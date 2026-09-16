import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { platform } from "node:os";
import { randomUUID } from "node:crypto";

export interface LogBudget {
  maxFileBytes: number;
  maxTotalBytes: number;
  retentionFiles: number;
  tailBytes: number;
}

const defaultBudget: LogBudget = { maxFileBytes: 256 * 1_024, maxTotalBytes: 1 * 1_024 * 1_024, retentionFiles: 4, tailBytes: 8 * 1_024 };

export function stripAnsi(value: string): string {
  const pattern = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");
  return value.replace(pattern, "");
}

function redact(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{8,}\b/gi, "[REDACTED]");
}

export class BoundedLogWriter {
  private readonly currentPath: string;
  private tailText = "";
  constructor(private readonly directory: string, private readonly name: string, private readonly budget: LogBudget = defaultBudget) {
    mkdirSync(directory, { recursive: true });
    this.currentPath = join(directory, `${name}.log`);
  }

  write(input: string | Uint8Array): void {
    const text = redact(typeof input === "string" ? input : Buffer.from(input).toString("utf8"));
    const bytes = Buffer.byteLength(text);
    const currentSize = existsSync(this.currentPath) ? statSync(this.currentPath).size : 0;
    if (currentSize > 0 && currentSize + bytes > this.budget.maxFileBytes) this.rotate();
    const allowed = Math.min(bytes, this.budget.maxFileBytes);
    const chunk = Buffer.from(text).subarray(0, allowed);
    writeFileSync(this.currentPath, chunk, { flag: "a", mode: 0o600 });
    this.tailText = (this.tailText + stripAnsi(chunk.toString("utf8"))).slice(-this.budget.tailBytes);
    this.enforceTotalBudget();
  }

  tail(): string { return this.tailText; }
  files(): string[] { return Array.from({ length: this.budget.retentionFiles }, (_, index) => index === 0 ? this.currentPath : `${this.currentPath}.${index}`).filter(existsSync); }

  private rotate(): void {
    const last = `${this.currentPath}.${this.budget.retentionFiles - 1}`;
    if (existsSync(last)) rmSync(last);
    for (let index = this.budget.retentionFiles - 2; index >= 1; index -= 1) {
      const source = `${this.currentPath}.${index}`;
      if (existsSync(source)) renameSync(source, `${this.currentPath}.${index + 1}`);
    }
    if (existsSync(this.currentPath)) renameSync(this.currentPath, `${this.currentPath}.1`);
  }

  private enforceTotalBudget(): void {
    const files = readdirSync(this.directory)
      .filter((entry) => entry.endsWith(".log") || /\.log\.\d+$/.test(entry))
      .map((entry) => join(this.directory, entry))
      .filter(existsSync)
      .map((path) => ({ path, bytes: statSync(path).size, modifiedAt: statSync(path).mtimeMs }))
      .sort((left, right) => right.modifiedAt - left.modifiedAt);
    while (files.reduce((sum, file) => sum + file.bytes, 0) > this.budget.maxTotalBytes && files.length > 1) {
      const oldest = files.pop();
      if (oldest) rmSync(oldest.path);
    }
  }
}

export type ExitClassification = "success" | "cancelled" | "timeout" | "idle-timeout" | "nonzero" | "signal" | "spawn-error";
export interface ActivityEvent { sessionId: string; stream: "stdout" | "stderr" | "lifecycle"; summary: string; occurredAt: string; }
export interface ProcessResult { sessionId: string; exitCode: number | null; signal: NodeJS.Signals | null; classification: ExitClassification; stdoutTail: string; stderrTail: string; durationMs: number; }
export interface ManagedProcessHandle {
  id: string;
  pid: number;
  send(data: string): Promise<void>;
  cancel(): Promise<void>;
  status(): { state: "running" | "completed"; pid: number };
  result(): Promise<ProcessResult>;
  subscribe(handler: (event: ActivityEvent) => void): () => void;
}

interface InternalProcess {
  child: ChildProcess;
  handle: ManagedProcessHandle;
}

