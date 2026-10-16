import { resolveProfileExecutionContext } from "./execution-context.js";
import { ProfileProbeService } from "./profile-probes.js";
import {RunInputReceipts,InputReceiptError,type RunInputIdentity} from "./run-inputs.js";
import {UsageObservations,UsageObservationError} from "./usage-observations.js";
import {buildDiagnostics,diagnosticChecks} from "./diagnostics.js";
import type { ProfileConsoleView,DeliveryEvidence } from "@dispatcher/domain";
import { applyConfigEdits, consoleConfig, consoleConfigPlan } from "./config-edits.js";
import {qualifyRoutingPolicy,type PolicyConfigEvidence} from "./policy-config.js";
import {TaskClassifier} from "./task-classifier.js";
import { remoteCatalog, remoteRunInventory } from "./remote-results.js";
import { RemoteNativeAdapter } from "./remote-adapter.js";
import { NATIVE_EXECUTION_CAPABILITY, type CommandPayload } from "@dispatcher/protocol";
import { ModelRoutingService } from "./model-routing.js";
import type { WorkspaceHandle } from "@dispatcher/workspace";
import { PublicationService, PublicationError, contentHash, assertPublicationScope, type PublicationRecord } from "./task-publications.js";
import { publishDraftSchema, type PublishDraftV1, type ExecutionSelection, type AccountModelCatalog, type ModelCatalogContext } from "@dispatcher/domain";
import { projectViews, publicWebUrl } from "./console-projection.js";
import { existsSync, statSync } from "node:fs";
import { PassThrough } from "node:stream";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { arch, platform } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import {
  CodexAdapter,
  createNativeProfileAdapter,
  probeNativeProfile,
  codexManifest,
  QoderAdapter,
  qoderManifest,
  cursorManifest,
  StructuredCliAdapter,
  AdapterContractError,
  kiroManifest,
  antigravityManifest, zcodeManifest, workbuddyCliManifest, qoderCnManifest,
  opencodeManifest,
  grokManifest,
  piManifest,
  isNativeCliProvider,
  probeNativeCliProfile,
  DevinAdapter,
  devinManifest,
  LocalServiceAdapter,
  localServiceManifest,
  GenericCliAdapter,
  genericCliManifest,
  genericMockManifest,
  buildAdapterCompatibilityMatrix,
  manifestCapabilities,
  assessManifestCapabilities,
  probeCodexProfile,
  probeQoderProfile,
  probeCursorProfile,
  probeKiroProfile,
  probeDevinProfile,
  probeLocalService,
  probeGenericCli,
  type AgentAdapter,
  type AdapterSession,
  type SessionStore,
  type CodexBackend,
  type CodexReadRequest,
  type CodexProfileConfig,
  type QoderBackend,
  type QoderProfileConfig,
  type CliAgentBackend,
  type CliAgentProfile,
  type NativeCliProvider,
  type DevinBackend,
  type DevinProfileConfig,
  type LocalServiceProfileConfig,
  type ProcessExecutor,
} from "@dispatcher/adapters";
import {
  assertRequiredSecretsAvailable,
  ConfigurationEngine,
  repositoryRunnerId,
  ConfigPlanError,
  ConfigValidationError,
  createDefaultSecretStore,
  dispatcherConfigSchema,
  validateConfig,
  dispatcherConfigUiSchema,
  requiredSecretReferences,
  SecretStoreError,
  type SecretMetadata,
  type SecretStore,
  type DispatcherConfig,
  type AgentProfileConfig,
  type RepositoryConfig,
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
  type Project,
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
import { EmbeddedRunner, EventBus, LeaseFenceError, ProcessManager, RemoteRunnerServer, RunnerEnrollmentAuthority, RunnerLeaseAuthority, RunnerRegistry, VerificationRegistry, reconcileRunnerState, type RunnerEnrollmentRecord, type RunnerEvents } from "@dispatcher/runner";
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
import { CanonicalScheduler, routeDeterministically, type DispatchCandidate } from "@dispatcher/scheduler";
import { RepositoryRegistry, WorkspaceManager, WorkspacePolicyError } from "@dispatcher/workspace";
import { BackgroundLoop, backoffDelayMs, runBounded } from "./background.js";
import { ControlPlaneAuth, OWNER_PASSWORD_REFERENCE, OWNER_PRINCIPAL_ID, OWNER_ROLES, OWNER_TOKEN_REFERENCE, type ControlPrincipal } from "./control-auth.js";
import { hashOwnerPassword, validOwnerPassword } from "./owner-password.js";
import { LifecycleManager, type ServiceModule } from "./lifecycle.js";
import { MESSAGING_INBOX_KIND, MessagingInbox, type MessagingInboxRecord } from "./messaging-inbox.js";

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
  codexNativeReader?: (input:CodexReadRequest)=>Promise<unknown>;
  codexBackendFactory?: (profile: CodexProfileConfig) => CodexBackend;
  qoderBackendFactory?: (profile: QoderProfileConfig) => QoderBackend;
  cliBackendFactory?: (provider: "cursor" | "kiro" | NativeCliProvider, profile: CliAgentProfile) => CliAgentBackend;
  devinBackendFactory?: (profile: DevinProfileConfig) => DevinBackend;
  modules?: ServiceModule[];
  ownerToken?: string;
  allowedHosts?: string[];
  clock?: () => Date;
  profileProbeExecutor?:(profile:AgentProfileConfig,repository?:RepositoryConfig)=>Promise<unknown>;
  backgroundWorker?: BackgroundWorkerOptions;
}

export interface BackgroundWorkerOptions {
  enabled?: boolean;
  intervalMs?: number;
  maxConcurrentRuns?: number;
  inboxBatchSize?: number;
  inboxMaxAttempts?: number;
  inboxBaseDelayMs?: number;
  inboxMaxDelayMs?: number;
  runBaseDelayMs?: number;
  runMaxDelayMs?: number;
}

type TaskDispatchResult = { run: Run; routing: { explanation: string; eligible: unknown[]; rejected: unknown[] } };
class TaskDispatchError extends Error {
  constructor(readonly code: string, readonly statusCode: number, message: string) { super(message); }
}

type AdvanceResult = { waiting: boolean; run: Run; task: Task; deliveries: JsonValue[] };
interface MessagingResumeReceipt {
  version: 1;
  runId: string;
  sessionId: string;
  generation: number;
  interventionRevision: number;
  principalId: string;
  connectorInstanceId: string;
  conversationId: string;
  threadId: string;
}
interface DeliveryFeedback {
  version: 1;
  id: string;
  runId: string;
  generation: number;
  body: string;
  severity: Notification["severity"];
  status: "PENDING" | "SENT" | "OBSOLETE";
  failures: number;
  nextAttemptAt: string;
}

const CREDENTIAL_PATTERN = /(?:sk-|xox[baprs]-|gh[op]_)[a-z0-9_-]{8,}/i;
const ADVANCEABLE_RUN_STATES = new Set<Run["state"]>(["ACTIVE", "VERIFYING", "DELIVERING"]);

class DatabaseSessionStore implements SessionStore {
  constructor(private readonly database: DispatcherDatabase,private readonly beforeSpawn?:(session:AdapterSession)=>void) {}
  load(id: string): AdapterSession | undefined {
    const value = this.database.getEntity<JsonValue>("adapter-session", id);
    return value as unknown as AdapterSession | undefined;
  }
  save(session: AdapterSession): void {
    if(session.state==="STARTING")this.beforeSpawn?.(session);
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

function stringArraySetting(value: JsonValue | undefined): string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : undefined;
}

interface SecretBody {
  value?: string;
}

interface ConfigPlanBody {
  baseRevision?: number;
  config?: unknown;
  edits?: unknown;
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

interface ProfilePlanOptions { previewOnly?: boolean; baseRevision?: number }

interface CodexProfileBody extends ProfilePlanOptions {
  enabled?: boolean;
  id?: string;
  alias?: string;
  runnerId?: string;
  codexHome?: string;
  executable?: string;
  model?: string;
}

interface QoderProfileBody extends ProfilePlanOptions {
  id?: string;
  alias?: string;
  runnerId?: string;
  executable?: string;
  configDir?: string;
  model?: string;
}

interface EcosystemProfileBody extends ProfilePlanOptions {
  trustWorkspace?: boolean;
  enabled?: boolean;
  configDir?: string;
  id?: string;
  alias?: string;
  runnerId?: string;
  credentialRef?: string;
  executable?: string;
  model?: string;
  approveTools?: boolean;
  organizationId?: string;
  apiBase?: string;
  maxSessionAcu?: number;
  provider?: "workbuddy" | "codebuddy";
  baseUrl?: string;
  healthPath?: string;
  startPath?: string;
  statusPath?: string;
  inputPath?: string;
  cancelPath?: string;
  resourcePath?: string;
  args?: string[];
  mode?: "headless" | "pty";
}

interface CodexRunBody {
  prompt?: string;
  workspacePath?: string;
}

interface TaskDispatchBody {
  profileId?: string;
  execution?: PublishDraftV1["execution"];
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

const adapterManifests = [genericMockManifest, genericCliManifest, codexManifest, qoderManifest, cursorManifest, devinManifest, kiroManifest, localServiceManifest, opencodeManifest, grokManifest, piManifest, antigravityManifest, zcodeManifest, workbuddyCliManifest, qoderCnManifest] as const;

function manifestForProvider(provider: string) {
  if (provider === "workbuddy" || provider === "codebuddy") return localServiceManifest;
  return adapterManifests.find((manifest) => manifest.id === provider);
}

function localServiceProfile(body: EcosystemProfileBody): LocalServiceProfileConfig | undefined {
  if (!body.id || !body.alias || !body.provider || !body.baseUrl || !body.healthPath || !body.startPath || !body.statusPath || !body.inputPath || !body.cancelPath) return undefined;
  return {
    id: body.id,
    alias: body.alias,
    provider: body.provider,
    baseUrl: body.baseUrl,
    healthPath: body.healthPath,
    startPath: body.startPath,
    statusPath: body.statusPath,
    inputPath: body.inputPath,
    cancelPath: body.cancelPath,
    ...(body.resourcePath ? { resourcePath: body.resourcePath } : {}),
    ...(body.credentialRef ? { credentialRef: body.credentialRef } : {}),
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
  private readonly pendingConsoleInputs = new Set<string>();
  private readonly profileProbes:ProfileProbeService;
  private readonly runInputs:RunInputReceipts;
  private readonly usageObservations:UsageObservations;
  private readonly secureLinks: SecureDashboardLinkIssuer;
  private readonly messagingChannels = new Map<string, string>();
  private readonly agentAdapters = new Map<string, AgentAdapter>();
  private readonly profileAdapterConfigurations = new Map<string, { profile: AgentProfileConfig; runner: { id: string; mode: string; credentialRef?: string } | undefined }>();
  private readonly pendingProfileStarts = new Map<string, number>();
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
  private readonly agentProcesses: ProcessManager;
  private readonly controlAuth: ControlPlaneAuth;
  private readonly requestPrincipals = new WeakMap<object, ControlPrincipal>();
  private readonly messagingInbox: MessagingInbox;
  private readonly background: BackgroundLoop;
  private dispatchQueue: Promise<void> = Promise.resolve();
  private readonly runAdvances = new Map<string, Promise<AdvanceResult>>();
  private readonly dispatchingRuns = new Set<string>();
  private readonly remoteLifecycleJobs = new Map<string,Promise<void>>();
  private readonly remoteLifecycleQueued = new Set<string>();
  private readonly runRetries = new Map<string, { failures: number; nextAttemptAt: number }>();
  private projectionDrain: Promise<unknown> | undefined;
  private ownerToken: Promise<string> | undefined;

  constructor(readonly options: ControllerOptions) {
    const logger = createLogger({ level: process.env.LOG_LEVEL ?? "info" });
    this.app = fastify({ loggerInstance: logger as unknown as FastifyBaseLogger, ajv: {customOptions:{coerceTypes:false,removeAdditional:false}} });
    this.database = new DispatcherDatabase(join(options.dataDirectory, "dispatcher.sqlite"));
    this.profileProbes=new ProfileProbeService(this.database,()=>this.now());
    this.runInputs=new RunInputReceipts(this.database,()=>this.now());
    this.usageObservations=new UsageObservations(this.database,()=>this.now());
    this.agentProcesses = new ProcessManager(join(options.dataDirectory, "agent-logs"));
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
    this.tasks = new CanonicalTaskService(this.database, () => this.now());
    this.projections = new ProjectionWorker(this.database, this.connectors);
    this.secrets = options.secretStore ?? createDefaultSecretStore({ dataDirectory: options.dataDirectory });
    const worker = options.backgroundWorker ?? {};
    this.messagingInbox = new MessagingInbox(this.database, {
      workerId: randomUUID(),
      clock: () => this.now(),
      ...(worker.inboxMaxAttempts === undefined ? {} : { maxAttempts: worker.inboxMaxAttempts }),
      ...(worker.inboxBaseDelayMs === undefined ? {} : { baseDelayMs: worker.inboxBaseDelayMs }),
      ...(worker.inboxMaxDelayMs === undefined ? {} : { maxDelayMs: worker.inboxMaxDelayMs }),
    });
    this.controlAuth = new ControlPlaneAuth({
      resolveOwnerToken: () => this.resolveOwnerToken(),
      resolveOwnerPasswordHash: async () => (await this.secrets.metadata(OWNER_PASSWORD_REFERENCE)).exists
        ? this.secrets.resolve(OWNER_PASSWORD_REFERENCE, { principal: "controller", purpose: "provider" })
        : undefined,
      allowedHosts: [...new Set(["localhost", "127.0.0.1", "::1", ...(options.host && !["0.0.0.0", "::"].includes(options.host) ? [options.host] : []), ...(options.allowedHosts ?? [])])],
      clock: () => this.now(),
    });
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
      const stored=runner as unknown as Runner;
      this.runners.register({...stored,...(this.configuration.current().config.runners.some(runner=>runner.id===stored.id&&runner.mode==="remote")?{state:"OFFLINE" as const}:{})});
    }
    this.events.subscribe("runnerChanged", async (runner) => {
      this.database.saveEntity("runner", runner.id, json(runner));
      this.fleetEvents.publish("runner.changed", runner.id, redactValue(runner));
      if (this.embeddedRunner?.runner.id === runner.id && runner.state === "ONLINE") await this.renewEmbeddedLeases();
      if(this.configuration.current().config.runners.some(configured=>configured.id===runner.id&&configured.mode==="remote")&&this.remoteRunnerServer.isConnected(runner.id)&&runner.capabilities.includes(NATIVE_EXECUTION_CAPABILITY))await this.reconcileRemoteLifecycle(runner.id);
      else if(!this.stopping&&this.configuration.current().config.runners.some(configured=>configured.id===runner.id&&configured.mode==="remote")&&["DEGRADED","OFFLINE"].includes(runner.state))for(const value of this.database.listEntities<JsonValue>("run")){const run=value as unknown as Run;if(run.runnerId===runner.id&&!isTerminalRunState(run.state))this.markRemoteUnavailable(run.id,"Awaiting owning Runner reconnection","REMOTE_RECONCILE_REQUIRED");}
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
        let expected:string;try{expected=await this.secrets.resolve(configured.credentialRef, { principal: "controller", purpose: "provider" });}catch{return false;}
        const suppliedBytes = Buffer.from(bearerToken);
        const expectedBytes = Buffer.from(expected);
        return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
      },
      onRunnerChanged: async (runner) => await this.events.publish("runnerChanged", runner),
    });
    const modules: ServiceModule[] = [];
    modules.push({ name: "agent-processes", start: () => undefined, stop: () => this.agentProcesses.shutdown() });
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
    this.background = new BackgroundLoop([
      { name: "embedded-leases", run: () => this.renewEmbeddedLeases() },
      { name: "messaging-inbox", run: () => this.processMessagingInbox(worker.inboxBatchSize ?? 10) },
      { name: "run-advancement", run: () => this.advanceDueRuns(worker.maxConcurrentRuns ?? 2, worker.runBaseDelayMs ?? 1_000, worker.runMaxDelayMs ?? 5 * 60_000) },
      { name: "run-attention", run: () => this.notifyDueAttention() },
      { name: "delivery-reconcile", run: () => this.reconcileDeliveryRuns(worker.maxConcurrentRuns ?? 2) },
      { name: "delivery-feedback", run: () => this.notifyDeliveryFeedback() },
      { name: "projection-drain", run: async () => { await this.drainProjections(this.now()); } },
    ], {
      intervalMs: worker.intervalMs ?? 2_000,
      onError: (job, error) => logger.error({ error: redactValue(error), job }, "background job failed"),
    });
    if (worker.enabled) modules.push({ name: "background-worker", start: () => this.background.start(), stop: () => this.background.stop() });
    this.lifecycle = new LifecycleManager(modules);
    this.modelRouting = new ModelRoutingService(this.database,()=>this.now(),new TaskClassifier(this.database,this.llm,()=>this.now()));
    this.publications = new PublicationService(this.database, this.configuration, this.tasks, { inspect: plan => this.inspectRepository(plan) }, () => this.now(), {
      prepare: (draft,repository,workspacePath,context) => this.preparePublication(draft,repository,workspacePath,context),
      dispatch: async (record,taskId) => (await this.dispatchTask(taskId,{profileId:record.selection!.profileId,repositoryId:record.repository!.id},`publication:${record.preview.publicationId}`,record)).run,
    });
    this.publications.reconcile();
    this.registerRoutes();
  }

  runBackgroundCycle(): Promise<void> {
    return this.background.tick();
  }

