import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LeaseFenceError,
  RemoteRunnerClient,
  RemoteRunnerServer,
  RunnerJournal,
  RunnerLeaseAuthority,
  RunnerRegistry,
  reconcileRunnerState,
} from "../src/index.js";

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function runner(id = "remote-mac") {
  return {
    id,
    displayName: "Remote Mac",
    platform: "darwin" as const,
    architecture: "arm64",
    state: "ONLINE" as const,
    capabilities: ["remote", "codex"],
    capacity: 2,
    lastSeenAt: new Date().toISOString(),
  };
}

describe("remote runner control plane", () => {
  it("authenticates registration and executes RPC over the versioned websocket channel", async () => {
    const registry = new RunnerRegistry();
    const server = new RemoteRunnerServer({ registry, port: 0, authenticate: ({ bearerToken }) => bearerToken === "test-token" });
    await server.ready();
    const address = server.address()!;
    const client = new RemoteRunnerClient({ url: `ws://127.0.0.1:${address.port}`, bearerToken: "test-token", runner: runner() });
    const handler = vi.fn(() => ({ status: "ok" }));
    client.register("runner.health", handler);
    await client.start();

    const response = await server.sendCommand("remote-mac", { type: "runner.health" });

    expect(response.payload).toMatchObject({ type: "rpc.result", result: { status: "ok" } });
    expect(handler).toHaveBeenCalledOnce();
    expect(registry.list()[0]).toMatchObject({ id: "remote-mac", state: "ONLINE" });
    const drained = await server.sendCommand("remote-mac", { type: "runner.drain", draining: true });
    expect(drained.payload).toMatchObject({ type: "rpc.result", result: { state: "DRAINING" } });
    expect(registry.list()[0]?.state).toBe("DRAINING");
    await expect(server.sendCommand("remote-mac", { type: "run.start", runId: "blocked" })).rejects.toThrow("draining");
    await client.stop();
    await server.close();
  });

  it("rejects an unauthorized runner before it enters the registry", async () => {
    const registry = new RunnerRegistry();
    const server = new RemoteRunnerServer({ registry, port: 0, authenticate: () => false });
    await server.ready();
    const address = server.address()!;
    const client = new RemoteRunnerClient({ url: `ws://127.0.0.1:${address.port}`, bearerToken: "wrong", runner: runner("intruder") });
    await expect(client.start()).rejects.toThrow("unauthorized");
    expect(registry.list()).toEqual([]);
    await server.close();
  });

  it("bounds connection buffering and requires TLS outside loopback", () => {
    const registry = new RunnerRegistry();
    expect(() => new RemoteRunnerServer({ registry, host: "0.0.0.0", port: 0, authenticate: () => true })).toThrow("TLS server");
  });

  it("replays acknowledgements after runner restart without executing duplicate run.start", async () => {
    const directory = mkdtempSync(join(tmpdir(), "dispatcher-remote-replay-"));
    tempDirectories.push(directory);
    const journalPath = join(directory, "runner.sqlite");
    const registry = new RunnerRegistry();
    const server = new RemoteRunnerServer({ registry, port: 0, authenticate: () => true });
    await server.ready();
    const address = server.address()!;
    const firstJournal = new RunnerJournal(journalPath);
    const first = new RemoteRunnerClient({ url: `ws://127.0.0.1:${address.port}`, bearerToken: "token", runner: runner(), journal: firstJournal });
    const firstHandler = vi.fn(() => ({ started: true }));
    first.register("run.start", firstHandler);
    await first.start();
    const initial = await server.sendCommand("remote-mac", { type: "run.start", runId: "run-1" }, { messageId: "start-run-1" });
    expect(initial.payload).toMatchObject({ type: "rpc.result", result: { started: true } });
    await first.stop();
    firstJournal.close();

    const restoredJournal = new RunnerJournal(journalPath);
    const restored = new RemoteRunnerClient({ url: `ws://127.0.0.1:${address.port}`, bearerToken: "token", runner: runner(), journal: restoredJournal });
    const restoredHandler = vi.fn(() => ({ started: "twice" }));
    restored.register("run.start", restoredHandler);
    await restored.start();
    const duplicate = await server.sendCommand("remote-mac", { type: "run.start", runId: "run-1" }, { messageId: "start-run-1" });
    expect(duplicate.payload).toMatchObject({ type: "rpc.result", result: { started: true } });
    expect(firstHandler).toHaveBeenCalledOnce();
    expect(restoredHandler).not.toHaveBeenCalled();
    await restored.stop();
    restoredJournal.close();
    await server.close();
  });
});

