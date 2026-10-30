import { childExecutionEnvironment } from "@dispatcher/shared";
import { spawn as spawnProcess } from "node:child_process";
import { OwnedProcessGroup } from "@dispatcher/adapters";
import { chmodSync,closeSync,constants,existsSync,fstatSync,lstatSync,mkdirSync,openSync,readdirSync,renameSync,rmSync,statSync,writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { arch, platform } from "node:os";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { spawn as spawnPty } from "node-pty";

export interface LogBudget {
  maxFileBytes: number;
  maxTotalBytes: number;
  retentionFiles: number;
  tailBytes: number;
}

const defaultBudget: LogBudget = { maxFileBytes: 256 * 1_024, maxTotalBytes: 1 * 1_024 * 1_024, retentionFiles: 4, tailBytes: 8 * 1_024 };

function ensurePtySpawnHelper(): void {
  if (platform() === "win32") return;
  const packageRoot = join(dirname(createRequire(import.meta.url).resolve("node-pty")), "..");
  for (const helper of [join(packageRoot, "prebuilds", `${platform()}-${arch()}`, "spawn-helper"), join(packageRoot, "build", "Release", "spawn-helper")]) {
    if (existsSync(helper) && (statSync(helper).mode & 0o111) === 0) chmodSync(helper, 0o755);
  }
}

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
  private readonly ownedNames:RegExp;
  private tailText = "";
  constructor(private readonly directory: string, private readonly name: string, private readonly budget: LogBudget = defaultBudget) {
    if(!/^[a-z][a-z0-9_-]{0,63}$/i.test(name)||Object.values(budget).some(value=>!Number.isSafeInteger(value)||value<1))throw Error("LOG_BUDGET_INVALID");
    mkdirSync(directory, { recursive: true });
    this.currentPath = join(directory, `${name}.log`);
    this.ownedNames=new RegExp(`^(?:${[...new Set([name,"stdout","stderr","pty"])].join("|")})\\.log(?:\\.\\d+)?$`);
  }

  write(input: string | Uint8Array): void {
    const text = redact(typeof input === "string" ? input : Buffer.from(input).toString("utf8"));
    const bytes = Buffer.byteLength(text);
    const currentSize = existsSync(this.currentPath) ? this.safeFile(this.currentPath).size : 0;
    const allowed = Math.min(bytes, this.budget.maxFileBytes,this.budget.maxTotalBytes);
    if (currentSize > 0 && currentSize + allowed > this.chunkLimitBytes) this.rotate();
    const chunk = Buffer.from(text).subarray(0, allowed);
    const descriptor=openSync(this.currentPath,constants.O_WRONLY|constants.O_APPEND|constants.O_CREAT|constants.O_NOFOLLOW|constants.O_NONBLOCK,0o600);
    try{const file=fstatSync(descriptor);if(!file.isFile()||file.nlink!==1)throw Error("LOG_PATH_UNSAFE");let offset=0;while(offset<chunk.length)offset+=writeSync(descriptor,chunk,offset,chunk.length-offset);}finally{closeSync(descriptor);}
    this.tailText = (this.tailText + stripAnsi(chunk.toString("utf8"))).slice(-this.budget.tailBytes);
    this.enforceTotalBudget();
  }

  tail(): string { return this.tailText; }
  get chunkLimitBytes():number{return Math.min(this.budget.maxFileBytes,this.budget.maxTotalBytes);}
  files(): string[] { return Array.from({ length: this.budget.retentionFiles }, (_, index) => index === 0 ? this.currentPath : `${this.currentPath}.${index}`).filter(existsSync); }

  private rotate(): void {
    if(this.budget.retentionFiles===1){this.safeFile(this.currentPath);rmSync(this.currentPath);return;}
    const last = `${this.currentPath}.${this.budget.retentionFiles - 1}`;
    if (existsSync(last)){this.safeFile(last);rmSync(last);}
    for (let index = this.budget.retentionFiles - 2; index >= 1; index -= 1) {
      const source = `${this.currentPath}.${index}`;
      if (existsSync(source)){this.safeFile(source);renameSync(source, `${this.currentPath}.${index + 1}`);}
    }
    if (existsSync(this.currentPath)) renameSync(this.currentPath, `${this.currentPath}.1`);
  }

  private enforceTotalBudget(): void {
    const files = readdirSync(this.directory)
      .filter((entry) => this.ownedNames.test(entry))
      .map((entry) => join(this.directory, entry))
      .filter(existsSync)
      .map((path) => ({ path, bytes: this.safeFile(path).size, modifiedAt: this.safeFile(path).mtimeMs }))
      .sort((left, right) => right.modifiedAt - left.modifiedAt);
    while (files.reduce((sum, file) => sum + file.bytes, 0) > this.budget.maxTotalBytes && files.length > 1) {
      const oldest = files.pop();
      if (oldest) rmSync(oldest.path);
    }
  }
  private safeFile(path:string){const file=lstatSync(path);if(!file.isFile()||file.isSymbolicLink()||file.nlink!==1)throw Error("LOG_PATH_UNSAFE");return file;}
}

