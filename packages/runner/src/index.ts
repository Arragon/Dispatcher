import type { Runner } from "@dispatcher/domain";
import {
  createEnvelope,
  parseEnvelope,
  type CommandPayload,
  type ProtocolEnvelope,
  type ResponsePayload,
} from "@dispatcher/protocol";

export * from "./process.js";
export * from "./verification.js";
export * from "./journal.js";
export * from "./lease.js";
export * from "./reconcile.js";
export * from "./remote.js";
export * from "./platform.js";
export * from "./enrollment.js";

export type EventHandler<T> = (event: T) => void | Promise<void>;

export class EventBus<TEvents extends object> {
  private readonly handlers = new Map<keyof TEvents, Set<EventHandler<unknown>>>();
  private inFlight = 0;
  private closed = false;

  constructor(
    private readonly maxInFlight = 1_000,
    private readonly onHandlerError: (error: unknown, topic: keyof TEvents) => void = () => undefined,
  ) {}

  subscribe<TKey extends keyof TEvents>(topic: TKey, handler: EventHandler<TEvents[TKey]>): () => void {
    if (this.closed) throw new Error("Event bus is closed");
    const handlers = this.handlers.get(topic) ?? new Set<EventHandler<unknown>>();
    handlers.add(handler as EventHandler<unknown>);
    this.handlers.set(topic, handlers);
    return () => handlers.delete(handler as EventHandler<unknown>);
  }

  async publish<TKey extends keyof TEvents>(topic: TKey, event: TEvents[TKey]): Promise<void> {
    if (this.closed) throw new Error("Event bus is closed");
    if (this.inFlight >= this.maxInFlight) throw new Error("Event bus backpressure limit reached");
    this.inFlight += 1;
    try {
      const handlers = [...(this.handlers.get(topic) ?? [])];
      const outcomes = await Promise.allSettled(
        handlers.map((handler) => Promise.resolve().then(() => handler(event))),
      );
      for (const outcome of outcomes) {
        if (outcome.status === "rejected") this.onHandlerError(outcome.reason, topic);
      }
    } finally {
      this.inFlight -= 1;
    }
  }

  close(): void {
    this.closed = true;
    this.handlers.clear();
  }

  get subscriberCount(): number {
    return [...this.handlers.values()].reduce((count, handlers) => count + handlers.size, 0);
  }
}

export type CommandHandler = (payload: CommandPayload, envelope: ProtocolEnvelope<CommandPayload>) => unknown | Promise<unknown>;

export interface RunnerTransport {
  send(envelope: ProtocolEnvelope<CommandPayload>): Promise<ProtocolEnvelope<ResponsePayload>>;
  close(): void;
}

export class EmbeddedTransport implements RunnerTransport {
  private readonly handlers = new Map<CommandPayload["type"], CommandHandler>();
  private readonly responses = new Map<string, ProtocolEnvelope<ResponsePayload>>();
  private lastSequence = -1;
  private closed = false;

  register(type: CommandPayload["type"], handler: CommandHandler): () => void {
    if (this.closed) throw new Error("Transport is closed");
    this.handlers.set(type, handler);
    return () => this.handlers.delete(type);
  }

  async send(input: ProtocolEnvelope<CommandPayload>): Promise<ProtocolEnvelope<ResponsePayload>> {
    if (this.closed) throw new Error("Transport is closed");
    const envelope = parseEnvelope(input) as ProtocolEnvelope<CommandPayload>;
    if (envelope.kind !== "command") throw new Error("Embedded transport accepts commands only");
    const duplicate = this.responses.get(envelope.messageId);
    if (duplicate) return duplicate;
    if (envelope.sequence <= this.lastSequence) {
      return this.response(envelope, {
        type: "rpc.error",
        correlationId: envelope.messageId,
        code: "STALE_SEQUENCE",
        message: `Sequence ${envelope.sequence} is not newer than ${this.lastSequence}`,
      });
    }
    this.lastSequence = envelope.sequence;
    const handler = this.handlers.get(envelope.payload.type);
    if (!handler) {
      const response = this.response(envelope, {
        type: "rpc.error",
        correlationId: envelope.messageId,
        code: "UNSUPPORTED_COMMAND",
        message: `No handler registered for ${envelope.payload.type}`,
      });
      this.responses.set(envelope.messageId, response);
      return response;
    }
    try {
      const result = await handler(envelope.payload, envelope);
      const response = this.response(envelope, { type: "rpc.result", correlationId: envelope.messageId, result });
      this.responses.set(envelope.messageId, response);
      return response;
    } catch (error) {
      const response = this.response(envelope, {
        type: "rpc.error",
        correlationId: envelope.messageId,
        code: "HANDLER_FAILED",
        message: error instanceof Error ? error.message : "Command handler failed",
      });
      this.responses.set(envelope.messageId, response);
      return response;
    }
  }

