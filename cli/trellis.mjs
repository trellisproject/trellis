#!/usr/bin/env node
// Trellis CLI — a thin, zero-dependency client over the HTTP API. Lets an agent
// or CI job join a project and report reality (facts, measurements) so the
// server can verify intent or file drift.
//
//   trellis join                 self-join with the code in .trellis.json
//   trellis check                run the metric checks in config, post each
//   trellis measure <key> <n>    post one metric measurement
//   trellis fact --statement ..  post a general fact (--supports/--contradicts)
//   trellis worklist [--effort]  print the worklist
//   trellis status               project + efforts summary
//
// Config: .trellis.json in the cwd (or $TRELLIS_CONFIG):
//   { "url", "project", "joinCode", "name"?, "checks"?: { "<metricKey>": "<command>" } }
// Auth: $TRELLIS_TOKEN (best for CI) > cached .trellis/token.json > join.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

function fail(msg) { console.error(`trellis: ${msg}`); process.exit(1); }

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) { flags[key] = true; }
      else { (flags[key] ??= []); if (!Array.isArray(flags[key])) flags[key] = [flags[key]]; flags[key].push(next); i++; }
    } else positional.push(a);
  }
  // collapse single-value flags
  for (const k of Object.keys(flags)) if (Array.isArray(flags[k]) && flags[k].length === 1) flags[k] = flags[k][0];
  return { positional, flags };
}

function loadConfig(flags) {
  const path = flags.config || process.env.TRELLIS_CONFIG || ".trellis.json";
  if (!existsSync(path)) fail(`no config at ${path} — create a .trellis.json with { url, project, joinCode }`);
  const cfg = JSON.parse(readFileSync(path, "utf8"));
  if (!cfg.url || !cfg.project) fail("config must include url and project");
  return cfg;
}

const tokenCachePath = () => resolve(".trellis/token.json");
function cachedToken(project) {
  const p = tokenCachePath();
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8"))[project] ?? null; } catch { return null; }
}
function cacheToken(project, token) {
  mkdirSync(resolve(".trellis"), { recursive: true });
  const p = tokenCachePath();
  const all = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {};
  all[project] = token;
  writeFileSync(p, JSON.stringify(all, null, 2));
}

async function api(cfg, method, path, body, token) {
  const res = await fetch(`${cfg.url}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) fail(`${method} ${path} -> ${res.status} ${json.error || text}`);
  return json;
}

async function resolveToken(cfg, { allowJoin = true, name } = {}) {
  if (process.env.TRELLIS_TOKEN) return process.env.TRELLIS_TOKEN;
  const cached = cachedToken(cfg.project);
  if (cached) return cached;
  if (!allowJoin) fail("no token — set $TRELLIS_TOKEN or run `trellis join`");
  if (!cfg.joinCode) fail("no token and no joinCode in config — set $TRELLIS_TOKEN");
  const r = await api(cfg, "POST", `/projects/${cfg.project}/join`, { code: cfg.joinCode, displayName: name || cfg.name || "checker", kind: "agent" });
  cacheToken(cfg.project, r.token);
  return r.token;
}

function gitCommit() {
  try { return execSync("git rev-parse HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; }
}

// Parse a check command's stdout into a number: JSON {value} or a bare number.
function parseMeasurement(stdout) {
  const trimmed = stdout.trim();
  try { const j = JSON.parse(trimmed); if (typeof j === "number") return j; if (j && typeof j.value === "number") return j.value; } catch { }
  const last = trimmed.split("\n").filter(Boolean).pop() ?? "";
  const n = Number.parseFloat(last);
  if (Number.isNaN(n)) fail(`could not parse a number from check output: "${trimmed.slice(0, 120)}"`);
  return n;
}

async function cmdJoin(cfg, flags) {
  if (process.env.TRELLIS_TOKEN) { console.log("using $TRELLIS_TOKEN"); return; }
  const token = await resolveToken(cfg, { name: flags.name });
  console.log(`joined ${cfg.project} as member; token cached in .trellis/token.json`);
  void token;
}

async function cmdMeasure(cfg, positional, flags) {
  const [, key, value] = positional;
  if (!key || value === undefined) fail("usage: trellis measure <metricKey> <value>");
  const token = await resolveToken(cfg, { name: flags.name });
  const commit = gitCommit();
  const evidence = [{ type: "commit", ref: commit || "local" }];
  const r = await api(cfg, "POST", `/projects/${cfg.project}/facts`, {
    key: `measure.${key}`, value: Number(value),
    statement: flags.statement || `${key}: ${value}`,
    evidence, metric_key: key, measured_value: Number(value),
  }, token);
  const outcome = r.verified?.length ? "on target ✓" : r.driftsCreated?.length ? "BELOW target — drift filed" : "recorded";
  console.log(`${key} = ${value} → ${outcome}`);
}

async function cmdCheck(cfg, flags) {
  const checks = cfg.checks || {};
  const keys = Object.keys(checks);
  if (keys.length === 0) fail("no checks in config — add a `checks` map of { metricKey: command }");
  const token = await resolveToken(cfg, { name: flags.name });
  const commit = gitCommit();
  let drifted = 0;
  for (const key of keys) {
    const cmd = checks[key];
    process.stdout.write(`• ${key}: running \`${cmd}\` … `);
    let out;
    try { out = execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }); }
    catch (e) { fail(`check command failed for ${key}: ${e.message}`); }
    const value = parseMeasurement(out);
    const r = await api(cfg, "POST", `/projects/${cfg.project}/facts`, {
      key: `measure.${key}`, value, statement: `${key}: ${value}`,
      evidence: [{ type: "commit", ref: commit || "local" }, { type: "test", ref: cmd }],
      metric_key: key, measured_value: value,
    }, token);
    const status = r.verified?.length ? "on target ✓" : r.driftsCreated?.length ? "BELOW ✗" : "recorded";
    if (r.driftsCreated?.length) drifted++;
    console.log(`${value} (${status})`);
  }
  console.log(`\n${keys.length} checked, ${drifted} below target.`);
  if (drifted > 0) process.exitCode = 1; // fail CI when a metric is off target
}

