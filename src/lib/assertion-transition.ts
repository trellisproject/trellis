// Human-driven assertion transitions that are decisions (TRL-CORE-018):
// agree (proposed -> agreed) and retire. Automatic transitions (implemented,
// verified, drifted) live elsewhere; these close the forward-path gap.

import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { assertions, assertionStatusHistory, decisions, type AssertionStatus } from "../db/schema.js";
import { authorizeDecider } from "./decisions.js";

type Result = { ok: true; decisionId: string; status: AssertionStatus } | { ok: false; code: string; error: string };

async function transition(
  projectId: string,
  humanId: string,
  choice: "agree" | "retire",
  from: AssertionStatus[],
  to: AssertionStatus,
  input: { actorId: string; rationale: string; delegatedById?: string | null },
): Promise<Result> {
  if (!input.rationale?.trim()) return { ok: false, code: "MISSING_RATIONALE", error: "A non-empty rationale is required" };
  const a = (await db.select().from(assertions).where(eq(assertions.humanId, humanId)))[0];
  if (!a || a.projectId !== projectId) return { ok: false, code: "NOT_FOUND", error: "Assertion not found" };
  if (!from.includes(a.status)) {
    return { ok: false, code: "INVALID_STATE", error: `Cannot ${choice} an assertion that is ${a.status}` };
  }
  const auth = await authorizeDecider(projectId, input.actorId, input.delegatedById, `assertion.${choice}`);
  if (!auth.ok) return auth;

  return await db.transaction(async (tx) => {
    const decision = (
      await tx
        .insert(decisions)
        .values({ projectId, actorId: input.actorId, onType: "assertion", onId: a.id, choice, rationale: input.rationale, delegatedById: auth.delegationId })
        .returning()
    )[0]!;
    await tx.update(assertions).set({ status: to, version: a.version + 1, updatedAt: new Date() }).where(eq(assertions.id, a.id));
    await tx.insert(assertionStatusHistory).values({ assertionId: a.id, status: to, byPrincipalId: input.actorId, decisionId: decision.id, note: choice });
    return { ok: true, decisionId: decision.id, status: to };
  });
}

// proposed -> agreed. The gate that makes an assertion buildable (TRL-CORE-006).
export const agreeAssertion = (projectId: string, humanId: string, input: { actorId: string; rationale: string; delegatedById?: string | null }) =>
  transition(projectId, humanId, "agree", ["proposed"], "agreed", input);

// any live state -> retired.
export const retireAssertion = (projectId: string, humanId: string, input: { actorId: string; rationale: string; delegatedById?: string | null }) =>
  transition(projectId, humanId, "retire", ["proposed", "agreed", "implemented", "verified", "drifted"], "retired", input);
