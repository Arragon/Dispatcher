import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
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

export interface QoderProfileConfig {
  id: string;
  alias: string;
  executable?: string;
  configDir?: string;
  model?: string;
}

export interface QoderDiscoveryResult {
  candidates: Array<{ executable: string; version?: string; authenticated: boolean; backends: string[]; diagnostic?: string }>;
  selected?: { executable: string; version?: string; authenticated: boolean; backends: string[]; diagnostic?: string };
}

export type NormalizedQoderEvent =
  | { type: "activity"; summary: string }
  | { type: "waiting"; reason: string }
  | { type: "resource"; state: "RATE_LIMITED" | "QUOTA_EXHAUSTED" | "AUTH_ERROR" | "PROVIDER_DOWN" | "UNKNOWN"; reason: string; remaining?: number; resetsAt?: string; source: "event" | "error" | "probe"; confidence: "high" | "medium" | "low" }
  | { type: "failure"; reason: string };

export const qoderManifest: AdapterManifest = {
  apiVersion: 1,
  id: "qoder",
  displayName: "Qoder",
  platforms: ["darwin", "linux", "win32"],
  configSchema: {
    type: "object",
    additionalProperties: false,
    required: ["id", "alias"],
    properties: {
      id: { type: "string", minLength: 1, pattern: "^[a-z0-9][a-z0-9._-]*$" },
      alias: { type: "string", minLength: 1 },
      runnerId: { type: "string", minLength: 1, default: "local" },
      executable: { type: "string", minLength: 1, default: "qoder" },
      configDir: { type: "string", minLength: 1 },
      model: { type: "string", minLength: 1 },
    },
  },
  uiSchema: {},
  secretFields: [],
  probes: [
    { id: "qoder-version", kind: "command", description: "Read Qoder CLI version", timeoutMs: 3_000 },
    { id: "qoder-auth", kind: "auth", description: "List models using the configured Qoder account", timeoutMs: 8_000 },
    { id: "qoder-session", kind: "capability", description: "Confirm explicit session-id and resume flags", timeoutMs: 3_000 },
  ],
  backends: [{ id: "qoder-cli-json", kind: "headless-cli", priority: 1, capabilities: ["code", "git", "start", "resume", "send", "status", "cancel", "result", "usage", "credits", "artifacts"] }],
  capabilities: { pause: false, resume: true, usage: true, diagnostics: true },
};

export interface QoderTurnResult {
  state: "completed" | "cancelled" | "failed" | "waiting";
  summary: string;
  events: NormalizedQoderEvent[];
}

export interface QoderTurn {
  cancel(): Promise<void>;
  status(): "running" | "completed";
  result(): Promise<QoderTurnResult>;
}

export interface QoderBackend {
  start(input: { executable: string; workspacePath: string; prompt: string; providerSessionId: string; resume: boolean; configDir?: string; model?: string }): QoderTurn;
}

export class QoderCliBackend implements QoderBackend {
  start(input: { executable: string; workspacePath: string; prompt: string; providerSessionId: string; resume: boolean; configDir?: string; model?: string }): QoderTurn {
    const session = input.resume ? ["--resume", input.providerSessionId] : ["--session-id", input.providerSessionId];
    const args = ["--print", "--output-format", "stream-json", "--permission-mode", "accept_edits", "--cwd", input.workspacePath, ...session];
    if (input.configDir) args.push("--config-dir", input.configDir);
    if (input.model) args.push("--model", input.model);
    args.push("--", input.prompt);
    return new SpawnedQoderTurn(spawn(input.executable, args, { cwd: input.workspacePath, shell: false, stdio: ["ignore", "pipe", "pipe"] }));
  }
}

class SpawnedQoderTurn implements QoderTurn {
  private completed = false;
  private cancelled = false;
  private readonly outcome: Promise<QoderTurnResult>;
  constructor(private readonly child: ChildProcess) {
    let stdout = "";
    let stderr = "";
    const events: NormalizedQoderEvent[] = [];
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = (stdout + chunk.toString("utf8")).slice(-131_072);
      const lines = stdout.split("\n");
      stdout = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const normalized = normalizeQoderEvent(JSON.parse(line) as Record<string, unknown>);
          if (normalized) events.push(normalized);
        } catch {
          events.push({ type: "activity", summary: line.slice(0, 1_000) });
        }
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-16_384); });
    this.outcome = new Promise((resolve) => {
      child.on("error", (error) => { stderr = error.message; });
      child.on("close", (code) => {
        this.completed = true;
        const error = normalizeQoderError(stderr);
        if (error) events.push(error);
        const waiting = events.findLast((event) => event.type === "waiting");
        const lastActivity = events.findLast((event) => event.type === "activity");
        resolve({
          state: this.cancelled ? "cancelled" : waiting ? "waiting" : code === 0 ? "completed" : "failed",
          summary: lastActivity?.summary ?? waiting?.reason ?? (code === 0 ? "Qoder completed" : "Qoder failed"),
          events,
        });
      });
    });
  }
  async cancel(): Promise<void> { if (!this.completed) { this.cancelled = true; this.child.kill("SIGTERM"); } await this.outcome; }
  status(): "running" | "completed" { return this.completed ? "completed" : "running"; }
  result(): Promise<QoderTurnResult> { return this.outcome; }
}

