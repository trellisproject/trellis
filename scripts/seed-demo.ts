// Seed a rich, clickable demo project: verified/implemented/drifted assertions,
// a populated roadmap, facts, a decision + task, and — importantly — one OPEN
// drift and one OPEN challenge so the triage board has things to resolve.
//
//   npm run seed:demo

import { createHmac } from "node:crypto";

const BASE = process.env.TRELLIS_URL ?? "http://localhost:8787";
const hmacHex = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest("hex");

async function api(method: string, path: string, opts: { body?: any; token?: string; raw?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", ...(opts.headers ?? {}) };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: opts.raw ?? (opts.body ? JSON.stringify(opts.body) : undefined) });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return json;
}

const SPEC = `---
project: payments
spec: PAY-API
title: Payments API
---

# Payments API

### PAY-API-001: Idempotent charge creation
status: agreed

POST /charges accepts an Idempotency-Key and returns the original charge on retry.

### PAY-API-002: Amounts are integer minor units
status: agreed

All amounts are integer cents; the API rejects fractional amounts with 422.

### PAY-API-003: Refunds never exceed the captured amount
status: agreed

A refund greater than the remaining captured balance is rejected.

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

function pr(secret: string, title: string, trailer: string, sha: string, n: number) {
  const payload = JSON.stringify({ action: "closed", pull_request: { merged: true, title, body: `Implements it.\n\n${trailer}`, merge_commit_sha: sha, html_url: `https://github.com/acme/payments/pull/${n}`, number: n } });
  return { raw: payload, headers: { "X-GitHub-Event": "pull_request", "X-Hub-Signature-256": `sha256=${hmacHex(secret, payload)}` } };
}

async function main() {
  const created = await api("POST", "/projects", { body: { name: "Payments API", repos: ["github.com/acme/payments"], operator: { displayName: "Priya (lead)" } } });
  const pid = created.project.id;
  const tok = created.token;
  await api("POST", `/projects/${pid}/specs/ingest`, { token: tok, body: { slug: "api", source: SPEC, commit: "spec-c1" } });
  const checker = await api("POST", `/projects/${pid}/tokens`, { token: tok, body: { displayName: "checker-bot", kind: "agent" } });
  const wh = await api("POST", `/projects/${pid}/webhook`, { token: tok });

  // Merge PRs -> implemented.
  for (const [t, id, sha, n] of [["Idempotent charges", "PAY-API-001", "sha1", 11], ["Integer amounts", "PAY-API-002", "sha2", 12], ["Refund guard", "PAY-API-003", "sha3", 13], ["Signed webhooks", "PAY-API-004", "sha4", 14]] as [string, string, string, number][]) {
    const e = pr(wh.secret, t, `Trellis: ${id}`, sha, n);
    await api("POST", `/projects/${pid}/integrations/github/webhook`, { raw: e.raw, headers: e.headers });
  }

  // Checker verifies three -> verified.
  for (const id of ["PAY-API-001", "PAY-API-002", "PAY-API-005"]) {
    await api("POST", `/projects/${pid}/facts`, { token: checker.token, body: { key: `verify.${id}`, value: true, statement: `Verified ${id} against the test suite`, evidence: [{ type: "test", ref: `payments.test.ts::${id}` }, { type: "commit", ref: "sha-v" }], links: [{ assertion: id, relation: "supports" }] } });
  }

  // Drift A on PAY-API-003 -> resolve as fix (creates a decision + task).
  const driftA = await api("POST", `/projects/${pid}/facts`, { token: checker.token, body: { key: "obs.003", value: false, statement: "Refund endpoint allows over-refund when two requests race", evidence: [{ type: "file", ref: "services/refund/handler.ts:41" }, { type: "commit", ref: "sha-race" }], links: [{ assertion: "PAY-API-003", relation: "contradicts" }] } });
  const fix = await api("POST", `/projects/${pid}/drifts/${driftA.driftsCreated[0]}/resolve`, { token: tok, body: { choice: "fix", rationale: "Real race condition — needs a row lock on the captured balance" } });

  // Challenge the fix decision -> LEAVE OPEN (shows on triage).
  const decisions = await api("GET", `/projects/${pid}/decisions`, { token: tok });
  const fixDecision = decisions.decisions.find((d: any) => d.choice === "fix");
  await api("POST", `/projects/${pid}/decisions/${fixDecision.id}/challenges`, { token: checker.token, body: { rationale: "Could we ship a feature flag for v1 and land the lock in v1.1?", cites: ["PAY-API-003"] } });

  // Drift B on PAY-API-006 (PCI) -> LEAVE OPEN (shows on triage).
  await api("POST", `/projects/${pid}/facts`, { token: checker.token, body: { key: "obs.006", value: false, statement: "Full card numbers appear in the charge-service debug logs", evidence: [{ type: "file", ref: "services/charge/logger.ts:88" }, { type: "commit", ref: "sha-pci" }], links: [{ assertion: "PAY-API-006", relation: "contradicts" }] } });

  // Roadmap.
  await api("POST", `/projects/${pid}/milestones`, { token: tok, body: { title: "v1 launch", target_date: "2026-08-15", assertions: ["PAY-API-001", "PAY-API-002", "PAY-API-003", "PAY-API-004", "PAY-API-005", "PAY-API-006"] } });

  console.log(JSON.stringify({ url: BASE, project: pid, token: tok }, null, 2));
}

main().catch((e) => { console.error("seed failed:", e.message); process.exit(1); });
