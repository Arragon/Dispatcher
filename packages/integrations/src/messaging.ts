import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { ConnectorDefinition, ConnectorInstance } from "@dispatcher/domain";
import { ConnectorError, createConnectorDefinition, type ConnectorAdapter, type ConnectorProbeResult } from "./contracts.js";

export interface Notification {
  channel: string;
  subject: string;
  body: string;
  severity: "info" | "warning" | "critical";
  canonicalEntityId?: string;
}

export interface MessagingAdapter extends ConnectorAdapter {
  send(notification: Notification, idempotencyKey: string): Promise<{ externalMessageId: string }>;
  ingress?(raw: Uint8Array, headers: Record<string, string>): Promise<MessagingIngress>;
  reply?(message: OutboundMessage, idempotencyKey: string): Promise<{ externalMessageId: string }>;
}

export interface NormalizedMessage {
  version: 1;
  connectorInstanceId: string;
  externalMessageId: string;
  conversationId: string;
  threadId: string;
  principalExternalId: string;
  text: string;
  occurredAt: string;
  idempotencyKey: string;
  action?: { id: string; value?: string; expectedRevision?: number; generation?: number };
}

export interface MessagingIngress {
  kind: "message" | "challenge" | "ignored";
  message?: NormalizedMessage;
  challenge?: string;
}

export interface OutboundMessage {
  channel: string;
  text: string;
  threadId?: string;
  blocks?: Array<{ type: string; [key: string]: unknown }>;
  files?: Array<{ name: string; content: Uint8Array; mediaType: string }>;
}

export interface ConversationBinding {
  id: string;
  connectorInstanceId: string;
  conversationId: string;
  threadId: string;
  taskId?: string;
  runId?: string;
  sessionId?: string;
  generation: number;
  revision: number;
  state: "ACTIVE" | "WAITING_USER" | "CLOSED";
  updatedAt: string;
}

export interface PrincipalBinding {
  connectorInstanceId: string;
  externalPrincipalId: string;
  principalId: string;
  roles: string[];
  approvedAt: string;
  revokedAt?: string;
}

export interface MessagingStateStore {
  getConversation(id: string): ConversationBinding | undefined;
  saveConversation(binding: ConversationBinding): void;
  getPrincipal(connectorInstanceId: string, externalPrincipalId: string): PrincipalBinding | undefined;
  savePrincipal(binding: PrincipalBinding): void;
}

export class MemoryMessagingStateStore implements MessagingStateStore {
  private readonly conversations = new Map<string, ConversationBinding>();
  private readonly principals = new Map<string, PrincipalBinding>();
  getConversation(id: string): ConversationBinding | undefined { const item = this.conversations.get(id); return item ? structuredClone(item) : undefined; }
  saveConversation(binding: ConversationBinding): void { this.conversations.set(binding.id, structuredClone(binding)); }
  getPrincipal(connectorInstanceId: string, externalPrincipalId: string): PrincipalBinding | undefined { const item = this.principals.get(`${connectorInstanceId}:${externalPrincipalId}`); return item ? structuredClone(item) : undefined; }
  savePrincipal(binding: PrincipalBinding): void { this.principals.set(`${binding.connectorInstanceId}:${binding.externalPrincipalId}`, structuredClone(binding)); }
}

export const messagingDefinition = createConnectorDefinition({
  id: "messaging.fake",
  kind: "messaging",
  displayName: "Deterministic Fake Messaging",
  capabilities: [
    { namespace: "messaging.notify", version: 1, support: "supported" },
  ],
});

export const slackMessagingDefinition = createConnectorDefinition({
  id: "messaging.slack",
  kind: "messaging",
  displayName: "Slack",
  capabilities: [
    { namespace: "messaging.notify", version: 1, support: "supported" },
    { namespace: "messaging.ingress", version: 1, support: "supported" },
    { namespace: "messaging.threads", version: 1, support: "supported" },
    { namespace: "messaging.actions", version: 1, support: "supported" },
    { namespace: "messaging.files", version: 1, support: "supported" },
  ],
});

export class FakeMessagingConnector implements MessagingAdapter {
  readonly definition: ConnectorDefinition = messagingDefinition;
  readonly sent: Array<{ notification: Notification; idempotencyKey: string; externalMessageId: string }> = [];
  private readonly results = new Map<string, string>();