export class ProcessManager {
  private readonly active = new Map<string, InternalProcess>();
  constructor(private readonly logRoot: string, private readonly budget: LogBudget = defaultBudget) {}
  get activeCount(): number { return this.active.size; }

  async start(input: { runId: string; file: string; args: string[]; cwd: string; timeoutMs?: number; idleTimeoutMs?: number; mode?: "process" | "pty" }): Promise<ManagedProcessHandle> {
    if (input.mode === "pty") throw new Error("PTY backend is unavailable until a manifest explicitly provides an installed PTY capability");
    const id = randomUUID();
    const startedAt = Date.now();
    const stdout = new BoundedLogWriter(join(this.logRoot, input.runId), "stdout", this.budget);
    const stderr = new BoundedLogWriter(join(this.logRoot, input.runId), "stderr", this.budget);
    const listeners = new Set<(event: ActivityEvent) => void>();
    let classification: ExitClassification | undefined;
    let settled = false;
    const child = spawn(input.file, input.args, { cwd: input.cwd, shell: false, detached: platform() !== "win32", stdio: ["pipe", "pipe", "pipe"] });
    if (child.pid === undefined) throw new Error("Process did not receive a pid");
    const emit = (stream: ActivityEvent["stream"], text: string): void => {
      const event = { sessionId: id, stream, summary: stripAnsi(redact(text)).slice(-500), occurredAt: new Date().toISOString() };
      for (const listener of listeners) listener(event);
    };
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const terminate = (reason: ExitClassification): void => {
      if (settled || child.exitCode !== null) return;
      classification = reason;
      try { if (platform() !== "win32") process.kill(-child.pid!, "SIGTERM"); else child.kill("SIGTERM"); } catch { child.kill("SIGTERM"); }
      const force = setTimeout(() => { if (child.exitCode === null) { try { if (platform() !== "win32") process.kill(-child.pid!, "SIGKILL"); else child.kill("SIGKILL"); } catch { child.kill("SIGKILL"); } } }, 2_000);
      force.unref();
    };
    const resetIdle = (): void => {
      if (!input.idleTimeoutMs) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => terminate("idle-timeout"), input.idleTimeoutMs);
      idleTimer.unref();
    };
    child.stdout?.on("data", (chunk: Buffer) => { stdout.write(chunk); emit("stdout", chunk.toString()); resetIdle(); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr.write(chunk); emit("stderr", chunk.toString()); resetIdle(); });
    resetIdle();
    const timeout = input.timeoutMs ? setTimeout(() => terminate("timeout"), input.timeoutMs) : undefined;
    timeout?.unref();
    const resultPromise = new Promise<ProcessResult>((resolve) => {
      child.on("error", (error) => { classification ??= "spawn-error"; stderr.write(error.message); });
      child.on("close", (code, signal) => {
        settled = true;
        if (timeout) clearTimeout(timeout);
        if (idleTimer) clearTimeout(idleTimer);
        this.active.delete(id);
        const resolved = classification ?? (signal ? "signal" : code === 0 ? "success" : "nonzero");
        emit("lifecycle", resolved);
        resolve({ sessionId: id, exitCode: code, signal: signal as NodeJS.Signals | null, classification: resolved, stdoutTail: stdout.tail(), stderrTail: stderr.tail(), durationMs: Date.now() - startedAt });
      });
    });
    const handle: ManagedProcessHandle = {
      id,
      pid: child.pid,
      send: async (data) => { if (!child.stdin?.writable) throw new Error("Process input is closed"); child.stdin.write(data); },
      cancel: async () => { terminate("cancelled"); await resultPromise; },
      status: () => ({ state: settled ? "completed" : "running", pid: child.pid! }),
      result: async () => await resultPromise,
      subscribe: (handler) => { listeners.add(handler); return () => listeners.delete(handler); },
    };
    this.active.set(id, { child, handle });
    return handle;
  }

  async shutdown(): Promise<void> { await Promise.all([...this.active.values()].map(({ handle }) => handle.cancel())); }
}
