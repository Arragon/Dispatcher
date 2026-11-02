import {createHash,randomUUID} from "node:crypto";
import {realpathSync,statSync} from "node:fs";
import {isAbsolute} from "node:path";
import {isDeepStrictEqual} from "node:util";
import {AdapterContractError,AdapterStartError,assertAdapterWriteAdmission,CodexAppServerBackend,type CodexAppServerScope,type CodexNativeAuthority,type CodexBackend,type CodexProfileConfig,type CodexStartInput,type CodexTurn,type CodexTurnResult,type NativeInteractionPort,type NativeRequestEvent} from "@dispatcher/adapters";
import {isExecutionContextRef,validateExecutionBinding,type ExecutionSelection,type NativeBinding} from "@dispatcher/domain";
import {NativeRuntimeHosts,type RuntimeHandle,type RuntimeLocalDisconnectResult} from "@dispatcher/runner";

interface DirectoryIdentity {path:string;dev:bigint;ino:bigint}
function directory(path:string):DirectoryIdentity {
 try{if(typeof path!=="string"||!isAbsolute(path))throw Error();const physical=realpathSync(path),stat=statSync(physical,{bigint:true});if(!stat.isDirectory())throw Error();return {path:physical,dev:stat.dev,ino:stat.ino};}
 catch{throw new AdapterStartError("not-created","CODEX_SCOPE_CHANGED","Native execution directory is unavailable or changed");}
}
interface ExecutionHost {scope:CodexAppServerScope;workspace:DirectoryIdentity;selection:ExecutionSelection;reference:NonNullable<CodexStartInput["executionRef"]>;port:CodexAppServerBackend;handle:Promise<RuntimeHandle>;creationAdmitted:boolean;binding?:NativeBinding;notCreatedClosed?:boolean}
interface RuntimeOptions {
 profile:CodexProfileConfig;runnerId:string;
 assertInput:(input:CodexStartInput)=>void;
 bindingFor:(nativeSessionId:string)=>NativeBinding|undefined;
 authorityFor?:(scope:CodexAppServerScope)=>CodexNativeAuthority;
 factory?:(scope:CodexAppServerScope,authority?:CodexNativeAuthority)=>CodexAppServerBackend;
}
class AcquiringTurn implements CodexTurn {
 private turn?:CodexTurn;
 private failed=false;
 private readonly admitted:Promise<void>;
 constructor(acquire:()=>Promise<CodexTurn>,onFailure:(error:unknown)=>Promise<unknown>,settled:()=>void){
  this.admitted=acquire().then(async turn=>{this.turn=turn;await turn.ready?.();}).catch(async error=>{this.failed=true;throw await onFailure(error);}).finally(settled);
  void this.admitted.catch(()=>undefined);
 }
 ready():Promise<void>{return this.admitted;}
 status():"running"|"completed"{return this.failed?"completed":this.turn?.status()??"running";}
 snapshot():Pick<CodexTurnResult,"events"|"providerSessionId"> {return this.turn?.snapshot?.()??{events:[]};}
 events(){return this.turn?.events?.()??[];}
 async result():Promise<CodexTurnResult>{try{await this.admitted;return await this.turn!.result();}catch{return {state:"failed",summary:"Native runtime admission requires reconciliation",...this.snapshot()};}}
 async cancel():Promise<void>{await this.admitted;if(this.turn?.status()==="running")await this.turn.cancel();}
}

