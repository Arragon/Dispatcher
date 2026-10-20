import { isTerminalRunState, type CapabilitySupport, type RunState } from "./index.js";
import type { ExecutionSelection } from "./publication.js";

export type EvidenceLevel="documented"|"installed-probed"|"runtime-verified"|"ui-roundtrip-verified";
export type NativeSurface="desktop"|"ide"|"web"|"mobile"|"tui";
export type InteractionMode="compatible"|"native-session"|"native-gui";
export interface InteractionRequirement {version:1;profileId:string;backendId?:string;mode:InteractionMode;surface?:NativeSurface;executionLocation:ExecutionContextRef["kind"]}
export interface CapabilityEvidence {
  version:1;support:CapabilitySupport;level:EvidenceLevel;scopeFingerprint:string;
  reasonCode?:string;verifiedAt?:string;evidenceRef?:string;
}
const evidenceLevels:readonly EvidenceLevel[]=["documented","installed-probed","runtime-verified","ui-roundtrip-verified"];
export function assessInteractionCapability(evidence:CapabilityEvidence|undefined,scopeFingerprint:string,minimum:EvidenceLevel):{supported:boolean;code?:"NATIVE_CAPABILITY_UNVERIFIED"|"NATIVE_CAPABILITY_UNSUPPORTED"} {
  if(evidence?.support==="unsupported")return {supported:false,code:"NATIVE_CAPABILITY_UNSUPPORTED"};
  if(!evidence||evidence.version!==1||evidence.support!=="supported"||!scopeFingerprint||evidence.scopeFingerprint!==scopeFingerprint||!evidence.evidenceRef||!evidence.verifiedAt||!Number.isFinite(Date.parse(evidence.verifiedAt))||evidenceLevels.indexOf(evidence.level)<evidenceLevels.indexOf(minimum))return {supported:false,code:"NATIVE_CAPABILITY_UNVERIFIED"};
  return {supported:true};
}
export interface InteractionCapabilities {
  version:1;durableIdentity:CapabilityEvidence;historyRead:CapabilityEvidence;sameSessionContinue:CapabilityEvidence;
  liveSteer:CapabilityEvidence;interruptTurn:CapabilityEvidence;nativeApproval:CapabilityEvidence;
  observeExternalChanges:CapabilityEvidence;releaseControl:CapabilityEvidence;reclaimControl:CapabilityEvidence;
  restartReattach:CapabilityEvidence;surfaces:Partial<Record<NativeSurface,CapabilityEvidence>>;
}
export interface NativeBinding {
  version:1;product:string;region:string;profileId:string;backendId:string;runnerId:string;
  nativeStoreRef:string;nativeSessionId:string;nativeThreadId?:string;parentSessionId?:string;
  identityState:"bound"|"missing"|"deleted"|"unreachable";executionRefId:string;
}
export type ExecutionContextRef=
  |{version:1;id:string;kind:"managed-worktree";runnerId:string;repositoryId:string;workspaceId:string;pathRef:string;branch:string;baseRevision:string}
  |{version:1;id:string;kind:"provider-self-hosted";runnerId:string;environmentRef:string;workerRef:string;workspaceRef:string;mappingEvidenceRef:string}
  |{version:1;id:string;kind:"provider-cloud";organizationRef:string;environmentRef:string;repositoryId:string;baseRevision:string;artifactRef?:string};
