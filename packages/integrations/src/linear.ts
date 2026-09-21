import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { ConnectorDefinition, ConnectorInstance, ExternalBinding } from "@dispatcher/domain";
import { ConnectorError, createConnectorDefinition, type ConnectorProbeResult, type ExternalEvent } from "./contracts.js";
import type { ReconcileResult, TaskDraft, TaskPlatformAdapter, TaskProjection } from "./task-platform.js";

export type IntegrationFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type SecretResolver = (reference: string) => Promise<string>;

export const linearTaskDefinition = createConnectorDefinition({
  id: "task.linear",
  kind: "task",
  displayName: "Linear",
  capabilities: [
    { namespace: "task.ingress", version: 1, support: "supported" },
    { namespace: "task.read", version: 1, support: "supported" },
    { namespace: "task.project", version: 1, support: "supported" },
    { namespace: "task.comment", version: 1, support: "supported" },
    { namespace: "task.reconcile", version: 1, support: "supported" },
    { namespace: "task.milestone", version: 1, support: "supported" },
  ],
});

export interface LinearConnectorOptions {
  instance: ConnectorInstance;
  credentialRef: string;
  webhookSecretRef: string;
  resolveSecret: SecretResolver;
  fetch?: IntegrationFetch;
  endpoint?: string;
  maxPayloadBytes?: number;
  webhookToleranceMs?: number;
  repository?: string;
  statusIds?: Partial<Record<string, string>>;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

export class LinearTaskConnector implements TaskPlatformAdapter {
  readonly definition: ConnectorDefinition = linearTaskDefinition;
  readonly instance: ConnectorInstance;
  private readonly fetch: IntegrationFetch;
  private readonly endpoint: string;
  private readonly maxPayloadBytes: number;
  private readonly webhookToleranceMs: number;

  constructor(private readonly options: LinearConnectorOptions) {
    if (!options.credentialRef.startsWith("secret://linear/") || !options.webhookSecretRef.startsWith("secret://linear/")) {
      throw new ConnectorError("AUTH", "Linear credentials must use the linear secret namespace");
    }
    this.instance = structuredClone(options.instance);
    this.fetch = options.fetch ?? fetch;
    this.endpoint = options.endpoint ?? "https://api.linear.app/graphql";
    this.maxPayloadBytes = options.maxPayloadBytes ?? 1_048_576;
    this.webhookToleranceMs = options.webhookToleranceMs ?? 5 * 60_000;
  }

  async probe(): Promise<ConnectorProbeResult> {
    await this.graphql("query Viewer { viewer { id } }");
    return { health: "HEALTHY", checkedAt: new Date().toISOString() };
  }

  async ingress(raw: Uint8Array, headers: Readonly<Record<string, string>>, now = new Date()): Promise<ExternalEvent> {
    if (raw.byteLength > this.maxPayloadBytes) throw new ConnectorError("INVALID_EVENT", "Linear webhook payload exceeds the configured limit");
    const signature = headers["linear-signature"] ?? headers["Linear-Signature"];
    if (!signature) throw new ConnectorError("INVALID_EVENT", "Linear webhook signature is missing");
    const secret = await this.options.resolveSecret(this.options.webhookSecretRef);
    const expected = createHmac("sha256", secret).update(raw).digest("hex");
    const expectedBytes = Buffer.from(expected, "hex");
    let receivedBytes: Buffer;
    try { receivedBytes = Buffer.from(signature, "hex"); } catch { throw new ConnectorError("INVALID_EVENT", "Linear webhook signature is invalid"); }
    if (receivedBytes.length !== expectedBytes.length || !timingSafeEqual(receivedBytes, expectedBytes)) {
      throw new ConnectorError("INVALID_EVENT", "Linear webhook signature is invalid");
    }
    let payload: Record<string, unknown>;
    try { payload = object(JSON.parse(new TextDecoder().decode(raw))); } catch { throw new ConnectorError("INVALID_EVENT", "Linear webhook JSON is invalid"); }
    const timestampValue = headers["x-dispatcher-timestamp"] ?? headers["X-Dispatcher-Timestamp"] ?? payload.webhookTimestamp ?? payload.createdAt;
    const timestamp = typeof timestampValue === "number"
      ? timestampValue
      : typeof timestampValue === "string"
        ? (/^\d+$/.test(timestampValue) ? Number(timestampValue) : Date.parse(timestampValue))
        : Number.NaN;
    const milliseconds = timestamp < 10_000_000_000 ? timestamp * 1_000 : timestamp;
    if (!Number.isFinite(milliseconds) || Math.abs(now.getTime() - milliseconds) > this.webhookToleranceMs) {
      throw new ConnectorError("INVALID_EVENT", "Linear webhook is outside the accepted time window");
    }
    return normalizeLinearEvent(this.instance.id, payload, now.toISOString());
  }

