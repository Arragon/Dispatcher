import { DispatcherDatabase } from "@dispatcher/persistence";
import { describe, expect, it } from "vitest";
import { ConfigValidationError, ConfigurationEngine, configToJson, defaultDispatcherConfig, validateConfig, type DispatcherConfig } from "../src/index.js";
function configured(): DispatcherConfig { return structuredClone(defaultDispatcherConfig); }
describe("Devin v3 configuration", () => {
  it.each([123, true, null, "", " ", "\nuser", "x".repeat(513)])("rejects invalid explicit Devin attribution %j", createAsUserId => {
    const config = configured();
    config.agentProfiles.push({ id: "devin", provider: "devin", alias: "Devin", runnerId: "local", credentialRef: "secret://devin/main", settings: { organizationId: "org-test", createAsUserId } });
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
  });
  it.each([0, -1, 12.5, "12", null])("rejects a Devin ACU limit outside the native positive integer contract %j", maxSessionAcu => {
    const config = configured();
    config.agentProfiles.push({ id: "devin", provider: "devin", alias: "Devin", runnerId: "local", credentialRef: "secret://devin/main", settings: { organizationId: "org-test", maxSessionAcu } });
    expect(() => validateConfig(config)).toThrow(ConfigValidationError);
  });
  it("retains optional explicit Devin owner and integer ACU limit", () => {
    const config = configured(); config.agentProfiles.push({ id: "devin", provider: "devin", alias: "Devin", runnerId: "local", credentialRef: "secret://devin/main", settings: { organizationId: "org-test", createAsUserId: "user-exact", maxSessionAcu: 12 } });
    expect(validateConfig(config).agentProfiles[0]?.settings).toMatchObject({ createAsUserId: "user-exact", maxSessionAcu: 12 });
  });
});

it.each([{ maxSessionAcu: 12.5 }, { createAsUserId: "\ninvalid" }])("preserves invalid persisted Devin values while refusing current validation %j", settings => {
  const database = new DispatcherDatabase(":memory:");
  try {
    const config = configured(); config.agentProfiles.push({ id: "devin", provider: "devin", alias: "Devin", runnerId: "local", credentialRef: "secret://devin/main", settings: { organizationId: "org-test", ...settings } });
    database.writeConfigState(0, { schemaVersion: 1, document: configToJson(config), updatedAt: "2026-10-25T00:00:00.000Z" });
    const before = database.getConfigState(), engine = new ConfigurationEngine(database);
    expect(() => engine.current()).toThrow(ConfigValidationError); expect(database.getConfigState()).toEqual(before);
  } finally { database.close(); }
});
