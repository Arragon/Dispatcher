export const TASK_STATES = [
  "BACKLOG",
  "NEEDS_SPEC",
  "READY",
  "QUEUED",
  "RUNNING",
  "WAITING_USER",
  "WAITING_RESOURCE",
  "VERIFYING",
  "REVIEW",
  "DONE",
  "CANCELLED",
  "FAILED",
] as const;

export const RUN_STATES = [
  "CREATED",
  "STARTING",
  "ACTIVE",
  "WAITING_USER",
  "RESOURCE_BLOCKED",
  "RUNNER_UNAVAILABLE",
  "SUSPECTED_STALL",
  "VERIFYING",
  "DELIVERING",
  "COMPLETE",
  "FAILED",
  "CANCELLED",
  "SUPERSEDED",
] as const;

export const RUNNER_STATES = ["ONLINE", "DEGRADED", "DRAINING", "OFFLINE"] as const;
export const RESOURCE_STATES = [
  "AVAILABLE",
  "LOW",
  "RATE_LIMITED",
  "QUOTA_EXHAUSTED",
  "WAITING_RESET",
  "AUTH_ERROR",
  "PROVIDER_DOWN",
  "UNKNOWN",
] as const;

export type TaskState = (typeof TASK_STATES)[number];
export type RunState = (typeof RUN_STATES)[number];
export type RunnerState = (typeof RUNNER_STATES)[number];
export type ResourceState = (typeof RESOURCE_STATES)[number];
export type IsoDateTime = string;
export type EntityId = string;

export type ConnectorKind = "task" | "messaging" | "scm";
export type ConnectorHealth = "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "AUTH_REQUIRED" | "DISABLED";
export type ProjectionState = "PENDING" | "SYNCED" | "CONFLICT" | "FAILED" | "DISABLED";
export type CapabilitySupport = "supported" | "unsupported" | "unknown";

export interface ConnectorCapability {
  namespace: string;
  version: number;
  support: CapabilitySupport;
}

export interface ConnectorDefinition {
  id: string;
  kind: ConnectorKind;
  displayName: string;
  apiVersion: 1;
  capabilities: ConnectorCapability[];
}

export interface ConnectorInstance {
  id: EntityId;
  definitionId: string;
  kind: ConnectorKind;
  displayName: string;
  enabled: boolean;
  credentialRef?: string;
  health: ConnectorHealth;
  revision: number;
  updatedAt: IsoDateTime;
}

export interface ExternalRef {
  connectorInstanceId: EntityId;
  entityType: "project" | "task" | "conversation" | "delivery";
  externalId: string;
  externalUrl?: string;
  externalRevision?: string;
}

export interface ExternalBinding extends ExternalRef {
  id: EntityId;
  canonicalEntityId: EntityId;
  projectionState: ProjectionState;
  platformExtensions?: Record<string, unknown>;
  updatedAt: IsoDateTime;
}

export interface OriginMetadata {
  source: "local" | "connector" | "migration";
  connectorInstanceId?: EntityId;
  externalEventId?: string;
}

export interface Project {
  id: EntityId;
  /** @deprecated External ids belong in bindings. Retained for v1 fixture compatibility. */
  linearProjectId?: string;
  name: string;
  repository?: string;
  revision?: number;
  bindings?: ExternalBinding[];
  updatedAt: IsoDateTime;
}

