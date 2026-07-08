// The Map: hierarchical flow diagrams anchored to specs. Nodes drill into child
// diagrams or anchor to an effort/assertion; status (and its color) is derived
// from those specs and propagates up so a subsystem lights up when anything
// inside it has drifted.
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { assertions, diagramEdges, diagramNodes, diagrams, effortAssertions, efforts } from "../db/schema.js";

type Result<T> = { ok: true; value: T } | { ok: false; code: string; error: string };

export type NodeStatus = "verified" | "drifted" | "progress" | "none";
const SEV: Record<NodeStatus, number> = { drifted: 3, progress: 2, verified: 1, none: 0 };

function mapAssertion(status: string | undefined): NodeStatus {
  if (status === "verified") return "verified";
  if (status === "drifted") return "drifted";
  if (status === "proposed" || status === "agreed" || status === "implemented") return "progress";
  return "none"; // retired / unknown
}
function deriveEffort(statuses: NodeStatus[]): NodeStatus {
  if (statuses.includes("drifted")) return "drifted";
  if (statuses.includes("progress")) return "progress";
  if (statuses.includes("verified")) return "verified";
  return "none";
}
function aggregate(statuses: NodeStatus[]): NodeStatus {
  return statuses.reduce<NodeStatus>((best, s) => (SEV[s] > SEV[best] ? s : best), "none");
}

function keyify(base: string, taken: Set<string>): string {
  let k = base.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (!k || !/^[a-z]/.test(k)) k = "n" + (k || randomUUID().replace(/-/g, "").slice(0, 8));
  let out = k, i = 2;
  while (taken.has(out)) out = `${k}_${i++}`;
  taken.add(out);
  return out;
}

// Status for every node in the project, memoized, with subflow recursion.
async function computeStatuses(projectId: string): Promise<Map<string, NodeStatus>> {
  const [allNodes, allDiagrams, ea, asserts] = await Promise.all([
    db.select().from(diagramNodes).where(eq(diagramNodes.projectId, projectId)),
    db.select({ id: diagrams.id, parentNodeId: diagrams.parentNodeId }).from(diagrams).where(eq(diagrams.projectId, projectId)),
    db.select({ effortId: effortAssertions.effortId, status: assertions.status }).from(effortAssertions).innerJoin(assertions, eq(assertions.id, effortAssertions.assertionId)).where(eq(assertions.projectId, projectId)),
    db.select({ id: assertions.id, status: assertions.status }).from(assertions).where(eq(assertions.projectId, projectId)),
  ]);
  const assertStatus = new Map(asserts.map((a) => [a.id, a.status]));
  const effortStatuses = new Map<string, NodeStatus[]>();
  for (const r of ea) { const arr = effortStatuses.get(r.effortId) ?? []; arr.push(mapAssertion(r.status)); effortStatuses.set(r.effortId, arr); }
  const nodesByDiagram = new Map<string, typeof allNodes>();
  for (const n of allNodes) { const arr = nodesByDiagram.get(n.diagramId) ?? []; arr.push(n); nodesByDiagram.set(n.diagramId, arr); }
  const childDiagramOfNode = new Map<string, string>();
  for (const d of allDiagrams) if (d.parentNodeId) childDiagramOfNode.set(d.parentNodeId, d.id);
  const byId = new Map(allNodes.map((n) => [n.id, n]));

  const memo = new Map<string, NodeStatus>();
  function statusOf(nodeId: string, seen: Set<string>): NodeStatus {
    if (memo.has(nodeId)) return memo.get(nodeId)!;
    if (seen.has(nodeId)) return "none"; // cycle guard
    seen.add(nodeId);
    const n = byId.get(nodeId);
    // Worst-wins across the node's own anchor AND its child diagram, so a node
    // that both anchors a spec and drills into a subsystem lights up when
    // either has drifted.
    const parts: NodeStatus[] = [];
    if (n?.assertionId) parts.push(mapAssertion(assertStatus.get(n.assertionId)));
    else if (n?.effortId) parts.push(deriveEffort(effortStatuses.get(n.effortId) ?? []));
    if (childDiagramOfNode.has(nodeId)) parts.push(aggregate((nodesByDiagram.get(childDiagramOfNode.get(nodeId)!) ?? []).map((c) => statusOf(c.id, seen))));
    const s = parts.length ? aggregate(parts) : "none";
    memo.set(nodeId, s);
    return s;
  }
  for (const n of allNodes) statusOf(n.id, new Set());
  return memo;
}

