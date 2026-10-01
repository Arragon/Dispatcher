import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import {
  AdapterContractError,
  validateManifest,
  type AdapterEvent,
  type AdapterManifest,
  type AdapterResult,
  type AdapterSession,
  type AgentAdapter,
} from "./contracts.js";
import { MemorySessionStore, type SessionStore } from "./generic.js";

const execFileAsync = promisify(execFile);

export interface CliAgentProfile {
  id: string;
  alias: string;
  executable?: string;
  credentialRef?: string;
  model?: string;
  approveTools?: boolean;
}

export interface CliDiscoveryResult {
  executable: string;
  installed: boolean;
  authenticated: boolean;
  version?: string;
  diagnostic?: string;
}

export type NormalizedCliEvent =
  | { type: "activity"; summary: string; providerSessionId?: string }
  | { type: "waiting"; reason: string }
  | { type: "resource"; state: "RATE_LIMITED" | "QUOTA_EXHAUSTED" | "AUTH_ERROR" | "PROVIDER_DOWN" | "UNKNOWN"; reason: string; remaining?: number; resetsAt?: string; source: "event" | "error"; confidence: "high" | "medium" | "low" }
  | { type: "failure"; reason: string };
type CliErrorEvent = Extract<NormalizedCliEvent, { type: "resource" | "failure" }>;

export interface CliTurnResult {
  state: "completed" | "cancelled" | "failed" | "waiting";
  summary: string;
  events: NormalizedCliEvent[];
  providerSessionId?: string;
}

export interface CliTurn {
  cancel(): Promise<void>;
  status(): "running" | "completed";
  result(): Promise<CliTurnResult>;
  events?(): NormalizedCliEvent[];
}

export interface CliStartInput {
  executable: string;
  args: string[];
  workspacePath: string;
  environment?: Record<string, string>;
  normalizeLine?: (line: string) => NormalizedCliEvent | undefined;
}

export interface CliAgentBackend {
  start(input: CliStartInput): CliTurn;
}

export type CredentialResolver = (reference: string) => Promise<string>;

export class SpawnCliAgentBackend implements CliAgentBackend {
  start(input: CliStartInput): CliTurn {
    return new SpawnedCliTurn(spawn(input.executable, input.args, {
      cwd: input.workspacePath,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...input.environment, PWD: input.workspacePath },
      detached: process.platform !== "win32",
    }), input.normalizeLine ?? normalizeCliLine);
  }
}

class SpawnedCliTurn implements CliTurn {
  private completed = false;
  private cancelled = false;
  private readonly outcome: Promise<CliTurnResult>;
  private readonly retainedEvents: NormalizedCliEvent[] = [];
  private resourceEvent: Extract<NormalizedCliEvent, { type: "resource" }> | undefined;

