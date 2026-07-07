import { beforeEach, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../src/db/index.js";
import { assertions, drifts } from "../src/db/schema.js";
import { parseSpec } from "../src/lib/spec-parse.js";
import { ingestSpec } from "../src/lib/ingest.js";
import { writeFact } from "../src/lib/facts.js";
import { resetDb, makeProject } from "./helpers/db.js";

const ev = [{ type: "test" as const, ref: "bench-run" }];
let projectId: string;
let operatorId: string;

const spec = (status: string, metric: string) =>
  `---\nspec: KOJI\ntitle: K\n---\n### KOJI-EXT-014: ACORD-125 accuracy\nstatus: ${status}\n${metric}\n\nExtraction accuracy on the ACORD-125 corpus is at least 95%.\n`;

async function measure(v: number) {
  return writeFact(projectId, {
    observerId: operatorId, key: "bench", value: v, statement: `ACORD-125 accuracy: ${v}%`,
    evidence: ev, metricKey: "extraction.accuracy.acord-125", measuredValue: v,
  });
}
const status = async () => (await db.select().from(assertions).where(eq(assertions.humanId, "KOJI-EXT-014")))[0]!.status;
const openDrifts = async () => db.select().from(drifts).where(eq(drifts.assertionId, (await db.select().from(assertions).where(eq(assertions.humanId, "KOJI-EXT-014")))[0]!.id));

beforeEach(async () => {
  await resetDb();
  ({ projectId, operatorId } = await makeProject());
});

describe("metric assertion parsing", () => {
  it("parses a metric: line into key/comparator/target/unit", () => {
    const r = parseSpec(spec("agreed", "metric: extraction.accuracy.acord-125 >= 95 %"));
    expect(r.errors).toEqual([]);
    expect(r.assertions[0]!.metric).toEqual({ key: "extraction.accuracy.acord-125", comparator: "gte", target: 95, unit: "%" });
  });

  it("ingests the metric definition onto the assertion", async () => {
    await ingestSpec(projectId, "koji", spec("agreed", "metric: extraction.accuracy.acord-125 >= 95%"), "c1");
    const a = (await db.select().from(assertions).where(eq(assertions.humanId, "KOJI-EXT-014")))[0]!;
    expect(a.metricKey).toBe("extraction.accuracy.acord-125");
    expect(a.metricComparator).toBe("gte");
    expect(a.metricTarget).toBe(95);
  });
});

describe("the metric loop (TRL-CORE-038)", () => {
  beforeEach(async () => {
    await ingestSpec(projectId, "koji", spec("agreed", "metric: extraction.accuracy.acord-125 >= 95%"), "c1");
  });

  it("a below-threshold measurement drifts the assertion automatically", async () => {
    const r = await measure(92.3);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.driftsCreated).toHaveLength(1);
    expect(await status()).toBe("drifted");
  });

  it("an at-or-above measurement verifies the assertion", async () => {
    const r = await measure(96.1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.verified).toEqual(["KOJI-EXT-014"]);
    expect(await status()).toBe("verified");
  });

  it("recovery auto-resolves the drift and verifies (self-healing loop)", async () => {
    await measure(92.3); // drift
    expect(await status()).toBe("drifted");
    const r = await measure(95.4); // recover
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.verified).toEqual(["KOJI-EXT-014"]);
    expect(await status()).toBe("verified");
    const ds = await openDrifts();
    expect(ds.every((d) => d.status === "resolved")).toBe(true); // the drift closed
  });

  it("a regression after verified re-drifts", async () => {
    await measure(96); // verified
    expect(await status()).toBe("verified");
    await measure(90); // regression
    expect(await status()).toBe("drifted");
  });

  it("does not double-file drift while still below threshold", async () => {
    await measure(92);
    await measure(91);
    const ds = (await openDrifts()).filter((d) => d.status !== "resolved");
    expect(ds).toHaveLength(1); // second contradiction attaches, no new drift
  });
});