export async function getDiagram(projectId: string, key: string) {
  const d = (await db.select().from(diagrams).where(and(eq(diagrams.projectId, projectId), eq(diagrams.key, key))))[0];
  if (!d) return null;
  const [nodes, edges, statuses] = await Promise.all([
    db.select().from(diagramNodes).where(eq(diagramNodes.diagramId, d.id)).orderBy(diagramNodes.order),
    db.select().from(diagramEdges).where(eq(diagramEdges.diagramId, d.id)),
    computeStatuses(projectId),
  ]);
  const nodeIds = nodes.map((n) => n.id);
  const children = nodeIds.length ? await db.select({ key: diagrams.key, title: diagrams.title, parentNodeId: diagrams.parentNodeId }).from(diagrams).where(and(eq(diagrams.projectId, projectId), inArray(diagrams.parentNodeId, nodeIds))) : [];
  const childByNode = new Map(children.map((c) => [c.parentNodeId!, c]));
  const effIds = nodes.map((n) => n.effortId).filter(Boolean) as string[];
  const assIds = nodes.map((n) => n.assertionId).filter(Boolean) as string[];
  const effTitles = effIds.length ? new Map((await db.select({ id: efforts.id, title: efforts.title }).from(efforts).where(inArray(efforts.id, effIds))).map((e) => [e.id, e.title])) : new Map();
  const assHumans = assIds.length ? new Map((await db.select({ id: assertions.id, humanId: assertions.humanId, title: assertions.title }).from(assertions).where(inArray(assertions.id, assIds))).map((a) => [a.id, a])) : new Map();
  const keyById = new Map(nodes.map((n) => [n.id, n.key]));

  // Breadcrumb: walk parentNodeId up to a root.
  const trail: { key: string; title: string }[] = [{ key: d.key, title: d.title }];
  let cur = d, guard = 0;
  while (cur.parentNodeId && guard++ < 20) {
    const parentNode = (await db.select({ diagramId: diagramNodes.diagramId }).from(diagramNodes).where(eq(diagramNodes.id, cur.parentNodeId)))[0];
    if (!parentNode) break;
    const parent = (await db.select().from(diagrams).where(eq(diagrams.id, parentNode.diagramId)))[0];
    if (!parent) break;
    trail.unshift({ key: parent.key, title: parent.title });
    cur = parent;
  }

  return {
    diagram: { id: d.id, key: d.key, title: d.title, description: d.description, direction: d.direction },
    breadcrumb: trail,
    nodes: nodes.map((n) => ({
      id: n.id, key: n.key, label: n.label, kind: n.kind, status: statuses.get(n.id) ?? "none",
      childDiagramKey: childByNode.get(n.id)?.key ?? null,
      effortId: n.effortId, effortTitle: n.effortId ? effTitles.get(n.effortId) ?? null : null,
      assertionId: n.assertionId, assertionHumanId: n.assertionId ? assHumans.get(n.assertionId)?.humanId ?? null : null,
    })),
    edges: edges.map((e) => ({ id: e.id, fromKey: keyById.get(e.fromNodeId) ?? "", toKey: keyById.get(e.toNodeId) ?? "", label: e.label })),
  };
}

export async function listDiagrams(projectId: string) {
  const [all, statuses] = await Promise.all([
    db.select().from(diagrams).where(eq(diagrams.projectId, projectId)),
    computeStatuses(projectId),
  ]);
  const nodes = await db.select({ id: diagramNodes.id, diagramId: diagramNodes.diagramId }).from(diagramNodes).where(eq(diagramNodes.projectId, projectId));
  const byDiagram = new Map<string, string[]>();
  for (const n of nodes) { const arr = byDiagram.get(n.diagramId) ?? []; arr.push(n.id); byDiagram.set(n.diagramId, arr); }
  return {
    diagrams: all.map((d) => {
      const ids = byDiagram.get(d.id) ?? [];
      return { id: d.id, key: d.key, title: d.title, parentNodeId: d.parentNodeId, isRoot: !d.parentNodeId, nodeCount: ids.length, status: aggregate(ids.map((i) => statuses.get(i) ?? "none")) };
    }),
  };
}

export async function createDiagram(projectId: string, input: { title: string; description?: string; direction?: "TD" | "LR"; parentNodeId?: string | null }): Promise<Result<typeof diagrams.$inferSelect>> {
  const taken = new Set((await db.select({ key: diagrams.key }).from(diagrams).where(eq(diagrams.projectId, projectId))).map((r) => r.key));
  const key = keyify(input.title, taken);
  const row = (await db.insert(diagrams).values({ projectId, key, title: input.title, description: input.description ?? "", direction: input.direction ?? "TD", parentNodeId: input.parentNodeId ?? null }).returning())[0]!;
  return { ok: true, value: row };
}

