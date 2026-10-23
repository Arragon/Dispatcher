import {afterEach,expect,it,vi} from "vitest";
import type {AgentAdapter} from "@dispatcher/adapters";
import {DispatcherDatabase} from "@dispatcher/persistence";
import {AccountQuotas} from "../src/account-quotas.js";

afterEach(()=>vi.useRealTimers());
const at="2026-10-22T12:00:00.000Z",snapshot={version:1 as const,profileId:"p",source:"native/quota",collectedAt:at,periods:[{id:"week",unit:"percent",remaining:"0"},{id:"credits",unit:"credits",remaining:"9007199254740993.123456789012345678"}]};
function fixture(){const database=new DispatcherDatabase(":memory:"),accountQuota=vi.fn(async(signal?:AbortSignal)=>{signal?.throwIfAborted();return structuredClone(snapshot);}),adapter={accountQuota} as unknown as AgentAdapter,adapters=new Map([["p",adapter]]),publish=vi.fn();let context="scope-a",now=new Date(at);const store=new AccountQuotas(database,adapters,()=>context,publish,()=>now);return {database,accountQuota,adapter,adapters,publish,store,scope:(value:string)=>{context=value;},time:(value:string)=>{now=new Date(value);}};}
it("coalesces account reads and preserves exact values independently of resource authority",async()=>{
 const f=fixture(),ready=Promise.withResolvers<typeof snapshot>();f.accountQuota.mockReturnValue(ready.promise);f.database.saveEntity("resource-snapshot","p",{state:"QUOTA_EXHAUSTED"});
 const a=f.store.refresh("p"),b=f.store.refresh("p");ready.resolve(snapshot);await Promise.all([a,b]);expect(f.accountQuota).toHaveBeenCalledOnce();
 expect(f.store.state("p")).toMatchObject({status:"fresh",snapshot,lastSuccessAt:at});expect(f.database.getEntity("resource-snapshot","p")).toEqual({state:"QUOTA_EXHAUSTED"});expect(f.database.listEntities("usage-observation")).toEqual([]);await f.store.close();f.database.close();
});
it("retains the last success on failure, ages source facts and rejects old account callbacks",async()=>{
 const f=fixture();await f.store.refresh("p");f.time("2026-10-22T12:11:00Z");expect(f.store.state("p")).toMatchObject({status:"stale",snapshot,lastSuccessAt:at});
 f.accountQuota.mockRejectedValueOnce(Error("private-account-detail"));await f.store.refresh("p");expect(f.store.state("p")).toMatchObject({status:"error",snapshot,lastSuccessAt:at,error:{code:"QUOTA_QUERY_FAILED"}});expect(JSON.stringify(f.store.state("p"))).not.toContain("private-account-detail");
 const ready=Promise.withResolvers<typeof snapshot>();f.accountQuota.mockReturnValue(ready.promise);const pending=f.store.refresh("p");f.scope("scope-b");ready.resolve({...snapshot,periods:[{id:"week",unit:"percent",remaining:"90"}]});await pending;expect(f.store.state("p")).toMatchObject({status:"stale",reasonCode:"QUOTA_CONTEXT_CHANGED"});expect(f.store.state("p")).not.toHaveProperty("snapshot");f.scope("scope-a");expect(f.store.state("p")).toMatchObject({snapshot});await f.store.close();f.database.close();
});
it("rejects invalid or foreign snapshots atomically and restores saved state after restart",async()=>{
 const f=fixture();await f.store.refresh("p");for(const invalid of [{...snapshot,profileId:"other"},{...snapshot,periods:[{id:"bad",unit:"percent",remaining:0}]},{...snapshot,periods:[...snapshot.periods,snapshot.periods[0]]}]){f.accountQuota.mockResolvedValueOnce(invalid as never);await f.store.refresh("p");expect(f.store.state("p")).toMatchObject({status:"error",snapshot,lastSuccessAt:at});}
 await f.store.close();const restarted=new AccountQuotas(f.database,f.adapters,()=>"scope-a",f.publish,()=>new Date(at));expect(restarted.state("p")).toMatchObject({status:"error",snapshot});await restarted.close();f.database.close();
});
it("keeps timed-out native reads owned and fences shutdown callbacks",async()=>{
 vi.useFakeTimers();const f=fixture(),ready=Promise.withResolvers<typeof snapshot>();f.accountQuota.mockReturnValue(ready.promise);const pending=f.store.refresh("p");await vi.advanceTimersByTimeAsync(31_000);expect(await pending).toMatchObject({status:"error",error:{code:"QUOTA_QUERY_TIMEOUT"}});expect(f.store.hasPending("p")).toBe(true);expect(f.accountQuota.mock.calls[0]?.[0]).toMatchObject({aborted:true});
 await f.store.refresh("p");expect(f.accountQuota).toHaveBeenCalledOnce();const closing=f.store.close().then(()=>undefined,error=>error);await vi.advanceTimersByTimeAsync(3_000);expect(await closing).toMatchObject({code:"QUOTA_CLEANUP_UNKNOWN"});const before=f.database.getEntity("account-quota","p");ready.resolve(snapshot);await vi.advanceTimersByTimeAsync(0);expect(f.database.getEntity("account-quota","p")).toEqual(before);expect(f.store.hasPending("p")).toBe(false);f.database.close();
});
it("collects without a dashboard while getters and unsupported accounts perform no native reads",async()=>{
 const f=fixture();expect(f.store.state("missing")).toMatchObject({status:"unsupported"});expect(f.store.state("p")).toMatchObject({status:"missing"});expect(f.accountQuota).not.toHaveBeenCalled();
 f.store.kick(["p"]);await vi.waitFor(()=>expect(f.store.state("p").status).toBe("fresh"));f.store.kick(["p"]);expect(f.accountQuota).toHaveBeenCalledOnce();await f.store.close();f.database.close();
});
it("expires an observed period at its native reset without inferring a new balance",async()=>{
 const f=fixture();f.accountQuota.mockResolvedValueOnce({...snapshot,periods:[{id:"week",unit:"percent",remaining:"90",resetsAt:"2026-10-22T12:01:00Z"}]});await f.store.refresh("p");f.time("2026-10-22T12:01:00Z");expect(f.store.state("p")).toMatchObject({status:"stale",reasonCode:"QUOTA_PERIOD_RESET",snapshot:{periods:[{remaining:"90"}]}});expect(f.accountQuota).toHaveBeenCalledOnce();await f.store.close();f.database.close();
});
it("keeps native cleanup uncertainty durable after the reader promise rejects",async()=>{
 const f=fixture();f.accountQuota.mockRejectedValueOnce(Object.assign(Error("private native cleanup"),{code:"MODEL_CATALOG_CLEANUP_UNKNOWN"}));
 try{
  expect(await f.store.refresh("p")).toMatchObject({status:"error",error:{code:"QUOTA_CLEANUP_UNKNOWN"}});expect(f.store.hasPending("p")).toBe(true);await f.store.refresh("p");expect(f.accountQuota).toHaveBeenCalledOnce();await expect(f.store.close()).rejects.toMatchObject({code:"QUOTA_CLEANUP_UNKNOWN"});
  const restarted=new AccountQuotas(f.database,f.adapters,()=>"scope-a",f.publish,()=>new Date(at));expect(restarted.hasPending("p")).toBe(true);await restarted.refresh("p");expect(f.accountQuota).toHaveBeenCalledOnce();await expect(restarted.close()).rejects.toMatchObject({code:"QUOTA_CLEANUP_UNKNOWN"});
 }finally{await f.store.close().catch(()=>undefined);f.database.close();}
});
