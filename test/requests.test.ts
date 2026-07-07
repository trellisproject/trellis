import { beforeEach, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../src/db/index.js";
import { assertions } from "../src/db/schema.js";
import { ingestSpec } from "../src/lib/ingest.js";
import { createRequest, decideRequest, getRequest, linkRequestAssertions } from "../src/lib/requests.js";
import { resetDb, makeProject, addMember } from "./helpers/db.js";

let projectId: string;
let operatorId: string;

beforeEach(async () => {
  await resetDb();
  ({ projectId, operatorId } = await makeProject());
  await ingestSpec(projectId, "core", `---\nspec: T-X\ntitle: T\n---\n### T-X-001: t\nstatus: agreed\n\nbody\n### T-X-002: u\nstatus: agreed\n\nbody2\n`, "c1");
});

describe("requests — capture → spec → ship (TRL-CORE-030..033)", () => {
  it("captures a request as new intent-to-be", async () => {
    const r = await createRequest(projectId, { title: "Bulk export", requester: "customer: Acme", source: "email" });
    expect(r.status).toBe("new");
    expect(r.requester).toBe("customer: Acme");
  });

  it("accepting is a decision requiring rationale (TRL-CORE-031)", async () => {
    const r = await createRequest(projectId, { title: "x", requester: "y" });
    const noReason = await decideRequest(projectId, r.id, { actorId: operatorId, choice: "accept", rationale: "  " });
    expect(noReason.ok).toBe(false);
    if (!noReason.ok) expect(noReason.code).toBe("MISSING_RATIONALE");
    const ok = await decideRequest(projectId, r.id, { actorId: operatorId, choice: "accept", rationale: "valuable, in scope" });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.status).toBe("accepted");
  });

  it("declining retains the reason and can't be re-decided", async () => {
    const r = await createRequest(projectId, { title: "x", requester: "y" });
    const dec = await decideRequest(projectId, r.id, { actorId: operatorId, choice: "decline", rationale: "out of scope for v1" });
    expect(dec.ok).toBe(true);
    const again = await decideRequest(projectId, r.id, { actorId: operatorId, choice: "accept", rationale: "changed mind" });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe("ALREADY_DECIDED");
  });

  it("a plain member cannot decide a request (needs operator/delegation)", async () => {
    const r = await createRequest(projectId, { title: "x", requester: "y" });
    const member = await addMember(projectId, "human", "member");
    const dec = await decideRequest(projectId, r.id, { actorId: member, choice: "accept", rationale: "yes" });
    expect(dec.ok).toBe(false);
    if (!dec.ok) expect(dec.code).toBe("NOT_OPERATOR");
  });

  it("links derived assertions and ships only when all are verified (TRL-CORE-032/033)", async () => {
    const r = await createRequest(projectId, { title: "x", requester: "y" });
    await decideRequest(projectId, r.id, { actorId: operatorId, choice: "accept", rationale: "yes" });
    await linkRequestAssertions(projectId, r.id, ["T-X-001", "T-X-002"]);

    let view = (await getRequest(projectId, r.id))!;
    expect(view.derived).toHaveLength(2);
    expect(view.shipped).toBe(false); // nothing verified yet

    await db.update(assertions).set({ status: "verified" }).where(eq(assertions.humanId, "T-X-001"));
    expect((await getRequest(projectId, r.id))!.shipped).toBe(false); // one still unverified

    await db.update(assertions).set({ status: "verified" }).where(eq(assertions.humanId, "T-X-002"));
    expect((await getRequest(projectId, r.id))!.shipped).toBe(true); // all verified -> shipped
  });

  it("a request with no derived assertions is never shipped", async () => {
    const r = await createRequest(projectId, { title: "x", requester: "y" });
    await decideRequest(projectId, r.id, { actorId: operatorId, choice: "accept", rationale: "yes" });
    expect((await getRequest(projectId, r.id))!.shipped).toBe(false);
  });

  it("rejects linking an unknown assertion", async () => {
    const r = await createRequest(projectId, { title: "x", requester: "y" });
    const res = await linkRequestAssertions(projectId, r.id, ["T-X-999"]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("UNKNOWN_ASSERTION");
  });
});