  issueDashboardLogin(baseUrl?: string): { url: string; expiresAt: string } {
    const issued = this.controlAuth.issueLoginCode();
    const host = !this.options.host || ["0.0.0.0", "::"].includes(this.options.host) ? "127.0.0.1" : this.options.host;
    return { url: `${baseUrl ?? `http://${host}:${this.options.port ?? 8347}`}/#login=${issued.code}`, expiresAt: issued.expiresAt };
  }

  async start(input: { listen?: boolean } = {}): Promise<void> {
    for (const value of this.database.listEntities<JsonValue>("workspace-handle")) {
      const handle=value as unknown as WorkspaceHandle;
      const config=this.configuration.current().config,repository=config.repositories.find(repository=>repository.id===handle.repositoryId);
      const recordedOwner=(value as Record<string,JsonValue>).runnerId;if(typeof recordedOwner==="string"&&recordedOwner!==(config.runners.find(runner=>runner.mode==="embedded")?.id??"local"))continue;
      if(repository&&config.runners.some(runner=>runner.id===repositoryRunnerId(config,repository)&&runner.mode==="remote"))continue;
      try { await this.workspaces.restore(value as unknown as WorkspaceHandle); }
      catch (error) { this.app.log.warn({error:redactValue(error)},"worktree restoration requires operator inspection"); }
    }
    await this.lifecycle.start();
    try {
      await this.app.ready();
      if (input.listen !== false) {
        await this.app.listen({ host: this.options.host ?? "127.0.0.1", port: this.options.port ?? 8347 });
        this.listening = true;
      }
    } catch (error) {
      await this.lifecycle.stop();
      await Promise.allSettled([...this.remoteLifecycleJobs.values()]);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopping = (async () => {
      await this.lifecycle.stop();
      await Promise.allSettled([...this.remoteLifecycleJobs.values()]);
      await this.profileProbes.drain();
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
    const expiresAt = run.leaseExpiresAt ?? new Date(this.now().getTime() + 15 * 60_000).toISOString();
    this.leaseAuthority.issue({ runId: run.id, runnerId: run.runnerId, leaseId: run.leaseId, generation: run.generation, expiresAt });
    if(run.revokedLeaseIds?.includes(run.leaseId))this.leaseAuthority.revoke(run.id,run.leaseId,run.generation,"Persisted authority revocation",this.now().toISOString());
    this.persistLatestLeaseAudit(run.id);
  }

  private fenceDelivery(run: Run, operation: "branch" | "push" | "pull-request" | "complete"): void {
    const current = this.database.getEntity<JsonValue>("run", run.id) as unknown as Run | undefined;
    if (!current || current.generation !== run.generation || current.leaseId !== run.leaseId || !["VERIFYING", "DELIVERING"].includes(current.state)) throw new ConnectorError("CONFLICT", "Delivery authority rejected: stale or terminal run", { retryable: false, operation: "delivery" });
    this.restoreLeaseAuthority(run);
    try {
      this.leaseAuthority.fence(run.id, run.leaseId, run.generation, operation, this.now().toISOString());
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
    if(this.leaseAuthority.current(runId)?.revokedAt){const run=this.database.getEntity<JsonValue>("run",runId) as unknown as Run|undefined;if(run&&record.leaseId===run.leaseId&&record.generation===run.generation&&!run.revokedLeaseIds?.includes(run.leaseId)){run.revokedLeaseIds=[...(run.revokedLeaseIds??[]),run.leaseId];this.database.saveEntity("run",run.id,json(run));}}
  }

  private async failRun(run: Run, reason: string): Promise<void> {
    const current = this.database.getEntity<JsonValue>("run", run.id) as unknown as Run | undefined;
    if (!current || current.generation !== run.generation || isTerminalRunState(current.state)) return;
    assertRunTransition(current.state, "FAILED");
    current.state = "FAILED";
    current.failureReason = String(redactValue(reason));
    current.endedAt = this.now().toISOString();
    this.database.saveEntity("run", current.id, json(current));
    const task = this.database.getCanonicalTask<JsonValue>(current.taskId);
    if (task && !["DONE", "FAILED", "CANCELLED"].includes((task.document as unknown as Task).state)) this.tasks.execute({ id: `run:${current.id}:${current.generation}:failed`, taskId: current.taskId, baseRevision: task.revision, actor: "run-worker", command: { type: "task.transition", state: "FAILED" } });
    this.fleetEvents.publish("run.changed", current.id, { id: current.id, state: current.state });
    if (!current.sessionId.startsWith("unstarted:")) {
      try { await this.agentAdapters.get(current.profileId)?.cancel(current.sessionId); }
      catch (error) {
        current.failureReason += `; agent cleanup failed: ${String(redactValue(error instanceof Error ? error.message : "unknown error"))}`;
        this.database.saveEntity("run", current.id, json(current));
        this.app.log.warn({ runId: current.id, error: redactValue(error) }, "failed run agent cleanup failed");
      }
    }
    await this.notifyAttention(current);
  }

  private async renewEmbeddedLeases(): Promise<void> {
    const runnerId = this.embeddedRunner?.runner.id;
    if (!runnerId || !this.runners.list().some((runner) => runner.id === runnerId && runner.state === "ONLINE")) return;
    const now = this.now();
    for (const value of this.database.listEntities<JsonValue>("run")) {
      const run = value as unknown as Run;
      if (run.runnerId !== runnerId || isTerminalRunState(run.state)) continue;
      this.restoreLeaseAuthority(run);
      const lease = this.leaseAuthority.current(run.id)!;
      if (lease.generation === run.generation && lease.leaseId === run.leaseId && !lease.revokedAt && Date.parse(lease.expiresAt) - now.getTime() > 5 * 60_000) continue;
      try {
        const renewed = this.leaseAuthority.renew(run.id, run.leaseId, run.generation, new Date(now.getTime() + 15 * 60_000).toISOString(), now.toISOString());
        run.leaseExpiresAt = renewed.expiresAt;
        this.database.saveEntity("run", run.id, json(run));
        this.persistLatestLeaseAudit(run.id);
      } catch (error) {
        this.persistLatestLeaseAudit(run.id);
        if (!(error instanceof LeaseFenceError)) throw error;
        await this.failRun(run, `Embedded Runner ${error.message}`);
      }
    }
  }

  private markRemoteUnavailable(runId:string,reason:string,code="NATIVE_OUTCOME_UNKNOWN",expected?:Pick<Run,"leaseId"|"generation">):void {
    if(this.dispatchingRuns.has(runId))return;
    let changed=false;
    this.database.transaction(()=>{
      const run=this.database.getEntity<JsonValue>("run",runId) as unknown as Run|undefined;
      if(!run||isTerminalRunState(run.state)||run.state==="CREATED")return;
      if(expected&&(run.leaseId!==expected.leaseId||run.generation!==expected.generation))return;
      if(run.state!=="RUNNER_UNAVAILABLE"){run.recoveryState=run.state;assertRunTransition(run.state,"RUNNER_UNAVAILABLE");run.state="RUNNER_UNAVAILABLE";}
      run.recoveryReason=code;run.resumePolicy="manual";this.database.saveEntity("run",run.id,json(run));
      changed=true;
      const stored=this.database.getCanonicalTask<JsonValue>(run.taskId),task=stored?.document as unknown as Task|undefined;
      if(stored&&task?.currentRunId===run.id&&["RUNNING","QUEUED"].includes(task.state))this.tasks.execute({id:`remote-unavailable:${run.id}:${stored.revision}`,taskId:run.taskId,baseRevision:stored.revision,actor:"remote-reconciliation",command:{type:"task.transition",state:task.state==="QUEUED"?"WAITING_RESOURCE":"WAITING_USER"}});
      for(const value of this.database.listEntities<JsonValue>("task-publication")){
        const publication=value as unknown as PublicationRecord;
        if(publication.receipt?.runId===run.id){publication.receipt={...publication.receipt,state:"OUTCOME_UNKNOWN",message:reason};this.database.saveEntity("task-publication",publication.preview.publicationId,json(publication));}
      }
    });
    if(changed)this.fleetEvents.publish("run.changed",runId,{id:runId,state:"RUNNER_UNAVAILABLE",recoveryReason:code});
  }
  private reconcileRemoteLifecycle(runnerId:string):Promise<void> {
    if(this.stopping)return Promise.resolve();
    const active=this.remoteLifecycleJobs.get(runnerId);if(active){this.remoteLifecycleQueued.add(runnerId);return active;}
    const work=Promise.resolve().then(async()=>{
      do{
        this.remoteLifecycleQueued.delete(runnerId);if(this.stopping)return;
        try{await this.reconcileRemoteRunner(runnerId);await this.renewRemoteLeases(runnerId);}
        catch(error){this.app.log.warn({runnerId,error:redactValue(error)},"remote ownership reconciliation is unconfirmed");}
      }while(this.remoteLifecycleQueued.has(runnerId));
    });
    this.remoteLifecycleJobs.set(runnerId,work);
    void work.finally(()=>{if(this.remoteLifecycleJobs.get(runnerId)===work)this.remoteLifecycleJobs.delete(runnerId);});
    return work;
  }
  private async reconcileRemoteRunner(runnerId:string):Promise<void> {
    const before=new Set(this.database.listEntities<JsonValue>("run").map(value=>value as unknown as Run).filter(run=>run.runnerId===runnerId&&!isTerminalRunState(run.state)).map(run=>contentHash({id:run.id,generation:run.generation,leaseId:run.leaseId})));
    const actual=remoteRunInventory(await this.remoteRequest(runnerId,{type:"runner.reconcile"}),runnerId);
    const runs=this.database.listEntities<JsonValue>("run").map(value=>value as unknown as Run).filter(run=>run.runnerId===runnerId&&!isTerminalRunState(run.state)&&before.has(contentHash({id:run.id,generation:run.generation,leaseId:run.leaseId})));
    const owned=runs.filter(run=>(this.database.getCanonicalTask<JsonValue>(run.taskId)?.document as unknown as Task|undefined)?.currentRunId===run.id);
    const expected=owned.map(run=>{
      const start=this.database.getEntity<JsonValue>("remote-native-start",run.id) as {commandHash?:string}|undefined;
      return {runId:run.id,runnerId,generation:run.generation,leaseId:run.leaseId,...(run.worktree?{workspace:run.worktree}:{}),...(!run.sessionId.startsWith("unstarted:")?{sessionId:run.sessionId}:{}),...(start?.commandHash?{startCommandHash:start.commandHash}:{}),requiresNativeOwnership:true};
    });
    for(const decision of reconcileRunnerState(runnerId,expected,actual)){
      if(this.stopping||this.dispatchingRuns.has(decision.runId))continue;
      const observed=actual.find(row=>row.runId===decision.runId),run=runs.find(run=>run.id===decision.runId);
      if(decision.action==="STOP_STALE"&&observed){const current=this.database.getEntity<JsonValue>("run",decision.runId) as unknown as Run|undefined;if(current&&!isTerminalRunState(current.state)&&current.generation===observed.generation&&current.leaseId===observed.leaseId&&(this.database.getCanonicalTask<JsonValue>(current.taskId)?.document as unknown as Task|undefined)?.currentRunId===current.id)continue;}
      this.database.saveEntity("remote-reconciliation",decision.runId,json({runnerId,...decision,observedAt:this.now().toISOString(),...(observed?{observation:observed}:{})}));
      if(decision.action==="STOP_STALE"){
        if(observed&&!observed.settledAt&&observed.nativeState!=="CANCELLED")await this.remoteRequest(runnerId,{type:"lease.revoke",leaseId:observed.leaseId,generation:observed.generation,reason:decision.reason});
        continue;
      }
      if(!run)continue;
      const start=this.database.getEntity<JsonValue>("remote-native-start",run.id) as {commandHash?:string;runnerId?:string;generation?:number;leaseId?:string}|undefined;
      if(decision.action!=="KEEP"||!observed||!start?.commandHash||start.runnerId!==runnerId||start.generation!==run.generation||start.leaseId!==run.leaseId||observed.profileId!==run.profileId){this.markRemoteUnavailable(run.id,decision.reason,"NATIVE_OUTCOME_UNKNOWN",run);continue;}
      this.restoreLeaseAuthority(run);
      const canonical=this.leaseAuthority.current(run.id)!;
      if(canonical.revokedAt||observed.lease.revokedAt||Date.parse(observed.lease.expiresAt)<=this.now().getTime()||!run.leaseExpiresAt||Date.parse(run.leaseExpiresAt)<=this.now().getTime()){
        if(!observed.lease.revokedAt)await this.remoteRequest(runnerId,{type:"lease.revoke",leaseId:run.leaseId,generation:run.generation,reason:"Canonical authority expired or was revoked"});
        this.markRemoteUnavailable(run.id,"Remote authority requires operator inspection","REMOTE_LEASE_INVALID",run);continue;
      }
      if(run.state!=="RUNNER_UNAVAILABLE"&&run.state!=="STARTING")continue;
      const adapter=this.agentAdapters.get(run.profileId);if(!(adapter instanceof RemoteNativeAdapter)){this.markRemoteUnavailable(run.id,"Remote native backend is unavailable","NATIVE_OUTCOME_UNKNOWN",run);continue;}
      const session=adapter.reconcileSession(await this.remoteRequest(runnerId,{type:"native.run",runId:run.id,action:"status"},run),run);
      this.database.transaction(()=>{
        const current=this.database.getEntity<JsonValue>("run",run.id) as unknown as Run|undefined,stored=this.database.getCanonicalTask<JsonValue>(run.taskId),task=stored?.document as unknown as Task|undefined;
        if(!current||isTerminalRunState(current.state)||current.generation!==run.generation||current.leaseId!==run.leaseId||task?.currentRunId!==run.id||!["RUNNER_UNAVAILABLE","STARTING"].includes(current.state))return;
        const restored:Run["state"]=current.recoveryState&&["ACTIVE","WAITING_USER","RESOURCE_BLOCKED","SUSPECTED_STALL","VERIFYING","DELIVERING"].includes(current.recoveryState)?current.recoveryState:"ACTIVE";
        assertRunTransition(current.state,restored);current.state=restored;current.sessionId=session.id;if(session.providerSessionId)current.providerSessionId=session.providerSessionId;
        delete current.recoveryReason;delete current.recoveryState;delete current.failureReason;current.resumePolicy=session.providerSessionId||adapter.manifest.capabilities.resume?"same-session":"controlled-reroute";
        this.database.saveEntity("run",current.id,json(current));
        if(stored&&restored==="ACTIVE"&&["WAITING_USER","WAITING_RESOURCE","QUEUED"].includes(task.state))this.tasks.execute({id:`remote-reattach:${current.id}:${stored.revision}`,taskId:current.taskId,baseRevision:stored.revision,actor:"remote-reconciliation",command:{type:"task.transition",state:"RUNNING"}});
        for(const value of this.database.listEntities<JsonValue>("task-publication")){const publication=value as unknown as PublicationRecord;if(publication.receipt?.runId===current.id)this.publications.markOutcome(publication.owner,publication.preview.publicationId,current);}
      });
      this.fleetEvents.publish("run.changed",run.id,{id:run.id,source:"remote-reconciliation"});
    }
  }
  private async renewRemoteLeases(runnerId:string):Promise<void> {
    for(const value of this.database.listEntities<JsonValue>("run")){
      const run=value as unknown as Run;if(run.runnerId!==runnerId||isTerminalRunState(run.state)||run.state==="RUNNER_UNAVAILABLE"||this.dispatchingRuns.has(run.id)||!run.leaseExpiresAt||Date.parse(run.leaseExpiresAt)-this.now().getTime()>5*60_000)continue;
      this.restoreLeaseAuthority(run);
      try{
        this.leaseAuthority.fence(run.id,run.leaseId,run.generation,"remote-renew",this.now().toISOString());
        const expiresAt=new Date(this.now().getTime()+15*60_000).toISOString();
        const acknowledged=await this.remoteRequest(runnerId,{type:"lease.renew",leaseId:run.leaseId,generation:run.generation,expiresAt},run,`native-renew:${run.id}:${run.generation}:${Date.parse(expiresAt)}`) as {runId?:unknown;runnerId?:unknown;leaseId?:unknown;generation?:unknown;expiresAt?:unknown;revokedAt?:unknown};
        if(!acknowledged||acknowledged.runId!==run.id||acknowledged.runnerId!==runnerId||acknowledged.leaseId!==run.leaseId||acknowledged.generation!==run.generation||acknowledged.expiresAt!==expiresAt||acknowledged.revokedAt)throw new AdapterContractError("REMOTE_RESULT_INVALID","Remote lease renewal acknowledgement does not match canonical authority");
        const current=this.database.getEntity<JsonValue>("run",run.id) as unknown as Run|undefined;
        if(!current||isTerminalRunState(current.state)||current.state==="RUNNER_UNAVAILABLE"||current.generation!==run.generation||current.leaseId!==run.leaseId)throw new AdapterContractError("RUN_CHANGED","Canonical authority changed while renewing its remote lease");
        const renewed=this.leaseAuthority.renew(run.id,run.leaseId,run.generation,expiresAt,this.now().toISOString());current.leaseExpiresAt=renewed.expiresAt;this.database.saveEntity("run",current.id,json(current));this.persistLatestLeaseAudit(run.id);
      }catch(error){
        try{await this.remoteRequest(runnerId,{type:"lease.revoke",leaseId:run.leaseId,generation:run.generation,reason:"Canonical renewal was not confirmed"},run);}catch(cleanup){this.app.log.warn({runId:run.id,error:redactValue(cleanup)},"remote renewal cleanup is unconfirmed");}
        try{this.leaseAuthority.revoke(run.id,run.leaseId,run.generation,"Canonical renewal was not confirmed",this.now().toISOString());}catch{/* A newer generation remains authoritative. */}
        this.persistLatestLeaseAudit(run.id);this.markRemoteUnavailable(run.id,"Remote lease renewal could not be confirmed","REMOTE_LEASE_INVALID",run);this.app.log.warn({runId:run.id,error:redactValue(error)},"remote lease renewal failed");
      }
    }
  }

  private genericProcessExecutor(): ProcessExecutor {
    return {
      start: async (input) => {
        const handle = await this.agentProcesses.start({ runId: input.runId, file: input.file, args: input.args, cwd: input.cwd, ...(input.mode === "pty" ? { mode: "pty" as const } : { mode: "process" as const }) });
        const state = async (): Promise<"running" | "cancelled" | "completed" | "failed"> => {
          if (handle.status().state === "running") return "running";
          const result = await handle.result();
          return result.classification === "success" ? "completed" : result.classification === "cancelled" ? "cancelled" : "failed";
        };
        return {
          id: handle.id,
          status: async () => ({ state: await state() }),
          send: (data) => handle.send(data),
          cancel: () => handle.cancel(),
          result: async () => {
            const result = await handle.result();
            return { state: result.classification === "success" ? "completed" as const : result.classification === "cancelled" ? "cancelled" as const : "failed" as const, summary: result.stdoutTail || result.stderrTail || result.classification };
          },
        };
      },
    };
  }

  private async planConfiguration(proposed:unknown,actor:string,source:Parameters<ConfigurationEngine["buildPlan"]>[2]) {
    const snapshot=this.configuration.current(),next=validateConfig(proposed);
    const evidence=await qualifyRoutingPolicy(snapshot.config,next,(profileId,repositoryId)=>this.modelCatalog(profileId,repositoryId,"selection-change"));
    if(this.configuration.current().revision!==snapshot.revision)throw new RevisionConflictError(snapshot.revision,this.configuration.current().revision);
    const plan=this.configuration.buildPlan(next,actor,source);
    if(evidence)this.database.saveEntity("policy-plan-evidence",plan.id,json(evidence));
    return plan;
  }
  private async applyConfigurationPlan(id:string,options:{confirmed?:boolean}={}) {
    const plan=this.configuration.getPlan(id);if(plan&&plan.state!=="PLANNED")return this.configuration.applyPlan(id,options);
    const snapshot=this.configuration.current();if(plan&&snapshot.revision!==plan.baseRevision)throw new RevisionConflictError(plan.baseRevision,snapshot.revision);
    const next=this.configuration.proposedConfig(id);
    const evidence=await qualifyRoutingPolicy(snapshot.config,next,(profileId,repositoryId)=>this.modelCatalog(profileId,repositoryId,"selection-change"));
    if(evidence){const reviewed=this.database.getEntity<JsonValue>("policy-plan-evidence",id) as unknown as PolicyConfigEvidence|undefined;if(!reviewed||contentHash(reviewed)!==contentHash(evidence))throw new ConfigPlanError("ROUTING_PLAN_STALE","Native routing evidence changed; build and review a new ConfigPlan");}
    await assertRequiredSecretsAvailable(next,this.secrets);
    return this.configuration.applyPlan(id,options);
  }
  private async rollbackConfigurationPlan(id:string) {
    const stored=this.database.getConfigPlan(id),snapshot=this.configuration.current();
    if(stored?.state!=="APPLIED")return this.configuration.rollbackPlan(id);
    if(stored)await qualifyRoutingPolicy(snapshot.config,validateConfig(stored.before),(profileId,repositoryId)=>this.modelCatalog(profileId,repositoryId,"selection-change"));
    if(this.configuration.current().revision!==snapshot.revision)throw new RevisionConflictError(snapshot.revision,this.configuration.current().revision);
    return this.configuration.rollbackPlan(id);
  }

  private applyRuntimeConfiguration(config: DispatcherConfig): void {
    const retainedAdapters = new Map<string, AgentAdapter>();
    const runnerIdentity = (runnerId: string) => {
      const runner = config.runners.find(candidate => candidate.id === runnerId);
      return runner ? { id: runner.id, mode: runner.mode, ...(runner.credentialRef ? { credentialRef: runner.credentialRef } : {}) } : undefined;
    };
    const adapterConfiguration = (profile: AgentProfileConfig) => structuredClone({ profile, runner: runnerIdentity(profile.runnerId) });
    const runs = this.database.listEntities<JsonValue>("run") as unknown as Run[];
    const sessions = this.database.listEntities<JsonValue>("adapter-session") as unknown as AdapterSession[];
    for (const [id, previous] of this.profileAdapterConfigurations) {
      const adapter = this.agentAdapters.get(id);
      const next = config.agentProfiles.find(profile => profile.id === id && profile.enabled !== false);
      if (adapter && next && isDeepStrictEqual(previous, adapterConfiguration(next))) {
        retainedAdapters.set(id, adapter);
        continue;
      }
      const owned = adapter instanceof StructuredCliAdapter || adapter instanceof CodexAdapter || adapter instanceof RemoteNativeAdapter;
      const busy = (this.pendingProfileStarts.get(id) ?? 0) > 0
        || runs.some(run => run.profileId === id && !isTerminalRunState(run.state))
        || (owned && adapter.hasActiveOperations())
        || sessions.some(session => session.profileId === id && (this.pendingConsoleInputs.has(session.id)
          || session.state === "PAUSED" || (!owned && ["STARTING", "RUNNING"].includes(session.state))));
      if (busy) throw new ConfigPlanError("ACTIVE_AGENT_PROFILE", `Finish or cancel active harness operations before changing or removing profile ${id}`);
      if (previous.runner?.mode === "remote" && !isDeepStrictEqual(previous.runner, runnerIdentity(previous.runner.id)) && this.remoteRunnerServer?.isConnected(previous.runner.id)) {
        throw new ConfigPlanError("RUNNER_CONNECTED", "Revoke and disconnect the Runner before changing its execution identity");
      }
    }
    this.llm.configure(llmConfiguration(config.internalLlm));
    this.repositories.clear();
    for (const repository of config.repositories) {
      if (config.runners.some(runner => runner.id === repositoryRunnerId(config,repository) && runner.mode === "remote")) continue;
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
    for (const [id, adapter] of retainedAdapters) this.agentAdapters.set(id, adapter);
    for (const id of this.profileAdapterConfigurations.keys()) {
      if (!retainedAdapters.has(id)) this.profileAdapterConfigurations.delete(id);
    }
    const store = new DatabaseSessionStore(this.database,session=>{
      const run=this.database.getEntity<JsonValue>("run",session.runId) as unknown as Run|undefined;if(!run)return;
      const task=this.database.getCanonicalTask<JsonValue>(run.taskId)?.document as unknown as Task|undefined;
      if(task?.currentRunId!==run.id||run.profileId!==session.profileId||isTerminalRunState(run.state))throw new AdapterContractError("SESSION_DETACHED","Canonical native startup authority changed");
      this.restoreLeaseAuthority(run);this.leaseAuthority.fence(run.id,run.leaseId,run.generation,"native-spawn",this.now().toISOString());
    });
    for(const profile of config.agentProfiles.filter(profile=>profile.enabled!==false&&config.runners.some(runner=>runner.id===profile.runnerId&&runner.mode==="remote"))){
      if(retainedAdapters.has(profile.id))continue;
      const manifest=manifestForProvider(profile.provider);
      if(!manifest||!(profile.provider==="codex"||profile.provider==="cursor"||profile.provider==="kiro"||isNativeCliProvider(profile.provider)))continue;
      this.agentAdapters.set(profile.id,new RemoteNativeAdapter({profileId:profile.id,runnerId:profile.runnerId,manifest,
        run:id=>{const run=this.database.getEntity<JsonValue>("run",id) as unknown as Run|undefined;if(!run)return;const task=this.database.getCanonicalTask<JsonValue>(run.taskId)?.document as unknown as Task|undefined;if(task?.currentRunId!==id||task.state!=="QUEUED")return;this.restoreLeaseAuthority(run);this.leaseAuthority.fence(run.id,run.leaseId,run.generation,"native-start",this.now().toISOString());return run;},
        sessionRun:id=>{const session=store.load(id);const run=session?this.database.getEntity<JsonValue>("run",session.runId) as unknown as Run|undefined:undefined;return run?.sessionId.startsWith("unstarted:")?{...run,sessionId:id}:run;},
        request:(payload,run,messageId)=>this.remoteRequest(profile.runnerId,payload,run,messageId),
        saveSession:session=>{const previous=store.load(session.id);if(previous&&(previous.runId!==session.runId||previous.profileId!==session.profileId))throw new AdapterContractError("COMMAND_OUTCOME_UNKNOWN","Remote session identity collides with another Run");store.save(session);},
        reserveStart:(run,commandHash)=>{const previous=this.database.getEntity<JsonValue>("remote-native-start",run.id) as {commandHash?:string}|undefined;if(previous&&previous.commandHash!==commandHash)throw new AdapterContractError("EXECUTION_CONFLICT","Remote Run start is already bound to a different descriptor");this.database.saveEntity("remote-native-start",run.id,json({runId:run.id,runnerId:run.runnerId,generation:run.generation,leaseId:run.leaseId,commandHash}));},
        active:()=>this.database.listEntities<JsonValue>("run").some(value=>{const run=value as unknown as Run;return run.profileId===profile.id&&!isTerminalRunState(run.state);}),
      }));
      this.profileAdapterConfigurations.set(profile.id, adapterConfiguration(profile));
    }
    const enabledProfiles = config.agentProfiles.filter((profile) => profile.enabled !== false && !config.runners.some(runner => runner.id === profile.runnerId && runner.mode === "remote"));
    const resolveProviderCredential = (reference: string): Promise<string> => this.secrets.resolve(reference, { principal: "controller", purpose: "provider" });
    for (const profile of enabledProfiles) {
      if (retainedAdapters.has(profile.id)) continue;
      const adapter = createNativeProfileAdapter(profile, {
        store, resolveCredential: resolveProviderCredential,
        ...(this.options.codexBackendFactory ? { codexBackendFactory: this.options.codexBackendFactory } : {}),
        ...(this.options.codexNativeReader ? { codexNativeReader: this.options.codexNativeReader } : {}),
        ...(this.options.cliBackendFactory ? { cliBackendFactory: this.options.cliBackendFactory } : {}),
      });
      if (adapter) {
        this.agentAdapters.set(profile.id, adapter);
        this.profileAdapterConfigurations.set(profile.id, adapterConfiguration(profile));
      }
    }
    for (const profile of enabledProfiles.filter((entry) => entry.provider === "qoder")) {
      if (retainedAdapters.has(profile.id)) continue;
      const adapterProfile: QoderProfileConfig = {
        id: profile.id,
        alias: profile.alias,
        ...(stringSetting(profile.settings?.executable) ? { executable: stringSetting(profile.settings?.executable)! } : {}),
        ...(stringSetting(profile.settings?.configDir) ? { configDir: stringSetting(profile.settings?.configDir)! } : {}),
        ...(stringSetting(profile.settings?.model) ? { model: stringSetting(profile.settings?.model)! } : {}),
      };
      this.agentAdapters.set(profile.id, new QoderAdapter(adapterProfile, this.options.qoderBackendFactory?.(adapterProfile), store));
    }
    for (const profile of enabledProfiles.filter((entry) => entry.provider === "devin")) {
      if (retainedAdapters.has(profile.id)) continue;
      const organizationId = stringSetting(profile.settings?.organizationId);
      if (!organizationId || !profile.credentialRef) continue;
      const adapterProfile: DevinProfileConfig = {
        id: profile.id,
        alias: profile.alias,
        organizationId,
        credentialRef: profile.credentialRef,
        ...(stringSetting(profile.settings?.apiBase) ? { apiBase: stringSetting(profile.settings?.apiBase)! } : {}),
        ...(typeof profile.settings?.maxSessionAcu === "number" ? { maxSessionAcu: profile.settings.maxSessionAcu } : {}),
      };
      this.agentAdapters.set(profile.id, new DevinAdapter(adapterProfile, this.options.devinBackendFactory?.(adapterProfile), store, resolveProviderCredential, this.options.integrationFetch as typeof fetch | undefined));
    }
    for (const profile of enabledProfiles.filter((entry) => entry.provider === "workbuddy" || entry.provider === "codebuddy")) {
      if (retainedAdapters.has(profile.id)) continue;
      const settings = profile.settings;
      const required = ["baseUrl", "healthPath", "startPath", "statusPath", "inputPath", "cancelPath"] as const;
      if (required.some((key) => !stringSetting(settings?.[key]))) continue;
      const adapterProfile: LocalServiceProfileConfig = {
        id: profile.id,
        alias: profile.alias,
        provider: profile.provider as "workbuddy" | "codebuddy",
        baseUrl: stringSetting(settings?.baseUrl)!,
        healthPath: stringSetting(settings?.healthPath)!,
        startPath: stringSetting(settings?.startPath)!,
        statusPath: stringSetting(settings?.statusPath)!,
        inputPath: stringSetting(settings?.inputPath)!,
        cancelPath: stringSetting(settings?.cancelPath)!,
        ...(stringSetting(settings?.resourcePath) ? { resourcePath: stringSetting(settings?.resourcePath)! } : {}),
        ...(profile.credentialRef ? { credentialRef: profile.credentialRef } : {}),
      };
      this.agentAdapters.set(profile.id, new LocalServiceAdapter(adapterProfile, resolveProviderCredential, this.options.integrationFetch as typeof fetch | undefined, store));
    }
    for (const profile of enabledProfiles.filter((entry) => entry.provider === "generic-cli")) {
      if (retainedAdapters.has(profile.id)) continue;
      const executable = stringSetting(profile.settings?.executable);
      const args = stringArraySetting(profile.settings?.args);
      if (!executable || !args) continue;
      this.agentAdapters.set(profile.id, new GenericCliAdapter(this.genericProcessExecutor(), {
        file: executable,
        args,
        ...(profile.settings?.mode === "pty" || profile.settings?.mode === "headless" ? { mode: profile.settings.mode } : {}),
      }, store, profile.id));
    }
    for (const profile of enabledProfiles) {
      if (this.agentAdapters.has(profile.id)) this.profileAdapterConfigurations.set(profile.id, adapterConfiguration(profile));
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
    const canonicalTasks = this.database.listCanonicalTasks<JsonValue>();
    const tasks = canonicalTasks.map(({ document, revision }) => {
      const task = document as unknown as Task;
      const run = task.currentRunId ? runsById.get(task.currentRunId) : latestRunByTask.get(task.id);
      return {
        id: task.id,
        projectId: task.projectId,
        title: task.title,
        state: task.state,
        updatedAt: task.updatedAt,
        revision,
        archiveRevision: (this.database.getEntity<JsonValue>("task-archive", task.id) as { revision?: number } | undefined)?.revision ?? 0,
        ...((this.database.getEntity<JsonValue>("task-archive", task.id) as { archivedAt?: string } | undefined)?.archivedAt ? { archivedAt: (this.database.getEntity<JsonValue>("task-archive", task.id) as { archivedAt: string }).archivedAt } : {}),
        ...(task.currentRunId ? { currentRunId: task.currentRunId } : run ? { currentRunId: run.id } : {}),
        ...(run ? { profileId: run.profileId } : {}),
        ...(task.bindings?.length ? { externalRefs: task.bindings.map((binding) => ({ connectorInstanceId: binding.connectorInstanceId, externalId: binding.externalId, ...(publicWebUrl(binding.externalUrl) ? { externalUrl: publicWebUrl(binding.externalUrl)! } : {}) })) } : {}),
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
        ...(run.model ? { model: run.model } : run.executionSelection?.requestedModel ? {model:{id:run.executionSelection.requestedModel,source:"selection" as const}} : {}),
        ...(run.tokens ? { tokens: run.tokens } : {}),
        ...(run.tokenScope ? { tokenScope: run.tokenScope } : {}),
        ...(run.telemetryAt ? { telemetryAt: run.telemetryAt } : {}),
        ...(run.worktree ? { worktree: run.worktree } : {}),
        ...(run.branch ? { branch: run.branch } : {}),
        ...(run.endedAt ? { endedAt: run.endedAt } : {}),
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
        state: profile.enabled === false ? "DISABLED" : this.agentAdapters.has(profile.id) ? "CONFIGURED" : "UNAVAILABLE",
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
    const projects = projectViews(canonicalTasks.map(({ document }) => document as unknown as Task), this.database.listEntities<JsonValue>("project") as unknown as Project[], this.configuration.current().config.repositories, (id) => this.database.getTaskContract<JsonValue>(id) as unknown as TaskContract | undefined);
    return this.fleet.rebuild({ projects, tasks, runs, connectors, profiles }, now);
  }

  private async captureProfileResource(profileId: string, adapter: AgentAdapter, sessionId: string): Promise<ResourceSnapshot | undefined> {
    if (!adapter.usage) return undefined;
    const usage = await adapter.usage(sessionId);
    const usageRun=this.database.listEntities<JsonValue>("run").map(value=>value as unknown as Run).find(run=>run.profileId===profileId&&run.sessionId===sessionId);
    if(usageRun&&usage.observations!==undefined)try{
      const inserted=this.usageObservations.record(usage.observations,{profileId,runId:usageRun.id,sessionId,generation:usageRun.generation});
      if(this.database.getEntity("usage-error",usageRun.id))this.database.saveEntity("usage-error",usageRun.id,{profileId,runId:usageRun.id,status:"resolved",observedAt:this.now().toISOString()});if(inserted)this.fleetEvents.publish("usage.changed",usageRun.id,{runId:usageRun.id,profileId});
    }catch(error){const diagnostic={profileId,runId:usageRun.id,status:"unknown",reasonCode:error instanceof UsageObservationError?error.code:"USAGE_UNAVAILABLE",observedAt:this.now().toISOString()};this.database.saveEntity("usage-error",usageRun.id,diagnostic);this.app.log.warn({error:redactValue(error),runId:usageRun.id},"Native usage observation rejected");}
    const reportedTokens = usage.tokens as { input?: unknown; output?: unknown; cachedInput?: unknown } | undefined;
    if (reportedTokens && Number.isSafeInteger(reportedTokens.input) && Number.isSafeInteger(reportedTokens.output) && Number(reportedTokens.input) >= 0 && Number(reportedTokens.output) >= 0) {
      const tokens = { input: Number(reportedTokens.input), output: Number(reportedTokens.output), ...(Number.isSafeInteger(reportedTokens.cachedInput) && Number(reportedTokens.cachedInput) >= 0 && Number(reportedTokens.cachedInput) <= Number(reportedTokens.input) ? { cachedInput: Number(reportedTokens.cachedInput) } : {}) };
      const run = this.database.listEntities<JsonValue>("run").map((value) => value as unknown as Run).find((value) => value.profileId === profileId && value.sessionId === sessionId);
      if (run) this.database.saveEntity("run-telemetry", run.id, json({ tokens, tokenScope: "latest-turn", telemetryAt: this.now().toISOString() }));
    }
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
      checkedAt:(()=>{const session=this.database.getEntity<JsonValue>("adapter-session",sessionId) as unknown as AdapterSession|undefined,candidate=[usage.checkedAt,usage.observedAt,...(["event","error","session"].includes(String(usage.source))?[session?.updatedAt]:[])].find(value=>typeof value==="string"&&Number.isFinite(Date.parse(value)));return typeof candidate==="string"?new Date(candidate).toISOString():new Date().toISOString();})(),
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

  private canRetryDeadLetter(entry:{source:string;sourceId:string}):boolean{return entry.source==="outbox"||entry.source==="inbox"&&entry.sourceId.startsWith(`${MESSAGING_INBOX_KIND}:`);}
  private connectorConfigurationFingerprint(id:string):string{const config=this.configuration.current().config;return contentHash(config.connectors.find(entry=>entry.id===id)??{id,compatibility:config.integrations});}
  private diagnosticsSnapshot(){
    const current=this.configuration.current(),now=this.now(),runs=this.database.listEntities<JsonValue>("run") as unknown as Run[];
    const profiles=current.config.agentProfiles.map(profile=>{const view=this.profileConsoleView(profile.id),signals=this.resourceRegistry.signalsFor(profile.id).sort((a,b)=>Date.parse(b.checkedAt)-Date.parse(a.checkedAt));if(view.resources.status==="unknown"&&signals[0]&&Date.parse(signals[0].checkedAt)+this.resourceRegistry.maxSignalAgeMs<now.getTime())view.resources={status:"stale",observedAt:signals[0].checkedAt,source:signals[0].source,reasonCode:"RESOURCE_EVIDENCE_EXPIRED"};return view;});
    const publications=(this.database.listEntities<JsonValue>("task-publication") as unknown as PublicationRecord[]).flatMap(publication=>publication.receipt?[{id:publication.preview.publicationId,state:publication.receipt.state}]:[]);
    const deliveries=this.database.listCanonicalTasks<JsonValue>().flatMap(task=>this.database.listDeliveryEvidence<JsonValue>((task.document as unknown as Task).id)) as unknown as DeliveryEvidence[];
    return buildDiagnostics({now:now.toISOString(),revision:current.revision,lifecycle:this.lifecycle.state,profiles,runners:current.config.runners.map(runner=>({id:runner.id,connected:runner.mode==="embedded"?this.embeddedRunner?.runner.id===runner.id:this.remoteRunnerServer.isConnected(runner.id)})),connectors:this.connectors.list().map(connector=>{const saved=this.database.getEntity<JsonValue>("connector-health",connector.instance.id) as {health?:string;checkedAt?:string;contextFingerprint?:string}|undefined;return {id:connector.instance.id,health:saved?saved.contextFingerprint===this.connectorConfigurationFingerprint(connector.instance.id)?saved.health??"UNKNOWN":"CONTEXT_CHANGED":"UNKNOWN",...(saved?.checkedAt?{updatedAt:saved.checkedAt}:{})};}),runs,publications,deliveries,deadLetters:this.database.listDeadLetters<JsonValue>().map(entry=>({id:entry.id,canRetry:this.canRetryDeadLetter(entry),createdAt:entry.createdAt}))});
  }
  private systemImpact(){
    const memory=process.memoryUsage();let databaseBytes:number|null=null;try{databaseBytes=statSync(join(this.options.dataDirectory,"dispatcher.sqlite")).size;}catch{/* A missing/unreadable file is unknown, not measured zero. */}
    return {rssBytes:memory.rss,heapUsedBytes:memory.heapUsed,runnerCount:this.runners.list().length,activeLocalProcesses:null,databaseBytes,dashboardClients:this.dashboardClients,llmCallsLastHour:null,llmCallsSinceStart:this.llm.snapshot().calls,llmCallScope:{basis:"generate-attempts",includesExplicitProbes:false,reset:"controller-instance",startedAt:new Date(this.startedAt).toISOString()}};
  }
  private async probeConnector(id:string){
    const connector=this.connectors.get(id);if(!connector)throw new ConfigPlanError("CONNECTOR_NOT_FOUND","Configured connector is unavailable");
    const contextFingerprint=this.connectorConfigurationFingerprint(id),probe=await connector.probe();
    if(contextFingerprint!==this.connectorConfigurationFingerprint(id))throw new ConfigPlanError("CONNECTOR_CONTEXT_CHANGED","Connector configuration changed during the health check");
    const current=this.connectors.get(id);if(!current)throw new ConfigPlanError("CONNECTOR_CONTEXT_CHANGED","Connector registration changed during the health check");current.instance.health=probe.health;current.instance.updatedAt=probe.checkedAt;
    this.database.saveEntity("connector-health",id,json({...redactValue(probe) as object,contextFingerprint}),probe.checkedAt);this.fleetEvents.publish("connector.changed",id,redactValue(probe));
    if(probe.health==="AUTH_REQUIRED")await this.notifyOperationalAttention({key:id,state:"CONNECTOR_AUTH",subject:`Connector authentication required: ${connector.instance.displayName}`,body:probe.message??"Open Integrations to repair credentials."});
    return probe;
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
        await this.validateRunSelection(run);
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
      await this.drainProjections();
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

  private saveAdvancedRun(run: Run, expectedState: Run["state"]): void {
    const current = this.database.getEntity<JsonValue>("run", run.id) as unknown as Run | undefined;
    if (!current || current.generation !== run.generation || current.leaseId !== run.leaseId || current.state !== expectedState) throw new ConnectorError("CONFLICT", "Run changed while advancement was awaiting work", { retryable: false });
    // Heartbeats can renew the same generation while verification or SCM awaits.
    if (current.leaseExpiresAt) run.leaseExpiresAt = current.leaseExpiresAt;
    this.database.saveEntity("run", run.id, json(run));
  }

  private async advanceRun(runId: string): Promise<{ waiting: boolean; run: Run; task: Task; deliveries: JsonValue[] }> {
    const storedRun = this.database.getEntity<JsonValue>("run", runId);
    if (!storedRun) throw new ConnectorError("PERMANENT", `Unknown run ${runId}`);
    const run = storedRun as unknown as Run;
    const storedTask = this.database.getCanonicalTask<JsonValue>(run.taskId);
    const contract = (this.database.getEntity<JsonValue>("run-contract",run.id) ?? this.database.getTaskContract<JsonValue>(run.taskId)) as unknown as TaskContract | undefined;
    if (!storedTask || !contract) throw new ConnectorError("PERMANENT", `Run ${runId} has no canonical task contract`);
    if (run.state === "COMPLETE") {
      return { waiting: false, run, task: storedTask.document as unknown as Task, deliveries: this.database.listDeliveryEvidence<JsonValue>(run.taskId) };
    }

    if (run.state === "ACTIVE") {
      const adapter = this.agentAdapters.get(run.profileId);
      if (!adapter) throw new ConnectorError("PERMANENT", `Profile ${run.profileId} is unavailable`);
      const session = await adapter.status(run.sessionId);
      if(session.providerSessionId)run.providerSessionId=session.providerSessionId;
      const resource = await this.captureProfileResource(run.profileId, adapter, run.sessionId);
      if (session.state === "RUNNING" || session.state === "STARTING") {
        return { waiting: true, run, task: storedTask.document as unknown as Task, deliveries: [] };
      }
      if (session.state === "PAUSED") {
        assertRunTransition(run.state, "WAITING_USER");
        run.state = "WAITING_USER";
        run.activitySummary = (await adapter.result(run.sessionId)).summary || "Waiting for user input";
        run.lastActivityAt = new Date().toISOString();
        this.saveAdvancedRun(run, "ACTIVE");
        const current = this.database.getCanonicalTask<JsonValue>(run.taskId)!;
        if ((current.document as unknown as Task).state === "RUNNING") {
          this.tasks.execute({ id: `run:${run.id}:${run.generation}:waiting-user:${current.revision}`, taskId: run.taskId, baseRevision: current.revision, actor: "run-worker", command: { type: "task.transition", state: "WAITING_USER" } });
        }
        return { waiting: true, run, task: this.database.getCanonicalTask<JsonValue>(run.taskId)!.document as unknown as Task, deliveries: [] };
      }
      const telemetry = this.database.getEntity<JsonValue>("run-telemetry", run.id) as unknown as Pick<Run, "tokens" | "tokenScope" | "telemetryAt"> | undefined;
      if (telemetry) Object.assign(run, telemetry);
      if (resource && !["AVAILABLE", "LOW", "UNKNOWN"].includes(resource.state)) {
        const pausedSession = await adapter.status(run.sessionId);
        assertRunTransition(run.state, "RESOURCE_BLOCKED");
        run.state = "RESOURCE_BLOCKED";
        run.resourceBlockReason = resource.reason ?? resource.state;
        if (pausedSession.providerSessionId) run.providerSessionId = pausedSession.providerSessionId;
        run.resumePolicy = pausedSession.providerSessionId || adapter.manifest.capabilities.resume ? "same-session" : "controlled-reroute";
        this.saveAdvancedRun(run, "ACTIVE");
        const current = this.database.getCanonicalTask<JsonValue>(run.taskId)!;
        if ((current.document as unknown as Task).state === "RUNNING") {
          this.tasks.execute({ id: `run:${run.id}:resource-blocked`, taskId: run.taskId, baseRevision: current.revision, actor: "run-worker", command: { type: "task.transition", state: "WAITING_RESOURCE" } });
        }
        return { waiting: true, run, task: this.database.getCanonicalTask<JsonValue>(run.taskId)!.document as unknown as Task, deliveries: [] };
      }
      if (session.state !== "COMPLETED") {
        assertRunTransition(run.state, "FAILED");
        run.state = "FAILED";
        run.failureReason = String(redactValue((await adapter.result(run.sessionId)).summary || `Agent session ${session.state.toLowerCase()}`));
        run.endedAt = new Date().toISOString();
        this.saveAdvancedRun(run, "ACTIVE");
        const current = this.database.getCanonicalTask<JsonValue>(run.taskId)!;
        if ((current.document as unknown as Task).state === "RUNNING") {
          this.tasks.execute({ id: `run:${run.id}:failed`, taskId: run.taskId, baseRevision: current.revision, actor: "run-worker", command: { type: "task.transition", state: "FAILED" } });
        }
        if(adapter instanceof RemoteNativeAdapter)await this.finalizeRemoteRun(run);
        return { waiting: false, run, task: this.database.getCanonicalTask<JsonValue>(run.taskId)!.document as unknown as Task, deliveries: [] };
      }
      const result = await adapter.result(run.sessionId);
      assertRunTransition(run.state, "VERIFYING");
      run.state = "VERIFYING";
      run.activitySummary = result.summary;
      run.lastActivityAt = new Date().toISOString();
      this.saveAdvancedRun(run, "ACTIVE");
      const current = this.database.getCanonicalTask<JsonValue>(run.taskId)!;
      if ((current.document as unknown as Task).state === "RUNNING") {
        this.tasks.execute({ id: `run:${run.id}:verifying`, taskId: run.taskId, baseRevision: current.revision, actor: "run-worker", command: { type: "task.transition", state: "VERIFYING" } });
      }
    }

    if (run.state === "RESOURCE_BLOCKED" || run.state === "WAITING_USER") {
      return { waiting: true, run, task: storedTask.document as unknown as Task, deliveries: [] };
    }

    if (run.state === "VERIFYING") {
      const repositoryId = contract.workspace?.repositoryId ?? contract.delivery.repository;
      const repository = this.configuration.current().config.repositories.find((entry) => entry.id === repositoryId);
      const frozen=this.database.getEntity<JsonValue>("run-verification-config",run.id) as unknown as RepositoryConfig["verificationCommands"]|undefined;
      if ((!repository && !frozen) || !run.worktree) throw new ConnectorError("PERMANENT", "Frozen verification or worktree is unavailable");
      const summaries: string[] = [];
      let blocked = false;
      if (this.agentAdapters.get(run.profileId) instanceof RemoteNativeAdapter) {
        const results = await this.remoteRequest(run.runnerId,{type:"native.run_verify",runId:run.id},run,`native-verify:${run.id}:${run.generation}`);
        const commands=frozen??repository!.verificationCommands;
        if(!Array.isArray(results)||results.length!==contract.verification.length)throw new AdapterContractError("REMOTE_RESULT_INVALID","Owning Runner returned an incomplete verification receipt");
        for(const [index,result] of results.entries()) {
          const command=commands.find(command=>command.id===contract.verification[index]);
          if(!command||!result||typeof result!=="object"||result.commandId!==command.id||result.required!==command.required||!["passed","failed","timeout"].includes(result.status)||result.status==="passed"&&result.exitCode!==0||result.exitCode!==null&&!Number.isSafeInteger(result.exitCode)||typeof result.durationMs!=="number"||!Number.isFinite(result.durationMs)||result.durationMs<0||typeof result.output!=="string"||result.output.length>command.outputLimitBytes||typeof result.truncated!=="boolean")throw new AdapterContractError("REMOTE_RESULT_INVALID","Owning Runner verification evidence differs from the frozen commands");
          summaries.push(`${command.id}:${result.status}`);if(command.required&&result.status!=="passed")blocked=true;
        }
        this.database.saveEntity("remote-verification",run.id,json(redactValue(results)));
      } else {
        const verification = new VerificationRegistry();
        for (const command of frozen ?? repository!.verificationCommands) verification.register(command);
        for (const commandId of contract.verification) {
          try {
            const result = await verification.run(commandId, run.worktree);
            summaries.push(`${commandId}:${result.status}`);
            if (result.required && result.status !== "passed") blocked = true;
          } catch { summaries.push(`${commandId}:unregistered`); blocked = true; }
        }
      }
      run.verification = { state: blocked ? "FAILED" : "PASSED", commands: [...contract.verification], summary: summaries.join(", ") };
      if (blocked) {
        assertRunTransition(run.state, "FAILED");
        run.state = "FAILED";
        run.failureReason = "Required verification failed";
        run.endedAt = new Date().toISOString();
        this.saveAdvancedRun(run, "VERIFYING");
        const current = this.database.getCanonicalTask<JsonValue>(run.taskId)!;
        if ((current.document as unknown as Task).state === "VERIFYING") {
          this.tasks.execute({ id: `run:${run.id}:verification-failed`, taskId: run.taskId, baseRevision: current.revision, actor: "run-worker", command: { type: "task.transition", state: "FAILED" } });
        }
        if(this.agentAdapters.get(run.profileId) instanceof RemoteNativeAdapter)await this.finalizeRemoteRun(run);
        return { waiting: false, run, task: this.database.getCanonicalTask<JsonValue>(run.taskId)!.document as unknown as Task, deliveries: [] };
      }
      assertRunTransition(run.state, "DELIVERING");
      run.state = "DELIVERING";
      this.saveAdvancedRun(run, "VERIFYING");
    }

    if (run.state !== "DELIVERING" || !run.worktree || !run.branch) throw new ConnectorError("CONFLICT", `Run ${run.id} is not ready for delivery`);
    if(contract.delivery.type==="none") {
      const remote=this.agentAdapters.get(run.profileId) instanceof RemoteNativeAdapter;
      const workspace=remote?this.database.getEntity<JsonValue>("workspace-handle",run.id) as unknown as WorkspaceHandle|undefined:this.workspaces.get(run.worktree);
      if(!workspace)throw new WorkspacePolicyError("WORKSPACE_UNAVAILABLE","Managed worktree requires restoration or inspection");
      const resultFiles=remote?await this.remoteRequest(run.runnerId,{type:"native.run_files",runId:run.id},run):await this.workspaces.resultFiles(workspace);
      if(!Array.isArray(resultFiles)||resultFiles.length>5000||resultFiles.some(file=>typeof file!=="string"||file.length>4000||/^[/\\]|^[a-z]:/i.test(file)||file.split(/[\\/]/).some(segment=>segment===".."||segment===".git"))||new Set(resultFiles).size!==resultFiles.length)throw new AdapterContractError("REMOTE_RESULT_INVALID","Owning Runner returned an invalid change manifest");
      const files=resultFiles as string[];if(remote)assertPublicationScope(files,workspace.scopePaths);
      const result={version:1,runId:run.id,taskId:run.taskId,runnerId:run.runnerId,deliveryType:"none",worktree:run.worktree,branch:run.branch,baseCommit:workspace.baseRevision,files,verification:run.verification,summary:run.activitySummary??"",createdAt:this.now().toISOString()};
      if(remote){this.fenceDelivery(run,"complete");await this.finalizeRemoteRun(run);}
      this.database.transaction(()=>{
        this.fenceDelivery(run,"complete");
        const current=this.database.getCanonicalTask<JsonValue>(run.taskId)!;
        const task=current.document as unknown as Task;
        if(task.currentRunId!==run.id||task.state!=="VERIFYING")throw new ConnectorError("CONFLICT","Task authority changed before local completion");
        assertRunTransition(run.state,"COMPLETE");run.state="COMPLETE";run.endedAt=this.now().toISOString();
        this.saveAdvancedRun(run,"DELIVERING");this.database.saveEntity("run-result",run.id,json(result));
        this.tasks.execute({id:`run:${run.id}:review`,taskId:run.taskId,baseRevision:current.revision,actor:"run-worker",command:{type:"task.transition",state:"REVIEW"}});
      });
      this.fleetEvents.publish("run.changed",run.id,{id:run.id,state:run.state});
      return {waiting:false,run,task:this.database.getCanonicalTask<JsonValue>(run.taskId)!.document as unknown as Task,deliveries:[]};
    }
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
    this.saveAdvancedRun(run, "DELIVERING");
    let current = this.database.getCanonicalTask<JsonValue>(run.taskId)!;
    if ((current.document as unknown as Task).state === "VERIFYING") {
      this.tasks.execute({ id: `run:${run.id}:review`, taskId: run.taskId, baseRevision: current.revision, actor: "run-worker", command: { type: "task.transition", state: "REVIEW" } });
      current = this.database.getCanonicalTask<JsonValue>(run.taskId)!;
    }
    if (pullRequest?.url) {
      this.tasks.execute({ id: `run:${run.id}:delivery-comment`, taskId: run.taskId, baseRevision: current.revision, actor: "run-worker", command: { type: "task.comment", body: `Pull request ready: ${pullRequest.url}` } });
    }
    await this.drainProjections();
    return {
      waiting: false,
      run,
      task: this.database.getCanonicalTask<JsonValue>(run.taskId)!.document as unknown as Task,
      deliveries: this.database.listDeliveryEvidence<JsonValue>(run.taskId),
    };
  }

  private dispatchCandidates(profileId?:string):DispatchCandidate[] {
    const active=this.database.listEntities<JsonValue>("run").map(v=>v as unknown as Run).filter(r=>!isTerminalRunState(r.state));
    return this.configuration.current().config.agentProfiles.filter(p=>!profileId||p.id===profileId).flatMap(profile=>{
      const runner=this.runners.list().find(r=>r.id===profile.runnerId),adapter=this.agentAdapters.get(profile.id);
      if(!runner||!adapter)return [];
      const remote=adapter instanceof RemoteNativeAdapter&&this.remoteRunnerServer.isConnected(runner.id)&&runner.capabilities.includes(NATIVE_EXECUTION_CAPABILITY)&&this.remoteRunnerServer.profileInventory(runner.id).includes(profile.id);
      const configuredCapacity=this.configuration.current().config.runners.find(configured=>configured.id===runner.id)?.capacity??0;
      return [{runnerId:runner.id,runnerTags:runner.capabilities,capacity:(runner.id===this.embeddedRunner?.runner.id||remote) && ["ONLINE","DEGRADED"].includes(runner.state)?Math.min(runner.capacity,configuredCapacity):0,activeRuns:active.filter(r=>r.runnerId===runner.id).length,providerId:profile.provider,profileId:profile.id,resourceState:this.profileResourceState(profile.id),capabilities:[...new Set([...manifestCapabilities(adapter.manifest),...runner.capabilities])],adapter}];
    });
  }
  private readonly catalogGenerations=new Map<string,number>();
  private async remoteRequest(runnerId:string,payload:CommandPayload,run?:Run,messageId?:string):Promise<unknown> {
    const configured=this.configuration.current().config.runners.find(runner=>runner.id===runnerId&&runner.mode==="remote"),runner=this.runners.list().find(runner=>runner.id===runnerId);
    if(!configured||!runner||!["ONLINE","DEGRADED","DRAINING"].includes(runner.state)||!runner.capabilities.includes(NATIVE_EXECUTION_CAPABILITY)||!this.remoteRunnerServer.isConnected(runnerId))throw new AdapterContractError("REMOTE_EXECUTION_UNAVAILABLE","Owning Runner is offline or has no qualified native execution capability");
    const response=await this.remoteRunnerServer.sendCommand(runnerId,payload,{...(run?{leaseId:run.leaseId,generation:run.generation,...(run.leaseExpiresAt?{leaseExpiresAt:run.leaseExpiresAt}:{})}:{}),...(messageId?{messageId}:{})});
    if(response.payload.type==="rpc.error")throw new AdapterContractError(response.payload.code,"Owning Runner rejected the native operation");
    return response.payload.result;
  }
  private async finalizeRemoteRun(run:Run):Promise<void> {
    const result=await this.remoteRequest(run.runnerId,{type:"native.run_finalize",runId:run.id},run,`native-finalize:${run.id}:${run.generation}`) as {runId?:unknown;settledAt?:unknown}|undefined;
    if(!result||result.runId!==run.id||typeof result.settledAt!=="string"||!Number.isFinite(Date.parse(result.settledAt)))throw new AdapterContractError("REMOTE_RESULT_INVALID","Owning Runner did not confirm execution finalization");
  }
  private async cancelRunExecution(run:Run):Promise<Run> {
    if(isTerminalRunState(run.state))return run;
    const remote=this.configuration.current().config.runners.some(runner=>runner.id===run.runnerId&&runner.mode==="remote");
    this.restoreLeaseAuthority(run);
    this.leaseAuthority.revoke(run.id,run.leaseId,run.generation,"Cancelled by operator",this.now().toISOString());
    this.persistLatestLeaseAudit(run.id);
    if(remote){
      try{
        const stopped=await this.remoteRequest(run.runnerId,{type:"lease.revoke",leaseId:run.leaseId,generation:run.generation,reason:"Cancelled by operator"},run,`native-cancel-lease:${run.id}:${run.generation}`) as {runId?:unknown;leaseId?:unknown;generation?:unknown;revokedAt?:unknown}|undefined;
        if(!stopped||stopped.runId!==run.id||stopped.leaseId!==run.leaseId||stopped.generation!==run.generation||typeof stopped.revokedAt!=="string"||!Number.isFinite(Date.parse(stopped.revokedAt)))throw new AdapterContractError("REMOTE_RESULT_INVALID","Owning Runner did not confirm cancellation");
      }catch(error){this.markRemoteUnavailable(run.id,"Cancellation has fenced authority; native termination is unconfirmed","REMOTE_LEASE_INVALID",run);throw error;}
    }else try{
      const adapter=this.agentAdapters.get(run.profileId);if(!adapter)throw new AdapterContractError("SESSION_DETACHED","Native backend is unavailable");
      const stopped=await adapter.cancel(run.sessionId);if(stopped.state!=="CANCELLED")throw new AdapterContractError("SESSION_DETACHED","Native termination is unconfirmed");
    }catch(error){this.markRemoteUnavailable(run.id,"Cancellation has fenced authority; inspect the original native process before continuing","NATIVE_OUTCOME_UNKNOWN",run);throw error;}
    const current=this.database.getEntity<JsonValue>("run",run.id) as unknown as Run|undefined;
    if(!current||current.leaseId!==run.leaseId||current.generation!==run.generation)throw new SemanticPolicyError("INVALID_INPUT","Run authority changed during cancellation");
    if(!isTerminalRunState(current.state)){assertRunTransition(current.state,"CANCELLED");current.state="CANCELLED";current.endedAt=this.now().toISOString();delete current.recoveryState;delete current.recoveryReason;this.database.saveEntity("run",current.id,json(current));this.fleetEvents.publish("run.changed",current.id,{id:current.id,state:current.state});}
    return current;
  }
  private async inspectRepository(plan:Parameters<WorkspaceManager["inspect"]>[0]):Promise<{baseCommit:string;root:string}> {
    const config=this.configuration.current().config,repository=config.repositories.find(repository=>repository.id===plan.repositoryId);
    if(!repository)throw new PublicationError("REPOSITORY_NOT_FOUND",404,"Repository is not registered");
    const owner=repositoryRunnerId(config,repository);
    if(!config.runners.some(runner=>runner.id===owner&&runner.mode==="remote"))return this.workspaces.inspect(plan);
    const inspected=await this.remoteRequest(owner,{type:"native.repository",...plan}) as {baseCommit?:unknown;root?:unknown;registeredRoot?:unknown;verificationCommands?:unknown};
    if(!inspected||typeof inspected.baseCommit!=="string"||!/^[a-f0-9]{40,64}$/i.test(inspected.baseCommit)||typeof inspected.root!=="string"||inspected.root.length>4000||inspected.registeredRoot!==repository.root||contentHash(inspected.verificationCommands)!==contentHash(repository.verificationCommands))throw new PublicationError("REMOTE_REPOSITORY_MISMATCH",409,"Owning Runner repository or verification registration differs; review both registrations");
    return {baseCommit:inspected.baseCommit,root:inspected.root};
  }
  private remoteWorkspace(value:unknown,plan:Parameters<WorkspaceManager["create"]>[0],reviewed?:WorkspaceHandle):WorkspaceHandle {
    const handle=value as WorkspaceHandle|undefined;
    const identity=(entry:typeof plan)=>({repositoryId:entry.repositoryId,taskId:entry.taskId,runId:entry.runId,attempt:entry.attempt,baseRef:entry.baseRef,scopePaths:entry.scopePaths,baseCommit:entry.baseCommit,targetBranch:entry.targetBranch});
    if(!handle||contentHash(identity(handle))!==contentHash(identity(plan))||typeof handle.path!=="string"||!handle.path||handle.path.length>4000||typeof handle.repositoryRoot!=="string"||typeof handle.branch!=="string"||!handle.branch||!Number.isFinite(Date.parse(handle.createdAt))||typeof handle.baseRevision!=="string"||!/^[a-f0-9]{40,64}$/i.test(handle.baseRevision)||plan.baseCommit&&handle.baseRevision!==plan.baseCommit||reviewed&&["path","branch","baseRevision","repositoryRoot"].some(key=>handle[key as keyof WorkspaceHandle]!==reviewed[key as keyof WorkspaceHandle]))throw new AdapterContractError(reviewed?"COMMAND_OUTCOME_UNKNOWN":"REMOTE_RESULT_INVALID","Owning Runner workspace identity does not match its approved plan");
    return structuredClone(handle);
  }
  private resolveProfileExecutionContext(profileId:string,repositoryId:string|undefined,purpose:Parameters<typeof resolveProfileExecutionContext>[3]) {return resolveProfileExecutionContext(this.configuration.current(),profileId,repositoryId,purpose);}
  private assertLocalDraftProbe(runnerId?:string):void{
    if(!runnerId)return;const runner=this.configuration.current().config.runners.find(runner=>runner.id===runnerId);
    if(!runner)throw new ConfigPlanError("RUNNER_NOT_FOUND","Choose a configured Runner");
    if(runner.mode==="remote")throw new ConfigPlanError("REMOTE_DRAFT_PROBE_UNAVAILABLE","Apply this account and its owning Runner registration before testing remotely");
  }
  private async executeProfileProbe(context:ReturnType<typeof resolveProfileExecutionContext>):Promise<unknown>{
    const profile=context.profile;
    if(context.runner.mode==="remote")return this.remoteRequest(context.runnerId,{type:"native.profile_probe",profileId:profile.id,...(context.repository?{repositoryId:context.repository.id}:{})});
    if(this.options.profileProbeExecutor)return this.options.profileProbeExecutor(profile,context.repository);
    const resolveCredential=(reference:string)=>this.secrets.resolve(reference,{principal:"controller",purpose:"provider"});
    if(profile.provider==="codex"||profile.provider==="cursor"||profile.provider==="kiro"||isNativeCliProvider(profile.provider))return probeNativeProfile(profile,resolveCredential,context.repository?{workspacePath:context.repository.root}:{});
      if (profile.provider === "qoder") return probeQoderProfile({
        id: profile.id,
        alias: profile.alias,
        ...(stringSetting(profile.settings?.executable) ? { executable: stringSetting(profile.settings?.executable)! } : {}),
        ...(stringSetting(profile.settings?.configDir) ? { configDir: stringSetting(profile.settings?.configDir)! } : {}),
        ...(stringSetting(profile.settings?.model) ? { model: stringSetting(profile.settings?.model)! } : {}),
      },context.repository?{workspacePath:context.repository.root}:{});
      if (profile.provider === "devin" && profile.credentialRef && stringSetting(profile.settings?.organizationId)) {
        const devinProfile: DevinProfileConfig = { id: profile.id, alias: profile.alias, organizationId: stringSetting(profile.settings?.organizationId)!, credentialRef: profile.credentialRef, ...(stringSetting(profile.settings?.apiBase) ? { apiBase: stringSetting(profile.settings?.apiBase)! } : {}), ...(typeof profile.settings?.maxSessionAcu === "number" ? { maxSessionAcu: profile.settings.maxSessionAcu } : {}) };
        const backend = this.options.devinBackendFactory?.(devinProfile);
        if (backend) { const health = await backend.health(); return { authenticated: health.ok, apiVersion: "v3", ...(health.diagnostic ? { diagnostic: health.diagnostic } : {}) }; }
        return probeDevinProfile(devinProfile, resolveCredential, this.options.integrationFetch as typeof fetch | undefined);
      }
      if (profile.provider === "workbuddy" || profile.provider === "codebuddy") {
        const local = localServiceProfile({ id: profile.id, alias: profile.alias, provider: profile.provider, ...(profile.credentialRef ? { credentialRef: profile.credentialRef } : {}), ...(stringSetting(profile.settings?.baseUrl) ? { baseUrl: stringSetting(profile.settings?.baseUrl)! } : {}), ...(stringSetting(profile.settings?.healthPath) ? { healthPath: stringSetting(profile.settings?.healthPath)! } : {}), ...(stringSetting(profile.settings?.startPath) ? { startPath: stringSetting(profile.settings?.startPath)! } : {}), ...(stringSetting(profile.settings?.statusPath) ? { statusPath: stringSetting(profile.settings?.statusPath)! } : {}), ...(stringSetting(profile.settings?.inputPath) ? { inputPath: stringSetting(profile.settings?.inputPath)! } : {}), ...(stringSetting(profile.settings?.cancelPath) ? { cancelPath: stringSetting(profile.settings?.cancelPath)! } : {}), ...(stringSetting(profile.settings?.resourcePath) ? { resourcePath: stringSetting(profile.settings?.resourcePath)! } : {}) });
        if (local) return probeLocalService(local, resolveCredential, this.options.integrationFetch as typeof fetch | undefined);
      }
      if (profile.provider === "generic-cli" && stringSetting(profile.settings?.executable) && stringArraySetting(profile.settings?.args)) return probeGenericCli({ file: stringSetting(profile.settings?.executable)!, args: stringArraySetting(profile.settings?.args)!, ...(profile.settings?.mode === "pty" || profile.settings?.mode === "headless" ? { mode: profile.settings.mode } : {}) });
    throw new ConfigPlanError("PROFILE_UNSUPPORTED","Configured account has no qualified probe");
  }
  private async probeConfiguredProfile(profileId:string,repositoryId?:string){
    const context=this.resolveProfileExecutionContext(profileId,repositoryId,"probe");
    const evidence=await this.profileProbes.run(context,()=>this.executeProfileProbe(context),()=>{try{return this.resolveProfileExecutionContext(profileId,repositoryId,"probe").fingerprint;}catch{return "removed";}});
    this.fleetEvents.publish("profile.changed",profileId,{id:profileId,evidence});
    return {evidence,source:context.runner.mode==="remote"?"owning-runner":"local-native",authenticated:evidence.authentication.status==="ready",authentication:evidence.authentication.status==="ready"?"ready":evidence.authentication.status==="missing"?"missing":"unknown",...(["ready","missing"].includes(evidence.installation.status)?{installed:evidence.installation.status==="ready"}:{}),...(["ready","failed"].includes(evidence.compatibility.status)?{compatible:evidence.compatibility.status==="ready"}:{}),...(evidence.nativeVersion?{version:evidence.nativeVersion}:{}),...(context.profile.provider==="devin"?{apiVersion:"v3"}:{}),profile:this.profileConsoleView(profileId)};
  }
  private profileConsoleView(profileId:string):ProfileConsoleView&{provider:string;state:string;capabilities:string[];resourceState:ResourceState}{
    const context=this.resolveProfileExecutionContext(profileId,undefined,"probe"),profile=context.profile,manifest=manifestForProvider(profile.provider),adapter=this.agentAdapters.get(profile.id),last=this.profileProbes.latest(profileId),resource=this.resourceRegistry.assess(profile.id,this.now());
    let probeContext=context;if(last?.repositoryId)try{probeContext=this.resolveProfileExecutionContext(profileId,last.repositoryId,"probe");}catch{/* Removed repository evidence remains stale. */}
    const probe=this.profileProbes.current(probeContext);
    const unknown={status:"unknown" as const,reasonCode:"NATIVE_PROBE_REQUIRED"},installation=probe?.installation??unknown,compatibility=probe?.compatibility??unknown,authentication=probe?.authentication??unknown;
    const enabled=profile.enabled!==false,remote=context.runner.mode==="remote",online=remote?this.remoteRunnerServer.isConnected(context.runnerId)&&Boolean(this.runners.list().find(runner=>runner.id===context.runnerId)?.capabilities.includes(NATIVE_EXECUTION_CAPABILITY)):Boolean(this.embeddedRunner),registered=!remote||this.remoteRunnerServer.profileInventory(context.runnerId).includes(profileId);
    const supportedProbe=Boolean(manifest?.probes.length)&&profile.provider!=="generic-mock",available=enabled&&Boolean(adapter)&&online&&registered&&["AVAILABLE","LOW","UNKNOWN"].includes(resource.state),verified=[installation,compatibility,authentication].every(evidence=>evidence.status==="ready");
    const model=stringSetting(profile.settings?.model);
    return {id:profile.id,alias:profile.alias,providerId:profile.provider,provider:profile.provider,adapterId:manifest?.id??profile.provider,runnerId:profile.runnerId,dispatchEnabled:enabled,configRevision:context.configRevision,state:!enabled?"DISABLED":adapter?"CONFIGURED":"UNAVAILABLE",resourceState:resource.state,capabilities:manifest?manifestCapabilities(manifest):[],installation,compatibility,authentication,
      resources:{status:["AVAILABLE","LOW"].includes(resource.state)?"ready":resource.state==="UNKNOWN"?"unknown":"failed",reasonCode:resource.state,source:"resource-registry",...(resource.evidence.length?{observedAt:resource.checkedAt}:{})},
      ...(model?{defaultModel:{id:model}}:{}),configuration:{complete:registered,missingFields:registered?[]:["owningRunnerRegistration"]},executionSupport:!manifest||profile.provider==="generic-mock"?"unsupported":available&&verified?remote?"remote-ready":"local-ready":"unverified",
      actions:{test:{allowed:supportedProbe&&(!remote||online&&registered&&enabled),requiresConfirmation:false,...(!supportedProbe?{reasonCode:"PROFILE_UNSUPPORTED",message:"This adapter has no qualified native probe"}:remote&&(!online||!registered||!enabled)?{reasonCode:"REMOTE_EXECUTION_UNAVAILABLE",message:"Apply and connect the owning Runner registration before probing"}:{})},publish:{allowed:available,requiresConfirmation:true,...(!available?{reasonCode:!enabled?"PROFILE_DISABLED":"EXECUTION_UNAVAILABLE"}:{})}},
      limitations:["Native login and CLI evidence describe the last check; external account switches or upgrades require another check","A native catalog does not prove model access or cost"]};
  }

  private async modelCatalog(profileId:string,repositoryId:string,reason:ModelCatalogContext["reason"]="open",workspacePath?:string):Promise<AccountModelCatalog> {
    const snapshot=this.configuration.current();const profile=snapshot.config.agentProfiles.find(p=>p.id===profileId),repository=snapshot.config.repositories.find(r=>r.id===repositoryId);
    if(!profile||!repository)throw new PublicationError("CATALOG_CONTEXT_REQUIRED",400,"Choose a registered account and repository");
    const context:ModelCatalogContext={profileId,runnerId:profile.runnerId,repositoryId,executionContextRef:contentHash({repositoryId,root:repository.root}),reason};
    const fallback=(code:string,message:string):AccountModelCatalog=>({profileId,runnerId:profile.runnerId,providerId:profile.provider,backendId:this.agentAdapters.get(profileId)?.manifest.backends[0]?.id??"unsupported",contextFingerprint:contentHash({profile,repositoryId,root:repository.root}),revision:"unverified",fetchedAt:this.now().toISOString(),freshness:"unverified",source:"native-rpc",selectionSupport:this.agentAdapters.get(profileId)?.supportsExecutionSelection?"native-default-only":"unsupported",entries:[],failure:{code,message}});
    if(profile.enabled===false)return fallback("PROFILE_DISABLED","Account is disabled");
    if(repositoryRunnerId(snapshot.config,repository)!==profile.runnerId)return fallback("RUNNER_REPOSITORY_MISMATCH","Account and repository belong to different Runners");
    const remote=snapshot.config.runners.some(runner=>runner.id===profile.runnerId&&runner.mode==="remote");
    if(!remote&&profile.runnerId!==this.embeddedRunner?.runner.id)return fallback("REMOTE_EXECUTION_UNAVAILABLE","Owning local Runner is unavailable");
    const applied=this.resolveProfileExecutionContext(profileId,repositoryId,"catalog");
    const adapter=this.agentAdapters.get(applied.profileId);
    if(!remote&&!adapter?.modelCatalog)return fallback("MODEL_CATALOG_UNSUPPORTED","This native adapter does not expose a model catalog");
    const key=contentHash({profileId,repositoryId});const generation=(this.catalogGenerations.get(key)??0)+1;this.catalogGenerations.set(key,generation);
    let catalog:AccountModelCatalog;
    try {
      const run=remote&&workspacePath?this.database.listEntities<JsonValue>("run").map(value=>value as unknown as Run).find(run=>run.profileId===profileId&&run.worktree===workspacePath&&!isTerminalRunState(run.state)):undefined;
      if(remote&&workspacePath&&!run)throw new AdapterContractError("RUN_CONTEXT_UNAVAILABLE","Remote worktree does not have matching canonical Run authority");
      catalog=remote?remoteCatalog(await this.remoteRequest(profile.runnerId,{type:"native.model_catalog",profileId,repositoryId,reason,...(run?{runId:run.id}:{})},run),{profileId,runnerId:profile.runnerId,providerId:profile.provider}):await adapter!.modelCatalog!({...context,workspacePath:workspacePath??repository.root});
    }
    catch (error) {
      catalog=error instanceof AdapterContractError&&(remote||error.code==="REMOTE_RESULT_INVALID")?fallback(error.code,error.message):error instanceof AdapterContractError && error.code==="NATIVE_VERSION_UNSUPPORTED" ? {...fallback(error.code,"Installed native version does not support the qualified catalog interface"),selectionSupport:"unsupported"} : error instanceof AdapterContractError && error.code==="NATIVE_CONTEXT_CHANGED" ? fallback(error.code,"Native account or configuration changed during the query; refresh before reviewing") : fallback("NATIVE_CATALOG_UNAVAILABLE","Native catalog could not be read; explicit selection is unavailable");
    }
    if(this.configuration.current().revision!==snapshot.revision)throw new PublicationError("SELECTION_CHANGED",409,"Configuration changed during native catalog query");
    if(this.catalogGenerations.get(key)!==generation)throw new PublicationError("CATALOG_SUPERSEDED",409,"A newer catalog request superseded this response");
    this.database.saveEntity("model-catalog",key,json(catalog));return catalog;
  }
  private async preparePublication(draft:PublishDraftV1,repository:RepositoryConfig,_workspacePath?:string,context?:{owner:string;reviewed?:ExecutionSelection}):Promise<ExecutionSelection> {
    const snapshot=this.configuration.current();const profile=snapshot.config.agentProfiles.find(p=>p.id===draft.execution.profileId);
    if(!profile)throw new PublicationError("PROFILE_REQUIRED",409,"Choose a configured native account");
    if(repositoryRunnerId(snapshot.config,repository)!==profile.runnerId)throw new PublicationError("RUNNER_REPOSITORY_MISMATCH",409,"Account and repository belong to different Runners");
    if(profile.runnerId!==this.embeddedRunner?.runner.id&&!(this.agentAdapters.get(profile.id) instanceof RemoteNativeAdapter))throw new PublicationError("REMOTE_EXECUTION_UNAVAILABLE",409,"Owning Runner has no qualified native execution backend");
    const catalog=await this.modelCatalog(profile.id,repository.id,_workspacePath?"before-start":"preflight",_workspacePath);
    if(catalog.selectionSupport==="unsupported")throw new PublicationError("NATIVE_SELECTION_UNSUPPORTED",409,"This native backend does not expose qualified per-run model selection");
    if(catalog.failure?.code==="NATIVE_AUTH_REQUIRED"||catalog.failure?.code==="PROFILE_DISABLED"||catalog.failure?.code==="NATIVE_CONTEXT_CHANGED")throw new PublicationError(catalog.failure.code,409,catalog.failure.message);
    const automatic=draft.execution.selectionMode==="policy-auto";
    let routingDecision:ExecutionSelection["routingDecision"];
    if(automatic){
      if(!context)throw new PublicationError("ROUTING_REVIEW_REQUIRED",409,"Automatic dispatch requires an authenticated routing review");
      if(draft.execution.selectionType||draft.execution.nativeModelId||Object.keys(draft.execution.nativeParameters??{}).length)throw new PublicationError("INVALID_AUTO_SELECTION",400,"Automatic routing cannot accept manual model parameters");
      if(context.reviewed){
        if(!context.reviewed.routingDecision)throw new PublicationError("ROUTING_REVIEW_REQUIRED",409,"Routing decision is required");
        routingDecision=context.reviewed.routingDecision;this.modelRouting.revalidate(context.owner,draft,snapshot.revision,catalog,routingDecision);
      }else routingDecision=await this.modelRouting.preview(context.owner,draft,snapshot.config,snapshot.revision,catalog);
      if(this.configuration.current().revision!==snapshot.revision)throw new PublicationError("ROUTING_DECISION_STALE",409,"Configuration changed during task classification");
      if(routingDecision.status!=="ready")throw new PublicationError(routingDecision.error!.code,409,routingDecision.error!.message,routingDecision);
    }
    const explicit=automatic||draft.execution.selectionType==="explicit-model";
    let nativeParameters:ExecutionSelection["nativeParameters"]={};
    if(automatic)nativeParameters={...routingDecision!.target!.nativeParameters};
    else if(explicit){
      if(catalog.freshness!=="native-fresh"||catalog.selectionSupport!=="explicit")throw new PublicationError("CATALOG_UNAVAILABLE",409,"A fresh native catalog is required for explicit selection");
      if(catalog.revision!==draft.execution.catalogRevision||catalog.contextFingerprint!==draft.execution.contextFingerprint)throw new PublicationError("SELECTION_CHANGED",409,"Model catalog or account/project context changed; review again");
      const entry=catalog.entries.find(e=>e.id===draft.execution.nativeModelId);
      if(!entry?.selectable||entry.access==="denied")throw new PublicationError("MODEL_UNAVAILABLE",409,"Selected native model is not selectable");
      if(entry.access==="unconfirmed"&&!draft.execution.allowUnconfirmedModelAccess)throw new PublicationError("MODEL_ACCESS_UNCONFIRMED",409,"Acknowledge that native catalog listing does not prove account access");
      for(const [key,value] of Object.entries(draft.execution.nativeParameters??{}))if(!entry.parameterOptions[key]?.includes(value))throw new PublicationError("INVALID_NATIVE_PARAMETERS",400,"Native parameter is not supported by the selected model");
      nativeParameters={...draft.execution.nativeParameters};
    }else if(Object.keys(draft.execution.nativeParameters??{}).length)throw new PublicationError("INVALID_NATIVE_PARAMETERS",400,"Native defaults do not accept model parameters");
    const candidates=this.dispatchCandidates(profile.id);
    if(_workspacePath)for(const candidate of candidates) candidate.activeRuns-=this.database.listEntities<JsonValue>("run").filter(v=>{const r=v as unknown as Run;return r.worktree===_workspacePath&&r.state==="STARTING"&&r.profileId===candidate.profileId;}).length;
    const decision=routeDeterministically({capabilities:["code","git"]},candidates);
    if(!decision.selected)throw new PublicationError("EXECUTION_UNAVAILABLE",409,decision.explanation);
    const backendId=decision.selected.adapter.manifest.backends[0]!.id;
    return {version:1,mode:automatic?"policy-auto":"manual",source:automatic?"policy":explicit?"explicit":"native-default",selectionType:explicit?"explicit-model":"native-default",...(explicit?{requestedModel:automatic?routingDecision!.target!.modelId:draft.execution.nativeModelId!,catalogRevision:catalog.revision}:{}),profileId:profile.id,runnerId:profile.runnerId,providerId:profile.provider,backendId,nativeParameters,...(routingDecision?{routingDecision}:{}),contextFingerprint:catalog.contextFingerprint,configRevision:snapshot.revision,selectedAt:this.now().toISOString()};
  }

  private async validateRunSelection(run:Run):Promise<void> {
    const registeredContract=(this.database.getEntity<JsonValue>("run-contract",run.id)??this.database.getTaskContract<JsonValue>(run.taskId)) as unknown as TaskContract|undefined;
    this.resolveProfileExecutionContext(run.profileId,registeredContract?.workspace?.repositoryId,"resume");
    if(!run.executionSelection)return;
    if(run.recoveryReason==="NATIVE_OUTCOME_UNKNOWN")throw new PublicationError("NATIVE_OUTCOME_UNKNOWN",409,"Inspect the original native process before continuing");
    const selection=run.executionSelection;
    const contract=this.database.getEntity<JsonValue>("run-contract",run.id) as unknown as TaskContract|undefined;
    if(!contract?.workspace||!run.worktree)throw new PublicationError("RUN_CONTEXT_UNAVAILABLE",409,"Frozen run context is unavailable");
    const catalog=await this.modelCatalog(run.profileId,contract.workspace.repositoryId,"before-start",run.worktree);
    if(catalog.failure?.code==="NATIVE_AUTH_REQUIRED"||catalog.runnerId!==selection.runnerId||catalog.contextFingerprint!==selection.contextFingerprint)throw new PublicationError("SELECTION_CHANGED",409,"Native account or project context changed before continuation");
    if(selection.selectionType==="explicit-model"&&(catalog.freshness!=="native-fresh"||catalog.revision!==selection.catalogRevision))throw new PublicationError("SELECTION_CHANGED",409,"Native model catalog changed before continuation");
    const current=this.database.getEntity<JsonValue>("run",run.id) as unknown as Run|undefined;
    if(!current||current.state!==run.state||current.generation!==run.generation||current.leaseId!==run.leaseId||current.sessionId!==run.sessionId)throw new PublicationError("RUN_CHANGED",409,"Run authority changed before continuation");
  }

  private dispatchTask(taskId: string, body: TaskDispatchBody, idempotencyKey?: string, publication?: PublicationRecord): Promise<TaskDispatchResult> {
    const dispatch = this.dispatchQueue.then(() => this.performDispatchTask(taskId, body, idempotencyKey, publication));
    this.dispatchQueue = dispatch.then(() => undefined, () => undefined);
    return dispatch;
  }

  private async performDispatchTask(taskId: string, body: TaskDispatchBody, idempotencyKey?: string, publication?: PublicationRecord): Promise<TaskDispatchResult> {
    const existing = idempotencyKey ? this.database.getEntity<JsonValue>("task-dispatch", idempotencyKey) : undefined;
    if (existing) {
      const result = existing as unknown as TaskDispatchResult;
      const current = this.database.getEntity<JsonValue>("run", result.run.id) as unknown as Run | undefined;
      return current?.generation === result.run.generation ? { ...result, run: current } : result;
    }
    const stored = this.database.getCanonicalTask<JsonValue>(taskId);
    const contract = this.database.getTaskContract<JsonValue>(taskId) as unknown as TaskContract | undefined;
    if (!stored || !contract) throw new TaskDispatchError("TASK_NOT_FOUND", 404, `Unknown task or contract ${taskId}`);
    if(publication&&(contentHash(contract)!==contentHash(publication.contract)||publication.taskBinding&&stored.revision!==publication.taskBinding.taskRevision))throw new PublicationError("TASK_CHANGED",409,"Task contract changed after publication approval");
    if ((stored.document as unknown as Task).state !== "READY") throw new TaskDispatchError("TASK_NOT_READY", 409, `Task ${taskId} is not dispatchable from ${(stored.document as unknown as Task).state}; READY is required`);
    if (body?.profileId && !this.agentAdapters.has(body.profileId)) throw new TaskDispatchError("PROFILE_NOT_FOUND", 404, `Unknown profile ${body.profileId}`);
    if ((this.database.getEntity<JsonValue>("task-archive", taskId) as { archivedAt?: string } | undefined)?.archivedAt) throw new TaskDispatchError("TASK_ARCHIVED", 409, "Restore the task before dispatch");
    if(contract.workspace && body.repositoryId && body.repositoryId!==contract.workspace.repositoryId)throw new PublicationError("REPOSITORY_MISMATCH",409,"Task workspace is bound to another repository");
    const repositoryId = contract.workspace?.repositoryId ?? body?.repositoryId ?? contract.delivery.repository;
    const repositoryConfig = this.configuration.current().config.repositories.find(entry=>entry.id===repositoryId);
    if (!repositoryId || !repositoryConfig) throw new TaskDispatchError("REPOSITORY_UNAVAILABLE",409,"Task repository is not registered");
    if(contract.workspace)assertPublicationScope(contract.scope,repositoryConfig.scopePaths);
    if(!publication&&contract.workspace){
      const intent=this.database.getEntity<JsonValue>("task-execution-intent",taskId) as unknown as {publicationId:string;execution:PublishDraftV1["execution"]}|undefined;
      if(intent){
        const original=this.database.getEntity<JsonValue>("task-publication",intent.publicationId) as unknown as PublicationRecord|undefined;
        if(!original)throw new PublicationError("PUBLICATION_NOT_FOUND",409,"Task publication context is unavailable");
        const execution=body.execution??intent.execution;
        if(intent.execution.selectionMode==="policy-auto"&&execution.selectionMode==="manual"&&execution.selectionType!=="explicit-model")throw new PublicationError("MANUAL_SELECTION_REQUIRED",409,"Overriding automatic routing requires a complete explicit native model selection");
        if(execution.selectionMode!=="manual")throw new PublicationError("ROUTING_REVIEW_REQUIRED",409,"Automatic routing requires a fresh publication review before dispatch");
        if(!body.execution&&execution.selectionType==="explicit-model"&&body.profileId&&body.profileId!==execution.profileId)throw new PublicationError("SELECTION_CHANGED",409,"Changing the account requires a fresh explicit model selection");
        const profileId=body.profileId??execution.profileId;
        const draft:PublishDraftV1={...original.draft,startMode:"dispatch",execution:{...execution,...(profileId?{profileId}:{})}};
        const selection=await this.preparePublication(draft,repositoryConfig);
        publication={...original,draft,selection,repository:repositoryConfig,configRevision:this.configuration.current().revision};
        body={...body,profileId:selection.profileId};
      }
    }
    if(publication && this.configuration.current().revision!==publication.configRevision)throw new PublicationError("SELECTION_CHANGED",409,"Configuration changed before dispatch");
    const repositoryRunner=repositoryRunnerId(this.configuration.current().config,repositoryConfig),remote=this.configuration.current().config.runners.some(runner=>runner.id===repositoryRunner&&runner.mode==="remote");
    if(body.profileId&&this.configuration.current().config.agentProfiles.find(profile=>profile.id===body.profileId)?.runnerId!==repositoryRunner)throw new PublicationError("RUNNER_REPOSITORY_MISMATCH",409,"Account and repository belong to different Runners");
    if(remote&&!publication?.selection)throw new PublicationError("REMOTE_SELECTION_REQUIRED",409,"Remote dispatch requires a reviewed native execution selection");
    if(remote&&contract.delivery.type!=="none")throw new PublicationError("REMOTE_DELIVERY_UNAVAILABLE",409,"Remote execution currently requires local result delivery on the owning Runner");
    const scheduler = new CanonicalScheduler(() => this.dispatchCandidates(body?.profileId).filter(candidate=>candidate.runnerId===repositoryRunner));
    const runId = randomUUID();
    const workspacePlan = {
      repositoryId,
      taskId: taskId,
      runId,
      attempt: 1,
      baseRef: contract.workspace?.baseRef ?? body?.baseRef ?? contract.delivery.baseBranch ?? repositoryConfig.defaultBaseRef,
      scopePaths: contract.workspace ? contract.scope : repositoryConfig.scopePaths,
      ...(contract.workspace?.baseCommit ? {baseCommit:contract.workspace.baseCommit}:{}),
      ...(contract.workspace?.targetBranch ? {targetBranch:contract.workspace.targetBranch}:{}),
    };
    this.database.saveEntity("workspace-intent",runId,json({...workspacePlan,state:remote?"PLANNED":"CREATING",runnerId:repositoryRunner}));
    const workspace=remote?this.remoteWorkspace(await this.remoteRequest(repositoryRunner,{type:"native.workspace_plan",profileId:publication!.selection!.profileId,plan:workspacePlan}),workspacePlan):await this.workspaces.create(workspacePlan);
    if(!remote)this.database.transaction(()=>{this.database.saveEntity("workspace-handle",runId,json(workspace));this.database.saveEntity("workspace-intent",runId,json({...workspacePlan,state:"CREATED",path:workspace.path}));});
    let dispatched: Awaited<ReturnType<CanonicalScheduler["dispatch"]>>;
    this.dispatchingRuns.add(runId);
    try {
      dispatched = await scheduler.dispatch({
        task: stored.document as unknown as Task,
        taskRevision: stored.revision,
        contract,
        requirements: {
          capabilities: ["code", "git", ...(body?.capabilities ?? [])],
          ...(body?.runnerTags?.length ? { runnerTags: body.runnerTags } : {}),
          ...(body?.providerIds?.length ? { providerIds: body.providerIds } : {}),
        },
        workspacePath: workspace.path,
        ...(publication?.selection ? {executionSelection:publication.selection}:{}),
        beforeStart:async()=>{
          if(publication&&contentHash(this.database.getTaskContract(taskId))!==contentHash(publication.contract))throw new PublicationError("TASK_CHANGED",409,"Task contract changed before native startup");
          if(remote){
            const reserved=this.database.getEntity<JsonValue>("run",runId) as unknown as Run|undefined;
            if(!reserved||reserved.state!=="STARTING")throw new PublicationError("RUN_CHANGED",409,"Remote workspace requires a reserved canonical Run");
            this.database.saveEntity("workspace-intent",runId,json({...workspacePlan,state:"CREATING",runnerId:repositoryRunner}));
            let prepared:unknown;
            try{prepared=await this.remoteRequest(repositoryRunner,{type:"native.workspace_prepare",runId,profileId:reserved.profileId,plan:workspacePlan,verificationCommandIds:contract.verification},reserved,`native-prepare:${runId}:${reserved.generation}`);}
            catch(error){if(error instanceof AdapterContractError)throw error;throw new AdapterContractError("COMMAND_OUTCOME_UNKNOWN","Remote workspace preparation response is unconfirmed");}
            const actual=this.remoteWorkspace(prepared,workspacePlan,workspace);
            this.database.transaction(()=>{this.database.saveEntity("workspace-handle",runId,json({...actual,runnerId:repositoryRunner}));this.database.saveEntity("workspace-intent",runId,json({...workspacePlan,state:"CREATED",path:actual.path,runnerId:repositoryRunner}));});
          }else for(const scope of workspace.scopePaths)await this.workspaces.assertPathAllowed(workspace,scope);
          if(publication?.selection){
            const selection=await this.preparePublication(publication.draft,repositoryConfig,workspace.path,{owner:publication.owner,reviewed:publication.selection});
            if(contentHash({...selection,selectedAt:undefined})!==contentHash({...publication.selection,selectedAt:undefined}))throw new PublicationError("SELECTION_CHANGED",409,"Selection changed before native startup");
            if(this.configuration.current().revision!==publication.configRevision)throw new PublicationError("SELECTION_CHANGED",409,"Configuration changed before native startup");
          }
          const reserved=this.database.getEntity<JsonValue>("run",runId) as unknown as Run|undefined;
          const currentTask=this.database.getCanonicalTask<JsonValue>(taskId)?.document as unknown as Task|undefined;
          if(reserved?.state!=="STARTING"||currentTask?.state!=="QUEUED"||currentTask.currentRunId!==runId)throw new PublicationError("RUN_CHANGED",409,"Task or run changed during preflight");
        },
        runId,
        onRunStarting: (run, decision) => {
          this.resolveProfileExecutionContext(run.profileId,repositoryId,"start");
          const selectedModel = this.configuration.current().config.agentProfiles.find((profile) => profile.id === run.profileId)?.settings?.model;
          if(publication?.selection?.requestedModel)run.model={id:publication.selection.requestedModel,source:"selection"};
          if (!publication?.selection && typeof selectedModel === "string") run.model = { id: selectedModel, source: "configuration" };
          run.branch = workspace.branch;
          run.leaseExpiresAt = new Date(this.now().getTime() + 15 * 60_000).toISOString();
          this.database.transaction(() => {
            if ((this.database.getEntity<JsonValue>("task-archive", taskId) as { archivedAt?: string } | undefined)?.archivedAt) throw new TaskDispatchError("TASK_ARCHIVED", 409, "Restore the task before dispatch");
            const current = this.database.getCanonicalTask<JsonValue>(taskId);
            const currentContract = this.database.getTaskContract<JsonValue>(taskId) as unknown as TaskContract | undefined;
            if (!current || (current.document as unknown as Task).state !== "READY" || currentContract?.revision !== contract.revision) throw new TaskDispatchError("TASK_CHANGED", 409, "Task changed before dispatch reservation");
            if(publication && this.configuration.current().revision!==publication.configRevision)throw new PublicationError("SELECTION_CHANGED",409,"Configuration changed during workspace creation");
            this.database.saveEntity("run-contract",run.id,json(contract));
            this.database.saveEntity("run-verification-config",run.id,json(repositoryConfig.verificationCommands));
            this.database.saveEntity("run", run.id, json(run));
            if(publication)this.publications.markStarting(publication.owner,publication.preview.publicationId,run);
            const bound = this.tasks.execute({ id: `dispatch:${run.id}:bound`, taskId, baseRevision: current.revision, actor: "scheduler", command: { type: "task.set-current-run", runId: run.id } });
            this.tasks.execute({ id: `dispatch:${run.id}:queued`, taskId, baseRevision: bound.revision, actor: "scheduler", command: { type: "task.transition", state: "QUEUED" } });
            if (idempotencyKey) this.database.saveEntity("task-dispatch", idempotencyKey, json({ run, routing: { explanation: decision.explanation, eligible: decision.eligible, rejected: decision.rejected } }));
          });
          this.restoreLeaseAuthority(run);
        },
      });
    } catch (error) {
      if(!remote){const cleanup = await this.workspaces.cleanupPlan(workspace);if (cleanup.safe) await this.workspaces.cleanup(cleanup);}
      if (error instanceof TaskDispatchError || error instanceof ConnectorError) throw error;
      throw new TaskDispatchError("DISPATCH_UNAVAILABLE", 409, error instanceof Error ? error.message : "Dispatch is unavailable");
    }finally{this.dispatchingRuns.delete(runId);}
    const reserved = this.database.getEntity<JsonValue>("run", dispatched.run.id) as unknown as Run | undefined;
    if (reserved?.model) dispatched.run.model = reserved.model;
    dispatched.run.branch = workspace.branch;
    if (dispatched.run.failureReason) dispatched.run.failureReason = String(redactValue(dispatched.run.failureReason));
    const result = { run: dispatched.run, routing: { explanation: dispatched.decision.explanation, eligible: dispatched.decision.eligible, rejected: dispatched.decision.rejected } };
    try {
      this.database.transaction(() => {
        const current = this.database.getCanonicalTask<JsonValue>(taskId)!;
        const task = current.document as unknown as Task;
        if (task.state !== "QUEUED" || task.currentRunId !== dispatched.run.id) throw new TaskDispatchError("TASK_CHANGED", 409, "Task changed during agent startup");
        this.saveAdvancedRun(dispatched.run, "STARTING");
        const state = dispatched.run.state === "FAILED" ? "FAILED" : dispatched.run.state==="RUNNER_UNAVAILABLE"?"WAITING_RESOURCE":"RUNNING";
        this.tasks.execute({ id: `dispatch:${dispatched.run.id}:${state}`, taskId, baseRevision: current.revision, actor: "scheduler", command: { type: "task.transition", state } });
        if(publication)this.publications.markOutcome(publication.owner,publication.preview.publicationId,dispatched.run);
        if (idempotencyKey) this.database.saveEntity("task-dispatch", idempotencyKey, json(result));
      });
    } catch (error) {
      if (!dispatched.run.sessionId.startsWith("unstarted:")) {
        try { await this.agentAdapters.get(dispatched.run.profileId)?.cancel(dispatched.run.sessionId); }
        catch (cleanupError) { this.app.log.warn({ error: redactValue(cleanupError), runId: dispatched.run.id }, "dispatch cleanup failed"); }
      }
      await this.failRun(dispatched.run, "Task or run authority changed during agent startup");
      throw error;
    }
    this.fleetEvents.publish("run.changed", dispatched.run.id, { id: dispatched.run.id, taskId: dispatched.run.taskId, state: dispatched.run.state });
    if(remote&&dispatched.run.state==="FAILED")try{await this.remoteRequest(repositoryRunner,{type:"lease.revoke",leaseId:dispatched.run.leaseId,generation:dispatched.run.generation,reason:"Canonical startup failed"},dispatched.run);}catch(error){this.app.log.warn({runId,error:redactValue(error)},"remote failed-start lease cleanup is unconfirmed");}
    return result;
  }

  private registerSemanticTools(): void {
    this.semanticTools.register({
      name: "task.dispatch", description: "Dispatch a READY task to a configured agent profile", risk: "privileged", requiredRoles: ["operator"],
      input: { required: ["target"], properties: { target: "string", profileId: "string" }, additionalProperties: false },
      execute: async ({ target, profileId }, context) => this.dispatchTask(String(target), typeof profileId === "string" ? { profileId } : {}, `semantic:${context.workflowId}`),
    });
    this.semanticTools.register({
      name: "agent.discover", description: "Discover an installed agent provider", risk: "read", input: { required: ["provider", "alias"], properties: { provider: "string", alias: "string", executable: "string", configDir: "string", codexHome: "string", model: "string" }, additionalProperties: false },
      execute: async (arguments_) => {
        const provider = String(arguments_.provider).toLocaleLowerCase();
        const alias = String(arguments_.alias);
        if (isNativeCliProvider(provider)) return probeNativeCliProfile(provider, { id: alias.toLocaleLowerCase(), alias, ...(typeof arguments_.configDir === "string" ? {configDir:arguments_.configDir}:{}), ...(typeof arguments_.executable === "string" ? { executable: arguments_.executable } : {}), ...(typeof arguments_.model === "string" ? { model: arguments_.model } : {}) });
        if (provider === "qoder") return probeQoderProfile({ id: alias.toLocaleLowerCase(), alias, ...(typeof arguments_.executable === "string" ? { executable: arguments_.executable } : {}), ...(typeof arguments_.configDir === "string" ? { configDir: arguments_.configDir } : {}), ...(typeof arguments_.model === "string" ? { model: arguments_.model } : {}) });
        if (provider === "codex" && typeof arguments_.codexHome === "string") return probeCodexProfile({ id: alias.toLocaleLowerCase(), alias, codexHome: arguments_.codexHome, ...(typeof arguments_.executable === "string" ? { executable: arguments_.executable } : {}), ...(typeof arguments_.model === "string" ? { model: arguments_.model } : {}) });
        throw new SemanticPolicyError("INVALID_INPUT", `Unsupported discovery provider ${provider}`);
      },
    });
    this.semanticTools.register({
      name: "agent.test_profile", description: "Test a configured agent profile", risk: "read", input: { required: ["target"], properties: { target: "string" }, additionalProperties: false },
      execute:async({target})=>this.probeConfiguredProfile(String(target)),
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
        if (run && !isTerminalRunState(run.state)) await this.cancelRunExecution(run);
        const current=this.database.getCanonicalTask<JsonValue>(taskId),latest=current?.document as unknown as Task|undefined;
        if(!current||!latest||latest.currentRunId!==task.currentRunId)throw new SemanticPolicyError("INVALID_INPUT","Task authority changed during cancellation");
        if (latest.state !== "CANCELLED") this.tasks.execute({ id: `semantic:${context.workflowId}`, taskId, baseRevision: current.revision, actor: context.principal.id, command: { type: "task.transition", state: "CANCELLED" } });
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
        const cancelled=await this.cancelRunExecution(run);
        const stored = this.database.getCanonicalTask<JsonValue>(run.taskId),task = stored?.document as unknown as Task | undefined;
        if (cancelled.state==="CANCELLED"&&stored && task?.currentRunId===run.id && !["DONE", "FAILED", "CANCELLED"].includes(task.state)) this.tasks.execute({ id: `semantic:${context.workflowId}`, taskId: run.taskId, baseRevision: stored.revision, actor: context.principal.id, command: { type: "task.transition", state: "CANCELLED" } });
        return cancelled;
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
        if(run.state==="RUNNER_UNAVAILABLE"&&this.configuration.current().config.runners.some(runner=>runner.id===run.runnerId&&runner.mode==="remote"))throw new SemanticPolicyError("INVALID_INPUT","Owning Runner must reconcile native ownership before resuming");
        if(run.recoveryReason==="NATIVE_OUTCOME_UNKNOWN")throw new SemanticPolicyError("INVALID_INPUT","Native execution outcome is unknown; inspect the original session before resuming");
        const adapter = this.agentAdapters.get(run.profileId);
        if (!adapter) throw new SemanticPolicyError("INVALID_INPUT", `Profile ${run.profileId} is unavailable`);
        await this.validateRunSelection(run);
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
        if(run.executionSelection)throw new SemanticPolicyError("INVALID_INPUT","Publication reroute requires a fresh account/model/workspace review and is not supported by the legacy reroute command");
        if(profile.runnerId!==run.runnerId||previousAdapter instanceof RemoteNativeAdapter||nextAdapter instanceof RemoteNativeAdapter)throw new SemanticPolicyError("INVALID_INPUT","Rerouting an existing workspace across Runner authority requires a new reviewed publication");
        const capabilityAssessment = assessManifestCapabilities(nextAdapter.manifest, run.requiredCapabilities ?? ["code", "git"]);
        if (!capabilityAssessment.supported) throw new SemanticPolicyError("INVALID_INPUT", capabilityAssessment.explanation);
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
        delete rerouted.model;
        delete rerouted.tokens;
        delete rerouted.tokenScope;
        delete rerouted.telemetryAt;
        if (typeof profile.settings?.model === "string") rerouted.model = { id: profile.settings.model, source: "configuration" };
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
      execute: async ({ config }, context) => this.planConfiguration(config, context.principal.id, "assistant"),
    });
    this.semanticTools.register({
      name: "config.build_plan", description: "Build a ConfigPlan without applying it", risk: "write", input: { required: ["config"], properties: { config: "object" }, additionalProperties: false },
      execute: async ({ config }, context) => this.planConfiguration(config, context.principal.id, "assistant"),
    });
    this.semanticTools.register({
      name: "config.apply", description: "Apply a confirmed ConfigPlan", risk: "privileged", requiredRoles: ["admin"], input: { required: ["planId"], properties: { planId: "string" }, additionalProperties: false },
      execute: async ({ planId }) => {
        return this.applyConfigurationPlan(String(planId), { confirmed: true });
      },
    });
    this.semanticTools.register({
      name: "config.apply_plan", description: "Apply a confirmed ConfigPlan", risk: "privileged", requiredRoles: ["admin"], input: { required: ["planId"], properties: { planId: "string" }, additionalProperties: false },
      execute: async ({ planId }) => {
        return this.applyConfigurationPlan(String(planId), { confirmed: true });
      },
    });
    this.semanticTools.register({
      name: "config.rollback", description: "Rollback an applied ConfigPlan", risk: "privileged", requiredRoles: ["admin"], input: { required: ["planId"], properties: { planId: "string" }, additionalProperties: false },
      execute: async ({ planId }) => this.rollbackConfigurationPlan(String(planId)),
    });
    this.semanticTools.register({
      name: "secret.request", description: "Request secure input without reading a secret", risk: "write", input: { required: ["namespace", "name"], properties: { namespace: "string", name: "string" }, additionalProperties: false },
      execute: async ({ namespace, name }) => ({ required: true, secureInput: { namespace, name }, acceptsLiteralValue: false }),
    });
  }

  private taskIdentifierAliases(taskId: string): string[] {
    const task = this.database.getCanonicalTask<JsonValue>(taskId)?.document as unknown as Task | undefined;
    const extensions = task?.platformExtensions;
    return Object.values(extensions ?? {}).flatMap((extension) => {
      const identifier = extension && typeof extension === "object" && !Array.isArray(extension) ? (extension as Record<string, unknown>).identifier : undefined;
      return typeof identifier === "string" ? [identifier] : [];
    });
  }

  private semanticCandidates(): ResolvableEntity[] {
    const snapshot = this.fleetSnapshot();
    return [
      ...snapshot.tasks.map((task) => ({ id: task.id, kind: "task" as const, label: task.title, aliases: [...(task.externalRefs?.map((reference) => reference.externalId) ?? []), ...this.taskIdentifierAliases(task.id)] })),
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
    const binding = this.runConversation(run);
    const attentionSubject = state === "WAITING_USER" ? `${run.taskId}:${binding?.revision ?? 1}` : run.taskId;
    if (!this.attentionNotifications.shouldNotify({ taskId: attentionSubject, state, generation: run.generation })) return;
    const idempotencyKey = `attention:${run.taskId}:${state}:${run.generation}${state === "WAITING_USER" ? `:${binding?.revision ?? 1}` : ""}`;
    if (this.database.getEntity<JsonValue>("attention-notification", idempotencyKey)) return;
    const connector = (binding ? this.connectors.get<MessagingAdapter>(binding.connectorInstanceId) : undefined)
      ?? this.connectors.list("messaging").find((entry) => this.messagingChannels.has(entry.instance.id)) as MessagingAdapter | undefined;
    if (!connector) return;
    const channel = binding?.conversationId ?? this.messagingChannels.get(connector.instance.id)!;
    const task = this.database.getCanonicalTask<JsonValue>(run.taskId)?.document as unknown as Task | undefined;
    const notification: Notification = {
      channel,
      subject: `${state}: ${task?.title ?? run.taskId}`,
      body: run.failureReason ?? run.resourceBlockReason ?? run.prUrl ?? run.activitySummary ?? "Open the thread to inspect or respond.",
      severity: state === "FAILED" ? "critical" : state === "REVIEW_READY" ? "info" : "warning",
      canonicalEntityId: run.taskId,
    };
    const sent = binding && connector.reply
      ? await connector.reply({ channel, threadId: binding.threadId, text: `${notification.subject}\n${notification.body}` }, idempotencyKey)
      : await connector.send(notification, idempotencyKey);
    this.database.saveEntity("attention-notification", idempotencyKey, json({ idempotencyKey, taskId: run.taskId, state, generation: run.generation, externalMessageId: sent.externalMessageId, sentAt: new Date().toISOString() }));
    if (state === "WAITING_USER") {
      this.conversations.bind({ connectorInstanceId: connector.instance.id, conversationId: channel, threadId: binding?.threadId ?? sent.externalMessageId, taskId: run.taskId, runId: run.id, sessionId: run.sessionId, generation: run.generation, state: "WAITING_USER" });
    }
  }

  private async notifyDueAttention(): Promise<void> {
    for (const value of this.database.listEntities<JsonValue>("run")) {
      const run = value as unknown as Run;
      if (!["WAITING_USER", "RESOURCE_BLOCKED", "FAILED", "COMPLETE"].includes(run.state)) continue;
      try {
        if (run.state === "FAILED") {
          const task = this.database.getCanonicalTask<JsonValue>(run.taskId);
          if (task) this.tasks.execute({ id: `failure-comment:${run.id}:${run.generation}`, taskId: run.taskId, baseRevision: task.revision, actor: "run-worker", command: { type: "task.comment", body: `Run ${run.id} FAILED: ${run.failureReason ?? "Execution failed"}` } });
        }
        await this.notifyAttention(run);
      }
      catch (error) {
        this.attentionNotifications.recover(run.taskId);
        this.app.log.warn({ error: redactValue(error), runId: run.id }, "attention notification will retry");
      }
    }
  }

  private messagingWorkflowText(workflow: SemanticWorkflowRecord): string {
    if (workflow.toolName === "task.dispatch" && workflow.state === "EXECUTED") {
      const result = workflow.result as TaskDispatchResult;
      return result.run.state === "FAILED" ? `Run ${result.run.id} FAILED: ${result.run.failureReason ?? "Agent could not start"}` : `Dispatched run ${result.run.id}.\n${result.routing.explanation}`;
    }
    return JSON.stringify(redactValue(workflow.result)).slice(0, 3_000);
  }

  private runConversation(run: Run): ConversationBinding | undefined {
    return this.database.listEntities<JsonValue>("messaging-conversation")
      .map((value) => value as unknown as ConversationBinding)
      .find((binding) => binding.runId === run.id && binding.sessionId === run.sessionId && binding.generation === run.generation);
  }

  private async executeMessagingWorkflow(workflow: SemanticWorkflowRecord): Promise<SemanticWorkflowRecord> {
    const origin = this.database.getEntity<JsonValue>("messaging-workflow-origin", workflow.id) as unknown as { connectorInstanceId: string; conversationId: string; threadId: string } | undefined;
    if (workflow.toolName === "task.dispatch" && workflow.state === "READY" && origin) {
      const existing = this.database.getEntity<JsonValue>("messaging-conversation", `${origin.connectorInstanceId}:${origin.conversationId}:${origin.threadId}`);
      if (existing) throw new ConnectorError("CONFLICT", "This thread already belongs to a run; dispatch in a new thread", { retryable: false, operation: "write" });
    }
    if (workflow.state === "READY") {
      try { workflow = await this.semanticWorkflows.execute(workflow.id, workflow.revision); }
      catch (error) {
        if (!(error instanceof TaskDispatchError || error instanceof ConnectorError && error.code === "CONFLICT")) throw error;
        workflow = this.semanticWorkflows.get(workflow.id)!;
      }
    }
    if (workflow.toolName === "task.dispatch" && workflow.state === "EXECUTED" && origin) {
      const run = (workflow.result as TaskDispatchResult).run;
      this.conversations.bind({ ...origin, taskId: run.taskId, runId: run.id, sessionId: run.sessionId, generation: run.generation, state: this.runConversation(run)?.state ?? "ACTIVE" });
    }
    return workflow;
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

  private assertMessagingInputAuthority(run: Run, binding: ConversationBinding, expectedRevision: number): void {
    const current = this.database.getEntity<JsonValue>("run", run.id) as unknown as Run | undefined;
    const task = this.database.getCanonicalTask<JsonValue>(run.taskId)?.document as unknown as Task | undefined;
    const conversation = this.database.getEntity<JsonValue>("messaging-conversation", binding.id) as unknown as ConversationBinding | undefined;
    if (!current || !task || current.generation !== run.generation || current.leaseId !== run.leaseId || current.sessionId !== binding.sessionId || current.state !== "WAITING_USER" || task.currentRunId && task.currentRunId !== run.id || !conversation || conversation.revision !== expectedRevision || conversation.generation !== run.generation || conversation.state !== "WAITING_USER") throw new ConnectorError("CONFLICT", "Run or intervention authority changed", { retryable: false, operation: "write" });
    this.restoreLeaseAuthority(current);
    try { this.leaseAuthority.fence(run.id, run.leaseId, run.generation, "user-input", this.now().toISOString()); }
    catch (error) {
      if (error instanceof LeaseFenceError) throw new ConnectorError("CONFLICT", error.message, { retryable: false, operation: "write" });
      throw error;
    } finally { this.persistLatestLeaseAudit(run.id); }
  }

  private replyMessagingResume(adapter: MessagingAdapter, message: NormalizedMessage, runId: string): Promise<{ externalMessageId: string }> {
    return adapter.reply
      ? adapter.reply({ channel: message.conversationId, threadId: message.threadId, text: `Resumed run ${runId} in the existing agent session.` }, `resume:${message.idempotencyKey}`)
      : adapter.send({ channel: message.conversationId, subject: "Run resumed", body: runId, severity: "info" }, `resume:${message.idempotencyKey}`);
  }

  private async handleMessagingMessage(adapter: MessagingAdapter, message: NormalizedMessage, options: { credentialRedacted?: boolean } = {}): Promise<{ externalMessageId: string }> {
    const principal = this.messagingIdentity.authorize(adapter.instance.id, message.principalExternalId);
    if (options.credentialRedacted || CREDENTIAL_PATTERN.test(message.text)) {
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
      const origin = this.database.getEntity<JsonValue>("messaging-workflow-origin", workflow.id) as unknown as { connectorInstanceId: string; conversationId: string; threadId: string } | undefined;
      if (origin && (origin.connectorInstanceId !== adapter.instance.id || origin.conversationId !== message.conversationId || origin.threadId !== message.threadId)) throw new ConnectorError("AUTH", "Approve dispatch in its originating thread", { retryable: false, operation: "auth" });
      const approved = workflow.state === "EXECUTED" || workflow.state === "FAILED" || workflow.state === "READY" && workflow.revision === action.expectedRevision + 1
        ? workflow : this.semanticWorkflows.approve(workflow.id, action.expectedRevision);
      const executed = await this.executeMessagingWorkflow(approved);
      const text = this.messagingWorkflowText(executed);
      return adapter.reply
        ? adapter.reply({ channel: message.conversationId, threadId: message.threadId, text }, `workflow-approval:${message.idempotencyKey}`)
        : adapter.send({ channel: message.conversationId, subject: "Workflow approved", body: text, severity: "info" }, `workflow-approval:${message.idempotencyKey}`);
    }
    const resumeKey = `${adapter.instance.id}:${message.idempotencyKey}`;
    const receipt = this.database.getEntity<JsonValue>("messaging-resume", resumeKey) as unknown as MessagingResumeReceipt | undefined;
    if (receipt) {
      this.messagingIdentity.authorize(adapter.instance.id, message.principalExternalId, "operator");
      const current = this.database.getEntity<JsonValue>("run", receipt.runId) as unknown as Run | undefined;
      if (receipt.principalId !== principal.principalId || receipt.connectorInstanceId !== adapter.instance.id || receipt.conversationId !== message.conversationId || receipt.threadId !== message.threadId || !current || current.generation !== receipt.generation || current.sessionId !== receipt.sessionId) throw new ConnectorError("CONFLICT", "Consumed reply belongs to an obsolete intervention", { retryable: false });
      return this.replyMessagingResume(adapter, message, receipt.runId);
    }
    const bindingId = `${adapter.instance.id}:${message.conversationId}:${message.threadId}`;
    const binding = this.database.getEntity<JsonValue>("messaging-conversation", bindingId) as unknown as ConversationBinding | undefined;
    if (binding?.state === "WAITING_USER" && binding.sessionId && binding.runId) {
      const expectedRevision = message.action?.expectedRevision ?? binding.revision;
      const generation = message.action?.generation ?? binding.generation;
      const run = this.database.getEntity<JsonValue>("run", binding.runId) as unknown as Run | undefined;
      if (!run || run.generation !== generation || run.sessionId !== binding.sessionId || run.state !== "WAITING_USER") throw new ConnectorError("CONFLICT", "The referenced run is stale", { retryable: false, operation: "write" });
      this.messagingIdentity.authorize(adapter.instance.id, message.principalExternalId, "operator");
      if (binding.revision !== expectedRevision || binding.generation !== generation) throw new ConnectorError("CONFLICT", "Conversation binding is stale", { retryable: false, operation: "write" });
      const agent = this.agentAdapters.get(run.profileId);
      if (!agent) throw new ConnectorError("PERMANENT", "The run profile is unavailable", { retryable: false, operation: "write" });
      this.assertMessagingInputAuthority(run, binding, expectedRevision);
      await this.validateRunSelection(run);
      this.assertMessagingInputAuthority(run,binding,expectedRevision);
      await agent.send(binding.sessionId, message.text || "Continue with the approved action.");
      try {
        this.assertMessagingInputAuthority(run, binding, expectedRevision);
      } catch (error) {
        try { await agent.cancel(binding.sessionId); }
        catch (cleanupError) { this.app.log.warn({ error: redactValue(cleanupError), runId: run.id }, "stale input session cleanup failed"); }
        throw error;
      }
      this.database.transaction(() => {
        assertRunTransition(run.state, "ACTIVE");
        run.state = "ACTIVE";
        run.lastActivityAt = new Date().toISOString();
        this.saveAdvancedRun(run, "WAITING_USER");
        this.conversations.resume(bindingId, { expectedRevision, generation });
        const task = this.database.getCanonicalTask<JsonValue>(run.taskId)!;
        if ((task.document as unknown as Task).state === "WAITING_USER") this.tasks.execute({ id: `messaging-resume:${message.idempotencyKey}`, taskId: run.taskId, baseRevision: task.revision, actor: principal.principalId, command: { type: "task.transition", state: "RUNNING" } });
        this.database.saveEntity("messaging-resume", resumeKey, json({ version: 1, runId: run.id, sessionId: run.sessionId, generation: run.generation, interventionRevision: expectedRevision, principalId: principal.principalId, connectorInstanceId: adapter.instance.id, conversationId: message.conversationId, threadId: message.threadId } satisfies MessagingResumeReceipt));
      });
      this.attentionNotifications.recover(run.taskId);
      return this.replyMessagingResume(adapter, message, run.id);
    }
    const workflowId = `messaging:${adapter.instance.id}:${message.idempotencyKey}`;
    const intent = await this.parseAssistantIntent(message.text);
    let workflow = this.semanticWorkflows.get(workflowId) ?? this.semanticWorkflows.plan({
      id: workflowId,
      intent,
      principal: { id: principal.principalId, roles: principal.roles, channel: "messaging" },
      candidates: this.semanticCandidates(),
    });
    this.database.saveEntity("messaging-workflow-origin", workflowId, json({ connectorInstanceId: adapter.instance.id, conversationId: message.conversationId, threadId: message.threadId }));
    workflow = await this.executeMessagingWorkflow(workflow);
    const text = workflow.state === "EXECUTED" || workflow.state === "FAILED"
      ? this.messagingWorkflowText(workflow)
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

  private now(): Date {
    return this.options.clock?.() ?? new Date();
  }

  private principalFor(request: object): ControlPrincipal {
    const principal = this.requestPrincipals.get(request);
    if (!principal) throw new ConnectorError("AUTH", "Control-plane authentication is required", { retryable: false, operation: "auth" });
    return principal;
  }

  private async resolveOwnerToken(): Promise<string> {
    if (this.options.ownerToken) return this.options.ownerToken;
    if ((await this.secrets.metadata(OWNER_TOKEN_REFERENCE)).exists) {
      return this.secrets.resolve(OWNER_TOKEN_REFERENCE, { principal: "controller", purpose: "provider" });
    }
    this.ownerToken ??= (async () => {
      const token = randomBytes(32).toString("base64url");
      await this.secrets.put(OWNER_TOKEN_REFERENCE, token);
      return token;
    })().finally(() => {
      this.ownerToken = undefined;
    });
    return this.ownerToken;
  }

  private async drainProjections(now?: Date): Promise<Awaited<ReturnType<ProjectionWorker["drain"]>>> {
    while (this.projectionDrain) await this.projectionDrain.catch(() => undefined);
    const drain = this.projections.drain(now ?? this.now());
    this.projectionDrain = drain;
    try {
      return await drain;
    } finally {
      if (this.projectionDrain === drain) this.projectionDrain = undefined;
    }
  }

  private advanceRunExclusive(runId: string): Promise<AdvanceResult> {
    const existing = this.runAdvances.get(runId);
    if (existing) return existing;
    const advance = (async () => {
      const advanced = await this.advanceRun(runId);
      this.fleetEvents.publish("run.changed", advanced.run.id, { id: advanced.run.id, taskId: advanced.run.taskId, state: advanced.run.state, lastActivityAt: advanced.run.lastActivityAt });
      try {
        await this.notifyAttention(advanced.run);
      } catch (error) {
        this.attentionNotifications.recover(advanced.run.taskId);
        this.app.log.error({ error: redactValue(error), runId: advanced.run.id }, "attention notification failed");
      }
      return advanced;
    })().finally(() => {
      this.runAdvances.delete(runId);
    });
    this.runAdvances.set(runId, advance);
    return advance;
  }

  private async advanceDueRuns(limit: number, baseDelayMs: number, maxDelayMs: number): Promise<void> {
    const now = this.now().getTime();
    const due = this.database.listEntities<JsonValue>("run")
      .map((value) => value as unknown as Run)
      .filter((run) => ADVANCEABLE_RUN_STATES.has(run.state) && !this.runAdvances.has(run.id) && (this.runRetries.get(run.id)?.nextAttemptAt ?? 0) <= now);
    await runBounded(due, limit, async (run) => {
      try {
        await this.advanceRunExclusive(run.id);
        this.runRetries.delete(run.id);
      } catch (error) {
        const failures = (this.runRetries.get(run.id)?.failures ?? 0) + 1;
        this.runRetries.set(run.id, { failures, nextAttemptAt: this.now().getTime() + backoffDelayMs(failures, baseDelayMs, maxDelayMs) });
        this.app.log.warn({ error: redactValue(error), runId: run.id, failures }, "background run advancement failed");
      }
    });
  }

  private assertCurrentDeliveryRun(run: Run): void {
    const current = this.database.getEntity<JsonValue>("run", run.id) as unknown as Run | undefined;
    const task = this.database.getCanonicalTask<JsonValue>(run.taskId)?.document as unknown as Task | undefined;
    if (!current || !task || current.state !== "COMPLETE" || current.generation !== run.generation || current.leaseId !== run.leaseId || task.currentRunId && task.currentRunId !== run.id) throw new ConnectorError("CONFLICT", "Delivery feedback belongs to an obsolete run", { retryable: false, operation: "read" });
  }

  private async reconcileDeliveryRuns(limit: number): Promise<void> {
    const now = this.now();
    const due = this.database.listEntities<JsonValue>("run").map((value) => value as unknown as Run).filter((run) => {
      if (run.state !== "COMPLETE" || !run.prUrl) return false;
      const monitor = this.database.getEntity<JsonValue>("delivery-monitor", `${run.id}:${run.generation}`) as unknown as { nextAttemptAt: string } | undefined;
      return !monitor || Date.parse(monitor.nextAttemptAt) <= now.getTime();
    });
    await runBounded(due, limit, async (run) => {
      const id = `${run.id}:${run.generation}`;
      try {
        this.assertCurrentDeliveryRun(run);
        const contract = this.database.getTaskContract<JsonValue>(run.taskId) as unknown as TaskContract | undefined;
        const [owner, name] = contract?.delivery.repository?.split("/") ?? [];
        if (!owner || !name) return;
        const evidence = this.database.listDeliveryEvidence<JsonValue>(run.taskId) as unknown as Array<{ kind: string; runId: string; connectorInstanceId: string }>;
        const connectorId = evidence.find((item) => item.kind === "pull-request" && item.runId === run.id)?.connectorInstanceId;
        const scm = connectorId ? this.connectors.get<ScmAdapter>(connectorId) : undefined;
        if (!scm) return;
        const reconciled = await new DeliveryService(this.database).reconcile(scm, { taskId: run.taskId, runId: run.id, generation: run.generation, repository: { owner, name }, assertCurrent: () => this.assertCurrentDeliveryRun(run) });
        if (!reconciled) return;
        const { pullRequest, ci } = reconciled;
        const feedbackId = `delivery-feedback:${id}:${pullRequest.revision}:${ci.revision}`;
        const ciLabel = ci.state === "READY" ? "CI_PASSED" : ci.state === "FAILED" ? "CI_FAILED" : "CI_PENDING";
        const prLabel = pullRequest.state === "MERGED" ? "PR_MERGED" : pullRequest.state === "FAILED" ? "PR_CLOSED" : "PR_OPEN";
        const body = `${ciLabel} / ${prLabel}: ${pullRequest.url ?? run.prUrl}\nCommit: ${ci.externalId}${ci.url ? `\nChecks: ${ci.url}` : ""}`;
        this.database.transaction(() => {
          this.assertCurrentDeliveryRun(run);
          if (!this.database.getEntity("delivery-feedback", feedbackId)) {
            const task = this.database.getCanonicalTask<JsonValue>(run.taskId)!;
            this.tasks.execute({ id: feedbackId, taskId: run.taskId, baseRevision: task.revision, actor: "delivery-worker", command: { type: "task.comment", body } });
            this.database.saveEntity("delivery-feedback", feedbackId, json({ version: 1, id: feedbackId, runId: run.id, generation: run.generation, body, severity: ci.state === "FAILED" || pullRequest.state === "FAILED" ? "critical" : "info", status: "PENDING", failures: 0, nextAttemptAt: now.toISOString() } satisfies DeliveryFeedback));
          }
          const doneOnCiPassed = this.configuration.current().config.connectors.find((connector) => connector.id === scm.instance.id)?.settings?.doneOnCiPassed === true;
          const current = this.database.getCanonicalTask<JsonValue>(run.taskId)!;
          if (doneOnCiPassed && ci.state === "READY" && pullRequest.state !== "FAILED" && (current.document as unknown as Task).state === "REVIEW") this.tasks.execute({ id: `${feedbackId}:done`, taskId: run.taskId, baseRevision: current.revision, actor: "delivery-worker", command: { type: "task.transition", state: "DONE" } });
          this.database.saveEntity("delivery-monitor", id, json({ version: 1, nextAttemptAt: new Date(now.getTime() + 30_000).toISOString(), failures: 0 }));
        });
        this.fleetEvents.publish("task.changed", run.taskId, { id: run.taskId, ci: ci.state, pr: pullRequest.state });
      } catch (error) {
        const previous = this.database.getEntity<JsonValue>("delivery-monitor", id) as unknown as { failures?: number } | undefined;
        const failures = (previous?.failures ?? 0) + 1;
        this.database.saveEntity("delivery-monitor", id, json({ version: 1, failures, nextAttemptAt: new Date(now.getTime() + backoffDelayMs(failures, 1_000, 5 * 60_000)).toISOString() }));
        this.app.log.warn({ error: redactValue(error), runId: run.id }, "delivery reconciliation will retry");
      }
    });
  }

  private async notifyDeliveryFeedback(): Promise<void> {
    const now = this.now();
    const due = (this.database.listEntities<JsonValue>("delivery-feedback") as unknown as DeliveryFeedback[])
      .filter((feedback) => feedback.status === "PENDING" && Date.parse(feedback.nextAttemptAt) <= now.getTime()).slice(0, 10);
    for (const feedback of due) {
      const run = this.database.getEntity<JsonValue>("run", feedback.runId) as unknown as Run | undefined;
      try {
        if (!run || run.generation !== feedback.generation) throw new ConnectorError("CONFLICT", "Stale delivery notification", { retryable: false });
        this.assertCurrentDeliveryRun(run);
        const binding = this.runConversation(run);
        const connector = (binding ? this.connectors.get<MessagingAdapter>(binding.connectorInstanceId) : undefined) ?? this.connectors.list("messaging").find((entry) => this.messagingChannels.has(entry.instance.id)) as MessagingAdapter | undefined;
        if (!connector) continue;
        const channel = binding?.conversationId ?? this.messagingChannels.get(connector.instance.id)!;
        if (binding && connector.reply) await connector.reply({ channel, threadId: binding.threadId, text: feedback.body }, feedback.id);
        else await connector.send({ channel, subject: "Delivery status", body: feedback.body, severity: feedback.severity, canonicalEntityId: run.taskId }, feedback.id);
        feedback.status = "SENT";
      } catch (error) {
        if (error instanceof ConnectorError && error.code === "CONFLICT") feedback.status = "OBSOLETE";
        else {
          feedback.failures += 1;
          const delay = error instanceof ConnectorError ? error.options.retryAfterMs : undefined;
          feedback.nextAttemptAt = new Date(now.getTime() + (delay ?? backoffDelayMs(feedback.failures, 1_000, 5 * 60_000))).toISOString();
          this.app.log.warn({ error: redactValue(error), runId: feedback.runId }, "delivery notification will retry");
        }
      }
      this.database.saveEntity("delivery-feedback", feedback.id, json(feedback));
    }
  }

  private async processMessagingInbox(limit: number): Promise<void> {
    for (const record of this.messagingInbox.claimDue(limit)) await this.processMessagingInboxRecord(record);
  }

  private async processMessagingInboxRecord(record: MessagingInboxRecord): Promise<void> {
    const message = record.message;
    if (!message) return;
    const adapter = this.connectors.list("messaging").find((entry) => entry.instance.id === record.connectorInstanceId) as MessagingAdapter | undefined;
    try {
      if (!adapter) throw new ConnectorError("TEMPORARY", "Messaging connector is not configured", { retryable: true, operation: "ingress" });
      if (!this.messagingPrincipalLinked(adapter.instance.id, message.principalExternalId)) {
        const sent = await this.replyUnauthorized(adapter, message);
        this.messagingInbox.complete(record.id, "UNAUTHORIZED", sent?.externalMessageId);
        return;
      }
      try {
        const sent = await this.handleMessagingMessage(adapter, message, { credentialRedacted: record.credentialRedacted });
        this.messagingInbox.complete(record.id, "REPLIED", sent.externalMessageId);
      } catch (error) {
        if (!(error instanceof SemanticPolicyError && error.code === "FORBIDDEN")) throw error;
        const sent = await this.replyUnauthorized(adapter, message);
        this.messagingInbox.complete(record.id, "UNAUTHORIZED", sent?.externalMessageId);
      }
    } catch (error) {
      const retryable = error instanceof ConnectorError ? error.options.retryable : !(error instanceof SemanticPolicyError || error instanceof RevisionConflictError);
      const reason = String(redactValue(error instanceof Error ? error.message : "messaging workflow failed")).slice(0, 500);
      const failed = this.messagingInbox.fail(record.id, reason, retryable);
      this.app.log.warn({ error: redactValue(error), inboxId: record.id, status: failed.status, attempts: failed.attempts }, "messaging inbox processing failed");
      if (failed.status === "DEAD_LETTER" && adapter) {
        try {
          await this.replyToMessage(adapter, message, "Dispatcher could not process this message. The owner can inspect it in the Dashboard dead-letter queue.", `dead-letter:${message.idempotencyKey}`);
        } catch (replyError) {
          this.app.log.warn({ error: redactValue(replyError), inboxId: record.id }, "messaging dead-letter notice failed");
        }
      }
    }
  }

  private messagingPrincipalLinked(connectorInstanceId: string, externalPrincipalId: string): boolean {
    try {
      this.messagingIdentity.authorize(connectorInstanceId, externalPrincipalId);
      return true;
    } catch (error) {
      if (error instanceof ConnectorError && error.code === "AUTH") return false;
      throw error;
    }
  }

  private async replyUnauthorized(adapter: MessagingAdapter, message: NormalizedMessage): Promise<{ externalMessageId: string } | undefined> {
    const key = `unauthorized:${adapter.instance.id}:${message.conversationId}:${message.threadId}:${message.principalExternalId}`;
    if (this.database.getEntity<JsonValue>("messaging-unauthorized-notice", key)) return undefined;
    const sent = await this.replyToMessage(adapter, message, "You are not authorized to run this Dispatcher action. Ask the Dispatcher owner to link your account or grant the required role.", key);
    this.database.saveEntity("messaging-unauthorized-notice", key, json({ key, connectorInstanceId: adapter.instance.id, principalExternalId: message.principalExternalId, externalMessageId: sent.externalMessageId, sentAt: this.now().toISOString() }));
    return sent;
  }

  private replyToMessage(adapter: MessagingAdapter, message: NormalizedMessage, text: string, idempotencyKey: string): Promise<{ externalMessageId: string }> {
    return adapter.reply
      ? adapter.reply({ channel: message.conversationId, threadId: message.threadId, text }, idempotencyKey)
      : adapter.send({ channel: message.conversationId, subject: "Dispatcher", body: text, severity: "warning" }, idempotencyKey);
  }

  private async revokeRunnerCredential(runnerId: string, credentialRef: string | undefined): Promise<void> {
    this.enrollments.revoke(runnerId, this.now());
    for(const value of this.database.listEntities<JsonValue>("run")){
      const run=value as unknown as Run;if(run.runnerId!==runnerId||isTerminalRunState(run.state))continue;
      this.restoreLeaseAuthority(run);this.leaseAuthority.revoke(run.id,run.leaseId,run.generation,"Runner credential revoked",this.now().toISOString());this.persistLatestLeaseAudit(run.id);
      this.markRemoteUnavailable(run.id,"Runner credentials revoked; owning process termination requires confirmation","REMOTE_LEASE_INVALID",run);
    }
    if (credentialRef && (await this.secrets.metadata(credentialRef)).exists) await this.secrets.delete(credentialRef);
    this.remoteRunnerServer.disconnect(runnerId, "credential revoked");
    this.database.saveEntity("runner-identity", runnerId, json({ runnerId, ...(credentialRef ? { credentialRef } : {}), revokedAt: this.now().toISOString() }));
  }

  private readonly modelRouting: ModelRoutingService;
  private readonly publications: PublicationService;

  private registerRoutes(): void {
    this.app.addHook("onRequest", async (request, reply) => {
      const decision = await this.controlAuth.evaluate({ method: request.method, url: request.url, headers: request.headers, ip: request.ip });
      if (decision.kind === "authenticated") this.requestPrincipals.set(request, decision.principal);
      if (decision.kind !== "rejected") return;
      if (decision.retryAfterSeconds) reply.header("retry-after", String(decision.retryAfterSeconds));
      return reply.code(decision.status).send({ code: decision.code, message: decision.message });
    });
    this.app.addHook("onSend", async (request, reply, payload) => {
      reply.header("x-content-type-options", "nosniff");
      reply.header("x-frame-options", "DENY");
      reply.header("referrer-policy", "no-referrer");
      reply.header("cross-origin-opener-policy", "same-origin");
      reply.header("content-security-policy", "frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
      if (request.url.startsWith("/api/") || request.url.startsWith("/auth/")) reply.header("cache-control", "no-store");
      return payload;
    });
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

    this.app.post<{ Body: { token?: string; code?: string; username?: string; password?: string } }>("/auth/session", async (request, reply) => {
      const token = typeof request.body?.token === "string" ? request.body.token : undefined;
      const code = typeof request.body?.code === "string" ? request.body.code : undefined;
      const username = typeof request.body?.username === "string" ? request.body.username : undefined;
      const password = typeof request.body?.password === "string" ? request.body.password : undefined;
      const session = await this.controlAuth.createSession({ ...(token ? { token } : {}), ...(code ? { code } : {}), ...(username ? { username } : {}), ...(password ? { password } : {}) }, request.ip);
      if (!session) return reply.code(401).send({ code: "AUTH_REJECTED", message: "Login credential is invalid or expired" });
      reply.header("set-cookie", this.controlAuth.sessionCookies(session, request.protocol === "https"));
      return reply.code(201).send({ principal: { id: OWNER_PRINCIPAL_ID, roles: [...OWNER_ROLES] }, csrfToken: session.csrfToken, expiresAt: session.expiresAt });
    });
    this.app.get("/auth/session", async (request) => ({
      authenticated: true,
      principal: this.principalFor(request),
      csrfToken: this.controlAuth.sessionCsrfToken(request.headers.cookie) ?? null,
    }));
    this.app.delete("/auth/session", async (request, reply) => {
      this.controlAuth.revokeSession(request.headers.cookie);
      reply.header("set-cookie", this.controlAuth.clearedCookies());
      return reply.code(204).send();
    });
    this.app.post<{ Body: { password?: string } }>("/auth/owner-password", async (request, reply) => {
      if (!validOwnerPassword(request.body?.password)) return reply.code(400).send({ code: "INVALID_OWNER_PASSWORD", message: "Password must contain 1 to 1024 characters" });
      await this.secrets.put(OWNER_PASSWORD_REFERENCE, await hashOwnerPassword(request.body.password));
      this.controlAuth.revokeAllSessions();
      return reply.code(204).send();
    });
    this.app.post("/auth/login-codes", async (_request, reply) => reply.code(201).send(this.issueDashboardLogin()));
    this.app.post("/auth/owner-token/rotate", async (_request, reply) => {
      if (this.options.ownerToken) return reply.code(409).send({ code: "OWNER_TOKEN_STATIC", message: "The owner token is supplied by the process environment" });
      const token = randomBytes(32).toString("base64url");
      await this.secrets.put(OWNER_TOKEN_REFERENCE, token);
      this.controlAuth.revokeAllSessions();
      return reply.code(201).send({ token, credentialRef: OWNER_TOKEN_REFERENCE });
    });

    this.app.get("/api/runners", async () => ({ runners: this.runners.list() }));
    this.app.post<{ Params: { id: string }; Body: { ttlMs?: number } }>("/api/runners/:id/enrollment", async (request, reply) => {
      const runner = this.configuration.current().config.runners.find((candidate) => candidate.id === request.params.id && candidate.mode === "remote");
      if (!runner) return reply.code(404).send({ code: "REMOTE_RUNNER_NOT_FOUND" });
      const issued = this.enrollments.issue(runner.id, request.body?.ttlMs, this.now());
      return reply.code(201).send({ runnerId: runner.id, token: issued.token, expiresAt: issued.record.expiresAt });
    });
    this.app.post<{ Body: RunnerEnrollmentBody }>("/api/runners/enroll", async (request, reply) => {
      if (!request.body?.runnerId || !request.body.token) return reply.code(400).send({ code: "ENROLLMENT_INPUT_REQUIRED" });
      const runner = this.configuration.current().config.runners.find((candidate) => candidate.id === request.body!.runnerId && candidate.mode === "remote");
      if (!runner?.credentialRef) return reply.code(404).send({ code: "REMOTE_RUNNER_NOT_FOUND" });
      try {
        this.enrollments.consume(runner.id, request.body.token, this.now());
      } catch (error) {
        this.controlAuth.recordFailure(request.ip);
        return reply.code(401).send({ code: "ENROLLMENT_REJECTED", message: error instanceof Error ? error.message : "Enrollment rejected" });
      }
      const bearerToken = randomBytes(32).toString("base64url");
      await this.secrets.put(runner.credentialRef, bearerToken);
      this.database.saveEntity("runner-identity", runner.id, json({ runnerId: runner.id, credentialRef: runner.credentialRef, enrolledAt: this.now().toISOString() }));
      return reply.code(201).send({ runnerId: runner.id, credentialRef: runner.credentialRef, bearerToken, protocolVersion: "1.2" });
    });
    this.app.post<{ Params: { id: string } }>("/api/runners/:id/credential/revoke", async (request, reply) => {
      const runner = this.configuration.current().config.runners.find((candidate) => candidate.id === request.params.id && candidate.mode === "remote");
      if (!runner) return reply.code(404).send({ code: "REMOTE_RUNNER_NOT_FOUND" });
      await this.revokeRunnerCredential(runner.id, runner.credentialRef);
      return { runnerId: runner.id, revoked: true };
    });
    this.app.post<{ Params: { id: string }; Body: { ttlMs?: number } }>("/api/runners/:id/credential/rotate", async (request, reply) => {
      const runner = this.configuration.current().config.runners.find((candidate) => candidate.id === request.params.id && candidate.mode === "remote");
      if (!runner) return reply.code(404).send({ code: "REMOTE_RUNNER_NOT_FOUND" });
      await this.revokeRunnerCredential(runner.id, runner.credentialRef);
      const issued = this.enrollments.issue(runner.id, request.body?.ttlMs, this.now());
      return reply.code(201).send({ runnerId: runner.id, token: issued.token, expiresAt: issued.record.expiresAt });
    });
    this.app.get("/api/adapters/manifests", async () => ({ manifests: adapterManifests }));
    this.app.get("/api/adapters/compatibility", async () => ({ matrix: buildAdapterCompatibilityMatrix(adapterManifests) }));
    this.app.get("/api/agents/profiles", async () => ({
      revision: this.configuration.current().revision,
      profiles:this.configuration.current().config.agentProfiles.map(profile=>this.profileConsoleView(profile.id)),
      sessions: this.database.listEntities<JsonValue>("adapter-session").map((value) => {
        const session = value as Record<string, JsonValue>;
        return { id: session.id, runId: session.runId, profileId: session.profileId, state: session.state, updatedAt: session.updatedAt };
      }),
    }));
    this.app.get<{Params:{id:string}}>("/api/agents/profiles/:id",async(request,reply)=>{
      if(!this.configuration.current().config.agentProfiles.some(profile=>profile.id===request.params.id))return reply.code(404).send({code:"PROFILE_NOT_FOUND"});return {profile:this.profileConsoleView(request.params.id)};
    });
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
      this.assertLocalDraftProbe(request.body?.runnerId);
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
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        alias: body.alias,
        runnerId: body.runnerId ?? "local",
        settings: {
          codexHome: body.codexHome,
          ...(body.executable ? { executable: body.executable } : {}),
          ...(body.model ? { model: body.model } : {}),
        },
      });
      if (body.baseRevision !== undefined) {
        if (!Number.isInteger(body.baseRevision)) return reply.code(400).send({code:"INVALID_CONFIG_REVISION"});
        const actual=this.configuration.current().revision;
        if(body.baseRevision!==actual) throw new RevisionConflictError(body.baseRevision,actual);
      }
      const plan = await this.planConfiguration(next, this.principalFor(request).id, "web");
      if(body.previewOnly === true) return reply.code(201).send({plan:consoleConfigPlan(plan)});
      const applied = await this.applyConfigurationPlan(plan.id, { confirmed: true });
      return reply.code(201).send({ profile: { id: body.id, provider: "codex", alias: body.alias, runnerId: body.runnerId ?? "local", state: body.enabled === false ? "DISABLED" : "CONFIGURED" }, revision: applied.revision });
    });
    this.app.post<{ Body: QoderProfileBody }>("/api/agents/qoder/discover", async (request, reply) => {
      if (!request.body?.alias) return reply.code(400).send({ code: "QODER_PROFILE_REQUIRED" });
      this.assertLocalDraftProbe(request.body?.runnerId);
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
      if(body.previewOnly!==true)this.assertLocalDraftProbe(body.runnerId);
      const discovery=body.previewOnly?undefined:await probeQoderProfile({id:body.id,alias:body.alias,...(body.executable?{executable:body.executable}:{}),...(body.configDir?{configDir:body.configDir}:{}),...(body.model?{model:body.model}:{})});
      if(discovery&&!discovery.selected)return reply.code(409).send({code:"QODER_SELECTION_REQUIRED",candidates:discovery.candidates});
      if(discovery&&!discovery.selected?.authenticated)return reply.code(409).send({code:"QODER_AUTH_REQUIRED",candidate:discovery.selected});
      const next = structuredClone(current.config);
      next.agentProfiles.push({
        id: body.id,
        provider: "qoder",
        alias: body.alias,
        runnerId: body.runnerId ?? "local",
        settings: { ...(discovery?.selected?{executable:discovery.selected.executable}:body.executable?{executable:body.executable}:{}), ...(body.configDir ? { configDir: body.configDir } : {}), ...(body.model ? { model: body.model } : {}) },
      });
      if (body.baseRevision !== undefined) {
        if (!Number.isInteger(body.baseRevision)) return reply.code(400).send({code:"INVALID_CONFIG_REVISION"});
        const actual=this.configuration.current().revision;
        if(body.baseRevision!==actual) throw new RevisionConflictError(body.baseRevision,actual);
      }
      const plan = await this.planConfiguration(next, this.principalFor(request).id, "web");
      if(body.previewOnly === true) return reply.code(201).send({plan:consoleConfigPlan(plan)});
      const applied = await this.applyConfigurationPlan(plan.id, { confirmed: true });
      return reply.code(201).send({ profile: { id: body.id, provider: "qoder", alias: body.alias, runnerId: body.runnerId ?? "local", state: "CONFIGURED" }, discovery: discovery?.selected, revision: applied.revision });
    });
    this.app.post<{ Params: { provider: string }; Body: EcosystemProfileBody }>("/api/agents/:provider/discover", async (request, reply) => {
      const body = request.body;
      if (!body?.alias) return reply.code(400).send({ code: "AGENT_PROFILE_REQUIRED" });
      this.assertLocalDraftProbe(request.body?.runnerId);
      if (isNativeCliProvider(request.params.provider)) return probeNativeCliProfile(request.params.provider, { id: body.id ?? `discovered-${request.params.provider}`, alias: body.alias, ...(body.configDir ? {configDir:body.configDir}:{}), ...(body.executable ? { executable: body.executable } : {}), ...(body.model ? { model: body.model } : {}) });
      const resolveCredential = (reference: string): Promise<string> => this.secrets.resolve(reference, { principal: "controller", purpose: "provider" });
      if (request.params.provider === "cursor" || request.params.provider === "kiro") {
        const profile: CliAgentProfile = { id: body.id ?? `discovered-${request.params.provider}`, alias: body.alias, ...(body.executable ? { executable: body.executable } : {}), ...(body.credentialRef ? { credentialRef: body.credentialRef } : {}), ...(body.model ? { model: body.model } : {}) };
        return request.params.provider === "cursor" ? probeCursorProfile(profile, resolveCredential) : probeKiroProfile(profile, resolveCredential);
      }
      if (request.params.provider === "devin") {
        if (!body.organizationId || !body.credentialRef) return reply.code(400).send({ code: "DEVIN_PROFILE_REQUIRED" });
        return probeDevinProfile({ id: body.id ?? "discovered-devin", alias: body.alias, organizationId: body.organizationId, credentialRef: body.credentialRef, ...(body.apiBase ? { apiBase: body.apiBase } : {}), ...(body.maxSessionAcu ? { maxSessionAcu: body.maxSessionAcu } : {}) }, resolveCredential, this.options.integrationFetch as typeof fetch | undefined);
      }
      if (request.params.provider === "workbuddy-codebuddy") {
        const local = localServiceProfile({ ...body, id: body.id ?? "discovered-local-service" });
        if (!local) return reply.code(400).send({ code: "LOCAL_SERVICE_PROFILE_REQUIRED" });
        return probeLocalService(local, resolveCredential, this.options.integrationFetch as typeof fetch | undefined);
      }
      if (request.params.provider === "generic-cli") {
        if (!body.executable || !body.args) return reply.code(400).send({ code: "GENERIC_CLI_PROFILE_REQUIRED" });
        return probeGenericCli({ file: body.executable, args: body.args, ...(body.mode ? { mode: body.mode } : {}) });
      }
      return reply.code(404).send({ code: "ADAPTER_NOT_FOUND" });
    });
    this.app.post<{ Params: { provider: string }; Body: EcosystemProfileBody }>("/api/agents/:provider/profiles", async (request, reply) => {
      const body = request.body;
      if (!body?.id || !body.alias) return reply.code(400).send({ code: "AGENT_PROFILE_REQUIRED" });
      const current = this.configuration.current();
      if (current.config.agentProfiles.some((profile) => profile.id === body.id)) return reply.code(409).send({ code: "PROFILE_EXISTS" });
      let provider = request.params.provider;
      let settings: Record<string, JsonValue>;
      let credentialRef = body.credentialRef;
      if (isNativeCliProvider(provider)) {
        if(body.previewOnly!==true)this.assertLocalDraftProbe(body.runnerId);
        if (provider === "zcode" && body.model) return reply.code(400).send({ code: "NATIVE_MODEL_SETTINGS_REQUIRED", message: "Select ZCode models in its native client." });
        if (body.approveTools !== undefined && (!["opencode", "grok", "antigravity"].includes(provider) || typeof body.approveTools !== "boolean")) return reply.code(400).send({ code: "INVALID_TOOL_APPROVAL" });
        if (credentialRef && provider !== "grok") return reply.code(400).send({ code: "NATIVE_LOGIN_REQUIRED", message: "Use the harness's native provider login for this profile." });
        const discovery=body.previewOnly?undefined:await probeNativeCliProfile(provider,{id:body.id,alias:body.alias,...(body.executable?{executable:body.executable}:{}),...(body.configDir?{configDir:body.configDir}:{}),...(body.model?{model:body.model}:{})});
        if(discovery&&(!discovery.installed||!discovery.compatible))return reply.code(409).send({code:"CLI_INCOMPATIBLE",discovery});
        settings={...(discovery?{executable:discovery.executable}:body.executable?{executable:body.executable}:{}),...(provider==="qoder-cn"&&body.configDir?{configDir:body.configDir}:{}),...(body.model?{model:body.model}:{}),...(body.approveTools!==undefined?{approveTools:body.approveTools}:{})};
      } else if (provider === "cursor" || provider === "kiro") {
        settings = { ...(body.executable ? { executable: body.executable } : {}), ...(body.model ? { model: body.model } : {}), ...(provider === "cursor" && body.approveTools !== undefined ? { approveTools: body.approveTools } : {}), ...(provider === "cursor" && body.trustWorkspace !== undefined ? { trustWorkspace: body.trustWorkspace } : {}) };
      } else if (provider === "devin") {
        if (!body.organizationId || !credentialRef) return reply.code(400).send({ code: "DEVIN_PROFILE_REQUIRED" });
        settings = { organizationId: body.organizationId, ...(body.apiBase ? { apiBase: body.apiBase } : {}), ...(body.maxSessionAcu ? { maxSessionAcu: body.maxSessionAcu } : {}) };
      } else if (provider === "workbuddy-codebuddy") {
        const local = localServiceProfile(body);
        if (!local) return reply.code(400).send({ code: "LOCAL_SERVICE_PROFILE_REQUIRED" });
        provider = local.provider;
        settings = { baseUrl: local.baseUrl, healthPath: local.healthPath, startPath: local.startPath, statusPath: local.statusPath, inputPath: local.inputPath, cancelPath: local.cancelPath, ...(local.resourcePath ? { resourcePath: local.resourcePath } : {}) };
      } else if (provider === "generic-cli") {
        if (!body.executable || !body.args) return reply.code(400).send({ code: "GENERIC_CLI_PROFILE_REQUIRED" });
        settings = { executable: body.executable, args: body.args, mode: body.mode ?? "headless" };
        credentialRef = undefined;
      } else return reply.code(404).send({ code: "ADAPTER_NOT_FOUND" });
      if (credentialRef && !(await this.secrets.metadata(credentialRef)).exists) return reply.code(409).send({ code: "SECRET_REFERENCE_MISSING" });
      const latest = this.configuration.current();
      if (latest.config.agentProfiles.some((profile) => profile.id === body.id)) return reply.code(409).send({ code: "PROFILE_EXISTS" });
      const next = structuredClone(latest.config);
      next.agentProfiles.push({ id: body.id, provider, ...(body.enabled !== undefined ? { enabled: body.enabled } : {}), alias: body.alias, runnerId: body.runnerId ?? "local", ...(credentialRef ? { credentialRef } : {}), settings });
      if (body.baseRevision !== undefined) {
        if (!Number.isInteger(body.baseRevision)) return reply.code(400).send({code:"INVALID_CONFIG_REVISION"});
        const actual=this.configuration.current().revision;
        if(body.baseRevision!==actual) throw new RevisionConflictError(body.baseRevision,actual);
      }
      const plan = await this.planConfiguration(next, this.principalFor(request).id, "web");
      if(body.previewOnly === true) return reply.code(201).send({plan:consoleConfigPlan(plan)});
      const applied = await this.applyConfigurationPlan(plan.id, { confirmed: true });
      return reply.code(201).send({ profile: { id: body.id, provider, alias: body.alias, runnerId: body.runnerId ?? "local", state: body.enabled === false ? "DISABLED" : this.agentAdapters.has(body.id) ? "CONFIGURED" : "UNAVAILABLE" }, revision: applied.revision });
    });
    this.app.post<{ Params: { id: string }; Body: { enabled: boolean;baseRevision?:number } }>("/api/agents/profiles/:id/enabled", async (request, reply) => {
      if (typeof request.body?.enabled !== "boolean") return reply.code(400).send({ code: "INVALID_PROFILE_ACTIVATION" });
      if(request.body.baseRevision!==undefined){if(!Number.isInteger(request.body.baseRevision))return reply.code(400).send({code:"INVALID_CONFIG_REVISION"});const actual=this.configuration.current().revision;if(request.body.baseRevision!==actual)throw new RevisionConflictError(request.body.baseRevision,actual);}
      const next = structuredClone(this.configuration.current().config);
      const profile = next.agentProfiles.find((entry) => entry.id === request.params.id);
      if (!profile) return reply.code(404).send({ code: "PROFILE_NOT_FOUND" });
      profile.enabled = request.body.enabled;
      const plan = await this.planConfiguration(next, this.principalFor(request).id, "web");
      const applied = await this.applyConfigurationPlan(plan.id, { confirmed: true });
      return { revision: applied.revision, profile: { id: profile.id, alias: profile.alias, enabled: profile.enabled } };
    });
    this.app.post<{ Params:{id:string};Body:{repositoryId?:string}|undefined }>("/api/agents/profiles/:id/test",async(request,reply)=>{
      if(!this.configuration.current().config.agentProfiles.some(profile=>profile.id===request.params.id))return reply.code(404).send({code:"PROFILE_NOT_FOUND"});return this.probeConfiguredProfile(request.params.id,request.body?.repositoryId);
    });
    this.app.post<{ Params: { id: string }; Body: CodexRunBody }>("/api/agents/profiles/:id/runs", async (request, reply) => {
      if (!request.body?.workspacePath || !request.body.prompt) return reply.code(400).send({ code: "RUN_INPUT_REQUIRED" });
      if (!this.workspaces.get(request.body.workspacePath)) return reply.code(400).send({ code: "UNMANAGED_WORKSPACE", message: "Agent runs must use a Dispatcher-managed worktree" });
      const adapter = this.agentAdapters.get(request.params.id);
      if (!adapter) return reply.code(404).send({ code: "PROFILE_NOT_FOUND" });
      const profileId = request.params.id;
      this.pendingProfileStarts.set(profileId, (this.pendingProfileStarts.get(profileId) ?? 0) + 1);
      try {
        const session = await adapter.start({ runId: randomUUID(), workspacePath: request.body.workspacePath, prompt: request.body.prompt });
        return reply.code(201).send({ session: this.sessionView(session) });
      } finally {
        const pending = (this.pendingProfileStarts.get(profileId) ?? 1) - 1;
        if (pending) this.pendingProfileStarts.set(profileId, pending);
        else this.pendingProfileStarts.delete(profileId);
      }
    });
    this.app.get<{ Params: { profileId: string; sessionId: string } }>("/api/agents/profiles/:profileId/sessions/:sessionId", async (request, reply) => {
      const storedSession = this.database.getEntity<JsonValue>("adapter-session", request.params.sessionId) as unknown as AdapterSession | undefined;
      if (storedSession?.profileId !== request.params.profileId) return reply.code(404).send({ code: "SESSION_NOT_FOUND" });
      const adapter = this.agentAdapters.get(request.params.profileId);
      if (!adapter) return reply.code(404).send({ code: "PROFILE_NOT_FOUND" });
      return { session: this.sessionView(await adapter.status(request.params.sessionId)) };
    });
    this.app.get<{Params:{runId:string;inputId:string}}>("/api/runs/:runId/inputs/:inputId",async(request,reply)=>{
      const receipt=this.runInputs.find(this.principalFor(request).id,request.params.inputId,request.params.runId);return receipt?{receipt}:reply.code(404).send({code:"INPUT_NOT_FOUND"});
    });
    this.app.post<{ Params: { profileId: string; sessionId: string }; Body: { message?: string; inputId?:string; authority?: { runId: string; generation: number; leaseId: string; taskRevision: number; lastActivityAt?: string } } }>("/api/agents/profiles/:profileId/sessions/:sessionId/input", async (request, reply) => {
      if (typeof request.body?.message!=="string"||!request.body.message.trim()) return reply.code(400).send({ code: "MESSAGE_REQUIRED" });
      if(request.body.inputId!==undefined&&(typeof request.body.inputId!=="string"||!/^[-a-zA-Z0-9_]{8,128}$/.test(request.body.inputId)))return reply.code(400).send({code:"INVALID_INPUT_ID"});
      const storedSession = this.database.getEntity<JsonValue>("adapter-session", request.params.sessionId) as unknown as AdapterSession | undefined;
      if (storedSession?.profileId !== request.params.profileId) return reply.code(404).send({ code: "SESSION_NOT_FOUND" });
      const expected=request.body.authority;
      const episode={runId:storedSession.runId,sessionId:request.params.sessionId,generation:expected?.generation??0,authorityHash:contentHash(expected?{runId:expected.runId,generation:expected.generation,leaseId:expected.leaseId,lastActivityAt:expected.lastActivityAt}:null)};
      const inputId=request.body.inputId??(expected?`legacy-${contentHash({actor:this.principalFor(request).id,sessionId:storedSession.id,message:request.body.message,authority:expected})}`:undefined);
      const input:RunInputIdentity|undefined=inputId?{...episode,inputId,actorId:this.principalFor(request).id,profileId:request.params.profileId,payloadHash:contentHash({message:request.body.message,authority:expected??null})}:undefined;
      const existing=input?this.runInputs.read(input):undefined;
      if(existing){
        if(existing.state!=="ACCEPTED")return reply.code(409).send({code:existing.state==="RESERVED"?"INPUT_PENDING":existing.state==="REJECTED"?"INPUT_REJECTED":"INPUT_OUTCOME_UNKNOWN",receipt:existing,message:"Inspect the original session before submitting another input"});
        return {receipt:existing,repeated:true,event:{type:"session.message",sessionId:existing.sessionId,occurredAt:existing.acceptedAt,data:{acceptedCharacters:request.body.message.length}}};
      }
      const adapter = this.agentAdapters.get(request.params.profileId);
      if (!adapter) return reply.code(404).send({ code: "PROFILE_NOT_FOUND" });
      const run = this.database.listEntities<JsonValue>("run").map((value) => value as unknown as Run).find((entry) => entry.sessionId === request.params.sessionId);
      const binding = run ? this.runConversation(run) : undefined;
      const assertAuthority = (): void => {
        if (!run) return; // Standalone trial sessions have no canonical task authority.
        const expected = request.body.authority;
        const current = this.database.getEntity<JsonValue>("run", run.id) as unknown as Run | undefined;
        const task = this.database.getCanonicalTask<JsonValue>(run.taskId);
        if (!expected || expected.runId !== run.id || expected.generation !== current?.generation || expected.leaseId !== current?.leaseId || expected.lastActivityAt !== current?.lastActivityAt || expected.taskRevision !== task?.revision || current?.state !== "WAITING_USER" || current.profileId !== request.params.profileId || current.sessionId !== request.params.sessionId || (task?.document as unknown as Task)?.currentRunId !== run.id) throw new ConnectorError("CONFLICT", "Run or intervention authority changed; refresh before replying", { retryable: false, operation: "write" });
        if (binding) this.assertMessagingInputAuthority(run, binding, binding.revision);
        else {
          this.restoreLeaseAuthority(current);
          try { this.leaseAuthority.fence(current.id, current.leaseId, current.generation, "user-input", this.now().toISOString()); }
          catch (error) { if (error instanceof LeaseFenceError) throw new ConnectorError("CONFLICT", error.message, { retryable: false, operation: "write" }); throw error; }
          finally { this.persistLatestLeaseAudit(current.id); }
        }
      };
      if (this.pendingConsoleInputs.has(request.params.sessionId)) return reply.code(409).send({ code: "INPUT_PENDING" });
      this.runInputs.assertAvailable(episode);
      assertAuthority();
      this.pendingConsoleInputs.add(request.params.sessionId);
      let reserved=false,sent=false;
      try {
        if(run)await this.validateRunSelection(run);
        assertAuthority();
        if(input){this.runInputs.reserve(input);reserved=true;}
        sent=true;
        const event = await adapter.send(request.params.sessionId, request.body.message);
        try { assertAuthority(); }
        catch (error) {
          try { await adapter.cancel(request.params.sessionId); }
          catch (cleanupError) { this.app.log.warn({ error: redactValue(cleanupError), runId: run?.id }, "stale console input cleanup failed"); }
          throw error;
        }
        if (run) {
          this.database.transaction(() => {
            assertAuthority();
            assertRunTransition(run.state, "ACTIVE");
            run.state = "ACTIVE";
            run.lastActivityAt = this.now().toISOString();
            this.saveAdvancedRun(run, "WAITING_USER");
            if (binding) this.conversations.resume(binding.id, { expectedRevision: binding.revision, generation: run.generation });
            const current = this.database.getCanonicalTask<JsonValue>(run.taskId)!;
            if ((current.document as unknown as Task).state === "WAITING_USER") this.tasks.execute({ id: `run:${run.id}:user-input:${current.revision}`, taskId: run.taskId, baseRevision: current.revision, actor: "user", command: { type: "task.transition", state: "RUNNING" } });
            if(input)this.runInputs.finish(input,"ACCEPTED");
          });
          this.attentionNotifications.recover(run.taskId);
          this.fleetEvents.publish("run.changed", run.id, { id: run.id, state: run.state, lastActivityAt: run.lastActivityAt });
        }
        if(!run&&input)this.runInputs.finish(input,"ACCEPTED");
        return { event,...(input?{receipt:this.runInputs.read(input)}:{}) };
      }catch(error){
        if(input&&reserved){
          let receipt;
          try{receipt=this.runInputs.finish(input,sent?"OUTCOME_UNKNOWN":"REJECTED");}
          catch(recordError){this.app.log.warn({error:redactValue(recordError)},"input receipt remains unconfirmed");}
          if(sent&&receipt?.state!=="ACCEPTED"){
            if(run)this.markRemoteUnavailable(run.id,"Native input outcome is unconfirmed; inspect the original session","NATIVE_OUTCOME_UNKNOWN",run);
            throw new InputReceiptError("INPUT_OUTCOME_UNKNOWN","Native input outcome is unconfirmed; inspect the original session before continuing");
          }
        }
        throw error;
      } finally { if(input)this.runInputs.release(input);this.pendingConsoleInputs.delete(request.params.sessionId); }
    });

    this.app.get("/api/connectors", async () => ({ connectors: this.connectors.list().map((adapter) => ({ definition: adapter.definition, instance: adapter.instance })) }));
    this.app.post<{ Params: { id: string } }>("/api/connectors/:id/test", async (request, reply) => {
      if(!this.connectors.get(request.params.id))return reply.code(404).send({code:"CONNECTOR_NOT_FOUND"});return {probe:redactValue(await this.probeConnector(request.params.id))};
    });
    this.app.post("/api/connectors/projections/drain", async () => this.drainProjections());
    this.app.get("/api/connectors/dead-letters", async () => ({ deadLetters: this.database.listDeadLetters<JsonValue>().map(entry=>({...entry,canRetry:this.canRetryDeadLetter(entry)})) }));
    this.app.post<{ Params: { id: string } }>("/api/connectors/dead-letters/:id/retry", async (request, reply) => {
      const deadLetter = this.database.listDeadLetters<JsonValue>().find((entry) => entry.id === request.params.id);
      const inboxPrefix = `${MESSAGING_INBOX_KIND}:`;
      if (deadLetter?.source === "inbox" && deadLetter.sourceId.startsWith(inboxPrefix)) {
        if (!this.messagingInbox.requeue(deadLetter.sourceId.slice(inboxPrefix.length))) return reply.code(409).send({ code: "DEAD_LETTER_NOT_RETRYABLE" });
        this.database.resolveDeadLetter(request.params.id);
        return { retried: true };
      }
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
        const ingress = await messaging.ingress(raw, headers).catch((error: unknown) => {
          if (error instanceof ConnectorError && error.code === "CONFLICT" && error.options.operation === "ingress") return undefined;
          throw error;
        });
        if (!ingress) return reply.code(200).send({ accepted: true, duplicate: true });
        if (ingress.kind === "challenge") return { challenge: ingress.challenge };
        if (ingress.kind === "ignored" || !ingress.message) {
          if (ingress.idempotencyKey) this.messagingInbox.ignore(ingress.idempotencyKey, messaging.instance.id, ingress.ignoredReason ?? "ignored", ingress.delivery);
          return reply.code(202).send({ accepted: true, ignored: true, ...(ingress.ignoredReason ? { reason: ingress.ignoredReason } : {}) });
        }
        const received = this.messagingInbox.receive(ingress.message, {
          credentialRedacted: CREDENTIAL_PATTERN.test(ingress.message.text),
          ...(ingress.delivery ? { delivery: ingress.delivery } : {}),
        });
        return reply.code(202).send({
          accepted: true,
          duplicate: received.duplicate,
          eventId: ingress.message.externalMessageId,
          status: received.record.status,
          ...(received.record.replyId ? { replyId: received.record.replyId } : {}),
        });
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

    this.app.get<{Params:{id:string};Querystring:{repositoryId?:string}}>("/api/agents/profiles/:id/models",async request=>{
      if(!request.query.repositoryId)throw new PublicationError("CATALOG_CONTEXT_REQUIRED",400,"repositoryId is required");
      return this.modelCatalog(request.params.id,request.query.repositoryId,"open");
    });
    this.app.get<{Params:{id:string}}>("/api/model-routing/decisions/:id",async request=>this.modelRouting.read(this.principalFor(request).id,request.params.id));
    this.app.post<{Body:PublishDraftV1;Querystring:{reanalyze?:string}}>("/api/model-routing/preview",{schema:{body:publishDraftSchema}},async request=>{
      const principal=this.principalFor(request);if(!principal.roles.includes("operator"))throw new PublicationError("FORBIDDEN",403,"Operator role required");
      const snapshot=this.configuration.current();const draft=request.body;
      if(draft.execution.selectionMode!=="policy-auto")throw new PublicationError("INVALID_AUTO_SELECTION",400,"Routing preview requires automatic mode");
      const catalog=await this.modelCatalog(draft.execution.profileId??"",draft.repositoryId,"preflight");
      if(this.configuration.current().revision!==snapshot.revision)throw new PublicationError("SELECTION_CHANGED",409,"Configuration changed during routing preview");
      const decision=await this.modelRouting.preview(principal.id,draft,snapshot.config,snapshot.revision,catalog,{forceAnalysis:request.query.reanalyze==="true"});
      if(this.configuration.current().revision!==snapshot.revision)throw new PublicationError("ROUTING_DECISION_STALE",409,"Configuration changed during classification");
      return decision;
    });
    this.app.post<{Body:{draft:PublishDraftV1;semantic?:boolean;policy?:NonNullable<DispatcherConfig["policies"]["modelRouting"]>}}>("/api/model-routing/test",{schema:{body:{type:"object",additionalProperties:false,required:["draft"],properties:{draft:publishDraftSchema,semantic:{type:"boolean"},policy:dispatcherConfigSchema.properties.policies.properties.modelRouting}}}},async request=>{
      const principal=this.principalFor(request);if(!principal.roles.includes("operator"))throw new PublicationError("FORBIDDEN",403,"Operator role required");
      const snapshot=this.configuration.current();const {draft,policy}=request.body;
      // Draft rules use the same schema/reference validation as ConfigPlan and cannot authorize a Run.
      if(policy){if(!principal.roles.includes("admin"))throw new PublicationError("FORBIDDEN",403,"Configuration editing permission required for draft policy trials");validateConfig({...snapshot.config,policies:{...snapshot.config.policies,modelRouting:policy}});}
      const catalog=await this.modelCatalog(draft.execution.profileId??"",draft.repositoryId,"preflight");
      if(this.configuration.current().revision!==snapshot.revision)throw new PublicationError("SELECTION_CHANGED",409,"Configuration changed during routing trial");
      const decision=await this.modelRouting.preview(principal.id,draft,snapshot.config,snapshot.revision,catalog,{trial:true,keywordOnly:request.body.semantic!==true,forceSemantic:request.body.semantic===true,...(policy?{policy}:{})});
      if(this.configuration.current().revision!==snapshot.revision)throw new PublicationError("ROUTING_DECISION_STALE",409,"Configuration changed during classification trial");
      return {trial:true,source:policy?"draft":"applied",decision};
    });
    this.app.get("/api/task-publications/capabilities", async () => ({ schemaVersion: 1, startModes: ["create-only","dispatch"], deliveryTypes: ["none"], selectionModes:["manual","policy-auto"], modelRouting:{classificationModes:["keyword","hybrid"],enabled:this.configuration.current().config.policies.modelRouting?.enabled===true}, projects: this.configuration.current().config.repositories.map(r => ({ id: `local:${r.id}`, repositoryId: r.id })) }));
    this.app.post<{ Body: PublishDraftV1 }>("/api/task-publications/preview", { schema: { body: publishDraftSchema } }, async request => {
      const principal = this.principalFor(request);
      if (!principal.roles.includes("operator")) throw new PublicationError("FORBIDDEN", 403, "Operator role required");
      return this.publications.preview(principal.id, request.body);
    });
    this.app.get<{ Params: { id: string } }>("/api/task-publications/:id", async request => this.publications.get(this.principalFor(request).id, request.params.id));
    this.app.post<{ Params: { id: string }; Body: unknown }>("/api/task-publications/:id/commit", async request => {
      const principal = this.principalFor(request);
      if (!principal.roles.includes("operator")) throw new PublicationError("FORBIDDEN", 403, "Operator role required");
      return this.publications.commit(principal.id, request.params.id, typeof request.headers["idempotency-key"] === "string" ? request.headers["idempotency-key"] : undefined, request.body);
    });

    this.app.get("/api/tasks", async () => ({ tasks: this.database.listCanonicalTasks<JsonValue>() }));
    this.app.post<{ Params: { id: string }; Body: { archived: boolean; revision: number; archiveRevision: number } }>("/api/tasks/:id/archive", async (request, reply) => {
      const body = request.body;
      if (typeof body?.archived !== "boolean" || !Number.isInteger(body.revision) || !Number.isInteger(body.archiveRevision)) return reply.code(400).send({ code: "ARCHIVE_INPUT_REQUIRED" });
      const outcome = this.database.transaction(() => {
        const stored = this.database.getCanonicalTask<JsonValue>(request.params.id);
        if (!stored) return { status: 404, code: "TASK_NOT_FOUND" };
        const existing = this.database.getEntity<JsonValue>("task-archive", request.params.id) as { revision: number } | undefined;
        if (stored.revision !== body.revision || (existing?.revision ?? 0) !== body.archiveRevision) return { status: 409, code: "TASK_CHANGED" };
        const active = this.database.listEntities<JsonValue>("run").some((value) => {
          const run = value as unknown as Run;
          return run.taskId === request.params.id && !["COMPLETE", "FAILED", "CANCELLED", "SUPERSEDED"].includes(run.state);
        });
        if (body.archived && active) return { status: 409, code: "ACTIVE_RUN_CANNOT_ARCHIVE" };
        const archive = { taskId: request.params.id, revision: body.archiveRevision + 1, actor: this.principalFor(request).id, updatedAt: this.now().toISOString(), ...(body.archived ? { archivedAt: this.now().toISOString() } : {}) };
        this.database.saveEntity("task-archive", request.params.id, json(archive));
        return { status: 200, archive };
      });
      if (outcome.status === 200) this.fleetEvents.publish("task.changed", request.params.id, { id: request.params.id });
      return reply.code(outcome.status).send(outcome);
    });
    this.app.get<{ Params: { id: string } }>("/api/tasks/:id", async (request, reply) => {
      const task = this.database.getCanonicalTask<JsonValue>(request.params.id);
      if (!task) return reply.code(404).send({ code: "TASK_NOT_FOUND" });
      return { ...task, contract: this.database.getTaskContract<JsonValue>(request.params.id), deliveries: this.database.listDeliveryEvidence<JsonValue>(request.params.id),
        executionIntent:this.database.getEntity<JsonValue>("task-execution-intent",request.params.id),
        archive: this.database.getEntity<JsonValue>("task-archive", request.params.id),
        runs: this.database.listEntities<JsonValue>("run").filter(value => (value as unknown as Run).taskId === request.params.id) };
    });
    this.app.post<{Params:{id:string};Body:{expectedRevision:number;execution:PublishDraftV1["execution"]}}>("/api/tasks/:id/publications/preview",{schema:{body:{type:"object",additionalProperties:false,required:["expectedRevision","execution"],properties:{expectedRevision:{type:"integer",minimum:1},execution:publishDraftSchema.properties.execution}}}},async request=>{
      const principal=this.principalFor(request);if(!principal.roles.includes("operator"))throw new PublicationError("FORBIDDEN",403,"Operator role required");
      return this.publications.previewTask(principal.id,request.params.id,request.body.expectedRevision,request.body.execution);
    });
    this.app.post<{ Params: { id: string }; Body: TaskDispatchBody }>("/api/tasks/:id/dispatch", async (request, reply) => {
      return reply.code(201).send(await this.dispatchTask(request.params.id, request.body ?? {}));
    });
    this.app.get<{ Params: { id: string } }>("/api/runs/:id", async (request, reply) => {
      const run = this.database.getEntity<JsonValue>("run", request.params.id);
      if (!run) return reply.code(404).send({ code: "RUN_NOT_FOUND" });
      return { run, contract: this.database.getEntity<JsonValue>("run-contract", request.params.id) };
    });
    this.app.get<{Params:{id:string}}>("/api/runs/:id/result",async(request,reply)=>{
      const result=this.database.getEntity<JsonValue>("run-result",request.params.id);
      return result?{result}:reply.code(404).send({code:"RUN_RESULT_UNAVAILABLE"});
    });
    this.app.post<{ Params: { id: string } }>("/api/runs/:id/advance", async (request, reply) => {
      const run = this.database.getEntity<JsonValue>("run", request.params.id);
      if (!run) return reply.code(404).send({ code: "RUN_NOT_FOUND" });
      const advanced = await this.advanceRunExclusive(request.params.id);
      return reply.code(advanced.waiting ? 202 : 200).send(advanced);
    });
    this.app.get("/api/system-impact",async()=>this.systemImpact());
    this.app.get("/api/diagnostics",async()=>this.diagnosticsSnapshot());
    this.app.get("/api/diagnostics/checks",async()=>({checks:diagnosticChecks}));
    this.app.get("/api/diagnostics/export",async()=>{const diagnostics=this.diagnosticsSnapshot(),measurements=this.systemImpact();return {schemaVersion:1,exportedAt:diagnostics.generatedAt,summary:diagnostics.summary,controllerReady:diagnostics.controllerReady,executionReadiness:diagnostics.executionReadiness,measurements};});
    this.app.post<{Body:{checkId:string;entityId?:string;repositoryId?:string}}>("/api/diagnostics/checks",{schema:{body:{type:"object",additionalProperties:false,required:["checkId"],properties:{checkId:{type:"string",maxLength:100},entityId:{type:"string",maxLength:200},repositoryId:{type:"string",maxLength:200}}}}},async(request,reply)=>{
      const check=diagnosticChecks.find(check=>check.id===request.body.checkId),id=request.body.entityId;
      if(!check)return reply.code(400).send({code:"DIAGNOSTIC_CHECK_UNKNOWN"});if(check.entityRequired&&!id)return reply.code(400).send({code:"DIAGNOSTIC_ENTITY_REQUIRED"});
      if(!check.entityRequired&&id!==undefined||request.body.repositoryId!==undefined&&check.id!=="profile.native")return reply.code(400).send({code:"DIAGNOSTIC_CONTEXT_INVALID"});
      if(check.id==="profile.native"){if(!this.configuration.current().config.agentProfiles.some(profile=>profile.id===id))return reply.code(404).send({code:"PROFILE_NOT_FOUND"});const action=this.profileConsoleView(id!).actions.test;if(action?.allowed===false)return reply.code(409).send({code:"DIAGNOSTIC_CHECK_UNAVAILABLE",message:action.message??"This account has no available registered native check"});await this.probeConfiguredProfile(id!,request.body.repositoryId);}
      if(check.id==="connector.health"){if(!this.connectors.get(id!))return reply.code(404).send({code:"CONNECTOR_NOT_FOUND"});await this.probeConnector(id!);}
      if(check.id==="runner.connection"&&!this.configuration.current().config.runners.some(runner=>runner.id===id))return reply.code(404).send({code:"RUNNER_NOT_FOUND"});
      return {checkId:check.id,cost:check.cost,completedAt:this.now().toISOString(),diagnostics:this.diagnosticsSnapshot()};
    });
    this.app.get<{Querystring:{profileId?:string;runId?:string;from?:string;to?:string}}>("/api/usage",async request=>({...this.usageObservations.query(request.query),errors:this.database.listEntities<JsonValue>("usage-error").filter(value=>{const error=value as {profileId?:string;runId?:string;status?:string};return error.status==="unknown"&&(!request.query.profileId||error.profileId===request.query.profileId)&&(!request.query.runId||error.runId===request.query.runId);})}));

    this.app.get("/api/llm", async () => {
      const current = this.configuration.current();
      return { revision: current.revision, config: current.config.internalLlm, ...this.llm.snapshot() };
    });
    this.app.put<{ Body: LlmConfigBody }>("/api/llm/config", async (request, reply) => {
      if (!request.body?.config) return reply.code(400).send({ code: "LLM_CONFIG_REQUIRED" });
      const current = this.configuration.current();
      const next: DispatcherConfig = { ...structuredClone(current.config), internalLlm: structuredClone(request.body.config) };
      const plan = await this.planConfiguration(next, this.principalFor(request).id, "web");
      await assertRequiredSecretsAvailable(next, this.secrets);
      const applied = await this.applyConfigurationPlan(plan.id, { confirmed: request.body.confirmed ?? true });
      return { plan, revision: applied.revision, config: applied.config.internalLlm, state: this.llm.snapshot().state };
    });
    this.app.post<{ Params: { profileId: string } }>("/api/llm/profiles/:profileId/test", async (request) => ({
      health: await this.llm.probe(request.params.profileId, "explicit"),
    }));
    this.app.post<{ Params: { role: LlmRole }; Body: LlmSwitchBody }>("/api/llm/roles/:role/switch", async (request, reply) => {
      if (!request.body?.profileId) return reply.code(400).send({ code: "LLM_PROFILE_REQUIRED" });
      return { state: await this.llm.switchProfile(request.params.role, request.body.profileId) };
    });
    this.app.post<{Params:{role:LlmRole}}>("/api/llm/roles/:role/reset", async(request,reply)=>{
      if(!["command_parser","config_assistant","runtime_summarizer","error_classifier","task_classifier"].includes(request.params.role)) return reply.code(400).send({code:"LLM_ROLE_REQUIRED"});
      return {state:this.llm.resetRole(request.params.role)};
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
        principal: { ...this.principalFor(request), channel: "web" },
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

    this.app.get<{Querystring:{view?:string}}>("/api/config", async (request,reply) => {if(request.query.view!==undefined&&request.query.view!=="console")return reply.code(400).send({code:"CONFIG_VIEW_INVALID"});const current=this.configuration.current();return request.query.view==="console"?{...current,...consoleConfig(current.config)}:current;});
    this.app.get("/api/config/schema", async () => ({ schema: dispatcherConfigSchema, uiSchema: dispatcherConfigUiSchema }));
    this.app.get("/api/config/audit", async () => ({ audit: this.database.listAudit() }));

    this.app.get<{Params:{id:string}}>("/api/config/plans/:id",async(request,reply)=>{
      const plan=this.configuration.getPlan(request.params.id);if(!plan)return reply.code(404).send({code:"CONFIG_PLAN_NOT_FOUND"});
      return {plan:consoleConfigPlan(plan),currentRevision:this.configuration.current().revision,...(["APPLIED","ROLLED_BACK"].includes(plan.state)?{appliedRevision:plan.baseRevision+1}:{})};
    });
    this.app.post<{ Body: ConfigPlanBody }>("/api/config/plans", async (request, reply) => {
      const body=request.body;if(!body||(body.config===undefined)===(body.edits===undefined))return reply.code(400).send({code:"CONFIG_INPUT_REQUIRED",message:"Provide exactly one of config or edits"});
      if(body.edits!==undefined&&body.baseRevision===undefined)return reply.code(400).send({code:"CONFIG_REVISION_REQUIRED"});
      if (body.baseRevision !== undefined) {
        if(!Number.isInteger(body.baseRevision)) return reply.code(400).send({code:"INVALID_CONFIG_REVISION"});
        const actual=this.configuration.current().revision;
        if(body.baseRevision!==actual) throw new RevisionConflictError(body.baseRevision,actual);
      }
      const proposed=body.edits===undefined?body.config:applyConfigEdits(this.configuration.current().config,body.edits);
      const plan = await this.planConfiguration(proposed, this.principalFor(request).id, "web");
      return reply.code(201).send({ plan:body.edits===undefined?plan:consoleConfigPlan(plan) });
    });
    this.app.post<{ Params: { id: string }; Body: ApplyPlanBody;Querystring:{view?:string} }>("/api/config/plans/:id/apply", async (request,reply) => {
      if(request.query.view!==undefined&&request.query.view!=="console")return reply.code(400).send({code:"CONFIG_VIEW_INVALID"});
      const before=this.configuration.getPlan(request.params.id),confirmed = request.body?.confirmed;
      const applied=await this.applyConfigurationPlan(request.params.id, confirmed === undefined ? {} : { confirmed });
      return {...applied,...(request.query.view==="console"?consoleConfig(applied.config):{}),planId:request.params.id,state:this.configuration.getPlan(request.params.id)?.state,currentRevision:applied.revision,...(before?{appliedRevision:before.baseRevision+1,repeated:before.state==="APPLIED"}:{})};
    });
    this.app.post<{ Params: { id: string };Querystring:{view?:string} }>("/api/config/plans/:id/rollback", async (request,reply) => {
      if(request.query.view!==undefined&&request.query.view!=="console")return reply.code(400).send({code:"CONFIG_VIEW_INVALID"});
      const result=await this.rollbackConfigurationPlan(request.params.id);return {...result,...(request.query.view==="console"?consoleConfig(result.config):{})};
    });

    this.app.get<{Querystring:{view?:string}}>("/api/setup", async (request,reply) => {
      if(request.query.view!==undefined&&request.query.view!=="console")return reply.code(400).send({code:"CONFIG_VIEW_INVALID"});
      const current=this.configuration.current();return {state:this.database.getWizardState()??{step:0,configRevision:current.revision,completed:false},config:request.query.view==="console"?{...current,...consoleConfig(current.config)}:current};
    });
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
      const status = error instanceof UsageObservationError?400:error instanceof InputReceiptError||error instanceof AdapterContractError&&["SESSION_DETACHED","SESSION_CANCELLED","SESSION_BUSY"].includes(error.code)?409:error instanceof PublicationError ? error.statusCode : error instanceof TaskDispatchError ? error.statusCode : error instanceof RevisionConflictError
        ? 409
        : error instanceof LlmRuntimeError
          ? error.code === "SELECTION_CHANGED" ? 409 : error.code === "NO_AVAILABLE_PROFILE" ? 503 : 400
        : error instanceof ConfigPlanError && ["PROFILE_CONTEXT_CHANGED","CONNECTOR_CONTEXT_CHANGED","REMOTE_DRAFT_PROBE_UNAVAILABLE"].includes(error.code)?409:error instanceof ConfigPlanError || error instanceof ConfigValidationError
          ? 400
          : semanticStatus ?? workspaceStatus ?? connectorStatus ?? secretStatus ?? (error && typeof error === "object" && "validation" in error ? 400 : 500);
      const code = error instanceof UsageObservationError||error instanceof InputReceiptError||error instanceof AdapterContractError||error instanceof PublicationError || error instanceof TaskDispatchError || error instanceof RevisionConflictError || error instanceof ConfigPlanError || error instanceof SecretStoreError || error instanceof LlmRuntimeError || error instanceof ConnectorError || error instanceof WorkspacePolicyError || error instanceof SemanticPolicyError
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
      void this.app.register(fastifyStatic, { root: webRoot, wildcard: false, maxAge: "1h", immutable: true, setHeaders: (response, path) => { if (path.endsWith("index.html")) response.header("Cache-Control", "no-cache"); } });
      this.app.setNotFoundHandler((request, reply) => {
        if (request.url.startsWith("/api/") || request.url.startsWith("/assets/") || request.url === "/health" || request.url === "/ready") {
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
