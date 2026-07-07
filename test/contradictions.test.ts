import { beforeEach, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../src/db/index.js";
import { assertions, drifts } from "../src/db/schema.js";
import { ingestSpec } from "../src/lib/ingest.js";
import { fileContradiction } from "../src/lib/contradictions.js";
import { resolveDrift } from "../src/lib/drift-resolve.js";
import { resetDb, makeProject } from "./helpers/db.js";

let projectId: string;
let operatorId: string;

async function seed(...specs: [string, string][]) {
  const block = specs.map(([id, st]) => `### ${id}: t\nstatus: ${st}\n\nbody ${id}\n`).join("\n");
  await ingestSpec(projectId, "core", `---\nspec: T-X\ntitle: T\n---\n${block}`, "c1");
}
const statusOf = async (h: string) => (await db.select().from(assertions).where(eq(assertions.humanId, h)))[0]!.status;

beforeEach(async () => {
  await resetDb();
  ({ projectId, operatorId } = await makeProject());
});

describe("contradiction drift (TRL-CORE-025)", () => {
  it("files a contradiction and drifts both assertions", async () => {
    await seed(["T-X-001", "agreed"], ["T-X-002", "agreed"]);
    const r = await fileContradiction(projectId, "T-X-001", "T-X-002", "these conflict", operatorId);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.kind).toBe("contradiction");
      expect(r.value.assertionBId).toBeTruthy();
    }
    expect(await statusOf("T-X-001")).toBe("drifted");
    expect(await statusOf("T-X-002")).toBe("drifted");
  });

  it("rejects a self-contradiction", async () => {
    await seed(["T-X-001", "agreed"]);
    const r = await fileContradiction(projectId, "T-X-001", "T-X-001", "x", operatorId);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("SAME_ASSERTION");
  });

  it("requires both assertions to be agreed-or-later", async () => {
    await seed(["T-X-001", "agreed"], ["T-X-002", "proposed"]);
    const r = await fileContradiction(projectId, "T-X-001", "T-X-002", "x", operatorId);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_DRIFTABLE");
  });

  it("dedups an open contradiction for the same pair (either order)", async () => {
    await seed(["T-X-001", "agreed"], ["T-X-002", "agreed"]);
    const a = await fileContradiction(projectId, "T-X-001", "T-X-002", "x", operatorId);
    const b = await fileContradiction(projectId, "T-X-002", "T-X-001", "again", operatorId);
    if (a.ok && b.ok) expect(b.value.id).toBe(a.value.id);
    const all = await db.select().from(drifts).where(eq(drifts.kind, "contradiction"));
    expect(all).toHaveLength(1);
  });

  it("resolving with accept restores BOTH assertions (TRL-CORE-013/025)", async () => {
    await seed(["T-X-001", "agreed"], ["T-X-002", "implemented"]);
    const r = await fileContradiction(projectId, "T-X-001", "T-X-002", "x", operatorId);
    if (!r.ok) throw new Error(r.code);
    const res = await resolveDrift(projectId, r.value.id, { actorId: operatorId, choice: "accept", rationale: "coexist" });
    expect(res.ok).toBe(true);
    expect(await statusOf("T-X-001")).toBe("agreed"); // restored to prior
    expect(await statusOf("T-X-002")).toBe("implemented"); // restored to its own prior
  });

  it("resolving a contradiction goes through the decision mechanism", async () => {
    await seed(["T-X-001", "agreed"], ["T-X-002", "agreed"]);
    const r = await fileContradiction(projectId, "T-X-001", "T-X-002", "x", operatorId);
    if (!r.ok) throw new Error(r.code);
    const res = await resolveDrift(projectId, r.value.id, { actorId: operatorId, choice: "fix", rationale: "reworking 002" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.decisionId).toBeTruthy();
    expect((await db.select().from(drifts).where(eq(drifts.id, r.value.id)))[0]!.status).toBe("resolved");
  });
});
