import {createHash,randomUUID} from "node:crypto";
import {accessSync,constants,realpathSync,statSync} from "node:fs";
import {access} from "node:fs/promises";
import {isAbsolute} from "node:path";
import {isDeepStrictEqual} from "node:util";
import {AdapterContractError,AdapterStartError,assertAdapterWriteAdmission,freezeExecutionSelection,OpenCodeV2ExecutionBackend,OpenCodeV2OwnedServer,type CliAgentBackend,type CliAgentProfile,type CliStartInput,type CliTurn,type CliTurnResult,type NativeInteractionPort,type OpenCodeV2OwnedScope} from "@dispatcher/adapters";
import {isExecutionContextRef,validateExecutionBinding,type ExecutionContextRef,type ExecutionSelection,type NativeBinding,type NativeTurnFact} from "@dispatcher/domain";
import {NativeRuntimeHosts,type RuntimeHandle,type RuntimeLocalDisconnectResult} from "@dispatcher/runner";

interface DirectoryIdentity {path:string;dev:bigint;ino:bigint}
interface ExecutableIdentity {alias:string;path:string;dev:bigint;ino:bigint;size:bigint;mtimeNs:bigint}
function fail(code="OPENCODE_SCOPE_CHANGED"):never {throw new AdapterStartError("not-created",code,"OpenCode runtime admission requires its original canonical scope");}
const identifier=(value:unknown):value is string=>typeof value==="string"&&value.length>0&&value.length<=512&&Array.from(value).every(char=>char.charCodeAt(0)>=32&&char.charCodeAt(0)!==127);
function directory(path:string):DirectoryIdentity {
 try{if(typeof path!=="string"||!isAbsolute(path))return fail();const canonical=realpathSync(path),stat=statSync(canonical,{bigint:true});if(!stat.isDirectory())return fail();return {path:canonical,dev:stat.dev,ino:stat.ino};}catch{return fail();}
}
function executable(alias:unknown):ExecutableIdentity {
 try{if(typeof alias!=="string"||!isAbsolute(alias)||!alias.length||alias.length>4096||Array.from(alias).some(char=>char.charCodeAt(0)<32||char.charCodeAt(0)===127))return fail();const path=realpathSync(alias),stat=statSync(path,{bigint:true});if(!stat.isFile())return fail();accessSync(alias,constants.X_OK);return {alias,path,dev:stat.dev,ino:stat.ino,size:stat.size,mtimeNs:stat.mtimeNs};}catch{return fail();}
}
interface ExecutionHost {
 reference:Extract<ExecutionContextRef,{kind:"managed-worktree"}>;selection:ExecutionSelection;workspace:DirectoryIdentity;workspacePath:string;scope:OpenCodeV2OwnedScope;
 backend:OpenCodeV2ExecutionBackend;handle:Promise<RuntimeHandle>;creator?:symbol;binding?:NativeBinding;notCreatedClosed?:boolean;authorityFailed?:boolean;
}
interface RuntimeOptions {
 profile:CliAgentProfile;runnerId:string;assertInput:(input:CliStartInput)=>void;bindingFor:(nativeSessionId:string)=>NativeBinding|undefined;
 /** Trusted injection: custom backends must enforce the same actual-spawn guard. */
 factory?:(scope:OpenCodeV2OwnedScope,reference:ExecutionContextRef)=>OpenCodeV2ExecutionBackend;
}
function capture(original:CliStartInput):CliStartInput {
 try{
  // Spread reads each data/callback property once, including getter-backed properties.
  const {beforePrompt,onBinding,onNativeEvent,normalizeLine,...data}={...original};
  return {...structuredClone(data),...(beforePrompt?{beforePrompt:beforePrompt.bind(original)}:{}),...(onBinding?{onBinding:onBinding.bind(original)}:{}),...(onNativeEvent?{onNativeEvent:onNativeEvent.bind(original)}:{}),...(normalizeLine?{normalizeLine:normalizeLine.bind(original)}:{})};
 }catch{return fail();}
}
function fresh(input:CliStartInput):CliStartInput {
 const {beforePrompt,onBinding,onNativeEvent,normalizeLine,...data}=input;
 return {...structuredClone(data),...(beforePrompt?{beforePrompt}:{}),...(onBinding?{onBinding}:{}),...(onNativeEvent?{onNativeEvent}:{}),...(normalizeLine?{normalizeLine}:{})};
}
class AcquiringTurn implements CliTurn {
 private turn?:CliTurn;private failed=false;private readonly admission:Promise<void>;
 constructor(acquire:Promise<CliTurn>,lifetime:<T>(work:Promise<T>)=>Promise<T>,private readonly cancellation:()=>Promise<void>){
  this.admission=lifetime(acquire.then(async turn=>{this.turn=turn;await turn.ready?.();})).catch(error=>{this.failed=true;throw error;});void this.admission.catch(()=>undefined);
 }
 ready():Promise<void>{return this.admission;}
 status():"running"|"completed"{return this.failed?"completed":this.turn?.status()??"running";}
 events(){return this.turn?.events?.()??[];}
 async result():Promise<CliTurnResult>{await this.admission;return this.turn!.result();}
 cancel():Promise<void>{return this.cancellation();}
}

