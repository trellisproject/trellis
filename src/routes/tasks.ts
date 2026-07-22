import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { efforts, principals, tasks } from "../db/schema.js";
import {
  claimTask,
  checkpointTask,
  createTask,
  getTask,
  handoffTask,
  updateTaskStatus,
} from "../lib/tasks.js";
import { requireMember, requireProjectMember } from "../middleware/auth.js";
import type { AppEnv } from "../types.js";

export const taskRoutes = new Hono<AppEnv>();

const ERR: Record<string, number> = {
  NOT_FOUND: 404,
  UNKNOWN_ASSERTION: 422,
  ASSERTION_NOT_BUILDABLE: 422,
  UNKNOWN_DRIFT: 422,
  CONFLICT: 409,
  ALREADY_CLAIMED: 409,
  STALE_VERSION: 409,
  FORBIDDEN: 403,
  NOT_MEMBER: 403,
};
const status = (code: string) => (ERR[code] ?? 400) as 400;

const createBody = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  assertions: z.array(z.string()).optional(),
  drift: z.string().nullable().optional(),
  depends_on: z.array(z.string()).optional(),
  effort_id: z.string().nullable().optional(),
  owner_id: z.string().nullable().optional(),
  priority: z.enum(["now", "normal", "later"]).optional(),
});

taskRoutes.post("/projects/:pid/tasks", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const parsed = createBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid body", code: "INVALID_INPUT", issues: parsed.error.issues }, 422);
  const b = parsed.data;
  const r = await createTask(c.req.param("pid"), { title: b.title, description: b.description, assertions: b.assertions, driftId: b.drift ?? null, dependsOn: b.depends_on, effortId: b.effort_id ?? null, ownerId: b.owner_id ?? null, priority: b.priority });
  if (!r.ok) return c.json({ error: r.error, code: r.code }, status(r.code));
  return c.json({ task: r.value }, 201);
});

taskRoutes.get("/projects/:pid/tasks", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const pid = c.req.param("pid");
  const st = c.req.query("status");
  const owner = c.req.query("owner");
  const conds = [eq(tasks.projectId, pid)];
  if (st) conds.push(eq(tasks.status, st as "open"));
  if (owner) conds.push(eq(tasks.ownerId, owner));
  const rows = await db
    .select({
      id: tasks.id, title: tasks.title, status: tasks.status, priority: tasks.priority,
      ownerId: tasks.ownerId, ownerName: principals.displayName, effortId: tasks.effortId, effortTitle: efforts.title,
    })
    .from(tasks)
    .leftJoin(principals, eq(principals.id, tasks.ownerId))
    .leftJoin(efforts, eq(efforts.id, tasks.effortId))
    .where(and(...conds))
    .orderBy(desc(tasks.createdAt));
  return c.json({ tasks: rows });
});

taskRoutes.get("/tasks/:tid", async (c) => {
  const tid = c.req.param("tid");
  const row = (await db.select({ projectId: tasks.projectId }).from(tasks).where(eq(tasks.id, tid)))[0];
  if (!row) return c.json({ error: "Task not found", code: "NOT_FOUND" }, 404);
  const gate = await requireProjectMember(c, row.projectId);
  if (gate instanceof Response) return gate;
  const full = await getTask(row.projectId, tid);
  return c.json(full);
});

taskRoutes.post("/projects/:pid/tasks/:tid/claim", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const r = await claimTask(c.req.param("pid"), c.req.param("tid"), m.principalId);
  if (!r.ok) return c.json({ error: r.error, code: r.code }, status(r.code));
  return c.json({ task: r.value });
});

taskRoutes.post("/projects/:pid/tasks/:tid/checkpoints", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const body = z.object({ note: z.string().min(1) }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Invalid body", code: "INVALID_INPUT" }, 422);
  const r = await checkpointTask(c.req.param("pid"), c.req.param("tid"), m.principalId, body.data.note);
  if (!r.ok) return c.json({ error: r.error, code: r.code }, status(r.code));
  return c.json({ checkpoint: r.value }, 201);
});

taskRoutes.post("/projects/:pid/tasks/:tid/handoff", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const body = z.object({ to: z.string().min(1) }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Invalid body", code: "INVALID_INPUT" }, 422);
  const r = await handoffTask(c.req.param("pid"), c.req.param("tid"), m, body.data.to);
  if (!r.ok) return c.json({ error: r.error, code: r.code }, status(r.code));
  return c.json({ task: r.value });
});

taskRoutes.patch("/projects/:pid/tasks/:tid", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const body = z
    .object({
      status: z.enum(["open", "claimed", "in_progress", "done", "blocked"]).optional(),
      title: z.string().min(1).optional(),
      description: z.string().optional(),
      priority: z.enum(["now", "normal", "later"]).optional(),
      owner_id: z.string().nullable().optional(),
      effort_id: z.string().nullable().optional(),
      assertions: z.array(z.string()).optional(),
      version: z.number().int().optional(),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Invalid body", code: "INVALID_INPUT" }, 422);
  const r = await updateTaskStatus(c.req.param("pid"), c.req.param("tid"), { status: body.data.status, title: body.data.title, description: body.data.description, priority: body.data.priority, ownerId: body.data.owner_id, effortId: body.data.effort_id, assertions: body.data.assertions, version: body.data.version });
  if (!r.ok) return c.json({ error: r.error, code: r.code }, status(r.code));
  return c.json({ task: r.value });
});
