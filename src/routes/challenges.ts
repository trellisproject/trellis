import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { challenges } from "../db/schema.js";
import { fileChallenge, resolveChallenge } from "../lib/challenges.js";
import { requireMember } from "../middleware/auth.js";
import type { AppEnv } from "../types.js";

export const challengeRoutes = new Hono<AppEnv>();

const ERR: Record<string, number> = {
  MISSING_RATIONALE: 422,
  INVALID_CHOICE: 422,
  NOT_FOUND: 404,
  ALREADY_RESOLVED: 409,
  NOT_MEMBER: 403,
  NOT_OPERATOR: 403,
  DELEGATION_REQUIRED: 403,
  INVALID_DELEGATION: 403,
  DELEGATION_SCOPE: 403,
};
const status = (code: string) => (ERR[code] ?? 400) as 400;

// POST /projects/:pid/decisions/:did/challenges — any member may file (TRL-CORE-027).
challengeRoutes.post("/projects/:pid/decisions/:did/challenges", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const body = z
    .object({ rationale: z.string().min(1), cites: z.array(z.string()).optional() })
    .safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Invalid body", code: "INVALID_INPUT" }, 422);
  const r = await fileChallenge(c.req.param("pid"), c.req.param("did"), m.principalId, body.data.rationale, body.data.cites ?? []);
  if (!r.ok) return c.json({ error: r.error, code: r.code }, status(r.code));
  return c.json({ challenge: r.value }, 201);
});

// GET /projects/:pid/challenges?status=
challengeRoutes.get("/projects/:pid/challenges", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const pid = c.req.param("pid");
  const st = c.req.query("status");
  const conds = [eq(challenges.projectId, pid)];
  if (st) conds.push(eq(challenges.status, st as "open" | "resolved"));
  const rows = await db.select().from(challenges).where(and(...conds)).orderBy(desc(challenges.createdAt));
  return c.json({ challenges: rows });
});

// POST /projects/:pid/challenges/:cid/resolve — a decision (TRL-CORE-029).
challengeRoutes.post("/projects/:pid/challenges/:cid/resolve", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const body = z
    .object({
      choice: z.enum(["uphold", "supersede"]),
      rationale: z.string().min(1),
      delegated_by: z.string().nullable().optional(),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Invalid body", code: "INVALID_INPUT" }, 422);
  const r = await resolveChallenge(c.req.param("pid"), c.req.param("cid"), {
    actorId: m.principalId,
    choice: body.data.choice,
    rationale: body.data.rationale,
    delegatedById: body.data.delegated_by ?? null,
  });
  if (!r.ok) return c.json({ error: r.error, code: r.code }, status(r.code));
  return c.json(r.value);
});
