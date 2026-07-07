// Filing a contradiction between two assertions (TRL-CORE-025). Unlike reality
// drift (auto-filed from a contradicting fact), a contradiction is filed
// explicitly by a review agent or human. It resolves through the same decision
// mechanism (see drift-resolve.ts).

import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  assertions,
  assertionStatusHistory,
  drifts,
  type AssertionStatus,
} from "../db/schema.js";

const DRIFTABLE: AssertionStatus[] = ["agreed", "implemented", "verified"];

type Result<T> = { ok: true; value: T } | { ok: false; code: string; error: string };

export async function fileContradiction(
  projectId: string,
  aHumanId: string,
  bHumanId: string,
  summary: string,
  byPrincipalId: string,
): Promise<Result<typeof drifts.$inferSelect>> {
  if (aHumanId === bHumanId) {
    return { ok: false, code: "SAME_ASSERTION", error: "A contradiction needs two distinct assertions" };
  }
  const rows = await db
    .select()
    .from(assertions)
    .where(and(eq(assertions.projectId, projectId), inArray(assertions.humanId, [aHumanId, bHumanId])));
  const byId = new Map(rows.map((r) => [r.humanId, r]));
  const a = byId.get(aHumanId);
  const b = byId.get(bHumanId);
  if (!a || !b) {
    const missing = [aHumanId, bHumanId].filter((h) => !byId.has(h));
    return { ok: false, code: "UNKNOWN_ASSERTION", error: `Unknown: ${missing.join(", ")}` };
  }
  if (!DRIFTABLE.includes(a.status) || !DRIFTABLE.includes(b.status)) {
    return { ok: false, code: "NOT_DRIFTABLE", error: "Both assertions must be agreed or later" };
  }

  // Dedup: an open contradiction between the same pair (either order).
  const existing = (
    await db
      .select()
      .from(drifts)
      .where(
        and(
          eq(drifts.projectId, projectId),
          eq(drifts.kind, "contradiction"),
          inArray(drifts.status, ["detected", "triaged"]),
          or(
            and(eq(drifts.assertionId, a.id), eq(drifts.assertionBId, b.id)),
            and(eq(drifts.assertionId, b.id), eq(drifts.assertionBId, a.id)),
          ),
        ),
      )
  )[0];
  if (existing) return { ok: true, value: existing };

  const drift = await db.transaction(async (tx) => {
    const d = (
      await tx
        .insert(drifts)
        .values({
          projectId,
          kind: "contradiction",
          assertionId: a.id,
          assertionBId: b.id,
          status: "detected",
          summary,
        })
        .returning()
    )[0]!;
    // Both assertions drift (TRL-CORE-025 + TRL-CORE-010 semantics).
    for (const x of [a, b]) {
      await tx
        .update(assertions)
        .set({ status: "drifted", preDriftStatus: x.status, version: x.version + 1, updatedAt: new Date() })
        .where(eq(assertions.id, x.id));
      await tx.insert(assertionStatusHistory).values({
        assertionId: x.id,
        status: "drifted",
        byPrincipalId,
        note: `auto: contradiction ${d.id}`,
      });
    }
    return d;
  });
  return { ok: true, value: drift };
}
