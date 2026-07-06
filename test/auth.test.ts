import { beforeEach, describe, it, expect } from "vitest";
import { app } from "../src/app.js";
import { resetDb, makeProject, addMember, authFor } from "./helpers/db.js";

const get = (path: string, headers: Record<string, string> = {}) => app.request(path, { headers });
const postJson = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

let projectId: string;
let operatorId: string;

beforeEach(async () => {
  await resetDb();
  ({ projectId, operatorId } = await makeProject());
});

describe("authentication & authorization", () => {
  it("health is reachable without a token", async () => {
    const res = await get("/health");
    expect(res.status).toBe(200);
  });

  it("rejects an invalid bearer token with 401", async () => {
    const res = await get(`/projects/${projectId}/specs`, { Authorization: "Bearer not-a-real-token" });
    expect(res.status).toBe(401);
  });

  it("rejects a read with no token with 401 (TRL-API-010)", async () => {
    const res = await get(`/projects/${projectId}/specs`);
    expect(res.status).toBe(401);
  });

  it("rejects a non-member with a valid token with 403", async () => {
    // token for a principal who is a member of a DIFFERENT project
    const other = await makeProject();
    const auth = await authFor(other.projectId, other.operatorId);
    const res = await get(`/projects/${projectId}/specs`, auth);
    expect(res.status).toBe(403);
  });

  it("allows a member to read", async () => {
    const auth = await authFor(projectId, operatorId);
    const res = await get(`/projects/${projectId}/specs`, auth);
    expect(res.status).toBe(200);
  });

  it("only operators can mint tokens (TRL-API-012)", async () => {
    const memberId = await addMember(projectId, "human", "member");
    const memberAuth = await authFor(projectId, memberId);
    const denied = await postJson(`/projects/${projectId}/tokens`, { displayName: "bot" }, memberAuth);
    expect(denied.status).toBe(403);

    const opAuth = await authFor(projectId, operatorId);
    const ok = await postJson(`/projects/${projectId}/tokens`, { displayName: "bot" }, opAuth);
    expect(ok.status).toBe(201);
    const body = (await ok.json()) as any;
    expect(body.token).toMatch(/^trk_/);
  });

  it("a token is not valid for a different project (TRL-API-001)", async () => {
    // Operator A's token used against project B they are not scoped to.
    const auth = await authFor(projectId, operatorId);
    const other = await makeProject();
    const res = await get(`/projects/${other.projectId}/specs`, auth);
    // token's project != path project -> WRONG_PROJECT 403
    expect(res.status).toBe(403);
  });
});