/** Per-execution Controller authority; the Adapter owns native protocol and raw host work. */
export class OpenCodeExecutionRuntime implements CliAgentBackend {
 readonly backendId="opencode-server-v2";
 readonly interaction?:NativeInteractionPort;
 private readonly options:RuntimeOptions;
 private readonly executable:ExecutableIdentity;
 private readonly hosts=new NativeRuntimeHosts();
 private readonly executions=new Map<string,ExecutionHost>();
 private readonly operations=new Set<Promise<unknown>>();
 private readonly abort=new AbortController();
 private closed=false;private cleanup?:Promise<RuntimeLocalDisconnectResult[]>;private receipts?:RuntimeLocalDisconnectResult[];
 constructor(options:RuntimeOptions){
  try{const profile=structuredClone(options.profile),runnerId=options.runnerId,assertInput=options.assertInput,bindingFor=options.bindingFor,factory=options.factory;
   if(!identifier(profile.id)||!identifier(runnerId)||typeof assertInput!=="function"||typeof bindingFor!=="function")fail();
   this.executable=executable(profile.executable);this.options=Object.freeze({profile,runnerId,assertInput:assertInput.bind(options),bindingFor:bindingFor.bind(options),...(factory?{factory:factory.bind(options)}:{})});
  }catch{throw new AdapterStartError("not-created","OPENCODE_SCOPE_CHANGED","OpenCode runtime requires an explicit executable and canonical owner");}
 }
 isClosed():boolean{return this.closed;}
 hasActiveOperations():boolean{return this.operations.size>0||[...this.executions.values()].some(entry=>entry.backend.hasActiveOperations());}
 hasUnclosedHosts():boolean{return this.receipts?this.receipts.some(receipt=>receipt.connection!=="closed"||receipt.ownedRoot==="unknown"||receipt.callbacks!=="drained"):[...this.executions.values()].some(entry=>!entry.notCreatedClosed);}
 beginShutdown():void {this.closed=true;this.abort.abort();for(const entry of this.executions.values())entry.backend.beginShutdown();}
 private track<T>(work:Promise<T>):Promise<T>{this.operations.add(work);void work.finally(()=>this.operations.delete(work)).catch(()=>undefined);return work;}
 private synchronous(callback:()=>void):void {
  assertAdapterWriteAdmission(()=>{
   const outcome:unknown=callback();
   // Normalize once: a custom thenable/getter must not enter untracked work twice.
   if(outcome!==undefined)return this.track(Promise.resolve(outcome));
  });
 }
 private physical(workspacePath:string,workspace:DirectoryIdentity):void {
  if(!isDeepStrictEqual(executable(this.executable.alias),this.executable)||!isDeepStrictEqual(directory(workspacePath),workspace))fail();
 }
 private open():void {if(this.closed)fail("OPENCODE_LOCAL_CONNECTION_CLOSED");}
 private validate(input:CliStartInput,workspace:DirectoryIdentity):void {
  this.open();const ref=input.executionRef,native=input.nativeInput;
  try{
   if(!isExecutionContextRef(ref)||ref.kind!=="managed-worktree"||ref.runnerId!==this.options.runnerId||input.executable!==this.executable.alias||!native||native.version!==1||native.profileId!==this.options.profile.id||native.backendId!==this.backendId||![native.runId,native.sessionId,native.commandId].every(identifier)||typeof native.prompt!=="string"||!native.prompt.length||native.prompt.length>262_144||native.approveTools!==false||typeof input.beforePrompt!=="function"||typeof input.onBinding!=="function"||typeof input.onNativeEvent!=="function"||input.environment&&Object.keys(input.environment).length)fail();
   if(!native.newSession||Object.hasOwn(native,"providerSessionId"))fail("OPENCODE_CONTINUATION_REQUIRES_COMMAND_LANE");
   if(Object.hasOwn(native,"legacyModel")||Object.hasOwn(native,"modelSelection"))fail("MODEL_LEGACY_REVIEW_REQUIRED");
   const selection=freezeExecutionSelection(native.executionSelection,{profileId:this.options.profile.id,providerId:"opencode",backendId:this.backendId,selection:true,reasoning:false}),choice=selection?.requestedModel;
   if(!selection||selection.selectionType!=="explicit-model"||!identifier(choice)||choice.indexOf("/")<1||choice.endsWith("/")||!validateExecutionBinding({profileId:this.options.profile.id,providerId:"opencode",backendId:this.backendId,runnerId:this.options.runnerId,executionRef:ref},selection,{repositoryId:ref.repositoryId,baseRevision:ref.baseRevision}).valid)fail();
   this.physical(input.workspacePath,workspace);this.synchronous(()=>this.options.assertInput(fresh(input)));this.physical(input.workspacePath,workspace);this.open();
  }catch(error){if(error instanceof AdapterStartError)throw error;fail();}
 }
 private registered(entry:ExecutionHost):void {this.open();if(this.executions.get(entry.reference.id)!==entry||entry.notCreatedClosed||entry.authorityFailed)fail();}
 private assertBinding(entry:ExecutionHost,binding:NativeBinding):void {
  const scope=entry.scope;
  if(!binding||binding.version!==1||binding.product!=="opencode"||binding.region!=="global"||binding.profileId!==scope.profileId||binding.backendId!==this.backendId||binding.runnerId!==scope.runnerId||binding.nativeStoreRef!==scope.nativeStoreRef||binding.executionRefId!==entry.reference.id||binding.identityState!=="bound"||!identifier(binding.nativeSessionId)||!/^ses[A-Za-z0-9_-]+$/.test(binding.nativeSessionId)||binding.nativeThreadId!==undefined||binding.parentSessionId!==undefined||entry.binding&&!isDeepStrictEqual(entry.binding,binding))fail("OPENCODE_BINDING_SCOPE_CHANGED");
 }
 private persisted(entry:ExecutionHost,binding:NativeBinding):void {
  this.assertBinding(entry,binding);const persisted=this.options.bindingFor(binding.nativeSessionId);this.registered(entry);
  if(!isDeepStrictEqual(persisted,binding))fail("OPENCODE_BINDING_SCOPE_CHANGED");
  // Lookup itself can synchronously revoke, delete or replace the durable owner.
  const current=this.options.bindingFor(binding.nativeSessionId);this.registered(entry);if(!isDeepStrictEqual(current,binding)||!isDeepStrictEqual(persisted,binding))fail("OPENCODE_BINDING_SCOPE_CHANGED");
 }
 source(original:NativeBinding):NativeInteractionPort|undefined {
  try{
   const binding=structuredClone(original);this.open();const entry=this.executions.get(binding.executionRefId);
   if(!entry?.binding||!isDeepStrictEqual(entry.binding,binding))return;
   this.assertBinding(entry,binding);this.physical(entry.workspacePath,entry.workspace);this.persisted(entry,binding);this.physical(entry.workspacePath,entry.workspace);
   const source=entry.backend.source(structuredClone(binding));this.registered(entry);this.persisted(entry,binding);this.physical(entry.workspacePath,entry.workspace);
   if(!isDeepStrictEqual(original,binding)||!isDeepStrictEqual(entry.binding,binding))return;return source;
  }catch{return;}
 }
 diagnostics(nativeSessionId:string):Record<string,unknown>{const entry=[...this.executions.values()].find(value=>value.binding?.nativeSessionId===nativeSessionId);return entry?{executionRefId:entry.reference.id,admission:this.closed?"closed":"open"}:{};}
 private async closeNotCreated(entry:ExecutionHost,token:symbol):Promise<void>{
  if(entry.binding||entry.creator!==undefined&&entry.creator!==token)return;
  try{const receipt=await entry.backend.disconnectLocal();if(entry.binding||entry.creator!==undefined&&entry.creator!==token||receipt.version!==1||receipt.connection!=="closed"||receipt.ownedRoot!=="not-created"||receipt.callbacks!=="drained"||receipt.backgroundTools!=="unknown"||receipt.nativeSessionDeleted!==false)return;entry.notCreatedClosed=true;if([...this.executions.values()].every(value=>value.notCreatedClosed))await this.disconnectLocal();}catch{/* Uncertain closure retains the original registration and barrier. */}
 }
 start(original:CliStartInput):CliTurn {
  const input=capture(original),workspace=directory(input.workspacePath);this.validate(input,workspace);
  const reference=input.executionRef as ExecutionHost["reference"],selection=input.nativeInput!.executionSelection!,token=Symbol("creation"),cancel=new AbortController();let entry:ExecutionHost|undefined,invoked=false;
  const guard=()=>{this.validate(input,workspace);if(cancel.signal.aborted)fail("OPENCODE_LOCAL_CONNECTION_CLOSED");if(entry){this.registered(entry);if(entry.creator!==token)fail("OPENCODE_SESSION_ALREADY_ADMITTED");if(entry.binding)this.persisted(entry,entry.binding);this.physical(input.workspacePath,workspace);this.registered(entry);}};
  const acquire=this.track((async()=>{
   await access(this.executable.alias,constants.X_OK);guard();
   entry=this.executions.get(reference.id);
   if(entry){
    if(!isDeepStrictEqual(entry.reference,reference)||!isDeepStrictEqual(entry.workspace,workspace)||!isDeepStrictEqual(entry.selection,selection))fail();
    if(entry.creator||entry.binding||entry.notCreatedClosed)fail("OPENCODE_SESSION_ALREADY_ADMITTED");
   }else{
    const nativeStoreRef=`native-store:${createHash("sha256").update(JSON.stringify(["opencode","global","default-native-environment-unqualified"])).digest("hex")}`;
    const scope:OpenCodeV2OwnedScope={profileId:this.options.profile.id,runnerId:this.options.runnerId,nativeStoreRef,workspacePath:workspace.path,scopeFingerprint:`scope:${createHash("sha256").update(JSON.stringify([this.options.profile.id,this.backendId,this.options.runnerId,nativeStoreRef,reference,selection,workspace,this.executable],(_key,value:unknown)=>typeof value==="bigint"?String(value):value)).digest("hex")}`,backendId:this.backendId,executable:this.executable.path};
    const backend=this.options.factory?this.options.factory(structuredClone(scope),structuredClone(reference)):new OpenCodeV2ExecutionBackend({scope,executionRef:structuredClone(reference),hostFactory:ownedScope=>new OpenCodeV2OwnedServer(ownedScope,guard)});
    if(backend.backendId!==this.backendId)fail("BACKEND_MISMATCH");
    try{guard();}catch(error){backend.beginShutdown();this.track(backend.disconnectLocal());throw error;}
    const handle=this.hosts.acquireRuntime({id:this.options.profile.id},{id:this.backendId,runnerId:scope.runnerId,nativeStoreRef,product:"opencode",region:"global",executionRefId:reference.id,ownership:"owned",acquire:async()=>({id:randomUUID(),profileId:scope.profileId,backendId:this.backendId,runnerId:scope.runnerId,nativeStoreRef,product:"opencode",region:"global",executionRefId:reference.id,ownership:"owned",interrupt:async(binding,request)=>{const source=this.source(binding);if(!source?.interrupt)throw new AdapterContractError("NATIVE_CAPABILITY_UNVERIFIED","No current exact OpenCode source");return source.interrupt(binding,request);},quiescent:async()=>false,stop:async()=>{throw new AdapterContractError("NATIVE_CAPABILITY_UNVERIFIED","Native writer release is unqualified");},detach:async()=>{throw new AdapterContractError("NATIVE_CAPABILITY_UNVERIFIED","Use explicit local cleanup");},disconnectLocal:()=>backend.disconnectLocal()})});
    entry={scope,reference:structuredClone(reference),selection:structuredClone(selection),workspace,workspacePath:input.workspacePath,backend,handle};this.executions.set(reference.id,entry);
   }
   entry.creator=token;await entry.handle;guard();const captured=entry;invoked=true;
   const bridge=async(binding:NativeBinding|undefined,callback:()=>void|Promise<void>)=>{
    try{guard();if(binding)this.assertBinding(captured,binding);await callback();guard();if(binding)this.persisted(captured,binding);this.physical(input.workspacePath,workspace);this.registered(captured);}catch(error){captured.authorityFailed=true;throw error;}
   };
   return captured.backend.start({...fresh(input),executable:this.executable.path,beforePrompt:()=>{guard();this.synchronous(input.beforePrompt!);guard();},onBinding:async originalBinding=>{
    const binding=structuredClone(originalBinding);await bridge(binding,()=>input.onBinding!(structuredClone(binding)));captured.binding=structuredClone(binding);
   },onNativeEvent:async originalFact=>{
    const fact:NativeTurnFact=structuredClone(originalFact);if(!captured.binding||fact.nativeSessionId!==captured.binding.nativeSessionId)fail("OPENCODE_BINDING_SCOPE_CHANGED");await bridge(captured.binding,()=>input.onNativeEvent!(fact));
   }});
  })().catch(async error=>{
   const failure=error instanceof AdapterStartError?error:new AdapterStartError(invoked?"unknown":"not-created","OPENCODE_RUNTIME_ADMISSION_FAILED","OpenCode runtime admission requires reconciliation");
   if(failure.creationOutcome==="not-created"&&entry&&(entry.creator===token||!entry.creator))await this.closeNotCreated(entry,token);throw failure;
  }));
  const lifetime=<T>(work:Promise<T>):Promise<T>=>new Promise<T>((resolve,reject)=>{
   const closed=()=>reject(new AdapterStartError(invoked?"unknown":"not-created","OPENCODE_LOCAL_CONNECTION_CLOSED","Local OpenCode admission is closed"));
   this.abort.signal.addEventListener("abort",closed,{once:true});cancel.signal.addEventListener("abort",closed,{once:true});void work.then(resolve,reject).finally(()=>{this.abort.signal.removeEventListener("abort",closed);cancel.signal.removeEventListener("abort",closed);}).catch(()=>undefined);if(this.closed||cancel.signal.aborted)closed();
  });
  return new AcquiringTurn(acquire,lifetime,async()=>{cancel.abort();if(entry?.creator===token){entry.backend.beginShutdown();await entry.backend.disconnectLocal();}});
 }
 async disconnectLocal():Promise<RuntimeLocalDisconnectResult[]>{this.beginShutdown();this.cleanup??=this.hosts.shutdownLocal().then(receipts=>{this.receipts=structuredClone(receipts);return receipts;});return structuredClone(await this.cleanup);}
}
