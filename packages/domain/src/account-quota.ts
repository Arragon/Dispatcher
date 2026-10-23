import {decimalAmount,decimalString} from "./decimal.js";
/** Account periods are independent of Run usage, billing and execution resources. */
export interface AccountQuotaSnapshot {
 version:1;profileId:string;source:string;collectedAt:string;
 periods:Array<{id:string;unit:string;used?:string;remaining?:string;total?:string;startsAt?:string;resetsAt?:string;windowDurationMins?:number;unlimited?:boolean}>;
}
export interface AccountQuotaState {
 profileId:string;status:"fresh"|"stale"|"error"|"unsupported"|"missing";
 contextFingerprint?:string;sourceContextFingerprint?:string;snapshot?:AccountQuotaSnapshot;checkedAt?:string;lastSuccessAt?:string;
 reasonCode?:string;error?:{code:string};
}
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
const text=(value:unknown):value is string=>typeof value==="string"&&value.length>0&&value.length<=240&&!Array.from(value).some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127);
const time=(value:unknown):value is string=>typeof value==="string"&&/^\d{4}-\d{2}-\d{2}T/u.test(value)&&/(?:Z|[+-]\d{2}:\d{2})$/u.test(value)&&Number.isFinite(Date.parse(value));
const keys=(value:Record<string,unknown>,allowed:string[])=>Object.keys(value).every(key=>allowed.includes(key));
const code=(value:unknown):value is string=>typeof value==="string"&&/^[A-Z][A-Z0-9_]{0,99}$/u.test(value);
const invalid=():never=>{throw Error("INVALID_ACCOUNT_QUOTA");};
/** Only normalized public DTOs cross an owner boundary; raw provider fields are rejected. */
export function captureAccountQuotaSnapshot(value:unknown,profileId:string):AccountQuotaSnapshot {
 if(!object(value)||!keys(value,["version","profileId","source","collectedAt","periods"])||value.version!==1||value.profileId!==profileId||!text(value.source)||!time(value.collectedAt)||!Array.isArray(value.periods)||value.periods.length>300)return invalid();
 const ids=new Set<string>();
 const periods=value.periods.map(period=>{
  if(!object(period)||!keys(period,["id","unit","used","remaining","total","startsAt","resetsAt","windowDurationMins","unlimited"])||!text(period.id)||!text(period.unit)||ids.has(period.id)||period.startsAt!==undefined&&!time(period.startsAt)||period.resetsAt!==undefined&&!time(period.resetsAt)||period.windowDurationMins!==undefined&&(!Number.isSafeInteger(period.windowDurationMins)||Number(period.windowDurationMins)<=0)||period.unlimited!==undefined&&typeof period.unlimited!=="boolean")return invalid();
  if(period.startsAt&&period.resetsAt&&Date.parse(period.startsAt as string)>Date.parse(period.resetsAt as string))return invalid();ids.add(period.id);
  const captured=structuredClone(period) as unknown as AccountQuotaSnapshot["periods"][number];
  for(const key of ["used","remaining","total"] as const)if(period[key]!==undefined){try{if(typeof period[key]!=="string")return invalid();captured[key]=decimalString(decimalAmount(period[key] as string));}catch{return invalid();}}
  return captured;
 });
 return {version:1,profileId,source:value.source,collectedAt:value.collectedAt,periods};
}
export function captureAccountQuotaState(value:unknown,profileId:string):AccountQuotaState {
 if(!object(value)||!keys(value,["profileId","status","contextFingerprint","sourceContextFingerprint","snapshot","checkedAt","lastSuccessAt","reasonCode","error"])||value.profileId!==profileId||!["fresh","stale","error","unsupported","missing"].includes(String(value.status))||value.contextFingerprint!==undefined&&!text(value.contextFingerprint)||value.sourceContextFingerprint!==undefined&&!text(value.sourceContextFingerprint)||value.checkedAt!==undefined&&!time(value.checkedAt)||value.lastSuccessAt!==undefined&&!time(value.lastSuccessAt)||value.reasonCode!==undefined&&!code(value.reasonCode)||value.error!==undefined&&(!object(value.error)||!keys(value.error,["code"])||!code(value.error.code)||!["error","stale"].includes(String(value.status)))||value.status==="error"&&value.error===undefined)return invalid();
 if(value.snapshot!==undefined&&(!text(value.contextFingerprint)||!time(value.lastSuccessAt))||value.status==="fresh"&&(value.snapshot===undefined||!text(value.contextFingerprint)||!time(value.checkedAt)||!time(value.lastSuccessAt)))return invalid();
 const captured=structuredClone(value) as unknown as AccountQuotaState;
 if(value.snapshot!==undefined)captured.snapshot=captureAccountQuotaSnapshot(value.snapshot,profileId);
 return captured;
}
