// Challenges — structured disagreement with a decision.
// TRL-CORE-027 (any member may file, rationale mandatory), TRL-CORE-028
// (filing does not suspend the challenged decision), TRL-CORE-029 (resolution
// is itself a decision: uphold or supersede).

import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { challenges, decisions } from "../db/schema.js";
import { authorizeDecider } from "./decisions.js";

type Result<T> = { ok: true; value: T } | { ok: false; code: string; error: string };

export async function fileChallenge(
  projectId: string,
  decisionId: string,
  byPrincipalId: string,
  rationale: string,
  cites: string[],
): Promise<Result<typeof challenges.$inferSelect>> {
  if (!rationale || rationale.trim().length === 0) {
    return { ok: false, code: "MISSING_RATIONALE", error: "A non-empty rationale is required" };
  }
  const decision = (await db.select().from(decisions).where(eq(decisions.id, decisionId)))[0];
  if (!decision || decision.projectId !== projectId) {
    return { ok: false, code: "NOT_FOUND", error: "Decision not found" };
  }
  // TRL-CORE-028: the challenged decision is untouched; we only record the challenge.
  const ch = (
    await db
      .insert(challenges)
      .values({ projectId, onDecisionId: decisionId, byPrincipalId, rationale, cites })
      .returning()
  )[0]!;
  return { ok: true, value: ch };
}

export type ChallengeChoice = "uphold" | "supersede";

export async function resolveChallenge(
  projectId: string,
  challengeId: string,
  input: { actorId: string; choice: ChallengeChoice; rationale: string; delegatedById?: string | null },
): Promise<Result<{ decisionId: string; choice: ChallengeChoice }>> {
  if (input.choice !== "uphold" && input.choice !== "supersede") {
    return { ok: false, code: "INVALID_CHOICE", error: "choice must be uphold or supersede" };
  }
  if (!input.rationale || input.rationale.trim().length === 0) {
    return { ok: false, code: "MISSING_RATIONALE", error: "A non-empty rationale is required" };
  }
  const ch = (await db.select().from(challenges).where(eq(challenges.id, challengeId)))[0];
  if (!ch || ch.projectId !== projectId) return { ok: false, code: "NOT_FOUND", error: "Challenge not found" };
  if (ch.status === "resolved") return { ok: false, code: "ALREADY_RESOLVED", error: "Challenge is resolved" };

  const auth = await authorizeDecider(projectId, input.actorId, input.delegatedById, "challenge.resolve");
  if (!auth.ok) return auth;

  return await db.transaction(async (tx) => {
    const decision = (
      await tx
        .insert(decisions)
        .values({
          projectId,
          actorId: input.actorId,
          onType: "challenge",
          onId: challengeId,
          choice: input.choice,
          rationale: input.rationale,
          delegatedById: auth.delegationId,
          // supersede: the resolving decision replaces the challenged one.
          supersedesId: input.choice === "supersede" ? ch.onDecisionId : null,
        })
        .returning()
    )[0]!;
    await tx
      .update(challenges)
      .set({ status: "resolved", resolvedByDecisionId: decision.id })
      .where(eq(challenges.id, challengeId));
    return { ok: true, value: { decisionId: decision.id, choice: input.choice } };
  });
}
