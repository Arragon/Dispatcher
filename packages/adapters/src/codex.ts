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

export interface CodexProfileConfig {
  id: string;
  alias: string;
  codexHome: string;
  executable?: string;
  model?: string;
}

export interface CodexDiscoveryResult {
  executable: string;
  version?: string;
  authenticated: boolean;
  profile: { id: string; alias: string };
  diagnostic?: string;
}

export type NormalizedCodexEvent =
  | { type: "activity"; summary: string }
  | { type: "waiting"; reason: string }
  | { type: "resource"; state: "RATE_LIMITED" | "QUOTA_EXHAUSTED" | "AUTH_ERROR" | "PROVIDER_DOWN" | "UNKNOWN"; reason: string; resetsAt?: string; source: "event" | "error"; confidence: "high" | "medium" | "low" }
  | { type: "failure"; reason: string };

export const codexManifest: AdapterManifest = {
  apiVersion: 1,
  id: "codex",
  displayName: "Codex",
  platforms: ["darwin", "linux", "win32"],
  configSchema: {
    type: "object",
    additionalProperties: false,
    required: ["id", "alias", "codexHome"],
    properties: {
      id: { type: "string", minLength: 1, pattern: "^[a-z0-9][a-z0-9._-]*$" },
      alias: { type: "string", minLength: 1 },
      codexHome: { type: "string", minLength: 1 },
      runnerId: { type: "string", minLength: 1, default: "local" },
      executable: { type: "string", minLength: 1, default: "codex" },
      model: { type: "string", minLength: 1 },
    },
  },
  uiSchema: {},
  secretFields: [],
  probes: [
    { id: "codex-version", kind: "command", description: "Read Codex CLI version", timeoutMs: 3_000 },
    { id: "codex-auth", kind: "auth", description: "Check Codex login for this isolated CODEX_HOME", timeoutMs: 5_000 },
  ],
  backends: [{ id: "codex-exec-json", kind: "headless-cli", priority: 1, capabilities: ["start", "resume", "send", "status", "cancel", "result", "usage"] }],
  capabilities: { pause: false, resume: true, usage: true, diagnostics: true },
};

interface CodexTurnResult {
  state: "completed" | "cancelled" | "failed" | "waiting";
  summary: string;
  providerSessionId?: string;
  events: NormalizedCodexEvent[];
}

interface CodexTurn {
  cancel(): Promise<void>;
  status(): "running" | "completed";
  result(): Promise<CodexTurnResult>;
}

export interface CodexBackend {
  start(input: { executable: string; codexHome: string; workspacePath: string; prompt: string; model?: string; providerSessionId?: string }): CodexTurn;
}

export class CodexCliBackend implements CodexBackend {
  start(input: { executable: string; codexHome: string; workspacePath: string; prompt: string; model?: string; providerSessionId?: string }): CodexTurn {
    const common = ["--json", "--skip-git-repo-check"];
    const model = input.model ? ["--model", input.model] : [];
    const args = input.providerSessionId
      ? ["exec", "resume", ...common, ...model, input.providerSessionId, input.prompt]
      : ["exec", ...common, "--sandbox", "workspace-write", ...model, "--cd", input.workspacePath, input.prompt];
    return new SpawnedCodexTurn(spawn(input.executable, args, {
      cwd: input.workspacePath,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CODEX_HOME: input.codexHome },
    }));
  }
}

class SpawnedCodexTurn implements CodexTurn {
  private completed = false;
  private cancelled = false;
  private readonly outcome: Promise<CodexTurnResult>;

