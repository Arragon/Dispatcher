import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { DispatcherDatabase, RevisionConflictError } from "@dispatcher/persistence";
import {
  ConfigValidationError,
  ConfigurationEngine,
  configToJson,
  defaultDispatcherConfig,
  normalizeConfig,
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
      { id: "one", provider: "codex", alias: "Atlas", runnerId: "local" },
      { id: "two", provider: "codex", alias: "atlas", runnerId: "local" },
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
