import { beforeEach, describe, it, expect } from "vitest";
import { app } from "../src/app.js";
import { resetDb, makeProject, addMember, authFor } from "./helpers/db.js";

const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

let projectId: string;
let memberId: string;
let chatId: string;

beforeEach(async () => {
  await resetDb();
  ({ projectId } = await makeProject());
  memberId = await addMember(projectId, "human", "member", "Dana");
  chatId = await addMember(projectId, "agent", "member", "slack-bot");
});

describe("chat capture substrate (TRL-CORE-043/046/047, TRL-API-015/016)", () => {
  it("records the capturing principal, distinct from the asker (TRL-CORE-043)", async () => {
    const auth = await authFor(projectId, memberId);
    const res = await app.request(
      `/projects/${projectId}/requests`,
      json({ title: "NAIC code in export", requester: "slack:U024 (dana)", body: "can the export include the NAIC code?" }, auth),
    );
    expect(res.status).toBe(201);
    const { request } = (await res.json()) as any;
    expect(request.requester).toBe("slack:U024 (dana)"); // the asker
    expect(request.capturedBy).toBe(memberId); // the authenticated principal — a different field
  });

  it("stores the verbatim ask and a durable source ref from {type, ref} (TRL-CORE-047)", async () => {
    const auth = await authFor(projectId, chatId, "capture");
    const res = await app.request(
      `/projects/${projectId}/requests`,
      json(
        {
          title: "NAIC code",
          requester: "slack:U024",
          body: "can the export include the carrier NAIC code?",
          source: { type: "slack", ref: "https://acme.slack.com/archives/C1/p1699" },
        },
        auth,
      ),
    );
    expect(res.status).toBe(201);
    const { request } = (await res.json()) as any;
    expect(request.source).toBe("slack");
    expect(request.sourceRef).toBe("https://acme.slack.com/archives/C1/p1699");
    expect(request.body).toContain("NAIC");
  });

  it("rejects a chat capture missing the source ref or the ask (TRL-API-016)", async () => {
    const auth = await authFor(projectId, chatId, "capture");
    const noRef = await app.request(
      `/projects/${projectId}/requests`,
      json({ title: "x", requester: "slack:U1", body: "ask", source: "slack" }, auth),
    );
    expect(noRef.status).toBe(422);
    expect(((await noRef.json()) as any).code).toBe("INCOMPLETE_SOURCE");

    const noAsk = await app.request(
      `/projects/${projectId}/requests`,
      json({ title: "x", requester: "slack:U1", source: { type: "slack", ref: "https://x/y" } }, auth),
    );
    expect(noAsk.status).toBe(422);
  });

  it("allows a member capture without a source (human/UI path is unconstrained)", async () => {
    const auth = await authFor(projectId, memberId);
    const res = await app.request(
      `/projects/${projectId}/requests`,
      json({ title: "internal idea", requester: "Dana" }, auth),
    );
    expect(res.status).toBe(201);
  });

  it("lets a capture-scoped token capture but not decide — no decision from chat (TRL-API-015, TRL-CORE-044)", async () => {
    const chatAuth = await authFor(projectId, chatId, "capture");
    const cap = await app.request(
      `/projects/${projectId}/requests`,
      json({ title: "x", requester: "slack:U1", body: "ask", source: { type: "slack", ref: "https://x/y" } }, chatAuth),
    );
    expect(cap.status).toBe(201);
    const rid = ((await cap.json()) as any).request.id;

    const dec = await app.request(
      `/projects/${projectId}/requests/${rid}/decide`,
      json({ choice: "accept", rationale: "looks good" }, chatAuth),
    );
    expect(dec.status).toBe(403);
    expect(((await dec.json()) as any).code).toBe("CAPTURE_SCOPE");
  });

  it("operator can mint a capture-scoped token that behaves as capture-only (TRL-API-015)", async () => {
    const created = await app.request("/projects", json({ name: "p", operator: { displayName: "Op" } }));
    const { project, token } = (await created.json()) as any;
    const opAuth = { Authorization: `Bearer ${token}` };

    const mint = await app.request(`/projects/${project.id}/tokens`, json({ displayName: "slack", scope: "capture" }, opAuth));
    expect(mint.status).toBe(201);
    const chatToken = ((await mint.json()) as any).token;
    const chatAuth = { Authorization: `Bearer ${chatToken}` };

    const cap = await app.request(
      `/projects/${project.id}/requests`,
      json({ title: "x", requester: "slack:U1", body: "ask", source: { type: "slack", ref: "https://x/y" } }, chatAuth),
    );
    expect(cap.status).toBe(201);

    const rid = ((await cap.json()) as any).request.id;
    const dec = await app.request(
      `/projects/${project.id}/requests/${rid}/decide`,
      json({ choice: "accept", rationale: "x" }, chatAuth),
    );
    expect(dec.status).toBe(403);
  });
});
