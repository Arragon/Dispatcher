import { randomUUID } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import {
  AdapterContractError,
  validateManifest,
  type AdapterEvent,
  type AdapterManifest,
  type AdapterResult,
  type AdapterSession,
  type AgentAdapter,
  type BackendKind,
} from "./contracts.js";

const execFileAsync = promisify(execFile);

export interface SessionStore {
  load(id: string): AdapterSession | undefined;
  save(session: AdapterSession): void;
}

export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, AdapterSession>();
  load(id: string): AdapterSession | undefined { const value = this.sessions.get(id); return value ? structuredClone(value) : undefined; }
  save(session: AdapterSession): void { this.sessions.set(session.id, structuredClone(session)); }
}

export function selectBackend(manifest: AdapterManifest, available: BackendKind[]): { backendId: string; explanation: string } {
  const backend = [...manifest.backends].sort((left, right) => left.priority - right.priority).find((entry) => available.includes(entry.kind));
  if (!backend) throw new AdapterContractError("NO_SUPPORTED_BACKEND", "No declared execution backend is available");
  return { backendId: backend.id, explanation: `Selected ${backend.id} (${backend.kind}) at declared priority ${backend.priority}` };
}

export const genericMockManifest: AdapterManifest = {
  apiVersion: 1,
  id: "generic-mock",
  displayName: "Generic Mock Agent",
  platforms: ["darwin", "linux", "win32"],
  configSchema: { type: "object", additionalProperties: false, properties: {} },
  uiSchema: {},
  secretFields: [],
  probes: [{ id: "mock-ready", kind: "capability", description: "Confirm deterministic mock availability", timeoutMs: 1_000 }],
  backends: [{ id: "mock-sdk", kind: "sdk", priority: 1, capabilities: ["start", "send", "cancel", "result"] }],
  capabilities: { pause: true, resume: true, usage: false, diagnostics: true },
};

export class GenericMockAdapter implements AgentAdapter {
  readonly manifest = validateManifest(genericMockManifest);
  constructor(private readonly store: SessionStore = new MemorySessionStore()) {}

  async start(input: { runId: string; workspacePath: string; backendId?: string }): Promise<AdapterSession> {
    const now = new Date().toISOString();
    const session: AdapterSession = { id: randomUUID(), runId: input.runId, backendId: input.backendId ?? "mock-sdk", workspacePath: input.workspacePath, state: "RUNNING", createdAt: now, updatedAt: now };
    this.store.save(session);
    return structuredClone(session);
  }
  async send(sessionId: string, message: string): Promise<AdapterEvent> { const session = this.require(sessionId); if (session.state !== "RUNNING") throw new AdapterContractError("SESSION_NOT_RUNNING", "Session is not running"); return { type: "session.message", sessionId, occurredAt: new Date().toISOString(), data: { acceptedCharacters: message.length } }; }
  async pause(sessionId: string): Promise<AdapterSession> { return this.transition(sessionId, "PAUSED"); }
  async resume(sessionId: string): Promise<AdapterSession> { return this.transition(sessionId, "RUNNING"); }
  async cancel(sessionId: string): Promise<AdapterSession> { return this.transition(sessionId, "CANCELLED"); }
  async status(sessionId: string): Promise<AdapterSession> { return structuredClone(this.require(sessionId)); }
  async result(sessionId: string): Promise<AdapterResult> { const session = this.require(sessionId); return { sessionId, state: session.state, summary: `Mock session ${session.state.toLowerCase()}`, artifacts: [] }; }
  async diagnostics(sessionId: string): Promise<Record<string, unknown>> { return { sessionId, deterministic: true }; }

  private require(id: string): AdapterSession { const session = this.store.load(id); if (!session) throw new AdapterContractError("SESSION_NOT_FOUND", `Unknown session ${id}`); return session; }
  private transition(id: string, state: AdapterSession["state"]): AdapterSession { const session = this.require(id); const updated = { ...session, state, updatedAt: new Date().toISOString() }; this.store.save(updated); return structuredClone(updated); }
}

export interface ProcessExecution {
  id: string;
  status(): Promise<{ state: "running" | "cancelled" | "completed" | "failed" }>;
  send(data: string): Promise<void>;
  cancel(): Promise<void>;
  result(): Promise<{ state: "cancelled" | "completed" | "failed"; summary: string }>;
}

export interface ProcessExecutor {
  start(input: { file: string; args: string[]; cwd: string; runId: string; mode?: "headless" | "pty" }): Promise<ProcessExecution>;
}

