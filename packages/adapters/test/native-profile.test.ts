import { expect, it,vi } from "vitest";
import { createNativeProfileAdapter, nativePrivatePaths } from "../src/native-profile.js";
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
