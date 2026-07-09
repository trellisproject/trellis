import { Hono } from "hono";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { requests } from "../db/schema.js";
import { createRequest, decideRequest, deliverPendingReceipts, getRequest, linkRequestAssertions, listRequests } from "../lib/requests.js";
import { postChatMessage } from "../lib/chat-bot.js";
import { requireMember } from "../middleware/auth.js";
import type { AppEnv } from "../types.js";

export const requestRoutes = new Hono<AppEnv>();

const ERR: Record<string, number> = {
  NOT_FOUND: 404, INVALID_CHOICE: 422, MISSING_RATIONALE: 422, ALREADY_DECIDED: 409,
  UNKNOWN_ASSERTION: 422, NOT_MEMBER: 403, NOT_OPERATOR: 403,
  DELEGATION_REQUIRED: 403, INVALID_DELEGATION: 403, DELEGATION_SCOPE: 403,
};
const st = (code: string) => (ERR[code] ?? 400) as 400;

// POST /projects/:pid/requests — capture an ask. Open to any member and to a
// capture-scoped chat principal (TRL-CORE-030/046, TRL-API-015). `source` may be
// a bare type string (legacy) or {type, ref}; the ask itself is `body`, stored
// verbatim (TRL-CORE-047). The capturing principal is recorded server-side and
// is distinct from `requester`, the asker (TRL-CORE-043).
requestRoutes.post("/projects/:pid/requests", async (c) => {
  const m = await requireMember(c, { allowCaptureScope: true });
  if (m instanceof Response) return m;
  const b = z
    .object({
      title: z.string().min(1),
      body: z.string().optional(),
      requester: z.string().min(1),
      source: z
        .union([z.string(), z.object({ type: z.string().min(1), ref: z.string().min(1) })])
        .nullable()
        .optional(),
      sourceRef: z.string().nullable().optional(),
      priority: z.enum(["now", "normal", "later"]).optional(),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "Invalid body", code: "INVALID_INPUT", issues: b.error.issues }, 422);

  let sourceType: string | null = null;
  let sourceRef: string | null = b.data.sourceRef ?? null;
  if (typeof b.data.source === "string") sourceType = b.data.source;
  else if (b.data.source) {
    sourceType = b.data.source.type;
    sourceRef = b.data.source.ref;
  }

  // TRL-API-016: a chat (capture-scoped) principal must supply full provenance —
  // a source type, a durable reference, and the verbatim ask — since a chat
  // permalink is the only trace back to the origin. Human/UI captures may omit
  // a source (they have observability elsewhere).
  if (c.get("tokenScope") === "capture" && (!sourceType || !sourceRef || !b.data.body?.trim())) {
    return c.json(
      { error: "Chat capture requires a source type, a source ref, and the verbatim ask (body)", code: "INCOMPLETE_SOURCE" },
      422,
    );
  }

  const req = await createRequest(c.req.param("pid"), {
    title: b.data.title,
    body: b.data.body,
    requester: b.data.requester,
    source: sourceType,
    sourceRef,
    capturedBy: m.principalId,
    priority: b.data.priority,
  });
  return c.json({ request: req }, 201);
});

// PATCH /projects/:pid/requests/:rid — set priority.
requestRoutes.patch("/projects/:pid/requests/:rid", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const b = z.object({ priority: z.enum(["now", "normal", "later"]) }).safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "Invalid body", code: "INVALID_INPUT" }, 422);
  const updated = (await db.update(requests).set({ priority: b.data.priority, updatedAt: new Date() }).where(and(eq(requests.id, c.req.param("rid")), eq(requests.projectId, c.req.param("pid")))).returning())[0];
  if (!updated) return c.json({ error: "Request not found", code: "NOT_FOUND" }, 404);
  return c.json({ request: updated });
});

// GET /projects/:pid/requests?status=
requestRoutes.get("/projects/:pid/requests", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const rows = await listRequests(c.req.param("pid"), c.req.query("status"));
  return c.json({ requests: rows });
});

// GET /projects/:pid/requests/:rid
requestRoutes.get("/projects/:pid/requests/:rid", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const req = await getRequest(c.req.param("pid"), c.req.param("rid"));
  if (!req) return c.json({ error: "Request not found", code: "NOT_FOUND" }, 404);
  return c.json({ request: req });
});

// POST /projects/:pid/requests/:rid/decide — accept or decline (TRL-CORE-031).
requestRoutes.post("/projects/:pid/requests/:rid/decide", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const b = z.object({ choice: z.enum(["accept", "decline"]), rationale: z.string().min(1), delegated_by: z.string().nullable().optional() }).safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "Invalid body", code: "INVALID_INPUT" }, 422);
  const r = await decideRequest(c.req.param("pid"), c.req.param("rid"), { actorId: m.principalId, choice: b.data.choice, rationale: b.data.rationale, delegatedById: b.data.delegated_by ?? null });
  if (!r.ok) return c.json({ error: r.error, code: r.code }, st(r.code));
  return c.json(r.value);
});

// POST /projects/:pid/requests/deliver-receipts — deliver receipts for shipped
// chat-sourced requests (TRL-CORE-045). Idempotent sweep, run by an agent or
// checker; safe to call repeatedly.
requestRoutes.post("/projects/:pid/requests/deliver-receipts", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const r = await deliverPendingReceipts(c.req.param("pid"), postChatMessage);
  return c.json(r);
});

// POST /projects/:pid/requests/:rid/assertions — link derived intent (TRL-CORE-032).
requestRoutes.post("/projects/:pid/requests/:rid/assertions", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const b = z.object({ assertions: z.array(z.string().min(1)).min(1) }).safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "Invalid body", code: "INVALID_INPUT" }, 422);
  const r = await linkRequestAssertions(c.req.param("pid"), c.req.param("rid"), b.data.assertions);
  if (!r.ok) return c.json({ error: r.error, code: r.code }, st(r.code));
  return c.json(r.value);
});
