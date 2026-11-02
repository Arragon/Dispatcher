import {createHash,randomUUID} from "node:crypto";
import {spawn,type ChildProcessWithoutNullStreams} from "node:child_process";
import {realpathSync,statSync} from "node:fs";
import {isAbsolute} from "node:path";
import {StringDecoder} from "node:string_decoder";
import {isDeepStrictEqual} from "node:util";
import {assessInteractionCapability,isExecutionContextRef,validateExecutionBinding,type AttachEvidence,type AttachRequest,type CapabilityEvidence,type HistoryPage,type HistoryRequest,type InteractionCapabilities,type InterruptRequest,type MutationFence,type NativeBinding,type NativeCommandReceipt,type NativeObservation,type NativeQuiescenceRuntime,type NativeResponse,type NativeTurnFact,type ReleaseEvidence,type ReleaseRequest} from "@dispatcher/domain";
import {childExecutionEnvironment} from "@dispatcher/shared";
import {AdapterContractError,AdapterStartError,assertAdapterWriteAdmission} from "./contracts.js";
import type {LocalRuntimeDisconnect,NativeInteractionPort,NativeReadHandle,NativeReadRequest} from "./interaction-contracts.js";
import type {CodexBackend,CodexStartInput,CodexTurn,CodexTurnResult,NormalizedCodexEvent} from "./codex.js";
import {freezeExecutionSelection} from "./execution-selection.js";
import {NativeRequestError,assertNativeRequestChoice,normalizeNativeRequest,type NativePendingRequest,type NativeRequestEvent,type NativeRequestHandle} from "./native-requests.js";
import {readOwnedNativeVersion} from "./native-version-probe.js";

export const codexAppServerProtocolVersion="0.166.0-alpha.5.1";
export interface CodexAppServerScope {
  profileId:string;runnerId:string;nativeStoreRef:string;scopeFingerprint:string;executionRefId:string;
  executable:string;codexHome:string;workspacePath:string;
  approvalPolicy:"on-request"|"untrusted";sandbox:"workspace-write"|"read-only";
  evidence?:Partial<InteractionCapabilities>;
}
export interface CodexRpcTransport {
  request(method:string,params:Record<string,unknown>,signal?:AbortSignal):Promise<unknown>;
  notify(method:string,params:Record<string,unknown>):void;
  onNotification(listener:(method:string,params:unknown)=>void):()=>void;
  onDisconnect(listener:()=>void):()=>void;
  onRequest?(listener:(request:CodexRpcRequest)=>void):()=>void;
  close():Promise<void>;
  disconnectLocal?():Promise<LocalRuntimeDisconnect>;
}
/** The original connection owns this callback. Cancellation cannot grant permission. */
export interface CodexRpcRequest {
  readonly id:string|number;readonly method:string;readonly params:unknown;
  isPending():boolean;respond(result:unknown):void;cancel():void;reject():void;
}
const validText=(value:unknown,max=512):value is string=>typeof value==="string"&&value.length>0&&value.length<=max&&Array.from(value).every(char=>char.charCodeAt(0)>=32&&char.charCodeAt(0)!==127);
const object=(value:unknown):Record<string,unknown>=>{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new AdapterContractError("CODEX_PROTOCOL_INVALID","Codex protocol payload is malformed");return value as Record<string,unknown>;
};
function physical(path:unknown):string {
  try{if(!validText(path,4096)||!isAbsolute(path)||!statSync(path).isDirectory())throw new Error();return realpathSync(path);}catch{throw new AdapterContractError("CODEX_SCOPE_CHANGED","Codex native directory is unavailable or changed");}
}
interface DirectoryIdentity {path:string;dev:bigint;ino:bigint}
function directoryIdentity(path:unknown):DirectoryIdentity {
  const canonical=physical(path);
  try{const stat=statSync(canonical,{bigint:true});if(!stat.isDirectory())throw new Error();return {path:canonical,dev:stat.dev,ino:stat.ino};}
  catch{throw new AdapterContractError("CODEX_SCOPE_CHANGED","Codex native directory is unavailable or changed");}
}
function assertDirectory(path:unknown,identity:DirectoryIdentity):void {
  if(!isDeepStrictEqual(directoryIdentity(path),identity))throw new AdapterContractError("CODEX_SCOPE_CHANGED","Native directory identity has changed");
}