  constructor(private readonly child: ChildProcess, normalizeLine: (line: string) => NormalizedCliEvent | undefined) {
    let stdout = "";
    let stderr = "";
    let droppingLine = false;
    let failure: Extract<NormalizedCliEvent, { type: "failure" | "resource" }> | undefined;
    let activity: Extract<NormalizedCliEvent, { type: "activity" }> | undefined;
    let waiting: Extract<NormalizedCliEvent, { type: "waiting" }> | undefined;
    let providerSessionId: string | undefined;
    const record = (event: NormalizedCliEvent | undefined): void => {
      if (!event) return;
      this.retainedEvents.push(event);
      if (this.retainedEvents.length > 256) this.retainedEvents.shift();
      if (event.type === "failure" || (event.type === "resource" && event.state !== "UNKNOWN")) failure = event;
      if (event.type === "activity") { activity = event; providerSessionId = event.providerSessionId ?? providerSessionId; }
      if (event.type === "waiting") waiting = event;
      if (event.type === "resource") this.resourceEvent = event;
    };
    this.child.stdout?.setEncoding("utf8");
    this.child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
      const lines = stdout.split("\n");
      stdout = lines.pop() ?? "";
      for (const line of lines) {
        if (!droppingLine && line.length <= 1_048_576) record(normalizeLine(line));
        else if (!droppingLine) record({ type: "failure", reason: "CLI output record exceeds 1 MiB" });
        droppingLine = false;
      }
      if (stdout.length > 1_048_576) { stdout = ""; droppingLine = true; record({ type: "failure", reason: "CLI output record exceeds 1 MiB" }); }
    });
    this.child.stderr?.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-32_768); });
    this.outcome = new Promise((resolve) => {
      child.on("error", (error) => { stderr = error.message; });
      child.on("close", (code) => {
        this.completed = true;
        if (!droppingLine && stdout.trim()) record(normalizeLine(stdout));
        const error = normalizeCliError(stderr);
        if (error && code !== 0) record(error);
        resolve({
          state: this.cancelled ? "cancelled" : failure ? "failed" : waiting ? "waiting" : code === 0 ? "completed" : "failed",
          summary: failure?.reason ?? waiting?.reason ?? activity?.summary ?? error?.reason ?? (code === 0 ? "Agent completed" : `Agent exited with code ${code ?? "unknown"}`),
          events: this.events(),
          ...(providerSessionId ? { providerSessionId } : {}),
        });
      });
    });
  }

  async cancel(): Promise<void> {
    if (!this.completed) {
      this.cancelled = true;
      this.kill("SIGTERM");
    }
    const timer = setTimeout(() => this.kill("SIGKILL"), 2_000);
    try { await this.outcome; } finally { clearTimeout(timer); }
  }
  private kill(signal: NodeJS.Signals): void {
    try {
      if (process.platform !== "win32" && this.child.pid) process.kill(-this.child.pid, signal);
      else this.child.kill(signal);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
  }
  events(): NormalizedCliEvent[] {
    const events = [...this.retainedEvents];
    if (this.resourceEvent && !events.includes(this.resourceEvent)) { events.push(this.resourceEvent); if (events.length > 256) events.shift(); }
    return structuredClone(events);
  }
  status(): "running" | "completed" { return this.completed ? "completed" : "running"; }
  result(): Promise<CliTurnResult> { return this.outcome; }
}

export interface CliProviderDefinition {
  manifest: AdapterManifest;
  defaultExecutable: string;
  versionArgs: string[];
  authArgs: string[];
  environmentKey?: string;
  supportsResume: boolean;
  strictLifecycle?: boolean;
  newSessionId?: () => string;
  resolveExecutable?: (profile: CliAgentProfile) => Promise<string>;
  normalizeLine?: (line: string) => NormalizedCliEvent | undefined;
  startArgs(input: { prompt: string; model?: string; providerSessionId?: string; newSession?: boolean; approveTools?: boolean }): string[];
}

export const cursorManifest: AdapterManifest = {
  apiVersion: 1,
  id: "cursor",
  displayName: "Cursor Agent",
  platforms: ["darwin", "linux", "win32"],
  configSchema: profileSchema("cursor-agent", true),
  uiSchema: { credentialRef: { "ui:widget": "hidden" } },
  secretFields: ["credentialRef"],
  probes: [
    { id: "cursor-version", kind: "command", description: "Read Cursor Agent CLI version", timeoutMs: 3_000 },
    { id: "cursor-auth", kind: "auth", description: "Check Cursor Agent authentication status", timeoutMs: 5_000 },
  ],
  backends: [
    { id: "cursor-local-cli", kind: "headless-cli", priority: 10, capabilities: ["code", "git", "start", "send", "resume", "status", "cancel", "result", "structured-events", "artifacts"] },
  ],
  capabilities: { pause: false, resume: true, usage: true, diagnostics: true },
};

