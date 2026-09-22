import { existsSync, statSync } from "node:fs";
import { PassThrough } from "node:stream";
import { randomUUID } from "node:crypto";
import { arch, platform } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import {
  CodexAdapter,
  codexManifest,
  genericCliManifest,
  genericMockManifest,
  probeCodexProfile,
  type AdapterSession,
  type SessionStore,
  type CodexBackend,
  type CodexProfileConfig,
} from "@dispatcher/adapters";
import {
  assertRequiredSecretsAvailable,
  ConfigurationEngine,
  ConfigPlanError,
  ConfigValidationError,
  createDefaultSecretStore,
  dispatcherConfigSchema,
  dispatcherConfigUiSchema,
  requiredSecretReferences,
  SecretStoreError,
  type SecretMetadata,
  type SecretStore,
  type DispatcherConfig,
} from "@dispatcher/config";
import {
  RESOURCE_STATES,
  assertRunTransition,
  type ExternalBinding,
  type ResourceSnapshot,
  type ResourceState,
  type Run,
  type Runner,
  type Task,
  type TaskContract,
} from "@dispatcher/domain";
import {
  CanonicalTaskService,
  ConnectorError,
  ConnectorRegistry,
  DeliveryService,
  GitHubScmConnector,
  LinearTaskConnector,
  LocalGitTransport,
  ProjectionWorker,
  type ExternalEvent,
  type GitTransport,
  type ScmAdapter,
  type TaskDraft,
  type TaskFieldMapping,
  type TaskPlatformAdapter,
} from "@dispatcher/integrations";
import { LlmRuntime, LlmRuntimeError, type FetchLike, type LlmConfiguration, type LlmRole } from "@dispatcher/llm-runtime";
import { createLogger, redactValue } from "@dispatcher/observability";
import { DispatcherDatabase, RevisionConflictError, type JsonValue } from "@dispatcher/persistence";
import { EmbeddedRunner, EventBus, RunnerRegistry, VerificationRegistry, type RunnerEvents } from "@dispatcher/runner";
import { TaskContractCompiler } from "@dispatcher/semantic";
import { CanonicalScheduler } from "@dispatcher/scheduler";
import { RepositoryRegistry, WorkspaceManager, WorkspacePolicyError } from "@dispatcher/workspace";
import { LifecycleManager, type ServiceModule } from "./lifecycle.js";

export interface ControllerOptions {
  dataDirectory: string;
  withRunner?: boolean;
  host?: string;
  port?: number;
  webRoot?: string;
  secretStore?: SecretStore;
  llmFetch?: FetchLike;
  integrationFetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  gitTransport?: GitTransport;
  codexBackendFactory?: (profile: CodexProfileConfig) => CodexBackend;
  modules?: ServiceModule[];
}

class DatabaseSessionStore implements SessionStore {
  constructor(private readonly database: DispatcherDatabase) {}
  load(id: string): AdapterSession | undefined {
    const value = this.database.getEntity<JsonValue>("adapter-session", id);
    return value as unknown as AdapterSession | undefined;
  }
  save(session: AdapterSession): void {
    this.database.saveEntity("adapter-session", session.id, JSON.parse(JSON.stringify(session)) as JsonValue, session.updatedAt);
  }
}

function stringSetting(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringMapSetting(value: JsonValue | undefined): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return Object.fromEntries(entries);
}

interface SecretBody {
  value?: string;
}

interface ConfigPlanBody {
  config?: unknown;
  actor?: string;
}

interface ApplyPlanBody {
  confirmed?: boolean;
}

interface WizardBody {
  step?: number;
  completed?: boolean;
  configRevision?: number;
}

interface LlmConfigBody {
  config?: DispatcherConfig["internalLlm"];
  actor?: string;
  confirmed?: boolean;
}

interface LlmSwitchBody {
  profileId?: string;
}

interface SecretTestState {
  lastTestedAt: string;
  lastTestStatus: "ok" | "failed";
}

interface CodexProfileBody {
  id?: string;
  alias?: string;
  runnerId?: string;
  codexHome?: string;
  executable?: string;
  model?: string;
}

interface CodexRunBody {
  prompt?: string;
  workspacePath?: string;
}

interface TaskDispatchBody {
  profileId?: string;
  repositoryId?: string;
  baseRef?: string;
}