export type ExitClassification = "success" | "cancelled" | "timeout" | "idle-timeout" | "nonzero" | "signal" | "spawn-error";
export interface ActivityEvent { sessionId: string; stream: "stdout" | "stderr" | "lifecycle"; summary: string; occurredAt: string; }
export interface ProcessResult { sessionId: string; exitCode: number | null; signal: NodeJS.Signals | null; classification: ExitClassification; stdoutTail: string; stderrTail: string; durationMs: number; }
export interface ProcessTreeStatus {state:"present"|"empty"|"unknown";scope:"owned-process-group"|"unverified"}
export interface ManagedProcessHandle {
  id: string;
  pid: number;
  send(data: string): Promise<void>;
  cancel(): Promise<void>;
  status(): { state: "running" | "completed"; pid: number };
  result(): Promise<ProcessResult>;
  treeStatus?(): ProcessTreeStatus;
  subscribe(handler: (event: ActivityEvent) => void): () => void;
}

export function processTreeKillCommand(pid: number, targetPlatform: NodeJS.Platform, force = false): { file: string; args: string[] } | undefined {
  if (targetPlatform !== "win32") return undefined;
  return { file: "taskkill.exe", args: ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])] };
}

interface InternalProcess {
  handle: ManagedProcessHandle;
}

export interface ProcessStartInput {runId:string;file:string;args:string[];cwd:string;timeoutMs?:number;idleTimeoutMs?:number;mode?:"process"|"pty";env?:Readonly<Record<string,string|undefined>>}

export class ProcessManager {
  private readonly active = new Map<string, InternalProcess>();
  constructor(private readonly logRoot: string, private readonly budget: LogBudget = defaultBudget) {}
  get activeCount(): number { return this.active.size; }

