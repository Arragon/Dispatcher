import { randomUUID } from "node:crypto";
import { redactValue } from "@dispatcher/observability";
import {
  RevisionConflictError,
  type DispatcherDatabase,
  type JsonValue,
  type StoredConfigPlan,
  type StoredConfigState,
} from "@dispatcher/persistence";
import {
  configToJson,
  defaultDispatcherConfig,
  normalizeConfig,
  validateConfig,
  type DispatcherConfig,
} from "./schema.js";

export type ConfigRisk = "safe" | "sensitive" | "privileged";
export type ConfigPlanState = "PLANNED" | "APPLIED" | "FAILED" | "ROLLED_BACK";

export interface ConfigChange {
  op: "replace";
  path: string;
  before: JsonValue;
  after: JsonValue;
}

export interface ConfigPlan {
  id: string;
  baseRevision: number;
  state: ConfigPlanState;
  risk: ConfigRisk;
  requiresConfirmation: boolean;
  changes: ConfigChange[];
  actor: string;
  source: "web" | "cli" | "import" | "assistant" | "bootstrap";
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeConfigTarget {
  apply(config: DispatcherConfig): void;
}

export class ConfigPlanError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConfigPlanError";
  }
}

function asJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function configurationFromState(state: StoredConfigState): DispatcherConfig {
  return validateConfig(state.document);
}

function inferRisk(before: DispatcherConfig, after: DispatcherConfig): ConfigRisk {
  if (
    before.controller.adminStrategy !== after.controller.adminStrategy ||
    JSON.stringify(before.policies) !== JSON.stringify(after.policies)
  ) {
    return "privileged";
  }
  if (JSON.stringify(before.integrations) !== JSON.stringify(after.integrations) || JSON.stringify(before.agentProfiles) !== JSON.stringify(after.agentProfiles)) {
    return "sensitive";
  }
  return "safe";
}

function changes(before: DispatcherConfig, after: DispatcherConfig): ConfigChange[] {
  const result: ConfigChange[] = [];
  for (const key of Object.keys(after) as Array<keyof DispatcherConfig>) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      result.push({ op: "replace", path: `/${key}`, before: asJson(before[key]), after: asJson(after[key]) });
    }
  }
  return result;
}

export class ConfigurationEngine {
  constructor(
    private readonly database: DispatcherDatabase,
    private readonly runtime: RuntimeConfigTarget = { apply: () => undefined },
    private readonly verifyHooks: Array<(config: DispatcherConfig) => void> = [],
  ) {
    if (!database.getConfigState()) {
      const now = new Date().toISOString();
      const created = database.writeConfigState(0, {
        schemaVersion: 1,
        document: configToJson(defaultDispatcherConfig),
        updatedAt: now,
      });
      database.appendAudit({
        id: randomUUID(),
        action: "bootstrap",
        actor: "system",
        source: "bootstrap",
        before: {},
        after: redactValue(created.document) as JsonValue,
        status: "committed",
        createdAt: now,
      });
    }
  }

  current(): { revision: number; config: DispatcherConfig; updatedAt: string } {
    const state = this.database.getConfigState();
    if (!state) throw new ConfigPlanError("CONFIG_NOT_INITIALIZED", "Configuration is not initialized");
    return { revision: state.revision, config: configurationFromState(state), updatedAt: state.updatedAt };
  }

  buildPlan(
    proposed: unknown,
    actor: string,
    source: ConfigPlan["source"],
  ): ConfigPlan {
    const current = this.current();
    const next = validateConfig(proposed);
    const now = new Date().toISOString();
    const risk = inferRisk(current.config, next);
    const plan: ConfigPlan = {
      id: randomUUID(),
      baseRevision: current.revision,
      state: "PLANNED",
      risk,
      requiresConfirmation: risk !== "safe",
      changes: changes(current.config, next),
      actor,
      source,
      createdAt: now,
      updatedAt: now,
    };
    this.database.saveConfigPlan({
      id: plan.id,
      baseRevision: plan.baseRevision,
      state: plan.state,
      risk: plan.risk,
      confirmed: false,
      plan: asJson(plan),
      before: configToJson(current.config),
      after: configToJson(next),
      createdAt: now,
      updatedAt: now,
    });
    return plan;
  }

  getPlan(id: string): ConfigPlan | undefined {
    const stored = this.database.getConfigPlan(id);
    return stored ? (stored.plan as unknown as ConfigPlan) : undefined;
  }

