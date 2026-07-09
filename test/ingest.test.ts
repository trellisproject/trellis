import { beforeEach, describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db/index.js";
import { assertions, specs } from "../src/db/schema.js";
import { ingestSpec } from "../src/lib/ingest.js";
import { resetDb, makeProject } from "./helpers/db.js";

const spec = (assertionsBlock: string) =>
  `---\nproject: t\nspec: T-X\ntitle: T\n---\n\n# T\n\n${assertionsBlock}`;

const A = (id: string, status: string, body: string) =>
  `### ${id}: title\nstatus: ${status}\n\n${body}\n`;

let projectId: string;

beforeEach(async () => {
  await resetDb();
  ({ projectId } = await makeProject());
});

describe("ingestSpec", () => {
  it("creates all assertions on first ingest", async () => {
    const src = spec(A("T-X-001", "agreed", "first") + "\n" + A("T-X-002", "proposed", "second"));
    const r = await ingestSpec(projectId, "core", src, "c1");
    expect(r.ok).toBe(true);
    expect(r.created.sort()).toEqual(["T-X-001", "T-X-002"]);
    const rows = await db.select().from(assertions).where(eq(assertions.projectId, projectId));
    expect(rows).toHaveLength(2);
  });

  it("clamps an authored status above agreed to agreed (TRL-CORE-005)", async () => {
    // A source file must not be able to birth a `verified` assertion with no
    // supporting fact; ingestion clamps it to `agreed`.
    const src = spec(A("T-X-001", "verified", "born verified in the file"));
    const r = await ingestSpec(projectId, "core", src, "cv");
    expect(r.ok).toBe(true);
    const row = (await db.select().from(assertions).where(eq(assertions.projectId, projectId)))[0]!;
    expect(row.status).toBe("agreed");
  });

  it("is a no-op when re-ingesting the same commit (TRL-API-014)", async () => {
    const src = spec(A("T-X-001", "agreed", "body"));
    await ingestSpec(projectId, "core", src, "c1");
    const changed = spec(A("T-X-001", "agreed", "DIFFERENT body"));
    const r = await ingestSpec(projectId, "core", changed, "c1"); // same commit
    expect(r.created).toEqual([]);
    expect(r.statementsUpdated).toEqual([]);
    const row = (await db.select().from(assertions).where(eq(assertions.humanId, "T-X-001")))[0]!;
    expect(row.statement).toBe("body"); // unchanged: commit was idempotent
  });

  it("bumps version and reports statementsUpdated on a changed statement", async () => {
    await ingestSpec(projectId, "core", spec(A("T-X-001", "agreed", "original")), "c1");
    const r = await ingestSpec(projectId, "core", spec(A("T-X-001", "agreed", "revised")), "c2");
    expect(r.statementsUpdated).toEqual(["T-X-001"]);
    const row = (await db.select().from(assertions).where(eq(assertions.humanId, "T-X-001")))[0]!;
    expect(row.statement).toBe("revised");
    expect(row.version).toBe(2);
  });

  it("retires an assertion absent from the file, without deleting it (TRL-CORE-002)", async () => {
    await ingestSpec(projectId, "core", spec(A("T-X-001", "agreed", "a") + A("T-X-002", "agreed", "b")), "c1");
    const r = await ingestSpec(projectId, "core", spec(A("T-X-001", "agreed", "a")), "c2");
    expect(r.retired).toEqual(["T-X-002"]);
    const row = (await db.select().from(assertions).where(eq(assertions.humanId, "T-X-002")))[0]!;
    expect(row).toBeDefined();
    expect(row.status).toBe("retired");
  });

  it("does not downgrade a server-advanced status on re-ingest (TRL-CORE-021)", async () => {
    await ingestSpec(projectId, "core", spec(A("T-X-001", "agreed", "body")), "c1");
    // simulate the assertion advancing past its authored status
    await db.update(assertions).set({ status: "implemented" }).where(eq(assertions.humanId, "T-X-001"));
    await ingestSpec(projectId, "core", spec(A("T-X-001", "agreed", "body v2")), "c2");
    const row = (await db.select().from(assertions).where(eq(assertions.humanId, "T-X-001")))[0]!;
    expect(row.status).toBe("implemented"); // file said 'agreed' but server state wins
    expect(row.statement).toBe("body v2"); // statement still updated from git
  });

  it("rejects a malformed spec atomically and writes nothing (TRL-API-009)", async () => {
    const bad = spec("### T-X-001: no status line\n\nbody\n");
    const r = await ingestSpec(projectId, "core", bad, "c1");
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
    const rows = await db.select().from(specs).where(and(eq(specs.projectId, projectId), eq(specs.slug, "core")));
    expect(rows).toHaveLength(0); // nothing persisted
  });
});
