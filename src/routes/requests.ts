import { Hono } from "hono";
import { z } from "zod";
import { createRequest, decideRequest, getRequest, linkRequestAssertions, listRequests } from "../lib/requests.js";
import { requireMember } from "../middleware/auth.js";
import type { AppEnv } from "../types.js";

export const requestRoutes = new Hono<AppEnv>();

const ERR: Record<string, number> = {
  NOT_FOUND: 404, INVALID_CHOICE: 422, MISSING_RATIONALE: 422, ALREADY_DECIDED: 409,
  UNKNOWN_ASSERTION: 422, NOT_MEMBER: 403, NOT_OPERATOR: 403,
  DELEGATION_REQUIRED: 403, INVALID_DELEGATION: 403, DELEGATION_SCOPE: 403,
};
const st = (code: string) => (ERR[code] ?? 400) as 400;

// POST /projects/:pid/requests — capture an ask (any member, TRL-CORE-030).
requestRoutes.post("/projects/:pid/requests", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const b = z.object({ title: z.string().min(1), body: z.string().optional(), requester: z.string().min(1), source: z.string().nullable().optional() }).safeParse(await c.req.json().catch(() => null));
  if (!b.success) return c.json({ error: "Invalid body", code: "INVALID_INPUT", issues: b.error.issues }, 422);
  const req = await createRequest(c.req.param("pid"), b.data);
  return c.json({ request: req }, 201);
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
