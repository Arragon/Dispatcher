import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import type { AdapterSession, NativeInteractionPort } from "@dispatcher/adapters";
import { assessInteractionCapability, normalizeNativeBinding, type HistoryPage, type HistoryRequest, type NativeBinding, type NativeHistoryEntry, type Run, type Session } from "@dispatcher/domain";
import { redactValue, redactNativeText, redactNativePayload } from "@dispatcher/observability";
import { InteractionStore, type DispatcherDatabase, type JsonValue } from "@dispatcher/persistence";
import type { InteractionPrincipal } from "./native-interactions.js";

export interface NativeHistoryScope {sessionId:string;runId:string;taskId:string;projectId:string;profileId:string}
export interface NativeHistorySource {binding:NativeBinding;scopeFingerprint:string;port:Pick<NativeInteractionPort,"capabilities"|"history">}
export class NativeHistoryError extends Error {constructor(readonly code:string){super(code);this.name="NativeHistoryError";}}
const validId=(value:unknown):value is string=>typeof value==="string"&&value.length>0&&value.length<=512&&Array.from(value).every(c=>c.charCodeAt(0)>=32);
const MAX_RESPONSE_BYTES=262_144;const MAX_ENTRY_BYTES=16_384;const MAX_PAGE_TEXT_BYTES=65_536;
function clip(value:string,maxBytes:number):{text:string;truncated:boolean} {
  let bytes=0;let text="";
  for(const character of value){const next=Buffer.byteLength(character);if(bytes+next>maxBytes)return {text,truncated:true};text+=character;bytes+=next;}
  return {text,truncated:false};
}
const safeMetadata=(value:unknown):value is string=>validId(value)&&redactNativeText(value)===value;
function cleanText(value:string):string {
  // Bound raw work; opaque metadata uses only known credential patterns, not base64 heuristics.
  return redactNativePayload(redactValue(value.slice(0,MAX_ENTRY_BYTES))) as string;
}

