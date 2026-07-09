import { beforeEach, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { app } from "../src/app.js";
import { db } from "../src/db/index.js";
import { requests } from "../src/db/schema.js";
import { buildChatCapture, extractWorkspaceId, stripLeadingMentions, __resetBotForTests } from "../src/lib/chat-bot.js";
import { captureFromChat, createChatInstall } from "../src/lib/chat.js";
import { resetDb, makeProject } from "./helpers/db.js";

let projectId: string;

beforeEach(async () => {
  await resetDb();
  ({ projectId } = await makeProject());
  __resetBotForTests();
});

describe("chat transport — event mapping (buildChatCapture)", () => {
  it("maps a Slack mention to capture args with provider, workspace, asker, and ref", () => {
    const cap = buildChatCapture({
      threadId: "slack:C123:T456",
      messageId: "1699.0001",
      text: "  @trellis can the export include the NAIC code?  ",
      author: { userId: "U024", fullName: "Dana" },
      raw: { team_id: "TWORK" },
    });
    expect(cap).toEqual({
      provider: "slack",
      workspaceId: "TWORK",
      channelId: "C123",
      title: "@trellis can the export include the NAIC code?",
      ask: "@trellis can the export include the NAIC code?",
      asker: "slack:U024 (Dana)",
      ref: "slack:C123:T456#1699.0001",
    });
  });

  it("maps a Google Chat event using the space name as workspace", () => {
    const cap = buildChatCapture({
      threadId: "gchat:spaces/AAA:threads/BBB",
      messageId: "m1",
      text: "please add a bulk import",
      author: { userId: "users/9", fullName: "Sam" },
      raw: { space: { name: "spaces/AAA" } },
    });
    expect(cap?.provider).toBe("gchat");
    expect(cap?.workspaceId).toBe("spaces/AAA");
    expect(cap?.asker).toBe("gchat:users/9 (Sam)");
  });

  it("captures with a null workspace when only a channel is present (reaction path)", () => {
    // Slack reactions carry no team id; a channel route still resolves.
    const cap = buildChatCapture({ threadId: "slack:C1:T1", messageId: "1", text: "hi", author: { userId: "U1" }, raw: {} });
    expect(cap).not.toBeNull();
    expect(cap?.workspaceId).toBeNull();
    expect(cap?.channelId).toBe("C1");
  });

  it("returns null for a non-chat thread, empty text, or no routing key", () => {
    expect(buildChatCapture({ threadId: "github:x:y", messageId: "1", text: "hi", author: {}, raw: { team_id: "T" } })).toBeNull();
    expect(buildChatCapture({ threadId: "slack:C1:T1", messageId: "1", text: "   ", author: { userId: "U1" }, raw: { team_id: "T" } })).toBeNull();
    expect(buildChatCapture({ threadId: "slack", messageId: "1", text: "hi", author: {}, raw: {} })).toBeNull(); // no channel, no workspace
  });

  it("extractWorkspaceId reads the known raw fields per provider", () => {
    expect(extractWorkspaceId("slack", { team_id: "T1" })).toBe("T1");
    expect(extractWorkspaceId("slack", { team: { id: "T2" } })).toBe("T2");
    expect(extractWorkspaceId("gchat", { space: { name: "spaces/Z" } })).toBe("spaces/Z");
    expect(extractWorkspaceId("slack", {})).toBeNull();
  });

  it("does not duplicate the ts in ref when the thread id already ends with the message id", () => {
    const cap = buildChatCapture({
      threadId: "slack:C1:1783614252.680839", // top-level message: thread == message ts
      messageId: "1783614252.680839",
      text: "add dark mode",
      author: { userId: "U1" },
      raw: { team_id: "T1" },
    });
    expect(cap?.ref).toBe("slack:C1:1783614252.680839"); // no "#…" duplicate
  });

  it("strips a leading bot mention from the ask", () => {
    expect(stripLeadingMentions("@U0BG5UB4ELV test where we go")).toBe("test where we go");
    expect(stripLeadingMentions("@bot @other please add export")).toBe("please add export");
    expect(stripLeadingMentions("no mention here")).toBe("no mention here");
    expect(stripLeadingMentions("@onlyamention")).toBe("@onlyamention"); // don't empty it
  });
});

describe("chat transport — end to end mapping into a captured request", () => {
  it("a mapped Slack event captures a request against the resolved install", async () => {
    await createChatInstall(projectId, { provider: "slack", workspaceId: "TWORK" });
    const cap = buildChatCapture({
      threadId: "slack:C123:T456",
      messageId: "1699.0001",
      text: "can the export include the carrier NAIC code?",
      author: { userId: "U024", fullName: "Dana" },
      raw: { team_id: "TWORK" },
    })!;
    const r = await captureFromChat(cap);
    expect(r.ok).toBe(true);
    const row = (await db.select().from(requests).where(eq(requests.projectId, projectId)))[0]!;
    expect(row.source).toBe("slack");
    expect(row.sourceRef).toBe("slack:C123:T456#1699.0001");
    expect(row.requester).toBe("slack:U024 (Dana)");
    expect(row.body).toContain("NAIC");
  });
});

describe("chat transport — webhook route", () => {
  const post = (path: string) => app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });

  it("returns 404 for an unknown provider", async () => {
    const res = await post(`/integrations/chat/telegram`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as any).code).toBe("UNKNOWN_PROVIDER");
  });

  it("returns 503 when the provider has no configured credentials", async () => {
    // No SLACK_BOT_TOKEN/SIGNING_SECRET in the test env → bot is not built.
    const res = await post(`/integrations/chat/slack`);
    expect(res.status).toBe(503);
    expect(((await res.json()) as any).code).toBe("CHAT_NOT_CONFIGURED");
  });
});
