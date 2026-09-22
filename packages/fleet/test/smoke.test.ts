import { describe, expect, it } from "vitest";
import { CoalescingEventStream, DeterministicStallDetector, FleetReadModel, paginate, summarizeActivity } from "../src/index.js";

const now = new Date("2026-09-22T12:00:00.000Z");

describe("Fleet read model v2", () => {
  it("rebuilds the same cross-view truth and keeps waiting distinct from stalled", () => {
    const model = new FleetReadModel(new DeterministicStallDetector({ suspectAfterMs: 1_000, stalledAfterMs: 2_000 }));
    const snapshot = model.rebuild({
      tasks: [{ id: "task-1", projectId: "project-1", title: "Ship", state: "IN_PROGRESS", updatedAt: "2026-09-22T11:59:00.000Z" }],
      runs: [
        { id: "run-stalled", taskId: "task-1", profileId: "codex", state: "ACTIVE", createdAt: "2026-09-22T11:00:00.000Z", updatedAt: "2026-09-22T11:00:00.000Z" },
        { id: "run-waiting", taskId: "task-1", profileId: "codex", state: "WAITING_USER", createdAt: "2026-09-22T11:00:00.000Z", updatedAt: "2026-09-22T11:59:59.000Z", waitingReason: "approval" },
        { id: "run-resource", taskId: "task-1", profileId: "qoder", state: "RESOURCE_BLOCKED", createdAt: "2026-09-22T11:00:00.000Z", updatedAt: "2026-09-22T11:58:00.000Z", summary: "authentication required" },
      ],
      connectors: [{ id: "linear", displayName: "Linear", kind: "task", health: "DEGRADED", checkedAt: now.toISOString(), reason: "retrying" }],
      profiles: [{ id: "codex", alias: "main", provider: "codex", state: "CONFIGURED" }],
    }, now);
    expect(snapshot.counts).toMatchObject({ tasks: 1, activeRuns: 3, waiting: 2, stalled: 1, unhealthyConnectors: 1 });
    expect(snapshot.attention.map((item) => item.kind).sort()).toEqual(["CONNECTOR", "STALLED", "WAITING_RESOURCE", "WAITING_USER"]);
    expect(model.current()).toEqual(snapshot);
  });

  it("coalesces noisy activity deterministically", () => {
    expect(summarizeActivity([
      { kind: "tool", occurredAt: "2026-09-22T10:00:00.000Z", label: "Reading files" },
      { kind: "tool", occurredAt: "2026-09-22T10:01:00.000Z", label: "Reading files" },
      { kind: "message", occurredAt: "2026-09-22T10:02:00.000Z", label: "heartbeat", meaningful: false },
    ])).toMatchObject({ headline: "Reading files ×2", total: 3, meaningful: 2, groups: [{ count: 2 }] });
  });

  it("bounds reconnect history and marks cursors that require a reset", () => {
    const stream = new CoalescingEventStream(3);
    const delivered: number[] = [];
    const unsubscribe = stream.subscribe((event) => delivered.push(event.cursor));
    stream.publish("run.changed", "run-1", { state: "A" });
    stream.publish("run.changed", "run-1", { state: "B" });
    stream.publish("run.changed", "run-2", { state: "A" });
    stream.publish("task.changed", "task-1", { state: "READY" });
    stream.publish("connector.changed", "linear", { health: "HEALTHY" });
    expect(stream.size()).toBe(3);
    expect(stream.since(0).events.map((event) => event.coalesceKey)).toEqual(["run-2", "task-1", "linear"]);
    expect(stream.since(1).reset).toBe(true);
    expect(delivered).toEqual([1, 2, 3, 4, 5]);
    unsubscribe();
    stream.publish("run.changed", "run-3", { state: "A" });
    expect(delivered).toHaveLength(5);
  });

  it("keeps 10k history server-paged", () => {
    const rows = Array.from({ length: 10_000 }, (_, index) => ({ id: `run-${index}` }));
    const page = paginate(rows, { offset: 1_000, limit: 100 });
    expect(page).toMatchObject({ total: 10_000, offset: 1_000, limit: 100 });
    expect(page.items).toHaveLength(100);
    expect(page.items[0]?.id).toBe("run-1000");
  });
});
