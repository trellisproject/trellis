// Task operations: create, claim, checkpoint, handoff, status update.
// TRL-CORE-014 (link to intent; completing a task never changes assertion
// status) and TRL-CORE-015 (checkpoint + handoff so a fresh agent resumes).

import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  assertions,
  drifts,
  memberships,
  taskAssertions,
  taskCheckpoints,
  taskDependencies,
  tasks,
} from "../db/schema.js";

export type TaskStatus = "open" | "claimed" | "in_progress" | "done" | "blocked";

type Result<T> = { ok: true; value: T } | { ok: false; code: string; error: string };

async function isMember(projectId: string, principalId: string): Promise<boolean> {
  const m = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.projectId, projectId), eq(memberships.principalId, principalId)));
  return m.length > 0;
}

export async function createTask(
  projectId: string,
  input: { title: string; assertions?: string[]; driftId?: string | null; dependsOn?: string[] },
): Promise<Result<typeof tasks.$inferSelect>> {
  // resolve assertion links by human id (TRL-CORE-014)
  let assertionIds: string[] = [];
  if (input.assertions?.length) {
    const rows = await db
      .select()
      .from(assertions)
      .where(and(eq(assertions.projectId, projectId), inArray(assertions.humanId, input.assertions)));
    const map = new Map(rows.map((r) => [r.humanId, r.id]));
    const missing = input.assertions.filter((h) => !map.has(h));
    if (missing.length) return { ok: false, code: "UNKNOWN_ASSERTION", error: `Unknown: ${missing.join(", ")}` };
    assertionIds = input.assertions.map((h) => map.get(h)!);
  }
  if (input.driftId) {
    const d = (await db.select().from(drifts).where(eq(drifts.id, input.driftId)))[0];
    if (!d || d.projectId !== projectId) return { ok: false, code: "UNKNOWN_DRIFT", error: "Unknown drift" };
  }

  const task = await db.transaction(async (tx) => {
    const t = (
      await tx.insert(tasks).values({ projectId, title: input.title, driftId: input.driftId ?? null }).returning()
    )[0]!;
    for (const aid of assertionIds) await tx.insert(taskAssertions).values({ taskId: t.id, assertionId: aid });
    for (const dep of input.dependsOn ?? []) {
      if (dep === t.id) continue; // no self-dependency
      await tx.insert(taskDependencies).values({ taskId: t.id, dependsOnTaskId: dep });
    }
    return t;
  });
  return { ok: true, value: task };
}

export async function claimTask(
  projectId: string,
  taskId: string,
  principalId: string,
): Promise<Result<typeof tasks.$inferSelect>> {
  const task = (await db.select().from(tasks).where(eq(tasks.id, taskId)))[0];
  if (!task || task.projectId !== projectId) return { ok: false, code: "NOT_FOUND", error: "Task not found" };
  if (task.status === "done") return { ok: false, code: "CONFLICT", error: "Task is done" };
  if (task.ownerId && task.ownerId !== principalId) {
    return { ok: false, code: "ALREADY_CLAIMED", error: "Task is owned by another principal" };
  }
  const updated = (
    await db
      .update(tasks)
      .set({ ownerId: principalId, status: task.status === "open" ? "claimed" : task.status, version: task.version + 1, updatedAt: new Date() })
      .where(eq(tasks.id, taskId))
      .returning()
  )[0]!;
  return { ok: true, value: updated };
}

export async function checkpointTask(
  projectId: string,
  taskId: string,
  principalId: string,
  note: string,
): Promise<Result<{ id: string }>> {
  const task = (await db.select().from(tasks).where(eq(tasks.id, taskId)))[0];
  if (!task || task.projectId !== projectId) return { ok: false, code: "NOT_FOUND", error: "Task not found" };
  const cp = (
    await db.insert(taskCheckpoints).values({ taskId, byPrincipalId: principalId, note }).returning()
  )[0]!;
  return { ok: true, value: { id: cp.id } };
}

export async function handoffTask(
  projectId: string,
  taskId: string,
  caller: { principalId: string; role: "operator" | "member" },
  toPrincipalId: string,
): Promise<Result<typeof tasks.$inferSelect>> {
  const task = (await db.select().from(tasks).where(eq(tasks.id, taskId)))[0];
  if (!task || task.projectId !== projectId) return { ok: false, code: "NOT_FOUND", error: "Task not found" };
  // Only the current owner or an operator can hand off (TRL-CORE-015).
  if (caller.role !== "operator" && task.ownerId !== caller.principalId) {
    return { ok: false, code: "FORBIDDEN", error: "Only the owner or an operator can hand off" };
  }
  if (!(await isMember(projectId, toPrincipalId))) {
    return { ok: false, code: "NOT_MEMBER", error: "Recipient is not a project member" };
  }
  const updated = (
    await db
      .update(tasks)
      .set({ ownerId: toPrincipalId, version: task.version + 1, updatedAt: new Date() })
      .where(eq(tasks.id, taskId))
      .returning()
  )[0]!;
  return { ok: true, value: updated };
}

export async function updateTaskStatus(
  projectId: string,
  taskId: string,
  input: { status?: TaskStatus; title?: string; version?: number },
): Promise<Result<typeof tasks.$inferSelect>> {
  const task = (await db.select().from(tasks).where(eq(tasks.id, taskId)))[0];
  if (!task || task.projectId !== projectId) return { ok: false, code: "NOT_FOUND", error: "Task not found" };
  // TRL-API-005: optimistic concurrency when a version is supplied.
  if (input.version !== undefined && input.version !== task.version) {
    return { ok: false, code: "STALE_VERSION", error: "Task was modified since last read" };
  }
  const updated = (
    await db
      .update(tasks)
      .set({
        status: input.status ?? task.status,
        title: input.title ?? task.title,
        version: task.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, taskId))
      .returning()
  )[0]!;
  return { ok: true, value: updated };
}

export async function getTask(projectId: string, taskId: string) {
  const task = (await db.select().from(tasks).where(eq(tasks.id, taskId)))[0];
  if (!task || task.projectId !== projectId) return null;
  const links = await db
    .select({ assertionId: taskAssertions.assertionId })
    .from(taskAssertions)
    .where(eq(taskAssertions.taskId, taskId));
  const checkpoints = await db
    .select()
    .from(taskCheckpoints)
    .where(eq(taskCheckpoints.taskId, taskId));
  const deps = await db
    .select({ dependsOn: taskDependencies.dependsOnTaskId })
    .from(taskDependencies)
    .where(eq(taskDependencies.taskId, taskId));
  return { task, assertions: links.map((l) => l.assertionId), checkpoints, dependsOn: deps.map((d) => d.dependsOn) };
}
