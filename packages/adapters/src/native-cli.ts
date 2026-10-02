import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AdapterManifest } from "./contracts.js";
import type { SessionStore } from "./generic.js";
import {
  StructuredCliAdapter, normalizeCliError,
  type CliAgentBackend, type CliAgentProfile, type CliDiscoveryResult,
  type CliProviderDefinition, type CredentialResolver, type NormalizedCliEvent,
} from "./ecosystem-cli.js";

const execFileAsync = promisify(execFile);
export type NativeCliProvider = "opencode" | "grok" | "pi" | "antigravity" | "zcode" | "workbuddy-cli" | "qoder-cn";
export function isNativeCliProvider(provider: string): provider is NativeCliProvider {
  return ["opencode", "grok", "pi", "antigravity", "zcode", "workbuddy-cli", "qoder-cn"].includes(provider);
}

function manifest(id: NativeCliProvider, displayName: string, credential = false): AdapterManifest {
  return {
    apiVersion: 1, id, displayName, platforms: ["darwin", "linux", "win32"],
    configSchema: {
      type: "object", additionalProperties: false, required: ["id", "alias"],
      properties: {
        id: { type: "string", minLength: 1, pattern: "^[a-z0-9][a-z0-9._-]*$" },
        alias: { type: "string", minLength: 1 }, runnerId: { type: "string", default: "local" },
        executable: { type: "string", minLength: 1, description: "Optional explicit CLI path; otherwise use the known local installation or PATH." },
        ...(id === "qoder-cn" ? { configDir: { type: "string", minLength: 1, description: "Native Qoder CN account configuration directory" } } : {}),
        ...(id !== "zcode" ? { model: { type: "string", minLength: 1, description: id === "grok" ? "Grok model ID" : "provider/model; omit to use the CLI default" } } : {}),
        ...(credential ? { credentialRef: { type: "string", pattern: "^secret://grok/" } } : {}),
        ...(id === "opencode" || id === "grok" ? { approveTools: { type: "boolean", default: false, title: "Unattended native tool approval", description: "Explicitly approve native tools for this trusted worktree. Grok approves all tools; OpenCode retains explicitly denied permissions." } } : {}),
      },
    },
    uiSchema: credential ? { credentialRef: { "ui:widget": "hidden" } } : {},
    secretFields: credential ? ["credentialRef"] : [],
    probes: [
      { id: `${id}-version`, kind: "command", description: "Read installed CLI version", timeoutMs: 3_000 },
      { id: `${id}-headless`, kind: "capability", description: "Verify native JSON and explicit-session flags", timeoutMs: 3_000 },
      ...(id === "pi" ? [{ id: "pi-auth", kind: "auth" as const, description: "Check selected model readiness without refreshing or exporting credentials", timeoutMs: 5_000 }] : []),
    ],
    backends: [{ id: `${id}-cli-json`, kind: "headless-cli", priority: 10, capabilities: ["code", "git", "start", "send", "resume", "status", "cancel", "result", "structured-events", "artifacts"] }],
    capabilities: { pause: false, resume: true, usage: true, diagnostics: true },
  };
}

export const opencodeManifest = manifest("opencode", "OpenCode v2");
export const grokManifest = manifest("grok", "Grok Build", true);
export const piManifest = manifest("pi", "pi coding agent");
export const antigravityManifest = manifest("antigravity", "Antigravity CLI");
export const zcodeManifest = manifest("zcode", "ZCode CLI");
export const workbuddyCliManifest = manifest("workbuddy-cli", "WorkBuddy bundled CLI");
export const qoderCnManifest = manifest("qoder-cn", "Qoder CN CLI");

async function executable(provider: NativeCliProvider, profile: CliAgentProfile): Promise<string> {
  if (profile.executable) return profile.executable;
  const paths = provider === "opencode" && process.platform === "darwin"
    ? ["/Applications/OpenCode.app/Contents/Resources/opencode-cli"]
    : provider === "grok" ? [join(homedir(), ".grok", "bin", "grok")]
    : ["antigravity", "zcode", "workbuddy-cli", "qoder-cn"].includes(provider) ? [join(homedir(), ".local", "bin", provider === "antigravity" ? "agy" : provider === "qoder-cn" ? "qoderclicn" : provider)] : [];
  for (const path of paths) {
    try { await access(path); return path; } catch { /* Try the next declared location. */ }
  }
  return provider;
}