async function cmdFact(cfg, flags) {
  if (!flags.statement) fail("usage: trellis fact --statement <text> [--supports A | --contradicts A] [--evidence type:ref ...]");
  const token = await resolveToken(cfg, { name: flags.name });
  const ev = [].concat(flags.evidence || []).map((e) => { const [type, ...r] = String(e).split(":"); return { type, ref: r.join(":") }; });
  if (ev.length === 0) ev.push({ type: "commit", ref: gitCommit() || "local" });
  const links = [];
  for (const a of [].concat(flags.supports || [])) links.push({ assertion: a, relation: "supports" });
  for (const a of [].concat(flags.contradicts || [])) links.push({ assertion: a, relation: "contradicts" });
  const r = await api(cfg, "POST", `/projects/${cfg.project}/facts`, {
    key: flags.key || "observation", value: flags.value ?? true, statement: flags.statement, evidence: ev, links,
  }, token);
  console.log(`fact ${r.fact.id.slice(0, 8)} recorded${r.verified?.length ? ` — verified ${r.verified.join(", ")}` : ""}${r.driftsCreated?.length ? ` — drift filed` : ""}`);
}

async function cmdWorklist(cfg, flags) {
  const token = await resolveToken(cfg, { allowJoin: true });
  const q = flags.effort ? `?effort=${flags.effort}` : "";
  const { buckets, counts } = await api(cfg, "GET", `/projects/${cfg.project}/worklist${q}`, null, token);
  for (const [bucket, items] of Object.entries(buckets)) {
    if (!items.length) continue;
    console.log(`\n${bucket.toUpperCase()} (${items.length})`);
    for (const i of items) console.log(`  [${i.priority}] ${i.ref}: ${i.title.slice(0, 70)} → ${i.action}`);
  }
  console.log(`\ntotal: ${Object.values(counts).reduce((a, b) => a + b, 0)}`);
}

// Write the git mirror: pull each spec's markdown and write it to <dir>/<slug>.md.
async function cmdExport(cfg, flags) {
  const dir = flags.dir || "specs";
  const token = await resolveToken(cfg, { allowJoin: true });
  const { specs } = await api(cfg, "GET", `/projects/${cfg.project}/specs`, null, token);
  mkdirSync(resolve(dir), { recursive: true });
  for (const s of specs) {
    const res = await fetch(`${cfg.url}/projects/${cfg.project}/specs/${s.slug}/export`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) fail(`export ${s.slug} -> ${res.status}`);
    const md = await res.text();
    writeFileSync(resolve(dir, `${s.slug}.md`), md);
    console.log(`wrote ${dir}/${s.slug}.md`);
  }
  console.log(`\n${specs.length} spec(s) mirrored to ${dir}/`);
}

