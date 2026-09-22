import { existsSync, statSync } from "node:fs";
import { PassThrough } from "node:stream";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { arch, platform } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import {
  CodexAdapter,
  codexManifest,
  QoderAdapter,
  qoderManifest,
  genericCliManifest,
  genericMockManifest,
  probeCodexProfile,
  probeQoderProfile,
  type AgentAdapter,
  type AdapterSession,
  type SessionStore,
  type CodexBackend,
  type CodexProfileConfig,
  type QoderBackend,
  type QoderProfileConfig,
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
  isTerminalRunState,
  type ExternalBinding,
  type ResourceSnapshot,
  type ResourceState,
  type Run,
  type Runner,
  type Task,
  type TaskContract,
} from "@dispatcher/domain";
import {
  CoalescingEventStream,
  FleetReadModel,
  MultiSignalResourceRegistry,
  ResetAwareProbeScheduler,
  decideResourceRecovery,
  paginate,
  type FleetSnapshot,
  type ResourceAssessment,
  type ResourceProbeSchedule,
} from "@dispatcher/fleet";
import {
  CanonicalTaskService,
  ConnectorError,
  ConnectorRegistry,
  DeliveryService,
  GitHubScmConnector,
  LinearTaskConnector,
  LocalGitTransport,
  SlackMessagingConnector,
  MessagingIdentityService,
  ConversationBindingService,
  AttentionNotificationPolicy,
  SecureDashboardLinkIssuer,
  ProjectionWorker,
  type ExternalEvent,
  type GitTransport,
  type ScmAdapter,
  type MessagingAdapter,
  type MessagingStateStore,
  type ConversationBinding,
  type PrincipalBinding,
  type NormalizedMessage,
  type Notification,
  type TaskDraft,
  type TaskFieldMapping,
  type TaskPlatformAdapter,
} from "@dispatcher/integrations";
import { LlmRuntime, LlmRuntimeError, type FetchLike, type LlmConfiguration, type LlmRole } from "@dispatcher/llm-runtime";
import { createLogger, redactValue } from "@dispatcher/observability";
import { DispatcherDatabase, RevisionConflictError, type JsonValue } from "@dispatcher/persistence";
import { EmbeddedRunner, EventBus, LeaseFenceError, RemoteRunnerServer, RunnerEnrollmentAuthority, RunnerLeaseAuthority, RunnerRegistry, VerificationRegistry, type RunnerEnrollmentRecord, type RunnerEvents } from "@dispatcher/runner";
import {
  SemanticPolicyError,
  SemanticToolRegistry,
  SemanticWorkflowEngine,
  parseFixedCommand,
  type ResolvableEntity,
  type SemanticWorkflowRecord,
  type SemanticWorkflowStore,
  type TypedIntentV2,
  TaskContractCompiler,
} from "@dispatcher/semantic";
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
  qoderBackendFactory?: (profile: QoderProfileConfig) => QoderBackend;
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

class DatabaseSemanticWorkflowStore implements SemanticWorkflowStore {
  constructor(private readonly database: DispatcherDatabase) {}
  get(id: string): SemanticWorkflowRecord | undefined {
    return this.database.getEntity<JsonValue>("semantic-workflow", id) as unknown as SemanticWorkflowRecord | undefined;
  }
  save(record: SemanticWorkflowRecord): void {
    this.database.saveEntity("semantic-workflow", record.id, json(record), record.updatedAt);
  }
}

