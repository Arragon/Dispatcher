import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import type { AdapterSession, AgentAdapter, SessionStore } from "@dispatcher/adapters";
import { ConfigurationEngine, repositoryRunnerId, type AgentProfileConfig, type DispatcherConfig, type RepositoryConfig } from "@dispatcher/config";
import type { AccountModelCatalog, ExecutionSelection, ModelCatalogContext } from "@dispatcher/domain";
import { redactValue } from "@dispatcher/observability";
import { DispatcherDatabase, type JsonValue } from "@dispatcher/persistence";
import { parseEnvelope, type CommandPayload, type NativeStartDescriptor, type NativeWorkspacePlan, type ProtocolEnvelope } from "@dispatcher/protocol";
import { RepositoryRegistry, WorkspaceManager, type WorkspaceHandle } from "@dispatcher/workspace";
import { RunnerLeaseAuthority, type RunnerLease } from "./lease.js";
import { remoteCommandHash } from "./remote.js";
import { VerificationRegistry, type VerificationCommand } from "./verification.js";

type ExecutionState = "PREPARING" | "PREPARED" | "STARTING" | "RUNNING" | "COMPLETE" | "FAILED" | "CANCELLED" | "OUTCOME_UNKNOWN";
interface ExecutionRecord {
  version: 1; runId: string; profileId: string; plan: NativeWorkspacePlan; planHash: string;
  registrationHash: string; state: ExecutionState; lease: RunnerLease;
  verificationCommands: VerificationCommand[]; workspace?: WorkspaceHandle;
  descriptorHash?: string; session?: AdapterSession; result?: JsonValue;
  observedUsage?: JsonValue;
  startCommandHash?: string; settledAt?: string;
}
interface OperationReceipt { identity: string; state: "PENDING" | "COMPLETE" | "UNKNOWN"; result?: JsonValue }
export class NativeRunnerError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "NativeRunnerError"; }
}
export interface NativeRunnerRuntimeOptions {
  runnerId: string; dataDirectory: string; now?: () => Date; monitorIntervalMs?: number;
  createAdapter(profile: AgentProfileConfig, store: SessionStore): AgentAdapter | undefined;
  probeProfile?(profile: AgentProfileConfig, repository?: RepositoryConfig): Promise<unknown>;
}
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => [key, canonical(value)]));
  return value;
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const terminal = (state: ExecutionState) => ["COMPLETE", "FAILED", "CANCELLED"].includes(state);
const occupies = (record: ExecutionRecord) => !record.settledAt && record.state !== "CANCELLED";

/** Owns physical execution. Transport journal retention never authorizes another native start. */
export class NativeRunnerRuntime {
  readonly database: DispatcherDatabase;
  readonly configuration: ConfigurationEngine;
  private config!: DispatcherConfig;
  private adapters = new Map<string, AgentAdapter>();
  private workspaces!: WorkspaceManager;
  private readonly records = new Map<string, ExecutionRecord>();
  private readonly attached = new Set<string>();
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly verificationAborts = new Map<string, AbortController>();
  private readonly authority = new RunnerLeaseAuthority();
  private readonly now: () => Date;
  private timer?: ReturnType<typeof setInterval>;
  private closed = false;
  private readonly writerToken = randomUUID();
  private writerClaimed = false;

  constructor(private readonly options: NativeRunnerRuntimeOptions) {
    this.now = options.now ?? (() => new Date());
    this.database = new DispatcherDatabase(join(options.dataDirectory, "native-execution.sqlite"));
    try {
      this.claimWriter();
      for (const value of this.database.listEntities<JsonValue>("native-execution")) {
        const record = value as unknown as ExecutionRecord;
        // A stored PID is evidence, never proof that this process owns a live handle.
        if (["PREPARING", "STARTING", "RUNNING"].includes(record.state)) record.state = "OUTCOME_UNKNOWN";
        this.records.set(record.runId, record);
        this.authority.issue(record.lease, this.now().toISOString());
        this.save(record);
      }
      this.configuration = new ConfigurationEngine(this.database, { apply: config => this.applyRegistrations(config) });
      this.applyRegistrations(this.configuration.current().config);
      const interval = options.monitorIntervalMs ?? 1000;
      if (interval > 0) { this.timer = setInterval(() => { void this.expireLeases().catch(() => undefined); }, interval); this.timer.unref(); }
    } catch (error) { this.releaseWriter(); this.database.close(); throw error; }
  }

