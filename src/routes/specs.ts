import { Hono } from "hono";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { assertions, specs } from "../db/schema.js";
import { ingestSpec } from "../lib/ingest.js";
import { getAssertionDetail } from "../lib/assertion-detail.js";
import { requireMember } from "../middleware/auth.js";
import type { AppEnv } from "../types.js";

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

// GET /projects/:pid/assertions/:humanId — the hub: statement, status,
// linked facts/drifts/tasks, and the decision chain (TRL-UI-004/010).
specRoutes.get("/projects/:pid/assertions/:humanId", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const detail = await getAssertionDetail(c.req.param("pid"), c.req.param("humanId"));
  if (!detail) return c.json({ error: "Assertion not found", code: "NOT_FOUND" }, 404);
  return c.json(detail);
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
