import { expect, it,vi } from "vitest";
import { createNativeProfileAdapter, nativePrivatePaths, type NativeProfileRegistration } from "../src/native-profile.js";
import type { CodexBackend } from "../src/codex.js";

const nativeCodex=()=>({id:"native",alias:"Native",provider:"codex",nativeInteraction:{mode:"compatible" as const,backendId:"codex-app-server" as const,executionLocation:"managed-worktree" as const},settings:{codexHome:"/native/home",executable:"/native/bin/codex"}});
it("requires the explicitly configured Codex runtime instead of falling back to exec",()=>{
 expect(()=>createNativeProfileAdapter(nativeCodex())).toThrow(expect.objectContaining({code:"CODEX_RUNTIME_UNAVAILABLE"}));
 const start=vi.fn(),factory=vi.fn(()=>({backendId:"codex-exec-json" as const,start}));expect(()=>createNativeProfileAdapter(nativeCodex(),{codexBackendFactory:factory})).toThrow(expect.objectContaining({code:"BACKEND_MISMATCH"}));expect(start).not.toHaveBeenCalled();
});
it("rejects a foreign configured backend before constructing a Codex factory",()=>{
 const original=nativeCodex(),profile={...original,nativeInteraction:{...original.nativeInteraction,backendId:"pi-rpc" as const}},factory=vi.fn(()=>({backendId:"codex-exec-json" as const,start:vi.fn()}));expect(()=>createNativeProfileAdapter(profile,{codexBackendFactory:factory})).toThrow(expect.objectContaining({code:"BACKEND_MISMATCH"}));expect(factory).not.toHaveBeenCalled();
});
it("does not activate an injected native Codex backend without applied opt-in",()=>{
 const {nativeInteraction:ignored,...profile}=nativeCodex();void ignored;const start=vi.fn();expect(()=>createNativeProfileAdapter(profile,{codexBackendFactory:()=>({backendId:"codex-app-server",start})})).toThrow(expect.objectContaining({code:"NATIVE_INTERACTION_REQUIRED"}));expect(start).not.toHaveBeenCalled();
});
it("constructs only the matching configured Codex backend without native startup",()=>{
 const start=vi.fn(),profile=nativeCodex(),before=structuredClone(profile),adapter=createNativeProfileAdapter(profile,{codexBackendFactory:()=>({backendId:"codex-app-server",start})})!;
 expect(adapter.manifest.backends[0]!.id).toBe("codex-app-server");expect(adapter.supportsExecutionRef).toBe(true);expect(start).not.toHaveBeenCalled();expect(profile).toEqual(before);
});

it("protects Pi account and native-session directories from repository execution",()=>{
 expect(nativePrivatePaths([{id:"pi",alias:"Pi",provider:"pi",settings:{agentDirectory:"/native/pi/agent",sessionDirectory:"/native/pi/sessions"}}])).toEqual(["/native/pi/agent","/native/pi/sessions"]);
});

it("shares native profile construction without modifying the registration or default model", async () => {
  const calls: Array<Parameters<CodexBackend["start"]>[0]> = [];
  const profile = { id: "p", alias: "P", provider: "codex", settings: { codexHome: "/own/home", executable: "own-codex", model: "default" } };
  const before = structuredClone(profile);
  const adapter = createNativeProfileAdapter(profile, { codexBackendFactory: () => ({ start: input => { calls.push(input); return { cancel: async () => undefined, status: () => "completed", result: async () => ({ state: "completed", summary: "done", events: [] }) }; } }) })!;
  await adapter.start({ runId: "r", workspacePath: "/own/work", executionSelection: { version: 1, mode: "manual", source: "native-default", selectionType: "native-default", profileId: "p", runnerId: "remote", providerId: "codex", backendId: "codex-exec-json", nativeParameters: {}, contextFingerprint: "context", configRevision: 1, selectedAt: "now" } });
  expect(calls[0]).toMatchObject({ executable: "own-codex", codexHome: "/own/home", workspacePath: "/own/work" });
  expect(calls[0]).not.toHaveProperty("model"); expect(profile).toEqual(before);
  expect(createNativeProfileAdapter({ ...profile, settings: {} })).toBeUndefined();
  expect(createNativeProfileAdapter({ ...profile, enabled: false })).toBeUndefined();
  expect(createNativeProfileAdapter({ ...profile, provider: "unqualified-provider" })).toBeUndefined();
});