export interface ExecutionBinding {profileId:string;providerId:string;backendId:string;runnerId:string;executionRef:ExecutionContextRef;nativeBinding?:NativeBinding}
export type BindingValidation={valid:true}|{valid:false;code:"MODEL_BINDING_DRIFT"|"EXECUTION_CONTEXT_DRIFT"};
export function isExecutionContextRef(value:unknown):value is ExecutionContextRef {
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const ref=value as ExecutionContextRef;
  const text=(value:unknown)=>typeof value==="string"&&value.length>0&&!value.includes("\0");
  if(ref.version!==1||!text(ref.id)||typeof ref.kind!=="string")return false;
  const keys:Record<ExecutionContextRef["kind"],string[]>={"managed-worktree":["version","id","kind","runnerId","repositoryId","workspaceId","pathRef","branch","baseRevision"],"provider-self-hosted":["version","id","kind","runnerId","environmentRef","workerRef","workspaceRef","mappingEvidenceRef"],"provider-cloud":["version","id","kind","organizationRef","environmentRef","repositoryId","baseRevision","artifactRef"]};
  if(!Object.hasOwn(keys,ref.kind)||Object.keys(ref).some(key=>!keys[ref.kind].includes(key)))return false;
  const required=keys[ref.kind].filter(key=>!["version","artifactRef"].includes(key));
  if(required.some(key=>!text((ref as unknown as Record<string,unknown>)[key])))return false;
  return !(ref.kind==="managed-worktree"&&ref.pathRef!==`workspace:${ref.workspaceId}`||ref.kind==="provider-cloud"&&ref.artifactRef!==undefined&&!text(ref.artifactRef));
}
export function validateExecutionBinding(binding:ExecutionBinding,selection:ExecutionSelection,context:{repositoryId:string;baseRevision:string}):BindingValidation {
  if(selection.version!==1||selection.runnerId!==binding.runnerId||!["explicit-model","native-default"].includes(selection.selectionType)||binding.profileId!==selection.profileId||binding.providerId!==selection.providerId||binding.backendId!==selection.backendId||binding.nativeBinding&&(binding.nativeBinding.profileId!==selection.profileId||binding.nativeBinding.backendId!==selection.backendId))return {valid:false,code:"MODEL_BINDING_DRIFT"};
  const ref=binding.executionRef;
  if(!isExecutionContextRef(ref))return {valid:false,code:"EXECUTION_CONTEXT_DRIFT"};
  if("runnerId" in ref&&ref.runnerId!==binding.runnerId||"repositoryId" in ref&&(ref.repositoryId!==context.repositoryId||ref.baseRevision!==context.baseRevision)||binding.nativeBinding&&(binding.nativeBinding.runnerId!==binding.runnerId||binding.nativeBinding.executionRefId!==ref.id))return {valid:false,code:"EXECUTION_CONTEXT_DRIFT"};
  return {valid:true};
}
export type ControlState="AUTOMATED"|"HANDOFF_REQUESTED"|"HUMAN"|"RECONCILING"|"CONFLICT";
export interface SessionControl {
  version:1;sessionId:string;activeRunId:string;state:ControlState;epoch:number;revision:number;
  handoffPrincipalId?:string;exclusion:"native-enforced"|"cooperative"|"none";
  lastObservationRef?:string;updatedAt:string;
}
export type ControlEvent=
  |{type:"request-handoff";principalId:string;at:string}
  |{type:"release-verified";evidence:ReleaseEvidence;at:string}
  |{type:"cancel-handoff"|"request-return"|"begin-reconcile"|"attention-timeout";at:string}
  |{type:"reconcile-verified";runTerminal:boolean;observationRef:string;at:string}
  |{type:"conflict";observationRef?:string;at:string};