export const kiroManifest: AdapterManifest = {
  apiVersion: 1,
  id: "kiro",
  displayName: "Kiro CLI",
  platforms: ["darwin", "linux", "win32"],
  configSchema: profileSchema("kiro-cli", true),
  uiSchema: { credentialRef: { "ui:widget": "hidden" } },
  secretFields: ["credentialRef"],
  probes: [
    { id: "kiro-version", kind: "command", description: "Read Kiro CLI version", timeoutMs: 3_000 },
    { id: "kiro-auth", kind: "auth", description: "List Kiro models using the active credential", timeoutMs: 8_000 },
    { id: "kiro-headless", kind: "capability", description: "Confirm V3 stream-json headless mode", timeoutMs: 3_000 },
  ],
  backends: [
    { id: "kiro-headless-v3", kind: "headless-cli", priority: 10, capabilities: ["code", "git", "start", "status", "cancel", "result", "structured-events", "artifacts"] },
  ],
  capabilities: { pause: false, resume: false, usage: true, diagnostics: true },
};

const cursorDefinition: CliProviderDefinition = {
  manifest: cursorManifest,
  defaultExecutable: "cursor-agent",
  versionArgs: ["--version"],
  authArgs: ["status"],
  environmentKey: "CURSOR_API_KEY",
  supportsResume: true,
  startArgs: ({ prompt, model, providerSessionId }) => [
    "--print", "--force", "--output-format", "stream-json",
    ...(providerSessionId ? ["--resume", providerSessionId] : []),
    ...(model ? ["--model", model] : []),
    prompt,
  ],
};

const kiroDefinition: CliProviderDefinition = {
  manifest: kiroManifest,
  defaultExecutable: "kiro-cli",
  versionArgs: ["--version"],
  authArgs: ["chat", "--list-models", "--format", "json"],
  environmentKey: "KIRO_API_KEY",
  supportsResume: false,
  startArgs: ({ prompt, model }) => [
    "chat", "--no-interactive", "--agent-engine", "v3", "--output-format", "stream-json",
    "--trust-tools=read,grep,write",
    ...(model ? ["--agent", model] : []),
    prompt,
  ],
};

export class StructuredCliAdapter implements AgentAdapter {
  readonly manifest: AdapterManifest;
  private readonly turns = new Map<string, CliTurn>();
  private readonly backend: CliAgentBackend;
  private readonly store: SessionStore;
  private readonly sending = new Set<string>();

  constructor(
    private readonly definition: CliProviderDefinition,
    readonly profile: CliAgentProfile,
    backend: CliAgentBackend = new SpawnCliAgentBackend(),
    store: SessionStore = new MemorySessionStore(),
    private readonly resolveCredential?: CredentialResolver,
  ) {
    this.manifest = validateManifest(definition.manifest);
    this.backend = backend;
    this.store = store;
  }

  async start(input: { runId: string; workspacePath: string; backendId?: string; prompt?: string }): Promise<AdapterSession> {
    const now = new Date().toISOString();
    const session: AdapterSession = {
      id: randomUUID(),
      runId: input.runId,
      backendId: input.backendId ?? this.manifest.backends[0]!.id,
      workspacePath: input.workspacePath,
      state: "RUNNING",
      profileId: this.profile.id,
      ...(this.definition.newSessionId ? { providerSessionId: this.definition.newSessionId() } : {}),
      createdAt: now,
      updatedAt: now,
    };
    const environment = await this.environment();
    this.turns.set(session.id, this.backend.start({
      executable: await this.executable(),
      args: this.definition.startArgs({ prompt: input.prompt ?? "Inspect the task and report readiness.", newSession: true, approveTools: this.profile.approveTools === true, ...(session.providerSessionId ? { providerSessionId: session.providerSessionId } : {}), ...(this.profile.model ? { model: this.profile.model } : {}) }),
      workspacePath: input.workspacePath,
      ...(this.definition.normalizeLine ? { normalizeLine: this.definition.normalizeLine } : {}),
      ...(environment ? { environment } : {}),
    }));
    this.store.save(session);
    return structuredClone(session);
  }

