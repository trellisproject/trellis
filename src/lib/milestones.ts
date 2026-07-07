// Milestones — named sets of assertions with computed progress.
// TRL-CORE-024 (progress is verified/total, derived from facts — never
// hand-set) and TRL-CORE-018 (scope or date changes require a decision).

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { assertions, decisions, milestoneAssertions, milestones } from "../db/schema.js";
import { authorizeDecider } from "./decisions.js";

type Result<T> = { ok: true; value: T } | { ok: false; code: string; error: string };

export type Progress = { verified: number; total: number };

async function resolveAssertionIds(projectId: string, humanIds: string[]): Promise<Result<string[]>> {
  if (humanIds.length === 0) return { ok: true, value: [] };
  const rows = await db
    .select()
    .from(assertions)
    .where(and(eq(assertions.projectId, projectId), inArray(assertions.humanId, humanIds)));
  const map = new Map(rows.map((r) => [r.humanId, r.id]));
  const missing = humanIds.filter((h) => !map.has(h));
  if (missing.length) return { ok: false, code: "UNKNOWN_ASSERTION", error: `Unknown: ${missing.join(", ")}` };
  return { ok: true, value: humanIds.map((h) => map.get(h)!) };
}

// TRL-CORE-024: verified over total, excluding retired assertions (no longer
// intent). Drifted assertions stay in total but are not verified.
export async function progressFor(projectId: string): Promise<Map<string, Progress>> {
  const rows = (await db.execute(sql`
    SELECT m.id AS milestone_id,
           COUNT(a.id) FILTER (WHERE a.status <> 'retired') AS total,
           COUNT(a.id) FILTER (WHERE a.status = 'verified') AS verified
    FROM ${milestones} m
    LEFT JOIN milestone_assertions ma ON ma.milestone_id = m.id
    LEFT JOIN assertions a ON a.id = ma.assertion_id
    WHERE m.project_id = ${projectId}
    GROUP BY m.id
  `)) as unknown as { milestone_id: string; total: number; verified: number }[];
  return new Map(rows.map((r) => [r.milestone_id, { verified: Number(r.verified), total: Number(r.total) }]));
}

// The assertions in each milestone (with live status), for the roadmap
// breakdown so progress is self-explanatory.
export async function assertionsByMilestone(
  projectId: string,
): Promise<Map<string, { humanId: string; title: string; status: string }[]>> {
  const rows = await db
    .select({
      milestoneId: milestoneAssertions.milestoneId,
      humanId: assertions.humanId,
      title: assertions.title,
      status: assertions.status,
    })
    .from(milestoneAssertions)
    .innerJoin(milestones, eq(milestones.id, milestoneAssertions.milestoneId))
    .innerJoin(assertions, eq(assertions.id, milestoneAssertions.assertionId))
    .where(eq(milestones.projectId, projectId));
  const map = new Map<string, { humanId: string; title: string; status: string }[]>();
  for (const r of rows) {
    const list = map.get(r.milestoneId) ?? [];
    list.push({ humanId: r.humanId, title: r.title, status: r.status });
    map.set(r.milestoneId, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.humanId.localeCompare(b.humanId));
  return map;
}

export async function createMilestone(
  projectId: string,
  input: { title: string; order?: number; targetDate?: string | null; assertions?: string[] },
): Promise<Result<typeof milestones.$inferSelect>> {
  const resolved = await resolveAssertionIds(projectId, input.assertions ?? []);
  if (!resolved.ok) return resolved;
  const ms = await db.transaction(async (tx) => {
    const m = (
      await tx
        .insert(milestones)
        .values({ projectId, title: input.title, order: input.order ?? 0, targetDate: input.targetDate ?? null })
        .returning()
    )[0]!;
    for (const aid of resolved.value) await tx.insert(milestoneAssertions).values({ milestoneId: m.id, assertionId: aid });
    return m;
  });
  return { ok: true, value: ms };
}

export type ChangeInput = {
  title?: string;
  order?: number;
  targetDate?: string | null;
  addAssertions?: string[];
  removeAssertions?: string[];
  decision?: { actorId: string; rationale: string; alternatives?: string[]; delegatedById?: string | null };
};

export async function changeMilestone(
  projectId: string,
  milestoneId: string,
  input: ChangeInput,
): Promise<Result<{ decisionId: string | null }>> {
  const ms = (await db.select().from(milestones).where(eq(milestones.id, milestoneId)))[0];
  if (!ms || ms.projectId !== projectId) return { ok: false, code: "NOT_FOUND", error: "Milestone not found" };

  const changesScope = (input.addAssertions?.length ?? 0) > 0 || (input.removeAssertions?.length ?? 0) > 0;
  const changesDate = input.targetDate !== undefined && input.targetDate !== ms.targetDate;
  const consequential = changesScope || changesDate;

  // TRL-CORE-018 / TRL-API-004: a scope or date change requires a decision.
  if (consequential) {
    if (!input.decision || !input.decision.rationale?.trim()) {
      return { ok: false, code: "MISSING_RATIONALE", error: "Scope or date changes require a decision rationale" };
    }
    const auth = await authorizeDecider(projectId, input.decision.actorId, input.decision.delegatedById, "milestone.change");
    if (!auth.ok) return auth;

    const addIds = await resolveAssertionIds(projectId, input.addAssertions ?? []);
    if (!addIds.ok) return addIds;
    const removeIds = await resolveAssertionIds(projectId, input.removeAssertions ?? []);
    if (!removeIds.ok) return removeIds;

    return await db.transaction(async (tx) => {
      const decision = (
        await tx
          .insert(decisions)
          .values({
            projectId,
            actorId: input.decision!.actorId,
            onType: "milestone",
            onId: milestoneId,
            choice: changesScope ? "scope" : "date",
            rationale: input.decision!.rationale,
            alternatives: input.decision!.alternatives ?? [],
            delegatedById: auth.delegationId,
          })
          .returning()
      )[0]!;

      for (const aid of addIds.value) {
        const exists = await tx
          .select({ id: milestoneAssertions.id })
          .from(milestoneAssertions)
          .where(and(eq(milestoneAssertions.milestoneId, milestoneId), eq(milestoneAssertions.assertionId, aid)));
        if (exists.length === 0) await tx.insert(milestoneAssertions).values({ milestoneId, assertionId: aid });
      }
      for (const aid of removeIds.value) {
        await tx
          .delete(milestoneAssertions)
          .where(and(eq(milestoneAssertions.milestoneId, milestoneId), eq(milestoneAssertions.assertionId, aid)));
      }

      await tx
        .update(milestones)
        .set({
          title: input.title ?? ms.title,
          order: input.order ?? ms.order,
          targetDate: input.targetDate !== undefined ? input.targetDate : ms.targetDate,
          version: ms.version + 1,
        })
        .where(eq(milestones.id, milestoneId));
      return { ok: true, value: { decisionId: decision.id } };
    });
  }

  // Non-consequential fields only (title/order): no decision required.
  await db
    .update(milestones)
    .set({ title: input.title ?? ms.title, order: input.order ?? ms.order, version: ms.version + 1 })
    .where(eq(milestones.id, milestoneId));
  return { ok: true, value: { decisionId: null } };
}
