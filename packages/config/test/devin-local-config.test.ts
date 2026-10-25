import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DispatcherDatabase } from "@dispatcher/persistence";
import { ConfigValidationError, ConfigurationEngine, defaultDispatcherConfig, validateConfig } from "../src/index.js";

function configuration() {
  const config: Omit<typeof defaultDispatcherConfig, "agentProfiles"> & { agentProfiles: Array<{
    id: string; provider: string; alias: string; runnerId: string; enabled?: boolean; credentialRef?: string;
    settings?: Record<string, unknown>; nativeInteraction?: { mode: string; backendId: string; executionLocation: string };
  }> } = { ...structuredClone(defaultDispatcherConfig), agentProfiles: [] };
  config.agentProfiles = [{ id: "local", provider: "devin-local", alias: "Devin Local", runnerId: "local", settings: { executable: "/fixture/devin", dataHome: "/fixture/data", configHome: "/fixture/config" }, nativeInteraction: { mode: "compatible", backendId: "devin-local-acp", executionLocation: "managed-worktree" } }];
  return config;
}
it.each(["executable", "dataHome", "configHome"])("requires explicit absolute %s in canonical ConfigPlan", field => {
  for (const value of [undefined, "", "relative", 7, null, "/fixture/\npath"]) {
    const config = configuration(); if (value === undefined) delete config.agentProfiles[0]!.settings![field]; else config.agentProfiles[0]!.settings![field] = value;
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
  }
});
it.each(["approveTools", "args", "environment", "cloud", "model", "organizationId", "configDir"])("rejects unsupported Local setting %s rather than silently dropping it", field => {
  const config = configuration(); config.agentProfiles[0]!.settings![field] = false;
  expect(() => validateConfig(config)).toThrow(ConfigValidationError);
});
it.each(["backend", "cloud", "missing", "credential", "remote"])("rejects %s native ownership in canonical configuration", mode => {
  const config = configuration(), profile = config.agentProfiles[0]!;
  if (mode === "backend") profile.nativeInteraction!.backendId = "devin-organization-api";
  if (mode === "cloud") profile.nativeInteraction!.executionLocation = "provider-cloud";
  if (mode === "missing") delete profile.nativeInteraction;
  if (mode === "credential") profile.credentialRef = "secret://devin-local/copied";
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

it.each(["default", "createAsUserId", "credential", "credentialRef", "remote", "data_home", "config_home"])("rejects additional Local setting %s", field => {
  const config = configuration(); config.agentProfiles[0]!.settings![field] = "explicit-but-unsupported";
  expect(() => validateConfig(config)).toThrow(ConfigValidationError);
});
it.each(["executable", "dataHome", "configHome"])("rejects all Local control and oversized %s values", field => {
  for (const value of ["/fixture/\u0000path", "/fixture/\tpath", "/fixture/\u001fpath", "/fixture/\u007fpath", "/" + "x".repeat(4096), true, {}]) {
    const config = configuration(); config.agentProfiles[0]!.settings![field] = value;
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
  }
  const config = configuration(); config.agentProfiles[0]!.settings![field] = "/" + "x".repeat(4095);
  expect(validateConfig(config).agentProfiles[0]!.settings![field]).toBe("/" + "x".repeat(4095));
});
it.each(["pi-rpc", "codex-app-server", "opencode-server-v2"])("rejects foreign Local backend %s", backendId => {
  const config = configuration(); config.agentProfiles[0]!.nativeInteraction!.backendId = backendId;
  expect(() => validateConfig(config)).toThrow(ConfigValidationError);
});
it.each(["devin", "codex", "pi", "opencode", "cursor", "unsupported"])("rejects the ACP backend on foreign provider %s", provider => {
  const config = configuration(); config.agentProfiles[0]!.provider = provider;
  expect(() => validateConfig(config)).toThrow(ConfigValidationError);
});
it.each([["mode", "native-session"], ["mode", "native-gui"], ["executionLocation", "provider-self-hosted"], ["surface", "desktop"]])("rejects unqualified Local interaction %s=%s", (field, value) => {
  const config = configuration(); Object.assign(config.agentProfiles[0]!.nativeInteraction!, { [field!]: value });
  expect(() => validateConfig(config)).toThrow(ConfigValidationError);
});
it.each(["missing", "credential", "remote", "setting", "path"])("validates a disabled Local row with invalid %s", mode => {
  const config = configuration(), profile = config.agentProfiles[0]!; profile.enabled = false;
  if (mode === "missing") delete profile.nativeInteraction;
  if (mode === "credential") profile.credentialRef = "secret://devin-local/copied";
  if (mode === "remote") { config.runners.push({ id: "remote", displayName: "Remote", mode: "remote", capacity: 1, tags: [], credentialRef: "secret://runner/remote" }); profile.runnerId = "remote"; }
  if (mode === "setting") profile.settings!.model = "default";
  if (mode === "path") delete profile.settings!.dataHome;
  expect(() => validateConfig(config)).toThrow(ConfigValidationError);
});
it("persists exact Local paths and independent v3 credentials across an actual database restart and safe export", () => {
  const root = mkdtempSync(join(tmpdir(), "dispatcher-local-config-")), path = join(root, "config.sqlite");
  let database = new DispatcherDatabase(path);
  try {
    const config = configuration();
    config.agentProfiles.push({ id: "cloud", provider: "devin", alias: "Devin Cloud", runnerId: "local", credentialRef: "secret://devin/cloud", settings: { organizationId: "org-exact", createAsUserId: "user-exact" } });
    const engine = new ConfigurationEngine(database), plan = engine.buildPlan(config, "owner", "import");
    expect(plan.requiresConfirmation).toBe(true);
    expect(() => engine.applyPlan(plan.id)).toThrow();
    engine.applyPlan(plan.id, { confirmed: true }); database.close(); database = new DispatcherDatabase(path);
    const restarted = new ConfigurationEngine(database);
    expect(restarted.current().revision).toBe(2);
    expect(restarted.current().config.agentProfiles).toEqual([
      { id: "cloud", provider: "devin", alias: "Devin Cloud", runnerId: "local", credentialRef: "secret://devin/cloud", settings: { organizationId: "org-exact", createAsUserId: "user-exact" } },
      { id: "local", provider: "devin-local", alias: "Devin Local", runnerId: "local", settings: { executable: "/fixture/devin", dataHome: "/fixture/data", configHome: "/fixture/config" }, nativeInteraction: { mode: "compatible", backendId: "devin-local-acp", executionLocation: "managed-worktree" } },
    ]);
    expect(restarted.exportRedacted()).toMatchObject({ agentProfiles: [expect.objectContaining({ id: "cloud", credentialRef: "secret://devin/cloud" }), expect.objectContaining({ id: "local", settings: { executable: "/fixture/devin", dataHome: "/fixture/data", configHome: "/fixture/config" } })] });
    expect(restarted.current().config.agentProfiles[1]).not.toHaveProperty("credentialRef");
  } finally { database.close(); rmSync(root, { recursive: true, force: true }); }
});
