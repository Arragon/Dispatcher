import {createHash,randomUUID} from "node:crypto";
import {realpathSync,statSync} from "node:fs";
import {isAbsolute} from "node:path";
import {isDeepStrictEqual} from "node:util";
import {AdapterContractError,AdapterStartError,PiRpcExecutionBackend,type PiRpcExecutionScope,type CliAgentBackend,type CliAgentProfile,type CliStartInput,type CliTurn,type CliTurnResult,type NativeInteractionPort} from "@dispatcher/adapters";
import {isExecutionContextRef,type ExecutionContextRef,type NativeBinding} from "@dispatcher/domain";
import {NativeRuntimeHosts,type RuntimeHandle,type RuntimeLocalDisconnectResult} from "@dispatcher/runner";
interface DirectoryIdentity {path:string;dev:bigint;ino:bigint}
function reject(code="PI_RPC_SCOPE_CHANGED"):never{throw new AdapterStartError("not-created",code,"The original managed Pi execution is unavailable");}
function directory(path:string):DirectoryIdentity{try{if(typeof path!=="string"||!isAbsolute(path))throw Error();const physical=realpathSync(path),stat=statSync(physical,{bigint:true});if(!stat.isDirectory())throw Error();return {path:physical,dev:stat.dev,ino:stat.ino};}catch{return reject();}}
export function assertPiRuntimeSettings(profile:CliAgentProfile,agentDirectory:string,sessionDirectory:string):void{
 if(typeof profile.executable!=="string"||!isAbsolute(profile.executable))reject();directory(agentDirectory);directory(sessionDirectory);
}
interface RuntimeOptions {profile:CliAgentProfile;agentDirectory:string;sessionDirectory:string;runnerId:string;assertInput:(input:CliStartInput)=>void;bindingFor:(nativeSessionId:string)=>NativeBinding|undefined;factory?:(scope:PiRpcExecutionScope,reference:ExecutionContextRef)=>PiRpcExecutionBackend}
interface ExecutionHost {reference:ExecutionContextRef;workspace:DirectoryIdentity;backend:PiRpcExecutionBackend;handle:Promise<RuntimeHandle>;creationAdmitted:boolean;binding?:NativeBinding;notCreatedClosed?:boolean}
class AcquiringTurn implements CliTurn {
 private turn?:CliTurn;private failed=false;private readonly admission:Promise<void>;
 constructor(acquire:()=>Promise<CliTurn>,private readonly close:()=>Promise<void>,onFailure:(error:unknown)=>Promise<void>){this.admission=acquire().then(async turn=>{this.turn=turn;await turn.ready?.();}).catch(async error=>{this.failed=true;await onFailure(error);throw error;});void this.admission.catch(()=>undefined);}
 ready():Promise<void>{return this.admission;}
 status():"running"|"completed"{return this.failed?"completed":this.turn?.status()??"running";}
 async result():Promise<CliTurnResult>{await this.admission;return this.turn!.result();}
 events(){return this.turn?.events?.()??[];}
 cancel():Promise<void>{return this.close();}
}
/** Routes original managed scopes only; Pi protocol parsing remains in Adapter. */
export class PiExecutionRuntime implements CliAgentBackend {
 readonly backendId="pi-rpc";
 private readonly options:RuntimeOptions;
 private readonly nativeDirectories:DirectoryIdentity[];
 private readonly hosts=new NativeRuntimeHosts();
 private readonly executions=new Map<string,ExecutionHost>();
 private readonly operations=new Set<Promise<unknown>>();
 private closed=false;private cleanup?:Promise<RuntimeLocalDisconnectResult[]>;private receipts?:RuntimeLocalDisconnectResult[];
 constructor(options:RuntimeOptions){
  this.options=Object.freeze({...options,profile:structuredClone(options.profile),assertInput:options.assertInput.bind(options),bindingFor:options.bindingFor.bind(options),...(options.factory?{factory:options.factory.bind(options)}:{})});
  assertPiRuntimeSettings(this.options.profile,this.options.agentDirectory,this.options.sessionDirectory);this.nativeDirectories=[options.agentDirectory,options.sessionDirectory].map(directory);
 }
 isClosed():boolean{return this.closed;}
 hasActiveOperations():boolean{return this.operations.size>0||[...this.executions.values()].some(entry=>entry.backend.hasActiveOperations());}
 private track<T>(work:Promise<T>):Promise<T>{this.operations.add(work);void work.then(()=>this.operations.delete(work),()=>this.operations.delete(work));return work;}
 hasUnclosedHosts():boolean{return this.executions.size>0&&(!this.receipts||this.receipts.some(receipt=>receipt.connection!=="closed"||receipt.ownedRoot==="unknown"||receipt.callbacks!=="drained"));}
 beginShutdown():void{this.closed=true;for(const entry of this.executions.values())entry.backend.beginShutdown();}
 source(binding:NativeBinding):NativeInteractionPort|undefined{
  const entry=this.executions.get(binding.executionRefId);if(this.closed||binding.profileId!==this.options.profile.id||!entry?.binding||!isDeepStrictEqual(entry.binding,binding)||!isDeepStrictEqual(this.options.bindingFor(binding.nativeSessionId),binding))return undefined;
  try{this.assertDirectories();return entry.backend.source(binding);}catch{return undefined;}
 }
 diagnostics(nativeSessionId:string):Record<string,unknown>{const entry=[...this.executions.values()].find(value=>value.binding?.nativeSessionId===nativeSessionId);return entry?{executionRefId:entry.reference.id,localConnection:this.closed?"closed":"open"}:{};}
 private async closeNotCreated(entry:ExecutionHost):Promise<void>{
  try{
   const receipt=await entry.backend.disconnectLocal();
   if(entry.binding||receipt.version!==1||receipt.connection!=="closed"||receipt.ownedRoot!=="not-created"||receipt.callbacks!=="drained"||receipt.backgroundTools!=="unknown"||receipt.nativeSessionDeleted!==false)return;
   entry.notCreatedClosed=true;
   // Keep all registered hosts until the owning manager confirms complete cleanup.
   if([...this.executions.values()].every(value=>value.notCreatedClosed))await this.disconnectLocal();
  }catch{/* Unconfirmed cleanup retains the registered host and profile barrier. */}
 }
 private assertDirectories():void{if(!isDeepStrictEqual([this.options.agentDirectory,this.options.sessionDirectory].map(directory),this.nativeDirectories))reject();}
 private validate(input:CliStartInput,workspace:DirectoryIdentity):void{
  if(this.closed)reject("PI_RPC_LOCAL_CONNECTION_CLOSED");
  const ref=input.executionRef,n=input.nativeInput;
  if(!isExecutionContextRef(ref)||ref.kind!=="managed-worktree"||ref.runnerId!==this.options.runnerId||!n||n.profileId!==this.options.profile.id||n.backendId!==this.backendId||input.executable!==this.options.profile.executable)reject();
  if(!n.newSession)reject("PI_RPC_CONTINUATION_REQUIRES_COMMAND_LANE");
  if(typeof n.providerSessionId!=="string"||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(n.providerSessionId)||typeof input.beforePrompt!=="function"||typeof input.onBinding!=="function")reject("PI_RPC_START_INVALID");
  try{this.assertDirectories();if(!isDeepStrictEqual(directory(input.workspacePath),workspace))reject();const result:unknown=this.options.assertInput(input);if(result!==undefined){this.track(Promise.resolve(result));reject();}this.assertDirectories();if(!isDeepStrictEqual(directory(input.workspacePath),workspace))reject();}catch{return reject();}
  if(this.closed)reject("PI_RPC_LOCAL_CONNECTION_CLOSED");
 }
 start(original:CliStartInput):CliTurn{
  const input={...original,...(original.executionRef?{executionRef:structuredClone(original.executionRef)}:{}),...(original.nativeInput?{nativeInput:structuredClone(original.nativeInput)}:{})},workspace=directory(input.workspacePath);this.validate(input,workspace);
  let cancelled=false,ownsCreation=false,captured:ExecutionHost|undefined;const guard=()=>{if(cancelled)reject("PI_RPC_LOCAL_CONNECTION_CLOSED");this.validate(input,workspace);};
  const turn=new AcquiringTurn(async()=>{
   guard();const reference=input.executionRef!;let entry=this.executions.get(reference.id);
   if(entry&&(!isDeepStrictEqual(entry.reference,reference)||!isDeepStrictEqual(entry.workspace,workspace)))reject();
   if(!entry){
    const nativeStoreRef=`native-store:${createHash("sha256").update(JSON.stringify(["pi","global",...this.nativeDirectories.map(value=>[value.path,String(value.dev),String(value.ino)])])).digest("hex")}`;
    const scope:PiRpcExecutionScope={profileId:this.options.profile.id,runnerId:this.options.runnerId,nativeStoreRef,workspacePath:workspace.path,agentDirectory:this.nativeDirectories[0]!.path,sessionDirectory:this.nativeDirectories[1]!.path,scopeFingerprint:`scope:${createHash("sha256").update(JSON.stringify([this.options.profile.id,this.backendId,this.options.runnerId,nativeStoreRef,reference,workspace.path])).digest("hex")}`,executable:this.options.profile.executable!};
    const backend=this.options.factory?.(structuredClone(scope),structuredClone(reference))??new PiRpcExecutionBackend({scope,executionRef:reference});guard();if(backend.backendId!==this.backendId)reject("BACKEND_MISMATCH");
    const handle=this.hosts.acquireRuntime({id:this.options.profile.id},{id:this.backendId,runnerId:scope.runnerId,nativeStoreRef,product:"pi",region:"global",executionRefId:reference.id,ownership:"owned",acquire:async()=>({id:randomUUID(),profileId:scope.profileId,backendId:this.backendId,runnerId:scope.runnerId,nativeStoreRef,product:"pi",region:"global",executionRefId:reference.id,ownership:"owned",interrupt:async(binding,request)=>{const source=backend.source(binding);if(!source?.interrupt)throw new AdapterContractError("NATIVE_CAPABILITY_UNVERIFIED","No current exact native source");return source.interrupt(binding,request);},quiescent:async()=>false,stop:async()=>{throw new AdapterContractError("NATIVE_CAPABILITY_UNVERIFIED","Pi native writer release is unqualified");},detach:async()=>{throw new AdapterContractError("NATIVE_CAPABILITY_UNVERIFIED","Use explicit local cleanup");},disconnectLocal:()=>backend.disconnectLocal()})});
    entry={reference:structuredClone(reference),workspace,backend,handle,creationAdmitted:false};this.executions.set(reference.id,entry);
   }
   captured=entry;await captured.handle;guard();if(captured.creationAdmitted)reject("PI_RPC_SESSION_ALREADY_ADMITTED");captured.creationAdmitted=true;ownsCreation=true;
   return captured.backend.start({...input,beforePrompt:()=>{guard();const result:unknown=input.beforePrompt!();if(result!==undefined){this.track(Promise.resolve(result));reject("PI_RPC_ADMISSION_MUST_BE_SYNCHRONOUS");}guard();},onBinding:async binding=>{guard();captured!.binding=structuredClone(binding);await input.onBinding!(structuredClone(binding));guard();}});
  },async()=>{cancelled=true;if(ownsCreation)await captured?.backend.disconnectLocal();},async error=>{
   if(ownsCreation&&captured&&error instanceof AdapterStartError&&error.creationOutcome==="not-created")await this.closeNotCreated(captured);
  });
  this.track(turn.ready());return turn;
 }
 async disconnectLocal():Promise<RuntimeLocalDisconnectResult[]>{this.beginShutdown();this.cleanup??=this.hosts.shutdownLocal().then(receipts=>{this.receipts=receipts;return receipts;});return structuredClone(await this.cleanup);}
}
