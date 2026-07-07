import { beforeEach, describe, it, expect } from "vitest";
import { resetDb, makeProject, addMember } from "./helpers/db.js";
import { createEffort, changeEffort, listEfforts } from "../src/lib/efforts.js";
import { worklist } from "../src/lib/worklist.js";
import { createSpec, createAssertion } from "../src/lib/authoring.js";

const daysFromNow = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

let projectId: string, operatorId: string;
beforeEach(async () => {
  await resetDb();
  ({ projectId, operatorId } = await makeProject());
  await createSpec(projectId, { slug: "s", title: "S", code: "T" });
});
async function assertion(title = "a"): Promise<string> {
  const r = await createAssertion(projectId, "s", { title, statement: "must hold" });
  if (!r.ok) throw new Error(r.code);
  return r.value.humanId;
}

describe("effort ownership + deadline-fed attention", () => {
  it("assigns an owner to an effort (fluid) and lists the owner name", async () => {
    const e = await createEffort(projectId, { title: "Onboarding", ownerId: operatorId });
    expect(e.ok).toBe(true);
    const list = await listEfforts(projectId);
    expect(list[0]!.ownerId).toBe(operatorId);
    expect(list[0]!.ownerName).toBe("Op");
  });

  it("scopes the worklist by owner — you see the work under efforts you own, not others'", async () => {
    const intern = await addMember(projectId, "human", "operator", "Intern");
    const mine = await assertion("op-area");
    const theirs = await assertion("intern-area");
    await createEffort(projectId, { title: "Op area", ownerId: operatorId, assertions: [mine] });
    await createEffort(projectId, { title: "Intern area", ownerId: intern, assertions: [theirs] });
    const wl = await worklist(projectId, { ownerId: intern });
    const ids = wl.agree.map((i) => i.ref);
    expect(ids).toContain(theirs);
    expect(ids).not.toContain(mine);
  });

  it("a due-soon effort floats above a dateless someday effort in the roadmap", async () => {
    await createEffort(projectId, { title: "Someday thing", status: "someday" });
    await createEffort(projectId, { title: "Client commit", status: "someday", targetDate: daysFromNow(3), commitment: true });
    const list = await listEfforts(projectId);
    expect(list[0]!.title).toBe("Client commit");
    expect(list[0]!.dueSoon).toBe(true);
    expect(list[0]!.dueInDays).toBeLessThanOrEqual(3);
  });

  it("worklist items inherit their effort's owner + deadline, and due-soon sorts up", async () => {
    const soon = await assertion("due-soon");
    const later = await assertion("no-date");
    await createEffort(projectId, { title: "committed", ownerId: operatorId, targetDate: daysFromNow(2), commitment: true, assertions: [soon] });
    await createEffort(projectId, { title: "open", assertions: [later] });
    const wl = await worklist(projectId);
    expect(wl.agree[0]!.ref).toBe(soon); // due-soon floats to the top
    expect(wl.agree[0]!.owner).toBe("Op");
    expect(wl.agree[0]!.dueInDays).toBeLessThanOrEqual(2);
    expect(wl.agree[0]!.commitment).toBe(true);
    expect(wl.agree.find((i) => i.ref === later)!.dueInDays ?? null).toBeNull();
  });

  it("assigning an owner is fluid, but changing a target date still needs a decision", async () => {
    const e = await createEffort(projectId, { title: "E" });
    if (!e.ok) throw new Error(e.code);
    expect((await changeEffort(projectId, e.value.id, { ownerId: operatorId })).ok).toBe(true);
    const dated = await changeEffort(projectId, e.value.id, { targetDate: daysFromNow(10) });
    expect(dated.ok).toBe(false); // MISSING_RATIONALE
  });
});