  constructor(readonly instance: ConnectorInstance = {
    id: "fake-messaging-main",
    definitionId: "messaging.fake",
    kind: "messaging",
    displayName: "Fake Messaging",
    enabled: true,
    health: "HEALTHY",
    revision: 1,
    updatedAt: new Date(0).toISOString(),
  }) {}

  async probe(): Promise<ConnectorProbeResult> {
    return { health: "HEALTHY", checkedAt: new Date().toISOString() };
  }

  async send(notification: Notification, idempotencyKey: string): Promise<{ externalMessageId: string }> {
    const existing = this.results.get(idempotencyKey);
    if (existing) return { externalMessageId: existing };
    const externalMessageId = `fake-message-${this.sent.length + 1}`;
    this.results.set(idempotencyKey, externalMessageId);
    this.sent.push({ notification: structuredClone(notification), idempotencyKey, externalMessageId });
    return { externalMessageId };
  }

  async reply(message: OutboundMessage, idempotencyKey: string): Promise<{ externalMessageId: string }> {
    return this.send({ channel: message.channel, subject: "Reply", body: message.text, severity: "info" }, idempotencyKey);
  }
}

export type MessagingFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type MessagingSecretResolver = (reference: string) => Promise<string>;

export interface SlackConnectorOptions {
  instance: ConnectorInstance;
  signingSecretRef: string;
  botTokenRef: string;
  resolveSecret: MessagingSecretResolver;
  fetch?: MessagingFetch;
  apiBase?: string;
  maxBodyBytes?: number;
  clock?: () => Date;
}

interface SlackApiResponse {
  ok?: boolean;
  error?: string;
  ts?: string;
  message?: { ts?: string };
  [key: string]: unknown;
}

export class SlackMessagingConnector implements MessagingAdapter {
  readonly definition = slackMessagingDefinition;
  readonly instance: ConnectorInstance;
  private readonly fetcher: MessagingFetch;
  private readonly replays = new Map<string, number>();
  private readonly outbound = new Map<string, string>();
  private readonly uploaded = new Set<string>();
  constructor(private readonly options: SlackConnectorOptions) {
    if (options.instance.definitionId !== slackMessagingDefinition.id || options.instance.kind !== "messaging") throw new Error("Slack connector instance does not match messaging.slack");
    this.instance = structuredClone(options.instance);
    this.fetcher = options.fetch ?? fetch;
  }

  async probe(): Promise<ConnectorProbeResult> {
    const response = await this.slack("auth.test", {});
    return { health: response.ok ? "HEALTHY" : "AUTH_REQUIRED", checkedAt: this.now().toISOString(), ...(response.error ? { message: String(response.error) } : {}) };
  }

