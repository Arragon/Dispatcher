import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  AttentionNotificationPolicy,
  ConnectorError,
  ConversationBindingService,
  MemoryMessagingStateStore,
  MessagingIdentityService,
  SecureDashboardLinkIssuer,
  SlackMessagingConnector,
  type SlackConnectorOptions,
} from "../src/index.js";

const fixedNow = new Date("2026-09-22T12:00:00.000Z");
const signingSecret = "signing-secret";
const timestamp = String(Math.floor(fixedNow.getTime() / 1_000));

function connector(fetcher: SlackConnectorOptions["fetch"] = async () => new Response(JSON.stringify({ ok: true, ts: "123.456" }), { status: 200 })): SlackMessagingConnector {
  return new SlackMessagingConnector({
    instance: { id: "slack-main", definitionId: "messaging.slack", kind: "messaging", displayName: "Slack", enabled: true, health: "HEALTHY", revision: 1, updatedAt: fixedNow.toISOString() },
    signingSecretRef: "secret://slack/signing",
    botTokenRef: "secret://slack/bot",
    resolveSecret: async (reference) => reference.endsWith("signing") ? signingSecret : "xoxb-hidden",
    fetch: fetcher,
    clock: () => fixedNow,
  });
}

function signed(body: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-slack-request-timestamp": timestamp,
    "x-slack-signature": `v0=${createHmac("sha256", signingSecret).update(`v0:${timestamp}:${body}`).digest("hex")}`,
  };
}

describe("Slack MessagingAdapter v1", () => {
  it("verifies exact raw bytes, normalizes threads and rejects replay", async () => {
    const adapter = connector();
    const body = JSON.stringify({ event_id: "Ev1", event: { type: "message", ts: "100.1", thread_ts: "99.9", channel: "C1", user: "U1", text: "task status INH-42" } });
    await expect(adapter.ingress(Buffer.from(body), signed(body))).resolves.toMatchObject({
      kind: "message",
      message: { conversationId: "C1", threadId: "99.9", principalExternalId: "U1", text: "task status INH-42", idempotencyKey: "slack-main:Ev1" },
    });
    await expect(adapter.ingress(Buffer.from(body), signed(body))).rejects.toMatchObject({ code: "CONFLICT" });
    const altered = `${body} `;
    await expect(adapter.ingress(Buffer.from(altered), signed(body))).rejects.toMatchObject({ code: "AUTH" });
  });

  it("deduplicates outbound replies and keeps tokens out of results", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true, ts: "123.456" }), { status: 200 }));
    const adapter = connector(fetcher);
    const first = await adapter.reply!({ channel: "C1", threadId: "99.9", text: "Ready" }, "reply-1");
    const duplicate = await adapter.reply!({ channel: "C1", threadId: "99.9", text: "Ready" }, "reply-1");
    expect(first).toEqual(duplicate);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(JSON.stringify(first)).not.toContain("xoxb-hidden");
  });

  it("uploads declared files once in the original thread", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => new Response(JSON.stringify(String(input).endsWith("/files.upload") ? { ok: true, file: { id: "F1" } } : { ok: true, ts: "123.456" }), { status: 200 }));
    const adapter = connector(fetcher);
    const message = { channel: "C1", threadId: "99.9", text: "Evidence", files: [{ name: "gate.txt", content: new TextEncoder().encode("passed"), mediaType: "text/plain" }] };
    await adapter.reply!(message, "reply-file-1");
    await adapter.reply!(message, "reply-file-1");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[1]![0]).endsWith("/files.upload")).toBe(true);
    expect(fetcher.mock.calls[1]![1]?.body).toBeInstanceOf(FormData);
  });

  it("enforces linked principals, one intervention per thread and stale generation checks", () => {
    const store = new MemoryMessagingStateStore();
    const identities = new MessagingIdentityService(store);
    expect(() => identities.authorize("slack-main", "U1")).toThrow(ConnectorError);
    identities.link({ connectorInstanceId: "slack-main", externalPrincipalId: "U1", principalId: "user-1", roles: ["operator"] });
    expect(identities.authorize("slack-main", "U1", "operator")).toMatchObject({ principalId: "user-1" });
    const conversations = new ConversationBindingService(store);
    const waiting = conversations.bind({ connectorInstanceId: "slack-main", conversationId: "C1", threadId: "T1", taskId: "task-1", runId: "run-1", sessionId: "session-1", generation: 3, state: "WAITING_USER" });
    expect(() => conversations.resume(waiting.id, { expectedRevision: 1, generation: 2 })).toThrow(ConnectorError);
    expect(conversations.resume(waiting.id, { expectedRevision: 1, generation: 3 })).toMatchObject({ state: "ACTIVE", revision: 2, sessionId: "session-1" });
  });

  it("notifies attention states once per cooldown and issues short-lived dashboard tickets", () => {
    const policy = new AttentionNotificationPolicy(1_000);
    expect(policy.shouldNotify({ taskId: "task-1", state: "RUNNING", generation: 1, now: fixedNow })).toBe(false);
    expect(policy.shouldNotify({ taskId: "task-1", state: "WAITING_USER", generation: 1, now: fixedNow })).toBe(true);
    expect(policy.shouldNotify({ taskId: "task-1", state: "WAITING_USER", generation: 1, now: fixedNow })).toBe(false);
    expect(policy.shouldNotify({ taskId: "task-1", state: "REVIEW_READY", generation: 1, now: fixedNow })).toBe(true);
    expect(policy.shouldNotify({ taskId: "connector-1", state: "SYNC_CONFLICT", generation: 1, now: fixedNow })).toBe(true);
    expect(policy.shouldNotify({ taskId: "runner-1", state: "RUNNER_OFFLINE", generation: 1, now: fixedNow })).toBe(true);
    const issuer = new SecureDashboardLinkIssuer("https://dispatcher.example", "ticket-key");
    const url = new URL(issuer.issue({ principalId: "user-1", taskId: "task-1", expiresAt: "2026-09-22T12:05:00.000Z" }));
    expect(issuer.verify(url.searchParams.get("ticket")!, fixedNow)).toMatchObject({ principalId: "user-1", taskId: "task-1" });
    expect(url.toString()).not.toContain("xoxb");
  });
});

