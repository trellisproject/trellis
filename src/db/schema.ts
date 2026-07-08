import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  date,
  doublePrecision,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums modeled as text + CHECK-style app validation (kept as plain text so
// adding a lifecycle state is a migration-free code change during V1).
// ---------------------------------------------------------------------------

const id = () =>
  text("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`);

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).defaultNow().notNull();

// --- Projects & principals -------------------------------------------------

export const projects = pgTable("projects", {
  id: id(),
  name: text("name").notNull(),
  repos: jsonb("repos").$type<string[]>().default([]).notNull(),
  // TRL-CORE-034: rotatable code that self-provisions member access. Lives in
  // the repo's .trellis.json, so plaintext here is by design (repo access is
  // the boundary).
  joinCode: text("join_code"),
  webhookSecretHash: text("webhook_secret_hash"), // deprecated, unused
  // TRL-API-011: HMAC verification needs the shared secret itself (plaintext in
  // V1; envelope-encrypt in production).
  webhookSecret: text("webhook_secret"),
  // Facts derived from PR trailers are attributed to this integration agent
  // principal (TRL-CORE-016 requires a member observer).
  githubPrincipalId: text("github_principal_id"),
  createdAt: createdAt(),
});

// A principal is a human or an agent. Identity is global; capability is per
// project via memberships (TRL-CORE-016).
export const principals = pgTable("principals", {
  id: id(),
  kind: text("kind").$type<"human" | "agent">().notNull(),
  displayName: text("display_name").notNull(),
  email: text("email"), // humans only
  createdAt: createdAt(),
});

// TRL-API-012: every human membership carries a role. Agents are members with
// role 'member' and gain decision authority only via delegation (TRL-CORE-020).
export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    projectId: text("project_id")
      .references(() => projects.id)
      .notNull(),
    principalId: text("principal_id")
      .references(() => principals.id)
      .notNull(),
    role: text("role").$type<"operator" | "member">().notNull().default("member"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("membership_project_principal").on(t.projectId, t.principalId)],
);

