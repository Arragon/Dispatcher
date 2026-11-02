import type { NativeInteractionPort } from "./interaction-contracts.js";
import type { NativeBinding, NativeBindingEvent, ExecutionContextRef, TurnObservation, ExecutionSelection, AccountModelCatalog, ModelCatalogContext, AccountQuotaSnapshot,AccountQuotaState, UsageObservationV1,ResourceState } from "@dispatcher/domain";
export type AdapterPlatform = "darwin" | "linux" | "win32";
export type BackendKind = "sdk" | "api" | "daemon" | "headless-cli" | "pty";

export interface AdapterBackendSpec {
  id: string;
  kind: BackendKind;
  priority: number;
  capabilities: string[];
}

export interface ProbeSpec {
  id: string;
  kind: "command" | "path" | "auth" | "capability";
  description: string;
  timeoutMs: number;
}

export interface AdapterManifest {
  apiVersion: 1;
  id: string;
  displayName: string;
  platforms: AdapterPlatform[];
  configSchema: Record<string, unknown>;
  uiSchema: Record<string, unknown>;
  secretFields: string[];
  probes: ProbeSpec[];
  backends: AdapterBackendSpec[];
  capabilities: { pause: boolean; resume: boolean; usage: boolean; diagnostics: boolean };
}

export type AdapterSessionState = "STARTING" | "RUNNING" | "PAUSED" | "CANCELLED" | "COMPLETED" | "FAILED";

export interface AdapterSession {
  /** Execution facts already observed by status/result; independent of billing reads. */
  executionResource?:{state:ResourceState;reason?:string;resetsAt?:string;source:"session"|"error";confidence:"high"|"medium"|"low";checkedAt:string};
  executionSelection?: ExecutionSelection;
  /** A present empty snapshot preserves a known omission; absent is historical data. */
  legacyModel?:{id?:string};
  turnId?:string;
  turnStartedAt?:string;
  modelInvocationId?:string;
  id: string;
  runId: string;
  backendId: string;
  workspacePath: string;
  state: AdapterSessionState;
  profileId?: string;
  providerSessionId?: string;
  nativeBinding?:NativeBinding;
  execution?:{generation:number;attempt:number;leaseId?:string};
  executionRef?:ExecutionContextRef;
  nativeInvocationId?:string;
  turnObservation?:TurnObservation;
  nativeIdentityIssue?:string;
  processId?: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdapterEvent {
  type: "session.started" | "session.message" | "session.paused" | "session.resumed" | "session.cancelled" | "session.completed" | "session.failed" | "activity";
  sessionId: string;
  occurredAt: string;
  data: Record<string, unknown>;
}

export interface AdapterResult {
  sessionId: string;
  state: AdapterSessionState;
  summary: string;
  artifacts: Array<{ path: string; kind: string }>;
}

export interface NativeObserverContext {
  sessionId:string;runId:string;profileId:string;backendId:string;invocationId:string;
  generation?:number;attempt?:number;leaseId?:string;
}
export type NativeObserverBegin=(context:NativeObserverContext)=>(()=>boolean);
export type NativeEventSink=(event:NativeBindingEvent)=>void|Promise<void>;
export type AdapterStartOutcome={kind:"created";session:AdapterSession}|{kind:"not-created"|"unknown";code:string;diagnostic?:string};

export interface AdapterStartInput {
  runId:string;sessionId?:string;workspacePath:string;backendId?:string;prompt?:string;
  executionSelection?:ExecutionSelection;beforeSend?:()=>void;beforeCreate?:()=>void;execution?:AdapterSession["execution"];
  executionRef?:ExecutionContextRef;
}

/** Capture request facts before async preparation; never invent invocation counters. */
export function captureAdapterStartInput(input:AdapterStartInput):AdapterStartInput {
  const request={...input};
  const e=input.execution;
  if(e!==undefined){
    if(!e||!Number.isSafeInteger(e.generation)||e.generation<1||!Number.isSafeInteger(e.attempt)||e.attempt<1||e.leaseId!==undefined&&(typeof e.leaseId!=="string"||!e.leaseId||e.leaseId.length>240||Array.from(e.leaseId).some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127)))throw new AdapterStartError("not-created","INVALID_EXECUTION_CONTEXT","Invocation counters require the owning Run generation and attempt");
    request.execution={generation:e.generation,attempt:e.attempt,...(e.leaseId!==undefined?{leaseId:e.leaseId}:{})};
  }
  if(input.executionSelection)request.executionSelection=structuredClone(input.executionSelection);
  if(input.executionRef)request.executionRef=structuredClone(input.executionRef);
  return request;
}

export interface AgentAdapter {
  readonly interaction?:NativeInteractionPort;
  readonly manifest: AdapterManifest;
  readonly supportsExecutionSelection?: boolean;
  readonly supportsExecutionRef?: boolean;
  setNativeEventSink?(sink:NativeEventSink,onBegin:NativeObserverBegin):void;
  /** Existing configured invocation defaults only; this does not qualify native selection. */
  legacyInvocationDefaults?():{backendId:string;model?:string};
  modelCatalog?(context: ModelCatalogContext & {workspacePath:string;signal?:AbortSignal}): Promise<AccountModelCatalog>;
  start(input: AdapterStartInput): Promise<AdapterSession>;
  send(sessionId: string, message: string, beforeSend?:()=>void): Promise<AdapterEvent>;
  pause(sessionId: string, beforeSend?:()=>void): Promise<AdapterSession>;
  resume(sessionId: string, beforeSend?:()=>void): Promise<AdapterSession>;
  cancel(sessionId: string, beforeSend?:()=>void): Promise<AdapterSession>;
  status(sessionId: string): Promise<AdapterSession>;
  result(sessionId: string): Promise<AdapterResult>;
  usage?(sessionId: string): Promise<Record<string, unknown>>;
  /** Reads already owned native events only; never waits for an active turn or performs a provider query. */
  usageObservations?(sessionId:string):Promise<UsageObservationV1[]>;
  /** Independent owning-account read. Never creates a turn or infers Run cost. */
  accountQuota?(signal?:AbortSignal):Promise<AccountQuotaSnapshot>;
  /** Remote owning cache projection; its freshness and last success must not be restamped locally. */
  accountQuotaState?(signal?:AbortSignal):Promise<AccountQuotaState>;
  diagnostics?(sessionId: string): Promise<Record<string, unknown>>;
}