describe("ConversationBinding optional control epoch", () => {
  const input = {
    connectorInstanceId: "slack-main", conversationId: "C1", threadId: "T1",
    taskId: "task-1", runId: "run-1", sessionId: "exact-native-session",
    generation: 3, state: "WAITING_USER" as const,
  };
  type BindInput = Parameters<ConversationBindingService["bind"]>[0] & { controlEpoch?: number };

  it("leaves genuinely legacy bindings without an epoch and accepts a first epoch of zero", () => {
    const store = new MemoryMessagingStateStore();
    const conversations = new ConversationBindingService(store);
    const legacy = conversations.bind(input, fixedNow.toISOString());
    expect(legacy).toEqual({ ...input, id: "slack-main:C1:T1", revision: 1, updatedAt: fixedNow.toISOString() });
    expect(legacy).not.toHaveProperty("controlEpoch");
    expect(conversations.bind(input, fixedNow.toISOString())).toEqual(legacy);
    const zero = conversations.bind({ ...input, threadId: "T0", controlEpoch: 0 } as BindInput, fixedNow.toISOString());
    expect(zero).toEqual({ ...input, threadId: "T0", controlEpoch: 0, id: "slack-main:C1:T0", revision: 1, updatedAt: fixedNow.toISOString() });
    expect(store.getConversation(zero.id)).toEqual(zero);
  });

  it("increments revision once per effective epoch change and fences stale resumes", () => {
    const store = new MemoryMessagingStateStore();
    const conversations = new ConversationBindingService(store);
    const legacy = conversations.bind(input, fixedNow.toISOString());
    const known = conversations.bind({ ...input, controlEpoch: 1 } as BindInput, "2026-09-22T12:00:01.000Z");
    expect(known).toEqual({ ...input, controlEpoch: 1, id: legacy.id, revision: 2, updatedAt: "2026-09-22T12:00:01.000Z" });
    expect(conversations.bind({ ...input, controlEpoch: 1 } as BindInput, known.updatedAt)).toEqual(known);
    const omitted = conversations.bind({ ...input, state: "ACTIVE" }, "2026-09-22T12:00:02.000Z");
    expect(omitted).toEqual({ ...known, state: "ACTIVE", updatedAt: "2026-09-22T12:00:02.000Z" });
    const advanced = conversations.bind({ ...input, controlEpoch: 2 } as BindInput, "2026-09-22T12:00:03.000Z");
    expect(advanced).toEqual({ ...known, controlEpoch: 2, revision: 3, updatedAt: "2026-09-22T12:00:03.000Z" });
    expect(() => conversations.resume(advanced.id, { expectedRevision: known.revision, generation: input.generation })).toThrowError(expect.objectContaining({ code: "CONFLICT" }));
    expect(store.getConversation(advanced.id)).toEqual(advanced);
    const resumed = conversations.resume(advanced.id, { expectedRevision: advanced.revision, generation: input.generation }, "2026-09-22T12:00:04.000Z");
    expect(resumed).toEqual({ ...advanced, state: "ACTIVE", revision: 4, updatedAt: "2026-09-22T12:00:04.000Z" });
    expect(() => conversations.resume(advanced.id, { expectedRevision: resumed.revision, generation: input.generation })).toThrowError(expect.objectContaining({ code: "CONFLICT" }));
    expect(store.getConversation(advanced.id)).toEqual(resumed);
  });

  it.each([-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, "1", null, true, {}])("rejects invalid epoch %s before writing a new or existing binding", (invalid) => {
    const store = new MemoryMessagingStateStore();
    const conversations = new ConversationBindingService(store);
    const current = conversations.bind({ ...input, controlEpoch: 1 } as BindInput, fixedNow.toISOString());
    const save = vi.spyOn(store, "saveConversation");
    for (const threadId of [input.threadId, "new-thread"]) {
      const id = `${input.connectorInstanceId}:${input.conversationId}:${threadId}`;
      const before = store.getConversation(id);
      expect(() => conversations.bind({ ...input, threadId, controlEpoch: invalid as unknown as number } as BindInput)).toThrowError(expect.objectContaining({ name: "ConnectorError", code: "CONFLICT" }));
      expect(store.getConversation(id)).toEqual(before);
    }
    expect(store.getConversation(current.id)).toEqual(current);
    expect(save).not.toHaveBeenCalled();
  });

  it("rejects epoch regression without mutating any stored binding field", () => {
    const store = new MemoryMessagingStateStore();
    const conversations = new ConversationBindingService(store);
    const current = conversations.bind({ ...input, controlEpoch: 1 } as BindInput, fixedNow.toISOString());
    const save = vi.spyOn(store, "saveConversation");
    expect(() => conversations.bind({ ...input, sessionId: "must-not-replace", state: "ACTIVE", controlEpoch: 0 } as BindInput)).toThrowError(expect.objectContaining({ code: "CONFLICT" }));
    expect(store.getConversation(current.id)).toEqual(current);
    expect(save).not.toHaveBeenCalled();
  });

  it.each([
    { taskId: "other-task" }, { runId: "other-run" }, { generation: 4 },
  ])("preserves intervention conflict checks for %s", (changed) => {
    const store = new MemoryMessagingStateStore();
    const conversations = new ConversationBindingService(store);
    const current = conversations.bind({ ...input, controlEpoch: 1 } as BindInput, fixedNow.toISOString());
    const save = vi.spyOn(store, "saveConversation");
    expect(() => conversations.bind({ ...input, ...changed, controlEpoch: 2 } as BindInput)).toThrowError(expect.objectContaining({ code: "CONFLICT" }));
    expect(store.getConversation(current.id)).toEqual(current);
    expect(save).not.toHaveBeenCalled();
  });
});
