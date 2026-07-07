import { Hono } from "hono";
import { worklist } from "../lib/worklist.js";
import { requireMember } from "../middleware/auth.js";
import type { AppEnv } from "../types.js";

export const worklistRoutes = new Hono<AppEnv>();

// GET /projects/:pid/worklist — the computed scheduler, bucketed + priority-sorted.
worklistRoutes.get("/projects/:pid/worklist", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const effortId = c.req.query("effort");
  const ownerId = c.req.query("owner");
  const buckets = await worklist(c.req.param("pid"), effortId ? { effortId } : ownerId ? { ownerId } : undefined);
  const counts = Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length]));
  return c.json({ buckets, counts });
});
