import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { nativeBindingKey, type InterruptRequest, type NativeBinding, type NativeCommandReceipt, type NativeObservation, type NativeProcessState, type NativeSessionReadability } from "@dispatcher/domain";
import type { LocalRuntimeDisconnect, NativeReadHandle } from "@dispatcher/adapters";
import type { ManagedProcessHandle } from "./process.js";

export interface NativeRuntimeConnection {
  readonly id:string;
  readonly observerGeneration:number;
}
interface Connection {
  token:NativeRuntimeConnection;
  key:string;
  binding:NativeBinding;
  scope:string;
  read:NativeReadHandle["inspect"];
  processState:()=>NativeProcessState;
  sequence:number;
  publishedSequence:number;
  pending:Set<AbortController>;
  closed:boolean;
}
class ReadFailure extends Error {
  constructor(readonly code:string){super(code);}
}
const validId=(value:unknown):value is string=>typeof value==="string"&&value.length>0&&value.length<=512&&Array.from(value).every(character=>character.charCodeAt(0)>=32);

/** Coordinates bounded read-only requests, never native execution or process ownership. */
export class NativeRuntime {
  private readonly connections=new WeakMap<NativeRuntimeConnection,Connection>();
  private readonly current=new Map<string,Connection>();
  private readonly generations=new Map<string,number>();
  private readonly observations=new Map<string,NativeObservation>();

  connect(handle:NativeReadHandle,options:{observerGeneration?:number}={}):NativeRuntimeConnection {
    const binding=structuredClone(handle.binding);
    if(binding.version!==1||![binding.product,binding.region,binding.profileId,binding.backendId,binding.runnerId,binding.nativeStoreRef,binding.nativeSessionId,binding.executionRefId,handle.scopeFingerprint].every(validId)||binding.nativeSessionId.startsWith("unstarted:")||[binding.nativeThreadId,binding.parentSessionId].some(value=>value!==undefined&&!validId(value))||typeof handle.inspect!=="function")throw new ReadFailure("INVALID_NATIVE_READ_HANDLE");
    const key=nativeBindingKey(binding);
    const previousGeneration=this.generations.get(key)??0;
    // A Controller restoring a durable checkpoint seeds the next stored generation.
    const observerGeneration=options.observerGeneration??previousGeneration+1;
    if(!Number.isSafeInteger(observerGeneration)||observerGeneration<=previousGeneration)throw new ReadFailure("STALE_NATIVE_OBSERVER");
    const previous=this.current.get(key);
    if(previous)this.disconnect(previous.token);
    const token=Object.freeze({id:randomUUID(),observerGeneration});
    const connection:Connection={token,key,binding,scope:handle.scopeFingerprint,read:handle.inspect.bind(handle),processState:handle.processState?.bind(handle)??(()=>"missing"),sequence:0,publishedSequence:0,pending:new Set(),closed:false};
    this.generations.set(key,observerGeneration);
    this.connections.set(token,connection);this.current.set(key,connection);
    // A new connection cannot borrow a preceding connection's idle evidence.
    this.observations.delete(key);
    return token;
  }

  disconnect(token:NativeRuntimeConnection):void {
    const connection=this.connections.get(token);if(!connection||connection.closed)return;
    connection.closed=true;
    if(this.current.get(connection.key)===connection){this.current.delete(connection.key);this.observations.delete(connection.key);}
    for(const abort of connection.pending)abort.abort(new ReadFailure("STALE_NATIVE_OBSERVER"));
  }

  latest(binding:NativeBinding):NativeObservation|undefined {
    const key=nativeBindingKey(binding);const connection=this.current.get(key);
    if(!connection||!isDeepStrictEqual(connection.binding,binding))return undefined;
    const observation=this.observations.get(key);return observation?structuredClone(observation):undefined;
  }

