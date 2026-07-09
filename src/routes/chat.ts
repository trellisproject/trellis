import { Hono } from "hono";
import { z } from "zod";
import { createChatInstall, listChatInstalls } from "../lib/chat.js";
import { getBot } from "../lib/chat-bot.js";
import { requireMember, requireOperator } from "../middleware/auth.js";
import type { AppEnv } from "../types.js";

export const chatRoutes = new Hono<AppEnv>();

const ERR: Record<string, number> = { INSTALL_EXISTS: 409 };
const st = (code: string) => (ERR[code] ?? 400) as 400;

// POST /integrations/chat/:provider — platform webhook. Authenticated by the
// adapter's own signature verification (fail-closed), not by a bearer token, so
// this route deliberately does not call requireMember. The Chat SDK parses and
// verifies the request and dispatches to the registered handlers, which capture
// requests (TRL-API-015). Unknown provider → 404; provider not configured with
// credentials → 503.
chatRoutes.post("/integrations/chat/:provider", async (c) => {
  const provider = c.req.param("provider");
  if (provider !== "slack" && provider !== "gchat") {
    return c.json({ error: "Unknown chat provider", code: "UNKNOWN_PROVIDER" }, 404);
  }
  const bot = getBot();
  const handler = bot?.webhooks?.[provider];
  if (!bot || !handler) {
    return c.json({ error: `Chat provider "${provider}" is not configured`, code: "CHAT_NOT_CONFIGURED" }, 503);
  }
  return handler(c.req.raw);
});

// POST /projects/:pid/chat-installs — an operator installs a chat integration,
// binding a workspace to this project. Returns a capture-scoped token once
// (TRL-API-015). The token/principal is what inbound events capture as.
chatRoutes.post("/projects/:pid/chat-installs", async (c) => {
  const op = await requireOperator(c);
  if (op instanceof Response) return op;
  const b = z
    .object({ provider: z.enum(["slack", "gchat"]), workspaceId: z.string().min(1), displayName: z.string().optional() })
    .safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "Invalid body", code: "INVALID_INPUT", issues: b.error.issues }, 422);
  const r = await createChatInstall(c.req.param("pid"), b.data);
  if (!r.ok) return c.json({ error: r.error, code: r.code }, st(r.code));
  return c.json({ install: r.value.install, token: r.value.token }, 201);
});

// GET /projects/:pid/chat-installs — list installs (never returns tokens).
chatRoutes.get("/projects/:pid/chat-installs", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const installs = await listChatInstalls(c.req.param("pid"));
  return c.json({ installs });
});
