import {isDeepStrictEqual} from "node:util";
import {capturePricingSnapshot,type NativeModelInvocation,type NativeTurnCompletion} from "@dispatcher/domain";
import type {DispatcherDatabase} from "./index.js";

const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
const text=(value:unknown):value is string=>typeof value==="string"&&value.length>0&&value.length<=1024&&!Array.from(value).some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127);
const keys=(value:Record<string,unknown>,allowed:string[])=>Object.keys(value).every(key=>allowed.includes(key));
const options=(value:unknown)=>object(value)&&Object.keys(value).length<=20&&Object.entries(value).every(([key,item])=>text(key)&&!["__proto__","constructor","prototype"].includes(key)&&(typeof item==="string"?item.length<=1024:typeof item==="boolean"||typeof item==="number"&&Number.isFinite(item)));
const pricing=(value:unknown):boolean=>{if(value===undefined)return true;try{return isDeepStrictEqual(capturePricingSnapshot(value),value);}catch{return false;}};
function valid(record:NativeModelInvocation):boolean {
 if(!object(record)||!keys(record,["version","id","sessionId","runId","profileId","backendId","kind","invokedAt","nativeSessionId","execution","executionSelection","model"])||record.version!==1||![record.id,record.sessionId,record.runId,record.profileId,record.backendId].every(text)||!["start","input"].includes(record.kind)||!text(record.invokedAt)||!Number.isFinite(Date.parse(record.invokedAt))||record.nativeSessionId!==undefined&&!text(record.nativeSessionId)||!object(record.model)||!keys(record.model,["id","options"])||record.model.id!==null&&!text(record.model.id)||!options(record.model.options))return false;
 const e=record.execution,s=record.executionSelection;
 if(e!==undefined&&(!object(e)||!keys(e,["generation","attempt","leaseId"])||!Number.isSafeInteger(e.generation)||e.generation<1||!Number.isSafeInteger(e.attempt)||e.attempt<1||e.leaseId!==undefined&&!text(e.leaseId)))return false;
 return s===undefined||object(s)&&keys(s,["version","mode","source","profileId","runnerId","providerId","backendId","selectionType","requestedModel","nativeParameters","catalogRevision","contextFingerprint","configRevision","selectedAt","pricingSnapshot"])&&s.version===1&&["manual","policy-auto","legacy"].includes(s.mode)&&["explicit","account-default","policy","native-default","legacy-config"].includes(s.source)&&["explicit-model","native-default"].includes(s.selectionType)&&[s.profileId,s.runnerId,s.providerId,s.backendId,s.contextFingerprint,s.selectedAt].every(text)&&(s.requestedModel===undefined||text(s.requestedModel))&&(s.catalogRevision===undefined||text(s.catalogRevision))&&Number.isSafeInteger(s.configRevision)&&s.configRevision>=0&&options(s.nativeParameters)&&pricing(s.pricingSnapshot);
}

/** Append-only actual invocation facts, independent of mutable session snapshots. */
export class ModelInvocationStore {
  constructor(private readonly db:DispatcherDatabase){}
  completion(id:string):NativeTurnCompletion|undefined {
    const row=this.db.handle.prepare("SELECT record_json FROM native_turn_completions WHERE invocation_id=?").get(id);return row?JSON.parse(String(row.record_json)) as NativeTurnCompletion:undefined;
  }
  appendCompletion(record:NativeTurnCompletion):void {
    if(!object(record))throw Error("NATIVE_COMPLETION_INVALID");
    this.db.transaction(()=>{
      const prior=this.completion(record.invocationId);if(prior){if(!isDeepStrictEqual(prior,record))throw Error("NATIVE_COMPLETION_IMMUTABLE");return;}
      const invocation=this.get(record.invocationId),e=record.execution;
      if(!object(record)||!keys(record,["version","invocationId","sessionId","runId","profileId","backendId","providerSessionId","producer","outcome","completedAt","execution"])||record.version!==1||record.producer!=="owned-process-group"||!["completed","failed","cancelled","waiting"].includes(record.outcome)||![record.invocationId,record.sessionId,record.runId,record.profileId,record.backendId,record.providerSessionId].every(text)||!text(record.completedAt)||!Number.isFinite(Date.parse(record.completedAt))||!invocation||Date.parse(record.completedAt)<Date.parse(invocation.invokedAt)||["sessionId","runId","profileId","backendId"].some(key=>record[key as keyof NativeTurnCompletion]!==invocation[key as keyof NativeModelInvocation])||invocation.nativeSessionId!==undefined&&invocation.nativeSessionId!==record.providerSessionId||!object(e)||!keys(e,["generation","attempt","leaseId"])||!text(e.leaseId)||!isDeepStrictEqual(e,invocation.execution))throw Error("NATIVE_COMPLETION_INVALID");
      this.db.handle.prepare("INSERT INTO native_turn_completions VALUES (?,?)").run(record.invocationId,JSON.stringify(record));
    });
  }
  get(id:string):NativeModelInvocation|undefined {
    const row=this.db.handle.prepare("SELECT record_json FROM native_model_invocations WHERE id=?").get(id);
    return row?JSON.parse(String(row.record_json)) as NativeModelInvocation:undefined;
  }
  list(runId:string):NativeModelInvocation[]{return this.db.handle.prepare("SELECT record_json FROM native_model_invocations WHERE run_id=? ORDER BY sequence").all(runId).map(row=>JSON.parse(String(row.record_json)) as NativeModelInvocation);}
  append(record:NativeModelInvocation):void {
    if(!valid(record))throw Error("MODEL_INVOCATION_INVALID");
    this.db.transaction(()=>{
      const previous=this.get(record.id);
      if(previous){if(!isDeepStrictEqual(previous,record))throw Error("MODEL_INVOCATION_IMMUTABLE");return;}
      this.db.handle.prepare("INSERT INTO native_model_invocations(id,run_id,session_id,record_json,sequence) SELECT ?,?,?,?,COALESCE(MAX(sequence),0)+1 FROM native_model_invocations").run(record.id,record.runId,record.sessionId,JSON.stringify(record));
    });
  }
}