export interface Task {
  id: EntityId;
  projectId: EntityId;
  /** @deprecated External ids belong in bindings. Retained for v1 fixture compatibility. */
  linearIssueId?: string;
  title: string;
  state: TaskState;
  currentRunId?: EntityId;
  revision?: number;
  bindings?: ExternalBinding[];
  origin?: OriginMetadata;
  description?: string;
  priority?: number;
  assignee?: string;
  labels?: string[];
  dueAt?: IsoDateTime;
  platformExtensions?: Record<string, unknown>;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface TaskContract {
  version: 1;
  revision: number;
  goal: string;
  scope: string[];
  acceptanceCriteria: string[];
  verification: string[];
  constraints: string[];
  delivery: { type: "pull-request" | "commit" | "none"; repository?: string; baseBranch?: string };
}

export interface DeliveryEvidence {
  id: EntityId;
  taskId: EntityId;
  runId: EntityId;
  connectorInstanceId: EntityId;
  kind: "pull-request" | "commit" | "ci";
  externalId: string;
  url?: string;
  state: "PENDING" | "READY" | "FAILED" | "MERGED";
  revision: number;
  metadata: Record<string, unknown>;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export function negotiateCapabilities(
  definition: ConnectorDefinition,
  requested: readonly { namespace: string; minimumVersion: number; required?: boolean }[],
): { accepted: ConnectorCapability[]; rejected: string[] } {
  const accepted: ConnectorCapability[] = [];
  const rejected: string[] = [];
  for (const request of requested) {
    const capability = definition.capabilities.find((entry) => entry.namespace === request.namespace);
    if (capability?.support === "supported" && capability.version >= request.minimumVersion) accepted.push(structuredClone(capability));
    else if (request.required) rejected.push(request.namespace);
  }
  return { accepted, rejected };
}

export function upgradeLegacyTask(task: Task): Task {
  const upgraded = structuredClone(task);
  upgraded.revision ??= 1;
  upgraded.bindings ??= task.linearIssueId
    ? [{
        id: `legacy-linear:${task.id}`,
        canonicalEntityId: task.id,
        connectorInstanceId: "legacy-linear",
        entityType: "task",
        externalId: task.linearIssueId,
        projectionState: "SYNCED",
        updatedAt: task.updatedAt,
      }]
    : [];
  upgraded.origin ??= task.linearIssueId
    ? { source: "migration", connectorInstanceId: "legacy-linear" }
    : { source: "local" };
  return upgraded;
}

export type ProviderId = "codex" | "cursor" | "devin" | "qoder" | "kiro" | "codebuddy" | string;

export interface Provider {
  id: ProviderId;
  displayName: string;
}

export interface Profile {
  id: EntityId;
  providerId: ProviderId;
  runnerId: EntityId;
  alias: string;
  credentialRef?: string;
  resourceState: ResourceState;
  updatedAt: IsoDateTime;
}

export interface Runner {
  id: EntityId;
  displayName: string;
  platform: "darwin" | "win32" | "linux";
  architecture: string;
  state: RunnerState;
  capabilities: string[];
  capacity: number;
  lastSeenAt: IsoDateTime;
}

export interface Session {
  id: EntityId;
  providerId: ProviderId;
  profileId: EntityId;
  nativeSessionId?: string;
  resumable: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface VerificationEvidence {
  state: "PENDING" | "PASSED" | "FAILED" | "SKIPPED";
  commands: string[];
  summary?: string;
}

export interface Run {
  id: EntityId;
  taskId: EntityId;
  runnerId: EntityId;
  providerId: ProviderId;
  profileId: EntityId;
  sessionId: EntityId;
  providerSessionId?: EntityId;
  resumePolicy?: "same-session" | "controlled-reroute" | "manual";
  state: RunState;
  attempt: number;
  generation: number;
  leaseId: string;
  leaseExpiresAt?: IsoDateTime;
  revokedLeaseIds?: string[];
  taskRevision?: number;
  contractRevision?: number;
  branch?: string;
  worktree?: string;
  startedAt?: IsoDateTime;
  lastActivityAt?: IsoDateTime;
  endedAt?: IsoDateTime;
  activitySummary?: string;
  failureReason?: string;
  resourceBlockReason?: string;
  recoveryReason?: string;
  prUrl?: string;
  verification: VerificationEvidence;
}

export interface ResourceSnapshot {
  profileId: EntityId;
  state: ResourceState;
  reason?: string;
  resetsAt?: IsoDateTime;
  source: "sdk" | "cli" | "session" | "error" | "probe" | "manual";
  confidence: "high" | "medium" | "low";
  checkedAt: IsoDateTime;
}

const taskTransitions: Readonly<Record<TaskState, readonly TaskState[]>> = {
  BACKLOG: ["NEEDS_SPEC", "READY", "CANCELLED"],
  NEEDS_SPEC: ["READY", "CANCELLED"],
  READY: ["QUEUED", "CANCELLED"],
  QUEUED: ["RUNNING", "WAITING_RESOURCE", "CANCELLED", "FAILED"],
  RUNNING: ["WAITING_USER", "WAITING_RESOURCE", "VERIFYING", "CANCELLED", "FAILED"],
  WAITING_USER: ["RUNNING", "CANCELLED", "FAILED"],
  WAITING_RESOURCE: ["QUEUED", "RUNNING", "CANCELLED", "FAILED"],
  VERIFYING: ["RUNNING", "REVIEW", "DONE", "FAILED", "CANCELLED"],
  REVIEW: ["RUNNING", "DONE", "CANCELLED", "FAILED"],
  DONE: [],
  CANCELLED: [],
  FAILED: ["QUEUED"],
};

const runTransitions: Readonly<Record<RunState, readonly RunState[]>> = {
  CREATED: ["STARTING", "CANCELLED", "SUPERSEDED"],
  STARTING: ["ACTIVE", "RESOURCE_BLOCKED", "RUNNER_UNAVAILABLE", "FAILED", "CANCELLED", "SUPERSEDED"],
  ACTIVE: ["WAITING_USER", "RESOURCE_BLOCKED", "RUNNER_UNAVAILABLE", "SUSPECTED_STALL", "VERIFYING", "FAILED", "CANCELLED", "SUPERSEDED"],
  WAITING_USER: ["ACTIVE", "FAILED", "CANCELLED", "SUPERSEDED"],
  RESOURCE_BLOCKED: ["ACTIVE", "FAILED", "CANCELLED", "SUPERSEDED"],
  RUNNER_UNAVAILABLE: ["ACTIVE", "FAILED", "CANCELLED", "SUPERSEDED"],
  SUSPECTED_STALL: ["ACTIVE", "FAILED", "CANCELLED", "SUPERSEDED"],
  VERIFYING: ["ACTIVE", "DELIVERING", "FAILED", "CANCELLED", "SUPERSEDED"],
  DELIVERING: ["COMPLETE", "FAILED", "CANCELLED", "SUPERSEDED"],
  COMPLETE: [],
  FAILED: [],
  CANCELLED: [],
  SUPERSEDED: [],
};

export class InvalidStateTransitionError extends Error {
  readonly code = "INVALID_STATE_TRANSITION";

