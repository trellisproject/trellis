// The Map API — hierarchical, spec-anchored flow diagrams. Authoring is fluid
// (member-level): a map is a navigation artifact over intent, not a decision.
import { Hono } from "hono";
import { z } from "zod";
import { and, eq, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { assertions, diagrams } from "../db/schema.js";
import { requireMember } from "../middleware/auth.js";
import { createDiagram, createEdge, createNode, deleteDiagram, deleteEdge, deleteNode, getDiagram, listDiagrams, mapRefs, updateDiagram, updateNode } from "../lib/diagrams.js";
import type { AppEnv } from "../types.js";

export const diagramRoutes = new Hono<AppEnv>();

// Resolve an assertion reference (humanId or id) within a project to its id.
async function resolveAssertion(projectId: string, ref: string | null | undefined): Promise<string | null> {
  if (!ref) return null;
  const r = (await db.select({ id: assertions.id }).from(assertions).where(and(eq(assertions.projectId, projectId), or(eq(assertions.humanId, ref), eq(assertions.id, ref)))))[0];
  return r?.id ?? null;
}
async function ownDiagram(projectId: string, diagramId: string) {
  return (await db.select({ id: diagrams.id }).from(diagrams).where(and(eq(diagrams.id, diagramId), eq(diagrams.projectId, projectId))))[0];
}

diagramRoutes.get("/projects/:pid/diagrams", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  return c.json(await listDiagrams(c.req.param("pid")));
});

// "On the map" reverse lookup for a spec detail / assertion hub page.
diagramRoutes.get("/projects/:pid/map-refs", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  return c.json(await mapRefs(c.req.param("pid"), { assertionHumanId: c.req.query("assertion"), specSlug: c.req.query("spec") }));
});

diagramRoutes.get("/projects/:pid/diagrams/:key", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const d = await getDiagram(c.req.param("pid"), c.req.param("key"));
  if (!d) return c.json({ error: "Diagram not found", code: "NOT_FOUND" }, 404);
  return c.json(d);
});

const createBody = z.object({ title: z.string().min(1), description: z.string().optional(), direction: z.enum(["TD", "LR"]).optional(), parent_node_id: z.string().optional() });
diagramRoutes.post("/projects/:pid/diagrams", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const b = createBody.safeParse(await c.req.json().catch(() => ({})));
  if (!b.success) return c.json({ error: "Invalid input", code: "INVALID_INPUT", detail: b.error.flatten() }, 422);
  const r = await createDiagram(c.req.param("pid"), { title: b.data.title, description: b.data.description, direction: b.data.direction, parentNodeId: b.data.parent_node_id ?? null });
  return r.ok ? c.json({ diagram: r.value }, 201) : c.json({ error: r.error, code: r.code }, 400);
});

const patchDiagramBody = z.object({ title: z.string().min(1).optional(), description: z.string().optional(), direction: z.enum(["TD", "LR"]).optional() });
diagramRoutes.patch("/projects/:pid/diagrams/:id", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const b = patchDiagramBody.safeParse(await c.req.json().catch(() => ({})));
  if (!b.success) return c.json({ error: "Invalid input", code: "INVALID_INPUT", detail: b.error.flatten() }, 422);
  await updateDiagram(c.req.param("pid"), c.req.param("id"), { title: b.data.title, description: b.data.description, direction: b.data.direction });
  return c.json({ ok: true });
});

const nodeBody = z.object({ label: z.string().min(1), key: z.string().optional(), kind: z.enum(["step", "decision", "trigger", "terminal", "subflow"]).optional(), effort_id: z.string().nullish(), assertion: z.string().nullish() });
diagramRoutes.post("/projects/:pid/diagrams/:id/nodes", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const pid = c.req.param("pid");
  if (!(await ownDiagram(pid, c.req.param("id")))) return c.json({ error: "Diagram not found", code: "NOT_FOUND" }, 404);
  const b = nodeBody.safeParse(await c.req.json().catch(() => ({})));
  if (!b.success) return c.json({ error: "Invalid input", code: "INVALID_INPUT", detail: b.error.flatten() }, 422);
  const assertionId = await resolveAssertion(pid, b.data.assertion);
  const r = await createNode(pid, c.req.param("id"), { label: b.data.label, key: b.data.key, kind: b.data.kind, effortId: b.data.effort_id ?? null, assertionId });
  return r.ok ? c.json({ node: r.value }, 201) : c.json({ error: r.error, code: r.code }, 400);
});

const edgeBody = z.object({ from: z.string().min(1), to: z.string().min(1), label: z.string().optional() });
diagramRoutes.post("/projects/:pid/diagrams/:id/edges", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const pid = c.req.param("pid");
  if (!(await ownDiagram(pid, c.req.param("id")))) return c.json({ error: "Diagram not found", code: "NOT_FOUND" }, 404);
  const b = edgeBody.safeParse(await c.req.json().catch(() => ({})));
  if (!b.success) return c.json({ error: "Invalid input", code: "INVALID_INPUT", detail: b.error.flatten() }, 422);
  const r = await createEdge(pid, c.req.param("id"), b.data);
  return r.ok ? c.json({ edge: r.value }, 201) : c.json({ error: r.error, code: r.code }, 400);
});

const patchNodeBody = z.object({ label: z.string().min(1).optional(), kind: z.enum(["step", "decision", "trigger", "terminal", "subflow"]).optional(), effort_id: z.string().nullish(), assertion: z.string().nullish(), order: z.number().optional() });
diagramRoutes.patch("/projects/:pid/nodes/:nid", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  const pid = c.req.param("pid");
  const b = patchNodeBody.safeParse(await c.req.json().catch(() => ({})));
  if (!b.success) return c.json({ error: "Invalid input", code: "INVALID_INPUT", detail: b.error.flatten() }, 422);
  const patch: Parameters<typeof updateNode>[2] = { label: b.data.label, kind: b.data.kind, order: b.data.order };
  if (b.data.effort_id !== undefined) patch.effortId = b.data.effort_id ?? null;
  if (b.data.assertion !== undefined) patch.assertionId = b.data.assertion ? await resolveAssertion(pid, b.data.assertion) : null;
  await updateNode(pid, c.req.param("nid"), patch);
  return c.json({ ok: true });
});

diagramRoutes.delete("/projects/:pid/nodes/:nid", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  await deleteNode(c.req.param("pid"), c.req.param("nid"));
  return c.json({ ok: true });
});
diagramRoutes.delete("/projects/:pid/edges/:eid", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  await deleteEdge(c.req.param("pid"), c.req.param("eid"));
  return c.json({ ok: true });
});
diagramRoutes.delete("/projects/:pid/diagrams/:id", async (c) => {
  const m = await requireMember(c);
  if (m instanceof Response) return m;
  await deleteDiagram(c.req.param("pid"), c.req.param("id"));
  return c.json({ ok: true });
});
