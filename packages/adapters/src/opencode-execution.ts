import {realpathSync,statSync} from "node:fs";
import {isAbsolute} from "node:path";
import {isDeepStrictEqual} from "node:util";
import {isExecutionContextRef,validateExecutionBinding,type ExecutionContextRef,type NativeBinding,type NativeTurnFact} from "@dispatcher/domain";
import {AdapterContractError,AdapterStartError} from "./contracts.js";
import {freezeExecutionSelection} from "./execution-selection.js";
import type {CliAgentBackend,CliStartInput,CliTurn,CliTurnResult,NormalizedCliEvent} from "./ecosystem-cli.js";
import type {LocalRuntimeDisconnect} from "./interaction-contracts.js";
import {OpenCodeV2OwnedServer,type OpenCodeV2OwnedScope} from "./opencode-owned-server.js";
import {OpenCodeV2Error,type OpenCodeV2InteractionPort,type OpenCodeV2Model} from "./opencode-server.js";

type Host=Pick<OpenCodeV2OwnedServer,"ready"|"disconnectLocal">;
export interface OpenCodeV2ExecutionOptions {
 scope:OpenCodeV2OwnedScope;executionRef:ExecutionContextRef;
 hostFactory?:(scope:OpenCodeV2OwnedScope)=>Host|Promise<Host>;
}
function fail(code:string):never {throw new AdapterStartError("not-created",code,"OpenCode execution requires the original qualified input");}
function directory(path:string):{path:string;dev:bigint;ino:bigint} {try{const canonical=realpathSync(path),stat=statSync(canonical,{bigint:true});if(!isAbsolute(path)||!stat.isDirectory())throw Error();return {path:canonical,dev:stat.dev,ino:stat.ino};}catch{fail("OPENCODE_SCOPE_CHANGED");}}
const identifier=(value:unknown):value is string=>typeof value==="string"&&value.length>0&&value.length<=512&&Array.from(value).every(char=>char.charCodeAt(0)>=32&&char.charCodeAt(0)!==127);
const unknownCleanup=():LocalRuntimeDisconnect=>({version:1,connection:"unknown",ownedRoot:"unknown",callbacks:"unknown",backgroundTools:"unknown",nativeSessionDeleted:false});