/** One owned, version-pinned stdio connection. Closing it cannot stop a user's app server. */
export class CodexStdioTransport implements CodexRpcTransport {
  private nextId=1;
  private readonly pending=new Map<number,{resolve:(value:unknown)=>void;reject:(reason:unknown)=>void;cleanup:()=>void}>();
  private readonly listeners=new Set<(method:string,params:unknown)=>void>();
  private readonly disconnects=new Set<()=>void>();
  private readonly incoming=new Map<string,CodexRpcRequest>();
  private requestListener:((request:CodexRpcRequest)=>void)|undefined;
  private closed=false;
  private readonly rootExited:Promise<void>;
  private localDisconnect?:Promise<LocalRuntimeDisconnect>;
  private constructor(private readonly child:ChildProcessWithoutNullStreams) {
    let buffer="";const decoder=new StringDecoder("utf8");
    child.stdout.on("data",(chunk:Buffer)=>{
      if(this.closed)return;buffer+=decoder.write(chunk);
      for(;;){const newline=buffer.indexOf("\n");if(newline<0)break;const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);if(Buffer.byteLength(line)>1_048_576){this.fail();return;}this.line(line);if(this.closed)return;}
      if(Buffer.byteLength(buffer)>1_048_576)this.fail();
    });
    child.stderr.on("data",()=>undefined);
    child.stdin.on("error",()=>this.fail());child.on("error",()=>this.fail());
    this.rootExited=new Promise(resolve=>{child.once("exit",()=>{this.fail();resolve();});child.once("close",()=>{this.fail();resolve();});});
  }
  static async open(scope:CodexAppServerScope,beforeSpawn?:()=>void):Promise<CodexStdioTransport> {
    scope=structuredClone(scope);
    let home:DirectoryIdentity,workspace:DirectoryIdentity;
    try{home=directoryIdentity(scope.codexHome);workspace=directoryIdentity(scope.workspacePath);}
    catch{throw new AdapterStartError("not-created","CODEX_SCOPE_CHANGED","Codex native directory is unavailable or changed");}
    const admit=()=>{try{if(beforeSpawn!==undefined)assertAdapterWriteAdmission(beforeSpawn);}catch{throw new AdapterStartError("not-created","CODEX_SPAWN_ADMISSION_REJECTED","Original native spawn authority changed");}};
    admit();
    let version:string;
    try{version=await readOwnedNativeVersion({executable:scope.executable,workspacePath:scope.workspacePath,environment:{...process.env,CODEX_HOME:scope.codexHome},failure:code=>new AdapterContractError(code==="exit-unconfirmed"?"CODEX_PROBE_EXIT_UNCONFIRMED":"CODEX_RUNTIME_UNAVAILABLE","Codex version probe did not finish safely")});}
    catch(error){throw new AdapterStartError("not-created",error instanceof AdapterContractError&&error.code==="CODEX_PROBE_EXIT_UNCONFIRMED"?error.code:"CODEX_RUNTIME_UNAVAILABLE","Codex executable is unavailable");}
    if(version!==`codex-cli ${codexAppServerProtocolVersion}`)throw new AdapterStartError("not-created","CODEX_PROTOCOL_VERSION_UNQUALIFIED","Installed Codex version differs from the pinned protocol");
    try{assertDirectory(scope.codexHome,home);assertDirectory(scope.workspacePath,workspace);}
    catch{throw new AdapterStartError("not-created","CODEX_SCOPE_CHANGED","Codex native directory changed during the version probe");}
    admit();
    return new CodexStdioTransport(spawn(scope.executable,["app-server","--listen","stdio://"],{cwd:scope.workspacePath,shell:false,stdio:["pipe","pipe","pipe"],env:childExecutionEnvironment(process.env,{PWD:scope.workspacePath,CODEX_HOME:scope.codexHome})}));
  }
  request(method:string,params:Record<string,unknown>,signal?:AbortSignal):Promise<unknown> {
    if(this.closed||signal?.aborted)return Promise.reject(new AdapterContractError("CODEX_NATIVE_UNREACHABLE","Codex native connection is unavailable"));
    if(this.pending.size>=64)return Promise.reject(new AdapterContractError("CODEX_REQUEST_LIMIT","Too many pending native requests"));
    const id=this.nextId++;
    return new Promise((resolve,reject)=>{
      const abort=()=>{const request=this.pending.get(id);if(!request)return;this.pending.delete(id);request.cleanup();reject(new AdapterContractError("CODEX_NATIVE_UNREACHABLE","Codex native request did not finish"));};
      const timer=setTimeout(abort,30_000);const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener("abort",abort);};
      this.pending.set(id,{resolve,reject,cleanup});signal?.addEventListener("abort",abort,{once:true});
      try{this.write({id,method,params});}catch(error){this.pending.delete(id);cleanup();reject(error);}
    });
  }
  notify(method:string,params:Record<string,unknown>):void {this.write({method,params});}
  onNotification(listener:(method:string,params:unknown)=>void):()=>void {this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  onDisconnect(listener:()=>void):()=>void {this.disconnects.add(listener);return()=>this.disconnects.delete(listener);}
  onRequest(listener:(request:CodexRpcRequest)=>void):()=>void {
    if(this.requestListener)throw new AdapterContractError("CODEX_REQUEST_OWNER_CONFLICT","Native callbacks already have an owner");
    this.requestListener=listener;return()=>{if(this.requestListener===listener)this.requestListener=undefined;};
  }
  private write(value:unknown):void {
    if(this.closed)throw new AdapterContractError("CODEX_NATIVE_UNREACHABLE","Codex native connection is unavailable");
    const line=JSON.stringify(value);if(Buffer.byteLength(line)>1_048_576)throw new AdapterContractError("CODEX_REQUEST_TOO_LARGE","Native request exceeds its bound");
    const frame=Buffer.from(`${line}\n`);
    if(this.child.stdin.writableLength+frame.byteLength>4_194_304)throw new AdapterContractError("CODEX_REQUEST_LIMIT","Native write queue exceeds its bound");
    this.child.stdin.write(frame);
  }
  private line(line:string):void {
    if(!line.trim())return;
    try{
      const message=object(JSON.parse(line));
      if(typeof message.method==="string"){
        if(message.id!==undefined){
          if(!(typeof message.id==="number"&&Number.isSafeInteger(message.id)||validText(message.id)))throw new Error();
          const id=message.id as string|number;const key=JSON.stringify(id);
          if(this.incoming.has(key)||this.incoming.size>=128)throw new Error();
          const pending=()=>!this.closed&&this.incoming.get(key)===request;
          const consume=()=>{if(!pending())throw new NativeRequestError("NATIVE_REQUEST_CONSUMED");this.incoming.delete(key);};
          const request:CodexRpcRequest={id,method:message.method,params:message.params,isPending:pending,cancel:()=>{if(pending())this.incoming.delete(key);},respond:result=>{consume();this.write({id,result});},reject:()=>{consume();this.write({id,error:{code:-32601,message:"Native request is unavailable for this connection"}});}};
          this.incoming.set(key,request);if(this.requestListener)this.requestListener(request);else request.reject();return;
        }
        if(message.method==="serverRequest/resolved"&&message.params&&typeof message.params==="object"){
          const params=message.params as Record<string,unknown>;const original=this.incoming.get(JSON.stringify(params.requestId));
          if(original&&(original.params as Record<string,unknown>)?.threadId===params.threadId)original.cancel();
        }
        for(const listener of this.listeners)listener(message.method,message.params);return;
      }
      if(typeof message.id!=="number")throw new Error();const request=this.pending.get(message.id);if(!request)return;
      let failure:AdapterContractError|undefined;
      if("error" in message){
        const error=message.error&&typeof message.error==="object"&&!Array.isArray(message.error)?message.error as Record<string,unknown>:undefined;
        failure=error&&Number.isInteger(error.code)?new AdapterContractError(error.code===-32601?"CODEX_METHOD_UNSUPPORTED":"CODEX_NATIVE_REQUEST_FAILED","Codex native request was rejected"):new AdapterContractError("CODEX_PROTOCOL_INVALID","Codex error response is malformed");
      }else if(!("result" in message))failure=new AdapterContractError("CODEX_PROTOCOL_INVALID","Codex response has no result");
      this.pending.delete(message.id);request.cleanup();if(failure)request.reject(failure);else request.resolve(message.result);
    }catch{this.fail();}
  }
  private fail():void {
    if(this.closed)return;this.closed=true;
    this.incoming.clear();
    for(const request of this.pending.values()){request.cleanup();request.reject(new AdapterContractError("CODEX_NATIVE_UNREACHABLE","Codex native connection ended"));}this.pending.clear();
    for(const listener of this.disconnects)try{listener();}catch{/* Observer failure cannot prevent owned transport cleanup. */}
    this.child.stdin.destroy();this.child.stdout.destroy();this.child.stderr.destroy();this.child.kill("SIGTERM");
    const timer=setTimeout(()=>this.child.kill("SIGKILL"),2_000);timer.unref();this.child.once("exit",()=>clearTimeout(timer));this.child.once("close",()=>clearTimeout(timer));
  }
  async disconnectLocal():Promise<LocalRuntimeDisconnect>{
    this.localDisconnect??=(async()=>{
      this.fail();let timer:ReturnType<typeof setTimeout>|undefined;
      try{await Promise.race([this.rootExited,new Promise<void>(resolve=>{timer=setTimeout(resolve,3_000);})]);}
      finally{if(timer)clearTimeout(timer);this.child.stdout.destroy();this.child.stderr.destroy();}
      const exited=this.child.exitCode!==null||this.child.signalCode!==null;
      return {version:1,connection:"closed",ownedRoot:exited?"exited":this.child.pid===undefined?"not-created":"unknown",callbacks:"drained",backgroundTools:"unknown",nativeSessionDeleted:false,...(this.child.pid?{ownedRootPid:this.child.pid}:{})};
    })();return structuredClone(await this.localDisconnect);
  }
  async close():Promise<void>{const result=await this.disconnectLocal();if(result.ownedRoot==="unknown")throw new AdapterContractError("CODEX_RUNTIME_CLOSE_UNKNOWN","Owned root exit remains unknown");}
}

export interface CodexNativeAuthority {
  /** Composition must allocate an epoch newer than the persisted Core watermark. */
  connectionEpoch:number;
  fenceFor(binding:NativeBinding):MutationFence;
  /** Canonical startup may settle before metadata ingress; returns the captured fence. */
  prepareIngress?(binding:NativeBinding):Promise<MutationFence>;
  /** Ingress validates metadata only; the other operations require mutation authority. */
  assert(binding:NativeBinding,fence:MutationFence,operation:"ingress"|"interrupt"|"approval"|"reject-approval"):void;
}

const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
interface Policy {model:string;modelProvider:string;reasoningEffort?:string;sandbox:Record<string,unknown>;approvalPolicy:CodexAppServerScope["approvalPolicy"];approvalsReviewer:"user"}
interface PendingCallback {binding:NativeBinding;turnId:string;rpc:CodexRpcRequest;request:NativePendingRequest;fence:MutationFence;questionId?:string;state:"pending"|"consumed"}
class AppServerTurn implements CodexTurn {
  private completed=false;
  private finishing=false;
  private readonly outcome:Promise<CodexTurnResult>;
  private resolve!:(result:CodexTurnResult)=>void;
  private readyPromise:Promise<void>=Promise.resolve();
  private readonly received:NormalizedCodexEvent[]=[];
  threadId?:string;
  turnId?:string;
  admitting=false;
  stopping=false;
  readonly buffered:Array<{method:string;params:Record<string,unknown>}>=[];
  readonly requests:CodexRpcRequest[]=[];
  constructor(readonly input:CodexStartInput,private readonly interrupt:()=>Promise<void>,private readonly observe:(fact:NativeTurnFact)=>Promise<void>,private readonly persistenceFailed:()=>void) {this.outcome=new Promise(resolve=>{this.resolve=resolve;});}
  initialize(promise:Promise<void>):void {this.readyPromise=promise;void promise.catch(()=>undefined);}
  ready():Promise<void>{return this.readyPromise;}
  status():"running"|"completed" {return this.completed?"completed":"running";}
  acceptsEvents():boolean{return !this.completed&&!this.finishing;}
  result():Promise<CodexTurnResult>{return this.outcome;}
  snapshot():Pick<CodexTurnResult,"events"|"providerSessionId"> {return {events:structuredClone(this.received),...(this.threadId?{providerSessionId:this.threadId}:{})};}
  events():NormalizedCodexEvent[]{return structuredClone(this.received);}
  recordFact(fact:NativeTurnFact):Promise<void>{return this.observe(fact);}
  detachCallbacks():void {delete this.input.onNativeEvent;delete this.input.onBinding;delete this.input.beforePrompt;}
  async cancel():Promise<void>{if(this.completed)return;await this.ready();if(this.completed)return;await this.interrupt();}
  record(event:NormalizedCodexEvent):void {this.received.push(event);if(this.received.length>256)this.received.shift();}
  finish(state:CodexTurnResult["state"],summary:string):void {
    if(!this.acceptsEvents())return;this.finishing=true;
    const settle=(resultState:CodexTurnResult["state"],resultSummary:string)=>{this.completed=true;this.resolve({state:resultState,summary:resultSummary.slice(0,2000),events:structuredClone(this.received),...(this.threadId?{providerSessionId:this.threadId}:{})});};
    void this.observe({state:state==="completed"?"completed":state==="waiting"?"waiting":"failed",observedAt:new Date().toISOString(),...(this.threadId?{nativeSessionId:this.threadId}:{}),...(this.turnId?{nativeTurnId:this.turnId}:{})}).then(()=>settle(state,summary),()=>{settle("failed","Native event persistence requires reconciliation");this.persistenceFailed();});
  }
}

