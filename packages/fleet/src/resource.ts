import type { ResourceSnapshot, ResourceState, Run } from "@dispatcher/domain";

export interface ResourceAssessment {
  profileId: string;
  state: ResourceState;
  reason?: string;
  resetsAt?: string;
  source: ResourceSnapshot["source"];
  confidence: ResourceSnapshot["confidence"];
  checkedAt: string;
  freshUntil: string;
  evidence: ResourceSnapshot[];
}

const confidenceRank: Record<ResourceSnapshot["confidence"], number> = { high: 3, medium: 2, low: 1 };
const stateRank: Record<ResourceState, number> = {
  QUOTA_EXHAUSTED: 8,
  RATE_LIMITED: 7,
  WAITING_RESET: 6,
  AUTH_ERROR: 5,
  PROVIDER_DOWN: 4,
  LOW: 3,
  AVAILABLE: 2,
  UNKNOWN: 1,
};

function clone<T>(value: T): T { return structuredClone(value); }

/**
 * Keeps provider observations separate from task state. The effective value is
 * deterministic: confidence first, then freshness, then the conservative state.
 */
export class MultiSignalResourceRegistry {
  private readonly signals = new Map<string, Map<ResourceSnapshot["source"], ResourceSnapshot>>();

  constructor(readonly maxSignalAgeMs = 6 * 60 * 60_000) {
    if (!Number.isFinite(maxSignalAgeMs) || maxSignalAgeMs <= 0) throw new Error("Resource signal max age must be positive");
  }

  record(signal: ResourceSnapshot): ResourceAssessment {
    if (!Number.isFinite(new Date(signal.checkedAt).getTime())) throw new Error("Resource signal checkedAt is invalid");
    const profile = this.signals.get(signal.profileId) ?? new Map<ResourceSnapshot["source"], ResourceSnapshot>();
    const current = profile.get(signal.source);
    if (!current || current.checkedAt <= signal.checkedAt) profile.set(signal.source, clone(signal));
    this.signals.set(signal.profileId, profile);
    return this.assess(signal.profileId, new Date(signal.checkedAt));
  }

  restore(signals: readonly ResourceSnapshot[]): void {
    for (const signal of signals) this.record(signal);
  }

  assess(profileId: string, now = new Date()): ResourceAssessment {
    const cutoff = now.getTime() - this.maxSignalAgeMs;
    const profile = this.signals.get(profileId);
    const fresh = [...(profile?.values() ?? [])]
      .filter((signal) => new Date(signal.checkedAt).getTime() >= cutoff)
      .sort((left, right) =>
        confidenceRank[right.confidence] - confidenceRank[left.confidence]
        || right.checkedAt.localeCompare(left.checkedAt)
        || stateRank[right.state] - stateRank[left.state]
        || left.source.localeCompare(right.source));
    const effective = fresh[0];
    if (!effective) {
      const checkedAt = now.toISOString();
      return { profileId, state: "UNKNOWN", reason: "No fresh resource signal", source: "manual", confidence: "low", checkedAt, freshUntil: checkedAt, evidence: [] };
    }
    return {
      profileId,
      state: effective.state,
      ...(effective.reason ? { reason: effective.reason } : {}),
      ...(effective.resetsAt ? { resetsAt: effective.resetsAt } : {}),
      source: effective.source,
      confidence: effective.confidence,
      checkedAt: effective.checkedAt,
      freshUntil: new Date(new Date(effective.checkedAt).getTime() + this.maxSignalAgeMs).toISOString(),
      evidence: fresh.map(clone),
    };
  }

  list(now = new Date()): ResourceAssessment[] {
    return [...this.signals.keys()].sort().map((profileId) => this.assess(profileId, now));
  }

  signalsFor(profileId: string): ResourceSnapshot[] {
    return [...(this.signals.get(profileId)?.values() ?? [])].map(clone).sort((left, right) => left.source.localeCompare(right.source));
  }
}

export interface ResourceProbeSchedule {
  profileId: string;
  nextProbeAt: string;
  attempts: number;
  status: "SCHEDULED" | "PROBING" | "RECOVERED";
  resetAt?: string;
  lastProbeAt?: string;
  lastState?: ResourceState;
}

