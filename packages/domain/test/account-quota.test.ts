import {expect,it} from "vitest";
import {captureAccountQuotaSnapshot,captureAccountQuotaState} from "../src/account-quota.js";
const at="2026-10-22T12:00:00Z",snapshot={version:1,profileId:"p",source:"native/quota",collectedAt:at,periods:[{id:"credits",unit:"credits",remaining:"9007199254740993.123456789012345678"},{id:"week",unit:"percent",remaining:"0"}]};
it("captures only exact public account quantities and independent owner freshness",()=>{
 const input={profileId:"p",status:"fresh",contextFingerprint:"owner-context",snapshot:structuredClone(snapshot),checkedAt:at,lastSuccessAt:at};
 const result=captureAccountQuotaState(input,"p");expect(result).toEqual(input);input.snapshot.periods[0]!.remaining="999";expect(result.snapshot?.periods[0]?.remaining).toBe("9007199254740993.123456789012345678");
 expect(captureAccountQuotaSnapshot({...snapshot,periods:[{id:"zero",unit:"credits",remaining:"0.000"}]},"p").periods[0]?.remaining).toBe("0");
});
it("rejects private, foreign, imprecise and internally unqualified quota projections",()=>{
 const fresh={profileId:"p",status:"fresh",contextFingerprint:"owner-context",snapshot,checkedAt:at,lastSuccessAt:at};
 for(const input of [{...fresh,apiKey:"private"},{...fresh,profileId:"foreign"},{...fresh,snapshot:{...snapshot,periods:[{id:"week",unit:"percent",remaining:0}]}},{...fresh,snapshot:{...snapshot,apiKey:"private"}},{...fresh,snapshot:{...snapshot,periods:[{id:"week",unit:"percent",remaining:"0",privatePath:"/private"}]}},{...fresh,lastSuccessAt:undefined},{...fresh,snapshot:undefined},{...fresh,status:"guessed"},{...fresh,error:{code:"secret detail"}}])expect(()=>captureAccountQuotaState(input,"p")).toThrow("INVALID_ACCOUNT_QUOTA");
 expect(captureAccountQuotaState({profileId:"p",status:"stale",reasonCode:"QUOTA_CONTEXT_CHANGED"},"p")).toEqual({profileId:"p",status:"stale",reasonCode:"QUOTA_CONTEXT_CHANGED"});
});
it("preserves a failed last read when its retained native period subsequently expires",()=>{
 const state={profileId:"p",status:"stale",contextFingerprint:"owner",snapshot:{...snapshot,periods:[{id:"week",unit:"percent",remaining:"0",resetsAt:"2026-10-22T12:01:00Z"}]},checkedAt:at,lastSuccessAt:at,reasonCode:"QUOTA_PERIOD_RESET",error:{code:"QUOTA_QUERY_FAILED"}};expect(captureAccountQuotaState(state,"p")).toEqual(state);
});