/** Provider JSON stays here; Core receives only scoped bindings, observations and turn facts. */
export class CodexAppServerBackend implements CodexBackend,NativeInteractionPort {
  readonly backendId="codex-app-server";
  get interaction():NativeInteractionPort{return this;}
  private readonly scope:CodexAppServerScope;
  private readonly home:string;
  private readonly workspace:string;
  private readonly homeIdentity:DirectoryIdentity;
  private readonly workspaceIdentity:DirectoryIdentity;
  private connection?:Promise<CodexRpcTransport>;
  private transport?:CodexRpcTransport;
  private disconnected=false;
  private readonly bindings=new Map<string,NativeBinding>();
  private readonly policies=new Map<string,Policy>();
  private readonly sources=new Map<string,string>();
  private readonly turns=new Set<AppServerTurn>();
  private readonly writers=new Map<string,AppServerTurn>();
  private readonly unsupported=new Set<string>();
  private readonly epoch=randomUUID();
  private observationSequence=0;
  private requestSink?:(event:NativeRequestEvent)=>void;
  private readonly callbacks=new Map<string,PendingCallback>();
  private readonly closedTurns=new Set<string>();
  private readonly requestHandles=new Map<string,NativeRequestHandle>();
  private readonly commands=new Map<string,{signature:string;result:Promise<NativeCommandReceipt>}>();
  private readonly authority?:CodexNativeAuthority;
  private localClosed=false;
  private readonly localLifetime=new AbortController();
  private readonly subscriptions=new Set<()=>void>();
  private localDisconnect?:Promise<LocalRuntimeDisconnect>;
  private localReceipt?:LocalRuntimeDisconnect;
  private readonly cleanup=new WeakMap<CodexRpcTransport,Promise<LocalRuntimeDisconnect>>();
  private readonly metadataCallbacks=new Set<Promise<void>>();
  private readonly requestAdmissions=new Set<Promise<void>>();
  private readonly receivedRequests=new WeakMap<CodexRpcRequest,{request:CodexRpcRequest;at:number}>();
  private readonly connect:(scope:CodexAppServerScope)=>Promise<CodexRpcTransport>;
  constructor(scope:CodexAppServerScope,connect:((scope:CodexAppServerScope)=>Promise<CodexRpcTransport>)|undefined=undefined,authority?:CodexNativeAuthority,beforeSpawn?:()=>void) {
    if(![scope.profileId,scope.runnerId,scope.nativeStoreRef,scope.scopeFingerprint,scope.executionRefId,scope.executable].every(value=>validText(value))||!["on-request","untrusted"].includes(scope.approvalPolicy)||!["workspace-write","read-only"].includes(scope.sandbox))throw new AdapterStartError("not-created","CODEX_SCOPE_INVALID","Native scope is incomplete");
    this.homeIdentity=directoryIdentity(scope.codexHome);this.workspaceIdentity=directoryIdentity(scope.workspacePath);
    this.home=this.homeIdentity.path;this.workspace=this.workspaceIdentity.path;this.scope=structuredClone(scope);
    // Explicit transports own their host boundary; the default retains original spawn admission.
    this.connect=connect??(scope=>CodexStdioTransport.open(scope,()=>{
      if(this.localClosed)throw new AdapterContractError("CODEX_NATIVE_RECONCILIATION_REQUIRED","Local connection is closed");this.assertScope();
      if(beforeSpawn!==undefined)assertAdapterWriteAdmission(()=>{
        const result:unknown=beforeSpawn();if(result!==undefined){const work=Promise.resolve(result).then(()=>undefined);this.metadataCallbacks.add(work);void work.finally(()=>this.metadataCallbacks.delete(work)).catch(()=>undefined);return work;}
      });
      this.assertScope();if(this.localClosed)throw new AdapterContractError("CODEX_NATIVE_RECONCILIATION_REQUIRED","Local connection is closed");
    }));
    if(authority){if(!Number.isSafeInteger(authority.connectionEpoch)||authority.connectionEpoch<1||typeof authority.fenceFor!=="function"||typeof authority.assert!=="function"||authority.prepareIngress!==undefined&&typeof authority.prepareIngress!=="function")throw new AdapterStartError("not-created","CODEX_AUTHORITY_INVALID","Native authority is incomplete");this.authority=Object.freeze({connectionEpoch:authority.connectionEpoch,fenceFor:authority.fenceFor.bind(authority),assert:authority.assert.bind(authority),...(authority.prepareIngress?{prepareIngress:authority.prepareIngress.bind(authority)}:{})});}
  }
  setNativeRequestSink(sink:(event:NativeRequestEvent)=>void):void {this.requestSink=sink;}
  hasActiveOperations():boolean{return this.turns.size>0||this.metadataCallbacks.size>0||this.requestAdmissions.size>0;}
  private assertScope():void {assertDirectory(this.scope.codexHome,this.homeIdentity);assertDirectory(this.scope.workspacePath,this.workspaceIdentity);}
  private async runtime():Promise<CodexRpcTransport> {
    if(this.localClosed)throw new AdapterContractError("CODEX_NATIVE_RECONCILIATION_REQUIRED","Local connection is closed");
    this.assertScope();
    this.connection??=this.connect(structuredClone(this.scope)).then(async rpc=>{
      if(this.localClosed){await this.cleanupLocal(rpc);throw new AdapterContractError("CODEX_NATIVE_RECONCILIATION_REQUIRED","Local connection is closed");}
      this.transport=rpc;
      this.subscriptions.add(rpc.onDisconnect(()=>this.markDisconnected()));this.subscriptions.add(rpc.onNotification((method,params)=>this.notification(method,params)));
      if(rpc.onRequest)this.subscriptions.add(rpc.onRequest(request=>this.nativeRequest(request)));
      try{
        const initialized=object(await this.untilLocalDisconnect(rpc.request("initialize",{clientInfo:{name:"agent_dispatcher",version:"0.1.0"},capabilities:{experimentalApi:true}})));
        if(physical(initialized.codexHome)!==this.home)throw new AdapterContractError("CODEX_SCOPE_CHANGED","Native CODEX_HOME differs from the frozen profile");
        this.assertScope();if(this.localClosed){await this.cleanupLocal(rpc);throw new AdapterContractError("CODEX_NATIVE_RECONCILIATION_REQUIRED","Local connection is closed");}rpc.notify("initialized",{});return rpc;
      }catch(error){if(this.localClosed)await this.cleanupLocal(rpc);else await rpc.close();throw error;}
    });
    return this.untilLocalDisconnect(this.connection);
  }
  private async untilLocalDisconnect<T>(work:Promise<T>):Promise<T> {
    const signal=this.localLifetime.signal;if(signal.aborted)throw signal.reason;
    let cancel!:()=>void;const ended=new Promise<never>((_,reject)=>{cancel=()=>reject(signal.reason);signal.addEventListener("abort",cancel,{once:true});});
    try{return await Promise.race([work,ended]);}finally{signal.removeEventListener("abort",cancel);}
  }
  private persistMetadata(callback:()=>void|Promise<void>):Promise<void> {
    const work=Promise.resolve().then(()=>{if(this.localClosed)throw new AdapterContractError("CODEX_NATIVE_RECONCILIATION_REQUIRED","Local connection is closed");return callback();});
    this.metadataCallbacks.add(work);void work.then(()=>this.metadataCallbacks.delete(work),()=>this.metadataCallbacks.delete(work));
    return this.untilLocalDisconnect(work);
  }
  private async request(method:string,params:Record<string,unknown>,signal?:AbortSignal,admit?:()=>void,onSend?:()=>void):Promise<unknown> {
    if(signal?.aborted)throw new AdapterContractError("CODEX_NATIVE_UNREACHABLE","Read was cancelled");
    const rpc=await this.runtime();this.assertScope();if(signal?.aborted)throw new AdapterContractError("CODEX_NATIVE_UNREACHABLE","Read was cancelled");if(this.localClosed)throw new AdapterContractError("CODEX_NATIVE_RECONCILIATION_REQUIRED","Local connection is closed");admit?.();this.assertScope();
    if(this.localClosed||admit&&this.disconnected)throw new AdapterContractError("CODEX_NATIVE_RECONCILIATION_REQUIRED","Local connection is closed");
    try{onSend?.();const result=await this.untilLocalDisconnect(rpc.request(method,params,signal));this.assertScope();if(signal?.aborted)throw new AdapterContractError("CODEX_NATIVE_UNREACHABLE","Read was cancelled");if(this.localClosed)throw new AdapterContractError("CODEX_NATIVE_RECONCILIATION_REQUIRED","Local connection is closed");return result;}catch(error){
      if(error instanceof AdapterContractError){if(error.code==="CODEX_METHOD_UNSUPPORTED")this.unsupported.add(method);throw error;}
      throw new AdapterContractError("CODEX_NATIVE_UNREACHABLE","Codex native request failed");
    }
  }
  markDisconnected():void {this.disconnected=true;this.expireRequests();for(const turn of this.turns){for(const request of turn.requests)request.cancel();turn.requests.length=0;try{turn.finish("failed","Codex native connection requires reconciliation");}catch{ /* The outcome is already settled; keep all input blocked. */ }}}
  capabilities():InteractionCapabilities {
    let scopeValid=true;try{this.assertScope();}catch{scopeValid=false;}
    const unknown:CapabilityEvidence={version:1,support:"unknown",level:"documented",scopeFingerprint:this.scope.scopeFingerprint,reasonCode:scopeValid?"CODEX_RUNTIME_UNQUALIFIED":"CODEX_SCOPE_CHANGED"};
    const qualified=(name:"durableIdentity"|"historyRead"|"interruptTurn"|"nativeApproval"|"observeExternalChanges")=>{
      if(this.localClosed)return {...unknown,reasonCode:"CODEX_LOCAL_CONNECTION_CLOSED"};
      if(!scopeValid)return {...unknown};
      if(name==="historyRead"&&this.unsupported.has("thread/turns/list"))return {...unknown,support:"unsupported" as const,reasonCode:"CODEX_METHOD_UNSUPPORTED"};
      const evidence=this.scope.evidence?.[name];return evidence&&assessInteractionCapability(evidence,this.scope.scopeFingerprint,"runtime-verified").supported?structuredClone(evidence):{...unknown};
    };
    // Continuation through the Interaction Port is reserved for the fenced command path.
    return {version:1,durableIdentity:qualified("durableIdentity"),historyRead:qualified("historyRead"),observeExternalChanges:qualified("observeExternalChanges"),sameSessionContinue:{...unknown},liveSteer:{...unknown},interruptTurn:this.authority?qualified("interruptTurn"):{...unknown},nativeApproval:this.authority&&this.requestSink?qualified("nativeApproval"):{...unknown},releaseControl:{...unknown},reclaimControl:{...unknown},restartReattach:{...unknown},surfaces:{}};
  }
  registerBinding(binding:NativeBinding):void {
    const s=this.scope;
    if(binding.version!==1||binding.product!=="codex"||binding.region!=="global"||binding.profileId!==s.profileId||binding.backendId!==this.backendId||binding.runnerId!==s.runnerId||binding.nativeStoreRef!==s.nativeStoreRef||binding.executionRefId!==s.executionRefId||binding.identityState!=="bound"||!validText(binding.nativeSessionId)||binding.nativeThreadId!==binding.nativeSessionId||binding.parentSessionId!==undefined)throw new AdapterContractError("CODEX_BINDING_SCOPE_CHANGED","Native thread binding differs from the frozen scope");
    const old=this.bindings.get(binding.nativeSessionId);if(old&&!isDeepStrictEqual(old,binding))throw new AdapterContractError("CODEX_BINDING_SCOPE_CHANGED","Native binding has changed");
    this.bindings.set(binding.nativeSessionId,structuredClone(binding));
  }
  private binding(binding:NativeBinding):void {this.assertScope();if(!isDeepStrictEqual(this.bindings.get(binding.nativeSessionId),binding))throw new AdapterContractError("CODEX_BINDING_SCOPE_CHANGED","Native binding is not registered for this runtime");}
  private validateThread(value:unknown,id?:string):Record<string,unknown> {
    const thread=object(value);const status=object(thread.status);
    if(!validText(thread.id)||id!==undefined&&thread.id!==id||thread.sessionId!==thread.id||thread.ephemeral!==false||physical(thread.cwd)!==this.workspace||thread.cliVersion!==codexAppServerProtocolVersion||!["notLoaded","idle","active","systemError"].includes(String(status.type))||!Array.isArray(thread.turns))throw new AdapterContractError("CODEX_THREAD_IDENTITY_CHANGED","Native thread identity or scope differs");
    this.sources.set(thread.id,["cli","vscode","exec","appServer","unknown"].includes(String(thread.source))?String(thread.source):"unknown");
    return thread;
  }
  private policy(value:Record<string,unknown>,input:CodexStartInput):Policy {
    const sandbox=object(value.sandbox);
    if(!validText(value.model)||!validText(value.modelProvider)||input.model!==undefined&&value.model!==input.model||physical(value.cwd)!==this.workspace||value.approvalPolicy!==this.scope.approvalPolicy||value.approvalsReviewer!=="user"||sandbox.type!==(this.scope.sandbox==="workspace-write"?"workspaceWrite":"readOnly")||sandbox.networkAccess===true||input.reasoningEffort!==undefined&&value.reasoningEffort!==input.reasoningEffort)throw new AdapterContractError("CODEX_MODEL_PERMISSION_DRIFT","Native model or permission policy differs from the frozen selection");
    if(sandbox.type==="workspaceWrite"&&(!Array.isArray(sandbox.writableRoots)||sandbox.writableRoots.some(root=>physical(root)!==this.workspace)))throw new AdapterContractError("CODEX_MODEL_PERMISSION_DRIFT","Native write roots differ from the frozen workspace");
    return {model:value.model,modelProvider:value.modelProvider,...(validText(value.reasoningEffort)?{reasoningEffort:value.reasoningEffort}:{}),sandbox:structuredClone(sandbox),approvalPolicy:this.scope.approvalPolicy,approvalsReviewer:"user"};
  }
  start(input:CodexStartInput):CodexTurn {
    if(this.localClosed)throw new AdapterStartError("not-created","CODEX_NATIVE_RECONCILIATION_REQUIRED","Local connection is closed");
    const captured={...input,...(input.executionRef?{executionRef:structuredClone(input.executionRef)}:{}),...(input.executionSelection?{executionSelection:structuredClone(input.executionSelection)}:{})};
    let events=Promise.resolve();
    const observe=(fact:NativeTurnFact):Promise<void>=>{
      const sink=captured.onNativeEvent;if(!sink)return Promise.resolve();
      // A later terminal fact cannot overtake an already admitted startup write.
      const work=events.then(()=>this.persistMetadata(()=>sink(fact)));events=work;return work;
    };
    const turn=new AppServerTurn(captured,async()=>{
      if(!turn.threadId||!turn.turnId)throw new AdapterContractError("CODEX_TURN_UNKNOWN","Native turn identity is unavailable");
      let sent=false;try{object(await this.request("turn/interrupt",{threadId:turn.threadId,turnId:turn.turnId},undefined,()=>{if(this.disconnected)throw new AdapterContractError("CODEX_NATIVE_RECONCILIATION_REQUIRED","Native event continuity was lost");this.binding(this.bindings.get(turn.threadId!)!);this.expireRequests(turn.threadId,turn.turnId);},()=>{sent=true;}));}catch(error){if(sent)this.markDisconnected();throw error;}
    },observe,()=>this.markDisconnected());
    this.turns.add(turn);
    void turn.result().then(()=>{this.turns.delete(turn);if(turn.threadId&&this.writers.get(turn.threadId)===turn)this.writers.delete(turn.threadId);if(input.providerSessionId&&this.writers.get(input.providerSessionId)===turn)this.writers.delete(input.providerSessionId);});
    turn.initialize(this.startTurn(turn));return turn;
  }
  private async startTurn(turn:AppServerTurn):Promise<void> {
    const input=turn.input;let creationAttempted=false;
    try{
      if(this.disconnected)throw new AdapterContractError("CODEX_NATIVE_RECONCILIATION_REQUIRED","Native event continuity was lost");
      if(!isExecutionContextRef(input.executionRef)||input.executionRef.kind!=="managed-worktree"||input.executionRef.id!==this.scope.executionRefId||input.executionRef.runnerId!==this.scope.runnerId)throw new AdapterContractError("CODEX_SCOPE_CHANGED","Invocation differs from the canonical execution identity");
      const selection=freezeExecutionSelection(input.executionSelection,{profileId:this.scope.profileId,providerId:"codex",backendId:this.backendId,selection:true,reasoning:true});
      if(!selection||typeof input.beforePrompt!=="function"||typeof input.onBinding!=="function"||typeof input.onNativeEvent!=="function")throw new AdapterContractError("CODEX_START_INVALID","Native start requires one canonical selection and durable observer callbacks");
      const checked=validateExecutionBinding({profileId:this.scope.profileId,providerId:"codex",backendId:this.backendId,runnerId:this.scope.runnerId,executionRef:input.executionRef},selection,{repositoryId:input.executionRef.repositoryId,baseRevision:input.executionRef.baseRevision});
      if(!checked.valid)throw new AdapterContractError(checked.code,"Native execution selection differs from its owner");
      if(selection.requestedModel!==input.model||selection.nativeParameters.reasoningEffort!==input.reasoningEffort)throw new AdapterContractError("CODEX_MODEL_PERMISSION_DRIFT","Invocation contradicts its canonical selection");
      if(input.providerSessionId){if(this.writers.has(input.providerSessionId))throw new AdapterContractError("SESSION_BUSY","Native thread already has an admitted invocation");this.writers.set(input.providerSessionId,turn);const previous=this.policies.get(input.providerSessionId);if(previous&&(input.model!==undefined&&input.model!==previous.model||input.reasoningEffort!==undefined&&input.reasoningEffort!==previous.reasoningEffort))throw new AdapterContractError("CODEX_MODEL_PERMISSION_DRIFT","Invocation changes the frozen native selection");}
      if(input.executable!==this.scope.executable||physical(input.codexHome)!==this.home||physical(input.workspacePath)!==this.workspace||typeof input.prompt!=="string"||!input.prompt.trim()||input.prompt.length>131_072||input.model!==undefined&&!validText(input.model)||input.reasoningEffort!==undefined&&!validText(input.reasoningEffort))throw new AdapterContractError("CODEX_SCOPE_CHANGED","Invocation differs from the frozen native scope");
      await this.runtime();if(this.disconnected)throw new AdapterContractError("CODEX_NATIVE_RECONCILIATION_REQUIRED","Native event continuity was lost");
      if(input.providerSessionId){
        const ref=this.bindings.get(input.providerSessionId);if(!ref)throw new AdapterContractError("CODEX_BINDING_SCOPE_CHANGED","Resume requires a previously registered exact thread");this.binding(ref);
        const observed=this.validateThread(object(await this.request("thread/read",{threadId:input.providerSessionId,includeTurns:false})).thread,input.providerSessionId);if(object(observed.status).type==="active")throw new AdapterContractError("SESSION_BUSY","Native thread has an active turn");
        const frozen=this.policies.get(input.providerSessionId);const observedEffort=validText(observed.reasoningEffort)?observed.reasoningEffort:undefined;if(frozen&&(observed.model!==frozen.model||observed.modelProvider!==frozen.modelProvider||observedEffort!==frozen.reasoningEffort))throw new AdapterContractError("CODEX_MODEL_PERMISSION_DRIFT","Observed native model differs from the frozen selection");
      }
      if(this.disconnected)throw new AdapterContractError("CODEX_NATIVE_RECONCILIATION_REQUIRED","Native event continuity was lost");assertAdapterWriteAdmission(input.beforePrompt);
      const admit=()=>{if(this.disconnected||!turn.acceptsEvents())throw new AdapterContractError("CODEX_NATIVE_RECONCILIATION_REQUIRED","Native event continuity was lost");if(input.providerSessionId)this.binding(this.bindings.get(input.providerSessionId)!);assertAdapterWriteAdmission(input.beforePrompt);this.assertScope();};
      const previous=input.providerSessionId?this.policies.get(input.providerSessionId):undefined;
      const selectedModel=input.model??previous?.model;const selectedEffort=input.reasoningEffort??previous?.reasoningEffort;
      const response=object(await this.request(input.providerSessionId?"thread/resume":"thread/start",{...(input.providerSessionId?{threadId:input.providerSessionId,excludeTurns:true}:{ephemeral:false,allowProviderModelFallback:false}),cwd:this.workspace,approvalPolicy:this.scope.approvalPolicy,approvalsReviewer:"user",sandbox:this.scope.sandbox,...(selectedModel?{model:selectedModel}:{}),...(previous?{modelProvider:previous.modelProvider}:{}),...(selectedEffort?{config:{model_reasoning_effort:selectedEffort}}:{})},undefined,admit,()=>{creationAttempted=true;}));
      const thread=this.validateThread(response.thread,input.providerSessionId);turn.threadId=String(thread.id);
      const binding:NativeBinding={version:1,product:"codex",region:"global",profileId:this.scope.profileId,backendId:this.backendId,runnerId:this.scope.runnerId,nativeStoreRef:this.scope.nativeStoreRef,nativeSessionId:turn.threadId,nativeThreadId:turn.threadId,identityState:"bound",executionRefId:this.scope.executionRefId};
      this.registerBinding(binding);
      await this.persistMetadata(()=>input.onBinding!(structuredClone(binding)));
      await turn.recordFact({state:"received",nativeSessionId:binding.nativeSessionId,observedAt:new Date().toISOString()});
      const policy=this.policy(response,{...input,...(selectedModel?{model:selectedModel}:{}),...(selectedEffort?{reasoningEffort:selectedEffort}:{})});
      if(previous&&!isDeepStrictEqual(previous,policy))throw new AdapterContractError("CODEX_MODEL_PERMISSION_DRIFT","Native policy changed between turns");this.policies.set(turn.threadId,policy);
      if(this.disconnected)throw new AdapterContractError("CODEX_NATIVE_RECONCILIATION_REQUIRED","Native event continuity was lost");this.binding(binding);assertAdapterWriteAdmission(input.beforePrompt);
      const owner=this.writers.get(turn.threadId);if(owner&&owner!==turn)throw new AdapterContractError("SESSION_BUSY","Native thread already has a writer");this.writers.set(turn.threadId,turn);
      turn.admitting=true;
      const accepted=object(object(await this.request("turn/start",{threadId:turn.threadId,input:[{type:"text",text:input.prompt}],model:policy.model,...(policy.reasoningEffort?{effort:policy.reasoningEffort}:{}),cwd:this.workspace,approvalPolicy:policy.approvalPolicy,approvalsReviewer:"user",sandboxPolicy:policy.sandbox},undefined,()=>{admit();this.binding(binding);})).turn);
      if(!validText(accepted.id)||!["inProgress","completed","failed","interrupted"].includes(String(accepted.status)))throw new AdapterContractError("CODEX_PROTOCOL_INVALID","Native turn receipt is malformed");
      if(turn.turnId&&turn.turnId!==accepted.id)throw new AdapterContractError("CODEX_TURN_IDENTITY_CHANGED","Native turn receipt differs from the observed turn");turn.turnId=accepted.id;
      if(this.closedTurns.has(hash([turn.threadId,turn.turnId])))turn.stopping=true;
      turn.admitting=false;
      for(const event of turn.buffered)this.applyNotification(turn,event.method,event.params);turn.buffered.length=0;
      for(const request of turn.requests)this.nativeRequest(request);turn.requests.length=0;
      const nativeTurnId=turn.turnId;
      if(turn.acceptsEvents())await turn.recordFact({state:"running",nativeSessionId:binding.nativeSessionId,nativeTurnId,observedAt:new Date().toISOString()});
      if(accepted.status!=="inProgress")this.complete(turn,accepted);
    }catch(error){
      if(creationAttempted)this.markDisconnected();turn.finish("failed",error instanceof AdapterContractError?error.code:"Codex native start failed");
      throw new AdapterStartError(creationAttempted?"unknown":"not-created",error instanceof AdapterContractError?error.code:"CODEX_NATIVE_START_FAILED","Codex native turn was not safely accepted");
    }
  }
  private notification(method:string,value:unknown):void {
    if(this.disconnected)return;
    try{
      this.assertScope();
      const params=object(value);if(!validText(params.threadId))return;
      if(method==="serverRequest/resolved")for(const callback of this.callbacks.values())if(callback.binding.nativeThreadId===params.threadId&&callback.rpc.id===params.requestId){callback.state="consumed";callback.rpc.cancel();}
      for(const turn of this.turns){
        if(!turn.acceptsEvents()||turn.threadId!==params.threadId)continue;
        if(turn.admitting){if(turn.buffered.length>=64)throw new Error();turn.buffered.push({method,params:structuredClone(params)});continue;}
        this.applyNotification(turn,method,params);
      }
    }catch{this.markDisconnected();}
  }
  private applyNotification(turn:AppServerTurn,method:string,params:Record<string,unknown>):void {
    if(!turn.turnId||!turn.acceptsEvents())return;
    if(method==="turn/completed"){const native=object(params.turn);if(native.id===turn.turnId)this.complete(turn,native);}
    else if(method==="item/completed"&&params.turnId===turn.turnId){const item=object(params.item);if(item.type==="agentMessage"&&typeof item.text==="string")turn.record({type:"activity",summary:item.text.slice(0,2000)});}
  }
  private complete(turn:AppServerTurn,native:Record<string,unknown>):void {
    if(!Array.isArray(native.items)||!["completed","interrupted","failed"].includes(String(native.status)))throw new AdapterContractError("CODEX_PROTOCOL_INVALID","Native completion is malformed");
    const final=native.items.map(object).findLast(item=>item.type==="agentMessage"&&typeof item.text==="string");
    this.expireRequests(turn.threadId,turn.turnId);
    turn.finish(native.status==="completed"?"completed":native.status==="interrupted"?"cancelled":"failed",typeof final?.text==="string"?final.text:`Codex turn ${String(native.status)}`);
  }
  readHandle(ref:NativeBinding):NativeReadHandle {const selected=structuredClone(ref);this.binding(selected);return {binding:structuredClone(selected),scopeFingerprint:this.scope.scopeFingerprint,processState:()=>"unknown",inspect:request=>this.inspect(selected,request)};}
  diagnostics(nativeSessionId:string):Record<string,unknown> {return {nativeThreadId:nativeSessionId,nativeSourceKind:this.sources.get(nativeSessionId)??"unknown"};}
  async inspect(ref:NativeBinding,request?:NativeReadRequest):Promise<NativeObservation> {
    this.binding(ref);const thread=this.validateThread(object(await this.request("thread/read",{threadId:ref.nativeThreadId,includeTurns:false},request?.signal)).thread,ref.nativeThreadId);this.binding(ref);
    const status=object(thread.status).type;
    return {version:1,id:randomUUID(),nativeSessionId:ref.nativeSessionId,nativeThreadId:ref.nativeThreadId!,scopeFingerprint:this.scope.scopeFingerprint,serverEpoch:this.epoch,observedAt:new Date().toISOString(),state:status==="active"?"running":status==="idle"?"idle":"unknown",pendingTools:"unknown",pendingApprovals:"unknown",historyRevision:hash([thread.updatedAt,thread.model,thread.reasoningEffort]),historyMode:"snapshot-only",readability:"readable",executionRefId:ref.executionRefId,...(validText(thread.model)?{reportedModel:{nativeSelectionId:thread.model,...(validText(thread.reasoningEffort)?{reasoning:thread.reasoningEffort}:{})}}:{})};
  }
  async history(ref:NativeBinding,inputRequest:HistoryRequest,readRequest?:NativeReadRequest):Promise<HistoryPage> {
    const selected=structuredClone(ref),input={limit:inputRequest.limit,cursor:inputRequest.cursor},read=readRequest?{...readRequest}:undefined;
    this.binding(selected);if(!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>100||input.cursor!==undefined&&!validText(input.cursor,4096))throw new AdapterContractError("INVALID_HISTORY_REQUEST","Native history bounds are invalid");
    const base={version:1 as const,nativeSessionId:selected.nativeSessionId,range:"native-history" as const,source:"codex-app-server/thread/turns/list"};
    try{
      await this.inspect(selected,read);
      const page=object(await this.request("thread/turns/list",{threadId:selected.nativeThreadId,limit:input.limit,itemsView:"full",sortDirection:"asc",...(input.cursor?{cursor:input.cursor}:{})},read?.signal));
      if(!Array.isArray(page.data)||page.data.length>input.limit||page.nextCursor!==undefined&&page.nextCursor!==null&&!validText(page.nextCursor,4096))throw new AdapterContractError("CODEX_PROTOCOL_INVALID","Native history page is malformed");
      const entries:HistoryPage["entries"]=[];const gaps=new Set<string>();const seen=new Set<string>();
      for(const value of page.data){const turn=object(value);if(!validText(turn.id)||!Array.isArray(turn.items))throw new AdapterContractError("CODEX_PROTOCOL_INVALID","Native history turn is malformed");if(turn.itemsView!==undefined&&turn.itemsView!=="full")gaps.add("TURN_ITEMS_PARTIAL");
        for(const value of turn.items){const item=object(value);if(!validText(item.id)||seen.has(item.id))throw new AdapterContractError("CODEX_PROTOCOL_INVALID","Native history item identity is malformed");seen.add(item.id);
          let text:string|undefined;let kind:"user"|"assistant"|"other"="other";
          if(item.type==="agentMessage"&&typeof item.text==="string"){text=item.text;kind="assistant";}
          else if(item.type==="userMessage"&&Array.isArray(item.content)){const parts=item.content.map(object);if(parts.every(part=>part.type==="text"&&typeof part.text==="string")){text=parts.map(part=>part.text).join("\n");kind="user";}}
          if(text===undefined){gaps.add("NATIVE_ITEM_UNREPRESENTED");continue;}
          if(entries.length>=500){gaps.add("HISTORY_ENTRY_LIMIT");continue;}const truncated=text.length>16_384;if(truncated)gaps.add("NATIVE_TEXT_TRUNCATED");entries.push({id:item.id,kind,text:text.slice(0,16_384),turnId:turn.id,...(truncated?{truncated:true}:{})});
        }
      }
      await this.inspect(selected,read);const cursor=typeof page.nextCursor==="string"?page.nextCursor:undefined;
      return {...base,state:"available",entries,completeness:gaps.size||cursor||input.cursor?"partial":"complete",...(cursor?{nextCursor:cursor}:{}),...(gaps.size?{gaps:[...gaps]}:{})};
    }catch(error){if(error instanceof AdapterContractError&&error.code==="CODEX_METHOD_UNSUPPORTED")return {...base,state:"unsupported",entries:[],completeness:"unknown",gaps:[error.code]};throw error;}
  }

