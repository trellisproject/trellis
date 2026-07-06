import { beforeEach, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../src/db/index.js";
import { challenges, decisions } from "../src/db/schema.js";
import { ingestSpec } from "../src/lib/ingest.js";
import { writeFact } from "../src/lib/facts.js";
import { resolveDrift } from "../src/lib/drift-resolve.js";
import { fileChallenge, resolveChallenge } from "../src/lib/challenges.js";
import { resetDb, makeProject, addMember, grantDelegation } from "./helpers/db.js";

let projectId: string;
let operatorId: string;

// Produce a real decision to challenge: drift a fact, resolve it.
async function seedDecision(): Promise<string> {
  await ingestSpec(projectId, "core", `---\nspec: T-X\ntitle: T\n---\n### T-X-001: t\nstatus: agreed\n\nbody\n`, "c1");
  const f = await writeFact(projectId, {
    observerId: operatorId,
    key: "k",
    value: false,
    statement: "no",
    evidence: [{ type: "commit", ref: "c" }],
    links: [{ assertion: "T-X-001", relation: "contradicts" }],
  });
  if (!f.ok) throw new Error(f.code);
  const r = await resolveDrift(projectId, f.driftsCreated[0]!, { actorId: operatorId, choice: "accept", rationale: "fine" });
  if (!r.ok) throw new Error(r.code);
  return r.decisionId;
}

beforeEach(async () => {
  await resetDb();
  ({ projectId, operatorId } = await makeProject());
});

describe("challenges", () => {
  it("any member (even an undelegated agent) can file with rationale (TRL-CORE-027)", async () => {
    const decId = await seedDecision();
    const agent = await addMember(projectId, "agent", "member");
    const r = await fileChallenge(projectId, decId, agent, "this is too broad", ["T-X-001"]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe("open");
  });

  it("rejects a challenge without rationale", async () => {
    const decId = await seedDecision();
    const r = await fileChallenge(projectId, decId, operatorId, "  ", []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("MISSING_RATIONALE");
  });

  it("filing a challenge does not alter the challenged decision (TRL-CORE-028)", async () => {
    const decId = await seedDecision();
    const before = (await db.select().from(decisions).where(eq(decisions.id, decId)))[0]!;
    await fileChallenge(projectId, decId, operatorId, "disagree", []);
    const after = (await db.select().from(decisions).where(eq(decisions.id, decId)))[0]!;
    expect(after).toEqual(before);
  });

  it("uphold resolves the challenge via a new decision, leaving the original (TRL-CORE-029)", async () => {
    const decId = await seedDecision();
    const ch = await fileChallenge(projectId, decId, operatorId, "disagree", []);
    if (!ch.ok) throw new Error(ch.code);
    const r = await resolveChallenge(projectId, ch.value.id, { actorId: operatorId, choice: "uphold", rationale: "original stands" });
    expect(r.ok).toBe(true);
    const row = (await db.select().from(challenges).where(eq(challenges.id, ch.value.id)))[0]!;
    expect(row.status).toBe("resolved");
    if (r.ok) {
      const dec = (await db.select().from(decisions).where(eq(decisions.id, r.value.decisionId)))[0]!;
      expect(dec.onType).toBe("challenge");
      expect(dec.supersedesId).toBeNull(); // uphold does not supersede
    }
  });

  it("supersede records a decision that supersedes the challenged one", async () => {
    const decId = await seedDecision();
    const ch = await fileChallenge(projectId, decId, operatorId, "wrong call", []);
    if (!ch.ok) throw new Error(ch.code);
    const r = await resolveChallenge(projectId, ch.value.id, { actorId: operatorId, choice: "supersede", rationale: "reversing" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const dec = (await db.select().from(decisions).where(eq(decisions.id, r.value.decisionId)))[0]!;
      expect(dec.supersedesId).toBe(decId);
    }
  });

  it("a plain member cannot resolve a challenge (needs operator/delegation)", async () => {
    const decId = await seedDecision();
    const ch = await fileChallenge(projectId, decId, operatorId, "x", []);
    if (!ch.ok) throw new Error(ch.code);
    const member = await addMember(projectId, "human", "member");
    const r = await resolveChallenge(projectId, ch.value.id, { actorId: member, choice: "uphold", rationale: "no" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_OPERATOR");
  });

  it("a delegated agent can resolve when the class is authorized", async () => {
    const decId = await seedDecision();
    const ch = await fileChallenge(projectId, decId, operatorId, "x", []);
    if (!ch.ok) throw new Error(ch.code);
    const agent = await addMember(projectId, "agent", "member");
    const del = await grantDelegation(projectId, agent, operatorId, ["challenge.resolve"]);
    const r = await resolveChallenge(projectId, ch.value.id, { actorId: agent, choice: "uphold", rationale: "auto", delegatedById: del });
    expect(r.ok).toBe(true);
  });

  it("cannot resolve an already-resolved challenge", async () => {
    const decId = await seedDecision();
    const ch = await fileChallenge(projectId, decId, operatorId, "x", []);
    if (!ch.ok) throw new Error(ch.code);
    await resolveChallenge(projectId, ch.value.id, { actorId: operatorId, choice: "uphold", rationale: "one" });
    const r = await resolveChallenge(projectId, ch.value.id, { actorId: operatorId, choice: "uphold", rationale: "two" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("ALREADY_RESOLVED");
  });
});
