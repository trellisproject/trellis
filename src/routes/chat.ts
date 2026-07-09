import { Hono } from "hono";
import { z } from "zod";
import { createChatInstall, listChatInstalls } from "../lib/chat.js";
import { requireMember, requireOperator } from "../middleware/auth.js";
import type { AppEnv } from "../types.js";

export const chatRoutes = new Hono<AppEnv>();

const ERR: Record<string, number> = { INSTALL_EXISTS: 409 };
const st = (code: string) => (ERR[code] ?? 400) as 400;

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
