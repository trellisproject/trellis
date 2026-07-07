import { Hono } from "hono";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { assertions, specs } from "../db/schema.js";
import { ingestSpec } from "../lib/ingest.js";
import { getAssertionDetail } from "../lib/assertion-detail.js";
import { agreeAssertion, retireAssertion } from "../lib/assertion-transition.js";
import { createAssertion, createSpec, editAssertion, renderSpec } from "../lib/authoring.js";
import { parseMetricExpr } from "../lib/spec-parse.js";
import { requireMember } from "../middleware/auth.js";
import type { AppEnv } from "../types.js";

const AUTHOR_ERR: Record<string, number> = { NOT_FOUND: 404, SLUG_TAKEN: 409, INVALID_INPUT: 422, NOT_MEMBER: 403 };
const metricFrom = (s: string | null | undefined) => (s == null ? s === null ? null : undefined : parseMetricExpr(s));

const TRANSITION_ERR: Record<string, number> = {
  MISSING_RATIONALE: 422, NOT_FOUND: 404, INVALID_STATE: 409,
  NOT_MEMBER: 403, NOT_OPERATOR: 403, DELEGATION_REQUIRED: 403, INVALID_DELEGATION: 403, DELEGATION_SCOPE: 403,
};

export const specRoutes = new Hono<AppEnv>();

const ingestBody = z.object({
  slug: z.string().min(1),
  source: z.string().min(1),
  commit: z.string().nullable().optional(),
});

// POST /projects/:pid/specs/ingest — markdown in, parse report out (TRL-API-009).
specRoutes.post("/projects/:pid/specs/ingest", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const pid = c.req.param("pid");
  const parsed = ingestBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "Invalid body", code: "INVALID_INPUT", issues: parsed.error.issues }, 422);
  }
  const report = await ingestSpec(pid, parsed.data.slug, parsed.data.source, parsed.data.commit ?? null);
  return c.json(report, report.ok ? 200 : 422);
});

// GET /projects/:pid/specs
specRoutes.get("/projects/:pid/specs", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const pid = c.req.param("pid");
  const rows = await db.select().from(specs).where(eq(specs.projectId, pid));
  return c.json({ specs: rows });
});

// POST /projects/:pid/specs — create a spec to author into (Trellis is the authority).
specRoutes.post("/projects/:pid/specs", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const b = z.object({ slug: z.string().min(1).regex(/^[a-z0-9-]+$/), title: z.string().min(1), code: z.string().min(1) }).safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "Invalid body (slug lowercase-kebab, title, code)", code: "INVALID_INPUT" }, 422);
  const r = await createSpec(c.req.param("pid"), b.data);
  if (!r.ok) return c.json({ error: r.error, code: r.code }, (AUTHOR_ERR[r.code] ?? 400) as 400);
  return c.json({ spec: r.value }, 201);
});

// POST /projects/:pid/specs/:slug/assertions — author a new assertion (auto id).
specRoutes.post("/projects/:pid/specs/:slug/assertions", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const b = z.object({ title: z.string().min(1), statement: z.string().min(1), status: z.enum(["proposed", "agreed"]).optional(), metric: z.string().nullable().optional() }).safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "Invalid body", code: "INVALID_INPUT" }, 422);
  const r = await createAssertion(c.req.param("pid"), c.req.param("slug"), { title: b.data.title, statement: b.data.statement, status: b.data.status, metric: b.data.metric ? parseMetricExpr(b.data.metric) : null });
  if (!r.ok) return c.json({ error: r.error, code: r.code }, (AUTHOR_ERR[r.code] ?? 400) as 400);
  return c.json({ assertion: r.value }, 201);
});

// PATCH /projects/:pid/assertions/:humanId — edit statement/title/metric (editable now).
specRoutes.patch("/projects/:pid/assertions/:humanId", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const b = z.object({ title: z.string().min(1).optional(), statement: z.string().min(1).optional(), metric: z.string().nullable().optional() }).safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "Invalid body", code: "INVALID_INPUT" }, 422);
  const r = await editAssertion(c.req.param("pid"), c.req.param("humanId"), { title: b.data.title, statement: b.data.statement, metric: metricFrom(b.data.metric) });
  if (!r.ok) return c.json({ error: r.error, code: r.code }, (AUTHOR_ERR[r.code] ?? 400) as 400);
  return c.json({ assertion: r.value });
});

// GET /projects/:pid/specs/:slug/export — the git mirror: spec-format markdown.
specRoutes.get("/projects/:pid/specs/:slug/export", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const md = await renderSpec(c.req.param("pid"), c.req.param("slug"));
  if (md === null) return c.json({ error: "Spec not found", code: "NOT_FOUND" }, 404);
  return c.text(md);
});

// GET /projects/:pid/assertions/:humanId — the hub: statement, status,
// linked facts/drifts/tasks, and the decision chain (TRL-UI-004/010).
specRoutes.get("/projects/:pid/assertions/:humanId", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const detail = await getAssertionDetail(c.req.param("pid"), c.req.param("humanId"));
  if (!detail) return c.json({ error: "Assertion not found", code: "NOT_FOUND" }, 404);
  return c.json(detail);
});

const transitionBody = z.object({ rationale: z.string().min(1), delegated_by: z.string().nullable().optional() });

// POST /projects/:pid/assertions/:humanId/agree — proposed -> agreed (a decision).
specRoutes.post("/projects/:pid/assertions/:humanId/agree", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const b = transitionBody.safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "Invalid body", code: "INVALID_INPUT" }, 422);
  const r = await agreeAssertion(c.req.param("pid"), c.req.param("humanId"), { actorId: m.principalId, rationale: b.data.rationale, delegatedById: b.data.delegated_by ?? null });
  if (!r.ok) return c.json({ error: r.error, code: r.code }, (TRANSITION_ERR[r.code] ?? 400) as 400);
  return c.json(r);
});

// POST /projects/:pid/assertions/:humanId/retire — retire a live assertion (a decision).
specRoutes.post("/projects/:pid/assertions/:humanId/retire", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const b = transitionBody.safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "Invalid body", code: "INVALID_INPUT" }, 422);
  const r = await retireAssertion(c.req.param("pid"), c.req.param("humanId"), { actorId: m.principalId, rationale: b.data.rationale, delegatedById: b.data.delegated_by ?? null });
  if (!r.ok) return c.json({ error: r.error, code: r.code }, (TRANSITION_ERR[r.code] ?? 400) as 400);
  return c.json(r);
});

// GET /projects/:pid/specs/:slug — merged view: statements + live status.
specRoutes.get("/projects/:pid/specs/:slug", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const pid = c.req.param("pid");
  const slug = c.req.param("slug");
  const spec = (
    await db.select().from(specs).where(and(eq(specs.projectId, pid), eq(specs.slug, slug)))
  )[0];
  if (!spec) return c.json({ error: "Spec not found", code: "NOT_FOUND" }, 404);
  const rows = await db
    .select()
    .from(assertions)
    .where(eq(assertions.specId, spec.id))
    .orderBy(asc(assertions.orderInSpec));
  return c.json({ spec, assertions: rows });
});
