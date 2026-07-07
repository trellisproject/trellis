import { beforeEach, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../src/db/index.js";
import { assertions, facts, memberships, principals, projects } from "../src/db/schema.js";
import { app } from "../src/app.js";
import { ingestSpec } from "../src/lib/ingest.js";
import { hmacHex, parseTrellisTrailers, verifyGithubSignature } from "../src/lib/github.js";
import { resetDb, makeProject } from "./helpers/db.js";

let projectId: string;
let operatorId: string;
const SECRET = "whsec_test";

// Configure the webhook secret + github integration principal directly.
async function configureWebhook() {
  const gh = (await db.insert(principals).values({ kind: "agent", displayName: "GitHub" }).returning())[0]!;
  await db.insert(memberships).values({ projectId, principalId: gh.id, role: "member" });
  await db.update(projects).set({ webhookSecret: SECRET, githubPrincipalId: gh.id }).where(eq(projects.id, projectId));
  return gh.id;
}

function mergedPrEvent(body: string, sha = "deadbeefcafe") {
  return {
    action: "closed",
    pull_request: { merged: true, title: "Implement things", body, merge_commit_sha: sha, html_url: "https://gh/pr/7", number: 7 },
  };
}

async function post(payload: unknown, secret = SECRET, event = "pull_request") {
  const raw = JSON.stringify(payload);
  return app.request(`/projects/${projectId}/integrations/github/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-GitHub-Event": event, "X-Hub-Signature-256": `sha256=${hmacHex(secret, raw)}` },
    body: raw,
  });
}

beforeEach(async () => {
  await resetDb();
  ({ projectId, operatorId } = await makeProject());
});

describe("github webhook helpers", () => {
  it("verifies a correct signature and rejects a wrong one (TRL-API-011)", () => {
    const body = '{"a":1}';
    expect(verifyGithubSignature(SECRET, body, `sha256=${hmacHex(SECRET, body)}`)).toBe(true);
    expect(verifyGithubSignature(SECRET, body, "sha256=deadbeef")).toBe(false);
    expect(verifyGithubSignature(SECRET, body, undefined)).toBe(false);
  });

  it("extracts assertion ids from a Trellis trailer", () => {
    expect(parseTrellisTrailers("blah\n\nTrellis: TRL-CORE-007, TRL-CORE-008\n")).toEqual(["TRL-CORE-007", "TRL-CORE-008"]);
    expect(parseTrellisTrailers("no trailer here")).toEqual([]);
  });
});

describe("github webhook endpoint", () => {
  it("rejects an unsigned payload with 401, writing nothing (TRL-API-011)", async () => {
    await configureWebhook();
    const raw = JSON.stringify(mergedPrEvent("Trellis: TRL-CORE-001"));
    const res = await app.request(`/projects/${projectId}/integrations/github/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-GitHub-Event": "pull_request" },
      body: raw,
    });
    expect(res.status).toBe(401);
    expect(await db.select().from(facts).where(eq(facts.projectId, projectId))).toHaveLength(0);
  });

  it("rejects a bad signature with 401", async () => {
    await configureWebhook();
    const res = await post(mergedPrEvent("Trellis: TRL-CORE-001"), "wrong-secret");
    expect(res.status).toBe(401);
  });

  it("transitions agreed -> implemented and writes a fact on a merged PR (TRL-CORE-022)", async () => {
    await configureWebhook();
    await ingestSpec(projectId, "core", `---\nspec: TRL-CORE\ntitle: T\n---\n### TRL-CORE-001: t\nstatus: agreed\n\nbody\n`, "c1");
    const res = await post(mergedPrEvent("Adds it.\n\nTrellis: TRL-CORE-001"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.processed).toEqual([{ humanId: "TRL-CORE-001", transitioned: true }]);
    const a = (await db.select().from(assertions).where(eq(assertions.humanId, "TRL-CORE-001")))[0]!;
    expect(a.status).toBe("implemented");
    const f = await db.select().from(facts).where(eq(facts.projectId, projectId));
    expect(f).toHaveLength(1);
    expect(f[0]!.evidence.some((e) => e.type === "commit")).toBe(true);
  });

  it("does not transition past implemented; verified needs a checker fact", async () => {
    await configureWebhook();
    await ingestSpec(projectId, "core", `---\nspec: TRL-CORE\ntitle: T\n---\n### TRL-CORE-001: t\nstatus: agreed\n\nbody\n`, "c1");
    await post(mergedPrEvent("Trellis: TRL-CORE-001"));
    // a second merged PR referencing the now-implemented assertion doesn't verify it
    const res = await post(mergedPrEvent("Trellis: TRL-CORE-001", "beadfeed0000"));
    const body = (await res.json()) as any;
    expect(body.processed).toEqual([{ humanId: "TRL-CORE-001", transitioned: false }]);
    const a = (await db.select().from(assertions).where(eq(assertions.humanId, "TRL-CORE-001")))[0]!;
    expect(a.status).toBe("implemented");
  });

  it("ignores an unmerged PR", async () => {
    await configureWebhook();
    const res = await post({ action: "closed", pull_request: { merged: false, body: "Trellis: TRL-CORE-001" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ignored).toMatch(/not a merged PR/);
  });

  it("operator can provision a webhook secret", async () => {
    const create = await app.request("/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "p", operator: { displayName: "Op" } }) });
    const { project, token } = (await create.json()) as any;
    const res = await app.request(`/projects/${project.id}/webhook`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.secret).toMatch(/^trk_/);
  });
});
