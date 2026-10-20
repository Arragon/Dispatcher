import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { nativeBindingKey, type NativeBinding, type NativeObservation, type NativeProcessState, type NativeSessionReadability } from "@dispatcher/domain";
import type { NativeReadHandle } from "@dispatcher/adapters";

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

