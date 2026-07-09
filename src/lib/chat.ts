// Chat integrations (TRL-API-015). An install binds an external chat workspace
// to a project and to a dedicated capture-scoped principal; inbound events
// resolve to it by (provider, workspaceId) and capture requests as that
// principal, so captured_by identifies the originating install (TRL-CORE-043).

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { agentTokens, chatInstalls, memberships, principals, requests } from "../db/schema.js";
import { generateToken, hashToken } from "./tokens.js";
import { createRequest } from "./requests.js";

type Result<T> = { ok: true; value: T } | { ok: false; code: string; error: string };

export type ChatProvider = "slack" | "gchat";

// Register a chat integration into a project. Creates a dedicated capture-scoped
// principal + token for the install and returns the token once (shown once, like
// any minted token — TRL-API-001/015).
export async function createChatInstall(
  projectId: string,
  input: { provider: ChatProvider; workspaceId: string; channelId?: string | null; captureMode?: "trigger" | "all"; displayName?: string },
): Promise<Result<{ install: typeof chatInstalls.$inferSelect; token: string }>> {
  const channelId = input.channelId ?? null;
  // A channel maps to at most one project globally (TRL-API-020) — so a channel
  // conflict is checked across all projects, not just this workspace. A
  // workspace default is unique per workspace.
  const existing = channelId
    ? (await db.select().from(chatInstalls).where(and(eq(chatInstalls.provider, input.provider), eq(chatInstalls.channelId, channelId))))[0]
    : (
        await db
          .select()
          .from(chatInstalls)
          .where(and(eq(chatInstalls.provider, input.provider), eq(chatInstalls.workspaceId, input.workspaceId), isNull(chatInstalls.channelId)))
      )[0];
  if (existing) {
    if (channelId) {
      const sameProject = existing.projectId === projectId;
      return {
        ok: false,
        code: "CHANNEL_TAKEN",
        error: sameProject
          ? `${input.provider} channel ${channelId} is already routed in this project`
          : `${input.provider} channel ${channelId} is already routed to another project`,
      };
    }
    return { ok: false, code: "INSTALL_EXISTS", error: `${input.provider} workspace default is already installed` };
  }

  const raw = generateToken();
  const label = input.displayName ?? `${input.provider}:${input.workspaceId}${channelId ? `:${channelId}` : ""}`;
  const install = await db.transaction(async (tx) => {
    const p = (await tx.insert(principals).values({ kind: "agent", displayName: label }).returning())[0]!;
    await tx.insert(memberships).values({ projectId, principalId: p.id, role: "member" });
    await tx.insert(agentTokens).values({ projectId, principalId: p.id, tokenHash: hashToken(raw), scope: "capture" });
    return (
      await tx
        .insert(chatInstalls)
        .values({
          projectId,
          provider: input.provider,
          workspaceId: input.workspaceId,
          channelId,
          captureMode: input.captureMode ?? "trigger",
          capturePrincipalId: p.id,
        })
        .returning()
    )[0]!;
  });
  return { ok: true, value: { install, token: raw } };
}

// Resolve an inbound event to its install: a channel-specific route wins, then
// the workspace default (channel_id NULL), else null (TRL-API-019). A channel
// route matches by (provider, channel) without the workspace, since chat
// channel ids are globally unique — and some events (Slack reactions) don't
// carry a workspace id at all.
export async function resolveInstall(provider: ChatProvider, workspaceId?: string | null, channelId?: string | null) {
  if (channelId) {
    const specific = (
      await db
        .select()
        .from(chatInstalls)
        .where(and(eq(chatInstalls.provider, provider), eq(chatInstalls.channelId, channelId)))
    )[0];
    if (specific) return specific;
  }
  if (!workspaceId) return null;
  return (
    (
      await db
        .select()
        .from(chatInstalls)
        .where(and(eq(chatInstalls.provider, provider), eq(chatInstalls.workspaceId, workspaceId), isNull(chatInstalls.channelId)))
    )[0] ?? null
  );
}

export async function listChatInstalls(projectId: string) {
  return db
    .select({
      id: chatInstalls.id,
      provider: chatInstalls.provider,
      workspaceId: chatInstalls.workspaceId,
      channelId: chatInstalls.channelId,
      captureMode: chatInstalls.captureMode,
      capturePrincipalId: chatInstalls.capturePrincipalId,
      createdAt: chatInstalls.createdAt,
    })
    .from(chatInstalls)
    .where(eq(chatInstalls.projectId, projectId))
    .orderBy(desc(chatInstalls.createdAt));
}

// Capture a request from a chat event, in-process. Resolves the install and
// creates the request as the install's capture principal, enforcing the same
// full-provenance rule as the HTTP capture path (TRL-API-016): a chat capture
// carries a verbatim ask and a durable source reference. This is the seam the
// platform webhook handlers call.
export async function captureFromChat(input: {
  provider: ChatProvider;
  workspaceId?: string | null;
  channelId?: string | null; // routes to a channel-specific install when set
  title: string;
  ask: string; // verbatim message text
  asker: string; // external identity, e.g. "slack:U024 (dana)"
  ref: string; // permalink / message id — the trace back to the origin
}): Promise<Result<{ requestId: string; projectId: string }>> {
  const install = await resolveInstall(input.provider, input.workspaceId ?? null, input.channelId ?? null);
  if (!install) {
    const where = input.channelId ? `channel ${input.channelId}` : `workspace ${input.workspaceId}`;
    return { ok: false, code: "NO_INSTALL", error: `No route for ${input.provider} ${where}` };
  }
  if (!input.ask.trim() || !input.ref.trim()) {
    return { ok: false, code: "INCOMPLETE_SOURCE", error: "A chat capture requires a verbatim ask and a source ref" };
  }
  // Idempotency: one chat message yields one request. source_ref identifies the
  // origin, so a Slack retry (we were slow to ack) or reacting to a message that
  // was already captured (e.g. your own @-mention) returns the existing request
  // rather than duplicating it. Cheaper and more targeted than shared dedupe
  // state; the bot runs on in-memory state deliberately.
  const existing = (
    await db
      .select({ id: requests.id })
      .from(requests)
      .where(and(eq(requests.projectId, install.projectId), eq(requests.source, input.provider), eq(requests.sourceRef, input.ref)))
  )[0];
  if (existing) return { ok: true, value: { requestId: existing.id, projectId: install.projectId } };

  const req = await createRequest(install.projectId, {
    title: input.title.trim() || input.ask.slice(0, 80),
    body: input.ask,
    requester: input.asker,
    source: input.provider,
    sourceRef: input.ref,
    capturedBy: install.capturePrincipalId,
  });
  return { ok: true, value: { requestId: req.id, projectId: install.projectId } };
}
