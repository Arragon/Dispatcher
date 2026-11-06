import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { type HistoryPage, type HistoryRequest, type NativeBinding, type NativeBindingEvent, type NativeHistoryEntry, type NativeObservation } from "@dispatcher/domain";

export type NativeEventStream={kind:"volatile"}|{kind:"replayable";cursor?:string};
export interface NativeHistoryRead {
  page:HistoryPage;binding:NativeBinding;scopeFingerprint:string;gapGeneration:number;
  requestId:string;observerEpoch:string;observerGeneration:number;sequence:number;requestedCursor?:string;
}
export interface NativeHistoryRange {
  gapGeneration:number;historyMode:NativeObservation["historyMode"];historyRevision?:string;serverEpoch?:string;
  source:string;state:HistoryPage["state"];range:HistoryPage["range"];completeness:HistoryPage["completeness"];
  entries:Array<Pick<NativeHistoryEntry,"id"|"kind"|"turnId"|"truncated">>;nextCursor?:string;gaps:string[];
}
export interface NativeEventCheckpoint {
  version:1;revision:number;gapGeneration:number;binding:NativeBinding;scopeFingerprint:string;stream:NativeEventStream;
  observerGeneration:number;sequence:number;observerEpoch?:string;observationId?:string;
  needsSnapshot:boolean;needsHistory:boolean;seen:Array<{id:string;digest:string}>;history?:NativeHistoryRange;
}
export interface NativeEventReconcileResult {
  accepted:boolean;code?:string;checkpoint:NativeEventCheckpoint;
  needsSnapshot:boolean;needsHistory:boolean;completeness:HistoryPage["completeness"];gaps:string[];
}
const id=(value:unknown):value is string=>typeof value==="string"&&value.length>0&&value.length<=512&&Array.from(value).every(c=>c.charCodeAt(0)>=32);
function bindingSnapshot(value:NativeBinding):NativeBinding|undefined {
  if(!value||value.version!==1||![value.product,value.region,value.profileId,value.backendId,value.runnerId,value.nativeStoreRef,value.nativeSessionId,value.executionRefId].every(id)||value.nativeSessionId.startsWith("unstarted:")||!["bound","missing","deleted","unreachable"].includes(value.identityState)||[value.nativeThreadId,value.parentSessionId].some(item=>item!==undefined&&!id(item)))return undefined;
  return {version:1,product:value.product,region:value.region,profileId:value.profileId,backendId:value.backendId,runnerId:value.runnerId,nativeStoreRef:value.nativeStoreRef,nativeSessionId:value.nativeSessionId,executionRefId:value.executionRefId,identityState:value.identityState,...(value.nativeThreadId?{nativeThreadId:value.nativeThreadId}:{}),...(value.parentSessionId?{parentSessionId:value.parentSessionId}:{})};
}
export function createNativeEventCheckpoint(input:{binding:NativeBinding;scopeFingerprint:string;stream:NativeEventStream}):NativeEventCheckpoint {
  const binding=bindingSnapshot(input.binding);
  if(!binding)throw new Error("INVALID_NATIVE_EVENT_BINDING");
  if(!id(input.scopeFingerprint)||!["volatile","replayable"].includes(input.stream.kind)||input.stream.kind==="replayable"&&input.stream.cursor!==undefined&&!id(input.stream.cursor))throw new Error("INVALID_NATIVE_EVENT_CHECKPOINT");
  return {version:1,revision:0,gapGeneration:1,binding,scopeFingerprint:input.scopeFingerprint,stream:input.stream.kind==="volatile"?{kind:"volatile"}:{kind:"replayable",...(input.stream.cursor?{cursor:input.stream.cursor}:{})},observerGeneration:0,sequence:0,needsSnapshot:true,needsHistory:true,seen:[]};
}
/** The upstream payload never crosses this whitelist into Core or its journal. */
export function normalizeNativeEvent(value:NativeBindingEvent):NativeBindingEvent|undefined {
  if(!value||value.version!==1||![value.id,value.sessionId,value.runId,value.profileId,value.backendId,value.turn?.id,value.turn?.invocationId].every(id)||!Number.isFinite(Date.parse(value.turn.observedAt))||!["received","running","completed","failed","waiting"].includes(value.turn.state)||!["native","dispatcher"].includes(value.turn.source)||[value.nativeSessionId,value.turn.nativeRequestId,value.turn.nativeMessageId,value.turn.nativeTurnId,value.leaseId].some(item=>item!==undefined&&!id(item))||[value.generation,value.attempt].some(item=>item!==undefined&&(!Number.isSafeInteger(item)||item<0)))return undefined;
  const turn=value.turn;
  if(turn.source==="native"?turn.nativeTurnId!==turn.id:turn.id!==turn.invocationId||turn.nativeTurnId!==undefined)return undefined;
  const binding=value.nativeBinding?bindingSnapshot(value.nativeBinding):undefined;
  if(value.nativeBinding&&!binding)return undefined;
  return {version:1,id:value.id,sessionId:value.sessionId,runId:value.runId,profileId:value.profileId,backendId:value.backendId,...(value.generation!==undefined?{generation:value.generation}:{}),...(value.attempt!==undefined?{attempt:value.attempt}:{}),...(value.leaseId?{leaseId:value.leaseId}:{}),...(value.nativeSessionId?{nativeSessionId:value.nativeSessionId}:{}),...(binding?{nativeBinding:binding}:{}),turn:{id:turn.id,invocationId:turn.invocationId,source:turn.source,state:turn.state,observedAt:turn.observedAt,...(turn.nativeRequestId?{nativeRequestId:turn.nativeRequestId}:{}),...(turn.nativeMessageId?{nativeMessageId:turn.nativeMessageId}:{}),...(turn.nativeTurnId?{nativeTurnId:turn.nativeTurnId}:{})}};
}
export function nativeEventDigest(event:NativeBindingEvent):string {
  const normalized=normalizeNativeEvent(event);
  if(!normalized)throw new Error("INVALID_NATIVE_EVENT");
  // Source timestamps can vary on replay; actual identity/turn facts cannot.
  return createHash("sha256").update(JSON.stringify({...normalized,turn:{...normalized.turn,observedAt:undefined}})).digest("hex");
}
export function recordNativeEvent(checkpoint:NativeEventCheckpoint,event:NativeBindingEvent):{checkpoint:NativeEventCheckpoint;accepted:boolean;code?:string} {
  const current=structuredClone(checkpoint);const normalized=normalizeNativeEvent(event);
  if(!normalized||normalized.profileId!==current.binding.profileId||normalized.backendId!==current.binding.backendId||normalized.nativeSessionId!==undefined&&normalized.nativeSessionId!==current.binding.nativeSessionId||normalized.nativeBinding&&!isDeepStrictEqual(normalized.nativeBinding,current.binding))return {checkpoint:current,accepted:false,code:"NATIVE_EVENT_MISMATCH"};
  const digest=nativeEventDigest(normalized);const prior=current.seen.find(item=>item.id===normalized.id);
  if(prior)return {checkpoint:current,accepted:false,code:prior.digest===digest?"DUPLICATE_NATIVE_EVENT":"NATIVE_EVENT_CONFLICT"};
  current.seen=[...current.seen,{id:normalized.id,digest}].slice(-256);
  current.revision+=1;
  return {checkpoint:current,accepted:true};
}
function validObservation(value:NativeObservation):boolean {
  const allowed=["version","id","nativeSessionId","nativeThreadId","scopeFingerprint","observedAt","serverEpoch","state","activeTurnId","pendingTools","pendingApprovals","historyRevision","historyMode","reportedModel","executionRefId","permissionFingerprint","readability","read"];
  const readAllowed=["requestId","observerEpoch","observerGeneration","sequence","processState","readability","reasonCode","sourceObservationId"];
  if(!value||Object.keys(value).some(key=>!allowed.includes(key))||!Number.isFinite(Date.parse(value.observedAt))||!["running","idle","unknown","deleted","unreachable"].includes(value.state)||!["none","present","unknown"].includes(value.pendingTools)||!["none","present","unknown"].includes(value.pendingApprovals)||!["native-revision","snapshot-only","unknown"].includes(value.historyMode)||[value.serverEpoch,value.activeTurnId,value.historyRevision,value.executionRefId,value.permissionFingerprint].some(item=>item!==undefined&&!id(item)))return false;
  const read=value.read;
  if(!read||Object.keys(read).some(key=>!readAllowed.includes(key))||!id(read.requestId)||!["running","completed","missing","unknown"].includes(read.processState)||!["readable","deleted","unreachable","unknown"].includes(read.readability)||value.readability!==undefined&&value.readability!==read.readability||[read.sourceObservationId,read.reasonCode].some(item=>item!==undefined&&!id(item)))return false;
  if(["running","idle"].includes(value.state)&&["deleted","unreachable"].includes(read.readability))return false;
  return !value.reportedModel||id(value.reportedModel.nativeSelectionId)&&(value.reportedModel.reasoning===undefined||id(value.reportedModel.reasoning))&&Object.keys(value.reportedModel).every(key=>["nativeSelectionId","reasoning"].includes(key));
}
function historyRange(page:HistoryPage,gapGeneration:number,observation:NativeObservation):NativeHistoryRange {
  const gaps:string[]=[];
  if(page.completeness!=="complete")gaps.push("HISTORY_PROVIDER_PARTIAL");
  if(page.gaps?.length)gaps.push("PROVIDER_REPORTED_GAP");
  if(page.entries.length>100)gaps.push("HISTORY_PAGE_TRUNCATED");
  if(page.truncation||page.entries.slice(0,100).some(entry=>entry.truncated))gaps.push("HISTORY_CONTENT_TRUNCATED");
  if(page.nextCursor)gaps.push("HISTORY_MORE_PAGES");
  if(page.range!=="native-history")gaps.push("HISTORY_RANGE_LIMITED");
  if(page.state!=="available")gaps.push(`HISTORY_${page.state.toUpperCase()}`);
  const completeness=page.state!=="available"?"unknown":gaps.length||page.completeness!=="complete"?"partial":"complete";
  return {gapGeneration,historyMode:observation.historyMode,...(observation.historyRevision?{historyRevision:observation.historyRevision}:{}),...(observation.serverEpoch?{serverEpoch:observation.serverEpoch}:{}),source:page.source,state:page.state,range:page.range,completeness,entries:page.entries.slice(0,100).map(entry=>({id:entry.id,kind:entry.kind,...(entry.turnId?{turnId:entry.turnId}:{}),...(entry.truncated?{truncated:true}:{})})),...(page.nextCursor?{nextCursor:page.nextCursor}:{}),gaps};
}
/** State/history evidence only. Reconnection never executes, changes control or completes a Run. */
export function reconcileNativeEvents(checkpoint:NativeEventCheckpoint,observation?:NativeObservation,history?:NativeHistoryRead,input:{disconnected?:boolean;cursor?:string}={}):NativeEventReconcileResult {
  const current=structuredClone(checkpoint);
  const result=(accepted:boolean,code?:string):NativeEventReconcileResult=>({accepted,...(code?{code}:{}),checkpoint:current,needsSnapshot:current.needsSnapshot,needsHistory:current.needsHistory,completeness:current.needsSnapshot?"unknown":current.needsHistory&&current.history?.completeness==="complete"?"partial":current.history?.completeness??"unknown",gaps:current.history?.gaps??[]});
  if(observation){
    const read=observation.read;
    if(!validObservation(observation)||observation.version!==1||!id(observation.id)||observation.nativeSessionId!==current.binding.nativeSessionId||observation.nativeThreadId!==current.binding.nativeThreadId||observation.scopeFingerprint!==current.scopeFingerprint||observation.executionRefId!==undefined&&observation.executionRefId!==current.binding.executionRefId||!read||!id(read.observerEpoch)||!Number.isSafeInteger(read.observerGeneration)||read.observerGeneration<1||!Number.isSafeInteger(read.sequence)||read.sequence<1||read.observerGeneration<current.observerGeneration||read.observerGeneration===current.observerGeneration&&(read.sequence<=current.sequence||current.observerEpoch!==undefined&&read.observerEpoch!==current.observerEpoch))return result(false,"STALE_NATIVE_OBSERVATION");
  }
  const gapGeneration=current.gapGeneration+(input.disconnected?1:0);
  const page=history?.page;
  if(history){
    const read=observation?.read;
    const expectedCursor=current.history?.gapGeneration===gapGeneration?current.history.nextCursor:undefined;
    if(!read||!isDeepStrictEqual(bindingSnapshot(history.binding),current.binding)||history.scopeFingerprint!==current.scopeFingerprint||history.gapGeneration!==gapGeneration||history.requestId!==read.requestId||history.observerEpoch!==read.observerEpoch||history.observerGeneration!==read.observerGeneration||history.sequence!==read.sequence||history.requestedCursor!==expectedCursor||!page||page.version!==1||page.nativeSessionId!==current.binding.nativeSessionId||!Array.isArray(page.entries)||!id(page.source)||page.nextCursor!==undefined&&!id(page.nextCursor)||!["complete","partial","unknown"].includes(page.completeness)||!["native-history","retained-range","summary-only"].includes(page.range)||!["available","deleted","unreachable","unsupported","unknown"].includes(page.state)||page.entries.slice(0,100).some(entry=>!entry||!id(entry.id)||!["user","assistant","tool","approval","summary","other"].includes(entry.kind)||entry.turnId!==undefined&&!id(entry.turnId)))return result(false,"NATIVE_HISTORY_MISMATCH");
    if(expectedCursor&&current.history&&(current.history.serverEpoch!==observation?.serverEpoch||current.history.historyMode==="native-revision"&&observation?.historyMode==="native-revision"&&current.history.historyRevision!==observation.historyRevision))return result(false,"NATIVE_HISTORY_REVISION_CHANGED");
    if(expectedCursor&&current.history?.source!==page.source)return result(false,"NATIVE_HISTORY_MISMATCH");
  }
  if(input.disconnected){current.gapGeneration=gapGeneration;current.needsSnapshot=true;current.needsHistory=true;}
  if(input.cursor!==undefined&&current.stream.kind==="replayable"){
    if(!id(input.cursor))return result(false,"INVALID_NATIVE_EVENT_CURSOR");
    current.stream={kind:"replayable",cursor:input.cursor};
  }
  if(observation){current.observerGeneration=observation.read!.observerGeneration;current.sequence=observation.read!.sequence;current.observerEpoch=observation.read!.observerEpoch;current.observationId=observation.id;current.needsSnapshot=observation.read!.readability!=="readable"||!["idle","running"].includes(observation.state);}
  if(page){
    const next=historyRange(page,gapGeneration,observation!);
    const previous=current.history;
    if(history?.requestedCursor&&previous?.gapGeneration===gapGeneration){
      const entries=new Map(previous.entries.map(entry=>[entry.id,entry]));
      for(const entry of next.entries)entries.set(entry.id,entry);
      next.entries=[...entries.values()].slice(0,100);
      next.gaps=[...new Set([...previous.gaps.filter(gap=>gap!=="HISTORY_MORE_PAGES"),...next.gaps,...(entries.size>100?["HISTORY_METADATA_TRUNCATED"]:[])])];
      if(next.historyMode!=="native-revision"||!next.historyRevision||previous.historyMode!=="native-revision"||!previous.historyRevision)next.gaps=[...new Set([...next.gaps,"HISTORY_REVISION_UNVERIFIED"])];
      next.completeness=next.state!=="available"?"unknown":next.gaps.length?"partial":next.completeness;
    }
    current.history=next;
  }
  current.needsHistory=current.needsSnapshot||(history?current.history?.completeness!=="complete":current.needsHistory);
  current.revision+=1;
  return result(true);
}
export interface NativeEventReader {
  inspect(binding:NativeBinding):Promise<NativeObservation>;
  history(binding:NativeBinding,request:HistoryRequest):Promise<HistoryPage>;
}
/** Reads one selected session and one page. It has no prompt/resume/interrupt capability. */
export async function recoverNativeEvents(checkpoint:NativeEventCheckpoint,reader:NativeEventReader,options:{timeoutMs?:number}={}):Promise<NativeEventReconcileResult> {
  const timeout=options.timeoutMs??5_000;
  if(!Number.isSafeInteger(timeout)||timeout<1||timeout>30_000)throw new Error("INVALID_NATIVE_EVENT_READ_TIMEOUT");
  // Capture identity and method receivers before any deferred read or caller mutation.
  const selected=structuredClone(checkpoint);
  const inspect=reader.inspect.bind(reader);const history=reader.history.bind(reader);
  let gap=selected.needsSnapshot||selected.needsHistory?selected:reconcileNativeEvents(selected,undefined,undefined,{disconnected:true}).checkpoint;
  let requestedCursor=gap.history?.gapGeneration===gap.gapGeneration?gap.history.nextCursor:undefined;
  const deadline=Date.now()+timeout;
  const bounded=async<T>(read:()=>Promise<T>):Promise<T>=>{
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{return await Promise.race([Promise.resolve().then(read),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("NATIVE_EVENT_READ_TIMEOUT")),Math.max(1,deadline-Date.now()));})]);}finally{if(timer)clearTimeout(timer);}
  };
  let observation:NativeObservation;
  try{observation=await bounded(()=>inspect(structuredClone(selected.binding)));}catch{return reconcileNativeEvents(gap);}
  if(requestedCursor&&gap.history&&(gap.history.serverEpoch!==observation.serverEpoch||gap.history.historyMode==="native-revision"&&observation.historyMode==="native-revision"&&gap.history.historyRevision!==observation.historyRevision)){
    gap=reconcileNativeEvents(gap,undefined,undefined,{disconnected:true}).checkpoint;
    requestedCursor=undefined;
  }
  // The snapshot allocates the local request context; the history call belongs to it.
  if(!reconcileNativeEvents(gap,observation).accepted)return reconcileNativeEvents(gap,observation);
  let page:HistoryPage|undefined;
  try{page=await bounded(()=>history(structuredClone(selected.binding),{limit:50,...(requestedCursor?{cursor:requestedCursor}:{})}));}catch { /* A bounded failed history read keeps the gap open. */ }
  const read=observation.read!;
  return reconcileNativeEvents(gap,observation,page?{page,binding:selected.binding,scopeFingerprint:selected.scopeFingerprint,gapGeneration:gap.gapGeneration,requestId:read.requestId,observerEpoch:read.observerEpoch,observerGeneration:read.observerGeneration,sequence:read.sequence,...(requestedCursor?{requestedCursor}:{})}:undefined);
}

