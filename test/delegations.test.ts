import { beforeEach, describe, it, expect } from "vitest";
import { app } from "../src/app.js";
import { resetDb } from "./helpers/db.js";

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const get = (path: string, headers: Record<string, string> = {}) => app.request(path, { headers });

async function setup() {
  const p = (await (await post("/projects", { name: "p", operator: { displayName: "Op" } })).json()) as any;
  const op = { Authorization: `Bearer ${p.token}` };
  const j = (await (await post(`/projects/${p.project.id}/join`, { code: p.joinCode, displayName: "reconciler", kind: "agent" })).json()) as any;
  const agent = { Authorization: `Bearer ${j.token}` };
  await post(`/projects/${p.project.id}/specs`, { slug: "s", title: "S", code: "T" }, op);
  const mk = async () => ((await (await post(`/projects/${p.project.id}/specs/s/assertions`, { title: "t", statement: "must hold" }, op)).json()) as any).assertion.humanId;
  return { pid: p.project.id, op, agent, mk };
}

const agree = (pid: string, hid: string, headers: Record<string, string>) =>
  post(`/projects/${pid}/assertions/${hid}/agree`, { rationale: "reconciled" }, headers);

describe("delegations (TRL-API-013) — agents decide only under a granted, scoped delegation", () => {
  beforeEach(async () => { await resetDb(); });

  it("blocks an agent from agreeing with no delegation (403 DELEGATION_REQUIRED)", async () => {
    const { pid, agent, mk } = await setup();
    const res = await agree(pid, await mk(), agent);
    expect(res.status).toBe(403);
    expect((await res.json() as any).code).toBe("DELEGATION_REQUIRED");
  });

  it("lets the agent agree once an operator grants assertion.agree — no delegation id threaded", async () => {
    const { pid, op, agent, mk } = await setup();
    const g = await post(`/projects/${pid}/delegations`, { agent: "reconciler", classes: ["assertion.agree"] }, op);
    expect(g.status).toBe(201);
    expect((await g.json() as any).delegation.agentName).toBe("reconciler");
    const res = await agree(pid, await mk(), agent);
    expect(res.status).toBe(200);
  });

  it("scopes the delegation — assertion.agree does not authorize retire", async () => {
    const { pid, op, agent, mk } = await setup();
    await post(`/projects/${pid}/delegations`, { agent: "reconciler", classes: ["assertion.agree"] }, op);
    const hid = await mk();
    expect((await agree(pid, hid, agent)).status).toBe(200);
    const retire = await post(`/projects/${pid}/assertions/${hid}/retire`, { rationale: "x" }, agent);
    expect(retire.status).toBe(403);
  });

  it("'*' authorizes every decision class", async () => {
    const { pid, op, agent, mk } = await setup();
    await post(`/projects/${pid}/delegations`, { agent: "reconciler", classes: ["*"] }, op);
    const hid = await mk();
    expect((await agree(pid, hid, agent)).status).toBe(200);
    expect((await post(`/projects/${pid}/assertions/${hid}/retire`, { rationale: "x" }, agent)).status).toBe(200);
  });

  it("only an operator can grant — an agent (or member) cannot", async () => {
    const { pid, agent } = await setup();
    const res = await post(`/projects/${pid}/delegations`, { agent: "reconciler", classes: ["*"] }, agent);
    expect(res.status).toBe(403);
    expect((await res.json() as any).code).toBe("NOT_OPERATOR");
  });

  it("revoking a delegation blocks the agent again", async () => {
    const { pid, op, agent, mk } = await setup();
    const g = (await (await post(`/projects/${pid}/delegations`, { agent: "reconciler", classes: ["assertion.agree"] }, op)).json()) as any;
    expect((await agree(pid, await mk(), agent)).status).toBe(200);
    const rev = await post(`/projects/${pid}/delegations/${g.delegation.id}/revoke`, {}, op);
    expect(rev.status).toBe(200);
    expect((await agree(pid, await mk(), agent)).status).toBe(403);
  });

  it("grant 404s for an unknown agent", async () => {
    const { pid, op } = await setup();
    const res = await post(`/projects/${pid}/delegations`, { agent: "nobody", classes: ["*"] }, op);
    expect(res.status).toBe(404);
  });
});
