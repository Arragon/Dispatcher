import { isDeepStrictEqual } from "node:util";
import { isExecutionContextRef, validateExecutionBinding, type ExecutionContextRef, type NativeTurnFact, type ModelCatalogContext, type AccountModelCatalog } from "@dispatcher/domain";
import { AdapterContractError, AdapterStartError, type AdapterManifest } from "./contracts.js";
import { StructuredCliAdapter, type CliAgentBackend, type CliAgentProfile, type CliStartInput, type CliTurn, type CliTurnResult, type NormalizedCliEvent } from "./ecosystem-cli.js";
import type { SessionStore } from "./generic.js";
import type { LocalRuntimeDisconnect } from "./interaction-contracts.js";
import { DevinLocalAcpClient, identity, type Identity, type DevinLocalAcpScope } from "./devin-acp.js";
import { readDevinLocalCatalog } from "./devin-acp-catalog.js";
import { freezeExecutionSelection } from "./execution-selection.js";
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 512 && !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
export interface DevinLocalAcpExecutionScope extends DevinLocalAcpScope { profileId: string; runnerId: string; nativeStoreRef: string }
/** One managed creation. Command continuation and native writer release are separate. */
export class DevinLocalAcpExecutionBackend implements CliAgentBackend {
  readonly backendId = "devin-local-acp";
  private readonly scope: DevinLocalAcpExecutionScope;
  private readonly reference: Extract<ExecutionContextRef, { kind: "managed-worktree" }>;
  private readonly paths: Identity[];
  private readonly shutdown = new AbortController();
  private readonly consumers = new Set<Promise<unknown>>();
  private readonly operations = new Set<Promise<unknown>>();
  private pipeline: Promise<void> = Promise.resolve();
  private admitted = false;
  private closed = false;
  private creationPossible = false;
  private persistenceFailed = false;
  private observationFailureClosed = false;
  private acquisitionEnded = true;
  private acquisitionAttempted = false;
  private client?: DevinLocalAcpClient;
  private opening?: Promise<DevinLocalAcpClient>;
  private work?: Promise<CliTurnResult>;
  private cleanup?: Promise<LocalRuntimeDisconnect>;

