// Dogfood: drive a realistic project through the live API and print the
// resulting state, so we can judge whether Trellis actually captures something
// useful. Run against a running server (npm run dev) + local DB.
//
//   npm run dogfood
//
// Talks HTTP only — exercises auth, ingestion, PR webhook, facts, drift,
// resolution, milestones, and challenges exactly as a real agent team would.

import { createHmac } from "node:crypto";

const BASE = process.env.TRELLIS_URL ?? "http://localhost:8787";

// Pure HTTP client — no server internals imported. Mirrors the server's
// signature scheme so we can post valid webhook events.
const hmacHex = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest("hex");

type Json = any;
async function api(method: string, path: string, opts: { body?: Json; token?: string; raw?: string; headers?: Record<string, string> } = {}): Promise<Json> {
  const headers: Record<string, string> = { "content-type": "application/json", ...(opts.headers ?? {}) };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: opts.raw ?? (opts.body ? JSON.stringify(opts.body) : undefined) });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return json;
}

// A realistic small spec for a fake product: a payments API.
const SPEC = `---
project: payments
spec: PAY-API
title: Payments API
---

# Payments API

### PAY-API-001: Idempotent charge creation
status: agreed

POST /charges accepts an Idempotency-Key and returns the original charge
on retry rather than double-charging.

### PAY-API-002: Amounts are integer minor units
status: agreed

All amounts are integer cents; the API rejects fractional amounts with 422.

### PAY-API-003: Refunds never exceed the captured amount
status: agreed

A refund request greater than the remaining captured balance is rejected.

### PAY-API-004: Webhooks are signed
status: agreed

Outbound webhooks carry an HMAC signature the receiver can verify.

### PAY-API-005: Charges are listable with cursor pagination
status: agreed

GET /charges paginates with a default page size of 50 and a cursor.

### PAY-API-006: PCI data is never logged
status: agreed

Card numbers and CVCs never appear in application logs.
`;

function prEvent(secret: string, title: string, body: string, sha: string, number: number) {
  const payload = JSON.stringify({ action: "closed", pull_request: { merged: true, title, body, merge_commit_sha: sha, html_url: `https://github.com/acme/payments/pull/${number}`, number } });
  return { raw: payload, sig: `sha256=${hmacHex(secret, payload)}` };
}

