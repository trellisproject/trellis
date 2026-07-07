// GitHub webhook: verify signature (TRL-API-011) and land implementation facts
// from PR "Trellis:" trailers (TRL-CORE-022).

import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { assertions, assertionStatusHistory } from "../db/schema.js";
import { writeFact } from "./facts.js";

export function hmacHex(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

// TRL-API-011: constant-time compare of X-Hub-Signature-256 against HMAC(secret, body).
export function verifyGithubSignature(secret: string, body: string, header: string | undefined): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${hmacHex(secret, body)}`);
  const got = Buffer.from(header);
  if (expected.length !== got.length) return false;
  return timingSafeEqual(expected, got);
}

const TRAILER = /^\s*Trellis:\s*(.+)\s*$/gim;
const ASSERTION_ID = /^[A-Z]+-[A-Z]+-\d+$/;

export function parseTrellisTrailers(text: string): string[] {
  const ids = new Set<string>();
  for (const m of text.matchAll(TRAILER)) {
    for (const token of m[1]!.split(/[,\s]+/)) {
      const t = token.trim();
      if (ASSERTION_ID.test(t)) ids.add(t);
    }
  }
  return [...ids];
}

export type PrResult = { processed: { humanId: string; transitioned: boolean }[]; ignored?: string };

// Handle a pull_request webhook. Only a merged PR is actioned (TRL-CORE-022).
export async function handlePullRequest(
  projectId: string,
  githubPrincipalId: string,
  payload: any,
): Promise<PrResult> {
  const pr = payload?.pull_request;
  if (payload?.action !== "closed" || !pr?.merged) {
    return { processed: [], ignored: "not a merged PR" };
  }
  const text = `${pr.title ?? ""}\n\n${pr.body ?? ""}`;
  const ids = parseTrellisTrailers(text);
  if (ids.length === 0) return { processed: [], ignored: "no Trellis trailer" };

  const mergeSha: string = pr.merge_commit_sha ?? "unknown";
  const url: string = pr.html_url ?? "";
  const number = pr.number ?? "?";

  const rows = await db
    .select()
    .from(assertions)
    .where(and(eq(assertions.projectId, projectId), inArray(assertions.humanId, ids)));
  const byHumanId = new Map(rows.map((r) => [r.humanId, r]));

  const processed: PrResult["processed"] = [];
  for (const humanId of ids) {
    const a = byHumanId.get(humanId);
    if (!a) continue; // unknown assertion — ignore
    // Record the PR as a fact (evidence), not a verification support link.
    await writeFact(projectId, {
      observerId: githubPrincipalId,
      key: `pr.implements.${humanId}`,
      value: { pr: number },
      statement: `PR #${number} references ${humanId}`,
      evidence: [
        { type: "commit", ref: mergeSha },
        ...(url ? ([{ type: "url", ref: url }] as const) : []),
      ],
    });
    // TRL-CORE-022: merging is a claim -> agreed becomes implemented. verified
    // still needs a checker fact, so we never transition past implemented here.
    let transitioned = false;
    if (a.status === "agreed") {
      await db
        .update(assertions)
        .set({ status: "implemented", version: a.version + 1, updatedAt: new Date() })
        .where(eq(assertions.id, a.id));
      await db.insert(assertionStatusHistory).values({
        assertionId: a.id,
        status: "implemented",
        byPrincipalId: githubPrincipalId,
        note: `PR #${number} merged (${mergeSha.slice(0, 8)})`,
      });
      transitioned = true;
    }
    processed.push({ humanId, transitioned });
  }
  return { processed };
}