export class QoderAdapter implements AgentAdapter {
  readonly manifest = validateManifest(qoderManifest);
  private readonly turns = new Map<string, QoderTurn>();
  constructor(readonly profile: QoderProfileConfig, private readonly backend: QoderBackend = new QoderCliBackend(), private readonly store: SessionStore = new MemorySessionStore()) {}

  async start(input: { runId: string; workspacePath: string; backendId?: string; prompt?: string }): Promise<AdapterSession> {
    const now = new Date().toISOString();
    const providerSessionId = randomUUID();
    const session: AdapterSession = { id: randomUUID(), runId: input.runId, backendId: input.backendId ?? "qoder-cli-json", workspacePath: input.workspacePath, state: "RUNNING", profileId: this.profile.id, providerSessionId, createdAt: now, updatedAt: now };
    this.turns.set(session.id, this.backend.start({ executable: this.profile.executable ?? "qoder", workspacePath: input.workspacePath, prompt: input.prompt ?? "Inspect the task context and report readiness.", providerSessionId, resume: false, ...(this.profile.configDir ? { configDir: this.profile.configDir } : {}), ...(this.profile.model ? { model: this.profile.model } : {}) }));
    this.store.save(session);
    return structuredClone(session);
  }
  async send(sessionId: string, message: string): Promise<AdapterEvent> {
    const session = await this.finish(sessionId);
    if (!session.providerSessionId) throw new AdapterContractError("SESSION_NOT_RESUMABLE", "Qoder session identity is missing");
    this.turns.set(sessionId, this.backend.start({ executable: this.profile.executable ?? "qoder", workspacePath: session.workspacePath, prompt: message, providerSessionId: session.providerSessionId, resume: true, ...(this.profile.configDir ? { configDir: this.profile.configDir } : {}), ...(this.profile.model ? { model: this.profile.model } : {}) }));
    this.store.save({ ...session, state: "RUNNING", updatedAt: new Date().toISOString() });
    return { type: "session.message", sessionId, occurredAt: new Date().toISOString(), data: { acceptedCharacters: message.length, providerSessionId: session.providerSessionId } };
  }
  async pause(): Promise<AdapterSession> { throw new AdapterContractError("UNSUPPORTED_CAPABILITY", "Qoder print mode cannot pause a live turn"); }
  async resume(sessionId: string): Promise<AdapterSession> { await this.send(sessionId, "Continue from the existing task context."); return this.status(sessionId); }
  async cancel(sessionId: string): Promise<AdapterSession> { await this.turns.get(sessionId)?.cancel(); return this.update(sessionId, { state: "CANCELLED" }); }
  async status(sessionId: string): Promise<AdapterSession> { const session = this.require(sessionId); const turn = this.turns.get(sessionId); return !turn || turn.status() === "running" ? structuredClone(session) : this.finish(sessionId); }
  async result(sessionId: string): Promise<AdapterResult> { const session = await this.finish(sessionId); const result = await this.turns.get(sessionId)?.result(); return { sessionId, state: session.state, summary: result?.summary ?? `Qoder session ${session.state.toLowerCase()}`, artifacts: [] }; }
  async usage(sessionId: string): Promise<Record<string, unknown>> { const result = await this.turns.get(sessionId)?.result(); return result?.events.filter((event) => event.type === "resource").at(-1) ?? { state: "UNKNOWN", source: "probe", confidence: "low" }; }
  async diagnostics(sessionId: string): Promise<Record<string, unknown>> { const session = this.require(sessionId); return { sessionId, profileId: session.profileId, alias: this.profile.alias, providerSessionId: session.providerSessionId, attached: this.turns.has(sessionId), resumable: true }; }

