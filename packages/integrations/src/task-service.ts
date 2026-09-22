import { randomUUID } from "node:crypto";
import { assertTaskTransition, type ExternalBinding, type Task, type TaskState } from "@dispatcher/domain";
import { CanonicalRevisionConflictError, type DispatcherDatabase, type JsonValue } from "@dispatcher/persistence";
import type { ExternalEvent } from "./contracts.js";
import type { FieldOwner, TaskFieldMapping, TaskProjection } from "./task-platform.js";

export type TaskCommand =
  | { type: "task.create"; task: Task; bindings?: ExternalBinding[] }
  | { type: "task.update"; changes: Partial<Pick<Task, "title" | "description" | "state" | "priority" | "assignee" | "labels" | "dueAt" | "platformExtensions">> }
  | { type: "task.assign"; assignee?: string }
  | { type: "task.comment"; body: string }
  | { type: "task.transition"; state: TaskState }
  | { type: "task.set-current-run"; runId: string }
  | { type: "task.switch-primary"; targetBinding: ExternalBinding };

export interface TaskCommandInput {
  id: string;
  taskId: string;
  baseRevision: number;
  actor: string;
  sourceConnectorInstanceId?: string;
  sourceBinding?: ExternalBinding;
  command: TaskCommand;
}

function json(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function ownerFor(field: string, mapping?: TaskFieldMapping): FieldOwner {
  const commonField = field === "state" ? "status" : field;
  return mapping?.ownership[commonField as keyof TaskFieldMapping["ownership"]] ?? "canonical";
}

export class CanonicalTaskService {
  constructor(private readonly database: DispatcherDatabase) {}

  ingest(event: ExternalEvent): boolean {
    return this.database.appendInboxEvent({
      id: event.id,
      connectorInstanceId: event.connectorInstanceId,
      externalEventId: event.externalEventId,
      idempotencyKey: event.idempotencyKey,
      eventType: `${event.entityType}.${event.action}`,
      normalized: json(event),
      status: "PENDING",
      receivedAt: event.occurredAt,
    });
  }

  execute(input: TaskCommandInput, mapping?: TaskFieldMapping): { task: Task; revision: number; duplicate: boolean } {
    return this.database.transaction(() => {
      const commandEventId = `command:${input.id}`;
      const inserted = this.database.appendInboxEvent({
        id: commandEventId,
        connectorInstanceId: input.sourceConnectorInstanceId ?? "local",
        externalEventId: input.id,
        idempotencyKey: `command:${input.id}`,
        eventType: input.command.type,
        normalized: json(input),
        status: "PENDING",
        receivedAt: new Date().toISOString(),
      });
      const existing = this.database.getCanonicalTask<JsonValue>(input.taskId);
      if (!inserted) {
        if (!existing) throw new Error("Duplicate command has no canonical result");
        return { task: existing.document as unknown as Task, revision: existing.revision, duplicate: true };
      }

      const current = existing?.document as unknown as Task | undefined;
      let next: Task;
      if (input.command.type === "task.create") {
        if (current) throw new CanonicalRevisionConflictError(input.taskId, 0, existing?.revision ?? 0);
        next = structuredClone(input.command.task);
        next.bindings = structuredClone(input.command.bindings ?? next.bindings ?? []);
      } else {
        if (!current) throw new Error(`Unknown canonical task ${input.taskId}`);
        next = structuredClone(current);
        if (input.command.type === "task.update") {
          for (const [field, value] of Object.entries(input.command.changes)) {
            if (input.sourceConnectorInstanceId && ownerFor(field, mapping) === "canonical") continue;
            if (field === "state" && value !== undefined && value !== next.state) assertTaskTransition(next.state, value as TaskState);
            if (value === undefined) delete (next as unknown as Record<string, unknown>)[field];
            else (next as unknown as Record<string, unknown>)[field] = structuredClone(value);
          }
        } else if (input.command.type === "task.assign") {
          if (!input.sourceConnectorInstanceId || ownerFor("assignee", mapping) !== "canonical") {
            if (input.command.assignee === undefined) delete next.assignee;
            else next.assignee = input.command.assignee;
          }
        } else if (input.command.type === "task.transition") {
          assertTaskTransition(next.state, input.command.state);
          next.state = input.command.state;
        } else if (input.command.type === "task.set-current-run") {
          next.currentRunId = input.command.runId;
        } else if (input.command.type === "task.switch-primary") {
          const target = input.command.targetBinding;
          if (target.entityType !== "task" || target.canonicalEntityId !== input.taskId) {
            throw new Error("Primary task platform binding does not match the canonical task");
          }
          next.bindings = [...(next.bindings ?? []).filter((binding) => binding.id !== target.id), structuredClone(target)];
          next.origin = { source: "connector", connectorInstanceId: target.connectorInstanceId };
        }
      }

      if (input.sourceBinding) {
        const bindings = next.bindings ?? [];
        next.bindings = [
          ...bindings.filter((binding) => binding.id !== input.sourceBinding!.id),
          structuredClone(input.sourceBinding),
        ];
      }

      const updatedAt = new Date().toISOString();
      next.updatedAt = updatedAt;
      next.revision = input.baseRevision + 1;
      const revision = this.database.writeCanonicalTask(input.taskId, input.baseRevision, json(next), updatedAt);
      next.revision = revision;

      const bindings = next.bindings ?? [];
      for (const binding of bindings) {
        const isSource = binding.connectorInstanceId === input.sourceConnectorInstanceId;
        const projectionState = isSource ? "SYNCED" : "PENDING";
        this.database.saveExternalBinding({
          id: binding.id,
          canonicalEntityId: binding.canonicalEntityId,
          connectorInstanceId: binding.connectorInstanceId,
          entityType: binding.entityType,
          externalId: binding.externalId,
          ...(binding.externalRevision ? { externalRevision: binding.externalRevision } : {}),
          projectionState,
          document: json({ ...binding, projectionState, updatedAt }),
          updatedAt,
        });
        if (isSource) continue;
        const payload = input.command.type === "task.comment"
          ? { operation: "comment", externalId: binding.externalId, body: input.command.body, canonicalTaskId: input.taskId, canonicalRevision: revision }
          : { operation: "update", externalId: binding.externalId, projection: this.projection(next, revision, binding.connectorInstanceId) };
        this.database.enqueueOutboxEvent({
          id: randomUUID(),
          connectorInstanceId: binding.connectorInstanceId,
          idempotencyKey: `${input.id}:${binding.connectorInstanceId}`,
          eventType: input.command.type,
          payload: json(payload),
          status: "PENDING",
          attempt: 0,
          availableAt: updatedAt,
          createdAt: updatedAt,
        });
      }
      this.database.markInboxEvent(commandEventId, "PROCESSED", undefined, updatedAt);
      return { task: next, revision, duplicate: false };
    });
  }

  applyExternalEvent(event: ExternalEvent, command: TaskCommandInput, mapping: TaskFieldMapping): { task: Task; revision: number; duplicate: boolean } {
    try {
      return this.database.transaction(() => {
        if (!this.ingest(event)) {
          const existing = this.database.getCanonicalTask<JsonValue>(command.taskId);
          if (!existing) throw new Error("Duplicate external event has no canonical task");
          return { task: existing.document as unknown as Task, revision: existing.revision, duplicate: true };
        }
        const result = this.execute({ ...command, id: `external:${event.idempotencyKey}`, sourceConnectorInstanceId: event.connectorInstanceId }, mapping);
        this.database.markInboxEvent(event.id, "PROCESSED");
        return result;
      });
    } catch (error) {
      if (this.ingest(event)) this.database.markInboxEvent(event.id, "FAILED", error instanceof Error ? error.message : "unknown error");
      throw error;
    }
  }

  isSelfOriginatedEcho(event: ExternalEvent, currentRevision: number): boolean {
    const origin = event.data.origin;
    if (!origin || typeof origin !== "object") return false;
    const value = origin as Record<string, unknown>;
    return value.connectorInstanceId === event.connectorInstanceId
      && typeof value.canonicalRevision === "number"
      && value.canonicalRevision <= currentRevision;
  }

  private projection(task: Task, revision: number, connectorInstanceId: string): TaskProjection {
    return {
      canonicalTaskId: task.id,
      canonicalRevision: revision,
      title: task.title,
      ...(task.description ? { description: task.description } : {}),
      status: task.state,
      ...(task.priority === undefined ? {} : { priority: task.priority }),
      ...(task.assignee ? { assignee: task.assignee } : {}),
      ...(task.labels ? { labels: [...task.labels] } : {}),
      origin: { connectorInstanceId, canonicalRevision: revision },
    };
  }
}

export function mergeExternalChanges(input: {
  base: Record<string, unknown>;
  canonical: Record<string, unknown>;
  external: Record<string, unknown>;
  mapping: TaskFieldMapping;
}): { merged: Record<string, unknown>; conflicts: string[] } {
  const merged = structuredClone(input.canonical);
  const conflicts: string[] = [];
  const fields = new Set([...Object.keys(input.canonical), ...Object.keys(input.external)]);
  for (const field of fields) {
    const base = input.base[field];
    const canonical = input.canonical[field];
    const external = input.external[field];
    const canonicalChanged = JSON.stringify(base) !== JSON.stringify(canonical);
    const externalChanged = JSON.stringify(base) !== JSON.stringify(external);
    const owner = ownerFor(field, input.mapping);
    if (canonicalChanged && externalChanged && JSON.stringify(canonical) !== JSON.stringify(external)) {
      if (owner === "canonical") continue;
      if (owner === "external") merged[field] = structuredClone(external);
      else conflicts.push(field);
    } else if (externalChanged && owner !== "canonical") {
      merged[field] = structuredClone(external);
    }
  }
  return { merged, conflicts };
}