  constructor(
    readonly machine: "task" | "run",
    readonly from: TaskState | RunState,
    readonly to: TaskState | RunState,
  ) {
    super(`Invalid ${machine} transition: ${from} -> ${to}`);
    this.name = "InvalidStateTransitionError";
  }
}

export function assertTaskTransition(from: TaskState, to: TaskState): void {
  if (!taskTransitions[from].includes(to)) throw new InvalidStateTransitionError("task", from, to);
}

export function assertRunTransition(from: RunState, to: RunState): void {
  if (!runTransitions[from].includes(to)) throw new InvalidStateTransitionError("run", from, to);
}

export function isTerminalTaskState(state: TaskState): boolean {
  return state === "DONE" || state === "CANCELLED";
}

export function isTerminalRunState(state: RunState): boolean {
  return state === "COMPLETE" || state === "FAILED" || state === "CANCELLED" || state === "SUPERSEDED";
}

export const domainContractSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://dispatcher.local/schemas/domain-v1.json",
  title: "Agent Dispatcher Domain Contract v1",
  type: "object",
  $defs: {
    taskState: { enum: TASK_STATES },
    runState: { enum: RUN_STATES },
    runnerState: { enum: RUNNER_STATES },
    resourceState: { enum: RESOURCE_STATES },
  },
} as const;
