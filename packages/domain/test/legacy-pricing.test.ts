import {expect,it} from "vitest";
import {readLegacyPricingSnapshot,projectLegacyCostValue} from "../src/legacy-pricing.js";
import {estimateCost} from "../src/metering.js";
const record={version:1,id:"legacy-frozen",source:"native/model",collectedAt:"2026-10-07T11:00:00Z",unit:"USD",currency:"USD",rates:{per:1000,input:2,output:4,cacheRead:0.5,includesMultiplier:true},multiplier:10};
const read=(r:unknown=record)=>readLegacyPricingSnapshot({format:"legacy-pricing-snapshot-v1",recordId:"old-run:price",record:r});
it("preserves named source and stored safe decimal representation without claiming current pricing",()=>{
 const original=structuredClone(record),result=read();expect(result).toMatchObject({status:"read-only",reference:{format:"legacy-pricing-snapshot-v1",recordId:"old-run:price"},pricing:{rates:{per:"1000",cacheRead:"0.5"},multiplier:"10"},diagnostics:expect.arrayContaining(["LEGACY_STORED_NUMERIC_PRECISION_ONLY","LEGACY_PRICE_ADMISSION_UNPROVEN"])});expect(result.raw).toEqual(original);expect(record).toEqual(original);
});
it("expands safe exponent representations but refuses unsafe, negative, nonfinite or excessive-precision prices",()=>{
 expect(read({...record,multiplier:1e-7})).toMatchObject({pricing:{multiplier:"0.0000001"}});
 for(const multiplier of [Number.MAX_SAFE_INTEGER+1,NaN,Infinity,-1,1e-19])expect(read({...record,multiplier})).toMatchObject({status:"invalid",diagnostics:["LEGACY_NUMERIC_PRECISION_UNSAFE"]});
 expect(read({...record,rates:{...record.rates,per:0}})).toMatchObject({status:"invalid"});expect(read({...record,collectedAt:"now"})).toMatchObject({status:"invalid"});
 expect(read({...record,rates:{...record.rates,includesMultiplier:"yes"}})).toMatchObject({status:"invalid"});
});
it("keeps omitted rates, multiplier and optional conditions absent instead of filling a current default",()=>{
 const result=read({version:1,id:"free",source:"native/free",collectedAt:record.collectedAt,unit:"credits",free:true,conditions:["allowance"]});expect(result).toMatchObject({status:"read-only",pricing:{free:true,conditions:["allowance"]}});expect(result.pricing).not.toHaveProperty("rates");expect(result.pricing).not.toHaveProperty("multiplier");
});
it("preserves the original cost formula in canonical units without importing legacy events into the ledger",()=>{
 const result=read();if(!result.pricing)throw Error("fixture price invalid");
 const estimate=estimateCost({runId:"r",calculatedAt:record.collectedAt,pricing:result.pricing,observations:[{version:1,eventId:"fixture",profileId:"p",runId:"r",sessionId:"s",generation:2,turnId:"t",scope:"turn",mode:"snapshot",source:"native-event",observedAt:record.collectedAt,collectedAt:record.collectedAt,completeness:"complete",metrics:[{name:"input",value:"100",unit:"tokens"},{name:"cachedInput",value:"70",unit:"tokens",includedIn:"input"},{name:"output",value:"10",unit:"tokens"}]}]});
 expect(estimate.value).toBe("0.135");expect(projectLegacyCostValue(estimate.value!)).toEqual({status:"available",value:0.135,basis:"stored-number-roundtrip"});expect(result.diagnostics).toContain("LEGACY_PRICE_ADMISSION_UNPROVEN");
});
it("refuses an old number projection whenever exact decimal facts would change",()=>{
 for(const value of ["9007199254740993","0.100000000000000001","1.123456789012345678","1e3","-1"])expect(projectLegacyCostValue(value)).toEqual({status:"unavailable",reason:"LEGACY_NUMERIC_PRECISION_UNSAFE"});expect(projectLegacyCostValue("0")).toMatchObject({status:"available",value:0});
});