  constructor(options: { scope: DevinLocalAcpExecutionScope; executionRef: ExecutionContextRef }) {
    this.scope = structuredClone(options.scope);
    const reference = structuredClone(options.executionRef);
    if (![this.scope.profileId, this.scope.runnerId, this.scope.nativeStoreRef].every(text) || !isExecutionContextRef(reference) || reference.kind !== "managed-worktree" || reference.runnerId !== this.scope.runnerId) this.reject("DEVIN_ACP_SCOPE_CHANGED");
    this.reference = reference;
    try { this.paths = this.identities(); } catch { this.reject("DEVIN_ACP_SCOPE_CHANGED"); }
  }
  private identities(): Identity[] { return [identity(this.scope.executable, false), identity(this.scope.workspacePath, true), identity(this.scope.dataHome, true), identity(this.scope.configHome, true)]; }
  private error(code: string): AdapterStartError { return new AdapterStartError(this.creationPossible ? "unknown" : "not-created", code, code); }
  private reject(code: string): never { throw this.error(code); }
  hasActiveOperations(): boolean { return this.operations.size > 0 || this.consumers.size > 0; }
  private track<T>(work: Promise<T>, set = this.operations): Promise<T> {
    set.add(work);
    void work.finally(() => set.delete(work)).catch(() => {});
    return work;
  }
  private consume(returned: unknown): Promise<void> {
    if (this.consumers.size >= 64) this.reject("DEVIN_ACP_CALLBACK_LIMIT");
    // Normalize the original returned work once; local wait cancellation cannot end it.
    return this.track(Promise.resolve(returned).then(() => {}), this.consumers);
  }
  private guard(input: CliStartInput): void {
    if (this.closed) this.reject("DEVIN_ACP_LOCAL_CONNECTION_CLOSED");
    if (this.persistenceFailed) this.reject("DEVIN_ACP_CALLBACK_FAILED");
    try {
      if (!isDeepStrictEqual(this.identities(), this.paths) || input.executable !== this.scope.executable || !isDeepStrictEqual(input.executionRef, this.reference) || !isDeepStrictEqual(identity(input.workspacePath, true), this.paths[1])) this.reject("DEVIN_ACP_SCOPE_CHANGED");
    } catch { this.reject("DEVIN_ACP_SCOPE_CHANGED"); }
    if (this.consumers.size >= 64) this.reject("DEVIN_ACP_CALLBACK_LIMIT");
    let returned: unknown;
    try { returned = input.beforePrompt!(); } catch { this.reject("DEVIN_ACP_AUTHORITY_CHANGED"); }
    if (returned !== undefined) { this.consume(returned); this.reject("DEVIN_ACP_AUTHORITY_CHANGED"); }
    if (this.closed) this.reject("DEVIN_ACP_LOCAL_CONNECTION_CLOSED");
    try { if (!isDeepStrictEqual(this.identities(), this.paths)) this.reject("DEVIN_ACP_SCOPE_CHANGED"); }
    catch { this.reject("DEVIN_ACP_SCOPE_CHANGED"); }
  }
  private validate(input: CliStartInput): void {
    const n = input.nativeInput;
    if (!n || n.version !== 1 || n.profileId !== this.scope.profileId || n.backendId !== this.backendId || ![n.runId, n.sessionId, n.commandId].every(text)) this.reject("DEVIN_ACP_SCOPE_CHANGED");
    if (n.newSession !== true || Object.hasOwn(n, "providerSessionId")) this.reject("DEVIN_ACP_CONTINUATION_REQUIRES_COMMAND_LANE");
    if (n.approveTools !== false || input.args.length || input.environment && Object.keys(input.environment).length || typeof n.prompt !== "string" || !n.prompt.length || Buffer.byteLength(n.prompt) > 240_000 || typeof input.beforePrompt !== "function" || typeof input.onBinding !== "function" || input.onNativeEvent !== undefined && typeof input.onNativeEvent !== "function") this.reject("DEVIN_ACP_START_INVALID");
    if (Object.hasOwn(n, "modelSelection") || Object.hasOwn(n, "legacyModel")) this.reject("MODEL_LEGACY_REVIEW_REQUIRED");
    try {
      const selection = freezeExecutionSelection(n.executionSelection, { profileId: this.scope.profileId, providerId: "devin-local", backendId: this.backendId, selection: true, reasoning: false });
      if (!selection || selection.selectionType !== "explicit-model" || !text(selection.requestedModel) || !validateExecutionBinding({ profileId: this.scope.profileId, providerId: "devin-local", backendId: this.backendId, runnerId: this.scope.runnerId, executionRef: this.reference }, selection, { repositoryId: this.reference.repositoryId, baseRevision: this.reference.baseRevision }).valid) this.reject("DEVIN_ACP_MODEL_SELECTION_INVALID");
    } catch { this.reject("DEVIN_ACP_MODEL_SELECTION_INVALID"); }
    this.guard(input);
  }
  private async bounded<T>(work: Promise<T>, code: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined;
    try {
      return await Promise.race([work, new Promise<never>((_, reject) => {
        abort = () => reject(this.error("DEVIN_ACP_LOCAL_CONNECTION_CLOSED"));
        this.shutdown.signal.addEventListener("abort", abort, { once: true });
        timer = setTimeout(() => reject(this.error(code)), 500);
        if (this.closed) abort();
      })]);
    } finally { if (timer) clearTimeout(timer); if (abort) this.shutdown.signal.removeEventListener("abort", abort); }
  }
  private observe(input: CliStartInput, original: NativeTurnFact): Promise<void> {
    const fact = structuredClone(original);
    const observation = this.pipeline.then(async () => {
      this.guard(input);
      let returned: unknown;
      try { returned = input.onNativeEvent?.(fact); } catch { this.reject("DEVIN_ACP_CALLBACK_FAILED"); }
      try { await this.bounded(this.consume(returned), "DEVIN_ACP_CALLBACK_FAILED"); }
      catch { this.reject("DEVIN_ACP_CALLBACK_FAILED"); }
      this.guard(input);
    }).catch(error => { this.persistenceFailed = true; throw error; });
    this.pipeline = this.track(observation);
    return observation;
  }
  start(original: CliStartInput): CliTurn {
    if (this.admitted) this.reject("DEVIN_ACP_SESSION_ALREADY_ADMITTED");
    const input: CliStartInput = {
      ...original, args: [...original.args],
      ...(original.environment ? { environment: structuredClone(original.environment) } : {}),
      ...(original.executionRef ? { executionRef: structuredClone(original.executionRef) } : {}),
      ...(original.nativeInput ? { nativeInput: structuredClone(original.nativeInput) } : {}),
      ...(typeof original.beforePrompt === "function" ? { beforePrompt: original.beforePrompt.bind(original) } : {}),
      ...(typeof original.onBinding === "function" ? { onBinding: original.onBinding.bind(original) } : {}),
      ...(typeof original.onNativeEvent === "function" ? { onNativeEvent: original.onNativeEvent.bind(original) } : {}),
    };
    this.validate(input); this.admitted = true;
    const n = input.nativeInput!, events: NormalizedCliEvent[] = [];
    let completed = false, confirmed = false, nativeId: string | undefined, resolveReady!: () => void, rejectReady!: (error: unknown) => void;
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; }); void ready.catch(() => {});
    const confirm = () => { this.guard(input); if (!confirmed) { confirmed = true; resolveReady(); } };
    this.acquisitionEnded = false; this.acquisitionAttempted = true;
    this.opening = this.track(DevinLocalAcpClient.open(this.scope, { signal: this.shutdown.signal, beforeCreate: () => this.guard(input) }).then(client => {
      this.client = client;
      if (this.closed) this.track(client.close());
      return client;
    }).finally(() => { this.acquisitionEnded = true; }));
    const work = (async (): Promise<CliTurnResult> => {
      try {
        const client = await this.opening!; this.guard(input);
        const { binding } = await client.beginSession({ mode: "new", profileId: this.scope.profileId, runnerId: this.scope.runnerId, nativeStoreRef: this.scope.nativeStoreRef, dispatcherSessionId: n.sessionId, workspacePath: client.connectionScope.workspacePath, executionRef: this.reference, executionSelection: n.executionSelection! }, {
          signal: this.shutdown.signal, beforeSend: () => this.guard(input),
          onBinding: async binding => {
            this.creationPossible = true; this.guard(input);
            if (!text(binding.nativeSessionId) || binding.nativeSessionId.startsWith("unstarted:")) this.reject("DEVIN_ACP_IDENTITY_CHANGED");
            nativeId = binding.nativeSessionId;
            let returned: unknown;
            try { returned = input.onBinding!(structuredClone(binding)); } catch { this.reject("DEVIN_ACP_BINDING_FAILED"); }
            await this.bounded(this.consume(returned), "DEVIN_ACP_BINDING_FAILED"); this.guard(input);
          },
        });
        this.guard(input);
        const result = await client.prompt({ binding, message: n.prompt }, {
          timeoutMs: 30_000, signal: this.shutdown.signal, beforeSend: () => this.guard(input),
          onUpdate: () => {
            this.guard(input);
            events.push({ type: "activity", summary: "Native Devin Local activity", providerSessionId: binding.nativeSessionId, executionEvidence: true }); if (events.length > 256) events.shift();
            // Client updates stay synchronous; the producer owns and bounds durable work.
            const observed = this.observe(input, { state: "running", observedAt: new Date().toISOString(), nativeSessionId: binding.nativeSessionId });
            void observed.then(confirm).catch(error => { if (!this.closed) this.observationFailureClosed = true; rejectReady(error); this.beginShutdown(); });
          },
        });
        await this.bounded(this.pipeline, "DEVIN_ACP_CALLBACK_FAILED"); this.guard(input);
        if (!confirmed) this.reject("DEVIN_ACP_ACTIVITY_UNCONFIRMED");
        const state = result.stopReason === "cancelled" ? "cancelled" : result.stopReason === "end_turn" && result.executionEvidence && !result.toolFailure && !result.permissionDenied && result.pendingTools === 0 ? "completed" : "failed";
        await this.observe(input, { state: state === "completed" ? "completed" : "failed", observedAt: new Date().toISOString(), nativeSessionId: binding.nativeSessionId });
        this.guard(input);
        return { state, summary: state === "completed" ? "Native Devin Local turn completed" : state === "cancelled" ? "Native Devin Local turn cancelled" : "Native Devin Local turn could not be confirmed", providerSessionId: binding.nativeSessionId, events };
      } catch (error) {
        if (error instanceof AdapterStartError && error.creationOutcome === "unknown") this.creationPossible = true;
        const closed = this.closed && !this.observationFailureClosed, wrapped = error instanceof AdapterStartError ? error : this.error(error instanceof AdapterContractError ? error.code : "DEVIN_ACP_START_OUTCOME_UNKNOWN");
        this.beginShutdown(); if (this.client) await this.track(this.client.close()).catch(() => {});
        if (!confirmed) { rejectReady(wrapped); throw wrapped; }
        return { state: closed ? "cancelled" : "failed", summary: closed ? "Local Devin connection cancelled" : "Native Devin Local turn could not be confirmed", ...(nativeId ? { providerSessionId: nativeId } : {}), events };
      } finally { completed = true; }
    })(); this.work = this.track(work);
    return { ready: () => ready, status: () => completed ? "completed" : "running", result: async () => structuredClone(await work), events: () => structuredClone(events), cancel: async () => { await this.disconnectLocal(); } };
  }
  beginShutdown(): void { this.closed = true; this.shutdown.abort(); }
  async disconnectLocal(): Promise<LocalRuntimeDisconnect> {
    this.beginShutdown();
    this.cleanup ??= (async () => {
      const closure = this.track((async () => {
        try { const client = this.client ?? await this.opening; return client ? await client.close() : undefined; } catch { return undefined; }
      })());
      let closeTimer: ReturnType<typeof setTimeout> | undefined, drainTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        const [receipt, drained] = await Promise.all([
          Promise.race([closure, new Promise<undefined>(resolve => { closeTimer = setTimeout(() => resolve(undefined), 2_500); })]),
          Promise.race([Promise.resolve(this.work).catch(() => {}).then(async () => { await Promise.allSettled([...this.consumers]); return true; }), new Promise<boolean>(resolve => { drainTimer = setTimeout(() => resolve(false), 500); })]),
        ]);
        return { version: 1, connection: receipt?.connection ?? (this.acquisitionAttempted ? "unknown" : "closed"), ownedRoot: receipt?.ownedRoot ?? (this.acquisitionAttempted ? "unknown" : "not-created"), callbacks: drained && this.acquisitionEnded && (receipt ? receipt.callbacks === "drained" : !this.acquisitionAttempted) ? "drained" : "unknown", backgroundTools: "unknown", nativeSessionDeleted: false, ...(receipt?.ownedRootPid === undefined ? {} : { ownedRootPid: receipt.ownedRootPid }) };
      } finally { if (closeTimer) clearTimeout(closeTimer); if (drainTimer) clearTimeout(drainTimer); }
    })();
    return structuredClone(await this.cleanup);
  }
}

