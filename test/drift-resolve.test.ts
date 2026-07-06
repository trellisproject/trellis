import { beforeEach, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../src/db/index.js";
import { assertions, decisions, drifts, tasks } from "../src/db/schema.js";
import { ingestSpec } from "../src/lib/ingest.js";
import { writeFact } from "../src/lib/facts.js";
import { resolveDrift } from "../src/lib/drift-resolve.js";
import { resetDb, makeProject, addMember, grantDelegation } from "./helpers/db.js";

const spec = (block: string) => `---\nspec: T-X\ntitle: T\n---\n${block}`;
const A = (id: string, status: string) => `### ${id}: t\nstatus: ${status}\n\nstatement ${id}\n`;
const ev = [{ type: "commit" as const, ref: "c" }];

let projectId: string;
let operatorId: string;

// seed an agreed assertion that is already drifted; returns the drift id.
async function seedDrift(status = "agreed"): Promise<string> {
  await ingestSpec(projectId, "core", spec(A("T-X-001", status)), "c1");
  const r = await writeFact(projectId, {
    observerId: operatorId,
    key: "k",
    value: false,
    statement: "contradiction",
    evidence: ev,
    links: [{ assertion: "T-X-001", relation: "contradicts" }],
  });
  if (!r.ok) throw new Error(r.code);
  return r.driftsCreated[0]!;
}

const a001 = async () => (await db.select().from(assertions).where(eq(assertions.humanId, "T-X-001")))[0]!;

beforeEach(async () => {
  await resetDb();
  ({ projectId, operatorId } = await makeProject());
});

describe("drift resolution", () => {
  it("fix: restores prior status, records a decision, spawns a task (TRL-CORE-011/013)", async () => {
    const did = await seedDrift("agreed");
    const r = await resolveDrift(projectId, did, { actorId: operatorId, choice: "fix", rationale: "impl bug" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.assertionStatus).toBe("agreed");
      expect(r.taskId).toBeTruthy();
    }
    expect((await a001()).status).toBe("agreed");
    expect((await db.select().from(drifts).where(eq(drifts.id, did)))[0]!.status).toBe("resolved");
    const spawned = await db.select().from(tasks).where(eq(tasks.driftId, did));
    expect(spawned).toHaveLength(1);
  });

  it("accept: restores status and suppresses re-flag (TRL-CORE-012)", async () => {
    const did = await seedDrift("agreed");
    await resolveDrift(projectId, did, { actorId: operatorId, choice: "accept", rationale: "acceptable" });
    expect((await a001()).status).toBe("agreed");
    // a new contradicting fact must NOT create a fresh drift
    const r = await writeFact(projectId, {
      observerId: operatorId,
      key: "k",
      value: false,
      statement: "still contradicts",
      evidence: ev,
      links: [{ assertion: "T-X-001", relation: "contradicts" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.driftsCreated).toEqual([]);
    const allDrifts = await db.select().from(drifts).where(eq(drifts.assertionId, (await a001()).id));
    expect(allDrifts).toHaveLength(1);
  });

  it("amend: retires the assertion (TRL-CORE-013)", async () => {
    const did = await seedDrift("agreed");
    const r = await resolveDrift(projectId, did, { actorId: operatorId, choice: "amend", rationale: "spec was wrong" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.assertionStatus).toBe("retired");
    expect((await a001()).status).toBe("retired");
  });

  it("rejects an empty rationale (TRL-CORE-018)", async () => {
    const did = await seedDrift();
    const r = await resolveDrift(projectId, did, { actorId: operatorId, choice: "fix", rationale: "   " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("MISSING_RATIONALE");
  });

  it("rejects a non-operator human (TRL-API-012)", async () => {
    const did = await seedDrift();
    const memberId = await addMember(projectId, "human", "member");
    const r = await resolveDrift(projectId, did, { actorId: memberId, choice: "fix", rationale: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_OPERATOR");
  });

  it("rejects an agent without delegation (TRL-API-013)", async () => {
    const did = await seedDrift();
    const agentId = await addMember(projectId, "agent", "member");
    const r = await resolveDrift(projectId, did, { actorId: agentId, choice: "fix", rationale: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("DELEGATION_REQUIRED");
  });

  it("allows an agent with a valid delegation, recording it on the decision", async () => {
    const did = await seedDrift();
    const agentId = await addMember(projectId, "agent", "member");
    const delId = await grantDelegation(projectId, agentId, operatorId, ["drift.resolve"]);
    const r = await resolveDrift(projectId, did, {
      actorId: agentId,
      choice: "accept",
      rationale: "auto-accept per policy",
      delegatedById: delId,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const dec = (await db.select().from(decisions).where(eq(decisions.id, r.decisionId)))[0]!;
      expect(dec.delegatedById).toBe(delId);
      expect(dec.actorId).toBe(agentId);
    }
  });

  it("rejects an agent whose delegation lacks the class (TRL-API-013)", async () => {
    const did = await seedDrift();
    const agentId = await addMember(projectId, "agent", "member");
    const delId = await grantDelegation(projectId, agentId, operatorId, ["milestone.scope"]);
    const r = await resolveDrift(projectId, did, {
      actorId: agentId,
      choice: "fix",
      rationale: "x",
      delegatedById: delId,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("DELEGATION_SCOPE");
  });

  it("rejects resolving an already-resolved drift", async () => {
    const did = await seedDrift();
    await resolveDrift(projectId, did, { actorId: operatorId, choice: "fix", rationale: "one" });
    const r = await resolveDrift(projectId, did, { actorId: operatorId, choice: "fix", rationale: "two" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("ALREADY_RESOLVED");
  });
});
