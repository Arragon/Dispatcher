import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { Readable } from "node:stream";
import { isDeepStrictEqual } from "node:util";
import { client, ndJsonStream, type ClientConnection } from "@agentclientprotocol/sdk";
import { AdapterContractError, AdapterStartError } from "./contracts.js";
import { isExecutionContextRef, validateExecutionBinding, type ExecutionContextRef, type ExecutionSelection, type NativeBinding } from "@dispatcher/domain";
import type { LocalRuntimeDisconnect } from "./interaction-contracts.js";
import { OwnedProcessRoot } from "./owned-root-process.js";
import { freezeExecutionSelection } from "./execution-selection.js";
import { childExecutionEnvironment } from "@dispatcher/shared";
import { readOwnedNativeVersion } from "./native-version-probe.js";

export const devinLocalAcpCliVersion = "devin 3000.11.3 (9c803229faa4)";
export interface DevinLocalAcpScope { executable: string; workspacePath: string; dataHome: string; configHome: string }
export interface DevinAcpReadOptions { signal?: AbortSignal; timeoutMs?: number; beforeSend?: () => void }
interface Identity { path: string; dev: bigint; ino: bigint }
interface Permit { method: string; params: Record<string, unknown>; signal: AbortSignal; deadline: number; beforeSend?: () => void; onWrite?: () => void; cancellation?: { active: ActivePrompt; written: boolean; skipped: boolean } }
export interface DevinAcpBootstrapInput {
  mode: "new" | "resume"; profileId: string; runnerId: string; nativeStoreRef: string; dispatcherSessionId: string;
  workspacePath: string; executionRef: ExecutionContextRef; executionSelection: ExecutionSelection; binding?: NativeBinding;
}

