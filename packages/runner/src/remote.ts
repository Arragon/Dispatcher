import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { Runner } from "@dispatcher/domain";
import {
  PROTOCOL_VERSION,
  createEnvelope,
  parseEnvelope,
  type CommandPayload,
  type EventPayload,
  type ProtocolEnvelope,
  type ResponsePayload,
} from "@dispatcher/protocol";
import WebSocket, { WebSocketServer, type RawData } from "ws";
import type { RunnerJournal } from "./journal.js";
import { isRunnerVersionCompatible } from "./enrollment.js";

export const RUNNER_VERSION = "0.1.0";

type CommandHandler = (payload: CommandPayload, envelope: ProtocolEnvelope<CommandPayload>) => unknown | Promise<unknown>;

interface RunnerRegistryPort {
  register(runner: Runner): Runner;
  setOffline(id: string, at?: string): Runner | undefined;
  list(): Runner[];
}

interface RegistrationFrame {
  type: "runner.register";
  protocolVersion: typeof PROTOCOL_VERSION;
  runner: Runner;
  profileInventory: string[];
  lastAcknowledgedSequence: number;
  runnerVersion: string;
}

interface RegistrationResult {
  type: "runner.registered" | "runner.rejected";
  reason?: string;
}

interface ServerConnection {
  socket: WebSocket;
  runner: Runner;
  nextSequence: number;
  lastReceivedSequence: number;
  lastSeenAt: number;
  pending: Map<string, { resolve: (value: ProtocolEnvelope<ResponsePayload>) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }>;
}

export interface RemoteRunnerServerOptions {
  registry: RunnerRegistryPort;
  authenticate: (input: { runnerId: string; bearerToken: string | undefined }) => boolean | Promise<boolean>;
  server?: Server;
  port?: number;
  host?: string;
  heartbeatTimeoutMs?: number;
  maxBufferedBytes?: number;
  rpcTimeoutMs?: number;
  path?: string;
  onRunnerChanged?: (runner: Runner) => void | Promise<void>;
  controllerVersion?: string;
}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

function bearer(header: string | undefined): string | undefined {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? "");
  return match?.[1];
}

function decode(data: RawData): unknown {
  return JSON.parse(typeof data === "string" ? data : data.toString("utf8"));
}

function sendJson(socket: WebSocket, value: unknown, maxBufferedBytes: number): void {
  if (socket.readyState !== WebSocket.OPEN) throw new Error("Remote runner connection is not open");
  if (socket.bufferedAmount > maxBufferedBytes) throw new Error("Remote runner backpressure limit reached");
  socket.send(JSON.stringify(value));
}

export class RemoteRunnerServer {
  private readonly webSocketServer: WebSocketServer;
  private readonly connections = new Map<string, ServerConnection>();
  private readonly heartbeatTimeoutMs: number;
  private readonly maxBufferedBytes: number;
  private readonly rpcTimeoutMs: number;
  private readonly monitor: ReturnType<typeof setInterval>;

  constructor(private readonly options: RemoteRunnerServerOptions) {
    const host = options.host ?? "127.0.0.1";
    if (!options.server && !isLoopback(host)) throw new Error("Remote runner TCP listener requires a TLS server outside loopback");
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 90_000;
    this.maxBufferedBytes = options.maxBufferedBytes ?? 1_048_576;
    this.rpcTimeoutMs = options.rpcTimeoutMs ?? 30_000;
    this.webSocketServer = options.server
      ? new WebSocketServer({ server: options.server, path: options.path, maxPayload: this.maxBufferedBytes })
      : new WebSocketServer({ host, port: options.port ?? 0, path: options.path, maxPayload: this.maxBufferedBytes });
    this.webSocketServer.on("connection", (socket, request) => this.accept(socket, request.headers.authorization));
    this.monitor = setInterval(() => this.expireOffline(), Math.max(5_000, Math.floor(this.heartbeatTimeoutMs / 2)));
    this.monitor.unref();
  }

