import { beforeEach, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../src/db/index.js";
import { assertions } from "../src/db/schema.js";
import { createSpec, createAssertion, editAssertion, renderSpec } from "../src/lib/authoring.js";
import { ingestSpec } from "../src/lib/ingest.js";
import { parseSpec } from "../src/lib/spec-parse.js";
import { resetDb, makeProject } from "./helpers/db.js";

let projectId: string;

beforeEach(async () => {
  await resetDb();
  ({ projectId } = await makeProject());
});

describe("in-app authoring (Trellis owns intent, TRL-CORE-021)", () => {
  it("creates a spec and auto-numbers assertion ids from its code", async () => {
    const s = await createSpec(projectId, { slug: "core", title: "Core", code: "KOJI-CORE" });
    expect(s.ok).toBe(true);
    const a1 = await createAssertion(projectId, "core", { title: "one", statement: "must one" });
    const a2 = await createAssertion(projectId, "core", { title: "two", statement: "must two" });
    if (a1.ok && a2.ok) {
      expect(a1.value.humanId).toBe("KOJI-CORE-001");
      expect(a2.value.humanId).toBe("KOJI-CORE-002");
      expect(a1.value.status).toBe("proposed");
    }
  });

  it("continues numbering after imported assertions", async () => {
    await ingestSpec(projectId, "core", `---\nspec: KOJI-CORE\ntitle: C\n---\n### KOJI-CORE-005: t\nstatus: agreed\n\nbody\n`, "c1");
    const a = await createAssertion(projectId, "core", { title: "new", statement: "authored in-app" });
    if (a.ok) expect(a.value.humanId).toBe("KOJI-CORE-006");
  });

  it("creates a metric assertion from a metric expression", async () => {
    await createSpec(projectId, { slug: "koji", title: "K", code: "KOJI-EXT" });
    const a = await createAssertion(projectId, "koji", { title: "accuracy", statement: "acc high", metric: { key: "acc.acord125", comparator: "gte", target: 95, unit: "%" } });
    if (a.ok) {
      expect(a.value.metricKey).toBe("acc.acord125");
      expect(a.value.metricTarget).toBe(95);
    }
  });

  it("edits a statement (statements are editable in Trellis now)", async () => {
    await createSpec(projectId, { slug: "core", title: "C", code: "X" });
    const a = await createAssertion(projectId, "core", { title: "t", statement: "original wording" });
    if (!a.ok) throw new Error(a.code);
    const e = await editAssertion(projectId, a.value.humanId, { statement: "clarified wording" });
    expect(e.ok).toBe(true);
    const row = (await db.select().from(assertions).where(eq(assertions.humanId, a.value.humanId)))[0]!;
    expect(row.statement).toBe("clarified wording");
    expect(row.version).toBe(a.value.version + 1);
  });

  it("renders the git mirror and it round-trips through the parser", async () => {
    await createSpec(projectId, { slug: "core", title: "Core Spec", code: "KOJI-CORE" });
    await createAssertion(projectId, "core", { title: "First", statement: "The system must do X.", status: "agreed" });
    await createAssertion(projectId, "core", { title: "Metric one", statement: "Accuracy holds.", metric: { key: "acc", comparator: "gte", target: 90, unit: "%" } });
    const md = await renderSpec(projectId, "core");
    expect(md).toBeTruthy();
    const parsed = parseSpec(md!);
    expect(parsed.errors).toEqual([]);
    expect(parsed.frontmatter.spec).toBe("KOJI-CORE");
    expect(parsed.assertions.map((a) => a.humanId)).toEqual(["KOJI-CORE-001", "KOJI-CORE-002"]);
    expect(parsed.assertions[1]!.metric).toEqual({ key: "acc", comparator: "gte", target: 90, unit: "%" });
  });

  it("rejects a duplicate spec slug", async () => {
    await createSpec(projectId, { slug: "core", title: "C", code: "X" });
    const dup = await createSpec(projectId, { slug: "core", title: "C2", code: "Y" });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.code).toBe("SLUG_TAKEN");
  });
});
