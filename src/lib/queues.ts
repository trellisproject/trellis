// The two load-bearing queries a checker and a triager work from.

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { assertions, challenges, drifts } from "../db/schema.js";

// TRL-CORE-009: agreed-or-later assertions with no supporting fact newer than
// staleDays. This is the checker work queue.
export async function checkerQueue(projectId: string, staleDays: number) {
  const cutoff = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000).toISOString();
  const rows = await db.execute<{
    id: string;
    human_id: string;
    title: string;
    status: string;
  }>(sql`
    SELECT a.id, a.human_id, a.title, a.status
    FROM ${assertions} a
    WHERE a.project_id = ${projectId}
      AND a.status IN ('agreed', 'implemented', 'verified')
      AND NOT EXISTS (
        SELECT 1
        FROM fact_links fl
        JOIN facts f ON f.id = fl.fact_id
        WHERE fl.assertion_id = a.id
          AND fl.relation = 'supports'
          AND f.observed_at > ${cutoff}::timestamptz
      )
    ORDER BY a.human_id
  `);
  return rows as unknown as { id: string; human_id: string; title: string; status: string }[];
}

// The triage queue: open drifts + open challenges (TRL-UI-001).
export async function triageQueue(projectId: string) {
  const openDrifts = await db
    .select()
    .from(drifts)
    .where(and(eq(drifts.projectId, projectId), inArray(drifts.status, ["detected", "triaged"])));
  const openChallenges = await db
    .select()
    .from(challenges)
    .where(and(eq(challenges.projectId, projectId), eq(challenges.status, "open")));
  return { drifts: openDrifts, challenges: openChallenges };
}
