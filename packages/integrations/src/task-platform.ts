import { randomUUID } from "node:crypto";
import type { ConnectorDefinition, ConnectorInstance, ExternalBinding, TaskState } from "@dispatcher/domain";
import { ConnectorError, createConnectorDefinition, type ConnectorAdapter, type ConnectorProbeResult, type ExternalEvent } from "./contracts.js";

export type CommonTaskField =
  | "title"
  | "description"
  | "status"
  | "priority"
  | "assignee"
  | "labels"
  | "dependencies"
  | "milestone"
  | "commentsSummary";
export type FieldOwner = "canonical" | "external" | "merge";

export interface TaskFieldMapping {
  ownership: Partial<Record<CommonTaskField, FieldOwner>>;
  statuses: Record<string, TaskState>;
  priorities: Record<string, number>;
  users: Record<string, string>;
}

export interface TaskDraft {
  externalId: string;
  externalRevision?: string;
  title: string;
  description?: string;
  status?: string;
  priority?: number;
  assignee?: string;
  labels: string[];
  dependencies: string[];
  milestone?: string;
  commentsSummary?: string;
  repository?: string;
  scope: string[];
  acceptanceCriteria: string[];
  verification: string[];
  constraints: string[];
  delivery?: { type: "pull-request" | "commit" | "none"; baseBranch?: string };
  extensions: Record<string, unknown>;
}

export interface TaskProjection {
  canonicalTaskId: string;
  canonicalRevision: number;
  title: string;
  description?: string;
  status: TaskState;
  priority?: number;
  assignee?: string;
  labels?: string[];
  origin: { connectorInstanceId: string; canonicalRevision: number };
}

export interface ReconcileResult {
  cursor?: string;
  changes: ExternalEvent[];
  conflicts: Array<{ externalId: string; fields: CommonTaskField[]; externalRevision?: string }>;
}

export interface TaskPlatformAdapter extends ConnectorAdapter {
  ingress(raw: Uint8Array, headers: Readonly<Record<string, string>>, now?: Date): Promise<ExternalEvent>;
  getTask(externalId: string): Promise<TaskDraft>;
  listChanges(cursor?: string): Promise<{ cursor?: string; tasks: TaskDraft[] }>;
  updateProjection(externalId: string, projection: TaskProjection, idempotencyKey: string): Promise<{ externalRevision?: string }>;
  addComment(externalId: string, body: string, idempotencyKey: string): Promise<void>;
  reconcile(bindings: ExternalBinding[], cursor?: string): Promise<ReconcileResult>;
}

export const taskPlatformDefinition = createConnectorDefinition({
  id: "task.fake",
  kind: "task",
  displayName: "Deterministic Fake Task Platform",
  capabilities: [
    { namespace: "task.ingress", version: 1, support: "supported" },
    { namespace: "task.read", version: 1, support: "supported" },
    { namespace: "task.project", version: 1, support: "supported" },
    { namespace: "task.comment", version: 1, support: "supported" },
    { namespace: "task.reconcile", version: 1, support: "supported" },
  ],
});

export class FakeTaskConnector implements TaskPlatformAdapter {
  readonly definition: ConnectorDefinition;
  readonly tasks = new Map<string, TaskDraft>();
  readonly projections: Array<{ externalId: string; projection: TaskProjection; idempotencyKey: string }> = [];
  readonly comments: Array<{ externalId: string; body: string; idempotencyKey: string }> = [];
  private readonly seenWrites = new Set<string>();
  healthFailure?: ConnectorError;

  constructor(
    readonly instance: ConnectorInstance = {
      id: "fake-task-main",
      definitionId: "task.fake",
      kind: "task",
      displayName: "Fake Tasks",
      enabled: true,
      health: "HEALTHY",
      revision: 1,
      updatedAt: new Date(0).toISOString(),
    },
    definition: ConnectorDefinition = taskPlatformDefinition,
  ) {
    this.definition = structuredClone(definition);
  }

  async probe(): Promise<ConnectorProbeResult> {
    if (this.healthFailure) throw this.healthFailure;
    return { health: "HEALTHY", checkedAt: new Date().toISOString() };
  }

