import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { projects, memberships, principals } from "../db/schema.js";

export const projectRoutes = new Hono();

const createProject = z.object({
  name: z.string().min(1),
  repos: z.array(z.string()).optional(),
  operator: z.object({ displayName: z.string().min(1), email: z.string().email().optional() }),
});

// POST /projects — create a project and its first operator principal.
projectRoutes.post("/projects", async (c) => {
  const parsed = createProject.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "Invalid body", code: "INVALID_INPUT", issues: parsed.error.issues }, 422);
  }
  const { name, repos, operator } = parsed.data;

  const result = await db.transaction(async (tx) => {
    const project = (
      await tx.insert(projects).values({ name, repos: repos ?? [] }).returning()
    )[0]!;
    const principal = (
      await tx
        .insert(principals)
        .values({ kind: "human", displayName: operator.displayName, email: operator.email })
        .returning()
    )[0]!;
    await tx
      .insert(memberships)
      .values({ projectId: project.id, principalId: principal.id, role: "operator" });
    return { project, operator: principal };
  });

  return c.json(result, 201);
});

// GET /projects — list all projects (V1: no cross-project auth scoping yet).
projectRoutes.get("/projects", async (c) => {
  const rows = await db.select().from(projects);
  return c.json({ projects: rows });
});

// GET /projects/:pid
projectRoutes.get("/projects/:pid", async (c) => {
  const pid = c.req.param("pid");
  const row = (await db.select().from(projects).where(eq(projects.id, pid)))[0];
  if (!row) return c.json({ error: "Project not found", code: "NOT_FOUND" }, 404);
  const members = await db
    .select({
      principalId: memberships.principalId,
      role: memberships.role,
      displayName: principals.displayName,
      kind: principals.kind,
    })
    .from(memberships)
    .innerJoin(principals, eq(principals.id, memberships.principalId))
    .where(eq(memberships.projectId, pid));
  return c.json({ project: row, members });
});