  private claimWriter(): void {
    this.database.transaction(() => {
      const owner = this.database.getEntity<JsonValue>("native-writer", "owner") as { pid: number; token: string; runnerId: string } | undefined;
      if (owner && owner.runnerId !== this.options.runnerId) throw new NativeRunnerError("RUNNER_DATA_IDENTITY_MISMATCH", "This data directory belongs to another Runner");
      if (owner && owner.pid > 0) {
        let alive = true;
        try { process.kill(owner.pid, 0); } catch (error) { alive = (error as NodeJS.ErrnoException).code !== "ESRCH"; }
        if (alive) throw new NativeRunnerError("RUNNER_ALREADY_RUNNING", "Stop the owning Runner process before applying its local configuration");
      }
      // BEGIN IMMEDIATE serializes dead-owner recovery; no stale lock-file unlink race.
      this.database.saveEntity("native-writer", "owner", { pid: process.pid, token: this.writerToken, runnerId: this.options.runnerId });
    });
    this.writerClaimed = true;
  }
  private releaseWriter(): void {
    if (!this.writerClaimed) return;
    this.database.transaction(() => {
      const owner = this.database.getEntity<JsonValue>("native-writer", "owner") as { token: string } | undefined;
      if (owner?.token === this.writerToken) this.database.saveEntity("native-writer", "owner", { pid: 0, token: this.writerToken, runnerId: this.options.runnerId });
    });
    this.writerClaimed = false;
  }

  private registration(profile: AgentProfileConfig, repository: RepositoryConfig): string { return hash({ profile, repository }); }
  private applyRegistrations(config: DispatcherConfig): void {
    const profiles = config.agentProfiles.filter(profile => profile.runnerId === this.options.runnerId && profile.enabled !== false);
    for (const record of this.records.values()) {
      if (!occupies(record) && !this.verificationAborts.has(record.runId)) continue;
      const profile = profiles.find(p => p.id === record.profileId), repository = config.repositories.find(r => r.id === record.plan.repositoryId && repositoryRunnerId(config, r) === this.options.runnerId);
      if (!profile || !repository || this.registration(profile, repository) !== record.registrationHash) throw new NativeRunnerError("RUNNER_CONFIGURATION_BUSY", "An active or uncertain execution still owns this registration");
    }
    const registry = new RepositoryRegistry();
    for (const repository of config.repositories.filter(r => repositoryRunnerId(config, r) === this.options.runnerId)) registry.register(repository);
    const next = new Map<string, AgentAdapter>();
    for (const profile of profiles) {
      const previous = this.config?.agentProfiles.find(p => p.id === profile.id);
      const adapter = previous && hash(previous) === hash(profile) ? this.adapters.get(profile.id) : undefined;
      const created = adapter ?? this.options.createAdapter(profile, this.sessionStore());
      if (created) next.set(profile.id, created);
    }
    this.config = structuredClone(config);
    this.adapters = next;
    this.workspaces = new WorkspaceManager(registry, join(this.options.dataDirectory, "worktrees"));
  }

