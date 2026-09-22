import { randomUUID } from "node:crypto";
import type { DispatcherDatabase, JsonValue, OutboxEventRecord } from "@dispatcher/persistence";
import { ConnectorError } from "./contracts.js";
import type { ConnectorRegistry } from "./registry.js";
import type { TaskPlatformAdapter, TaskProjection } from "./task-platform.js";

interface ProjectionPayload {
  operation: "update" | "comment";
  externalId: string;
  projection?: TaskProjection;
  body?: string;
  canonicalTaskId?: string;
  canonicalRevision?: number;
}

export interface ProjectionWorkerOptions {
  maxAttempts?: number;
  baseBackoffMs?: number;
  concurrencyPerConnector?: number;
}

export class ProjectionWorker {
  private readonly active = new Map<string, number>();
  private readonly maxAttempts: number;
  private readonly baseBackoffMs: number;
  private readonly concurrencyPerConnector: number;

  constructor(
    private readonly database: DispatcherDatabase,
    private readonly registry: ConnectorRegistry,
    options: ProjectionWorkerOptions = {},
  ) {
    this.maxAttempts = options.maxAttempts ?? 5;
    this.baseBackoffMs = options.baseBackoffMs ?? 1_000;
    this.concurrencyPerConnector = options.concurrencyPerConnector ?? 2;
  }

  async drain(now = new Date()): Promise<{ delivered: number; retried: number; dead: number; skipped: number }> {
    const result = { delivered: 0, retried: 0, dead: 0, skipped: 0 };
    for (const event of this.database.listReadyOutbox(now.toISOString())) {
      const count = this.active.get(event.connectorInstanceId) ?? 0;
      if (count >= this.concurrencyPerConnector) { result.skipped += 1; continue; }
      this.active.set(event.connectorInstanceId, count + 1);
      try {
        await this.deliver(event);
        this.database.markOutboxDelivered(event.id, now.toISOString());
        result.delivered += 1;
      } catch (error) {
        const connectorError = error instanceof ConnectorError ? error : new ConnectorError("TEMPORARY", error instanceof Error ? error.message : "projection failed", { retryable: true });
        const nextAttempt = event.attempt + 1;
        const dead = !connectorError.options.retryable || nextAttempt >= this.maxAttempts;
        const retryAfter = connectorError.options.retryAfterMs ?? this.baseBackoffMs * 2 ** event.attempt;
        this.database.rescheduleOutbox(event.id, new Date(now.getTime() + retryAfter).toISOString(), connectorError.message, dead);
        if (dead) {
          this.database.appendDeadLetter({ id: randomUUID(), connectorInstanceId: event.connectorInstanceId, source: "outbox", sourceId: event.id, reason: connectorError.code, payload: event.payload });
          result.dead += 1;
        } else result.retried += 1;
      } finally {
        this.active.set(event.connectorInstanceId, Math.max(0, (this.active.get(event.connectorInstanceId) ?? 1) - 1));
      }
    }
    return result;
  }

  private async deliver(event: OutboxEventRecord): Promise<void> {
    const adapter = this.registry.require<TaskPlatformAdapter>(event.connectorInstanceId, "task");
    const payload = event.payload as unknown as ProjectionPayload;
    if (payload.operation === "update" && payload.projection) {
      const result = await adapter.updateProjection(payload.externalId, payload.projection, event.idempotencyKey);
      const binding = this.database.findExternalBinding<Record<string, JsonValue>>(event.connectorInstanceId, "task", payload.externalId);
      if (binding) {
        const updatedAt = new Date().toISOString();
        const updated = { ...binding, projectionState: "SYNCED", updatedAt, ...(result.externalRevision ? { externalRevision: result.externalRevision } : {}) };
        this.database.saveExternalBinding({
          id: String(binding.id),
          canonicalEntityId: String(binding.canonicalEntityId),
          connectorInstanceId: event.connectorInstanceId,
          entityType: "task",
          externalId: payload.externalId,
          ...(result.externalRevision ? { externalRevision: result.externalRevision } : {}),
          projectionState: "SYNCED",
          document: updated,
          updatedAt,
        });
      }
      return;
    }
    if (payload.operation === "comment" && payload.body !== undefined) {
      await adapter.addComment(payload.externalId, payload.body, event.idempotencyKey);
      return;
    }
    throw new ConnectorError("PERMANENT", "Malformed projection outbox payload", { retryable: false, operation: "write" });
  }
}

export function outboxPayload(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
