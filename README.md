# Trellis

Project & specification management for agent-driven development. Specs are structured intent, facts are observed reality with provenance, and drift — the gap between them — is a first-class object.

Product design, primitives, and the spec live in the [playbook](https://github.com/trellisproject/playbook). This repo is the server.

## Status

Phase 1 (server), early. Implemented so far:

- Full database schema for all primitives (projects, principals, memberships, tokens, delegations, specs, assertions, facts, drift, tasks, decisions, challenges, milestones).
- Spec-format parser (`src/lib/spec-parse.ts`) — the markdown assertion format from the playbook.
- Spec ingestion (`src/lib/ingest.ts`) — atomic parse report, immutable ids, retire-on-absence, commit-idempotent (TRL-API-009, TRL-API-014, TRL-CORE-021).
- Routes: project create/list/get with first operator, spec ingest + read.
- Tests: 16 across parser (unit), ingestion (integration), and routes (integration) — see Testing.

Not yet built: auth middleware, facts/drift/tasks/decisions/challenges/milestones routes, the two work-queue queries, GitHub webhook.

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
