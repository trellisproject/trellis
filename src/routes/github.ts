import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { memberships, principals, projects } from "../db/schema.js";
import { generateToken } from "../lib/tokens.js";
import { handlePullRequest, verifyGithubSignature } from "../lib/github.js";
import { requireOperator } from "../middleware/auth.js";
import type { AppEnv } from "../types.js";

export const githubRoutes = new Hono<AppEnv>();

// POST /projects/:pid/webhook — operator provisions (or rotates) the webhook
// secret, creating the GitHub integration principal on first call. Secret is
// returned once. TRL-API-011.
githubRoutes.post("/projects/:pid/webhook", async (c) => {
  const op = await requireOperator(c);
  if (op instanceof Response) return op;
  const pid = c.req.param("pid");
  const project = (await db.select().from(projects).where(eq(projects.id, pid)))[0];
  if (!project) return c.json({ error: "Project not found", code: "NOT_FOUND" }, 404);

  const secret = generateToken();
  let githubPrincipalId = project.githubPrincipalId;
  await db.transaction(async (tx) => {
    if (!githubPrincipalId) {
      const p = (
        await tx.insert(principals).values({ kind: "agent", displayName: "GitHub" }).returning()
      )[0]!;
      await tx.insert(memberships).values({ projectId: pid, principalId: p.id, role: "member" });
      githubPrincipalId = p.id;
    }
    await tx.update(projects).set({ webhookSecret: secret, githubPrincipalId }).where(eq(projects.id, pid));
  });
  return c.json({ secret, hint: "Set as the GitHub webhook secret; events post to /projects/:pid/integrations/github/webhook" }, 201);
});

// POST /projects/:pid/integrations/github/webhook — signed inbound events.
// Unsigned/invalid payloads are rejected and write nothing (TRL-API-011).
githubRoutes.post("/projects/:pid/integrations/github/webhook", async (c) => {
  const pid = c.req.param("pid");
  const project = (await db.select().from(projects).where(eq(projects.id, pid)))[0];
  if (!project || !project.webhookSecret || !project.githubPrincipalId) {
    return c.json({ error: "Webhook not configured", code: "NOT_CONFIGURED" }, 404);
  }
  const raw = await c.req.text();
  const sig = c.req.header("X-Hub-Signature-256");
  if (!verifyGithubSignature(project.webhookSecret, raw, sig)) {
    return c.json({ error: "Invalid signature", code: "BAD_SIGNATURE" }, 401);
  }
  const event = c.req.header("X-GitHub-Event");
  if (event !== "pull_request") return c.json({ ok: true, ignored: `event ${event}` });

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return c.json({ error: "Invalid JSON", code: "INVALID_INPUT" }, 422);
  }
  const result = await handlePullRequest(pid, project.githubPrincipalId, payload);
  return c.json({ ok: true, ...result });
});
