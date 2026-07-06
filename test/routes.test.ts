import { beforeEach, describe, it, expect } from "vitest";
import { app } from "../src/app.js";
import { resetDb, authFor } from "./helpers/db.js";

const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

beforeEach(async () => {
  await resetDb();
});

// Create a project (unauthenticated) and return its id + operator auth header.
async function createProject() {
  const res = await app.request("/projects", json({ name: "trellis", operator: { displayName: "Frank" } }));
  const body = (await res.json()) as any;
  const auth = { Authorization: `Bearer ${body.token}` };
  return { res, body, auth };
}

describe("routes", () => {
  it("creates a project with an operator and a bootstrap token", async () => {
    const { res, body } = await createProject();
    expect(res.status).toBe(201);
    expect(body.project.id).toBeTruthy();
    expect(body.operator.displayName).toBe("Frank");
    expect(body.token).toMatch(/^trk_/);
  });

  it("rejects a malformed project body with 422", async () => {
    const res = await app.request("/projects", json({ name: "" }));
    expect(res.status).toBe(422);
  });

  it("ingests a spec and returns a parse report", async () => {
    const { body, auth } = await createProject();
    const src = `---\nspec: T-X\ntitle: T\n---\n### T-X-001: t\nstatus: agreed\n\nbody\n`;
    const res = await app.request(
      `/projects/${body.project.id}/specs/ingest`,
      json({ slug: "core", source: src, commit: "c1" }, auth),
    );
    expect(res.status).toBe(200);
    const report = (await res.json()) as any;
    expect(report.ok).toBe(true);
    expect(report.created).toEqual(["T-X-001"]);
  });

  it("returns 422 for a malformed spec via the route", async () => {
    const { body, auth } = await createProject();
    const bad = `### T-X-001: no status\n\nbody\n`;
    const res = await app.request(`/projects/${body.project.id}/specs/ingest`, json({ slug: "core", source: bad }, auth));
    expect(res.status).toBe(422);
    const report = (await res.json()) as any;
    expect(report.ok).toBe(false);
  });

  it("serves the merged spec view with assertions", async () => {
    const { body, auth } = await createProject();
    const src = `---\nspec: T-X\ntitle: T\n---\n### T-X-001: t\nstatus: agreed\n\nbody\n`;
    await app.request(`/projects/${body.project.id}/specs/ingest`, json({ slug: "core", source: src, commit: "c1" }, auth));
    const res = await app.request(`/projects/${body.project.id}/specs/core`, { headers: auth });
    expect(res.status).toBe(200);
    const view = (await res.json()) as any;
    expect(view.spec.slug).toBe("core");
    expect(view.assertions).toHaveLength(1);
    expect(view.assertions[0].humanId).toBe("T-X-001");
  });
});