// Import a spec-format markdown file into Trellis (bootstrap / absorb edits).
async function cmdIngest(cfg, positional, flags) {
  const [, slug, file] = positional;
  if (!slug || !file) fail("usage: trellis ingest <slug> <file>");
  const token = await resolveToken(cfg, { name: flags.name });
  const source = readFileSync(file, "utf8");
  const r = await api(cfg, "POST", `/projects/${cfg.project}/specs/ingest`, { slug, source, commit: gitCommit() }, token);
  if (!r.ok) fail(`ingest rejected: ${r.errors.map((e) => `L${e.line} ${e.message}`).join("; ")}`);
  console.log(`ingested ${slug}: ${r.created.length} created, ${r.statementsUpdated.length} updated, ${r.retired.length} retired`);
}

// Author intent: create a spec, or list one's assertions.
async function cmdSpec(cfg, positional, flags) {
  const token = await resolveToken(cfg, { name: flags.name });
  if (positional[1] === "new") {
    const slug = positional[2];
    if (!slug || typeof flags.title !== "string" || typeof flags.code !== "string") fail("usage: trellis spec new <slug> --title T --code CODE");
    const r = await api(cfg, "POST", `/projects/${cfg.project}/specs`, { slug, title: flags.title, code: flags.code }, token);
    console.log(`created spec ${r.spec.slug} (${r.spec.code})`);
    return;
  }
  const slug = positional[1];
  if (!slug) fail("usage: trellis spec <slug> | trellis spec new <slug> --title T --code CODE");
  const { spec, assertions } = await api(cfg, "GET", `/projects/${cfg.project}/specs/${slug}`, null, token);
  console.log(`${spec.title} — ${assertions.length} assertions`);
  for (const a of assertions) console.log(`  ${a.humanId}  [${a.status}]  ${a.title}`);
}

// Author intent: add or edit an assertion. --metric "key >= 95%" sets a metric;
// on edit, --metric "" clears it, omitting it leaves it unchanged.
async function cmdAssert(cfg, positional, flags) {
  const token = await resolveToken(cfg, { name: flags.name });
  const sub = positional[1];
  if (sub === "add") {
    const slug = positional[2];
    if (!slug || typeof flags.title !== "string" || typeof flags.statement !== "string") fail("usage: trellis assert add <slug> --title T --statement S [--metric 'key >= 95%']");
    const body = { title: flags.title, statement: flags.statement };
    if (typeof flags.metric === "string") body.metric = flags.metric;
    const r = await api(cfg, "POST", `/projects/${cfg.project}/specs/${slug}/assertions`, body, token);
    console.log(`added ${r.assertion.humanId}: ${r.assertion.title}`);
  } else if (sub === "edit") {
    const hid = positional[2];
    if (!hid) fail("usage: trellis assert edit <humanId> [--title T] [--statement S] [--metric 'expr'|'']");
    const body = {};
    if (typeof flags.title === "string") body.title = flags.title;
    if (typeof flags.statement === "string") body.statement = flags.statement;
    if (flags.metric !== undefined) body.metric = flags.metric === true ? null : flags.metric; // --metric "" clears
    if (Object.keys(body).length === 0) fail("nothing to edit — pass --title / --statement / --metric");
    const r = await api(cfg, "PATCH", `/projects/${cfg.project}/assertions/${hid}`, body, token);
    console.log(`edited ${r.assertion.humanId} (v${r.assertion.version})`);
  } else fail("usage: trellis assert add <slug> ... | trellis assert edit <humanId> ...");
}

// A decision: agree or retire an assertion (rationale is the record).
async function cmdDecide(cfg, verb, positional, flags) {
  const hid = positional[1];
  const why = flags.why ?? flags.rationale;
  if (!hid || typeof why !== "string") fail(`usage: trellis ${verb} <humanId> --why "reason"`);
  await api(cfg, "POST", `/projects/${cfg.project}/assertions/${hid}/${verb}`, { rationale: why }, await resolveToken(cfg, { name: flags.name }));
  console.log(`${verb === "agree" ? "agreed" : "retired"} ${hid}`);
}

// List open drifts (the Decide bucket) with their ids for `trellis resolve`.
async function cmdDrifts(cfg, flags) {
  const token = await resolveToken(cfg, { allowJoin: true });
  const { buckets } = await api(cfg, "GET", `/projects/${cfg.project}/worklist`, null, token);
  const drifts = (buckets.decide || []).filter((i) => i.kind === "drift");
  if (!drifts.length) { console.log("no open drifts"); return; }
  for (const d of drifts) console.log(`  ${d.id}  ${d.ref}  ${d.title.slice(0, 70)}`);
}

