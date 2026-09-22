export type FleetScope = "fleet" | "profile" | "project" | "task";
export type AttentionKind = "WAITING_USER" | "WAITING_RESOURCE" | "STALLED" | "FAILED" | "CONNECTOR";

export interface FleetTaskInput {
  id: string;
  projectId: string;
  title: string;
  state: string;
  updatedAt: string;
  profileId?: string;
  externalRefs?: Array<{ connectorInstanceId: string; externalId: string }>;
}

export interface FleetRunInput {
  id: string;
  taskId: string;
  profileId: string;
  state: string;
  updatedAt: string;
  createdAt: string;
  lastActivityAt?: string;
  waitingReason?: string;
  resourceState?: string;
  summary?: string;
}

export interface FleetConnectorInput {
  id: string;
  displayName: string;
  kind: string;
  health: string;
  checkedAt: string;
  reason?: string;
  pendingOutbox?: number;
  deadLetters?: number;
  capabilities?: string[];
}

export interface FleetProfileInput {
  id: string;
  alias: string;
  provider: string;
  state: string;
  resourceState?: string;
  runnerId?: string;
}

export interface FleetAttentionItem {
  id: string;
  kind: AttentionKind;
  taskId?: string;
  runId?: string;
  connectorId?: string;
  title: string;
  detail: string;
  since: string;
}

export interface FleetSnapshot {
  version: 2;
  cursor: number;
  generatedAt: string;
  tasks: FleetTaskInput[];
  runs: FleetRunInput[];
  connectors: FleetConnectorInput[];
  profiles: FleetProfileInput[];
  attention: FleetAttentionItem[];
  counts: { tasks: number; activeRuns: number; waiting: number; stalled: number; failed: number; unhealthyConnectors: number };
}

export interface FleetSnapshotInput {
  tasks: readonly FleetTaskInput[];
  runs: readonly FleetRunInput[];
  connectors: readonly FleetConnectorInput[];
  profiles: readonly FleetProfileInput[];
}

export interface StallPolicy { suspectAfterMs: number; stalledAfterMs: number; }
export interface StallAssessment {
  state: "ACTIVE" | "SUSPECT" | "STALLED" | "WAITING_USER" | "WAITING_RESOURCE" | "TERMINAL";
  lastActivityAt: string;
  inactiveForMs: number;
  reason: string;
}

const terminalRunStates = new Set(["COMPLETE", "FAILED", "CANCELLED", "SUPERSEDED"]);

export class DeterministicStallDetector {
  constructor(private readonly policy: StallPolicy = { suspectAfterMs: 5 * 60_000, stalledAfterMs: 15 * 60_000 }) {
    if (policy.suspectAfterMs < 0 || policy.stalledAfterMs < policy.suspectAfterMs) throw new Error("Invalid stall policy");
  }

  assess(run: FleetRunInput, now = new Date()): StallAssessment {
    const lastActivityAt = run.lastActivityAt ?? run.updatedAt ?? run.createdAt;
    const inactiveForMs = Math.max(0, now.getTime() - new Date(lastActivityAt).getTime());
    if (terminalRunStates.has(run.state)) return { state: "TERMINAL", lastActivityAt, inactiveForMs, reason: `run is ${run.state.toLowerCase()}` };
    if (run.state === "WAITING_USER" || run.waitingReason) return { state: "WAITING_USER", lastActivityAt, inactiveForMs, reason: run.waitingReason ?? "user input required" };
    if (run.state === "WAITING_RESOURCE" || run.state === "RESOURCE_BLOCKED" || run.state === "RUNNER_UNAVAILABLE" || (run.resourceState && run.resourceState !== "AVAILABLE")) {
      return { state: "WAITING_RESOURCE", lastActivityAt, inactiveForMs, reason: run.resourceState ?? "resource unavailable" };
    }
    if (inactiveForMs >= this.policy.stalledAfterMs) return { state: "STALLED", lastActivityAt, inactiveForMs, reason: "no meaningful activity" };
    if (inactiveForMs >= this.policy.suspectAfterMs) return { state: "SUSPECT", lastActivityAt, inactiveForMs, reason: "activity is older than the suspect threshold" };
    return { state: "ACTIVE", lastActivityAt, inactiveForMs, reason: "recent meaningful activity" };
  }
}

export interface ActivitySignal {
  kind: "tool" | "message" | "state" | "verification" | "resource";
  occurredAt: string;
  label: string;
  meaningful?: boolean;
}
export interface ActivitySummary {
  lastActivityAt?: string;
  headline: string;
  total: number;
  meaningful: number;
  groups: Array<{ kind: ActivitySignal["kind"]; label: string; count: number; lastOccurredAt: string }>;
}

export function summarizeActivity(signals: readonly ActivitySignal[]): ActivitySummary {
  const sorted = [...signals].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.kind.localeCompare(right.kind) || left.label.localeCompare(right.label));
  const meaningful = sorted.filter((signal) => signal.meaningful !== false);
  const groups = new Map<string, ActivitySummary["groups"][number]>();
  for (const signal of meaningful) {
    const key = `${signal.kind}\0${signal.label}`;
    const existing = groups.get(key);
    groups.set(key, existing
      ? { ...existing, count: existing.count + 1, lastOccurredAt: signal.occurredAt }
      : { kind: signal.kind, label: signal.label, count: 1, lastOccurredAt: signal.occurredAt });
  }
  const latest = meaningful.at(-1);
  const latestGroup = latest ? groups.get(`${latest.kind}\0${latest.label}`) : undefined;
  return {
    ...(latest ? { lastActivityAt: latest.occurredAt } : {}),
    headline: latest ? `${latest.label}${(latestGroup?.count ?? 1) > 1 ? ` ×${latestGroup!.count}` : ""}` : "No meaningful activity",
    total: sorted.length,
    meaningful: meaningful.length,
    groups: [...groups.values()].sort((left, right) => left.lastOccurredAt.localeCompare(right.lastOccurredAt)),
  };
}