export async function updateDiagram(projectId: string, diagramId: string, input: Partial<{ title: string; description: string; direction: "TD" | "LR" }>) {
  const patch: Record<string, unknown> = {};
  for (const k of ["title", "description", "direction"] as const) if (input[k] !== undefined) patch[k] = input[k];
  if (Object.keys(patch).length) await db.update(diagrams).set(patch).where(and(eq(diagrams.id, diagramId), eq(diagrams.projectId, projectId)));
}

export async function createNode(projectId: string, diagramId: string, input: { label: string; key?: string; kind?: typeof diagramNodes.$inferSelect["kind"]; effortId?: string | null; assertionId?: string | null }): Promise<Result<typeof diagramNodes.$inferSelect>> {
  const existing = await db.select({ key: diagramNodes.key, order: diagramNodes.order }).from(diagramNodes).where(eq(diagramNodes.diagramId, diagramId));
  const key = keyify(input.key || input.label, new Set(existing.map((r) => r.key)));
  const order = existing.reduce((m, r) => Math.max(m, r.order), -1) + 1;
  const row = (await db.insert(diagramNodes).values({ projectId, diagramId, key, label: input.label, kind: input.kind ?? "step", effortId: input.effortId ?? null, assertionId: input.assertionId ?? null, order }).returning())[0]!;
  return { ok: true, value: row };
}

async function resolveNode(diagramId: string, ref: string): Promise<string | null> {
  const byKey = (await db.select({ id: diagramNodes.id }).from(diagramNodes).where(and(eq(diagramNodes.diagramId, diagramId), eq(diagramNodes.key, ref))))[0];
  if (byKey) return byKey.id;
  const byId = (await db.select({ id: diagramNodes.id }).from(diagramNodes).where(and(eq(diagramNodes.diagramId, diagramId), eq(diagramNodes.id, ref))))[0];
  return byId?.id ?? null;
}

export async function createEdge(projectId: string, diagramId: string, input: { from: string; to: string; label?: string }): Promise<Result<typeof diagramEdges.$inferSelect>> {
  const [from, to] = await Promise.all([resolveNode(diagramId, input.from), resolveNode(diagramId, input.to)]);
  if (!from || !to) return { ok: false, code: "NODE_NOT_FOUND", error: "from/to must be node keys or ids in this diagram" };
  const row = (await db.insert(diagramEdges).values({ projectId, diagramId, fromNodeId: from, toNodeId: to, label: input.label ?? "" }).returning())[0]!;
  return { ok: true, value: row };
}

export async function updateNode(projectId: string, nodeId: string, input: Partial<{ label: string; kind: typeof diagramNodes.$inferSelect["kind"]; effortId: string | null; assertionId: string | null; order: number }>) {
  const patch: Record<string, unknown> = {};
  for (const k of ["label", "kind", "effortId", "assertionId", "order"] as const) if (input[k] !== undefined) patch[k] = input[k];
  if (Object.keys(patch).length) await db.update(diagramNodes).set(patch).where(and(eq(diagramNodes.id, nodeId), eq(diagramNodes.projectId, projectId)));
}

export async function deleteNode(projectId: string, nodeId: string) {
  await db.delete(diagramEdges).where(and(eq(diagramEdges.projectId, projectId), inArray(diagramEdges.fromNodeId, [nodeId])));
  await db.delete(diagramEdges).where(and(eq(diagramEdges.projectId, projectId), inArray(diagramEdges.toNodeId, [nodeId])));
  await db.update(diagrams).set({ parentNodeId: null }).where(and(eq(diagrams.projectId, projectId), eq(diagrams.parentNodeId, nodeId)));
  await db.delete(diagramNodes).where(and(eq(diagramNodes.id, nodeId), eq(diagramNodes.projectId, projectId)));
}
export async function deleteEdge(projectId: string, edgeId: string) {
  await db.delete(diagramEdges).where(and(eq(diagramEdges.id, edgeId), eq(diagramEdges.projectId, projectId)));
}
export async function deleteDiagram(projectId: string, diagramId: string) {
  await db.delete(diagramEdges).where(and(eq(diagramEdges.projectId, projectId), eq(diagramEdges.diagramId, diagramId)));
  await db.update(diagrams).set({ parentNodeId: null }).where(eq(diagrams.projectId, projectId)); // detach any children pointing at removed nodes
  await db.delete(diagramNodes).where(and(eq(diagramNodes.projectId, projectId), eq(diagramNodes.diagramId, diagramId)));
  await db.delete(diagrams).where(and(eq(diagrams.id, diagramId), eq(diagrams.projectId, projectId)));
}
