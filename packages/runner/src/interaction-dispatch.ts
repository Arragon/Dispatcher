import { assessInteractionCapability, type MutationFence, type NativeBinding, type NativeCommandReceipt, type NativeResponse } from "@dispatcher/domain";
import type { NativeInteractionPort } from "@dispatcher/adapters";
import { assertNativeRequestPending, captureNativeRequestHandle, type NativePendingRequest, type NativeRequestHandle } from "@dispatcher/adapters";

export type NativeDispatchCommand=
 |{type:"continue";commandId:string;message:string}
 |{type:"steer";commandId:string;message:string;activeTurnId:string}
 |{type:"approval";commandId:string;requestId:string;requestType:NativeResponse["type"];expectedRevision:string;requestRef?:string;response:NativeResponse["response"]};
export interface NativeDispatchSource {binding:NativeBinding;scopeFingerprint:string;port:Pick<NativeInteractionPort,"capabilities"|"continueTurn"|"steer"|"respond"|"requestHandle">;nativeRequest?:{handle:NativeRequestHandle;request:NativePendingRequest;now:()=>Date}}
export class InteractionDispatchError extends Error {constructor(readonly code:string){super(code);this.name="InteractionDispatchError";}}
class InteractionAdmissionError extends InteractionDispatchError {}
const validId=(value:unknown):value is string=>typeof value==="string"&&value.length>0&&value.length<=512&&Array.from(value).every(c=>c.charCodeAt(0)>=32)&&!/(?:\b(?:[a-z][a-z0-9]*[-_])*(?:token|secret|password|credential|authorization|api[-_]?key|private[-_]?key)["']?\s*[:=]|\bBearer\s|\b(?:sk|ghp|github_pat|xox[baprs])[-_][\w-]{8,})/i.test(value);
const validMessage=(value:unknown):value is string=>typeof value==="string"&&value.length>0&&Buffer.byteLength(value)<=16_384&&!value.includes("\0");
export function normalizeInteractionCommand(command:NativeDispatchCommand):NativeDispatchCommand {
 if(!validId(command.commandId)||command.commandId.length>200)throw new InteractionDispatchError("INVALID_NATIVE_COMMAND");
 if(command.type==="continue"||command.type==="steer") {
   if(!validMessage(command.message)||command.type==="steer"&&!validId(command.activeTurnId))throw new InteractionDispatchError("INVALID_NATIVE_COMMAND");
   return command.type==="continue"?{type:"continue",commandId:command.commandId,message:command.message}:{type:"steer",commandId:command.commandId,message:command.message,activeTurnId:command.activeTurnId};
 }
 if(command.type!=="approval"||!validId(command.requestId)||!validId(command.expectedRevision)||command.requestRef!==undefined&&!validId(command.requestRef)||!["permission","input"].includes(command.requestType))throw new InteractionDispatchError("INVALID_NATIVE_COMMAND");
 const response=command.response;
 if(!response||!["reject","allow","text"].includes(response.kind)||response.kind==="allow"&&(command.requestType!=="permission"||!validId(response.optionId))||response.kind==="text"&&(command.requestType!=="input"||!validMessage(response.text)))throw new InteractionDispatchError("INVALID_NATIVE_COMMAND");
 return {type:"approval",commandId:command.commandId,requestId:command.requestId,requestType:command.requestType,expectedRevision:command.expectedRevision,...(command.requestRef?{requestRef:command.requestRef}:{}),response:response.kind==="reject"?{kind:"reject"}:response.kind==="allow"?{kind:"allow",optionId:response.optionId}:{kind:"text",text:response.text}};
}
const knownCodes=new Set(["FORBIDDEN","SESSION_OWNER_MISMATCH","NATIVE_IDENTITY_CHANGED","NATIVE_BINDING_MISSING","NATIVE_WRITE_LOCKED","STALE_RUN_AUTHORITY","STALE_TASK_REVISION","STALE_CONTROL_REVISION","STALE_CONTROL_EPOCH","STALE_NATIVE_TURN","NATIVE_STATE_UNKNOWN","NATIVE_OBSERVATION_SCOPE_CHANGED","NATIVE_COMMAND_OUTCOME_UNKNOWN","NATIVE_COMMAND_QUEUE_UNCONFIRMED","NATIVE_CAPABILITY_UNSUPPORTED","NATIVE_CAPABILITY_UNVERIFIED","TERMINAL_TASK","TERMINAL_RUN","SESSION_BUSY","SESSION_NOT_RUNNING","RUN_PHASE_CONFLICT"]);
for(const code of ["NATIVE_REQUEST_CONNECTION_CHANGED","NATIVE_REQUEST_EXPIRED","NATIVE_REQUEST_ALREADY_ANSWERED","NATIVE_REQUEST_STATE_UNKNOWN","NATIVE_REQUEST_CHANGED","NATIVE_REQUEST_NOT_FOUND"])knownCodes.add(code);
const cleanCode=(value:unknown,fallback:string)=>typeof value==="string"&&knownCodes.has(value)?value:fallback;
function normalizeReceipt(value:NativeCommandReceipt,commandId:string):NativeCommandReceipt|undefined {
 if(!value||value.version!==1||value.commandId!==commandId||!["accepted","queued","rejected","unknown"].includes(value.state)||[value.nativeRequestId,value.nativeMessageId,value.nativeTurnId].some(id=>id!==undefined&&!validId(id)))return undefined;
 return {version:1,commandId,state:value.state,...(value.nativeRequestId?{nativeRequestId:value.nativeRequestId}:{}),...(value.nativeMessageId?{nativeMessageId:value.nativeMessageId}:{}),...(value.nativeTurnId?{nativeTurnId:value.nativeTurnId}:{}),...(value.code?{code:cleanCode(value.code,"NATIVE_COMMAND_DIAGNOSTIC")}:{})};
}
/** One bounded native mutation; UNKNOWN is a receipt, never permission to retry. */
export async function dispatchInteraction(commandInput:NativeDispatchCommand,fenceInput:MutationFence,source:NativeDispatchSource,assertCurrent:()=>void,timeoutMs=5_000):Promise<NativeCommandReceipt> {
 const command=normalizeInteractionCommand(commandInput);const fence=structuredClone(fenceInput);const binding=structuredClone(source.binding);const scope=source.scopeFingerprint;
 const rejected=(code:string):NativeCommandReceipt=>({version:1,commandId:command.commandId,state:"rejected",code});
 const unknown=(code:string):NativeCommandReceipt=>({version:1,commandId:command.commandId,state:"unknown",code});
 if(command.commandId!==fence.commandId||![fence.runId,fence.sessionId,fence.expectedCurrentRunId,fence.leaseId,fence.commandId].every(validId)||![fence.generation,fence.expectedTaskRevision,fence.expectedControlRevision,fence.expectedControlEpoch].every(value=>Number.isSafeInteger(value)&&value>=1)||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30_000)return rejected("INVALID_NATIVE_COMMAND");
 let invoke:()=>Promise<NativeCommandReceipt>;
 let admissionOpen=true;
 const port=source.port,capabilities=port.capabilities.bind(port);
 const checkDeadline=()=>{if(!admissionOpen)throw new InteractionAdmissionError("NATIVE_COMMAND_OUTCOME_UNKNOWN");if(performance.now()>=deadline)throw new InteractionAdmissionError("NATIVE_COMMAND_TIMEOUT");};
 const checkCurrent=()=>{const result:unknown=assertCurrent();if(result!==undefined){void Promise.resolve(result).catch(()=>undefined);throw new InteractionDispatchError("NATIVE_CAPABILITY_UNVERIFIED");}};
 const capability=command.type==="continue"?"sameSessionContinue":command.type==="steer"?"liveSteer":"nativeApproval";
 const beforeSend=()=>{
   checkDeadline();
   try{checkCurrent();const assessment=assessInteractionCapability(capabilities()[capability],scope,"runtime-verified");if(!assessment.supported)throw new InteractionDispatchError(assessment.code!);checkCurrent();}
   catch(error){throw new InteractionAdmissionError(cleanCode((error as {code?:unknown})?.code,"NATIVE_CAPABILITY_UNVERIFIED"));}
   checkDeadline();
 };
 try {
   checkCurrent();
   const assessment=assessInteractionCapability(capabilities()[capability],scope,"runtime-verified");if(!assessment.supported)return rejected(assessment.code!);
   if(command.type==="continue") {const method=port.continueTurn?.bind(port);if(!method)return rejected("NATIVE_CAPABILITY_UNSUPPORTED");invoke=()=>method(binding,{commandId:command.commandId,fence,message:command.message},beforeSend);}
   else if(command.type==="steer") {const method=port.steer?.bind(port);if(!method)return rejected("NATIVE_CAPABILITY_UNSUPPORTED");invoke=()=>method(binding,{commandId:command.commandId,fence,activeTurnId:command.activeTurnId,message:command.message},beforeSend);}
   else {
     const original=source.nativeRequest;if(!original)return rejected("NATIVE_CAPABILITY_UNSUPPORTED");
     const pending={handle:captureNativeRequestHandle(original.handle,binding,scope),request:structuredClone(original.request),now:original.now.bind(original)};
     await assertNativeRequestPending(pending.handle,pending.request,pending.now);
     invoke=()=>pending.handle.respond(binding,{commandId:command.commandId,fence,requestId:command.requestId,type:command.requestType,expectedRevision:command.expectedRevision,response:command.response,connectionId:pending.request.connectionId,connectionEpoch:pending.request.connectionEpoch},beforeSend);
   }
   checkCurrent();
 } catch(error) {return rejected(cleanCode((error as {code?:unknown})?.code,"NATIVE_CAPABILITY_UNVERIFIED"));}
 let timer:ReturnType<typeof setTimeout>|undefined;
 const deadline=performance.now()+timeoutMs;
 try {const raw=await Promise.race([invoke(),new Promise<undefined>(resolve=>{timer=setTimeout(()=>resolve(undefined),timeoutMs);})]);const receipt=raw?normalizeReceipt(raw,command.commandId):undefined;return !raw?unknown("NATIVE_COMMAND_TIMEOUT"):!receipt||command.type==="approval"&&["accepted","queued"].includes(receipt.state)&&receipt.nativeRequestId!==command.requestId?unknown("NATIVE_COMMAND_RECEIPT_INVALID"):receipt;}
 catch(error) {return error instanceof InteractionAdmissionError?rejected(error.code):unknown("NATIVE_COMMAND_OUTCOME_UNKNOWN");}
 finally {admissionOpen=false;if(timer)clearTimeout(timer);}
}
