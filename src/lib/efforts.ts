// Efforts — the roadmap's focus stack (TRL-CORE-024/036/037). An effort is a
// major effort ordered by attention (active/next/someday/done) with a goal
// (checklist of assertions | metric threshold | open-ended). Progress is
// computed from verified facts, never hand-set. Scope/date changes are decisions.

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { assertions, decisions, effortAssertions, efforts, principals, tasks } from "../db/schema.js";
import { authorizeDecider } from "./decisions.js";

type Result<T> = { ok: true; value: T } | { ok: false; code: string; error: string };

export type Progress = { verified: number; total: number };
export type EffortStatus = "active" | "next" | "someday" | "done";
export type GoalType = "checklist" | "metric" | "open";

// A deadline feeds attention rather than replacing it: within this many days of
// its target date, a (non-done) effort surfaces as if active and its work is
// flagged. Most efforts have no date and are purely attention-ordered.
export const LEAD_DAYS = 7;
export function deadlineInfo(targetDate: string | null, status: string): { dueInDays: number | null; dueSoon: boolean } {
  if (!targetDate) return { dueInDays: null, dueSoon: false };
  const dueInDays = Math.ceil((new Date(targetDate + "T00:00:00Z").getTime() - Date.now()) / 86400000);
  return { dueInDays, dueSoon: status !== "done" && dueInDays <= LEAD_DAYS };
}

async function resolveAssertionIds(projectId: string, humanIds: string[]): Promise<Result<string[]>> {
  if (humanIds.length === 0) return { ok: true, value: [] };
  const rows = await db.select().from(assertions).where(and(eq(assertions.projectId, projectId), inArray(assertions.humanId, humanIds)));
  const map = new Map(rows.map((r) => [r.humanId, r.id]));
  const missing = humanIds.filter((h) => !map.has(h));
  if (missing.length) return { ok: false, code: "UNKNOWN_ASSERTION", error: `Unknown: ${missing.join(", ")}` };
  return { ok: true, value: humanIds.map((h) => map.get(h)!) };
}

// TRL-CORE-024: verified over total, excluding retired (no longer intent).
export async function progressFor(projectId: string): Promise<Map<string, Progress>> {
  const rows = (await db.execute(sql`
    SELECT m.id AS effort_id,
           COUNT(a.id) FILTER (WHERE a.status <> 'retired') AS total,
           COUNT(a.id) FILTER (WHERE a.status = 'verified') AS verified
    FROM ${efforts} m
    LEFT JOIN milestone_assertions ma ON ma.milestone_id = m.id
    LEFT JOIN assertions a ON a.id = ma.assertion_id
    WHERE m.project_id = ${projectId}
    GROUP BY m.id
  `)) as unknown as { effort_id: string; total: number; verified: number }[];
  return new Map(rows.map((r) => [r.effort_id, { verified: Number(r.verified), total: Number(r.total) }]));
}

export type EffortAssertion = {
  humanId: string; title: string; status: string;
  metricKey: string | null; metricComparator: string | null; metricTarget: number | null; metricUnit: string | null;
  latestValue: number | null; // live measurement for metric assertions (TRL-CORE-038)
};

// Latest measured value per metric key in the project.
async function latestMeasurements(projectId: string): Promise<Map<string, number>> {
  const rows = (await db.execute(sql`
    SELECT DISTINCT ON (metric_key) metric_key, measured_value
    FROM facts
    WHERE project_id = ${projectId} AND metric_key IS NOT NULL AND measured_value IS NOT NULL
    ORDER BY metric_key, observed_at DESC
  `)) as unknown as { metric_key: string; measured_value: number }[];
  return new Map(rows.map((r) => [r.metric_key, Number(r.measured_value)]));
}

