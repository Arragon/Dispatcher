import {isDeepStrictEqual} from "node:util";
import {isAbsolute} from "node:path";
import {isExecutionContextRef,validateExecutionBinding,type ExecutionContextRef,type ExecutionSelection,type InteractionCapabilities,type NativeBinding,type NativeTurnFact} from "@dispatcher/domain";
import {AdapterContractError,AdapterStartError} from "./contracts.js";
import {freezeExecutionSelection} from "./execution-selection.js";
import type {LocalRuntimeDisconnect,NativeInteractionPort} from "./interaction-contracts.js";
import type {CliAgentBackend,CliStartInput,CliTurn,CliTurnResult,NormalizedCliEvent} from "./ecosystem-cli.js";
import {normalizePiLine} from "./native-cli.js";
import {PiRpcClient,directory,text,type Directory} from "./pi-rpc-client.js";
import {PiRpcInteractionPort,record} from "./pi-rpc-read.js";

/** Internal producer contract; no default Adapter/Controller registration is implied. */
export interface PiRpcStartInput extends CliStartInput {
 executionRef?:ExecutionContextRef;
 nativeInput?:{version:1;profileId:string;backendId:string;runId:string;sessionId:string;commandId:string;newSession:boolean;prompt:string;approveTools:boolean;providerSessionId?:string;executionSelection?:ExecutionSelection};
 beforePrompt?:()=>void;
 onBinding?:(binding:NativeBinding)=>void|Promise<void>;
 onNativeEvent?:(fact:NativeTurnFact)=>void|Promise<void>;
}
export interface PiRpcTurn extends CliTurn {ready():Promise<void>}
export interface PiRpcExecutionScope {
 executable:string;workspacePath:string;agentDirectory:string;sessionDirectory:string;
 profileId:string;runnerId:string;nativeStoreRef:string;scopeFingerprint:string;
 evidence?:Partial<InteractionCapabilities>;
}
export interface PiRpcExecutionOptions {scope:PiRpcExecutionScope;executionRef:ExecutionContextRef}
/** One reserved managed execution. Local closure never grants native writer ownership. */
export class PiRpcExecutionBackend implements CliAgentBackend {
 readonly backendId="pi-rpc";
 private readonly scope:PiRpcExecutionScope;
 private readonly reference:ExecutionContextRef;
 private readonly directories:Directory[];
 private admitted=false;private closed=false;private created=false;
 private client?:PiRpcClient;private port?:PiRpcInteractionPort;private binding?:NativeBinding;
 private opening?:Promise<PiRpcClient>;private acquisitionEnded=true;private probeUnknown=false;
 private work?:Promise<CliTurnResult>;private cleanup?:Promise<LocalRuntimeDisconnect>;
 private readonly callbacks=new Set<Promise<unknown>>();
 private readonly shutdown=new AbortController();
 constructor(options:PiRpcExecutionOptions){
  this.scope=structuredClone(options.scope);this.reference=structuredClone(options.executionRef);
  const c=this.scope;
  if(![c.executable,c.profileId,c.runnerId,c.nativeStoreRef,c.scopeFingerprint].every(value=>text(value))||!isAbsolute(c.executable)||!isExecutionContextRef(this.reference)||this.reference.kind!=="managed-worktree"||this.reference.runnerId!==c.runnerId)this.rejectStart("PI_RPC_SCOPE_CHANGED");
  try{this.directories=[c.workspacePath,c.agentDirectory,c.sessionDirectory].map(directory);}catch{this.rejectStart("PI_RPC_SCOPE_CHANGED");}
 }
 private rejectStart(code:string):never{throw new AdapterStartError(this.created?"unknown":"not-created",code,"Pi RPC execution requires the original managed input");}
 private assertDirectories():void{try{if(!isDeepStrictEqual([this.scope.workspacePath,this.scope.agentDirectory,this.scope.sessionDirectory].map(directory),this.directories))throw Error();}catch{this.rejectStart("PI_RPC_SCOPE_CHANGED");}}
 private guard(input:PiRpcStartInput):void{
  if(this.closed)this.rejectStart("PI_RPC_LOCAL_CONNECTION_CLOSED");
  try{this.assertDirectories();if(input.executable!==this.scope.executable||!isDeepStrictEqual(input.executionRef,this.reference)||!isDeepStrictEqual(directory(input.workspacePath),this.directories[0]))this.rejectStart("PI_RPC_SCOPE_CHANGED");}catch{this.rejectStart("PI_RPC_SCOPE_CHANGED");}
  try{const result:unknown=input.beforePrompt!();if(result!==undefined){void Promise.resolve(result).catch(()=>undefined);this.rejectStart("PI_RPC_ADMISSION_MUST_BE_SYNCHRONOUS");}}
  catch(error){if(error instanceof AdapterStartError&&error.code==="PI_RPC_ADMISSION_MUST_BE_SYNCHRONOUS")throw error;this.rejectStart("PI_RPC_AUTHORITY_CHANGED");}
  if(this.closed)this.rejectStart("PI_RPC_LOCAL_CONNECTION_CLOSED");this.assertDirectories();
 }
 private validate(input:PiRpcStartInput):{provider:string;model:string}{
  const n=input.nativeInput,c=this.scope;
  if(!n||n.version!==1||n.profileId!==c.profileId||n.backendId!==this.backendId)this.rejectStart("PI_RPC_SCOPE_CHANGED");
  if(![n.runId,n.sessionId,n.commandId,n.providerSessionId].every(value=>text(value))||!/^([a-f0-9]{8}-){1}[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(n.providerSessionId!)||typeof n.prompt!=="string"||!n.prompt.length||Buffer.byteLength(n.prompt)>240_000||typeof input.beforePrompt!=="function"||typeof input.onBinding!=="function"||n.approveTools!==false||input.environment&&Object.keys(input.environment).length)this.rejectStart("PI_RPC_START_INVALID");
  if(!n.newSession)this.rejectStart("PI_RPC_CONTINUATION_REQUIRES_COMMAND_LANE");
  if(Object.hasOwn(n,"modelSelection")||Object.hasOwn(n,"legacyModel"))this.rejectStart("MODEL_LEGACY_REVIEW_REQUIRED");
  const selection=n.executionSelection,choice=selection?.requestedModel;
  if(!selection||!text(choice))this.rejectStart("PI_RPC_EXACT_MODEL_REQUIRED");
  const slash=choice.indexOf("/");if(slash<1||slash===choice.length-1)this.rejectStart("PI_RPC_EXACT_MODEL_REQUIRED");
  try{freezeExecutionSelection(selection,{profileId:c.profileId,providerId:"pi",backendId:this.backendId,selection:true,reasoning:false});}
  catch(error){this.rejectStart(error instanceof AdapterContractError?error.code:"PI_RPC_MODEL_SELECTION_INVALID");}
  if(this.reference.kind!=="managed-worktree")this.rejectStart("PI_RPC_SCOPE_CHANGED");
  const checked=validateExecutionBinding({profileId:c.profileId,providerId:"pi",backendId:this.backendId,runnerId:c.runnerId,executionRef:this.reference},selection,{repositoryId:this.reference.repositoryId,baseRevision:this.reference.baseRevision});if(!checked.valid)this.rejectStart(checked.code);
  this.guard(input);return {provider:choice.slice(0,slash),model:choice.slice(slash+1)};
 }
 source(ref:NativeBinding):NativeInteractionPort|undefined{
  if(this.closed||this.client?.disconnectSignal.aborted||!isDeepStrictEqual(ref,this.binding))return undefined;
  try{this.assertDirectories();this.client?.assertCurrentScope();return this.port;}catch{return undefined;}
 }
 private async persistBinding(input:PiRpcStartInput,ref:NativeBinding,client:PiRpcClient):Promise<void>{
  const callback=Promise.resolve().then(()=>input.onBinding!(structuredClone(ref))).finally(()=>this.callbacks.delete(callback));this.callbacks.add(callback);void callback.catch(()=>undefined);
  let cancelled:(()=>void)|undefined,disconnected:(()=>void)|undefined;
  try{await Promise.race([callback,new Promise<never>((_,reject)=>{cancelled=()=>reject(new AdapterStartError("unknown","PI_RPC_LOCAL_CONNECTION_CLOSED","Local Pi admission is closed"));disconnected=()=>reject(new AdapterStartError("unknown","PI_RPC_UNREACHABLE","Owned Pi connection was lost"));this.shutdown.signal.addEventListener("abort",cancelled,{once:true});client.disconnectSignal.addEventListener("abort",disconnected,{once:true});if(this.shutdown.signal.aborted)cancelled();else if(client.disconnectSignal.aborted)disconnected();})]);}
  catch(error){if(error instanceof AdapterStartError&&["PI_RPC_LOCAL_CONNECTION_CLOSED","PI_RPC_UNREACHABLE"].includes(error.code))throw error;this.rejectStart("PI_RPC_BINDING_PERSISTENCE_UNKNOWN");}
  finally{if(cancelled)this.shutdown.signal.removeEventListener("abort",cancelled);if(disconnected)client.disconnectSignal.removeEventListener("abort",disconnected);}
 }
 private async settleCallbacks():Promise<boolean>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([Promise.allSettled([...this.callbacks]).then(()=>true),new Promise<boolean>(resolve=>{timer=setTimeout(()=>resolve(false),500);})]);}
  finally{if(timer)clearTimeout(timer);}
 }
 start(original:PiRpcStartInput):PiRpcTurn{
  const input={...original,...(original.nativeInput?{nativeInput:structuredClone(original.nativeInput)}:{}),...(original.executionRef?{executionRef:structuredClone(original.executionRef)}:{})};
  const model=this.validate(input);if(this.admitted)this.rejectStart("PI_RPC_SESSION_ALREADY_ADMITTED");this.admitted=true;
  const n=input.nativeInput!,events:NormalizedCliEvent[]=[];let completed=false,proof=false,failed=false,written=false,settled:boolean|undefined;
  let finish!:(aborted:boolean)=>void;const terminal=new Promise<boolean>(resolve=>{finish=resolve;});
  let unsubscribe:(()=>void)|undefined,disconnected:(()=>void)|undefined;
  const emit=(fact:NativeTurnFact)=>{
   if(this.closed)return;
   if(this.callbacks.size>=64){failed=true;this.beginShutdown();return;}
   try{const returned:unknown=input.onNativeEvent?.(fact);if(returned!==undefined){const callback=Promise.resolve(returned).catch(()=>{failed=true;}).finally(()=>this.callbacks.delete(callback));this.callbacks.add(callback);}}
   catch{failed=true;}
  };
  this.acquisitionEnded=false;
  this.opening=PiRpcClient.open({executable:this.scope.executable,workspacePath:this.scope.workspacePath,agentDirectory:this.scope.agentDirectory,sessionDirectory:this.scope.sessionDirectory,sessionId:n.providerSessionId!,mode:"new",...model},{signal:this.shutdown.signal,beforeCreate:()=>this.guard(input)});
  const preparation=(async()=>{
   try{this.client=await this.opening!;this.created=true;this.guard(input);}
   catch(error){if(error instanceof AdapterStartError&&error.code==="PI_RPC_PROBE_EXIT_UNCONFIRMED")this.probeUnknown=true;throw error;}
   finally{this.acquisitionEnded=true;}
   const inspect=async()=>{const state=await this.client!.request("get_state",{},{signal:this.shutdown.signal,beforeSend:()=>this.guard(input)});this.guard(input);if(state.sessionId!==n.providerSessionId)this.rejectStart("PI_RPC_IDENTITY_CHANGED");const selected=record(state.model);if(selected.provider!==model.provider||selected.id!==model.model)this.rejectStart("MODEL_BINDING_DRIFT");if(state.isStreaming!==false||state.isCompacting!==false||state.pendingMessageCount!==0)this.rejectStart("PI_RPC_SESSION_BUSY");};
   await inspect();
   const ref:NativeBinding={version:1,product:"pi",region:"global",profileId:this.scope.profileId,backendId:this.backendId,runnerId:this.scope.runnerId,nativeStoreRef:this.scope.nativeStoreRef,nativeSessionId:n.providerSessionId!,identityState:"bound",executionRefId:this.reference.id};
   await this.persistBinding(input,ref,this.client);this.guard(input);await inspect();
   this.binding=structuredClone(ref);this.port=new PiRpcInteractionPort({binding:ref,scopeFingerprint:this.scope.scopeFingerprint,...(this.scope.evidence?{evidence:this.scope.evidence}:{})},this.client);
   disconnected=()=>finish(true);this.client.disconnectSignal.addEventListener("abort",disconnected,{once:true});this.shutdown.signal.addEventListener("abort",disconnected,{once:true});
   unsubscribe=this.client.onEvent(event=>{
    if(!written||this.closed)return;
    if(event.type==="agent_start")emit({state:"running",nativeSessionId:ref.nativeSessionId,observedAt:new Date().toISOString()});
    if(event.type==="message_end"){
     let normalized:NormalizedCliEvent|undefined;try{normalized=normalizePiLine(JSON.stringify(event));}catch{failed=true;}
     if(normalized){if(normalized.type==="failure"||normalized.type==="resource"){failed=true;normalized=normalized.type==="failure"?{type:"failure",reason:"Native Pi turn failed"}:{...normalized,reason:"Native Pi resource unavailable"};}else if(normalized.type==="activity")proof||=normalized.executionEvidence===true;events.push(normalized);if(events.length>256)events.shift();}
    }
    if(event.type==="agent_settled"){settled=event.aborted as boolean;finish(settled);}
   });
   const ack=await this.client.request("prompt",{message:n.prompt},{signal:this.shutdown.signal,beforeSend:()=>{this.guard(input);written=true;}});this.guard(input);
   emit({state:"received",nativeSessionId:ref.nativeSessionId,observedAt:new Date().toISOString()});return ack.disposition;
  })().catch(async error=>{this.beginShutdown();await this.client?.close().catch(()=>undefined);if(error instanceof AdapterStartError)throw error;throw new AdapterStartError(this.created?"unknown":"not-created",error instanceof AdapterContractError?error.code:this.closed?"PI_RPC_LOCAL_CONNECTION_CLOSED":"PI_RPC_START_OUTCOME_UNKNOWN","Pi RPC startup requires reconciliation");});void preparation.catch(()=>undefined);
  const work=preparation.then(async disposition=>{
   if(disposition==="handled")return {state:"waiting" as const,summary:"Native Pi prompt handled without a run",providerSessionId:n.providerSessionId!,events};
   const aborted=settled??await terminal;
   const outcome=()=>failed?"failed" as const:this.closed?"cancelled" as const:this.client!.disconnectSignal.aborted?"failed" as const:aborted?"cancelled" as const:!proof?"failed" as const:"completed" as const;
   unsubscribe?.();
   emit({state:outcome()==="completed"?"completed":"failed",nativeSessionId:n.providerSessionId!,observedAt:new Date().toISOString()});
   if(!await this.settleCallbacks())failed=true;
   const state=outcome();
   const summary=state==="completed"?[...events].reverse().find(event=>event.type==="activity")?.summary??"Native Pi turn completed":state==="cancelled"?"Local Pi execution cancelled":"Native Pi execution could not be confirmed";
   return {state,summary,providerSessionId:n.providerSessionId!,events} satisfies CliTurnResult;
  }).finally(()=>{completed=true;unsubscribe?.();if(disconnected){this.client?.disconnectSignal.removeEventListener("abort",disconnected);this.shutdown.signal.removeEventListener("abort",disconnected);}if(this.closed)void this.client?.close().catch(()=>undefined);});this.work=work;void work.catch(()=>undefined);
  return {ready:async()=>{await preparation;},status:()=>completed?"completed":"running",result:async()=>structuredClone(await work),events:()=>structuredClone(events),cancel:async()=>{await this.disconnectLocal();}};
 }
 beginShutdown():void{this.closed=true;this.shutdown.abort();}
 disconnectLocal():Promise<LocalRuntimeDisconnect>{
  this.beginShutdown();return this.cleanup??=(async()=>{
   const closed=(async()=>{try{const client=this.client??await this.opening;await client?.close();return !this.probeUnknown;}catch(error){return error instanceof AdapterStartError&&error.code!=="PI_RPC_PROBE_EXIT_UNCONFIRMED";}})();
   const drained=Promise.resolve(this.work).catch(()=>undefined).then(async()=>{await Promise.allSettled([...this.callbacks]);return true;});
   let closeTimer:ReturnType<typeof setTimeout>|undefined,drainTimer:ReturnType<typeof setTimeout>|undefined;
   try{const [confirmed,callbacks]=await Promise.all([Promise.race([closed,new Promise<boolean>(resolve=>{closeTimer=setTimeout(()=>resolve(false),2_500);})]),Promise.race([drained,new Promise<boolean>(resolve=>{drainTimer=setTimeout(()=>resolve(false),500);})])]);return {version:1,connection:confirmed?"closed":"unknown",ownedRoot:confirmed?(this.created?"exited":"not-created"):"unknown",callbacks:callbacks&&this.acquisitionEnded?"drained":"unknown",backgroundTools:"unknown",nativeSessionDeleted:false};}
   finally{if(closeTimer)clearTimeout(closeTimer);if(drainTimer)clearTimeout(drainTimer);}
  })();
 }
}

