import { beforeEach, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../src/db/index.js";
import { assertions } from "../src/db/schema.js";
import { ingestSpec } from "../src/lib/ingest.js";
import { changeMilestone, createMilestone, progressFor } from "../src/lib/milestones.js";
import { resetDb, makeProject, addMember, grantDelegation } from "./helpers/db.js";

let projectId: string;
let operatorId: string;

async function seed(ids: string[]) {
  const block = ids.map((id) => `### ${id}: t\nstatus: agreed\n\nbody ${id}\n`).join("\n");
  await ingestSpec(projectId, "core", `---\nspec: T-X\ntitle: T\n---\n${block}`, "c1");
}
const setStatus = (humanId: string, status: string) =>
  db.update(assertions).set({ status: status as "verified" }).where(eq(assertions.humanId, humanId));

beforeEach(async () => {
  await resetDb();
  ({ projectId, operatorId } = await makeProject());
});

describe("milestones", () => {
  it("computes progress as verified/total (TRL-CORE-024)", async () => {
    await seed(["T-X-001", "T-X-002", "T-X-003"]);
    const r = await createMilestone(projectId, { title: "M1", assertions: ["T-X-001", "T-X-002", "T-X-003"] });
    if (!r.ok) throw new Error(r.code);
    await setStatus("T-X-001", "verified");
    const p = (await progressFor(projectId)).get(r.value.id)!;
    expect(p).toEqual({ verified: 1, total: 3 });
  });

  it("a drifted assertion is not counted verified (roadmap can't claim it)", async () => {
    await seed(["T-X-001", "T-X-002"]);
    const r = await createMilestone(projectId, { title: "M1", assertions: ["T-X-001", "T-X-002"] });
    if (!r.ok) throw new Error(r.code);
    await setStatus("T-X-001", "verified");
    await setStatus("T-X-002", "verified");
    expect((await progressFor(projectId)).get(r.value.id)).toEqual({ verified: 2, total: 2 });
    await setStatus("T-X-001", "drifted");
    expect((await progressFor(projectId)).get(r.value.id)).toEqual({ verified: 1, total: 2 });
  });

  it("a retired assertion drops out of the total", async () => {
    await seed(["T-X-001", "T-X-002"]);
    const r = await createMilestone(projectId, { title: "M1", assertions: ["T-X-001", "T-X-002"] });
    if (!r.ok) throw new Error(r.code);
    await setStatus("T-X-001", "retired");
    expect((await progressFor(projectId)).get(r.value.id)).toEqual({ verified: 0, total: 1 });
  });

  it("a scope change requires a decision rationale (TRL-CORE-018)", async () => {
    await seed(["T-X-001"]);
    const r = await createMilestone(projectId, { title: "M1" });
    if (!r.ok) throw new Error(r.code);
    const noDec = await changeMilestone(projectId, r.value.id, { addAssertions: ["T-X-001"] });
    expect(noDec.ok).toBe(false);
    if (!noDec.ok) expect(noDec.code).toBe("MISSING_RATIONALE");

    const withDec = await changeMilestone(projectId, r.value.id, {
      addAssertions: ["T-X-001"],
      decision: { actorId: operatorId, rationale: "pulling this in" },
    });
    expect(withDec.ok).toBe(true);
    if (withDec.ok) expect(withDec.value.decisionId).toBeTruthy();
    expect((await progressFor(projectId)).get(r.value.id)).toEqual({ verified: 0, total: 1 });
  });

  it("a date change requires a decision", async () => {
    const r = await createMilestone(projectId, { title: "M1", targetDate: "2026-08-01" });
    if (!r.ok) throw new Error(r.code);
    const noDec = await changeMilestone(projectId, r.value.id, { targetDate: "2026-09-01" });
    expect(noDec.ok).toBe(false);
    if (!noDec.ok) expect(noDec.code).toBe("MISSING_RATIONALE");
  });

  it("a title-only change needs no decision", async () => {
    const r = await createMilestone(projectId, { title: "M1" });
    if (!r.ok) throw new Error(r.code);
    const changed = await changeMilestone(projectId, r.value.id, { title: "Renamed" });
    expect(changed.ok).toBe(true);
    if (changed.ok) expect(changed.value.decisionId).toBeNull();
  });

  it("a non-operator cannot make a scope-change decision", async () => {
    await seed(["T-X-001"]);
    const r = await createMilestone(projectId, { title: "M1" });
    if (!r.ok) throw new Error(r.code);
    const member = await addMember(projectId, "human", "member");
    const res = await changeMilestone(projectId, r.value.id, {
      addAssertions: ["T-X-001"],
      decision: { actorId: member, rationale: "x" },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("NOT_OPERATOR");
  });

  it("a delegated agent can make a scope change when authorized", async () => {
    await seed(["T-X-001"]);
    const r = await createMilestone(projectId, { title: "M1" });
    if (!r.ok) throw new Error(r.code);
    const agent = await addMember(projectId, "agent", "member");
    const del = await grantDelegation(projectId, agent, operatorId, ["milestone.change"]);
    const res = await changeMilestone(projectId, r.value.id, {
      addAssertions: ["T-X-001"],
      decision: { actorId: agent, rationale: "auto", delegatedById: del },
    });
    expect(res.ok).toBe(true);
  });
});
