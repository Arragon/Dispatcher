import { AdapterContractError, type AgentAdapter } from "./contracts.js";
import { CodexAdapter, probeCodexProfile, type CodexBackend, type CodexProfileConfig } from "./codex.js";
import type { CodexReadRequest } from "./codex-catalog.js";
import { CursorAdapter, KiroAdapter, probeCursorProfile, probeKiroProfile, type CliAgentBackend, type CliAgentProfile, type NativeProbeContext, type CredentialResolver } from "./ecosystem-cli.js";
import { AntigravityAdapter, GrokAdapter, OpenCodeAdapter, PiAdapter, QoderCnAdapter, WorkBuddyCliAdapter, ZCodeAdapter, isNativeCliProvider, probeNativeCliProfile, type NativeCliProvider } from "./native-cli.js";
import type { SessionStore } from "./generic.js";
import {homedir} from "node:os";
import {join} from "node:path";

/** Structural registration contract; adapters do not depend on configuration or persistence. */
export interface NativeProfileRegistration {
  id: string; alias: string; provider: string; enabled?: boolean; credentialRef?: string; settings?: Record<string, unknown>;
}
/** Native account locations used by our registered adapters/catalogs; owning host only. */
export function nativePrivatePaths(profiles:readonly NativeProfileRegistration[]):string[]{
  const paths=new Set<string>();
  for(const profile of profiles){
    for(const key of ["codexHome","configDir"])if(typeof profile.settings?.[key]==="string"&&profile.settings[key])paths.add(profile.settings[key]);
    if(profile.provider==="cursor")paths.add(join(homedir(),".cursor"));
    if(profile.provider==="qoder-cn"&&!profile.settings?.configDir)paths.add(join(homedir(),".qoder-cn"));
    if(profile.provider==="grok")paths.add(join(homedir(),".grok"));
    if(profile.provider==="opencode")paths.add(join(process.env.XDG_DATA_HOME??join(homedir(),".local","share"),"opencode"));
    if(profile.provider==="antigravity"){
      paths.add(join(homedir(),".gemini","config"));
      if(process.env.AGY_ADC_AUTH==="true")paths.add(process.env.GOOGLE_APPLICATION_CREDENTIALS??join(homedir(),".config","gcloud","application_default_credentials.json"));
    }
    if(process.platform==="darwin"&&["antigravity","grok"].includes(profile.provider))paths.add(join(homedir(),"Library","Keychains"));
  }
  return [...paths];
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