  async send(sessionId: string, message: string): Promise<AdapterEvent> {
    if (!this.definition.supportsResume) throw new AdapterContractError("UNSUPPORTED_CAPABILITY", `${this.manifest.displayName} headless runs do not accept mid-session input`);
    if (this.definition.strictLifecycle && !this.turns.has(sessionId) && !["COMPLETED", "PAUSED"].includes(this.require(sessionId).state)) throw new AdapterContractError("SESSION_DETACHED", "Active or failed process handles cannot be recovered; use controlled operator recovery");
    if (this.definition.strictLifecycle && (this.turns.get(sessionId)?.status() === "running" || this.sending.has(sessionId))) throw new AdapterContractError("SESSION_BUSY", "Wait for the current CLI turn before sending another message");
    if (this.require(sessionId).state === "CANCELLED") throw new AdapterContractError("SESSION_CANCELLED", "Cancelled sessions cannot accept input");
    this.sending.add(sessionId);
    try {
      const session = await this.finish(sessionId);
      if (!session.providerSessionId) throw new AdapterContractError("SESSION_NOT_RESUMABLE", `${this.manifest.displayName} did not emit a provider session id`);
      const environment = await this.environment();
      const executable = await this.executable();
      if (this.require(sessionId).state === "CANCELLED") throw new AdapterContractError("SESSION_CANCELLED", "Session was cancelled before the next turn started");
      this.turns.set(sessionId, this.backend.start({
        executable,
        args: this.definition.startArgs({ prompt: message, providerSessionId: session.providerSessionId, approveTools: this.profile.approveTools === true, ...(this.profile.model ? { model: this.profile.model } : {}) }),
        workspacePath: session.workspacePath,
        ...(this.definition.normalizeLine ? { normalizeLine: this.definition.normalizeLine } : {}),
        ...(environment ? { environment } : {}),
      }));
      this.store.save({ ...session, state: "RUNNING", updatedAt: new Date().toISOString() });
      return { type: "session.message", sessionId, occurredAt: new Date().toISOString(), data: { acceptedCharacters: message.length, providerSessionId: session.providerSessionId } };
    } finally { this.sending.delete(sessionId); }
  }
  async pause(): Promise<AdapterSession> { throw new AdapterContractError("UNSUPPORTED_CAPABILITY", `${this.manifest.displayName} cannot pause a headless turn`); }
  async resume(sessionId: string): Promise<AdapterSession> {
    if (!this.definition.supportsResume) throw new AdapterContractError("UNSUPPORTED_CAPABILITY", `${this.manifest.displayName} session recovery is not declared for this backend`);
    await this.send(sessionId, "Continue from the existing task context.");
    return this.status(sessionId);
  }
  async cancel(sessionId: string): Promise<AdapterSession> {
    this.update(sessionId, { state: "CANCELLED" });
    await this.turns.get(sessionId)?.cancel();
    return this.update(sessionId, { state: "CANCELLED" });
  }
  async status(sessionId: string): Promise<AdapterSession> {
    const session = this.require(sessionId);
    const turn = this.turns.get(sessionId);
    if (!turn && this.definition.strictLifecycle && session.state === "RUNNING") return this.update(sessionId, { state: "FAILED" });
    return !turn || turn.status() === "running" ? structuredClone(session) : this.finish(sessionId);
  }
  async result(sessionId: string): Promise<AdapterResult> {
    const session = await this.finish(sessionId);
    const result = await this.turns.get(sessionId)?.result();
    return { sessionId, state: session.state, summary: result?.summary ?? `${this.manifest.displayName} session ${session.state.toLowerCase()}`, artifacts: extractArtifacts(result?.summary ?? "") };
  }
  async usage(sessionId: string): Promise<Record<string, unknown>> {
    this.require(sessionId);
    const turn = this.turns.get(sessionId);
    const events = turn?.events ? turn.events() : turn?.status() === "completed" ? (await turn.result()).events : [];
    return events.filter((event) => event.type === "resource").at(-1) ?? { state: "UNKNOWN", reason: "Provider did not emit a resource signal", source: "probe", confidence: "low" };
  }
  async diagnostics(sessionId: string): Promise<Record<string, unknown>> {
    const session = this.require(sessionId);
    return { sessionId, profileId: session.profileId, alias: this.profile.alias, attached: this.turns.has(sessionId), backendId: session.backendId, resumable: this.definition.supportsResume };
  }