  async ingress(raw: Uint8Array): Promise<ExternalEvent> {
    const parsed = JSON.parse(new TextDecoder().decode(raw)) as { id: string; action?: ExternalEvent["action"]; task: TaskDraft };
    return {
      version: 1,
      id: randomUUID(),
      connectorInstanceId: this.instance.id,
      externalEventId: parsed.id,
      idempotencyKey: `${this.instance.id}:${parsed.id}`,
      entityType: "task",
      action: parsed.action ?? "updated",
      externalEntityId: parsed.task.externalId,
      ...(parsed.task.externalRevision ? { externalRevision: parsed.task.externalRevision } : {}),
      occurredAt: new Date().toISOString(),
      traceId: randomUUID(),
      data: { task: structuredClone(parsed.task) },
    };
  }

  async getTask(externalId: string): Promise<TaskDraft> {
    const task = this.tasks.get(externalId);
    if (!task) throw new ConnectorError("PERMANENT", `Unknown external task ${externalId}`);
    return structuredClone(task);
  }

  async listChanges(cursor?: string): Promise<{ cursor?: string; tasks: TaskDraft[] }> {
    const tasks = [...this.tasks.values()].sort((left, right) => left.externalId.localeCompare(right.externalId));
    return { cursor: String(Number(cursor ?? "0") + tasks.length), tasks: structuredClone(tasks) };
  }

  async updateProjection(externalId: string, projection: TaskProjection, idempotencyKey: string): Promise<{ externalRevision?: string }> {
    if (this.healthFailure) throw this.healthFailure;
    if (!this.seenWrites.has(idempotencyKey)) {
      this.projections.push({ externalId, projection: structuredClone(projection), idempotencyKey });
      this.seenWrites.add(idempotencyKey);
    }
    return { externalRevision: `fake-${projection.canonicalRevision}` };
  }

  async addComment(externalId: string, body: string, idempotencyKey: string): Promise<void> {
    if (!this.seenWrites.has(idempotencyKey)) {
      this.comments.push({ externalId, body, idempotencyKey });
      this.seenWrites.add(idempotencyKey);
    }
  }

  async reconcile(bindings: ExternalBinding[], cursor?: string): Promise<ReconcileResult> {
    const changes: ExternalEvent[] = [];
    for (const binding of bindings) {
      const task = this.tasks.get(binding.externalId);
      if (task && task.externalRevision !== binding.externalRevision) {
        changes.push(await this.ingress(new TextEncoder().encode(JSON.stringify({ id: `reconcile:${task.externalId}:${task.externalRevision}`, task }))));
      }
    }
    return { cursor: String(Number(cursor ?? "0") + 1), changes, conflicts: [] };
  }
}

export async function runTaskPlatformContract(adapter: TaskPlatformAdapter): Promise<string[]> {
  const failures: string[] = [];
  if (adapter.definition.kind !== "task") failures.push("definition kind must be task");
  const required = ["task.ingress", "task.read", "task.project", "task.comment", "task.reconcile"];
  for (const namespace of required) {
    if (!adapter.definition.capabilities.some((entry) => entry.namespace === namespace && entry.support === "supported")) failures.push(`missing ${namespace}`);
  }
  try {
    const probe = await adapter.probe();
    if (probe.health !== "HEALTHY") failures.push("probe must be healthy in contract fixture");
    const event = await adapter.ingress(new TextEncoder().encode(JSON.stringify({
      id: "contract-event",
      task: { externalId: "contract-task", title: "Contract", labels: [], dependencies: [], scope: [], acceptanceCriteria: [], verification: [], constraints: [], extensions: {} },
    })), {});
    if (!event.idempotencyKey || event.connectorInstanceId !== adapter.instance.id) failures.push("ingress must retain identity and idempotency");
    const projection: TaskProjection = { canonicalTaskId: "task-1", canonicalRevision: 1, title: "Contract", status: "READY", origin: { connectorInstanceId: adapter.instance.id, canonicalRevision: 1 } };
    await adapter.updateProjection("contract-task", projection, "contract-write");
    await adapter.updateProjection("contract-task", projection, "contract-write");
    await adapter.addComment("contract-task", "ok", "contract-comment");
    await adapter.reconcile([], undefined);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : "task platform contract failed");
  }
  return failures;
}