// A decision: resolve a drift by fix (code wrong, files a task), amend (intent
// wrong, retires the assertion), or accept (tolerate the divergence).
async function cmdResolve(cfg, positional, flags) {
  const did = positional[1];
  const choice = flags.amend ? "amend" : flags.fix ? "fix" : flags.accept ? "accept" : null;
  const why = flags.why ?? flags.rationale;
  if (!did || !choice || typeof why !== "string") fail('usage: trellis resolve <driftId> --amend|--fix|--accept --why "reason"');
  const r = await api(cfg, "POST", `/projects/${cfg.project}/drifts/${did}/resolve`, { choice, rationale: why }, await resolveToken(cfg, { name: flags.name }));
  console.log(`resolved ${did.slice(0, 8)} as ${choice} → assertion ${r.assertionStatus}${r.taskId ? ` (task ${r.taskId.slice(0, 8)})` : ""}`);
}

// Read: an assertion's statement, status, facts, and open drifts.
async function cmdShow(cfg, positional, flags) {
  const hid = positional[1];
  if (!hid) fail("usage: trellis show <humanId>");
  const token = await resolveToken(cfg, { allowJoin: true });
  const d = await api(cfg, "GET", `/projects/${cfg.project}/assertions/${hid}`, null, token);
  const a = d.assertion;
  console.log(`${a.humanId}  [${a.status}]  ${a.title}\n\n${a.statement}\n`);
  if (d.facts?.length) { console.log(`facts (${d.facts.length}):`); for (const f of d.facts) console.log(`  ${f.relation} — ${f.statement.slice(0, 80)}`); }
  const open = (d.drifts || []).filter((x) => x.status !== "resolved");
  if (open.length) { console.log(`open drifts:`); for (const dr of open) console.log(`  ${dr.id} — ${dr.summary}`); }
}

// Operator grants an agent scoped, reversible decision authority (the only
// sanctioned way for an agent to agree/retire/resolve). Needs an operator token.
async function cmdDelegate(cfg, positional, flags) {
  const agent = positional[1];
  if (!agent) fail('usage: trellis delegate <agentNameOrId> --classes assertion.agree,drift.resolve  (or --all)');
  const classes = flags.all ? ["*"] : String(flags.classes || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!classes.length) fail('need --classes "assertion.agree,assertion.retire,drift.resolve" (or --all)');
  const token = await resolveToken(cfg, { name: flags.name });
  const r = await api(cfg, "POST", `/projects/${cfg.project}/delegations`, { agent, classes, policy: flags.policy }, token);
  console.log(`delegated to ${r.delegation.agentName}: [${r.delegation.decisionClasses.join(", ")}]\n  id ${r.delegation.id}  (revoke with: trellis revoke-delegation ${r.delegation.id})`);
}

async function cmdDelegations(cfg) {
  const token = await resolveToken(cfg, { allowJoin: true });
  const { delegations } = await api(cfg, "GET", `/projects/${cfg.project}/delegations`, null, token);
  if (!delegations.length) return console.log("no delegations");
  for (const d of delegations) console.log(`  ${d.active ? "active " : "revoked"}  ${d.id}  ${d.agentName}  [${d.decisionClasses.join(", ")}]`);
}

async function cmdRevokeDelegation(cfg, positional, flags) {
  const id = positional[1];
  if (!id) fail("usage: trellis revoke-delegation <id>");
  await api(cfg, "POST", `/projects/${cfg.project}/delegations/${id}/revoke`, {}, await resolveToken(cfg, { name: flags.name }));
  console.log(`revoked delegation ${id}`);
}

async function cmdMembers(cfg) {
  const token = await resolveToken(cfg, { allowJoin: true });
  const { members } = await api(cfg, "GET", `/projects/${cfg.project}/members`, null, token);
  for (const m of members) console.log(`  ${m.principalId}  ${m.kind.padEnd(5)} ${m.role.padEnd(9)} ${m.name}`);
}