function bar(verified: number, total: number, width = 20): string {
  const filled = total === 0 ? 0 : Math.round((verified / total) * width);
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}] ${verified}/${total}`;
}

async function main() {
  console.log("\n=== Seeding a realistic project through the live API ===\n");

  // 1. Operator creates the project (bootstrap token).
  const created = await api("POST", "/projects", { body: { name: `payments-${Date.now()}`, repos: ["github.com/acme/payments"], operator: { displayName: "Priya (lead)" } } });
  const pid = created.project.id;
  const opTok = created.token;
  console.log(`Project created: ${created.project.name}  (operator: Priya)`);

  // 2. Ingest the spec — intent is now structured.
  const ing = await api("POST", `/projects/${pid}/specs/ingest`, { token: opTok, body: { slug: "api", source: SPEC, commit: "spec-c1" } });
  console.log(`Spec ingested: ${ing.created.length} assertions agreed\n`);

  // 3. Operator provisions a builder + a checker agent, and a webhook secret.
  const builder = await api("POST", `/projects/${pid}/tokens`, { token: opTok, body: { displayName: "builder-bot", kind: "agent" } });
  const checker = await api("POST", `/projects/${pid}/tokens`, { token: opTok, body: { displayName: "checker-bot", kind: "agent" } });
  const wh = await api("POST", `/projects/${pid}/webhook`, { token: opTok });
  console.log("Provisioned builder-bot, checker-bot, and a webhook secret.");

  // 4. Builder merges PRs -> agreed becomes implemented (via signed webhook).
  const merges: [string, string, string, number][] = [
    ["Idempotent charges", "Trellis: PAY-API-001", "sha001", 11],
    ["Integer amounts", "Trellis: PAY-API-002", "sha002", 12],
    ["Refund guard", "Trellis: PAY-API-003", "sha003", 13],
    ["Signed webhooks", "Trellis: PAY-API-004", "sha004", 14],
  ];
  for (const [title, trailer, sha, n] of merges) {
    const e = prEvent(wh.secret, title, `Implements it.\n\n${trailer}`, sha, n);
    await api("POST", `/projects/${pid}/integrations/github/webhook`, { raw: e.raw, headers: { "X-GitHub-Event": "pull_request", "X-Hub-Signature-256": e.sig } });
  }
  console.log(`Builder merged ${merges.length} PRs -> assertions transitioned to implemented.\n`);

  // 5. Checker pass: read the work queue, write supporting facts with evidence.
  const queue = await api("GET", `/projects/${pid}/queue/checker?stale_days=7`, { token: checker.token });
  console.log(`Checker queue has ${queue.assertions.length} assertions needing verification.`);
  for (const a of queue.assertions.filter((x: Json) => ["PAY-API-001", "PAY-API-002", "PAY-API-005"].includes(x.human_id))) {
    await api("POST", `/projects/${pid}/facts`, { token: checker.token, body: {
      key: `verify.${a.human_id}`, value: true, statement: `Verified ${a.human_id} against the test suite`,
      evidence: [{ type: "test", ref: `payments.test.ts::${a.human_id}` }, { type: "commit", ref: "sha-verify" }],
      links: [{ assertion: a.human_id, relation: "supports" }],
    } });
  }
  console.log("Checker wrote supporting facts for 3 assertions.\n");

  // 6. Checker observes reality contradicting PAY-API-006 (PCI logging) -> drift.
  const fact = await api("POST", `/projects/${pid}/facts`, { token: checker.token, body: {
    key: "observed.PAY-API-006", value: false, statement: "Full card numbers appear in the charge-service debug logs",
    evidence: [{ type: "file", ref: "services/charge/logger.ts:88" }, { type: "commit", ref: "sha-bad" }],
    links: [{ assertion: "PAY-API-006", relation: "contradicts" }],
  } });
  console.log(`Checker filed a contradiction against PAY-API-006 -> drift ${fact.driftsCreated[0].slice(0, 8)} (assertion now drifted).`);

  // 7. Operator resolves the drift: reality is wrong -> fix (spawns a task).
  const resolved = await api("POST", `/projects/${pid}/drifts/${fact.driftsCreated[0]}/resolve`, { token: opTok, body: { choice: "fix", rationale: "Real leak — must scrub PAN from logs before release" } });
  console.log(`Priya resolved it: fix -> task ${resolved.taskId.slice(0, 8)} spawned; decision recorded.\n`);

  // 8. A milestone groups the release scope.
  const ms = await api("POST", `/projects/${pid}/milestones`, { token: opTok, body: { title: "v1 launch", target_date: "2026-08-15", assertions: ["PAY-API-001", "PAY-API-002", "PAY-API-003", "PAY-API-004", "PAY-API-005", "PAY-API-006"] } });

  // 9. Someone challenges the fix decision; operator upholds it.
  const decisions = await api("GET", `/projects/${pid}/decisions`, { token: opTok });
  const fixDecision = decisions.decisions.find((d: Json) => d.choice === "fix");
  const challenge = await api("POST", `/projects/${pid}/decisions/${fixDecision.id}/challenges`, { token: checker.token, body: { rationale: "Could we accept it for v1 and scrub in v1.1?", cites: ["PAY-API-006"] } });
  await api("POST", `/projects/${pid}/challenges/${challenge.challenge.id}/resolve`, { token: opTok, body: { choice: "uphold", rationale: "PCI is a launch blocker, not deferrable" } });
  console.log("checker-bot challenged the fix; Priya upheld it. Both recorded.\n");

  // ---- Render the resulting project state ----
  console.log("========================================================");
  console.log(`  STATE OF PROJECT: ${created.project.name}`);
  console.log("========================================================\n");

  const spec = await api("GET", `/projects/${pid}/specs/api`, { token: opTok });
  console.log("SPEC — intent and its live status:");
  for (const a of spec.assertions) console.log(`  ${a.humanId}  ${a.status.padEnd(12)} ${a.title}`);

  const roadmap = await api("GET", `/projects/${pid}/milestones`, { token: opTok });
  console.log("\nROADMAP — computed from verified facts:");
  for (const m of roadmap.milestones) console.log(`  ${m.title.padEnd(12)} ${bar(m.progress.verified, m.progress.total)}  (due ${m.targetDate})`);

  const triage = await api("GET", `/projects/${pid}/queue/triage`, { token: opTok });
  console.log(`\nTRIAGE QUEUE — open drifts: ${triage.drifts.length}, open challenges: ${triage.challenges.length}`);

  const cq = await api("GET", `/projects/${pid}/queue/checker?stale_days=7`, { token: opTok });
  console.log(`CHECKER QUEUE — still needing a fresh verifying fact: ${cq.assertions.length}`);
  for (const a of cq.assertions) console.log(`    ${a.human_id} (${a.status})`);

  const log = await api("GET", `/projects/${pid}/decisions`, { token: opTok });
  console.log(`\nDECISION LOG — the "why is it like this" trail (${log.decisions.length}):`);
  for (const d of log.decisions) console.log(`    ${d.onType}/${d.choice.padEnd(9)} — ${d.rationale}`);

  const tasks = await api("GET", `/projects/${pid}/tasks`, { token: opTok });
  console.log(`\nOPEN WORK — tasks (${tasks.tasks.length}):`);
  for (const t of tasks.tasks) console.log(`    [${t.status}] ${t.title}`);

  console.log("\n========================================================");
  console.log("  Connect the UI to this seeded project:");
  console.log(`  URL:   ${BASE}`);
  console.log(`  Token: ${opTok}`);
  console.log(`  (project ${pid})`);
  console.log("========================================================\n");
}

main().catch((e) => {
  console.error("dogfood failed:", e.message);
  process.exit(1);
});
