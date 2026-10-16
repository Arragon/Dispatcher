import { OwnedProcessGroup } from "./owned-process.js";
import { readCodexCatalog, type CodexReadRequest } from "./codex-catalog.js";
import type { ExecutionSelection, ModelCatalogContext, AccountModelCatalog,UsageObservationV1 } from "@dispatcher/domain";
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
  | { type: "usage"; summary: string;observedAt?:string; tokens: { input: number; output: number; cachedInput?: number } }
  | { type: "waiting"; reason: string }
  | { type: "resource";observedAt?:string; state: "AVAILABLE"|"RATE_LIMITED" | "QUOTA_EXHAUSTED" | "AUTH_ERROR" | "PROVIDER_DOWN" | "UNKNOWN"; reason: string; resetsAt?: string; source: "event" | "error"|"probe"; confidence: "high" | "medium" | "low" }
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
      enabled: { type: "boolean", default: true, title: "Enable task dispatch" },
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
  backends: [{ id: "codex-exec-json", kind: "headless-cli", priority: 1, capabilities: ["code", "git", "start", "resume", "send", "status", "cancel", "result", "usage", "artifacts"] }],
  capabilities: { pause: false, resume: true, usage: true, diagnostics: true },
};

interface CodexTurnResult {
  state: "completed" | "cancelled" | "failed" | "waiting";
  summary: string;
  providerSessionId?: string;
  events: NormalizedCodexEvent[];
}

interface CodexTurn {
  readonly processId?: number | undefined;
  cancel(): Promise<void>;
  status(): "running" | "completed";
  result(): Promise<CodexTurnResult>;
  events?():NormalizedCodexEvent[];
}

export interface CodexBackend {
  start(input: { executable: string; codexHome: string; workspacePath: string; prompt: string; model?: string; reasoningEffort?: string; providerSessionId?: string }): CodexTurn;
}

export class CodexCliBackend implements CodexBackend {
  start(input: { executable: string; codexHome: string; workspacePath: string; prompt: string; model?: string; reasoningEffort?: string; providerSessionId?: string }): CodexTurn {
    const common = ["--json", "--skip-git-repo-check"];
    const model = input.model ? ["--model", input.model] : [];
    const effort = input.reasoningEffort ? ["-c",`model_reasoning_effort=${JSON.stringify(input.reasoningEffort)}`] : [];
    const args = input.providerSessionId
      ? ["exec", "resume", ...common, ...model, ...effort, input.providerSessionId, input.prompt]
      : ["exec", ...common, "--sandbox", "workspace-write", ...model, ...effort, "--cd", input.workspacePath, input.prompt];
    return new SpawnedCodexTurn(spawn(input.executable, args, {
      cwd: input.workspacePath,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PWD: input.workspacePath, CODEX_HOME: input.codexHome },
    }));
  }
}

class SpawnedCodexTurn implements CodexTurn {
  get processId(): number | undefined { return this.child.pid; }
  private completed = false;
  private cancelled = false;
  private readonly outcome: Promise<CodexTurnResult>;
  private readonly ownership:OwnedProcessGroup;
  private readonly retainedEvents:NormalizedCodexEvent[]=[];
  private readonly criticalEvents=new Map<string,NormalizedCodexEvent>();
  private record(event:NormalizedCodexEvent):void{this.retainedEvents.push(event);if(this.retainedEvents.length>256)this.retainedEvents.shift();if(event.type!=="activity")this.criticalEvents.set(event.type,event);}
  events():NormalizedCodexEvent[]{const events=[...this.retainedEvents];for(const event of this.criticalEvents.values())if(!events.includes(event))events.push(event);while(events.length>256)events.splice(Math.max(0,events.findIndex(event=>event.type==="activity")),1);return structuredClone(events);}