const definitions: Record<NativeCliProvider, CliProviderDefinition> = {
  antigravity: {
    manifest: antigravityManifest, defaultExecutable: "agy", versionArgs: ["--version"], authArgs: [],
    supportsResume: true, strictLifecycle: true, requireExecutionEvidence: true, resolveExecutable: (profile) => executable("antigravity", profile), normalizeLine: normalizeAntigravityLine,
    startArgs: ({ prompt, model, providerSessionId }) => ["--output-format", "stream-json", "--mode", "accept-edits", ...(model ? ["--model", model] : []), ...(providerSessionId ? ["--conversation", providerSessionId] : []), "--print", prompt],
  },
  zcode: {
    manifest: zcodeManifest, defaultExecutable: "zcode", versionArgs: ["--version"], authArgs: [],
    supportsResume: true, strictLifecycle: true, requireExecutionEvidence: true, resolveExecutable: (profile) => executable("zcode", profile), normalizeLine: normalizeZCodeLine,
    startArgs: ({ prompt, providerSessionId }) => ["--json", "--mode", "edit", ...(providerSessionId ? ["--resume", providerSessionId] : []), "--prompt", prompt],
  },
  "workbuddy-cli": {
    manifest: workbuddyCliManifest, defaultExecutable: "workbuddy-cli", versionArgs: ["--version"], authArgs: [],
    supportsResume: true, strictLifecycle: true, requireExecutionEvidence: true, newSessionId: randomUUID, resolveExecutable: (profile) => executable("workbuddy-cli", profile), normalizeLine: normalizeWorkBuddyLine,
    startArgs: ({ prompt, model, providerSessionId, newSession }) => ["--print", "--output-format", "stream-json", "--permission-mode", "acceptEdits", ...(model ? ["--model", model] : []), ...(providerSessionId ? [newSession ? "--session-id" : "--resume", providerSessionId] : []), "--", prompt],
  },
  "qoder-cn": {
    manifest: qoderCnManifest, defaultExecutable: "qoderclicn", versionArgs: ["--version"], authArgs: [],
    supportsResume: true, strictLifecycle: true, requireExecutionEvidence: true, newSessionId: randomUUID, resolveExecutable: (profile) => executable("qoder-cn", profile), normalizeLine: normalizeWorkBuddyLine,
    startArgs: ({ prompt, model, providerSessionId, newSession, configDir }) => ["--print", "--output-format", "stream-json", "--permission-mode", "accept_edits", ...(configDir ? ["--config-dir", configDir] : []), ...(model ? ["--model", model] : []), ...(providerSessionId ? [newSession ? "--session-id" : "--resume", providerSessionId] : []), "--", prompt],
  },
  opencode: {
    manifest: opencodeManifest, defaultExecutable: "opencode", versionArgs: ["--version"], authArgs: [],
    supportsResume: true, strictLifecycle: true, requireExecutionEvidence: true, resolveExecutable: (profile) => executable("opencode", profile), normalizeLine: normalizeOpenCodeLine,
    // v2's private server is owned by this child, so cancellation cannot strand a shared-service run.
    startArgs: ({ prompt, model, providerSessionId, approveTools }) => ["run", "--standalone", "--format", "json", ...(approveTools ? ["--auto"] : []), ...(model ? ["--model", model] : []), ...(providerSessionId ? ["--session", providerSessionId] : []), "--", prompt],
  },
  grok: {
    manifest: grokManifest, defaultExecutable: "grok", versionArgs: ["--version"], authArgs: [], environmentKey: "XAI_API_KEY",
    supportsResume: true, strictLifecycle: true, requireExecutionEvidence: true, newSessionId: randomUUID, resolveExecutable: (profile) => executable("grok", profile), normalizeLine: normalizeGrokLine,
    startArgs: ({ prompt, model, providerSessionId, newSession, approveTools }) => ["--output-format", "streaming-messages-json", ...(approveTools ? ["--always-approve"] : []), ...(model ? ["--model", model] : []), ...(providerSessionId ? [newSession ? "--session-id" : "--resume", providerSessionId] : []), `--single=${prompt}`],
  },
  pi: {
    manifest: piManifest, defaultExecutable: "pi", versionArgs: ["--version"], authArgs: [],
    supportsResume: true, strictLifecycle: true, requireExecutionEvidence: true, newSessionId: randomUUID, resolveExecutable: (profile) => executable("pi", profile), normalizeLine: normalizePiLine,
    startArgs: ({ prompt, model, providerSessionId, newSession }) => ["--print", "--mode", "json", ...(model ? ["--model", model] : []), ...(providerSessionId ? [newSession ? "--session-id" : "--session", providerSessionId] : []), "--", prompt],
  },
};

export class OpenCodeAdapter extends StructuredCliAdapter {
  constructor(profile: CliAgentProfile, backend?: CliAgentBackend, store?: SessionStore) { super(definitions.opencode, profile, backend, store); }
}
export class GrokAdapter extends StructuredCliAdapter {
  constructor(profile: CliAgentProfile, backend?: CliAgentBackend, store?: SessionStore, resolveCredential?: CredentialResolver) { super(definitions.grok, profile, backend, store, resolveCredential); }
}
export class PiAdapter extends StructuredCliAdapter {
  constructor(profile: CliAgentProfile, backend?: CliAgentBackend, store?: SessionStore) { super(definitions.pi, profile, backend, store); }
}

