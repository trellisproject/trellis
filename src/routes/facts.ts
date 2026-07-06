import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { drifts, driftContradictingFacts, facts } from "../db/schema.js";
import { writeFact } from "../lib/facts.js";
import { checkerQueue, triageQueue } from "../lib/queues.js";
import { requireMember, requireProjectMember } from "../middleware/auth.js";
import type { AppEnv } from "../types.js";

export const factRoutes = new Hono<AppEnv>();

const evidence = z.object({
  type: z.enum(["commit", "file", "test", "url"]),
  ref: z.string().min(1),
});

const factBody = z.object({
  key: z.string().min(1),
  value: z.unknown(),
  statement: z.string().min(1),
  evidence: z.array(evidence).min(1),
  observed_at: z.string().datetime().optional(),
  expires_at: z.string().datetime().nullable().optional(),
  supersedes: z.string().nullable().optional(),
  links: z
    .array(z.object({ assertion: z.string().min(1), relation: z.enum(["supports", "contradicts"]) }))
    .optional(),
});

const ERR_STATUS: Record<string, number> = {
  MISSING_EVIDENCE: 422,
  NOT_MEMBER: 403,
  UNKNOWN_ASSERTION: 422,
};

// POST /projects/:pid/facts (TRL-CORE-007, TRL-CORE-010)
factRoutes.post("/projects/:pid/facts", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const pid = c.req.param("pid");
  const parsed = factBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "Invalid body", code: "INVALID_INPUT", issues: parsed.error.issues }, 422);
  }
  const b = parsed.data;
  const result = await writeFact(pid, {
    observerId: m.principalId,
    key: b.key,
    value: b.value,
    statement: b.statement,
    evidence: b.evidence,
    observedAt: b.observed_at ? new Date(b.observed_at) : undefined,
    expiresAt: b.expires_at ? new Date(b.expires_at) : b.expires_at === null ? null : undefined,
    supersedesId: b.supersedes ?? null,
    links: b.links,
  });
  if (!result.ok) {
    return c.json({ error: result.error, code: result.code }, (ERR_STATUS[result.code] ?? 400) as 400);
  }
  return c.json({ fact: result.fact, driftsCreated: result.driftsCreated }, 201);
});

// GET /projects/:pid/facts?key=&observer=
factRoutes.get("/projects/:pid/facts", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const pid = c.req.param("pid");
  const key = c.req.query("key");
  const observer = c.req.query("observer");
  const conds = [eq(facts.projectId, pid)];
  if (key) conds.push(eq(facts.key, key));
  if (observer) conds.push(eq(facts.observerId, observer));
  const rows = await db
    .select()
    .from(facts)
    .where(and(...conds))
    .orderBy(desc(facts.observedAt))
    .limit(50);
  return c.json({ facts: rows });
});

// GET /projects/:pid/drifts?status=&kind=
factRoutes.get("/projects/:pid/drifts", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const pid = c.req.param("pid");
  const status = c.req.query("status");
  const kind = c.req.query("kind");
  const conds = [eq(drifts.projectId, pid)];
  if (status) conds.push(eq(drifts.status, status as "detected" | "triaged" | "resolved"));
  if (kind) conds.push(eq(drifts.kind, kind as "reality" | "contradiction"));
  const rows = await db
    .select()
    .from(drifts)
    .where(and(...conds))
    .orderBy(desc(drifts.createdAt));
  return c.json({ drifts: rows });
});

// GET /drifts/:did
factRoutes.get("/drifts/:did", async (c) => {
  const did = c.req.param("did");
  const drift = (await db.select().from(drifts).where(eq(drifts.id, did)))[0];
  if (!drift) return c.json({ error: "Drift not found", code: "NOT_FOUND" }, 404);
  const gate = await requireProjectMember(c, drift.projectId);
  if (gate instanceof Response) return gate;
  const factRows = await db
    .select({ factId: driftContradictingFacts.factId })
    .from(driftContradictingFacts)
    .where(eq(driftContradictingFacts.driftId, did));
  return c.json({ drift, contradictingFacts: factRows.map((r) => r.factId) });
});

// GET /projects/:pid/queue/checker?stale_days=N (TRL-CORE-009)
factRoutes.get("/projects/:pid/queue/checker", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const pid = c.req.param("pid");
  const staleDays = Number(c.req.query("stale_days") ?? "7");
  const rows = await checkerQueue(pid, Number.isFinite(staleDays) ? staleDays : 7);
  return c.json({ assertions: rows });
});

// GET /projects/:pid/queue/triage
factRoutes.get("/projects/:pid/queue/triage", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const pid = c.req.param("pid");
  return c.json(await triageQueue(pid));
});
