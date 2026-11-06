import { expect, it } from "vitest";
import { DispatcherDatabase } from "@dispatcher/persistence";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigValidationError, ConfigurationEngine, defaultDispatcherConfig, validateConfig } from "../src/index.js";

function configuration() {
  const config: Omit<typeof defaultDispatcherConfig, "agentProfiles"> & { agentProfiles: Array<{
    id: string; provider: string; alias: string; runnerId: string; enabled?: boolean; credentialRef?: string;
    settings?: Record<string, unknown>; nativeInteraction?: { mode: string; backendId: string; executionLocation: string; surface?: string };
  }> } = { ...structuredClone(defaultDispatcherConfig), agentProfiles: [] };
  config.agentProfiles = [{ id: "local", provider: "copilot", alias: "Copilot RPC", runnerId: "local", settings: { executable: "/fixture/copilot", copilotHome: "/fixture/home" }, nativeInteraction: { mode: "compatible", backendId: "copilot-rpc", executionLocation: "managed-worktree" } }];
  return config;
}
it.each(["executable", "copilotHome"])("requires explicit absolute %s in canonical ConfigPlan", field => {
  for (const value of [undefined, "", "relative", 7, null, "/fixture/\npath", "/fixture/\u0001path", "/fixture/\u007fpath", "/" + "p".repeat(4096)]) {
    const config = configuration(); if (value === undefined) delete config.agentProfiles[0]!.settings![field]; else config.agentProfiles[0]!.settings![field] = value;
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
  }
});
it.each(["approveTools", "args", "environment", "cloud", "model", "organizationId", "configDir"])("rejects unsupported Local setting %s rather than silently dropping it", field => {
  const config = configuration(); config.agentProfiles[0]!.settings![field] = false;
  expect(() => validateConfig(config)).toThrow(ConfigValidationError);
});
it.each(["backend", "cloud", "missing", "credential", "remote", "gui"])("rejects %s native ownership in canonical configuration", mode => {
  const config = configuration(), profile = config.agentProfiles[0]!;
  if (mode === "backend") profile.nativeInteraction!.backendId = "devin-organization-api";
  if (mode === "cloud") profile.nativeInteraction!.executionLocation = "provider-cloud";
  if (mode === "missing") delete profile.nativeInteraction;
  if (mode === "gui") profile.nativeInteraction = { mode: "native-gui", backendId: "copilot-rpc", executionLocation: "managed-worktree", surface: "fixture" };
  if (mode === "credential") profile.credentialRef = "secret://copilot/copied";
  if (mode === "remote") { config.runners.push({ id: "remote", displayName: "Remote", mode: "remote", capacity: 1, tags: [], credentialRef: "secret://runner/remote" }); profile.runnerId = "remote"; }
  expect(() => validateConfig(config)).toThrow(ConfigValidationError);
});
it("retains distinct explicit Local and v3 settings through ConfigPlan restart", () => {
  const database = new DispatcherDatabase(":memory:");
  try {
    const config = configuration(); config.agentProfiles.push({ id: "cloud", provider: "devin", alias: "Devin Cloud", runnerId: "local", credentialRef: "secret://devin/cloud", settings: { organizationId: "org-exact", createAsUserId: "user-exact" } });
    const engine = new ConfigurationEngine(database), plan = engine.buildPlan(config, "owner", "import"); engine.applyPlan(plan.id, { confirmed: true });
    expect(new ConfigurationEngine(database).current().config.agentProfiles).toEqual(validateConfig(config).agentProfiles);
  } finally { database.close(); }
});
it("keeps a disabled explicitly configured Local profile reserved without provider evidence", () => {
  const config = configuration(); config.agentProfiles[0]!.enabled = false;
  expect(validateConfig(config).agentProfiles[0]).toEqual(config.agentProfiles[0]);
});

it.each([true, false])("requires Copilot opt-in even when enabled is %s", enabled => {
  const config = configuration(), profile = config.agentProfiles[0]!;
  profile.enabled = enabled; delete profile.nativeInteraction;
  expect(() => validateConfig(config)).toThrow(/nativeInteraction is required for Copilot RPC/);
});
it.each(["devin", "devin-local", "codex", "pi", "opencode", "cursor", "unsupported"])("rejects Copilot RPC on foreign provider %s", provider => {
  const config = configuration(); config.agentProfiles[0]!.provider = provider;
  expect(() => validateConfig(config)).toThrow(ConfigValidationError);
});
it.each(["executable", "copilotHome"])("retains the exact 4096-unit %s and rejects every C0/DEL character", field => {
  for (const code of [...Array.from({ length: 32 }, (_, index) => index), 127]) {
    const config = configuration(); config.agentProfiles[0]!.settings![field] = "/fixture/" + String.fromCharCode(code) + "path";
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
  }
  const config = configuration(); config.agentProfiles[0]!.settings![field] = "/" + "p".repeat(4095);
  expect(validateConfig(config).agentProfiles[0]!.settings![field]).toBe("/" + "p".repeat(4095));
});
it.each(["missing", "credential", "remote", "setting", "path"])("validates a disabled Copilot reservation with invalid %s", mode => {
  const config = configuration(), profile = config.agentProfiles[0]!; profile.enabled = false;
  if (mode === "missing") delete profile.nativeInteraction;
  if (mode === "credential") profile.credentialRef = "secret://copilot/copied";
  if (mode === "remote") { config.runners.push({ id: "remote", displayName: "Remote", mode: "remote", capacity: 1, tags: [], credentialRef: "secret://runner/remote" }); profile.runnerId = "remote"; }
  if (mode === "setting") profile.settings!.model = "default";
  if (mode === "path") delete profile.settings!.copilotHome;
  expect(() => validateConfig(config)).toThrow(ConfigValidationError);
});
it("persists exact Copilot paths and independent Devin v3 settings across database close and reopen", () => {
  const root = mkdtempSync(join(tmpdir(), "dispatcher-copilot-config-")), path = join(root, "config.sqlite");
  let database = new DispatcherDatabase(path);
  try {
    const config = configuration();
    config.agentProfiles.push({ id: "cloud", provider: "devin", alias: "Devin Cloud", runnerId: "local", credentialRef: "secret://devin/cloud", settings: { organizationId: "org-exact", createAsUserId: "user-exact" } });
    const engine = new ConfigurationEngine(database), plan = engine.buildPlan(config, "owner", "import");
    expect(plan.requiresConfirmation).toBe(true); expect(() => engine.applyPlan(plan.id)).toThrow();
    engine.applyPlan(plan.id, { confirmed: true }); database.close(); database = new DispatcherDatabase(path);
    const restarted = new ConfigurationEngine(database);
    expect(restarted.current().revision).toBe(2);
    expect(restarted.current().config.agentProfiles).toEqual([
      { id: "cloud", provider: "devin", alias: "Devin Cloud", runnerId: "local", credentialRef: "secret://devin/cloud", settings: { organizationId: "org-exact", createAsUserId: "user-exact" } },
      { id: "local", provider: "copilot", alias: "Copilot RPC", runnerId: "local", settings: { executable: "/fixture/copilot", copilotHome: "/fixture/home" }, nativeInteraction: { mode: "compatible", backendId: "copilot-rpc", executionLocation: "managed-worktree" } },
    ]);
    expect(restarted.current().config.agentProfiles[1]).not.toHaveProperty("credentialRef");
  } finally { database.close(); rmSync(root, { recursive: true, force: true }); }
});
