import {decimalAmount,decimalString,type AccountQuotaSnapshot} from "@dispatcher/domain";
import type {CodexProfileConfig} from "./codex.js";
import {readCodexNative,type CodexReadRequest} from "./codex-catalog.js";
import {AdapterContractError} from "./contracts.js";

const invalid=()=>new AdapterContractError("INVALID_ACCOUNT_QUOTA","Native account quota is malformed");
const object=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=="object"||Array.isArray(value))throw invalid();return value as Record<string,unknown>;};
const id=(value:unknown):value is string=>typeof value==="string"&&value.length>0&&value.length<=200&&!Array.from(value).some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127);
/** Port of a499d84 codex-quota; credit decimals retain their original precision. */
export function normalizeCodexQuota(value:unknown,input:{profileId:string;collectedAt:string}):AccountQuotaSnapshot {
 if(!id(input.profileId)||!Number.isFinite(Date.parse(input.collectedAt)))throw invalid();
 const raw=object(value),multi=raw.rateLimitsByLimitId==null?undefined:object(raw.rateLimitsByLimitId);
 const buckets=multi&&Object.keys(multi).length?Object.entries(multi):[["legacy",raw.rateLimits]] as Array<[string,unknown]>;
 if(buckets.length>100)throw invalid();const periods:AccountQuotaSnapshot["periods"]=[],seen=new Set<string>();
 const add=(period:AccountQuotaSnapshot["periods"][number])=>{if(!id(period.id)||seen.has(period.id))throw invalid();seen.add(period.id);periods.push(period);};
 for(const [key,value] of buckets){
  const bucket=object(value),identity=bucket.limitId==null?key:bucket.limitId;if(!id(identity))throw invalid();
  for(const kind of ["primary","secondary"]){
   if(bucket[kind]==null)continue;const window=object(bucket[kind]),used=window.usedPercent,duration=window.windowDurationMins,reset=window.resetsAt;
   if(typeof used!=="number"||!Number.isSafeInteger(used)||used<0||duration!=null&&(!Number.isSafeInteger(duration)||Number(duration)<=0)||reset!=null&&(!Number.isSafeInteger(reset)||Number(reset)<=0||!Number.isFinite(new Date(Number(reset)*1000).getTime())))throw invalid();
   add({id:`${identity}:${kind}`,unit:"percent",used:String(used),remaining:String(Math.max(0,100-used)),total:"100",...(reset!=null?{resetsAt:new Date(Number(reset)*1000).toISOString()}:{}),...(duration!=null?{windowDurationMins:Number(duration)}:{})});
  }
  if(bucket.credits!=null){
   const credits=object(bucket.credits),balance=credits.balance;
   if(credits.unlimited!=null&&typeof credits.unlimited!=="boolean")throw invalid();
   if(balance!=null){if(typeof balance!=="string")throw invalid();try{decimalAmount(balance);}catch{throw invalid();}}
   if(balance!=null||credits.unlimited===true)add({id:`${identity}:credits`,unit:"credits",...(balance!=null?{remaining:decimalString(decimalAmount(balance as string))}:{}),...(credits.unlimited===true?{unlimited:true}:{})});
  }
 }
 return {version:1,profileId:input.profileId,source:"codex-app-server/account/rateLimits/read",collectedAt:input.collectedAt,periods};
}
export async function readCodexQuota(input:{profile:CodexProfileConfig;signal?:AbortSignal;request?:(request:CodexReadRequest)=>Promise<unknown>}):Promise<AccountQuotaSnapshot>{
 const response=await(input.request??readCodexNative)({executable:input.profile.executable??"codex",codexHome:input.profile.codexHome,workspacePath:input.profile.codexHome,method:"account/rateLimits/read",params:{},...(input.signal?{signal:input.signal}:{})});
 return normalizeCodexQuota(response,{profileId:input.profile.id,collectedAt:new Date().toISOString()});
}
