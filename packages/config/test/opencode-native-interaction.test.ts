import { expect, it } from "vitest";
import { DispatcherDatabase } from "@dispatcher/persistence";
import { ConfigurationEngine, defaultDispatcherConfig, validateConfig } from "../src/index.js";

const interaction = { mode: "compatible", backendId: "opencode-server-v2", executionLocation: "managed-worktree" };
function candidate() {
  const settings: Record<string, unknown> = { executable: "/native/bin/opencode" };
  return { ...structuredClone(defaultDispatcherConfig), agentProfiles: [{ id: "opencode-local", alias: "OpenCode", provider: "opencode", runnerId: "local", nativeInteraction: { ...interaction }, settings }] };
}

it("round-trips explicit server configuration without probing", () => {
  const config = candidate(), before = structuredClone(config), result = validateConfig(config);
  expect(result).toEqual(before); expect(config).toEqual(before);
  expect(result.agentProfiles[0]!.settings).not.toHaveProperty("model");
  expect(result.agentProfiles[0]!.settings).not.toHaveProperty("approveTools");
});
it("preserves omitted native interaction as standalone", () => {
  const config = candidate(); Reflect.deleteProperty(config.agentProfiles[0]!, "nativeInteraction");
  config.agentProfiles[0]!.settings = { executable: "opencode", model: "standalone model", approveTools: true, configDir: "/native/config" };
  expect(validateConfig(config)).toEqual(config);
});
it.each([
  ["mode", "native-session"], ["mode", "native-gui"], ["mode", "control"],
  ["backendId", "opencode-cli-json"], ["backendId", "arbitrary"],
  ["executionLocation", "provider-cloud"], ["executionLocation", "provider-self-hosted"],
  ["surface", "desktop"], ["surface", "tui"], ["enabled", true],
])("rejects unsupported interaction fields %s=%s without creating a ConfigPlan", (field, value) => {
  const config = candidate(); Object.assign(config.agentProfiles[0]!.nativeInteraction, { [field]: value });
  const database = new DispatcherDatabase(":memory:");
  try {
    const engine = new ConfigurationEngine(database), before = engine.current();
    expect(() => validateConfig(config)).toThrow(/nativeInteraction/);
    expect(() => engine.buildPlan(config, "fixture", "web")).toThrow(/nativeInteraction/);
    expect(engine.current()).toEqual(before);
    expect(database.handle.prepare("SELECT COUNT(*) AS count FROM config_plans").get()?.count).toBe(0);
  } finally { database.close(); }
});
it("requires a confirmed privileged feature plan while preserving the compatible backend policy", () => {
  const config = { ...candidate(), nativeInteraction: { enabled: true } },database=new DispatcherDatabase(":memory:");
  try {
    expect(validateConfig(config)).toEqual(config);const engine=new ConfigurationEngine(database),before=engine.current(),plan=engine.buildPlan(config,"fixture","web");
    expect(plan).toMatchObject({risk:"privileged",requiresConfirmation:true});expect(()=>engine.applyPlan(plan.id,{confirmed:false})).toThrow();expect(engine.current()).toEqual(before);
    engine.applyPlan(plan.id,{confirmed:true});expect(engine.current().config.agentProfiles[0]!.nativeInteraction?.mode).toBe("compatible");
    expect(()=>validateConfig({...config,nativeInteraction:{enabled:true,claimQualified:true}})).toThrow(/additional properties/);
  }finally{database.close();}
});
it.each(["codex", "pi", "cursor", "generic"])("rejects a server backend on a foreign provider %s", provider => {
  const config = candidate(); config.agentProfiles[0]!.provider = provider;
  expect(() => validateConfig(config)).toThrow(/nativeInteraction/);
});
it("rejects a server backend on a remote Runner", () => {
  const config = candidate(); config.runners.push({ id: "remote", displayName: "Remote", mode: "remote", capacity: 1, tags: [], credentialRef: "secret://runner/fixture/remote" });
  config.agentProfiles[0]!.runnerId = "remote";
  expect(() => validateConfig(config)).toThrow(/embedded/);
});
it.each([undefined, "", "relative/path", "/native/\u0000unsafe", "/native/\nunsafe", "/native/\u007funsafe", "/" + "a".repeat(4096), 42])("requires only the explicit absolute executable path: %s", executable => {
  const config = candidate(); config.agentProfiles[0]!.settings.executable = executable;
  expect(() => validateConfig(config)).toThrow(/executable/);
});
it("accepts the executable path length boundary without probing", () => {
  const config = candidate(); config.agentProfiles[0]!.settings.executable = "/" + "a".repeat(4095);
  expect(validateConfig(config)).toEqual(config);
});
it.each([undefined, "provider/model", "provider/vendor/model", "provider name/model name", "provider / model", "provider/model\u2028suffix", "供应商/模型", "p/" + "m".repeat(238)])("accepts omitted model or a safe exact model: %s", model => {
  const config = candidate(); if (model !== undefined) config.agentProfiles[0]!.settings.model = model;
  expect(validateConfig(config)).toEqual(config);
});
it.each(["", "model", "/model", "provider/", "provider/model#variant", "provider/\u0000model", "provider/model\u007f", 42, "p/" + "m".repeat(239)])("rejects an unsafe exact model: %s", model => {
  const config = candidate(); config.agentProfiles[0]!.settings.model = model;
  expect(() => validateConfig(config)).toThrow(/model/);
});
it.each([undefined, false])("keeps tool approval unqualified: %s", approveTools => {
  const config = candidate(); if (approveTools !== undefined) config.agentProfiles[0]!.settings.approveTools = approveTools;
  const result = validateConfig(config); expect(result).toEqual(config);
  if (approveTools === undefined) expect(result.agentProfiles[0]!.settings).not.toHaveProperty("approveTools");
});
it.each([true, "false", 0, null])("rejects qualified or malformed tool approval: %s", approveTools => {
  const config = candidate(); config.agentProfiles[0]!.settings.approveTools = approveTools;
  expect(() => validateConfig(config)).toThrow(/approveTools/);
});
it.each(["configDir", "opencodeHome", "dataHome", "sessionDirectory", "agentDirectory", "codexHome", "environment", "trustWorkspace", "unknown"])("rejects unsupported server settings: %s", key => {
  const config = candidate(); config.agentProfiles[0]!.settings[key] = key === "environment" ? {} : key === "trustWorkspace" ? false : "/native/path";
  expect(() => validateConfig(config)).toThrow(new RegExp(key));
});
it("keeps OpenCode native login outside credential storage", () => {
  const config = candidate(); Object.assign(config.agentProfiles[0]!, { credentialRef: "secret://opencode/fixture" });
  expect(() => validateConfig(config)).toThrow(/native login/);
});
it("retains disabled structural registration without activation", () => {
  const config = candidate(); Object.assign(config.agentProfiles[0]!, { enabled: false });
  expect(validateConfig(config)).toEqual(config);
  config.agentProfiles[0]!.settings.executable = "opencode"; expect(() => validateConfig(config)).toThrow(/executable/);
  config.agentProfiles[0]!.settings.executable = "/native/bin/opencode"; config.agentProfiles[0]!.settings.configDir = "/native/config";
  expect(() => validateConfig(config)).toThrow(/configDir/);
});
it("reviews activation and removal through sensitive ConfigPlan", () => {
  const database = new DispatcherDatabase(":memory:");
  try {
    const engine = new ConfigurationEngine(database), standalone = candidate(); Reflect.deleteProperty(standalone.agentProfiles[0]!, "nativeInteraction");
    engine.applyPlan(engine.buildPlan(standalone, "fixture", "web").id, { confirmed: true });
    const before = engine.current(), plan = engine.buildPlan(candidate(), "fixture", "web");
    expect(plan.risk).toBe("sensitive"); expect(plan.requiresConfirmation).toBe(true);
    expect(plan.changes).toEqual([{ op: "replace", path: "/agentProfiles", before: standalone.agentProfiles, after: candidate().agentProfiles }]);
    expect(() => engine.applyPlan(plan.id)).toThrow(expect.objectContaining({ code: "CONFIG_CONFIRMATION_REQUIRED" }));
    expect(engine.current()).toEqual(before);
    expect(engine.applyPlan(plan.id, { confirmed: true }).config.agentProfiles).toEqual(candidate().agentProfiles);
    for (const next of [standalone, { ...candidate(), agentProfiles: [{ ...candidate().agentProfiles[0]!, settings: { executable: "/native/bin/other", model: "provider/model", approveTools: false } }] }]) {
      const current = engine.current(), change = engine.buildPlan(next, "fixture", "web");
      expect(change.risk).toBe("sensitive"); expect(change.requiresConfirmation).toBe(true);
      expect(change.changes).toEqual([{ op: "replace", path: "/agentProfiles", before: current.config.agentProfiles, after: next.agentProfiles }]);
      expect(() => engine.applyPlan(change.id)).toThrow(expect.objectContaining({ code: "CONFIG_CONFIRMATION_REQUIRED" }));
      expect(engine.current()).toEqual(current);
    }
  } finally { database.close(); }
});
