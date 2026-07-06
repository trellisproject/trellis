// Authorization for consequential decisions.
// TRL-API-012: only operators (human) decide. TRL-CORE-020 / TRL-API-013:
// agents decide only under an active delegation authorizing the class.

import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { delegations, memberships, principals } from "../db/schema.js";

export type DecideAuth =
  | { ok: true; delegationId: string | null }
  | { ok: false; code: string; error: string };

export async function authorizeDecider(
  projectId: string,
  actorId: string,
  delegatedById: string | null | undefined,
  requiredClass: string,
): Promise<DecideAuth> {
  const member = (
    await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.projectId, projectId), eq(memberships.principalId, actorId)))
  )[0];
  if (!member) return { ok: false, code: "NOT_MEMBER", error: "Actor is not a member of this project" };

  const principal = (await db.select().from(principals).where(eq(principals.id, actorId)))[0];
  if (!principal) return { ok: false, code: "NOT_MEMBER", error: "Unknown actor" };

  if (principal.kind === "human") {
    if (member.role !== "operator") {
      return { ok: false, code: "NOT_OPERATOR", error: "Only operators can decide" };
    }
    return { ok: true, delegationId: null };
  }

  // agent principal — requires a valid delegation (TRL-API-013)
  if (!delegatedById) {
    return { ok: false, code: "DELEGATION_REQUIRED", error: "Agent decisions require a delegation" };
  }
  const del = (
    await db
      .select()
      .from(delegations)
      .where(
        and(
          eq(delegations.id, delegatedById),
          eq(delegations.projectId, projectId),
          eq(delegations.agentPrincipalId, actorId),
          eq(delegations.active, true),
        ),
      )
  )[0];
  if (!del) return { ok: false, code: "INVALID_DELEGATION", error: "No active delegation for this agent" };
  const classes = del.decisionClasses;
  if (!classes.includes("*") && !classes.includes(requiredClass)) {
    return { ok: false, code: "DELEGATION_SCOPE", error: `Delegation does not authorize ${requiredClass}` };
  }
  return { ok: true, delegationId: del.id };
}
