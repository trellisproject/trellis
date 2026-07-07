// In-app authoring — Trellis is the authoring authority for intent (TRL-CORE-021).
// Create specs and assertions, edit statements. Git is a generated mirror
// (see renderSpec) for durability and agent-visible intent, not the source.

import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { assertions, specs, type AssertionStatus } from "../db/schema.js";
import type { ParsedMetric } from "./spec-parse.js";

type Result<T> = { ok: true; value: T } | { ok: false; code: string; error: string };

export async function createSpec(
  projectId: string,
  input: { slug: string; title: string; code: string },
): Promise<Result<typeof specs.$inferSelect>> {
  const existing = (await db.select().from(specs).where(and(eq(specs.projectId, projectId), eq(specs.slug, input.slug))))[0];
  if (existing) return { ok: false, code: "SLUG_TAKEN", error: `A spec with slug "${input.slug}" already exists` };
  const row = (await db.insert(specs).values({ projectId, slug: input.slug, title: input.title, code: input.code }).returning())[0]!;
  return { ok: true, value: row };
}

// Next assertion id for a spec: <code>-<NNN>, zero-padded, immutable (TRL-CORE-002).
async function nextHumanId(projectId: string, specRow: typeof specs.$inferSelect): Promise<string> {
  const code = specRow.code ?? specRow.slug.toUpperCase();
  const rows = await db.select({ humanId: assertions.humanId }).from(assertions).where(eq(assertions.specId, specRow.id));
  let max = 0;
  const re = new RegExp(`^${code}-(\\d+)$`);
  for (const r of rows) {
    const m = re.exec(r.humanId);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${code}-${String(max + 1).padStart(3, "0")}`;
}

export async function createAssertion(
  projectId: string,
  slug: string,
  input: { title: string; statement: string; status?: AssertionStatus; metric?: ParsedMetric | null },
): Promise<Result<typeof assertions.$inferSelect>> {
  const specRow = (await db.select().from(specs).where(and(eq(specs.projectId, projectId), eq(specs.slug, slug))))[0];
  if (!specRow) return { ok: false, code: "NOT_FOUND", error: "Spec not found" };
  if (!input.title.trim() || !input.statement.trim()) return { ok: false, code: "INVALID_INPUT", error: "title and statement are required" };
  const humanId = await nextHumanId(projectId, specRow);
  const order = (await db.select().from(assertions).where(eq(assertions.specId, specRow.id))).length;
  const row = (
    await db
      .insert(assertions)
      .values({
        projectId, specId: specRow.id, humanId, title: input.title, statement: input.statement,
        status: input.status ?? "proposed", orderInSpec: order,
        metricKey: input.metric?.key ?? null, metricComparator: input.metric?.comparator ?? null,
        metricTarget: input.metric?.target ?? null, metricUnit: input.metric?.unit ?? null,
      })
      .returning()
  )[0]!;
  return { ok: true, value: row };
}

// Edit statement/title/metric of an assertion (statements are now editable in
// Trellis). Bumps version; attribution is the caller. Meaning changes should
// still retire+replace (TRL-CORE-002) — that's a discipline, not enforced here.
export async function editAssertion(
  projectId: string,
  humanId: string,
  input: { title?: string; statement?: string; metric?: ParsedMetric | null },
): Promise<Result<typeof assertions.$inferSelect>> {
  const a = (await db.select().from(assertions).where(and(eq(assertions.projectId, projectId), eq(assertions.humanId, humanId))))[0];
  if (!a) return { ok: false, code: "NOT_FOUND", error: "Assertion not found" };
  const metricProvided = input.metric !== undefined;
  const row = (
    await db
      .update(assertions)
      .set({
        title: input.title ?? a.title,
        statement: input.statement ?? a.statement,
        metricKey: metricProvided ? (input.metric?.key ?? null) : a.metricKey,
        metricComparator: metricProvided ? (input.metric?.comparator ?? null) : a.metricComparator,
        metricTarget: metricProvided ? (input.metric?.target ?? null) : a.metricTarget,
        metricUnit: metricProvided ? (input.metric?.unit ?? null) : a.metricUnit,
        version: a.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(assertions.id, a.id))
      .returning()
  )[0]!;
  return { ok: true, value: row };
}

const OP_SYMBOL: Record<string, string> = { gte: ">=", gt: ">", lte: "<=", lt: "<", eq: "==" };

// Render a spec to spec-format markdown — the git mirror. Round-trips through
// the parser. Retired assertions are omitted (retire = removed from the spec).
export async function renderSpec(projectId: string, slug: string): Promise<string | null> {
  const specRow = (await db.select().from(specs).where(and(eq(specs.projectId, projectId), eq(specs.slug, slug))))[0];
  if (!specRow) return null;
  const rows = await db
    .select()
    .from(assertions)
    .where(and(eq(assertions.specId, specRow.id), inArray(assertions.status, ["proposed", "agreed", "implemented", "verified", "drifted"])))
    .orderBy(asc(assertions.orderInSpec));

  const lines: string[] = [];
  lines.push("---");
  lines.push(`spec: ${specRow.code ?? specRow.slug.toUpperCase()}`);
  lines.push(`title: ${specRow.title}`);
  lines.push("---", "");
  lines.push(`# ${specRow.title}`, "");
  lines.push("<!-- Generated by Trellis. Intent is authored in Trellis; this file is a mirror. -->", "");
  for (const a of rows) {
    lines.push(`### ${a.humanId}: ${a.title}`);
    lines.push(`status: ${a.status}`);
    if (a.metricKey && a.metricComparator && a.metricTarget != null) {
      lines.push(`metric: ${a.metricKey} ${OP_SYMBOL[a.metricComparator]} ${a.metricTarget}${a.metricUnit ?? ""}`);
    }
    lines.push("", a.statement, "");
  }
  return lines.join("\n");
}
