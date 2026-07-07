// Requests — captured asks that become intent (TRL-CORE-030..033).
// Capture (any member) → accept/decline (a decision) → derive & link
// assertions → shipped is computed when that intent is verified.

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { assertions, decisions, requestAssertions, requests } from "../db/schema.js";
import { authorizeDecider } from "./decisions.js";

type Result<T> = { ok: true; value: T } | { ok: false; code: string; error: string };

export async function createRequest(
  projectId: string,
  input: { title: string; body?: string; requester: string; source?: string | null; priority?: "now" | "normal" | "later" },
): Promise<typeof requests.$inferSelect> {
  return (
    await db
      .insert(requests)
      .values({ projectId, title: input.title, body: input.body ?? "", requester: input.requester, source: input.source ?? null, priority: input.priority ?? "normal" })
      .returning()
  )[0]!;
}

export async function decideRequest(
  projectId: string,
  requestId: string,
  input: { actorId: string; choice: "accept" | "decline"; rationale: string; delegatedById?: string | null },
): Promise<Result<{ decisionId: string; status: "accepted" | "declined" }>> {
  if (input.choice !== "accept" && input.choice !== "decline") {
    return { ok: false, code: "INVALID_CHOICE", error: "choice must be accept or decline" };
  }
  if (!input.rationale?.trim()) return { ok: false, code: "MISSING_RATIONALE", error: "A non-empty rationale is required" };
  const req = (await db.select().from(requests).where(eq(requests.id, requestId)))[0];
  if (!req || req.projectId !== projectId) return { ok: false, code: "NOT_FOUND", error: "Request not found" };
  if (req.status !== "new") return { ok: false, code: "ALREADY_DECIDED", error: "Request already accepted or declined" };

  const auth = await authorizeDecider(projectId, input.actorId, input.delegatedById, "request.decide");
  if (!auth.ok) return auth;

  return await db.transaction(async (tx) => {
    const decision = (
      await tx
        .insert(decisions)
        .values({ projectId, actorId: input.actorId, onType: "request", onId: requestId, choice: input.choice, rationale: input.rationale, delegatedById: auth.delegationId })
        .returning()
    )[0]!;
    const status = input.choice === "accept" ? ("accepted" as const) : ("declined" as const);
    await tx.update(requests).set({ status, decisionId: decision.id, updatedAt: new Date() }).where(eq(requests.id, requestId));
    return { ok: true, value: { decisionId: decision.id, status } };
  });
}

// Link derived assertions to a request (TRL-CORE-032). Assertions must exist
// in the project; skips already-linked.
export async function linkRequestAssertions(
  projectId: string,
  requestId: string,
  humanIds: string[],
): Promise<Result<{ linked: string[] }>> {
  const req = (await db.select().from(requests).where(eq(requests.id, requestId)))[0];
  if (!req || req.projectId !== projectId) return { ok: false, code: "NOT_FOUND", error: "Request not found" };
  const rows = await db
    .select()
    .from(assertions)
    .where(and(eq(assertions.projectId, projectId), inArray(assertions.humanId, humanIds)));
  const byId = new Map(rows.map((r) => [r.humanId, r.id]));
  const missing = humanIds.filter((h) => !byId.has(h));
  if (missing.length) return { ok: false, code: "UNKNOWN_ASSERTION", error: `Unknown: ${missing.join(", ")}` };

  const existing = new Set(
    (await db.select({ a: requestAssertions.assertionId }).from(requestAssertions).where(eq(requestAssertions.requestId, requestId))).map((r) => r.a),
  );
  const linked: string[] = [];
  for (const h of humanIds) {
    const aid = byId.get(h)!;
    if (existing.has(aid)) continue;
    await db.insert(requestAssertions).values({ requestId, assertionId: aid });
    linked.push(h);
  }
  return { ok: true, value: { linked } };
}

export type RequestView = typeof requests.$inferSelect & {
  derived: { humanId: string; title: string; status: string }[];
  shipped: boolean;
};

async function derivedFor(requestId: string) {
  return db
    .select({ humanId: assertions.humanId, title: assertions.title, status: assertions.status })
    .from(requestAssertions)
    .innerJoin(assertions, eq(assertions.id, requestAssertions.assertionId))
    .where(eq(requestAssertions.requestId, requestId));
}

// TRL-CORE-033: shipped is computed — accepted, >=1 non-retired derived
// assertion, all of them verified.
function isShipped(derived: { status: string }[]): boolean {
  const live = derived.filter((d) => d.status !== "retired");
  return live.length > 0 && live.every((d) => d.status === "verified");
}

export async function getRequest(projectId: string, requestId: string): Promise<RequestView | null> {
  const req = (await db.select().from(requests).where(eq(requests.id, requestId)))[0];
  if (!req || req.projectId !== projectId) return null;
  const derived = await derivedFor(requestId);
  return { ...req, derived, shipped: isShipped(derived) };
}

export async function listRequests(projectId: string, status?: string): Promise<RequestView[]> {
  const conds = [eq(requests.projectId, projectId)];
  if (status) conds.push(eq(requests.status, status as "new"));
  const rows = await db.select().from(requests).where(and(...conds)).orderBy(desc(requests.createdAt));
  const out: RequestView[] = [];
  for (const r of rows) {
    const derived = await derivedFor(r.id);
    out.push({ ...r, derived, shipped: isShipped(derived) });
  }
  return out;
}