/** Controller composition only: provider requests remain in the scoped Adapter. */
export class CodexExecutionRuntime implements CodexBackend {
 readonly backendId="codex-app-server" as const;
 // No aggregate port can qualify every execution workspace.
 readonly interaction?:NativeInteractionPort;
 private readonly profile:CodexProfileConfig;
 private readonly home:DirectoryIdentity;
 private starting=0;
 private readonly operations=new Set<Promise<unknown>>();
 private readonly hosts=new NativeRuntimeHosts();
 private readonly executions=new Map<string,ExecutionHost>();
 private requestSink?: (event:NativeRequestEvent)=>void;
 private closed=false;
 private cleanup?:Promise<RuntimeLocalDisconnectResult[]>;
 private receipts?:RuntimeLocalDisconnectResult[];
 private readonly options:RuntimeOptions;
 constructor(options:RuntimeOptions){this.profile=structuredClone(options.profile);if(typeof this.profile.executable!=="string"||!isAbsolute(this.profile.executable))throw new AdapterStartError("not-created","CODEX_SCOPE_CHANGED","Native runtime requires an explicit absolute executable");this.home=directory(this.profile.codexHome);this.options=Object.freeze({profile:this.profile,runnerId:options.runnerId,assertInput:options.assertInput.bind(options),bindingFor:options.bindingFor.bind(options),...(options.authorityFor?{authorityFor:options.authorityFor.bind(options)}:{}),...(options.factory?{factory:options.factory.bind(options)}:{})});}
 hasActiveOperations():boolean{return this.starting>0||this.operations.size>0||[...this.executions.values()].some(entry=>entry.port.hasActiveOperations());}
 hasUnclosedHosts():boolean {return this.executions.size>0&&(!this.receipts||this.receipts.some(r=>r.connection!=="closed"||r.ownedRoot==="unknown"||r.callbacks!=="drained"));}
 isClosed():boolean {return this.closed;}
 beginShutdown():void {this.closed=true;}
 setNativeRequestSink(sink:(event:NativeRequestEvent)=>void):void {this.requestSink=sink;}
 private synchronous(callback:()=>void):void {
  assertAdapterWriteAdmission(()=>{const result:unknown=callback();if(result!==undefined){const work=Promise.resolve(result);this.operations.add(work);void work.finally(()=>this.operations.delete(work)).catch(()=>undefined);return work;}});
 }
 private assertBindingScope(entry:ExecutionHost,binding:NativeBinding):void {
  const scope=entry.scope;
  if(binding.version!==1||binding.identityState!=="bound"||binding.product!=="codex"||binding.region!=="global"||binding.profileId!==scope.profileId||binding.backendId!==this.backendId||binding.runnerId!==scope.runnerId||binding.nativeStoreRef!==scope.nativeStoreRef||binding.executionRefId!==scope.executionRefId||!binding.nativeSessionId||binding.nativeThreadId!==binding.nativeSessionId||binding.parentSessionId!==undefined)throw new AdapterContractError("CODEX_BINDING_SCOPE_CHANGED","Native binding differs from its registered execution host");
 }
 source(original:NativeBinding):NativeInteractionPort|undefined {
  const binding=structuredClone(original);if(this.closed||binding.profileId!==this.profile.id)return undefined;
  const entry=this.executions.get(binding.executionRefId);if(!entry?.binding||!isDeepStrictEqual(entry.binding,binding))return undefined;
  try{this.assertBindingScope(entry,binding);this.assertDirectories(entry.scope.codexHome,entry.scope.workspacePath,entry.workspace);const persisted=this.options.bindingFor(binding.nativeSessionId);if(this.closed||this.executions.get(binding.executionRefId)!==entry||!isDeepStrictEqual(entry.binding,binding)||!isDeepStrictEqual(persisted,binding))return undefined;this.assertDirectories(entry.scope.codexHome,entry.scope.workspacePath,entry.workspace);return entry.port;}catch{return undefined;}
 }
 diagnostics(nativeSessionId:string):Record<string,unknown>{const entry=[...this.executions.values()].find(value=>value.binding?.nativeSessionId===nativeSessionId);return entry?.port.diagnostics(nativeSessionId)??{};}
 private assertDirectories(home:string,workspace:string,expected:DirectoryIdentity):void {
  if(!isDeepStrictEqual(directory(this.profile.codexHome),this.home)||!isDeepStrictEqual(directory(home),this.home)||!isDeepStrictEqual(directory(workspace),expected))throw new AdapterStartError("not-created","CODEX_SCOPE_CHANGED","Native physical directory identity changed");
 }
 private async closeNotCreated(entry:ExecutionHost):Promise<void>{
  try{const receipt=await entry.port.disconnectLocal();if(entry.binding||receipt.version!==1||receipt.connection!=="closed"||receipt.ownedRoot!=="not-created"||receipt.callbacks!=="drained"||receipt.backgroundTools!=="unknown"||receipt.nativeSessionDeleted!==false)return;entry.notCreatedClosed=true;if([...this.executions.values()].every(value=>value.notCreatedClosed))await this.disconnectLocal();}catch{/* Unconfirmed cleanup retains the host and profile barrier. */}
 }
 private validate(input:CodexStartInput,workspace:DirectoryIdentity):void {
  if(this.closed)throw new AdapterStartError("not-created","CODEX_LOCAL_CONNECTION_CLOSED","Local native runtime admission is closed");
  const ref=input.executionRef;
  if(!isExecutionContextRef(ref)||ref.kind!=="managed-worktree"||ref.runnerId!==this.options.runnerId||input.executable!==this.profile.executable||!input.executionSelection||typeof input.beforePrompt!=="function"||typeof input.onBinding!=="function"||typeof input.onNativeEvent!=="function")throw new AdapterStartError("not-created","CODEX_SCOPE_CHANGED","A current managed execution context and observer are required");
  if(!validateExecutionBinding({profileId:this.profile.id,providerId:"codex",backendId:this.backendId,runnerId:this.options.runnerId,executionRef:ref},input.executionSelection,{repositoryId:ref.repositoryId,baseRevision:ref.baseRevision}).valid)throw new AdapterStartError("not-created","CODEX_SCOPE_CHANGED","Canonical selection differs from the owning runtime");
  try{this.assertDirectories(input.codexHome,input.workspacePath,workspace);this.synchronous(()=>this.options.assertInput({...input,executionRef:structuredClone(ref),executionSelection:structuredClone(input.executionSelection!)}));this.assertDirectories(input.codexHome,input.workspacePath,workspace);}
  catch{throw new AdapterStartError("not-created","CODEX_SCOPE_CHANGED","The canonical native execution scope is unavailable");}
  if(this.closed)throw new AdapterStartError("not-created","CODEX_LOCAL_CONNECTION_CLOSED","Local native runtime admission is closed");
  if(input.providerSessionId){
   const entry=this.executions.get(ref.id);
   if(!entry)throw new AdapterStartError("not-created","CODEX_RESTART_REATTACH_UNQUALIFIED","Restart continuation requires restored native policy evidence");
   const persisted=this.options.bindingFor(input.providerSessionId);
   if(!entry.binding||entry.binding.nativeSessionId!==input.providerSessionId||!isDeepStrictEqual(persisted,entry.binding))throw new AdapterStartError("not-created","CODEX_BINDING_SCOPE_CHANGED","Continuation requires the current exact persisted binding");
  }
 }
 start(original:CodexStartInput):CodexTurn {
  const input={...original,...(original.executionRef?{executionRef:structuredClone(original.executionRef)}:{}),...(original.executionSelection?{executionSelection:structuredClone(original.executionSelection)}:{})},workspaceIdentity=directory(original.workspacePath);this.validate(input,workspaceIdentity);
  const reference=input.executionRef!;
  let entry=this.executions.get(reference.id);
  if(entry&&(!isDeepStrictEqual(workspaceIdentity,entry.workspace)||!isDeepStrictEqual(reference,entry.reference)||!isDeepStrictEqual(input.executionSelection,entry.selection)))throw new AdapterStartError("not-created","CODEX_SCOPE_CHANGED","Execution workspace or selection differs from the captured native host");
  if(!entry){
   const home=this.home.path,workspace=workspaceIdentity.path;
   const nativeStoreRef=`native-store:${createHash("sha256").update(JSON.stringify(["codex","global",home,String(this.home.dev),String(this.home.ino)])).digest("hex")}`;
   const scope:CodexAppServerScope={profileId:this.profile.id,runnerId:this.options.runnerId,nativeStoreRef,scopeFingerprint:`scope:${createHash("sha256").update(JSON.stringify([this.profile.id,"codex-app-server",this.options.runnerId,nativeStoreRef,reference,workspace,String(workspaceIdentity.dev),String(workspaceIdentity.ino)])).digest("hex")}`,executionRefId:reference.id,executable:this.profile.executable!,codexHome:home,workspacePath:workspace,approvalPolicy:"on-request",sandbox:"workspace-write"};
   const supplied=this.options.authorityFor?.(structuredClone(scope));
   const assertCurrent=(binding:NativeBinding)=>{if(this.source(binding)!==port)throw new AdapterContractError("CODEX_AUTHORITY_CHANGED","Native authority source is no longer current");};
   const fenceFor=supplied?.fenceFor.bind(supplied),assert=supplied?.assert.bind(supplied),prepare=supplied?.prepareIngress?.bind(supplied);
   const authority:CodexNativeAuthority|undefined=supplied?{connectionEpoch:supplied.connectionEpoch,fenceFor:binding=>{assertCurrent(binding);const fence=fenceFor!(structuredClone(binding));assertCurrent(binding);return structuredClone(fence);},...(prepare?{prepareIngress:async(binding:NativeBinding)=>{const captured=structuredClone(binding);assertCurrent(captured);const fence=await prepare(structuredClone(captured));assertCurrent(captured);return structuredClone(fence);}}:{}),assert:(binding,fence,operation)=>{assertCurrent(binding);assertAdapterWriteAdmission(()=>assert!(structuredClone(binding),structuredClone(fence),operation));assertCurrent(binding);}}:undefined;
   const port=this.options.factory?this.options.factory(structuredClone(scope),authority):new CodexAppServerBackend(scope,undefined,authority,()=>{guard();this.synchronous(input.beforePrompt!);guard();});
   if(port.backendId!==this.backendId)throw new AdapterStartError("not-created","BACKEND_MISMATCH","Configured native factory returned a different backend");
   port.setNativeRequestSink(event=>{
    const captured=structuredClone(event);
    if(captured.scopeFingerprint!==scope.scopeFingerprint||this.source(captured.binding)!==port||!this.requestSink)throw new AdapterContractError("CODEX_BINDING_SCOPE_CHANGED","Native request source is no longer current");
    this.requestSink(captured);
   });
   const hostId=randomUUID();
   const handle=this.hosts.acquireRuntime({id:this.profile.id},{id:this.backendId,runnerId:scope.runnerId,nativeStoreRef,product:"codex",region:"global",executionRefId:reference.id,ownership:"owned",acquire:async()=>({id:hostId,profileId:scope.profileId,backendId:this.backendId,runnerId:scope.runnerId,nativeStoreRef,product:"codex",region:"global",executionRefId:reference.id,ownership:"owned",interrupt:(binding,request)=>port.interrupt(binding,request),quiescent:async()=>false,stop:async()=>{throw new AdapterContractError("NATIVE_CAPABILITY_UNVERIFIED","Native writer release is unqualified");},detach:async()=>{throw new AdapterContractError("NATIVE_CAPABILITY_UNVERIFIED","Use explicit local cleanup");},disconnectLocal:()=>port.disconnectLocal()})});
   entry={scope,workspace:workspaceIdentity,selection:structuredClone(input.executionSelection!),reference:structuredClone(reference),port,handle,creationAdmitted:false};this.executions.set(reference.id,entry);
  }
  const captured=entry;let invoked=false,ownsCreation=false;this.starting++;
  const guard=()=>{this.validate(input,workspaceIdentity);if(captured.binding&&this.source(captured.binding)!==captured.port)throw new AdapterStartError("not-created","CODEX_BINDING_SCOPE_CHANGED","Native source differs from its durable binding");};
  return new AcquiringTurn(async()=>{
   await captured.handle;guard();
   if(input.providerSessionId){
    const binding=this.options.bindingFor(input.providerSessionId);
    if(!binding||binding.nativeSessionId!==input.providerSessionId)throw new AdapterStartError("not-created","CODEX_BINDING_SCOPE_CHANGED","Continuation requires an exact persisted binding");
    captured.port.registerBinding(binding);captured.binding=structuredClone(binding);
   }else if(captured.creationAdmitted||captured.binding)throw new AdapterStartError("not-created","CODEX_SESSION_ALREADY_ADMITTED","This execution already admitted a native creation");
   else {captured.creationAdmitted=true;ownsCreation=true;}
   invoked=true;return captured.port.start({...input,beforePrompt:()=>{guard();this.synchronous(input.beforePrompt!);guard();},onBinding:async binding=>{
    this.validate(input,workspaceIdentity);this.assertBindingScope(captured,binding);captured.binding=structuredClone(binding);await input.onBinding!(structuredClone(binding));guard();
   }});
  },async error=>{const failure=error instanceof AdapterStartError?error:new AdapterStartError(invoked?"unknown":"not-created","CODEX_RUNTIME_ADMISSION_FAILED","Native runtime was not safely admitted");if(failure.creationOutcome==="not-created"&&!captured.binding&&(ownsCreation||!captured.creationAdmitted))await this.closeNotCreated(captured);return failure;},()=>{this.starting--;});
 }
 async disconnectLocal():Promise<RuntimeLocalDisconnectResult[]> {
  this.beginShutdown();this.cleanup??=this.hosts.shutdownLocal().then(receipts=>{this.receipts=receipts;return receipts;});return structuredClone(await this.cleanup);
 }
}