  address(): { host: string; port: number } | undefined {
    const address = this.webSocketServer.address();
    if (!address || typeof address === "string") return undefined;
    return { host: address.address, port: address.port };
  }

  async ready(): Promise<void> {
    if (this.webSocketServer.address()) return;
    await new Promise<void>((resolve, reject) => {
      this.webSocketServer.once("listening", () => resolve());
      this.webSocketServer.once("error", reject);
    });
  }

  async sendCommand(runnerId: string, payload: CommandPayload, options: { messageId?: string; leaseId?: string; generation?: number; leaseExpiresAt?: string } = {}): Promise<ProtocolEnvelope<ResponsePayload>> {
    const connection = this.connections.get(runnerId);
    if (!connection) throw new Error(`Runner ${runnerId} is not connected`);
    if (connection.runner.state === "DRAINING" && payload.type === "run.start") throw new Error(`Runner ${runnerId} is draining`);
    const messageId = options.messageId ?? randomUUID();
    const envelope = createEnvelope({
      kind: "command",
      messageId,
      traceId: randomUUID(),
      runnerId,
      sequence: connection.nextSequence++,
      ackSequence: connection.lastReceivedSequence,
      payload,
      origin: "controller",
      ...(options.leaseId ? { leaseId: options.leaseId } : {}),
      ...(options.generation === undefined ? {} : { generation: options.generation }),
      ...(options.leaseExpiresAt ? { leaseExpiresAt: options.leaseExpiresAt } : {}),
    });
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        connection.pending.delete(messageId);
        reject(new Error(`Remote runner RPC timed out: ${payload.type}`));
      }, this.rpcTimeoutMs);
      timer.unref();
      connection.pending.set(messageId, { resolve, reject, timer });
      try {
        sendJson(connection.socket, envelope, this.maxBufferedBytes);
      } catch (error) {
        clearTimeout(timer);
        connection.pending.delete(messageId);
        reject(error instanceof Error ? error : new Error("Remote runner send failed"));
      }
    });
  }

  async close(): Promise<void> {
    clearInterval(this.monitor);
    for (const connection of this.connections.values()) connection.socket.close(1001, "controller shutdown");
    await new Promise<void>((resolve) => this.webSocketServer.close(() => resolve()));
  }

  private accept(socket: WebSocket, authorization: string | undefined): void {
    let registered = false;
    const registrationTimer = setTimeout(() => socket.close(1008, "registration timeout"), 10_000);
    registrationTimer.unref();
    socket.once("message", async (data) => {
      clearTimeout(registrationTimer);
      try {
        const frame = decode(data) as Partial<RegistrationFrame>;
        if (frame.type !== "runner.register" || frame.protocolVersion !== PROTOCOL_VERSION || !frame.runner || !Array.isArray(frame.profileInventory) || !Number.isSafeInteger(frame.lastAcknowledgedSequence) || Number(frame.lastAcknowledgedSequence) < 0 || typeof frame.runnerVersion !== "string") {
          sendJson(socket, { type: "runner.rejected", reason: "unsupported registration or protocol version" } satisfies RegistrationResult, this.maxBufferedBytes);
          socket.close(1002, "invalid registration");
          return;
        }
        if (!isRunnerVersionCompatible(this.options.controllerVersion ?? RUNNER_VERSION, frame.runnerVersion)) {
          sendJson(socket, { type: "runner.rejected", reason: `incompatible runner version ${frame.runnerVersion}` } satisfies RegistrationResult, this.maxBufferedBytes);
          socket.close(1002, "incompatible runner version");
          return;
        }
        if (!(await this.options.authenticate({ runnerId: frame.runner.id, bearerToken: bearer(authorization) }))) {
          sendJson(socket, { type: "runner.rejected", reason: "unauthorized" } satisfies RegistrationResult, this.maxBufferedBytes);
          socket.close(1008, "unauthorized");
          return;
        }
        registered = true;
        const runner = this.options.registry.register({ ...frame.runner, state: "ONLINE", lastSeenAt: new Date().toISOString() });
        void this.options.onRunnerChanged?.(runner);
        const existing = this.connections.get(runner.id);
        if (existing) existing.socket.close(1012, "runner reconnected");
        const connection: ServerConnection = { socket, runner, nextSequence: 1, lastReceivedSequence: Number(frame.lastAcknowledgedSequence), lastSeenAt: Date.now(), pending: new Map() };
        this.connections.set(runner.id, connection);
        sendJson(socket, { type: "runner.registered" } satisfies RegistrationResult, this.maxBufferedBytes);
        socket.on("message", (message) => this.receive(connection, message));
      } catch (error) {
        socket.close(1002, error instanceof Error ? error.message.slice(0, 100) : "registration failed");
      }
    });
    socket.on("close", () => {
      clearTimeout(registrationTimer);
      if (!registered) return;
      const connection = [...this.connections.values()].find((candidate) => candidate.socket === socket);
      if (!connection) return;
      this.connections.delete(connection.runner.id);
      const degraded = this.options.registry.register({ ...connection.runner, state: "DEGRADED", lastSeenAt: new Date().toISOString() });
      void this.options.onRunnerChanged?.(degraded);
      for (const pending of connection.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Remote runner disconnected"));
      }
    });
  }

  private receive(connection: ServerConnection, data: RawData): void {
    try {
      const envelope = parseEnvelope(decode(data));
      if (envelope.runnerId !== connection.runner.id) throw new Error("Runner identity changed within connection");
      if (envelope.sequence <= connection.lastReceivedSequence) return;
      if (envelope.sequence !== connection.lastReceivedSequence + 1) throw new Error(`Out-of-order remote sequence ${envelope.sequence}`);
      connection.lastReceivedSequence = envelope.sequence;
      connection.lastSeenAt = Date.now();
      if (envelope.ackSequence !== undefined) {
        // Ack is carried for journal compaction by the remote endpoint; pending RPCs still resolve by correlation ID.
      }
      if (envelope.kind === "event" && envelope.payload.type === "runner.heartbeat") {
        connection.runner = this.options.registry.register({ ...connection.runner, state: envelope.payload.state, lastSeenAt: new Date().toISOString() });
        void this.options.onRunnerChanged?.(connection.runner);
        return;
      }
      if (envelope.kind !== "response") return;
      const response = envelope as ProtocolEnvelope<ResponsePayload>;
      const pending = connection.pending.get(response.payload.correlationId);
      if (!pending) return;
      clearTimeout(pending.timer);
      connection.pending.delete(response.payload.correlationId);
      pending.resolve(response);
    } catch (error) {
      connection.socket.close(1002, error instanceof Error ? error.message.slice(0, 100) : "invalid envelope");
    }
  }

  private expireOffline(): void {
    const now = Date.now();
    for (const runner of this.options.registry.list()) {
      const connection = this.connections.get(runner.id);
      if (!connection && runner.state === "DEGRADED" && now - Date.parse(runner.lastSeenAt) >= this.heartbeatTimeoutMs) {
        const offline = this.options.registry.setOffline(runner.id);
        if (offline) void this.options.onRunnerChanged?.(offline);
      }
    }
  }
}