  constructor(private readonly child: ChildProcess) {
    this.ownership=new OwnedProcessGroup(child);
    let stdout = "";
    let stderr = "";
    let providerSessionId: string | undefined;
    let completedTurn=false;
    let failedTurn=false;
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
          if(event.type==="turn.completed")completedTurn=true;
          if(event.type==="turn.failed"||event.type==="error")failedTurn=true;
          const normalized = normalizeCodexEvent(event);
          if (normalized)this.record(normalized.type==="usage"||normalized.type==="resource"?{...normalized,observedAt:new Date().toISOString()}:normalized);
        } catch {
          this.record({ type: "activity", summary: line.slice(0, 500) });
        }
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-16_384); });
    this.outcome = new Promise((resolve,reject) => {
      child.on("error", (error) => {
        stderr = error.message;
      });
      child.on("close", (code) => {void (async()=>{
        await this.ownership.stop();
        this.completed = true;
        const normalized = code===0 ? undefined : normalizeCodexError(stderr);
        if (normalized)this.record(normalized.type==="resource"?{...normalized,observedAt:new Date().toISOString()}:normalized);
        const events=this.events();
        const last = events.findLast(e=>e.type==="failure"||e.type==="activity");
        const waiting = events.findLast((event) => event.type === "waiting");
        resolve({
          state: this.cancelled ? "cancelled" : waiting ? "waiting" : code === 0 && completedTurn && !failedTurn && providerSessionId ? "completed" : "failed",
          summary: last?.type === "failure" ? last.reason : last?.type === "activity" ? last.summary : waiting?.reason ?? (code === 0 ? "Codex completed" : stderr.slice(0, 500) || "Codex failed"),
          ...(providerSessionId ? { providerSessionId } : {}),
          events,
        });
      })().catch(reject);});
    });
    void this.outcome.catch(()=>undefined);
  }

  async cancel(): Promise<void> {
    if (this.completed) return;
    this.cancelled = true;
    await this.ownership.stop();
    await this.outcome;
  }
  status(): "running" | "completed" { return this.completed ? "completed" : "running"; }
  async result(): Promise<CodexTurnResult> { return this.outcome; }
}

export class CodexAdapter implements AgentAdapter {
  readonly supportsExecutionSelection = true;
  readonly manifest = validateManifest(codexManifest);
  private readonly turns = new Map<string, CodexTurn>();
  private pending = 0;
  private readonly sending = new Set<string>();
  private readonly cancelled=new Set<string>();

  hasActiveOperations(): boolean { return this.pending > 0 || this.sending.size > 0 || [...this.turns.values()].some((turn) => turn.status() === "running"); }

  constructor(
    readonly profile: CodexProfileConfig,
    private readonly backend: CodexBackend = new CodexCliBackend(),
    private readonly store: SessionStore = new MemorySessionStore(),
    private readonly catalogRequest?: (input:CodexReadRequest)=>Promise<unknown>,
  ) {}

  modelCatalog(context:ModelCatalogContext & {workspacePath:string}):Promise<AccountModelCatalog> {
    return readCodexCatalog({profile:this.profile,context,workspacePath:context.workspacePath,...(this.catalogRequest?{request:this.catalogRequest}:{})});
  }
  async start(input: { runId: string; workspacePath: string; backendId?: string; prompt?: string; executionSelection?: ExecutionSelection }): Promise<AdapterSession> {
    const now = new Date().toISOString();
    const session: AdapterSession = {
      id: randomUUID(),
      runId: input.runId,
      backendId: input.backendId ?? "codex-exec-json",
      workspacePath: input.workspacePath,
      state: "STARTING",
      profileId: this.profile.id,
      ...(input.executionSelection ? { executionSelection: structuredClone(input.executionSelection) } : {}),
      createdAt: now,
      updatedAt: now,
      turnId:randomUUID(),turnStartedAt:now,
    };
    this.store.save(session);
    const turn = this.backend.start({
      executable: this.profile.executable ?? "codex",
      codexHome: this.profile.codexHome,
      workspacePath: input.workspacePath,
      ...(typeof input.executionSelection?.nativeParameters.reasoningEffort==="string" ? {reasoningEffort:input.executionSelection.nativeParameters.reasoningEffort}:{}),
      prompt: input.prompt ?? "Inspect the task context and report readiness.",
      ...(input.executionSelection ? input.executionSelection.requestedModel ? {model:input.executionSelection.requestedModel} : {} : this.profile.model ? {model:this.profile.model} : {}),
    });
    this.turns.set(session.id, turn);
    session.state = "RUNNING";
    if (turn.processId !== undefined) session.processId = turn.processId;
    try { this.store.save(session); } catch (error) { await turn.cancel(); throw error; }
    return structuredClone(session);
  }

