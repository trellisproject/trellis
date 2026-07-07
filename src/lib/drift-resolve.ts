// Drift resolution — the first consequential, decision-bearing transition.
// TRL-CORE-011 (fix|amend|accept), TRL-CORE-013 (status restoration),
// TRL-CORE-018 (decision with mandatory rationale), TRL-API-004 (decision
// rides the transition call).

import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  assertions,
  assertionStatusHistory,
  decisions,
  drifts,
  taskAssertions,
  tasks,
  type AssertionStatus,
} from "../db/schema.js";
import { authorizeDecider } from "./decisions.js";

export type ResolveChoice = "fix" | "amend" | "accept";

export type ResolveInput = {
  actorId: string;
  choice: ResolveChoice;
  rationale: string;
  alternatives?: string[];
  delegatedById?: string | null;
};

export type ResolveResult =
  | { ok: true; decisionId: string; assertionStatus: AssertionStatus; taskId: string | null }
  | { ok: false; code: string; error: string };

const CHOICES: ResolveChoice[] = ["fix", "amend", "accept"];

export async function resolveDrift(
  projectId: string,
  driftId: string,
  input: ResolveInput,
): Promise<ResolveResult> {
  if (!CHOICES.includes(input.choice)) {
    return { ok: false, code: "INVALID_CHOICE", error: "choice must be fix, amend, or accept" };
  }
  // TRL-CORE-018: rationale is mandatory.
  if (!input.rationale || input.rationale.trim().length === 0) {
    return { ok: false, code: "MISSING_RATIONALE", error: "A non-empty rationale is required" };
  }

  const drift = (await db.select().from(drifts).where(eq(drifts.id, driftId)))[0];
  if (!drift || drift.projectId !== projectId) {
    return { ok: false, code: "NOT_FOUND", error: "Drift not found" };
  }
  if (drift.status === "resolved") {
    return { ok: false, code: "ALREADY_RESOLVED", error: "Drift is already resolved" };
  }

  const auth = await authorizeDecider(projectId, input.actorId, input.delegatedById, "drift.resolve");
  if (!auth.ok) return auth;

  return await db.transaction(async (tx) => {
    const decision = (
      await tx
        .insert(decisions)
        .values({
          projectId,
          actorId: input.actorId,
          onType: "drift",
          onId: driftId,
          choice: input.choice,
          rationale: input.rationale,
          alternatives: input.alternatives ?? [],
          delegatedById: auth.delegationId,
        })
        .returning()
    )[0]!;

    await tx
      .update(drifts)
      .set({ status: "resolved", resolutionDecisionId: decision.id, updatedAt: new Date() })
      .where(eq(drifts.id, driftId));

    // Reality drift affects one assertion; a contradiction affects both
    // (TRL-CORE-025). Restore each from 'drifted'.
    const affectedIds = [drift.assertionId, ...(drift.assertionBId ? [drift.assertionBId] : [])];
    const primary = (await tx.select().from(assertions).where(eq(assertions.id, drift.assertionId)))[0]!;
    let primaryStatus: AssertionStatus = primary.status;

    for (const aid of affectedIds) {
      const a = (await tx.select().from(assertions).where(eq(assertions.id, aid)))[0]!;
      // TRL-CORE-013: for a reality drift, amend retires the (unambiguous)
      // assertion. For a contradiction, which side is wrong is decided in git,
      // so all choices restore prior status and the retire lands via ingestion.
      let newStatus: AssertionStatus;
      if (drift.kind === "reality" && input.choice === "amend") {
        newStatus = "retired";
      } else {
        newStatus = a.preDriftStatus ?? "agreed";
      }
      await tx
        .update(assertions)
        .set({ status: newStatus, preDriftStatus: null, version: a.version + 1, updatedAt: new Date() })
        .where(eq(assertions.id, a.id));
      await tx.insert(assertionStatusHistory).values({
        assertionId: a.id,
        status: newStatus,
        byPrincipalId: input.actorId,
        decisionId: decision.id,
        note: `drift ${input.choice}`,
      });
      if (aid === drift.assertionId) primaryStatus = newStatus;
    }

    // TRL-CORE-011: 'fix' means reality is wrong — spawn a task to fix it.
    let taskId: string | null = null;
    if (input.choice === "fix") {
      const task = (
        await tx
          .insert(tasks)
          .values({ projectId, title: `Fix drift on ${primary.humanId}`, status: "open", driftId })
          .returning()
      )[0]!;
      await tx.insert(taskAssertions).values({ taskId: task.id, assertionId: primary.id });
      taskId = task.id;
    }

    return { ok: true, decisionId: decision.id, assertionStatus: primaryStatus, taskId };
  });
}

// Triage is a non-decision transition (detected -> triaged); any member may do it.
export async function triageDrift(projectId: string, driftId: string): Promise<ResolveResult | { ok: true }> {
  const drift = (await db.select().from(drifts).where(eq(drifts.id, driftId)))[0];
  if (!drift || drift.projectId !== projectId) {
    return { ok: false, code: "NOT_FOUND", error: "Drift not found" };
  }
  if (drift.status !== "detected") {
    return { ok: false, code: "INVALID_STATE", error: "Only a detected drift can be triaged" };
  }
  await db.update(drifts).set({ status: "triaged", updatedAt: new Date() }).where(eq(drifts.id, driftId));
  return { ok: true };
}
