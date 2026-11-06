import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { assessInteractionCapability, isNativeAccountFingerprint, type CapabilityEvidence, type DriftReport, type ExecutionContextRef, type NativeBinding, type NativeObservation } from "@dispatcher/domain";
import { isSafeNativeMetadataId, normalizeQuiescenceObservation, verifyQuiescence, type NativeQuiescenceRuntime } from "./native-quiescence.js";
import type { NativeHistoryRead } from "./native-event-reconcile.js";
export interface NativeReclaimProbe {
 observation:NativeObservation;runtime:NativeQuiescenceRuntime;history:NativeHistoryRead;
 workspace:{state:"available"|"unknown"|"unreachable";executionRef:ExecutionContextRef;headRevision:string;treeRef:string;dirty:"clean"|"dirty"|"unknown";fingerprint:string;evidence:CapabilityEvidence};
 resource:{state:"available"|"blocked"|"unknown";evidence:CapabilityEvidence};
 account?:{state:"reported";fingerprint:string;requestId:string;evidence:CapabilityEvidence}|{state:"unknown"};
}
export interface NativeReclaimSource {binding:NativeBinding;scopeFingerprint:string;capability:CapabilityEvidence;inspectReclaim(binding:NativeBinding,request:{signal:AbortSignal;requestId:string}):Promise<NativeReclaimProbe>}
export interface ReclaimReport {
 version:1;id:string;ready:boolean;code?:string;binding:NativeBinding;scopeFingerprint:string;
 observation?:NativeObservation;history?:{state:"available";completeness:"complete";entries:Array<{id:string;kind:NativeHistoryRead["page"]["entries"][number]["kind"];turnId?:string}>};
 workspace?:Omit<NativeReclaimProbe["workspace"],"evidence">;readProof?:{requestId:string;evidenceRef:string};
 account?:{state:"reported";fingerprint:string}|{state:"unknown"};drift?:DriftReport;
}
const qualified=(e:CapabilityEvidence|undefined,scope:string)=>assessInteractionCapability(e,scope,"runtime-verified").supported&&isSafeNativeMetadataId(e?.evidenceRef);
class ReclaimFailure extends Error {constructor(readonly code:string){super(code);}}
/** A bounded read-only inspection. No attach, resume, input, approval or queue-drain callable is accepted. */
export async function reconcileForReclaim(ref:NativeBinding,executionRef:ExecutionContextRef,source:NativeReclaimSource,assertCurrent:()=>void,timeoutMs=5_000):Promise<ReclaimReport> {
 const safe=(v:unknown)=>isSafeNativeMetadataId(v)?v:"unknown";
 const binding:NativeBinding={version:1,product:safe(ref.product),region:safe(ref.region),profileId:safe(ref.profileId),backendId:safe(ref.backendId),runnerId:safe(ref.runnerId),nativeStoreRef:safe(ref.nativeStoreRef),nativeSessionId:safe(ref.nativeSessionId),executionRefId:safe(ref.executionRefId),identityState:["bound","missing","deleted","unreachable"].includes(ref.identityState)?ref.identityState:"unreachable",...(isSafeNativeMetadataId(ref.nativeThreadId)?{nativeThreadId:ref.nativeThreadId}:{}),...(isSafeNativeMetadataId(ref.parentSessionId)?{parentSessionId:ref.parentSessionId}:{})};const execution=structuredClone(executionRef);const scope=source.scopeFingerprint;const inspect=source.inspectReclaim;const abort=new AbortController();const reportId=randomUUID();let closed=false;let timer:ReturnType<typeof setTimeout>|undefined;
 const failure=(code:string):ReclaimReport=>({version:1,id:reportId,ready:false,code,binding,scopeFingerprint:safe(scope)});
 const guard=()=>{if(closed)throw new ReclaimFailure("NATIVE_RECLAIM_TIMEOUT");assertCurrent();if(!isDeepStrictEqual(source.binding,binding)||source.scopeFingerprint!==scope||source.inspectReclaim!==inspect)throw new ReclaimFailure("NATIVE_RECLAIM_SCOPE_CHANGED");if(!qualified(source.capability,scope))throw new ReclaimFailure("NATIVE_CAPABILITY_UNVERIFIED");};
 const work=async():Promise<ReclaimReport>=>{
  guard();if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30_000||!isSafeNativeMetadataId(scope)||binding.version!==1||binding.identityState!=="bound")throw new ReclaimFailure("INVALID_NATIVE_RECLAIM");
  const requestId=randomUUID();const probe=structuredClone(await inspect.call(source,structuredClone(binding),{signal:abort.signal,requestId}));guard();
  const observation=normalizeQuiescenceObservation(probe.observation);const runtime=probe.runtime;
  if(!observation||!isDeepStrictEqual(runtime?.binding,binding)||runtime.scopeFingerprint!==scope||runtime.readProof?.requestId!==requestId)throw new ReclaimFailure("NATIVE_RECLAIM_READ_UNVERIFIED");
  const quiet=verifyQuiescence(observation,runtime);if(!quiet.quiescent)throw new ReclaimFailure(quiet.reasonCode??"NATIVE_RECLAIM_NOT_QUIESCENT");
  const history=probe.history;const read=observation.read!;
  if(!history||history.requestedCursor!==undefined||!Number.isSafeInteger(history.gapGeneration)||history.gapGeneration<1||!isDeepStrictEqual(history.binding,binding)||history.scopeFingerprint!==scope||history.requestId!==observation.id||history.observerEpoch!==read.observerEpoch||history.observerGeneration!==read.observerGeneration||history.sequence!==read.sequence||history.page?.version!==1||history.page.nativeSessionId!==binding.nativeSessionId||history.page.state!=="available"||history.page.completeness!=="complete"||history.page.range!=="native-history"||history.page.nextCursor!==undefined||history.page.gaps!==undefined&&(!Array.isArray(history.page.gaps)||history.page.gaps.length>0)||history.page.truncation!==undefined||!Array.isArray(history.page.entries)||history.page.entries.length>100||history.page.entries.some(e=>e.truncated===true||!isSafeNativeMetadataId(e.id)||!["user","assistant","tool","approval","summary","other"].includes(e.kind)||[e.turnId].some(v=>v!==undefined&&!isSafeNativeMetadataId(v))))throw new ReclaimFailure("NATIVE_RECLAIM_HISTORY_UNVERIFIED");
  const workspace=probe.workspace;
  if(!workspace||workspace.state!=="available"||!isDeepStrictEqual(workspace.executionRef,execution)||!["clean","dirty"].includes(workspace.dirty)||![workspace.headRevision,workspace.treeRef,workspace.fingerprint].every(isSafeNativeMetadataId)||!qualified(workspace.evidence,scope))throw new ReclaimFailure("EXECUTION_CONTEXT_DRIFT");
  if(!probe.resource||probe.resource.state!=="available"||!qualified(probe.resource.evidence,scope))throw new ReclaimFailure(probe.resource?.state==="blocked"?"RESOURCE_BLOCKED":"RESOURCE_STATE_UNKNOWN");
  if(!observation.reportedModel||!observation.permissionFingerprint)throw new ReclaimFailure("NATIVE_RECLAIM_CONTEXT_UNVERIFIED");
  const a=probe.account;const account:ReclaimReport["account"]=a?.state==="reported"&&isNativeAccountFingerprint(a.fingerprint)&&a.requestId===requestId&&qualified(a.evidence,scope)?{state:"reported",fingerprint:a.fingerprint}:{state:"unknown"};
  return {version:1,id:reportId,ready:true,binding,scopeFingerprint:scope,observation,account,history:{state:"available",completeness:"complete",entries:history.page.entries.map(e=>({id:e.id,kind:e.kind,...(e.turnId?{turnId:e.turnId}:{})}))},workspace:{state:"available",executionRef:execution,headRevision:workspace.headRevision,treeRef:workspace.treeRef,dirty:workspace.dirty,fingerprint:workspace.fingerprint},readProof:{requestId,evidenceRef:runtime.readProof.evidence.evidenceRef!}};
 };
 try{return await Promise.race([work(),new Promise<ReclaimReport>(resolve=>{timer=setTimeout(()=>{closed=true;abort.abort();resolve(failure("NATIVE_RECLAIM_TIMEOUT"));},Number.isSafeInteger(timeoutMs)&&timeoutMs>0?Math.min(timeoutMs,30_000):1);})]);}
 catch(error){return failure(error instanceof ReclaimFailure?error.code:"NATIVE_RECLAIM_READ_FAILED");}
 finally{closed=true;abort.abort();if(timer)clearTimeout(timer);}
}
/** Compared after user confirmation. Read provenance/counters may advance; reviewed native/code facts may not. */
export function reclaimFingerprint(report:ReclaimReport):unknown {
 const o=report.observation;return {binding:report.binding,scopeFingerprint:report.scopeFingerprint,workspace:report.workspace,history:report.history,account:report.account??{state:"unknown"},observation:o?{nativeSessionId:o.nativeSessionId,nativeThreadId:o.nativeThreadId,state:o.state,activeTurnId:o.activeTurnId,pendingTools:o.pendingTools,pendingApprovals:o.pendingApprovals,serverEpoch:o.serverEpoch,historyRevision:o.historyRevision,historyMode:o.historyMode,executionRefId:o.executionRefId,reportedModel:o.reportedModel,permissionFingerprint:o.permissionFingerprint}:undefined};
}
