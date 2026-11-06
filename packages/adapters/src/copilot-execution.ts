import {isDeepStrictEqual} from "node:util";
import {isExecutionContextRef,validateExecutionBinding,type ExecutionContextRef,type NativeBinding,type NativeTurnFact} from "@dispatcher/domain";
import {AdapterContractError,AdapterStartError,type AdapterManifest} from "./contracts.js";
import {StructuredCliAdapter,type CliAgentBackend,type CliAgentProfile,type CliStartInput,type CliTurn,type CliTurnResult,type NormalizedCliEvent} from "./ecosystem-cli.js";
import {freezeExecutionSelection} from "./execution-selection.js";
import type {SessionStore} from "./generic.js";
import type {LocalRuntimeDisconnect} from "./interaction-contracts.js";
import {CopilotRpcClient,copilotPhysicalIdentity as physical,type CopilotRpcScope} from "./copilot.js";
const failure=(code:string)=>new AdapterContractError(code,"Copilot execution could not be confirmed");
const text=(value:unknown):value is string=>typeof value==="string"&&value.length>0&&value.length<=512&&Array.from(value).every(char=>char.charCodeAt(0)>=32&&char.charCodeAt(0)!==127);
export interface CopilotExecutionScope extends CopilotRpcScope {profileId:string;runnerId:string;nativeStoreRef:string}
/** One managed creation; original binding persistence and local cleanup are separate facts. */
export class CopilotExecutionBackend implements CliAgentBackend {
 readonly backendId="copilot-rpc";
 private readonly scope:CopilotExecutionScope;
 private readonly reference:Extract<ExecutionContextRef,{kind:"managed-worktree"}>;
 private readonly paths:ReturnType<typeof physical>[];
 private readonly shutdown=new AbortController();
 private readonly consumers=new Set<Promise<unknown>>();
 private readonly operations=new Set<Promise<unknown>>();
 private pipeline:Promise<void>=Promise.resolve();
 private starting=false;private admitted=false;private closed=false;private creationPossible=false;private acquisitionAttempted=false;private acquisitionEnded=true;private persistenceFailed=false;
 private client?:CopilotRpcClient;private opening?:Promise<CopilotRpcClient>;private work?:Promise<CliTurnResult>;private cleanup?:Promise<LocalRuntimeDisconnect>;private closing?:Promise<LocalRuntimeDisconnect>;
 constructor(options:{scope:CopilotExecutionScope;executionRef:ExecutionContextRef}){
  this.scope=structuredClone(options.scope);const reference=structuredClone(options.executionRef);
  if(![this.scope.profileId,this.scope.runnerId,this.scope.nativeStoreRef].every(text)||!isExecutionContextRef(reference)||reference.kind!=="managed-worktree"||reference.runnerId!==this.scope.runnerId)this.reject("COPILOT_RPC_SCOPE_INVALID");
  this.reference=reference;
  try{this.paths=this.identities();}catch{this.reject("COPILOT_RPC_SCOPE_CHANGED");}
 }
 private identities(){return [physical(this.scope.executable,false),physical(this.scope.workspacePath,true),physical(this.scope.copilotHome,true)];}
 assertExecutionScope(scope:CopilotExecutionScope,reference:ExecutionContextRef):void{
  if(this.closed||this.admitted||!isDeepStrictEqual(this.scope,scope)||!isDeepStrictEqual(this.reference,reference))this.reject("COPILOT_RPC_SCOPE_CHANGED");
  try{if(!isDeepStrictEqual(this.identities(),this.paths))throw Error();}catch{this.reject("COPILOT_RPC_SCOPE_CHANGED");}
 }
 private error(code:string):AdapterStartError{return new AdapterStartError(this.creationPossible?"unknown":"not-created",code,"Copilot execution requires reconciliation");}
 private reject(code:string):never{throw this.error(code);}
 hasActiveOperations():boolean{return this.consumers.size>0||this.operations.size>0;}
 private track<T>(work:Promise<T>):Promise<T>{this.operations.add(work);void work.finally(()=>this.operations.delete(work)).catch(()=>{});return work;}
 private invoke<T>(callback:()=>T,set=this.consumers):{asynchronous:boolean;settled:Promise<Awaited<T>>}{
  if(set===this.consumers&&set.size>=64)this.reject("COPILOT_RPC_REQUEST_LIMIT");
  // Reserve before entering user code, including its returned then getter and reentrant close.
  let resolve!:(value:Awaited<T>)=>void,reject!:(error:unknown)=>void;
  const promise=new Promise<Awaited<T>>((yes,no)=>{resolve=yes;reject=no;}),slot={promise,resolve,reject};set.add(slot.promise);void slot.promise.catch(()=>{});
  const release=()=>set.delete(slot.promise);
  let returned:T;
  try{returned=callback();}catch(error){release();slot.reject(error);throw error;}
  if(returned===undefined){release();slot.resolve(undefined as Awaited<T>);return {asynchronous:false,settled:slot.promise};}
  const raw=Promise.resolve(returned);
  void raw.then(value=>{release();slot.resolve(value);},error=>{release();slot.reject(error);});
  return {asynchronous:true,settled:slot.promise};
 }
 private guard(input:CliStartInput):void{
  if(this.closed)this.reject("COPILOT_RPC_UNREACHABLE");if(this.persistenceFailed)this.reject("COPILOT_RPC_CALLBACK_FAILED");
  try{if(input.executable!==this.scope.executable||!isDeepStrictEqual(input.executionRef,this.reference)||!isDeepStrictEqual(physical(input.workspacePath,true),this.paths[1])||!isDeepStrictEqual(this.identities(),this.paths))throw Error();}catch{this.reject("COPILOT_RPC_SCOPE_CHANGED");}
  let permission:ReturnType<CopilotExecutionBackend["invoke"]>;
  try{permission=this.invoke(()=>input.beforePrompt!());}catch(error){if(error instanceof AdapterStartError&&error.code==="COPILOT_RPC_REQUEST_LIMIT")throw error;this.reject("COPILOT_RPC_AUTHORITY_CHANGED");}
  if(permission.asynchronous)this.reject("COPILOT_RPC_AUTHORITY_CHANGED");
  if(this.closed)this.reject("COPILOT_RPC_UNREACHABLE");
  try{if(!isDeepStrictEqual(this.identities(),this.paths))throw Error();}catch{this.reject("COPILOT_RPC_SCOPE_CHANGED");}
 }
 private validate(input:CliStartInput):void{
  const n=input.nativeInput;
  if(!n||n.version!==1||n.profileId!==this.scope.profileId||n.backendId!==this.backendId||![n.runId,n.sessionId,n.commandId].every(text))this.reject("COPILOT_RPC_SCOPE_CHANGED");
  if(n.newSession!==true||Object.hasOwn(n,"providerSessionId"))this.reject("COPILOT_RPC_CONTINUATION_REQUIRES_COMMAND_LANE");
  if(n.approveTools!==false||input.args.length||input.environment&&Object.keys(input.environment).length||typeof n.prompt!=="string"||!n.prompt.trim()||Buffer.byteLength(n.prompt)>196608||typeof input.beforePrompt!=="function"||typeof input.onBinding!=="function"||input.onNativeEvent!==undefined&&typeof input.onNativeEvent!=="function")this.reject("COPILOT_RPC_REQUEST_INVALID");
  if(Object.hasOwn(n,"modelSelection")||Object.hasOwn(n,"legacyModel"))this.reject("MODEL_LEGACY_REVIEW_REQUIRED");
  try{const selection=freezeExecutionSelection(n.executionSelection,{profileId:this.scope.profileId,providerId:"copilot",backendId:this.backendId,selection:true,reasoning:false});
   if(!selection||selection.selectionType!=="explicit-model"||!text(selection.requestedModel)||!validateExecutionBinding({profileId:this.scope.profileId,providerId:"copilot",backendId:this.backendId,runnerId:this.scope.runnerId,executionRef:this.reference},selection,{repositoryId:this.reference.repositoryId,baseRevision:this.reference.baseRevision}).valid)this.reject("COPILOT_RPC_MODEL_UNQUALIFIED");
  }catch{this.reject("COPILOT_RPC_MODEL_UNQUALIFIED");}
  this.guard(input);
 }
 private async bounded<T>(work:Promise<T>,code:string):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined,abort:(()=>void)|undefined;
  try{return await Promise.race([work,new Promise<never>((_,reject)=>{
   abort=()=>reject(this.error("COPILOT_RPC_UNREACHABLE"));this.shutdown.signal.addEventListener("abort",abort,{once:true});
   timer=setTimeout(()=>reject(this.error(code)),500);if(this.closed)abort();
  })]);}finally{if(timer)clearTimeout(timer);if(abort)this.shutdown.signal.removeEventListener("abort",abort);}
 }
 private observe(input:CliStartInput,fact:NativeTurnFact):Promise<void>{
  const observation=this.pipeline.then(async()=>{
   this.guard(input);
   try{await this.bounded(this.invoke(()=>input.onNativeEvent?.(fact)).settled,"COPILOT_RPC_CALLBACK_FAILED");}catch{this.reject("COPILOT_RPC_CALLBACK_FAILED");}
   this.guard(input);
  }).catch(error=>{this.persistenceFailed=true;throw error;});
  this.pipeline=this.track(observation);return observation;
 }
 private closeClient():Promise<LocalRuntimeDisconnect>{
  // Publish the cached close before invoking a client that can reenter shutdown.
  return this.closing??=this.track(Promise.resolve().then(async()=>await this.client!.close()));
 }
 start(original:CliStartInput):CliTurn{
  if(this.admitted||this.starting)this.reject("COPILOT_RPC_SESSION_ALREADY_ADMITTED");
  this.starting=true;let input:CliStartInput;
  try{
  const captured={...original};
  input={...captured,args:[...captured.args],...(captured.environment?{environment:structuredClone(captured.environment)}:{}),...(captured.executionRef?{executionRef:structuredClone(captured.executionRef)}:{}),...(captured.nativeInput?{nativeInput:structuredClone(captured.nativeInput)}:{}),
   ...(typeof captured.beforePrompt==="function"?{beforePrompt:captured.beforePrompt.bind(original)}:{}),...(typeof captured.onBinding==="function"?{onBinding:captured.onBinding.bind(original)}:{}),...(typeof captured.onNativeEvent==="function"?{onNativeEvent:captured.onNativeEvent.bind(original)}:{})};
  this.validate(input);
  }finally{this.starting=false;}
  this.admitted=true;const n=input.nativeInput!,events:NormalizedCliEvent[]=[];
  let failure:unknown;
  let completed=false,confirmed=false,nativeId:string|undefined,updates=0,resolveReady!:()=>void,rejectReady!:(error:unknown)=>void;
  const ready=new Promise<void>((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});void ready.catch(()=>{});
  const confirm=()=>{this.guard(input);if(!confirmed){confirmed=true;resolveReady();}};
  const cancelled=()=>rejectReady(this.error("COPILOT_RPC_UNREACHABLE"));this.shutdown.signal.addEventListener("abort",cancelled,{once:true});
  const observationFailure=(error:unknown)=>{failure=error;rejectReady(error);this.beginShutdown();};
  this.acquisitionAttempted=true;this.acquisitionEnded=false;
  this.opening=this.invoke(()=>CopilotRpcClient.openExecution(structuredClone(this.scope),{signal:this.shutdown.signal,beforeSend:()=>this.guard(input),beforeMutation:()=>{this.guard(input);this.creationPossible=true;}}),this.operations).settled.then(client=>{
   this.client=client;if(this.closed)void this.closeClient().catch(()=>{});return client;
  }).finally(()=>{this.acquisitionEnded=true;});void this.opening.catch(()=>{});
  const work=(async():Promise<CliTurnResult>=>{
   try{
    const client=await this.opening!;this.guard(input);
    const acquired=client.connectionScope;
    if(!isDeepStrictEqual([physical(acquired.executable,false),physical(acquired.workspacePath,true),physical(acquired.copilotHome,true)],this.paths))this.reject("COPILOT_RPC_SCOPE_CHANGED");
    await this.invoke(()=>client.bootstrap({mode:"new",model:n.executionSelection!.requestedModel!,onSessionKnown:async id=>{
     this.creationPossible=true;this.guard(input);
     if(typeof id!=="string"||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)||nativeId!==undefined&&nativeId!==id)this.reject("COPILOT_RPC_IDENTITY_CHANGED");nativeId=id;
     const binding:NativeBinding={version:1,product:"copilot",region:"global",profileId:this.scope.profileId,backendId:this.backendId,runnerId:this.scope.runnerId,nativeStoreRef:this.scope.nativeStoreRef,nativeSessionId:id,identityState:"bound",executionRefId:this.reference.id};
     try{await this.bounded(this.invoke(()=>input.onBinding!(structuredClone(binding))).settled,"COPILOT_RPC_BINDING_FAILED");}catch(error){this.persistenceFailed=true;throw error;}
     this.guard(input);
    }},{signal:this.shutdown.signal,beforeSend:()=>this.guard(input)}),this.operations).settled;
    this.guard(input);
    const result=await this.invoke(()=>client.prompt({sessionId:nativeId!,message:n.prompt},{signal:this.shutdown.signal,timeoutMs:30000,beforeSend:()=>this.guard(input),onUpdate:()=>{
     this.guard(input);updates++;events.push({type:"activity",summary:"Native Copilot activity",providerSessionId:nativeId!,executionEvidence:true});if(events.length>256)events.shift();
     void this.observe(input,{state:"running",observedAt:new Date().toISOString(),nativeSessionId:nativeId!}).then(confirm).catch(observationFailure);
    }}),this.operations).settled;
    const state=result.nativeStopReason==="aborted"?"cancelled":result.nativeStopReason==="idle"&&result.executionEvidence&&!result.toolFailure&&!result.permissionDenied&&result.pendingTools===0?"completed":"failed";
    // Bound the whole queued checkpoint, including terminal durability, independently of each ACK.
    await this.bounded(this.track((async()=>{
     await this.pipeline;this.guard(input);
     if(updates===0){await this.observe(input,{state:"running",observedAt:new Date().toISOString(),nativeSessionId:nativeId!});confirm();}
     await this.observe(input,{state:state==="completed"?"completed":"failed",observedAt:new Date().toISOString(),nativeSessionId:nativeId!});this.guard(input);
    })()),"COPILOT_RPC_CALLBACK_FAILED");
    return {state,summary:state==="completed"?"Native Copilot turn completed":state==="cancelled"?"Native Copilot turn cancelled":"Native Copilot turn could not be confirmed",providerSessionId:nativeId!,events};
   }catch(error){
    const wasClosed=this.closed&&failure===undefined;if(error instanceof AdapterStartError&&error.creationOutcome==="unknown")this.creationPossible=true;
    const wrapped=error instanceof AdapterStartError?error:this.error(error instanceof AdapterContractError?error.code:"COPILOT_RPC_OUTCOME_UNKNOWN");
    if(!wasClosed)failure=wrapped;if(!confirmed)rejectReady(wrapped);this.beginShutdown();if(this.client)void this.closeClient().catch(()=>{});
    if(!confirmed)throw wrapped;
    return {state:wasClosed?"cancelled":"failed",summary:wasClosed?"Local Copilot connection cancelled":"Native Copilot turn could not be confirmed",...(nativeId?{providerSessionId:nativeId}:{}),events};
   }finally{completed=true;this.shutdown.signal.removeEventListener("abort",cancelled);}
  })();this.work=this.track(work);void work.catch(()=>{});
  // Public cancellation releases callers while acquisition, client and sinks remain owned.
  const publicResult=new Promise<CliTurnResult>((resolve,reject)=>{
   const abort=()=>{completed=true;if(confirmed)resolve({state:failure===undefined?"cancelled":"failed",summary:failure===undefined?"Local Copilot connection cancelled":"Native Copilot turn could not be confirmed",...(nativeId?{providerSessionId:nativeId}:{}),events});else reject(failure??this.error("COPILOT_RPC_UNREACHABLE"));};
   this.shutdown.signal.addEventListener("abort",abort,{once:true});void work.then(resolve,reject).finally(()=>this.shutdown.signal.removeEventListener("abort",abort)).catch(()=>{});if(this.closed)abort();
  });void publicResult.catch(()=>{});
  return {ready:()=>ready,status:()=>completed?"completed":"running",result:async()=>structuredClone(await publicResult),events:()=>structuredClone(events),cancel:async()=>{await this.disconnectLocal();}};
 }
 beginShutdown():void{this.closed=true;this.shutdown.abort();}
 async disconnectLocal():Promise<LocalRuntimeDisconnect>{
  this.beginShutdown();this.cleanup??=Promise.resolve().then(async()=>{
   const closure=this.track((async()=>{try{const client=this.client??await this.opening;return client?await this.closeClient():undefined;}catch{return undefined;}})());
   let closeTimer:ReturnType<typeof setTimeout>|undefined,drainTimer:ReturnType<typeof setTimeout>|undefined;
   try{
    const [receipt,drained]=await Promise.all([
     Promise.race([closure,new Promise<undefined>(resolve=>{closeTimer=setTimeout(()=>resolve(undefined),2500);})]),
     Promise.race([Promise.resolve(this.work).catch(()=>{}).then(async()=>{await Promise.allSettled([...this.consumers]);return true;}),new Promise<boolean>(resolve=>{drainTimer=setTimeout(()=>resolve(false),500);})]),
    ]);
    return {version:1 as const,connection:receipt?.connection??(this.acquisitionAttempted?"unknown" as const:"closed" as const),ownedRoot:receipt?.ownedRoot??(this.acquisitionAttempted?"unknown" as const:"not-created" as const),callbacks:drained&&this.acquisitionEnded&&(receipt?receipt.callbacks==="drained":!this.acquisitionAttempted)?"drained" as const:"unknown" as const,backgroundTools:"unknown" as const,nativeSessionDeleted:false as const,...(receipt?.ownedRootPid===undefined?{}:{ownedRootPid:receipt.ownedRootPid})};
   }finally{if(closeTimer)clearTimeout(closeTimer);if(drainTimer)clearTimeout(drainTimer);}
  });return structuredClone(await this.cleanup);
 }
}
export const copilotManifest:AdapterManifest={
 apiVersion:1,id:"copilot",displayName:"Copilot RPC",platforms:["darwin","linux","win32"],
 configSchema:{type:"object",additionalProperties:false,properties:{executable:{type:"string"},copilotHome:{type:"string"}},required:["executable","copilotHome"]},
 uiSchema:{},secretFields:[],probes:[],backends:[{id:"copilot-rpc",kind:"headless-cli",priority:10,capabilities:["code","git","start","status","cancel","result","structured-events"]}],
 capabilities:{pause:false,resume:false,usage:false,diagnostics:true},
};
export class CopilotAdapter extends StructuredCliAdapter {
 constructor(profile:CliAgentProfile,backend:CliAgentBackend,store?:SessionStore){
  if(backend.backendId!=="copilot-rpc")throw failure("BACKEND_MISMATCH");
  physical(profile.executable??"",false);
  super({manifest:copilotManifest,defaultExecutable:"copilot",versionArgs:["--version"],authArgs:[],supportsResume:false,supportsExecutionSelection:true,requiresNativeBinding:true,strictLifecycle:true,requireExecutionEvidence:true,startArgs:()=>[]},profile,backend,store);
 }
}
