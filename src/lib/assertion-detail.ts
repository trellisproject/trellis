// The assertion hub: everything linked to one assertion — its status history,
// facts (supporting/contradicting), drifts, tasks, and the decisions that
// shaped it. Powers the "why is it like this" drill-in (TRL-UI-004/010).

import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  assertions,
  assertionStatusHistory,
  decisions,
  driftContradictingFacts,
  drifts,
  factLinks,
  facts,
  taskAssertions,
  tasks,
} from "../db/schema.js";

export async function getAssertionDetail(projectId: string, humanId: string) {
  const a = (
    await db.select().from(assertions).where(and(eq(assertions.projectId, projectId), eq(assertions.humanId, humanId)))
  )[0];
  if (!a) return null;

  const linkedFacts = await db
    .select({
      relation: factLinks.relation,
      id: facts.id,
      statement: facts.statement,
      observerId: facts.observerId,
      evidence: facts.evidence,
      observedAt: facts.observedAt,
    })
    .from(factLinks)
    .innerJoin(facts, eq(facts.id, factLinks.factId))
    .where(eq(factLinks.assertionId, a.id))
    .orderBy(desc(facts.observedAt));

  const relatedDrifts = await db
    .select()
    .from(drifts)
    .where(and(eq(drifts.projectId, projectId), or(eq(drifts.assertionId, a.id), eq(drifts.assertionBId, a.id))))
    .orderBy(desc(drifts.createdAt));

  const relatedTasks = await db
    .select({ id: tasks.id, title: tasks.title, status: tasks.status })
    .from(taskAssertions)
    .innerJoin(tasks, eq(tasks.id, taskAssertions.taskId))
    .where(eq(taskAssertions.assertionId, a.id));

  const statusHistory = await db
    .select()
    .from(assertionStatusHistory)
    .where(eq(assertionStatusHistory.assertionId, a.id))
    .orderBy(asc(assertionStatusHistory.at));

  // Decisions made on this assertion directly, or on any of its drifts.
  const driftIds = relatedDrifts.map((d) => d.id);
  const decisionRows = await db
    .select()
    .from(decisions)
    .where(
      and(
        eq(decisions.projectId, projectId),
        or(
          and(eq(decisions.onType, "assertion"), eq(decisions.onId, a.id)),
          driftIds.length ? and(eq(decisions.onType, "drift"), inArray(decisions.onId, driftIds)) : undefined,
        ),
      ),
    )
    .orderBy(desc(decisions.at));

  return { assertion: a, facts: linkedFacts, drifts: relatedDrifts, tasks: relatedTasks, statusHistory, decisions: decisionRows };
}