  async send(sessionId: string, message: string): Promise<AdapterEvent> {
    if (this.cancelled.has(sessionId)||this.require(sessionId).state === "CANCELLED") throw new AdapterContractError("SESSION_CANCELLED", "A cancelled Codex session cannot accept input");
    if(!this.turns.has(sessionId)&&["STARTING","RUNNING"].includes(this.require(sessionId).state))throw new AdapterContractError("SESSION_DETACHED","Inspect the original native process before continuing this session");
    if (this.sending.has(sessionId) || (this.require(sessionId).state === "RUNNING" && this.turns.get(sessionId)?.status() === "running")) throw new AdapterContractError("SESSION_BUSY", "Wait for the active Codex turn before sending another message");
    this.sending.add(sessionId);
    try {
    const session = await this.finishCurrentTurn(sessionId);
    if (this.cancelled.has(sessionId)||this.require(sessionId).state === "CANCELLED") throw new AdapterContractError("SESSION_CANCELLED", "A cancelled Codex session cannot accept input");
    if (!session.providerSessionId) throw new AdapterContractError("SESSION_NOT_RESUMABLE", "Codex did not return a provider session id");
    const turnStartedAt=new Date().toISOString();this.store.save({ ...session, state: "STARTING",turnId:randomUUID(),turnStartedAt,updatedAt:turnStartedAt });
    const turn = this.backend.start({
      executable: this.profile.executable ?? "codex",
      codexHome: this.profile.codexHome,
      workspacePath: session.workspacePath,
      ...(typeof session.executionSelection?.nativeParameters.reasoningEffort==="string" ? {reasoningEffort:session.executionSelection.nativeParameters.reasoningEffort}:{}),
      prompt: message,
      providerSessionId: session.providerSessionId,
      ...(session.executionSelection ? session.executionSelection.requestedModel ? {model:session.executionSelection.requestedModel} : {} : this.profile.model ? {model:this.profile.model} : {}),
    });
    this.turns.set(sessionId, turn);
    const persisted = { ...this.require(sessionId) }; delete persisted.processId;
    try { this.store.save({ ...persisted, state: "RUNNING", ...(turn.processId !== undefined ? { processId: turn.processId } : {}), updatedAt: new Date().toISOString() }); }
    catch (error) { await turn.cancel(); throw error; }
    return { type: "session.message", sessionId, occurredAt: new Date().toISOString(), data: { acceptedCharacters: message.length } };
    } finally { this.sending.delete(sessionId); }
  }
  async pause(): Promise<AdapterSession> { throw new AdapterContractError("UNSUPPORTED_CAPABILITY", "Codex exec does not support pausing a live turn"); }
  async resume(sessionId: string): Promise<AdapterSession> {
    await this.send(sessionId, "Continue from the existing task context.");
    return this.status(sessionId);
  }
  async cancel(sessionId: string): Promise<AdapterSession> {
    this.pending++;
    try {
      const session=this.require(sessionId);
      const turn = this.turns.get(sessionId);
      if(!turn&&["STARTING","RUNNING"].includes(session.state))throw new AdapterContractError("SESSION_DETACHED","Native termination cannot be confirmed without owned process handles");
      this.cancelled.add(sessionId);
      if (turn) await turn.cancel();
      return this.update(sessionId, { state: "CANCELLED" });
    } finally { this.pending--; }
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
    const session=this.require(sessionId),turn=this.turns.get(sessionId),result=turn?.status()==="completed"?await turn.result():undefined,events=turn?.events?.()??result?.events??[];
    const resource=events.findLast(event=>event.type==="resource"),usage=events.findLast(event=>event.type==="usage"),tokens=usage?.tokens;
    const observedAt=usage?.observedAt??session.turnStartedAt??session.createdAt;
    const observation:UsageObservationV1|undefined=tokens&&session.turnId?{version:1,eventId:`${session.turnId}:usage`,profileId:this.profile.id,runId:session.runId,sessionId:session.id,turnId:session.turnId,scope:"turn",mode:"snapshot",observedAt,collectedAt:observedAt,source:"native-event",completeness:"complete",metrics:[{name:"input",value:String(tokens.input),unit:"tokens"},{name:"output",value:String(tokens.output),unit:"tokens"},...(tokens.cachedInput!==undefined?[{name:"cachedInput",value:String(tokens.cachedInput),unit:"tokens",includedIn:"input"}]:[])]}:undefined;
    return { ...(resource ?? (result?.state==="completed" ? {state:"AVAILABLE",source:"event",confidence:"medium",reason:"Native turn completed; remaining quota was not reported"} : { state: "UNKNOWN", source: "event", confidence: "low" })),checkedAt:resource?.observedAt??(resource?.source==="probe"?new Date().toISOString():observedAt), ...(tokens ? { tokens, tokenScope: "latest-turn" } : {}),...(observation?{observations:[observation]}:{}) };
  }
  async diagnostics(sessionId: string): Promise<Record<string, unknown>> {
    const session = this.require(sessionId);
    return { sessionId, profileId: session.profileId, alias: this.profile.alias, attached: this.turns.has(sessionId), resumable: Boolean(session.providerSessionId) };
  }