export class AntigravityAdapter extends StructuredCliAdapter {
  constructor(profile: CliAgentProfile, backend?: CliAgentBackend, store?: SessionStore) { super(definitions.antigravity, profile, backend, store); }
}
export class ZCodeAdapter extends StructuredCliAdapter {
  constructor(profile: CliAgentProfile, backend?: CliAgentBackend, store?: SessionStore) { super(definitions.zcode, profile, backend, store); }
}
export class WorkBuddyCliAdapter extends StructuredCliAdapter {
  constructor(profile: CliAgentProfile, backend?: CliAgentBackend, store?: SessionStore) { super(definitions["workbuddy-cli"], profile, backend, store); }
}
export class QoderCnAdapter extends StructuredCliAdapter {
  constructor(profile: CliAgentProfile, backend?: CliAgentBackend, store?: SessionStore) { super(definitions["qoder-cn"], profile, backend, store); }
}

export interface NativeCliDiscoveryResult extends CliDiscoveryResult {
  compatible: boolean;
  authentication: "unknown" | "ready" | "missing";
}

export async function probeNativeCliProfile(provider: NativeCliProvider, profile: CliAgentProfile): Promise<NativeCliDiscoveryResult> {
  const file = await executable(provider, profile);
  const base: NativeCliDiscoveryResult = { executable: file, installed: false, compatible: false, authenticated: false, authentication: "unknown" };
  try {
    const version = await execFileAsync(file, ["--version"], { timeout: 3_000, maxBuffer: 32_768 });
    base.installed = true;
    base.version = version.stdout.trim().slice(0, 120);
  } catch { return { ...base, diagnostic: "CLI version probe failed; check the installed executable." }; }
  try {
    const help = await execFileAsync(file, provider === "opencode" ? ["run", "--help"] : ["--help"], { timeout: 3_000, maxBuffer: 65_536 });
    const output = help.stdout + help.stderr;
    base.compatible = provider === "opencode" ? /--standalone/.test(output) && /--format/.test(output) && /--session/.test(output)
      : provider === "grok" ? /streaming-messages-json/.test(output) && /--session-id/.test(output) && /--resume/.test(output)
       : provider === "pi" ? /--session-id/.test(output) && /--mode/.test(output) && /json/.test(output)
      : provider === "antigravity" ? /--conversation/.test(output) && /stream-json/.test(output) && /--print/.test(output)
      : provider === "zcode" ? /--resume/.test(output) && /--json/.test(output) && /--prompt/.test(output) && /--mode/.test(output)
      : /--session-id/.test(output) && /--resume/.test(output) && /--output-format/.test(output) && /--permission-mode/.test(output);
    if (!base.compatible) return { ...base, diagnostic: "Installed CLI lacks the required native JSON/session flags. OpenCode requires v2." };
  } catch { return { ...base, diagnostic: "CLI capability probe failed." }; }
  if (provider === "pi" && profile.model) {
    try {
      const auth = await execFileAsync(file, ["auth", "check", "--model", profile.model, "--json", "--no-refresh"], { timeout: 5_000, maxBuffer: 32_768 });
      const value: unknown = JSON.parse(auth.stdout);
      if (object(value)?.status === "ready") return { ...base, authenticated: true, authentication: "ready" };
      return { ...base, authentication: "missing", diagnostic: "Selected pi model is not ready; authenticate in the native CLI." };
    } catch { return { ...base, diagnostic: "pi authentication check failed; login or refresh in the native CLI." }; }
  }
  return { ...base, diagnostic: "Native JSON/session flags verified. Authentication is unverified until a model invocation succeeds." };
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function parse(line: string): Record<string, unknown> | undefined {
  try { return object(JSON.parse(line)); } catch { return undefined; }
}
function text(value: unknown): string | undefined { return typeof value === "string" && value ? value : undefined; }
function content(value: unknown): string | undefined {
  if (typeof value === "string") return value.slice(0, 2_000);
  if (!Array.isArray(value)) return undefined;
  const result = value.map(object).filter((item) => item?.type === "text").map((item) => text(item?.text) ?? "").join("\n");
  return result ? result.slice(0, 2_000) : undefined;
}
function activity(summary: string, providerSessionId?: string, executionEvidence = false): NormalizedCliEvent {
  return { type: "activity", summary: summary.slice(0, 2_000), ...(providerSessionId ? { providerSessionId } : {}), ...(executionEvidence ? { executionEvidence: true as const } : {}) };
}
function error(message: string, status?: number): NormalizedCliEvent {
  if (status === 402 || /requires more credits|can only afford|insufficient.*balance/i.test(message)) return { type: "resource", state: "QUOTA_EXHAUSTED", reason: message.slice(0, 1_000), source: "error", confidence: "high" };
  if (status === 401 || status === 403 || /invalid.*(?:api.?key|token)|authentication|unauthorized/i.test(message)) return { type: "resource", state: "AUTH_ERROR", reason: message.slice(0, 1_000), source: "error", confidence: "high" };
  if (status === 429) return { type: "resource", state: "RATE_LIMITED", reason: message.slice(0, 1_000), source: "error", confidence: "high" };
  return normalizeCliError(message) ?? { type: "failure", reason: "Provider failed without a diagnostic" };
}

export function normalizeOpenCodeLine(line: string): NormalizedCliEvent | undefined {
  const value = parse(line);
  if (!value) return undefined;
  const sessionId = text(value.sessionID) ?? text(value.sessionId);
  if (value.type === "error") {
    const detail = object(value.error);
    const data = object(detail?.data);
    return error(text(data?.message) ?? text(detail?.message) ?? text(value.message) ?? text(detail?.name) ?? "OpenCode failed", typeof data?.statusCode === "number" ? data.statusCode : undefined);
  }
  const part = object(value.part);
  if (value.type === "text" && text(part?.text)) return activity(String(part!.text), sessionId, true);
  if (value.type === "step_start" && sessionId) return activity("OpenCode turn started", sessionId);
  return undefined;
}

export function normalizeGrokLine(line: string): NormalizedCliEvent | undefined {
  const value = parse(line);
  if (!value) return undefined;
  const sessionId = text(value.session_id);
  if (value.type === "result") {
    const result = text(value.result);
    if (value.is_error === true) return error(result ?? (Array.isArray(value.errors) ? value.errors.map(String).join("; ") : "Grok failed"));
    if (result || value.is_error === false || value.subtype === "success") return activity(result ?? "Grok turn completed", sessionId, true);
  }
  if (value.type === "assistant") {
    const summary = content(object(value.message)?.content);
    if (summary) return activity(summary, sessionId, true);
  }
  if (value.type === "system" && value.subtype === "init" && sessionId) return activity("Grok turn started", sessionId);
  if (value.type === "error") return error(text(value.message) ?? "Grok failed");
  return undefined;
}

export function normalizePiLine(line: string): NormalizedCliEvent | undefined {
  const value = parse(line);
  if (!value) return undefined;
  if (value.type === "session" && text(value.id)) return activity("pi turn started", String(value.id));
  if (value.type === "message_end") {
    const message = object(value.message);
    if (message?.role !== "assistant") return undefined;
    if (message.stopReason === "error" || message.stopReason === "aborted") return error(text(message.errorMessage) ?? `pi request ${String(message.stopReason)}`);
    const summary = content(message.content);
    if (summary || message.stopReason === "stop") return activity(summary ?? "pi turn completed", undefined, true);
  }
  return undefined;
}


export function normalizeWorkBuddyLine(line: string): NormalizedCliEvent | undefined {
  const event = normalizeGrokLine(line);
  return event?.type === "activity" && event.summary === "Grok turn started" ? { ...event, summary: "Native CLI turn started" } : event;
}

export function normalizeAntigravityLine(line: string): NormalizedCliEvent | undefined {
  const value = parse(line);
  if (!value) return undefined;
  if (value.event === "init" && text(value.conversation_id)) return activity("Antigravity turn started", String(value.conversation_id));
  if (value.event === "result") {
    const result = object(value.result);
    const response = text(result?.response);
    if (Array.isArray(result?.denied_actions) && result.denied_actions.length > 0) {
      return error("Antigravity native permission denied one or more requested actions");
    }
    if (result?.status !== "SUCCESS") {
      const detail = object(result?.error);
      return error(text(result?.error) ?? text(detail?.message) ?? response ?? `Antigravity result ${String(result?.status ?? "missing")}`);
    }
    return activity(response ?? "Antigravity turn completed", text(result.conversation_id), true);
  }
  if (value.event === "error") return error(text(value.error) ?? text(value.message) ?? "Antigravity failed");
  return undefined;
}

export function normalizeZCodeLine(line: string): NormalizedCliEvent | undefined {
  const value = parse(line);
  if (!value) return undefined;
  if (value.type === "result") {
    const status = text(object(value.projection)?.status)?.toLowerCase();
    if (status === "failed" || status === "error" || status === "cancelled") return error(text(value.response) ?? `ZCode ${status}`);
    const response = text(value.response);
    if (response && text(value.sessionId)) return activity(response, String(value.sessionId), true);
  }
  if (value.type === "error") return error(text(value.message) ?? "ZCode failed");
  return undefined;
}
