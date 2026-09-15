import { describe, expect, it, vi } from "vitest";
import { createEnvelope } from "@dispatcher/protocol";
import { EmbeddedRunner, EmbeddedTransport, EventBus, RunnerRegistry } from "../src/index.js";

describe("EventBus", () => {
  it("isolates handler failures and still delivers to other subscribers", async () => {
    const errors: unknown[] = [];
    const delivered: number[] = [];
    const bus = new EventBus<{ value: number }>(10, (error) => errors.push(error));
    bus.subscribe("value", () => {
      throw new Error("boom");
    });
    bus.subscribe("value", (value) => {
      delivered.push(value);
    });
    await bus.publish("value", 7);
    expect(delivered).toEqual([7]);
    expect(errors).toHaveLength(1);
    bus.close();
    expect(bus.subscriberCount).toBe(0);
  });
});

describe("EmbeddedTransport", () => {
  it("shares the versioned envelope and deduplicates message IDs", async () => {
    const transport = new EmbeddedTransport();
    const handler = vi.fn(() => ({ status: "ok" }));
    transport.register("runner.health", handler);
    const command = createEnvelope({
      kind: "command",
      messageId: "msg-1",
      traceId: "trace-1",
      runnerId: "mac-neo",
      sequence: 1,
      payload: { type: "runner.health" },
    });
    const first = await transport.send(command);
    const duplicate = await transport.send(command);
    expect(first).toEqual(duplicate);
    expect(first.payload.type).toBe("rpc.result");
    expect(handler).toHaveBeenCalledOnce();
    transport.close();
  });

  it("classifies stale sequence numbers", async () => {
    const transport = new EmbeddedTransport();
    transport.register("runner.health", () => ({ status: "ok" }));
    await transport.send(
      createEnvelope({
        kind: "command",
        messageId: "msg-2",
        traceId: "trace-2",
        runnerId: "mac-neo",
        sequence: 2,
        payload: { type: "runner.health" },
      }),
    );
    const stale = await transport.send(
      createEnvelope({
        kind: "command",
        messageId: "msg-1",
        traceId: "trace-1",
        runnerId: "mac-neo",
        sequence: 1,
        payload: { type: "runner.health" },
      }),
    );
    expect(stale.payload).toMatchObject({ type: "rpc.error", code: "STALE_SEQUENCE" });
  });
});

describe("EmbeddedRunner", () => {
  it("registers online and releases its heartbeat on stop", async () => {
    const registry = new RunnerRegistry();
    const bus = new EventBus<{ runnerChanged: { id: string } }>();
    const runner = new EmbeddedRunner(
      {
        id: "mac-neo",
        displayName: "Mac Neo",
        platform: "darwin",
        architecture: "arm64",
        state: "OFFLINE",
        capabilities: ["embedded"],
        capacity: 1,
        lastSeenAt: new Date(0).toISOString(),
      },
      registry,
      bus,
      60_000,
    );
    await runner.start();
    expect(registry.list()[0]?.state).toBe("ONLINE");
    await runner.stop();
    expect(registry.list()[0]?.state).toBe("OFFLINE");
    bus.close();
  });
});
