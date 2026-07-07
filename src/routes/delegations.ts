// Delegations (TRL-CORE-020 / TRL-API-013): an operator grants an agent a
// named, scoped, reversible authority to make decisions of certain classes
// (assertion.agree, assertion.retire, drift.resolve, challenge.resolve,
// request.decide, effort.change, or "*"). This is the ONLY sanctioned way to
// let an agent decide — no raw DB writes.
import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { delegations, memberships, principals } from "../db/schema.js";
import { requireMember, requireOperator } from "../middleware/auth.js";
import type { AppEnv } from "../types.js";

export const delegationRoutes = new Hono<AppEnv>();

type MemberRow = { principalId: string; name: string; kind: "human" | "agent"; role: string };

async function projectMembers(projectId: string): Promise<MemberRow[]> {
  return db
    .select({ principalId: principals.id, name: principals.displayName, kind: principals.kind, role: memberships.role })
    .from(memberships)
    .innerJoin(principals, eq(memberships.principalId, principals.id))
    .where(eq(memberships.projectId, projectId));
}

// Resolve an agent by principal id or (unique) display name.
function resolveAgent(members: MemberRow[], ref: string): { ok: true; agent: MemberRow } | { ok: false; code: string; error: string } {
  const agents = members.filter((m) => m.kind === "agent");
  const byId = agents.find((a) => a.principalId === ref);
  if (byId) return { ok: true, agent: byId };
  const byName = agents.filter((a) => a.name === ref);
  if (byName.length === 1) return { ok: true, agent: byName[0]! };
  if (byName.length > 1) return { ok: false, code: "AMBIGUOUS", error: `Multiple agents named "${ref}" — use the principal id` };
  return { ok: false, code: "NOT_FOUND", error: `No agent "${ref}" in this project` };
}

// GET /projects/:pid/members — who's in the project (to find an agent to delegate to).
delegationRoutes.get("/projects/:pid/members", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  return c.json({ members: await projectMembers(c.req.param("pid")) });
});

// GET /projects/:pid/delegations — list, with the agent's name and status.
delegationRoutes.get("/projects/:pid/delegations", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const rows = await db
    .select({ id: delegations.id, agentPrincipalId: delegations.agentPrincipalId, agentName: principals.displayName, policy: delegations.policy, decisionClasses: delegations.decisionClasses, active: delegations.active, createdAt: delegations.createdAt, revokedAt: delegations.revokedAt })
    .from(delegations)
    .innerJoin(principals, eq(delegations.agentPrincipalId, principals.id))
    .where(eq(delegations.projectId, c.req.param("pid")))
    .orderBy(desc(delegations.createdAt));
  return c.json({ delegations: rows });
});

// POST /projects/:pid/delegations — grant (operator only).
delegationRoutes.post("/projects/:pid/delegations", async (c) => {
  const m = await requireOperator(c);
  if (m instanceof Response) return m;
  const b = z
    .object({ agent: z.string().min(1), classes: z.array(z.string().min(1)).min(1), policy: z.string().optional() })
    .safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "Invalid body — need { agent, classes: [] }", code: "INVALID_INPUT" }, 422);
  const pid = c.req.param("pid");
  const r = resolveAgent(await projectMembers(pid), b.data.agent);
  if (!r.ok) return c.json({ error: r.error, code: r.code }, (r.code === "AMBIGUOUS" ? 409 : 404) as 404);
  const row = (
    await db
      .insert(delegations)
      .values({ projectId: pid, agentPrincipalId: r.agent.principalId, grantedById: m.principalId, policy: b.data.policy ?? `Decisions delegated to ${r.agent.name}`, decisionClasses: b.data.classes, active: true })
      .returning()
  )[0]!;
  return c.json({ delegation: { ...row, agentName: r.agent.name } }, 201);
});

// POST /projects/:pid/delegations/:id/revoke — deactivate (operator only).
delegationRoutes.post("/projects/:pid/delegations/:id/revoke", async (c) => {
  const m = await requireOperator(c);
  if (m instanceof Response) return m;
  const row = (
    await db
      .update(delegations)
      .set({ active: false, revokedAt: new Date() })
      .where(and(eq(delegations.id, c.req.param("id")), eq(delegations.projectId, c.req.param("pid"))))
      .returning()
  )[0];
  if (!row) return c.json({ error: "Delegation not found", code: "NOT_FOUND" }, 404);
  return c.json({ delegation: row });
});