  async ingress(raw: Uint8Array, headers: Record<string, string>): Promise<MessagingIngress> {
    if (raw.byteLength > (this.options.maxBodyBytes ?? 1_048_576)) throw new ConnectorError("INVALID_EVENT", "Slack webhook body exceeds the configured limit", { retryable: false, operation: "ingress" });
    const timestamp = headers["x-slack-request-timestamp"];
    const signature = headers["x-slack-signature"];
    if (!timestamp || !signature) throw new ConnectorError("AUTH", "Slack signature headers are required", { retryable: false, operation: "auth" });
    const seconds = Number(timestamp);
    const nowSeconds = Math.floor(this.now().getTime() / 1_000);
    if (!Number.isFinite(seconds) || Math.abs(nowSeconds - seconds) > 300) throw new ConnectorError("AUTH", "Slack request timestamp is stale", { retryable: false, operation: "auth" });
    const body = Buffer.from(raw).toString("utf8");
    const signingSecret = await this.options.resolveSecret(this.options.signingSecretRef);
    const expected = `v0=${createHmac("sha256", signingSecret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
    const left = Buffer.from(expected);
    const right = Buffer.from(signature);
    if (left.length !== right.length || !timingSafeEqual(left, right)) throw new ConnectorError("AUTH", "Slack signature is invalid", { retryable: false, operation: "auth" });
    const replayKey = createHash("sha256").update(`${timestamp}:${signature}:${body}`).digest("hex");
    this.pruneReplays(nowSeconds);
    if (this.replays.has(replayKey)) throw new ConnectorError("CONFLICT", "Slack request was already processed", { retryable: false, operation: "ingress" });
    this.replays.set(replayKey, nowSeconds);
    const payload = this.parseBody(body, headers["content-type"] ?? "application/json");
    if (payload.type === "url_verification" && typeof payload.challenge === "string") return { kind: "challenge", challenge: payload.challenge };
    return this.normalize(payload, replayKey);
  }

  async send(notification: Notification, idempotencyKey: string): Promise<{ externalMessageId: string }> {
    return this.reply!({ channel: notification.channel, text: `*${notification.subject}*\n${notification.body}` }, idempotencyKey);
  }

  async reply(message: OutboundMessage, idempotencyKey: string): Promise<{ externalMessageId: string }> {
    let externalMessageId = this.outbound.get(idempotencyKey);
    if (!externalMessageId) {
      const result = await this.slack("chat.postMessage", { channel: message.channel, text: message.text, ...(message.threadId ? { thread_ts: message.threadId } : {}), ...(message.blocks ? { blocks: message.blocks } : {}) });
      if (!result.ok) throw new ConnectorError(result.error === "ratelimited" ? "RATE_LIMITED" : "TEMPORARY", `Slack outbound failed: ${String(result.error ?? "unknown")}`, { retryable: true, operation: "write" });
      externalMessageId = String(result.ts ?? result.message?.ts ?? "");
      if (!externalMessageId) throw new ConnectorError("INVALID_EVENT", "Slack response did not include a message id", { retryable: true, operation: "write" });
      this.outbound.set(idempotencyKey, externalMessageId);
    }
    for (const [index, file] of (message.files ?? []).entries()) {
      const fileKey = `${idempotencyKey}:file:${index}`;
      if (this.uploaded.has(fileKey)) continue;
      const form = new FormData();
      form.set("channels", message.channel);
      if (message.threadId) form.set("thread_ts", message.threadId);
      form.set("filename", file.name);
      form.set("filetype", file.mediaType);
      form.set("file", new Blob([Uint8Array.from(file.content)], { type: file.mediaType }), file.name);
      const uploaded = await this.slackMultipart("files.upload", form);
      if (!uploaded.ok) throw new ConnectorError(uploaded.error === "ratelimited" ? "RATE_LIMITED" : "TEMPORARY", `Slack file upload failed: ${String(uploaded.error ?? "unknown")}`, { retryable: true, operation: "write" });
      this.uploaded.add(fileKey);
    }
    return { externalMessageId };
  }

  private parseBody(body: string, contentType: string): Record<string, unknown> {
    try {
      if (contentType.includes("application/x-www-form-urlencoded")) {
        const values = new URLSearchParams(body);
        const payload = values.get("payload");
        return payload ? JSON.parse(payload) as Record<string, unknown> : Object.fromEntries(values);
      }
      return JSON.parse(body) as Record<string, unknown>;
    } catch {
      throw new ConnectorError("INVALID_EVENT", "Slack body is malformed", { retryable: false, operation: "ingress" });
    }
  }

  private normalize(payload: Record<string, unknown>, replayKey: string): MessagingIngress {
    const event = payload.event && typeof payload.event === "object" ? payload.event as Record<string, unknown> : undefined;
    const actionPayload = Array.isArray(payload.actions) ? payload : undefined;
    const command = typeof payload.command === "string" ? payload : undefined;
    const source = event ?? actionPayload ?? command;
    if (!source) return { kind: "ignored" };
    const container = actionPayload?.container && typeof actionPayload.container === "object" ? actionPayload.container as Record<string, unknown> : undefined;
    const user = actionPayload?.user && typeof actionPayload.user === "object" ? actionPayload.user as Record<string, unknown> : undefined;
    const channel = actionPayload?.channel && typeof actionPayload.channel === "object" ? actionPayload.channel as Record<string, unknown> : undefined;
    const firstAction = actionPayload?.actions && Array.isArray(actionPayload.actions) && actionPayload.actions[0] && typeof actionPayload.actions[0] === "object" ? actionPayload.actions[0] as Record<string, unknown> : undefined;
    const externalMessageId = String(event?.event_ts ?? event?.ts ?? container?.message_ts ?? payload.trigger_id ?? replayKey);
    const conversationId = String(event?.channel ?? channel?.id ?? payload.channel_id ?? "");
    const threadId = String(event?.thread_ts ?? event?.ts ?? container?.thread_ts ?? container?.message_ts ?? payload.thread_ts ?? externalMessageId);
    const principalExternalId = String(event?.user ?? user?.id ?? payload.user_id ?? "");
    if (!conversationId || !principalExternalId) return { kind: "ignored" };
    const actionValue = typeof firstAction?.value === "string" ? firstAction.value : undefined;
    let parsedAction: Record<string, unknown> | undefined;
    if (actionValue) { try { parsedAction = JSON.parse(actionValue) as Record<string, unknown>; } catch { parsedAction = { value: actionValue }; } }
    return {
      kind: "message",
      message: {
        version: 1,
        connectorInstanceId: this.instance.id,
        externalMessageId,
        conversationId,
        threadId,
        principalExternalId,
        text: String(event?.text ?? payload.text ?? parsedAction?.text ?? ""),
        occurredAt: this.now().toISOString(),
        idempotencyKey: `${this.instance.id}:${String(payload.event_id ?? replayKey)}`,
        ...(firstAction ? { action: { id: String(firstAction.action_id ?? firstAction.block_id ?? "action"), ...(actionValue ? { value: actionValue } : {}), ...(typeof parsedAction?.expectedRevision === "number" ? { expectedRevision: parsedAction.expectedRevision } : {}), ...(typeof parsedAction?.generation === "number" ? { generation: parsedAction.generation } : {}) } } : {}),
      },
    };
  }

  private async slack(method: string, body: Record<string, unknown>): Promise<SlackApiResponse> {
    const token = await this.options.resolveSecret(this.options.botTokenRef);
    const response = await this.fetcher(`${this.options.apiBase ?? "https://slack.com/api"}/${method}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(body) });
    if (response.status === 429) throw new ConnectorError("RATE_LIMITED", "Slack rate limit", { retryable: true, retryAfterMs: Number(response.headers.get("retry-after") ?? 1) * 1_000, operation: "write" });
    if (!response.ok) throw new ConnectorError(response.status === 401 || response.status === 403 ? "AUTH" : "TEMPORARY", `Slack API returned ${response.status}`, { retryable: response.status >= 500, operation: "write" });
    return await response.json() as SlackApiResponse;
  }

  private async slackMultipart(method: string, body: FormData): Promise<SlackApiResponse> {
    const token = await this.options.resolveSecret(this.options.botTokenRef);
    const response = await this.fetcher(`${this.options.apiBase ?? "https://slack.com/api"}/${method}`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body });
    if (response.status === 429) throw new ConnectorError("RATE_LIMITED", "Slack rate limit", { retryable: true, retryAfterMs: Number(response.headers.get("retry-after") ?? 1) * 1_000, operation: "write" });
    if (!response.ok) throw new ConnectorError(response.status === 401 || response.status === 403 ? "AUTH" : "TEMPORARY", `Slack API returned ${response.status}`, { retryable: response.status >= 500, operation: "write" });
    return await response.json() as SlackApiResponse;
  }

  private now(): Date { return this.options.clock?.() ?? new Date(); }
  private pruneReplays(nowSeconds: number): void { for (const [key, seenAt] of this.replays) if (nowSeconds - seenAt > 300) this.replays.delete(key); }
}

