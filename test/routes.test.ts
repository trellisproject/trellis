import { beforeEach, describe, it, expect } from "vitest";
import { app } from "../src/app.js";
import { resetDb } from "./helpers/db.js";

const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

beforeEach(async () => {
  await resetDb();
});

async function createProject() {
  const res = await app.request(
    "/projects",
    json({ name: "trellis", operator: { displayName: "Frank" } }),
  );
  return { res, body: (await res.json()) as any };
}

describe("routes", () => {
  it("creates a project with a first operator", async () => {
    const { res, body } = await createProject();
    expect(res.status).toBe(201);
    expect(body.project.id).toBeTruthy();
    expect(body.operator.displayName).toBe("Frank");
  });

  it("rejects a malformed project body with 422", async () => {
    const res = await app.request("/projects", json({ name: "" }));
    expect(res.status).toBe(422);
  });

  it("ingests a spec and returns a parse report", async () => {
    const { body } = await createProject();
    const src = `---\nspec: T-X\ntitle: T\n---\n### T-X-001: t\nstatus: agreed\n\nbody\n`;
    const res = await app.request(`/projects/${body.project.id}/specs/ingest`, json({ slug: "core", source: src, commit: "c1" }));
    expect(res.status).toBe(200);
    const report = (await res.json()) as any;
    expect(report.ok).toBe(true);
    expect(report.created).toEqual(["T-X-001"]);
  });

  it("returns 422 for a malformed spec via the route", async () => {
    const { body } = await createProject();
    const bad = `### T-X-001: no status\n\nbody\n`;
    const res = await app.request(`/projects/${body.project.id}/specs/ingest`, json({ slug: "core", source: bad }));
    expect(res.status).toBe(422);
    const report = (await res.json()) as any;
    expect(report.ok).toBe(false);
  });

  it("serves the merged spec view with assertions", async () => {
    const { body } = await createProject();
    const src = `---\nspec: T-X\ntitle: T\n---\n### T-X-001: t\nstatus: agreed\n\nbody\n`;
    await app.request(`/projects/${body.project.id}/specs/ingest`, json({ slug: "core", source: src, commit: "c1" }));
    const res = await app.request(`/projects/${body.project.id}/specs/core`);
    expect(res.status).toBe(200);
    const view = (await res.json()) as any;
    expect(view.spec.slug).toBe("core");
    expect(view.assertions).toHaveLength(1);
    expect(view.assertions[0].humanId).toBe("T-X-001");
  });
});