export async function assertionsByEffort(projectId: string): Promise<Map<string, EffortAssertion[]>> {
  const [rows, latest] = await Promise.all([
    db
      .select({
        effortId: effortAssertions.effortId, humanId: assertions.humanId, title: assertions.title, status: assertions.status,
        metricKey: assertions.metricKey, metricComparator: assertions.metricComparator, metricTarget: assertions.metricTarget, metricUnit: assertions.metricUnit,
      })
      .from(effortAssertions)
      .innerJoin(efforts, eq(efforts.id, effortAssertions.effortId))
      .innerJoin(assertions, eq(assertions.id, effortAssertions.assertionId))
      .where(eq(efforts.projectId, projectId)),
    latestMeasurements(projectId),
  ]);
  const map = new Map<string, EffortAssertion[]>();
  for (const r of rows) {
    const list = map.get(r.effortId) ?? [];
    list.push({ ...r, latestValue: r.metricKey ? latest.get(r.metricKey) ?? null : null });
    map.set(r.effortId, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.humanId.localeCompare(b.humanId));
  return map;
}

export async function createEffort(
  projectId: string,
  input: { title: string; description?: string; status?: EffortStatus; goalType?: GoalType; goalTarget?: string | null; order?: number; targetDate?: string | null; ownerId?: string | null; commitment?: boolean; assertions?: string[] },
): Promise<Result<typeof efforts.$inferSelect>> {
  const resolved = await resolveAssertionIds(projectId, input.assertions ?? []);
  if (!resolved.ok) return resolved;
  const e = await db.transaction(async (tx) => {
    const row = (
      await tx
        .insert(efforts)
        .values({
          projectId, title: input.title, description: input.description ?? "",
          status: input.status ?? "next",
          goalType: input.goalType ?? "checklist",
          goalTarget: input.goalTarget ?? null,
          order: input.order ?? 0,
          targetDate: input.targetDate ?? null,
          ownerId: input.ownerId ?? null,
          commitment: input.commitment ?? false,
        })
        .returning()
    )[0]!;
    for (const aid of resolved.value) await tx.insert(effortAssertions).values({ effortId: row.id, assertionId: aid });
    return row;
  });
  return { ok: true, value: e };
}

export type ChangeInput = {
  title?: string;
  description?: string;
  status?: EffortStatus;
  goalType?: GoalType;
  goalTarget?: string | null;
  order?: number;
  targetDate?: string | null;
  ownerId?: string | null; // fluid — assigning an area owner is a planning move
  commitment?: boolean;
  addAssertions?: string[];
  removeAssertions?: string[];
  decision?: { actorId: string; rationale: string; alternatives?: string[]; delegatedById?: string | null };
};

export async function changeEffort(projectId: string, effortId: string, input: ChangeInput): Promise<Result<{ decisionId: string | null }>> {
  const e = (await db.select().from(efforts).where(eq(efforts.id, effortId)))[0];
  if (!e || e.projectId !== projectId) return { ok: false, code: "NOT_FOUND", error: "Effort not found" };

  const changesScope = (input.addAssertions?.length ?? 0) > 0 || (input.removeAssertions?.length ?? 0) > 0;
  const changesDate = input.targetDate !== undefined && input.targetDate !== e.targetDate;
  const consequential = changesScope || changesDate;

  // TRL-CORE-018: scope or date changes require a decision. Status/goal/title/
  // order are fluid planning moves and need none.
  if (consequential) {
    if (!input.decision || !input.decision.rationale?.trim()) {
      return { ok: false, code: "MISSING_RATIONALE", error: "Scope or date changes require a decision rationale" };
    }
    const auth = await authorizeDecider(projectId, input.decision.actorId, input.decision.delegatedById, "effort.change");
    if (!auth.ok) return auth;
    const addIds = await resolveAssertionIds(projectId, input.addAssertions ?? []);
    if (!addIds.ok) return addIds;
    const removeIds = await resolveAssertionIds(projectId, input.removeAssertions ?? []);
    if (!removeIds.ok) return removeIds;

    return await db.transaction(async (tx) => {
      const decision = (
        await tx.insert(decisions).values({
          projectId, actorId: input.decision!.actorId, onType: "effort", onId: effortId,
          choice: changesScope ? "scope" : "date", rationale: input.decision!.rationale,
          alternatives: input.decision!.alternatives ?? [], delegatedById: auth.delegationId,
        }).returning()
      )[0]!;
      for (const aid of addIds.value) {
        const exists = await tx.select({ id: effortAssertions.id }).from(effortAssertions).where(and(eq(effortAssertions.effortId, effortId), eq(effortAssertions.assertionId, aid)));
        if (exists.length === 0) await tx.insert(effortAssertions).values({ effortId, assertionId: aid });
      }
      for (const aid of removeIds.value) {
        await tx.delete(effortAssertions).where(and(eq(effortAssertions.effortId, effortId), eq(effortAssertions.assertionId, aid)));
      }
      await tx.update(efforts).set({
        title: input.title ?? e.title, description: input.description ?? e.description, status: input.status ?? e.status,
        goalType: input.goalType ?? e.goalType, goalTarget: input.goalTarget !== undefined ? input.goalTarget : e.goalTarget,
        order: input.order ?? e.order, targetDate: input.targetDate !== undefined ? input.targetDate : e.targetDate,
        ownerId: input.ownerId !== undefined ? input.ownerId : e.ownerId, commitment: input.commitment ?? e.commitment,
        version: e.version + 1,
      }).where(eq(efforts.id, effortId));
      return { ok: true, value: { decisionId: decision.id } };
    });
  }

  await db.update(efforts).set({
    title: input.title ?? e.title, description: input.description ?? e.description, status: input.status ?? e.status,
    goalType: input.goalType ?? e.goalType, goalTarget: input.goalTarget !== undefined ? input.goalTarget : e.goalTarget,
    order: input.order ?? e.order, ownerId: input.ownerId !== undefined ? input.ownerId : e.ownerId,
    commitment: input.commitment ?? e.commitment, version: e.version + 1,
  }).where(eq(efforts.id, effortId));
  return { ok: true, value: { decisionId: null } };
}

const STATUS_ORDER: Record<EffortStatus, number> = { active: 0, next: 1, someday: 2, done: 3 };

// Map principal id -> display name, for the owners referenced by these efforts.
export async function ownerNames(ownerIds: (string | null)[]): Promise<Map<string, string>> {
  const ids = [...new Set(ownerIds.filter((x): x is string => !!x))];
  if (!ids.length) return new Map();
  const rows = await db.select({ id: principals.id, name: principals.displayName }).from(principals).where(inArray(principals.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}

// The area cockpit: an effort with its assertions, tasks, and the decisions
// that shaped its scope/dates.
export async function getEffortDetail(projectId: string, effortId: string) {
  const e = (await db.select().from(efforts).where(and(eq(efforts.id, effortId), eq(efforts.projectId, projectId))))[0];
  if (!e) return null;
  const [progress, byEffort, owners] = await Promise.all([progressFor(projectId), assertionsByEffort(projectId), ownerNames([e.ownerId])]);
  const effortTasks = await db
    .select({ id: tasks.id, title: tasks.title, status: tasks.status, priority: tasks.priority, ownerName: principals.displayName })
    .from(tasks)
    .leftJoin(principals, eq(principals.id, tasks.ownerId))
    .where(and(eq(tasks.projectId, projectId), eq(tasks.effortId, effortId)))
    .orderBy(asc(tasks.status), desc(tasks.createdAt));
  const effortDecisions = await db
    .select({ id: decisions.id, choice: decisions.choice, rationale: decisions.rationale, at: decisions.at, actorId: decisions.actorId })
    .from(decisions)
    .where(and(eq(decisions.projectId, projectId), eq(decisions.onType, "effort"), eq(decisions.onId, effortId)))
    .orderBy(desc(decisions.at));
  return {
    effort: { ...e, ownerName: e.ownerId ? owners.get(e.ownerId) ?? null : null, ...deadlineInfo(e.targetDate, e.status), progress: progress.get(e.id) ?? { verified: 0, total: 0 } },
    assertions: byEffort.get(effortId) ?? [],
    tasks: effortTasks,
    decisions: effortDecisions,
  };
}

export async function listEfforts(projectId: string) {
  const rows = await db.select().from(efforts).where(eq(efforts.projectId, projectId)).orderBy(asc(efforts.order));
  const [progress, byEffort, owners] = await Promise.all([progressFor(projectId), assertionsByEffort(projectId), ownerNames(rows.map((e) => e.ownerId))]);
  return rows
    .map((e) => ({
      ...e,
      ownerName: e.ownerId ? owners.get(e.ownerId) ?? null : null,
      ...deadlineInfo(e.targetDate, e.status),
      progress: progress.get(e.id) ?? { verified: 0, total: 0 },
      assertions: byEffort.get(e.id) ?? [],
    }))
    // A due-soon effort floats up as if active — the deadline pulls it into focus.
    .sort((a, b) => (a.dueSoon === b.dueSoon ? STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.order - b.order : a.dueSoon ? -1 : 1));
}