/** Only the selected session's qualified read method is reachable from this service. */
export class NativeHistoryService {
  private readonly store:InteractionStore;
  constructor(private readonly database:DispatcherDatabase,
    private readonly resolveSource:(binding:NativeBinding)=>NativeHistorySource|undefined,
    private readonly authorizeScope:(principal:InteractionPrincipal,scope:NativeHistoryScope)=>boolean){this.store=new InteractionStore(database);}
  private context(sessionId:string):{scope:NativeHistoryScope;binding:NativeBinding} {
    const session=this.database.getEntity<JsonValue>("session",sessionId) as unknown as Session|undefined;
    const adapter=this.database.getEntity<JsonValue>("adapter-session",sessionId) as unknown as AdapterSession|undefined;
    const run=adapter?this.database.getEntity<JsonValue>("run",adapter.runId) as unknown as Run|undefined:undefined;
    const binding=this.store.binding(sessionId);
    const task=run?this.database.getCanonicalTask<JsonValue>(run.taskId)?.document as {projectId?:string}|undefined:undefined;
    if(!session||!adapter||!run||!binding||!validId(task?.projectId)||session.providerId!==run.providerId)throw new NativeHistoryError("NATIVE_HISTORY_UNAVAILABLE");
    if(![binding.product,binding.region,binding.profileId,binding.backendId,binding.runnerId,binding.nativeStoreRef,binding.nativeSessionId,binding.executionRefId].every(validId)||[binding.nativeThreadId,binding.parentSessionId].some(value=>value!==undefined&&!validId(value))||!safeMetadata(binding.nativeSessionId)||!safeMetadata(binding.product))throw new NativeHistoryError("NATIVE_HISTORY_SCOPE_CHANGED");
    const normalized=normalizeNativeBinding(session,adapter,run);
    if(!("binding" in normalized)||!isDeepStrictEqual(normalized.binding,binding)||run.executionRef?.id!==binding.executionRefId)throw new NativeHistoryError("NATIVE_HISTORY_SCOPE_CHANGED");
    return {scope:{sessionId,runId:run.id,taskId:run.taskId,projectId:task.projectId,profileId:run.profileId},binding:structuredClone(binding)};
  }
  private authorize(principal:InteractionPrincipal,scope:NativeHistoryScope):void {
    if(!principal.id||!principal.roles.some(role=>["viewer","operator","admin"].includes(role))||principal.profileId!==undefined&&principal.profileId!==scope.profileId)throw new NativeHistoryError("FORBIDDEN");
    try{if(this.authorizeScope(structuredClone(principal),structuredClone(scope)))return;}catch { /* Policy failure cannot disclose provider or policy diagnostics. */ }
    throw new NativeHistoryError("FORBIDDEN");
  }
  private source(binding:NativeBinding):{scopeFingerprint:string;port:NativeHistorySource["port"];method:NonNullable<NativeInteractionPort["history"]>;read:NonNullable<NativeInteractionPort["history"]>}|{state:HistoryPage["state"];code:string} {
    try{
      const source=this.resolveSource(structuredClone(binding));
      if(!source)return {state:"unsupported",code:"NATIVE_HISTORY_UNSUPPORTED"};
      if(!isDeepStrictEqual(source.binding,binding)||!validId(source.scopeFingerprint))throw new NativeHistoryError("NATIVE_HISTORY_SCOPE_CHANGED");
      const assessment=assessInteractionCapability(source.port.capabilities().historyRead,source.scopeFingerprint,"runtime-verified");
      if(!assessment.supported)return {state:assessment.code==="NATIVE_CAPABILITY_UNSUPPORTED"?"unsupported":"unknown",code:assessment.code??"NATIVE_CAPABILITY_UNVERIFIED"};
      if(!source.port.history)return {state:"unsupported",code:"NATIVE_HISTORY_UNSUPPORTED"};
      return {scopeFingerprint:source.scopeFingerprint,port:source.port,method:source.port.history,read:source.port.history.bind(source.port)};
    }catch(error){if(error instanceof NativeHistoryError)throw error;return {state:"unknown",code:"NATIVE_HISTORY_SOURCE_UNAVAILABLE"};}
  }
  async readNativeHistory(principal:InteractionPrincipal,sessionId:string,request:Partial<HistoryRequest>={}):Promise<HistoryPage> {
    const actor=structuredClone(principal);
    // Reject anonymous/unprivileged requests before looking up even session existence.
    if(!actor.id||!actor.roles.some(role=>["viewer","operator","admin"].includes(role)))throw new NativeHistoryError("FORBIDDEN");
    if(!validId(sessionId)||request.limit!==undefined&&(!Number.isSafeInteger(request.limit)||request.limit<1)||request.cursor!==undefined&&!safeMetadata(request.cursor))throw new NativeHistoryError("INVALID_HISTORY_REQUEST");
    const input={limit:Math.min(request.limit??50,100),...(request.cursor?{cursor:request.cursor}:{})};
    const selected=this.context(sessionId);this.authorize(actor,selected.scope);
    const unavailable=(state:HistoryPage["state"],code:string):HistoryPage=>({version:1,nativeSessionId:selected.binding.nativeSessionId,entries:[],completeness:"unknown",range:"native-history",state,source:selected.binding.product,gaps:[code]});
    const source=this.source(selected.binding);
    if("state" in source)return unavailable(source.state,source.code);
    const {read,scopeFingerprint}=source;
    const recheck=()=>{
      const current=this.context(sessionId);this.authorize(actor,current.scope);
      if(!isDeepStrictEqual(current,selected))throw new NativeHistoryError("NATIVE_HISTORY_SCOPE_CHANGED");
      const currentSource=this.source(selected.binding);
      if("state" in currentSource||currentSource.scopeFingerprint!==scopeFingerprint||currentSource.port!==source.port||currentSource.method!==source.method)throw new NativeHistoryError("NATIVE_HISTORY_SCOPE_CHANGED");
    };
    const cancellation=new AbortController(),context={requestId:randomUUID(),observerEpoch:randomUUID(),sequence:1,signal:cancellation.signal};let timer:ReturnType<typeof setTimeout>|undefined;
    let page:HistoryPage;
    try{page=await Promise.race([Promise.resolve().then(()=>{recheck();return read(structuredClone(selected.binding),{...input},context);}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{cancellation.abort();reject(new Error("NATIVE_HISTORY_TIMEOUT"));},5_000);})]);}
    catch{recheck();return unavailable("unreachable","NATIVE_HISTORY_READ_UNAVAILABLE");}
    finally{if(timer)clearTimeout(timer);cancellation.abort();}
    recheck();
    return this.normalize(page,selected.binding,input.limit);
  }
  private normalize(page:HistoryPage,binding:NativeBinding,limit:number):HistoryPage {
    const invalid=():HistoryPage=>({version:1,nativeSessionId:binding.nativeSessionId,entries:[],completeness:"unknown",range:"native-history",state:"unknown",source:binding.product,gaps:["INVALID_NATIVE_HISTORY"]});
    if(!page||page.version!==1||page.nativeSessionId!==binding.nativeSessionId||!Array.isArray(page.entries)||!safeMetadata(page.source)||!["complete","partial","unknown"].includes(page.completeness)||!["native-history","retained-range","summary-only"].includes(page.range)||!["available","deleted","unreachable","unsupported","unknown"].includes(page.state)||page.nextCursor!==undefined&&!safeMetadata(page.nextCursor)||page.gaps!==undefined&&(!Array.isArray(page.gaps)||page.gaps.slice(0,32).some(gap=>typeof gap!=="string"))||page.truncation!==undefined&&typeof page.truncation!=="string")return invalid();
    const gaps:string[]=[];const truncation:string[]=[];
    if(page.gaps?.length)gaps.push("PROVIDER_REPORTED_GAP");
    if(page.truncation)truncation.push("PROVIDER_TRUNCATED");
    if(page.entries.length>limit)truncation.push("HISTORY_PAGE_TRUNCATED");
    if(page.nextCursor)gaps.push("HISTORY_MORE_PAGES");
    if(page.range!=="native-history")gaps.push("HISTORY_RANGE_LIMITED");
    let remaining=MAX_PAGE_TEXT_BYTES;const entries:NativeHistoryEntry[]=[];
    for(const entry of page.entries.slice(0,limit)){
      if(!entry||!safeMetadata(entry.id)||!["user","assistant","tool","approval","summary","other"].includes(entry.kind)||typeof entry.text!=="string"||entry.turnId!==undefined&&!safeMetadata(entry.turnId)||entry.occurredAt!==undefined&&(!safeMetadata(entry.occurredAt)||entry.occurredAt.length>64||!Number.isFinite(Date.parse(entry.occurredAt)))||entry.truncated!==undefined&&typeof entry.truncated!=="boolean")return invalid();
      const text=clip(cleanText(entry.text),Math.min(MAX_ENTRY_BYTES,remaining));remaining-=Buffer.byteLength(text.text);
      const truncated=entry.truncated||text.truncated||entry.text.length>MAX_ENTRY_BYTES;
      if(truncated)truncation.push("HISTORY_CONTENT_TRUNCATED");
      entries.push({id:entry.id,kind:entry.kind,text:text.text,...(entry.turnId?{turnId:entry.turnId}:{}),...(entry.occurredAt?{occurredAt:entry.occurredAt}:{}),...(truncated?{truncated:true}:{})});
    }
    const result:HistoryPage={version:1,nativeSessionId:binding.nativeSessionId,entries,completeness:page.state!=="available"?"unknown":page.completeness,state:page.state,range:page.range,source:clip(redactValue(page.source) as string,128).text,...(page.nextCursor?{nextCursor:page.nextCursor}:{})};
    if(truncation.length){result.truncation=[...new Set(truncation)].join(",");gaps.push("HISTORY_TRUNCATED");}
    if(gaps.length)result.gaps=gaps;
    if(result.state==="available"&&(gaps.length||truncation.length)&&result.completeness==="complete")result.completeness="partial";
    while(Buffer.byteLength(JSON.stringify(result))>MAX_RESPONSE_BYTES&&entries.length){
      entries.pop();result.truncation=[...new Set([...truncation,"HISTORY_RESPONSE_TRUNCATED"])].join(",");result.gaps=[...new Set([...gaps,"HISTORY_TRUNCATED"])];if(result.state==="available"&&result.completeness==="complete")result.completeness="partial";
    }
    return result;
  }
}
