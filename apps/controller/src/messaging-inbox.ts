import type { MessagingDelivery, NormalizedMessage } from "@dispatcher/integrations";
import type { DispatcherDatabase, JsonValue } from "@dispatcher/persistence";
import { backoffDelayMs } from "./background.js";

export const MESSAGING_INBOX_KIND = "messaging-inbox";

export type MessagingInboxStatus = "RECEIVED" | "PROCESSING" | "DONE" | "FAILED" | "IGNORED" | "DEAD_LETTER";

export interface MessagingInboxRecord {
  version: 2;
  id: string;
  connectorInstanceId: string;
  status: MessagingInboxStatus;
  message?: NormalizedMessage;
  credentialRedacted: boolean;
  attempts: number;
  deliveries: number;
  receivedAt: string;
  nextAttemptAt: string;
  lastRetryAttempt?: number;
  lastRetryReason?: string;
  claimedBy?: string;
  claimedAt?: string;
  processedAt?: string;
  replyId?: string;
  outcome?: "REPLIED" | "UNAUTHORIZED";
  ignoredReason?: string;
  lastError?: string;
  deadLetteredAt?: string;
}

export interface MessagingInboxOptions {
  workerId: string;
  clock: () => Date;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

interface LegacyInboxRecord {
  status?: string;
  message?: NormalizedMessage;
  receivedAt?: string;
  processedAt?: string;
  failedAt?: string;
  replyId?: string;
  error?: string;
}

function toJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

type ClearableKey = "claimedBy" | "claimedAt" | "lastError" | "deadLetteredAt";

function omit(record: MessagingInboxRecord, ...keys: ClearableKey[]): MessagingInboxRecord {
  const copy = { ...record };
  for (const key of keys) delete copy[key];
  return copy;
}

function upgrade(id: string, stored: JsonValue): MessagingInboxRecord {
  if ((stored as unknown as { version?: number }).version === 2) return stored as unknown as MessagingInboxRecord;
  const value = stored as unknown as LegacyInboxRecord;
  const receivedAt = value.receivedAt ?? new Date(0).toISOString();
  const status: MessagingInboxStatus = value.status === "PROCESSED" ? "DONE" : value.status === "FAILED" ? "FAILED" : "RECEIVED";
  return {
    version: 2,
    id,
    connectorInstanceId: value.message?.connectorInstanceId ?? id.split(":")[0] ?? "",
    status,
    ...(value.message ? { message: value.message } : {}),
    credentialRedacted: value.message?.text === "[REDACTED]",
    attempts: status === "RECEIVED" ? 0 : 1,
    deliveries: 1,
    receivedAt,
    nextAttemptAt: value.failedAt ?? receivedAt,
    ...(value.processedAt ? { processedAt: value.processedAt } : {}),
    ...(value.replyId ? { replyId: value.replyId, outcome: "REPLIED" as const } : {}),
    ...(value.error ? { lastError: value.error } : {}),
  };
}

export class MessagingInbox {
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;

  constructor(
    private readonly database: DispatcherDatabase,
    private readonly options: MessagingInboxOptions,
  ) {
    this.maxAttempts = options.maxAttempts ?? 5;
    this.baseDelayMs = options.baseDelayMs ?? 1_000;
    this.maxDelayMs = options.maxDelayMs ?? 5 * 60_000;
  }

  get(id: string): MessagingInboxRecord | undefined {
    const stored = this.database.getEntity<JsonValue>(MESSAGING_INBOX_KIND, id);
    return stored === undefined ? undefined : upgrade(id, stored);
  }

  receive(message: NormalizedMessage, input: { credentialRedacted: boolean; delivery?: MessagingDelivery }): { record: MessagingInboxRecord; duplicate: boolean } {
    const existing = this.get(message.idempotencyKey);
    if (existing) return { record: this.save(this.withDelivery(existing, input.delivery)), duplicate: true };
    const now = this.now();
    const record: MessagingInboxRecord = this.withDelivery({
      version: 2,
      id: message.idempotencyKey,
      connectorInstanceId: message.connectorInstanceId,
      status: "RECEIVED",
      message: input.credentialRedacted ? { ...message, text: "[REDACTED]" } : message,
      credentialRedacted: input.credentialRedacted,
      attempts: 0,
      deliveries: 0,
      receivedAt: now,
      nextAttemptAt: now,
    }, input.delivery);
    return { record: this.save(record), duplicate: false };
  }

