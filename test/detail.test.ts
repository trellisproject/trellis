import { beforeEach, describe, it, expect } from "vitest";
import { ingestSpec } from "../src/lib/ingest.js";
import { writeFact } from "../src/lib/facts.js";
import { resolveDrift } from "../src/lib/drift-resolve.js";
import { getAssertionDetail } from "../src/lib/assertion-detail.js";
import { createEffort, assertionsByEffort } from "../src/lib/efforts.js";
import { resetDb, makeProject } from "./helpers/db.js";

let projectId: string;
let operatorId: string;
const ev = [{ type: "commit" as const, ref: "c" }];

beforeEach(async () => {
  await resetDb();
  ({ projectId, operatorId } = await makeProject());
  await ingestSpec(projectId, "core", `---\nspec: T-X\ntitle: T\n---\n### T-X-001: t\nstatus: agreed\n\nbody\n### T-X-002: u\nstatus: agreed\n\nbody2\n`, "c1");
});

describe("assertion detail hub (TRL-UI-004/010)", () => {
  it("returns linked facts, drifts, tasks, and decisions for an assertion", async () => {
    // contradicting fact -> drift, then resolve fix -> decision + task
    const f = await writeFact(projectId, { observerId: operatorId, key: "k", value: false, statement: "contradiction", evidence: ev, links: [{ assertion: "T-X-001", relation: "contradicts" }] });
    if (!f.ok) throw new Error(f.code);
    await resolveDrift(projectId, f.driftsCreated[0]!, { actorId: operatorId, choice: "fix", rationale: "bug" });

    const detail = await getAssertionDetail(projectId, "T-X-001");
    expect(detail).not.toBeNull();
    expect(detail!.facts.length).toBeGreaterThanOrEqual(1);
    expect(detail!.drifts).toHaveLength(1);
    expect(detail!.tasks).toHaveLength(1); // spawned by fix
    expect(detail!.decisions.length).toBeGreaterThanOrEqual(1); // the fix decision
    expect(detail!.statusHistory.length).toBeGreaterThanOrEqual(1);
  });

  it("returns null for an unknown assertion", async () => {
    expect(await getAssertionDetail(projectId, "T-X-999")).toBeNull();
  });
});

describe("effort breakdown (roadmap legibility)", () => {
  it("lists an effort's assertions with their live status", async () => {
    const m = await createEffort(projectId, { title: "M1", assertions: ["T-X-001", "T-X-002"] });
    if (!m.ok) throw new Error(m.code);
    const byMs = await assertionsByEffort(projectId);
    const list = byMs.get(m.value.id)!;
    expect(list.map((a) => a.humanId)).toEqual(["T-X-001", "T-X-002"]);
    expect(list.every((a) => a.status === "agreed")).toBe(true);
  });
});