  async inspect(token:NativeRuntimeConnection,options:{signal?:AbortSignal;timeoutMs?:number}={}):Promise<NativeObservation> {
    const connection=this.connections.get(token);
    if(!connection)throw new ReadFailure("INVALID_NATIVE_READ_HANDLE");
    const timeoutMs=options.timeoutMs??5_000;
    if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30_000)throw new ReadFailure("INVALID_NATIVE_READ_TIMEOUT");
    const sequence=++connection.sequence;const requestId=randomUUID();const abort=new AbortController();
    const unavailable=(code:string):NativeObservation=>this.unavailable(connection,requestId,sequence,code);
    if(connection.closed||this.current.get(connection.key)!==connection)return unavailable("STALE_NATIVE_OBSERVER");
    connection.pending.add(abort);
    const cancel=()=>abort.abort(new ReadFailure("NATIVE_READ_CANCELLED"));
    options.signal?.addEventListener("abort",cancel,{once:true});
    if(options.signal?.aborted)cancel();
    let rejectAbort!:(error:unknown)=>void;
    const aborted=new Promise<never>((_,reject)=>{rejectAbort=reject;});
    const onAbort=()=>rejectAbort(abort.signal.reason);
    abort.signal.addEventListener("abort",onAbort,{once:true});
    const timer=setTimeout(()=>abort.abort(new ReadFailure("NATIVE_READ_TIMEOUT")),timeoutMs);
    let observation:NativeObservation;
    try {
      if(abort.signal.aborted)throw abort.signal.reason;
      const response=await Promise.race([Promise.resolve().then(()=>{
        if(abort.signal.aborted)throw abort.signal.reason;
        return connection.read({requestId,observerEpoch:token.id,sequence,signal:abort.signal});
      }),aborted]);
      if(!this.validObservation(connection,response))observation=unavailable("NATIVE_OBSERVATION_MISMATCH");
      else observation=this.normalizeObservation(connection,response,requestId,sequence);
    }catch(error){observation=unavailable(error instanceof ReadFailure?error.code:"NATIVE_READ_FAILED");}
    finally {clearTimeout(timer);options.signal?.removeEventListener("abort",cancel);abort.signal.removeEventListener("abort",onAbort);connection.pending.delete(abort);}
    if(connection.closed||this.current.get(connection.key)!==connection)return unavailable("STALE_NATIVE_OBSERVER");
    if(sequence<connection.publishedSequence)return unavailable("STALE_NATIVE_READ");
    connection.publishedSequence=sequence;this.observations.set(connection.key,structuredClone(observation));
    return observation;
  }

  private processState(connection:Connection):NativeProcessState {
    try{const state=connection.processState();return ["running","completed","missing","unknown"].includes(state)?state:"unknown";}catch{return "unknown";}
  }
  private unavailable(connection:Connection,requestId:string,sequence:number,code:string):NativeObservation {
    const unreachable=["NATIVE_READ_TIMEOUT","NATIVE_READ_FAILED"].includes(code);
    return {version:1,id:requestId,nativeSessionId:connection.binding.nativeSessionId,...(connection.binding.nativeThreadId?{nativeThreadId:connection.binding.nativeThreadId}:{}),scopeFingerprint:connection.scope,observedAt:new Date().toISOString(),state:unreachable?"unreachable":"unknown",pendingTools:"unknown",pendingApprovals:"unknown",historyMode:"unknown",read:{requestId,observerEpoch:connection.token.id,observerGeneration:connection.token.observerGeneration,sequence,processState:this.processState(connection),readability:unreachable?"unreachable":"unknown",reasonCode:code}};
  }
  private normalizeObservation(connection:Connection,source:NativeObservation,requestId:string,sequence:number):NativeObservation {
    const readability:NativeSessionReadability=source.readability??source.read?.readability??(source.state==="deleted"?"deleted":source.state==="unreachable"?"unreachable":source.state==="unknown"?"unknown":"readable");
    return {version:1,id:requestId,readability,nativeSessionId:source.nativeSessionId,scopeFingerprint:source.scopeFingerprint,observedAt:source.observedAt,state:source.state,pendingTools:source.pendingTools,pendingApprovals:source.pendingApprovals,historyMode:source.historyMode??"unknown",
      ...(source.nativeThreadId?{nativeThreadId:source.nativeThreadId}:{}),...(source.serverEpoch?{serverEpoch:source.serverEpoch}:{}),...(source.activeTurnId?{activeTurnId:source.activeTurnId}:{}),...(source.historyRevision?{historyRevision:source.historyRevision}:{}),...(source.executionRefId?{executionRefId:source.executionRefId}:{}),...(source.permissionFingerprint?{permissionFingerprint:source.permissionFingerprint}:{}),...(source.reportedModel?{reportedModel:{nativeSelectionId:source.reportedModel.nativeSelectionId,...(source.reportedModel.reasoning?{reasoning:source.reportedModel.reasoning}:{})}}:{}),
      read:{requestId,observerEpoch:connection.token.id,observerGeneration:connection.token.observerGeneration,sequence,sourceObservationId:source.id,processState:this.processState(connection),readability}};
  }
  private validObservation(connection:Connection,value:NativeObservation):boolean {
    if(!value||typeof value!=="object")return false;
    if(value.readability!==undefined&&value.read?.readability!==undefined&&value.readability!==value.read.readability)return false;
    const readability=value.readability??value.read?.readability;
    // A cached idle/running snapshot from an unreadable store cannot authorize writes.
    if(["idle","running"].includes(value.state)&&readability!==undefined&&["deleted","unreachable"].includes(readability))return false;
    return Boolean(value&&value.version===1&&validId(value.id)&&value.nativeSessionId===connection.binding.nativeSessionId&&value.scopeFingerprint===connection.scope&&(value.nativeThreadId===connection.binding.nativeThreadId)&&(!value.executionRefId||value.executionRefId===connection.binding.executionRefId)&&typeof value.observedAt==="string"&&Number.isFinite(Date.parse(value.observedAt))&&["running","idle","unknown","deleted","unreachable"].includes(value.state)&&["none","present","unknown"].includes(value.pendingTools)&&["none","present","unknown"].includes(value.pendingApprovals)&&[value.readability,value.read?.readability].every(state=>state===undefined||["readable","deleted","unreachable","unknown"].includes(state))&&[value.serverEpoch,value.activeTurnId,value.historyRevision,value.permissionFingerprint].every(id=>id===undefined||validId(id))&&(value.historyMode===undefined||["native-revision","snapshot-only","unknown"].includes(value.historyMode))&&(!value.reportedModel||validId(value.reportedModel.nativeSelectionId)&&(value.reportedModel.reasoning===undefined||validId(value.reportedModel.reasoning))));
  }
}

