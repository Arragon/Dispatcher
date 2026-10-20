import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { assessInteractionCapability, type InterruptRequest, type NativeBinding, type NativeCommandReceipt } from "@dispatcher/domain";
import type { NativeInteractionPort } from "@dispatcher/adapters";
import { isSafeNativeMetadataId, normalizeQuiescenceObservation, verifyQuiescence } from "./native-quiescence.js";

export interface NativeStopSource {binding:NativeBinding;scopeFingerprint:string;port:Pick<NativeInteractionPort,"capabilities"|"interrupt"|"interruptWithoutResume"|"inspectQuiescence">;isCurrent?():boolean}
export interface NativeStopProof {version:1;state:"stopped"|"unknown";observationRef?:string;requestId?:string;evidenceRef?:string;code?:string}
export interface NativeStopResult {receipt:NativeCommandReceipt;nativeStopProof:NativeStopProof}
class StopFailure extends Error {constructor(readonly code:string){super(code);}}
/** Session-scoped interruption never calls host shutdown, release, resume or history mutation. */
export async function interruptNativeSession(source:NativeStopSource,requestInput:InterruptRequest,assertCurrent:()=>void,timeoutMs=5_000):Promise<NativeStopResult>{
 const binding=structuredClone(source.binding);const scope=source.scopeFingerprint;const request=structuredClone(requestInput);
 const port=source.port;const interruptMethod=port.interrupt;const inspectMethod=port.inspectQuiescence;const withoutResume=structuredClone(port.interruptWithoutResume);const currentMethod=source.isCurrent;
 const abort=new AbortController();let closed=false;let sent=false;let timer:ReturnType<typeof setTimeout>|undefined;
 const duration=Number.isSafeInteger(timeoutMs)&&timeoutMs>=1&&timeoutMs<=30_000?timeoutMs:1;
 let receipt:NativeCommandReceipt={version:1,commandId:isSafeNativeMetadataId(request.commandId)&&request.commandId.length<=200?request.commandId:"unknown",state:"unknown"};
 const unknown=(code:string):NativeStopResult=>({receipt:{...receipt,...(!sent?{state:"rejected" as const}:{})},nativeStopProof:{version:1,state:"unknown",code}});
 const guard=()=>{if(closed)throw new StopFailure("NATIVE_STOP_TIMEOUT");assertCurrent();if(!isDeepStrictEqual(source.binding,binding)||source.scopeFingerprint!==scope||source.port!==port||port.interrupt!==interruptMethod||port.inspectQuiescence!==inspectMethod||!isDeepStrictEqual(port.interruptWithoutResume,withoutResume)||source.isCurrent!==currentMethod||currentMethod&&!currentMethod.call(source))throw new StopFailure("NATIVE_STOP_SCOPE_CHANGED");};
 const qualify=()=>{guard();const capabilities=port.capabilities();if(capabilities.version!==1||!interruptMethod||!inspectMethod||!assessInteractionCapability(capabilities.interruptTurn,scope,"runtime-verified").supported||!assessInteractionCapability(withoutResume,scope,"runtime-verified").supported)throw new StopFailure("NATIVE_CAPABILITY_UNVERIFIED");guard();};
 const work=async():Promise<NativeStopResult>=>{
  if(duration!==timeoutMs)throw new StopFailure("INVALID_NATIVE_INTERRUPT");
  qualify();if(binding.version!==1||binding.identityState!=="bound"||![binding.product,binding.region,binding.profileId,binding.backendId,binding.runnerId,binding.nativeStoreRef,binding.nativeSessionId,binding.executionRefId,scope,request.commandId].every(isSafeNativeMetadataId)||[binding.nativeThreadId,binding.parentSessionId,request.activeTurnId].some(v=>v!==undefined&&!isSafeNativeMetadataId(v))||request.commandId.length>200||request.commandId!==request.fence.commandId)throw new StopFailure("INVALID_NATIVE_INTERRUPT");
  const inspect=async()=>{const requestId=randomUUID();const raw=structuredClone(await inspectMethod!.call(port,structuredClone(binding),{requestId,signal:abort.signal}));qualify();const observation=normalizeQuiescenceObservation(raw.observation);if(!observation||!isDeepStrictEqual(raw.runtime?.binding,binding)||raw.runtime.scopeFingerprint!==scope||raw.runtime.readProof?.requestId!==requestId||!assessInteractionCapability(raw.runtime.readProof.evidence,scope,"runtime-verified").supported||raw.runtime.observationRef!==observation.id||observation.nativeSessionId!==binding.nativeSessionId||observation.nativeThreadId!==binding.nativeThreadId||observation.executionRefId!==binding.executionRefId||observation.scopeFingerprint!==scope||observation.read?.requestId!==observation.id||observation.read.readability!=="readable"||!["running","idle"].includes(observation.state))throw new StopFailure("NATIVE_STOP_READ_UNVERIFIED");return {observation,runtime:raw.runtime};};
  const before=await inspect();
  if(before.runtime.version!==1||before.runtime.readProof.kind!=="live-native-read"||!assessInteractionCapability(before.runtime.evidence,scope,"runtime-verified").supported||!before.runtime.host||!isSafeNativeMetadataId(before.runtime.host.id)||!["owned","external"].includes(before.runtime.host.ownership)||![true,false,"unknown"].includes(before.runtime.host.shared)||before.runtime.host.releaseBoundary!=="session")throw new StopFailure("NATIVE_HOST_STOP_UNSAFE");
  if(before.observation.activeTurnId!==request.activeTurnId)throw new StopFailure("NATIVE_ACTIVE_TURN_CHANGED");
  qualify();sent=true;const raw=await interruptMethod!.call(port,structuredClone(binding),structuredClone(request));
  receipt={version:1,commandId:request.commandId,state:raw?.version===1&&raw.commandId===request.commandId&&["accepted","queued","rejected","unknown"].includes(raw.state)?raw.state:"unknown"};
  qualify();if(!["accepted","queued"].includes(receipt.state))return unknown("NATIVE_INTERRUPT_UNCONFIRMED");
  const after=await inspect();
  if(!isDeepStrictEqual(after.runtime.host,before.runtime.host))throw new StopFailure("NATIVE_STOP_SCOPE_CHANGED");
  const prior=before.observation.read!;const next=after.observation.read!;
  if(after.observation.id===before.observation.id||next.observerGeneration<prior.observerGeneration||next.observerGeneration===prior.observerGeneration&&(next.observerEpoch!==prior.observerEpoch||next.sequence<=prior.sequence))throw new StopFailure("STALE_NATIVE_STOP_READ");
  const quiet=verifyQuiescence(after.observation,after.runtime);if(!quiet.quiescent)return unknown(quiet.reasonCode??"NATIVE_STOP_UNVERIFIED");
  const host=after.runtime.host;if(!host||!isSafeNativeMetadataId(host.id)||host.releaseBoundary!=="session")throw new StopFailure("NATIVE_HOST_STOP_UNSAFE");
  return {receipt,nativeStopProof:{version:1,state:"stopped",observationRef:after.observation.id,requestId:after.runtime.readProof.requestId,evidenceRef:after.runtime.readProof.evidence.evidenceRef!}};
 };
 try{return await Promise.race([work(),new Promise<NativeStopResult>(resolve=>{timer=setTimeout(()=>{closed=true;abort.abort();resolve(unknown("NATIVE_STOP_TIMEOUT"));},duration);})]);}
 catch(error){return unknown(error instanceof StopFailure?error.code:"NATIVE_STOP_FAILED");}
 finally{closed=true;abort.abort();if(timer)clearTimeout(timer);}
}