describe("runner journal", () => {
  it("persists replay order, acknowledgements, checksums, and compaction across restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "dispatcher-runner-journal-"));
    tempDirectories.push(directory);
    const path = join(directory, "runner.sqlite");
    const first = new RunnerJournal(path);
    first.append({
      protocolVersion: "1.2",
      messageId: "event-1",
      traceId: "trace-1",
      runnerId: "remote-mac",
      sequence: 1,
      sentAt: new Date().toISOString(),
      kind: "event",
      payload: { type: "runner.heartbeat", runnerId: "remote-mac", state: "ONLINE" },
    });
    first.append({
      protocolVersion: "1.2",
      messageId: "event-2",
      traceId: "trace-2",
      runnerId: "remote-mac",
      sequence: 2,
      sentAt: new Date().toISOString(),
      kind: "event",
      payload: { type: "runner.heartbeat", runnerId: "remote-mac", state: "ONLINE" },
    });
    first.acknowledge(2);
    first.close();

    const restored = new RunnerJournal(path);
    expect(restored.schemaVersion).toBe(1);
    expect(restored.replay(0).map((entry) => entry.sequence)).toEqual([1, 2]);
    expect(restored.replay()).toEqual([]);
    expect(restored.compact(0)).toBe(2);
    restored.close();
  });
});

describe("lease fencing and reconciliation", () => {
  it("denies expired, revoked, and stale generations and audits every fence", () => {
    const authority = new RunnerLeaseAuthority();
    authority.issue({ runId: "run-1", runnerId: "runner-a", leaseId: "lease-1", generation: 1, expiresAt: "2026-09-23T10:00:00.000Z" }, "2026-09-23T09:00:00.000Z");
    expect(authority.fence("run-1", "lease-1", 1, "push", "2026-09-23T09:30:00.000Z")).toMatchObject({ leaseId: "lease-1" });
    expect(() => authority.fence("run-1", "lease-1", 1, "push", "2026-09-23T10:00:00.000Z")).toThrowError(LeaseFenceError);
    authority.issue({ runId: "run-1", runnerId: "runner-b", leaseId: "lease-2", generation: 2, expiresAt: "2026-09-23T12:00:00.000Z" });
    expect(() => authority.fence("run-1", "lease-1", 1, "pull-request")).toThrow("not current");
    authority.revoke("run-1", "lease-2", 2, "rerouted");
    expect(() => authority.fence("run-1", "lease-2", 2, "complete")).toThrow("revoked");
    expect(authority.audit("run-1").map((entry) => entry.action)).toEqual(expect.arrayContaining(["ISSUE", "FENCE_ALLOW", "FENCE_DENY", "REVOKE"]));
  });

  it("produces deterministic recovery, stale-stop, and human-attention decisions", () => {
    const decisions = reconcileRunnerState(
      "runner-a",
      [
        { runId: "missing", runnerId: "runner-a", generation: 1, leaseId: "l1" },
        { runId: "stale", runnerId: "runner-a", generation: 2, leaseId: "l2" },
        { runId: "ahead", runnerId: "runner-a", generation: 2, leaseId: "l2" },
      ],
      [
        { runId: "orphan", generation: 1, leaseId: "old" },
        { runId: "stale", generation: 1, leaseId: "old" },
        { runId: "ahead", generation: 3, leaseId: "l3" },
      ],
    );
    expect(decisions).toEqual([
      { runId: "ahead", action: "ATTENTION", reason: "runner generation is ahead of canonical state" },
      { runId: "missing", action: "RECOVER", reason: "controller run is missing from runner" },
      { runId: "orphan", action: "STOP_STALE", reason: "runner reports an unowned run" },
      { runId: "stale", action: "STOP_STALE", reason: "runner holds a stale generation or lease" },
    ]);
  });
});
