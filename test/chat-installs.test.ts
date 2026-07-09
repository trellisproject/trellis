import { beforeEach, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { app } from "../src/app.js";
import { db } from "../src/db/index.js";
import { requests } from "../src/db/schema.js";
import { captureFromChat, createChatInstall, resolveInstall } from "../src/lib/chat.js";
import { resetDb, makeProject, addMember, authFor } from "./helpers/db.js";

const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

let projectId: string;
let operatorId: string;

beforeEach(async () => {
  await resetDb();
  ({ projectId, operatorId } = await makeProject());
});

describe("chat installs (TRL-API-015) — mapping workspace → project + capture principal", () => {
  it("captureFromChat resolves the install and captures as its principal with full provenance", async () => {
    const created = await createChatInstall(projectId, { provider: "slack", workspaceId: "T123" });
    expect(created.ok).toBe(true);
    const principalId = created.ok ? created.value.install.capturePrincipalId : "";

    const cap = await captureFromChat({
      provider: "slack",
      workspaceId: "T123",
      title: "NAIC code",
      ask: "can the export include the carrier NAIC code?",
      asker: "slack:U024 (dana)",
      ref: "https://acme.slack.com/archives/C1/p1699",
    });
    expect(cap.ok).toBe(true);
    const row = (await db.select().from(requests).where(eq(requests.projectId, projectId)))[0]!;
    expect(row.source).toBe("slack");
    expect(row.sourceRef).toBe("https://acme.slack.com/archives/C1/p1699");
    expect(row.body).toContain("NAIC");
    expect(row.requester).toBe("slack:U024 (dana)"); // asker
    expect(row.capturedBy).toBe(principalId); // the install's principal
  });

  it("captureFromChat fails for an unknown workspace", async () => {
    const r = await captureFromChat({ provider: "slack", workspaceId: "nope", title: "x", ask: "a", asker: "u", ref: "r" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NO_INSTALL");
  });

  it("captureFromChat rejects an incomplete source (no ref)", async () => {
    await createChatInstall(projectId, { provider: "slack", workspaceId: "T1" });
    const r = await captureFromChat({ provider: "slack", workspaceId: "T1", title: "x", ask: "the ask", asker: "u", ref: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INCOMPLETE_SOURCE");
  });

  it("a workspace can only be installed once", async () => {
    await createChatInstall(projectId, { provider: "slack", workspaceId: "T1" });
    const dup = await createChatInstall(projectId, { provider: "slack", workspaceId: "T1" });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.code).toBe("INSTALL_EXISTS");
    expect(await resolveInstall("slack", "T1")).not.toBeNull();
  });

  it("operator registers an install over HTTP and gets a capture-only token", async () => {
    const opAuth = await authFor(projectId, operatorId);
    const res = await app.request(`/projects/${projectId}/chat-installs`, json({ provider: "slack", workspaceId: "TWS" }, opAuth));
    expect(res.status).toBe(201);
    const { token } = (await res.json()) as any;
    expect(token).toBeTruthy();

    // the returned token can capture...
    const chatAuth = { Authorization: `Bearer ${token}` };
    const cap = await app.request(
      `/projects/${projectId}/requests`,
      json({ title: "x", requester: "slack:U1", body: "ask", source: { type: "slack", ref: "https://x/y" } }, chatAuth),
    );
    expect(cap.status).toBe(201);
    // ...but cannot decide (capture scope — TRL-CORE-044)
    const rid = ((await cap.json()) as any).request.id;
    const dec = await app.request(`/projects/${projectId}/requests/${rid}/decide`, json({ choice: "accept", rationale: "x" }, chatAuth));
    expect(dec.status).toBe(403);
  });

  it("a plain member cannot register an install", async () => {
    const memberId = await addMember(projectId, "human", "member");
    const memberAuth = await authFor(projectId, memberId);
    const res = await app.request(`/projects/${projectId}/chat-installs`, json({ provider: "slack", workspaceId: "TX" }, memberAuth));
    expect(res.status).toBe(403);
  });
});
