import { existsSync, statSync } from "node:fs";
import { arch, platform } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { genericCliManifest, genericMockManifest } from "@dispatcher/adapters";
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
import type { Runner } from "@dispatcher/domain";
import { LlmRuntime, LlmRuntimeError, type FetchLike, type LlmConfiguration, type LlmRole } from "@dispatcher/llm-runtime";
import { createLogger, redactValue } from "@dispatcher/observability";
import { DispatcherDatabase, RevisionConflictError, type JsonValue } from "@dispatcher/persistence";
import { EmbeddedRunner, EventBus, RunnerRegistry, type RunnerEvents } from "@dispatcher/runner";
import { LifecycleManager, type ServiceModule } from "./lifecycle.js";

export interface ControllerOptions {
  dataDirectory: string;
  withRunner?: boolean;
  host?: string;
  port?: number;
  webRoot?: string;
  secretStore?: SecretStore;
  llmFetch?: FetchLike;
  modules?: ServiceModule[];
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

function json(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
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
    this.secrets = options.secretStore ?? createDefaultSecretStore({ dataDirectory: options.dataDirectory });
    this.llm = new LlmRuntime(this.database, (reference) => this.secrets.resolve(reference, { principal: "controller", purpose: "llm" }), options.llmFetch);
    this.configuration = new ConfigurationEngine(this.database, { apply: (config) => this.llm.configure(llmConfiguration(config.internalLlm)) });
    this.llm.configure(llmConfiguration(this.configuration.current().config.internalLlm));
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

  private registerRoutes(): void {
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
    this.app.get("/api/adapters/manifests", async () => ({ manifests: [genericMockManifest, genericCliManifest] }));
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
      const status = error instanceof RevisionConflictError
        ? 409
        : error instanceof LlmRuntimeError
          ? error.code === "NO_AVAILABLE_PROFILE" ? 503 : 400
        : error instanceof ConfigPlanError || error instanceof ConfigValidationError
          ? 400
          : secretStatus ?? 500;
      const code = error instanceof RevisionConflictError || error instanceof ConfigPlanError || error instanceof SecretStoreError || error instanceof LlmRuntimeError
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
}
