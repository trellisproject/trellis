import { beforeEach, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../src/db/index.js";
import { assertions as assertionsTable, tasks } from "../src/db/schema.js";
import { ingestSpec } from "../src/lib/ingest.js";
import {
  claimTask,
  checkpointTask,
  createTask,
  getTask,
  handoffTask,
  updateTaskStatus,
} from "../src/lib/tasks.js";
import { resetDb, makeProject, addMember } from "./helpers/db.js";

let projectId: string;
let operatorId: string;

async function seedAssertion(id = "T-X-001") {
  await ingestSpec(projectId, "core", `---\nspec: T-X\ntitle: T\n---\n### ${id}: t\nstatus: agreed\n\nbody\n`, "c1");
}
async function mkTask(title = "do the thing", opts: Parameters<typeof createTask>[1] = { title: "" }) {
  const r = await createTask(projectId, { ...opts, title });
  if (!r.ok) throw new Error(r.code);
  return r.value;
}

beforeEach(async () => {
  await resetDb();
  ({ projectId, operatorId } = await makeProject());
});

describe("tasks", () => {
  it("creates a task linked to an assertion (TRL-CORE-014)", async () => {
    await seedAssertion();
    const t = await mkTask("wire it up", { title: "", assertions: ["T-X-001"] });
    const full = await getTask(projectId, t.id);
    expect(full!.assertions).toHaveLength(1);
    expect(t.status).toBe("open");
  });

  it("rejects a link to an unknown assertion", async () => {
    const r = await createTask(projectId, { title: "x", assertions: ["T-X-999"] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("UNKNOWN_ASSERTION");
  });

  it("claim sets owner and moves open -> claimed", async () => {
    const t = await mkTask();
    const r = await claimTask(projectId, t.id, operatorId);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.ownerId).toBe(operatorId);
      expect(r.value.status).toBe("claimed");
    }
  });

  it("cannot claim a task owned by another principal", async () => {
    const t = await mkTask();
    await claimTask(projectId, t.id, operatorId);
    const other = await addMember(projectId, "agent", "member");
    const r = await claimTask(projectId, t.id, other);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("ALREADY_CLAIMED");
  });

  it("records a checkpoint that a fresh session can read (TRL-CORE-015)", async () => {
    const t = await mkTask();
    await claimTask(projectId, t.id, operatorId);
    await checkpointTask(projectId, t.id, operatorId, "did step 1");
    const full = await getTask(projectId, t.id);
    expect(full!.checkpoints).toHaveLength(1);
    expect(full!.checkpoints[0]!.note).toBe("did step 1");
  });

  it("handoff transfers ownership to another member", async () => {
    const t = await mkTask();
    await claimTask(projectId, t.id, operatorId);
    const agent = await addMember(projectId, "agent", "member");
    const r = await handoffTask(projectId, t.id, { principalId: operatorId, role: "operator" }, agent);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.ownerId).toBe(agent);
  });

  it("handoff to a non-member is rejected", async () => {
    const t = await mkTask();
    const r = await handoffTask(projectId, t.id, { principalId: operatorId, role: "operator" }, "00000000-0000-0000-0000-000000000000");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_MEMBER");
  });

  it("a non-owner member cannot hand off", async () => {
    const t = await mkTask();
    await claimTask(projectId, t.id, operatorId);
    const agent = await addMember(projectId, "agent", "member");
    const r = await handoffTask(projectId, t.id, { principalId: agent, role: "member" }, agent);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("FORBIDDEN");
  });

  it("status update respects optimistic version (TRL-API-005)", async () => {
    const t = await mkTask();
    const stale = await updateTaskStatus(projectId, t.id, { status: "in_progress", version: 999 });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.code).toBe("STALE_VERSION");
    const ok = await updateTaskStatus(projectId, t.id, { status: "in_progress", version: t.version });
    expect(ok.ok).toBe(true);
  });

  it("completing a task does not change linked assertion status (TRL-CORE-014)", async () => {
    await seedAssertion();
    const t = await mkTask("finish", { title: "", assertions: ["T-X-001"] });
    await updateTaskStatus(projectId, t.id, { status: "done" });
    const a = (await db.select().from(assertionsTable).where(eq(assertionsTable.humanId, "T-X-001")))[0]!;
    expect(a.status).toBe("agreed"); // unchanged — only facts change assertion status
  });
});