/** One owned execution. Public cancellation never abandons admitted persistence or acquisition. */
export class OpenCodeV2ExecutionBackend implements CliAgentBackend {
 readonly backendId="opencode-server-v2";
 private readonly scope:OpenCodeV2OwnedScope;
 private readonly reference:Extract<ExecutionContextRef,{kind:"managed-worktree"}>;
 private readonly workspace:ReturnType<typeof directory>;
 private readonly factory:NonNullable<OpenCodeV2ExecutionOptions["hostFactory"]>;
 private host?:Host;
 private opening?:Promise<Host>;
 private hostCleanup?:Promise<LocalRuntimeDisconnect>;
 private port?:OpenCodeV2InteractionPort;
 private binding?:NativeBinding;
 private closed=false;
 private admitted=false;
 private creationObserved=false;
 private creationPossible=false;
 private persistenceFailed=false;
 private readonly operations=new Set<Promise<unknown>>();
 private readonly callbacks=new Set<Promise<unknown>>();
 private pipeline:Promise<void>=Promise.resolve();
 private readonly abort=new AbortController();
 private cleanup?:Promise<LocalRuntimeDisconnect>;
 constructor(options:OpenCodeV2ExecutionOptions){
  this.scope=structuredClone(options.scope);const reference=structuredClone(options.executionRef);
  this.workspace=directory(this.scope.workspacePath);
  if(this.scope.backendId!==this.backendId||typeof this.scope.executable!=="string"||!this.scope.executable.length||this.scope.executable.length>4096||Array.from(this.scope.executable).some(char=>char.charCodeAt(0)<32||char.charCodeAt(0)===127)||![this.scope.profileId,this.scope.runnerId,this.scope.nativeStoreRef,this.scope.scopeFingerprint].every(identifier)||!isExecutionContextRef(reference)||reference.kind!=="managed-worktree"||reference.runnerId!==this.scope.runnerId)fail("OPENCODE_SCOPE_CHANGED");
  this.reference=reference;this.factory=options.hostFactory?.bind(options)??(scope=>new OpenCodeV2OwnedServer(scope));
 }
 private assertWorkspace():void {if(!isDeepStrictEqual(directory(this.scope.workspacePath),this.workspace))fail("OPENCODE_SCOPE_CHANGED");}
 source(binding:NativeBinding):OpenCodeV2InteractionPort|undefined {
  if(this.closed||!this.port||!isDeepStrictEqual(binding,this.binding))return;
  try{this.assertWorkspace();this.port.readHandle(binding);return this.port;}catch{return;}
 }
 get interaction():OpenCodeV2InteractionPort|undefined {return this.binding?this.source(this.binding):undefined;}
 hasActiveOperations():boolean {return this.operations.size>0||this.callbacks.size>0;}
 private track<T>(work:Promise<T>,set=this.operations):Promise<T>{set.add(work);void work.finally(()=>set.delete(work)).catch(()=>undefined);return work;}
 private guard(input:CliStartInput):void {
  if(this.closed)fail("OPENCODE_LOCAL_CONNECTION_CLOSED");
  if(this.persistenceFailed)fail("OPENCODE_BINDING_PERSISTENCE_UNKNOWN");
  this.assertWorkspace();
  if(!isDeepStrictEqual(input.executionRef,this.reference)||input.executable!==this.scope.executable||!isDeepStrictEqual(directory(input.workspacePath),this.workspace))fail("OPENCODE_SCOPE_CHANGED");
  let returned:unknown;
  try{returned=input.beforePrompt!();}catch{fail("OPENCODE_AUTHORITY_CHANGED");}
  if(returned!==undefined){void Promise.resolve(returned).catch(()=>undefined);fail("OPENCODE_ADMISSION_MUST_BE_SYNCHRONOUS");}
  if(this.closed)fail("OPENCODE_LOCAL_CONNECTION_CLOSED");
  this.assertWorkspace();if(!isDeepStrictEqual(directory(input.workspacePath),this.workspace))fail("OPENCODE_SCOPE_CHANGED");
 }
 private validate(input:CliStartInput):OpenCodeV2Model {
  const native=input.nativeInput;
  if(!native||native.version!==1||native.profileId!==this.scope.profileId||native.backendId!==this.backendId||![native.runId,native.sessionId,native.commandId].every(identifier)||typeof native.prompt!=="string"||!native.prompt.length||native.prompt.length>262_144||typeof input.beforePrompt!=="function"||typeof input.onBinding!=="function"||typeof input.onNativeEvent!=="function")fail("OPENCODE_START_INVALID");
  if(!native.newSession||Object.hasOwn(native,"providerSessionId"))fail("OPENCODE_CONTINUATION_REQUIRES_COMMAND_LANE");
  if(native.approveTools!==false)fail("OPENCODE_TOOL_APPROVAL_UNQUALIFIED");
  if(input.environment&&Object.keys(input.environment).length)fail("OPENCODE_ENVIRONMENT_UNSUPPORTED");
  if(Object.hasOwn(native,"modelSelection")||Object.hasOwn(native,"legacyModel"))fail("MODEL_LEGACY_REVIEW_REQUIRED");
  const selection=native.executionSelection,choice=selection?.requestedModel;
  if(!selection||selection.selectionType!=="explicit-model"||!identifier(choice))fail("OPENCODE_EXACT_MODEL_REQUIRED");
  const slash=choice.indexOf("/");if(slash<1||slash===choice.length-1)fail("OPENCODE_EXACT_MODEL_REQUIRED");
  try{freezeExecutionSelection(selection,{profileId:this.scope.profileId,providerId:"opencode",backendId:this.backendId,selection:true,reasoning:false});}catch(error){fail(error instanceof AdapterContractError?error.code:"OPENCODE_MODEL_SELECTION_INVALID");}
  const check=validateExecutionBinding({profileId:this.scope.profileId,providerId:"opencode",backendId:this.backendId,runnerId:this.scope.runnerId,executionRef:this.reference},selection,{repositoryId:this.reference.repositoryId,baseRevision:this.reference.baseRevision});
  if(!check.valid)fail(check.code);
  this.guard(input);return {providerID:choice.slice(0,slash),id:choice.slice(slash+1)};
 }
 private assertBinding(binding:NativeBinding):void {
  const c=this.scope;
  if(binding.version!==1||binding.product!=="opencode"||binding.region!=="global"||binding.profileId!==c.profileId||binding.backendId!==this.backendId||binding.runnerId!==c.runnerId||binding.nativeStoreRef!==c.nativeStoreRef||binding.executionRefId!==this.reference.id||binding.identityState!=="bound"||!identifier(binding.nativeSessionId)||!/^ses[A-Za-z0-9_-]+$/.test(binding.nativeSessionId)||binding.nativeThreadId!==undefined||binding.parentSessionId!==undefined||this.binding&&!isDeepStrictEqual(this.binding,binding))fail("OPENCODE_BINDING_SCOPE_CHANGED");
 }
 private error(error:unknown):AdapterStartError {
  const outcome=this.creationObserved?"unknown":error instanceof AdapterStartError?error.creationOutcome:error instanceof OpenCodeV2Error?error.outcome:this.creationPossible?"unknown":"not-created";
  const code=error instanceof AdapterStartError||error instanceof OpenCodeV2Error||error instanceof AdapterContractError?error.code:"OPENCODE_RUNTIME_UNAVAILABLE";
  return new AdapterStartError(outcome,/^[A-Z0-9_]{1,100}$/.test(code)?code:"OPENCODE_START_OUTCOME_UNKNOWN","OpenCode execution requires reconciliation");
 }
 private lifetime<T>(work:Promise<T>):Promise<T>{
  return new Promise<T>((resolve,reject)=>{
   const closed=()=>reject(this.error(new AdapterStartError(this.creationPossible?"unknown":"not-created","OPENCODE_LOCAL_CONNECTION_CLOSED","Local admission closed")));
   this.abort.signal.addEventListener("abort",closed,{once:true});
   void work.then(resolve,reject).finally(()=>this.abort.signal.removeEventListener("abort",closed)).catch(()=>undefined);
   if(this.closed)closed();
  });
 }
 private fact(input:CliStartInput,callback:()=>void|Promise<void>):Promise<void>{
  const work=this.pipeline.then(async()=>{
   this.guard(input);
   await callback();this.guard(input);
  }).catch(error=>{this.persistenceFailed=true;this.port?.markDisconnected();throw error;});
  this.pipeline=work;this.track(work,this.callbacks);return work;
 }
 private async bounded<T>(work:Promise<T>,ms:number):Promise<{settled:true;value:T}|{settled:false}>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([work.then(value=>({settled:true as const,value})),new Promise<{settled:false}>(resolve=>{timer=setTimeout(()=>resolve({settled:false}),ms);})]);}finally{if(timer)clearTimeout(timer);}
 }
 start(original:CliStartInput):CliTurn {
  const input={...original,...(original.nativeInput?{nativeInput:structuredClone(original.nativeInput)}:{}),...(original.executionRef?{executionRef:structuredClone(original.executionRef)}:{})};
  const model=this.validate(input);if(this.admitted)fail("OPENCODE_SESSION_ALREADY_ADMITTED");this.admitted=true;
  const native=input.nativeInput!,events:NormalizedCliEvent[]=[];let completed=false;
  const emit=(originalFact:NativeTurnFact)=>{const fact=structuredClone(originalFact);return this.fact(input,()=>input.onNativeEvent!(fact));};
  let acquired:Host|Promise<Host>;try{this.guard(input);acquired=this.factory(structuredClone(this.scope));}catch(error){throw this.error(error);}
  this.opening=this.track(Promise.resolve(acquired).then(host=>{this.host=host;if(this.closed)void this.cleanHost();return host;}));
  const preparation=this.track((async()=>{
   const host=await this.opening!,port=await host.ready();this.guard(input);
   if(!isDeepStrictEqual([port.scope.profileId,port.scope.runnerId,port.scope.nativeStoreRef,port.scope.backendId,port.scope.scopeFingerprint,directory(port.scope.workspacePath)],[this.scope.profileId,this.scope.runnerId,this.scope.nativeStoreRef,this.backendId,this.scope.scopeFingerprint,this.workspace]))fail("OPENCODE_SCOPE_CHANGED");
   this.port=port;
   // The public lifetime race cannot prove an in-flight create POST was unsent.
   this.creationPossible=true;
   const created=await port.create({executionRefId:this.reference.id,executionRef:structuredClone(this.reference),commandId:native.commandId,prompt:native.prompt,model,permissions:[],beforePrompt:()=>this.guard(input),onBinding:async originalBinding=>{
    this.creationObserved=true;const binding=structuredClone(originalBinding);this.guard(input);this.assertBinding(binding);
    await this.fact(input,async()=>{await input.onBinding!(structuredClone(binding));});this.guard(input);this.binding=structuredClone(binding);
   },onNativeEvent:emit});
   this.creationObserved=true;this.guard(input);this.assertBinding(created.binding);
   if(created.receipt.state!=="accepted")throw new OpenCodeV2Error(created.receipt.code??"OPENCODE_PROMPT_OUTCOME_UNKNOWN");
   return created.binding;
  })().catch(error=>{this.port?.markDisconnected();throw this.error(error);}));
  const ready=this.lifetime(preparation);void ready.catch(()=>undefined);
  const rawWork=this.track(preparation.then(async binding=>{
   for(;;){
    this.guard(input);const result=await this.port!.readTurn(binding,native.commandId,{signal:this.abort.signal});this.guard(input);
    if(result.state!=="pending"){
     let state:CliTurnResult["state"]=result.state==="succeeded"?"completed":result.state==="interrupted"?"cancelled":"failed";
     let summary=result.summary??`Native turn ${result.state}`;
     try{const persisted=await this.bounded(emit({state:state==="completed"?"completed":"failed",nativeSessionId:binding.nativeSessionId,nativeMessageId:result.nativeMessageId,...(result.nativeTerminalMessageId?{nativeTurnId:result.nativeTerminalMessageId}:{}),observedAt:new Date().toISOString()}),500);if(!persisted.settled){this.persistenceFailed=true;this.port?.markDisconnected();state="failed";}}catch{state="failed";}
     if(state==="failed")summary="Native OpenCode execution requires reconciliation";
     events.push(state==="completed"?{type:"activity",summary,providerSessionId:binding.nativeSessionId,executionEvidence:true}:{type:"failure",reason:summary});
     return {state,summary,providerSessionId:binding.nativeSessionId,events} satisfies CliTurnResult;
    }
    await new Promise<void>(resolve=>{const wake=()=>{clearTimeout(timer);this.abort.signal.removeEventListener("abort",wake);resolve();};const timer=setTimeout(wake,100);this.abort.signal.addEventListener("abort",wake,{once:true});if(this.closed)wake();});
   }
  }).catch(error=>{throw this.error(error);}));
  const work=this.lifetime(rawWork).finally(()=>{completed=true;});void work.catch(()=>undefined);
  return {ready:async()=>{await ready;},status:()=>completed?"completed":"running",result:async()=>structuredClone(await work),events:()=>structuredClone(events),cancel:async()=>{await this.disconnectLocal();}};
 }
 beginShutdown():void {this.closed=true;this.abort.abort();this.port?.markDisconnected();}
 private cleanHost():Promise<LocalRuntimeDisconnect>{return this.hostCleanup??=this.track((async()=>{
  try{const receipt=await this.host!.disconnectLocal();if(receipt.version!==1||!["closed","unknown"].includes(receipt.connection)||!["exited","not-created","unknown"].includes(receipt.ownedRoot)||!["drained","unknown"].includes(receipt.callbacks)||receipt.backgroundTools!=="unknown"||receipt.nativeSessionDeleted!==false||receipt.ownedRootPid!==undefined&&(!Number.isSafeInteger(receipt.ownedRootPid)||receipt.ownedRootPid<=0))return unknownCleanup();return {version:1,connection:receipt.connection,ownedRoot:receipt.ownedRoot,callbacks:receipt.callbacks,backgroundTools:"unknown",nativeSessionDeleted:false,...(receipt.ownedRootPid===undefined?{}:{ownedRootPid:receipt.ownedRootPid})};}catch{return unknownCleanup();}
 })());}
 async disconnectLocal():Promise<LocalRuntimeDisconnect>{
  this.beginShutdown();this.cleanup??=(async()=>{
   const noHost:LocalRuntimeDisconnect={version:1,connection:"closed",ownedRoot:"not-created",callbacks:"drained",backgroundTools:"unknown",nativeSessionDeleted:false};
   const acquired=(async()=>{try{await this.opening;}catch{/* Failure before host acquisition has no owned service. */}return this.host?this.cleanHost():noHost;})();
   const closed=await this.bounded(acquired,2500),receipt=closed.settled?closed.value:unknownCleanup();
   const drained=await this.bounded(Promise.allSettled([...this.operations,...this.callbacks]),500);
   return {...receipt,callbacks:receipt.callbacks==="drained"&&drained.settled?"drained" as const:"unknown" as const};
  })();return structuredClone(await this.cleanup);
 }
}
