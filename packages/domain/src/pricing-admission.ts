import {decimalAmount,decimalString} from "./decimal.js";
import {isPricingSnapshotV1,type PricingSnapshotV1} from "./metering.js";
import type {AccountModelCatalog,NativeModelPricingV1,NativeParameter} from "./publication.js";
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
const keys=(value:Record<string,unknown>,allowed:readonly string[])=>Object.keys(value).every(key=>allowed.includes(key));
const invalid=():never=>{throw Error("PRICE_EVIDENCE_INVALID");};
const stable=(value:unknown):string=>Array.isArray(value)?`[${value.map(stable).join(",")}]`:object(value)?`{${Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`:JSON.stringify(value)??"null";
/** Capture only the public canonical price fields; a provider payload is never an export. */
export function capturePricingSnapshot(value:unknown):PricingSnapshotV1 {
 if(!object(value)||!keys(value,["version","id","source","collectedAt","validFrom","validUntil","unit","currency","rates","multiplier","free","conditions"])||!isPricingSnapshotV1(value))return invalid();
 if(value.rates!==undefined&&(!object(value.rates)||!keys(value.rates,["per","input","output","cacheRead","cacheWrite","includesMultiplier"])))return invalid();
 if(value.conditions&&new Set(value.conditions).size!==value.conditions.length)return invalid();
 const captured=structuredClone(value) as unknown as PricingSnapshotV1;
 if(captured.multiplier!==undefined)captured.multiplier=decimalString(decimalAmount(captured.multiplier));
 if(captured.rates)for(const key of ["per","input","output","cacheRead","cacheWrite"] as const)if(captured.rates[key]!==undefined)captured.rates[key]=decimalString(decimalAmount(captured.rates[key]!));
 return captured;
}
export function isNativeModelPricingV1(value:unknown):value is NativeModelPricingV1 {
 if(!object(value)||!keys(value,["version","basis","nativeParameters","snapshot"])||value.version!==1||value.basis!=="native-account-model"||!object(value.nativeParameters)||Object.keys(value.nativeParameters).length>20||Object.entries(value.nativeParameters).some(([key,v])=>!key||key.length>100||!(typeof v==="string"&&v.length<=240||typeof v==="number"&&Number.isFinite(v)||typeof v==="boolean")))return false;
 try{capturePricingSnapshot(value.snapshot);return true;}catch{return false;}
}
export function admitCatalogPricing(catalog:AccountModelCatalog,modelId:string,nativeParameters:Record<string,NativeParameter>,at:string):{status:"available";snapshot:PricingSnapshotV1}|{status:"unavailable";reasonCode:string}{
 const unavailable=(reasonCode:string)=>({status:"unavailable" as const,reasonCode});
 if(catalog.freshness!=="native-fresh"||catalog.failure||catalog.selectionSupport!=="explicit")return unavailable("PRICE_SOURCE_UNVERIFIED");
 const entry=catalog.entries.find(entry=>entry.id===modelId);
 if(!entry?.selectable||entry.kind!=="model"||entry.access==="denied"||entry.billing?.mode==="unknown"||!entry.billing?.pricing)return unavailable("PRICE_NOT_PROVIDED");
 if(!isNativeModelPricingV1(entry.billing.pricing))return unavailable("PRICE_EVIDENCE_INVALID");
 if(stable(entry.billing.pricing.nativeParameters)!==stable(nativeParameters)||Object.entries(nativeParameters).some(([key,value])=>!entry.parameterOptions[key]?.includes(value)))return unavailable("PRICE_PARAMETERS_UNPROVEN");
 const snapshot=capturePricingSnapshot(entry.billing.pricing.snapshot),when=Date.parse(at);
 if(!Number.isFinite(when)||Date.parse(snapshot.collectedAt)>when||snapshot.validFrom&&Date.parse(snapshot.validFrom)>when||snapshot.validUntil&&Date.parse(snapshot.validUntil)<=when)return unavailable("PRICE_OUTSIDE_VALIDITY");
 return {status:"available",snapshot};
}
export function samePricingTerms(a:PricingSnapshotV1,b:PricingSnapshotV1):boolean {
 try{const withoutTime=(value:PricingSnapshotV1)=>{const copy=capturePricingSnapshot(value);delete(copy as Partial<PricingSnapshotV1>).collectedAt;return stable(copy);};return withoutTime(a)===withoutTime(b);}catch{return false;}
}
