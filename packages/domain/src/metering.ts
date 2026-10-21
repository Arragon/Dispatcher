import type {UsageObservationV1} from "./usage.js";
import {DECIMAL_SCALE,decimalAmount,decimalString} from "./decimal.js";

/** Explicit price evidence; quantities and rates never pass through JS number. */
export interface PricingSnapshotV1 {
 version:1;id:string;source:string;collectedAt:string;validFrom?:string;validUntil?:string;unit:string;currency?:string;
 rates?:{per:string;input?:string;output?:string;cacheRead?:string;cacheWrite?:string;includesMultiplier:boolean};
 multiplier?:string;free?:boolean;conditions?:string[];
}
export interface BillingTimeEvidence {eventId:string;profileId:string;sessionId:string;occurredAt:string;source:string}
export interface CacheInclusionEvidence {eventId:string;profileId:string;sessionId:string;metric:"cachedInput"|"cacheWrite";includedInInput:boolean;source:string}
export interface PricingInterval {startsAt:string;endsAt?:string;source:string;pricing:PricingSnapshotV1}
export interface CostEstimateInput {
 runId:string;observations:readonly UsageObservationV1[];pricing?:PricingSnapshotV1;calculatedAt:string;
 conditionEvidence?:Array<{condition:string;source:string;collectedAt:string}>;billingTimes?:BillingTimeEvidence[];cacheInclusion?:CacheInclusionEvidence[];segments?:PricingInterval[];
}
export interface CostEstimateV1 {
 version:1;runId:string;formulaVersion:"native-usage-decimal-v1";scope:"turn"|"run";collectedAt:string;
 pricingSnapshot?:PricingSnapshotV1;inputs:UsageObservationV1[];completeness:"complete"|"partial"|"unavailable";unit:string;currency?:string;
 value?:string;reason?:string;missingDimensions?:string[];rounding:{scale:18;mode:"half-up";applied:boolean};
 conditionEvidence?:CostEstimateInput["conditionEvidence"];billingTimes?:BillingTimeEvidence[];cacheInclusion?:CacheInclusionEvidence[];
 segments?:Array<{startsAt:string;endsAt?:string;source:string;pricingSnapshot:PricingSnapshotV1;eventIds:string[];value:string}>;
}
const dimensions=["input","output","cacheRead","cacheWrite"] as const;
const names={input:"input",output:"output",cacheRead:"cachedInput",cacheWrite:"cacheWrite"} as const;
const text=(v:unknown):v is string=>typeof v==="string"&&v.length>0&&v.length<=500&&!Array.from(v).some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127);
const time=(v:unknown):v is string=>text(v)&&/^\d{4}-\d{2}-\d{2}T/u.test(v)&&/(?:Z|[+-]\d{2}:\d{2})$/u.test(v)&&Number.isFinite(Date.parse(v));
function fail(code:string):never {throw Error(code);}
const identity=(v:UsageObservationV1|BillingTimeEvidence|CacheInclusionEvidence)=>JSON.stringify([v.profileId,v.sessionId,v.eventId]);
function stable(v:unknown):string {if(Array.isArray(v))return `[${v.map(stable).join(",")}]`;if(v&&typeof v==="object")return `{${Object.entries(v).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;return JSON.stringify(v)??"null";}
function effective(input:CostEstimateInput):{values:UsageObservationV1[];partial:boolean}{
 if(!text(input.runId)||!time(input.calculatedAt)||input.observations.length>1000)fail("USAGE_INVALID");
 const events=new Map<string,UsageObservationV1>();
 for(const value of input.observations){
  if(value.scope==="session"||value.scope==="account-period")continue;
  if(value.version!==1||value.runId!==input.runId||!text(value.profileId)||!text(value.sessionId)||!text(value.eventId)||!time(value.observedAt)||!time(value.collectedAt)||!Number.isSafeInteger(value.generation)||value.generation!<1||!["turn","run"].includes(value.scope)||!["delta","snapshot"].includes(value.mode)||!["native-event","native-query","native-result"].includes(value.source)||!["complete","partial","unknown"].includes(value.completeness)||value.scope==="turn"&&!text(value.turnId)||value.mode==="delta"&&!text(value.turnId)||!Array.isArray(value.metrics)||value.metrics.length>64)fail("USAGE_INVALID");
  if(new Set(value.metrics.map(m=>m.name)).size!==value.metrics.length)fail("USAGE_INVALID");
  for(const metric of value.metrics){
   if(!text(metric.name)||!text(metric.unit)||typeof metric.value!=="string")fail("USAGE_INVALID");try{decimalAmount(metric.value);}catch{fail("USAGE_INVALID");}
   if(metric.includedIn!==undefined){const parent=value.metrics.find(m=>m.name===metric.includedIn);if(!parent||parent===metric||parent.unit!==metric.unit||decimalAmount(metric.value)>decimalAmount(parent.value))fail("USAGE_INVALID");const seen=new Set([metric.name]);let next=parent!;while(next.includedIn){if(seen.has(next.name))fail("USAGE_INVALID");seen.add(next.name);const p=value.metrics.find(m=>m.name===next.includedIn);if(!p)fail("USAGE_INVALID");next=p!;}}
  }
  const key=identity(value),prior=events.get(key);if(prior&&stable({...prior,collectedAt:undefined})!==stable({...value,collectedAt:undefined}))fail("EVENT_ID_CONFLICT");events.set(key,value);
 }
 const records=[...events.values()];if(new Set(records.map(v=>stable([v.profileId,v.sessionId,v.generation,v.source]))).size>1)fail("USAGE_BASIS_AMBIGUOUS");
 const hasRun=records.some(v=>v.scope==="run");let partial=hasRun&&records.some(v=>v.scope==="turn");
 const groups=new Map<string,UsageObservationV1[]>();for(const v of records){if(hasRun&&v.scope==="turn")continue;const k=stable([v.scope,v.scope==="turn"?v.turnId:undefined]);groups.set(k,[...(groups.get(k)??[]),v]);}
 const values:UsageObservationV1[]=[];
 for(const group of groups.values()){
  const snapshots=group.filter(v=>v.mode==="snapshot").sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt));const latest=snapshots[0];
  if(latest&&snapshots.some(v=>v!==latest&&Date.parse(v.observedAt)===Date.parse(latest.observedAt)))fail("SNAPSHOT_ORDER_AMBIGUOUS");
  if(latest)values.push(latest);for(const v of group.filter(v=>v.mode==="delta")){if(!latest||Date.parse(v.observedAt)>Date.parse(latest.observedAt))values.push(v);else partial=true;}
 }
 return {values:values.sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt)||identity(a).localeCompare(identity(b))),partial};
}
type Fraction={n:bigint;d:bigint};
const gcd=(a:bigint,b:bigint):bigint=>{while(b){[a,b]=[b,a%b];}return a;};
const fraction=(n:bigint,d:bigint):Fraction=>{const g=gcd(n,d);return {n:n/g,d:d/g};};
const add=(a:Fraction,b:Fraction)=>fraction(a.n*b.d+b.n*a.d,a.d*b.d);
const rounded=(v:Fraction)=>{const scaled=v.n*DECIMAL_SCALE,remainder=scaled%v.d;return {value:decimalString(scaled/v.d+(2n*remainder>=v.d?1n:0n)),applied:remainder!==0n};};
function validPrice(p:PricingSnapshotV1):void {
 if(!p||p.version!==1||![p.id,p.source,p.unit].every(text)||!time(p.collectedAt)||p.currency!==undefined&&!text(p.currency)||p.validFrom!==undefined&&!time(p.validFrom)||p.validUntil!==undefined&&!time(p.validUntil)||p.validFrom&&p.validUntil&&Date.parse(p.validFrom)>=Date.parse(p.validUntil)||p.free!==undefined&&typeof p.free!=="boolean"||p.conditions!==undefined&&(!Array.isArray(p.conditions)||p.conditions.length>64||!p.conditions.every(text)))fail("INVALID_PRICE");
 try{if(p.multiplier!==undefined)decimalAmount(p.multiplier);if(p.rates){if(typeof p.rates.includesMultiplier!=="boolean"||decimalAmount(p.rates.per)===0n)fail("INVALID_PRICE");for(const k of dimensions)if(p.rates[k]!==undefined)decimalAmount(p.rates[k]!);}}catch{fail("INVALID_PRICE");}
}
/** Valid shape only; callers still need authoritative account/model/rate evidence. */
export function isPricingSnapshotV1(value:unknown):value is PricingSnapshotV1 {try{validPrice(value as PricingSnapshotV1);return true;}catch{return false;}}
function billingTime(input:CostEstimateInput,v:UsageObservationV1):number|undefined {
 const matches=(input.billingTimes??[]).filter(t=>identity(t)===identity(v));if(!matches.length)return;
 if(matches.some(t=>!text(t.source)||!time(t.occurredAt))||new Set(matches.map(t=>Date.parse(t.occurredAt))).size!==1)fail("PRICE_TIME_UNPROVEN");return Date.parse(matches[0]!.occurredAt);
}
function calculate(input:CostEstimateInput,values:UsageObservationV1[],p:PricingSnapshotV1):{total:Fraction;missing:Set<string>} {
 validPrice(p);
 if(p.conditions?.some(condition=>!input.conditionEvidence?.some(e=>e.condition===condition&&text(e.source)&&time(e.collectedAt))))fail("CONDITIONS_UNCONFIRMED");
 if(p.validFrom||p.validUntil)for(const v of values){const t=billingTime(input,v);if(t===undefined)fail("PRICE_TIME_UNPROVEN");if(p.validFrom&&t!<Date.parse(p.validFrom)||p.validUntil&&t!>=Date.parse(p.validUntil))fail("PRICE_OUTSIDE_VALIDITY");}
 let total:Fraction={n:0n,d:1n};const missing=new Set<string>();if(p.free===true)return {total,missing};
 if(!p.rates){
  if(values.some(v=>!v.metrics.some(m=>m.name==="baseConsumption"&&m.unit===p.unit&&m.includedIn===undefined)))fail("BILLING_BASIS_NOT_PROVIDED");
  if(p.multiplier===undefined)fail("MULTIPLIER_NOT_PROVIDED");for(const v of values){const q=v.metrics.find(m=>m.name==="baseConsumption")!;total=add(total,fraction(decimalAmount(q.value)*decimalAmount(p.multiplier),DECIMAL_SCALE**2n));}return {total,missing};
 }
 const rates=p.rates;if(!rates.includesMultiplier&&p.multiplier===undefined)fail("MULTIPLIER_NOT_PROVIDED");const multiplier=rates.includesMultiplier?DECIMAL_SCALE:decimalAmount(p.multiplier!);let known=0;
 for(const v of values){
  const read=(name:string)=>v.metrics.find(m=>m.name===name);const cache=read("cachedInput");
  if(v.metrics.some(m=>Object.values(names).includes(m.name as typeof names[keyof typeof names])&&m.unit!=="tokens"))fail("USAGE_UNIT_MISMATCH");
  if(cache&&rates.cacheRead!==undefined&&cache.includedIn!=="input"&&cache.includedIn!==undefined)fail("CACHE_INCLUSION_UNCONFIRMED");
  const inclusion=(metric:UsageObservationV1["metrics"][number]|undefined):boolean|undefined=>{
   const proof=(input.cacheInclusion??[]).filter(e=>identity(e)===identity(v)&&e.metric===metric?.name);
   if(proof.some(e=>!text(e.source)||typeof e.includedInInput!=="boolean")||new Set(proof.map(e=>e.includedInInput)).size>1||metric?.includedIn==="input"&&proof.some(e=>!e.includedInInput))fail("CACHE_INCLUSION_UNCONFIRMED");
   return metric?.includedIn==="input"?true:proof[0]?.includedInInput;
  };
  const write=read("cacheWrite"),included=inclusion(cache),writeIncluded=inclusion(write);
  if(cache&&rates.cacheRead!==undefined&&included===undefined||write&&rates.cacheWrite!==undefined&&writeIncluded===undefined)fail("CACHE_INCLUSION_UNCONFIRMED");
  for(const k of dimensions){
   const metric=read(names[k]),rate=rates[k];let quantity=metric?decimalAmount(metric.value):undefined;
   if(k==="input"&&quantity!==undefined){if(rates.cacheRead!==undefined&&cache&&included)quantity-=decimalAmount(cache.value);if(rates.cacheWrite!==undefined&&write&&writeIncluded)quantity-=decimalAmount(write.value);if(quantity<0n)fail("CACHE_EXCEEDS_INPUT");}
   if(k==="input"&&(rates.cacheRead!==undefined&&!cache||rates.cacheWrite!==undefined&&!write)&&quantity!==undefined){quantity=undefined;missing.add("input");}
   if(rate===undefined){if(quantity!==undefined&&quantity>0n&&(k!=="cacheRead"||!included)&&(k!=="cacheWrite"||!writeIncluded))missing.add(`${k}Rate`);continue;}
   if(quantity===undefined){missing.add(k);continue;}known++;total=add(total,fraction(quantity*decimalAmount(rate)*multiplier,DECIMAL_SCALE**2n*decimalAmount(rates.per)));
  }
 }
 if(!known)fail("USAGE_DIMENSIONS_NOT_PROVIDED");return {total,missing};
}
export function estimateCost(input:CostEstimateInput):CostEstimateV1 {
 const base:CostEstimateV1={version:1,runId:input.runId,formulaVersion:"native-usage-decimal-v1",scope:"run",collectedAt:input.calculatedAt,inputs:[],completeness:"unavailable",unit:input.pricing?.unit??"unknown",rounding:{scale:18,mode:"half-up",applied:false},...(input.pricing?{pricingSnapshot:structuredClone(input.pricing)}:{}),...(input.pricing?.currency?{currency:input.pricing.currency}:{}),...(input.conditionEvidence?{conditionEvidence:structuredClone(input.conditionEvidence)}:{}),...(input.billingTimes?{billingTimes:structuredClone(input.billingTimes)}:{}),...(input.cacheInclusion?{cacheInclusion:structuredClone(input.cacheInclusion)}:{})};
 try{
  const selected=effective(input),values=selected.values;base.inputs=structuredClone(values);base.scope=values.every(v=>v.scope==="turn")?"turn":"run";
  if(!input.pricing)fail("PRICE_NOT_PROVIDED");validPrice(input.pricing!);if(!values.length)fail("USAGE_NOT_PROVIDED");
  let total:Fraction={n:0n,d:1n};const missing=new Set<string>();
  if(input.segments?.length){
   if(input.segments.length>64)fail("RATE_INTERVAL_UNMAPPED");const sorted=[...input.segments].sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt));
   for(let i=0;i<sorted.length;i++){const s=sorted[i]!;if(!time(s.startsAt)||s.endsAt!==undefined&&(!time(s.endsAt)||Date.parse(s.endsAt)<=Date.parse(s.startsAt))||!text(s.source)||i>0&&(!sorted[i-1]!.endsAt||Date.parse(sorted[i-1]!.endsAt!)>Date.parse(s.startsAt)))fail("RATE_INTERVAL_UNMAPPED");validPrice(s.pricing);if(s.pricing.unit!==input.pricing!.unit||s.pricing.currency!==input.pricing!.currency)fail("RATE_INTERVAL_BASIS_INCOMPLETE");}
   const mapped=sorted.map(segment=>({segment,values:[] as UsageObservationV1[]}));
   for(const v of values){const at=billingTime(input,v);if(at===undefined)fail("RATE_INTERVAL_UNMAPPED");const matches=mapped.filter(({segment:s})=>at!>=Date.parse(s.startsAt)&&(!s.endsAt||at!<Date.parse(s.endsAt)));if(matches.length!==1)fail("RATE_INTERVAL_UNMAPPED");matches[0]!.values.push(v);}
   base.segments=[];for(const entry of mapped.filter(e=>e.values.length)){const result=calculate(input,entry.values,entry.segment.pricing);total=add(total,result.total);for(const d of result.missing)missing.add(d);base.segments.push({startsAt:entry.segment.startsAt,...(entry.segment.endsAt?{endsAt:entry.segment.endsAt}:{}),source:entry.segment.source,pricingSnapshot:structuredClone(entry.segment.pricing),eventIds:entry.values.map(v=>v.eventId),value:rounded(result.total).value});}
  }else{const result=calculate(input,values,input.pricing!);total=result.total;for(const d of result.missing)missing.add(d);}
  const value=rounded(total);return {...base,value:value.value,rounding:{...base.rounding,applied:value.applied},completeness:base.scope==="run"&&!selected.partial&&values.every(v=>v.completeness==="complete")&&!missing.size?"complete":"partial",...(missing.size?{missingDimensions:[...missing].sort(),reason:"BILLING_DIMENSIONS_INCOMPLETE"}:{})};
 }catch(error){delete base.segments;return {...base,reason:error instanceof Error&&/^[A-Z_]+$/u.test(error.message)?error.message:"BILLING_INPUT_INVALID"};}
}