export interface NativeRuntimeEndpoint {
  id:string;profileId:string;backendId:string;runnerId:string;nativeStoreRef:string;product:string;region:string;
  executionRefId?:string;
  ownership:"owned"|"external";
  process?:ManagedProcessHandle;
  // Backend qualification must prove tools cannot escape this specific group.
  processGroupContainment?:{handleId:string;evidenceRef:string};
  interrupt(binding:NativeBinding,request:InterruptRequest):Promise<NativeCommandReceipt>;
  quiescent():Promise<boolean>;
  stop():Promise<void>;
  detach():Promise<void>;
  /** Explicit local cleanup; never proof of native tool or writer release. */
  disconnectLocal?():Promise<LocalRuntimeDisconnect>;
}
export interface NativeRuntimeBackend {
  id:string;runnerId:string;nativeStoreRef:string;product:string;region:string;ownership:"owned"|"external";
  /** Omit only when the host genuinely serves multiple execution contexts. */
  executionRefId?:string;
  acquire(profileId:string):Promise<NativeRuntimeEndpoint>;
}
export interface RuntimeHandle {
  readonly id:string;readonly hostId:string;readonly profileId:string;readonly backendId:string;
  readonly executionRefId?:string;
  readonly runnerId:string;readonly nativeStoreRef:string;readonly product:string;readonly region:string;readonly ownership:"owned"|"external";
}
export interface RuntimeReleaseResult {state:"retained"|"detached"|"stopped"|"unknown";nativeSessionDeleted:false;reasonCode?:string}
export interface RuntimeLocalDisconnectResult extends LocalRuntimeDisconnect {
  profileId:string;backendId:string;runnerId:string;nativeStoreRef:string;product:string;region:string;
  ownership:"owned"|"external";executionRefId?:string;hostId?:string;
}
interface RuntimeHostEntry {
  key:string;profileId:string;backend:NativeRuntimeBackend;ready:Promise<NativeRuntimeEndpoint>;arrival:Promise<NativeRuntimeEndpoint>;
  endpointIdentity?:{id:string;runnerId:string;ownership:"owned"|"external"};
  claims:Set<RuntimeHandle>;pendingCommands:Set<Promise<void>>;uncertain:boolean;ownershipConflict:boolean;detached:boolean;closing?:Promise<RuntimeReleaseResult>;
  localDisconnect?:Promise<LocalRuntimeDisconnect>;
}
interface RuntimeClaim {entry:RuntimeHostEntry;release?:Promise<RuntimeReleaseResult>}

