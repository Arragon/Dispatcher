import { AdapterContractError, type AgentAdapter } from "./contracts.js";
import { CodexAdapter, probeCodexProfile, type CodexBackend, type CodexProfileConfig } from "./codex.js";
import type { CodexReadRequest } from "./codex-catalog.js";
import { CursorAdapter, KiroAdapter, probeCursorProfile, probeKiroProfile, type CliAgentBackend, type CliAgentProfile, type NativeProbeContext, type CredentialResolver } from "./ecosystem-cli.js";
import { AntigravityAdapter, GrokAdapter, OpenCodeAdapter, PiAdapter, QoderCnAdapter, WorkBuddyCliAdapter, ZCodeAdapter, isNativeCliProvider, probeNativeCliProfile, type NativeCliProvider } from "./native-cli.js";
import type { SessionStore } from "./generic.js";
import { DevinLocalAcpAdapter } from "./devin-acp-execution.js";
import { CopilotAdapter } from "./copilot-execution.js";
import {homedir} from "node:os";
import {isAbsolute,join} from "node:path";

/** Structural registration contract; adapters do not depend on configuration or persistence. */
export interface NativeProfileRegistration {
  id: string; alias: string; provider: string; enabled?: boolean; credentialRef?: string; settings?: Record<string, unknown>;
  nativeInteraction?:{mode:"compatible";backendId:"pi-rpc"|"codex-app-server"|"opencode-server-v2"|"devin-local-acp"|"copilot-rpc";executionLocation:"managed-worktree"};
}
/** Native account locations used by our registered adapters/catalogs; owning host only. */
export function nativePrivatePaths(profiles:readonly NativeProfileRegistration[]):string[]{
  const paths=new Set<string>();
  for(const profile of profiles){
    for(const key of ["codexHome","configDir"])if(typeof profile.settings?.[key]==="string"&&profile.settings[key])paths.add(profile.settings[key]);
    if(profile.provider==="devin-local")for(const key of ["dataHome","configHome"])if(typeof profile.settings?.[key]==="string"&&profile.settings[key])paths.add(profile.settings[key]);
    if(profile.provider==="copilot"&&typeof profile.settings?.copilotHome==="string"&&profile.settings.copilotHome)paths.add(profile.settings.copilotHome);
    if(profile.provider==="pi")for(const key of ["agentDirectory","sessionDirectory"])if(typeof profile.settings?.[key]==="string"&&profile.settings[key])paths.add(profile.settings[key]);
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
  devinLocalBackendFactory?: (profile: CliAgentProfile) => CliAgentBackend | undefined;
  copilotBackendFactory?: (profile: CliAgentProfile) => CliAgentBackend | undefined;
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
function nativePath(profile: NativeProfileRegistration, key: string, code: string, label: string): string {
  const value = profile.settings?.[key];
  if (typeof value !== "string" || !isAbsolute(value) || value.length > 4096 || Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new AdapterContractError(code, `${label} requires an explicit absolute ${key}`);
  return value;
}
export function createNativeProfileAdapter(profile: NativeProfileRegistration, options: NativeProfileFactoryOptions = {}): AgentAdapter | undefined {
  if (profile.enabled === false) return;
  const configured = profile.nativeInteraction?.backendId;
  if ((configured === "copilot-rpc" && profile.provider !== "copilot") || (profile.provider === "copilot" && configured && configured !== "copilot-rpc")) throw new AdapterContractError("BACKEND_MISMATCH", "Copilot RPC requires its owning Copilot profile");
  if (profile.provider === "copilot") {
    if (configured !== "copilot-rpc" || profile.nativeInteraction?.mode !== "compatible" || profile.nativeInteraction.executionLocation !== "managed-worktree") throw new AdapterContractError("NATIVE_INTERACTION_REQUIRED", "Copilot RPC requires explicit compatible managed-worktree configuration");
    if (profile.credentialRef !== undefined || Object.keys(profile.settings ?? {}).some(key => !["executable", "copilotHome"].includes(key))) throw new AdapterContractError("COPILOT_RPC_INVALID_PROFILE", "Copilot RPC accepts only explicit native paths and native login");
    const executable = nativePath(profile, "executable", "COPILOT_RPC_INVALID_PROFILE", "Copilot RPC");
    nativePath(profile, "copilotHome", "COPILOT_RPC_INVALID_PROFILE", "Copilot RPC");
    const native = { id: profile.id, alias: profile.alias, executable };
    const backend = options.copilotBackendFactory?.(structuredClone(native));
    if (!backend) throw new AdapterContractError("COPILOT_RPC_RUNTIME_UNAVAILABLE", "Configured Copilot RPC requires its owning execution host");
    if (backend.backendId !== "copilot-rpc") throw new AdapterContractError("BACKEND_MISMATCH", "Configured Copilot host returned a different backend");
    return new CopilotAdapter(native, backend, options.store);
  }
  if ((configured === "devin-local-acp" && profile.provider !== "devin-local") || (profile.provider === "devin-local" && configured && configured !== "devin-local-acp")) throw new AdapterContractError("BACKEND_MISMATCH", "Devin Local ACP requires its owning Local profile");
  if (profile.provider === "devin-local") {
    if (configured !== "devin-local-acp" || profile.nativeInteraction?.mode !== "compatible" || profile.nativeInteraction.executionLocation !== "managed-worktree") throw new AdapterContractError("NATIVE_INTERACTION_REQUIRED", "Devin Local ACP requires explicit compatible managed-worktree configuration");
    if (profile.credentialRef !== undefined || Object.keys(profile.settings ?? {}).some(key => !["executable", "dataHome", "configHome"].includes(key))) throw new AdapterContractError("DEVIN_ACP_INVALID_PROFILE", "Devin Local ACP accepts only explicit native paths and native login");
    const scope = { executable: nativePath(profile, "executable", "DEVIN_ACP_INVALID_PROFILE", "Devin Local"), dataHome: nativePath(profile, "dataHome", "DEVIN_ACP_INVALID_PROFILE", "Devin Local"), configHome: nativePath(profile, "configHome", "DEVIN_ACP_INVALID_PROFILE", "Devin Local") };
    const native = { id: profile.id, alias: profile.alias, executable: scope.executable };
    const backend = options.devinLocalBackendFactory?.(structuredClone(native));
    if (!backend) throw new AdapterContractError("DEVIN_ACP_RUNTIME_UNAVAILABLE", "Configured Devin Local ACP requires its owning execution host");
    if (backend.backendId !== "devin-local-acp") throw new AdapterContractError("BACKEND_MISMATCH", "Configured Devin Local host returned a different backend");
    return new DevinLocalAcpAdapter(native, backend, options.store, scope);
  }
  if ((configured === "opencode-server-v2" && profile.provider !== "opencode") || (profile.provider === "opencode" && configured && configured !== "opencode-server-v2")) throw new AdapterContractError("BACKEND_MISMATCH", "OpenCode Server requires its owning OpenCode profile");
  if (profile.provider === "codex") {
    const native = codexProfile(profile); if (!native) return;
    if(configured&&configured!=="codex-app-server")throw new AdapterContractError("BACKEND_MISMATCH","Codex profile selects another provider's native backend");
    const backend=options.codexBackendFactory?.(native);
    if (["copilot-rpc"].includes(backend?.backendId ?? "")) throw new AdapterContractError("BACKEND_MISMATCH", "Copilot RPC cannot serve another provider");
    if(configured&&!backend)throw new AdapterContractError("CODEX_RUNTIME_UNAVAILABLE","Configured Codex App Server requires its owning execution host");
    if(configured&&backend?.backendId!==configured)throw new AdapterContractError("BACKEND_MISMATCH","Configured Codex native host returned a different backend");
    if(!configured&&backend?.backendId==="codex-app-server")throw new AdapterContractError("NATIVE_INTERACTION_REQUIRED","Codex App Server requires explicit applied native configuration");
    return new CodexAdapter(native, backend, options.store, options.codexNativeReader);
  }
  if (profile.provider !== "cursor" && profile.provider !== "kiro" && !isNativeCliProvider(profile.provider)) return;
  const native = cliProfile(profile), backend = options.cliBackendFactory?.(profile.provider, native), store = options.store, resolve = options.resolveCredential;
  if (backend?.backendId === "copilot-rpc") throw new AdapterContractError("BACKEND_MISMATCH", "Copilot RPC cannot serve another provider");
  if (backend?.backendId === "devin-local-acp") throw new AdapterContractError("BACKEND_MISMATCH", "Devin Local ACP cannot serve another provider");
  if (configured === "opencode-server-v2" && !backend) throw new AdapterContractError("OPENCODE_RUNTIME_UNAVAILABLE", "Configured OpenCode Server requires its owning execution host");
  if (configured === "opencode-server-v2" && backend?.backendId !== configured) throw new AdapterContractError("BACKEND_MISMATCH", "Configured OpenCode native host returned a different backend");
  if (backend?.backendId === "opencode-server-v2") {
    if (profile.provider !== "opencode") throw new AdapterContractError("BACKEND_MISMATCH", "OpenCode Server cannot serve another provider");
    if (!configured) throw new AdapterContractError("NATIVE_INTERACTION_REQUIRED", "OpenCode Server requires explicit applied native configuration");
  }
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
