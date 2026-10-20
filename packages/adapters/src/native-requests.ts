import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { MutationFence, NativeBinding, NativeCommandReceipt, NativeResponse } from "@dispatcher/domain";

/** Metadata-only native request; command arguments and prompt/credential payload stay at the provider. */
export interface NativePendingRequest {
  version:1;requestId:string;revision:string;connectionId:string;connectionEpoch:number;type:"permission"|"input";
  tool:{name:string;scope:string[];risk:"low"|"high"|"unknown"};
  options:Array<{id:string;kind:"allow-once"}>;expiresAt:string;promptRef?:string;
}
export interface NativeRequestInspection {version:1;requestId:string;connectionId:string;connectionEpoch:number;state:"pending"|"answered"|"expired"|"unknown";request?:NativePendingRequest}
export interface NativeRequestHandle {
  readonly binding:NativeBinding;readonly scopeFingerprint:string;readonly connectionId:string;readonly connectionEpoch:number;
  isConnected():boolean;
  inspectPending(nativeRequestId:string,request:{requestId:string;signal:AbortSignal}):Promise<NativeRequestInspection>;
  /** Provider qualification must prove compare-and-consume on this original live callback, not a resume RPC. */
  respond(ref:NativeBinding,request:NativeResponse&{connectionId:string;connectionEpoch:number},beforeSend?:()=>void):Promise<NativeCommandReceipt>;
}
export interface NativeRequestEvent {fence:MutationFence;binding:NativeBinding;scopeFingerprint:string;request:NativePendingRequest}
export class NativeRequestError extends Error {constructor(readonly code:string){super(code);this.name="NativeRequestError";}}
const credentialPattern=/(?:\b(?:[a-z][a-z0-9]*[-_])*(?:token|secret|password|credential|authorization|api[-_]?key|private[-_]?key)["']?\s*[:=]|\bBearer\s|\b(?:sk|ghp|github_pat|xox[baprs])[-_][\w-]{8,})/i;
const safe=(v:unknown):v is string=>typeof v==="string"&&v.length>0&&v.length<=512&&Array.from(v).every(c=>c.charCodeAt(0)>=32&&c.charCodeAt(0)!==127)&&!credentialPattern.test(v);
export function normalizeNativeRequest(value:NativePendingRequest):NativePendingRequest {
  if(!value||value.version!==1||![value.requestId,value.revision,value.connectionId].every(safe)||!Number.isSafeInteger(value.connectionEpoch)||value.connectionEpoch<1||!["permission","input"].includes(value.type)||!value.tool||!safe(value.tool.name)||!["low","high","unknown"].includes(value.tool.risk)||!Array.isArray(value.tool.scope)||value.tool.scope.length>32||value.tool.scope.some(v=>!safe(v))||new Set(value.tool.scope).size!==value.tool.scope.length||value.type==="permission"&&!value.tool.scope.length||!Array.isArray(value.options)||value.options.length>32||value.options.some(o=>!o||!safe(o.id)||o.kind!=="allow-once")||new Set(value.options.map(o=>o.id)).size!==value.options.length||value.type==="input"&&value.options.length||typeof value.expiresAt!=="string"||value.expiresAt.length>64||!Number.isFinite(Date.parse(value.expiresAt))||value.promptRef!==undefined&&!safe(value.promptRef))throw new NativeRequestError("INVALID_NATIVE_REQUEST");
  return {version:1,requestId:value.requestId,revision:value.revision,connectionId:value.connectionId,connectionEpoch:value.connectionEpoch,type:value.type,tool:{name:value.tool.name,scope:[...value.tool.scope],risk:value.tool.risk},options:value.options.map(o=>({id:o.id,kind:o.kind})),expiresAt:value.expiresAt,...(value.promptRef?{promptRef:value.promptRef}:{})};
}
export function captureNativeRequestHandle(handle:NativeRequestHandle,binding:NativeBinding,scope:string):NativeRequestHandle {
  if(!handle||!isDeepStrictEqual(handle.binding,binding)||handle.scopeFingerprint!==scope||!safe(handle.connectionId)||!Number.isSafeInteger(handle.connectionEpoch)||handle.connectionEpoch<1||[handle.isConnected,handle.inspectPending,handle.respond].some(f=>typeof f!=="function"))throw new NativeRequestError("NATIVE_REQUEST_CONNECTION_CHANGED");
  return Object.freeze({binding:structuredClone(binding),scopeFingerprint:scope,connectionId:handle.connectionId,connectionEpoch:handle.connectionEpoch,isConnected:handle.isConnected.bind(handle),inspectPending:handle.inspectPending.bind(handle),respond:handle.respond.bind(handle)});
}
export function assertNativeRequestChoice(request:NativePendingRequest,response:NativeResponse["response"]):void {
  if(!response||response.kind==="allow"&&(request.type!=="permission"||!request.options.some(o=>o.id===response.optionId))||response.kind==="text"&&(request.type!=="input"||typeof response.text!=="string"||!response.text.length||Buffer.byteLength(response.text)>16_384||response.text.includes("\0")||credentialPattern.test(response.text))||!["allow","reject","text"].includes(response.kind))throw new NativeRequestError("INVALID_NATIVE_REQUEST_CHOICE");
}
export async function assertNativeRequestPending(handle:NativeRequestHandle,expected:NativePendingRequest,now:()=>Date):Promise<void> {
  const check=()=>{if(!handle.isConnected()||handle.connectionId!==expected.connectionId||handle.connectionEpoch!==expected.connectionEpoch)throw new NativeRequestError("NATIVE_REQUEST_CONNECTION_CHANGED");if(Date.parse(expected.expiresAt)<=now().getTime())throw new NativeRequestError("NATIVE_REQUEST_EXPIRED");};check();
  const requestId=randomUUID();const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    const response=await Promise.race([Promise.resolve().then(()=>handle.inspectPending(expected.requestId,{requestId,signal:abort.signal})),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(new NativeRequestError("NATIVE_REQUEST_STATE_UNKNOWN"));},5_000);})]);check();
    if(!response||response.version!==1||response.requestId!==requestId||response.connectionId!==expected.connectionId||response.connectionEpoch!==expected.connectionEpoch)throw new NativeRequestError("NATIVE_REQUEST_CONNECTION_CHANGED");
    if(response.state!=="pending")throw new NativeRequestError(response.state==="answered"?"NATIVE_REQUEST_ALREADY_ANSWERED":response.state==="expired"?"NATIVE_REQUEST_EXPIRED":"NATIVE_REQUEST_STATE_UNKNOWN");
    if(!isDeepStrictEqual(normalizeNativeRequest(response.request!),expected))throw new NativeRequestError("NATIVE_REQUEST_CHANGED");
  }catch(error){if(error instanceof NativeRequestError)throw error;throw new NativeRequestError("NATIVE_REQUEST_STATE_UNKNOWN");}finally{if(timer)clearTimeout(timer);}
}
