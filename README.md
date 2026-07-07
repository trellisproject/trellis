# Trellis

Project & specification management for agent-driven development. Specs are structured intent, facts are observed reality with provenance, and drift — the gap between them — is a first-class object.

Product design, primitives, and the spec live in the [playbook](https://github.com/trellisproject/playbook). This repo is the server.

## Status

Phase 1 (server): route surface complete, 84 tests green. Implemented:

- Full database schema for all primitives.
- Spec-format parser + ingestion — atomic parse report, immutable ids, retire-on-absence, commit-idempotent (TRL-API-009/014, TRL-CORE-021).
- Auth: bearer-token middleware, principal-from-token, member/operator/delegation gates, bootstrap token on project create.
- Facts with mandatory provenance + automatic drift filing; checker + triage work queues.
- Drift resolution (fix/amend/accept) with decisions + status restoration; challenges (file + uphold/supersede); contradiction drift between two assertions.
- Tasks (claim/checkpoint/handoff, optimistic concurrency); milestones with computed progress + decision-gated scope/date changes.
- GitHub webhook (signed) — merged PR trailers land facts + agreed→implemented.

Not yet built: human session auth (OAuth/magic link — humans use bearer tokens for now); Neon provisioning; Vercel deploy; CLI + MCP adapters; UI.

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