/** Persist metadata only; even accidental transcript fields are refused. */
export function validateNativeEventCheckpoint(value:NativeEventCheckpoint):void {
  const keys=["version","revision","gapGeneration","binding","scopeFingerprint","stream","observerGeneration","sequence","observerEpoch","observationId","needsSnapshot","needsHistory","seen","history"];
  const known=(object:object,allowed:string[])=>Object.keys(object).every(key=>allowed.includes(key));
  const invalid=()=>{throw new Error("INVALID_NATIVE_EVENT_CHECKPOINT");};
  if(!value||value.version!==1||!known(value,keys)||!Number.isSafeInteger(value.revision)||value.revision<0||!Number.isSafeInteger(value.gapGeneration)||value.gapGeneration<1||!Number.isSafeInteger(value.observerGeneration)||value.observerGeneration<0||!Number.isSafeInteger(value.sequence)||value.sequence<0||typeof value.needsSnapshot!=="boolean"||typeof value.needsHistory!=="boolean"||!id(value.scopeFingerprint)||!isDeepStrictEqual(bindingSnapshot(value.binding),value.binding)||!value.stream||!known(value.stream,["kind","cursor"])||!["volatile","replayable"].includes(value.stream.kind)||"cursor" in value.stream&&(value.stream.kind!=="replayable"||!id(value.stream.cursor))||!Array.isArray(value.seen)||value.seen.length>256||value.seen.some(item=>!item||!known(item,["id","digest"])||!id(item.id)||!/^[a-f0-9]{64}$/.test(item.digest))||new Set(value.seen.map(item=>item.id)).size!==value.seen.length)return invalid();
  if(value.observerGeneration===0?(value.sequence!==0||value.observerEpoch!==undefined):(value.sequence<1||!id(value.observerEpoch)))return invalid();
  if(value.observationId!==undefined&&!id(value.observationId))return invalid();
  const history=value.history;
  if(history&&(!known(history,["gapGeneration","historyMode","historyRevision","serverEpoch","source","state","range","completeness","entries","nextCursor","gaps"])||!Number.isSafeInteger(history.gapGeneration)||history.gapGeneration<1||history.gapGeneration>value.gapGeneration||!["native-revision","snapshot-only","unknown"].includes(history.historyMode)||history.historyRevision!==undefined&&!id(history.historyRevision)||history.serverEpoch!==undefined&&!id(history.serverEpoch)||!id(history.source)||!["available","deleted","unreachable","unsupported","unknown"].includes(history.state)||!["native-history","retained-range","summary-only"].includes(history.range)||!["complete","partial","unknown"].includes(history.completeness)||!Array.isArray(history.entries)||history.entries.length>100||history.entries.some(entry=>!entry||!known(entry,["id","kind","turnId","truncated"])||!id(entry.id)||!["user","assistant","tool","approval","summary","other"].includes(entry.kind)||entry.turnId!==undefined&&!id(entry.turnId)||entry.truncated!==undefined&&entry.truncated!==true)||history.nextCursor!==undefined&&!id(history.nextCursor)||!Array.isArray(history.gaps)||history.gaps.length>32||history.gaps.some(gap=>!id(gap))))return invalid();
}