// Tasks — create, and drive an existing one:
//   trellis task "<title>" [--effort ID --owner ID --assertion HUMANID --desc T --priority P]
//   trellis task update <id> [--status --owner --effort --priority --title --desc]
//   trellis task done|claim <id>   ·   task checkpoint <id> --note "..."   ·   task handoff <id> --to <principalId>
async function cmdTask(cfg, positional, flags) {
  const token = await resolveToken(cfg, { name: flags.name });
  const P = cfg.project;
  const sub = positional[1];
  const SUBS = ["update", "done", "claim", "checkpoint", "handoff", "add"];

  if (SUBS.includes(sub) && sub !== "add") {
    const id = positional[2];
    if (!id) fail(`usage: trellis task ${sub} <taskId> ...`);
    if (sub === "done") { const r = await api(cfg, "PATCH", `/projects/${P}/tasks/${id}`, { status: "done" }, token); return console.log(`task ${id.slice(0, 8)} → done`); }
    if (sub === "claim") { const r = await api(cfg, "POST", `/projects/${P}/tasks/${id}/claim`, {}, token); return console.log(`claimed ${id.slice(0, 8)} (${r.task.status})`); }
    if (sub === "checkpoint") { if (typeof flags.note !== "string") fail('need --note "..."'); await api(cfg, "POST", `/projects/${P}/tasks/${id}/checkpoints`, { note: flags.note }, token); return console.log(`checkpointed ${id.slice(0, 8)}`); }
    if (sub === "handoff") { if (typeof flags.to !== "string") fail("need --to <principalId>"); await api(cfg, "POST", `/projects/${P}/tasks/${id}/handoff`, { to: flags.to }, token); return console.log(`handed off ${id.slice(0, 8)}`); }
    // update
    const body = {};
    if (typeof flags.status === "string") body.status = flags.status;
    if (typeof flags.title === "string") body.title = flags.title;
    if (typeof flags.desc === "string") body.description = flags.desc;
    if (typeof flags.priority === "string") body.priority = flags.priority;
    if (flags.owner !== undefined) body.owner_id = flags.owner === true ? null : flags.owner;
    if (flags.effort !== undefined) body.effort_id = flags.effort === true ? null : flags.effort;
    if (Object.keys(body).length === 0) fail("nothing to update — pass --status/--owner/--effort/--priority/--title/--desc");
    const r = await api(cfg, "PATCH", `/projects/${P}/tasks/${id}`, body, token);
    return console.log(`updated ${id.slice(0, 8)} → [${r.task.status}]`);
  }

  // create (bare `task "<title>"` or `task add "<title>"`)
  const title = (sub === "add" ? positional.slice(2) : positional.slice(1)).join(" ").trim() || (typeof flags.title === "string" ? flags.title : "");
  if (!title) fail('usage: trellis task "<title>" [opts]  |  trellis task update|done|claim|checkpoint|handoff <id> ...');
  const body = { title, description: typeof flags.desc === "string" ? flags.desc : undefined, effort_id: typeof flags.effort === "string" ? flags.effort : null, owner_id: typeof flags.owner === "string" ? flags.owner : null, priority: typeof flags.priority === "string" ? flags.priority : undefined };
  if (flags.assertion) body.assertions = [].concat(flags.assertion);
  const r = await api(cfg, "POST", `/projects/${P}/tasks`, body, token);
  console.log(`created ${r.task.id}  ${r.task.title}`);
}

async function cmdTasks(cfg, flags) {
  const token = await resolveToken(cfg, { allowJoin: true });
  const q = [];
  if (flags.status) q.push(`status=${flags.status}`);
  if (flags.owner) q.push(`owner=${flags.owner}`);
  const { tasks } = await api(cfg, "GET", `/projects/${cfg.project}/tasks${q.length ? "?" + q.join("&") : ""}`, null, token);
  if (!tasks.length) return console.log("no tasks");
  for (const t of tasks) console.log(`  ${t.id}  [${t.status}]  ${t.title}${t.effortTitle ? `  · ${t.effortTitle}` : ""}${t.ownerName ? `  @${t.ownerName}` : ""}`);
}

