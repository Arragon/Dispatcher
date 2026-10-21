import {storedNumberDecimal as storedDecimal} from "./decimal.js";
/** Historical compatibility only. These facts require reconciliation before ledger admission. */
export interface LegacyUsageEvidence {
  profileId:string;runId:string;sessionId:string;nativeSessionId?:string;
  generation:number;attempt:number;eventId:string;turnId?:string;source:string;
  collectedAt:string;occurredAt?:string;scope:"turn"|"run"|"session";
  mode:"delta"|"snapshot";completeness:"complete"|"partial";
  cacheReadIncludedInInput?:boolean;
  metrics:Array<{name:string;value:string;unit:string;includedIn?:string}>;
}
export interface LegacyUsageRead {
  status:"read-only"|"invalid";
  reference:{format:"legacy-usage-measurement-v1";recordId:string};
  evidence?:LegacyUsageEvidence;
  /** Private source evidence; never serialize this directly into a public projection. */
  raw?:unknown;
  diagnostics:string[];
}
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==="object"&&!Array.isArray(value));
const text=(value:unknown):value is string=>typeof value==="string"&&value.length>0&&value.length<=500&&!Array.from(value).some(character=>character.charCodeAt(0)<32||character.charCodeAt(0)===127);
const time=(value:unknown):value is string=>text(value)&&/^\d{4}-\d{2}-\d{2}T/.test(value)&&/(?:Z|[+-]\d{2}:\d{2})$/u.test(value)&&Number.isFinite(Date.parse(value));
const ordinal=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>0;


export function readLegacyUsageMeasurement(input:{format:"legacy-usage-measurement-v1";recordId:string;record:unknown}):LegacyUsageRead{
  const reference={format:input.format,recordId:input.recordId};let raw:unknown;
  try{raw=structuredClone(input.record);}catch{return {status:"invalid",reference,diagnostics:["LEGACY_RECORD_UNREADABLE"]};}
  const invalid=(code:string):LegacyUsageRead=>({status:"invalid",reference,raw,diagnostics:[code]});
  if(input.format!=="legacy-usage-measurement-v1"||!text(input.recordId))return invalid("LEGACY_SOURCE_FORMAT_REQUIRED");
  if(!object(raw)||raw.version!==1||!["profileId","runId","sessionId","eventId","source","unit"].every(key=>text(raw[key]))||!ordinal(raw.generation)||!ordinal(raw.attempt)||!time(raw.collectedAt)||raw.occurredAt!==undefined&&!time(raw.occurredAt)||!["turn","run","session"].includes(String(raw.scope))||!["incremental","cumulative"].includes(String(raw.semantics))||!["complete","partial"].includes(String(raw.completeness)))return invalid("LEGACY_USAGE_INVALID");
  if(raw.nativeSessionId!==undefined&&!text(raw.nativeSessionId)||raw.turnId!==undefined&&!text(raw.turnId)||(raw.scope==="turn"||raw.semantics==="incremental")&&!text(raw.turnId)||raw.cacheReadIncludedInInput!==undefined&&typeof raw.cacheReadIncludedInInput!=="boolean")return invalid("LEGACY_USAGE_INVALID");
  const metrics:LegacyUsageEvidence["metrics"]=[];
  for(const name of ["input","output","cacheRead","cacheWrite"]){
    if(raw[name]===undefined)continue;const value=storedDecimal(raw[name]);if(value===undefined||raw.unit==="tokens"&&!Number.isSafeInteger(raw[name]))return invalid("LEGACY_NUMERIC_PRECISION_UNSAFE");
    metrics.push({name,value,unit:String(raw.unit),...(name==="cacheRead"&&raw.cacheReadIncludedInInput===true&&raw.input!==undefined?{includedIn:"input"}:{})});
  }
  if(raw.cacheReadIncludedInInput===true&&typeof raw.input==="number"&&typeof raw.cacheRead==="number"&&raw.cacheRead>raw.input)return invalid("LEGACY_CACHE_EXCEEDS_INPUT");
  if(raw.other!==undefined){
    if(!object(raw.other)||Object.keys(raw.other).length>64)return invalid("LEGACY_USAGE_INVALID");
    for(const [name,quantity] of Object.entries(raw.other).sort(([left],[right])=>left.localeCompare(right))){
      const value=storedDecimal(quantity);if(!text(name)||value===undefined)return invalid("LEGACY_NUMERIC_PRECISION_UNSAFE");metrics.push({name:`other.${name}`,value,unit:String(raw.unit)});
    }
  }
  const diagnostics=["LEGACY_NATIVE_EVENT_IDENTITY_UNPROVEN","LEGACY_STORED_NUMERIC_PRECISION_ONLY"];
  if(raw.occurredAt===undefined)diagnostics.push("LEGACY_BILLING_TIME_UNKNOWN");
  if(raw.input===undefined||raw.output===undefined)diagnostics.push("LEGACY_DIMENSIONS_MISSING");
  if(raw.cacheRead!==undefined&&raw.cacheReadIncludedInInput===undefined)diagnostics.push("LEGACY_CACHE_INCLUSION_UNKNOWN");
  const evidence:LegacyUsageEvidence={profileId:String(raw.profileId),runId:String(raw.runId),sessionId:String(raw.sessionId),generation:raw.generation,attempt:raw.attempt,eventId:String(raw.eventId),source:String(raw.source),collectedAt:raw.collectedAt,scope:raw.scope as LegacyUsageEvidence["scope"],mode:raw.semantics==="incremental"?"delta":"snapshot",completeness:raw.completeness as LegacyUsageEvidence["completeness"],metrics,...(text(raw.nativeSessionId)?{nativeSessionId:raw.nativeSessionId}:{}),...(text(raw.turnId)?{turnId:raw.turnId}:{}),...(time(raw.occurredAt)?{occurredAt:raw.occurredAt}:{}),...(typeof raw.cacheReadIncludedInInput==="boolean"?{cacheReadIncludedInInput:raw.cacheReadIncludedInInput}:{})};
  return {status:"read-only",reference,raw,evidence,diagnostics};
}