export function transitionControl(current:SessionControl,event:ControlEvent,expectedRevision:number):SessionControl {
  if(current.revision!==expectedRevision)throw new SessionIdentityError("STALE_CONTROL_REVISION");
  if(current.version!==1||!Number.isSafeInteger(current.revision)||current.revision<1||!Number.isSafeInteger(current.epoch)||current.epoch<0||!Number.isFinite(Date.parse(event.at)))throw new SessionIdentityError("INVALID_CONTROL_RECORD");
  if(event.type==="attention-timeout")return structuredClone(current);
  let state:ControlState|undefined;
  switch(event.type){
    case "request-handoff":
      if(current.state==="AUTOMATED"&&event.principalId&&current.exclusion!=="none")state="HANDOFF_REQUESTED";
      break;
    case "release-verified":{
      if(current.state!=="HANDOFF_REQUESTED")break;
      const evidence=event.evidence;const observation=evidence.observation;
      if(!evidence.quiescent||evidence.pendingCommands!=="none"||evidence.exclusion!==current.exclusion||evidence.exclusion==="none"||evidence.lockReleased==="unknown"||evidence.exclusion==="native-enforced"&&evidence.lockReleased!=="confirmed"||observation.state!=="idle"||observation.pendingTools!=="none"||observation.pendingApprovals!=="none"||observation.nativeSessionId!==evidence.nativeSessionId)throw new SessionIdentityError("HANDOFF_NOT_QUIESCENT");
      state="HUMAN";break;
    }
    case "cancel-handoff":if(current.state==="HANDOFF_REQUESTED")state="RECONCILING";break;
    case "request-return":if(current.state==="HUMAN")state="RECONCILING";break;
    case "begin-reconcile":if(current.state==="CONFLICT")state="RECONCILING";break;
    case "reconcile-verified":
      if(current.state!=="RECONCILING")break;
      if(event.runTerminal)throw new SessionIdentityError("TERMINAL_RUN");
      if(!event.observationRef)throw new SessionIdentityError("NATIVE_STATE_UNKNOWN");
      state="AUTOMATED";break;
    case "conflict":state="CONFLICT";break;
  }
  if(!state)throw new SessionIdentityError("INVALID_CONTROL_TRANSITION");
  if(current.epoch===Number.MAX_SAFE_INTEGER||current.revision===Number.MAX_SAFE_INTEGER)throw new SessionIdentityError("CONTROL_VERSION_EXHAUSTED");
  const next:SessionControl={...structuredClone(current),state,epoch:current.epoch+1,revision:current.revision+1,updatedAt:event.at};
  if(event.type==="request-handoff")next.handoffPrincipalId=event.principalId;
  if(event.type==="release-verified")next.lastObservationRef=event.evidence.observation.id;
  if(event.type==="reconcile-verified"){next.lastObservationRef=event.observationRef;delete next.handoffPrincipalId;}
  if(event.type==="conflict"&&event.observationRef)next.lastObservationRef=event.observationRef;
  return next;
}
export type InteractionOperation="history"|"access"|"collect"|"continue"|"steer"|"approval"|"reject-approval"|"verify"|"deliver"|"cancel"|"interrupt";
export interface InteractionSnapshot {control:SessionControl;run:{id:string;sessionId:string;state:RunState};nativeState:NativeObservation["state"];humanCancelConfirmed?:boolean}
export type GuardDecision={allowed:true}|{allowed:false;code:string};
export function canMutate(snapshot:InteractionSnapshot,operation:InteractionOperation):GuardDecision {
  if(["history","access","collect"].includes(operation))return {allowed:true};
  const {control,run}=snapshot;
  if(isTerminalRunState(run.state))return {allowed:false,code:"TERMINAL_RUN"};
  if(control.version!==1||control.activeRunId!==run.id||control.sessionId!==run.sessionId)return {allowed:false,code:"NATIVE_IDENTITY_CHANGED"};
  if(operation==="cancel")return control.state==="HUMAN"&&!snapshot.humanCancelConfirmed?{allowed:false,code:"HUMAN_CANCEL_CONFIRMATION_REQUIRED"}:{allowed:true};
  if(operation==="reject-approval"&&control.state==="HANDOFF_REQUESTED")return {allowed:true};
  if(control.state!=="AUTOMATED")return {allowed:false,code:"NATIVE_WRITE_LOCKED"};
  if(operation==="interrupt")return snapshot.nativeState==="running"&&["ACTIVE","WAITING_USER"].includes(run.state)?{allowed:true}:{allowed:false,code:"SESSION_NOT_RUNNING"};
  if(snapshot.nativeState==="unknown"||snapshot.nativeState==="deleted"||snapshot.nativeState==="unreachable")return {allowed:false,code:"NATIVE_STATE_UNKNOWN"};
  if(operation!=="steer"&&operation!=="approval"&&operation!=="reject-approval"&&snapshot.nativeState!=="idle")return {allowed:false,code:"SESSION_BUSY"};
  if(operation==="steer"&&snapshot.nativeState!=="running")return {allowed:false,code:"SESSION_NOT_RUNNING"};
  if(["continue","steer","approval","reject-approval"].includes(operation)&&!["ACTIVE","WAITING_USER"].includes(run.state)||operation==="verify"&&run.state!=="VERIFYING"||operation==="deliver"&&run.state!=="DELIVERING")return {allowed:false,code:"RUN_PHASE_CONFLICT"};
  return {allowed:true};
}
export interface MutationFence {
  runId:string;sessionId:string;expectedTaskRevision:number;expectedCurrentRunId:string;
  expectedControlRevision:number;expectedControlEpoch:number;generation:number;leaseId:string;commandId:string;
}
export type NativeProcessState="running"|"completed"|"missing"|"unknown";
export type NativeSessionReadability="readable"|"deleted"|"unreachable"|"unknown";
export interface NativeReadEvidence {
  requestId:string;observerEpoch:string;observerGeneration:number;sequence:number;
  processState:NativeProcessState;readability:NativeSessionReadability;
  reasonCode?:string;sourceObservationId?:string;
}
export interface NativeObservation {
  version:1;id:string;nativeSessionId:string;nativeThreadId?:string;scopeFingerprint:string;observedAt:string;
  serverEpoch?:string;state:"running"|"idle"|"unknown"|"deleted"|"unreachable";
  activeTurnId?:string;pendingTools:"none"|"present"|"unknown";pendingApprovals:"none"|"present"|"unknown";
  historyRevision?:string;historyMode:"native-revision"|"snapshot-only"|"unknown";
  reportedModel?:{nativeSelectionId:string;reasoning?:string};executionRefId?:string;permissionFingerprint?:string;
  readability?:NativeSessionReadability;read?:NativeReadEvidence;
}
export interface NativeQuiescenceRuntime {
 version:1;binding:NativeBinding;scopeFingerprint:string;observationRef:string;
 pendingCommands:"none"|"present"|"unknown";backgroundTools:"none"|"present"|"unknown";evidence:CapabilityEvidence;
 readProof:{kind:"live-native-read";requestId:string;evidence:CapabilityEvidence};
 processScope:{kind:"native-service";state:"quiescent"|"active"|"unknown";evidence:CapabilityEvidence}|{kind:"owned-process-group";state:"empty"|"present"|"unknown";evidence:CapabilityEvidence};
 host:{id:string;ownership:"owned"|"external";shared:boolean|"unknown";releaseBoundary:"session"|"host"|"unknown"};
}
export interface HistoryRequest {cursor?:string;limit:number}
export interface NativeHistoryEntry {id:string;kind:"user"|"assistant"|"tool"|"approval"|"summary"|"other";text:string;occurredAt?:string;turnId?:string;truncated?:boolean}
export interface HistoryPage {
  version:1;nativeSessionId:string;entries:NativeHistoryEntry[];nextCursor?:string;
  completeness:"complete"|"partial"|"unknown";range:"native-history"|"retained-range"|"summary-only";
  state:"available"|"deleted"|"unreachable"|"unsupported"|"unknown";source:string;
  gaps?:string[];truncation?:string;
}
export interface NativeAccessDescriptor {
  version:1;id:string;surface:NativeSurface;runnerId:string;nativeSessionId:string;
  availability:"verified"|"unverified"|"unsupported";reasonCode?:string;
  action:{kind:"web-url";url:string}|{kind:"local-launch";launcherId:string;args:string[]}|{kind:"instructions";text:string};
}
export interface NativeCommandReceipt {version:1;commandId:string;state:"accepted"|"queued"|"rejected"|"unknown";nativeRequestId?:string;nativeMessageId?:string;nativeTurnId?:string;code?:string}
export interface NativeTurnFact {
  state:"received"|"running"|"completed"|"failed"|"waiting";observedAt:string;
  nativeSessionId?:string;nativeRequestId?:string;nativeMessageId?:string;nativeTurnId?:string;
}
export interface TurnObservation extends Omit<NativeTurnFact,"nativeSessionId"> {
  id:string;invocationId:string;source:"native"|"dispatcher";
}
// Duplicate receipt events cannot rewind a running or terminal invocation.
export function mergeTurnObservation(current:TurnObservation|undefined,incoming:TurnObservation):TurnObservation {
  if(!current||current.invocationId!==incoming.invocationId)return structuredClone(incoming);
  const terminal=["completed","failed"].includes(current.state);
  const rewind=current.state!=="received"&&incoming.state==="received";
  if(terminal||rewind||Date.parse(incoming.observedAt)<Date.parse(current.observedAt))return structuredClone(current);
  return {...current,...incoming};
}
export interface NativeBindingEvent {
  version:1;id:string;sessionId:string;runId:string;profileId:string;backendId:string;
  generation?:number;attempt?:number;leaseId?:string;nativeSessionId?:string;
  nativeBinding?:NativeBinding;turn:TurnObservation;
}
export interface InterruptRequest {commandId:string;fence:MutationFence;activeTurnId?:string}
export interface ReleaseRequest {commandId:string;fence:MutationFence;settlePolicy:"wait"|"interrupt"}
export interface ReleaseEvidence {version:1;nativeSessionId:string;quiescent:boolean;pendingCommands:"none"|"present"|"unknown";lockReleased:"confirmed"|"unsupported"|"unknown";exclusion:SessionControl["exclusion"];observation:NativeObservation;reasonCode?:string}
export interface AttachRequest {commandId:string;fence:MutationFence;executionSelection:ExecutionSelection;executionRef:ExecutionContextRef}
export interface AttachEvidence {version:1;nativeSessionId:string;attached:boolean;method:"same-session"|"unsupported"|"unknown";observation:NativeObservation;reasonCode?:string}
export interface NativeResponse {commandId:string;fence:MutationFence;requestId:string;type:"permission"|"input";expectedRevision:string;response:{kind:"reject"}|{kind:"allow";optionId:string}|{kind:"text";text:string}}