export interface RemoteRunnerClientOptions {
  url: string;
  bearerToken: string;
  runner: Runner;
  profileInventory?: string[];
  journal?: RunnerJournal;
  heartbeatIntervalMs?: number;
  maxBufferedBytes?: number;
  reconnectBackoffMs?: number;
  maxReconnectBackoffMs?: number;
  runnerVersion?: string;
}

export class RemoteRunnerClient {
  private readonly handlers = new Map<CommandPayload["type"], CommandHandler>();
  private readonly responses = new Map<string, ProtocolEnvelope<ResponsePayload>>();
  private socket: WebSocket | undefined;
  private nextSequence: number;
  private lastReceivedSequence = 0;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectAttempt = 0;
  private stopping = false;
  private currentState: Runner["state"];

  constructor(private readonly options: RemoteRunnerClientOptions) {
    const replay = options.journal?.replay(0) ?? [];
    this.nextSequence = (replay.at(-1)?.sequence ?? 0) + 1;
    this.currentState = options.runner.state;
    for (const entry of replay) {
      if (entry.envelope.kind === "response" && (entry.envelope.payload.type === "rpc.result" || entry.envelope.payload.type === "rpc.error")) {
        this.responses.set(entry.envelope.payload.correlationId, entry.envelope as ProtocolEnvelope<ResponsePayload>);
      }
    }
  }

