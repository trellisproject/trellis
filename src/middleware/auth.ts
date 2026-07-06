import type { Context, MiddlewareHandler } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { agentTokens, memberships, principals } from "../db/schema.js";
import { hashToken } from "../lib/tokens.js";
import type { AppEnv } from "../types.js";

// Resolves the bearer token to a principal (TRL-API-001). Absent token is
// allowed through as unauthenticated (handlers gate reads/writes); an invalid
// token is rejected outright.
export const authenticate: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header("Authorization");
  if (header?.startsWith("Bearer ")) {
    const raw = header.slice(7).trim();
    const row = (
      await db
        .select({ principalId: agentTokens.principalId, projectId: agentTokens.projectId, kind: principals.kind })
        .from(agentTokens)
        .innerJoin(principals, eq(principals.id, agentTokens.principalId))
        .where(and(eq(agentTokens.tokenHash, hashToken(raw)), isNull(agentTokens.revokedAt)))
    )[0];
    if (!row) return c.json({ error: "Invalid token", code: "UNAUTHENTICATED" }, 401);
    c.set("principalId", row.principalId);
    c.set("principalKind", row.kind);
    c.set("tokenProjectId", row.projectId);
  }
  await next();
};

export type Member = { principalId: string; role: "operator" | "member" };

// Resolve the caller to a member of an explicit project id. Returns a Response
// (401/403) to short-circuit, or the member on success (TRL-API-003/010/012).
export async function requireProjectMember(
  c: Context<AppEnv>,
  projectId: string,
): Promise<Member | Response> {
  const principalId = c.get("principalId");
  if (!principalId) return c.json({ error: "Authentication required", code: "UNAUTHENTICATED" }, 401);
  const tokenProjectId = c.get("tokenProjectId");
  if (tokenProjectId && tokenProjectId !== projectId) {
    return c.json({ error: "Token not valid for this project", code: "WRONG_PROJECT" }, 403);
  }
  const m = (
    await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.projectId, projectId), eq(memberships.principalId, principalId)))
  )[0];
  if (!m) return c.json({ error: "Not a project member", code: "NOT_MEMBER" }, 403);
  return { principalId, role: m.role };
}

// Same, using the :pid path param.
export async function requireMember(c: Context<AppEnv>): Promise<Member | Response> {
  const pid = c.req.param("pid");
  if (!pid) return c.json({ error: "Missing project id", code: "INVALID_INPUT" }, 400);
  return requireProjectMember(c, pid);
}

export async function requireOperator(c: Context<AppEnv>): Promise<Member | Response> {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  if (m.role !== "operator") return c.json({ error: "Operator role required", code: "NOT_OPERATOR" }, 403);
  return m;
}
