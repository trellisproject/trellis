// Fact writing + automatic drift filing.
// Implements TRL-CORE-007 (mandatory provenance), TRL-CORE-008 (append-only),
// TRL-CORE-010 (a contradicting fact files drift), TRL-CORE-012 (accepted
// deviations never re-flag).

import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  assertions,
  assertionStatusHistory,
  decisions,
  driftContradictingFacts,
  drifts,
  factLinks,
  facts,
  memberships,
  type AssertionStatus,
  type EvidenceRef,
} from "../db/schema.js";

export type FactLinkInput = { assertion: string; relation: "supports" | "contradicts" };

export type WriteFactInput = {
  observerId: string;
  key: string;
  value: unknown;
  statement: string;
  evidence: EvidenceRef[];
  observedAt?: Date;
  expiresAt?: Date | null;
  supersedesId?: string | null;
  links?: FactLinkInput[];
};

export type WriteFactResult =
  | { ok: true; fact: typeof facts.$inferSelect; driftsCreated: string[]; verified: string[] }
  | { ok: false; code: string; error: string };

// Statuses from which a contradiction can knock an assertion into 'drifted'.
const DRIFTABLE: AssertionStatus[] = ["agreed", "implemented", "verified"];
const OPEN_DRIFT: ("detected" | "triaged")[] = ["detected", "triaged"];

export async function writeFact(
  projectId: string,
  input: WriteFactInput,
): Promise<WriteFactResult> {
  // TRL-CORE-007: provenance is mandatory.
  if (!input.evidence || input.evidence.length === 0) {
    return { ok: false, code: "MISSING_EVIDENCE", error: "At least one evidence reference is required" };
  }

  // TRL-CORE-016: the observer must be a project member.
  const member = (
    await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.projectId, projectId), eq(memberships.principalId, input.observerId)))
  )[0];
  if (!member) {
    return { ok: false, code: "NOT_MEMBER", error: "Observer is not a member of this project" };
  }

  // Resolve linked assertions by human id within the project.
  const links = input.links ?? [];
  let linkedByHumanId = new Map<string, typeof assertions.$inferSelect>();
  if (links.length > 0) {
    const humanIds = [...new Set(links.map((l) => l.assertion))];
    const rows = await db
      .select()
      .from(assertions)
      .where(and(eq(assertions.projectId, projectId), inArray(assertions.humanId, humanIds)));
    linkedByHumanId = new Map(rows.map((r) => [r.humanId, r]));
    const missing = humanIds.filter((h) => !linkedByHumanId.has(h));
    if (missing.length > 0) {
      return { ok: false, code: "UNKNOWN_ASSERTION", error: `Unknown assertion(s): ${missing.join(", ")}` };
    }
  }

  return await db.transaction(async (tx) => {
    const fact = (
      await tx
        .insert(facts)
        .values({
          projectId,
          key: input.key,
          value: input.value as object,
          statement: input.statement,
          observerId: input.observerId,
          evidence: input.evidence,
          observedAt: input.observedAt ?? new Date(),
          expiresAt: input.expiresAt ?? null,
          supersedesId: input.supersedesId ?? null,
        })
        .returning()
    )[0]!;

    const driftsCreated: string[] = [];
    const verified: string[] = [];

    for (const link of links) {
      const assertion = linkedByHumanId.get(link.assertion)!;
      await tx.insert(factLinks).values({
        factId: fact.id,
        assertionId: assertion.id,
        relation: link.relation,
      });

      if (link.relation === "supports") {
        // TRL-CORE-005: a supporting fact is the sanctioned path to verified.
        // Only an agreed/implemented assertion advances; drifted must resolve
        // first, proposed isn't intent yet.
        if (assertion.status === "agreed" || assertion.status === "implemented") {
          await tx
            .update(assertions)
            .set({ status: "verified", version: assertion.version + 1, updatedAt: new Date() })
            .where(eq(assertions.id, assertion.id));
          await tx.insert(assertionStatusHistory).values({
            assertionId: assertion.id,
            status: "verified",
            byPrincipalId: input.observerId,
            note: `verified by fact ${fact.id}`,
          });
          verified.push(assertion.humanId);
        }
        continue;
      }

      // Find an open drift for this assertion to attach to (dedup — TRL-CORE-010).
      const open = (
        await tx
          .select()
          .from(drifts)
          .where(
            and(
              eq(drifts.assertionId, assertion.id),
              eq(drifts.kind, "reality"),
              inArray(drifts.status, OPEN_DRIFT),
            ),
          )
      )[0];
      if (open) {
        await tx.insert(driftContradictingFacts).values({ driftId: open.id, factId: fact.id });
        continue;
      }

      // TRL-CORE-012: if a prior drift for this assertion was resolved as
      // 'accept', do not re-file the same contradiction.
      const accepted = await tx
        .select({ id: drifts.id })
        .from(drifts)
        .innerJoin(decisions, eq(decisions.id, drifts.resolutionDecisionId))
        .where(
          and(
            eq(drifts.assertionId, assertion.id),
            eq(drifts.kind, "reality"),
            eq(decisions.choice, "accept"),
          ),
        );
      if (accepted.length > 0) continue;

      // Only agreed-or-later assertions drift.
      if (!DRIFTABLE.includes(assertion.status)) continue;

      const drift = (
        await tx
          .insert(drifts)
          .values({
            projectId,
            kind: "reality",
            assertionId: assertion.id,
            status: "detected",
            summary: `Observed fact contradicts ${assertion.humanId}: ${input.statement}`,
          })
          .returning()
      )[0]!;
      await tx.insert(driftContradictingFacts).values({ driftId: drift.id, factId: fact.id });

      // TRL-CORE-010: knock the assertion to 'drifted', remembering prior status
      // so resolution can restore it (TRL-CORE-013).
      await tx
        .update(assertions)
        .set({ status: "drifted", preDriftStatus: assertion.status, version: assertion.version + 1, updatedAt: new Date() })
        .where(eq(assertions.id, assertion.id));
      await tx.insert(assertionStatusHistory).values({
        assertionId: assertion.id,
        status: "drifted",
        byPrincipalId: input.observerId,
        note: `auto: drift ${drift.id}`,
      });

      driftsCreated.push(drift.id);
    }

    return { ok: true, fact, driftsCreated, verified };
  });
}