/** Owns only registered host lifetimes. Session interruption never routes through host stop. */
export class NativeRuntimeHosts {
  private readonly entries=new Map<string,RuntimeHostEntry>();
  private readonly claims=new WeakMap<RuntimeHandle,RuntimeClaim>();
  private closed=false;
  private shutdownResult?:Promise<RuntimeReleaseResult[]>;
  private localClosing=false;
  private localShutdownResult?:Promise<RuntimeLocalDisconnectResult[]>;

  async acquireRuntime(profile:{id:string},backend:NativeRuntimeBackend):Promise<RuntimeHandle> {
    if(this.closed)throw new ReadFailure("NATIVE_RUNTIME_MANAGER_CLOSED");
    if(![profile.id,backend.id,backend.runnerId,backend.nativeStoreRef,backend.product,backend.region].every(validId)||backend.executionRefId!==undefined&&!validId(backend.executionRefId)||!["owned","external"].includes(backend.ownership)||typeof backend.acquire!=="function")throw new ReadFailure("INVALID_NATIVE_RUNTIME_BACKEND");
    profile=Object.freeze({id:profile.id});
    backend=Object.freeze({id:backend.id,runnerId:backend.runnerId,nativeStoreRef:backend.nativeStoreRef,product:backend.product,region:backend.region,ownership:backend.ownership,acquire:backend.acquire.bind(backend),...(backend.executionRefId!==undefined?{executionRefId:backend.executionRefId}:{})});
    const key=JSON.stringify([backend.product,backend.region,backend.runnerId,backend.nativeStoreRef,backend.id,backend.executionRefId??null]);
    let entry=this.entries.get(key);
    if(entry&&entry.profileId!==profile.id)throw new ReadFailure("RUNTIME_OWNER_MISMATCH");
    if(entry&&entry.backend.ownership!==backend.ownership)throw new ReadFailure("RUNTIME_OWNER_MISMATCH");
    if(entry?.closing){await entry.closing;return this.acquireRuntime(profile,backend);}
    if(!entry){
      const profileId=profile.id;
      const captured=backend;
      const arrival=Promise.resolve().then(()=>captured.acquire(profileId)).then(endpoint=>{
        if(!endpoint||!validId(endpoint.id)||endpoint.profileId!==profileId||endpoint.backendId!==captured.id||endpoint.runnerId!==captured.runnerId||endpoint.nativeStoreRef!==captured.nativeStoreRef||endpoint.product!==captured.product||endpoint.region!==captured.region||endpoint.ownership!==captured.ownership||endpoint.executionRefId!==captured.executionRefId||[endpoint.interrupt,endpoint.quiescent,endpoint.stop,endpoint.detach].some(method=>typeof method!=="function"))throw new ReadFailure("RUNTIME_OWNER_MISMATCH");
        for(const other of this.entries.values())if(other!==entry&&other.endpointIdentity?.id===endpoint.id&&other.endpointIdentity.runnerId===endpoint.runnerId&&(other.endpointIdentity.ownership==="owned"||endpoint.ownership==="owned")){
          other.uncertain=true;other.ownershipConflict=true;entry!.uncertain=true;entry!.ownershipConflict=true;throw new ReadFailure("RUNTIME_OWNER_MISMATCH");
        }
        entry!.endpointIdentity=Object.freeze({id:endpoint.id,runnerId:endpoint.runnerId,ownership:endpoint.ownership});
        const managed=endpoint.process;
        return Object.freeze({id:endpoint.id,profileId:endpoint.profileId,backendId:endpoint.backendId,runnerId:endpoint.runnerId,nativeStoreRef:endpoint.nativeStoreRef,product:endpoint.product,region:endpoint.region,ownership:endpoint.ownership,...(endpoint.executionRefId!==undefined?{executionRefId:endpoint.executionRefId}:{}),interrupt:endpoint.interrupt.bind(endpoint),quiescent:endpoint.quiescent.bind(endpoint),stop:endpoint.stop.bind(endpoint),detach:endpoint.detach.bind(endpoint),...(typeof endpoint.disconnectLocal==="function"?{disconnectLocal:endpoint.disconnectLocal.bind(endpoint)}:{}),...(managed?{process:Object.freeze({id:managed.id,pid:managed.pid,send:managed.send.bind(managed),cancel:managed.cancel.bind(managed),status:managed.status.bind(managed),result:managed.result.bind(managed),subscribe:managed.subscribe.bind(managed),treeStatus:managed.treeStatus?.bind(managed)??(()=>({state:"unknown" as const,scope:"unverified" as const}))})}:{}),...(endpoint.processGroupContainment?{processGroupContainment:Object.freeze({handleId:endpoint.processGroupContainment.handleId,evidenceRef:endpoint.processGroupContainment.evidenceRef})}:{})});
      });
      entry={key,profileId,backend:captured,claims:new Set(),pendingCommands:new Set(),uncertain:false,ownershipConflict:false,detached:false,arrival,ready:this.bounded(arrival).catch(()=>{throw new ReadFailure("NATIVE_RUNTIME_ACQUIRE_UNKNOWN");})};
      // Retain a failed acquisition: a rejected reply cannot prove no host was started.
      this.entries.set(key,entry);
    }
    const endpoint=await entry.ready;
    if(this.closed)throw new ReadFailure("NATIVE_RUNTIME_MANAGER_CLOSED");
    if(entry.closing){await entry.closing;return this.acquireRuntime(profile,backend);}
    if(entry.uncertain)throw new ReadFailure("NATIVE_RUNTIME_OUTCOME_UNKNOWN");
    if(entry.detached)throw new ReadFailure("NATIVE_RUNTIME_DETACHED");
    const handle=Object.freeze({id:randomUUID(),hostId:endpoint.id,profileId:entry.profileId,backendId:endpoint.backendId,runnerId:endpoint.runnerId,nativeStoreRef:endpoint.nativeStoreRef,product:endpoint.product,region:endpoint.region,ownership:endpoint.ownership,...(endpoint.executionRefId!==undefined?{executionRefId:endpoint.executionRefId}:{})});
    entry.claims.add(handle);this.claims.set(handle,{entry});return handle;
  }