  register(type: CommandPayload["type"], handler: CommandHandler): () => void {
    this.handlers.set(type, handler);
    return () => this.handlers.delete(type);
  }

  async start(): Promise<void> {
    if (this.socket) throw new Error("Remote runner client is already started");
    this.stopping = false;
    this.lastReceivedSequence = 0;
    const socket = new WebSocket(this.options.url, { headers: { authorization: `Bearer ${this.options.bearerToken}` } });
    this.socket = socket;
    try {
      await new Promise<void>((resolve, reject) => {
        const fail = (error: Error) => reject(error);
        socket.once("error", fail);
        socket.once("open", () => {
          sendJson(socket, {
            type: "runner.register",
            protocolVersion: PROTOCOL_VERSION,
            runner: this.options.runner,
            profileInventory: this.options.profileInventory ?? [],
            lastAcknowledgedSequence: this.options.journal?.acknowledgedSequence() ?? 0,
            runnerVersion: this.options.runnerVersion ?? RUNNER_VERSION,
          } satisfies RegistrationFrame, this.options.maxBufferedBytes ?? 1_048_576);
        });
        socket.once("message", (data) => {
          const result = decode(data) as RegistrationResult;
          if (result.type !== "runner.registered") {
            reject(new Error(result.reason ?? "Remote runner registration rejected"));
            return;
          }
          socket.off("error", fail);
          socket.on("message", (message) => void this.receive(message));
          resolve();
        });
      });
    } catch (error) {
      socket.terminate();
      this.socket = undefined;
      throw error;
    }
    for (const entry of this.options.journal?.replay() ?? []) sendJson(socket, entry.envelope, this.options.maxBufferedBytes ?? 1_048_576);
    const interval = Math.max(5_000, this.options.heartbeatIntervalMs ?? 30_000);
    this.heartbeat = setInterval(() => void this.sendEvent({ type: "runner.heartbeat", runnerId: this.options.runner.id, state: this.currentState }).catch(() => undefined), interval);
    this.heartbeat.unref();
    this.reconnectAttempt = 0;
    socket.once("close", () => this.handleDisconnect(socket));
  }

  async sendEvent(payload: EventPayload): Promise<void> {
    const envelope = createEnvelope({ kind: "event", messageId: randomUUID(), traceId: randomUUID(), runnerId: this.options.runner.id, sequence: this.nextSequence++, ackSequence: this.lastReceivedSequence, payload, origin: "runner" });
    this.options.journal?.append(envelope);
    sendJson(this.requireSocket(), envelope, this.options.maxBufferedBytes ?? 1_048_576);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    const socket = this.socket;
    this.socket = undefined;
    if (!socket) return;
    await new Promise<void>((resolve) => {
      socket.once("close", () => resolve());
      socket.close(1000, "runner shutdown");
    });
  }