function json(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function taskStateForDraft(draft: TaskDraft, compiledState: "READY" | "NEEDS_SPEC"): "BACKLOG" | "READY" | "NEEDS_SPEC" {
  if (compiledState === "NEEDS_SPEC") return compiledState;
  if (!draft.status) return "READY";
  return ["ready", "todo", "to do"].includes(draft.status.trim().toLocaleLowerCase()) ? "READY" : "BACKLOG";
}

function llmConfiguration(config: DispatcherConfig["internalLlm"]): LlmConfiguration {
  return {
    endpoints: structuredClone(config.endpoints),
    profiles: structuredClone(config.profiles),
    pools: structuredClone(config.pools),
    roleBindings: structuredClone(config.roleBindings),
    ...(config.defaultPoolId ? { defaultPoolId: config.defaultPoolId } : {}),
  };
}

export class ControllerService {
  readonly app: FastifyInstance;
  readonly database: DispatcherDatabase;
  readonly configuration: ConfigurationEngine;
  readonly runners: RunnerRegistry;
  readonly events: EventBus<RunnerEvents>;
  readonly lifecycle: LifecycleManager;
  readonly secrets: SecretStore;
  readonly llm: LlmRuntime;
  readonly repositories = new RepositoryRegistry();
  readonly workspaces: WorkspaceManager;
  readonly connectors = new ConnectorRegistry();
  readonly tasks: CanonicalTaskService;
  readonly projections: ProjectionWorker;
  private readonly taskCompiler = new TaskContractCompiler();
  private readonly codexAdapters = new Map<string, CodexAdapter>();
  private readonly rawWebhookBodies = new WeakMap<object, Uint8Array>();
  private readonly startedAt = Date.now();
  private readonly embeddedRunner?: EmbeddedRunner;
  private listening = false;
  private stopping?: Promise<void>;
  private dashboardClients = 0;
  private readonly secretTestStates = new Map<string, SecretTestState>();

  constructor(readonly options: ControllerOptions) {
    const logger = createLogger({ level: process.env.LOG_LEVEL ?? "info" });
    this.app = fastify({ loggerInstance: logger as unknown as FastifyBaseLogger });
    this.database = new DispatcherDatabase(join(options.dataDirectory, "dispatcher.sqlite"));
    this.workspaces = new WorkspaceManager(this.repositories, join(options.dataDirectory, "worktrees"));
    this.tasks = new CanonicalTaskService(this.database);
    this.projections = new ProjectionWorker(this.database, this.connectors);
    this.secrets = options.secretStore ?? createDefaultSecretStore({ dataDirectory: options.dataDirectory });
    this.llm = new LlmRuntime(this.database, (reference) => this.secrets.resolve(reference, { principal: "controller", purpose: "llm" }), options.llmFetch);
    this.configuration = new ConfigurationEngine(this.database, { apply: (config) => this.applyRuntimeConfiguration(config) });
    this.applyRuntimeConfiguration(this.configuration.current().config);
    this.events = new EventBus<RunnerEvents>(1_000, (error, topic) => {
      logger.error({ error: redactValue(error), topic }, "event handler failed");
    });
    this.runners = new RunnerRegistry((runner) => {
      this.database.saveEntity("runner", runner.id, json(runner));
    });
    for (const runner of this.database.listEntities<JsonValue>("runner")) {
      this.runners.register(runner as unknown as Runner);
    }
    this.events.subscribe("runnerChanged", async (runner) => {
      this.database.saveEntity("runner", runner.id, json(runner));
    });
    const modules: ServiceModule[] = [];
    if (options.withRunner) {
      const configured = this.configuration.current().config.runners.find((runner) => runner.mode === "embedded");
      const now = new Date().toISOString();
      const runner: Runner = {
        id: configured?.id ?? "local",
        displayName: configured?.displayName ?? "Local Runner",
        platform: platform() as Runner["platform"],
        architecture: arch(),
        state: "OFFLINE",
        capabilities: ["embedded", "process"],
        capacity: configured?.capacity ?? 1,
        lastSeenAt: now,
      };
      this.embeddedRunner = new EmbeddedRunner(runner, this.runners, this.events);
      modules.push({ name: "embedded-runner", start: () => this.embeddedRunner?.start(), stop: () => this.embeddedRunner?.stop() });
    }
    modules.push(...(options.modules ?? []));
    this.lifecycle = new LifecycleManager(modules);
    this.registerRoutes();
  }

  async start(input: { listen?: boolean } = {}): Promise<void> {
    await this.lifecycle.start();
    try {
      await this.app.ready();
      if (input.listen !== false) {
        await this.app.listen({ host: this.options.host ?? "127.0.0.1", port: this.options.port ?? 8347 });
        this.listening = true;
      }
    } catch (error) {
      await this.lifecycle.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopping = (async () => {
      await this.lifecycle.stop();
      if (this.listening) await this.app.close();
      else await this.app.close();
      this.events.close();
      this.database.checkpoint();
      this.database.close();
      this.listening = false;
    })();
    return this.stopping;
  }

  private applyRuntimeConfiguration(config: DispatcherConfig): void {
    this.llm.configure(llmConfiguration(config.internalLlm));
    this.repositories.clear();
    for (const repository of config.repositories) {
      this.repositories.register({
        id: repository.id,
        root: repository.root,
        ...(repository.remote ? { remote: repository.remote } : {}),
      });
    }
    const nextConnectorIds = new Set(config.connectors.filter((connector) => connector.enabled).map((connector) => connector.id));
    for (const existing of this.connectors.list()) {
      if (!nextConnectorIds.has(existing.instance.id)) this.database.deleteConnectorInstance(existing.instance.id);
    }
    this.connectors.clear();
    for (const configured of config.connectors.filter((connector) => connector.enabled)) {
      const instance = {
        id: configured.id,
        definitionId: configured.definitionId,
        kind: configured.kind,
        displayName: configured.displayName,
        enabled: configured.enabled,
        ...(configured.credentialRef ? { credentialRef: configured.credentialRef } : {}),
        health: "DEGRADED" as const,
        revision: 1,
        updatedAt: new Date().toISOString(),
      };
      if (configured.definitionId === "task.linear") {
        const webhookSecretRef = stringSetting(configured.settings?.webhookSecretRef);
        if (!configured.credentialRef || !webhookSecretRef) throw new Error(`Linear connector ${configured.id} is missing credential references`);
        this.connectors.register(new LinearTaskConnector({
          instance,
          credentialRef: configured.credentialRef,
          webhookSecretRef,
          resolveSecret: (reference) => this.secrets.resolve(reference, { principal: "controller", purpose: "integration" }),
          ...(this.options.integrationFetch ? { fetch: this.options.integrationFetch } : {}),
          ...(stringSetting(configured.settings?.endpoint) ? { endpoint: stringSetting(configured.settings?.endpoint)! } : {}),
          ...(stringSetting(configured.settings?.repository) ? { repository: stringSetting(configured.settings?.repository)! } : {}),
          ...(stringMapSetting(configured.settings?.statusIds) ? { statusIds: stringMapSetting(configured.settings?.statusIds)! } : {}),
        }));
      } else if (configured.definitionId === "scm.github") {
        if (!configured.credentialRef) throw new Error(`GitHub connector ${configured.id} is missing a credential reference`);
        this.connectors.register(new GitHubScmConnector({
          instance,
          credentialRef: configured.credentialRef,
          resolveSecret: (reference) => this.secrets.resolve(reference, { principal: "controller", purpose: "integration" }),
          transport: this.options.gitTransport ?? new LocalGitTransport(),
          ...(this.options.integrationFetch ? { fetch: this.options.integrationFetch } : {}),
          ...(stringSetting(configured.settings?.apiBase) ? { apiBase: stringSetting(configured.settings?.apiBase)! } : {}),
        }));
      }
      this.database.saveConnectorInstance({
        id: instance.id,
        definitionId: instance.definitionId,
        kind: instance.kind,
        revision: instance.revision,
        document: json(instance),
        updatedAt: instance.updatedAt,
      });
    }

    this.codexAdapters.clear();
    const store = new DatabaseSessionStore(this.database);
    for (const profile of config.agentProfiles.filter((entry) => entry.provider === "codex")) {
      const codexHome = stringSetting(profile.settings?.codexHome);
      if (!codexHome) continue;
      const adapterProfile: CodexProfileConfig = {
        id: profile.id,
        alias: profile.alias,
        codexHome,
        ...(stringSetting(profile.settings?.executable) ? { executable: stringSetting(profile.settings?.executable)! } : {}),
        ...(stringSetting(profile.settings?.model) ? { model: stringSetting(profile.settings?.model)! } : {}),
      };
      this.codexAdapters.set(profile.id, new CodexAdapter(adapterProfile, this.options.codexBackendFactory?.(adapterProfile), store));
    }
  }

  private async processExternalTaskEvent(adapter: TaskPlatformAdapter, event: ExternalEvent): Promise<{ task: Task; revision: number; duplicate: boolean }> {
    const existingBinding = this.database.findExternalBinding<JsonValue>(event.connectorInstanceId, "task", event.externalEntityId) as unknown as ExternalBinding | undefined;
    if (existingBinding && event.externalRevision && existingBinding.externalRevision === event.externalRevision && existingBinding.projectionState === "SYNCED") {
      const inserted = this.tasks.ingest(event);
      if (inserted) this.database.markInboxEvent(event.id, "PROCESSED");
      const existing = this.database.getCanonicalTask<JsonValue>(existingBinding.canonicalEntityId);
      if (!existing) throw new Error("External binding points to a missing canonical task");
      return { task: existing.document as unknown as Task, revision: existing.revision, duplicate: true };
    }
    const draft = await adapter.getTask(event.externalEntityId);
    const compiled = this.taskCompiler.compile(draft);
    const desiredState = taskStateForDraft(draft, compiled.state);
    const taskId = existingBinding?.canonicalEntityId ?? randomUUID();
    const binding: ExternalBinding = {
      ...(existingBinding ?? {
        id: `${event.connectorInstanceId}:${event.externalEntityId}`,
        canonicalEntityId: taskId,
        connectorInstanceId: event.connectorInstanceId,
        entityType: "task" as const,
        externalId: event.externalEntityId,
      }),
      ...(event.externalRevision ? { externalRevision: event.externalRevision } : {}),
      projectionState: "SYNCED",
      platformExtensions: structuredClone(draft.extensions),
      updatedAt: new Date().toISOString(),
    };
    const current = this.database.getCanonicalTask<JsonValue>(taskId);
    const currentTask = current?.document as unknown as Task | undefined;
    const synchronizedState = currentTask && desiredState !== currentTask.state
      && ((currentTask.state === "NEEDS_SPEC" && desiredState === "READY") || currentTask.state === "BACKLOG")
      ? desiredState
      : undefined;
    const mapping: TaskFieldMapping = {
      ownership: { title: "external", description: "external", status: "external", priority: "external", assignee: "external", labels: "external" },
      statuses: {}, priorities: {}, users: {},
    };
    const outcome = current
      ? this.tasks.applyExternalEvent(event, {
          id: `sync:${event.idempotencyKey}`,
          taskId,
          baseRevision: current.revision,
          actor: `connector:${event.connectorInstanceId}`,
          sourceBinding: binding,
          command: {
            type: "task.update",
            changes: {
              title: draft.title,
              ...(draft.description ? { description: draft.description } : {}),
              ...(draft.priority === undefined ? {} : { priority: draft.priority }),
              ...(draft.assignee ? { assignee: draft.assignee } : {}),
              labels: [...draft.labels],
              ...(synchronizedState ? { state: synchronizedState } : {}),
              platformExtensions: structuredClone(draft.extensions),
            },
          },
        }, mapping)
      : this.tasks.applyExternalEvent(event, {
          id: `create:${event.idempotencyKey}`,
          taskId,
          baseRevision: 0,
          actor: `connector:${event.connectorInstanceId}`,
          sourceBinding: binding,
          command: {
            type: "task.create",
            task: {
              id: taskId,
              projectId: this.projectId(draft),
              title: draft.title,
              ...(draft.description ? { description: draft.description } : {}),
              state: desiredState,
              ...(draft.priority === undefined ? {} : { priority: draft.priority }),
              ...(draft.assignee ? { assignee: draft.assignee } : {}),
              labels: [...draft.labels],
              origin: { source: "connector", connectorInstanceId: event.connectorInstanceId, externalEventId: event.externalEventId },
              bindings: [binding],
              platformExtensions: structuredClone(draft.extensions),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            bindings: [binding],
          },
        }, mapping);
    if (compiled.contract) this.database.saveTaskContract(taskId, json(compiled.contract));
    return outcome;
  }

  private projectId(draft: TaskDraft): string {
    const linear = draft.extensions.linear;
    if (linear && typeof linear === "object" && !Array.isArray(linear)) {
      const value = linear as Record<string, unknown>;
      if (typeof value.projectId === "string") return value.projectId;
    }
    return "external";
  }

  private profileResourceState(profileId: string): ResourceState {
    const snapshot = this.database.getEntity<JsonValue>("resource-snapshot", profileId) as unknown as ResourceSnapshot | undefined;
    return snapshot?.state ?? "AVAILABLE";
  }

  private async captureProfileResource(profileId: string, adapter: CodexAdapter, sessionId: string): Promise<ResourceSnapshot | undefined> {
    const usage = await adapter.usage(sessionId);
    const state = typeof usage.state === "string" && RESOURCE_STATES.includes(usage.state as ResourceState)
      ? usage.state as ResourceState
      : undefined;
    if (!state || state === "UNKNOWN") return undefined;
    const snapshot: ResourceSnapshot = {
      profileId,
      state,
      ...(typeof usage.reason === "string" ? { reason: usage.reason } : {}),
      ...(typeof usage.resetsAt === "string" ? { resetsAt: usage.resetsAt } : {}),
      source: usage.source === "error" ? "error" : "session",
      confidence: usage.confidence === "high" || usage.confidence === "medium" ? usage.confidence : "low",
      checkedAt: new Date().toISOString(),
    };
    this.database.saveEntity("resource-snapshot", profileId, json(snapshot));
    return snapshot;
  }

  private async advanceRun(runId: string): Promise<{ waiting: boolean; run: Run; task: Task; deliveries: JsonValue[] }> {
    const storedRun = this.database.getEntity<JsonValue>("run", runId);
    if (!storedRun) throw new ConnectorError("PERMANENT", `Unknown run ${runId}`);
    const run = storedRun as unknown as Run;
    const storedTask = this.database.getCanonicalTask<JsonValue>(run.taskId);
    const contract = this.database.getTaskContract<JsonValue>(run.taskId) as unknown as TaskContract | undefined;
    if (!storedTask || !contract) throw new ConnectorError("PERMANENT", `Run ${runId} has no canonical task contract`);
    if (run.state === "COMPLETE") {
      return { waiting: false, run, task: storedTask.document as unknown as Task, deliveries: this.database.listDeliveryEvidence<JsonValue>(run.taskId) };
    }

    if (run.state === "ACTIVE") {
      const adapter = this.codexAdapters.get(run.profileId);
      if (!adapter) throw new ConnectorError("PERMANENT", `Profile ${run.profileId} is unavailable`);
      const session = await adapter.status(run.sessionId);
      if (session.state === "RUNNING" || session.state === "STARTING") {
        return { waiting: true, run, task: storedTask.document as unknown as Task, deliveries: [] };
      }
      if (session.state === "PAUSED") {
        assertRunTransition(run.state, "WAITING_USER");
        run.state = "WAITING_USER";
        run.activitySummary = "Waiting for user input";
        run.lastActivityAt = new Date().toISOString();
        this.database.saveEntity("run", run.id, json(run));
        const current = this.database.getCanonicalTask<JsonValue>(run.taskId)!;
        if ((current.document as unknown as Task).state === "RUNNING") {
          this.tasks.execute({ id: `run:${run.id}:waiting-user`, taskId: run.taskId, baseRevision: current.revision, actor: "run-worker", command: { type: "task.transition", state: "WAITING_USER" } });
        }
        return { waiting: true, run, task: this.database.getCanonicalTask<JsonValue>(run.taskId)!.document as unknown as Task, deliveries: [] };
      }
      const resource = await this.captureProfileResource(run.profileId, adapter, run.sessionId);
      if (resource) {
        assertRunTransition(run.state, "RESOURCE_BLOCKED");
        run.state = "RESOURCE_BLOCKED";
        run.resourceBlockReason = resource.reason ?? resource.state;
        this.database.saveEntity("run", run.id, json(run));
        const current = this.database.getCanonicalTask<JsonValue>(run.taskId)!;
        if ((current.document as unknown as Task).state === "RUNNING") {
          this.tasks.execute({ id: `run:${run.id}:resource-blocked`, taskId: run.taskId, baseRevision: current.revision, actor: "run-worker", command: { type: "task.transition", state: "WAITING_RESOURCE" } });
        }
        return { waiting: true, run, task: this.database.getCanonicalTask<JsonValue>(run.taskId)!.document as unknown as Task, deliveries: [] };
      }
      if (session.state !== "COMPLETED") {
        assertRunTransition(run.state, "FAILED");
        run.state = "FAILED";
        run.failureReason = `Agent session ${session.state.toLowerCase()}`;
        run.endedAt = new Date().toISOString();
        this.database.saveEntity("run", run.id, json(run));
        const current = this.database.getCanonicalTask<JsonValue>(run.taskId)!;
        if ((current.document as unknown as Task).state === "RUNNING") {
          this.tasks.execute({ id: `run:${run.id}:failed`, taskId: run.taskId, baseRevision: current.revision, actor: "run-worker", command: { type: "task.transition", state: "FAILED" } });
        }
        return { waiting: false, run, task: this.database.getCanonicalTask<JsonValue>(run.taskId)!.document as unknown as Task, deliveries: [] };
      }
      const result = await adapter.result(run.sessionId);
      assertRunTransition(run.state, "VERIFYING");
      run.state = "VERIFYING";
      run.activitySummary = result.summary;
      run.lastActivityAt = new Date().toISOString();
      this.database.saveEntity("run", run.id, json(run));
      const current = this.database.getCanonicalTask<JsonValue>(run.taskId)!;
      if ((current.document as unknown as Task).state === "RUNNING") {
        this.tasks.execute({ id: `run:${run.id}:verifying`, taskId: run.taskId, baseRevision: current.revision, actor: "run-worker", command: { type: "task.transition", state: "VERIFYING" } });
      }
    }

    if (run.state === "RESOURCE_BLOCKED" || run.state === "WAITING_USER") {
      return { waiting: true, run, task: storedTask.document as unknown as Task, deliveries: [] };
    }

    if (run.state === "VERIFYING") {
      const repositoryId = contract.delivery.repository;
      const repository = this.configuration.current().config.repositories.find((entry) => entry.id === repositoryId);
      if (!repository || !run.worktree) throw new ConnectorError("PERMANENT", "Run repository or worktree is unavailable");
      const verification = new VerificationRegistry();
      for (const command of repository.verificationCommands) verification.register(command);
      const summaries: string[] = [];
      let blocked = false;
      for (const commandId of contract.verification) {
        try {
          const result = await verification.run(commandId, run.worktree);
          summaries.push(`${commandId}:${result.status}`);
          if (result.required && result.status !== "passed") blocked = true;
        } catch {
          summaries.push(`${commandId}:unregistered`);
          blocked = true;
        }
      }
      run.verification = { state: blocked ? "FAILED" : "PASSED", commands: [...contract.verification], summary: summaries.join(", ") };
      if (blocked) {
        assertRunTransition(run.state, "FAILED");
        run.state = "FAILED";
        run.failureReason = "Required verification failed";
        run.endedAt = new Date().toISOString();
        this.database.saveEntity("run", run.id, json(run));
        const current = this.database.getCanonicalTask<JsonValue>(run.taskId)!;
        if ((current.document as unknown as Task).state === "VERIFYING") {
          this.tasks.execute({ id: `run:${run.id}:verification-failed`, taskId: run.taskId, baseRevision: current.revision, actor: "run-worker", command: { type: "task.transition", state: "FAILED" } });
        }
        return { waiting: false, run, task: this.database.getCanonicalTask<JsonValue>(run.taskId)!.document as unknown as Task, deliveries: [] };
      }
      assertRunTransition(run.state, "DELIVERING");
      run.state = "DELIVERING";
      this.database.saveEntity("run", run.id, json(run));
    }

    if (run.state !== "DELIVERING" || !run.worktree || !run.branch) throw new ConnectorError("CONFLICT", `Run ${run.id} is not ready for delivery`);
    const repositoryId = contract.delivery.repository;
    const repositoryParts = repositoryId?.split("/") ?? [];
    if (repositoryParts.length !== 2) throw new ConnectorError("PERMANENT", "GitHub delivery repository must use owner/name");
    const scm = this.connectors.list().find((connector) => connector.instance.kind === "scm" && connector.definition.id === "scm.github") as ScmAdapter | undefined;
    if (!scm) throw new ConnectorError("PERMANENT", "A GitHub connector is required for delivery");
    const delivery = await new DeliveryService(this.database).deliver(scm, {
      idempotencyKey: `delivery:${run.id}:${run.generation}`,
      taskId: run.taskId,
      run,
      currentGeneration: run.generation,
      currentLeaseId: run.leaseId,
      repository: { owner: repositoryParts[0]!, name: repositoryParts[1]!, localPath: run.worktree },
      headBranch: run.branch,
      baseBranch: contract.delivery.baseBranch ?? "main",
      title: contract.goal,
      body: `Verified by Agent Dispatcher run ${run.id}.`,
      verification: run.verification,
    });
    const pullRequest = delivery.evidence.find((entry) => entry.kind === "pull-request");
    assertRunTransition(run.state, "COMPLETE");
    run.state = "COMPLETE";
    run.endedAt = new Date().toISOString();
    if (pullRequest?.url) run.prUrl = pullRequest.url;
    this.database.saveEntity("run", run.id, json(run));
    let current = this.database.getCanonicalTask<JsonValue>(run.taskId)!;
    if ((current.document as unknown as Task).state === "VERIFYING") {
      this.tasks.execute({ id: `run:${run.id}:review`, taskId: run.taskId, baseRevision: current.revision, actor: "run-worker", command: { type: "task.transition", state: "REVIEW" } });
      current = this.database.getCanonicalTask<JsonValue>(run.taskId)!;
    }
    if (pullRequest?.url) {
      this.tasks.execute({ id: `run:${run.id}:delivery-comment`, taskId: run.taskId, baseRevision: current.revision, actor: "run-worker", command: { type: "task.comment", body: `Pull request ready: ${pullRequest.url}` } });
    }
    await this.projections.drain();
    return {
      waiting: false,
      run,
      task: this.database.getCanonicalTask<JsonValue>(run.taskId)!.document as unknown as Task,
      deliveries: this.database.listDeliveryEvidence<JsonValue>(run.taskId),
    };
  }

  private registerRoutes(): void {
    this.app.addHook("preParsing", async (request, _reply, payload) => {
      if (!request.url.startsWith("/api/connectors/") || !request.url.endsWith("/webhook")) return payload;
      const chunks: Buffer[] = [];
      const copy = new PassThrough();
      payload.on("data", (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      payload.on("end", () => this.rawWebhookBodies.set(request, Buffer.concat(chunks)));
      payload.pipe(copy);
      return copy;
    });

    this.app.get("/health", async () => ({
      status: this.lifecycle.state === "READY" && (!this.configuration.current().config.internalLlm.configured || this.llm.snapshot().state.mode === "ACTIVE")
        ? "ok"
        : this.lifecycle.state === "READY" || this.lifecycle.state === "DEGRADED"
          ? "degraded"
          : "starting",
      lifecycle: this.lifecycle.state,
      version: "0.1.0",
      mode: this.options.withRunner ? "embedded" : "controller",
      uptimeMs: Date.now() - this.startedAt,
    }));

    this.app.get("/ready", async (_request, reply) => {
      const ready = this.lifecycle.state === "READY" || this.lifecycle.state === "DEGRADED";
      return reply.code(ready ? 200 : 503).send({ ready, lifecycle: this.lifecycle.state });
    });

    this.app.get("/api/runners", async () => ({ runners: this.runners.list() }));
    this.app.get("/api/adapters/manifests", async () => ({ manifests: [genericMockManifest, genericCliManifest, codexManifest] }));
    this.app.get("/api/agents/profiles", async () => ({
      profiles: this.configuration.current().config.agentProfiles.map((profile) => ({
        id: profile.id,
        provider: profile.provider,
        alias: profile.alias,
        runnerId: profile.runnerId,
        state: this.codexAdapters.has(profile.id) ? "CONFIGURED" : "UNAVAILABLE",
        resourceState: this.profileResourceState(profile.id),
      })),
      sessions: this.database.listEntities<JsonValue>("adapter-session").map((value) => {
        const session = value as Record<string, JsonValue>;
        return { id: session.id, runId: session.runId, profileId: session.profileId, state: session.state, updatedAt: session.updatedAt };
      }),
    }));
    this.app.post<{ Body: CodexProfileBody }>("/api/agents/codex/discover", async (request, reply) => {
      if (!request.body?.codexHome || !request.body.alias) return reply.code(400).send({ code: "CODEX_PROFILE_REQUIRED" });
      return probeCodexProfile({
        id: request.body.id ?? "discovered-codex",
        alias: request.body.alias,
        codexHome: request.body.codexHome,
        ...(request.body.executable ? { executable: request.body.executable } : {}),
        ...(request.body.model ? { model: request.body.model } : {}),
      });
    });
    this.app.post<{ Body: CodexProfileBody }>("/api/agents/codex/profiles", async (request, reply) => {
      const body = request.body;
      if (!body?.id || !body.alias || !body.codexHome) return reply.code(400).send({ code: "CODEX_PROFILE_REQUIRED" });
      const current = this.configuration.current();
      if (current.config.agentProfiles.some((profile) => profile.id === body.id)) return reply.code(409).send({ code: "PROFILE_EXISTS" });
      const next = structuredClone(current.config);
      next.agentProfiles.push({
        id: body.id,
        provider: "codex",
        alias: body.alias,
        runnerId: body.runnerId ?? "local",
        settings: {
          codexHome: body.codexHome,
          ...(body.executable ? { executable: body.executable } : {}),
          ...(body.model ? { model: body.model } : {}),
        },
      });
      const plan = this.configuration.buildPlan(next, "local-web", "web");
      const applied = this.configuration.applyPlan(plan.id, { confirmed: true });
      return reply.code(201).send({ profile: { id: body.id, provider: "codex", alias: body.alias, runnerId: body.runnerId ?? "local", state: "CONFIGURED" }, revision: applied.revision });
    });
    this.app.post<{ Params: { id: string } }>("/api/agents/profiles/:id/test", async (request, reply) => {
      const profile = this.configuration.current().config.agentProfiles.find((entry) => entry.id === request.params.id);
      const codexHome = stringSetting(profile?.settings?.codexHome);
      if (!profile || profile.provider !== "codex" || !codexHome) return reply.code(404).send({ code: "PROFILE_NOT_FOUND" });
      return probeCodexProfile({
        id: profile.id,
        alias: profile.alias,
        codexHome,
        ...(stringSetting(profile.settings?.executable) ? { executable: stringSetting(profile.settings?.executable)! } : {}),
        ...(stringSetting(profile.settings?.model) ? { model: stringSetting(profile.settings?.model)! } : {}),
      });
    });
    this.app.post<{ Params: { id: string }; Body: CodexRunBody }>("/api/agents/profiles/:id/runs", async (request, reply) => {
      if (!request.body?.workspacePath || !request.body.prompt) return reply.code(400).send({ code: "RUN_INPUT_REQUIRED" });
      if (!this.workspaces.get(request.body.workspacePath)) return reply.code(400).send({ code: "UNMANAGED_WORKSPACE", message: "Codex runs must use a Dispatcher-managed worktree" });
      const adapter = this.codexAdapters.get(request.params.id);
      if (!adapter) return reply.code(404).send({ code: "PROFILE_NOT_FOUND" });
      const session = await adapter.start({ runId: randomUUID(), workspacePath: request.body.workspacePath, prompt: request.body.prompt });
      return reply.code(201).send({ session: this.sessionView(session) });
    });
    this.app.get<{ Params: { profileId: string; sessionId: string } }>("/api/agents/profiles/:profileId/sessions/:sessionId", async (request, reply) => {
      const adapter = this.codexAdapters.get(request.params.profileId);
      if (!adapter) return reply.code(404).send({ code: "PROFILE_NOT_FOUND" });
      return { session: this.sessionView(await adapter.status(request.params.sessionId)) };
    });
    this.app.post<{ Params: { profileId: string; sessionId: string }; Body: { message?: string } }>("/api/agents/profiles/:profileId/sessions/:sessionId/input", async (request, reply) => {
      if (!request.body?.message) return reply.code(400).send({ code: "MESSAGE_REQUIRED" });
      const adapter = this.codexAdapters.get(request.params.profileId);
      if (!adapter) return reply.code(404).send({ code: "PROFILE_NOT_FOUND" });
      const event = await adapter.send(request.params.sessionId, request.body.message);
      const run = this.database.listEntities<JsonValue>("run")
        .map((value) => value as unknown as Run)
        .find((entry) => entry.sessionId === request.params.sessionId);
      if (run?.state === "WAITING_USER") {
        assertRunTransition(run.state, "ACTIVE");
        run.state = "ACTIVE";
        run.lastActivityAt = new Date().toISOString();
        this.database.saveEntity("run", run.id, json(run));
        const current = this.database.getCanonicalTask<JsonValue>(run.taskId);
        if (current && (current.document as unknown as Task).state === "WAITING_USER") {
          this.tasks.execute({ id: `run:${run.id}:user-input`, taskId: run.taskId, baseRevision: current.revision, actor: "user", command: { type: "task.transition", state: "RUNNING" } });
        }
      }
      return { event };
    });

    this.app.get("/api/connectors", async () => ({ connectors: this.connectors.list().map((adapter) => ({ definition: adapter.definition, instance: adapter.instance })) }));
    this.app.post<{ Params: { id: string } }>("/api/connectors/:id/test", async (request, reply) => {
      const connector = this.connectors.get(request.params.id);
      if (!connector) return reply.code(404).send({ code: "CONNECTOR_NOT_FOUND" });
      return { probe: await connector.probe() };
    });
    this.app.post("/api/connectors/projections/drain", async () => this.projections.drain());
    this.app.get("/api/connectors/dead-letters", async () => ({ deadLetters: this.database.listDeadLetters<JsonValue>() }));
    this.app.post<{ Params: { id: string } }>("/api/connectors/dead-letters/:id/retry", async (request, reply) => {
      if (!this.database.retryDeadLetter(request.params.id)) return reply.code(409).send({ code: "DEAD_LETTER_NOT_RETRYABLE" });
      return reply.code(202).send({ accepted: true });
    });
    this.app.post<{ Params: { id: string } }>("/api/connectors/dead-letters/:id/resolve", async (request, reply) => {
      this.database.resolveDeadLetter(request.params.id);
      return reply.code(204).send();
    });
    this.app.post<{ Params: { id: string } }>("/api/connectors/:id/reconcile", async (request, reply) => {
      const adapter = this.connectors.get<TaskPlatformAdapter>(request.params.id);
      if (!adapter || adapter.instance.kind !== "task") return reply.code(404).send({ code: "CONNECTOR_NOT_FOUND" });
      const bindings = this.database.listCanonicalTasks<JsonValue>()
        .flatMap((task) => this.database.listExternalBindings<JsonValue>(String((task.document as Record<string, JsonValue>).id), "task"))
        .map((binding) => binding as unknown as ExternalBinding)
        .filter((binding) => binding.connectorInstanceId === request.params.id);
      const result = await adapter.reconcile(bindings, this.database.getSyncCursor(request.params.id));
      let applied = 0;
      for (const event of result.changes) {
        if (event.entityType !== "task") continue;
        const outcome = await this.processExternalTaskEvent(adapter, event);
        if (!outcome.duplicate) applied += 1;
      }
      for (const conflict of result.conflicts) {
        this.database.appendDeadLetter({
          id: randomUUID(),
          connectorInstanceId: request.params.id,
          source: "reconcile",
          sourceId: conflict.externalId,
          reason: `CONFLICT:${conflict.fields.join(",")}`,
          payload: json(conflict),
        });
      }
      if (result.cursor) this.database.saveSyncCursor(request.params.id, result.cursor);
      return { applied, conflicts: result.conflicts.length, cursor: result.cursor ?? null };
    });
    this.app.post<{ Params: { id: string } }>("/api/connectors/:id/webhook", async (request, reply) => {
      const adapter = this.connectors.get<TaskPlatformAdapter>(request.params.id);
      if (!adapter || adapter.instance.kind !== "task") return reply.code(404).send({ code: "CONNECTOR_NOT_FOUND" });
      const raw = this.rawWebhookBodies.get(request);
      if (!raw) return reply.code(400).send({ code: "RAW_WEBHOOK_REQUIRED" });
      const headers = Object.fromEntries(Object.entries(request.headers).flatMap(([key, value]) => typeof value === "string" ? [[key, value]] : []));
      const event = await adapter.ingress(raw, headers);
      const result = event.entityType === "task" ? await this.processExternalTaskEvent(adapter, event) : { duplicate: !this.tasks.ingest(event) };
      return reply.code(202).send({ accepted: true, duplicate: result.duplicate, eventId: event.externalEventId });
    });

    this.app.get("/api/tasks", async () => ({ tasks: this.database.listCanonicalTasks<JsonValue>() }));
    this.app.get<{ Params: { id: string } }>("/api/tasks/:id", async (request, reply) => {
      const task = this.database.getCanonicalTask<JsonValue>(request.params.id);
      if (!task) return reply.code(404).send({ code: "TASK_NOT_FOUND" });
      return { ...task, contract: this.database.getTaskContract<JsonValue>(request.params.id), deliveries: this.database.listDeliveryEvidence<JsonValue>(request.params.id) };
    });
    this.app.post<{ Params: { id: string }; Body: TaskDispatchBody }>("/api/tasks/:id/dispatch", async (request, reply) => {
      if (!request.body?.profileId) return reply.code(400).send({ code: "DISPATCH_INPUT_REQUIRED" });
      const stored = this.database.getCanonicalTask<JsonValue>(request.params.id);
      const contract = this.database.getTaskContract<JsonValue>(request.params.id) as unknown as TaskContract | undefined;
      const adapter = this.codexAdapters.get(request.body.profileId);
      if (!stored || !contract) return reply.code(404).send({ code: "TASK_NOT_FOUND" });
      if (!adapter) return reply.code(404).send({ code: "PROFILE_NOT_FOUND" });
      const profile = this.configuration.current().config.agentProfiles.find((entry) => entry.id === request.body!.profileId)!;
      const runner = this.runners.list().find((entry) => entry.id === profile.runnerId);
      if (!runner) return reply.code(409).send({ code: "RUNNER_UNAVAILABLE" });
      const repositoryId = request.body.repositoryId ?? contract.delivery.repository;
      const repositoryConfig = this.configuration.current().config.repositories.find((entry) => entry.id === repositoryId);
      if (!repositoryId || !repositoryConfig) return reply.code(409).send({ code: "REPOSITORY_UNAVAILABLE", message: "The task repository is not registered" });
      const scheduler = new CanonicalScheduler(() => [{
        runnerId: runner.id,
        runnerTags: runner.capabilities,
        capacity: runner.capacity,
        activeRuns: this.database.listEntities<JsonValue>("run").filter((value) => (value as Record<string, JsonValue>).state === "ACTIVE").length,
        providerId: "codex",
        profileId: profile.id,
        resourceState: this.profileResourceState(profile.id),
        capabilities: ["code", "git", "session-resume"],
        adapter,
      }]);
      const runId = randomUUID();
      const workspace = await this.workspaces.create({
        repositoryId,
        taskId: request.params.id,
        runId,
        attempt: 1,
        baseRef: request.body.baseRef ?? contract.delivery.baseBranch ?? repositoryConfig.defaultBaseRef,
        scopePaths: repositoryConfig.scopePaths,
      });
      let dispatched: Awaited<ReturnType<CanonicalScheduler["dispatch"]>>;
      try {
        dispatched = await scheduler.dispatch({ task: stored.document as unknown as Task, taskRevision: stored.revision, contract, requirements: { capabilities: ["code", "git"] }, workspacePath: workspace.path, runId });
      } catch (error) {
        const cleanup = await this.workspaces.cleanupPlan(workspace);
        if (cleanup.safe) await this.workspaces.cleanup(cleanup);
        throw error;
      }
      dispatched.run.branch = workspace.branch;
      this.database.saveEntity("run", dispatched.run.id, json(dispatched.run));
      const queued = this.tasks.execute({ id: `dispatch:${dispatched.run.id}:queued`, taskId: request.params.id, baseRevision: stored.revision, actor: "scheduler", command: { type: "task.transition", state: "QUEUED" } });
      this.tasks.execute({ id: `dispatch:${dispatched.run.id}:running`, taskId: request.params.id, baseRevision: queued.revision, actor: "scheduler", command: { type: "task.transition", state: "RUNNING" } });
      return reply.code(201).send({ run: dispatched.run, routing: { explanation: dispatched.decision.explanation, eligible: dispatched.decision.eligible, rejected: dispatched.decision.rejected } });
    });
    this.app.get<{ Params: { id: string } }>("/api/runs/:id", async (request, reply) => {
      const run = this.database.getEntity<JsonValue>("run", request.params.id);
      if (!run) return reply.code(404).send({ code: "RUN_NOT_FOUND" });
      return { run };
    });
    this.app.post<{ Params: { id: string } }>("/api/runs/:id/advance", async (request, reply) => {
      const run = this.database.getEntity<JsonValue>("run", request.params.id);
      if (!run) return reply.code(404).send({ code: "RUN_NOT_FOUND" });
      const advanced = await this.advanceRun(request.params.id);
      return reply.code(advanced.waiting ? 202 : 200).send(advanced);
    });
    this.app.get("/api/system-impact", async () => {
      const memory = process.memoryUsage();
      const databasePath = join(this.options.dataDirectory, "dispatcher.sqlite");
      return {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        runnerCount: this.runners.list().length,
        activeLocalProcesses: 0,
        databaseBytes: existsSync(databasePath) ? statSync(databasePath).size : 0,
        dashboardClients: this.dashboardClients,
        llmCallsLastHour: this.llm.snapshot().calls,
      };
    });

    this.app.get("/api/llm", async () => {
      const current = this.configuration.current();
      return { revision: current.revision, config: current.config.internalLlm, ...this.llm.snapshot() };
    });
    this.app.put<{ Body: LlmConfigBody }>("/api/llm/config", async (request, reply) => {
      if (!request.body?.config) return reply.code(400).send({ code: "LLM_CONFIG_REQUIRED" });
      const current = this.configuration.current();
      const next: DispatcherConfig = { ...structuredClone(current.config), internalLlm: structuredClone(request.body.config) };
      const plan = this.configuration.buildPlan(next, request.body.actor ?? "local-web", "web");
      await assertRequiredSecretsAvailable(next, this.secrets);
      const applied = this.configuration.applyPlan(plan.id, { confirmed: request.body.confirmed ?? true });
      return { plan, revision: applied.revision, config: applied.config.internalLlm, state: this.llm.snapshot().state };
    });
    this.app.post<{ Params: { profileId: string } }>("/api/llm/profiles/:profileId/test", async (request) => ({
      health: await this.llm.probe(request.params.profileId, "explicit"),
    }));
    this.app.post<{ Params: { role: LlmRole }; Body: LlmSwitchBody }>("/api/llm/roles/:role/switch", async (request, reply) => {
      if (!request.body?.profileId) return reply.code(400).send({ code: "LLM_PROFILE_REQUIRED" });
      return { state: await this.llm.switchProfile(request.params.role, request.body.profileId) };
    });
    this.app.post<{ Params: { role: LlmRole } }>("/api/llm/roles/:role/failback", async (request) => ({
      switched: await this.llm.attemptFailback(request.params.role),
      state: this.llm.snapshot().state,
    }));

    this.app.get("/api/events", async (request, reply) => {
      reply.hijack();
      const response = reply.raw;
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      this.dashboardClients += 1;
      response.write(`event: ready\ndata: ${JSON.stringify({ connected: true })}\n\n`);
      const unsubscribe = this.events.subscribe("runnerChanged", (runner) => {
        response.write(`event: runner.changed\ndata: ${JSON.stringify(redactValue(runner))}\n\n`);
      });
      const keepAlive = setInterval(() => response.write(": keep-alive\n\n"), 30_000);
      keepAlive.unref();
      request.raw.on("close", () => {
        clearInterval(keepAlive);
        unsubscribe();
        this.dashboardClients = Math.max(0, this.dashboardClients - 1);
      });
    });

    this.app.get("/api/config", async () => this.configuration.current());
    this.app.get("/api/config/schema", async () => ({ schema: dispatcherConfigSchema, uiSchema: dispatcherConfigUiSchema }));
    this.app.get("/api/config/audit", async () => ({ audit: this.database.listAudit() }));
    this.app.post<{ Body: ConfigPlanBody }>("/api/config/plans", async (request, reply) => {
      if (request.body?.config === undefined) return reply.code(400).send({ code: "CONFIG_REQUIRED" });
      const plan = this.configuration.buildPlan(request.body.config, request.body.actor ?? "local-web", "web");
      return reply.code(201).send({ plan });
    });
    this.app.post<{ Params: { id: string }; Body: ApplyPlanBody }>("/api/config/plans/:id/apply", async (request) => {
      const confirmed = request.body?.confirmed;
      await assertRequiredSecretsAvailable(this.configuration.proposedConfig(request.params.id), this.secrets);
      return this.configuration.applyPlan(request.params.id, confirmed === undefined ? {} : { confirmed });
    });
    this.app.post<{ Params: { id: string } }>("/api/config/plans/:id/rollback", async (request) =>
      this.configuration.rollbackPlan(request.params.id),
    );

    this.app.get("/api/setup", async () => ({
      state: this.database.getWizardState() ?? { step: 0, configRevision: this.configuration.current().revision, completed: false },
      config: this.configuration.current(),
    }));
    this.app.post<{ Body: WizardBody }>("/api/setup", async (request, reply) => {
      const currentRevision = this.configuration.current().revision;
      const step = request.body?.step;
      if (!Number.isInteger(step) || step === undefined || step < 0 || step > 4) {
        return reply.code(400).send({ code: "INVALID_WIZARD_STEP" });
      }
      if (request.body.configRevision !== currentRevision) {
        return reply.code(409).send({ code: "CONFIG_REVISION_CONFLICT", actualRevision: currentRevision });
      }
      const state = { step, configRevision: currentRevision, completed: Boolean(request.body.completed), updatedAt: new Date().toISOString() };
      this.database.saveWizardState(state);
      return { state };
    });

    this.app.put<{ Params: { namespace: string; name: string }; Body: SecretBody }>(
      "/api/secrets/:namespace/:name",
      async (request, reply) => {
        if (!request.body?.value) return reply.code(400).send({ code: "SECRET_VALUE_REQUIRED" });
        const reference = `secret://${request.params.namespace}/${request.params.name}`;
        const metadata = await this.secrets.put(reference, request.body.value);
        this.secretTestStates.delete(reference);
        return reply.code(201).send({ secret: this.secretView(metadata) });
      },
    );
    this.app.post<{ Params: { namespace: string; name: string } }>("/api/secrets/:namespace/:name/test", async (request) => {
      const reference = `secret://${request.params.namespace}/${request.params.name}`;
      const metadata = await this.secrets.metadata(reference);
      const testedAt = new Date().toISOString();
      if (!metadata.exists) {
        this.secretTestStates.set(reference, { lastTestedAt: testedAt, lastTestStatus: "failed" });
        return { ok: false, secret: this.secretView(metadata) };
      }
      try {
        const ok = await this.secrets.test(reference, { principal: "controller", purpose: "test" });
        this.secretTestStates.set(reference, { lastTestedAt: testedAt, lastTestStatus: ok ? "ok" : "failed" });
        return { ok, secret: this.secretView(metadata) };
      } catch (error) {
        this.secretTestStates.set(reference, { lastTestedAt: testedAt, lastTestStatus: "failed" });
        throw error;
      }
    });
    this.app.delete<{ Params: { namespace: string; name: string } }>("/api/secrets/:namespace/:name", async (request, reply) => {
      const reference = `secret://${request.params.namespace}/${request.params.name}`;
      if (requiredSecretReferences(this.configuration.current().config).includes(reference)) {
        return reply.code(409).send({ code: "SECRET_IN_USE", message: "Disable the configuration that uses this credential before deleting it" });
      }
      await this.secrets.delete(reference);
      this.secretTestStates.delete(reference);
      return reply.code(204).send();
    });

    this.app.setErrorHandler((error, _request, reply) => {
      const secretStatus = error instanceof SecretStoreError
        ? error.code === "SECRET_ACCESS_DENIED"
          ? 403
          : ["INVALID_SECRET_REFERENCE", "EMPTY_SECRET", "SECRET_NOT_FOUND", "SECRET_REFERENCE_MISSING"].includes(error.code)
            ? 400
            : 500
        : undefined;
      const connectorStatus = error instanceof ConnectorError
        ? error.code === "AUTH"
          ? 401
          : error.code === "RATE_LIMITED"
            ? 429
            : error.code === "CONFLICT"
              ? 409
              : error.code === "TEMPORARY"
                ? 503
                : 400
        : undefined;
      const workspaceStatus = error instanceof WorkspacePolicyError ? 409 : undefined;
      const status = error instanceof RevisionConflictError
        ? 409
        : error instanceof LlmRuntimeError
          ? error.code === "NO_AVAILABLE_PROFILE" ? 503 : 400
        : error instanceof ConfigPlanError || error instanceof ConfigValidationError
          ? 400
          : workspaceStatus ?? connectorStatus ?? secretStatus ?? 500;
      const code = error instanceof RevisionConflictError || error instanceof ConfigPlanError || error instanceof SecretStoreError || error instanceof LlmRuntimeError || error instanceof ConnectorError || error instanceof WorkspacePolicyError
        ? error.code
        : error instanceof ConfigValidationError
          ? error.code
        : "INTERNAL_ERROR";
      this.app.log.error({ error: redactValue(error) }, "request failed");
      const message = error instanceof Error ? error.message : "Request failed";
      void reply.code(status).send({ code, message: status === 500 ? "Internal error" : message });
    });

    const webRoot = this.options.webRoot ?? resolve(fileURLToPath(new URL("../../web/dist", import.meta.url)));
    if (existsSync(webRoot)) {
      void this.app.register(fastifyStatic, { root: webRoot, wildcard: false, maxAge: "1h", immutable: true });
      this.app.setNotFoundHandler((request, reply) => {
        if (request.url.startsWith("/api/") || request.url === "/health" || request.url === "/ready") {
          return reply.code(404).send({ code: "NOT_FOUND" });
        }
        return reply.header("Cache-Control", "no-cache").sendFile("index.html", { maxAge: 0, immutable: false });
      });
    }
  }

  private secretView(metadata: SecretMetadata): SecretMetadata & { lastTestedAt: string | null; lastTestStatus: "ok" | "failed" | null } {
    const state = this.secretTestStates.get(metadata.reference);
    return {
      ...metadata,
      lastTestedAt: state?.lastTestedAt ?? null,
      lastTestStatus: state?.lastTestStatus ?? null,
    };
  }

  private sessionView(session: AdapterSession): Pick<AdapterSession, "id" | "runId" | "profileId" | "state" | "createdAt" | "updatedAt"> {
    return {
      id: session.id,
      runId: session.runId,
      ...(session.profileId ? { profileId: session.profileId } : {}),
      state: session.state,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }
}
