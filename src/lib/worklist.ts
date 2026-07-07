// The worklist — the computed scheduler. Every state machine feeds one of five
// buckets, each item carrying a priority so the surface orders itself. This is
// what humans triage and what a builder/analyst agent pulls from.

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { assertions, challenges, drifts, effortAssertions, requestAssertions, requests } from "../db/schema.js";

export type Priority = "now" | "normal" | "later";
export type Bucket = "decide" | "specify" | "agree" | "build" | "verify";

export type WorklistItem = {
  bucket: Bucket;
  kind: "drift" | "challenge" | "request" | "assertion";
  id: string;
  ref: string; // human id or short id for display
  title: string;
  priority: Priority;
  action: string; // the next action label
};

const RANK: Record<Priority, number> = { now: 0, normal: 1, later: 2 };
const sortByPriority = (items: WorklistItem[]) =>
  [...items].sort((a, b) => RANK[a.priority] - RANK[b.priority]);

export async function worklist(projectId: string, opts?: { effortId?: string }): Promise<Record<Bucket, WorklistItem[]>> {
  // When scoped to an effort, the assertion-backed buckets show only that
  // effort's assertions; cross-cutting inbox items (new requests, challenges)
  // are dropped — they live in the unscoped view.
  let effortAssertionIds: Set<string> | null = null; // internal ids
  let effortHumanIds: Set<string> | null = null;
  if (opts?.effortId) {
    const rows = await db
      .select({ id: assertions.id, humanId: assertions.humanId })
      .from(effortAssertions)
      .innerJoin(assertions, eq(assertions.id, effortAssertions.assertionId))
      .where(eq(effortAssertions.effortId, opts.effortId));
    effortAssertionIds = new Set(rows.map((r) => r.id));
    effortHumanIds = new Set(rows.map((r) => r.humanId));
  }
  const inEffortA = (aid: string) => !effortAssertionIds || effortAssertionIds.has(aid);
  const inEffortH = (h: string) => !effortHumanIds || effortHumanIds.has(h);
  const scoped = !!opts?.effortId;

  // DECIDE — open drifts, open challenges, new requests (a judgment is owed).
  const openDrifts = (
    await db.select().from(drifts).where(and(eq(drifts.projectId, projectId), inArray(drifts.status, ["detected", "triaged"])))
  ).filter((d) => inEffortA(d.assertionId));
  const openChallenges = await db
    .select()
    .from(challenges)
    .where(and(eq(challenges.projectId, projectId), eq(challenges.status, "open")));
  const newRequests = await db
    .select()
    .from(requests)
    .where(and(eq(requests.projectId, projectId), eq(requests.status, "new")));

  const decide: WorklistItem[] = [
    ...openDrifts.map((d) => ({ bucket: "decide" as const, kind: "drift" as const, id: d.id, ref: d.kind, title: d.summary, priority: d.priority, action: "Resolve" })),
    // Challenges and new requests aren't tied to an effort's assertions — inbox-level, unscoped only.
    ...(scoped ? [] : openChallenges.map((c) => ({ bucket: "decide" as const, kind: "challenge" as const, id: c.id, ref: "challenge", title: c.rationale, priority: "normal" as const, action: "Resolve" }))),
    ...(scoped ? [] : newRequests.map((r) => ({ bucket: "decide" as const, kind: "request" as const, id: r.id, ref: r.requester, title: r.title, priority: r.priority, action: "Accept / Decline" }))),
  ];

  // SPECIFY — accepted requests with zero derived assertions (turn the ask into intent).
  const acceptedNoDerived = (await db.execute(sql`
    SELECT r.id, r.title, r.requester, r.priority
    FROM ${requests} r
    WHERE r.project_id = ${projectId} AND r.status = 'accepted'
      AND NOT EXISTS (SELECT 1 FROM request_assertions ra WHERE ra.request_id = r.id)
  `)) as unknown as { id: string; title: string; requester: string; priority: Priority }[];
  const specify: WorklistItem[] = (scoped ? [] : acceptedNoDerived).map((r) => ({
    bucket: "specify" as const, kind: "request" as const, id: r.id, ref: r.requester, title: r.title, priority: r.priority, action: "Draft assertions",
  }));

  // AGREE — proposed assertions (review intent).
  const proposed = (await db.select().from(assertions).where(and(eq(assertions.projectId, projectId), eq(assertions.status, "proposed")))).filter((a) => inEffortH(a.humanId));
  const agree: WorklistItem[] = proposed.map((a) => ({ bucket: "agree", kind: "assertion", id: a.humanId, ref: a.humanId, title: a.title, priority: "normal", action: "Agree" }));

  // BUILD — agreed assertions with no active task (create the work).
  const agreedNoTask = (await db.execute(sql`
    SELECT a.human_id, a.title
    FROM ${assertions} a
    WHERE a.project_id = ${projectId} AND a.status = 'agreed'
      AND NOT EXISTS (
        SELECT 1 FROM task_assertions ta JOIN tasks t ON t.id = ta.task_id
        WHERE ta.assertion_id = a.id AND t.status IN ('open','claimed','in_progress')
      )
    ORDER BY a.human_id
  `)) as unknown as { human_id: string; title: string }[];
  const build: WorklistItem[] = agreedNoTask.filter((a) => inEffortH(a.human_id)).map((a) => ({ bucket: "build", kind: "assertion", id: a.human_id, ref: a.human_id, title: a.title, priority: "normal", action: "Create task" }));

  // VERIFY — implemented assertions awaiting a verifying fact (the checker's queue).
  const implemented = (await db.select().from(assertions).where(and(eq(assertions.projectId, projectId), eq(assertions.status, "implemented")))).filter((a) => inEffortH(a.humanId));
  const verify: WorklistItem[] = implemented.map((a) => ({ bucket: "verify", kind: "assertion", id: a.humanId, ref: a.humanId, title: a.title, priority: "normal", action: "Verify" }));

  return {
    decide: sortByPriority(decide),
    specify: sortByPriority(specify),
    agree: sortByPriority(agree),
    build: sortByPriority(build),
    verify: sortByPriority(verify),
  };
}
