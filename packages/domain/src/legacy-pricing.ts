import {decimalAmount,storedNumberDecimal} from "./decimal.js";
import {isPricingSnapshotV1,type PricingSnapshotV1} from "./metering.js";
export interface LegacyPricingRead {
 status:"read-only"|"invalid";reference:{format:"legacy-pricing-snapshot-v1";recordId:string};pricing?:PricingSnapshotV1;
 /** Private historical evidence, never copy raw records into public projections. */
 raw?:unknown;diagnostics:string[];
}
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
const text=(value:unknown):value is string=>typeof value==="string"&&value.length>0&&value.length<=500&&!Array.from(value).some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127);
export function readLegacyPricingSnapshot(input:{format:"legacy-pricing-snapshot-v1";recordId:string;record:unknown}):LegacyPricingRead {
 const reference={format:input.format,recordId:input.recordId};let raw:unknown;
 try{raw=structuredClone(input.record);}catch{return {status:"invalid",reference,diagnostics:["LEGACY_RECORD_UNREADABLE"]};}
 const invalid=(code:string):LegacyPricingRead=>({status:"invalid",reference,raw,diagnostics:[code]});
 if(input.format!=="legacy-pricing-snapshot-v1"||!text(input.recordId))return invalid("LEGACY_SOURCE_FORMAT_REQUIRED");
 if(!object(raw))return invalid("LEGACY_PRICE_INVALID");
 const numeric=(value:unknown):string=>{const decimal=storedNumberDecimal(value);if(decimal===undefined)throw Error("LEGACY_NUMERIC_PRECISION_UNSAFE");return decimal;};
 try{
  const price:Record<string,unknown>=Object.fromEntries(["version","id","source","collectedAt","validUntil","unit","currency","free","conditions"].filter(k=>raw[k]!==undefined).map(k=>[k,raw[k]]));
  if(raw.multiplier!==undefined)price.multiplier=numeric(raw.multiplier);
  if(raw.rates!==undefined){if(!object(raw.rates))return invalid("LEGACY_PRICE_INVALID");const rates=raw.rates;price.rates={per:numeric(rates.per),includesMultiplier:rates.includesMultiplier,...Object.fromEntries(["input","output","cacheRead","cacheWrite"].filter(k=>rates[k]!==undefined).map(k=>[k,numeric(rates[k])]))};}
  if(!isPricingSnapshotV1(price))return invalid("LEGACY_PRICE_INVALID");
  return {status:"read-only",reference,raw,pricing:price,diagnostics:["LEGACY_STORED_NUMERIC_PRECISION_ONLY","LEGACY_PRICE_ADMISSION_UNPROVEN"]};
 }catch{return invalid("LEGACY_NUMERIC_PRECISION_UNSAFE");}
}
/** Only compatibility consumers may request this; canonical storage retains the string. */
export function projectLegacyCostValue(value:string):{status:"available";value:number;basis:"stored-number-roundtrip"}|{status:"unavailable";reason:"LEGACY_NUMERIC_PRECISION_UNSAFE"} {
 try{const n=Number(value),stored=storedNumberDecimal(n);if(stored!==undefined&&decimalAmount(stored)===decimalAmount(value))return {status:"available",value:n,basis:"stored-number-roundtrip"};}catch{/* Invalid or out-of-range decimals have no old numeric projection. */}
 return {status:"unavailable",reason:"LEGACY_NUMERIC_PRECISION_UNSAFE"};
}
