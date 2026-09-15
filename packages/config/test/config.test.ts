import { describe, expect, it, vi } from "vitest";
import { DispatcherDatabase, RevisionConflictError } from "@dispatcher/persistence";
import {
  ConfigValidationError,
  ConfigurationEngine,
  defaultDispatcherConfig,
  normalizeConfig,
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
    database.close();
  });
});
