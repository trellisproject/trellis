// The worklist — the computed scheduler. Every state machine feeds one of five
// buckets. Items order by deadline (due-soon first) then priority. Ownership and
// deadlines are DERIVED from each item's effort — you own areas, not items.

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { assertions, challenges, drifts, effortAssertions, efforts, requests, tasks } from "../db/schema.js";
import { deadlineInfo, LEAD_DAYS, ownerNames } from "./efforts.js";

export type Priority = "now" | "normal" | "later";
export type Bucket = "decide" | "specify" | "agree" | "build" | "do" | "verify";

export type WorklistItem = {
  bucket: Bucket;
  kind: "drift" | "challenge" | "request" | "assertion" | "task";
  id: string;
  ref: string; // human id or short id for display
  title: string;
  priority: Priority;
  action: string; // the next action label
  owner?: string | null; // derived from the item's effort owner
  dueInDays?: number | null; // derived from the item's effort deadline
  commitment?: boolean;
  assertionRef?: string; // the assertion (human id) this item is about, for navigation
};

const RANK: Record<Priority, number> = { now: 0, normal: 1, later: 2 };
// Due-soon work floats to the top (deadline feeding attention), then priority.
const sortItems = (items: WorklistItem[]) =>
  [...items].sort((a, b) => {
    const ad = a.dueInDays != null && a.dueInDays <= LEAD_DAYS ? a.dueInDays : Infinity;
    const bd = b.dueInDays != null && b.dueInDays <= LEAD_DAYS ? b.dueInDays : Infinity;
    return ad - bd || RANK[a.priority] - RANK[b.priority];
  });

type Meta = { ownerId: string | null; owner: string | null; dueInDays: number | null; commitment: boolean };