  async cancelSession(handle:RuntimeHandle,binding:NativeBinding,request:InterruptRequest):Promise<NativeCommandReceipt> {
    const claim=this.claims.get(handle);
    if(!claim||claim.release||claim.entry.uncertain||binding.version!==1||binding.identityState!=="bound"||!validId(binding.nativeSessionId)||binding.nativeSessionId.startsWith("unstarted:")||!validId(binding.executionRefId)||handle.executionRefId!==undefined&&binding.executionRefId!==handle.executionRefId||binding.profileId!==handle.profileId||binding.backendId!==handle.backendId||binding.runnerId!==handle.runnerId||binding.nativeStoreRef!==handle.nativeStoreRef||binding.product!==handle.product||binding.region!==handle.region)throw new ReadFailure("RUNTIME_OWNER_MISMATCH");
    if(!validId(request.commandId)||request.commandId!==request.fence.commandId||request.activeTurnId!==undefined&&!validId(request.activeTurnId))throw new ReadFailure("INVALID_NATIVE_INTERRUPT_REQUEST");
    if(claim.entry.closing||this.closed)throw new ReadFailure("NATIVE_RUNTIME_HANDLE_RELEASED");
    const capturedBinding=structuredClone(binding);const capturedRequest=structuredClone(request);
    // Reserve before awaiting: releasing the final claim must not race the admitted RPC.
    let settle!:()=>void;const pending=new Promise<void>(resolve=>{settle=resolve;});
    claim.entry.pendingCommands.add(pending);let invoked=false;
    try {
      const endpoint=await claim.entry.ready;
      if(claim.entry.uncertain||claim.entry.detached||this.localClosing)throw new ReadFailure("RUNTIME_OWNER_MISMATCH");
      invoked=true;
      const receipt=await this.bounded(endpoint.interrupt(capturedBinding,capturedRequest));
      if(!receipt||receipt.version!==1||receipt.commandId!==capturedRequest.commandId||!["accepted","queued","rejected","unknown"].includes(receipt.state)||[receipt.nativeRequestId,receipt.nativeMessageId,receipt.nativeTurnId,receipt.code].some(id=>id!==undefined&&!validId(id)))throw new ReadFailure("NATIVE_COMMAND_RECEIPT_MISMATCH");
      if(receipt.state==="unknown")claim.entry.uncertain=true;
      return {version:1,commandId:receipt.commandId,state:receipt.state,...(receipt.nativeRequestId?{nativeRequestId:receipt.nativeRequestId}:{}),...(receipt.nativeMessageId?{nativeMessageId:receipt.nativeMessageId}:{}),...(receipt.nativeTurnId?{nativeTurnId:receipt.nativeTurnId}:{}),...(receipt.code?{code:receipt.code}:{})};
    } catch {
      if(invoked)claim.entry.uncertain=true;
      throw new ReadFailure("NATIVE_RUNTIME_INTERRUPT_UNKNOWN");
    } finally {claim.entry.pendingCommands.delete(pending);settle();}
  }

