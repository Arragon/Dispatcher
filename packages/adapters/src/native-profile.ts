import { AdapterContractError, type AgentAdapter } from "./contracts.js";
import { CodexAdapter, probeCodexProfile, type CodexBackend, type CodexProfileConfig } from "./codex.js";
import type { CodexReadRequest } from "./codex-catalog.js";
import { CursorAdapter, KiroAdapter, probeCursorProfile, probeKiroProfile, type CliAgentBackend, type CliAgentProfile, type NativeProbeContext, type CredentialResolver } from "./ecosystem-cli.js";
import { AntigravityAdapter, GrokAdapter, OpenCodeAdapter, PiAdapter, QoderCnAdapter, WorkBuddyCliAdapter, ZCodeAdapter, isNativeCliProvider, probeNativeCliProfile, type NativeCliProvider } from "./native-cli.js";
import type { SessionStore } from "./generic.js";

/** Structural registration contract; adapters do not depend on configuration or persistence. */
export interface NativeProfileRegistration {
  id: string; alias: string; provider: string; enabled?: boolean; credentialRef?: string; settings?: Record<string, unknown>;
}
export interface NativeProfileFactoryOptions {
  store?: SessionStore; resolveCredential?: CredentialResolver;
  codexBackendFactory?: (profile: CodexProfileConfig) => CodexBackend | undefined;
  cliBackendFactory?: (provider: "cursor" | "kiro" | NativeCliProvider, profile: CliAgentProfile) => CliAgentBackend | undefined;
  codexNativeReader?: (input: CodexReadRequest) => Promise<unknown>;
}
const text = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value : undefined;
function codexProfile(profile: NativeProfileRegistration): CodexProfileConfig | undefined {
  const codexHome = text(profile.settings?.codexHome); if (!codexHome) return;
  return { id: profile.id, alias: profile.alias, codexHome, ...(text(profile.settings?.executable) ? { executable: text(profile.settings?.executable)! } : {}), ...(text(profile.settings?.model) ? { model: text(profile.settings?.model)! } : {}) };
}
function cliProfile(profile: NativeProfileRegistration): CliAgentProfile {
  return { id: profile.id, alias: profile.alias,
    ...(text(profile.settings?.executable) ? { executable: text(profile.settings?.executable)! } : {}),
    ...(text(profile.settings?.configDir) ? { configDir: text(profile.settings?.configDir)! } : {}),
    ...(text(profile.settings?.model) ? { model: text(profile.settings?.model)! } : {}),
    ...(typeof profile.settings?.approveTools === "boolean" ? { approveTools: profile.settings.approveTools } : {}),
    ...(typeof profile.settings?.trustWorkspace === "boolean" ? { trustWorkspace: profile.settings.trustWorkspace } : {}),
    ...(profile.credentialRef ? { credentialRef: profile.credentialRef } : {}),
  };
}
export function createNativeProfileAdapter(profile: NativeProfileRegistration, options: NativeProfileFactoryOptions = {}): AgentAdapter | undefined {
  if (profile.enabled === false) return;
  if (profile.provider === "codex") {
    const native = codexProfile(profile); if (!native) return;
    return new CodexAdapter(native, options.codexBackendFactory?.(native), options.store, options.codexNativeReader);
  }
  if (profile.provider !== "cursor" && profile.provider !== "kiro" && !isNativeCliProvider(profile.provider)) return;
  const native = cliProfile(profile), backend = options.cliBackendFactory?.(profile.provider, native), store = options.store, resolve = options.resolveCredential;
  switch (profile.provider) {
    case "cursor": return new CursorAdapter(native, backend, store, resolve);
    case "kiro": return new KiroAdapter(native, backend, store, resolve);
    case "opencode": return new OpenCodeAdapter(native, backend, store);
    case "grok": return new GrokAdapter(native, backend, store, resolve);
    case "pi": return new PiAdapter(native, backend, store);
    case "antigravity": return new AntigravityAdapter(native, backend, store);
    case "zcode": return new ZCodeAdapter(native, backend, store);
    case "workbuddy-cli": return new WorkBuddyCliAdapter(native, backend, store);
    case "qoder-cn": return new QoderCnAdapter(native, backend, store);
  }
}
export async function probeNativeProfile(profile: NativeProfileRegistration, resolveCredential?: CredentialResolver,context:NativeProbeContext={}): Promise<unknown> {
  if (profile.provider === "codex") {
    const native = codexProfile(profile); if (!native) throw new AdapterContractError("PROFILE_UNAVAILABLE", "Codex home is not registered");
    return probeCodexProfile(native,context);
  }
  const native = cliProfile(profile);
  if (profile.provider === "cursor") return probeCursorProfile(native, resolveCredential,context);
  if (profile.provider === "kiro") return probeKiroProfile(native, resolveCredential,context);
  if (isNativeCliProvider(profile.provider)) return probeNativeCliProfile(profile.provider, native,context);
  throw new AdapterContractError("PROBE_UNAVAILABLE", "Provider has no qualified native probe");
}
