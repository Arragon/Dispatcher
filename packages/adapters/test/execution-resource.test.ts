import {expect,it,vi} from "vitest";
import {DevinAdapter,LocalServiceAdapter,QoderAdapter} from "../src/index.js";
it("does not invent a Devin remaining balance from a configured limit without consumed usage",async()=>{
 const snapshot={sessionId:"native",status:"running",pullRequests:[]};
 const adapter=new DevinAdapter({id:"p",alias:"P",organizationId:"org",credentialRef:"secret://fixture",maxSessionAcu:10},{health:async()=>({ok:true}),create:async()=>snapshot,get:async()=>snapshot,send:async()=>snapshot});
 const session=await adapter.start({runId:"r",workspacePath:"/work"}),usage=await adapter.usage(session.id);
 expect(usage.state).toBe("UNKNOWN");expect(usage.consumed).toBeUndefined();expect(usage.remaining).toBeUndefined();expect(usage.limit).toBe(10);
});
it("retains local-service execution resource facts from status without an extra billing query",async()=>{
 const fetchImpl=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({sessionId:"native",state:"failed",resource:{state:"QUOTA_EXHAUSTED",source:"error",confidence:"high",reason:"native budget exhausted"}})));
 const adapter=new LocalServiceAdapter({id:"p",alias:"P",provider:"workbuddy",baseUrl:"http://fixture.invalid",healthPath:"/health",startPath:"/start",statusPath:"/status/{sessionId}",inputPath:"/input/{sessionId}",cancelPath:"/cancel/{sessionId}",resourcePath:"/billing"},undefined,fetchImpl),session=await adapter.start({runId:"r",workspacePath:"/work"});
 expect((await adapter.status(session.id)).executionResource).toMatchObject({state:"QUOTA_EXHAUSTED",source:"error",reason:"native budget exhausted"});expect(fetchImpl).toHaveBeenCalledTimes(2);expect(fetchImpl.mock.calls.some(([url])=>String(url).endsWith("/billing"))).toBe(false);
});
it("retains Qoder's observed execution failure separately from optional telemetry",async()=>{
 const adapter=new QoderAdapter({id:"p",alias:"P"},{start:()=>({status:()=>"completed",cancel:async()=>{},result:async()=>({state:"failed",summary:"quota",events:[{type:"resource",state:"QUOTA_EXHAUSTED",source:"error",confidence:"high",reason:"quota"}]})})}),session=await adapter.start({runId:"r",workspacePath:"/work"});
 expect((await adapter.status(session.id)).executionResource).toMatchObject({state:"QUOTA_EXHAUSTED",source:"error"});
});