export class AdapterContractError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AdapterContractError";
  }
}

export class AdapterStartError extends AdapterContractError {
  constructor(readonly creationOutcome:"not-created"|"unknown",code:string,message:string){super(code,message);this.name="AdapterStartError";}
}
/** Produced only at the final local boundary, before invoking any native write. */
export class AdapterAdmissionError extends AdapterContractError {
  readonly dispatch="not-sent";
  constructor(code:string){super(code,"Native write admission rejected");this.name="AdapterAdmissionError";}
}
export function assertAdapterWriteAdmission(guard:(()=>void)|undefined):void {
  if(!guard)return;
  try{
    const outcome:unknown=guard();
    if(outcome!==undefined){void Promise.resolve(outcome).catch(()=>undefined);throw new AdapterAdmissionError("NATIVE_CAPABILITY_UNVERIFIED");}
  }catch(error){
    const code=(error as {code?:unknown})?.code;
    throw new AdapterAdmissionError(typeof code==="string"&&/^[A-Z][A-Z0-9_]{0,79}$/.test(code)?code:"NATIVE_WRITE_ADMISSION_REJECTED");
  }
}

export function assertAdapterStartAdmission(guard:(()=>void)|undefined):void {
  try{assertAdapterWriteAdmission(guard);}catch(error){throw startPreparationFailure(error);}
}

export function localStartFailure(error:unknown):unknown {
  const code=error&&typeof error==="object"&&"code" in error?error.code:undefined;
  return ["ENOENT","EACCES","ENOEXEC","EPERM"].includes(String(code))
    ? new AdapterStartError("not-created","SPAWN_FAILED",error instanceof Error?error.message:String(code))
    : error;
}

export function startPreparationFailure(error:unknown):AdapterStartError {
  return new AdapterStartError("not-created",error instanceof AdapterContractError?error.code:"START_PREPARATION_FAILED",error instanceof Error?error.message:"Agent preparation failed before creation");
}

function schemaProperties(schema: Record<string, unknown>): Record<string, unknown> {
  return schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)
    ? schema.properties as Record<string, unknown>
    : {};
}

export function validateManifest(manifest: AdapterManifest): AdapterManifest {
  if (manifest.apiVersion !== 1 || !manifest.id || !manifest.displayName) throw new AdapterContractError("INVALID_MANIFEST", "Manifest identity is incomplete");
  if (new Set(manifest.probes.map((probe) => probe.id)).size !== manifest.probes.length) throw new AdapterContractError("INVALID_MANIFEST", "Probe ids must be unique");
  if (new Set(manifest.backends.map((backend) => backend.id)).size !== manifest.backends.length) throw new AdapterContractError("INVALID_MANIFEST", "Backend ids must be unique");
  const properties = schemaProperties(manifest.configSchema);
  for (const field of manifest.secretFields) {
    if (!(field in properties)) throw new AdapterContractError("INVALID_MANIFEST", `Secret field ${field} is missing from config schema`);
    const ui = manifest.uiSchema[field];
    if (!ui || typeof ui !== "object" || (ui as Record<string, unknown>)["ui:widget"] !== "hidden") {
      throw new AdapterContractError("INVALID_MANIFEST", `Secret field ${field} must be hidden from ordinary forms`);
    }
  }
  return structuredClone(manifest);
}

export async function runAdapterContract(adapter: AgentAdapter): Promise<string[]> {
  const failures: string[] = [];
  try { validateManifest(adapter.manifest); } catch (error) { failures.push(error instanceof Error ? error.message : "invalid manifest"); }
  let session: AdapterSession | undefined;
  try {
    session = await adapter.start({ runId: "contract-run", workspacePath: "/contract/workspace", prompt: "hello" });
    if (session.state !== "RUNNING") failures.push("start must produce RUNNING session");
    const capabilities = new Set(adapter.manifest.backends.find((backend) => backend.id === session?.backendId)?.capabilities ?? []);
    if (capabilities.has("send") || capabilities.has("interactive-input")) {
      const event = await adapter.send(session.id, "continue");
      if (event.sessionId !== session.id) failures.push("send event must retain session identity");
    }
    const status = await adapter.status(session.id);
    if (status.id !== session.id) failures.push("status must retain session identity");
    if (capabilities.has("cancel")) {
      const cancelled = await adapter.cancel(session.id);
      if (cancelled.state !== "CANCELLED") failures.push("cancel must produce CANCELLED session");
    }
    const result = await adapter.result(session.id);
    if (result.sessionId !== session.id) failures.push("result must retain session identity");
    if (capabilities.has("cancel") && result.state !== "CANCELLED") failures.push("result must reflect terminal session");
  } catch (error) {
    failures.push(error instanceof Error ? error.message : "adapter contract failed");
  }
  return failures;
}