export const devinLocalAcpManifest: AdapterManifest = {
  apiVersion: 1, id: "devin-local", displayName: "Devin Local ACP", platforms: ["darwin", "linux", "win32"],
  configSchema: { type: "object", additionalProperties: false, properties: { executable: { type: "string" }, dataHome: { type: "string" }, configHome: { type: "string" } }, required: ["executable", "dataHome", "configHome"] },
  uiSchema: {}, secretFields: [], probes: [], backends: [{ id: "devin-local-acp", kind: "headless-cli", priority: 10, capabilities: ["code", "git", "start", "status", "cancel", "result", "structured-events"] }],
  capabilities: { pause: false, resume: false, usage: false, diagnostics: true },
};
export class DevinLocalAcpAdapter extends StructuredCliAdapter {
  private readonly catalogScope?: Omit<DevinLocalAcpScope, "workspacePath">;
  private readonly catalogRoots?: Identity[];
  private readonly catalogProfileId: string;
  constructor(profile: CliAgentProfile, backend: CliAgentBackend, store?: SessionStore, catalogScope?: Omit<DevinLocalAcpScope, "workspacePath">) {
    if (backend.backendId !== "devin-local-acp") throw new AdapterContractError("BACKEND_MISMATCH", "Devin Local requires its owning ACP backend");
    super({ manifest: devinLocalAcpManifest, defaultExecutable: "devin", versionArgs: ["--version"], authArgs: [], supportsResume: false, supportsExecutionSelection: true, requiresNativeBinding: true, strictLifecycle: true, requireExecutionEvidence: true, startArgs: () => [] }, structuredClone(profile), backend, store);
    this.catalogProfileId = profile.id;
    if (catalogScope) {
      const captured = structuredClone(catalogScope);
      if (!profile.executable || captured.executable !== profile.executable) throw new AdapterContractError("MODEL_CONTEXT_MISMATCH", "MODEL_CONTEXT_MISMATCH");
      try { this.catalogRoots = [identity(captured.executable, false), identity(captured.dataHome, true), identity(captured.configHome, true)]; }
      catch { throw new AdapterContractError("MODEL_CONTEXT_MISMATCH", "MODEL_CONTEXT_MISMATCH"); }
      this.catalogScope = captured;
    }
  }
  override async modelCatalog(context: ModelCatalogContext & { workspacePath: string; signal?: AbortSignal }): Promise<AccountModelCatalog> {
    if (!this.catalogScope || !this.catalogRoots) return super.modelCatalog(context);
    const captured: ModelCatalogContext = { profileId: context.profileId, runnerId: context.runnerId, repositoryId: context.repositoryId, executionContextRef: context.executionContextRef, reason: context.reason };
    return readDevinLocalCatalog({ profileId: this.catalogProfileId, scope: { ...this.catalogScope, workspacePath: context.workspacePath }, context: captured, ...(context.signal ? { signal: context.signal } : {}) }, this.catalogRoots);
  }
}