  releaseRuntime(handle:RuntimeHandle,policy:"detach"|"stop-owned"="detach"):Promise<RuntimeReleaseResult> {
    this.validatePolicy(policy);
    const claim=this.claims.get(handle);if(!claim)throw new ReadFailure("NATIVE_RUNTIME_HANDLE_RELEASED");
    if(claim.release)return claim.release;
    claim.entry.claims.delete(handle);
    claim.release=claim.entry.claims.size>0?Promise.resolve({state:"retained",nativeSessionDeleted:false,reasonCode:"NATIVE_RUNTIME_IN_USE"}):this.releaseEntry(claim.entry,policy);
    return claim.release;
  }

  shutdown(policy:"detach"|"stop-owned"="detach"):Promise<RuntimeReleaseResult[]> {
    this.validatePolicy(policy);
    if(this.shutdownResult)return this.shutdownResult;
    this.closed=true;
    this.shutdownResult=Promise.resolve().then(async()=>{
      const results:RuntimeReleaseResult[]=[];
      for(const entry of [...this.entries.values()]){
        // Closed admission plus bounded RPCs makes draining finite without stopping a live command.
        await Promise.all([...entry.pendingCommands]);
        const handles=[...entry.claims];
        if(handles.length===0)results.push(await this.releaseEntry(entry,policy));
        else for(const handle of handles)results.push(await this.releaseRuntime(handle,policy));
      }
      return results;
    });
    return this.shutdownResult;
  }

  /** Close local connections even after an unknown command; preserve native uncertainty. */
  async shutdownLocal():Promise<RuntimeLocalDisconnectResult[]> {
    if(!this.localShutdownResult){
      this.closed=true;this.localClosing=true;
      this.localShutdownResult=Promise.all([...this.entries.values()].map(async entry=>{
        const receipt=await this.disconnectEntryLocal(entry),b=entry.backend;
        return {...receipt,profileId:entry.profileId,backendId:b.id,runnerId:b.runnerId,nativeStoreRef:b.nativeStoreRef,product:b.product,region:b.region,ownership:b.ownership,...(b.executionRefId!==undefined?{executionRefId:b.executionRefId}:{}),...(entry.endpointIdentity?{hostId:entry.endpointIdentity.id}:{})};
      }));
    }
    return structuredClone(await this.localShutdownResult);
  }
  private unknownLocal():LocalRuntimeDisconnect {return {version:1,connection:"unknown",ownedRoot:"unknown",callbacks:"unknown",backgroundTools:"unknown",nativeSessionDeleted:false};}
  private disconnectEntryLocal(entry:RuntimeHostEntry):Promise<LocalRuntimeDisconnect> {
    if(entry.localDisconnect)return entry.localDisconnect;
    const cleanup=Promise.resolve().then(async():Promise<LocalRuntimeDisconnect>=>{
      try{
        if(entry.closing)await entry.closing;
        // Keep awaiting the actual acquisition after its public deadline: a late
        // validated owned transport still needs cleanup, without promoting its receipt.
        const endpoint=await entry.arrival;
        if(entry.ownershipConflict||endpoint.ownership!=="owned"||!endpoint.disconnectLocal)return this.unknownLocal();
        const receipt=await endpoint.disconnectLocal();
        if(entry.ownershipConflict||receipt?.version!==1||!["closed","unknown"].includes(receipt.connection)||!["exited","not-created","unknown"].includes(receipt.ownedRoot)||!["drained","unknown"].includes(receipt.callbacks)||receipt.backgroundTools!=="unknown"||receipt.nativeSessionDeleted!==false||receipt.ownedRootPid!==undefined&&(!Number.isSafeInteger(receipt.ownedRootPid)||receipt.ownedRootPid<1))return this.unknownLocal();
        return {version:1,connection:receipt.connection,ownedRoot:receipt.ownedRoot,callbacks:receipt.callbacks,backgroundTools:"unknown",nativeSessionDeleted:false,...(receipt.ownedRootPid?{ownedRootPid:receipt.ownedRootPid}:{})};
      }catch{return this.unknownLocal();}
    });
    const commands=this.bounded(Promise.all([...entry.pendingCommands])).then(()=>true,()=>false);
    entry.localDisconnect=Promise.all([this.bounded(cleanup).catch(()=>this.unknownLocal()),commands]).then(([receipt,drained])=>{entry.detached=true;return {...receipt,callbacks:drained?receipt.callbacks:"unknown"};});
    return entry.localDisconnect;
  }

