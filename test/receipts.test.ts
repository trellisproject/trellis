import { beforeEach, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../src/db/index.js";
import { assertions, requests } from "../src/db/schema.js";
import { ingestSpec } from "../src/lib/ingest.js";
import { createRequest, deliverPendingReceipts, linkRequestAssertions } from "../src/lib/requests.js";
import { resetDb, makeProject } from "./helpers/db.js";

let projectId: string;

// A poster that records calls instead of hitting a chat platform.
function recorder() {
  const calls: { provider: string; threadId: string; text: string }[] = [];
  const post = async (provider: string, threadId: string, text: string) => {
    calls.push({ provider, threadId, text });
    return true;
  };
  return { calls, post };
}

async function shippedChatRequest(): Promise<string> {
  // one verified assertion, linked to a slack-sourced request → shipped
  await ingestSpec(projectId, "core", `---\nspec: T-X\ntitle: T\n---\n### T-X-001: t\nstatus: agreed\n\nbody\n`, "c1");
  await db.update(assertions).set({ status: "verified" }).where(eq(assertions.humanId, "T-X-001"));
  const req = await createRequest(projectId, {
    title: "bulk export",
    body: "add bulk export",
    requester: "slack:U1",
    source: "slack",
    sourceRef: "slack:C1:1783600000.0001",
  });
  await linkRequestAssertions(projectId, req.id, ["T-X-001"]);
  return req.id;
}

beforeEach(async () => {
  await resetDb();
  ({ projectId } = await makeProject());
});

describe("shipped-request receipts (TRL-CORE-045 / TRL-API-017)", () => {
  it("delivers a receipt to the origin thread once a request has shipped", async () => {
    const rid = await shippedChatRequest();
    const { calls, post } = recorder();
    const r = await deliverPendingReceipts(projectId, post);

    expect(r.delivered).toEqual([rid]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.provider).toBe("slack");
    expect(calls[0]!.threadId).toBe("slack:C1:1783600000.0001"); // the source_ref
    expect(calls[0]!.text).toContain("bulk export");
    expect(calls[0]!.text).toContain("T-X-001"); // names the verifying assertion
    const row = (await db.select().from(requests).where(eq(requests.id, rid)))[0]!;
    expect(row.receiptDeliveredAt).not.toBeNull();
  });

  it("is idempotent — a second sweep does not re-post", async () => {
    await shippedChatRequest();
    const first = recorder();
    await deliverPendingReceipts(projectId, first.post);
    expect(first.calls).toHaveLength(1);

    const second = recorder();
    const r2 = await deliverPendingReceipts(projectId, second.post);
    expect(second.calls).toHaveLength(0);
    expect(r2.delivered).toEqual([]);
  });

  it("does not deliver for a request that has not shipped", async () => {
    // linked assertion stays 'agreed', not verified → not shipped
    await ingestSpec(projectId, "core", `---\nspec: T-X\ntitle: T\n---\n### T-X-001: t\nstatus: agreed\n\nbody\n`, "c1");
    const req = await createRequest(projectId, { title: "x", body: "a", requester: "slack:U1", source: "slack", sourceRef: "slack:C1:2" });
    await linkRequestAssertions(projectId, req.id, ["T-X-001"]);
    const { calls, post } = recorder();
    const r = await deliverPendingReceipts(projectId, post);
    expect(calls).toHaveLength(0);
    expect(r.delivered).toEqual([]);
  });

  it("ignores non-chat requests (no source_ref to reply to)", async () => {
    await ingestSpec(projectId, "core", `---\nspec: T-X\ntitle: T\n---\n### T-X-001: t\nstatus: agreed\n\nbody\n`, "c1");
    await db.update(assertions).set({ status: "verified" }).where(eq(assertions.humanId, "T-X-001"));
    const req = await createRequest(projectId, { title: "verbal ask", body: "x", requester: "Andreas", source: "verbal" });
    await linkRequestAssertions(projectId, req.id, ["T-X-001"]);
    const { calls } = recorder();
    const r = await deliverPendingReceipts(projectId, recorder().post);
    expect(r.delivered).toEqual([]);
  });
});
