import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { decisions } from "../db/schema.js";
import { resolveDrift, triageDrift } from "../lib/drift-resolve.js";

export const decisionRoutes = new Hono();

const ERR_STATUS: Record<string, number> = {
  INVALID_CHOICE: 422,
  MISSING_RATIONALE: 422,
  NOT_FOUND: 404,
  ALREADY_RESOLVED: 409,
  NOT_MEMBER: 403,
  NOT_OPERATOR: 403,
  DELEGATION_REQUIRED: 403,
  INVALID_DELEGATION: 403,
  DELEGATION_SCOPE: 403,
  INVALID_STATE: 409,
};

const resolveBody = z.object({
  actor: z.string().min(1),
  choice: z.enum(["fix", "amend", "accept"]),
  rationale: z.string().min(1),
  alternatives: z.array(z.string()).optional(),
  delegated_by: z.string().nullable().optional(),
});

// POST /drifts/:did/resolve (TRL-CORE-011, TRL-CORE-018, TRL-API-004)
decisionRoutes.post("/projects/:pid/drifts/:did/resolve", async (c) => {
  const pid = c.req.param("pid");
  const did = c.req.param("did");
  const parsed = resolveBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "Invalid body", code: "INVALID_INPUT", issues: parsed.error.issues }, 422);
  }
  const b = parsed.data;
  const result = await resolveDrift(pid, did, {
    actorId: b.actor,
    choice: b.choice,
    rationale: b.rationale,
    alternatives: b.alternatives,
    delegatedById: b.delegated_by ?? null,
  });
  if (!result.ok) {
    return c.json({ error: result.error, code: result.code }, (ERR_STATUS[result.code] ?? 400) as 400);
  }
  return c.json(result, 200);
});

// POST /projects/:pid/drifts/:did/triage
decisionRoutes.post("/projects/:pid/drifts/:did/triage", async (c) => {
  const pid = c.req.param("pid");
  const did = c.req.param("did");
  const result = await triageDrift(pid, did);
  if ("ok" in result && !result.ok) {
    return c.json({ error: result.error, code: result.code }, (ERR_STATUS[result.code] ?? 400) as 400);
  }
  return c.json({ ok: true }, 200);
});

// GET /projects/:pid/decisions?on=<id> — the decision chain for an object.
decisionRoutes.get("/projects/:pid/decisions", async (c) => {
  const pid = c.req.param("pid");
  const on = c.req.query("on");
  const conds = [eq(decisions.projectId, pid)];
  if (on) conds.push(eq(decisions.onId, on));
  const rows = await db
    .select()
    .from(decisions)
    .where(and(...conds))
    .orderBy(desc(decisions.at));
  return c.json({ decisions: rows });
});

// GET /decisions/:did
decisionRoutes.get("/decisions/:did", async (c) => {
  const did = c.req.param("did");
  const row = (await db.select().from(decisions).where(eq(decisions.id, did)))[0];
  if (!row) return c.json({ error: "Decision not found", code: "NOT_FOUND" }, 404);
  return c.json({ decision: row });
});
