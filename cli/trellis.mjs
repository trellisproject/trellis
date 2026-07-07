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
    case "status": return cmdStatus(cfg);
    default: fail(`unknown command "${cmd}" — try \`trellis help\``);
  }
}

main().catch((e) => fail(e.message));