function copySorted<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...items].map((item) => structuredClone(item)).sort((left, right) => key(left).localeCompare(key(right)));
}

export class FleetReadModel {
  private cursor = 0;
  private snapshot?: FleetSnapshot;
  constructor(private readonly stalls = new DeterministicStallDetector()) {}

  rebuild(input: FleetSnapshotInput, now = new Date()): FleetSnapshot {
    const tasks = copySorted(input.tasks, (item) => item.id);
    const runs = copySorted(input.runs, (item) => `${item.createdAt}:${item.id}`).reverse();
    const connectors = copySorted(input.connectors, (item) => item.id);
    const profiles = copySorted(input.profiles, (item) => item.id);
    const tasksById = new Map(tasks.map((task) => [task.id, task]));
    const attention: FleetAttentionItem[] = [];
    let stalled = 0;
    let waiting = 0;
    let failed = 0;
    for (const run of runs) {
      const assessment = this.stalls.assess(run, now);
      const task = tasksById.get(run.taskId);
      if (assessment.state === "WAITING_USER" || assessment.state === "WAITING_RESOURCE" || assessment.state === "STALLED" || run.state === "FAILED") {
        const kind: AttentionKind = run.state === "FAILED"
          ? "FAILED"
          : assessment.state === "WAITING_USER"
            ? "WAITING_USER"
            : assessment.state === "WAITING_RESOURCE"
              ? "WAITING_RESOURCE"
              : "STALLED";
        if (kind === "STALLED") stalled += 1;
        if (kind === "WAITING_USER" || kind === "WAITING_RESOURCE") waiting += 1;
        if (kind === "FAILED") failed += 1;
        attention.push({ id: `run:${run.id}:${kind}`, kind, taskId: run.taskId, runId: run.id, title: task?.title ?? run.taskId, detail: run.summary ?? assessment.reason, since: assessment.lastActivityAt });
      }
    }
    for (const connector of connectors) {
      if (connector.health !== "HEALTHY") attention.push({ id: `connector:${connector.id}`, kind: "CONNECTOR", connectorId: connector.id, title: connector.displayName, detail: connector.reason ?? connector.health, since: connector.checkedAt });
    }
    this.snapshot = {
      version: 2,
      cursor: ++this.cursor,
      generatedAt: now.toISOString(),
      tasks,
      runs,
      connectors,
      profiles,
      attention: attention.sort((left, right) => right.since.localeCompare(left.since) || left.id.localeCompare(right.id)),
      counts: {
        tasks: tasks.length,
        activeRuns: runs.filter((run) => !terminalRunStates.has(run.state)).length,
        waiting,
        stalled,
        failed,
        unhealthyConnectors: connectors.filter((connector) => connector.health !== "HEALTHY").length,
      },
    };
    return structuredClone(this.snapshot);
  }

  current(): FleetSnapshot | undefined { return this.snapshot ? structuredClone(this.snapshot) : undefined; }
}

export interface FleetEvent<T = unknown> { cursor: number; type: string; occurredAt: string; coalesceKey: string; payload: T; }

export class CoalescingEventStream {
  private nextCursor = 1;
  private readonly events: FleetEvent[] = [];
  private readonly subscribers = new Set<(event: FleetEvent) => void>();
  constructor(readonly capacity = 512) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error("Event stream capacity must be positive");
  }
  publish<T>(type: string, coalesceKey: string, payload: T, occurredAt = new Date().toISOString()): FleetEvent<T> {
    const event: FleetEvent<T> = { cursor: this.nextCursor++, type, occurredAt, coalesceKey, payload: structuredClone(payload) };
    const existing = this.events.findIndex((candidate) => candidate.type === type && candidate.coalesceKey === coalesceKey);
    if (existing >= 0) this.events.splice(existing, 1);
    this.events.push(event as FleetEvent);
    if (this.events.length > this.capacity) this.events.splice(0, this.events.length - this.capacity);
    for (const subscriber of this.subscribers) subscriber(structuredClone(event));
    return structuredClone(event);
  }
  since(cursor = 0): { reset: boolean; cursor: number; events: FleetEvent[] } {
    const oldest = this.events[0]?.cursor ?? this.nextCursor;
    const reset = cursor > 0 && cursor < oldest - 1;
    const events = reset ? [...this.events] : this.events.filter((event) => event.cursor > cursor);
    return { reset, cursor: this.nextCursor - 1, events: structuredClone(events) };
  }
  size(): number { return this.events.length; }
  subscribe(subscriber: (event: FleetEvent) => void): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }
}

export interface Page<T> { items: T[]; total: number; offset: number; limit: number; }
export function paginate<T>(items: readonly T[], input: { offset?: number; limit?: number } = {}): Page<T> {
  const offset = Math.max(0, Math.trunc(input.offset ?? 0));
  const limit = Math.min(250, Math.max(1, Math.trunc(input.limit ?? 50)));
  return { items: structuredClone(items.slice(offset, offset + limit)), total: items.length, offset, limit };
}
