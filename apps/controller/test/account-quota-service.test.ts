import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach,expect,it,vi} from "vitest";
import type {AgentAdapter} from "@dispatcher/adapters";
import {ControllerService} from "../src/service.js";
const roots:string[]=[],services:ControllerService[]=[],headers={authorization:"Bearer fixture-owner"};
afterEach(async()=>{for(const service of services.splice(0))await service.stop();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
async function fixture(){
 const root=mkdtempSync(join(tmpdir(),"dispatcher-account-quota-"));roots.push(root);const service=new ControllerService({dataDirectory:join(root,"controller"),ownerToken:"fixture-owner",withRunner:true,backgroundWorker:{enabled:false}});services.push(service);await service.start({listen:false});
 const config=structuredClone(service.configuration.current().config);config.agentProfiles=[{id:"p",alias:"P",provider:"codex",runnerId:"local",settings:{codexHome:root}}];
 const plan=service.configuration.buildPlan(config,"fixture","web");expect((await service.app.inject({headers,method:"POST",url:`/api/config/plans/${plan.id}/apply`,payload:{confirmed:true}})).statusCode).toBe(200);
 const adapter=(service as unknown as {agentAdapters:Map<string,AgentAdapter>}).agentAdapters.get("p")!,snapshot={version:1 as const,profileId:"p",source:"fixture/native-quota",collectedAt:new Date().toISOString(),periods:[{id:"weekly",unit:"percent",remaining:"0"}]},read=vi.spyOn(adapter,"accountQuota").mockResolvedValue(snapshot);
 return {service,read,snapshot};
}
it("exposes cached scoped quota and explicit refresh without changing resources or Run state",async()=>{
 const f=await fixture();const get=()=>f.service.app.inject({headers,url:"/api/agents/profiles/p/quota"});expect((await get()).json()).toMatchObject({quota:{profileId:"p",status:"missing"}});expect(f.read).not.toHaveBeenCalled();
 f.service.database.saveEntity("resource-snapshot","p",{state:"QUOTA_EXHAUSTED"});const response=await f.service.app.inject({headers,method:"POST",url:"/api/agents/profiles/p/quota/refresh",payload:{}});expect(response.statusCode,response.body).toBe(200);expect(response.json()).toMatchObject({quota:{status:"fresh",snapshot:f.snapshot}});await get();expect(f.read).toHaveBeenCalledOnce();expect(f.service.database.getEntity("resource-snapshot","p")).toEqual({state:"QUOTA_EXHAUSTED"});expect(f.service.database.listEntities("run")).toEqual([]);
 expect((await f.service.app.inject({headers,url:"/api/agents/profiles/absent/quota"})).statusCode).toBe(404);expect((await f.service.app.inject({method:"POST",url:"/api/agents/profiles/p/quota/refresh",payload:{}})).statusCode).toBe(401);
});
it("starts quota reads from the worker without waiting for them and fences profile replacement",async()=>{
 const f=await fixture(),ready=Promise.withResolvers<typeof f.snapshot>();f.read.mockReturnValue(ready.promise);await f.service.runBackgroundCycle();await f.service.runBackgroundCycle();expect(f.read).toHaveBeenCalledOnce();
 const config=structuredClone(f.service.configuration.current().config);config.agentProfiles[0]!.settings!.model="different";const plan=f.service.configuration.buildPlan(config,"fixture","web");
 try{const response=await f.service.app.inject({headers,method:"POST",url:`/api/config/plans/${plan.id}/apply`,payload:{confirmed:true}});expect(response.statusCode).toBe(400);expect(response.json().code).toBe("ACTIVE_AGENT_PROFILE");}
 finally{ready.resolve(f.snapshot);}
 await vi.waitFor(async()=>expect((await f.service.app.inject({headers,url:"/api/agents/profiles/p/quota"})).json()).toMatchObject({quota:{status:"fresh"}}));
});