  private sessionStore(): SessionStore {
    return {
      load: id => this.database.getEntity<JsonValue>("adapter-session", id) as unknown as AdapterSession | undefined,
      save: session => {
        const record = this.records.get(session.runId);
        if (!record || record.profileId !== session.profileId || record.workspace?.path !== session.workspacePath) throw new NativeRunnerError("SESSION_AUTHORITY_MISMATCH", "Session does not belong to this execution");
        // Adapters persist STARTING after credential/config awaits, immediately before spawn.
        if (session.state === "STARTING") {
          this.authority.fence(record.runId, record.lease.leaseId, record.lease.generation, "native-spawn", this.now().toISOString());
          if (this.registration(this.profile(record.profileId).profile, this.repository(record.plan.repositoryId)) !== record.registrationHash) throw new NativeRunnerError("SELECTION_CHANGED", "Runner registration changed before native spawn");
        }
        this.database.transaction(() => {
          this.database.saveEntity("adapter-session", session.id, json(session), session.updatedAt);
          record.session = structuredClone(session); this.save(record);
        });
        if (session.state === "STARTING") this.authority.fence(record.runId, record.lease.leaseId, record.lease.generation, "native-spawn-after-persist", this.now().toISOString());
      },
    };
  }
  profileInventory(): string[] { return [...this.adapters.keys()].sort(); }
  capacity(): number { return this.config.runners.find(r => r.id === this.options.runnerId)?.capacity ?? 0; }
  registerHandlers(client: { register(type: CommandPayload["type"], handler: (payload: CommandPayload, envelope: ProtocolEnvelope<CommandPayload>) => Promise<unknown>): unknown }): void {
    const commands: CommandPayload["type"][] = ["native.repository", "native.workspace_plan", "native.workspace_prepare", "native.model_catalog", "native.profile_probe", "native.run", "native.run_verify", "native.run_files", "native.run_finalize", "run.start", "runner.reconcile", "lease.renew", "lease.revoke"];
    for (const type of commands) client.register(type, (payload, envelope) => this.handle(payload, envelope));
  }
  private profile(id: string): { profile: AgentProfileConfig; adapter: AgentAdapter } {
    const profile = this.config.agentProfiles.find(p => p.id === id && p.runnerId === this.options.runnerId && p.enabled !== false), adapter = this.adapters.get(id);
    if (!profile || !adapter) throw new NativeRunnerError("PROFILE_UNAVAILABLE", "Profile is not registered and enabled on this Runner");
    return { profile, adapter };
  }
  private repository(id: string): RepositoryConfig {
    const repository = this.config.repositories.find(r => r.id === id && repositoryRunnerId(this.config, r) === this.options.runnerId);
    if (!repository) throw new NativeRunnerError("REPOSITORY_UNAVAILABLE", "Repository is not registered on this Runner");
    return repository;
  }
  private validatePlan(profileId: string, plan: NativeWorkspacePlan): { profile: AgentProfileConfig; repository: RepositoryConfig } {
    const { profile } = this.profile(profileId), repository = this.repository(plan.repositoryId);
    this.assertScopes(repository, plan.scopePaths);
    return { profile, repository };
  }
  private assertScopes(repository: RepositoryConfig, requested: string[]): void {
    const within = (allowed: string, path: string) => allowed === "." || path === allowed || path.startsWith(`${allowed.replace(/\/$/, "")}/`);
    if (repository.scopePaths.length && (!requested.length && !repository.scopePaths.includes(".") || !requested.every(scope => repository.scopePaths.some(allowed => within(allowed, scope))))) throw new NativeRunnerError("SCOPE_NOT_REGISTERED", "Task scope exceeds the Runner registration");
  }
  private save(record: ExecutionRecord): void { this.database.saveEntity("native-execution", record.runId, json(record), this.now().toISOString()); }
  private require(runId: string): ExecutionRecord {
    const record = this.records.get(runId);
    if (!record) throw new NativeRunnerError("EXECUTION_NOT_FOUND", "No reserved execution for this Run");
    return record;
  }
  private fence(record: ExecutionRecord, envelope: ProtocolEnvelope<CommandPayload>): void {
    this.authority.fence(record.runId, envelope.leaseId ?? "", envelope.generation ?? 0, envelope.payload.type, this.now().toISOString());
  }
  private async workspace(record: ExecutionRecord): Promise<WorkspaceHandle> {
    if (!record.workspace) throw new NativeRunnerError("WORKSPACE_NOT_PREPARED", "The owning Runner has not prepared this workspace");
    await this.workspaces.restore(record.workspace);
    return record.workspace;
  }
  private serialize<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(action);
    this.locks.set(key, next);
    void next.finally(() => { if (this.locks.get(key) === next) this.locks.delete(key); }).catch(() => undefined);
    return next;
  }

  async handle(payload: CommandPayload, envelope: ProtocolEnvelope<CommandPayload>): Promise<unknown> {
    if (this.closed) throw new NativeRunnerError("RUNNER_CLOSED", "Runner is shutting down");
    if (envelope.runnerId !== this.options.runnerId) throw new NativeRunnerError("RUNNER_MISMATCH", "Command targets a different Runner");
    parseEnvelope(envelope);
    if (hash(envelope.payload) !== hash(payload)) throw new NativeRunnerError("COMMAND_IDEMPOTENCY_CONFLICT", "Envelope and command disagree");
    const mutating = payload.type === "native.workspace_prepare" || payload.type === "run.start" || payload.type === "native.run_verify" || payload.type === "native.run_finalize" || payload.type === "lease.renew" || payload.type === "lease.revoke" || payload.type === "native.run" && ["send", "pause", "resume", "cancel"].includes(payload.action);
    if (mutating) {
      const identity = remoteCommandHash(envelope), bound = this.database.getEntity<JsonValue>("native-command-binding", envelope.messageId) as { identity: string } | undefined;
      if (bound && bound.identity !== identity) throw new NativeRunnerError("COMMAND_IDEMPOTENCY_CONFLICT", "Command id is already durably bound to different content or authority");
      if (!bound) this.database.saveEntity("native-command-binding", envelope.messageId, { identity });
    }
    if (payload.type === "runner.reconcile") return this.reconcile();
    if (payload.type === "lease.renew" || payload.type === "lease.revoke") return this.updateLease(payload);
    const runId = "runId" in payload ? payload.runId : payload.type === "native.workspace_plan" ? payload.plan.runId : undefined;
    return this.serialize(runId ?? "registration-reads", async () => {
      if (payload.type === "native.repository") {
        const repository = this.repository(payload.repositoryId);
        this.assertScopes(repository, payload.scopePaths);
        return { ...await this.workspaces.inspect(payload), registeredRoot: repository.root, verificationCommands: structuredClone(repository.verificationCommands), registrationHash: hash(repository) };
      }
      if (payload.type === "native.workspace_plan") { this.validatePlan(payload.profileId, payload.plan); return this.workspaces.plan(payload.plan); }
      if (payload.type === "native.profile_probe") {
        const { profile } = this.profile(payload.profileId), repository = payload.repositoryId ? this.repository(payload.repositoryId) : undefined;
        if (!this.options.probeProfile) throw new NativeRunnerError("PROBE_UNAVAILABLE", "Native probe is unavailable");
        return redactValue(await this.options.probeProfile(profile, repository));
      }
      if (payload.type === "native.model_catalog") {
        const record = payload.runId ? this.require(payload.runId) : undefined;
        if (record) { this.fence(record, envelope); if (record.profileId !== payload.profileId || record.plan.repositoryId !== payload.repositoryId) throw new NativeRunnerError("CATALOG_CONTEXT_MISMATCH", "Catalog belongs to another execution"); }
        const catalog = await this.catalog(payload.profileId, payload.repositoryId, payload.reason, record);
        if (record) this.fence(record, envelope);
        return catalog;
      }
      if (payload.type === "native.workspace_prepare") return this.prepare(payload, envelope);
      if (payload.type === "run.start" && payload.execution) return this.start(payload.runId, payload.execution, envelope);
      if (payload.type === "native.run" || payload.type === "native.run_verify" || payload.type === "native.run_files" || payload.type === "native.run_finalize") {
        const record = this.require(payload.runId); this.fence(record, envelope);
        const receipt = this.readReceipt(envelope);
        if (receipt) return receipt.result;
        if (record.state === "OUTCOME_UNKNOWN") throw new NativeRunnerError("COMMAND_OUTCOME_UNKNOWN", "Native process ownership must be reconciled before another operation");
        if (payload.type === "native.run_finalize") {
          if (!terminal(record.state) || this.verificationAborts.has(record.runId)) throw new NativeRunnerError("EXECUTION_NOT_COMPLETE", "Native execution and verification must finish before releasing capacity");
          record.settledAt ??= this.now().toISOString(); this.save(record); return { runId: record.runId, settledAt: record.settledAt };
        }
        if (record.settledAt && (payload.type === "native.run_verify" || payload.type === "native.run" && ["send", "resume", "pause"].includes(payload.action))) throw new NativeRunnerError("EXECUTION_SETTLED", "Controller finalized this execution; it cannot accept further work");
        if (payload.type === "native.run_files") { const files = await this.workspaces.resultFiles(await this.workspace(record)); this.fence(record, envelope); return files; }
        if (payload.type === "native.run_verify") return this.operation(record, envelope, async () => {
          if (!terminal(record.state)) throw new NativeRunnerError("EXECUTION_NOT_COMPLETE", "Verification requires a finished native turn");
          const workspace = await this.workspace(record), registry = new VerificationRegistry();
          for (const command of record.verificationCommands) registry.register(command);
          const results = [], abort = new AbortController(); this.verificationAborts.set(record.runId, abort);
          try {
            for (const command of record.verificationCommands) { this.fence(record, envelope); results.push(await registry.run(command.id, workspace.path, abort.signal)); }
            this.fence(record, envelope); return redactValue(results);
          } finally { this.verificationAborts.delete(record.runId); }
        });
        const adapter = this.profile(record.profileId).adapter;
        if (!record.session) throw new NativeRunnerError("SESSION_NOT_STARTED", "Native session has not started");
        const sessionId = record.session.id;
        if (payload.action === "status") {
          if (!this.attached.has(record.runId)) return structuredClone(record.session);
          const session = await adapter.status(sessionId); this.fence(record, envelope);
          if (["COMPLETED","FAILED","CANCELLED"].includes(session.state)) {
            record.result=json(redactValue(await adapter.result(sessionId)));this.fence(record,envelope);
            try{record.observedUsage=json(redactValue(await adapter.usage?.(sessionId)??{state:"UNKNOWN",reason:"Native usage unavailable"}));}catch{record.observedUsage={state:"UNKNOWN",reason:"Native usage unavailable"};}
            this.fence(record,envelope);
          }
          this.observe(record, session); return session;
        }
        if (payload.action === "result") {
          if (record.result !== undefined) return record.result;
          if (!this.attached.has(record.runId)) throw new NativeRunnerError("COMMAND_OUTCOME_UNKNOWN", "No attached native result handle");
          const result = redactValue(await adapter.result(sessionId)); this.fence(record, envelope); record.result = json(result); this.save(record); return result;
        }
        if (payload.action === "diagnostics") return this.diagnostics(record);
        if (payload.action === "usage") { if(!this.attached.has(record.runId))return record.observedUsage??{state:"UNKNOWN",reason:"No attached native usage source"};const result = redactValue(await adapter.usage?.(sessionId) ?? { state: "UNKNOWN", reason: "Native usage unavailable" }); this.fence(record, envelope); return result; }
        if(!this.attached.has(record.runId))throw new NativeRunnerError("COMMAND_OUTCOME_UNKNOWN","No attached native process handle");
        return this.operation(record, envelope, async () => {
          if (payload.action === "send" || payload.action === "resume") {
            const selection = record.session?.executionSelection;
            if (!selection) throw new NativeRunnerError("SELECTION_CHANGED", "Native selection snapshot is unavailable");
            this.validateSelection(selection, await this.catalog(record.profileId, record.plan.repositoryId, "before-start", record)); this.fence(record, envelope);
          }
          const result = payload.action === "send" ? await adapter.send(sessionId, payload.message!) : payload.action === "pause" ? await adapter.pause(sessionId) : payload.action === "resume" ? await adapter.resume(sessionId) : await adapter.cancel(sessionId);
          this.fence(record, envelope);
          if (payload.action !== "send") this.observe(record, result as AdapterSession);
          else { record.state = "RUNNING"; delete record.result; this.save(record); }
          return redactValue(result);
        });
      }
      throw new NativeRunnerError("UNSUPPORTED_COMMAND", "Command has no owning native handler");
    });
  }

  private async catalog(profileId: string, repositoryId: string, reason: ModelCatalogContext["reason"], record?: ExecutionRecord): Promise<AccountModelCatalog> {
    const { profile, adapter } = this.profile(profileId), repository = this.repository(repositoryId), registration = this.registration(profile, repository);
    if (!adapter.modelCatalog) throw new NativeRunnerError("MODEL_CATALOG_UNSUPPORTED", "Native catalog is unavailable");
    const workspacePath = record ? (await this.workspace(record)).path : (await this.workspaces.inspect({ repositoryId, baseRef: repository.defaultBaseRef, scopePaths: repository.scopePaths })).root;
    const catalog = await adapter.modelCatalog({ profileId, runnerId: this.options.runnerId, repositoryId, executionContextRef: registration, reason, workspacePath });
    if (this.registration(this.profile(profileId).profile, this.repository(repositoryId)) !== registration) throw new NativeRunnerError("SELECTION_CHANGED", "Runner registration changed during catalog query");
    if (catalog.profileId !== profileId || catalog.runnerId !== this.options.runnerId || catalog.providerId !== profile.provider) throw new NativeRunnerError("CATALOG_CONTEXT_MISMATCH", "Native catalog does not belong to this Runner registration");
    return catalog;
  }
  private async prepare(payload: Extract<CommandPayload, { type: "native.workspace_prepare" }>, envelope: ProtocolEnvelope<CommandPayload>): Promise<WorkspaceHandle> {
    const { profile, repository } = this.validatePlan(payload.profileId, payload.plan);
    if (repository.verificationCommands.some(command => command.required && !payload.verificationCommandIds.includes(command.id))) throw new NativeRunnerError("VERIFICATION_COMMAND_REQUIRED", "Every required registered verification command must be selected");
    const verificationCommands = payload.verificationCommandIds.map(id => {
      const command = repository.verificationCommands.find(c => c.id === id);
      if (!command) throw new NativeRunnerError("VERIFICATION_COMMAND_UNAVAILABLE", "Verification command is not registered on this Runner");
      return structuredClone(command);
    });
    const planHash = hash({ profileId: payload.profileId, plan: payload.plan, verificationCommands }), previous = this.records.get(payload.runId);
    if (previous) {
      this.fence(previous, envelope);
      if (previous.planHash !== planHash) throw new NativeRunnerError("EXECUTION_CONFLICT", "Run already reserved with different workspace or commands");
      if (previous.state === "OUTCOME_UNKNOWN" || !previous.workspace) throw new NativeRunnerError("COMMAND_OUTCOME_UNKNOWN", "Workspace creation outcome must be reconciled");
      return structuredClone(await this.workspace(previous));
    }
    const capacity = this.config.runners.find(r => r.id === this.options.runnerId)?.capacity ?? 0;
    if ([...this.records.values()].filter(occupies).length >= capacity) throw new NativeRunnerError("RUNNER_CAPACITY", "Runner capacity is occupied");
    const lease: RunnerLease = { runId: payload.runId, runnerId: this.options.runnerId, leaseId: envelope.leaseId!, generation: envelope.generation!, expiresAt: envelope.leaseExpiresAt! };
    this.authority.issue(lease, this.now().toISOString()); this.authority.fence(lease.runId, lease.leaseId, lease.generation, "workspace-prepare", this.now().toISOString());
    const record: ExecutionRecord = { version: 1, runId: payload.runId, profileId: profile.id, plan: structuredClone(payload.plan), planHash, registrationHash: this.registration(profile, repository), state: "PREPARING", lease, verificationCommands };
    this.records.set(record.runId, record); this.save(record);
    try {
      const workspace = await this.workspaces.create(payload.plan, { beforeCreate: () => this.fence(record, envelope) }); record.workspace = workspace;
      this.fence(record, envelope); record.state = "PREPARED"; this.save(record); return structuredClone(workspace);
    } catch (error) { record.state = "OUTCOME_UNKNOWN"; this.save(record); throw error; }
  }
  private validateSelection(selection: ExecutionSelection, catalog: AccountModelCatalog): void {
    if (selection.profileId !== catalog.profileId || selection.runnerId !== catalog.runnerId || selection.providerId !== catalog.providerId || selection.backendId !== catalog.backendId || selection.contextFingerprint !== catalog.contextFingerprint || catalog.selectionSupport === "unsupported") throw new NativeRunnerError("SELECTION_CHANGED", "Native selection context changed");
    if (selection.selectionType === "native-default") {
      if (selection.requestedModel || Object.keys(selection.nativeParameters).length || catalog.failure) throw new NativeRunnerError("SELECTION_CHANGED", "Native defaults are unavailable in this context");
      return;
    }
    const entry = catalog.entries.find(e => e.id === selection.requestedModel);
    if (catalog.failure || catalog.freshness !== "native-fresh" || catalog.selectionSupport !== "explicit" || catalog.revision !== selection.catalogRevision || !entry?.selectable || entry.access === "denied" || selection.mode === "policy-auto" && entry.kind !== "model") throw new NativeRunnerError("SELECTION_CHANGED", "Reviewed native model is no longer available");
    for (const [key, value] of Object.entries(selection.nativeParameters)) if (!entry.parameterOptions[key]?.includes(value)) throw new NativeRunnerError("INVALID_NATIVE_PARAMETERS", "Native parameter is not supported by this model");
  }
  private async start(runId: string, execution: NativeStartDescriptor, envelope: ProtocolEnvelope<CommandPayload>): Promise<AdapterSession> {
    const record = this.require(runId); this.fence(record, envelope);
    const descriptorHash = hash(execution);
    if (record.descriptorHash && record.descriptorHash !== descriptorHash) throw new NativeRunnerError("EXECUTION_CONFLICT", "Run already reserved with a different native descriptor");
    if (record.state === "OUTCOME_UNKNOWN" || record.state === "STARTING") throw new NativeRunnerError("COMMAND_OUTCOME_UNKNOWN", "Native start outcome must be reconciled");
    if (record.descriptorHash && record.session) return structuredClone(record.session);
    if (record.state !== "PREPARED" || record.profileId !== execution.profileId) throw new NativeRunnerError("EXECUTION_CONFLICT", "Run is not prepared for this profile");
    const { profile, adapter } = this.profile(record.profileId), repository = this.repository(record.plan.repositoryId);
    if (this.registration(profile, repository) !== record.registrationHash) throw new NativeRunnerError("SELECTION_CHANGED", "Runner registration changed after preparation");
    const catalog = await this.catalog(profile.id, repository.id, "before-start", record); this.fence(record, envelope); this.validateSelection(execution.selection, catalog);
    record.state = "STARTING"; record.descriptorHash = descriptorHash; record.startCommandHash = remoteCommandHash(envelope); this.save(record);
    this.attached.add(record.runId);
    try {
      const session = await adapter.start({ runId, workspacePath: record.workspace!.path, backendId: execution.selection.backendId, prompt: execution.prompt, executionSelection: execution.selection });
      this.fence(record, envelope); record.session = session; record.state = "RUNNING"; this.save(record); return structuredClone(session);
    } catch (error) {
      if (record.session) { try { await adapter.cancel(record.session.id); } catch { /* Uncertain ownership remains fenced and visible. */ } }
      record.state = record.lease.revokedAt ? "CANCELLED" : "OUTCOME_UNKNOWN"; this.save(record); throw error;
    }
  }
  private observe(record: ExecutionRecord, session: AdapterSession): void {
    record.session = structuredClone(session);
    record.state = session.state === "COMPLETED" ? "COMPLETE" : session.state === "CANCELLED" ? "CANCELLED" : session.state === "FAILED" ? "FAILED" : "RUNNING";
    this.save(record);
  }
  private async operation(record: ExecutionRecord, envelope: ProtocolEnvelope<CommandPayload>, action: () => Promise<unknown>): Promise<unknown> {
    const identity = remoteCommandHash(envelope), id = envelope.messageId, previous = this.readReceipt(envelope);
    if (previous) return previous.result;
    this.database.saveEntity("native-operation", id, json({ identity, state: "PENDING" }));
    if (envelope.payload.type === "native.run" && ["send", "resume"].includes(envelope.payload.action)) {
      record.state = "STARTING"; delete record.result; this.save(record);
    }
    try {
      const result = json(await action());
      this.database.saveEntity("native-operation", id, json({ identity, state: "COMPLETE", result })); return result;
    } catch (error) {
      this.database.saveEntity("native-operation", id, json({ identity, state: "UNKNOWN" }));
      if (envelope.payload.type === "native.run" && ["send", "resume"].includes(envelope.payload.action)) { record.state = "OUTCOME_UNKNOWN"; this.save(record); }
      throw error;
    }
  }
  private readReceipt(envelope: ProtocolEnvelope<CommandPayload>): OperationReceipt | undefined {
    const previous = this.database.getEntity<JsonValue>("native-operation", envelope.messageId) as unknown as OperationReceipt | undefined;
    if (!previous) return;
    if (previous.identity !== remoteCommandHash(envelope)) throw new NativeRunnerError("COMMAND_IDEMPOTENCY_CONFLICT", "Operation id is already bound to different content or authority");
    if (previous.state !== "COMPLETE") throw new NativeRunnerError("COMMAND_OUTCOME_UNKNOWN", "Operation may have executed; automatic repetition is unsafe");
    return previous;
  }
  private async updateLease(payload: Extract<CommandPayload, { type: "lease.renew" | "lease.revoke" }>): Promise<RunnerLease> {
    const record = [...this.records.values()].find(r => r.lease.leaseId === payload.leaseId);
    if (!record) throw new NativeRunnerError("LEASE_MISSING", "No execution owns this lease");
    record.lease = payload.type === "lease.renew" ? this.authority.renew(record.runId, payload.leaseId, payload.generation, payload.expiresAt, this.now().toISOString()) : this.authority.revoke(record.runId, payload.leaseId, payload.generation, payload.reason, this.now().toISOString());
    this.save(record);
    if (payload.type === "lease.revoke") await this.stopOwned(record);
    return structuredClone(record.lease);
  }
  private async stopOwned(record: ExecutionRecord): Promise<void> {
    this.verificationAborts.get(record.runId)?.abort();
    if (record.settledAt) return;
    if (record.state === "PREPARED" && !record.session) { record.state = "CANCELLED"; record.settledAt = this.now().toISOString(); this.save(record); return; }
    if (!this.attached.has(record.runId) || !record.session) return;
    try { const session = await this.profile(record.profileId).adapter.cancel(record.session.id); this.observe(record, session); }
    catch { record.state = "OUTCOME_UNKNOWN"; this.save(record); }
  }
  async expireLeases(): Promise<void> {
    for (const record of this.records.values()) {
      if (Date.parse(record.lease.expiresAt) > this.now().getTime() && !record.lease.revokedAt) continue;
      if (!occupies(record) && !this.verificationAborts.has(record.runId)) continue;
      if (!record.lease.revokedAt) { record.lease = this.authority.revoke(record.runId, record.lease.leaseId, record.lease.generation, "lease expired", this.now().toISOString()); this.save(record); }
      await this.stopOwned(record);
    }
  }
  private diagnostics(record: ExecutionRecord): unknown {
    return { runnerId: this.options.runnerId, runId: record.runId, profileId: record.profileId, state: record.state, attached: this.attached.has(record.runId), sessionId: record.session?.id, providerSessionId: record.session?.providerSessionId, processId: record.session?.processId, workspace: record.workspace?.path, generation: record.lease.generation, leaseId: record.lease.leaseId, lease: structuredClone(record.lease), startCommandHash: record.startCommandHash, settledAt: record.settledAt, resultAvailable:record.result!==undefined };
  }
  reconcile(): unknown { return { runnerId: this.options.runnerId, runs: [...this.records.values()].map(record => this.diagnostics(record)) }; }
  async shutdown(): Promise<void> {
    if (this.closed) return;
    for (const record of this.records.values()) {
      if (!occupies(record) && !this.verificationAborts.has(record.runId)) continue;
      if (!record.lease.revokedAt) { record.lease = this.authority.revoke(record.runId, record.lease.leaseId, record.lease.generation, "runner shutdown", this.now().toISOString()); this.save(record); }
      await this.stopOwned(record);
    }
    await Promise.allSettled([...this.locks.values()]); this.close();
  }
  /** Closes storage after shutdown, or simulates abrupt process loss in recovery tests. */
  close(): void { if (this.closed) return; this.closed = true; if (this.timer) clearInterval(this.timer); this.releaseWriter(); this.database.close(); }
}