// Efforts (roadmap areas). new/update; status/owner/title/goal are fluid, but
// changing the date or assertion scope is a decision (needs --why, and an agent
// needs an effort.change delegation).
async function cmdEffort(cfg, positional, flags) {
  const token = await resolveToken(cfg, { name: flags.name });
  const P = cfg.project;
  const sub = positional[1];
  if (sub === "show") {
    const id = positional[2];
    if (!id) fail("usage: trellis effort show <id>");
    return printEffortDetail(await api(cfg, "GET", `/projects/${P}/efforts/${id}`, null, token));
  }
  if (sub === "update") {
    const id = positional[2];
    if (!id) fail('usage: trellis effort update <id> [--status s --owner ID --title T --goal g --target T --desc T] [--date YYYY-MM-DD --why R] [--commitment|--no-commitment] [--add HUMANID --why R] [--remove HUMANID --why R]');
    const body = {};
    if (typeof flags.status === "string") body.status = flags.status;
    if (typeof flags.title === "string") body.title = flags.title;
    if (typeof flags.desc === "string") body.description = flags.desc;
    if (typeof flags.description === "string") body.description = flags.description;
    if (typeof flags.goal === "string") body.goal_type = flags.goal;
    if (flags.target !== undefined) body.goal_target = flags.target === true ? null : flags.target;
    if (flags.owner !== undefined) body.owner_id = flags.owner === true ? null : flags.owner;
    if (flags.commitment) body.commitment = true;
    if (flags["no-commitment"]) body.commitment = false;
    if (flags.date !== undefined) body.target_date = flags.date === true ? null : flags.date;
    if (flags.add) body.add_assertions = [].concat(flags.add);
    if (flags.remove) body.remove_assertions = [].concat(flags.remove);
    if (typeof flags.why === "string") body.rationale = flags.why;
    if (Object.keys(body).length === 0) fail("nothing to update — pass --status/--owner/--title/--desc/--goal/--target/--date/--commitment/--add/--remove");
    await api(cfg, "PATCH", `/projects/${P}/efforts/${id}`, body, token);
    return console.log(`updated effort ${id.slice(0, 8)}`);
  }
  const title = (sub === "new" ? positional.slice(2) : positional.slice(1)).join(" ").trim() || (typeof flags.title === "string" ? flags.title : "");
  if (!title) fail('usage: trellis effort new "<title>" [--desc T --status s --owner ID --goal checklist|metric|open --target T --date YYYY-MM-DD --commitment --assertion HUMANID ...]');
  const body = {
    title, status: typeof flags.status === "string" ? flags.status : undefined,
    description: typeof flags.desc === "string" ? flags.desc : typeof flags.description === "string" ? flags.description : undefined,
    goal_type: typeof flags.goal === "string" ? flags.goal : undefined, goal_target: typeof flags.target === "string" ? flags.target : undefined,
    owner_id: typeof flags.owner === "string" ? flags.owner : null, target_date: typeof flags.date === "string" ? flags.date : null, commitment: !!flags.commitment,
  };
  if (flags.assertion) body.assertions = [].concat(flags.assertion);
  const r = await api(cfg, "POST", `/projects/${P}/efforts`, body, token);
  console.log(`created effort ${r.effort.id}  ${r.effort.title}`);
}

// Render the effort cockpit: header, description, assertions, tasks, recent decisions.
function printEffortDetail(d) {
  const e = d.effort;
  const goal = e.goalType === "metric" ? "metric" : e.goalType === "open" ? "open-ended" : "checklist";
  const owner = e.ownerName ? `  @${e.ownerName}` : "";
  const date = e.targetDate ? `  (target ${e.targetDate}${e.dueSoon ? `, due ${e.dueInDays}d` : ""})` : "";
  const commit = e.commitment ? "  ⚑ committed" : "";
  console.log(`${e.title}  [${e.status}]${owner}${date}${commit}`);
  console.log(`goal: ${goal}${e.goalTarget ? ` (${e.goalTarget})` : ""}  ·  progress ${e.progress.verified}/${e.progress.total}`);
  if (e.description) console.log(`\n${e.description}`);
  const asserts = d.assertions ?? [];
  console.log(`\nassertions (${asserts.length}):`);
  for (const a of asserts) console.log(`  ${a.humanId}  [${a.status}]  ${a.title}${a.latestValue != null ? `  = ${a.latestValue}` : ""}`);
  const tasks = d.tasks ?? [];
  if (tasks.length) { console.log(`\ntasks (${tasks.length}):`); for (const t of tasks) console.log(`  [${t.status}] ${t.priority ? `(${t.priority}) ` : ""}${t.title}${t.ownerName ? `  @${t.ownerName}` : ""}`); }
  const decisions = d.decisions ?? [];
  if (decisions.length) { console.log(`\nrecent decisions (${decisions.length}):`); for (const dec of decisions.slice(0, 5)) console.log(`  ${dec.choice} — ${(dec.rationale || "").slice(0, 80)}`); }
}