  private async environment(): Promise<Record<string, string> | undefined> {
    if (!this.profile.credentialRef) return undefined;
    if (!this.definition.environmentKey || !this.resolveCredential) throw new AdapterContractError("SECRET_RESOLVER_UNAVAILABLE", "Credential references require a SecretStore resolver");
    return { [this.definition.environmentKey]: await this.resolveCredential(this.profile.credentialRef) };
  }
  private executable(): Promise<string> {
    return this.definition.resolveExecutable?.(this.profile) ?? Promise.resolve(this.profile.executable ?? this.definition.defaultExecutable);
  }
  private async finish(sessionId: string): Promise<AdapterSession> {
    const session = this.require(sessionId);
    if (session.state === "CANCELLED") return structuredClone(session);
    const turn = this.turns.get(sessionId);
    if (!turn) return this.definition.strictLifecycle && session.state === "RUNNING" ? this.update(sessionId, { state: "FAILED" }) : structuredClone(session);
    const result = await turn.result();
    if (this.require(sessionId).state === "CANCELLED") return structuredClone(this.require(sessionId));
    return this.update(sessionId, {
      state: result.state === "completed" ? "COMPLETED" : result.state === "cancelled" ? "CANCELLED" : result.state === "waiting" ? "PAUSED" : "FAILED",
      ...(result.providerSessionId ? { providerSessionId: result.providerSessionId } : {}),
    });
  }
  private require(id: string): AdapterSession {
    const session = this.store.load(id);
    if (!session) throw new AdapterContractError("SESSION_NOT_FOUND", `Unknown session ${id}`);
    return session;
  }
  private update(id: string, changes: Partial<AdapterSession>): AdapterSession {
    const updated = { ...this.require(id), ...changes, updatedAt: new Date().toISOString() };
    this.store.save(updated);
    return structuredClone(updated);
  }
}

export class CursorAdapter extends StructuredCliAdapter {
  constructor(profile: CliAgentProfile, backend?: CliAgentBackend, store?: SessionStore, resolveCredential?: CredentialResolver) {
    super(cursorDefinition, profile, backend, store, resolveCredential);
  }
}

export class KiroAdapter extends StructuredCliAdapter {
  constructor(profile: CliAgentProfile, backend?: CliAgentBackend, store?: SessionStore, resolveCredential?: CredentialResolver) {
    super(kiroDefinition, profile, backend, store, resolveCredential);
  }
}

export async function probeCursorProfile(profile: CliAgentProfile, resolveCredential?: CredentialResolver): Promise<CliDiscoveryResult> {
  return probeCliProfile(cursorDefinition, profile, resolveCredential);
}

export async function probeKiroProfile(profile: CliAgentProfile, resolveCredential?: CredentialResolver): Promise<CliDiscoveryResult> {
  return probeCliProfile(kiroDefinition, profile, resolveCredential);
}

async function probeCliProfile(definition: CliProviderDefinition, profile: CliAgentProfile, resolveCredential?: CredentialResolver): Promise<CliDiscoveryResult> {
  const executable = profile.executable ?? definition.defaultExecutable;
  let version: string;
  try { version = (await execFileAsync(executable, definition.versionArgs, { timeout: 3_000 })).stdout.trim(); }
  catch (error) { return { executable, installed: false, authenticated: false, diagnostic: error instanceof Error ? error.message.slice(0, 240) : "Executable not found" }; }
  const environment = { ...process.env };
  if (profile.credentialRef) {
    if (!definition.environmentKey || !resolveCredential) return { executable, installed: true, authenticated: false, version, diagnostic: "Credential reference cannot be resolved in this runtime" };
    environment[definition.environmentKey] = await resolveCredential(profile.credentialRef);
  }
  try {
    const result = await execFileAsync(executable, definition.authArgs, { timeout: 8_000, maxBuffer: 256 * 1024, env: environment });
    const output = `${result.stdout}\n${result.stderr}`;
    const diagnostic = /not authenticated|not logged in|login required|unauthorized|forbidden/i.test(output) ? output.trim().slice(0, 240) : undefined;
    return { executable, installed: true, authenticated: !diagnostic, version, ...(diagnostic ? { diagnostic } : {}) };
  } catch (error) {
    return { executable, installed: true, authenticated: false, version, diagnostic: error instanceof Error ? error.message.slice(0, 240) : "Authentication probe failed" };
  }
}

