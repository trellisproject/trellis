// Chat integrations (TRL-API-015). An install binds an external chat workspace
// to a project and to a dedicated capture-scoped principal; inbound events
// resolve to it by (provider, workspaceId) and capture requests as that
// principal, so captured_by identifies the originating install (TRL-CORE-043).

import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { agentTokens, chatInstalls, memberships, principals } from "../db/schema.js";
import { generateToken, hashToken } from "./tokens.js";
import { createRequest } from "./requests.js";

type Result<T> = { ok: true; value: T } | { ok: false; code: string; error: string };

export type ChatProvider = "slack" | "gchat";

// Register a chat integration into a project. Creates a dedicated capture-scoped
// principal + token for the install and returns the token once (shown once, like
// any minted token — TRL-API-001/015).
export async function createChatInstall(
  projectId: string,
  input: { provider: ChatProvider; workspaceId: string; displayName?: string },
): Promise<Result<{ install: typeof chatInstalls.$inferSelect; token: string }>> {
  const existing = (
    await db
      .select()
      .from(chatInstalls)
      .where(and(eq(chatInstalls.provider, input.provider), eq(chatInstalls.workspaceId, input.workspaceId)))
  )[0];
  if (existing) return { ok: false, code: "INSTALL_EXISTS", error: `${input.provider} workspace is already installed` };

  const raw = generateToken();
  const install = await db.transaction(async (tx) => {
    const p = (
      await tx
        .insert(principals)
        .values({ kind: "agent", displayName: input.displayName ?? `${input.provider}:${input.workspaceId}` })
        .returning()
    )[0]!;
    await tx.insert(memberships).values({ projectId, principalId: p.id, role: "member" });
    await tx.insert(agentTokens).values({ projectId, principalId: p.id, tokenHash: hashToken(raw), scope: "capture" });
    return (
      await tx
        .insert(chatInstalls)
        .values({ projectId, provider: input.provider, workspaceId: input.workspaceId, capturePrincipalId: p.id })
        .returning()
    )[0]!;
  });
  return { ok: true, value: { install, token: raw } };
}

// Resolve an inbound event's workspace to its install, or null.
export async function resolveInstall(provider: ChatProvider, workspaceId: string) {
  return (
    (
      await db
        .select()
        .from(chatInstalls)
        .where(and(eq(chatInstalls.provider, provider), eq(chatInstalls.workspaceId, workspaceId)))
    )[0] ?? null
  );
}

export async function listChatInstalls(projectId: string) {
  return db
    .select({
      id: chatInstalls.id,
      provider: chatInstalls.provider,
      workspaceId: chatInstalls.workspaceId,
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
  workspaceId: string;
  title: string;
  ask: string; // verbatim message text
  asker: string; // external identity, e.g. "slack:U024 (dana)"
  ref: string; // permalink / message id — the trace back to the origin
}): Promise<Result<{ requestId: string; projectId: string }>> {
  const install = await resolveInstall(input.provider, input.workspaceId);
  if (!install) {
    return { ok: false, code: "NO_INSTALL", error: `No install for ${input.provider} workspace ${input.workspaceId}` };
  }
  if (!input.ask.trim() || !input.ref.trim()) {
    return { ok: false, code: "INCOMPLETE_SOURCE", error: "A chat capture requires a verbatim ask and a source ref" };
  }
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