  private validateCommand(commandId:string,fence:MutationFence):void {
    if(!fence||commandId!==fence.commandId||!validText(commandId)||![fence.runId,fence.sessionId,fence.expectedCurrentRunId,fence.leaseId].every(value=>validText(value))||fence.runId!==fence.expectedCurrentRunId||![fence.generation,fence.expectedTaskRevision,fence.expectedControlRevision,fence.expectedControlEpoch].every(value=>Number.isSafeInteger(value)&&value>=1))throw new AdapterContractError("CODEX_COMMAND_INVALID","Native command fence is invalid");
  }
  private assertAuthority(ref:NativeBinding,fence:MutationFence,operation:"ingress"|"interrupt"|"approval"|"reject-approval"):void {
    this.binding(ref);if(this.disconnected)throw new AdapterContractError("CODEX_NATIVE_RECONCILIATION_REQUIRED","Native event continuity was lost");
    try{if(!this.authority)throw new Error();this.authority.assert(structuredClone(ref),structuredClone(fence),operation);}catch{throw new AdapterContractError("CODEX_AUTHORITY_CHANGED","Native authority is no longer current");}
  }
  private command(ref:NativeBinding,request:{commandId:string;fence:MutationFence},kind:string,perform:()=>Promise<NativeCommandReceipt>):Promise<NativeCommandReceipt> {
    this.validateCommand(request.commandId,request.fence);this.binding(ref);const signature=hash([kind,ref,request]);const prior=this.commands.get(request.commandId);
    if(prior){if(prior.signature!==signature)throw new AdapterContractError("CODEX_COMMAND_CONFLICT","Native command semantics changed");return prior.result.then(structuredClone);}
    if(this.commands.size>=1024)throw new AdapterContractError("CODEX_REQUEST_LIMIT","Native command retention limit reached");
    const result=perform();this.commands.set(request.commandId,{signature,result});return result.then(structuredClone);
  }
  async interrupt(ref:NativeBinding,input:InterruptRequest):Promise<NativeCommandReceipt> {
    const selected=structuredClone(ref);const request=structuredClone(input);
    return this.command(selected,request,"interrupt",async()=>{
      if(!validText(request.activeTurnId))throw new AdapterContractError("CODEX_TURN_UNKNOWN","An exact native turn is required");
      if(!assessInteractionCapability(this.capabilities().interruptTurn,this.scope.scopeFingerprint,"runtime-verified").supported)throw new AdapterContractError("NATIVE_CAPABILITY_UNVERIFIED","Native interruption is unqualified");
      this.assertAuthority(selected,request.fence,"interrupt");await this.inspect(selected);
      const owner=this.writers.get(selected.nativeThreadId!);if(owner?.turnId&&owner.turnId!==request.activeTurnId)throw new AdapterContractError("CODEX_TURN_IDENTITY_CHANGED","Native turn differs from the frozen command");
      let sent=false;
      try{
        object(await this.request("turn/interrupt",{threadId:selected.nativeThreadId,turnId:request.activeTurnId},undefined,()=>{this.assertAuthority(selected,request.fence,"interrupt");this.expireRequests(selected.nativeThreadId,request.activeTurnId);},()=>{sent=true;}));
        return {version:1,commandId:request.commandId,state:"accepted",nativeTurnId:request.activeTurnId};
      }catch(error){if(!sent)throw error;this.markDisconnected();return {version:1,commandId:request.commandId,state:"unknown",code:"CODEX_INTERRUPT_OUTCOME_UNKNOWN"};}
    });
  }
  async inspectQuiescence(ref:NativeBinding,input:{requestId:string;signal:AbortSignal}):Promise<{observation:NativeObservation;runtime:NativeQuiescenceRuntime}> {
    const request={requestId:input.requestId,signal:input.signal};if(!validText(request.requestId))throw new AdapterContractError("CODEX_COMMAND_INVALID","Native read challenge is invalid");
    const selected=structuredClone(ref);const sequence=++this.observationSequence;
    const observation=await this.inspect(selected,{...request,observerEpoch:this.epoch,sequence});
    const sourceObservationId=observation.id;observation.id=request.requestId;
    observation.read={requestId:request.requestId,observerEpoch:this.epoch,observerGeneration:1,sequence,sourceObservationId,processState:"unknown",readability:"readable"};
    const evidence=this.capabilities().releaseControl;
    return {observation,runtime:{version:1,binding:selected,scopeFingerprint:this.scope.scopeFingerprint,observationRef:observation.id,pendingCommands:"unknown",backgroundTools:"unknown",evidence,readProof:{kind:"live-native-read",requestId:request.requestId,evidence},processScope:{kind:"native-service",state:observation.state==="running"?"active":"unknown",evidence},host:{id:this.epoch,ownership:"owned",shared:"unknown",releaseBoundary:"unknown"}}};
  }
  async release(binding:NativeBinding,input:ReleaseRequest):Promise<ReleaseEvidence> {
    const ref=structuredClone(binding);const request=structuredClone(input);
    this.validateCommand(request.commandId,request.fence);if(!["wait","interrupt"].includes(request.settlePolicy))throw new AdapterContractError("CODEX_COMMAND_INVALID","Native settlement policy is invalid");
    const result=await this.inspectQuiescence(ref,{requestId:randomUUID(),signal:new AbortController().signal});
    // Unsubscribe retains the engine during its grace period. Stopping a shared host affects other threads.
    return {version:1,nativeSessionId:ref.nativeSessionId,quiescent:false,pendingCommands:"unknown",lockReleased:"unknown",exclusion:"cooperative",observation:result.observation,reasonCode:result.observation.state==="running"?"CODEX_SESSION_BUSY":"CODEX_WRITER_RELEASE_UNQUALIFIED"};
  }
  async attach(binding:NativeBinding,input:AttachRequest):Promise<AttachEvidence> {
    const ref=structuredClone(binding);const request=structuredClone(input);
    this.validateCommand(request.commandId,request.fence);this.binding(ref);
    const selection=freezeExecutionSelection(request.executionSelection,{profileId:this.scope.profileId,providerId:"codex",backendId:this.backendId,selection:true,reasoning:true});
    if(!selection||!isExecutionContextRef(request.executionRef)||request.executionRef.kind!=="managed-worktree"||!validateExecutionBinding({profileId:this.scope.profileId,providerId:"codex",backendId:this.backendId,runnerId:this.scope.runnerId,executionRef:request.executionRef,nativeBinding:ref},selection,{repositoryId:request.executionRef.repositoryId,baseRevision:request.executionRef.baseRevision}).valid)throw new AdapterContractError("CODEX_BINDING_SCOPE_CHANGED","Native reclaim context differs from the frozen binding");
    const observation=await this.inspect(ref);
    const matches=selection.selectionType==="native-default"||observation.reportedModel?.nativeSelectionId===selection.requestedModel&&(selection.nativeParameters.reasoningEffort===undefined||observation.reportedModel?.reasoning===selection.nativeParameters.reasoningEffort);
    return {version:1,nativeSessionId:ref.nativeSessionId,attached:false,method:"unknown",observation,reasonCode:matches?"CODEX_RECLAIM_UNQUALIFIED":"CODEX_NATIVE_POLICY_DRIFT"};
  }

