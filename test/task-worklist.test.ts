import { beforeEach, describe, it, expect } from "vitest";
import { resetDb, makeProject, addMember } from "./helpers/db.js";
import { createTask, updateTaskStatus } from "../src/lib/tasks.js";
import { createEffort } from "../src/lib/efforts.js";
import { worklist } from "../src/lib/worklist.js";

const daysFromNow = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
let projectId: string, operatorId: string;
beforeEach(async () => { await resetDb(); ({ projectId, operatorId } = await makeProject()); });

describe("tasks as first-class work — the Do bucket", () => {
  it("a standalone task with no assertion shows in the Do bucket", async () => {
    const t = await createTask(projectId, { title: "Get a Stripe API key" });
    expect(t.ok).toBe(true);
    const wl = await worklist(projectId);
    expect(wl.do.map((i) => i.title)).toContain("Get a Stripe API key");
    expect(wl.do[0]!.kind).toBe("task");
  });

  it("a task inherits its effort's owner and deadline", async () => {
    const e = await createEffort(projectId, { title: "Payments", ownerId: operatorId, targetDate: daysFromNow(3), commitment: true });
    if (!e.ok) throw new Error(e.code);
    await createTask(projectId, { title: "Wire webhooks", effortId: e.value.id });
    const item = (await worklist(projectId)).do.find((i) => i.title === "Wire webhooks");
    expect(item?.owner).toBe("Op");
    expect(item?.dueInDays).toBeLessThanOrEqual(3);
    expect(item?.commitment).toBe(true);
  });

  it("scopes the Do bucket by owner — area owner or direct assignee", async () => {
    const intern = await addMember(projectId, "human", "operator", "Intern");
    const e = await createEffort(projectId, { title: "Intern area", ownerId: intern });
    if (!e.ok) throw new Error(e.code);
    await createTask(projectId, { title: "intern task", effortId: e.value.id });
    await createTask(projectId, { title: "op direct", ownerId: operatorId });
    const titles = (await worklist(projectId, { ownerId: intern })).do.map((i) => i.title);
    expect(titles).toContain("intern task");
    expect(titles).not.toContain("op direct");
  });

  it("a done task drops out of the Do bucket", async () => {
    const t = await createTask(projectId, { title: "one-off" });
    if (!t.ok) throw new Error("create failed");
    await updateTaskStatus(projectId, t.value.id, { status: "done" });
    expect((await worklist(projectId)).do.map((i) => i.title)).not.toContain("one-off");
  });

  it("a direct owner overrides the area owner on a task", async () => {
    const intern = await addMember(projectId, "human", "operator", "Intern");
    const e = await createEffort(projectId, { title: "Op area", ownerId: operatorId });
    if (!e.ok) throw new Error(e.code);
    await createTask(projectId, { title: "delegated", effortId: e.value.id, ownerId: intern });
    const item = (await worklist(projectId)).do.find((i) => i.title === "delegated");
    expect(item?.owner).toBe("Intern");
  });
});
