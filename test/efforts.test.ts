import { beforeEach, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../src/db/index.js";
import { assertions } from "../src/db/schema.js";
import { ingestSpec } from "../src/lib/ingest.js";
import { changeEffort, createEffort, listEfforts, progressFor } from "../src/lib/efforts.js";
import { resetDb, makeProject, addMember } from "./helpers/db.js";

let projectId: string;
let operatorId: string;

async function seed(ids: string[]) {
  const block = ids.map((id) => `### ${id}: t\nstatus: agreed\n\nbody ${id}\n`).join("\n");
  await ingestSpec(projectId, "core", `---\nspec: T-X\ntitle: T\n---\n${block}`, "c1");
}
const setStatus = (h: string, s: string) => db.update(assertions).set({ status: s as "verified" }).where(eq(assertions.humanId, h));

beforeEach(async () => {
  await resetDb();
  ({ projectId, operatorId } = await makeProject());
});

describe("efforts — the focus stack", () => {
  it("creates efforts with status and goal type", async () => {
    const r = await createEffort(projectId, { title: "Extraction accuracy", status: "active", goalType: "metric", goalTarget: ">= 95% on ACORD-125" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe("active");
      expect(r.value.goalType).toBe("metric");
      expect(r.value.goalTarget).toBe(">= 95% on ACORD-125");
    }
  });

  it("computes checklist progress as verified/total (TRL-CORE-024)", async () => {
    await seed(["T-X-001", "T-X-002", "T-X-003"]);
    const r = await createEffort(projectId, { title: "Onboarding", assertions: ["T-X-001", "T-X-002", "T-X-003"] });
    if (!r.ok) throw new Error(r.code);
    await setStatus("T-X-001", "verified");
    expect((await progressFor(projectId)).get(r.value.id)).toEqual({ verified: 1, total: 3 });
  });

  it("orders the stack by attention (active, next, someday, done)", async () => {
    await createEffort(projectId, { title: "someday one", status: "someday" });
    await createEffort(projectId, { title: "active one", status: "active" });
    await createEffort(projectId, { title: "next one", status: "next" });
    await createEffort(projectId, { title: "done one", status: "done" });
    const list = await listEfforts(projectId);
    expect(list.map((e) => e.title)).toEqual(["active one", "next one", "someday one", "done one"]);
  });

  it("changing status is fluid — no decision required", async () => {
    const r = await createEffort(projectId, { title: "e", status: "next" });
    if (!r.ok) throw new Error(r.code);
    const changed = await changeEffort(projectId, r.value.id, { status: "active" });
    expect(changed.ok).toBe(true);
    if (changed.ok) expect(changed.value.decisionId).toBeNull();
    const list = await listEfforts(projectId);
    expect(list[0]!.status).toBe("active");
  });

  it("changing scope requires a decision (TRL-CORE-018)", async () => {
    await seed(["T-X-001"]);
    const r = await createEffort(projectId, { title: "e" });
    if (!r.ok) throw new Error(r.code);
    const noDec = await changeEffort(projectId, r.value.id, { addAssertions: ["T-X-001"] });
    expect(noDec.ok).toBe(false);
    if (!noDec.ok) expect(noDec.code).toBe("MISSING_RATIONALE");
    const withDec = await changeEffort(projectId, r.value.id, { addAssertions: ["T-X-001"], decision: { actorId: operatorId, rationale: "pulling into scope" } });
    expect(withDec.ok).toBe(true);
    if (withDec.ok) expect(withDec.value.decisionId).toBeTruthy();
  });

  it("a non-operator cannot make a scope decision", async () => {
    await seed(["T-X-001"]);
    const r = await createEffort(projectId, { title: "e" });
    if (!r.ok) throw new Error(r.code);
    const member = await addMember(projectId, "human", "member");
    const res = await changeEffort(projectId, r.value.id, { addAssertions: ["T-X-001"], decision: { actorId: member, rationale: "x" } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("NOT_OPERATOR");
  });
});