export class SpawnProcessExecutor implements ProcessExecutor {
  async start(input: { file: string; args: string[]; cwd: string; runId: string; mode?: "headless" | "pty" }): Promise<ProcessExecution> {
    if (input.mode === "pty") throw new AdapterContractError("PTY_EXECUTOR_REQUIRED", "PTY mode must be provided by the Runner ProcessManager");
    return new SpawnProcessExecution(input.runId, spawn(input.file, input.args, { cwd: input.cwd, shell: false, stdio: ["pipe", "pipe", "pipe"] }));
  }
}

class SpawnProcessExecution implements ProcessExecution {
  private current: "running" | "cancelled" | "completed" | "failed" = "running";
  private stdout = "";
  private stderr = "";
  private readonly outcome: Promise<{ state: "cancelled" | "completed" | "failed"; summary: string }>;

  constructor(readonly id: string, private readonly child: ChildProcess) {
    child.stdout?.on("data", (chunk: Buffer) => { this.stdout = (this.stdout + chunk.toString("utf8")).slice(-131_072); });
    child.stderr?.on("data", (chunk: Buffer) => { this.stderr = (this.stderr + chunk.toString("utf8")).slice(-32_768); });
    this.outcome = new Promise((resolve) => {
      child.on("error", (error) => { this.stderr = error.message; });
      child.on("close", (code) => {
        if (this.current !== "cancelled") this.current = code === 0 ? "completed" : "failed";
        resolve({ state: this.current, summary: (this.stdout.trim() || this.stderr.trim() || `Process exited with code ${code ?? "unknown"}`).slice(0, 4_000) });
      });
    });
  }
  async status(): Promise<{ state: "running" | "cancelled" | "completed" | "failed" }> { return { state: this.current }; }
  async send(data: string): Promise<void> {
    if (this.current !== "running" || !this.child.stdin?.writable) throw new AdapterContractError("SESSION_NOT_INTERACTIVE", "CLI process stdin is unavailable");
    await new Promise<void>((resolve, reject) => this.child.stdin!.write(data, (error) => error ? reject(error) : resolve()));
  }
  async cancel(): Promise<void> {
    if (this.current === "running") { this.current = "cancelled"; this.child.kill("SIGTERM"); }
    await this.outcome;
  }
  result(): Promise<{ state: "cancelled" | "completed" | "failed"; summary: string }> { return this.outcome; }
}

export interface GenericCliTemplate {
  file: string;
  args: string[];
  mode?: "headless" | "pty";
}

export const genericCliManifest: AdapterManifest = {
  apiVersion: 1,
  id: "generic-cli",
  displayName: "Generic CLI Agent",
  platforms: ["darwin", "linux", "win32"],
  configSchema: {
    type: "object",
    additionalProperties: false,
    required: ["id", "alias", "executable", "args"],
    properties: {
      id: { type: "string", minLength: 1, pattern: "^[a-z0-9][a-z0-9._-]*$" },
      alias: { type: "string", minLength: 1 },
      runnerId: { type: "string", minLength: 1, default: "local" },
      executable: { type: "string", title: "Executable" },
      args: { type: "array", title: "Argument template", items: { type: "string" } },
      mode: { enum: ["headless", "pty"], default: "headless" },
    },
  },
  uiSchema: {},
  secretFields: [],
  probes: [{ id: "cli-version", kind: "command", description: "Read the configured CLI version", timeoutMs: 3_000 }],
  backends: [
    { id: "structured-cli", kind: "headless-cli", priority: 30, capabilities: ["code", "git", "start", "send", "status", "cancel", "result", "interactive-input"] },
    { id: "restricted-pty", kind: "pty", priority: 50, capabilities: ["code", "git", "start", "send", "status", "cancel", "result", "interactive-input"] },
  ],
  capabilities: { pause: false, resume: false, usage: false, diagnostics: true },
};

export class GenericCliAdapter implements AgentAdapter {
  readonly manifest = validateManifest(genericCliManifest);
  private readonly executions = new Map<string, ProcessExecution>();
  constructor(private readonly executor: ProcessExecutor, private readonly template: GenericCliTemplate, private readonly store: SessionStore = new MemorySessionStore(), private readonly profileId?: string) {}

  async start(input: { runId: string; workspacePath: string; backendId?: string; prompt?: string }): Promise<AdapterSession> {
    const id = randomUUID();
    const command = renderCommand(this.template, { prompt: input.prompt ?? "", sessionId: id, workspace: input.workspacePath });
    const execution = await this.executor.start({ ...command, cwd: input.workspacePath, runId: input.runId, ...(this.template.mode ? { mode: this.template.mode } : {}) });
    this.executions.set(id, execution);
    const now = new Date().toISOString();
    const session: AdapterSession = { id, runId: input.runId, backendId: input.backendId ?? (this.template.mode === "pty" ? "restricted-pty" : "structured-cli"), workspacePath: input.workspacePath, state: "RUNNING", ...(this.profileId ? { profileId: this.profileId } : {}), createdAt: now, updatedAt: now };
    this.store.save(session);
    return structuredClone(session);
  }

