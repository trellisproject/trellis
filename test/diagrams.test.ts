import { beforeEach, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../src/db/index.js";
import { assertions } from "../src/db/schema.js";
import { ingestSpec } from "../src/lib/ingest.js";
import { createEffort } from "../src/lib/efforts.js";
import { createDiagram, createEdge, createNode, getDiagram, listDiagrams } from "../src/lib/diagrams.js";
import { resetDb, makeProject } from "./helpers/db.js";

let projectId: string;

async function seed(ids: string[]) {
  const block = ids.map((id) => `### ${id}: t\nstatus: agreed\n\nbody ${id}\n`).join("\n");
  await ingestSpec(projectId, "core", `---\nspec: T-X\ntitle: T\n---\n${block}`, "c1");
}
const setStatus = (h: string, s: string) => db.update(assertions).set({ status: s as "verified" }).where(eq(assertions.humanId, h));
const assertId = async (h: string) => (await db.select({ id: assertions.id }).from(assertions).where(eq(assertions.humanId, h)))[0]!.id;

beforeEach(async () => {
  await resetDb();
  ({ projectId } = await makeProject());
});

describe("diagrams — the drift-colored map", () => {
  it("colors a node by its anchored assertion status", async () => {
    await seed(["T-X-001"]);
    const d = await createDiagram(projectId, { title: "Flow" });
    if (!d.ok) throw new Error(d.error);
    await createNode(projectId, d.value.id, { label: "Step", assertionId: await assertId("T-X-001") });
    expect((await getDiagram(projectId, d.value.key))!.nodes[0]!.status).toBe("progress"); // agreed
    await setStatus("T-X-001", "verified");
    expect((await getDiagram(projectId, d.value.key))!.nodes[0]!.status).toBe("verified");
    await setStatus("T-X-001", "drifted");
    expect((await getDiagram(projectId, d.value.key))!.nodes[0]!.status).toBe("drifted");
  });

  it("derives an effort node from its assertions — any drift wins", async () => {
    await seed(["T-X-001", "T-X-002"]);
    const eff = await createEffort(projectId, { title: "Area", assertions: ["T-X-001", "T-X-002"] });
    if (!eff.ok) throw new Error(eff.code);
    await setStatus("T-X-001", "verified");
    await setStatus("T-X-002", "verified");
    const d = await createDiagram(projectId, { title: "Flow" });
    if (!d.ok) throw new Error(d.error);
    await createNode(projectId, d.value.id, { label: "Area", effortId: eff.value.id });
    expect((await getDiagram(projectId, d.value.key))!.nodes[0]!.status).toBe("verified");
    await setStatus("T-X-002", "drifted");
    expect((await getDiagram(projectId, d.value.key))!.nodes[0]!.status).toBe("drifted");
  });

  it("propagates drift up from a child diagram to the parent subflow node", async () => {
    await seed(["T-X-001"]);
    const parent = await createDiagram(projectId, { title: "System" });
    if (!parent.ok) throw new Error(parent.error);
    const sub = await createNode(projectId, parent.value.id, { label: "Subsystem", kind: "subflow" });
    if (!sub.ok) throw new Error(sub.error);
    const child = await createDiagram(projectId, { title: "Detail", parentNodeId: sub.value.id });
    if (!child.ok) throw new Error(child.error);
    await createNode(projectId, child.value.id, { label: "leaf", assertionId: await assertId("T-X-001") });
    await setStatus("T-X-001", "verified");
    let got = (await getDiagram(projectId, parent.value.key))!;
    expect(got.nodes[0]!.status).toBe("verified");
    expect(got.nodes[0]!.childDiagramKey).toBe(child.value.key);
    await setStatus("T-X-001", "drifted");
    got = (await getDiagram(projectId, parent.value.key))!;
    expect(got.nodes[0]!.status).toBe("drifted"); // up-propagation
  });

  it("a node that both anchors a spec and drills into a child surfaces drift from either", async () => {
    await seed(["T-X-001", "T-X-002"]);
    const eff = await createEffort(projectId, { title: "Area", assertions: ["T-X-001"] });
    if (!eff.ok) throw new Error(eff.code);
    await setStatus("T-X-001", "verified"); // own anchor verified
    const parent = await createDiagram(projectId, { title: "System" });
    if (!parent.ok) throw new Error(parent.error);
    const sub = await createNode(projectId, parent.value.id, { label: "Sub", effortId: eff.value.id });
    if (!sub.ok) throw new Error(sub.error);
    const child = await createDiagram(projectId, { title: "Child", parentNodeId: sub.value.id });
    if (!child.ok) throw new Error(child.error);
    await createNode(projectId, child.value.id, { label: "leaf", assertionId: await assertId("T-X-002") });
    await setStatus("T-X-002", "verified");
    expect((await getDiagram(projectId, parent.value.key))!.nodes[0]!.status).toBe("verified");
    await setStatus("T-X-002", "drifted"); // child drifts even though own anchor is verified
    expect((await getDiagram(projectId, parent.value.key))!.nodes[0]!.status).toBe("drifted");
  });

  it("resolves edges by node key and builds a breadcrumb up the hierarchy", async () => {
    const parent = await createDiagram(projectId, { title: "System" });
    if (!parent.ok) throw new Error(parent.error);
    const a = await createNode(projectId, parent.value.id, { label: "A" });
    const b = await createNode(projectId, parent.value.id, { label: "B" });
    if (!a.ok || !b.ok) throw new Error("node");
    const e = await createEdge(projectId, parent.value.id, { from: a.value.key, to: b.value.key, label: "go" });
    expect(e.ok).toBe(true);
    const sub = await createNode(projectId, parent.value.id, { label: "Sub", kind: "subflow" });
    if (!sub.ok) throw new Error("sub");
    const child = await createDiagram(projectId, { title: "Child", parentNodeId: sub.value.id });
    if (!child.ok) throw new Error("child");
    expect((await getDiagram(projectId, child.value.key))!.breadcrumb.map((x) => x.title)).toEqual(["System", "Child"]);
    expect((await getDiagram(projectId, parent.value.key))!.edges[0]).toMatchObject({ fromKey: a.value.key, toKey: b.value.key, label: "go" });
  });

  it("lists diagrams with a root flag", async () => {
    const d = await createDiagram(projectId, { title: "Root" });
    if (!d.ok) throw new Error(d.error);
    expect((await listDiagrams(projectId)).diagrams.find((x) => x.key === d.value.key)).toMatchObject({ isRoot: true, nodeCount: 0 });
  });
});