  ignore(id: string, connectorInstanceId: string, reason: string, delivery?: MessagingDelivery): { record: MessagingInboxRecord; duplicate: boolean } {
    const existing = this.get(id);
    if (existing) return { record: this.save(this.withDelivery(existing, delivery)), duplicate: true };
    const now = this.now();
    return {
      record: this.save(this.withDelivery({
        version: 2,
        id,
        connectorInstanceId,
        status: "IGNORED",
        credentialRedacted: false,
        attempts: 0,
        deliveries: 0,
        receivedAt: now,
        nextAttemptAt: now,
        processedAt: now,
        ignoredReason: reason,
      }, delivery)),
      duplicate: false,
    };
  }

  claimDue(limit: number): MessagingInboxRecord[] {
    const now = this.now();
    const due = this.database.listEntities<JsonValue>(MESSAGING_INBOX_KIND)
      .map((stored) => {
        const value = stored as unknown as { id?: string; message?: NormalizedMessage };
        return upgrade(value.id ?? value.message?.idempotencyKey ?? "", stored);
      })
      .filter((record) => record.id && record.message && this.claimable(record, now))
      .sort((left, right) => left.receivedAt.localeCompare(right.receivedAt))
      .slice(0, limit);
    return due.map((record) => this.save({ ...record, status: "PROCESSING", attempts: record.attempts + 1, claimedBy: this.options.workerId, claimedAt: now }));
  }

  complete(id: string, outcome: "REPLIED" | "UNAUTHORIZED", replyId?: string): MessagingInboxRecord {
    const record = this.require(id);
    const rest = omit(record, "claimedBy", "claimedAt", "lastError");
    return this.save({ ...rest, status: "DONE", outcome, processedAt: this.now(), ...(replyId ? { replyId } : {}) });
  }

  fail(id: string, error: string, retryable: boolean): MessagingInboxRecord {
    const record = this.require(id);
    const rest = omit(record, "claimedBy", "claimedAt");
    const now = this.options.clock();
    if (retryable && record.attempts < this.maxAttempts) {
      return this.save({
        ...rest,
        status: "FAILED",
        lastError: error,
        nextAttemptAt: new Date(now.getTime() + backoffDelayMs(record.attempts, this.baseDelayMs, this.maxDelayMs)).toISOString(),
      });
    }
    const deadLetteredAt = now.toISOString();
    this.database.appendDeadLetter({
      id: `${MESSAGING_INBOX_KIND}:${record.id}:${deadLetteredAt}`,
      connectorInstanceId: record.connectorInstanceId,
      source: "inbox",
      sourceId: `${MESSAGING_INBOX_KIND}:${record.id}`,
      reason: retryable ? "MAX_ATTEMPTS_EXCEEDED" : "PERMANENT_FAILURE",
      payload: toJson({ inboxId: record.id, attempts: record.attempts, lastError: error }),
      createdAt: deadLetteredAt,
    });
    return this.save({ ...rest, status: "DEAD_LETTER", lastError: error, deadLetteredAt });
  }

  requeue(id: string): boolean {
    const record = this.get(id);
    if (!record || record.status !== "DEAD_LETTER") return false;
    const rest = omit(record, "deadLetteredAt");
    this.save({ ...rest, status: "RECEIVED", attempts: 0, nextAttemptAt: this.now() });
    return true;
  }

  private claimable(record: MessagingInboxRecord, now: string): boolean {
    if (record.status === "RECEIVED") return true;
    if (record.status === "FAILED") return record.nextAttemptAt <= now;
    return record.status === "PROCESSING" && record.claimedBy !== this.options.workerId;
  }

  private withDelivery(record: MessagingInboxRecord, delivery: MessagingDelivery | undefined): MessagingInboxRecord {
    return {
      ...record,
      deliveries: record.deliveries + 1,
      ...(delivery ? { lastRetryAttempt: delivery.retryAttempt, ...(delivery.reason ? { lastRetryReason: delivery.reason } : {}) } : {}),
    };
  }

  private require(id: string): MessagingInboxRecord {
    const record = this.get(id);
    if (!record) throw new Error(`Messaging inbox record ${id} was not found`);
    return record;
  }

  private save(record: MessagingInboxRecord): MessagingInboxRecord {
    this.database.saveEntity(MESSAGING_INBOX_KIND, record.id, toJson(record), this.now());
    return record;
  }

  private now(): string {
    return this.options.clock().toISOString();
  }
}