  async send(sessionId: string, message: string): Promise<AdapterEvent> {
    const execution = this.executions.get(sessionId);
    if (!execution) throw new AdapterContractError("SESSION_NOT_ATTACHED", "CLI process is not attached to this runtime");
    await execution.send(message);
    return { type: "session.message", sessionId, occurredAt: new Date().toISOString(), data: { acceptedCharacters: message.length } };
  }
  async pause(): Promise<AdapterSession> { throw new AdapterContractError("UNSUPPORTED_CAPABILITY", "Generic CLI does not declare pause support"); }
  async resume(): Promise<AdapterSession> { throw new AdapterContractError("UNSUPPORTED_CAPABILITY", "Generic CLI does not declare resume support"); }
  async cancel(sessionId: string): Promise<AdapterSession> {
    const execution = this.executions.get(sessionId);
    if (execution) await execution.cancel();
    return this.transition(sessionId, "CANCELLED");
  }
  async status(sessionId: string): Promise<AdapterSession> {
    const session = this.require(sessionId);
    const execution = this.executions.get(sessionId);
    if (!execution) return structuredClone(session);
    const status = await execution.status();
    if (status.state === "running") return structuredClone(session);
    return this.transition(sessionId, status.state === "completed" ? "COMPLETED" : status.state === "cancelled" ? "CANCELLED" : "FAILED");
  }
  async result(sessionId: string): Promise<AdapterResult> {
    const execution = this.executions.get(sessionId);
    if (!execution) { const session = this.require(sessionId); return { sessionId, state: session.state, summary: "Persisted session; process is not attached", artifacts: [] }; }
    const result = await execution.result();
    const state = result.state === "completed" ? "COMPLETED" : result.state === "cancelled" ? "CANCELLED" : "FAILED";
    this.transition(sessionId, state);
    return { sessionId, state, summary: result.summary, artifacts: [] };
  }
  async diagnostics(sessionId: string): Promise<Record<string, unknown>> { const session = this.require(sessionId); return { sessionId, backendId: session.backendId, mode: this.template.mode ?? "headless", attached: this.executions.has(sessionId) }; }

  private require(id: string): AdapterSession { const session = this.store.load(id); if (!session) throw new AdapterContractError("SESSION_NOT_FOUND", `Unknown session ${id}`); return session; }
  private transition(id: string, state: AdapterSession["state"]): AdapterSession { const current = this.require(id); const updated = { ...current, state, updatedAt: new Date().toISOString() }; this.store.save(updated); return structuredClone(updated); }
}

const placeholders = new Set(["{{prompt}}", "{{sessionId}}", "{{workspace}}"]);
export function renderCommand(template: GenericCliTemplate, values: { prompt: string; sessionId: string; workspace: string }): { file: string; args: string[] } {
  if (!template.file || template.file.includes("{{")) throw new AdapterContractError("UNSAFE_COMMAND_TEMPLATE", "Executable must be a fixed manifest value");
  const args = template.args.map((argument) => {
    if (!argument.includes("{{")) return argument;
    if (!placeholders.has(argument)) throw new AdapterContractError("UNSAFE_COMMAND_TEMPLATE", "Placeholders must occupy an entire argv value");
    if (argument === "{{prompt}}") return values.prompt;
    if (argument === "{{sessionId}}") return values.sessionId;
    return values.workspace;
  });
  if ([template.file, ...args].some((value) => value.includes("\0"))) throw new AdapterContractError("UNSAFE_COMMAND_TEMPLATE", "Command contains a null byte");
  return { file: template.file, args };
}

export async function probeGenericCli(template: GenericCliTemplate): Promise<{ installed: boolean; executable: string; version?: string; diagnostic?: string }> {
  if (!template.file || template.file.includes("{{") || template.file.includes("\0")) return { installed: false, executable: template.file, diagnostic: "Executable must be a fixed non-empty value" };
  try {
    const result = await execFileAsync(template.file, ["--version"], { timeout: 3_000, maxBuffer: 128 * 1024 });
    return { installed: true, executable: template.file, version: `${result.stdout}\n${result.stderr}`.trim().slice(0, 240) || "version command succeeded" };
  } catch (error) {
    return { installed: false, executable: template.file, diagnostic: error instanceof Error ? error.message.slice(0, 240) : "Version probe failed" };
  }
}
