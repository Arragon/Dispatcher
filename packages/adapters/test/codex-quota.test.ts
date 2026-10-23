import {expect,it,vi} from "vitest";
import {normalizeCodexQuota,readCodexQuota} from "../src/codex-quota.js";

it("preserves independent native windows, real zero and exact credit balances",()=>{
 const value=normalizeCodexQuota({rateLimits:{primary:{usedPercent:99}},rateLimitsByLimitId:{codex:{primary:{usedPercent:0,windowDurationMins:10080,resetsAt:1791958568},secondary:null,credits:{hasCredits:true,unlimited:false,balance:"12345678901234567890.000000000000000001"}},other:{primary:{usedPercent:25},secondary:null}}},{profileId:"p",collectedAt:"2026-10-22T12:00:00Z"});
 expect(value.periods).toEqual([{id:"codex:primary",unit:"percent",used:"0",remaining:"100",total:"100",windowDurationMins:10080,resetsAt:expect.any(String)},{id:"codex:credits",unit:"credits",remaining:"12345678901234567890.000000000000000001"},{id:"other:primary",unit:"percent",used:"25",remaining:"75",total:"100"}]);
 expect(value).not.toHaveProperty("runId");expect(value.periods[0]).not.toHaveProperty("startsAt");
 expect(normalizeCodexQuota({rateLimits:{primary:null,secondary:null,credits:{balance:null}}},{profileId:"p",collectedAt:"2026-10-22T12:00:00Z"}).periods).toEqual([]);
});
it("rejects malformed native quota and duplicate identities instead of inventing zero",()=>{
 for(const usedPercent of [-1,"9",NaN,1.5])expect(()=>normalizeCodexQuota({rateLimits:{primary:{usedPercent}}},{profileId:"p",collectedAt:"2026-10-22T12:00:00Z"})).toThrow();
 for(const balance of ["-1","1e3","0.0000000000000000001",1])expect(()=>normalizeCodexQuota({rateLimits:{credits:{balance}}},{profileId:"p",collectedAt:"2026-10-22T12:00:00Z"})).toThrow();
 expect(()=>normalizeCodexQuota({rateLimitsByLimitId:{a:{limitId:"same",primary:{usedPercent:1}},b:{limitId:"same",primary:{usedPercent:2}}}},{profileId:"p",collectedAt:"2026-10-22T12:00:00Z"})).toThrow();
 expect(normalizeCodexQuota({rateLimits:{primary:{usedPercent:101,windowDurationMins:null,resetsAt:null}}},{profileId:"p",collectedAt:"2026-10-22T12:00:00Z"}).periods).toEqual([{id:"legacy:primary",unit:"percent",used:"101",remaining:"0",total:"100"}]);
});
it("queries the existing read-only account connection and forwards cancellation",async()=>{
 const request=vi.fn().mockResolvedValue({rateLimits:{primary:null,secondary:null}}),abort=new AbortController();
 await readCodexQuota({profile:{id:"p",alias:"P",codexHome:"/fixture/account",executable:"/fixture/codex"},request,signal:abort.signal});
 expect(request).toHaveBeenCalledExactlyOnceWith({executable:"/fixture/codex",codexHome:"/fixture/account",workspacePath:"/fixture/account",method:"account/rateLimits/read",params:{},signal:abort.signal});
});
