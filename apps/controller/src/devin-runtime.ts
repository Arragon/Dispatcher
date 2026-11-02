import { createHash, randomUUID } from "node:crypto";
import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { AdapterContractError, AdapterStartError, freezeExecutionSelection, DevinLocalAcpExecutionBackend, type DevinLocalAcpExecutionScope, type CliAgentBackend, type CliAgentProfile, type CliStartInput, type CliTurn, type CliTurnResult, type NativeInteractionPort } from "@dispatcher/adapters";
import { isExecutionContextRef, validateExecutionBinding, type ExecutionContextRef, type ExecutionSelection, type NativeBinding } from "@dispatcher/domain";
import { NativeRuntimeHosts, type RuntimeHandle, type RuntimeLocalDisconnectResult } from "@dispatcher/runner";

interface PathIdentity { path: string; dev: bigint; ino: bigint; size?: bigint; mtimeNs?: bigint }
const identifier = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 512 && !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
function reject(code = "DEVIN_ACP_SCOPE_CHANGED", outcome: "not-created" | "unknown" = "not-created"): never { throw new AdapterStartError(outcome, code, code); }
function physical(path: string, directory = true): PathIdentity {
  try {
    if (typeof path !== "string" || !isAbsolute(path) || Array.from(path).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw Error();
    const actual = realpathSync(path), stat = statSync(actual, { bigint: true });
    if (directory ? !stat.isDirectory() : !stat.isFile()) throw Error();
    if (!directory) accessSync(path, constants.X_OK);
    return { path: actual, dev: stat.dev, ino: stat.ino, ...(!directory ? { size: stat.size, mtimeNs: stat.mtimeNs } : {}) };
  } catch { return reject(); }
}
export function assertDevinRuntimeSettings(profile: CliAgentProfile, dataHome: string, configHome: string): void { physical(profile.executable ?? "", false); physical(dataHome); physical(configHome); }
interface RuntimeOptions {
  profile: CliAgentProfile; dataHome: string; configHome: string; runnerId: string;
  assertInput: (input: CliStartInput) => void; bindingFor: (nativeSessionId: string) => NativeBinding | undefined;
  factory?: (scope: DevinLocalAcpExecutionScope, reference: ExecutionContextRef) => DevinLocalAcpExecutionBackend;
}
interface Host {
  reference: Extract<ExecutionContextRef, { kind: "managed-worktree" }>; selection: ExecutionSelection;
  workspace: PathIdentity; workspacePath: string; scope: DevinLocalAcpExecutionScope;
  backend: DevinLocalAcpExecutionBackend; handle: Promise<RuntimeHandle>; creator: symbol; binding?: NativeBinding; bindingPersisted?: boolean;
}
function copy(input: CliStartInput): CliStartInput {
  const { beforePrompt, beforeObserve, onBinding, onNativeEvent, normalizeLine, ...data } = input;
  return { ...structuredClone(data), ...(beforePrompt ? { beforePrompt } : {}), ...(beforeObserve ? { beforeObserve } : {}), ...(onBinding ? { onBinding } : {}), ...(onNativeEvent ? { onNativeEvent } : {}), ...(normalizeLine ? { normalizeLine } : {}) };
}
function capture(original: CliStartInput): CliStartInput {
  try {
    // Read getter-backed inputs once; preserve callbacks' original receivers.
    const { beforePrompt, beforeObserve, onBinding, onNativeEvent, normalizeLine, ...data } = { ...original };
    if ([beforePrompt, beforeObserve, onBinding, onNativeEvent, normalizeLine].some(callback => callback !== undefined && typeof callback !== "function")) reject();
    return { ...structuredClone(data), ...(beforePrompt ? { beforePrompt: beforePrompt.bind(original) } : {}), ...(beforeObserve ? { beforeObserve: beforeObserve.bind(original) } : {}), ...(onBinding ? { onBinding: onBinding.bind(original) } : {}), ...(onNativeEvent ? { onNativeEvent: onNativeEvent.bind(original) } : {}), ...(normalizeLine ? { normalizeLine: normalizeLine.bind(original) } : {}) };
  } catch { return reject(); }
}
class AcquiringTurn implements CliTurn {
  private turn?: CliTurn; private failed = false; private readonly admission: Promise<void>; private work?: Promise<CliTurnResult>;
  constructor(acquire: Promise<CliTurn>, private readonly track: <T>(work: Promise<T>) => Promise<T>, private readonly lifetime: <T>(work: Promise<T>) => Promise<T>, private readonly close: () => Promise<void>, admitted: () => Promise<void>, private readonly beforeResult: () => void, private readonly finish: (result: CliTurnResult) => Promise<void>, private readonly failure: (error: unknown) => AdapterStartError) {
    const raw = this.track(acquire.then(async turn => { this.turn = turn; await turn.ready?.(); await admitted(); }));
    this.admission = lifetime(raw).catch(error => { this.failed = true; throw failure(error); }); void this.admission.catch(() => {});
  }
  ready(): Promise<void> { return this.admission; }
  status(): "running" | "completed" { return this.failed ? "completed" : this.turn?.status() ?? "running"; }
  async result(): Promise<CliTurnResult> {
    await this.admission;
    if (!this.work) this.beforeResult();
    this.work ??= this.track((async () => { try { const result = structuredClone(await this.turn!.result()); await this.finish(result); return result; } catch (error) { throw this.failure(error); } })());
    return structuredClone(await this.lifetime(this.work));
  }
  events() { return this.turn?.events?.() ?? []; }
  cancel(): Promise<void> { return this.close(); }
}
/** Controller owns managed routing/lifetime; ACP payloads remain in Adapter. */
export class DevinExecutionRuntime implements CliAgentBackend {
  readonly backendId = "devin-local-acp";
  private readonly options: RuntimeOptions;
  private readonly paths: PathIdentity[];
  private readonly nativeStoreRef: string;
  private readonly hosts = new NativeRuntimeHosts();
  private readonly executions = new Map<string, Host>();
  private readonly callbacks = new Set<Promise<unknown>>();
  private readonly operations = new Set<Promise<unknown>>();
  private readonly shutdown = new AbortController();
  private closed = false; private cleanup?: Promise<RuntimeLocalDisconnectResult[]>; private receipts?: RuntimeLocalDisconnectResult[];
  constructor(original: RuntimeOptions) {
    try {
      const { profile: originalProfile, dataHome, configHome, runnerId, assertInput, bindingFor, factory } = { ...original };
      const profile = structuredClone(originalProfile);
      if (!identifier(profile.id) || !identifier(runnerId) || typeof assertInput !== "function" || typeof bindingFor !== "function" || factory !== undefined && typeof factory !== "function") reject();
      this.options = Object.freeze({ profile, dataHome, configHome, runnerId, assertInput: assertInput.bind(original), bindingFor: bindingFor.bind(original), ...(factory ? { factory: factory.bind(original) } : {}) });
      assertDevinRuntimeSettings(this.options.profile, dataHome, configHome); this.paths = this.identities();
      this.nativeStoreRef = "native-store:" + createHash("sha256").update(JSON.stringify(["devin-local", "global", ...this.paths.slice(1).map(value => [value.path, String(value.dev), String(value.ino)])])).digest("hex");
    } catch { throw new AdapterStartError("not-created", "DEVIN_ACP_SCOPE_CHANGED", "DEVIN_ACP_SCOPE_CHANGED"); }
  }
  private identities(): PathIdentity[] { return [physical(this.options.profile.executable ?? "", false), physical(this.options.dataHome), physical(this.options.configHome)]; }
  private assertPaths(workspacePath?: string, workspace?: PathIdentity): void { if (!isDeepStrictEqual(this.identities(), this.paths) || workspace && !isDeepStrictEqual(physical(workspacePath!), workspace)) reject(); }
  private track<T>(work: Promise<T>, set = this.operations): Promise<T> { set.add(work); void work.finally(() => set.delete(work)).catch(() => {}); return work; }
  private capacity(): void { if (this.callbacks.size >= 64) reject("DEVIN_ACP_CALLBACK_LIMIT"); }
  private invoke(callback: () => unknown): { work: Promise<void>; asynchronous: boolean } {
    this.capacity();
    // Reserve before user code: that code can synchronously start local shutdown.
    let resolve!: () => void, fail!: (reason: unknown) => void;
    const work = new Promise<void>((pass, reject) => { resolve = pass; fail = reject; }); this.track(work, this.callbacks);
    try {
      const returned = callback();
      if (returned === undefined) { resolve(); this.callbacks.delete(work); return { work, asynchronous: false }; }
      // Normalize the actual returned work once, including a throwing then getter.
      void Promise.resolve(returned).then(() => resolve(), fail);
      return { work, asynchronous: true };
    } catch (error) { fail(error); throw error; }
  }
  private sync(callback: () => void, code: string): void {
    this.capacity();
    try { if (this.invoke(callback).asynchronous) reject(code); }
    catch { reject(code); }
  }
  private validate(input: CliStartInput, workspace: PathIdentity): void {
    if (this.closed) reject("DEVIN_ACP_LOCAL_CONNECTION_CLOSED");
    const ref = input.executionRef, n = input.nativeInput;
    try {
      if (!isExecutionContextRef(ref) || ref.kind !== "managed-worktree" || ref.runnerId !== this.options.runnerId || !n || n.version !== 1 || n.profileId !== this.options.profile.id || n.backendId !== this.backendId || input.executable !== this.options.profile.executable) reject();
      if (n.newSession !== true || Object.hasOwn(n, "providerSessionId")) reject("DEVIN_ACP_CONTINUATION_REQUIRES_COMMAND_LANE");
      if (Object.hasOwn(n, "legacyModel") || Object.hasOwn(n, "modelSelection")) reject("MODEL_LEGACY_REVIEW_REQUIRED");
      const selection = freezeExecutionSelection(n.executionSelection, { profileId: this.options.profile.id, providerId: "devin-local", backendId: this.backendId, selection: true, reasoning: false });
      if (!selection || selection.mode === "legacy" || selection.selectionType !== "explicit-model" || !identifier(selection.requestedModel) || !validateExecutionBinding({ profileId: this.options.profile.id, providerId: "devin-local", backendId: this.backendId, runnerId: this.options.runnerId, executionRef: ref }, selection, { repositoryId: ref.repositoryId, baseRevision: ref.baseRevision }).valid || ![n.runId, n.sessionId, n.commandId].every(identifier) || typeof n.prompt !== "string" || !n.prompt.length || Buffer.byteLength(n.prompt) > 240_000 || n.approveTools !== false || !Array.isArray(input.args) || input.args.length || input.environment && Object.keys(input.environment).length || typeof input.beforePrompt !== "function" || typeof input.beforeObserve !== "function" || typeof input.onBinding !== "function" || input.onNativeEvent !== undefined && typeof input.onNativeEvent !== "function") reject("DEVIN_ACP_START_INVALID");
      this.assertPaths(input.workspacePath, workspace); this.sync(() => this.options.assertInput(copy(input)), "DEVIN_ACP_SCOPE_CHANGED"); this.assertPaths(input.workspacePath, workspace);
      if (this.closed) reject("DEVIN_ACP_LOCAL_CONNECTION_CLOSED");
    } catch (error) { if (error instanceof AdapterStartError) throw error; reject(); }
  }
  private registered(entry: Host): void { if (this.closed) reject("DEVIN_ACP_LOCAL_CONNECTION_CLOSED"); if (this.executions.get(entry.reference.id) !== entry) reject(); }
  private persisted(entry: Host): void {
    const binding = structuredClone(entry.binding); if (!binding || !entry.bindingPersisted) reject("DEVIN_ACP_IDENTITY_CHANGED", "unknown");
    const found = this.options.bindingFor(binding.nativeSessionId); this.registered(entry); this.assertPaths(entry.workspacePath, entry.workspace);
    const current = this.options.bindingFor(binding.nativeSessionId); this.registered(entry); this.assertPaths(entry.workspacePath, entry.workspace);
    if (!isDeepStrictEqual(found, binding) || !isDeepStrictEqual(current, binding)) reject("DEVIN_ACP_IDENTITY_CHANGED", "unknown");
  }
  isClosed(): boolean { return this.closed; }
  hasActiveOperations(): boolean { return this.operations.size > 0 || this.callbacks.size > 0 || [...this.executions.values()].some(entry => entry.backend.hasActiveOperations()); }
  hasUnclosedHosts(): boolean { return this.callbacks.size > 0 || Boolean(this.receipts?.some(receipt => receipt.connection !== "closed" || receipt.ownedRoot === "unknown" || receipt.callbacks !== "drained")) || this.executions.size > 0 && !this.receipts; }
  beginShutdown(): void { this.closed = true; this.shutdown.abort(); for (const entry of this.executions.values()) entry.backend.beginShutdown(); }
  source(binding: NativeBinding): NativeInteractionPort | undefined { void binding; return undefined; }
  diagnostics(nativeSessionId: string): Record<string, unknown> {
    try { const entry = [...this.executions.values()].find(value => value.binding?.nativeSessionId === nativeSessionId); if (!entry) return {}; this.persisted(entry); return { executionRefId: entry.reference.id, localConnection: "open" }; } catch { return {}; }
  }
  start(original: CliStartInput): CliTurn {
    const input = capture(original), workspace = physical(input.workspacePath); this.validate(input, workspace);
    this.sync(input.beforeObserve!, "DEVIN_ACP_AUTHORITY_CHANGED"); this.validate(input, workspace);
    const reference = input.executionRef as Host["reference"], selection = input.nativeInput!.executionSelection!, token = Symbol("creation"), cancel = new AbortController();
    let ownsCreation = false, creationObserved = false, producerEntered = false, captured: Host | undefined, boundaryFailure: AdapterStartError | undefined;
    const pending = new Set<Promise<unknown>>();
    const failure = (error: unknown): AdapterStartError => {
      const code = error instanceof AdapterContractError ? error.code : "DEVIN_ACP_CALLBACK_FAILED";
      const wrapped = new AdapterStartError(creationObserved || error instanceof AdapterStartError && error.creationOutcome === "unknown" ? "unknown" : "not-created", code, code);
      if (ownsCreation) boundaryFailure ??= wrapped; return wrapped;
    };
    const guard = () => {
      try {
        if (boundaryFailure) throw boundaryFailure; if (cancel.signal.aborted) reject("DEVIN_ACP_LOCAL_CONNECTION_CLOSED"); this.validate(input, workspace);
        if (captured) { this.registered(captured); if (captured.creator !== token || !isDeepStrictEqual(captured.reference, reference) || !isDeepStrictEqual(captured.selection, selection)) reject(); if (captured.bindingPersisted) { this.persisted(captured); this.validate(input, workspace); this.registered(captured); } }
      } catch (error) { throw failure(error); }
    };
    const bounded = async <T>(work: Promise<T>, code: string): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { return await Promise.race([work, new Promise<never>((_, fail) => { timer = setTimeout(() => fail(failure(new AdapterStartError("unknown", code, code))), 500); })]); }
      finally { if (timer) clearTimeout(timer); }
    };
    const admitted = async () => { guard(); if (!captured?.bindingPersisted || !captured.binding) reject("DEVIN_ACP_IDENTITY_CHANGED", "unknown"); await bounded(Promise.all([...pending]), "DEVIN_ACP_CALLBACK_FAILED"); guard(); };
    const durable = (callback: () => void | Promise<void>, code: string, after: () => void): Promise<void> => {
      const work = (async () => {
        try {
          guard(); const raw = this.invoke(callback).work;
          await bounded(raw, code); guard(); after(); guard();
        } catch (error) { throw failure(error); }
      })();
      this.track(work); this.track(work, pending); void work.catch(() => {}); return work;
    };
    const acquire = this.track((async () => {
      guard(); let entry = this.executions.get(reference.id);
      if (entry && (!isDeepStrictEqual(entry.reference, reference) || !isDeepStrictEqual(entry.workspace, workspace) || !isDeepStrictEqual(entry.selection, selection))) reject();
      if (entry) reject("DEVIN_ACP_SESSION_ALREADY_ADMITTED");
      const scope: DevinLocalAcpExecutionScope = { profileId: this.options.profile.id, runnerId: this.options.runnerId, nativeStoreRef: this.nativeStoreRef, executable: this.options.profile.executable!, workspacePath: workspace.path, dataHome: this.paths[1]!.path, configHome: this.paths[2]!.path };
      const backend = this.options.factory ? this.options.factory(structuredClone(scope), structuredClone(reference)) : new DevinLocalAcpExecutionBackend({ scope, executionRef: structuredClone(reference) });
      try { guard(); if (this.executions.has(reference.id)) reject("DEVIN_ACP_SESSION_ALREADY_ADMITTED"); if (backend.backendId !== this.backendId) reject("BACKEND_MISMATCH"); }
      catch (error) { backend.beginShutdown(); this.track(backend.disconnectLocal()); throw error; }
      const unsupported = async (): Promise<never> => { throw new AdapterContractError("NATIVE_CAPABILITY_UNVERIFIED", "Devin Local native control is unqualified"); };
      const handle = this.track(this.hosts.acquireRuntime({ id: this.options.profile.id }, { id: this.backendId, runnerId: scope.runnerId, nativeStoreRef: scope.nativeStoreRef, product: "devin-local", region: "global", executionRefId: reference.id, ownership: "owned", acquire: async () => ({ id: randomUUID(), profileId: scope.profileId, backendId: this.backendId, runnerId: scope.runnerId, nativeStoreRef: scope.nativeStoreRef, product: "devin-local", region: "global", executionRefId: reference.id, ownership: "owned", interrupt: unsupported, quiescent: async () => false, stop: unsupported, detach: unsupported, disconnectLocal: () => backend.disconnectLocal() }) }));
      entry = { reference: structuredClone(reference), selection: structuredClone(selection), workspace, workspacePath: input.workspacePath, scope, backend, handle, creator: token }; this.executions.set(reference.id, entry);
      captured = entry; ownsCreation = true; await handle; guard();
      producerEntered = true;
      return backend.start({ ...copy(input), beforePrompt: () => { try { guard(); this.sync(input.beforePrompt!, "DEVIN_ACP_AUTHORITY_CHANGED"); guard(); } catch (error) { throw failure(error); } }, beforeObserve: () => { try { guard(); this.sync(input.beforeObserve!, "DEVIN_ACP_AUTHORITY_CHANGED"); guard(); } catch (error) { throw failure(error); } }, ...(input.onNativeEvent ? { onNativeEvent: originalFact => {
        let fact: typeof originalFact; try { fact = structuredClone(originalFact); } catch (error) { throw failure(error); }
        return durable(() => { if (!captured!.bindingPersisted || fact.nativeSessionId !== captured!.binding!.nativeSessionId) reject("DEVIN_ACP_IDENTITY_CHANGED", "unknown"); return input.onNativeEvent!(fact); }, "DEVIN_ACP_CALLBACK_FAILED", () => {});
      } } : {}), onBinding: originalBinding => {
        creationObserved = true;
        let binding: NativeBinding; try { binding = structuredClone(originalBinding); } catch (error) { throw failure(error); }
        return durable(() => {
          const id = binding.nativeSessionId;
          if (!identifier(id) || id.startsWith("unstarted:") || !isDeepStrictEqual(binding, { version: 1, product: "devin-local", region: "global", profileId: scope.profileId, backendId: this.backendId, runnerId: scope.runnerId, nativeStoreRef: scope.nativeStoreRef, nativeSessionId: id, identityState: "bound", executionRefId: reference.id }) || captured!.binding) reject("DEVIN_ACP_IDENTITY_CHANGED", "unknown");
          captured!.binding = structuredClone(binding); return input.onBinding!(structuredClone(binding));
        }, "DEVIN_ACP_BINDING_FAILED", () => { captured!.bindingPersisted = true; this.persisted(captured!); });
      } });
    })().catch(error => { throw failure(error); }));
    const lifetime = <T>(work: Promise<T>): Promise<T> => new Promise((resolve, fail) => {
      const closed = () => fail(failure(new AdapterStartError(producerEntered ? "unknown" : "not-created", "DEVIN_ACP_LOCAL_CONNECTION_CLOSED", "DEVIN_ACP_LOCAL_CONNECTION_CLOSED")));
      this.shutdown.signal.addEventListener("abort", closed, { once: true }); cancel.signal.addEventListener("abort", closed, { once: true });
      void work.then(resolve, fail).finally(() => { this.shutdown.signal.removeEventListener("abort", closed); cancel.signal.removeEventListener("abort", closed); }).catch(() => {});
      if (this.closed || cancel.signal.aborted) closed();
    });
    return new AcquiringTurn(acquire, work => this.track(work), lifetime, async () => { cancel.abort(); if (ownsCreation && captured?.creator === token) { captured.backend.beginShutdown(); await captured.backend.disconnectLocal(); } }, admitted, guard, async result => { await admitted(); if (result.providerSessionId !== undefined && result.providerSessionId !== captured!.binding!.nativeSessionId || result.state === "completed" && result.providerSessionId === undefined) reject("DEVIN_ACP_IDENTITY_CHANGED", "unknown"); }, failure);
  }
  async disconnectLocal(): Promise<RuntimeLocalDisconnectResult[]> {
    this.beginShutdown();
    this.cleanup ??= (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        // Bound our own raw callbacks independently of the producer's receipt.
        const [receipts, drained] = await Promise.all([this.hosts.shutdownLocal(), Promise.race([Promise.allSettled([...this.callbacks]).then(() => true), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 500); })])]);
        if (!drained) {
          receipts.push({ version: 1, connection: "closed", ownedRoot: "not-created", callbacks: "unknown", backgroundTools: "unknown", nativeSessionDeleted: false, profileId: this.options.profile.id, backendId: this.backendId, runnerId: this.options.runnerId, nativeStoreRef: this.nativeStoreRef, product: "devin-local", region: "global", ownership: "owned" });
        }
        this.receipts = structuredClone(receipts); return receipts;
      } finally { if (timer) clearTimeout(timer); }
    })();
    return structuredClone(await this.cleanup);
  }
}
