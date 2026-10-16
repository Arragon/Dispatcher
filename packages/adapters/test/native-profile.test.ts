import { expect, it } from "vitest";
import { createNativeProfileAdapter } from "../src/native-profile.js";
import type { CodexBackend } from "../src/codex.js";

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
