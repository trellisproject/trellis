// Attachments — supporting assets (designs, mockups, docs) on any object
// (effort/assertion/task), stored in Vercel Blob. Server-side upload path, so
// bounded by the platform request-body limit; larger files would want client
// upload. Degrades cleanly if no Blob store is connected yet.
import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { del, get, put } from "@vercel/blob";
import { db } from "../db/index.js";
import { attachments } from "../db/schema.js";
import { requireMember } from "../middleware/auth.js";
import type { AppEnv } from "../types.js";

export const attachmentRoutes = new Hono<AppEnv>();

const MAX = 4 * 1024 * 1024; // ~ platform serverless body cap
const TARGETS = ["effort", "assertion", "task"];

attachmentRoutes.post("/projects/:pid/attachments", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const pid = c.req.param("pid");
  const filename = c.req.query("filename");
  const targetType = c.req.query("target_type");
  const targetId = c.req.query("target_id");
  if (!filename || !targetType || !targetId || !TARGETS.includes(targetType)) {
    return c.json({ error: "filename, target_type (effort|assertion|task), target_id required", code: "INVALID_INPUT" }, 422);
  }
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength === 0) return c.json({ error: "Empty file", code: "INVALID_INPUT" }, 422);
  if (buf.byteLength > MAX) return c.json({ error: "File too large (max ~4MB via this path)", code: "TOO_LARGE" }, 413);
  const contentType = c.req.header("content-type") || undefined;
  // Blob auth is resolved by the SDK: a BLOB_READ_WRITE_TOKEN if present, else
  // the store's OIDC token (Vercel injects it when a store is connected).
  let blob;
  try {
    blob = await put(`${pid}/${filename}`, Buffer.from(buf), { access: "private", addRandomSuffix: true, contentType });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Blob upload failed — is a store connected to this project?", code: "UPLOAD_FAILED" }, 502);
  }
  const row = (
    await db
      .insert(attachments)
      .values({ projectId: pid, targetType: targetType as "effort", targetId, filename, url: blob.url, contentType: contentType ?? null, size: buf.byteLength, uploadedById: m.principalId })
      .returning()
  )[0]!;
  return c.json({ attachment: row }, 201);
});

attachmentRoutes.get("/projects/:pid/attachments", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const conds = [eq(attachments.projectId, c.req.param("pid"))];
  const tt = c.req.query("target_type");
  const ti = c.req.query("target_id");
  if (tt) conds.push(eq(attachments.targetType, tt as "effort"));
  if (ti) conds.push(eq(attachments.targetId, ti));
  const rows = await db.select().from(attachments).where(and(...conds)).orderBy(desc(attachments.createdAt));
  return c.json({ attachments: rows });
});

// Authenticated proxy: stream the private blob's bytes after checking the
// caller is a member. The web app fetches this WITH its bearer token and
// renders via a local blob: URL — files never leave auth, no signed URLs.
attachmentRoutes.get("/projects/:pid/attachments/:id/content", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const row = (await db.select().from(attachments).where(and(eq(attachments.id, c.req.param("id")), eq(attachments.projectId, c.req.param("pid")))))[0];
  if (!row) return c.json({ error: "Not found", code: "NOT_FOUND" }, 404);
  try {
    const r = await get(row.url, { access: "private" });
    if (!r) return c.json({ error: "Blob missing", code: "NOT_FOUND" }, 404);
    const bytes = await new Response(r.stream).arrayBuffer();
    return c.body(bytes, 200, { "content-type": row.contentType ?? "application/octet-stream", "cache-control": "private, max-age=60" });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Fetch failed", code: "FETCH_FAILED" }, 502);
  }
});

attachmentRoutes.delete("/projects/:pid/attachments/:id", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const row = (await db.select().from(attachments).where(and(eq(attachments.id, c.req.param("id")), eq(attachments.projectId, c.req.param("pid")))))[0];
  if (!row) return c.json({ error: "Not found", code: "NOT_FOUND" }, 404);
  try { await del(row.url); } catch { /* best-effort */ }
  await db.delete(attachments).where(eq(attachments.id, row.id));
  return c.json({ ok: true });
});
