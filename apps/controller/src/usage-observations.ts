import type {UsageObservationV1} from "@dispatcher/domain";
import type {DispatcherDatabase,JsonValue} from "@dispatcher/persistence";
import {contentHash} from "./task-publications.js";
export type UsageContext={profileId:string;runId:string;sessionId:string}&({generation:number;standalone?:false}|{standalone:true;generation?:never});
export class UsageObservationError extends Error{constructor(readonly code:string,message:string){super(message);this.name="UsageObservationError";}}
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==="object"&&!Array.isArray(value));
const scalar=(value:unknown):value is string=>typeof value==="string"&&value.length>0&&value.length<=200;
const date=(value:unknown):value is string=>typeof value==="string"&&/^\d{4}-\d{2}-\d{2}T/.test(value)&&/(?:Z|[+-]\d{2}:\d{2})$/u.test(value)&&Number.isFinite(Date.parse(value));
const amount=(value:string)=>{const [whole,fraction=""]=value.split(".");return BigInt(whole!)*10n**18n+BigInt(fraction.padEnd(18,"0"));};
const decimal=(value:bigint)=>{const whole=value/10n**18n,fraction=(value%10n**18n).toString().padStart(18,"0").replace(/0+$/u,"");return `${whole}${fraction?`.${fraction}`:""}`;};
function fail(message:string):never{throw new UsageObservationError("USAGE_INVALID",message);}
function normalize(value:unknown,context:UsageContext,collectedAt:string):UsageObservationV1{
 if(!object(value)||value.version!==1||!scalar(value.eventId)||value.profileId!==context.profileId||!date(value.observedAt)||!["turn","run","session","account-period"].includes(String(value.scope))||!["delta","snapshot"].includes(String(value.mode))||!["native-event","native-query","native-result"].includes(String(value.source))||!["complete","partial","unknown"].includes(String(value.completeness)))return fail("Usage observation identity is invalid");
 const account=value.scope==="account-period";
 if(context.standalone&&value.scope==="run")return fail("Standalone usage cannot claim canonical Run scope");
 if(account&&(value.runId!==undefined||value.sessionId!==undefined||value.generation!==undefined||value.turnId!==undefined)||!account&&(value.runId!==context.runId||value.sessionId!==context.sessionId||value.generation!==undefined&&value.generation!==context.generation)||value.scope==="turn"&&!scalar(value.turnId))return fail("Usage belongs to another execution context");
 if(!Array.isArray(value.metrics)||value.metrics.length>64)return fail("Usage metrics must be bounded");
 const metrics=value.metrics.map(metric=>{if(!object(metric)||typeof metric.name!=="string"||!/^[a-zA-Z][a-zA-Z0-9._-]{0,79}$/u.test(metric.name)||typeof metric.unit!=="string"||!/^[a-zA-Z][a-zA-Z0-9._:/-]{0,39}$/u.test(metric.unit)||typeof metric.value!=="string"||!/^\d{1,30}(?:\.\d{1,18})?$/u.test(metric.value)||metric.includedIn!==undefined&&typeof metric.includedIn!=="string")return fail("Usage metric is invalid");return {name:metric.name,value:metric.value,unit:metric.unit,...(typeof metric.includedIn==="string"?{includedIn:metric.includedIn}:{})};});
 if(new Set(metrics.map(metric=>metric.name)).size!==metrics.length)return fail("Usage metric names must be unique");
 for(const metric of metrics)if(metric.includedIn){const parent=metrics.find(parent=>parent.name===metric.includedIn);if(!parent||parent.name===metric.name||parent.unit!==metric.unit||amount(metric.value)>amount(parent.value))return fail("Usage inclusion is invalid");const visited=new Set([metric.name]);let current=parent;while(current.includedIn){if(visited.has(current.name))return fail("Usage inclusion is cyclic");visited.add(current.name);const next=metrics.find(candidate=>candidate.name===current.includedIn);if(!next)return fail("Usage inclusion is invalid");current=next;}}
 let period:UsageObservationV1["period"];
 if(value.period!==undefined){const raw=value.period;if(!object(raw)||Object.entries(raw).some(([key,value])=>!["start","end","resetsAt"].includes(key)||!date(value)))return fail("Usage period is invalid");period=raw as UsageObservationV1["period"];if(period?.start&&period.end&&Date.parse(period.start)>Date.parse(period.end))return fail("Usage period is reversed");}
 return {version:1,eventId:value.eventId,profileId:context.profileId,...(!account?{sessionId:context.sessionId,...(!context.standalone?{runId:context.runId,generation:context.generation}:{})}:{}),...(scalar(value.turnId)?{turnId:value.turnId}:{}),scope:value.scope as UsageObservationV1["scope"],mode:value.mode as UsageObservationV1["mode"],observedAt:value.observedAt,collectedAt,source:value.source as UsageObservationV1["source"],completeness:value.completeness as UsageObservationV1["completeness"],metrics,...(period?{period:structuredClone(period)}:{})};
}
const scopeKey=(value:UsageObservationV1)=>({profileId:value.profileId,runId:value.runId,sessionId:value.sessionId,generation:value.generation,turnId:value.turnId,scope:value.scope,period:value.period});
export class UsageObservations {
 constructor(private readonly db:DispatcherDatabase,private readonly now:()=>Date=()=>new Date()){}
 record(input:unknown,context:UsageContext):number{
  if(!Array.isArray(input)||input.length>1000)return fail("Usage observation batch is invalid");const records=input.map(value=>normalize(value,context,this.now().toISOString()));
  return this.db.transaction(()=>{let inserted=0;for(const record of records){const identity=contentHash({profileId:record.profileId,sessionId:record.sessionId,eventId:record.eventId}),prior=this.db.getEntity<JsonValue>("usage-observation",identity) as unknown as UsageObservationV1|undefined;
   if(prior){if(contentHash({...prior,collectedAt:undefined})!==contentHash({...record,collectedAt:undefined}))throw new UsageObservationError("USAGE_EVENT_CONFLICT","Native usage event changed on replay");continue;}
   this.db.saveEntity("usage-observation",identity,record as unknown as JsonValue,record.collectedAt);inserted++;
  }return inserted;});
 }
 query(filter:{profileId?:string;runId?:string;sessionId?:string;from?:string;to?:string}={}){
  if(filter.from&&!date(filter.from)||filter.to&&!date(filter.to)||filter.from&&filter.to&&Date.parse(filter.from)>Date.parse(filter.to))return fail("Usage time range is invalid");
  const observations=this.db.listEntities<JsonValue>("usage-observation").map(value=>value as unknown as UsageObservationV1).filter(value=>(!filter.profileId||value.profileId===filter.profileId)&&(!filter.runId||value.runId===filter.runId)&&(!filter.sessionId||value.sessionId===filter.sessionId)&&(!filter.from||Date.parse(value.observedAt)>=Date.parse(filter.from))&&(!filter.to||Date.parse(value.observedAt)<=Date.parse(filter.to))).sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt)||Date.parse(a.collectedAt)-Date.parse(b.collectedAt));
  const snapshots=new Map<string,UsageObservationV1>();for(const record of observations)if(record.mode==="snapshot")snapshots.set(contentHash(scopeKey(record)),record);
  const groups=new Map<string,{record:UsageObservationV1;metric:UsageObservationV1["metrics"][number]}[]>();for(const record of observations)for(const metric of record.metrics){const key=contentHash({...scopeKey(record),name:metric.name,unit:metric.unit}),entries=groups.get(key)??[];entries.push({record,metric});groups.set(key,entries);}
  const sums=new Map<string,{profileId:string;scope:UsageObservationV1["scope"];name:string;unit:string;value:bigint;period?:UsageObservationV1["period"]}>();
  for(const entries of groups.values()){const first=entries[0]!,latest=snapshots.get(contentHash(scopeKey(first.record))),snapshot=entries.find(entry=>entry.record===latest),deltas=entries.filter(entry=>entry.record.mode==="delta"&&(!latest||Date.parse(entry.record.observedAt)>Date.parse(latest.observedAt)));if(!snapshot&&!deltas.length)continue;
   const key=contentHash({profileId:first.record.profileId,scope:first.record.scope,name:first.metric.name,unit:first.metric.unit,period:first.record.period}),sum=sums.get(key)??{profileId:first.record.profileId,scope:first.record.scope,name:first.metric.name,unit:first.metric.unit,value:0n,...(first.record.period?{period:first.record.period}:{})};sum.value+=snapshot?amount(snapshot.metric.value):0n;for(const entry of deltas)sum.value+=amount(entry.metric.value);sums.set(key,sum);}
  return {observations,totals:[...sums.values()].map(value=>({...value,value:decimal(value.value)})),rangeBasis:"observation-time" as const,estimation:{status:"unavailable",reasonCode:"BILLING_BASELINE_MISSING"}};
 }
}
