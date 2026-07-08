import { beforeEach, describe, it, expect } from "vitest";
import { app } from "../src/app.js";
import { resetDb } from "./helpers/db.js";

const post = (p: string, b: unknown, h: Record<string, string> = {}) => app.request(p, { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(b) });
const patch = (p: string, b: unknown, h: Record<string, string> = {}) => app.request(p, { method: "PATCH", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(b) });

beforeEach(async () => { await resetDb(); });

async function project() {
  const p = (await (await post("/projects", { name: "p", operator: { displayName: "Op" } })).json()) as any;
  return { pid: p.project.id, op: { Authorization: `Bearer ${p.token}` } };
}
const addHuman = async (pid: string, op: Record<string, string>) =>
  (await (await post(`/projects/${pid}/tokens`, { displayName: "Dev", kind: "human", role: "member" }, op)).json()) as any;

describe("member role changes — promoting a human to operator (decision authority)", () => {
  it("an operator promotes a human member to operator", async () => {
    const { pid, op } = await project();
    const h = await addHuman(pid, op);
    const r = await patch(`/projects/${pid}/members/${h.principal.id}`, { role: "operator" }, op);
    expect(r.status).toBe(200);
    expect((await r.json() as any).role).toBe("operator");
  });

  it("a non-operator cannot change roles", async () => {
    const { pid, op } = await project();
    const h = await addHuman(pid, op);
    const dev = { Authorization: `Bearer ${h.token}` };
    const r = await patch(`/projects/${pid}/members/${h.principal.id}`, { role: "operator" }, dev);
    expect(r.status).toBe(403);
  });

  it("won't demote the last operator (no lockout)", async () => {
    const { pid, op } = await project();
    const members = (await (await app.request(`/projects/${pid}/members`, { headers: op })).json()) as any;
    const opId = members.members.find((m: any) => m.role === "operator").principalId;
    const r = await patch(`/projects/${pid}/members/${opId}`, { role: "member" }, op);
    expect(r.status).toBe(409);
  });
});
