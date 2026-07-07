import { beforeEach, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../src/db/index.js";
import { assertions, drifts } from "../src/db/schema.js";
import { ingestSpec } from "../src/lib/ingest.js";
import { writeFact } from "../src/lib/facts.js";
import { createRequest, decideRequest } from "../src/lib/requests.js";
import { createTask } from "../src/lib/tasks.js";
import { agreeAssertion, retireAssertion } from "../src/lib/assertion-transition.js";
import { worklist } from "../src/lib/worklist.js";
import { resetDb, makeProject, addMember } from "./helpers/db.js";

let projectId: string;
let operatorId: string;
const ev = [{ type: "commit" as const, ref: "c" }];

beforeEach(async () => {
  await resetDb();
  ({ projectId, operatorId } = await makeProject());
});

describe("agree transition (proposed -> agreed)", () => {
  it("agrees a proposed assertion via a decision", async () => {
    await ingestSpec(projectId, "s", `---\nspec: T-X\ntitle: T\n---\n### T-X-001: t\nstatus: proposed\n\nb\n`, "c1");
    const r = await agreeAssertion(projectId, "T-X-001", { actorId: operatorId, rationale: "reviewed, in scope" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.status).toBe("agreed");
    expect((await db.select().from(assertions).where(eq(assertions.humanId, "T-X-001")))[0]!.status).toBe("agreed");
  });

  it("requires rationale and operator authority", async () => {
    await ingestSpec(projectId, "s", `---\nspec: T-X\ntitle: T\n---\n### T-X-001: t\nstatus: proposed\n\nb\n`, "c1");
    const noReason = await agreeAssertion(projectId, "T-X-001", { actorId: operatorId, rationale: " " });
    expect(noReason.ok).toBe(false);
    const member = await addMember(projectId, "human", "member");
    const notOp = await agreeAssertion(projectId, "T-X-001", { actorId: member, rationale: "x" });
    expect(notOp.ok).toBe(false);
    if (!notOp.ok) expect(notOp.code).toBe("NOT_OPERATOR");
  });

  it("cannot agree an assertion that is not proposed", async () => {
    await ingestSpec(projectId, "s", `---\nspec: T-X\ntitle: T\n---\n### T-X-001: t\nstatus: agreed\n\nb\n`, "c1");
    const r = await agreeAssertion(projectId, "T-X-001", { actorId: operatorId, rationale: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INVALID_STATE");
  });

  it("retires a live assertion", async () => {
    await ingestSpec(projectId, "s", `---\nspec: T-X\ntitle: T\n---\n### T-X-001: t\nstatus: agreed\n\nb\n`, "c1");
    const r = await retireAssertion(projectId, "T-X-001", { actorId: operatorId, rationale: "obsolete" });
    expect(r.ok).toBe(true);
    expect((await db.select().from(assertions).where(eq(assertions.humanId, "T-X-001")))[0]!.status).toBe("retired");
  });
});

describe("worklist buckets", () => {
  it("routes each object to the right bucket", async () => {
    // proposed -> agree bucket; agreed (no task) -> build; implemented -> verify
    await ingestSpec(projectId, "s", `---\nspec: T-X\ntitle: T\n---\n### T-X-001: a\nstatus: proposed\n\nb\n### T-X-002: b\nstatus: agreed\n\nb\n### T-X-003: c\nstatus: implemented\n\nb\n`, "c1");
    // a new request -> decide; an accepted request w/o assertions -> specify
    const rNew = await createRequest(projectId, { title: "new ask", requester: "cust" });
    const rAcc = await createRequest(projectId, { title: "accepted ask", requester: "cust" });
    await decideRequest(projectId, rAcc.id, { actorId: operatorId, choice: "accept", rationale: "yes" });
    // a drift -> decide
    const f = await writeFact(projectId, { observerId: operatorId, key: "k", value: false, statement: "no", evidence: ev, links: [{ assertion: "T-X-002", relation: "contradicts" }] });
    if (!f.ok) throw new Error(f.code);

    const wl = await worklist(projectId);
    expect(wl.decide.map((i) => i.kind).sort()).toEqual(["drift", "request"]); // new request + drift
    expect(wl.specify.map((i) => i.id)).toEqual([rAcc.id]);
    expect(wl.agree.map((i) => i.ref)).toEqual(["T-X-001"]);
    // T-X-002 drifted (not agreed anymore) so it's not in build; T-X-003 implemented -> verify
    expect(wl.verify.map((i) => i.ref)).toEqual(["T-X-003"]);
    void rNew;
  });

  it("an agreed assertion with an active task leaves the build bucket", async () => {
    await ingestSpec(projectId, "s", `---\nspec: T-X\ntitle: T\n---\n### T-X-001: a\nstatus: agreed\n\nb\n`, "c1");
    expect((await worklist(projectId)).build.map((i) => i.ref)).toEqual(["T-X-001"]);
    await createTask(projectId, { title: "build it", assertions: ["T-X-001"] });
    expect((await worklist(projectId)).build).toEqual([]);
  });

  it("orders a bucket by priority (now before normal before later)", async () => {
    const a = await createRequest(projectId, { title: "later one", requester: "c", priority: "later" });
    const b = await createRequest(projectId, { title: "now one", requester: "c", priority: "now" });
    const c = await createRequest(projectId, { title: "normal one", requester: "c" });
    const decide = (await worklist(projectId)).decide;
    expect(decide.map((i) => i.title)).toEqual(["now one", "normal one", "later one"]);
    void [a, b, c];
  });
});