export function normalizeCliLine(line: string): NormalizedCliEvent | undefined {
  if (!line.trim()) return undefined;
  let value: Record<string, unknown>;
  try { value = JSON.parse(line) as Record<string, unknown>; }
  catch { return { type: "activity", summary: line.slice(0, 2_000) }; }
  const type = String(value.type ?? value.event ?? value.event_type ?? "").toLowerCase();
  const message = String(value.message ?? value.text ?? value.summary ?? value.result ?? "");
  const providerSessionId = stringValue(value.session_id) ?? stringValue(value.sessionId) ?? stringValue(value.chat_id);
  if (/waiting|input_required|approval_required/.test(type)) return { type: "waiting", reason: message || type };
  if (/usage|quota|rate.?limit|credit/.test(type)) {
    const remaining = numberValue(value.remaining) ?? numberValue(value.credits_remaining);
    return {
      type: "resource",
      state: remaining === 0 || /quota|exhaust/.test(type) ? "QUOTA_EXHAUSTED" : /rate.?limit/.test(type) ? "RATE_LIMITED" : "UNKNOWN",
      reason: message || type,
      ...(remaining === undefined ? {} : { remaining }),
      ...(stringValue(value.resets_at) ? { resetsAt: stringValue(value.resets_at)! } : {}),
      source: "event",
      confidence: "high",
    };
  }
  if (/error|failed/.test(type)) return normalizeCliError(message || type);
  return { type: "activity", summary: (message || type || JSON.stringify(value)).slice(0, 2_000), ...(providerSessionId ? { providerSessionId } : {}) };
}

export function normalizeCliError(message: string): CliErrorEvent | undefined {
  if (!message.trim()) return undefined;
  const reason = message.slice(0, 1_000);
  const lower = reason.toLowerCase();
  if (/model unavailable|model not found|unknown model/.test(lower)) return { type: "failure", reason };
  if (/quota|credit.*exhaust|insufficient credit|requires more credits|can only afford/.test(lower)) return { type: "resource", state: "QUOTA_EXHAUSTED", reason, source: "error", confidence: "high" };
  if (/rate.?limit|too many requests/.test(lower)) return { type: "resource", state: "RATE_LIMITED", reason, source: "error", confidence: "high" };
  if (/unauth|not logged in|login required|forbidden|no api key|invalid api.?key/.test(lower)) return { type: "resource", state: "AUTH_ERROR", reason, source: "error", confidence: "high" };
  if (/unavailable|econn|network|timeout/.test(lower)) return { type: "resource", state: "PROVIDER_DOWN", reason, source: "error", confidence: "medium" };
  return { type: "failure", reason };
}

function profileSchema(defaultExecutable: string, includeCredential: boolean): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["id", "alias"],
    properties: {
      id: { type: "string", minLength: 1, pattern: "^[a-z0-9][a-z0-9._-]*$" },
      alias: { type: "string", minLength: 1 },
      runnerId: { type: "string", minLength: 1, default: "local" },
      executable: { type: "string", minLength: 1, default: defaultExecutable },
      model: { type: "string", minLength: 1 },
      ...(includeCredential ? { credentialRef: { type: "string", pattern: "^secret://[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._/-]*$" } } : {}),
    },
  };
}

function stringValue(value: unknown): string | undefined { return typeof value === "string" && value ? value : undefined; }
function numberValue(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function extractArtifacts(summary: string): Array<{ path: string; kind: string }> {
  return [...new Set(summary.match(/https?:\/\/[^\s)]+\/pull\/\d+/g) ?? [])].map((path) => ({ path, kind: "pull-request" }));
}