  private async finishCurrentTurn(sessionId: string): Promise<AdapterSession> {
    const session = this.require(sessionId);
    const turn = this.turns.get(sessionId);
    if (!turn || session.state === "CANCELLED") return structuredClone(session);
    const result = await turn.result();
    if (this.cancelled.has(sessionId)||this.require(sessionId).state === "CANCELLED") return structuredClone(this.require(sessionId));
    return this.update(sessionId, {
      state: result.state === "completed" ? "COMPLETED" : result.state === "cancelled" ? "CANCELLED" : result.state === "waiting" ? "PAUSED" : "FAILED",
      ...(result.providerSessionId ? { providerSessionId: result.providerSessionId } : {}),
    });
  }
  private require(id: string): AdapterSession {
    const session = this.store.load(id);
    if (!session || session.profileId !== this.profile.id) throw new AdapterContractError("SESSION_NOT_FOUND", `Unknown session ${id}`);
    return session;
  }
  private update(id: string, changes: Partial<AdapterSession>): AdapterSession {
    const updated = { ...this.require(id), ...changes, updatedAt: new Date().toISOString() };
    this.store.save(updated);
    return structuredClone(updated);
  }
}

export async function probeCodexProfile(profile: CodexProfileConfig,context:{workspacePath?:string}={}): Promise<CodexDiscoveryResult> {
  const executable = profile.executable ?? "codex";
  const environment = { ...process.env, CODEX_HOME: profile.codexHome,...(context.workspacePath?{PWD:context.workspacePath}:{}) };
  let version: string | undefined;
  try { version = (await execFileAsync(executable, ["--version"], { env: environment,...(context.workspacePath?{cwd:context.workspacePath}:{}), timeout: 3_000 })).stdout.trim(); }
  catch (error) { return { executable, authenticated: false, profile: { id: profile.id, alias: profile.alias }, diagnostic: error instanceof Error ? error.message.slice(0, 240) : "Codex executable unavailable" }; }
  try {
    await execFileAsync(executable, ["login", "status"], { env: environment,...(context.workspacePath?{cwd:context.workspacePath}:{}), timeout: 5_000 });
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
  if (type === "turn.completed") {
    const usage = event.usage as Record<string, unknown> | undefined;
    if (usage && Number.isSafeInteger(usage.input_tokens) && Number.isSafeInteger(usage.output_tokens) && Number(usage.input_tokens) >= 0 && Number(usage.output_tokens) >= 0) {
      return { type: "usage", summary: type, tokens: { input: Number(usage.input_tokens), output: Number(usage.output_tokens), ...(Number.isSafeInteger(usage.cached_input_tokens) && Number(usage.cached_input_tokens) >= 0 && Number(usage.cached_input_tokens) <= Number(usage.input_tokens) ? { cachedInput: Number(usage.cached_input_tokens) } : {}) } };
    }
    return { type: "activity", summary: type };
  }
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