// TRL-API-001: agent bearer tokens, stored as SHA-256 hash, revocable.
export const agentTokens = pgTable(
  "agent_tokens",
  {
    id: id(),
    projectId: text("project_id")
      .references(() => projects.id)
      .notNull(),
    principalId: text("principal_id")
      .references(() => principals.id)
      .notNull(),
    tokenHash: text("token_hash").notNull(),
    createdAt: createdAt(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("agent_token_hash").on(t.tokenHash)],
);

// TRL-CORE-020 / TRL-API-013: named standing policy authorizing an agent to
// make decisions of certain classes. Granted/revoked by operators only.
export const delegations = pgTable("delegations", {
  id: id(),
  projectId: text("project_id")
    .references(() => projects.id)
    .notNull(),
  agentPrincipalId: text("agent_principal_id")
    .references(() => principals.id)
    .notNull(),
  grantedById: text("granted_by_id")
    .references(() => principals.id)
    .notNull(),
  policy: text("policy").notNull(), // human-readable description
  decisionClasses: jsonb("decision_classes").$type<string[]>().notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

// --- Specs & assertions ----------------------------------------------------

export const specs = pgTable(
  "specs",
  {
    id: id(),
    projectId: text("project_id")
      .references(() => projects.id)
      .notNull(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    // The assertion-id prefix (e.g. "TRL-CORE"); assertions are <code>-<NNN>.
    // Set from frontmatter on import, or supplied when a spec is created in-app.
    code: text("code"),
    bodyMd: text("body_md").default("").notNull(),
    version: integer("version").notNull().default(1),
    // TRL-API-014: the git commit a spec's current statements were ingested from.
    lastIngestedCommit: text("last_ingested_commit"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("spec_project_slug").on(t.projectId, t.slug)],
);

export type AssertionStatus =
  | "proposed"
  | "agreed"
  | "implemented"
  | "verified"
  | "drifted"
  | "retired";

// TRL-CORE-002: humanId (e.g. "TRL-CORE-007") is immutable and unique per
// project; surrogate uuid is the FK target.
export const assertions = pgTable(
  "assertions",
  {
    id: id(),
    projectId: text("project_id")
      .references(() => projects.id)
      .notNull(),
    specId: text("spec_id")
      .references(() => specs.id)
      .notNull(),
    humanId: text("human_id").notNull(), // "TRL-CORE-007"
    title: text("title").notNull(),
    statement: text("statement").notNull(),
    status: text("status").$type<AssertionStatus>().notNull().default("proposed"),
    // status the assertion held before it was knocked to 'drifted', so
    // resolution can restore it (TRL-CORE-013).
    preDriftStatus: text("pre_drift_status").$type<AssertionStatus>(),
    orderInSpec: integer("order_in_spec").notNull().default(0),
    version: integer("version").notNull().default(1),
    // Metric assertions (TRL-CORE-038): a threshold the server evaluates
    // measurements against. Authored in the spec's `metric:` line.
    metricKey: text("metric_key"),
    metricComparator: text("metric_comparator").$type<"gte" | "gt" | "lte" | "lt" | "eq">(),
    metricTarget: doublePrecision("metric_target"),
    metricUnit: text("metric_unit"),
    supersedesId: text("supersedes_id"), // amend: retired assertion this replaces
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("assertion_project_humanid").on(t.projectId, t.humanId)],
);

export const assertionStatusHistory = pgTable("assertion_status_history", {
  id: id(),
  assertionId: text("assertion_id")
    .references(() => assertions.id)
    .notNull(),
  status: text("status").$type<AssertionStatus>().notNull(),
  byPrincipalId: text("by_principal_id").references(() => principals.id),
  decisionId: text("decision_id"), // set when the transition required a decision
  note: text("note"),
  at: createdAt(),
});

// --- Facts (append-only, TRL-CORE-007/008) ---------------------------------

export type EvidenceRef = { type: "commit" | "file" | "test" | "url"; ref: string };

export const facts = pgTable(
  "facts",
  {
    id: id(),
    projectId: text("project_id")
      .references(() => projects.id)
      .notNull(),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    statement: text("statement").notNull(),
    observerId: text("observer_id")
      .references(() => principals.id)
      .notNull(),
    evidence: jsonb("evidence").$type<EvidenceRef[]>().notNull(), // >=1 enforced in app
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    // Metric measurement (TRL-CORE-038): a value the server compares against
    // matching metric assertions to derive support/contradiction.
    metricKey: text("metric_key"),
    measuredValue: doublePrecision("measured_value"),
    supersedesId: text("supersedes_id"),
    createdAt: createdAt(),
  },
  (t) => [index("fact_project_key").on(t.projectId, t.key)],
);

// Many-to-many: a fact supports or contradicts assertions. A 'contradicts'
// link is what triggers drift (TRL-CORE-010).
export const factLinks = pgTable(
  "fact_links",
  {
    id: id(),
    factId: text("fact_id")
      .references(() => facts.id)
      .notNull(),
    assertionId: text("assertion_id")
      .references(() => assertions.id)
      .notNull(),
    relation: text("relation").$type<"supports" | "contradicts">().notNull(),
  },
  (t) => [index("fact_link_assertion").on(t.assertionId)],
);

// --- Drift (TRL-CORE-010/011/025) ------------------------------------------

export const drifts = pgTable(
  "drifts",
  {
    id: id(),
    projectId: text("project_id")
      .references(() => projects.id)
      .notNull(),
    kind: text("kind").$type<"reality" | "contradiction">().notNull(),
    assertionId: text("assertion_id")
      .references(() => assertions.id)
      .notNull(),
    // second assertion for kind='contradiction' (TRL-CORE-025)
    assertionBId: text("assertion_b_id").references(() => assertions.id),
    status: text("status").$type<"detected" | "triaged" | "resolved">().notNull().default("detected"),
    priority: text("priority").$type<"now" | "normal" | "later">().notNull().default("normal"),
    summary: text("summary").notNull(),
    resolutionDecisionId: text("resolution_decision_id"),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("drift_project_status").on(t.projectId, t.status)],
);

export const driftContradictingFacts = pgTable("drift_contradicting_facts", {
  id: id(),
  driftId: text("drift_id")
    .references(() => drifts.id)
    .notNull(),
  factId: text("fact_id")
    .references(() => facts.id)
    .notNull(),
});

// --- Tasks (TRL-CORE-014/015) ----------------------------------------------

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    projectId: text("project_id")
      .references(() => projects.id)
      .notNull(),
    title: text("title").notNull(),
    description: text("description").default("").notNull(), // free-text detail (markdown)
    status: text("status")
      .$type<"open" | "claimed" | "in_progress" | "done" | "blocked">()
      .notNull()
      .default("open"),
    priority: text("priority").$type<"now" | "normal" | "later">().notNull().default("normal"),
    ownerId: text("owner_id").references(() => principals.id),
    driftId: text("drift_id").references(() => drifts.id),
    // A task belongs to an area (effort). Work — including standalone
    // operational tasks with no assertion — lives under an effort and inherits
    // its owner and deadline. Nullable: an unfiled task is still valid.
    effortId: text("effort_id").references(() => efforts.id),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("task_project_status").on(t.projectId, t.status)],
);

export const taskAssertions = pgTable("task_assertions", {
  id: id(),
  taskId: text("task_id")
    .references(() => tasks.id)
    .notNull(),
  assertionId: text("assertion_id")
    .references(() => assertions.id)
    .notNull(),
});

export const taskDependencies = pgTable("task_dependencies", {
  id: id(),
  taskId: text("task_id")
    .references(() => tasks.id)
    .notNull(),
  dependsOnTaskId: text("depends_on_task_id")
    .references(() => tasks.id)
    .notNull(),
});

export const taskCheckpoints = pgTable("task_checkpoints", {
  id: id(),
  taskId: text("task_id")
    .references(() => tasks.id)
    .notNull(),
  byPrincipalId: text("by_principal_id")
    .references(() => principals.id)
    .notNull(),
  note: text("note").notNull(),
  at: createdAt(),
});

// --- Decisions (append-only, TRL-CORE-018/019) -----------------------------

export const decisions = pgTable("decisions", {
  id: id(),
  projectId: text("project_id")
    .references(() => projects.id)
    .notNull(),
  actorId: text("actor_id")
    .references(() => principals.id)
    .notNull(),
  onType: text("on_type").$type<"assertion" | "drift" | "challenge" | "milestone" | "effort" | "request">().notNull(),
  onId: text("on_id").notNull(),
  choice: text("choice").notNull(), // agree|retire|amend|fix|accept|uphold|supersede|scope|date
  rationale: text("rationale").notNull(), // TRL-CORE-018: non-empty enforced in app
  alternatives: jsonb("alternatives").$type<string[]>().default([]).notNull(),
  delegatedById: text("delegated_by_id").references(() => delegations.id), // TRL-API-013
  supersedesId: text("supersedes_id"),
  at: createdAt(),
});

// --- Challenges (TRL-CORE-027/028/029) -------------------------------------

export const challenges = pgTable("challenges", {
  id: id(),
  projectId: text("project_id")
    .references(() => projects.id)
    .notNull(),
  onDecisionId: text("on_decision_id")
    .references(() => decisions.id)
    .notNull(),
  byPrincipalId: text("by_principal_id")
    .references(() => principals.id)
    .notNull(),
  rationale: text("rationale").notNull(),
  cites: jsonb("cites").$type<string[]>().default([]).notNull(),
  status: text("status").$type<"open" | "resolved">().notNull().default("open"),
  resolvedByDecisionId: text("resolved_by_decision_id").references(() => decisions.id),
  createdAt: createdAt(),
});

// --- Milestones (TRL-CORE-024) ---------------------------------------------

// Efforts (TRL-CORE-024/036/037) — the roadmap's focus stack. Physical table
// stays "milestones" (additive evolution); the concept is an Effort: an
// attention-ordered major effort with a goal, not a dated release.
export const efforts = pgTable("milestones", {
  id: id(),
  projectId: text("project_id")
    .references(() => projects.id)
    .notNull(),
  title: text("title").notNull(),
  description: text("description").default("").notNull(), // free-text detail (markdown)
  // Attention, not date: what you're on now vs later.
  status: text("status").$type<"active" | "next" | "someday" | "done">().notNull().default("next"),
  // How "done" is judged: a set of assertions, a metric threshold, or open-ended.
  goalType: text("goal_type").$type<"checklist" | "metric" | "open">().notNull().default("checklist"),
  goalTarget: text("goal_target"), // e.g. ">= 95% on ACORD-125" for a metric effort
  order: integer("order").notNull().default(0),
  // Ownership is at the area level: a person owns an effort (a chunk of product)
  // end to end. Work under it is implicitly theirs — no per-item assignment.
  ownerId: text("owner_id").references(() => principals.id),
  targetDate: date("target_date"), // optional; most efforts are attention-ordered, not dated
  // A dated effort marked a commitment is a client promise — it feeds attention
  // (surfaces ~a week ahead) rather than sitting in the someday pile.
  commitment: boolean("commitment").notNull().default(false),
  version: integer("version").notNull().default(1),
  createdAt: createdAt(),
});

export const effortAssertions = pgTable("milestone_assertions", {
  id: id(),
  effortId: text("milestone_id")
    .references(() => efforts.id)
    .notNull(),
  assertionId: text("assertion_id")
    .references(() => assertions.id)
    .notNull(),
});

// --- Requests (TRL-CORE-030..033) — captured asks, the origin of intent ----

export const requests = pgTable("requests", {
  id: id(),
  projectId: text("project_id")
    .references(() => projects.id)
    .notNull(),
  title: text("title").notNull(),
  body: text("body").default("").notNull(),
  requester: text("requester").notNull(), // who asked — "customer: Acme", a name, etc.
  source: text("source"), // email | slack | meeting | customer | ...
  status: text("status").$type<"new" | "accepted" | "declined">().notNull().default("new"),
  priority: text("priority").$type<"now" | "normal" | "later">().notNull().default("normal"),
  decisionId: text("decision_id"), // the accept/decline decision
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// Assertions derived from a request (TRL-CORE-032).
export const requestAssertions = pgTable("request_assertions", {
  id: id(),
  requestId: text("request_id")
    .references(() => requests.id)
    .notNull(),
  assertionId: text("assertion_id")
    .references(() => assertions.id)
    .notNull(),
});

// Supporting assets (designs, mockups, docs) attached to any object — an effort,
// assertion, or task — stored in Vercel Blob. targetId is that object's id.
export const attachments = pgTable(
  "attachments",
  {
    id: id(),
    projectId: text("project_id")
      .references(() => projects.id)
      .notNull(),
    targetType: text("target_type").$type<"effort" | "assertion" | "task">().notNull(),
    targetId: text("target_id").notNull(),
    filename: text("filename").notNull(),
    url: text("url").notNull(),
    contentType: text("content_type"),
    size: integer("size"),
    uploadedById: text("uploaded_by_id").references(() => principals.id),
    createdAt: createdAt(),
  },
  (t) => [index("attachment_target").on(t.projectId, t.targetType, t.targetId)],
);
