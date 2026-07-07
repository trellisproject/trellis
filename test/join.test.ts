import { beforeEach, describe, it, expect } from "vitest";
import { app } from "../src/app.js";
import { resetDb } from "./helpers/db.js";

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

async function newProject() {
  const res = await post("/projects", { name: "p", operator: { displayName: "Op" } });
  const body = (await res.json()) as any;
  return { pid: body.project.id, opToken: body.token, joinCode: body.joinCode };
}

beforeEach(async () => { await resetDb(); });

describe("join code onboarding (TRL-CORE-034/035)", () => {
  it("returns a join code at project creation", async () => {
    const { joinCode } = await newProject();
    expect(joinCode).toMatch(/^join_/);
  });

  it("lets an agent self-join with the code and get a working member token", async () => {
    const { pid, joinCode } = await newProject();
    const res = await post(`/projects/${pid}/join`, { code: joinCode, displayName: "checker-bot" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.role).toBe("member");
    expect(body.token).toMatch(/^trk_/);
    // token works for reads
    const read = await app.request(`/projects/${pid}/specs`, { headers: { Authorization: `Bearer ${body.token}` } });
    expect(read.status).toBe(200);
  });

  it("rejects a wrong join code with 403", async () => {
    const { pid } = await newProject();
    const res = await post(`/projects/${pid}/join`, { code: "join_wrong", displayName: "x" });
    expect(res.status).toBe(403);
  });

  it("a joined member cannot decide (operator authority is never granted by a code)", async () => {
    const { pid, opToken, joinCode } = await newProject();
    // ingest + drift so there's something to resolve
    await post(`/projects/${pid}/specs/ingest`, { slug: "s", source: `---\nspec: T-X\ntitle: T\n---\n### T-X-001: t\nstatus: agreed\n\nb\n`, commit: "c1" }, { Authorization: `Bearer ${opToken}` });
    const joined = (await (await post(`/projects/${pid}/join`, { code: joinCode, displayName: "bot" })).json()) as any;
    const fact = (await (await post(`/projects/${pid}/facts`, { key: "k", value: false, statement: "no", evidence: [{ type: "commit", ref: "c" }], links: [{ assertion: "T-X-001", relation: "contradicts" }] }, { Authorization: `Bearer ${joined.token}` })).json()) as any;
    const resolve = await post(`/projects/${pid}/drifts/${fact.driftsCreated[0]}/resolve`, { choice: "fix", rationale: "x" }, { Authorization: `Bearer ${joined.token}` });
    expect(resolve.status).toBe(403); // members can't decide
  });

  it("rotating the code invalidates the old one; operator-only", async () => {
    const { pid, opToken, joinCode } = await newProject();
    // member cannot rotate
    const joined = (await (await post(`/projects/${pid}/join`, { code: joinCode, displayName: "bot" })).json()) as any;
    const denied = await post(`/projects/${pid}/join-code/rotate`, {}, { Authorization: `Bearer ${joined.token}` });
    expect(denied.status).toBe(403);
    // operator rotates
    const rot = await post(`/projects/${pid}/join-code/rotate`, {}, { Authorization: `Bearer ${opToken}` });
    const { joinCode: newCode } = (await rot.json()) as any;
    expect(newCode).not.toBe(joinCode);
    // old code no longer works
    const old = await post(`/projects/${pid}/join`, { code: joinCode, displayName: "y" });
    expect(old.status).toBe(403);
    const fresh = await post(`/projects/${pid}/join`, { code: newCode, displayName: "z" });
    expect(fresh.status).toBe(201);
  });

  it("does not leak the join code to non-operator members", async () => {
    const { pid, joinCode } = await newProject();
    const joined = (await (await post(`/projects/${pid}/join`, { code: joinCode, displayName: "bot" })).json()) as any;
    const view = (await (await app.request(`/projects/${pid}`, { headers: { Authorization: `Bearer ${joined.token}` } })).json()) as any;
    expect(view.project.joinCode).toBeUndefined();
  });
});