  applyPlan(id: string, options: { confirmed?: boolean } = {}): { revision: number; config: DispatcherConfig } {
    const stored = this.database.getConfigPlan(id);
    if (!stored) throw new ConfigPlanError("CONFIG_PLAN_NOT_FOUND", `Unknown configuration plan: ${id}`);
    if (stored.state === "APPLIED") {
      const current = this.current();
      return { revision: current.revision, config: current.config };
    }
    if (stored.state !== "PLANNED") throw new ConfigPlanError("CONFIG_PLAN_NOT_APPLICABLE", `Plan is ${stored.state}`);
    if (stored.risk !== "safe" && !options.confirmed) {
      throw new ConfigPlanError("CONFIG_CONFIRMATION_REQUIRED", "Sensitive or privileged plans require confirmation");
    }
    const before = validateConfig(stored.before);
    const after = validateConfig(stored.after);
    const now = new Date().toISOString();
    try {
      return this.database.transaction(() => {
        const actual = this.current().revision;
        if (actual !== stored.baseRevision) throw new RevisionConflictError(stored.baseRevision, actual);
        this.runtime.apply(after);
        for (const verify of this.verifyHooks) verify(after);
        const state = this.database.writeConfigState(stored.baseRevision, {
          schemaVersion: 1,
          document: configToJson(after),
          updatedAt: now,
        });
        this.database.saveConfigPlan({ ...stored, state: "APPLIED", confirmed: Boolean(options.confirmed), updatedAt: now });
        this.database.appendAudit({
          id: randomUUID(),
          planId: stored.id,
          action: "apply",
          actor: String((stored.plan as Record<string, JsonValue>).actor ?? "unknown"),
          source: String((stored.plan as Record<string, JsonValue>).source ?? "unknown"),
          before: redactValue(stored.before) as JsonValue,
          after: redactValue(stored.after) as JsonValue,
          status: "committed",
          createdAt: now,
        });
        return { revision: state.revision, config: after };
      });
    } catch (error) {
      try {
        this.runtime.apply(before);
      } catch {
        // Runtime rollback failure is reported through the classified apply error below.
      }
      const failed: StoredConfigPlan = {
        ...stored,
        state: "FAILED",
        confirmed: Boolean(options.confirmed),
        result: { code: error instanceof RevisionConflictError ? error.code : "CONFIG_APPLY_FAILED" },
        updatedAt: now,
      };
      this.database.saveConfigPlan(failed);
      this.database.appendAudit({
        id: randomUUID(),
        planId: stored.id,
        action: "apply",
        actor: String((stored.plan as Record<string, JsonValue>).actor ?? "unknown"),
        source: String((stored.plan as Record<string, JsonValue>).source ?? "unknown"),
        before: redactValue(stored.before) as JsonValue,
        after: redactValue(stored.after) as JsonValue,
        status: "failed",
        createdAt: now,
      });
      if (error instanceof RevisionConflictError) throw error;
      throw new ConfigPlanError("CONFIG_APPLY_FAILED", "Configuration plan failed and was rolled back", { cause: error });
    }
  }

  rollbackPlan(id: string): { revision: number; config: DispatcherConfig } {
    const stored = this.database.getConfigPlan(id);
    if (!stored) throw new ConfigPlanError("CONFIG_PLAN_NOT_FOUND", `Unknown configuration plan: ${id}`);
    if (stored.state !== "APPLIED") throw new ConfigPlanError("CONFIG_PLAN_NOT_ROLLBACKABLE", `Plan is ${stored.state}`);
    const current = this.current();
    if (current.revision !== stored.baseRevision + 1) {
      throw new RevisionConflictError(stored.baseRevision + 1, current.revision);
    }
    const before = normalizeConfig(validateConfig(stored.before));
    const now = new Date().toISOString();
    return this.database.transaction(() => {
      this.runtime.apply(before);
      for (const verify of this.verifyHooks) verify(before);
      const state = this.database.writeConfigState(current.revision, {
        schemaVersion: 1,
        document: configToJson(before),
        updatedAt: now,
      });
      this.database.saveConfigPlan({ ...stored, state: "ROLLED_BACK", updatedAt: now });
      this.database.appendAudit({
        id: randomUUID(),
        planId: stored.id,
        action: "rollback",
        actor: String((stored.plan as Record<string, JsonValue>).actor ?? "unknown"),
        source: String((stored.plan as Record<string, JsonValue>).source ?? "unknown"),
        before: redactValue(stored.after) as JsonValue,
        after: redactValue(stored.before) as JsonValue,
        status: "committed",
        createdAt: now,
      });
      return { revision: state.revision, config: before };
    });
  }

  exportRedacted(): JsonValue {
    return redactValue(configToJson(this.current().config)) as JsonValue;
  }

  importConfig(document: unknown, actor: string): ConfigPlan {
    return this.buildPlan(document, actor, "import");
  }
}