  private async finish(sessionId: string): Promise<AdapterSession> {
    const session = this.require(sessionId);
    if (session.state === "CANCELLED") return structuredClone(session);
    const turn = this.turns.get(sessionId);
    if (!turn) return structuredClone(session);
    const result = await turn.result();
    return this.update(sessionId, { state: result.state === "completed" ? "COMPLETED" : result.state === "cancelled" ? "CANCELLED" : result.state === "waiting" ? "PAUSED" : "FAILED" });
  }
  private require(id: string): AdapterSession { const session = this.store.load(id); if (!session) throw new AdapterContractError("SESSION_NOT_FOUND", `Unknown session ${id}`); return session; }
  private update(id: string, changes: Partial<AdapterSession>): AdapterSession { const updated = { ...this.require(id), ...changes, updatedAt: new Date().toISOString() }; this.store.save(updated); return structuredClone(updated); }
}

const defaultQoderCandidates = ["qoder", join(homedir(), ".qoder", "entry", "qoder"), "/Applications/Qoder.app/Contents/MacOS/qoder"];

export async function probeQoderProfile(profile: QoderProfileConfig): Promise<QoderDiscoveryResult> {
  const executables = [...new Set([profile.executable, ...defaultQoderCandidates].filter((value): value is string => Boolean(value)))];
  const candidates: QoderDiscoveryResult["candidates"] = [];
  for (const executable of executables) {
    if (executable.includes("/")) { try { await access(executable); } catch { continue; } }
    let version: string;
    try { version = (await execFileAsync(executable, ["--version"], { timeout: 3_000 })).stdout.trim(); } catch { continue; }
    try {
      const result = await execFileAsync(executable, ["--list-models", ...(profile.configDir ? ["--config-dir", profile.configDir] : [])], { timeout: 8_000, maxBuffer: 256 * 1024 });
      const diagnostic = qoderAuthenticationDiagnostic(`${result.stdout}\n${result.stderr}`);
      candidates.push({ executable, version, authenticated: !diagnostic, backends: ["qoder-cli-json"], ...(diagnostic ? { diagnostic } : {}) });
    } catch (error) {
      candidates.push({ executable, version, authenticated: false, backends: ["qoder-cli-json"], diagnostic: error instanceof Error ? error.message.slice(0, 240) : "Qoder authentication is required" });
    }
  }
  return { candidates, ...(candidates.length === 1 ? { selected: candidates[0] } : profile.executable ? { selected: candidates.find((candidate) => candidate.executable === profile.executable) } : {}) };
}

export function qoderAuthenticationDiagnostic(output: string): string | undefined {
  const normalized = output.trim();
  if (!normalized) return undefined;
  return /not logged in|log(?:ged)?\s+in.*authenticate|login\s+(?:is\s+)?required|authentication\s+required/i.test(normalized)
    ? normalized.slice(0, 240)
    : undefined;
}

export function normalizeQoderEvent(event: Record<string, unknown>): NormalizedQoderEvent | undefined {
  const type = String(event.type ?? event.event ?? "").toLowerCase();
  const message = String(event.message ?? event.text ?? event.summary ?? "");
  if (type.includes("approval") || type.includes("input_required") || type.includes("waiting")) return { type: "waiting", reason: message || type };
  if (type.includes("usage") || type.includes("credit") || type.includes("quota") || type.includes("rate_limit")) {
    const remaining = typeof event.remaining === "number" ? event.remaining : typeof event.credits_remaining === "number" ? event.credits_remaining : undefined;
    return { type: "resource", state: remaining === 0 || type.includes("quota") ? "QUOTA_EXHAUSTED" : type.includes("rate_limit") ? "RATE_LIMITED" : "UNKNOWN", reason: message || type, ...(remaining === undefined ? {} : { remaining }), ...(typeof event.resets_at === "string" ? { resetsAt: event.resets_at } : {}), source: "event", confidence: "high" };
  }
  if (type.includes("error") || type.includes("failed")) return normalizeQoderError(message || type);
  if (message || type.includes("assistant") || type.includes("result")) return { type: "activity", summary: (message || type).slice(0, 2_000) };
  return undefined;
}

export function normalizeQoderError(message: string): NormalizedQoderEvent | undefined {
  if (!message.trim()) return undefined;
  const lower = message.toLowerCase();
  if (/quota|credit.*exhaust|insufficient credit/.test(lower)) return { type: "resource", state: "QUOTA_EXHAUSTED", reason: message.slice(0, 1_000), source: "error", confidence: "high" };
  if (/rate.?limit|too many requests/.test(lower)) return { type: "resource", state: "RATE_LIMITED", reason: message.slice(0, 1_000), source: "error", confidence: "high" };
  if (/unauth|login|required|forbidden/.test(lower)) return { type: "resource", state: "AUTH_ERROR", reason: message.slice(0, 1_000), source: "error", confidence: "high" };
  if (/unavailable|econn|network|timeout/.test(lower)) return { type: "resource", state: "PROVIDER_DOWN", reason: message.slice(0, 1_000), source: "error", confidence: "medium" };
  return { type: "failure", reason: message.slice(0, 1_000) };
}