  async start(request: ProcessStartInput): Promise<ManagedProcessHandle> {
    const input={...request,args:[...request.args],env:Object.freeze({...request.env??process.env})};
    if (input.mode === "pty") return this.startPty(input);
    const id = randomUUID();
    const startedAt = Date.now();
    const stdout = new BoundedLogWriter(join(this.logRoot, input.runId), "stdout", this.budget);
    const stderr = new BoundedLogWriter(join(this.logRoot, input.runId), "stderr", this.budget);
    const listeners = new Set<(event: ActivityEvent) => void>();
    let classification: ExitClassification | undefined;
    let settled = false;
    const child = spawnProcess(input.file, input.args, { cwd: input.cwd, env: childExecutionEnvironment(input.env, { PWD: input.cwd }), shell: false, detached: platform() !== "win32", stdio: ["pipe", "pipe", "pipe"] });
    const ownership = new OwnedProcessGroup(child);
    let rejectResult: (error: unknown) => void = () => undefined;
    const spawned = new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("spawn", resolve);
    });
    const emit = (stream: ActivityEvent["stream"], text: string): void => {
      const event = { sessionId: id, stream, summary: stripAnsi(redact(text)).slice(-500), occurredAt: new Date().toISOString() };
      for (const listener of listeners) listener(event);
    };
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const terminate = (reason: ExitClassification): void => {
      if (settled) return;
      classification ??= reason;
      void ownership.stop().catch(rejectResult);
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
    const resultPromise = new Promise<ProcessResult>((resolve, reject) => {
      rejectResult = reject;
      child.on("error", (error) => { classification ??= "spawn-error"; stderr.write(error.message); });
      child.on("close", (code, signal) => { void (async () => {
        await ownership.stop();
        settled = true;
        if (timeout) clearTimeout(timeout);
        if (idleTimer) clearTimeout(idleTimer);
        this.active.delete(id);
        const resolved = classification ?? (signal ? "signal" : code === 0 ? "success" : "nonzero");
        emit("lifecycle", resolved);
        resolve({ sessionId: id, exitCode: code, signal: signal as NodeJS.Signals | null, classification: resolved, stdoutTail: stdout.tail(), stderrTail: stderr.tail(), durationMs: Date.now() - startedAt });
      })().catch(reject); });
    });
    await spawned;
    if (child.pid === undefined) throw new Error("Process did not receive a pid");
    const handle: ManagedProcessHandle = {
      id,
      pid: child.pid,
      send: async (data) => { if (!child.stdin?.writable) throw new Error("Process input is closed"); child.stdin.write(data); },
      cancel: async () => { terminate("cancelled"); await resultPromise; },
      status: () => ({ state: settled ? "completed" : "running", pid: child.pid! }),
      treeStatus: () => ownership.treeStatus(),
      result: async () => await resultPromise,
      subscribe: (handler) => { listeners.add(handler); return () => listeners.delete(handler); },
    };
    this.active.set(id, { handle });
    return handle;
  }

  private startPty(input: ProcessStartInput & {env:Readonly<Record<string,string|undefined>>}): ManagedProcessHandle {
    ensurePtySpawnHelper();
    const id = randomUUID();
    const startedAt = Date.now();
    const output = new BoundedLogWriter(join(this.logRoot, input.runId), "pty", this.budget);
    const listeners = new Set<(event: ActivityEvent) => void>();
    let settled = false;
    let classification: ExitClassification | undefined;
    const terminal = spawnPty(input.file, input.args, {
      cwd: input.cwd,
      env: childExecutionEnvironment(input.env, { PWD: input.cwd }),
      name: input.env?.TERM ?? "xterm-256color",
      cols: 120,
      rows: 40,
      useConpty: platform() === "win32",
    });
    const ownership = new OwnedProcessGroup(terminal);
    const emit = (stream: ActivityEvent["stream"], text: string): void => {
      const event = { sessionId: id, stream, summary: stripAnsi(redact(text)).slice(-500), occurredAt: new Date().toISOString() };
      for (const listener of listeners) listener(event);
    };
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let resolveResult: (result: ProcessResult) => void = () => undefined;
    let rejectResult: (error: unknown) => void = () => undefined;
    const resultPromise = new Promise<ProcessResult>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
    const terminate = (reason: ExitClassification): void => {
      if (settled) return;
      classification ??= reason;
      void ownership.stop().catch(rejectResult);
    };
    const resetIdle = (): void => {
      if (!input.idleTimeoutMs) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => terminate("idle-timeout"), input.idleTimeoutMs);
      idleTimer.unref();
    };
    terminal.onData((data) => {
      output.write(data);
      emit("stdout", data);
      resetIdle();
    });
    terminal.onExit(({ exitCode, signal }) => { void (async () => {
      await ownership.stop();
      settled = true;
      if (idleTimer) clearTimeout(idleTimer);
      if (timeout) clearTimeout(timeout);
      this.active.delete(id);
      const resolved = classification ?? (signal ? "signal" : exitCode === 0 ? "success" : "nonzero");
      emit("lifecycle", resolved);
      resolveResult({ sessionId: id, exitCode, signal: null, classification: resolved, stdoutTail: output.tail(), stderrTail: "", durationMs: Date.now() - startedAt });
    })().catch(rejectResult); });
    resetIdle();
    if (input.timeoutMs) {
      timeout = setTimeout(() => terminate("timeout"), input.timeoutMs);
      timeout.unref();
    }
    const handle: ManagedProcessHandle = {
      id,
      pid: terminal.pid,
      send: async (data) => terminal.write(data),
      cancel: async () => { terminate("cancelled"); await resultPromise; },
      status: () => ({ state: settled ? "completed" : "running", pid: terminal.pid }),
      treeStatus: () => ownership.treeStatus(),
      result: async () => await resultPromise,
      subscribe: (handler) => { listeners.add(handler); return () => listeners.delete(handler); },
    };
    this.active.set(id, { handle });
    return handle;
  }

  async shutdown(): Promise<void> { await Promise.all([...this.active.values()].map(({ handle }) => handle.cancel())); }
}