// The Map — hierarchical, spec-anchored flow diagrams (agent-authorable).
async function cmdMap(cfg, positional, flags) {
  const token = await resolveToken(cfg, { name: flags.name });
  const P = cfg.project;
  const sub = positional[1];
  if (!sub || sub === "list") {
    const { diagrams } = await api(cfg, "GET", `/projects/${P}/diagrams`, null, token);
    if (!diagrams.length) return console.log("no maps");
    for (const d of diagrams) console.log(`  ${d.id}  ${d.key}${d.isRoot ? "  (root)" : ""}  [${d.status}]  ${d.title}  ${d.nodeCount} nodes`);
    return;
  }
  if (sub === "new") {
    const title = flags.title || positional.slice(2).join(" ");
    if (!title) fail('usage: trellis map new "<title>" [--parent <nodeId>] [--dir TD|LR]');
    const body = { title };
    if (flags.parent) body.parent_node_id = flags.parent;
    if (flags.dir) body.direction = flags.dir;
    const { diagram } = await api(cfg, "POST", `/projects/${P}/diagrams`, body, token);
    console.log(`created ${diagram.id}  key=${diagram.key}`);
    return;
  }
  if (sub === "show") {
    const key = positional[2];
    if (!key) fail("usage: trellis map show <key>");
    const d = await api(cfg, "GET", `/projects/${P}/diagrams/${key}`, null, token);
    console.log(`# ${d.diagram.title}  (key=${d.diagram.key}, id=${d.diagram.id}, ${d.diagram.direction})`);
    console.log("nodes:");
    for (const n of d.nodes) console.log(`  ${n.key}  <${n.kind}>  [${n.status}]  ${n.label}${n.childDiagramKey ? `  ⤵${n.childDiagramKey}` : ""}${n.assertionHumanId ? `  ~${n.assertionHumanId}` : ""}${n.effortTitle ? `  ~effort:${n.effortTitle}` : ""}${n.specTitle ? `  ~spec:${n.specTitle}` : ""}`);
    console.log("edges:");
    for (const e of d.edges) console.log(`  ${e.fromKey} -${e.label ? `[${e.label}]` : ""}-> ${e.toKey}`);
    return;
  }
  if (sub === "node") {
    const did = positional[2];
    const label = positional[3] || flags.label;
    if (!did || !label) fail('usage: trellis map node <diagramId> "<label>" [--kind step|decision|trigger|terminal|subflow --effort <id> --assert <humanId> --key <k>]');
    const body = { label };
    if (flags.kind) body.kind = flags.kind;
    if (flags.effort) body.effort_id = flags.effort;
    if (flags.assert) body.assertion = flags.assert;
    if (flags.spec) body.spec = flags.spec;
    if (flags.key) body.key = flags.key;
    const { node } = await api(cfg, "POST", `/projects/${P}/diagrams/${did}/nodes`, body, token);
    console.log(`node ${node.id}  key=${node.key}`);
    return;
  }
  if (sub === "edge") {
    const [, , did, from, to] = positional;
    if (!did || !from || !to) fail("usage: trellis map edge <diagramId> <fromKey> <toKey> [--label <trigger>]");
    const body = { from, to };
    if (typeof flags.label === "string") body.label = flags.label;
    await api(cfg, "POST", `/projects/${P}/diagrams/${did}/edges`, body, token);
    console.log("edge added");
    return;
  }
  fail("usage: trellis map [list | new | show <key> | node <diagramId> <label> | edge <diagramId> <from> <to>]");
}

async function cmdEfforts(cfg) {
  const token = await resolveToken(cfg, { allowJoin: true });
  const { efforts } = await api(cfg, "GET", `/projects/${cfg.project}/efforts`, null, token);
  if (!efforts.length) return console.log("no efforts");
  for (const e of efforts) {
    const due = e.dueSoon && e.dueInDays != null ? `  ⏰ due ${e.dueInDays}d` : e.targetDate ? `  (${e.targetDate})` : "";
    console.log(`  ${e.id}  [${e.status}]  ${e.title}${e.ownerName ? `  @${e.ownerName}` : ""}${due}  ${e.progress.verified}/${e.progress.total}`);
  }
}

async function cmdStatus(cfg) {
  const token = await resolveToken(cfg, { allowJoin: true });
  const efforts = (await api(cfg, "GET", `/projects/${cfg.project}/efforts`, null, token)).efforts;
  console.log(`project ${cfg.project} · ${efforts.length} efforts`);
  for (const e of efforts) {
    const goal = e.goalType === "metric" ? `${e.progress.verified}/${e.progress.total} metrics on target` : e.goalType === "open" ? "open-ended" : `${e.progress.verified}/${e.progress.total} verified`;
    console.log(`  [${e.status}] ${e.title} — ${goal}`);
  }
}