  private expireRequests(threadId?:string,turnId?:string):void {
    if(threadId&&turnId){if(this.closedTurns.size>=1024&&!this.closedTurns.has(hash([threadId,turnId])))throw new AdapterContractError("CODEX_REQUEST_LIMIT","Native turn retention limit reached");this.closedTurns.add(hash([threadId,turnId]));}
    for(const turn of this.turns)for(const request of turn.requests)if(threadId===undefined||(request.params as Record<string,unknown>).threadId===threadId&&(turnId===undefined||(request.params as Record<string,unknown>).turnId===turnId))request.cancel();
    for(const turn of this.turns)if(threadId===undefined||turn.threadId===threadId&&(turnId===undefined||turn.turnId===turnId)){turn.stopping=true;for(const request of turn.requests)request.cancel();turn.requests.length=0;}
    for(const callback of this.callbacks.values())if(threadId===undefined||callback.binding.nativeThreadId===threadId&&(turnId===undefined||callback.turnId===turnId)){callback.state="consumed";callback.rpc.cancel();}
  }
  private nativeRequest(original:CodexRpcRequest,preparedFence?:MutationFence):void {
    let rpc=original;
    try{
      let received=this.receivedRequests.get(original);
      if(!received){received={at:Date.now(),request:{id:original.id,method:original.method,params:structuredClone(original.params),isPending:original.isPending.bind(original),respond:original.respond.bind(original),cancel:original.cancel.bind(original),reject:original.reject.bind(original)}};this.receivedRequests.set(original,received);this.receivedRequests.set(received.request,received);}
      rpc=received.request;
      if(this.disconnected||!rpc.isPending())throw new Error();
      const params=object(rpc.params);if(!validText(params.threadId)||!validText(params.turnId)||!validText(params.itemId))throw new Error();
      if(this.closedTurns.has(hash([params.threadId,params.turnId]))){rpc.cancel();return;}
      const turn=this.writers.get(params.threadId);
      if(turn?.stopping){rpc.cancel();return;}
      if(turn?.admitting){if(turn.requests.length>=64)throw new Error();turn.requests.push(rpc);return;}
      if(!turn||turn.status()!=="running"||turn.turnId!==params.turnId||!this.authority||!this.requestSink||!assessInteractionCapability(this.capabilities().nativeApproval,this.scope.scopeFingerprint,"runtime-verified").supported)throw new Error();
      const ref=this.bindings.get(params.threadId)!;this.binding(ref);
      if(this.authority.prepareIngress&&!preparedFence){
        if(this.requestAdmissions.size>=64)throw new Error();
        const prepare=this.authority.prepareIngress;const deadline=received.at+5_000;
        const work=(async()=>{let timer:ReturnType<typeof setTimeout>|undefined;try{
          const fence=await this.untilLocalDisconnect(Promise.race([Promise.resolve().then(()=>prepare(structuredClone(ref))),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error()),Math.max(0,deadline-Date.now()));})]));
          const captured=structuredClone(fence);this.validateCommand(captured?.commandId??"",captured);
          if(Date.now()>=deadline)throw new Error();this.nativeRequest(rpc,captured);
        }catch{if(rpc.isPending())rpc.reject();}finally{if(timer)clearTimeout(timer);}})();
        this.requestAdmissions.add(work);void work.then(()=>this.requestAdmissions.delete(work),()=>this.requestAdmissions.delete(work));return;
      }
      const fence=structuredClone(preparedFence??this.authority.fenceFor(structuredClone(ref)));this.validateCommand(fence.commandId,fence);this.assertAuthority(ref,fence,"ingress");
      let type:NativePendingRequest["type"];let tool:string;let questionId:string|undefined;let lifetime=300_000;let allowOnce=true;
      if(["item/commandExecution/requestApproval","item/fileChange/requestApproval"].includes(rpc.method)){
        if(params.grantRoot!==undefined&&params.grantRoot!==null||params.networkApprovalContext!==undefined&&params.networkApprovalContext!==null||params.additionalPermissions!==undefined&&params.additionalPermissions!==null)throw new Error();
        if(typeof params.startedAtMs!=="number"||!Number.isFinite(params.startedAtMs))throw new Error();type="permission";tool=rpc.method.includes("commandExecution")?"commandExecution":"fileChange";
        if(params.availableDecisions!==undefined){if(!Array.isArray(params.availableDecisions)||params.availableDecisions.length>32)throw new Error();allowOnce=params.availableDecisions.includes("accept");}
      }else if(rpc.method==="item/tool/requestUserInput"){
        if(!Array.isArray(params.questions)||params.questions.length!==1||typeof params.isBlocking!=="boolean")throw new Error();const question=object(params.questions[0]);
        if(!validText(question.id)||question.isSecret===true)throw new Error();questionId=question.id;type="input";tool="requestUserInput";
        if(params.autoResolutionMs!==null&&params.autoResolutionMs!==undefined){if(typeof params.autoResolutionMs!=="number"||!Number.isSafeInteger(params.autoResolutionMs)||params.autoResolutionMs<=0)throw new Error();lifetime=Math.min(lifetime,params.autoResolutionMs);}
      }else throw new Error();
      for(const [id,callback] of this.callbacks)if(callback.state!=="pending"||!callback.rpc.isPending()||Date.parse(callback.request.expiresAt)<=Date.now()){callback.rpc.cancel();this.callbacks.delete(id);}
      if(this.callbacks.size>=128)throw new Error();
      if(received.at+lifetime<=Date.now())throw new Error();
      const request=normalizeNativeRequest({version:1,requestId:randomUUID(),revision:hash([rpc.id,rpc.method,rpc.params]),connectionId:this.epoch,connectionEpoch:this.authority.connectionEpoch,type,tool:{name:`codex.${tool}`,scope:type==="permission"?[`execution:${ref.executionRefId}`]:[],risk:"unknown"},options:type==="permission"&&allowOnce?[{id:"accept-once",kind:"allow-once"}]:[],expiresAt:new Date(received.at+lifetime).toISOString(),...(type==="input"?{promptRef:`native-prompt:${randomUUID()}`}:{})});
      this.callbacks.set(request.requestId,{binding:structuredClone(ref),turnId:params.turnId,rpc,request,fence,...(questionId?{questionId}:{}),state:"pending"});
      try{this.requestSink({binding:structuredClone(ref),scopeFingerprint:this.scope.scopeFingerprint,fence:structuredClone(fence),request:structuredClone(request)});}catch{this.callbacks.delete(request.requestId);throw new Error();}
    }catch{if(rpc.isPending())rpc.reject();}
  }
  requestHandle(ref:NativeBinding):NativeRequestHandle {
    this.binding(ref);if(!this.authority)throw new NativeRequestError("NATIVE_REQUEST_CONNECTION_CHANGED");
    const key=ref.nativeSessionId;const old=this.requestHandles.get(key);if(old)return old;const selected=structuredClone(ref);
    const handle:NativeRequestHandle={binding:structuredClone(selected),scopeFingerprint:this.scope.scopeFingerprint,connectionId:this.epoch,connectionEpoch:this.authority.connectionEpoch,isConnected:()=>Boolean(this.connection)&&!this.disconnected,
      inspectPending:async(id,input)=>{
        this.binding(selected);if(input.signal.aborted||!validText(input.requestId))throw new NativeRequestError("NATIVE_REQUEST_STATE_UNKNOWN");const callback=this.callbacks.get(id);
        const state=!handle.isConnected()?"unknown":!callback||!isDeepStrictEqual(callback.binding,selected)?"unknown":Date.parse(callback.request.expiresAt)<=Date.now()?"expired":callback.state!=="pending"||!callback.rpc.isPending()?"answered":"pending";
        return {version:1,requestId:input.requestId,connectionId:handle.connectionId,connectionEpoch:handle.connectionEpoch,state,...(state==="pending"?{request:structuredClone(callback!.request)}:{})};
      },respond:(binding,response,beforeSend)=>this.respondRequest(selected,binding,structuredClone(response),beforeSend)};
    this.requestHandles.set(key,handle);return handle;
  }
  private async respondRequest(selected:NativeBinding,ref:NativeBinding,request:NativeResponse&{connectionId:string;connectionEpoch:number},beforeSend?:()=>void):Promise<NativeCommandReceipt> {
    if(!isDeepStrictEqual(selected,ref))throw new NativeRequestError("NATIVE_REQUEST_CHANGED");
    return this.command(selected,request,"response",async()=>{
      if(this.disconnected||!this.authority||request.connectionId!==this.epoch||request.connectionEpoch!==this.authority.connectionEpoch)throw new NativeRequestError("NATIVE_REQUEST_CONNECTION_CHANGED");
      const callback=this.callbacks.get(request.requestId);if(!callback||!isDeepStrictEqual(callback.binding,selected)||callback.state!=="pending"||!callback.rpc.isPending())throw new NativeRequestError("NATIVE_REQUEST_CONSUMED");
      const assertPending=()=>{if(this.callbacks.get(request.requestId)!==callback||callback.state!=="pending"||!callback.rpc.isPending())throw new NativeRequestError("NATIVE_REQUEST_CONSUMED");if(Date.parse(callback.request.expiresAt)<=Date.now()){callback.state="consumed";callback.rpc.cancel();throw new NativeRequestError("NATIVE_REQUEST_EXPIRED");}};assertPending();
      if(callback.request.type!==request.type||callback.request.revision!==request.expectedRevision)throw new NativeRequestError("NATIVE_REQUEST_CHANGED");
      const original=callback.fence;const current=request.fence;
      if(["runId","sessionId","expectedTaskRevision","expectedCurrentRunId","generation","leaseId"].some(field=>original[field as keyof MutationFence]!==current[field as keyof MutationFence])||request.response.kind!=="reject"&&(original.expectedControlEpoch!==current.expectedControlEpoch||original.expectedControlRevision!==current.expectedControlRevision)||request.response.kind==="reject"&&current.expectedControlEpoch<original.expectedControlEpoch)throw new NativeRequestError("NATIVE_REQUEST_CHANGED");
      assertNativeRequestChoice(callback.request,request.response);this.assertAuthority(selected,current,request.response.kind==="reject"?"reject-approval":"approval");
      const admission:unknown=beforeSend?.();if(admission!==undefined){void Promise.resolve(admission).catch(()=>undefined);throw new NativeRequestError("NATIVE_REQUEST_STATE_UNKNOWN");}
      this.assertAuthority(selected,current,request.response.kind==="reject"?"reject-approval":"approval");
      assertPending();
      // Compare-and-consume is synchronous with the original callback, without resume or a blanket grant.
      callback.state="consumed";
      try{callback.rpc.respond(callback.request.type==="permission"?{decision:request.response.kind==="allow"?"accept":"decline"}:{answers:request.response.kind==="text"?{[callback.questionId!]:{answers:[request.response.text]}}:{}});}catch{this.markDisconnected();}
      // JSON-RPC responses have no decision acknowledgement. Resolution alone may also mean cancellation.
      return {version:1,commandId:request.commandId,state:"unknown",nativeRequestId:request.requestId,code:"CODEX_RESPONSE_OUTCOME_UNKNOWN"};
    });
  }
  private unknownDisconnect():LocalRuntimeDisconnect {return {version:1,connection:"unknown",ownedRoot:"unknown",callbacks:"unknown",backgroundTools:"unknown",nativeSessionDeleted:false};}
  private async boundedLocal<T>(work:Promise<T>,unknown:T):Promise<T> {
    let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([work,new Promise<T>(resolve=>{timer=setTimeout(()=>resolve(unknown),5_000);})]);}finally{if(timer)clearTimeout(timer);}
  }
  private cleanupLocal(rpc:CodexRpcTransport):Promise<LocalRuntimeDisconnect> {
    const existing=this.cleanup.get(rpc);if(existing)return existing;
    const work=(async():Promise<LocalRuntimeDisconnect>=>{
      try{if(!rpc.disconnectLocal)return this.unknownDisconnect();const receipt=await this.boundedLocal(rpc.disconnectLocal(),this.unknownDisconnect());
        if(receipt?.version!==1||!["closed","unknown"].includes(receipt.connection)||!["exited","not-created","unknown"].includes(receipt.ownedRoot)||!["drained","unknown"].includes(receipt.callbacks)||receipt.backgroundTools!=="unknown"||receipt.nativeSessionDeleted!==false||receipt.ownedRootPid!==undefined&&(!Number.isSafeInteger(receipt.ownedRootPid)||receipt.ownedRootPid<1))return this.unknownDisconnect();
        return {version:1,connection:receipt.connection,ownedRoot:receipt.ownedRoot,callbacks:receipt.callbacks,backgroundTools:"unknown",nativeSessionDeleted:false,...(receipt.ownedRootPid?{ownedRootPid:receipt.ownedRootPid}:{})};
      }catch{return this.unknownDisconnect();}
    })().then(receipt=>{this.localReceipt=receipt;return receipt;});this.cleanup.set(rpc,work);return work;
  }
  async disconnectLocal():Promise<LocalRuntimeDisconnect> {
    if(!this.localDisconnect){
      this.localClosed=true;delete this.requestSink;this.localLifetime.abort(new AdapterContractError("CODEX_NATIVE_RECONCILIATION_REQUIRED","Local connection is closed"));
      for(const unsubscribe of this.subscriptions)try{unsubscribe();}catch{/* Admission stays closed even if a provider unsubscribe fails. */}this.subscriptions.clear();
      for(const turn of this.turns)turn.detachCallbacks();this.markDisconnected();
      const work=this.transport?this.cleanupLocal(this.transport):this.connection?this.connection.then(rpc=>this.cleanupLocal(rpc),()=>this.localReceipt??this.unknownDisconnect()):Promise.resolve<LocalRuntimeDisconnect>({version:1,connection:"closed",ownedRoot:"not-created",callbacks:"drained",backgroundTools:"unknown",nativeSessionDeleted:false});
      // Already admitted async callbacks cannot be revoked by deleting references.
      const drained=Promise.allSettled([...this.metadataCallbacks,...this.requestAdmissions]).then(()=>"drained" as const);
      this.localDisconnect=Promise.all([this.boundedLocal(work,this.unknownDisconnect()),this.boundedLocal<"drained"|"unknown">(drained,"unknown")]).then(([receipt,callbacks])=>({...receipt,callbacks:receipt.callbacks==="drained"?callbacks:"unknown"}));
    }
    return structuredClone(await this.localDisconnect);
  }
  async close():Promise<void> {if([...this.turns].some(turn=>turn.status()==="running"))throw new AdapterContractError("SESSION_BUSY","Cannot close a runtime with an active turn");if(this.localClosed){await this.disconnectLocal();return;}const rpc=await this.connection;await rpc?.close();}
}