  private releaseEntry(entry:RuntimeHostEntry,policy:"detach"|"stop-owned"):Promise<RuntimeReleaseResult> {
    if(entry.localDisconnect)return Promise.resolve({state:"unknown",nativeSessionDeleted:false,reasonCode:"NATIVE_RUNTIME_LOCAL_DISCONNECTED"});
    if(entry.closing)return entry.closing;
    const released=(state:RuntimeReleaseResult["state"],reasonCode?:string):RuntimeReleaseResult=>({state,nativeSessionDeleted:false,...(reasonCode?{reasonCode}:{})});
    const closing=Promise.resolve().then(async()=>{
      let endpoint:NativeRuntimeEndpoint;
      try{endpoint=await entry.ready;}catch{return released("unknown","NATIVE_RUNTIME_ACQUIRE_UNKNOWN");}
      if(entry.uncertain)return released("unknown","NATIVE_RUNTIME_OUTCOME_UNKNOWN");
      if(entry.detached)return policy==="detach"?released("detached"):released("unknown","NATIVE_RUNTIME_DETACHED");
      if(entry.claims.size>0||entry.pendingCommands.size>0)return released("retained","NATIVE_RUNTIME_IN_USE");
      if(endpoint.ownership==="external"||policy==="detach"){
        try{await this.bounded(endpoint.detach());entry.detached=true;if(endpoint.ownership==="external")this.entries.delete(entry.key);return released("detached");}catch{entry.uncertain=true;return released("unknown","NATIVE_RUNTIME_DETACH_UNKNOWN");}
      }
      try{if(!await this.bounded(endpoint.quiescent()))return released("retained","NATIVE_RUNTIME_BUSY");}catch{return released("retained","NATIVE_RUNTIME_QUIESCENCE_UNKNOWN");}
      if(entry.uncertain)return released("unknown","NATIVE_RUNTIME_OUTCOME_UNKNOWN");
      if(entry.claims.size>0)return released("retained","NATIVE_RUNTIME_IN_USE");
      try{
        await this.bounded(endpoint.stop());
        if(entry.uncertain)return released("unknown","NATIVE_RUNTIME_OUTCOME_UNKNOWN");
        const tree=endpoint.process?.treeStatus?.();
        if(!tree||tree.scope!=="owned-process-group"||tree.state!=="empty"){entry.uncertain=true;return released("unknown",tree?.state==="present"?"NATIVE_BACKGROUND_PROCESS_SURVIVES":"NATIVE_PROCESS_TREE_UNKNOWN");}
        const containment=endpoint.processGroupContainment;
        if(!containment||containment.handleId!==endpoint.process?.id||!validId(containment.evidenceRef)){entry.uncertain=true;return released("unknown","NATIVE_BACKGROUND_SCOPE_UNVERIFIED");}
        this.entries.delete(entry.key);return released("stopped");
      }catch{entry.uncertain=true;return released("unknown","NATIVE_RUNTIME_STOP_UNKNOWN");}
    });
    entry.closing=closing;void closing.finally(()=>{if(entry.closing===closing)delete entry.closing;}).catch(()=>undefined);return closing;
  }
  private validatePolicy(policy:string):void {if(!["detach","stop-owned"].includes(policy))throw new ReadFailure("INVALID_NATIVE_RUNTIME_RELEASE_POLICY");}
  private async bounded<T>(work:Promise<T>):Promise<T> {
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new ReadFailure("NATIVE_RUNTIME_TIMEOUT")),5_000);})]);}finally{if(timer)clearTimeout(timer);}
  }
}