  constructor(private readonly child: ChildProcess) {
    let stdout = "";
    let stderr = "";
    let providerSessionId: string | undefined;
    const events: NormalizedCodexEvent[] = [];
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = (stdout + chunk.toString("utf8")).slice(-131_072);
      const lines = stdout.split("\n");
      const tail = lines.pop() ?? "";
      stdout = tail;
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as Record<string, unknown>;
          if (event.type === "thread.started" && typeof event.thread_id === "string") providerSessionId = event.thread_id;
          const normalized = normalizeCodexEvent(event);
          if (normalized) events.push(normalized);
        } catch {
          events.push({ type: "activity", summary: line.slice(0, 500) });
        }
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-16_384); });
    this.outcome = new Promise((resolve) => {
      child.on("error", (error) => {
        stderr = error.message;
      });
      child.on("close", (code) => {
        this.completed = true;
        const normalized = normalizeCodexError(stderr);
        if (normalized) events.push(normalized);
        const last = events.at(-1);
        const waiting = events.findLast((event) => event.type === "waiting");
        resolve({
          state: this.cancelled ? "cancelled" : waiting ? "waiting" : code === 0 ? "completed" : "failed",
          summary: last?.type === "activity" ? last.summary : waiting?.reason ?? (code === 0 ? "Codex completed" : "Codex failed"),
          ...(providerSessionId ? { providerSessionId } : {}),
          events,
        });
      });
    });
  }

  async cancel(): Promise<void> {
    if (this.completed) return;
    this.cancelled = true;
    this.child.kill("SIGTERM");
    await this.outcome;
  }
  status(): "running" | "completed" { return this.completed ? "completed" : "running"; }
  async result(): Promise<CodexTurnResult> { return this.outcome; }
}

export class CodexAdapter implements AgentAdapter {
  readonly manifest = validateManifest(codexManifest);
  private readonly turns = new Map<string, CodexTurn>();

  constructor(
    readonly profile: CodexProfileConfig,
    private readonly backend: CodexBackend = new CodexCliBackend(),
    private readonly store: SessionStore = new MemorySessionStore(),
  ) {}

  async start(input: { runId: string; workspacePath: string; backendId?: string; prompt?: string }): Promise<AdapterSession> {
    const now = new Date().toISOString();
    const session: AdapterSession = {
      id: randomUUID(),
      runId: input.runId,
      backendId: input.backendId ?? "codex-exec-json",
      workspacePath: input.workspacePath,
      state: "RUNNING",
      profileId: this.profile.id,
      createdAt: now,
      updatedAt: now,
    };
    const turn = this.backend.start({
      executable: this.profile.executable ?? "codex",
      codexHome: this.profile.codexHome,
      workspacePath: input.workspacePath,
      prompt: input.prompt ?? "Inspect the task context and report readiness.",
      ...(this.profile.model ? { model: this.profile.model } : {}),
    });
    this.turns.set(session.id, turn);
    this.store.save(session);
    return structuredClone(session);
  }

  async send(sessionId: string, message: string): Promise<AdapterEvent> {
    const session = await this.finishCurrentTurn(sessionId);
    if (!session.providerSessionId) throw new AdapterContractError("SESSION_NOT_RESUMABLE", "Codex did not return a provider session id");
    const turn = this.backend.start({
      executable: this.profile.executable ?? "codex",
      codexHome: this.profile.codexHome,
      workspacePath: session.workspacePath,
      prompt: message,
      providerSessionId: session.providerSessionId,
      ...(this.profile.model ? { model: this.profile.model } : {}),
    });
    this.turns.set(sessionId, turn);
    this.store.save({ ...session, state: "RUNNING", updatedAt: new Date().toISOString() });
    return { type: "session.message", sessionId, occurredAt: new Date().toISOString(), data: { acceptedCharacters: message.length } };
  }
  async pause(): Promise<AdapterSession> { throw new AdapterContractError("UNSUPPORTED_CAPABILITY", "Codex exec does not support pausing a live turn"); }
  async resume(sessionId: string): Promise<AdapterSession> {
    await this.send(sessionId, "Continue from the existing task context.");
    return this.status(sessionId);
  }
  async cancel(sessionId: string): Promise<AdapterSession> {
    const turn = this.turns.get(sessionId);
    if (turn) await turn.cancel();
    return this.update(sessionId, { state: "CANCELLED" });
  }
  async status(sessionId: string): Promise<AdapterSession> {
    const session = this.require(sessionId);
    const turn = this.turns.get(sessionId);
    if (!turn || turn.status() === "running") return structuredClone(session);
    return this.finishCurrentTurn(sessionId);
  }
  async result(sessionId: string): Promise<AdapterResult> {
    const session = await this.finishCurrentTurn(sessionId);
    const result = await this.turns.get(sessionId)?.result();
    return { sessionId, state: session.state, summary: result?.summary ?? `Codex session ${session.state.toLowerCase()}`, artifacts: [] };
  }
  async usage(sessionId: string): Promise<Record<string, unknown>> {
    const result = await this.turns.get(sessionId)?.result();
    const resource = result?.events.filter((event) => event.type === "resource").at(-1);
    return resource ?? { state: "UNKNOWN", source: "event", confidence: "low" };
  }
  async diagnostics(sessionId: string): Promise<Record<string, unknown>> {
    const session = this.require(sessionId);
    return { sessionId, profileId: session.profileId, alias: this.profile.alias, attached: this.turns.has(sessionId), resumable: Boolean(session.providerSessionId) };
  }

