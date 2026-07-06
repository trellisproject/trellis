import { Hono } from "hono";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { projects, memberships, principals, agentTokens } from "../db/schema.js";
import { generateToken, hashToken } from "../lib/tokens.js";
import { requireMember, requireOperator } from "../middleware/auth.js";
import type { AppEnv } from "../types.js";

export const projectRoutes = new Hono<AppEnv>();

const createProject = z.object({
  name: z.string().min(1),
  repos: z.array(z.string()).optional(),
  operator: z.object({ displayName: z.string().min(1), email: z.string().email().optional() }),
});

// POST /projects — create a project, its first operator, and a bootstrap
// token. Unauthenticated (chicken-and-egg); the returned token is how the
// operator authenticates every subsequent call, and is shown only once.
projectRoutes.post("/projects", async (c) => {
  const parsed = createProject.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "Invalid body", code: "INVALID_INPUT", issues: parsed.error.issues }, 422);
  }
  const { name, repos, operator } = parsed.data;
  const raw = generateToken();

  const result = await db.transaction(async (tx) => {
    const project = (await tx.insert(projects).values({ name, repos: repos ?? [] }).returning())[0]!;
    const principal = (
      await tx
        .insert(principals)
        .values({ kind: "human", displayName: operator.displayName, email: operator.email })
        .returning()
    )[0]!;
    await tx
      .insert(memberships)
      .values({ projectId: project.id, principalId: principal.id, role: "operator" });
    await tx
      .insert(agentTokens)
      .values({ projectId: project.id, principalId: principal.id, tokenHash: hashToken(raw) });
    return { project, operator: principal };
  });

  return c.json({ ...result, token: raw }, 201);
});

const mintToken = z.object({
  displayName: z.string().min(1),
  kind: z.enum(["human", "agent"]).default("agent"),
  role: z.enum(["operator", "member"]).default("member"),
});

// POST /projects/:pid/tokens — operator provisions a new principal (typically
// an agent) as a member and returns its token (shown once). TRL-API-001/012.
projectRoutes.post("/projects/:pid/tokens", async (c) => {
  const op = await requireOperator(c);
  if (op instanceof Response) return op;
  const pid = c.req.param("pid");
  const parsed = mintToken.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "Invalid body", code: "INVALID_INPUT", issues: parsed.error.issues }, 422);
  }
  const { displayName, kind, role } = parsed.data;
  const raw = generateToken();
  const principal = await db.transaction(async (tx) => {
    const p = (await tx.insert(principals).values({ kind, displayName }).returning())[0]!;
    await tx.insert(memberships).values({ projectId: pid, principalId: p.id, role });
    await tx.insert(agentTokens).values({ projectId: pid, principalId: p.id, tokenHash: hashToken(raw) });
    return p;
  });
  return c.json({ principal, token: raw }, 201);
});

// GET /projects — projects the caller is a member of (TRL-API-010).
projectRoutes.get("/projects", async (c) => {
  const principalId = c.get("principalId");
  if (!principalId) return c.json({ error: "Authentication required", code: "UNAUTHENTICATED" }, 401);
  const mine = await db
    .select({ projectId: memberships.projectId })
    .from(memberships)
    .where(eq(memberships.principalId, principalId));
  const ids = mine.map((m) => m.projectId);
  const rows = ids.length ? await db.select().from(projects).where(inArray(projects.id, ids)) : [];
  return c.json({ projects: rows });
});

// GET /projects/:pid
projectRoutes.get("/projects/:pid", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
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