export class MessagingIdentityService {
  constructor(private readonly store: MessagingStateStore) {}
  link(binding: Omit<PrincipalBinding, "approvedAt">, approvedAt = new Date().toISOString()): PrincipalBinding {
    const saved = { ...structuredClone(binding), approvedAt };
    this.store.savePrincipal(saved);
    return structuredClone(saved);
  }
  revoke(connectorInstanceId: string, externalPrincipalId: string, revokedAt = new Date().toISOString()): PrincipalBinding {
    const current = this.require(connectorInstanceId, externalPrincipalId);
    const revoked = { ...current, revokedAt };
    this.store.savePrincipal(revoked);
    return structuredClone(revoked);
  }
  authorize(connectorInstanceId: string, externalPrincipalId: string, role?: string): PrincipalBinding {
    const binding = this.require(connectorInstanceId, externalPrincipalId);
    if (binding.revokedAt || role && !binding.roles.includes(role)) throw new ConnectorError("AUTH", "Messaging principal is not authorized", { retryable: false, operation: "auth" });
    return binding;
  }
  private require(connectorInstanceId: string, externalPrincipalId: string): PrincipalBinding {
    const binding = this.store.getPrincipal(connectorInstanceId, externalPrincipalId);
    if (!binding) throw new ConnectorError("AUTH", "Messaging principal is not linked", { retryable: false, operation: "auth" });
    return binding;
  }
}

