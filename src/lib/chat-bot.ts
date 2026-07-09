// The chat bot: a Vercel Chat SDK instance wiring Slack / Google Chat events to
// request capture (TRL-API-015/019). Two triggers per the intake design —
// an @-mention (portable across platforms) and a capture emoji reaction — both
// funnel through captureFromChat, so a request is born from a chat message with
// full provenance (verbatim ask + durable ref, TRL-CORE-047).
//
// Construction is lazy and guarded: the bot is built only from adapters whose
// credentials are present in the environment, so a deployment without chat
// configured (including the test suite) never constructs an adapter and the
// webhook route simply reports "not configured". This keeps chat entirely
// optional and side-effect-free until an operator wires real credentials.

import { Chat } from "chat";
import { createSlackAdapter } from "@chat-adapter/slack";
import { createGoogleChatAdapter } from "@chat-adapter/gchat";
import { createPostgresState } from "@chat-adapter/state-pg";
import { createMemoryState } from "@chat-adapter/state-memory";
import { captureFromChat, type ChatProvider } from "./chat.js";

// The workspace id is not a normalized SDK field — it lives in the platform raw
// payload — so extraction is platform-specific and best-effort. These are the
// documented seams to verify against a live Slack/Google Chat app; if a
// workspace cannot be resolved the event is skipped rather than mis-attributed.
export function extractWorkspaceId(provider: ChatProvider, raw: unknown): string | null {
  const r = (raw ?? {}) as Record<string, any>;
  if (provider === "slack") {
    return r.team_id ?? r.team?.id ?? r.team ?? r.event?.team ?? r.authorizations?.[0]?.team_id ?? null;
  }
  // Google Chat: the space resource name identifies the workspace/space.
  return r.space?.name ?? r.space ?? r.spaceName ?? null;
}

// Pure mapping from a normalized chat message to capture arguments, or null when
// the event can't or shouldn't be captured (non-chat thread, unknown workspace,
// empty text). Kept free of SDK types so it is unit-testable in isolation.
export function buildChatCapture(args: {
  threadId: string; // "<adapter>:<channel>:<thread>"
  messageId: string;
  text: string;
  author: { userId?: string; fullName?: string };
  raw: unknown;
}): { provider: ChatProvider; workspaceId: string; title: string; ask: string; asker: string; ref: string } | null {
  const provider = args.threadId.split(":")[0];
  if (provider !== "slack" && provider !== "gchat") return null;
  const workspaceId = extractWorkspaceId(provider, args.raw);
  const ask = (args.text ?? "").trim();
  if (!workspaceId || !ask) return null;
  const who = args.author.userId ?? "unknown";
  const asker = `${provider}:${who}${args.author.fullName ? ` (${args.author.fullName})` : ""}`;
  const ref = `${args.threadId}#${args.messageId}`;
  return { provider, workspaceId, title: ask.slice(0, 80), ask, asker, ref };
}

async function captureFromMessage(message: {
  threadId: string;
  id: string;
  text: string;
  author?: { userId?: string; fullName?: string };
  raw: unknown;
}): Promise<void> {
  const cap = buildChatCapture({
    threadId: message.threadId,
    messageId: message.id,
    text: message.text,
    author: { userId: message.author?.userId, fullName: message.author?.fullName },
    raw: message.raw,
  });
  if (!cap) return;
  await captureFromChat(cap);
}

function configuredAdapters(): Record<string, unknown> {
  const adapters: Record<string, unknown> = {};
  if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_SIGNING_SECRET) {
    adapters.slack = createSlackAdapter();
  }
  const gchatProject = process.env.GOOGLE_CHAT_PROJECT_NUMBER;
  const gchatAudience = process.env.GOOGLE_CHAT_PUBSUB_AUDIENCE;
  if (gchatProject || gchatAudience) {
    adapters.gchat = createGoogleChatAdapter({ googleChatProjectNumber: gchatProject, pubsubAudience: gchatAudience });
  }
  return adapters;
}

type BotLike = {
  webhooks: Record<string, (request: Request) => Promise<Response>>;
  onNewMention: (h: (thread: unknown, message: any) => Promise<void>) => void;
  onReaction: (emojis: string[], h: (event: any) => Promise<void>) => void;
};

let botMemo: BotLike | null | undefined;

// The configured bot, or null when no adapter credentials are present.
export function getBot(): BotLike | null {
  if (botMemo !== undefined) return botMemo;
  const adapters = configuredAdapters();
  if (Object.keys(adapters).length === 0) {
    botMemo = null;
    return null;
  }
  const state = process.env.DATABASE_URL
    ? createPostgresState({ url: process.env.DATABASE_URL })
    : createMemoryState();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bot = new Chat({ userName: process.env.CHAT_BOT_USERNAME ?? "trellis", adapters: adapters as any, state }) as unknown as BotLike;

  const captureEmoji = process.env.CHAT_CAPTURE_EMOJI ?? "inbox_tray";
  bot.onNewMention(async (_thread, message) => {
    await captureFromMessage(message);
  });
  bot.onReaction([captureEmoji], async (event) => {
    if (!event.added || !event.message) return;
    await captureFromMessage(event.message);
  });

  botMemo = bot;
  return bot;
}

// Test-only: reset the memoized bot so env changes take effect.
export function __resetBotForTests(): void {
  botMemo = undefined;
}
