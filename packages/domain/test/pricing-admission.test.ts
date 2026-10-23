import {expect,it} from "vitest";
import type {AccountModelCatalog,PricingSnapshotV1} from "../src/index.js";
import {admitCatalogPricing,capturePricingSnapshot,samePricingTerms} from "../src/pricing-admission.js";
const at="2026-10-22T12:00:00Z";
const price:PricingSnapshotV1={version:1,id:"native-price-1",source:"native/account-model",collectedAt:at,unit:"credits",rates:{per:"1000",input:"0.1",output:"2",includesMultiplier:true}};
const catalog:AccountModelCatalog={profileId:"p",runnerId:"local",providerId:"codex",backendId:"exec",contextFingerprint:"scope",revision:"v1",fetchedAt:at,freshness:"native-fresh",source:"native-rpc",selectionSupport:"explicit",entries:[{id:"model",displayName:"Model",kind:"model",selectable:true,access:"account-listed",parameterOptions:{reasoningEffort:["low"]},billing:{mode:"metered",pricing:{version:1,basis:"native-account-model",nativeParameters:{reasoningEffort:"low"},snapshot:price}}}]};
it("admits only fresh owning model/parameter price evidence and clones exact decimal facts",()=>{
 const value=admitCatalogPricing(catalog,"model",{reasoningEffort:"low"},at);expect(value).toEqual({status:"available",snapshot:price});if(value.status!=="available")throw Error("price unavailable");value.snapshot.rates!.input="999";expect(catalog.entries[0]!.billing!.pricing!.snapshot.rates!.input).toBe("0.1");
 expect(capturePricingSnapshot({...price,rates:{...price.rates!,input:"0000.1000"}}).rates!.input).toBe("0.1");
});
it("keeps cached, foreign, unmatched, inventory and unknown price sources unavailable",()=>{
 for(const value of [{...catalog,freshness:"native-cache" as const},{...catalog,failure:{code:"READ_FAILED",message:"read unavailable"}},{...catalog,entries:[{...catalog.entries[0]!,billing:{mode:"unknown" as const}}]}])expect(admitCatalogPricing(value,"model",{reasoningEffort:"low"},at).status).toBe("unavailable");
 expect(admitCatalogPricing(catalog,"another-model",{reasoningEffort:"low"},at)).toMatchObject({status:"unavailable"});expect(admitCatalogPricing(catalog,"model",{},at)).toMatchObject({reasonCode:"PRICE_PARAMETERS_UNPROVEN"});
 const entry=catalog.entries[0]!,billing=entry.billing!;expect(admitCatalogPricing({...catalog,entries:[{...entry,billing:{...billing,pricing:{...billing.pricing!,basis:"inventory" as never}}} ]},"model",{reasoningEffort:"low"},at)).toMatchObject({status:"unavailable"});
});
it("rejects private/unknown fields, unsafe decimals, future and expired quotes",()=>{
 for(const invalid of [{...price,privatePayload:{credential:"private"}},{...price,rates:{...price.rates!,rawRate:123}},{...price,rates:{...price.rates!,input:0.1}},{...price,rates:{...price.rates!,per:"0"}}])expect(()=>capturePricingSnapshot(invalid)).toThrow();
 for(const patch of [{collectedAt:"2026-10-22T12:01:00Z"},{validUntil:at},{validFrom:"2026-10-23T00:00:00Z"}]){const value=structuredClone(catalog);value.entries[0]!.billing!.pricing!.snapshot={...price,...patch};expect(admitCatalogPricing(value,"model",{reasoningEffort:"low"},at).status).toBe("unavailable");}
});
it("compares terms independently of a later collection timestamp while retaining rate changes",()=>{
 expect(samePricingTerms(price,{...price,collectedAt:"2026-10-22T12:01:00Z"})).toBe(true);expect(samePricingTerms(price,{...price,rates:{...price.rates!,input:"0.2"}})).toBe(false);expect(samePricingTerms(price,{...price,id:"another-price"})).toBe(false);
});