const HELP = `trellis — report reality to a Trellis project

  trellis join [--name NAME]           self-join with the code in .trellis.json
  trellis check                        run config metric checks, post each fact
  trellis measure <key> <value>        post one metric measurement
  trellis fact --statement T [--supports A|--contradicts A] [--evidence t:r]
  trellis worklist [--effort ID]       print the worklist
  trellis export [--dir specs]         write the git mirror (spec markdown)
  trellis ingest <slug> <file>         import a spec-format markdown file
  trellis spec new <slug> --title T --code CODE    create a spec
  trellis spec <slug>                  list a spec's assertions
  trellis assert add <slug> --title T --statement S [--metric 'k >= 95%']
  trellis assert edit <humanId> [--statement S] [--metric 'expr'|'']
  trellis agree <humanId> --why R      proposed → agreed
  trellis retire <humanId> --why R     retire an assertion
  trellis drifts                       open drifts (the Decide bucket)
  trellis resolve <driftId> --amend|--fix|--accept --why R
  trellis effort new "<title>" [--desc T --status s --owner ID --goal g --target T --date YYYY-MM-DD --commitment --assertion HUMANID]
  trellis effort update <id> [--status --owner --title --desc --goal --target] [--date D --why R] [--commitment|--no-commitment] [--add/--remove HUMANID --why R]
  trellis effort show <id>             effort detail — description, assertions, tasks, decisions
  trellis efforts                      list efforts (roadmap)
  trellis task "<title>" [--effort ID] [--owner ID] [--assertion HUMANID] [--desc T] [--priority now|normal|later]
  trellis task update <id> [--status s] [--owner ID] [--effort ID] [--priority p] [--title T] [--desc T]
  trellis task done|claim <id>   ·   task checkpoint <id> --note "..."   ·   task handoff <id> --to <principalId>
  trellis tasks [--status open] [--owner ID]   list tasks
  trellis show <humanId>               statement, status, facts, drifts
  trellis members                      list project members (find an agent to delegate to)
  trellis delegate <agent> --classes assertion.agree,assertion.retire,drift.resolve   (operator; or --all)
  trellis delegations                  list delegations
  trellis revoke-delegation <id>       revoke a delegation (operator)
  trellis status                       efforts summary

config: .trellis.json { url, project, joinCode, name?, checks? }
auth:   $TRELLIS_TOKEN > cached .trellis/token.json > join`;

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const cmd = positional[0];
  if (!cmd || cmd === "help" || flags.help) { console.log(HELP); return; }
  const cfg = loadConfig(flags);
  switch (cmd) {
    case "join": return cmdJoin(cfg, flags);
    case "check": return cmdCheck(cfg, flags);
    case "measure": return cmdMeasure(cfg, positional, flags);
    case "fact": return cmdFact(cfg, flags);
    case "worklist": return cmdWorklist(cfg, flags);
    case "export": return cmdExport(cfg, flags);
    case "ingest": return cmdIngest(cfg, positional, flags);
    case "spec": return cmdSpec(cfg, positional, flags);
    case "assert": return cmdAssert(cfg, positional, flags);
    case "agree": return cmdDecide(cfg, "agree", positional, flags);
    case "retire": return cmdDecide(cfg, "retire", positional, flags);
    case "drifts": return cmdDrifts(cfg, flags);
    case "resolve": return cmdResolve(cfg, positional, flags);
    case "show": return cmdShow(cfg, positional, flags);
    case "effort": return cmdEffort(cfg, positional, flags);
    case "efforts": return cmdEfforts(cfg);
    case "map": return cmdMap(cfg, positional, flags);
    case "task": return cmdTask(cfg, positional, flags);
    case "tasks": return cmdTasks(cfg, flags);
    case "members": return cmdMembers(cfg);
    case "delegate": return cmdDelegate(cfg, positional, flags);
    case "delegations": return cmdDelegations(cfg);
    case "revoke-delegation": return cmdRevokeDelegation(cfg, positional, flags);
    case "status": return cmdStatus(cfg);
    default: fail(`unknown command "${cmd}" — try \`trellis help\``);
  }
}

main().catch((e) => fail(e.message));
