import type { ConnectorDefinition, ConnectorInstance } from "@dispatcher/domain";
import { createConnectorDefinition, type ConnectorAdapter, type ConnectorProbeResult } from "./contracts.js";

export interface Notification {
  channel: string;
  subject: string;
  body: string;
  severity: "info" | "warning" | "critical";
  canonicalEntityId?: string;
}

export interface MessagingAdapter extends ConnectorAdapter {
  send(notification: Notification, idempotencyKey: string): Promise<{ externalMessageId: string }>;
}

export const messagingDefinition = createConnectorDefinition({
  id: "messaging.fake",
  kind: "messaging",
  displayName: "Deterministic Fake Messaging",
  capabilities: [
    { namespace: "messaging.notify", version: 1, support: "supported" },
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
