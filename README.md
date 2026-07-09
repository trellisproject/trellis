# Trellis

Project & specification management for agent-driven development. Specs are structured intent, facts are observed reality with provenance, and drift — the gap between them — is a first-class object.

Product design, primitives, and the spec live in the [playbook](https://github.com/trellisproject/playbook). This repo is the server.

## Status

Phase 1 (server) + CLI adapter: deployed to production, 161 tests green. Implemented:

- Full database schema for all primitives.
- Spec-format parser + ingestion — atomic parse report, immutable ids, retire-on-absence, commit-idempotent (TRL-API-009/014, TRL-CORE-021).
- Auth: bearer-token middleware, principal-from-token, member/operator/delegation gates, bootstrap token on project create.
- Facts with mandatory provenance + automatic drift filing; checker + triage work queues.
- Drift resolution (fix/amend/accept) with decisions + status restoration; challenges (file + uphold/supersede); contradiction drift between two assertions.
- Tasks (claim/checkpoint/handoff, optimistic concurrency); milestones with computed progress + decision-gated scope/date changes.
- GitHub webhook (signed) — merged PR trailers land facts + agreed→implemented.
- CLI adapter (`cli/trellis.mjs`) — thin, zero-dependency client over the API (join, worklist, fact, drift/resolve, tasks, efforts, ingest/export). See **[Using Trellis](#using-trellis-in-a-project)** below.

Not yet built: MCP adapter; UI; human session auth (OAuth/magic link — bearer tokens for now).

## Using Trellis in a project

An operator sets a project up once; agents and CI then report reality against it. The CLI is a thin client over the HTTP API — anything it does, the API does directly.

### Install the CLI

```sh
git clone https://github.com/trellisproject/trellis && cd trellis && npm install && npm link
# `trellis` is now on your PATH. (Not yet published to npm; `npm link` symlinks the local bin.)
# No link? Invoke by path: node /path/to/trellis/cli/trellis.mjs <cmd>
```

### Set up a project (operator, once)

```sh
export TRELLIS_URL=https://trellis-sepia-omega.vercel.app
# Create the project — returns an operator token + join code, SHOWN ONCE.
curl -sS -X POST "$TRELLIS_URL/projects" -H 'content-type: application/json' \
  -d '{"name":"my-project","operator":{"displayName":"You"}}'
```

Store the operator token safely (a gitignored `.env`; never commit it). Import your spec (spec-format markdown — see [playbook `docs/spec-format.md`](https://github.com/trellisproject/playbook/blob/main/docs/spec-format.md)) with `trellis ingest <slug> <file>`, and wire the automated loop — PR-trailer webhook, ingest CI, session hook — per [playbook `docs/checker.md` → "Wiring the full loop"](https://github.com/trellisproject/playbook/blob/main/docs/checker.md#wiring-the-full-loop).

### Wire a repo

Add `.trellis.json` at the repo root, and gitignore `.trellis/` (it caches the token):

```json
{
  "url": "https://trellis-sepia-omega.vercel.app",
  "project": "<project-id>",
  "joinCode": "join_…",
  "name": "my-checker"
}
```

Then paste the [drop-in snippet](#drop-in-claudemd-snippet) below into the repo's `CLAUDE.md`.

### The agent loop

| goal | command |
| --- | --- |
| first run — get a token | `trellis join` (or set `$TRELLIS_TOKEN`) |
| see what needs doing | `trellis worklist` |
| inspect one assertion | `trellis show <ID>` |
| you satisfied an assertion | `trellis fact --statement "…" --supports <ID> --evidence commit:$(git rev-parse HEAD)` |
| reality diverged from intent | `trellis fact --statement "…" --contradicts <ID> --evidence …`  (files drift) |
| triage / resolve a drift | `trellis drifts`, then `trellis resolve <driftId> --fix\|--amend\|--accept --why "…"` |
| every command | `trellis help` |

Two rules: never set an assertion to `verified` by hand — only a fact does that; and evidence is mandatory on every fact (a commit, test, file, or URL). You can skip the CLI for facts entirely by putting `Trellis: <ID>` in a PR body — merging writes the implementation fact automatically.

### Drop-in `CLAUDE.md` snippet

Paste into any repo wired to Trellis so agents know the workflow:

> **Trellis.** This project's intent — specs, assertions, and drift — lives in Trellis (config: `.trellis.json`). Run `trellis worklist` to see what needs building, verifying, or deciding. When you finish work that satisfies an assertion, record it: `trellis fact --statement "…" --supports <ID> --evidence commit:$(git rev-parse HEAD)`. If you observe reality diverging from an assertion, file drift with `--contradicts <ID>`. First run with no token: `trellis join`. Never mark an assertion `verified` by hand — only a fact does. `trellis help` lists every command.

## Stack

Hono · Drizzle ORM · Postgres (Neon in prod) · Zod · Vitest. Node 20+.

## Develop

```sh
npm install
cp .env.example .env          # set DATABASE_URL
npm run db:generate           # generate SQL migrations
npm run db:migrate            # apply to the database
npm run dev                   # start on :8787
npm run typecheck && npm test
```

## Testing

Standard: everything we build ships with automated tests when possible. Pure logic gets unit tests; DB and route behavior get integration tests against a real Postgres — no mocks.

```sh
npm run db:up                 # test DB needs the local container running
npm test                      # provisions + migrates trellis_test, then runs
```

`test/global-setup.ts` creates and migrates a dedicated `trellis_test` database (separate from dev data); tables truncate between tests. Vitest's env override makes the test DB authoritative, so tests can never touch the dev database.

## Layout

```
src/
  db/schema.ts       all tables, derived from the playbook primitives
  db/index.ts        postgres connection
  lib/spec-parse.ts  spec-format markdown parser (pure)
  lib/ingest.ts      ingest + reconcile into the DB
  routes/            Hono route groups
  app.ts index.ts    app assembly + server entry
```
