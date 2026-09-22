import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { DispatcherDatabase, RevisionConflictError } from "@dispatcher/persistence";
import {
  ConfigValidationError,
  ConfigurationEngine,
  configToJson,
  defaultDispatcherConfig,
  normalizeConfig,
  requiredSecretReferences,
  resolveEffectiveConfig,
  validateConfig,
  type ConfigPlanError,
  type DispatcherConfig,
} from "../src/index.js";

function configured(overrides: Partial<DispatcherConfig["controller"]> = {}): DispatcherConfig {
  return {
    ...structuredClone(defaultDispatcherConfig),
    controller: { ...defaultDispatcherConfig.controller, ...overrides },
  };
}

describe("configuration schema", () => {
  it("normalizes equivalent inputs deterministically", () => {
    const input = structuredClone(defaultDispatcherConfig);
    input.runners[0]!.tags = ["z", "a"];
    expect(normalizeConfig(input).runners[0]!.tags).toEqual(["a", "z"]);
  });

  it("rejects unknown fields and duplicate aliases", () => {
    expect(() => validateConfig({ ...defaultDispatcherConfig, unexpected: true })).toThrow(ConfigValidationError);
    const input = structuredClone(defaultDispatcherConfig);
    input.agentProfiles = [
      { id: "one", provider: "codex", alias: "Atlas", runnerId: "local", settings: { codexHome: "/profiles/one" } },
      { id: "two", provider: "codex", alias: "atlas", runnerId: "local", settings: { codexHome: "/profiles/two" } },
    ];
    expect(() => validateConfig(input)).toThrowError(/duplicate provider alias/);
  });

  it("round-trips the canonical document and rejects the previous schema fixture", () => {
    const serialized = JSON.stringify(configToJson(defaultDispatcherConfig));
    expect(validateConfig(JSON.parse(serialized))).toEqual(defaultDispatcherConfig);
    const previousVersion = JSON.parse(readFileSync(new URL("./fixtures/config-v0.json", import.meta.url), "utf8"));
    expect(() => validateConfig(previousVersion)).toThrow(ConfigValidationError);
  });

  it("applies runtime overrides after canonical configuration", () => {
    const canonical = configured({ id: "canonical", port: 9000 });
    const effective = resolveEffectiveConfig({ canonical, runtime: { controller: { port: 9001 } } as Partial<DispatcherConfig> });
    expect(effective.controller).toMatchObject({ id: "canonical", port: 9001 });
  });

  it("requires a correctly namespaced credential reference for enabled integrations", () => {
    const missing = structuredClone(defaultDispatcherConfig);
    missing.integrations.linear.enabled = true;
    expect(() => validateConfig(missing)).toThrowError(/credentialRef is required/);
    missing.integrations.linear.credentialRef = "secret://slack/main";
    expect(() => validateConfig(missing)).toThrowError(/linear secret namespace/);
  });

  it("validates connector and Codex profile configuration through the canonical schema", () => {
    const input = structuredClone(defaultDispatcherConfig);
    input.connectors = [{
      id: "linear-main",
      definitionId: "task.linear",
      kind: "task",
      displayName: "Linear",
      enabled: true,
      credentialRef: "secret://linear/token",
      settings: { webhookSecretRef: "secret://linear/webhook", repository: "acme/repo" },
    }];
    input.agentProfiles = [{ id: "orion", provider: "codex", alias: "Orion", runnerId: "local", settings: { codexHome: "/profiles/orion" } }];
    expect(validateConfig(input)).toEqual(input);
    input.connectors[0]!.settings = { webhookSecretRef: "secret://github/wrong" };
    expect(() => validateConfig(input)).toThrowError(/linear secret namespace/);
  });

  it("requires absolute repository roots and relative scope paths", () => {
    const input = structuredClone(defaultDispatcherConfig);
    input.repositories = [{ id: "acme/repo", root: "/srv/repo", defaultBaseRef: "main", scopePaths: ["packages/api"], verificationCommands: [] }];
    expect(validateConfig(input).repositories).toEqual(input.repositories);
    input.repositories[0]!.scopePaths = ["../outside"];
    expect(() => validateConfig(input)).toThrowError(/scopePaths must stay relative/);
    input.repositories[0] = { id: "acme/repo", root: "relative", defaultBaseRef: "main", scopePaths: [], verificationCommands: [] };
    expect(() => validateConfig(input)).toThrowError(/root must be absolute/);
  });

  it("requires an opaque runner credential reference for remote runners", () => {
    const input = structuredClone(defaultDispatcherConfig);
    input.runners.push({ id: "remote", displayName: "Remote", mode: "remote", capacity: 1, tags: [] });
    expect(() => validateConfig(input)).toThrowError(/credentialRef is required/);
    input.runners[1]!.credentialRef = "secret://runner/dispatcher/remote";
    expect(validateConfig(input).runners[1]?.credentialRef).toBe("secret://runner/dispatcher/remote");
    expect(requiredSecretReferences(validateConfig(input))).not.toContain("secret://runner/dispatcher/remote");
  });
});