it("constructs each supported CLI through its existing adapter and preserves local config paths", () => {
  for (const provider of ["cursor", "kiro", "opencode", "grok", "pi", "antigravity", "zcode", "workbuddy-cli", "qoder-cn"]) {
    let received: unknown;
    const adapter = createNativeProfileAdapter({ id: provider, alias: provider, provider, credentialRef: "secret://provider/native", settings: { configDir: "/own/config", executable: "/own/cli", approveTools: false, trustWorkspace: false } }, { cliBackendFactory: (kind, profile) => { received = { kind, profile }; return { start: () => { throw new Error("not started"); } }; } });
    expect(adapter?.supportsExecutionSelection, provider).toBe(["cursor", "opencode", "grok", "antigravity", "qoder-cn"].includes(provider));
    expect(received).toMatchObject({ kind: provider, profile: { configDir: "/own/config", executable: "/own/cli", approveTools: false, trustWorkspace: false } });
  }
});

const nativeOpenCode = () => ({ id: "opencode-native", alias: "OpenCode", provider: "opencode", nativeInteraction: { mode: "compatible", backendId: "opencode-server-v2", executionLocation: "managed-worktree" }, settings: { executable: "/native/bin/opencode", model: "provider/vendor/model", approveTools: false } } satisfies NativeProfileRegistration);
it("requires the explicitly configured OpenCode runtime instead of falling back to standalone", () => {
  expect(() => createNativeProfileAdapter(nativeOpenCode())).toThrow(expect.objectContaining({ code: "OPENCODE_RUNTIME_UNAVAILABLE" }));
  const factory = vi.fn(() => undefined);
  expect(() => createNativeProfileAdapter(nativeOpenCode(), { cliBackendFactory: factory })).toThrow(expect.objectContaining({ code: "OPENCODE_RUNTIME_UNAVAILABLE" }));
  expect(factory).toHaveBeenCalledWith("opencode", { id: "opencode-native", alias: "OpenCode", executable: "/native/bin/opencode", model: "provider/vendor/model", approveTools: false });
});
it.each(["codex", "pi", "cursor", "unsupported"])("rejects configured OpenCode on foreign provider %s before any factory", provider => {
  const codexFactory = vi.fn(), cliFactory = vi.fn();
  const profile = { ...nativeOpenCode(), provider, settings: { ...nativeOpenCode().settings, codexHome: "/native/codex" } };
  expect(() => createNativeProfileAdapter(profile, { codexBackendFactory: codexFactory, cliBackendFactory: cliFactory })).toThrow(expect.objectContaining({ code: "BACKEND_MISMATCH" }));
  expect(codexFactory).not.toHaveBeenCalled(); expect(cliFactory).not.toHaveBeenCalled();
});
const foreignOpenCodeBackends: Array<NonNullable<NativeProfileRegistration["nativeInteraction"]>["backendId"]> = ["pi-rpc", "codex-app-server"];
it.each(foreignOpenCodeBackends)("rejects foreign native backend %s on OpenCode before any factory", backendId => {
  const profile = nativeOpenCode(), cliFactory = vi.fn(), codexFactory = vi.fn();
  expect(() => createNativeProfileAdapter({ ...profile, nativeInteraction: { ...profile.nativeInteraction, backendId } }, { cliBackendFactory: cliFactory, codexBackendFactory: codexFactory })).toThrow(expect.objectContaining({ code: "BACKEND_MISMATCH" }));
  expect(cliFactory).not.toHaveBeenCalled(); expect(codexFactory).not.toHaveBeenCalled();
});
it.each([undefined, "opencode-cli-json", "pi-rpc", "codex-app-server", "arbitrary"])("rejects mismatched OpenCode factory backend %s before start", backendId => {
  const start = vi.fn();
  expect(() => createNativeProfileAdapter(nativeOpenCode(), { cliBackendFactory: () => ({ backendId, start }) })).toThrow(expect.objectContaining({ code: "BACKEND_MISMATCH" }));
  expect(start).not.toHaveBeenCalled();
});
it("does not activate an injected OpenCode server without applied opt-in", () => {
  const { nativeInteraction: ignored, ...profile } = nativeOpenCode(); void ignored;
  const start = vi.fn();
  expect(() => createNativeProfileAdapter(profile, { cliBackendFactory: () => ({ backendId: "opencode-server-v2", start }) })).toThrow(expect.objectContaining({ code: "NATIVE_INTERACTION_REQUIRED" }));
  expect(start).not.toHaveBeenCalled();
});
it.each(["cursor", "kiro", "grok", "pi", "antigravity", "zcode", "workbuddy-cli", "qoder-cn"])("rejects injected OpenCode server on foreign CLI provider %s", provider => {
  const start = vi.fn();
  expect(() => createNativeProfileAdapter({ id: provider, alias: provider, provider }, { cliBackendFactory: () => ({ backendId: "opencode-server-v2", start }) })).toThrow(expect.objectContaining({ code: "BACKEND_MISMATCH" }));
  expect(start).not.toHaveBeenCalled();
});
it("constructs only the matching OpenCode server without eager native work or registration mutation", () => {
  const profile = nativeOpenCode(), before = structuredClone(profile), start = vi.fn(), factory = vi.fn(() => ({ backendId: "opencode-server-v2", start }));
  const adapter = createNativeProfileAdapter(profile, { cliBackendFactory: factory })!;
  expect(adapter.manifest.backends.map(backend => backend.id)).toEqual(["opencode-server-v2"]);
  expect(adapter.supportsExecutionRef).toBe(true); expect(adapter.supportsExecutionSelection).toBe(true);
  expect(factory).toHaveBeenCalledWith("opencode", { id: "opencode-native", alias: "OpenCode", executable: "/native/bin/opencode", model: "provider/vendor/model", approveTools: false });
  expect(start).not.toHaveBeenCalled(); expect(profile).toEqual(before);
});
it("returns disabled OpenCode profiles before invoking any factory or accessing the nonexistent executable", () => {
  const cliFactory = vi.fn(), codexFactory = vi.fn();
  expect(createNativeProfileAdapter({ ...nativeOpenCode(), enabled: false }, { cliBackendFactory: cliFactory, codexBackendFactory: codexFactory })).toBeUndefined();
  expect(cliFactory).not.toHaveBeenCalled(); expect(codexFactory).not.toHaveBeenCalled();
});
it("preserves the default standalone OpenCode manifest and broad injected CLI factory", () => {
  const profile = { id: "standalone", alias: "Standalone", provider: "opencode", settings: { executable: "opencode", model: "default", approveTools: true, configDir: "/native/config" } }, before = structuredClone(profile);
  const start = vi.fn(), factory = vi.fn(() => ({ start }));
  expect(createNativeProfileAdapter(profile)!.manifest.backends.map(backend => backend.id)).toEqual(["opencode-cli-json"]);
  const adapter = createNativeProfileAdapter(profile, { cliBackendFactory: factory })!;
  expect(adapter.manifest.backends.map(backend => backend.id)).toEqual(["opencode-cli-json"]);
  expect(adapter.supportsExecutionRef).toBe(false);
  expect(factory).toHaveBeenCalledWith("opencode", { id: "standalone", alias: "Standalone", executable: "opencode", model: "default", approveTools: true, configDir: "/native/config" });
  expect(start).not.toHaveBeenCalled(); expect(profile).toEqual(before);
});
it("protects the effective XDG OpenCode directory and restores the process environment fixture", () => {
  const original = process.env.XDG_DATA_HOME;
  try {
    process.env.XDG_DATA_HOME = "/fixture/xdg-data";
    expect(nativePrivatePaths([nativeOpenCode()])).toEqual(["/fixture/xdg-data/opencode"]);
  } finally {
    if (original === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = original;
  }
  expect(process.env.XDG_DATA_HOME).toBe(original);
});
