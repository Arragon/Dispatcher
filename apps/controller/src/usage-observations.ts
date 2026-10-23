import {decimalAmount as amount,decimalString as decimal,usageAggregationTime,type UsageObservationV1} from "@dispatcher/domain";
import type {DispatcherDatabase,JsonValue} from "@dispatcher/persistence";
import {contentHash} from "./task-publications.js";
export type UsageContext={profileId:string;runId:string;sessionId:string;nativeSessionId?:string;
 /** Trusted owning producer registration; incoming observations cannot self-authorize a namespace or scope. */
 producer?:{id:string;scope:UsageObservationV1["scope"]}}&({generation:number;attempt?:number;standalone?:false}|{standalone:true;generation?:never;attempt?:never});
export class UsageObservationError extends Error{constructor(readonly code:string,message:string){super(message);this.name="UsageObservationError";}}
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==="object"&&!Array.isArray(value));
const scalar=(value:unknown):value is string=>typeof value==="string"&&value.length>0&&value.length<=200;
const date=(value:unknown):value is string=>typeof value==="string"&&/^\d{4}-\d{2}-\d{2}T/.test(value)&&/(?:Z|[+-]\d{2}:\d{2})$/u.test(value)&&Number.isFinite(Date.parse(value));
const identifier=(value:unknown):value is string=>scalar(value)&&!Array.from(value).some(character=>character.charCodeAt(0)<32||character.charCodeAt(0)===127);
function fail(message:string):never{throw new UsageObservationError("USAGE_INVALID",message);}
function normalize(value:unknown,context:UsageContext,collectedAt:string):UsageObservationV1{
 if(!object(value)||value.version!==1||!scalar(value.eventId)||value.profileId!==context.profileId||!date(value.observedAt)||!["turn","run","session","account-period"].includes(String(value.scope))||!["delta","snapshot"].includes(String(value.mode))||!["native-event","native-query","native-result"].includes(String(value.source))||!["complete","partial","unknown"].includes(String(value.completeness)))return fail("Usage observation identity is invalid");
 const account=value.scope==="account-period";
 if(context.attempt!==undefined&&(!Number.isSafeInteger(context.attempt)||context.attempt<1)||context.nativeSessionId!==undefined&&!identifier(context.nativeSessionId)||context.producer&&(!identifier(context.producer.id)||context.producer.scope!==value.scope))return fail("Usage producer context is invalid");
 if(value.attempt!==undefined&&(account||context.standalone||value.attempt!==context.attempt)||value.nativeSessionId!==undefined&&(account||value.nativeSessionId!==context.nativeSessionId))return fail("Usage belongs to another native attempt");
 let producerOrigin:UsageObservationV1["producerOrigin"];
 if(value.producerOrigin!==undefined){
  const origin=value.producerOrigin;
  if(!object(origin)||!context.producer||origin.producerId!==context.producer.id||!identifier(origin.eventId)||Object.keys(origin).some(key=>!["producerId","eventId"].includes(key)))return fail("Usage producer origin is unproven");
  producerOrigin={producerId:context.producer.id,eventId:origin.eventId};
 }
 if(value.occurredAt!==undefined&&(!producerOrigin||!date(value.occurredAt)))return fail("Usage billing occurrence is unproven");
 if(context.standalone&&value.scope==="run")return fail("Standalone usage cannot claim canonical Run scope");
 if(account&&(value.runId!==undefined||value.sessionId!==undefined||value.generation!==undefined||value.turnId!==undefined)||!account&&(value.runId!==context.runId||value.sessionId!==context.sessionId||value.generation!==undefined&&value.generation!==context.generation)||value.scope==="turn"&&!scalar(value.turnId))return fail("Usage belongs to another execution context");
 if(!Array.isArray(value.metrics)||value.metrics.length>64)return fail("Usage metrics must be bounded");
 const metrics=value.metrics.map(metric=>{if(!object(metric)||typeof metric.name!=="string"||!/^[a-zA-Z][a-zA-Z0-9._-]{0,79}$/u.test(metric.name)||typeof metric.unit!=="string"||!/^[a-zA-Z][a-zA-Z0-9._:/-]{0,39}$/u.test(metric.unit)||typeof metric.value!=="string"||!/^\d{1,30}(?:\.\d{1,18})?$/u.test(metric.value)||metric.includedIn!==undefined&&typeof metric.includedIn!=="string")return fail("Usage metric is invalid");return {name:metric.name,value:metric.value,unit:metric.unit,...(typeof metric.includedIn==="string"?{includedIn:metric.includedIn}:{})};});
 if(new Set(metrics.map(metric=>metric.name)).size!==metrics.length)return fail("Usage metric names must be unique");
 for(const metric of metrics)if(metric.includedIn){const parent=metrics.find(parent=>parent.name===metric.includedIn);if(!parent||parent.name===metric.name||parent.unit!==metric.unit||amount(metric.value)>amount(parent.value))return fail("Usage inclusion is invalid");const visited=new Set([metric.name]);let current=parent;while(current.includedIn){if(visited.has(current.name))return fail("Usage inclusion is cyclic");visited.add(current.name);const next=metrics.find(candidate=>candidate.name===current.includedIn);if(!next)return fail("Usage inclusion is invalid");current=next;}}
 let period:UsageObservationV1["period"];
 if(value.period!==undefined){const raw=value.period;if(!object(raw)||Object.entries(raw).some(([key,value])=>!["start","end","resetsAt"].includes(key)||!date(value)))return fail("Usage period is invalid");period=raw as UsageObservationV1["period"];if(period?.start&&period.end&&Date.parse(period.start)>Date.parse(period.end))return fail("Usage period is reversed");}
 return {version:1,eventId:value.eventId,profileId:context.profileId,...(!account?{sessionId:context.sessionId,...(context.nativeSessionId?{nativeSessionId:context.nativeSessionId}:{}),...(!context.standalone?{runId:context.runId,generation:context.generation,...(context.attempt!==undefined?{attempt:context.attempt}:{})}:{})}:{}),...(producerOrigin?{producerOrigin}:{}),...(value.occurredAt!==undefined?{occurredAt:value.occurredAt as string}:{}),...(scalar(value.turnId)?{turnId:value.turnId}:{}),scope:value.scope as UsageObservationV1["scope"],mode:value.mode as UsageObservationV1["mode"],observedAt:value.observedAt,collectedAt,source:value.source as UsageObservationV1["source"],completeness:value.completeness as UsageObservationV1["completeness"],metrics,...(period?{period:structuredClone(period)}:{})};
}
const scopeKey=(value:UsageObservationV1)=>({profileId:value.profileId,runId:value.runId,sessionId:value.sessionId,generation:value.generation,attempt:value.attempt,nativeSessionId:value.nativeSessionId,producerId:value.producerOrigin?.producerId,turnId:value.turnId,scope:value.scope,period:value.period});
const replayHash=(record:UsageObservationV1)=>contentHash({...record,collectedAt:undefined});
const originHash=(record:UsageObservationV1)=>contentHash({...record,eventId:undefined,source:undefined,observedAt:undefined,collectedAt:undefined});
interface UsageOriginAlias {canonicalId:string;recordHash:string;eventId:string;source:UsageObservationV1["source"];observedAt:string}
export class UsageObservations {
 constructor(private readonly db:DispatcherDatabase,private readonly now:()=>Date=()=>new Date()){}
 record(input:unknown,context:UsageContext):number{
  if(!Array.isArray(input)||input.length>1000)return fail("Usage observation batch is invalid");const records=input.map(value=>normalize(value,context,this.now().toISOString()));
  return this.db.transaction(()=>{let inserted=0;for(const record of records){
   const collectorId=contentHash({profileId:record.profileId,sessionId:record.sessionId,eventId:record.eventId});
   const producerId=record.producerOrigin?contentHash({profileId:record.profileId,...(record.nativeSessionId?{nativeSessionId:record.nativeSessionId}:{sessionId:record.sessionId}),producerOrigin:record.producerOrigin}):undefined;
   const producer=producerId?this.db.getEntity<JsonValue>("usage-producer-origin",producerId) as {canonicalId:string}|undefined:undefined;
   const historical=this.db.getEntity<JsonValue>("usage-observation",collectorId) as unknown as UsageObservationV1|undefined;
   const alias=this.db.getEntity<JsonValue>("usage-origin-alias",collectorId) as unknown as UsageOriginAlias|undefined;
   const conflict=()=>{throw new UsageObservationError("USAGE_EVENT_CONFLICT","Native usage event changed on replay");};
   if(historical){if(replayHash(historical)!==replayHash(record)||producerId&&producer?.canonicalId!==collectorId)conflict();continue;}
   if(alias){const canonical=this.db.getEntity<JsonValue>("usage-observation",alias.canonicalId) as unknown as UsageObservationV1|undefined;if(alias.recordHash!==replayHash(record)||!canonical||originHash(canonical)!==originHash(record)||producer?.canonicalId!==alias.canonicalId)conflict();continue;}
   const identity=producer?.canonicalId??collectorId;
   const prior=this.db.getEntity<JsonValue>("usage-observation",identity) as unknown as UsageObservationV1|undefined;
   if(prior){if(originHash(prior)!==originHash(record))conflict();}
   else{if(producer)conflict();this.db.saveEntity("usage-observation",identity,record as unknown as JsonValue,record.collectedAt);inserted++;}
   if(producerId&&!producer)this.db.saveEntity("usage-producer-origin",producerId,{canonicalId:identity},record.collectedAt);
   // Collector receipts point to one immutable event; they never become extra quantities.
   if(record.producerOrigin&&identity!==collectorId)this.db.saveEntity("usage-origin-alias",collectorId,{canonicalId:identity,recordHash:replayHash(record),eventId:record.eventId,source:record.source,observedAt:record.observedAt},record.collectedAt);
  }return inserted;});
 }
 query(filter:{profileId?:string;runId?:string;sessionId?:string;from?:string;to?:string}={}){
  if(filter.from&&!date(filter.from)||filter.to&&!date(filter.to)||filter.from&&filter.to&&Date.parse(filter.from)>Date.parse(filter.to))return fail("Usage time range is invalid");
  const observations=this.db.listEntities<JsonValue>("usage-observation").map(value=>value as unknown as UsageObservationV1).filter(value=>(!filter.profileId||value.profileId===filter.profileId)&&(!filter.runId||value.runId===filter.runId)&&(!filter.sessionId||value.sessionId===filter.sessionId)&&(!filter.from||Date.parse(value.observedAt)>=Date.parse(filter.from))&&(!filter.to||Date.parse(value.observedAt)<=Date.parse(filter.to))).sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt)||Date.parse(a.collectedAt)-Date.parse(b.collectedAt));
  const scopes=new Map<string,UsageObservationV1[]>();for(const record of observations){const key=contentHash(scopeKey(record)),group=scopes.get(key)??[];group.push(record);scopes.set(key,group);}
  const snapshots=new Map<string,UsageObservationV1>();let orderUnproven=false;
  for(const [key,group] of scopes){const candidates=group.filter(record=>record.mode==="snapshot");if(!candidates.length)continue;
   if(group.length>1&&group.some(record=>usageAggregationTime(record)===undefined)){orderUnproven=true;continue;}
   candidates.sort((a,b)=>(usageAggregationTime(a)??0)-(usageAggregationTime(b)??0));const latest=candidates.at(-1)!;
   if(latest.producerOrigin&&group.some(record=>record!==latest&&usageAggregationTime(record)===usageAggregationTime(latest))){orderUnproven=true;continue;}
   snapshots.set(key,latest);
  }
  const groups=new Map<string,{record:UsageObservationV1;metric:UsageObservationV1["metrics"][number]}[]>();for(const record of observations)for(const metric of record.metrics){const key=contentHash({...scopeKey(record),name:metric.name,unit:metric.unit}),entries=groups.get(key)??[];entries.push({record,metric});groups.set(key,entries);}
  const sums=new Map<string,{profileId:string;scope:UsageObservationV1["scope"];name:string;unit:string;value:bigint;period?:UsageObservationV1["period"];producerId?:string}>();
  for(const entries of groups.values()){const first=entries[0]!,latest=snapshots.get(contentHash(scopeKey(first.record))),snapshot=entries.find(entry=>entry.record===latest),deltas=entries.filter(entry=>entry.record.mode==="delta"&&(!latest||usageAggregationTime(entry.record)!>usageAggregationTime(latest)!));if(!snapshot&&!deltas.length)continue;
   const producerId=first.record.producerOrigin?.producerId,key=contentHash({profileId:first.record.profileId,scope:first.record.scope,name:first.metric.name,unit:first.metric.unit,period:first.record.period,producerId}),sum=sums.get(key)??{profileId:first.record.profileId,scope:first.record.scope,name:first.metric.name,unit:first.metric.unit,value:0n,...(first.record.period?{period:first.record.period}:{}),...(producerId?{producerId}:{})};sum.value+=snapshot?amount(snapshot.metric.value):0n;for(const entry of deltas)sum.value+=amount(entry.metric.value);sums.set(key,sum);}
  return {observations,totals:orderUnproven?[]:[...sums.values()].map(value=>({...value,value:decimal(value.value)})),rangeBasis:"observation-time" as const,estimation:{status:"unavailable",reasonCode:orderUnproven?"USAGE_ORDER_UNPROVEN":"BILLING_BASELINE_MISSING"}};
 }
}