export interface DevinAcpBootstrapOptions extends DevinAcpReadOptions {
  beforeSend: () => void; onBinding: (binding: NativeBinding) => Promise<void>;
}
export type DevinAcpStopReason = "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled";
export type DevinAcpTurnUpdate = { kind: "activity"; nativeSessionId: string } | { kind: "tool"; nativeSessionId: string; toolCallId: string; status: "pending" | "in_progress" | "completed" | "failed" };
export interface DevinAcpPromptOptions extends DevinAcpReadOptions { beforeSend: () => void; onUpdate?: (update: DevinAcpTurnUpdate) => void }
export interface DevinAcpPromptResult { stopReason: DevinAcpStopReason; executionEvidence: boolean; toolFailure: boolean; permissionDenied: boolean; pendingTools: number }
interface ModelOption { id: string; currentValue: string; values: string[] }
interface ActivePrompt {
  binding: NativeBinding; model: ModelOption; deadline: number; written: boolean; terminal: boolean; cancelAdmitted: boolean; updates: number;
  tools: Map<string, "pending" | "in_progress" | "completed" | "failed">; proof: boolean; toolFailure: boolean; permissionDenied: boolean;
  signal: AbortSignal; onUpdate?: (update: DevinAcpTurnUpdate) => void;
}
export interface DevinAcpNegotiation { protocolVersion: 1; agentName?: string; agentVersion?: string; loadSession: boolean; listSessions: boolean }
const fail = (code: string) => new AdapterContractError(code, code);
const text = (value: unknown, limit = 512): value is string => typeof value === "string" && value.length > 0 && value.length <= limit && !/[\0\r\n]/.test(value);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
function identity(path: string, directory: boolean): Identity {
  try {
    if (!text(path, 4_096) || !isAbsolute(path)) throw Error();
    const physical = realpathSync(path), stat = statSync(physical, { bigint: true });
    if (directory ? !stat.isDirectory() : !stat.isFile()) throw Error();
    return { path: physical, dev: stat.dev, ino: stat.ino };
  } catch { throw fail("DEVIN_ACP_SCOPE_CHANGED"); }
}
/** One owned Local ACP connection. All writes are guarded; native approval remains closed. */
export class DevinLocalAcpClient {
  private readonly disconnected = new AbortController();
  private readonly connection: ClientConnection;
  private readonly cancellation: OwnedProcessRoot;
  private readonly exited: Promise<void>;
  private readonly originalPid: number | undefined;
  private notCreated = false;
  private readonly permits: Permit[] = [];
  private readonly sent = new Map<string, Permit>();
  private readonly frameLengths: number[] = [];
  private readonly guardCallbacks = new Set<Promise<void>>();
  private readonly writes = new Set<Promise<void>>();
  private frameBytes = 0;
  private bufferedInputBytes = 0;
  private reservedRequestBytes = 0;
  private bootstrapState?: { expectedId?: string; observedId?: string; updates: number; latestModel?: ModelOption };
  private bound?: { binding: NativeBinding; model: ModelOption };
  private activePrompt?: ActivePrompt;
  private pending = 0;
  private closed = false;
  private shutdown?: Promise<LocalRuntimeDisconnect>;
  private negotiated?: DevinAcpNegotiation;
  private readonly original: DevinLocalAcpScope;
  private constructor(private readonly scope: DevinLocalAcpScope, original: DevinLocalAcpScope, private readonly paths: Identity[], private readonly child: ChildProcessWithoutNullStreams) {
    this.original = original; this.originalPid = child.pid; this.cancellation = new OwnedProcessRoot(child);
    this.exited = new Promise(resolve => { child.once("exit", () => { resolve(); this.end("DEVIN_ACP_DISCONNECTED"); }); child.once("close", () => { resolve(); this.end("DEVIN_ACP_DISCONNECTED"); }); });
    child.once("error", () => { this.notCreated = this.originalPid === undefined && child.pid === undefined; this.end("DEVIN_ACP_DISCONNECTED"); }); child.stderr.resume();
    const utf8 = new TextDecoder("utf-8", { fatal: true });
    const incoming = (Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>).pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform: (bytes, controller) => {
        try {
          utf8.decode(bytes, { stream: true }); this.bufferedInputBytes += bytes.byteLength;
          if (this.bufferedInputBytes > 1_048_576) throw fail("DEVIN_ACP_INBOUND_LIMIT");
          for (const byte of bytes) { this.frameBytes++; if (byte === 10) { this.frameLengths.push(this.frameBytes); this.frameBytes = 0; } }
          if (this.frameLengths.length + (this.frameBytes ? 1 : 0) > 64) throw fail("DEVIN_ACP_INBOUND_LIMIT");
          controller.enqueue(bytes);
        } catch (error) { const code = error instanceof AdapterContractError ? error.code : "DEVIN_ACP_PROTOCOL_INVALID"; this.end(code); controller.error(fail(code)); }
      },
      flush: () => { try { utf8.decode(); if (this.frameBytes) { this.frameLengths.push(this.frameBytes); this.frameBytes = 0; } } catch { this.end("DEVIN_ACP_PROTOCOL_INVALID"); } },
    }));
    const outgoing = new WritableStream<Uint8Array>({
      write: bytes => {
        try {
        this.assertCurrentScope();
        const frame = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as Record<string, unknown>;
        if (bytes.byteLength > 262_144 || child.stdin.writableLength + bytes.byteLength > 1_048_576) throw fail("DEVIN_ACP_WRITE_LIMIT");
        if (typeof frame.method === "string") {
          const permit = this.permits.shift();
          if (!permit || permit.method !== frame.method || !isDeepStrictEqual(permit.params, frame.params) || frame.id === undefined && frame.method !== "session/cancel") throw fail("DEVIN_ACP_PROTOCOL_INVALID");
          // A queued cancellation belongs to its captured turn, never a later
          // prompt. Drop an unsent terminal cancellation without failing the SDK sink.
          if (permit.cancellation && (permit.cancellation.skipped || permit.cancellation.active.terminal || this.activePrompt !== permit.cancellation.active)) { permit.cancellation.skipped = true; return; }
          if (permit.signal.aborted) throw fail("DEVIN_ACP_CANCELLED");
          this.finalGuard(permit.beforeSend); this.assertCurrentScope();
          if (permit.signal.aborted) throw fail("DEVIN_ACP_CANCELLED");
          if (performance.now() >= permit.deadline) throw fail("DEVIN_ACP_TIMEOUT");
          if (frame.id !== undefined) this.sent.set(JSON.stringify(frame.id), permit);
          if (permit.cancellation) permit.cancellation.written = true;
          permit.onWrite?.();
        }
        return new Promise<void>((resolve, reject) => child.stdin.write(bytes, error => {
          if (error) { this.end("DEVIN_ACP_DISCONNECTED"); reject(fail("DEVIN_ACP_DISCONNECTED")); } else resolve();
        }));
        } catch (error) {
          const code = error instanceof AdapterContractError ? error.code : "DEVIN_ACP_PROTOCOL_INVALID";
          this.end(code); throw fail(code);
        }
      },
    });
    const stream = ndJsonStream(outgoing, incoming, { maxMessageBytes: 1_048_576 });
    const checked = stream.readable.pipeThrough(new TransformStream({
      transform: async (message, controller) => {
        try {
          const packet: unknown = message;
          this.assertCurrentScope();
          const length = this.frameLengths.shift(); if (length === undefined) throw fail("DEVIN_ACP_PROTOCOL_INVALID");
          this.bufferedInputBytes -= length;
          if (!record(packet) || packet.jsonrpc !== "2.0") throw fail("DEVIN_ACP_PROTOCOL_INVALID");
          if (typeof packet.method === "string") {
            if (packet.method === "session/update" && packet.id === undefined && this.bootstrapState) {
              this.sessionUpdate(packet.params); return;
            }
            if (packet.method !== "session/request_permission" || !this.validRpcId(packet.id)) throw fail("DEVIN_ACP_PROTOCOL_INVALID");
            // Native approval remains closed. Refuse the exact callback
            // without entering SDK handlers that retain/log untrusted provider payloads.
            if (this.activePrompt) this.promptPermission(packet.params);
            await this.rejectPermission(packet.id);
            return;
          }
          if (!this.validRpcId(packet.id) || ("result" in packet) === ("error" in packet)) throw fail("DEVIN_ACP_PROTOCOL_INVALID");
          const key = JSON.stringify(packet.id), permit = this.sent.get(key);
          if (!permit) throw fail("DEVIN_ACP_PROTOCOL_INVALID"); this.sent.delete(key);
          if ("error" in packet) {
            if (!record(packet.error) || !Number.isSafeInteger(packet.error.code)) throw fail("DEVIN_ACP_PROTOCOL_INVALID");
            controller.enqueue({ jsonrpc: "2.0", id: packet.id, error: { code: packet.error.code as number, message: "Devin ACP request rejected" } });
          } else controller.enqueue({ jsonrpc: "2.0", id: packet.id, result: this.projectResult(permit, packet.result) });
        } catch (error) { const code = error instanceof AdapterContractError ? error.code : "DEVIN_ACP_PROTOCOL_INVALID"; this.end(code); controller.error(fail(code)); }
      },
    }));
    this.connection = client({ name: "dispatcher-devin-local" }).connect({ writable: stream.writable, readable: checked });
    this.connection.closed.then(() => this.end("DEVIN_ACP_DISCONNECTED")).catch(() => this.end("DEVIN_ACP_DISCONNECTED"));
  }
  static async open(input: DevinLocalAcpScope, options: { signal?: AbortSignal; beforeCreate?: () => void } = {}): Promise<DevinLocalAcpClient> {
    const original = structuredClone(input), signal = options.signal, beforeCreate = options.beforeCreate;
    const admission = () => {
      if (signal?.aborted) throw fail("DEVIN_ACP_CANCELLED");
      try {
        if (beforeCreate !== undefined && typeof beforeCreate !== "function") throw Error();
        const returned: unknown = beforeCreate?.();
        if (returned !== undefined) { void Promise.resolve(returned).catch(() => {}); throw Error(); }
      } catch { throw fail("DEVIN_ACP_AUTHORITY_CHANGED"); }
      if (signal?.aborted) throw fail("DEVIN_ACP_CANCELLED");
    };
    admission();
    const paths = [identity(original.executable, false), identity(original.workspacePath, true), identity(original.dataHome, true), identity(original.configHome, true)];
    const scope = { executable: paths[0]!.path, workspacePath: paths[1]!.path, dataHome: paths[2]!.path, configHome: paths[3]!.path };
    const env = childExecutionEnvironment(process.env, { PWD: scope.workspacePath, XDG_DATA_HOME: scope.dataHome, XDG_CONFIG_HOME: scope.configHome });
    const version = await readOwnedNativeVersion({ executable: scope.executable, workspacePath: scope.workspacePath, environment: env, ...(signal ? { signal } : {}), ownsGroup: false, failure: code => fail(code === "exit-unconfirmed" ? "DEVIN_ACP_PROBE_EXIT_UNCONFIRMED" : "DEVIN_ACP_RUNTIME_UNAVAILABLE") });
    if (version !== devinLocalAcpCliVersion) throw fail("DEVIN_ACP_VERSION_UNQUALIFIED");
    const assertScope = () => {
      const current = [identity(original.executable, false), identity(original.workspacePath, true), identity(original.dataHome, true), identity(original.configHome, true)];
      if (!isDeepStrictEqual(paths, current)) throw fail("DEVIN_ACP_SCOPE_CHANGED");
    };
    assertScope(); admission(); assertScope();
    const child = spawn(scope.executable, ["acp"], { cwd: scope.workspacePath, shell: false, detached: false, stdio: ["pipe", "pipe", "pipe"], env });
    const owned = new DevinLocalAcpClient(scope, original, paths, child);
    try {
      const response = await owned.request("initialize", { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: "dispatcher", version: "0.1.0" } }, { ...(signal ? { signal } : {}) });
      if (!record(response) || response.protocolVersion !== 1 || !record(response.agentCapabilities)) throw fail("DEVIN_ACP_PROTOCOL_UNQUALIFIED");
      const caps = response.agentCapabilities, sessions = record(caps.sessionCapabilities) ? caps.sessionCapabilities : {};
      const agent = record(response.agentInfo) ? response.agentInfo : {};
      owned.negotiated = { protocolVersion: 1, loadSession: caps.loadSession === true, listSessions: record(sessions.list), ...(text(agent.name, 100) ? { agentName: agent.name } : {}), ...(text(agent.version, 100) ? { agentVersion: agent.version } : {}) };
      return owned;
    } catch (error) { await owned.close(); throw error instanceof AdapterContractError ? error : fail("DEVIN_ACP_PROTOCOL_UNQUALIFIED"); }
  }
  get connectionScope(): DevinLocalAcpScope { return structuredClone(this.scope); }
  get negotiation(): DevinAcpNegotiation { if (!this.negotiated) throw fail("DEVIN_ACP_PROTOCOL_UNQUALIFIED"); return structuredClone(this.negotiated); }
  get disconnectSignal(): AbortSignal { return this.disconnected.signal; }
  assertCurrentScope(): void {
    if (this.closed) throw fail("DEVIN_ACP_DISCONNECTED");
    const current = [identity(this.original.executable, false), identity(this.original.workspacePath, true), identity(this.original.dataHome, true), identity(this.original.configHome, true)];
    if (!isDeepStrictEqual(current, this.paths)) throw fail("DEVIN_ACP_SCOPE_CHANGED");
  }
  private validRpcId(id: unknown): id is string | number { return text(id) || typeof id === "number" && Number.isSafeInteger(id); }
  private finalGuard(guard?: () => void): void {
    try {
      const result: unknown = guard?.();
      if (result !== undefined) {
        if (this.guardCallbacks.size >= 64) throw fail("DEVIN_ACP_CALLBACK_LIMIT");
        const settled = Promise.resolve(result).then(() => {}, () => {});
        this.guardCallbacks.add(settled); void settled.then(() => this.guardCallbacks.delete(settled));
        throw fail("DEVIN_ACP_AUTHORITY_CHANGED");
      }
    } catch (error) { throw error instanceof AdapterContractError ? error : fail("DEVIN_ACP_AUTHORITY_CHANGED"); }
  }
  private projectResult(permit: Permit, result: unknown): unknown {
    if (!record(result)) throw fail("DEVIN_ACP_PROTOCOL_INVALID");
    if (permit.method === "session/prompt") {
      const active = this.activePrompt;
      if (!active || !active.written || active.terminal || permit.params.sessionId !== active.binding.nativeSessionId) throw fail("DEVIN_ACP_IDENTITY_CHANGED");
      if (!["end_turn", "max_tokens", "max_turn_requests", "refusal", "cancelled"].includes(result.stopReason as string)) throw fail("DEVIN_ACP_PROTOCOL_INVALID");
      this.assertPrompt(active); active.terminal = true;
      return { stopReason: result.stopReason };
    }
    if (permit.method === "session/list") return this.projectSessions(result, permit.params.cursor as string | undefined);
    if (["session/new", "session/load", "session/set_config_option"].includes(permit.method)) {
      const state = this.bootstrapState; if (!state) throw fail("DEVIN_ACP_IDENTITY_CHANGED");
      if (permit.method === "session/new") {
        if (!text(result.sessionId) || state.observedId !== undefined && state.observedId !== result.sessionId) throw fail("DEVIN_ACP_IDENTITY_CHANGED");
        state.expectedId = result.sessionId;
      } else if (result.sessionId !== undefined && result.sessionId !== state.expectedId || permit.params.sessionId !== state.expectedId) throw fail("DEVIN_ACP_IDENTITY_CHANGED");
      let model: ModelOption | undefined;
      try { model = this.projectModel(result.configOptions); } catch { /* Keep known native identity even when model metadata cannot qualify. */ }
      // Responses and notifications both advance the observed model in wire order.
      if (model) state.latestModel = model; else delete state.latestModel;
      return { ...(permit.method === "session/new" ? { sessionId: state.expectedId } : {}), configOptions: model ? [{ id: model.id, name: "Model", category: "model", type: "select", currentValue: model.currentValue, options: model.values.map(value => ({ value, name: value })) }] : [] };
    }
    if (permit.method !== "initialize" || !Number.isSafeInteger(result.protocolVersion) || !record(result.agentCapabilities)) throw fail("DEVIN_ACP_PROTOCOL_INVALID");
    const caps = result.agentCapabilities, sessions = record(caps.sessionCapabilities) ? caps.sessionCapabilities : {};
    if (caps.loadSession !== undefined && typeof caps.loadSession !== "boolean" || sessions.list !== undefined && !record(sessions.list)) throw fail("DEVIN_ACP_PROTOCOL_INVALID");
    const agent = record(result.agentInfo) ? result.agentInfo : {};
    return { protocolVersion: result.protocolVersion, agentCapabilities: { loadSession: caps.loadSession === true, sessionCapabilities: { ...(record(sessions.list) ? { list: {} } : {}) } }, ...(agent.name === "affogato" && agent.version === "0.0.0-dev" ? { agentInfo: { name: "affogato", version: "0.0.0-dev" } } : {}), authMethods: [] };
  }
  private projectModel(value: unknown): ModelOption {
    if (!Array.isArray(value) || value.length > 32) throw fail("DEVIN_ACP_MODEL_UNQUALIFIED");
    const models = value.filter(item => record(item) && item.category === "model");
    if (models.length !== 1) throw fail("DEVIN_ACP_MODEL_UNQUALIFIED");
    const model: unknown = models[0];
    if (!record(model) || model.type !== "select" || !text(model.id) || !text(model.currentValue) || !Array.isArray(model.options) || model.options.length > 200) throw fail("DEVIN_ACP_MODEL_UNQUALIFIED");
    const values: string[] = [];
    for (const entry of model.options) {
      if (!record(entry)) throw fail("DEVIN_ACP_MODEL_UNQUALIFIED");
      const choices = Array.isArray(entry.options) ? entry.options : [entry];
      if (choices.length > 200) throw fail("DEVIN_ACP_MODEL_UNQUALIFIED");
      for (const choice of choices) {
        if (!record(choice) || !text(choice.value) || values.includes(choice.value) || values.length >= 200) throw fail("DEVIN_ACP_MODEL_UNQUALIFIED");
        values.push(choice.value);
      }
    }
    if (!values.includes(model.currentValue)) throw fail("DEVIN_ACP_MODEL_UNQUALIFIED");
    return { id: model.id, currentValue: model.currentValue, values };
  }
  private sessionUpdate(value: unknown): void {
    const state = this.bootstrapState!;
    if (!record(value) || !text(value.sessionId) || !record(value.update) || typeof value.update.sessionUpdate !== "string") throw fail("DEVIN_ACP_PROTOCOL_INVALID");
    if (state.expectedId !== undefined && value.sessionId !== state.expectedId || state.observedId !== undefined && state.observedId !== value.sessionId) throw fail("DEVIN_ACP_IDENTITY_CHANGED");
    state.observedId = value.sessionId;
    const active = this.activePrompt;
    if (active ? ++active.updates > 1_024 : ++state.updates > 100) throw fail("DEVIN_ACP_INBOUND_LIMIT");
    // Load replays may include text/tool history. It is deliberately not retained,
    // rendered or sent to the SDK; this bootstrap does not qualify history.
    const kind = value.update.sessionUpdate;
    if (!["available_commands_update", "current_mode_update", "config_option_update", "session_info_update", "user_message_chunk", "agent_message_chunk", "agent_thought_chunk", "tool_call", "tool_call_update", "plan", "usage_update"].includes(kind)) throw fail("DEVIN_ACP_PROTOCOL_INVALID");
    if (kind === "current_mode_update" && !text(value.update.currentModeId) || kind === "available_commands_update" && (!Array.isArray(value.update.availableCommands) || value.update.availableCommands.length > 100)) throw fail("DEVIN_ACP_PROTOCOL_INVALID");
    if (kind === "session_info_update" && [value.update.title, value.update.updatedAt].some(field => field !== undefined && field !== null && (typeof field !== "string" || field.length > 16_384))) throw fail("DEVIN_ACP_PROTOCOL_INVALID");
    if (kind === "config_option_update") state.latestModel = this.projectModel(value.update.configOptions);
    if (!active) return;
    this.assertPrompt(active);
    if (!active.written || active.terminal) throw fail("DEVIN_ACP_PROTOCOL_INVALID");
    const update = value.update;
    if (["agent_message_chunk", "user_message_chunk", "agent_thought_chunk"].includes(kind)) {
      if (!record(update.content) || update.content.type !== "text" || typeof update.content.text !== "string" || Buffer.byteLength(update.content.text) > 16_384) throw fail("DEVIN_ACP_PROTOCOL_INVALID");
      if (kind === "agent_message_chunk" && update.content.text.length) { active.proof = true; this.emitUpdate(active, { kind: "activity", nativeSessionId: active.binding.nativeSessionId }); }
    }
    if (kind === "tool_call" || kind === "tool_call_update") {
      if (!text(update.toolCallId) || kind === "tool_call" && (typeof update.title !== "string" || Buffer.byteLength(update.title) > 16_384 || active.tools.has(update.toolCallId)) || kind === "tool_call_update" && !active.tools.has(update.toolCallId)) throw fail("DEVIN_ACP_PROTOCOL_INVALID");
      const status = update.status ?? active.tools.get(update.toolCallId) ?? "pending";
      if (!["pending", "in_progress", "completed", "failed"].includes(status as string)) throw fail("DEVIN_ACP_PROTOCOL_INVALID");
      if (!active.tools.has(update.toolCallId) && active.tools.size >= 64) throw fail("DEVIN_ACP_INBOUND_LIMIT");
      const prior = active.tools.get(update.toolCallId);
      if (prior && ["completed", "failed"].includes(prior) && status !== prior) throw fail("DEVIN_ACP_PROTOCOL_INVALID");
      active.tools.set(update.toolCallId, status as "pending" | "in_progress" | "completed" | "failed");
      active.proof ||= status === "completed"; active.toolFailure ||= status === "failed";
      this.emitUpdate(active, { kind: "tool", nativeSessionId: active.binding.nativeSessionId, toolCallId: update.toolCallId, status: status as "pending" | "in_progress" | "completed" | "failed" });
    }
  }
  private emitUpdate(active: ActivePrompt, update: DevinAcpTurnUpdate): void {
    try {
      const result: unknown = active.onUpdate?.(structuredClone(update));
      if (result !== undefined) {
        if (this.guardCallbacks.size >= 64) throw fail("DEVIN_ACP_CALLBACK_LIMIT");
        const settled = Promise.resolve(result).then(() => {}, () => {});
        this.guardCallbacks.add(settled); void settled.then(() => this.guardCallbacks.delete(settled));
        throw fail("DEVIN_ACP_CALLBACK_FAILED");
      }
    } catch { throw fail("DEVIN_ACP_CALLBACK_FAILED"); }
  }
  private promptPermission(value: unknown): void {
    const active = this.activePrompt!;
    if (!record(value) || value.sessionId !== active.binding.nativeSessionId || !record(value.toolCall) || !text(value.toolCall.toolCallId)) throw fail("DEVIN_ACP_IDENTITY_CHANGED");
    if (!Array.isArray(value.options) || !value.options.length || value.options.length > 16) throw fail("DEVIN_ACP_PROTOCOL_INVALID");
    const ids = new Set<string>();
    for (const option of value.options) {
      if (!record(option) || !text(option.optionId) || ids.has(option.optionId) || !["allow_once", "allow_always", "reject_once", "reject_always"].includes(option.kind as string)) throw fail("DEVIN_ACP_PROTOCOL_INVALID");
      ids.add(option.optionId);
    }
    this.assertPrompt(active); if (!active.written || active.terminal) throw fail("DEVIN_ACP_PROTOCOL_INVALID");
    active.permissionDenied = true;
  }
  private assertPrompt(active: ActivePrompt): void {
    this.assertCurrentScope();
    if (this.activePrompt !== active || !isDeepStrictEqual(active.binding, this.bound?.binding)) throw fail("DEVIN_ACP_IDENTITY_CHANGED");
    if (!isDeepStrictEqual(active.model, this.bootstrapState?.latestModel)) throw fail("DEVIN_ACP_MODEL_DRIFT");
    if (performance.now() >= active.deadline) throw fail("DEVIN_ACP_TIMEOUT");
    if (active.signal.aborted) throw fail("DEVIN_ACP_CANCELLED");
  }
  private async rejectPermission(id: string | number): Promise<void> {
    this.assertCurrentScope();
    const bytes = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, result: { outcome: { outcome: "cancelled" } } }) + "\n");
    if (this.child.stdin.writableLength + bytes.byteLength > 1_048_576 || this.writes.size >= 64) throw fail("DEVIN_ACP_WRITE_LIMIT");
    const written = new Promise<void>((resolve, reject) => this.child.stdin.write(bytes, error => error ? reject(fail("DEVIN_ACP_DISCONNECTED")) : resolve()));
    this.writes.add(written);
    try { await written; } finally { this.writes.delete(written); }
  }
  private async request(method: string, params: Record<string, unknown>, options: DevinAcpReadOptions = {}, onWrite?: () => void): Promise<unknown> {
    this.assertCurrentScope(); if (options.signal?.aborted) throw fail("DEVIN_ACP_CANCELLED");
    const timeout = options.timeoutMs ?? 5_000;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30_000) throw fail("DEVIN_ACP_TIMEOUT_INVALID");
    const requestBytes = Buffer.byteLength(JSON.stringify(params)) + 512;
    if (this.pending >= 64 || requestBytes > 262_144 || this.reservedRequestBytes + requestBytes > 1_048_576) throw fail("DEVIN_ACP_REQUEST_LIMIT");
    const frozen = structuredClone(params), local = new AbortController(), signal = options.signal ? AbortSignal.any([local.signal, options.signal]) : local.signal;
    const permit: Permit = { method, params: frozen, signal, deadline: performance.now() + timeout, ...(options.beforeSend ? { beforeSend: options.beforeSend } : {}), ...(onWrite ? { onWrite } : {}) };
    this.permits.push(permit); this.pending++; this.reservedRequestBytes += requestBytes;
    let expired = false; const timer = setTimeout(() => { expired = true; local.abort(); }, timeout);
    try {
      const result = await new Promise<unknown>((resolve, reject) => {
        const abort = () => {
          const reason: unknown = this.disconnectSignal.reason;
          const code = expired ? "DEVIN_ACP_TIMEOUT" : this.disconnectSignal.aborted && reason instanceof AdapterContractError ? reason.code : "DEVIN_ACP_CANCELLED";
          this.end(code); reject(fail(code));
        };
        signal.addEventListener("abort", abort, { once: true });
        this.connection.agent.request(method, frozen).then(value => { signal.removeEventListener("abort", abort); resolve(value); }, error => {
          signal.removeEventListener("abort", abort);
          reject(this.disconnected.signal.aborted ? this.disconnected.signal.reason : error instanceof AdapterContractError ? error : fail("DEVIN_ACP_REQUEST_FAILED"));
        });
        if (signal.aborted) abort();
      });
      this.assertCurrentScope();
      if (performance.now() >= permit.deadline) { this.end("DEVIN_ACP_TIMEOUT"); throw fail("DEVIN_ACP_TIMEOUT"); }
      return result;
    } finally { clearTimeout(timer); this.pending--; this.reservedRequestBytes -= requestBytes; const index = this.permits.indexOf(permit); if (index >= 0) this.permits.splice(index, 1); }
  }
  async listSessions(input: { cursor?: string }, options?: DevinAcpReadOptions): Promise<{ sessions: Array<{ sessionId: string; cwd: string }>; nextCursor?: string }> {
    if (!this.negotiation.listSessions) throw fail("DEVIN_ACP_LIST_UNSUPPORTED");
    const cursor = input.cursor; if (cursor !== undefined && !text(cursor, 1_024)) throw fail("DEVIN_ACP_SESSION_LIST_INVALID");
    return await this.request("session/list", { cwd: this.scope.workspacePath, ...(cursor === undefined ? {} : { cursor }) }, options) as { sessions: Array<{ sessionId: string; cwd: string }>; nextCursor?: string };
  }
  private projectSessions(response: Record<string, unknown>, cursor?: string): { sessions: Array<{ sessionId: string; cwd: string }>; nextCursor?: string } {
    if (!record(response) || !Array.isArray(response.sessions) || response.sessions.length > 100 || response.nextCursor !== undefined && response.nextCursor !== null && (!text(response.nextCursor, 1_024) || response.nextCursor === cursor)) throw fail("DEVIN_ACP_SESSION_LIST_INVALID");
    const seen = new Set<string>(), sessions = response.sessions.map((value: unknown) => {
      if (!record(value) || !text(value.sessionId) || seen.has(value.sessionId) || value.cwd !== this.scope.workspacePath || value.additionalDirectories !== undefined && (!Array.isArray(value.additionalDirectories) || value.additionalDirectories.length)) throw fail("DEVIN_ACP_SESSION_LIST_INVALID");
      seen.add(value.sessionId); return { sessionId: value.sessionId, cwd: value.cwd as string };
    });
    return { sessions, ...(response.nextCursor ? { nextCursor: response.nextCursor as string } : {}) };
  }
  async beginSession(supplied: DevinAcpBootstrapInput, options: DevinAcpBootstrapOptions): Promise<{ binding: NativeBinding; modelId: string }> {
    if (this.bootstrapState) throw fail("DEVIN_ACP_SESSION_BUSY");
    const input = structuredClone(supplied), guard = options.beforeSend, onBinding = options.onBinding, originalSignal = options.signal, timeout = options.timeoutMs ?? 5_000;
    const notCreated = (code: string) => new AdapterStartError("not-created", code, code);
    this.assertCurrentScope();
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30_000 || typeof guard !== "function" || typeof onBinding !== "function" || !["new", "resume"].includes(input.mode) || input.workspacePath !== this.scope.workspacePath || ![input.profileId, input.runnerId, input.nativeStoreRef, input.dispatcherSessionId].every(value => text(value)) || Object.hasOwn(input, "modelSelection") || !isExecutionContextRef(input.executionRef) || input.executionRef.kind !== "managed-worktree") throw notCreated("DEVIN_ACP_SCOPE_CHANGED");
    let selection: ExecutionSelection | undefined;
    try { selection = freezeExecutionSelection(input.executionSelection, { profileId: input.profileId, providerId: "devin-local", backendId: "devin-local-acp", selection: true, reasoning: false }); } catch { throw notCreated("DEVIN_ACP_SCOPE_CHANGED"); }
    if (!selection || selection.selectionType !== "explicit-model" || !selection.requestedModel || !validateExecutionBinding({ profileId: input.profileId, providerId: "devin-local", backendId: "devin-local-acp", runnerId: input.runnerId, executionRef: input.executionRef }, selection, { repositoryId: input.executionRef.repositoryId, baseRevision: input.executionRef.baseRevision }).valid) throw notCreated("DEVIN_ACP_SCOPE_CHANGED");
    const expected = (id: string): NativeBinding => ({ version: 1, product: "devin-local", region: "global", profileId: input.profileId, backendId: "devin-local-acp", runnerId: input.runnerId, nativeStoreRef: input.nativeStoreRef, nativeSessionId: id, identityState: "bound", executionRefId: input.executionRef.id });
    if (input.mode === "new" && input.binding !== undefined || input.mode === "resume" && (!input.binding || !text(input.binding.nativeSessionId) || !isDeepStrictEqual(input.binding, expected(input.binding.nativeSessionId)))) throw notCreated("DEVIN_ACP_IDENTITY_CHANGED");
    if (input.mode === "resume" && (!this.negotiation.loadSession || !this.negotiation.listSessions)) throw notCreated("DEVIN_ACP_LOAD_UNSUPPORTED");
    if (originalSignal?.aborted) throw notCreated("DEVIN_ACP_CANCELLED");
    this.bootstrapState = { updates: 0, ...(input.binding ? { expectedId: input.binding.nativeSessionId } : {}) };
    const local = new AbortController(), signal = AbortSignal.any([local.signal, this.disconnectSignal, ...(originalSignal ? [originalSignal] : [])]), deadline = performance.now() + timeout;
    let timedOut = false, written = false;
    const timer = setTimeout(() => { timedOut = true; local.abort(); }, timeout);
    const check = () => {
      this.assertCurrentScope();
      if (signal.aborted) throw fail(timedOut ? "DEVIN_ACP_TIMEOUT" : this.disconnectSignal.aborted ? "DEVIN_ACP_DISCONNECTED" : "DEVIN_ACP_CANCELLED");
      this.finalGuard(guard); this.assertCurrentScope();
      if (signal.aborted) throw fail(timedOut ? "DEVIN_ACP_TIMEOUT" : this.disconnectSignal.aborted ? "DEVIN_ACP_DISCONNECTED" : "DEVIN_ACP_CANCELLED");
      if (performance.now() >= deadline) throw fail("DEVIN_ACP_TIMEOUT");
    };
    const assertModel = (model: ModelOption) => {
      if (!isDeepStrictEqual(model, this.bootstrapState?.latestModel)) throw fail("DEVIN_ACP_MODEL_DRIFT");
    };
    const native = (method: string, params: Record<string, unknown>, mutation = true, model?: ModelOption) => {
      const sendCheck = () => { check(); if (model) assertModel(model); };
      sendCheck();
      return this.request(method, params, { signal, timeoutMs: Math.max(1, Math.ceil(deadline - performance.now())), beforeSend: sendCheck }, mutation ? () => { written = true; } : undefined);
    };
    try {
      let response: unknown;
      if (input.mode === "resume") {
        let cursor: string | undefined, found = false; const cursors = new Set<string>(), ids = new Set<string>();
        for (let page = 0; page < 10; page++) {
          const inventory = this.projectSessions(await native("session/list", { cwd: this.scope.workspacePath, ...(cursor === undefined ? {} : { cursor }) }, false) as Record<string, unknown>, cursor);
          for (const item of inventory.sessions) { if (ids.has(item.sessionId)) throw fail("DEVIN_ACP_SESSION_LIST_INVALID"); ids.add(item.sessionId); if (item.sessionId === input.binding!.nativeSessionId) found = true; }
          if (!inventory.nextCursor) { if (!found) throw fail("DEVIN_ACP_SESSION_NOT_FOUND"); break; }
          if (cursors.has(inventory.nextCursor) || page === 9) throw fail("DEVIN_ACP_SESSION_LIST_INVALID"); cursor = inventory.nextCursor; cursors.add(cursor);
        }
        response = await native("session/load", { sessionId: input.binding!.nativeSessionId, cwd: this.scope.workspacePath, mcpServers: [] });
      } else response = await native("session/new", { cwd: this.scope.workspacePath, mcpServers: [] });
      const body = response as Record<string, unknown>, id = input.mode === "resume" ? input.binding!.nativeSessionId : body.sessionId as string;
      const binding = expected(id), selected = selection.requestedModel;
      check();
      let callback: Promise<void>;
      try { callback = Promise.resolve(onBinding(structuredClone(binding))); } catch { throw fail("DEVIN_ACP_BINDING_FAILED"); }
      const settled = callback.then(() => {}, () => {}); this.guardCallbacks.add(settled); void settled.then(() => this.guardCallbacks.delete(settled));
      await new Promise<void>((resolve, reject) => {
        const abort = () => { cleanup(); reject(fail(timedOut ? "DEVIN_ACP_TIMEOUT" : this.disconnectSignal.aborted ? "DEVIN_ACP_DISCONNECTED" : "DEVIN_ACP_CANCELLED")); };
        const cleanup = () => signal.removeEventListener("abort", abort); signal.addEventListener("abort", abort, { once: true });
        callback.then(() => { cleanup(); resolve(); }, () => { cleanup(); reject(fail("DEVIN_ACP_BINDING_FAILED")); }); if (signal.aborted) abort();
      });
      check();
      let model = this.projectModel(body.configOptions);
      assertModel(model);
      if (input.mode === "resume" && model.currentValue !== selected) throw fail("DEVIN_ACP_MODEL_DRIFT");
      if (!model.values.includes(selected)) throw fail("DEVIN_ACP_MODEL_UNQUALIFIED");
      if (input.mode === "new" && model.currentValue !== selected) {
        const updated = await native("session/set_config_option", { sessionId: id, configId: model.id, value: selected }, true, model) as Record<string, unknown>;
        model = this.projectModel(updated.configOptions);
      }
      check(); assertModel(model); if (model.currentValue !== selected) throw fail("DEVIN_ACP_MODEL_DRIFT");
      this.bound = { binding: structuredClone(binding), model: structuredClone(model) };
      return { binding: structuredClone(binding), modelId: model.currentValue };
    } catch (error) {
      const code = timedOut ? "DEVIN_ACP_TIMEOUT" : error instanceof AdapterContractError ? error.code : "DEVIN_ACP_BOOTSTRAP_FAILED";
      this.end(code); throw new AdapterStartError(written ? "unknown" : "not-created", code, code);
    } finally { clearTimeout(timer); }
  }
  async prompt(supplied: { binding: NativeBinding; message: string }, options: DevinAcpPromptOptions): Promise<DevinAcpPromptResult> {
    if (this.activePrompt) throw fail("DEVIN_ACP_SESSION_BUSY");
    const input = structuredClone(supplied), guard = options.beforeSend, signal = options.signal ? AbortSignal.any([options.signal, this.disconnectSignal]) : this.disconnectSignal, onUpdate = options.onUpdate, timeout = options.timeoutMs ?? 5_000;
    if (!this.bound || !isDeepStrictEqual(input.binding, this.bound.binding)) throw fail("DEVIN_ACP_IDENTITY_CHANGED");
    if (typeof input.message !== "string" || !input.message.length || Buffer.byteLength(input.message) > 240_000 || typeof guard !== "function" || onUpdate !== undefined && typeof onUpdate !== "function") throw fail("DEVIN_ACP_PROMPT_INVALID");
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30_000) throw fail("DEVIN_ACP_TIMEOUT_INVALID");
    const active: ActivePrompt = { binding: structuredClone(input.binding), model: structuredClone(this.bound.model), deadline: performance.now() + timeout, written: false, terminal: false, cancelAdmitted: false, updates: 0, tools: new Map(), proof: false, toolFailure: false, permissionDenied: false, signal, ...(onUpdate ? { onUpdate } : {}) };
    this.activePrompt = active;
    const check = () => { this.assertPrompt(active); this.finalGuard(guard); this.assertPrompt(active); };
    try {
      check();
      const response = await this.request("session/prompt", { sessionId: active.binding.nativeSessionId, prompt: [{ type: "text", text: input.message }] }, { signal, timeoutMs: Math.max(1, Math.ceil(active.deadline - performance.now())), beforeSend: check }, () => { active.written = true; });
      check();
      return { stopReason: (response as { stopReason: DevinAcpStopReason }).stopReason, executionEvidence: active.proof, toolFailure: active.toolFailure, permissionDenied: active.permissionDenied, pendingTools: [...active.tools.values()].filter(status => status === "pending" || status === "in_progress").length };
    } catch (error) {
      const reason: unknown = this.disconnectSignal.reason;
      const code = this.disconnectSignal.aborted && reason instanceof AdapterContractError ? reason.code : error instanceof AdapterContractError ? error.code : "DEVIN_ACP_PROMPT_OUTCOME_UNKNOWN";
      this.end(code); throw fail(code);
    } finally { if (this.activePrompt === active) delete this.activePrompt; if (this.bootstrapState) this.bootstrapState.updates = 0; }
  }
  async cancelPrompt(supplied: { binding: NativeBinding }, options: Pick<DevinAcpReadOptions, "signal"> & { beforeSend: () => void }): Promise<{ disposition: "submitted" | "not-submitted" }> {
    const input = structuredClone(supplied), active = this.activePrompt, guard = options.beforeSend;
    if (!active || !isDeepStrictEqual(input.binding, active.binding)) throw fail("DEVIN_ACP_IDENTITY_CHANGED");
    if (active.cancelAdmitted || active.terminal || !active.written) throw fail("DEVIN_ACP_SESSION_BUSY");
    if (typeof guard !== "function") throw fail("DEVIN_ACP_AUTHORITY_CHANGED");
    active.cancelAdmitted = true;
    const signal = options.signal ? AbortSignal.any([active.signal, options.signal]) : active.signal;
    const params = { sessionId: active.binding.nativeSessionId };
    const check = () => { this.assertPrompt(active); if (active.terminal) throw fail("DEVIN_ACP_SESSION_BUSY"); this.finalGuard(guard); this.assertPrompt(active); };
    const cancellation = { active, written: false, skipped: false };
    const permit: Permit = { method: "session/cancel", params, signal, deadline: active.deadline, beforeSend: check, cancellation };
    const remaining = Math.max(1, Math.ceil(active.deadline - performance.now()));
    let timer: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined, queued = false;
    const removePermit = () => { const index = this.permits.indexOf(permit); if (index >= 0) this.permits.splice(index, 1); };
    try {
      check(); this.permits.push(permit);
      await new Promise<void>((resolve, reject) => {
        abort = () => {
          if (!cancellation.written && (active.terminal || this.activePrompt !== active)) { cancellation.skipped = true; resolve(); return; }
          const reason: unknown = this.disconnectSignal.reason;
          const code = this.disconnectSignal.aborted && reason instanceof AdapterContractError ? reason.code : "DEVIN_ACP_CANCEL_OUTCOME_UNKNOWN";
          this.end(code); reject(fail(code));
        };
        signal.addEventListener("abort", abort, { once: true }); timer = setTimeout(abort, remaining);
        queued = true;
        const notification = this.connection.agent.notify("session/cancel", params);
        // Even if an unsent terminal cancellation expires, keep its queue permit
        // until the SDK reaches/drops that frame; removing it would misroute the next write.
        const settled = notification.then(() => {}, () => {}).finally(() => { removePermit(); this.writes.delete(settled); });
        this.writes.add(settled); notification.then(resolve, reject); if (signal.aborted) abort();
      });
      return { disposition: cancellation.skipped ? "not-submitted" : "submitted" };
    } catch (error) { const code = error instanceof AdapterContractError ? error.code : "DEVIN_ACP_CANCEL_OUTCOME_UNKNOWN"; this.end(code); throw fail(code); }
    finally { if (timer) clearTimeout(timer); if (abort) signal.removeEventListener("abort", abort); if (!queued) removePermit(); }
  }
  private end(code: string): void {
    if (this.closed) return; this.closed = true; const error = fail(code); this.disconnected.abort(error); this.connection?.close(error);
    this.permits.length = 0; this.sent.clear(); this.frameLengths.length = 0; this.frameBytes = 0; this.bufferedInputBytes = 0; this.child.stdin.destroy(); this.child.stdout.destroy(); this.child.stderr.destroy();
    void Promise.resolve().then(() => this.close()).catch(() => {});
  }
  close(): Promise<LocalRuntimeDisconnect> { return this.shutdown ??= this.closeOwned(); }
  private async closeOwned(): Promise<LocalRuntimeDisconnect> {
    this.end("DEVIN_ACP_DISCONNECTED");
    let stopped = true;
    try { await this.cancellation.stop(); } catch { stopped = false; }
    const exited = await new Promise<boolean>(resolve => { const timer = setTimeout(() => resolve(false), 500); this.exited.then(() => { clearTimeout(timer); resolve(true); }); });
    const drained = await new Promise<boolean>(resolve => {
      const timer = setTimeout(() => resolve(false), 500);
      Promise.allSettled([...this.guardCallbacks, ...this.writes]).then(() => { clearTimeout(timer); resolve(true); });
    });
    return { version: 1, connection: "closed", ownedRoot: !stopped ? "unknown" : this.notCreated ? "not-created" : this.originalPid !== undefined && exited ? "exited" : "unknown", callbacks: drained ? "drained" : "unknown", backgroundTools: "unknown", nativeSessionDeleted: false, ...(this.originalPid === undefined ? {} : { ownedRootPid: this.originalPid }) };
  }
}