export class SessionIdentityError extends Error {
  constructor(readonly code:string){super(code);this.name="SessionIdentityError";}
}
export function nativeBindingKey(binding:NativeBinding):string {return JSON.stringify([binding.product,binding.region,binding.nativeStoreRef,binding.nativeSessionId,binding.nativeThreadId??""]);}
export function assertSessionOwner(binding:NativeBinding,profileId:string):void {if(binding.profileId!==profileId)throw new SessionIdentityError("SESSION_OWNER_MISMATCH");}
export type BindingResult={state:"bound"|"missing"|"deleted"|"unreachable";binding?:NativeBinding}|{state:"unbound"|"conflict";code:string};
export function normalizeNativeBinding(
  session:{id:string;profileId:string;nativeSessionId?:string;nativeBinding?:NativeBinding},
  adapter:{id:string;runId:string;profileId?:string;backendId:string;providerSessionId?:string;nativeBinding?:NativeBinding},
  run:{id:string;profileId:string;runnerId:string;sessionId:string;providerSessionId?:string},
):BindingResult {
  if(session.id.startsWith("unstarted:")||adapter.id.startsWith("unstarted:")||[session.nativeSessionId,adapter.providerSessionId,run.providerSessionId].some(id=>id?.startsWith("unstarted:")))return {state:"unbound",code:"NATIVE_SESSION_UNBOUND"};
  if(session.id!==adapter.id||run.sessionId!==session.id||adapter.runId!==run.id)return {state:"conflict",code:"NATIVE_IDENTITY_CHANGED"};
  if(session.profileId!==run.profileId||adapter.profileId!==undefined&&adapter.profileId!==session.profileId)return {state:"conflict",code:"SESSION_OWNER_MISMATCH"};
  const binding=session.nativeBinding??adapter.nativeBinding;
  if(!binding)return {state:"missing"};
  if(binding.profileId!==session.profileId||adapter.nativeBinding&&adapter.nativeBinding.profileId!==session.profileId)return {state:"conflict",code:"SESSION_OWNER_MISMATCH"};
  const bindings=[session.nativeBinding,adapter.nativeBinding].filter((value):value is NativeBinding=>value!==undefined);
  if(bindings.some(value=>value.version!==1||!value.nativeStoreRef||!value.nativeSessionId||!value.executionRefId||value.nativeSessionId.startsWith("unstarted:")||value.backendId!==adapter.backendId||value.runnerId!==run.runnerId||nativeBindingKey(value)!==nativeBindingKey(binding)||value.executionRefId!==binding.executionRefId||value.parentSessionId!==binding.parentSessionId)||[session.nativeSessionId,adapter.providerSessionId,run.providerSessionId].some(id=>id!==undefined&&id!==binding.nativeSessionId))return {state:"conflict",code:"NATIVE_IDENTITY_CHANGED"};
  return {state:binding.identityState,binding:structuredClone(binding)};
}