  private async finishCurrentTurn(sessionId: string): Promise<AdapterSession> {
    const session = this.require(sessionId);
    const turn = this.turns.get(sessionId);
    if (!turn) return structuredClone(session);
    const result = await turn.result();
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

export async function probeCodexProfile(profile: CodexProfileConfig): Promise<CodexDiscoveryResult> {
  const executable = profile.executable ?? "codex";
  const environment = { ...process.env, CODEX_HOME: profile.codexHome };
  let version: string | undefined;
  try { version = (await execFileAsync(executable, ["--version"], { env: environment, timeout: 3_000 })).stdout.trim(); }
  catch (error) { return { executable, authenticated: false, profile: { id: profile.id, alias: profile.alias }, diagnostic: error instanceof Error ? error.message.slice(0, 240) : "Codex executable unavailable" }; }
  try {
    await execFileAsync(executable, ["login", "status"], { env: environment, timeout: 5_000 });
    return { executable, version, authenticated: true, profile: { id: profile.id, alias: profile.alias } };
  } catch {
    return { executable, version, authenticated: false, profile: { id: profile.id, alias: profile.alias }, diagnostic: "Authentication is required for this profile" };
  }
}

export function normalizeCodexEvent(event: Record<string, unknown>): NormalizedCodexEvent | undefined {
  const type = String(event.type ?? "");
  if (type === "item.completed") {
    const item = event.item && typeof event.item === "object" ? event.item as Record<string, unknown> : undefined;
    const summary = item?.type === "agent_message" && typeof item.text === "string" ? item.text.slice(0, 2_000) : type;
    return { type: "activity", summary };
  }
  if (type === "turn.completed") return { type: "activity", summary: type };
  if (type.includes("approval") || type.includes("input_required")) return { type: "waiting", reason: type };
  if (type.includes("rate_limit") || type.includes("quota")) {
    const exhausted = type.includes("quota") || event.remaining === 0;
    return {
      type: "resource",
      state: exhausted ? "QUOTA_EXHAUSTED" : "RATE_LIMITED",
      reason: type,
      ...(typeof event.resets_at === "string" ? { resetsAt: event.resets_at } : {}),
      source: "event",
      confidence: "high",
    };
  }
  if (type === "error" || type === "turn.failed") return normalizeCodexError(String(event.message ?? objectMessage(event.error) ?? type));
  return undefined;
}

export function normalizeCodexError(message: string): NormalizedCodexEvent | undefined {
  if (!message.trim()) return undefined;
  const lower = message.toLowerCase();
  if (lower.includes("quota") || lower.includes("usage limit")) return { type: "resource", state: "QUOTA_EXHAUSTED", reason: "Codex usage limit reached", source: "error", confidence: "medium" };
  if (lower.includes("429") || lower.includes("rate limit")) return { type: "resource", state: "RATE_LIMITED", reason: "Codex rate limited", source: "error", confidence: "medium" };
  if (lower.includes("auth") || lower.includes("login") || lower.includes("unauthorized")) return { type: "resource", state: "AUTH_ERROR", reason: "Codex authentication required", source: "error", confidence: "medium" };
  if (lower.includes("unavailable") || lower.includes("connection")) return { type: "resource", state: "PROVIDER_DOWN", reason: "Codex provider unavailable", source: "error", confidence: "medium" };
  return { type: "failure", reason: message.slice(0, 500) };
}

function objectMessage(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "message" in value && typeof (value as { message?: unknown }).message === "string") return (value as { message: string }).message;
  return undefined;
}