export class ConversationBindingService {
  constructor(private readonly store: MessagingStateStore) {}
  bind(input: Omit<ConversationBinding, "id" | "revision" | "updatedAt">, now = new Date().toISOString()): ConversationBinding {
    const id = `${input.connectorInstanceId}:${input.conversationId}:${input.threadId}`;
    const existing = this.store.getConversation(id);
    if (existing && (existing.taskId !== input.taskId || existing.runId !== input.runId || existing.generation !== input.generation)) {
      throw new ConnectorError("CONFLICT", "Conversation thread is already bound to another intervention", { retryable: false, operation: "write" });
    }
    const binding: ConversationBinding = { ...structuredClone(input), id, revision: existing?.revision ?? 1, updatedAt: now };
    this.store.saveConversation(binding);
    return structuredClone(binding);
  }
  resume(id: string, input: { expectedRevision: number; generation: number }, now = new Date().toISOString()): ConversationBinding {
    const current = this.store.getConversation(id);
    if (!current || current.revision !== input.expectedRevision || current.generation !== input.generation || current.state !== "WAITING_USER") throw new ConnectorError("CONFLICT", "Conversation binding is stale", { retryable: false, operation: "write" });
    const updated = { ...current, revision: current.revision + 1, state: "ACTIVE" as const, updatedAt: now };
    this.store.saveConversation(updated);
    return structuredClone(updated);
  }
}

export class AttentionNotificationPolicy {
  private readonly sent = new Map<string, number>();
  constructor(private readonly cooldownMs = 15 * 60_000) {}
  shouldNotify(input: { taskId: string; state: string; generation: number; now?: Date }): boolean {
    if (!["WAITING_USER", "WAITING_RESOURCE", "FAILED", "STALLED"].includes(input.state)) return false;
    const key = `${input.taskId}:${input.state}:${input.generation}`;
    const now = input.now?.getTime() ?? Date.now();
    const previous = this.sent.get(key);
    if (previous !== undefined && now - previous < this.cooldownMs) return false;
    this.sent.set(key, now);
    return true;
  }
  recover(taskId: string): void { for (const key of this.sent.keys()) if (key.startsWith(`${taskId}:`)) this.sent.delete(key); }
}

export class SecureDashboardLinkIssuer {
  constructor(private readonly origin: string, private readonly signingKey: string) {}
  issue(input: { principalId: string; taskId?: string; expiresAt: string }): string {
    const payload = Buffer.from(JSON.stringify(input)).toString("base64url");
    const signature = createHmac("sha256", this.signingKey).update(payload).digest("base64url");
    const url = new URL("/auth/messaging", this.origin);
    url.searchParams.set("ticket", `${payload}.${signature}`);
    return url.toString();
  }
  verify(ticket: string, now = new Date()): { principalId: string; taskId?: string; expiresAt: string } {
    const [payload, signature] = ticket.split(".");
    if (!payload || !signature) throw new ConnectorError("AUTH", "Dashboard ticket is malformed", { retryable: false, operation: "auth" });
    const expected = createHmac("sha256", this.signingKey).update(payload).digest("base64url");
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new ConnectorError("AUTH", "Dashboard ticket is invalid", { retryable: false, operation: "auth" });
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { principalId: string; taskId?: string; expiresAt: string };
    if (Date.parse(parsed.expiresAt) <= now.getTime()) throw new ConnectorError("AUTH", "Dashboard ticket expired", { retryable: false, operation: "auth" });
    return parsed;
  }
}

export async function runMessagingContract(adapter: MessagingAdapter): Promise<string[]> {
  const failures: string[] = [];
  if (adapter.definition.kind !== "messaging") failures.push("definition kind must be messaging");
  if (!adapter.definition.capabilities.some((entry) => entry.namespace === "messaging.notify" && entry.support === "supported")) {
    failures.push("missing messaging.notify");
  }
  try {
    if ((await adapter.probe()).health !== "HEALTHY") failures.push("probe must be healthy in contract fixture");
    const notification: Notification = { channel: "operations", subject: "Ready", body: "Task is ready", severity: "info" };
    const first = await adapter.send(notification, "contract-notification");
    const duplicate = await adapter.send(notification, "contract-notification");
    if (!first.externalMessageId || duplicate.externalMessageId !== first.externalMessageId) failures.push("send must be idempotent");
  } catch (error) {
    failures.push(error instanceof Error ? error.message : "messaging contract failed");
  }
  return failures;
}
