import { beforeEach, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../src/db/index.js";
import { assertions, drifts, facts as factsTable } from "../src/db/schema.js";
import { writeFact } from "../src/lib/facts.js";
import { checkerQueue, triageQueue } from "../src/lib/queues.js";
import { ingestSpec } from "../src/lib/ingest.js";
import { resetDb, makeProject, authFor } from "./helpers/db.js";

const spec = (block: string) => `---\nspec: T-X\ntitle: T\n---\n${block}`;
const A = (id: string, status: string) => `### ${id}: t\nstatus: ${status}\n\nstatement for ${id}\n`;

let projectId: string;
let operatorId: string;

async function seed(block: string) {
  await ingestSpec(projectId, "core", spec(block), "c1");
}

const ev = [{ type: "commit" as const, ref: "abc123" }];

beforeEach(async () => {
  await resetDb();
  ({ projectId, operatorId } = await makeProject());
});

describe("writeFact provenance", () => {
  it("rejects a fact with no evidence (TRL-CORE-007)", async () => {
    const r = await writeFact(projectId, {
      observerId: operatorId,
      key: "k",
      value: true,
      statement: "s",
      evidence: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("MISSING_EVIDENCE");
  });

  it("rejects a fact from a non-member observer (TRL-CORE-016)", async () => {
    const r = await writeFact(projectId, {
      observerId: "00000000-0000-0000-0000-000000000000",
      key: "k",
      value: true,
      statement: "s",
      evidence: ev,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_MEMBER");
  });

  it("writes a supporting fact with no drift", async () => {
    await seed(A("T-X-001", "agreed"));
    const r = await writeFact(projectId, {
      observerId: operatorId,
      key: "k",
      value: true,
      statement: "holds",
      evidence: ev,
      links: [{ assertion: "T-X-001", relation: "supports" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.driftsCreated).toEqual([]);
  });
});

describe("automatic drift filing", () => {
  it("files drift and knocks an agreed assertion to drifted (TRL-CORE-010)", async () => {
    await seed(A("T-X-001", "agreed"));
    const r = await writeFact(projectId, {
      observerId: operatorId,
      key: "k",
      value: false,
      statement: "does not hold",
      evidence: ev,
      links: [{ assertion: "T-X-001", relation: "contradicts" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.driftsCreated).toHaveLength(1);
    const a = (await db.select().from(assertions).where(eq(assertions.humanId, "T-X-001")))[0]!;
    expect(a.status).toBe("drifted");
    expect(a.preDriftStatus).toBe("agreed");
    const d = await db.select().from(drifts).where(eq(drifts.assertionId, a.id));
    expect(d).toHaveLength(1);
  });

  it("attaches a second contradiction to the existing open drift (no duplicate)", async () => {
    await seed(A("T-X-001", "agreed"));
    const base = { observerId: operatorId, key: "k", value: false, statement: "no", evidence: ev, links: [{ assertion: "T-X-001", relation: "contradicts" as const }] };
    await writeFact(projectId, base);
    const r2 = await writeFact(projectId, base);
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.driftsCreated).toEqual([]); // attached, not a new drift
    const a = (await db.select().from(assertions).where(eq(assertions.humanId, "T-X-001")))[0]!;
    const d = await db.select().from(drifts).where(eq(drifts.assertionId, a.id));
    expect(d).toHaveLength(1);
  });

  it("does not drift a proposed assertion (only agreed-or-later)", async () => {
    await seed(A("T-X-001", "proposed"));
    const r = await writeFact(projectId, {
      observerId: operatorId,
      key: "k",
      value: false,
      statement: "no",
      evidence: ev,
      links: [{ assertion: "T-X-001", relation: "contradicts" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.driftsCreated).toEqual([]);
    const a = (await db.select().from(assertions).where(eq(assertions.humanId, "T-X-001")))[0]!;
    expect(a.status).toBe("proposed");
  });

  it("rejects a link to an unknown assertion", async () => {
    const r = await writeFact(projectId, {
      observerId: operatorId,
      key: "k",
      value: true,
      statement: "s",
      evidence: ev,
      links: [{ assertion: "T-X-999", relation: "supports" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("UNKNOWN_ASSERTION");
  });
});

describe("verification via supporting fact (TRL-CORE-005)", () => {
  const support = { observerId: "", key: "v", value: true, statement: "verified", evidence: ev, links: [{ assertion: "T-X-001", relation: "supports" as const }] };

  it("verifies an implemented assertion", async () => {
    await seed(A("T-X-001", "agreed"));
    await db.update(assertions).set({ status: "implemented" }).where(eq(assertions.humanId, "T-X-001"));
    const r = await writeFact(projectId, { ...support, observerId: operatorId });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.verified).toEqual(["T-X-001"]);
    expect((await db.select().from(assertions).where(eq(assertions.humanId, "T-X-001")))[0]!.status).toBe("verified");
  });

  it("verifies an agreed assertion", async () => {
    await seed(A("T-X-001", "agreed"));
    const r = await writeFact(projectId, { ...support, observerId: operatorId });
    if (r.ok) expect(r.verified).toEqual(["T-X-001"]);
    expect((await db.select().from(assertions).where(eq(assertions.humanId, "T-X-001")))[0]!.status).toBe("verified");
  });

  it("does not verify a proposed assertion", async () => {
    await seed(A("T-X-001", "proposed"));
    const r = await writeFact(projectId, { ...support, observerId: operatorId });
    if (r.ok) expect(r.verified).toEqual([]);
    expect((await db.select().from(assertions).where(eq(assertions.humanId, "T-X-001")))[0]!.status).toBe("proposed");
  });

  it("does not verify a drifted assertion (must resolve first)", async () => {
    await seed(A("T-X-001", "agreed"));
    // drift it via a contradicting fact
    await writeFact(projectId, { observerId: operatorId, key: "k", value: false, statement: "no", evidence: ev, links: [{ assertion: "T-X-001", relation: "contradicts" }] });
    const r = await writeFact(projectId, { ...support, observerId: operatorId });
    if (r.ok) expect(r.verified).toEqual([]);
    expect((await db.select().from(assertions).where(eq(assertions.humanId, "T-X-001")))[0]!.status).toBe("drifted");
  });
});

describe("work queues", () => {
  it("checker queue lists agreed assertions lacking a fresh supporting fact (TRL-CORE-009)", async () => {
    await seed(A("T-X-001", "agreed") + A("T-X-002", "agreed"));
    let q = await checkerQueue(projectId, 7);
    expect(q.map((r) => r.human_id).sort()).toEqual(["T-X-001", "T-X-002"]);

    // a fresh supporting fact drops T-X-001 off the queue
    await writeFact(projectId, {
      observerId: operatorId,
      key: "k",
      value: true,
      statement: "holds",
      evidence: ev,
      links: [{ assertion: "T-X-001", relation: "supports" }],
    });
    q = await checkerQueue(projectId, 7);
    expect(q.map((r) => r.human_id)).toEqual(["T-X-002"]);
  });

  it("triage queue returns the open drift", async () => {
    await seed(A("T-X-001", "agreed"));
    await writeFact(projectId, {
      observerId: operatorId,
      key: "k",
      value: false,
      statement: "no",
      evidence: ev,
      links: [{ assertion: "T-X-001", relation: "contradicts" }],
    });
    const q = await triageQueue(projectId);
    expect(q.drifts).toHaveLength(1);
    expect(q.challenges).toHaveLength(0);
  });
});

describe("facts route", () => {
  it("POST /facts returns 201 with the fact and any drifts", async () => {
    const { app } = await import("../src/app.js");
    const auth = await authFor(projectId, operatorId);
    await seed(A("T-X-001", "agreed"));
    const res = await app.request(`/projects/${projectId}/facts`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({
        key: "k",
        value: false,
        statement: "contradiction",
        evidence: [{ type: "commit", ref: "deadbeef" }],
        links: [{ assertion: "T-X-001", relation: "contradicts" }],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.fact.id).toBeTruthy();
    expect(body.fact.observerId).toBe(operatorId); // observer comes from the token
    expect(body.driftsCreated).toHaveLength(1);
  });

  it("POST /facts with empty evidence returns 422", async () => {
    const { app } = await import("../src/app.js");
    const auth = await authFor(projectId, operatorId);
    const res = await app.request(`/projects/${projectId}/facts`, {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ key: "k", value: 1, statement: "s", evidence: [] }),
    });
    expect(res.status).toBe(422);
  });

  it("POST /facts without a token returns 401", async () => {
    const { app } = await import("../src/app.js");
    const res = await app.request(`/projects/${projectId}/facts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "k", value: 1, statement: "s", evidence: [{ type: "commit", ref: "c" }] }),
    });
    expect(res.status).toBe(401);
  });
});
