// Spec ingestion: parse spec-format markdown and reconcile it into the
// database. Implements TRL-API-009 (parse report, atomic reject on error),
// TRL-CORE-021 (git owns statements), TRL-CORE-002 (immutable ids).

import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { assertions, specs } from "../db/schema.js";
import { parseSpec } from "./spec-parse.js";

export type IngestReport = {
  ok: boolean;
  spec?: { id: string; slug: string; version: number };
  created: string[];
  statementsUpdated: string[];
  retired: string[];
  // Placeholder ids resolved to real ids during this ingest (TRL-CORE-048/049).
  // The caller writes these back into the git mirror so the placeholder never
  // reaches a commit.
  allocated: { placeholder: string; assigned: string }[];
  errors: { line: number; message: string }[];
};

export async function ingestSpec(
  projectId: string,
  slug: string,
  source: string,
  sourceCommit: string | null,
): Promise<IngestReport> {
  const parsed = parseSpec(source);

  // TRL-API-009: a file with format errors is rejected atomically.
  if (parsed.errors.length > 0) {
    return {
      ok: false,
      created: [],
      statementsUpdated: [],
      retired: [],
      allocated: [],
      errors: parsed.errors,
    };
  }

  const title = parsed.frontmatter.title ?? slug;

  return await db.transaction(async (tx) => {
    // TRL-API-014: idempotent per source commit — re-ingesting a commit is a no-op.
    const existing = (
      await tx.select().from(specs).where(and(eq(specs.projectId, projectId), eq(specs.slug, slug)))
    )[0];

    if (existing && sourceCommit && existing.lastIngestedCommit === sourceCommit) {
      return {
        ok: true,
        spec: { id: existing.id, slug, version: existing.version },
        created: [],
        statementsUpdated: [],
        retired: [],
        allocated: [],
        errors: [],
      };
    }

    const code = parsed.frontmatter.spec ?? null;
    const specRow =
      existing ??
      (
        await tx
          .insert(specs)
          .values({ projectId, slug, title, code, bodyMd: parsed.bodyMd })
          .returning()
      )[0]!;

    if (existing) {
      await tx
        .update(specs)
        .set({
          title,
          code: code ?? existing.code,
          bodyMd: parsed.bodyMd,
          version: existing.version + 1,
          lastIngestedCommit: sourceCommit ?? existing.lastIngestedCommit,
          updatedAt: new Date(),
        })
        .where(eq(specs.id, existing.id));
    } else if (sourceCommit) {
      await tx.update(specs).set({ lastIngestedCommit: sourceCommit }).where(eq(specs.id, specRow.id));
    }

    const created: string[] = [];
    const statementsUpdated: string[] = [];
    const seenIds = new Set<string>();

    const current = await tx
      .select()
      .from(assertions)
      .where(eq(assertions.specId, specRow.id));
    const byHumanId = new Map(current.map((a) => [a.humanId, a]));

    // TRL-CORE-048/049: resolve placeholder ids to real, sequential ones. The
    // server is the sole id allocator, so no human picks a number and parallel
    // drafts cannot collide. Allocation runs inside this transaction, which is
    // serialized per spec (TRL-API-014), so it is atomic. The next number for a
    // prefix is max(existing db ids, real ids in this file) + 1, then counting
    // up for each further placeholder.
    const allocated: { placeholder: string; assigned: string }[] = [];
    const nextByPrefix = new Map<string, number>();
    const maxForPrefix = (prefix: string): number => {
      const re = new RegExp(`^${prefix}-(\\d{3})$`);
      let max = 0;
      for (const a of current) {
        const m = re.exec(a.humanId);
        if (m) max = Math.max(max, Number(m[1]));
      }
      for (const pa of parsed.assertions) {
        if (pa.placeholder) continue;
        const m = re.exec(pa.humanId);
        if (m) max = Math.max(max, Number(m[1]));
      }
      return max;
    };
    const resolved = parsed.assertions.map((pa) => {
      if (!pa.placeholder) return pa;
      const prefix = pa.humanId.replace(/-NEW(?:-[A-Za-z0-9]+)?$/, "");
      const n = (nextByPrefix.get(prefix) ?? maxForPrefix(prefix)) + 1;
      nextByPrefix.set(prefix, n);
      const assigned = `${prefix}-${String(n).padStart(3, "0")}`;
      allocated.push({ placeholder: pa.humanId, assigned });
      return { ...pa, humanId: assigned, placeholder: false };
    });

    for (const pa of resolved) {
      seenIds.add(pa.humanId);
      const prev = byHumanId.get(pa.humanId);
      if (!prev) {
        await tx.insert(assertions).values({
          projectId,
          specId: specRow.id,
          humanId: pa.humanId,
          title: pa.title,
          statement: pa.statement,
          // TRL-CORE-005: a source file must never birth a `verified` assertion —
          // that status requires a supporting fact — so clamp it to `agreed`.
          status: pa.status === "verified" ? "agreed" : pa.status,
          orderInSpec: pa.order,
          metricKey: pa.metric?.key ?? null,
          metricComparator: pa.metric?.comparator ?? null,
          metricTarget: pa.metric?.target ?? null,
          metricUnit: pa.metric?.unit ?? null,
        });
        created.push(pa.humanId);
      } else {
        // TRL-CORE-021: git owns statements; the file is authoritative for
        // statement + title + order. Status is server-owned once it advances
        // past the file's authored value, so we do not downgrade it here.
        const statementChanged = prev.statement !== pa.statement;
        const metricChanged =
          prev.metricKey !== (pa.metric?.key ?? null) ||
          prev.metricComparator !== (pa.metric?.comparator ?? null) ||
          prev.metricTarget !== (pa.metric?.target ?? null);
        if (statementChanged || metricChanged || prev.title !== pa.title || prev.orderInSpec !== pa.order) {
          await tx
            .update(assertions)
            .set({
              statement: pa.statement,
              title: pa.title,
              orderInSpec: pa.order,
              metricKey: pa.metric?.key ?? null,
              metricComparator: pa.metric?.comparator ?? null,
              metricTarget: pa.metric?.target ?? null,
              metricUnit: pa.metric?.unit ?? null,
              version: prev.version + 1,
              updatedAt: new Date(),
            })
            .where(eq(assertions.id, prev.id));
          if (statementChanged) statementsUpdated.push(pa.humanId);
        }
      }
    }

    // Assertions present in the DB but absent from the file are retired
    // (TRL-CORE-002: retire, don't delete).
    const retired: string[] = [];
    for (const a of current) {
      if (!seenIds.has(a.humanId) && a.status !== "retired") {
        await tx
          .update(assertions)
          .set({ status: "retired", updatedAt: new Date() })
          .where(eq(assertions.id, a.id));
        retired.push(a.humanId);
      }
    }

    const finalVersion = existing ? existing.version + 1 : specRow.version;
    return {
      ok: true,
      spec: { id: specRow.id, slug, version: finalVersion },
      created,
      statementsUpdated,
      retired,
      allocated,
      errors: [],
    };
  });
}