  async getTask(externalId: string): Promise<TaskDraft> {
    const data = await this.graphql(`query Task($id: String!) {
      issue(id: $id) { id identifier title description priority updatedAt state { name type } assignee { id name }
        labels { nodes { name } } projectMilestone { id name } project { id name } }
    }`, { id: externalId });
    return linearIssueToDraft(object(data.issue), this.options.repository);
  }

  async listChanges(cursor?: string): Promise<{ cursor?: string; tasks: TaskDraft[] }> {
    const data = await this.graphql(`query Changes($after: String) {
      issues(first: 50, after: $after, orderBy: updatedAt) { pageInfo { endCursor hasNextPage } nodes {
        id identifier title description priority updatedAt state { name type } assignee { id name }
        labels { nodes { name } } projectMilestone { id name } project { id name } }
      }
    }`, { after: cursor ?? null });
    const issues = object(data.issues);
    const pageInfo = object(issues.pageInfo);
    const next = typeof pageInfo.endCursor === "string" ? pageInfo.endCursor : undefined;
    return {
      ...(next ? { cursor: next } : {}),
      tasks: Array.isArray(issues.nodes) ? issues.nodes.map((issue) => linearIssueToDraft(object(issue), this.options.repository)) : [],
    };
  }

  async updateProjection(externalId: string, projection: TaskProjection, idempotencyKey: string): Promise<{ externalRevision?: string }> {
    const data = await this.graphql(`mutation Update($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) { success issue { id updatedAt } }
    }`, {
      id: externalId,
      input: {
        title: projection.title,
        ...(projection.description ? { description: projection.description } : {}),
        priority: projection.priority ?? 0,
        ...(this.options.statusIds?.[projection.status] ? { stateId: this.options.statusIds[projection.status] } : {}),
      },
    }, idempotencyKey);
    const issue = object(object(data.issueUpdate).issue);
    return typeof issue.updatedAt === "string" ? { externalRevision: issue.updatedAt } : {};
  }

  async addComment(externalId: string, body: string, idempotencyKey: string): Promise<void> {
    await this.graphql(`mutation Comment($input: CommentCreateInput!) { commentCreate(input: $input) { success } }`, {
      input: { issueId: externalId, body: `${body}\n\n<!-- dispatcher:${idempotencyKey} -->` },
    }, idempotencyKey);
  }

  async reconcile(bindings: ExternalBinding[], cursor?: string): Promise<ReconcileResult> {
    const listed = await this.listChanges(cursor);
    const byExternal = new Map(bindings.map((binding) => [binding.externalId, binding]));
    const changes: ExternalEvent[] = [];
    const conflicts: ReconcileResult["conflicts"] = [];
    for (const task of listed.tasks) {
      const binding = byExternal.get(task.externalId);
      if (!binding || task.externalRevision === binding.externalRevision) continue;
      changes.push({
        version: 1,
        id: randomUUID(),
        connectorInstanceId: this.instance.id,
        externalEventId: `reconcile:${task.externalId}:${task.externalRevision ?? "unknown"}`,
        idempotencyKey: `${this.instance.id}:reconcile:${task.externalId}:${task.externalRevision ?? "unknown"}`,
        entityType: "task",
        action: "updated",
        externalEntityId: task.externalId,
        ...(task.externalRevision ? { externalRevision: task.externalRevision } : {}),
        occurredAt: new Date().toISOString(),
        traceId: randomUUID(),
        data: { task },
      });
      if (binding.projectionState === "PENDING") conflicts.push({
        externalId: task.externalId,
        fields: ["title", "description", "status"],
        ...(task.externalRevision ? { externalRevision: task.externalRevision } : {}),
      });
    }
    return { ...listed.cursor ? { cursor: listed.cursor } : {}, changes, conflicts };
  }