  private async receive(data: RawData): Promise<void> {
    const envelope = parseEnvelope(decode(data)) as ProtocolEnvelope<CommandPayload>;
    if (envelope.kind !== "command") return;
    if (envelope.ackSequence !== undefined) {
      this.options.journal?.acknowledge(envelope.ackSequence);
      this.options.journal?.compact();
    }
    const duplicate = this.responses.get(envelope.messageId);
    if (duplicate) {
      if (envelope.sequence > this.lastReceivedSequence + 1) {
        await this.respond(envelope, { type: "rpc.error", correlationId: envelope.messageId, code: "OUT_OF_ORDER", message: `Expected sequence ${this.lastReceivedSequence + 1}, received ${envelope.sequence}` });
        return;
      }
      if (envelope.sequence === this.lastReceivedSequence + 1) this.lastReceivedSequence = envelope.sequence;
      await this.respond(envelope, duplicate.payload);
      return;
    }
    if (envelope.sequence !== this.lastReceivedSequence + 1) {
      await this.respond(envelope, { type: "rpc.error", correlationId: envelope.messageId, code: "OUT_OF_ORDER", message: `Expected sequence ${this.lastReceivedSequence + 1}, received ${envelope.sequence}` });
      return;
    }
    this.lastReceivedSequence = envelope.sequence;
    if (envelope.payload.type === "runner.drain") {
      this.currentState = envelope.payload.draining ? "DRAINING" : "ONLINE";
      await this.sendEvent({ type: "runner.heartbeat", runnerId: this.options.runner.id, state: this.currentState });
      await this.respond(envelope, { type: "rpc.result", correlationId: envelope.messageId, result: { state: this.currentState } });
      return;
    }
    const handler = this.handlers.get(envelope.payload.type);
    if (!handler) {
      await this.respond(envelope, { type: "rpc.error", correlationId: envelope.messageId, code: "UNSUPPORTED_COMMAND", message: `No handler registered for ${envelope.payload.type}` });
      return;
    }
    try {
      const result = await handler(envelope.payload, envelope);
      await this.respond(envelope, { type: "rpc.result", correlationId: envelope.messageId, result });
    } catch (error) {
      await this.respond(envelope, { type: "rpc.error", correlationId: envelope.messageId, code: "HANDLER_FAILED", message: error instanceof Error ? error.message : "Command handler failed" });
    }
  }

  private async respond(command: ProtocolEnvelope<CommandPayload>, payload: ResponsePayload): Promise<void> {
    const response = createEnvelope({ kind: "response", messageId: randomUUID(), traceId: command.traceId, runnerId: this.options.runner.id, sequence: this.nextSequence++, ackSequence: this.lastReceivedSequence, correlationId: command.messageId, payload, origin: "runner" });
    this.responses.set(command.messageId, response);
    this.options.journal?.append(response);
    sendJson(this.requireSocket(), response, this.options.maxBufferedBytes ?? 1_048_576);
  }

  private requireSocket(): WebSocket {
    if (!this.socket) throw new Error("Remote runner client is not started");
    return this.socket;
  }

  private handleDisconnect(socket: WebSocket): void {
    if (this.socket !== socket) return;
    this.socket = undefined;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    if (this.stopping) return;
    const base = Math.max(250, this.options.reconnectBackoffMs ?? 1_000);
    const maximum = Math.max(base, this.options.maxReconnectBackoffMs ?? 30_000);
    const delay = Math.min(maximum, base * 2 ** this.reconnectAttempt++);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.start().catch(() => this.handleDisconnectRetry());
    }, delay);
    this.reconnectTimer.unref();
  }

  private handleDisconnectRetry(): void {
    if (this.stopping) return;
    const base = Math.max(250, this.options.reconnectBackoffMs ?? 1_000);
    const maximum = Math.max(base, this.options.maxReconnectBackoffMs ?? 30_000);
    const delay = Math.min(maximum, base * 2 ** this.reconnectAttempt++);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.start().catch(() => this.handleDisconnectRetry());
    }, delay);
    this.reconnectTimer.unref();
  }
}