class DatabaseMessagingStateStore implements MessagingStateStore {
  constructor(private readonly database: DispatcherDatabase) {}
  getConversation(id: string): ConversationBinding | undefined {
    return this.database.getEntity<JsonValue>("messaging-conversation", id) as unknown as ConversationBinding | undefined;
  }
  saveConversation(binding: ConversationBinding): void {
    this.database.saveEntity("messaging-conversation", binding.id, json(binding), binding.updatedAt);
  }
  getPrincipal(connectorInstanceId: string, externalPrincipalId: string): PrincipalBinding | undefined {
    return this.database.getEntity<JsonValue>("messaging-principal", `${connectorInstanceId}:${externalPrincipalId}`) as unknown as PrincipalBinding | undefined;
  }
  savePrincipal(binding: PrincipalBinding): void {
    this.database.saveEntity("messaging-principal", `${binding.connectorInstanceId}:${binding.externalPrincipalId}`, json(binding), binding.revokedAt ?? binding.approvedAt);
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

interface QoderProfileBody {
  id?: string;
  alias?: string;
  runnerId?: string;
  executable?: string;
  configDir?: string;
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
  capabilities?: string[];
  runnerTags?: string[];
  providerIds?: string[];
}

interface RunnerEnrollmentBody {
  runnerId?: string;
  token?: string;
}

interface AssistantPlanBody {
  text?: string;
  intent?: TypedIntentV2;
  actor?: string;
  roles?: string[];
  channel?: "web" | "api" | "messaging";
}

interface MessagingIdentityBody {
  externalPrincipalId?: string;
  principalId?: string;
  roles?: string[];
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
  readonly semanticTools: SemanticToolRegistry;
  readonly semanticWorkflows: SemanticWorkflowEngine;
  readonly messagingIdentity: MessagingIdentityService;
  readonly conversations: ConversationBindingService;
  private readonly taskCompiler = new TaskContractCompiler();
  private readonly fleet = new FleetReadModel();
  private readonly fleetEvents = new CoalescingEventStream(512);
  private readonly resourceRegistry = new MultiSignalResourceRegistry();
  private readonly resourceProbes = new ResetAwareProbeScheduler();
  private readonly attentionNotifications = new AttentionNotificationPolicy();
  private readonly leaseAuthority = new RunnerLeaseAuthority();
  private readonly secureLinks: SecureDashboardLinkIssuer;
  private readonly messagingChannels = new Map<string, string>();
  private readonly agentAdapters = new Map<string, AgentAdapter>();
  private readonly rawWebhookBodies = new WeakMap<object, Uint8Array>();
  private readonly startedAt = Date.now();
  private readonly embeddedRunner?: EmbeddedRunner;
  private readonly remoteRunnerServer: RemoteRunnerServer;
  private readonly enrollments: RunnerEnrollmentAuthority;
  private resourceProbeTimer: ReturnType<typeof setInterval> | undefined;
  private resourceProbeRunning = false;
  private listening = false;
  private stopping?: Promise<void>;
  private dashboardClients = 0;
  private readonly secretTestStates = new Map<string, SecretTestState>();

  constructor(readonly options: ControllerOptions) {
    const logger = createLogger({ level: process.env.LOG_LEVEL ?? "info" });
    this.app = fastify({ loggerInstance: logger as unknown as FastifyBaseLogger });
    this.database = new DispatcherDatabase(join(options.dataDirectory, "dispatcher.sqlite"));
    this.enrollments = new RunnerEnrollmentAuthority(
      this.database.listEntities<JsonValue>("runner-enrollment") as unknown as RunnerEnrollmentRecord[],
      (record) => this.database.saveEntity("runner-enrollment", record.id, json(record), record.consumedAt ?? record.createdAt),
    );
    for (const value of this.database.listEntities<JsonValue>("run")) {
      const run = value as unknown as Run;
      if (isTerminalRunState(run.state)) continue;
      this.restoreLeaseAuthority(run);
    }
    this.resourceRegistry.restore(this.database.listEntities<JsonValue>("resource-signal") as unknown as ResourceSnapshot[]);
    this.resourceProbes.restore(this.database.listEntities<JsonValue>("resource-probe-schedule") as unknown as ResourceProbeSchedule[]);
    this.workspaces = new WorkspaceManager(this.repositories, join(options.dataDirectory, "worktrees"));
    this.tasks = new CanonicalTaskService(this.database);
    this.projections = new ProjectionWorker(this.database, this.connectors);
    this.secrets = options.secretStore ?? createDefaultSecretStore({ dataDirectory: options.dataDirectory });
    this.secureLinks = new SecureDashboardLinkIssuer(`http://${options.host ?? "127.0.0.1"}:${options.port ?? 8347}`, randomUUID());
    this.llm = new LlmRuntime(this.database, (reference) => this.secrets.resolve(reference, { principal: "controller", purpose: "llm" }), options.llmFetch);
    this.configuration = new ConfigurationEngine(this.database, { apply: (config) => this.applyRuntimeConfiguration(config) });
    this.applyRuntimeConfiguration(this.configuration.current().config);
    this.semanticTools = new SemanticToolRegistry({ highRiskRequiresConfirmation: this.configuration.current().config.policies.highRiskRequiresConfirmation });
    this.semanticWorkflows = new SemanticWorkflowEngine(this.semanticTools, new DatabaseSemanticWorkflowStore(this.database));
    const messagingStore = new DatabaseMessagingStateStore(this.database);
    this.messagingIdentity = new MessagingIdentityService(messagingStore);
    this.conversations = new ConversationBindingService(messagingStore);
    this.registerSemanticTools();
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
      this.fleetEvents.publish("runner.changed", runner.id, redactValue(runner));
      if (runner.state === "OFFLINE") await this.notifyOperationalAttention({ key: runner.id, state: "RUNNER_OFFLINE", subject: `Runner offline: ${runner.displayName}`, body: `${runner.id} stopped reporting capacity.` });
    });
    this.remoteRunnerServer = new RemoteRunnerServer({
      registry: this.runners,
      server: this.app.server,
      path: "/runner",
      authenticate: async ({ runnerId, bearerToken }) => {
        if (!bearerToken) return false;
        const configured = this.configuration.current().config.runners.find((runner) => runner.id === runnerId && runner.mode === "remote");
        if (!configured?.credentialRef) return false;
        const expected = await this.secrets.resolve(configured.credentialRef, { principal: "controller", purpose: "provider" });
        const suppliedBytes = Buffer.from(bearerToken);
        const expectedBytes = Buffer.from(expected);
        return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
      },
      onRunnerChanged: async (runner) => await this.events.publish("runnerChanged", runner),
    });
    const modules: ServiceModule[] = [];
    modules.push({ name: "remote-runner-server", start: () => undefined, stop: () => this.remoteRunnerServer.close() });
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
    modules.push({
      name: "resource-monitor",
      start: () => {
        this.resourceProbeTimer = setInterval(() => void this.runDueResourceProbes(), 30_000);
        this.resourceProbeTimer.unref();
        void this.runDueResourceProbes();
      },
      stop: () => {
        if (this.resourceProbeTimer) clearInterval(this.resourceProbeTimer);
        this.resourceProbeTimer = undefined;
      },
    });
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

  private restoreLeaseAuthority(run: Run): void {
    if (this.leaseAuthority.current(run.id)) return;
    const expiresAt = run.leaseExpiresAt ?? new Date(Date.now() + 15 * 60_000).toISOString();
    this.leaseAuthority.issue({ runId: run.id, runnerId: run.runnerId, leaseId: run.leaseId, generation: run.generation, expiresAt });
    this.persistLatestLeaseAudit(run.id);
  }

  private fenceDelivery(run: Run, operation: "branch" | "push" | "pull-request" | "complete"): void {
    this.restoreLeaseAuthority(run);
    try {
      this.leaseAuthority.fence(run.id, run.leaseId, run.generation, operation);
      this.persistLatestLeaseAudit(run.id);
    } catch (error) {
      this.persistLatestLeaseAudit(run.id);
      if (error instanceof LeaseFenceError) {
        throw new ConnectorError("CONFLICT", `Delivery authority rejected during ${operation}: ${error.message}`, { retryable: false, operation: "delivery" });
      }
      throw error;
    }
  }

  private persistLatestLeaseAudit(runId: string): void {
    const audit = this.leaseAuthority.audit(runId);
    const record = audit.at(-1);
    if (!record) return;
    this.database.saveEntity("lease-audit", `${runId}:${audit.length}`, json(record), record.occurredAt);
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
    this.messagingChannels.clear();
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
      } else if (configured.definitionId === "messaging.slack") {
        const signingSecretRef = stringSetting(configured.settings?.signingSecretRef);
        if (!configured.credentialRef || !signingSecretRef) throw new Error(`Slack connector ${configured.id} is missing credential references`);
        this.connectors.register(new SlackMessagingConnector({
          instance,
          botTokenRef: configured.credentialRef,
          signingSecretRef,
          resolveSecret: (reference) => this.secrets.resolve(reference, { principal: "controller", purpose: "integration" }),
          ...(this.options.integrationFetch ? { fetch: this.options.integrationFetch } : {}),
          ...(stringSetting(configured.settings?.apiBase) ? { apiBase: stringSetting(configured.settings?.apiBase)! } : {}),
        }));
        const alertChannel = stringSetting(configured.settings?.alertChannel);
        if (alertChannel) this.messagingChannels.set(configured.id, alertChannel);
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

    this.agentAdapters.clear();
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
      this.agentAdapters.set(profile.id, new CodexAdapter(adapterProfile, this.options.codexBackendFactory?.(adapterProfile), store));
    }
    for (const profile of config.agentProfiles.filter((entry) => entry.provider === "qoder")) {
      const adapterProfile: QoderProfileConfig = {
        id: profile.id,
        alias: profile.alias,
        ...(stringSetting(profile.settings?.executable) ? { executable: stringSetting(profile.settings?.executable)! } : {}),
        ...(stringSetting(profile.settings?.configDir) ? { configDir: stringSetting(profile.settings?.configDir)! } : {}),
        ...(stringSetting(profile.settings?.model) ? { model: stringSetting(profile.settings?.model)! } : {}),
      };
      this.agentAdapters.set(profile.id, new QoderAdapter(adapterProfile, this.options.qoderBackendFactory?.(adapterProfile), store));
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
    const assessment = this.resourceRegistry.assess(profileId);
    if (assessment.evidence.length) return assessment.state;
    const snapshot = this.database.getEntity<JsonValue>("resource-snapshot", profileId) as unknown as ResourceSnapshot | undefined;
    return snapshot?.state ?? "AVAILABLE";
  }

  private fleetSnapshot(now = new Date()): FleetSnapshot {
    const storedRuns = this.database.listEntities<JsonValue>("run").map((document) => document as unknown as Run);
    const runsById = new Map(storedRuns.map((run) => [run.id, run]));
    const latestRunByTask = new Map<string, Run>();
    for (const run of storedRuns) {
      const current = latestRunByTask.get(run.taskId);
      const runTime = run.lastActivityAt ?? run.endedAt ?? run.startedAt ?? "";
      const currentTime = current?.lastActivityAt ?? current?.endedAt ?? current?.startedAt ?? "";
      if (!current || runTime > currentTime) latestRunByTask.set(run.taskId, run);
    }
    const tasks = this.database.listCanonicalTasks<JsonValue>().map(({ document }) => {
      const task = document as unknown as Task;
      const run = task.currentRunId ? runsById.get(task.currentRunId) : latestRunByTask.get(task.id);
      return {
        id: task.id,
        projectId: task.projectId,
        title: task.title,
        state: task.state,
        updatedAt: task.updatedAt,
        ...(run ? { profileId: run.profileId } : {}),
        ...(task.bindings?.length ? { externalRefs: task.bindings.map((binding) => ({ connectorInstanceId: binding.connectorInstanceId, externalId: binding.externalId })) } : {}),
      };
    });
    const runs = storedRuns.map((run) => {
      const resource = this.database.getEntity<JsonValue>("resource-snapshot", run.profileId) as unknown as ResourceSnapshot | undefined;
      const createdAt = run.startedAt ?? run.lastActivityAt ?? new Date(0).toISOString();
      return {
        id: run.id,
        taskId: run.taskId,
        profileId: run.profileId,
        state: run.state,
        createdAt,
        updatedAt: run.lastActivityAt ?? run.endedAt ?? createdAt,
        ...(run.lastActivityAt ? { lastActivityAt: run.lastActivityAt } : {}),
        ...(run.state === "WAITING_USER" ? { waitingReason: run.activitySummary ?? "User input required" } : {}),
        ...(resource?.state ? { resourceState: resource.state } : {}),
        ...(run.activitySummary || run.failureReason || run.resourceBlockReason ? { summary: run.activitySummary ?? run.failureReason ?? run.resourceBlockReason } : {}),
      };
    });
    const deadLetters = this.database.listDeadLetters<JsonValue>();
    const connectors = this.connectors.list().map((adapter) => {
      const blockers = this.database.connectorDeletionBlockers(adapter.instance.id);
      const probe = this.database.getEntity<JsonValue>("connector-health", adapter.instance.id) as { health?: typeof adapter.instance.health; checkedAt?: string; message?: string } | undefined;
      const health = probe?.health ?? adapter.instance.health;
      return {
        id: adapter.instance.id,
        displayName: adapter.instance.displayName,
        kind: adapter.instance.kind,
        health,
        checkedAt: probe?.checkedAt ?? adapter.instance.updatedAt,
        source: probe ? "probe" as const : "configuration" as const,
        ...(probe?.message ? { reason: probe.message } : health === "HEALTHY" ? {} : { reason: health }),
        pendingOutbox: blockers.pendingOutbox,
        deadLetters: deadLetters.filter((entry) => entry.connectorInstanceId === adapter.instance.id).length,
        capabilities: adapter.definition.capabilities.filter((capability) => capability.support === "supported").map((capability) => `${capability.namespace}@${capability.version}`),
      };
    });
    const profiles = this.configuration.current().config.agentProfiles.map((profile) => {
      const resource = this.resourceRegistry.assess(profile.id, now);
      return {
        id: profile.id,
        alias: profile.alias,
        provider: profile.provider,
        state: this.agentAdapters.has(profile.id) ? "CONFIGURED" : "UNAVAILABLE",
        resourceState: resource.evidence.length ? resource.state : this.profileResourceState(profile.id),
        ...(resource.evidence.length ? {
          resourceReason: resource.reason,
          resourceSource: resource.source,
          resourceConfidence: resource.confidence,
          resetsAt: resource.resetsAt,
          affectedTasks: storedRuns.filter((run) => run.profileId === profile.id && run.state === "RESOURCE_BLOCKED").length,
        } : {}),
        runnerId: profile.runnerId,
      };
    });
    return this.fleet.rebuild({ tasks, runs, connectors, profiles }, now);
  }

  private async captureProfileResource(profileId: string, adapter: AgentAdapter, sessionId: string): Promise<ResourceSnapshot | undefined> {
    if (!adapter.usage) return undefined;
    const usage = await adapter.usage(sessionId);
    const state = typeof usage.state === "string" && RESOURCE_STATES.includes(usage.state as ResourceState)
      ? usage.state as ResourceState
      : undefined;
    if (!state) return undefined;
    const resourceSources: ResourceSnapshot["source"][] = ["sdk", "cli", "session", "error", "probe", "manual"];
    const reportedSource = typeof usage.source === "string" && resourceSources.includes(usage.source as ResourceSnapshot["source"])
      ? usage.source as ResourceSnapshot["source"]
      : undefined;
    const snapshot: ResourceSnapshot = {
      profileId,
      state,
      ...(typeof usage.reason === "string" ? { reason: usage.reason } : {}),
      ...(typeof usage.resetsAt === "string" ? { resetsAt: usage.resetsAt } : {}),
      source: reportedSource ?? (usage.source === "error" ? "error" : "session"),
      confidence: usage.confidence === "high" || usage.confidence === "medium" ? usage.confidence : "low",
      checkedAt: new Date().toISOString(),
    };
    this.database.saveEntity("resource-signal", `${profileId}:${snapshot.source}`, json(snapshot), snapshot.checkedAt);
    const assessment = this.resourceRegistry.record(snapshot);
    const effective: ResourceSnapshot = {
      profileId: assessment.profileId,
      state: assessment.state,
      ...(assessment.reason ? { reason: assessment.reason } : {}),
      ...(assessment.resetsAt ? { resetsAt: assessment.resetsAt } : {}),
      source: assessment.source,
      confidence: assessment.confidence,
      checkedAt: assessment.checkedAt,
    };
    this.database.saveEntity("resource-snapshot", profileId, json(effective), effective.checkedAt);
    const priorSchedule = this.resourceProbes.list().find((entry) => entry.profileId === profileId);
    const scheduled = this.resourceProbes.schedule(effective);
    if (scheduled) this.database.saveEntity("resource-probe-schedule", profileId, json(scheduled), scheduled.nextProbeAt);
    else if (priorSchedule && (effective.state === "AVAILABLE" || effective.state === "LOW")) {
      const recovered: ResourceProbeSchedule = { ...priorSchedule, status: "RECOVERED", lastProbeAt: effective.checkedAt, lastState: effective.state };
      this.database.saveEntity("resource-probe-schedule", profileId, json(recovered), effective.checkedAt);
    }
    this.fleetEvents.publish("resource.changed", profileId, redactValue(assessment));
    return snapshot;
  }

  private async probeProfileResource(profileId: string): Promise<ResourceSnapshot | undefined> {
    const adapter = this.agentAdapters.get(profileId);
    if (!adapter?.usage) return undefined;
    const run = this.database.listEntities<JsonValue>("run")
      .map((value) => value as unknown as Run)
      .filter((candidate) => candidate.profileId === profileId)
      .sort((left, right) => (right.lastActivityAt ?? right.startedAt ?? "").localeCompare(left.lastActivityAt ?? left.startedAt ?? ""))[0];
    if (!run) return undefined;
    const snapshot = await this.captureProfileResource(profileId, adapter, run.sessionId);
    if (!snapshot) return undefined;
    const scheduled = this.resourceProbes.list().find((entry) => entry.profileId === profileId);
    if (scheduled?.status === "PROBING") {
      const completed = this.resourceProbes.complete(profileId, snapshot);
      this.database.saveEntity("resource-probe-schedule", profileId, json(completed), completed.lastProbeAt ?? completed.nextProbeAt);
    }
    const assessment = this.resourceRegistry.assess(profileId);
    if (assessment.state === "AVAILABLE" || assessment.state === "LOW") await this.recoverProfileRuns(profileId, assessment);
    return snapshot;
  }

  private async runDueResourceProbes(): Promise<void> {
    if (this.resourceProbeRunning) return;
    this.resourceProbeRunning = true;
    try {
      for (const due of this.resourceProbes.due()) {
        this.database.saveEntity("resource-probe-schedule", due.profileId, json(due), due.lastProbeAt ?? due.nextProbeAt);
        try {
          const result = await this.probeProfileResource(due.profileId);
          if (!result) {
            const unavailable: ResourceSnapshot = { profileId: due.profileId, state: "UNKNOWN", reason: "Provider did not return a resource probe", source: "probe", confidence: "low", checkedAt: new Date().toISOString() };
            this.resourceRegistry.record(unavailable);
            this.database.saveEntity("resource-signal", `${due.profileId}:probe`, json(unavailable), unavailable.checkedAt);
            const completed = this.resourceProbes.complete(due.profileId, unavailable);
            this.database.saveEntity("resource-probe-schedule", due.profileId, json(completed), completed.lastProbeAt ?? completed.nextProbeAt);
          }
        } catch (error) {
          const failed: ResourceSnapshot = { profileId: due.profileId, state: "PROVIDER_DOWN", reason: error instanceof Error ? error.message : "Resource probe failed", source: "probe", confidence: "medium", checkedAt: new Date().toISOString() };
          this.resourceRegistry.record(failed);
          this.database.saveEntity("resource-signal", `${due.profileId}:probe`, json(failed), failed.checkedAt);
          const completed = this.resourceProbes.complete(due.profileId, failed);
          this.database.saveEntity("resource-probe-schedule", due.profileId, json(completed), completed.lastProbeAt ?? completed.nextProbeAt);
        }
      }
    } finally {
      this.resourceProbeRunning = false;
    }
  }

  private async recoverProfileRuns(profileId: string, assessment: ResourceAssessment): Promise<Array<{ runId: string; action: string; reason: string }>> {
    const outcomes: Array<{ runId: string; action: string; reason: string }> = [];
    const adapter = this.agentAdapters.get(profileId);
    if (!adapter) return outcomes;
    const runs = this.database.listEntities<JsonValue>("run").map((value) => value as unknown as Run).filter((run) => run.profileId === profileId && run.state === "RESOURCE_BLOCKED");
    for (const run of runs) {
      const taskRecord = this.database.getCanonicalTask<JsonValue>(run.taskId);
      const task = taskRecord?.document as unknown as Task | undefined;
      let session: AdapterSession | undefined;
      try { session = await adapter.status(run.sessionId); } catch { /* explicit reroute decision below */ }
      const runner = this.runners.list().find((candidate) => candidate.id === run.runnerId);
      const decision = decideResourceRecovery({
        run,
        currentGeneration: task?.currentRunId === run.id ? run.generation : run.generation + 1,
        ...(task?.currentRunId ? { currentRunId: task.currentRunId } : {}),
        sessionResumable: Boolean(session && (session.providerSessionId || adapter.manifest.capabilities.resume)),
        profileAvailable: assessment.state === "AVAILABLE" || assessment.state === "LOW",
        runnerAvailable: runner?.state === "ONLINE" || runner?.state === "DEGRADED",
      });
      if (this.database.getEntity<JsonValue>("resource-recovery", decision.idempotencyKey)) {
        outcomes.push({ runId: run.id, action: "DEDUPED", reason: decision.reason });
        continue;
      }
      if (decision.action !== "RESUME") {
        this.database.saveEntity("resource-recovery", decision.idempotencyKey, json({ ...decision, runId: run.id, profileId, recordedAt: new Date().toISOString() }));
        outcomes.push({ runId: run.id, action: decision.action, reason: decision.reason });
        continue;
      }
      try {
        await adapter.resume(run.sessionId);
      } catch (error) {
        const reason = `Same-session resume failed: ${error instanceof Error ? error.message : "unknown error"}; controlled reroute requires operator approval`;
        this.database.saveEntity("resource-recovery", decision.idempotencyKey, json({ runId: run.id, profileId, action: "REROUTE_REQUIRED", reason, revokeLeaseId: run.leaseId, recordedAt: new Date().toISOString() }));
        outcomes.push({ runId: run.id, action: "REROUTE_REQUIRED", reason });
        continue;
      }
      assertRunTransition(run.state, "ACTIVE");
      run.state = "ACTIVE";
      run.recoveryReason = decision.reason;
      run.lastActivityAt = new Date().toISOString();
      delete run.resourceBlockReason;
      this.database.saveEntity("run", run.id, json(run), run.lastActivityAt);
      if (taskRecord && task?.state === "WAITING_RESOURCE") {
        this.tasks.execute({ id: decision.idempotencyKey, taskId: run.taskId, baseRevision: taskRecord.revision, actor: "resource-monitor", command: { type: "task.transition", state: "RUNNING" } });
      }
      this.database.saveEntity("resource-recovery", decision.idempotencyKey, json({ ...decision, runId: run.id, profileId, assessment, recoveredAt: run.lastActivityAt }));
      this.attentionNotifications.recover(run.taskId);
      await this.notifyResourceRecovery(run, decision.idempotencyKey);
      await this.projections.drain();
      this.fleetEvents.publish("run.changed", run.id, { id: run.id, state: run.state, recoveryReason: run.recoveryReason });
      outcomes.push({ runId: run.id, action: decision.action, reason: decision.reason });
    }
    return outcomes;
  }

  private async notifyResourceRecovery(run: Run, idempotencyKey: string): Promise<void> {
    const existing = this.database.getEntity<JsonValue>("resource-recovery-notification", idempotencyKey);
    if (existing) return;
    const binding = this.database.listEntities<JsonValue>("messaging-conversation")
      .map((value) => value as unknown as ConversationBinding)
      .find((candidate) => candidate.runId === run.id && candidate.generation === run.generation);
    const connector = binding ? this.connectors.get<MessagingAdapter>(binding.connectorInstanceId) : undefined;
    if (binding && connector?.reply) {
      const sent = await connector.reply({ channel: binding.conversationId, threadId: binding.threadId, text: `Resource recovered; resumed the original session for run ${run.id}.` }, `${idempotencyKey}:thread`);
      this.database.saveEntity("resource-recovery-notification", idempotencyKey, json({ idempotencyKey, externalMessageId: sent.externalMessageId, threadId: binding.threadId, sentAt: new Date().toISOString() }));
    }
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
      const adapter = this.agentAdapters.get(run.profileId);
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
      if (resource && !["AVAILABLE", "LOW", "UNKNOWN"].includes(resource.state)) {
        const pausedSession = await adapter.status(run.sessionId);
        assertRunTransition(run.state, "RESOURCE_BLOCKED");
        run.state = "RESOURCE_BLOCKED";
        run.resourceBlockReason = resource.reason ?? resource.state;
        if (pausedSession.providerSessionId) run.providerSessionId = pausedSession.providerSessionId;
        run.resumePolicy = pausedSession.providerSessionId || adapter.manifest.capabilities.resume ? "same-session" : "controlled-reroute";
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
      assertAuthority: (operation) => this.fenceDelivery(run, operation),
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

  private registerSemanticTools(): void {
    this.semanticTools.register({
      name: "agent.discover", description: "Discover an installed agent provider", risk: "read", input: { required: ["provider", "alias"], properties: { provider: "string", alias: "string", executable: "string", configDir: "string", codexHome: "string", model: "string" }, additionalProperties: false },
      execute: async (arguments_) => {
        const provider = String(arguments_.provider).toLocaleLowerCase();
        const alias = String(arguments_.alias);
        if (provider === "qoder") return probeQoderProfile({ id: alias.toLocaleLowerCase(), alias, ...(typeof arguments_.executable === "string" ? { executable: arguments_.executable } : {}), ...(typeof arguments_.configDir === "string" ? { configDir: arguments_.configDir } : {}), ...(typeof arguments_.model === "string" ? { model: arguments_.model } : {}) });
        if (provider === "codex" && typeof arguments_.codexHome === "string") return probeCodexProfile({ id: alias.toLocaleLowerCase(), alias, codexHome: arguments_.codexHome, ...(typeof arguments_.executable === "string" ? { executable: arguments_.executable } : {}), ...(typeof arguments_.model === "string" ? { model: arguments_.model } : {}) });
        throw new SemanticPolicyError("INVALID_INPUT", `Unsupported discovery provider ${provider}`);
      },
    });
    this.semanticTools.register({
      name: "agent.test_profile", description: "Test a configured agent profile", risk: "read", input: { required: ["target"], properties: { target: "string" }, additionalProperties: false },
      execute: async ({ target }) => {
        const profile = this.configuration.current().config.agentProfiles.find((entry) => entry.id === String(target));
        if (!profile) throw new SemanticPolicyError("INVALID_INPUT", `Unknown profile ${String(target)}`);
        if (profile.provider === "qoder") return probeQoderProfile({ id: profile.id, alias: profile.alias, ...(stringSetting(profile.settings?.executable) ? { executable: stringSetting(profile.settings?.executable)! } : {}), ...(stringSetting(profile.settings?.configDir) ? { configDir: stringSetting(profile.settings?.configDir)! } : {}), ...(stringSetting(profile.settings?.model) ? { model: stringSetting(profile.settings?.model)! } : {}) });
        const codexHome = stringSetting(profile.settings?.codexHome);
        if (profile.provider === "codex" && codexHome) return probeCodexProfile({ id: profile.id, alias: profile.alias, codexHome, ...(stringSetting(profile.settings?.executable) ? { executable: stringSetting(profile.settings?.executable)! } : {}), ...(stringSetting(profile.settings?.model) ? { model: stringSetting(profile.settings?.model)! } : {}) });
        throw new SemanticPolicyError("INVALID_INPUT", `Profile ${profile.id} cannot be probed`);
      },
    });
    this.semanticTools.register({
      name: "fleet.list", description: "Read the current fleet snapshot", risk: "read", input: { additionalProperties: false },
      execute: async () => this.fleetSnapshot(),
    });
    this.semanticTools.register({
      name: "fleet.status", description: "Read the current fleet snapshot", risk: "read", input: { additionalProperties: false },
      execute: async () => this.fleetSnapshot(),
    });
    this.semanticTools.register({
      name: "task.list", description: "List canonical tasks", risk: "read", input: { additionalProperties: false },
      execute: async () => this.fleetSnapshot().tasks,
    });
    this.semanticTools.register({
      name: "task.status", description: "Read a canonical task", risk: "read", input: { required: ["target"], properties: { target: "string" }, additionalProperties: false },
      execute: async ({ target }) => {
        const task = this.database.getCanonicalTask<JsonValue>(String(target));
        if (!task) throw new SemanticPolicyError("INVALID_INPUT", `Unknown task ${String(target)}`);
        return task;
      },
    });
    this.semanticTools.register({
      name: "task.cancel", description: "Cancel a canonical task and its active run", risk: "privileged", requiredRoles: ["operator"], input: { required: ["target"], properties: { target: "string" }, additionalProperties: false },
      execute: async ({ target }, context) => {
        const taskId = String(target);
        const stored = this.database.getCanonicalTask<JsonValue>(taskId);
        if (!stored) throw new SemanticPolicyError("INVALID_INPUT", `Unknown task ${taskId}`);
        const task = stored.document as unknown as Task;
        if (task.state === "DONE" || task.state === "FAILED") throw new SemanticPolicyError("INVALID_INPUT", `Task ${taskId} cannot be cancelled from ${task.state}`);
        const run = task.currentRunId ? this.database.getEntity<JsonValue>("run", task.currentRunId) as unknown as Run | undefined : undefined;
        if (run && !isTerminalRunState(run.state)) {
          await this.agentAdapters.get(run.profileId)?.cancel(run.sessionId);
          assertRunTransition(run.state, "CANCELLED");
          run.state = "CANCELLED";
          run.endedAt = new Date().toISOString();
          this.database.saveEntity("run", run.id, json(run));
          this.fleetEvents.publish("run.changed", run.id, { id: run.id, state: run.state });
        }
        if (task.state !== "CANCELLED") this.tasks.execute({ id: `semantic:${context.workflowId}`, taskId, baseRevision: stored.revision, actor: context.principal.id, command: { type: "task.transition", state: "CANCELLED" } });
        return { taskId, state: "CANCELLED", runId: run?.id };
      },
    });
    this.semanticTools.register({
      name: "run.status", description: "Read a run", risk: "read", input: { required: ["target"], properties: { target: "string" }, additionalProperties: false },
      execute: async ({ target }) => {
        const run = this.database.getEntity<JsonValue>("run", String(target));
        if (!run) throw new SemanticPolicyError("INVALID_INPUT", `Unknown run ${String(target)}`);
        return run;
      },
    });
    this.semanticTools.register({
      name: "run.list", description: "List runs", risk: "read", input: { additionalProperties: false },
      execute: async () => this.fleetSnapshot().runs,
    });
    this.semanticTools.register({
      name: "run.cancel", description: "Cancel a run", risk: "privileged", requiredRoles: ["operator"], input: { required: ["target"], properties: { target: "string" }, additionalProperties: false },
      execute: async ({ target }, context) => {
        const runId = String(target);
        const run = this.database.getEntity<JsonValue>("run", runId) as unknown as Run | undefined;
        if (!run) throw new SemanticPolicyError("INVALID_INPUT", `Unknown run ${runId}`);
        if (!isTerminalRunState(run.state)) {
          await this.agentAdapters.get(run.profileId)?.cancel(run.sessionId);
          assertRunTransition(run.state, "CANCELLED");
          run.state = "CANCELLED";
          run.endedAt = new Date().toISOString();
          this.database.saveEntity("run", run.id, json(run));
          const stored = this.database.getCanonicalTask<JsonValue>(run.taskId);
          const task = stored?.document as unknown as Task | undefined;
          if (stored && task && !["DONE", "FAILED", "CANCELLED"].includes(task.state)) this.tasks.execute({ id: `semantic:${context.workflowId}`, taskId: run.taskId, baseRevision: stored.revision, actor: context.principal.id, command: { type: "task.transition", state: "CANCELLED" } });
          this.fleetEvents.publish("run.changed", run.id, { id: run.id, state: run.state });
        }
        return run;
      },
    });
    this.semanticTools.register({
      name: "run.pause", description: "Pause an active run", risk: "privileged", requiredRoles: ["operator"], input: { required: ["target"], properties: { target: "string" }, additionalProperties: false },
      execute: async ({ target }, context) => {
        const runId = String(target);
        const run = this.database.getEntity<JsonValue>("run", runId) as unknown as Run | undefined;
        if (!run || run.state !== "ACTIVE") throw new SemanticPolicyError("INVALID_INPUT", `Run ${runId} is not active`);
        const adapter = this.agentAdapters.get(run.profileId);
        if (!adapter) throw new SemanticPolicyError("INVALID_INPUT", `Profile ${run.profileId} is unavailable`);
        await adapter.pause(run.sessionId);
        assertRunTransition(run.state, "WAITING_USER");
        run.state = "WAITING_USER";
        run.activitySummary = "Paused by operator";
        run.lastActivityAt = new Date().toISOString();
        this.database.saveEntity("run", run.id, json(run));
        const stored = this.database.getCanonicalTask<JsonValue>(run.taskId);
        const task = stored?.document as unknown as Task | undefined;
        if (stored && task?.state === "RUNNING") this.tasks.execute({ id: `semantic:${context.workflowId}`, taskId: run.taskId, baseRevision: stored.revision, actor: context.principal.id, command: { type: "task.transition", state: "WAITING_USER" } });
        this.fleetEvents.publish("run.changed", run.id, { id: run.id, state: run.state, lastActivityAt: run.lastActivityAt });
        return run;
      },
    });
    this.semanticTools.register({
      name: "run.resume", description: "Resume a waiting run in its existing agent session", risk: "privileged", requiredRoles: ["operator"], input: { required: ["target"], properties: { target: "string" }, additionalProperties: false },
      execute: async ({ target }, context) => {
        const runId = String(target);
        const run = this.database.getEntity<JsonValue>("run", runId) as unknown as Run | undefined;
        if (!run || !["WAITING_USER", "RESOURCE_BLOCKED", "RUNNER_UNAVAILABLE", "SUSPECTED_STALL"].includes(run.state)) throw new SemanticPolicyError("INVALID_INPUT", `Run ${runId} is not resumable`);
        const adapter = this.agentAdapters.get(run.profileId);
        if (!adapter) throw new SemanticPolicyError("INVALID_INPUT", `Profile ${run.profileId} is unavailable`);
        await adapter.resume(run.sessionId);
        assertRunTransition(run.state, "ACTIVE");
        run.state = "ACTIVE";
        run.lastActivityAt = new Date().toISOString();
        this.database.saveEntity("run", run.id, json(run));
        const stored = this.database.getCanonicalTask<JsonValue>(run.taskId);
        const task = stored?.document as unknown as Task | undefined;
        if (stored && task && ["WAITING_USER", "WAITING_RESOURCE"].includes(task.state)) this.tasks.execute({ id: `semantic:${context.workflowId}`, taskId: run.taskId, baseRevision: stored.revision, actor: context.principal.id, command: { type: "task.transition", state: "RUNNING" } });
        this.fleetEvents.publish("run.changed", run.id, { id: run.id, state: run.state, lastActivityAt: run.lastActivityAt });
        return run;
      },
    });
    this.semanticTools.register({
      name: "run.reroute", description: "Supersede a run with another configured profile", risk: "privileged", requiredRoles: ["operator"], input: { required: ["target", "profileId"], properties: { target: "string", profileId: "string" }, additionalProperties: false },
      execute: async ({ target, profileId }, context) => {
        const runId = String(target);
        const nextProfileId = String(profileId);
        const run = this.database.getEntity<JsonValue>("run", runId) as unknown as Run | undefined;
        const profile = this.configuration.current().config.agentProfiles.find((entry) => entry.id === nextProfileId);
        const nextAdapter = this.agentAdapters.get(nextProfileId);
        const previousAdapter = run ? this.agentAdapters.get(run.profileId) : undefined;
        const contract = run ? this.database.getTaskContract<JsonValue>(run.taskId) as unknown as TaskContract | undefined : undefined;
        if (!run || isTerminalRunState(run.state) || !run.worktree || !profile || !nextAdapter || !previousAdapter || !contract) throw new SemanticPolicyError("INVALID_INPUT", `Run ${runId} cannot be rerouted to ${nextProfileId}`);
        const session = await nextAdapter.start({ runId: randomUUID(), workspacePath: run.worktree, prompt: contract.goal });
        try { await previousAdapter.cancel(run.sessionId); }
        catch (error) { await nextAdapter.cancel(session.id); throw error; }
        assertRunTransition(run.state, "SUPERSEDED");
        run.state = "SUPERSEDED";
        run.endedAt = new Date().toISOString();
        run.recoveryReason = `Delivery authority revoked for controlled reroute to ${nextProfileId}`;
        this.database.saveEntity("run", run.id, json(run));
        const now = new Date().toISOString();
        this.restoreLeaseAuthority(run);
        this.leaseAuthority.revoke(run.id, run.leaseId, run.generation, `controlled reroute to ${nextProfileId}`, now);
        this.persistLatestLeaseAudit(run.id);
        const rerouted: Run = { ...run, id: session.runId, runnerId: profile.runnerId, providerId: profile.provider, profileId: nextProfileId, sessionId: session.id, ...(session.providerSessionId ? { providerSessionId: session.providerSessionId } : {}), resumePolicy: session.providerSessionId || nextAdapter.manifest.capabilities.resume ? "same-session" : "controlled-reroute", state: "ACTIVE", attempt: run.attempt + 1, generation: run.generation + 1, leaseId: randomUUID(), leaseExpiresAt: new Date(Date.parse(now) + 15 * 60_000).toISOString(), revokedLeaseIds: [...(run.revokedLeaseIds ?? []), run.leaseId], startedAt: now, lastActivityAt: now, verification: { state: "PENDING", commands: [...contract.verification] } };
        delete rerouted.endedAt;
        delete rerouted.failureReason;
        delete rerouted.resourceBlockReason;
        rerouted.recoveryReason = `Controlled reroute from ${run.profileId}; prior lease ${run.leaseId} revoked`;
        delete rerouted.activitySummary;
        delete rerouted.prUrl;
        this.database.saveEntity("run", rerouted.id, json(rerouted));
        this.restoreLeaseAuthority(rerouted);
        const stored = this.database.getCanonicalTask<JsonValue>(run.taskId);
        if (!stored) throw new SemanticPolicyError("INVALID_INPUT", `Unknown task ${run.taskId}`);
        const bound = this.tasks.execute({ id: `semantic:${context.workflowId}:bind`, taskId: run.taskId, baseRevision: stored.revision, actor: context.principal.id, command: { type: "task.set-current-run", runId: rerouted.id } });
        if (["WAITING_USER", "WAITING_RESOURCE"].includes(bound.task.state)) this.tasks.execute({ id: `semantic:${context.workflowId}:running`, taskId: run.taskId, baseRevision: bound.revision, actor: context.principal.id, command: { type: "task.transition", state: "RUNNING" } });
        this.fleetEvents.publish("run.changed", run.id, { id: run.id, state: run.state });
        this.fleetEvents.publish("run.changed", rerouted.id, { id: rerouted.id, state: rerouted.state, profileId: rerouted.profileId });
        return { supersededRunId: run.id, run: rerouted };
      },
    });
    this.semanticTools.register({
      name: "profile.list", description: "List agent profiles", risk: "read", input: { additionalProperties: false },
      execute: async () => this.fleetSnapshot().profiles,
    });
    this.semanticTools.register({
      name: "profile.status", description: "Read an agent profile", risk: "read", input: { required: ["target"], properties: { target: "string" }, additionalProperties: false },
      execute: async ({ target }) => {
        const profile = this.fleetSnapshot().profiles.find((candidate) => candidate.id === String(target));
        if (!profile) throw new SemanticPolicyError("INVALID_INPUT", `Unknown profile ${String(target)}`);
        return profile;
      },
    });
    this.semanticTools.register({
      name: "connector.test", description: "Probe a connector", risk: "write", input: { required: ["target"], properties: { target: "string" }, additionalProperties: false },
      execute: async ({ target }) => {
        const connector = this.connectors.get(String(target));
        if (!connector) throw new SemanticPolicyError("INVALID_INPUT", `Unknown connector ${String(target)}`);
        const probe = await connector.probe();
        connector.instance.health = probe.health;
        connector.instance.updatedAt = probe.checkedAt;
        this.database.saveEntity("connector-health", connector.instance.id, json(probe), probe.checkedAt);
        this.fleetEvents.publish("connector.changed", connector.instance.id, probe);
        return probe;
      },
    });
    this.semanticTools.register({
      name: "integration.test", description: "Probe an integration connector", risk: "write", input: { required: ["target"], properties: { target: "string" }, additionalProperties: false },
      execute: async ({ target }) => {
        const connector = this.connectors.get(String(target));
        if (!connector) throw new SemanticPolicyError("INVALID_INPUT", `Unknown connector ${String(target)}`);
        const probe = await connector.probe();
        connector.instance.health = probe.health;
        connector.instance.updatedAt = probe.checkedAt;
        this.database.saveEntity("connector-health", connector.instance.id, json(probe), probe.checkedAt);
        this.fleetEvents.publish("connector.changed", connector.instance.id, probe);
        return probe;
      },
    });
    this.semanticTools.register({
      name: "llm.test_profile", description: "Probe an Internal LLM profile", risk: "read", input: { required: ["target"], properties: { target: "string" }, additionalProperties: false },
      execute: async ({ target }) => this.llm.probe(String(target), "explicit"),
    });
    this.semanticTools.register({
      name: "config.plan", description: "Build a ConfigPlan without applying it", risk: "write", input: { required: ["config"], properties: { config: "object" }, additionalProperties: false },
      execute: async ({ config }, context) => this.configuration.buildPlan(config, context.principal.id, "assistant"),
    });
    this.semanticTools.register({
      name: "config.build_plan", description: "Build a ConfigPlan without applying it", risk: "write", input: { required: ["config"], properties: { config: "object" }, additionalProperties: false },
      execute: async ({ config }, context) => this.configuration.buildPlan(config, context.principal.id, "assistant"),
    });
    this.semanticTools.register({
      name: "config.apply", description: "Apply a confirmed ConfigPlan", risk: "privileged", requiredRoles: ["admin"], input: { required: ["planId"], properties: { planId: "string" }, additionalProperties: false },
      execute: async ({ planId }) => {
        await assertRequiredSecretsAvailable(this.configuration.proposedConfig(String(planId)), this.secrets);
        return this.configuration.applyPlan(String(planId), { confirmed: true });
      },
    });
    this.semanticTools.register({
      name: "config.apply_plan", description: "Apply a confirmed ConfigPlan", risk: "privileged", requiredRoles: ["admin"], input: { required: ["planId"], properties: { planId: "string" }, additionalProperties: false },
      execute: async ({ planId }) => {
        await assertRequiredSecretsAvailable(this.configuration.proposedConfig(String(planId)), this.secrets);
        return this.configuration.applyPlan(String(planId), { confirmed: true });
      },
    });
    this.semanticTools.register({
      name: "config.rollback", description: "Rollback an applied ConfigPlan", risk: "privileged", requiredRoles: ["admin"], input: { required: ["planId"], properties: { planId: "string" }, additionalProperties: false },
      execute: async ({ planId }) => this.configuration.rollbackPlan(String(planId)),
    });
    this.semanticTools.register({
      name: "secret.request", description: "Request secure input without reading a secret", risk: "write", input: { required: ["namespace", "name"], properties: { namespace: "string", name: "string" }, additionalProperties: false },
      execute: async ({ namespace, name }) => ({ required: true, secureInput: { namespace, name }, acceptsLiteralValue: false }),
    });
  }

  private semanticCandidates(): ResolvableEntity[] {
    const snapshot = this.fleetSnapshot();
    return [
      ...snapshot.tasks.map((task) => ({ id: task.id, kind: "task" as const, label: task.title, aliases: task.externalRefs?.map((reference) => reference.externalId) ?? [] })),
      ...snapshot.runs.map((run) => ({ id: run.id, kind: "run" as const, label: run.id })),
      ...snapshot.profiles.map((profile) => ({ id: profile.id, kind: "profile" as const, label: profile.alias, aliases: [`${profile.provider}:${profile.alias}`] })),
      ...snapshot.connectors.map((connector) => ({ id: connector.id, kind: "connector" as const, label: connector.displayName })),
    ];
  }

  private async parseAssistantIntent(text: string): Promise<TypedIntentV2> {
    const fixed = parseFixedCommand(text);
    if (fixed) return fixed;
    if (/(?:sk-|xox[baprs]-|gh[op]_)[a-z0-9_-]{8,}/i.test(text)) throw new SemanticPolicyError("SECRET_BLOCKED", "Enter credentials through secure input, not the assistant");
    const response = await this.llm.invoke("command_parser", {
      messages: [
        { role: "system", content: `Return a TypedIntentV2 JSON object. Allowed actions: ${this.semanticTools.list().map((tool) => tool.name).join(", ")}. Never infer an entity when it is ambiguous.` },
        { role: "user", content: text.slice(0, 4_000) },
      ],
      jsonSchema: {
        type: "object", additionalProperties: false, required: ["version", "action", "entities", "arguments", "confidence", "source"],
        properties: {
          version: { const: 2 }, action: { type: "string" },
          entities: { type: "array", items: { type: "object", additionalProperties: false, required: ["kind", "value"], properties: { kind: { enum: ["task", "project", "profile", "connector", "run"] }, value: { type: "string" } } } },
          arguments: { type: "object" }, confidence: { type: "number", minimum: 0, maximum: 1 }, source: { const: "assistant" }, expectedRevision: { type: "integer", minimum: 0 },
        },
      },
      temperature: 0,
      maxOutputTokens: 1_000,
    });
    const candidate = response.structured ?? JSON.parse(response.text) as unknown;
    if (!candidate || typeof candidate !== "object") throw new SemanticPolicyError("INVALID_INPUT", "The assistant did not return a typed intent");
    return candidate as TypedIntentV2;
  }

  private async notifyAttention(run: Run): Promise<void> {
    const state = run.state === "RESOURCE_BLOCKED" ? "WAITING_RESOURCE" : run.state === "COMPLETE" && run.prUrl ? "REVIEW_READY" : run.state;
    if (!this.attentionNotifications.shouldNotify({ taskId: run.taskId, state, generation: run.generation })) return;
    const idempotencyKey = `attention:${run.taskId}:${state}:${run.generation}`;
    if (this.database.getEntity<JsonValue>("attention-notification", idempotencyKey)) return;
    const connector = this.connectors.list("messaging").find((entry) => this.messagingChannels.has(entry.instance.id)) as MessagingAdapter | undefined;
    if (!connector) return;
    const channel = this.messagingChannels.get(connector.instance.id)!;
    const task = this.database.getCanonicalTask<JsonValue>(run.taskId)?.document as unknown as Task | undefined;
    const notification: Notification = {
      channel,
      subject: `${state}: ${task?.title ?? run.taskId}`,
      body: run.prUrl ?? run.activitySummary ?? run.failureReason ?? run.resourceBlockReason ?? "Open the thread to inspect or respond.",
      severity: state === "FAILED" ? "critical" : state === "REVIEW_READY" ? "info" : "warning",
      canonicalEntityId: run.taskId,
    };
    const sent = await connector.send(notification, idempotencyKey);
    this.database.saveEntity("attention-notification", idempotencyKey, json({ idempotencyKey, taskId: run.taskId, state, generation: run.generation, externalMessageId: sent.externalMessageId, sentAt: new Date().toISOString() }));
    if (state === "WAITING_USER") {
      this.conversations.bind({ connectorInstanceId: connector.instance.id, conversationId: channel, threadId: sent.externalMessageId, taskId: run.taskId, runId: run.id, sessionId: run.sessionId, generation: run.generation, state: "WAITING_USER" });
    }
  }

  private async notifyOperationalAttention(input: { key: string; state: "SYNC_CONFLICT" | "CONNECTOR_AUTH" | "RUNNER_OFFLINE"; subject: string; body: string; canonicalEntityId?: string }): Promise<void> {
    if (!this.attentionNotifications.shouldNotify({ taskId: input.key, state: input.state, generation: 1 })) return;
    const idempotencyKey = `attention:${input.key}:${input.state}:1`;
    if (this.database.getEntity<JsonValue>("attention-notification", idempotencyKey)) return;
    const connector = this.connectors.list("messaging").find((entry) => this.messagingChannels.has(entry.instance.id)) as MessagingAdapter | undefined;
    if (!connector) return;
    try {
      const sent = await connector.send({ channel: this.messagingChannels.get(connector.instance.id)!, subject: input.subject, body: input.body, severity: "warning", ...(input.canonicalEntityId ? { canonicalEntityId: input.canonicalEntityId } : {}) }, idempotencyKey);
      this.database.saveEntity("attention-notification", idempotencyKey, json({ ...input, idempotencyKey, externalMessageId: sent.externalMessageId, sentAt: new Date().toISOString() }));
    } catch (error) {
      this.app.log.warn({ error: redactValue(error), state: input.state, key: input.key }, "attention notification failed");
    }
  }

  private async handleMessagingMessage(adapter: MessagingAdapter, message: NormalizedMessage): Promise<{ externalMessageId: string }> {
    const principal = this.messagingIdentity.authorize(adapter.instance.id, message.principalExternalId);
    if (/(?:sk-|xox[baprs]-|gh[op]_)[a-z0-9_-]{8,}/i.test(message.text)) {
      const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
      const secureLink = this.secureLinks.issue({ principalId: principal.principalId, expiresAt });
      const text = `Credentials are not accepted in Slack. Use the secure Dashboard input instead: ${secureLink}`;
      return adapter.reply
        ? adapter.reply({ channel: message.conversationId, threadId: message.threadId, text }, `secure-input:${message.idempotencyKey}`)
        : adapter.send({ channel: message.conversationId, subject: "Secure input required", body: text, severity: "warning" }, `secure-input:${message.idempotencyKey}`);
    }
    if (message.action?.id === "workflow.approve") {
      let action: { workflowId?: string; expectedRevision?: number } = {};
      try { action = JSON.parse(message.action.value ?? "{}") as typeof action; } catch { throw new ConnectorError("INVALID_EVENT", "Workflow approval payload is malformed", { retryable: false, operation: "ingress" }); }
      const workflow = action.workflowId ? this.semanticWorkflows.get(action.workflowId) : undefined;
      if (!workflow || action.expectedRevision === undefined || workflow.principal.id !== principal.principalId || workflow.principal.roles.some((role) => !principal.roles.includes(role))) throw new ConnectorError("AUTH", "Workflow approval is not authorized", { retryable: false, operation: "auth" });
      const approved = this.semanticWorkflows.approve(workflow.id, action.expectedRevision);
      const executed = await this.semanticWorkflows.execute(approved.id, approved.revision);
      const text = JSON.stringify(redactValue(executed.result)).slice(0, 3_000);
      return adapter.reply
        ? adapter.reply({ channel: message.conversationId, threadId: message.threadId, text }, `workflow-approval:${message.idempotencyKey}`)
        : adapter.send({ channel: message.conversationId, subject: "Workflow approved", body: text, severity: "info" }, `workflow-approval:${message.idempotencyKey}`);
    }
    const bindingId = `${adapter.instance.id}:${message.conversationId}:${message.threadId}`;
    const binding = this.database.getEntity<JsonValue>("messaging-conversation", bindingId) as unknown as ConversationBinding | undefined;
    if (binding?.state === "WAITING_USER" && binding.sessionId && binding.runId) {
      const expectedRevision = message.action?.expectedRevision ?? binding.revision;
      const generation = message.action?.generation ?? binding.generation;
      this.conversations.resume(bindingId, { expectedRevision, generation });
      const run = this.database.getEntity<JsonValue>("run", binding.runId) as unknown as Run | undefined;
      if (!run || run.generation !== generation || run.sessionId !== binding.sessionId) throw new ConnectorError("CONFLICT", "The referenced run is stale", { retryable: false, operation: "write" });
      const agent = this.agentAdapters.get(run.profileId);
      if (!agent) throw new ConnectorError("PERMANENT", "The run profile is unavailable", { retryable: false, operation: "write" });
      await agent.send(binding.sessionId, message.text || "Continue with the approved action.");
      if (run.state === "WAITING_USER") {
        assertRunTransition(run.state, "ACTIVE");
        run.state = "ACTIVE";
        run.lastActivityAt = new Date().toISOString();
        this.database.saveEntity("run", run.id, json(run));
      }
      return adapter.reply
        ? adapter.reply({ channel: message.conversationId, threadId: message.threadId, text: `Resumed run ${run.id} in the existing agent session.` }, `resume:${message.idempotencyKey}`)
        : adapter.send({ channel: message.conversationId, subject: "Run resumed", body: run.id, severity: "info" }, `resume:${message.idempotencyKey}`);
    }
    const intent = await this.parseAssistantIntent(message.text);
    let workflow = this.semanticWorkflows.plan({
      id: randomUUID(),
      intent,
      principal: { id: principal.principalId, roles: principal.roles, channel: "messaging" },
      candidates: this.semanticCandidates(),
    });
    if (workflow.state === "READY") workflow = await this.semanticWorkflows.execute(workflow.id, workflow.revision);
    const text = workflow.state === "EXECUTED"
      ? JSON.stringify(redactValue(workflow.result)).slice(0, 3_000)
      : workflow.state === "NEEDS_APPROVAL"
        ? `Approval required for ${workflow.toolName}. Open the Dashboard or use the bound approval action.`
        : workflow.questions.join(" ") || `Workflow state: ${workflow.state}`;
    const blocks = workflow.state === "NEEDS_APPROVAL"
      ? [{ type: "actions", elements: [{ type: "button", action_id: "workflow.approve", text: { type: "plain_text", text: "Approve" }, style: "primary", value: JSON.stringify({ workflowId: workflow.id, expectedRevision: workflow.revision }) }] }]
      : undefined;
    return adapter.reply
      ? adapter.reply({ channel: message.conversationId, threadId: message.threadId, text, ...(blocks ? { blocks } : {}) }, `workflow:${message.idempotencyKey}`)
      : adapter.send({ channel: message.conversationId, subject: "Dispatcher", body: text, severity: "info" }, `workflow:${message.idempotencyKey}`);
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

    this.app.get<{ Querystring: { ticket?: string } }>("/auth/messaging", async (request, reply) => {
      if (!request.query.ticket) return reply.code(400).send({ code: "MESSAGING_TICKET_REQUIRED" });
      const verified = this.secureLinks.verify(request.query.ticket);
      return reply.redirect(`/config?secureInput=1&principal=${encodeURIComponent(verified.principalId)}`);
    });

    this.app.get("/api/runners", async () => ({ runners: this.runners.list() }));
    this.app.post<{ Params: { id: string }; Body: { ttlMs?: number } }>("/api/runners/:id/enrollment", async (request, reply) => {
      const runner = this.configuration.current().config.runners.find((candidate) => candidate.id === request.params.id && candidate.mode === "remote");
      if (!runner) return reply.code(404).send({ code: "REMOTE_RUNNER_NOT_FOUND" });
      const issued = this.enrollments.issue(runner.id, request.body?.ttlMs);
      return reply.code(201).send({ runnerId: runner.id, token: issued.token, expiresAt: issued.record.expiresAt });
    });
    this.app.post<{ Body: RunnerEnrollmentBody }>("/api/runners/enroll", async (request, reply) => {
      if (!request.body?.runnerId || !request.body.token) return reply.code(400).send({ code: "ENROLLMENT_INPUT_REQUIRED" });
      const runner = this.configuration.current().config.runners.find((candidate) => candidate.id === request.body!.runnerId && candidate.mode === "remote");
      if (!runner?.credentialRef) return reply.code(404).send({ code: "REMOTE_RUNNER_NOT_FOUND" });
      try {
        this.enrollments.consume(runner.id, request.body.token);
      } catch (error) {
        return reply.code(401).send({ code: "ENROLLMENT_REJECTED", message: error instanceof Error ? error.message : "Enrollment rejected" });
      }
      const bearerToken = randomBytes(32).toString("base64url");
      await this.secrets.put(runner.credentialRef, bearerToken);
      this.database.saveEntity("runner-identity", runner.id, json({ runnerId: runner.id, credentialRef: runner.credentialRef, enrolledAt: new Date().toISOString() }));
      return reply.code(201).send({ runnerId: runner.id, credentialRef: runner.credentialRef, bearerToken, protocolVersion: "1.2" });
    });
    this.app.get("/api/adapters/manifests", async () => ({ manifests: [genericMockManifest, genericCliManifest, codexManifest, qoderManifest] }));
    this.app.get("/api/agents/profiles", async () => ({
      profiles: this.configuration.current().config.agentProfiles.map((profile) => ({
        id: profile.id,
        provider: profile.provider,
        alias: profile.alias,
        runnerId: profile.runnerId,
        state: this.agentAdapters.has(profile.id) ? "CONFIGURED" : "UNAVAILABLE",
        resourceState: this.profileResourceState(profile.id),
      })),
      sessions: this.database.listEntities<JsonValue>("adapter-session").map((value) => {
        const session = value as Record<string, JsonValue>;
        return { id: session.id, runId: session.runId, profileId: session.profileId, state: session.state, updatedAt: session.updatedAt };
      }),
    }));
    this.app.get("/api/resources", async () => ({
      resources: this.configuration.current().config.agentProfiles.map((profile) => {
        const assessment = this.resourceRegistry.assess(profile.id);
        const affectedTasks = this.database.listEntities<JsonValue>("run").map((value) => value as unknown as Run)
          .filter((run) => run.profileId === profile.id && run.state === "RESOURCE_BLOCKED").map((run) => run.taskId);
        return { ...assessment, affectedTasks: [...new Set(affectedTasks)].sort() };
      }),
      schedules: this.resourceProbes.list(),
    }));
    this.app.post<{ Params: { profileId: string } }>("/api/resources/:profileId/probe", async (request, reply) => {
      if (!this.agentAdapters.has(request.params.profileId)) return reply.code(404).send({ code: "PROFILE_NOT_FOUND" });
      const snapshot = await this.probeProfileResource(request.params.profileId);
      if (!snapshot) return reply.code(409).send({ code: "RESOURCE_PROBE_UNAVAILABLE" });
      return { snapshot, assessment: this.resourceRegistry.assess(request.params.profileId), schedules: this.resourceProbes.list().filter((entry) => entry.profileId === request.params.profileId) };
    });
    this.app.post<{ Params: { profileId: string } }>("/api/resources/:profileId/recover", async (request, reply) => {
      const assessment = this.resourceRegistry.assess(request.params.profileId);
      if (!["AVAILABLE", "LOW"].includes(assessment.state)) return reply.code(409).send({ code: "RESOURCE_NOT_READY", assessment });
      return { assessment, recoveries: await this.recoverProfileRuns(request.params.profileId, assessment) };
    });
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
    this.app.post<{ Body: QoderProfileBody }>("/api/agents/qoder/discover", async (request, reply) => {
      if (!request.body?.alias) return reply.code(400).send({ code: "QODER_PROFILE_REQUIRED" });
      return probeQoderProfile({
        id: request.body.id ?? "discovered-qoder",
        alias: request.body.alias,
        ...(request.body.executable ? { executable: request.body.executable } : {}),
        ...(request.body.configDir ? { configDir: request.body.configDir } : {}),
        ...(request.body.model ? { model: request.body.model } : {}),
      });
    });
    this.app.post<{ Body: QoderProfileBody }>("/api/agents/qoder/profiles", async (request, reply) => {
      const body = request.body;
      if (!body?.id || !body.alias) return reply.code(400).send({ code: "QODER_PROFILE_REQUIRED" });
      const current = this.configuration.current();
      if (current.config.agentProfiles.some((profile) => profile.id === body.id)) return reply.code(409).send({ code: "PROFILE_EXISTS" });
      const discovery = await probeQoderProfile({ id: body.id, alias: body.alias, ...(body.executable ? { executable: body.executable } : {}), ...(body.configDir ? { configDir: body.configDir } : {}), ...(body.model ? { model: body.model } : {}) });
      if (!discovery.selected) return reply.code(409).send({ code: "QODER_SELECTION_REQUIRED", candidates: discovery.candidates });
      if (!discovery.selected.authenticated) return reply.code(409).send({ code: "QODER_AUTH_REQUIRED", candidate: discovery.selected });
      const next = structuredClone(current.config);
      next.agentProfiles.push({
        id: body.id,
        provider: "qoder",
        alias: body.alias,
        runnerId: body.runnerId ?? "local",
        settings: { executable: discovery.selected.executable, ...(body.configDir ? { configDir: body.configDir } : {}), ...(body.model ? { model: body.model } : {}) },
      });
      const plan = this.configuration.buildPlan(next, "local-web", "web");
      const applied = this.configuration.applyPlan(plan.id, { confirmed: true });
      return reply.code(201).send({ profile: { id: body.id, provider: "qoder", alias: body.alias, runnerId: body.runnerId ?? "local", state: "CONFIGURED" }, discovery: discovery.selected, revision: applied.revision });
    });
    this.app.post<{ Params: { id: string } }>("/api/agents/profiles/:id/test", async (request, reply) => {
      const profile = this.configuration.current().config.agentProfiles.find((entry) => entry.id === request.params.id);
      const codexHome = stringSetting(profile?.settings?.codexHome);
      if (!profile) return reply.code(404).send({ code: "PROFILE_NOT_FOUND" });
      if (profile.provider === "codex" && codexHome) return probeCodexProfile({
        id: profile.id,
        alias: profile.alias,
        codexHome,
        ...(stringSetting(profile.settings?.executable) ? { executable: stringSetting(profile.settings?.executable)! } : {}),
        ...(stringSetting(profile.settings?.model) ? { model: stringSetting(profile.settings?.model)! } : {}),
      });
      if (profile.provider === "qoder") return probeQoderProfile({
        id: profile.id,
        alias: profile.alias,
        ...(stringSetting(profile.settings?.executable) ? { executable: stringSetting(profile.settings?.executable)! } : {}),
        ...(stringSetting(profile.settings?.configDir) ? { configDir: stringSetting(profile.settings?.configDir)! } : {}),
        ...(stringSetting(profile.settings?.model) ? { model: stringSetting(profile.settings?.model)! } : {}),
      });
      return reply.code(409).send({ code: "PROFILE_UNSUPPORTED" });
    });
    this.app.post<{ Params: { id: string }; Body: CodexRunBody }>("/api/agents/profiles/:id/runs", async (request, reply) => {
      if (!request.body?.workspacePath || !request.body.prompt) return reply.code(400).send({ code: "RUN_INPUT_REQUIRED" });
      if (!this.workspaces.get(request.body.workspacePath)) return reply.code(400).send({ code: "UNMANAGED_WORKSPACE", message: "Agent runs must use a Dispatcher-managed worktree" });
      const adapter = this.agentAdapters.get(request.params.id);
      if (!adapter) return reply.code(404).send({ code: "PROFILE_NOT_FOUND" });
      const session = await adapter.start({ runId: randomUUID(), workspacePath: request.body.workspacePath, prompt: request.body.prompt });
      return reply.code(201).send({ session: this.sessionView(session) });
    });
    this.app.get<{ Params: { profileId: string; sessionId: string } }>("/api/agents/profiles/:profileId/sessions/:sessionId", async (request, reply) => {
      const adapter = this.agentAdapters.get(request.params.profileId);
      if (!adapter) return reply.code(404).send({ code: "PROFILE_NOT_FOUND" });
      return { session: this.sessionView(await adapter.status(request.params.sessionId)) };
    });
    this.app.post<{ Params: { profileId: string; sessionId: string }; Body: { message?: string } }>("/api/agents/profiles/:profileId/sessions/:sessionId/input", async (request, reply) => {
      if (!request.body?.message) return reply.code(400).send({ code: "MESSAGE_REQUIRED" });
      const adapter = this.agentAdapters.get(request.params.profileId);
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
        this.fleetEvents.publish("run.changed", run.id, { id: run.id, state: run.state, lastActivityAt: run.lastActivityAt });
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
      const probe = await connector.probe();
      connector.instance.health = probe.health;
      connector.instance.updatedAt = probe.checkedAt;
      this.database.saveEntity("connector-health", connector.instance.id, json(probe), probe.checkedAt);
      this.fleetEvents.publish("connector.changed", connector.instance.id, probe);
      if (probe.health === "AUTH_REQUIRED") await this.notifyOperationalAttention({ key: connector.instance.id, state: "CONNECTOR_AUTH", subject: `Connector authentication required: ${connector.instance.displayName}`, body: probe.message ?? "Open Integrations to repair credentials." });
      return { probe };
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
      if (result.conflicts.length) await this.notifyOperationalAttention({ key: request.params.id, state: "SYNC_CONFLICT", subject: `Sync conflicts: ${adapter.instance.displayName}`, body: `${result.conflicts.length} conflict(s) require recovery in Integrations.` });
      return { applied, conflicts: result.conflicts.length, cursor: result.cursor ?? null };
    });
    this.app.post<{ Params: { id: string } }>("/api/connectors/:id/webhook", async (request, reply) => {
      const adapter = this.connectors.get(request.params.id);
      if (!adapter) return reply.code(404).send({ code: "CONNECTOR_NOT_FOUND" });
      const raw = this.rawWebhookBodies.get(request);
      if (!raw) return reply.code(400).send({ code: "RAW_WEBHOOK_REQUIRED" });
      const headers = Object.fromEntries(Object.entries(request.headers).flatMap(([key, value]) => typeof value === "string" ? [[key, value]] : []));
      if (adapter.instance.kind === "task") {
        const taskAdapter = adapter as TaskPlatformAdapter;
        const event = await taskAdapter.ingress(raw, headers);
        const result = event.entityType === "task" ? await this.processExternalTaskEvent(taskAdapter, event) : { duplicate: !this.tasks.ingest(event) };
        if (event.entityType === "task") this.fleetEvents.publish("task.changed", event.externalEntityId, { connectorId: event.connectorInstanceId, action: event.action });
        return reply.code(202).send({ accepted: true, duplicate: result.duplicate, eventId: event.externalEventId });
      }
      if (adapter.instance.kind === "messaging") {
        const messaging = adapter as MessagingAdapter;
        if (!messaging.ingress) return reply.code(409).send({ code: "MESSAGING_INGRESS_UNSUPPORTED" });
        const ingress = await messaging.ingress(raw, headers);
        if (ingress.kind === "challenge") return { challenge: ingress.challenge };
        if (ingress.kind === "ignored" || !ingress.message) return reply.code(202).send({ accepted: true, ignored: true });
        const existing = this.database.getEntity<JsonValue>("messaging-inbox", ingress.message.idempotencyKey) as { status?: string; replyId?: string } | undefined;
        if (existing?.status === "PROCESSED") return reply.code(202).send({ accepted: true, duplicate: true, eventId: ingress.message.externalMessageId, replyId: existing.replyId });
        const receivedAt = new Date().toISOString();
        const inboxMessage = /(?:sk-|xox[baprs]-|gh[op]_)[a-z0-9_-]{8,}/i.test(ingress.message.text) ? { ...ingress.message, text: "[REDACTED]" } : ingress.message;
        this.database.saveEntity("messaging-inbox", ingress.message.idempotencyKey, json({ status: "RECEIVED", message: inboxMessage, receivedAt }), receivedAt);
        try {
          const sent = await this.handleMessagingMessage(messaging, ingress.message);
          this.database.saveEntity("messaging-inbox", ingress.message.idempotencyKey, json({ status: "PROCESSED", message: inboxMessage, receivedAt, processedAt: new Date().toISOString(), replyId: sent.externalMessageId }));
          return reply.code(202).send({ accepted: true, eventId: ingress.message.externalMessageId, replyId: sent.externalMessageId });
        } catch (error) {
          this.database.saveEntity("messaging-inbox", ingress.message.idempotencyKey, json({ status: "FAILED", message: inboxMessage, receivedAt, failedAt: new Date().toISOString(), error: error instanceof Error ? error.message : "messaging workflow failed" }));
          throw error;
        }
      }
      return reply.code(409).send({ code: "WEBHOOK_UNSUPPORTED" });
    });
    this.app.post<{ Params: { id: string }; Body: MessagingIdentityBody }>("/api/connectors/:id/messaging-identities", async (request, reply) => {
      const adapter = this.connectors.get(request.params.id);
      if (!adapter || adapter.instance.kind !== "messaging") return reply.code(404).send({ code: "CONNECTOR_NOT_FOUND" });
      if (!request.body?.externalPrincipalId || !request.body.principalId || !request.body.roles?.length) return reply.code(400).send({ code: "IDENTITY_BINDING_REQUIRED" });
      return reply.code(201).send({ binding: this.messagingIdentity.link({ connectorInstanceId: request.params.id, externalPrincipalId: request.body.externalPrincipalId, principalId: request.body.principalId, roles: request.body.roles }) });
    });
    this.app.delete<{ Params: { id: string; externalPrincipalId: string } }>("/api/connectors/:id/messaging-identities/:externalPrincipalId", async (request) => ({
      binding: this.messagingIdentity.revoke(request.params.id, request.params.externalPrincipalId),
    }));

    this.app.get("/api/fleet", async () => ({ snapshot: this.fleetSnapshot() }));
    this.app.get<{ Querystring: { offset?: string; limit?: string; projectId?: string; taskId?: string; profileId?: string; state?: string } }>("/api/fleet/tasks", async (request) => {
      const snapshot = this.fleetSnapshot();
      const filtered = snapshot.tasks.filter((task) =>
        (!request.query.projectId || task.projectId === request.query.projectId)
        && (!request.query.taskId || task.id === request.query.taskId)
        && (!request.query.profileId || task.profileId === request.query.profileId)
        && (!request.query.state || task.state === request.query.state));
      return { page: paginate(filtered, { offset: Number(request.query.offset ?? 0), limit: Number(request.query.limit ?? 50) }), cursor: snapshot.cursor };
    });
    this.app.get<{ Querystring: { offset?: string; limit?: string; taskId?: string; profileId?: string; state?: string } }>("/api/fleet/runs", async (request) => {
      const snapshot = this.fleetSnapshot();
      const filtered = snapshot.runs.filter((run) =>
        (!request.query.taskId || run.taskId === request.query.taskId)
        && (!request.query.profileId || run.profileId === request.query.profileId)
        && (!request.query.state || run.state === request.query.state));
      return { page: paginate(filtered, { offset: Number(request.query.offset ?? 0), limit: Number(request.query.limit ?? 50) }), cursor: snapshot.cursor };
    });
    this.app.get("/api/fleet/connectors", async () => {
      const snapshot = this.fleetSnapshot();
      return { connectors: snapshot.connectors, cursor: snapshot.cursor };
    });

    this.app.get("/api/tasks", async () => ({ tasks: this.database.listCanonicalTasks<JsonValue>() }));
    this.app.get<{ Params: { id: string } }>("/api/tasks/:id", async (request, reply) => {
      const task = this.database.getCanonicalTask<JsonValue>(request.params.id);
      if (!task) return reply.code(404).send({ code: "TASK_NOT_FOUND" });
      return { ...task, contract: this.database.getTaskContract<JsonValue>(request.params.id), deliveries: this.database.listDeliveryEvidence<JsonValue>(request.params.id) };
    });
    this.app.post<{ Params: { id: string }; Body: TaskDispatchBody }>("/api/tasks/:id/dispatch", async (request, reply) => {
      const stored = this.database.getCanonicalTask<JsonValue>(request.params.id);
      const contract = this.database.getTaskContract<JsonValue>(request.params.id) as unknown as TaskContract | undefined;
      if (!stored || !contract) return reply.code(404).send({ code: "TASK_NOT_FOUND" });
      if (request.body?.profileId && !this.agentAdapters.has(request.body.profileId)) return reply.code(404).send({ code: "PROFILE_NOT_FOUND" });
      const runners = new Map(this.runners.list().map((runner) => [runner.id, runner]));
      const profiles = this.configuration.current().config.agentProfiles.filter((profile) => !request.body?.profileId || profile.id === request.body.profileId);
      const repositoryId = request.body?.repositoryId ?? contract.delivery.repository;
      const repositoryConfig = this.configuration.current().config.repositories.find((entry) => entry.id === repositoryId);
      if (!repositoryId || !repositoryConfig) return reply.code(409).send({ code: "REPOSITORY_UNAVAILABLE", message: "The task repository is not registered" });
      const activeRuns = this.database.listEntities<JsonValue>("run").map((value) => value as unknown as Run).filter((run) => run.state === "ACTIVE");
      const scheduler = new CanonicalScheduler(() => profiles.flatMap((profile) => {
        const runner = runners.get(profile.runnerId);
        const adapter = this.agentAdapters.get(profile.id);
        if (!runner || !adapter) return [];
        return [{
          runnerId: runner.id,
          runnerTags: runner.capabilities,
          capacity: runner.state === "ONLINE" || runner.state === "DEGRADED" ? runner.capacity : 0,
          activeRuns: activeRuns.filter((run) => run.runnerId === runner.id).length,
          providerId: profile.provider,
          profileId: profile.id,
          resourceState: this.profileResourceState(profile.id),
          capabilities: ["code", "git", "session-resume", ...runner.capabilities],
          adapter,
        }];
      }));
      const runId = randomUUID();
      const workspace = await this.workspaces.create({
        repositoryId,
        taskId: request.params.id,
        runId,
        attempt: 1,
        baseRef: request.body?.baseRef ?? contract.delivery.baseBranch ?? repositoryConfig.defaultBaseRef,
        scopePaths: repositoryConfig.scopePaths,
      });
      let dispatched: Awaited<ReturnType<CanonicalScheduler["dispatch"]>>;
      try {
        dispatched = await scheduler.dispatch({
          task: stored.document as unknown as Task,
          taskRevision: stored.revision,
          contract,
          requirements: {
            capabilities: ["code", "git", ...(request.body?.capabilities ?? [])],
            ...(request.body?.runnerTags?.length ? { runnerTags: request.body.runnerTags } : {}),
            ...(request.body?.providerIds?.length ? { providerIds: request.body.providerIds } : {}),
          },
          workspacePath: workspace.path,
          runId,
        });
      } catch (error) {
        const cleanup = await this.workspaces.cleanupPlan(workspace);
        if (cleanup.safe) await this.workspaces.cleanup(cleanup);
        throw error;
      }
      dispatched.run.branch = workspace.branch;
      dispatched.run.leaseExpiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
      this.database.saveEntity("run", dispatched.run.id, json(dispatched.run));
      this.restoreLeaseAuthority(dispatched.run);
      this.fleetEvents.publish("run.changed", dispatched.run.id, { id: dispatched.run.id, taskId: dispatched.run.taskId, state: dispatched.run.state });
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
      this.fleetEvents.publish("run.changed", advanced.run.id, { id: advanced.run.id, taskId: advanced.run.taskId, state: advanced.run.state, lastActivityAt: advanced.run.lastActivityAt });
      try { await this.notifyAttention(advanced.run); }
      catch (error) { this.app.log.error({ error: redactValue(error), runId: advanced.run.id }, "attention notification failed"); }
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

    this.app.get("/api/assistant/tools", async () => ({ tools: this.semanticTools.list(), mode: this.llm.snapshot().state.mode }));
    this.app.post<{ Body: AssistantPlanBody }>("/api/assistant/workflows", async (request, reply) => {
      if (!request.body?.intent && !request.body?.text) return reply.code(400).send({ code: "INTENT_REQUIRED" });
      const intent = request.body.intent ?? await this.parseAssistantIntent(request.body.text!);
      const workflow = this.semanticWorkflows.plan({
        id: randomUUID(),
        intent,
        principal: { id: request.body.actor ?? "local-web", roles: request.body.roles ?? ["admin"], channel: request.body.channel ?? "web" },
        candidates: this.semanticCandidates(),
      });
      return reply.code(201).send({ workflow, mode: this.llm.snapshot().state.mode });
    });
    this.app.get<{ Params: { id: string } }>("/api/assistant/workflows/:id", async (request, reply) => {
      const workflow = this.database.getEntity<JsonValue>("semantic-workflow", request.params.id);
      if (!workflow) return reply.code(404).send({ code: "WORKFLOW_NOT_FOUND" });
      return { workflow };
    });
    this.app.post<{ Params: { id: string }; Body: { revision?: number } }>("/api/assistant/workflows/:id/approve", async (request, reply) => {
      if (!Number.isInteger(request.body?.revision)) return reply.code(400).send({ code: "WORKFLOW_REVISION_REQUIRED" });
      return { workflow: this.semanticWorkflows.approve(request.params.id, request.body!.revision!) };
    });
    this.app.post<{ Params: { id: string }; Body: { revision?: number } }>("/api/assistant/workflows/:id/execute", async (request, reply) => {
      if (!Number.isInteger(request.body?.revision)) return reply.code(400).send({ code: "WORKFLOW_REVISION_REQUIRED" });
      return { workflow: await this.semanticWorkflows.execute(request.params.id, request.body!.revision!) };
    });
    this.app.post<{ Params: { id: string }; Body: { revision?: number; intent?: TypedIntentV2 } }>("/api/assistant/workflows/:id/clarify", async (request, reply) => {
      if (!Number.isInteger(request.body?.revision) || !request.body?.intent) return reply.code(400).send({ code: "CLARIFICATION_REQUIRED" });
      return { workflow: this.semanticWorkflows.clarify(request.params.id, request.body.revision!, request.body.intent, this.semanticCandidates()) };
    });

    this.app.get<{ Querystring: { cursor?: string } }>("/api/events", async (request, reply) => {
      reply.hijack();
      const response = reply.raw;
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      this.dashboardClients += 1;
      const headerCursor = Number(request.headers["last-event-id"] ?? request.query.cursor ?? 0);
      const replay = this.fleetEvents.since(Number.isFinite(headerCursor) ? headerCursor : 0);
      response.write(`event: ready\ndata: ${JSON.stringify({ connected: true, cursor: replay.cursor, reset: replay.reset })}\n\n`);
      if (replay.reset) response.write(`event: fleet.reset\ndata: ${JSON.stringify({ snapshot: this.fleetSnapshot() })}\n\n`);
      for (const event of replay.events) response.write(`id: ${event.cursor}\nevent: ${event.type}\ndata: ${JSON.stringify(redactValue(event.payload))}\n\n`);
      const unsubscribe = this.fleetEvents.subscribe((event) => {
        response.write(`id: ${event.cursor}\nevent: ${event.type}\ndata: ${JSON.stringify(redactValue(event.payload))}\n\n`);
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
      const semanticStatus = error instanceof SemanticPolicyError
        ? error.code === "FORBIDDEN" ? 403 : error.code === "STALE_WORKFLOW" ? 409 : 400
        : undefined;
      const status = error instanceof RevisionConflictError
        ? 409
        : error instanceof LlmRuntimeError
          ? error.code === "NO_AVAILABLE_PROFILE" ? 503 : 400
        : error instanceof ConfigPlanError || error instanceof ConfigValidationError
          ? 400
          : semanticStatus ?? workspaceStatus ?? connectorStatus ?? secretStatus ?? 500;
      const code = error instanceof RevisionConflictError || error instanceof ConfigPlanError || error instanceof SecretStoreError || error instanceof LlmRuntimeError || error instanceof ConnectorError || error instanceof WorkspacePolicyError || error instanceof SemanticPolicyError
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