function deterministicJitter(profileId: string, rangeMs: number): number {
  if (rangeMs <= 0) return 0;
  let hash = 0;
  for (const character of profileId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash % (rangeMs + 1);
}

/** A persisted due-list, not a polling loop. reset_at schedules a probe only. */
export class ResetAwareProbeScheduler {
  private readonly schedules = new Map<string, ResourceProbeSchedule>();

  constructor(
    readonly baseCooldownMs = 60_000,
    readonly maxCooldownMs = 30 * 60_000,
    readonly jitterMs = 5_000,
  ) {}

  schedule(snapshot: ResourceSnapshot, now = new Date()): ResourceProbeSchedule | undefined {
    if (["AVAILABLE", "LOW"].includes(snapshot.state)) {
      this.schedules.delete(snapshot.profileId);
      return undefined;
    }
    const existing = this.schedules.get(snapshot.profileId);
    if (existing?.status === "SCHEDULED" || existing?.status === "PROBING") return clone(existing);
    const reset = snapshot.resetsAt ? new Date(snapshot.resetsAt).getTime() : Number.NaN;
    const dueAt = Number.isFinite(reset) && reset > now.getTime()
      ? reset + deterministicJitter(snapshot.profileId, this.jitterMs)
      : now.getTime() + this.baseCooldownMs + deterministicJitter(snapshot.profileId, this.jitterMs);
    const scheduled: ResourceProbeSchedule = {
      profileId: snapshot.profileId,
      nextProbeAt: new Date(dueAt).toISOString(),
      attempts: existing?.attempts ?? 0,
      status: "SCHEDULED",
      ...(snapshot.resetsAt ? { resetAt: snapshot.resetsAt } : {}),
      lastState: snapshot.state,
    };
    this.schedules.set(snapshot.profileId, scheduled);
    return clone(scheduled);
  }

  restore(records: readonly ResourceProbeSchedule[]): void {
    for (const record of records) {
      if (record.status !== "RECOVERED") this.schedules.set(record.profileId, clone({ ...record, status: "SCHEDULED" }));
    }
  }

  due(now = new Date(), limit = 25): ResourceProbeSchedule[] {
    return [...this.schedules.values()]
      .filter((record) => record.status === "SCHEDULED" && record.nextProbeAt <= now.toISOString())
      .sort((left, right) => left.nextProbeAt.localeCompare(right.nextProbeAt) || left.profileId.localeCompare(right.profileId))
      .slice(0, limit)
      .map((record) => {
        const probing = { ...record, status: "PROBING" as const, lastProbeAt: now.toISOString() };
        this.schedules.set(record.profileId, probing);
        return clone(probing);
      });
  }

  complete(profileId: string, snapshot: ResourceSnapshot, now = new Date()): ResourceProbeSchedule {
    const current = this.schedules.get(profileId);
    if (!current) throw new Error(`No resource probe is scheduled for ${profileId}`);
    if (snapshot.state === "AVAILABLE" || snapshot.state === "LOW") {
      const recovered: ResourceProbeSchedule = { ...current, status: "RECOVERED", lastProbeAt: now.toISOString(), lastState: snapshot.state };
      this.schedules.delete(profileId);
      return recovered;
    }
    const attempts = current.attempts + 1;
    const cooldown = Math.min(this.maxCooldownMs, this.baseCooldownMs * 2 ** Math.min(attempts, 10));
    const scheduled: ResourceProbeSchedule = {
      ...current,
      status: "SCHEDULED",
      attempts,
      lastProbeAt: now.toISOString(),
      lastState: snapshot.state,
      nextProbeAt: new Date(now.getTime() + cooldown + deterministicJitter(profileId, this.jitterMs)).toISOString(),
    };
    this.schedules.set(profileId, scheduled);
    return clone(scheduled);
  }

  list(): ResourceProbeSchedule[] { return [...this.schedules.values()].map(clone).sort((left, right) => left.profileId.localeCompare(right.profileId)); }
}

export type RecoveryDecision =
  | { action: "RESUME"; reason: string; idempotencyKey: string }
  | { action: "REROUTE_REQUIRED"; reason: string; revokeLeaseId: string; idempotencyKey: string }
  | { action: "IGNORE_STALE"; reason: string; idempotencyKey: string };

export function decideResourceRecovery(input: {
  run: Run;
  currentGeneration: number;
  currentRunId?: string;
  sessionResumable: boolean;
  profileAvailable: boolean;
  runnerAvailable: boolean;
}): RecoveryDecision {
  const idempotencyKey = `resource-recovery:${input.run.id}:${input.run.generation}`;
  if (input.run.generation !== input.currentGeneration || (input.currentRunId && input.currentRunId !== input.run.id)) {
    return { action: "IGNORE_STALE", reason: "Run is no longer the current generation", idempotencyKey };
  }
  if (input.run.state !== "RESOURCE_BLOCKED") return { action: "IGNORE_STALE", reason: `Run state is ${input.run.state}`, idempotencyKey };
  if (input.sessionResumable && input.profileAvailable && input.runnerAvailable) {
    return { action: "RESUME", reason: "Original provider session, profile and runner are available", idempotencyKey };
  }
  return {
    action: "REROUTE_REQUIRED",
    reason: "Original execution authority cannot be resumed; an explicit controlled reroute is required",
    revokeLeaseId: input.run.leaseId,
    idempotencyKey,
  };
}