export async function worklist(projectId: string, opts?: { effortId?: string; ownerId?: string }): Promise<Record<Bucket, WorklistItem[]>> {
  // effort ↔ assertion links with effort meta — powers both scoping and the
  // per-item owner/deadline derivation (you own areas; items inherit it).
  const links = await db
    .select({
      aInternal: effortAssertions.assertionId,
      humanId: assertions.humanId,
      effortId: efforts.id,
      status: efforts.status,
      ownerId: efforts.ownerId,
      targetDate: efforts.targetDate,
      commitment: efforts.commitment,
    })
    .from(effortAssertions)
    .innerJoin(efforts, eq(efforts.id, effortAssertions.effortId))
    .innerJoin(assertions, eq(assertions.id, effortAssertions.assertionId))
    .where(eq(efforts.projectId, projectId));
  const owners = await ownerNames(links.map((l) => l.ownerId));

  // Per-assertion meta; when an assertion sits in several efforts the nearest
  // deadline wins (that's what should pull it into focus).
  const metaByHuman = new Map<string, Meta>();
  const metaByInternal = new Map<string, Meta>();
  for (const l of links) {
    const dl = deadlineInfo(l.targetDate, l.status);
    const meta: Meta = { ownerId: l.ownerId, owner: l.ownerId ? owners.get(l.ownerId) ?? null : null, dueInDays: dl.dueInDays, commitment: l.commitment };
    const better = (ex?: Meta) => !ex || (meta.dueInDays != null && (ex.dueInDays == null || meta.dueInDays < ex.dueInDays));
    if (better(metaByHuman.get(l.humanId))) metaByHuman.set(l.humanId, meta);
    if (better(metaByInternal.get(l.aInternal))) metaByInternal.set(l.aInternal, meta);
  }
  const withMeta = (item: WorklistItem, m?: Meta): WorklistItem =>
    m ? { ...item, owner: m.owner, dueInDays: m.dueInDays, commitment: m.commitment } : item;

  // Scope: by a single effort, or by an owner (the union of that person's efforts).
  let scopeInternal: Set<string> | null = null;
  let scopeHuman: Set<string> | null = null;
  if (opts?.effortId || opts?.ownerId) {
    const s = links.filter((l) => (opts.effortId ? l.effortId === opts.effortId : l.ownerId === opts.ownerId));
    scopeInternal = new Set(s.map((l) => l.aInternal));
    scopeHuman = new Set(s.map((l) => l.humanId));
  }
  const inA = (aid: string) => !scopeInternal || scopeInternal.has(aid);
  const inH = (h: string) => !scopeHuman || scopeHuman.has(h);
  const scoped = !!(opts?.effortId || opts?.ownerId);

  // DECIDE — open drifts, open challenges, new requests (a judgment is owed).
  const openDrifts = (
    await db.select().from(drifts).where(and(eq(drifts.projectId, projectId), inArray(drifts.status, ["detected", "triaged"])))
  ).filter((d) => inA(d.assertionId));
  const openChallenges = await db.select().from(challenges).where(and(eq(challenges.projectId, projectId), eq(challenges.status, "open")));
  const newRequests = await db.select().from(requests).where(and(eq(requests.projectId, projectId), eq(requests.status, "new")));

  // Human ids for the drifted assertions, so a Decide row can open its hub.
  const driftAssertionIds = [...new Set(openDrifts.map((d) => d.assertionId))];
  const driftAHuman = driftAssertionIds.length
    ? new Map((await db.select({ id: assertions.id, humanId: assertions.humanId }).from(assertions).where(inArray(assertions.id, driftAssertionIds))).map((r) => [r.id, r.humanId]))
    : new Map<string, string>();

  const decide: WorklistItem[] = [
    ...openDrifts.map((d) => ({ ...withMeta({ bucket: "decide" as const, kind: "drift" as const, id: d.id, ref: d.kind, title: d.summary, priority: d.priority, action: "Resolve" }, metaByInternal.get(d.assertionId)), assertionRef: driftAHuman.get(d.assertionId) })),
    // Challenges and new requests aren't tied to an effort — inbox-level, unscoped only.
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
    bucket: "specify", kind: "request", id: r.id, ref: r.requester, title: r.title, priority: r.priority, action: "Draft assertions",
  }));

  // AGREE — proposed assertions (review intent).
  const proposed = (await db.select().from(assertions).where(and(eq(assertions.projectId, projectId), eq(assertions.status, "proposed")))).filter((a) => inH(a.humanId));
  const agree: WorklistItem[] = proposed.map((a) => withMeta({ bucket: "agree", kind: "assertion", id: a.humanId, ref: a.humanId, title: a.title, priority: "normal", action: "Agree" }, metaByHuman.get(a.humanId)));

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
  const build: WorklistItem[] = agreedNoTask.filter((a) => inH(a.human_id)).map((a) => withMeta({ bucket: "build", kind: "assertion", id: a.human_id, ref: a.human_id, title: a.title, priority: "normal", action: "Create task" }, metaByHuman.get(a.human_id)));

  // DO — open work: tasks to be done (build, fix, or standalone operational work
  // with no assertion). Owner + deadline come from the task's own owner/effort,
  // else its effort's owner/deadline. This is where created tasks live until done.
  const openTasks = await db
    .select({
      id: tasks.id, title: tasks.title, priority: tasks.priority,
      taskOwnerId: tasks.ownerId, effortId: tasks.effortId,
      effortStatus: efforts.status, effortOwnerId: efforts.ownerId, targetDate: efforts.targetDate, commitment: efforts.commitment,
    })
    .from(tasks)
    .leftJoin(efforts, eq(efforts.id, tasks.effortId))
    .where(and(eq(tasks.projectId, projectId), inArray(tasks.status, ["open", "claimed", "in_progress"])));
  const taskOwners = await ownerNames(openTasks.flatMap((t) => [t.taskOwnerId, t.effortOwnerId]));
  const doItems: WorklistItem[] = openTasks
    .filter((t) => (opts?.effortId ? t.effortId === opts.effortId : opts?.ownerId ? t.taskOwnerId === opts.ownerId || t.effortOwnerId === opts.ownerId : true))
    .map((t) => {
      const ownerId = t.taskOwnerId ?? t.effortOwnerId;
      const dl = deadlineInfo(t.targetDate, t.effortStatus ?? "next");
      return { bucket: "do" as const, kind: "task" as const, id: t.id, ref: "task", title: t.title, priority: t.priority, action: "Open", owner: ownerId ? taskOwners.get(ownerId) ?? null : null, dueInDays: dl.dueInDays, commitment: t.commitment ?? false };
    });

  // VERIFY — implemented assertions awaiting a verifying fact (the checker's queue).
  const implemented = (await db.select().from(assertions).where(and(eq(assertions.projectId, projectId), eq(assertions.status, "implemented")))).filter((a) => inH(a.humanId));
  const verify: WorklistItem[] = implemented.map((a) => withMeta({ bucket: "verify", kind: "assertion", id: a.humanId, ref: a.humanId, title: a.title, priority: "normal", action: "Verify" }, metaByHuman.get(a.humanId)));

  return {
    decide: sortItems(decide),
    specify: sortItems(specify),
    agree: sortItems(agree),
    build: sortItems(build),
    do: sortItems(doItems),
    verify: sortItems(verify),
  };
}
