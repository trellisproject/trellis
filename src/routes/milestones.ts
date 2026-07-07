import { Hono } from "hono";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { milestones } from "../db/schema.js";
import { assertionsByMilestone, changeMilestone, createMilestone, progressFor } from "../lib/milestones.js";
import { requireMember } from "../middleware/auth.js";
import type { AppEnv } from "../types.js";

export const milestoneRoutes = new Hono<AppEnv>();

const ERR: Record<string, number> = {
  NOT_FOUND: 404,
  UNKNOWN_ASSERTION: 422,
  MISSING_RATIONALE: 422,
  NOT_MEMBER: 403,
  NOT_OPERATOR: 403,
  DELEGATION_REQUIRED: 403,
  INVALID_DELEGATION: 403,
  DELEGATION_SCOPE: 403,
};
const status = (code: string) => (ERR[code] ?? 400) as 400;

const createBody = z.object({
  title: z.string().min(1),
  order: z.number().int().optional(),
  target_date: z.string().nullable().optional(),
  assertions: z.array(z.string()).optional(),
});

milestoneRoutes.post("/projects/:pid/milestones", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const parsed = createBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid body", code: "INVALID_INPUT", issues: parsed.error.issues }, 422);
  const b = parsed.data;
  const r = await createMilestone(c.req.param("pid"), { title: b.title, order: b.order, targetDate: b.target_date, assertions: b.assertions });
  if (!r.ok) return c.json({ error: r.error, code: r.code }, status(r.code));
  return c.json({ milestone: r.value }, 201);
});

// GET /projects/:pid/milestones — with computed progress (TRL-CORE-024).
milestoneRoutes.get("/projects/:pid/milestones", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const pid = c.req.param("pid");
  const rows = await db.select().from(milestones).where(eq(milestones.projectId, pid)).orderBy(asc(milestones.order));
  const progress = await progressFor(pid);
  const byMilestone = await assertionsByMilestone(pid);
  return c.json({
    milestones: rows.map((ms) => ({
      ...ms,
      progress: progress.get(ms.id) ?? { verified: 0, total: 0 },
      assertions: byMilestone.get(ms.id) ?? [],
    })),
  });
});

const patchBody = z.object({
  title: z.string().min(1).optional(),
  order: z.number().int().optional(),
  target_date: z.string().nullable().optional(),
  add_assertions: z.array(z.string()).optional(),
  remove_assertions: z.array(z.string()).optional(),
  rationale: z.string().optional(),
  alternatives: z.array(z.string()).optional(),
  delegated_by: z.string().nullable().optional(),
});

// PATCH /projects/:pid/milestones/:mid — scope/date change carries the decision
// inline (TRL-API-004); title/order alone need no decision.
milestoneRoutes.patch("/projects/:pid/milestones/:mid", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const parsed = patchBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid body", code: "INVALID_INPUT" }, 422);
  const b = parsed.data;
  const r = await changeMilestone(c.req.param("pid"), c.req.param("mid"), {
    title: b.title,
    order: b.order,
    targetDate: b.target_date,
    addAssertions: b.add_assertions,
    removeAssertions: b.remove_assertions,
    decision: b.rationale !== undefined
      ? { actorId: m.principalId, rationale: b.rationale, alternatives: b.alternatives, delegatedById: b.delegated_by ?? null }
      : undefined,
  });
  if (!r.ok) return c.json({ error: r.error, code: r.code }, status(r.code));
  return c.json(r.value);
});
