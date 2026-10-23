import {createHash,randomUUID} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {mergeTurnObservation,type NativeBinding,type NativeBindingEvent,type NativeTurnFact,type TurnObservation} from "@dispatcher/domain";
import {AdapterContractError,assertAdapterWriteAdmission,type AdapterSession,type NativeEventSink,type NativeObserverBegin} from "./contracts.js";
import {assertSessionModelBinding} from "./execution-selection.js";
import type {SessionStore} from "./generic.js";

const validId=(value:unknown):value is string=>typeof value==="string"&&value.length>0&&value.length<=512&&Array.from(value).every(character=>character.charCodeAt(0)>=32&&character.charCodeAt(0)!==127);
export type NativeTurnObserver=((fact:NativeTurnFact)=>Promise<void>)&{canProject:()=>boolean};
/** Binds each producer to one reserved invocation and its original Controller authority. */
export class NativeBindingEvents {
 private readonly failedInvocations=new Set<string>();
 private sink:NativeEventSink|undefined;
 private onBegin:NativeObserverBegin|undefined;
 constructor(private readonly store:SessionStore){}
 setSink(sink:NativeEventSink,onBegin:NativeObserverBegin):void {this.sink=sink;this.onBegin=onBegin;}
 assertAvailable():void {if(typeof this.sink!=="function"||typeof this.onBegin!=="function")throw new AdapterContractError("NATIVE_OBSERVER_UNAVAILABLE","Native startup requires an owning observer");}
 private assertIdentity(sessionId:string):void {
  const current=this.store.load(sessionId),issue=this.failedInvocations.has(current?.nativeInvocationId??sessionId)?"NATIVE_EVENT_PERSISTENCE_FAILED":current?.nativeIdentityIssue;
  if(issue)throw new AdapterContractError(issue,"Native identity requires reconciliation before input");
 }
 private retainFailure(sessionId:string,invocationId:string,canProject?:()=>boolean):void {
  this.failedInvocations.add(invocationId);
  try{const current=this.store.load(sessionId);if(current?.nativeInvocationId===invocationId&&(!canProject||canProject()))this.store.save({...current,nativeIdentityIssue:current.nativeIdentityIssue??"NATIVE_EVENT_PERSISTENCE_FAILED"});}catch{/* Original invocation stays closed when persistence itself is unavailable. */}
 }
 startOptions(session:AdapterSession,emit:NativeTurnObserver,product:string,admit:()=>void,identity:"reserved"|"codex-thread"="reserved"):{beforePrompt:()=>void;onBinding:(binding:NativeBinding)=>Promise<void>} {
  const expected=structuredClone(session),invocationId=this.store.load(session.id)!.nativeInvocationId!;let bound=structuredClone(expected.nativeBinding);
  const codexThread=identity==="codex-thread";
  if(!["reserved","codex-thread"].includes(identity)||codexThread&&(product!=="codex"||expected.backendId!=="codex-app-server"||(bound?expected.providerSessionId!==bound.nativeSessionId:expected.providerSessionId!==undefined||expected.state!=="STARTING")))throw new AdapterContractError("NATIVE_IDENTITY_CHANGED","Native allocation requires the original unbound Codex invocation");
  const assertCurrent=()=>{
   this.assertIdentity(expected.id);const current=this.store.load(expected.id);
   if(!current)throw new AdapterContractError("SESSION_NOT_FOUND","Native input requires the original Adapter session");
   if(current.state==="CANCELLED")throw new AdapterContractError("SESSION_CANCELLED","Cancelled sessions cannot accept native input");
   if(codexThread&&!bound&&current.state!=="STARTING")throw new AdapterContractError("NATIVE_IDENTITY_CHANGED","Native allocation no longer owns a starting invocation");
   if(!emit.canProject())throw new AdapterContractError("STALE_NATIVE_OBSERVER","Native observer no longer owns input authority");
   assertSessionModelBinding(current,expected);
   if(!isDeepStrictEqual(current.nativeBinding,bound)||current.providerSessionId!==expected.providerSessionId)throw new AdapterContractError("NATIVE_IDENTITY_CHANGED","Native binding differs from the reserved identity");
  };
  const beforePrompt=()=>{assertCurrent();assertAdapterWriteAdmission(admit);assertCurrent();};
  return {beforePrompt,onBinding:async original=>{
   const binding=structuredClone(original);beforePrompt();const current=this.store.load(expected.id)!;
   const wrongIdentity=codexThread?binding.region!=="global"||binding.nativeThreadId!==binding.nativeSessionId||expected.providerSessionId!==undefined&&binding.nativeSessionId!==expected.providerSessionId:binding.nativeThreadId!==undefined||binding.nativeSessionId!==expected.providerSessionId;
   if(binding.version!==1||binding.identityState!=="bound"||![binding.product,binding.region,binding.profileId,binding.backendId,binding.runnerId,binding.nativeStoreRef,binding.nativeSessionId,binding.executionRefId].every(validId)||wrongIdentity||binding.parentSessionId!==undefined||binding.nativeSessionId.startsWith("unstarted:")||binding.product!==product||binding.profileId!==expected.profileId||binding.backendId!==expected.backendId||binding.executionRefId!==expected.executionRef?.id||expected.executionRef.kind!=="managed-worktree"||binding.runnerId!==expected.executionRef.runnerId||bound&&!isDeepStrictEqual(binding,bound))throw new AdapterContractError("NATIVE_IDENTITY_CHANGED","Native binding differs from the frozen execution scope");
   try{
    try{this.store.save({...current,nativeBinding:binding,...(codexThread?{providerSessionId:binding.nativeSessionId}:{})});}catch(error){this.retainFailure(expected.id,invocationId);throw error;}bound=structuredClone(binding);if(codexThread)expected.providerSessionId=binding.nativeSessionId;
    // Connection identity is durable before prompt; waiting is not a prompt ACK.
    await emit({state:"waiting",nativeSessionId:binding.nativeSessionId,observedAt:new Date().toISOString()});beforePrompt();
   }catch(error){this.retainFailure(expected.id,invocationId,emit.canProject);throw error;}
  }};
 }
 begin(sessionId:string):NativeTurnObserver {
  this.assertAvailable();this.assertIdentity(sessionId);const session=this.store.load(sessionId);
  if(!session?.profileId||!session.execution)throw new AdapterContractError("SESSION_NOT_FOUND","Native observation requires a reserved execution");
  const invocationId=`observer:${randomUUID()}`,profileId=session.profileId,execution=structuredClone(session.execution),sink=this.sink!;
  this.store.save({...session,nativeInvocationId:invocationId});
  const ownsAuthority=this.onBegin!({sessionId,runId:session.runId,profileId,backendId:session.backendId,invocationId,...execution});
  if(typeof ownsAuthority!=="function")throw new AdapterContractError("NATIVE_OBSERVER_UNAVAILABLE","Native observer must expose synchronous authority");
  const canProject=()=>{
   const current=this.store.load(sessionId);
   return Boolean(current&&current.runId===session.runId&&current.profileId===profileId&&current.backendId===session.backendId&&current.nativeInvocationId===invocationId&&isDeepStrictEqual(current.execution,execution)&&ownsAuthority()===true);
  };
  const emit=async(fact:NativeTurnFact)=>{
   try{
    this.assertIdentity(sessionId);if(!canProject())throw new AdapterContractError("STALE_NATIVE_OBSERVER","Native observation authority changed");
    const current=this.store.load(sessionId)!;assertSessionModelBinding(current,session);
    if(!validId(fact.nativeSessionId)||!Number.isFinite(Date.parse(fact.observedAt))||!["received","running","completed","failed","waiting"].includes(fact.state)||[fact.nativeSessionId,fact.nativeRequestId,fact.nativeMessageId,fact.nativeTurnId].some(id=>id!==undefined&&!validId(id)))throw new AdapterContractError("INVALID_NATIVE_EVENT","Native observation is malformed");
    if(!current.nativeBinding||fact.nativeSessionId!==current.providerSessionId||current.nativeBinding.nativeSessionId!==fact.nativeSessionId)throw new AdapterContractError("NATIVE_IDENTITY_CHANGED","Native observation changed identity");
    const turn:TurnObservation={id:fact.nativeTurnId??invocationId,invocationId,source:fact.nativeTurnId?"native":"dispatcher",state:fact.state,observedAt:fact.observedAt,...(fact.nativeRequestId?{nativeRequestId:fact.nativeRequestId}:{}),...(fact.nativeMessageId?{nativeMessageId:fact.nativeMessageId}:{}),...(fact.nativeTurnId?{nativeTurnId:fact.nativeTurnId}:{})};
    const retained=mergeTurnObservation(current.turnObservation,turn);
    try{this.store.save({...current,turnObservation:retained,updatedAt:retained.observedAt});}catch(error){this.retainFailure(sessionId,invocationId);throw error;}
    const id=createHash("sha256").update(JSON.stringify([sessionId,session.runId,execution,invocationId,fact.nativeSessionId,turn.state,turn.nativeRequestId,turn.nativeMessageId,turn.nativeTurnId])).digest("hex");
    const event:NativeBindingEvent={version:1,id,sessionId,runId:session.runId,profileId,backendId:session.backendId,...execution,nativeSessionId:fact.nativeSessionId,nativeBinding:structuredClone(current.nativeBinding),turn};
    // A rejected durable sink remains uncertain even if authority expired during its await.
    try{await sink(event);}catch(error){this.retainFailure(sessionId,invocationId);throw error;}
   }catch(error){this.retainFailure(sessionId,invocationId,canProject);throw error;}
  };
  return Object.assign(emit,{canProject});
 }
}