  private async graphql(query: string, variables: Record<string, unknown> = {}, idempotencyKey?: string): Promise<Record<string, unknown>> {
    const token = await this.options.resolveSecret(this.options.credentialRef);
    let response: Response;
    try {
      response = await this.fetch(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: token,
          ...(idempotencyKey ? { "x-idempotency-key": idempotencyKey } : {}),
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch (error) {
      throw new ConnectorError("TEMPORARY", error instanceof Error ? error.message : "Linear request failed", { retryable: true, operation: "read" });
    }
    if (response.status === 401 || response.status === 403) throw new ConnectorError("AUTH", "Linear authentication failed", { retryable: false, operation: "auth" });
    if (response.status === 429) {
      const delay = retryAfter(response);
      throw new ConnectorError("RATE_LIMITED", "Linear rate limit reached", { retryable: true, ...(delay === undefined ? {} : { retryAfterMs: delay }), operation: "read" });
    }
    if (response.status >= 500) throw new ConnectorError("TEMPORARY", `Linear returned ${response.status}`, { retryable: true, operation: "read" });
    if (!response.ok) throw new ConnectorError("PERMANENT", `Linear returned ${response.status}`, { retryable: false, operation: "read" });
    const body = object(await response.json());
    if (Array.isArray(body.errors) && body.errors.length) throw new ConnectorError("PERMANENT", "Linear GraphQL operation failed", { retryable: false });
    return object(body.data);
  }
}

function retryAfter(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? seconds * 1_000 : undefined;
}

export function normalizeLinearEvent(connectorInstanceId: string, payload: Record<string, unknown>, receivedAt: string): ExternalEvent {
  const data = object(payload.data);
  const externalEventId = typeof payload.webhookId === "string" ? payload.webhookId : typeof payload.id === "string" ? payload.id : "";
  const externalEntityId = typeof data.id === "string" ? data.id : "";
  if (!externalEventId || !externalEntityId) throw new ConnectorError("INVALID_EVENT", "Linear webhook identity is incomplete");
  const type = String(payload.type ?? "Issue").toLowerCase();
  const entityType: ExternalEvent["entityType"] = type.includes("comment") ? "comment" : type.includes("project") ? "project" : "task";
  const actionValue = String(payload.action ?? "update").toLowerCase();
  const action: ExternalEvent["action"] = actionValue.includes("create") ? "created" : actionValue.includes("remove") ? "deleted" : entityType === "comment" ? "commented" : "updated";
  return {
    version: 1,
    id: randomUUID(),
    connectorInstanceId,
    externalEventId,
    idempotencyKey: `${connectorInstanceId}:${externalEventId}`,
    entityType,
    action,
    externalEntityId,
    ...(typeof data.updatedAt === "string" ? { externalRevision: data.updatedAt } : {}),
    occurredAt: typeof payload.createdAt === "string" ? payload.createdAt : receivedAt,
    traceId: randomUUID(),
    data: {
      id: externalEntityId,
      ...(typeof data.title === "string" ? { title: data.title } : {}),
      ...(typeof data.description === "string" ? { description: data.description } : {}),
      ...(typeof data.priority === "number" ? { priority: data.priority } : {}),
      ...(typeof data.state === "object" ? { status: object(data.state).name } : {}),
    },
  };
}

function linearIssueToDraft(issue: Record<string, unknown>, repository?: string): TaskDraft {
  const labels = object(issue.labels);
  const labelNodes = Array.isArray(labels.nodes) ? labels.nodes.map(object) : [];
  const state = object(issue.state);
  const assignee = object(issue.assignee);
  const project = object(issue.project);
  const milestone = object(issue.projectMilestone);
  const description = typeof issue.description === "string" ? issue.description : undefined;
  const sections = markdownSections(description ?? "");
  return {
    externalId: String(issue.id ?? ""),
    ...(typeof issue.updatedAt === "string" ? { externalRevision: issue.updatedAt } : {}),
    title: String(issue.title ?? ""),
    ...(description ? { description } : {}),
    ...(typeof state.name === "string" ? { status: state.name } : {}),
    ...(typeof issue.priority === "number" ? { priority: issue.priority } : {}),
    ...(typeof assignee.id === "string" ? { assignee: assignee.id } : {}),
    labels: labelNodes.map((entry) => String(entry.name ?? "")).filter(Boolean),
    dependencies: strings(issue.dependencies),
    ...(typeof milestone.name === "string" ? { milestone: milestone.name } : {}),
    ...(repository ? { repository } : {}),
    scope: strings(issue.scope).length ? strings(issue.scope) : sections.scope,
    acceptanceCriteria: strings(issue.acceptanceCriteria).length ? strings(issue.acceptanceCriteria) : sections.acceptance,
    verification: strings(issue.verification).length ? strings(issue.verification) : sections.verification,
    constraints: strings(issue.constraints).length ? strings(issue.constraints) : sections.constraints,
    extensions: {
      linear: {
        ...(typeof issue.identifier === "string" ? { identifier: issue.identifier } : {}),
        ...(typeof project.id === "string" ? { projectId: project.id } : {}),
        ...(typeof milestone.id === "string" ? { milestoneId: milestone.id } : {}),
      },
    },
  };
}

function markdownSections(markdown: string): { scope: string[]; acceptance: string[]; verification: string[]; constraints: string[] } {
  const result = { scope: [] as string[], acceptance: [] as string[], verification: [] as string[], constraints: [] as string[] };
  let current: keyof typeof result | undefined;
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^#{1,6}\s+/.test(line)) {
      const heading = line.replace(/^#{1,6}\s+/, "").toLowerCase();
      current = heading.includes("acceptance") || heading.includes("验收")
        ? "acceptance"
        : heading.includes("verification") || heading.includes("验证")
          ? "verification"
          : heading.includes("constraint") || heading.includes("约束")
            ? "constraints"
            : heading.includes("scope") || heading.includes("范围")
              ? "scope"
              : undefined;
      continue;
    }
    const item = line.match(/^[-*]\s+(?:\[[ xX]\]\s+)?(.+)$/)?.[1];
    if (current && item) result[current].push(item);
  }
  return result;
}