describe("ConfigurationEngine", () => {
  it("applies and audits a safe plan", () => {
    const database = new DispatcherDatabase(":memory:");
    const runtime = { apply: vi.fn() };
    const engine = new ConfigurationEngine(database, runtime);
    const plan = engine.buildPlan(configured({ id: "controller-two" }), "tester", "cli");
    expect(plan.risk).toBe("safe");
    const applied = engine.applyPlan(plan.id);
    expect(applied.config.controller.id).toBe("controller-two");
    expect(database.listAudit().map((entry) => entry.action)).toContain("apply");
    expect(runtime.apply).toHaveBeenCalled();
    database.close();
  });

  it("requires confirmation for sensitive plans", () => {
    const database = new DispatcherDatabase(":memory:");
    const engine = new ConfigurationEngine(database);
    const next = structuredClone(defaultDispatcherConfig);
    next.integrations.linear = { enabled: true, credentialRef: "secret://linear/main" };
    const plan = engine.buildPlan(next, "tester", "web");
    expect(plan.requiresConfirmation).toBe(true);
    expect(() => engine.applyPlan(plan.id)).toThrowError(
      expect.objectContaining<Partial<ConfigPlanError>>({ code: "CONFIG_CONFIRMATION_REQUIRED" }),
    );
    database.close();
  });

  it("rolls back database and runtime when verification fails", () => {
    const database = new DispatcherDatabase(":memory:");
    const runtime = { apply: vi.fn() };
    const engine = new ConfigurationEngine(database, runtime, [() => { throw new Error("probe failed"); }]);
    const before = engine.current();
    const plan = engine.buildPlan(configured({ id: "invalid-runtime" }), "tester", "web");
    expect(() => engine.applyPlan(plan.id)).toThrowError(
      expect.objectContaining<Partial<ConfigPlanError>>({ code: "CONFIG_APPLY_FAILED" }),
    );
    expect(engine.current()).toEqual(before);
    expect(runtime.apply).toHaveBeenLastCalledWith(before.config);
    database.close();
  });

  it("restores runtime when apply or canonical persistence fails", () => {
    for (const failure of ["runtime", "database"] as const) {
      const database = new DispatcherDatabase(":memory:");
      const runtime = { apply: vi.fn() };
      const engine = new ConfigurationEngine(database, runtime);
      const before = engine.current();
      const plan = engine.buildPlan(configured({ id: `${failure}-failure` }), "tester", "cli");
      if (failure === "runtime") runtime.apply.mockImplementationOnce(() => { throw new Error("runtime failed"); });
      else vi.spyOn(database, "writeConfigState").mockImplementationOnce(() => { throw new Error("database failed"); });
      expect(() => engine.applyPlan(plan.id)).toThrowError(
        expect.objectContaining<Partial<ConfigPlanError>>({ code: "CONFIG_APPLY_FAILED" }),
      );
      expect(engine.current()).toEqual(before);
      expect(runtime.apply).toHaveBeenLastCalledWith(before.config);
      expect(database.listAudit().find((entry) => entry.action === "apply" && entry.status === "failed")).toBeDefined();
      database.close();
    }
  });

  it("rejects stale plans without overwriting newer state", () => {
    const database = new DispatcherDatabase(":memory:");
    const engine = new ConfigurationEngine(database);
    const first = engine.buildPlan(configured({ id: "first" }), "tester", "web");
    const stale = engine.buildPlan(configured({ id: "stale" }), "tester", "web");
    engine.applyPlan(first.id);
    expect(() => engine.applyPlan(stale.id)).toThrow(RevisionConflictError);
    expect(engine.current().config.controller.id).toBe("first");
    database.close();
  });

  it("creates a new revision when an applied plan is rolled back", () => {
    const database = new DispatcherDatabase(":memory:");
    const engine = new ConfigurationEngine(database);
    const original = engine.current();
    const plan = engine.buildPlan(configured({ id: "temporary" }), "tester", "cli");
    const applied = engine.applyPlan(plan.id);
    const rolledBack = engine.rollbackPlan(plan.id);
    expect(rolledBack.revision).toBe(applied.revision + 1);
    expect(rolledBack.config).toEqual(original.config);
    expect(database.listAudit().find((entry) => entry.action === "rollback" && entry.status === "committed")).toBeDefined();
    database.close();
  });

  it("keeps the active revision and audits a failed rollback", () => {
    const database = new DispatcherDatabase(":memory:");
    const runtime = { apply: vi.fn() };
    const engine = new ConfigurationEngine(database, runtime);
    const plan = engine.buildPlan(configured({ id: "active" }), "tester", "cli");
    const applied = engine.applyPlan(plan.id);
    runtime.apply.mockImplementationOnce(() => { throw new Error("rollback apply failed"); });
    expect(() => engine.rollbackPlan(plan.id)).toThrowError(
      expect.objectContaining<Partial<ConfigPlanError>>({ code: "CONFIG_ROLLBACK_FAILED" }),
    );
    expect(engine.current()).toEqual({ ...applied, updatedAt: engine.current().updatedAt });
    expect(database.listAudit().find((entry) => entry.action === "rollback" && entry.status === "failed")).toBeDefined();
    database.close();
  });
});
