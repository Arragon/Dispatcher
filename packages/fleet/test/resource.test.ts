import { describe, expect, it } from "vitest";
import type { ResourceSnapshot, Run } from "@dispatcher/domain";
import { MultiSignalResourceRegistry, ResetAwareProbeScheduler, decideResourceRecovery } from "../src/index.js";

const at = "2026-09-23T00:00:00.000Z";
const signal = (overrides: Partial<ResourceSnapshot> = {}): ResourceSnapshot => ({
  profileId: "codex-main", state: "QUOTA_EXHAUSTED", reason: "usage limit", resetsAt: "2026-09-23T01:00:00.000Z",
  source: "session", confidence: "high", checkedAt: at, ...overrides,
});

describe("M11 resource continuity", () => {
  it("resolves multiple signals by confidence and freshness and expires stale blockers", () => {
    const registry = new MultiSignalResourceRegistry(60_000);
    registry.record(signal({ source: "error", confidence: "medium", checkedAt: "2026-09-22T23:59:40.000Z" }));
    registry.record(signal({ state: "AVAILABLE", source: "probe", confidence: "high", checkedAt: "2026-09-22T23:59:50.000Z", reason: "probe succeeded", resetsAt: undefined }));
    expect(registry.assess("codex-main", new Date(at))).toMatchObject({ state: "AVAILABLE", source: "probe", confidence: "high", evidence: [{ state: "AVAILABLE" }, { state: "QUOTA_EXHAUSTED" }] });
    expect(registry.assess("codex-main", new Date("2026-09-23T00:02:00.000Z"))).toMatchObject({ state: "UNKNOWN", reason: "No fresh resource signal", evidence: [] });
  });

  it("persists a reset-aware due list and requires a successful probe before recovery", () => {
    const scheduler = new ResetAwareProbeScheduler(1_000, 8_000, 0);
    scheduler.schedule(signal({ resetsAt: "2026-09-23T00:00:05.000Z" }), new Date(at));
    expect(scheduler.due(new Date("2026-09-23T00:00:04.999Z"))).toEqual([]);
    expect(scheduler.due(new Date("2026-09-23T00:00:05.000Z"))).toHaveLength(1);
    const retry = scheduler.complete("codex-main", signal({ state: "RATE_LIMITED", checkedAt: "2026-09-23T00:00:05.000Z" }), new Date("2026-09-23T00:00:05.000Z"));
    expect(retry).toMatchObject({ status: "SCHEDULED", attempts: 1, lastState: "RATE_LIMITED" });
    const restored = new ResetAwareProbeScheduler(1_000, 8_000, 0);
    restored.restore(scheduler.list());
    expect(restored.list()).toEqual(scheduler.list());
    restored.due(new Date(retry.nextProbeAt));
    expect(restored.complete("codex-main", signal({ state: "AVAILABLE", checkedAt: retry.nextProbeAt, resetsAt: undefined }), new Date(retry.nextProbeAt))).toMatchObject({ status: "RECOVERED" });
    expect(restored.list()).toEqual([]);
  });

  it("resumes only the current generation and makes reroute an explicit decision", () => {
    const run: Run = { id: "run-1", taskId: "task-1", runnerId: "runner-1", providerId: "codex", profileId: "codex-main", sessionId: "session-1", state: "RESOURCE_BLOCKED", attempt: 1, generation: 3, leaseId: "lease-3", verification: { state: "PENDING", commands: [] } };
    expect(decideResourceRecovery({ run, currentGeneration: 3, currentRunId: run.id, sessionResumable: true, profileAvailable: true, runnerAvailable: true })).toMatchObject({ action: "RESUME", idempotencyKey: "resource-recovery:run-1:3" });
    expect(decideResourceRecovery({ run, currentGeneration: 3, currentRunId: run.id, sessionResumable: false, profileAvailable: true, runnerAvailable: true })).toMatchObject({ action: "REROUTE_REQUIRED", revokeLeaseId: "lease-3" });
    expect(decideResourceRecovery({ run, currentGeneration: 4, currentRunId: "run-2", sessionResumable: true, profileAvailable: true, runnerAvailable: true })).toMatchObject({ action: "IGNORE_STALE" });
  });
});
