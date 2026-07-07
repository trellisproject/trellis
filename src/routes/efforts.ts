import { Hono } from "hono";
import { z } from "zod";
import { changeEffort, createEffort, listEfforts } from "../lib/efforts.js";
import { requireMember } from "../middleware/auth.js";
import type { AppEnv } from "../types.js";

export const effortRoutes = new Hono<AppEnv>();

const ERR: Record<string, number> = {
  NOT_FOUND: 404, UNKNOWN_ASSERTION: 422, MISSING_RATIONALE: 422,
  NOT_MEMBER: 403, NOT_OPERATOR: 403, DELEGATION_REQUIRED: 403, INVALID_DELEGATION: 403, DELEGATION_SCOPE: 403,
};
const st = (code: string) => (ERR[code] ?? 400) as 400;

const statusEnum = z.enum(["active", "next", "someday", "done"]);
const goalEnum = z.enum(["checklist", "metric", "open"]);

const createBody = z.object({
  title: z.string().min(1),
  status: statusEnum.optional(),
  goal_type: goalEnum.optional(),
  goal_target: z.string().nullable().optional(),
  order: z.number().int().optional(),
  target_date: z.string().nullable().optional(),
  owner_id: z.string().nullable().optional(),
  commitment: z.boolean().optional(),
  assertions: z.array(z.string()).optional(),
});

// POST /projects/:pid/efforts
effortRoutes.post("/projects/:pid/efforts", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const b = createBody.safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "Invalid body", code: "INVALID_INPUT", issues: b.error.issues }, 422);
  const r = await createEffort(c.req.param("pid"), {
    title: b.data.title, status: b.data.status, goalType: b.data.goal_type, goalTarget: b.data.goal_target,
    order: b.data.order, targetDate: b.data.target_date, ownerId: b.data.owner_id, commitment: b.data.commitment, assertions: b.data.assertions,
  });
  if (!r.ok) return c.json({ error: r.error, code: r.code }, st(r.code));
  return c.json({ effort: r.value }, 201);
});

// GET /projects/:pid/efforts — the focus stack, attention-ordered, with progress + assertions.
effortRoutes.get("/projects/:pid/efforts", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  return c.json({ efforts: await listEfforts(c.req.param("pid")) });
});

const patchBody = z.object({
  title: z.string().min(1).optional(),
  status: statusEnum.optional(),
  goal_type: goalEnum.optional(),
  goal_target: z.string().nullable().optional(),
  order: z.number().int().optional(),
  target_date: z.string().nullable().optional(),
  owner_id: z.string().nullable().optional(),
  commitment: z.boolean().optional(),
  add_assertions: z.array(z.string()).optional(),
  remove_assertions: z.array(z.string()).optional(),
  rationale: z.string().optional(),
  alternatives: z.array(z.string()).optional(),
  delegated_by: z.string().nullable().optional(),
});

// PATCH /projects/:pid/efforts/:eid — status/goal/title fluid; scope/date carry a decision inline.
effortRoutes.patch("/projects/:pid/efforts/:eid", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const b = patchBody.safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "Invalid body", code: "INVALID_INPUT" }, 422);
  const r = await changeEffort(c.req.param("pid"), c.req.param("eid"), {
    title: b.data.title, status: b.data.status, goalType: b.data.goal_type, goalTarget: b.data.goal_target,
    order: b.data.order, targetDate: b.data.target_date, ownerId: b.data.owner_id, commitment: b.data.commitment,
    addAssertions: b.data.add_assertions, removeAssertions: b.data.remove_assertions,
    decision: b.data.rationale !== undefined ? { actorId: m.principalId, rationale: b.data.rationale, alternatives: b.data.alternatives, delegatedById: b.data.delegated_by ?? null } : undefined,
  });
  if (!r.ok) return c.json({ error: r.error, code: r.code }, st(r.code));
  return c.json(r.value);
});
