import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import { assessInteractionCapability, type CapabilityEvidence, type NativeBinding, type NativeObservation, type ReleaseEvidence, type ReleaseRequest, type NativeQuiescenceRuntime } from "@dispatcher/domain";
import type { NativeInteractionPort } from "@dispatcher/adapters";

type Pending="none"|"present"|"unknown";
export type { NativeQuiescenceRuntime } from "@dispatcher/domain";
export interface QuiescenceEvidence {version:1;nativeSessionId:string;scopeFingerprint:string;observationRef:string;quiescent:boolean;pendingCommands:Pending;reasonCode?:string}
export interface NativeReleaseSource {
 binding:NativeBinding;scopeFingerprint:string;
 port:Pick<NativeInteractionPort,"capabilities"|"release">;
 inspectQuiescence(binding:NativeBinding,request:{signal:AbortSignal;requestId:string}):Promise<{observation:NativeObservation;runtime:NativeQuiescenceRuntime}>;
}
export interface NativeControlReleaseResult extends ReleaseEvidence {dispatch:"not-sent"|"acknowledged"|"unknown";readProof?:{requestId:string;evidenceRef:string}}
const qualified=(evidence:CapabilityEvidence|undefined,scope:string)=>assessInteractionCapability(evidence,scope,"runtime-verified").supported;
const validId=(value:unknown):value is string=>typeof value==="string"&&value.length>0&&value.length<=512&&Array.from(value).every(c=>c.charCodeAt(0)>=32)&&!/(?:\b(?:[a-z][a-z0-9]*[-_])*(?:token|secret|password|credential|authorization|api[-_]?key|private[-_]?key)["']?\s*[:=]|\bBearer\s|\b(?:sk|ghp|github_pat|xox[baprs])[-_][\w-]{8,})/i.test(value);
function cleanObservation(value:NativeObservation):NativeObservation|undefined {
 if(!value||value.version!==1||![value.id,value.nativeSessionId,value.scopeFingerprint].every(validId)||!["running","idle","unknown","deleted","unreachable"].includes(value.state)||![value.pendingTools,value.pendingApprovals].every(v=>["none","present","unknown"].includes(v))||!Number.isFinite(Date.parse(value.observedAt))||!["native-revision","snapshot-only","unknown"].includes(value.historyMode)||[value.nativeThreadId,value.serverEpoch,value.activeTurnId,value.historyRevision,value.executionRefId,value.permissionFingerprint].some(v=>v!==undefined&&!validId(v)))return undefined;
 const read=value.read;
 if(read&&(![read.requestId,read.observerEpoch].every(validId)||read.sourceObservationId!==undefined&&!validId(read.sourceObservationId)||![read.observerGeneration,read.sequence].every(n=>Number.isSafeInteger(n)&&n>=1)||!["running","completed","missing","unknown"].includes(read.processState)||!["readable","deleted","unreachable","unknown"].includes(read.readability)))return undefined;
 if(value.readability!==undefined&&!["readable","deleted","unreachable","unknown"].includes(value.readability)||value.reportedModel&&(!validId(value.reportedModel.nativeSelectionId)||value.reportedModel.reasoning!==undefined&&!validId(value.reportedModel.reasoning)))return undefined;
 return {version:1,id:value.id,nativeSessionId:value.nativeSessionId,scopeFingerprint:value.scopeFingerprint,observedAt:value.observedAt,state:value.state,pendingTools:value.pendingTools,pendingApprovals:value.pendingApprovals,historyMode:value.historyMode,
 ...(value.nativeThreadId?{nativeThreadId:value.nativeThreadId}:{}),...(value.serverEpoch?{serverEpoch:value.serverEpoch}:{}),...(value.activeTurnId?{activeTurnId:value.activeTurnId}:{}),...(value.historyRevision?{historyRevision:value.historyRevision}:{}),...(value.executionRefId?{executionRefId:value.executionRefId}:{}),...(value.permissionFingerprint?{permissionFingerprint:value.permissionFingerprint}:{}),...(value.readability?{readability:value.readability}:{}),...(value.reportedModel?{reportedModel:{nativeSelectionId:value.reportedModel.nativeSelectionId,...(value.reportedModel.reasoning?{reasoning:value.reportedModel.reasoning}:{})}}:{}),...(read?{read:{requestId:read.requestId,observerEpoch:read.observerEpoch,observerGeneration:read.observerGeneration,sequence:read.sequence,processState:read.processState,readability:read.readability,...(read.sourceObservationId?{sourceObservationId:read.sourceObservationId}:{})}}:{})};
}
/** The runtime snapshot is a qualified backend probe, never a claim from an HTTP caller. */
export function verifyQuiescence(input:NativeObservation,runtime:NativeQuiescenceRuntime):QuiescenceEvidence {
 const binding=runtime?.binding;const observation=cleanObservation(input);
 const result=(quiescent:boolean,reasonCode?:string):QuiescenceEvidence=>({version:1,nativeSessionId:validId(binding?.nativeSessionId)?binding.nativeSessionId:"unknown",scopeFingerprint:validId(runtime?.scopeFingerprint)?runtime.scopeFingerprint:"unknown",observationRef:observation?.id??"unknown",quiescent,pendingCommands:["none","present","unknown"].includes(runtime?.pendingCommands)?runtime.pendingCommands:"unknown",...(reasonCode?{reasonCode}:{})});
 if(runtime?.version!==1||!binding||binding.identityState!=="bound"||!observation||observation.nativeSessionId!==binding.nativeSessionId||observation.nativeThreadId!==binding.nativeThreadId||observation.executionRefId!==binding.executionRefId||observation.scopeFingerprint!==runtime.scopeFingerprint||runtime.observationRef!==observation.id||!qualified(runtime.evidence,runtime.scopeFingerprint))return result(false,"NATIVE_QUIESCENCE_UNVERIFIED");
 if(observation.state!=="idle"||observation.activeTurnId||observation.pendingTools!=="none"||observation.pendingApprovals!=="none"||runtime.pendingCommands!=="none"||runtime.backgroundTools!=="none")return result(false,"NATIVE_SESSION_NOT_QUIESCENT");
 if(runtime.readProof?.kind!=="live-native-read"||!validId(runtime.readProof.requestId)||!qualified(runtime.readProof.evidence,runtime.scopeFingerprint)||!validId(runtime.readProof.evidence.evidenceRef)||!observation.read||observation.read.requestId!==observation.id||observation.read.readability!=="readable"||observation.readability!==undefined&&observation.readability!=="readable")return result(false,"NATIVE_QUIESCENCE_UNVERIFIED");
 const scope=runtime.processScope;
 if(!scope||!qualified(scope.evidence,runtime.scopeFingerprint)||!(scope.kind==="native-service"&&scope.state==="quiescent"||scope.kind==="owned-process-group"&&scope.state==="empty"))return result(false,"NATIVE_PROCESS_SCOPE_UNVERIFIED");
 return result(true);
}
class ReleaseFailure extends Error {constructor(readonly code:string){super(code);}}
/** One bounded release attempt. Late reads cannot start a release after its timeout. */
export async function releaseNativeControl(ref:NativeBinding,mode:ReleaseEvidence["exclusion"],requestInput:ReleaseRequest,source:NativeReleaseSource,assertCurrent:()=>void,timeoutMs=5_000):Promise<NativeControlReleaseResult> {
 const binding=structuredClone(ref);const request=structuredClone(requestInput);const scope=source.scopeFingerprint;
 const port=source.port;const releaseMethod=port.release;const inspectMethod=source.inspectQuiescence;
 const abort=new AbortController();let closed=false;let invoked=false;let acknowledged=false;let timer:ReturnType<typeof setTimeout>|undefined;
 const fallbackObservation:NativeObservation={version:1,id:validId(request.commandId)?request.commandId:"unknown",nativeSessionId:validId(binding.nativeSessionId)?binding.nativeSessionId:"unknown",...(validId(binding.nativeThreadId)?{nativeThreadId:binding.nativeThreadId}:{}),scopeFingerprint:validId(scope)?scope:"unknown",observedAt:new Date().toISOString(),state:"unknown",pendingTools:"unknown",pendingApprovals:"unknown",historyMode:"unknown",...(validId(binding.executionRefId)?{executionRefId:binding.executionRefId}:{})};
 const failure=(reasonCode:string):NativeControlReleaseResult=>({version:1,nativeSessionId:fallbackObservation.nativeSessionId,quiescent:false,pendingCommands:"unknown",lockReleased:"unknown",exclusion:["native-enforced","cooperative"].includes(mode)?mode:"none",observation:fallbackObservation,dispatch:acknowledged?"acknowledged":invoked?"unknown":"not-sent",reasonCode});
 const guard=()=>{if(closed)throw new ReleaseFailure("NATIVE_RELEASE_TIMEOUT");assertCurrent();if(!isDeepStrictEqual(source.binding,binding)||source.scopeFingerprint!==scope||source.port!==port||port.release!==releaseMethod||source.inspectQuiescence!==inspectMethod)throw new ReleaseFailure("NATIVE_RELEASE_SCOPE_CHANGED");};
 const work=async():Promise<NativeControlReleaseResult>=>{
  guard();
  if(binding.version!==1||binding.identityState!=="bound"||!["native-enforced","cooperative"].includes(mode)||![binding.product,binding.region,binding.profileId,binding.backendId,binding.runnerId,binding.nativeStoreRef,binding.nativeSessionId,binding.executionRefId,scope].every(validId)||[binding.nativeThreadId,binding.parentSessionId].some(id=>id!==undefined&&!validId(id))||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30_000||!request.fence||request.commandId!==request.fence.commandId||![request.fence.runId,request.fence.sessionId,request.fence.expectedCurrentRunId,request.fence.leaseId].every(validId)||![request.fence.generation,request.fence.expectedTaskRevision,request.fence.expectedControlRevision,request.fence.expectedControlEpoch].every(n=>Number.isSafeInteger(n)&&n>=1)||!validId(request.commandId)||request.commandId.length>200||!["wait","interrupt"].includes(request.settlePolicy))throw new ReleaseFailure("INVALID_NATIVE_RELEASE");
  const release=releaseMethod?.bind(port);const inspect=inspectMethod.bind(source);
  if(!release)throw new ReleaseFailure("NATIVE_CAPABILITY_UNVERIFIED");
  const qualifyRelease=()=>{const capabilities=port.capabilities();if(capabilities?.version!==1||!qualified(capabilities.releaseControl,scope))throw new ReleaseFailure("NATIVE_CAPABILITY_UNVERIFIED");guard();};
  qualifyRelease();
  const inspectFresh=async()=>{const requestId=randomUUID();const snapshot=structuredClone(await inspect(structuredClone(binding),{signal:abort.signal,requestId}));guard();qualifyRelease();if(snapshot.runtime?.readProof?.requestId!==requestId)throw new ReleaseFailure("NATIVE_READ_FRESHNESS_UNVERIFIED");return snapshot;};
  guard();
  const before=await inspectFresh();guard();
  if(!isDeepStrictEqual(before.runtime.binding,binding)||before.runtime.scopeFingerprint!==scope)throw new ReleaseFailure("NATIVE_RELEASE_SCOPE_CHANGED");
  const quiet=verifyQuiescence(before.observation,before.runtime);if(!quiet.quiescent)throw new ReleaseFailure(quiet.reasonCode!);
  const host=before.runtime.host;
  if(!host||!validId(host.id)||!["owned","external"].includes(host.ownership)||![false,true,"unknown"].includes(host.shared)||host.releaseBoundary!=="session"&&!(host.releaseBoundary==="host"&&host.ownership==="owned"&&host.shared===false))throw new ReleaseFailure("NATIVE_HOST_RELEASE_UNSAFE");
  qualifyRelease();guard();invoked=true;const raw=await release(structuredClone(binding),structuredClone(request));acknowledged=true;guard();qualifyRelease();
  if(!raw||raw.version!==1||raw.nativeSessionId!==binding.nativeSessionId||raw.exclusion!==mode||!raw.quiescent||raw.pendingCommands!=="none"||!["confirmed","unsupported","unknown"].includes(raw.lockReleased)||mode==="native-enforced"&&raw.lockReleased!=="confirmed"||mode==="cooperative"&&raw.lockReleased==="unknown"||!cleanObservation(raw.observation)||raw.observation.nativeSessionId!==binding.nativeSessionId||raw.observation.nativeThreadId!==binding.nativeThreadId||raw.observation.scopeFingerprint!==scope||raw.observation.executionRefId!==binding.executionRefId||raw.observation.state!=="idle"||raw.observation.activeTurnId||raw.observation.pendingTools!=="none"||raw.observation.pendingApprovals!=="none")throw new ReleaseFailure("NATIVE_RELEASE_EVIDENCE_INVALID");
  const after=await inspectFresh();guard();
  if(!isDeepStrictEqual(after.runtime.binding,binding)||after.runtime.scopeFingerprint!==scope||!isDeepStrictEqual(after.runtime.host,before.runtime.host))throw new ReleaseFailure("NATIVE_RELEASE_SCOPE_CHANGED");
  const verified=verifyQuiescence(after.observation,after.runtime);if(!verified.quiescent)throw new ReleaseFailure(verified.reasonCode!);
  const priorRead=before.observation.read!;const nextRead=after.observation.read!;
  if(after.observation.id===before.observation.id||nextRead.observerGeneration<priorRead.observerGeneration||nextRead.observerGeneration===priorRead.observerGeneration&&(nextRead.observerEpoch!==priorRead.observerEpoch||nextRead.sequence<=priorRead.sequence))throw new ReleaseFailure("STALE_NATIVE_RELEASE_READ");
  return {version:1,nativeSessionId:binding.nativeSessionId,quiescent:true,pendingCommands:"none",lockReleased:mode==="native-enforced"?"confirmed":"unsupported",exclusion:mode,observation:cleanObservation(after.observation)!,dispatch:"acknowledged",readProof:{requestId:after.runtime.readProof.requestId,evidenceRef:after.runtime.readProof.evidence.evidenceRef!}};
 };
 try{return await Promise.race([work(),new Promise<NativeControlReleaseResult>(resolve=>{timer=setTimeout(()=>{closed=true;abort.abort();resolve(failure("NATIVE_RELEASE_TIMEOUT"));},Number.isSafeInteger(timeoutMs)&&timeoutMs>0?Math.min(timeoutMs,30_000):1);})]);}
 catch(error){return failure(error instanceof ReleaseFailure?error.code:"NATIVE_RELEASE_FAILED");}
 finally{closed=true;abort.abort();if(timer)clearTimeout(timer);}
}

export { validId as isSafeNativeMetadataId, cleanObservation as normalizeQuiescenceObservation };
