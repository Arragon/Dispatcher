import { isDeepStrictEqual } from "node:util";
import { AdapterContractError, type AdapterEvent, type AdapterManifest, type AdapterResult, type AdapterSession, type AgentAdapter } from "@dispatcher/adapters";
import type { ExecutionSelection, Run } from "@dispatcher/domain";
import type { CommandPayload } from "@dispatcher/protocol";
import { remoteCommandHash } from "@dispatcher/runner";
import { contentHash } from "./task-publications.js";

interface RemoteNativeAdapterOptions {
  profileId: string; runnerId: string; manifest: AdapterManifest;
  run(runId: string): Run | undefined; sessionRun(sessionId: string): Run | undefined;
  request(payload: CommandPayload, run: Run, messageId?: string): Promise<unknown>;
  saveSession(session: AdapterSession): void;
  reserveStart(run: Run, commandHash: string): void;
  active(): boolean;
}
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const text = (value: unknown, max = 500): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
const date = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
function nativeSelection(selection: ExecutionSelection): Omit<ExecutionSelection, "routingDecision"> { const snapshot = structuredClone(selection); delete snapshot.routingDecision; return snapshot; }

/** A transport facade: no native credentials, executable or Controller filesystem operations. */
export class RemoteNativeAdapter implements AgentAdapter {
  readonly supportsExecutionSelection = true;
  readonly manifest: AdapterManifest;
  constructor(private readonly options: RemoteNativeAdapterOptions) { this.manifest = structuredClone(options.manifest); }
  hasActiveOperations(): boolean { return this.options.active(); }
  private run(id: string, session = false): Run {
    const run = session ? this.options.sessionRun(id) : this.options.run(id);
    if (!run || run.profileId !== this.options.profileId || run.runnerId !== this.options.runnerId || !run.worktree || !run.leaseExpiresAt) throw new AdapterContractError("RUN_AUTHORITY_MISMATCH", "No matching canonical remote Run authority");
    return run;
  }
  private session(value: unknown, run: Run, starting = false): AdapterSession {
    if (!object(value) || !text(value.id) || value.runId !== run.id || value.profileId !== run.profileId || value.backendId !== run.executionSelection?.backendId || value.workspacePath !== run.worktree || !["STARTING", "RUNNING", "PAUSED", "CANCELLED", "COMPLETED", "FAILED"].includes(String(value.state)) || !date(value.createdAt) || !date(value.updatedAt) || !starting && value.id !== run.sessionId || value.providerSessionId !== undefined && !text(value.providerSessionId) || run.providerSessionId!==undefined&&value.providerSessionId!==run.providerSessionId || value.processId !== undefined && (!Number.isSafeInteger(value.processId) || Number(value.processId) <= 0) || !run.executionSelection || !isDeepStrictEqual(value.executionSelection, nativeSelection(run.executionSelection))) throw new AdapterContractError("COMMAND_OUTCOME_UNKNOWN", "Owning Runner response does not prove the reserved native session identity");
    const session: AdapterSession = { id: value.id, runId: run.id, profileId: run.profileId, backendId: String(value.backendId), workspacePath: run.worktree!, state: value.state as AdapterSession["state"], createdAt: value.createdAt, updatedAt: value.updatedAt, executionSelection: structuredClone(run.executionSelection), ...(value.providerSessionId ? { providerSessionId: String(value.providerSessionId) } : {}), ...(value.processId !== undefined ? { processId: Number(value.processId) } : {}) };
    this.options.saveSession(session); return session;
  }
  reconcileSession(value:unknown,run:Run):AdapterSession {
    if(!run.sessionId.startsWith("unstarted:")&&(!object(value)||value.id!==run.sessionId))throw new AdapterContractError("COMMAND_OUTCOME_UNKNOWN","Reconciliation cannot replace the original native session");
    return this.session(value,run,true);
  }
  private async mutation(payload: CommandPayload, run: Run, messageId: string): Promise<unknown> {
    try { return await this.options.request(payload, run, messageId); }
    catch (error) { if (error instanceof AdapterContractError) throw error; throw new AdapterContractError("COMMAND_OUTCOME_UNKNOWN", "Remote mutation response is unconfirmed; inspect the owning Runner before retrying"); }
  }
  async start(input: Parameters<AgentAdapter["start"]>[0]): Promise<AdapterSession> {
    const run = this.run(input.runId);
    if (run.state !== "STARTING" || input.workspacePath !== run.worktree || !input.executionSelection || !run.executionSelection || !isDeepStrictEqual(input.executionSelection, run.executionSelection)) throw new AdapterContractError("RUN_AUTHORITY_MISMATCH", "Remote start requires the reserved canonical workspace and frozen selection");
    const payload: CommandPayload = { type: "run.start", runId: run.id, execution: { version: 1, profileId: run.profileId, workspaceId: run.id, prompt: input.prompt ?? "Inspect the task context and report readiness.", selection: nativeSelection(run.executionSelection) } };
    this.options.reserveStart(run, remoteCommandHash({ payload, leaseId: run.leaseId, generation: run.generation }));
    return this.session(await this.mutation(payload, run, `native-start:${run.id}:${run.generation}`), run, true);
  }
  async send(sessionId: string, message: string): Promise<AdapterEvent> {
    const run = this.run(sessionId, true);
    const key = `native-input:${contentHash({ runId: run.id, generation: run.generation, leaseId: run.leaseId, sessionId, message, intervention: run.lastActivityAt })}`;
    const value = await this.mutation({ type: "native.run", runId: run.id, action: "send", message }, run, key);
    if (!object(value) || value.type !== "session.message" || value.sessionId !== sessionId || !date(value.occurredAt) || !object(value.data)) throw new AdapterContractError("COMMAND_OUTCOME_UNKNOWN", "Remote input acknowledgement does not match the native session");
    return { type: "session.message", sessionId, occurredAt: value.occurredAt, data: { ...(typeof value.data.acceptedCharacters === "number" ? { acceptedCharacters: value.data.acceptedCharacters } : {}) } };
  }
  private async transition(sessionId: string, action: "pause" | "resume" | "cancel"): Promise<AdapterSession> {
    const run = this.run(sessionId, true), key = `native-${action}:${contentHash({ runId: run.id, generation: run.generation, leaseId: run.leaseId, intervention: action === "cancel" ? "cancel" : run.lastActivityAt })}`;
    return this.session(await this.mutation({ type: "native.run", runId: run.id, action }, run, key), run);
  }
  pause(sessionId: string): Promise<AdapterSession> { return this.transition(sessionId, "pause"); }
  resume(sessionId: string): Promise<AdapterSession> { return this.transition(sessionId, "resume"); }
  cancel(sessionId: string): Promise<AdapterSession> { return this.transition(sessionId, "cancel"); }
  async status(sessionId: string): Promise<AdapterSession> { const run = this.run(sessionId, true); return this.session(await this.options.request({ type: "native.run", runId: run.id, action: "status" }, run), run); }
  async result(sessionId: string): Promise<AdapterResult> {
    const run = this.run(sessionId, true), value = await this.options.request({ type: "native.run", runId: run.id, action: "result" }, run);
    if (!object(value) || value.sessionId !== sessionId || !["STARTING", "RUNNING", "PAUSED", "CANCELLED", "COMPLETED", "FAILED"].includes(String(value.state)) || typeof value.summary !== "string" || value.summary.length > 100000 || !Array.isArray(value.artifacts) || value.artifacts.length > 1000 || !value.artifacts.every(artifact => object(artifact) && text(artifact.path, 4000) && text(artifact.kind))) throw new AdapterContractError("REMOTE_RESULT_INVALID", "Owning Runner returned invalid native result evidence");
    return { sessionId, state: value.state as AdapterSession["state"], summary: value.summary, artifacts: value.artifacts.map(artifact => ({ path: String(artifact.path), kind: String(artifact.kind) })) };
  }
  async usage(sessionId: string): Promise<Record<string, unknown>> {
    const run = this.run(sessionId, true), value = await this.options.request({ type: "native.run", runId: run.id, action: "usage" }, run);
    if (!object(value) || JSON.stringify(value).length > 64000) throw new AdapterContractError("REMOTE_RESULT_INVALID", "Owning Runner returned invalid usage evidence");
    const allowed = ["state", "reason", "source", "confidence", "checkedAt", "remaining", "limit", "consumed", "resetsAt", "tokens", "tokenScope", "providerRequestId", "modelId", "profileId", "sessionId"];
    return Object.fromEntries(Object.entries(value).filter(([key]) => allowed.includes(key)));
  }
  async diagnostics(sessionId: string): Promise<Record<string, unknown>> {
    const run = this.run(sessionId, true), value = await this.options.request({ type: "native.run", runId: run.id, action: "diagnostics" }, run);
    if (!object(value) || value.runId !== run.id || value.profileId !== run.profileId || value.runnerId !== run.runnerId || value.sessionId !== sessionId) throw new AdapterContractError("REMOTE_RESULT_INVALID", "Owning Runner returned mismatched native diagnostics");
    return Object.fromEntries(Object.entries(value).filter(([key]) => ["runnerId", "runId", "profileId", "state", "attached", "sessionId", "providerSessionId", "processId", "workspace", "leaseId", "generation"].includes(key)));
  }
}