  private response(
    envelope: ProtocolEnvelope<CommandPayload>,
    payload: ResponsePayload,
  ): ProtocolEnvelope<ResponsePayload> {
    return createEnvelope({
      kind: "response",
      messageId: `response:${envelope.messageId}`,
      traceId: envelope.traceId,
      runnerId: envelope.runnerId,
      sequence: envelope.sequence,
      payload,
    });
  }

  close(): void {
    this.closed = true;
    this.handlers.clear();
    this.responses.clear();
  }
}

export class RunnerRegistry {
  private readonly runners = new Map<string, Runner>();

  constructor(private readonly onChange: (runner: Runner) => void = () => undefined) {}

  register(runner: Runner): Runner {
    this.runners.set(runner.id, structuredClone(runner));
    this.onChange(runner);
    return runner;
  }

  heartbeat(id: string, at = new Date().toISOString()): Runner {
    const runner = this.runners.get(id);
    if (!runner) throw new Error(`Unknown runner: ${id}`);
    const updated: Runner = { ...runner, state: "ONLINE", lastSeenAt: at };
    this.runners.set(id, updated);
    this.onChange(updated);
    return updated;
  }

  setOffline(id: string, at = new Date().toISOString()): Runner | undefined {
    const runner = this.runners.get(id);
    if (!runner) return undefined;
    const updated: Runner = { ...runner, state: "OFFLINE", lastSeenAt: at };
    this.runners.set(id, updated);
    this.onChange(updated);
    return updated;
  }

  list(): Runner[] {
    return [...this.runners.values()].map((runner) => structuredClone(runner));
  }
}

export class ProcessRegistry {
  private readonly processes = new Map<string, { pid: number; runId: string }>();

  add(id: string, process: { pid: number; runId: string }): void {
    this.processes.set(id, process);
  }

  remove(id: string): void {
    this.processes.delete(id);
  }

  list(): Array<{ id: string; pid: number; runId: string }> {
    return [...this.processes.entries()].map(([id, process]) => ({ id, ...process }));
  }

  async shutdown(terminate: (pid: number) => Promise<void>): Promise<void> {
    await Promise.all([...this.processes.values()].map((process) => terminate(process.pid)));
    this.processes.clear();
  }
}

export interface RunnerEvents {
  runnerChanged: Runner;
}

export class EmbeddedRunner {
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    readonly runner: Runner,
    private readonly registry: RunnerRegistry,
    private readonly events: EventBus<RunnerEvents>,
    private readonly heartbeatIntervalMs = 30_000,
  ) {}

  async start(): Promise<void> {
    this.registry.register({ ...this.runner, state: "ONLINE", lastSeenAt: new Date().toISOString() });
    await this.events.publish("runnerChanged", this.registry.heartbeat(this.runner.id));
    this.heartbeatTimer = setInterval(() => {
      const updated = this.registry.heartbeat(this.runner.id);
      void this.events.publish("runnerChanged", updated);
    }, this.heartbeatIntervalMs);
    this.heartbeatTimer.unref();
  }

  async stop(): Promise<void> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
    const offline = this.registry.setOffline(this.runner.id);
    if (offline) await this.events.publish("runnerChanged", offline);
  }
}
