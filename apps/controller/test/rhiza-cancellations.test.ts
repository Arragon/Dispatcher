import {afterEach,expect,it,vi} from "vitest";
import {RhizaCommandStore,RhizaObservationStore,type JsonValue} from "@dispatcher/persistence";
import {RhizaCancellations} from "../src/rhiza-cancellations.js";
import {rhizaReadJobFixture} from "./fixtures/rhiza-read-job.js";
import {clientToken,clientHeaders} from "./fixtures/rhiza-service.js";
import type {ControlPrincipal} from "../src/control-auth.js";
const fixtures:Awaited<ReturnType<typeof rhizaReadJobFixture>>[]=[];
afterEach(async()=>{for(const f of fixtures.splice(0))await f.close();});
async function setup(){
 const f=await rhizaReadJobFixture();fixtures.push(f);const auth=f.service["rhizaAuth"],decision=await auth.authenticate(clientToken,{method:"POST",url:"/api/integrations/rhiza/v1/jobs/x/cancellations",routePath:"/api/integrations/rhiza/v1/jobs/:jobId/cancellations",protocol:"http",ip:"127.0.0.1",headers:{host:"localhost"}}),principal=(decision as {principal:ControlPrincipal}).principal;
 const scheduled:Array<()=>Promise<void>>=[],stop=vi.fn(async(_run:unknown,_principal:unknown,guard:()=>void)=>{guard();return {kind:"stopped" as const,runId:f.runId,runGeneration:f.run.generation,sessionId:f.sessionId,leaseId:f.run.leaseId};});
 const options={now:()=>f.clock.now,schedule:(op:()=>Promise<void>)=>{scheduled.push(op);},supports:()=>true,stop,cancelUnstarted:vi.fn()};
 const controls=new RhizaCancellations(f.service.database,auth,f.service["rhizaViews"],options),request={requestId:"cancel-a",expectedJobRevision:new RhizaObservationStore(f.service.database).head(f.jobId)!.revision,runId:f.runId,generation:f.request.workOrder.origin.generation,runGeneration:f.run.generation};
 return {...f,principal,controls,request,stop,scheduled,options};
}
it("persists an immutable accepted intent before stop, replays once and records observed stop separately",async()=>{
 const f=await setup(),receipt=f.controls.accept(f.principal,f.jobId,f.request);expect(receipt).toMatchObject({state:"accepted",kind:"cancel",jobId:f.jobId,requestId:"cancel-a"});expect(f.stop).not.toHaveBeenCalled();expect(new RhizaCommandStore(f.service.database).hasCancellation(f.taskId)).toBe(true);
 expect(f.controls.accept(f.principal,f.jobId,f.request)).toEqual(receipt);expect(f.scheduled).toHaveLength(1);await f.scheduled[0]!();expect(f.stop).toHaveBeenCalledTimes(1);expect(new RhizaCommandStore(f.service.database).latest(receipt.commandId)?.state).toBe("confirmed");
 expect(()=>f.controls.accept(f.principal,f.jobId,{...f.request,generation:6})).toThrow(expect.objectContaining({code:"IDEMPOTENCY_CONFLICT"}));expect(f.controls.accept(f.principal,f.jobId,f.request)).toEqual(receipt);
});
it.each(["revision","run","generation","run-generation"])("rejects stale %s before writing intent",async reason=>{
 const f=await setup(),request={...f.request};if(reason==="revision")request.expectedJobRevision++;if(reason==="run")request.runId="foreign";if(reason==="generation")request.generation++;if(reason==="run-generation")request.runGeneration++;
 expect(()=>f.controls.accept(f.principal,f.jobId,request)).toThrow();expect(f.scheduled).toHaveLength(0);expect(new RhizaCommandStore(f.service.database).hasCancellation(f.taskId)).toBe(false);
});
it("retains failed or restarted sends as unknown without resending the native stop",async()=>{
 const f=await setup();f.stop.mockRejectedValueOnce(Error("stop unconfirmed"));const receipt=f.controls.accept(f.principal,f.jobId,f.request);await f.scheduled[0]!();expect(new RhizaCommandStore(f.service.database).latest(receipt.commandId)?.state).toBe("unknown");
 new RhizaCancellations(f.service.database,f.service["rhizaAuth"],f.service["rhizaViews"],f.options);expect(f.controls.accept(f.principal,f.jobId,f.request)).toEqual(receipt);expect(f.stop).toHaveBeenCalledTimes(1);expect(f.scheduled).toHaveLength(1);
});
it("rechecks revocation before delayed native stop and does not manufacture confirmed proof",async()=>{
 const f=await setup(),receipt=f.controls.accept(f.principal,f.jobId,f.request);await f.configure(config=>{config.rhizaIngress!.clients[0]!.enabled=false;});await f.scheduled[0]!();expect(f.stop).not.toHaveBeenCalled();expect(new RhizaCommandStore(f.service.database).latest(receipt.commandId)?.state).toBe("unknown");
});
it("marks an unclaimed receipt unknown on restart and never adopts the original stop",async()=>{
 const f=await setup(),receipt=f.controls.accept(f.principal,f.jobId,f.request);new RhizaCancellations(f.service.database,f.service["rhizaAuth"],f.service["rhizaViews"],f.options);await f.scheduled[0]!();expect(f.stop).not.toHaveBeenCalled();expect(new RhizaCommandStore(f.service.database).latest(receipt.commandId)?.state).toBe("unknown");
});
it.each(["lease","selection","profile","wrong-proof"])("keeps %s drift unconfirmed and never publishes stopped",async reason=>{
 const f=await setup(),receipt=f.controls.accept(f.principal,f.jobId,f.request);
 if(reason==="wrong-proof")f.stop.mockResolvedValueOnce({kind:"stopped",runId:"foreign",runGeneration:f.run.generation,sessionId:f.sessionId,leaseId:f.run.leaseId});
 else {const run={...f.run};if(reason==="lease")run.leaseId="replacement-lease";if(reason==="profile")run.profileId="foreign";
  if(reason==="selection"){
   run.executionSelection={...run.executionSelection!,requestedModel:"foreign"};expect(()=>f.service.database.saveEntity("run",run.id,JSON.parse(JSON.stringify(run)))).toThrow("bound Run");
   // Explicit corruption injection also exercises the final guard; the supported writer already rejects it.
   f.service.database.handle.prepare("UPDATE entities SET document_json=? WHERE kind='run' AND id=?").run(JSON.stringify(run),run.id);
  }else f.service.database.saveEntity("run",run.id,JSON.parse(JSON.stringify(run)));
 }
 await f.scheduled[0]!();expect(new RhizaCommandStore(f.service.database).latest(receipt.commandId)?.state).toBe("unknown");if(reason!=="wrong-proof")expect(f.stop).not.toHaveBeenCalled();
});
it("cancels a queued unsent dispatch atomically and never schedules a native stop",async()=>{
 const f=await setup(),task=f.service.database.getCanonicalTask<JsonValue>(f.taskId)!,document={...(task.document as Record<string,JsonValue>),state:"READY"};delete document.currentRunId;f.service.database.writeCanonicalTask(f.taskId,task.revision,document);
 const job=f.service.database.getEntity<JsonValue>("rhiza-job",f.jobId) as Record<string,JsonValue>;f.service.database.saveEntity("rhiza-job",f.jobId,{...job,dispatch:{state:"pending"}});
 f.options.cancelUnstarted.mockImplementation(()=>{const current=f.service.database.getCanonicalTask<JsonValue>(f.taskId)!;f.service.database.writeCanonicalTask(f.taskId,current.revision,{...(current.document as object),state:"CANCELLED"});});
 const receipt=f.controls.accept(f.principal,f.jobId,{requestId:"queued-cancel",expectedJobRevision:new RhizaObservationStore(f.service.database).head(f.jobId)!.revision,runId:null,generation:f.request.generation});expect(f.scheduled).toHaveLength(0);expect(f.stop).not.toHaveBeenCalled();expect(new RhizaCommandStore(f.service.database).latest(receipt.commandId)).toMatchObject({state:"confirmed",proof:{kind:"not_sent"}});expect(()=>f.service["rhizaJobs"].assertTask(f.taskId)).toThrow(expect.objectContaining({code:"STOP_UNCONFIRMED"}));
 const snapshot=f.service["rhizaViews"].snapshot(f.principal,f.jobId);expect(snapshot).toMatchObject({state:"canceled",processObservation:"not_started",cancellationRequested:true});
});
it("does not accept an unauthorized or malformed cleanup control",async()=>{
 const f=await setup(),url=`/api/integrations/rhiza/v1/jobs/${f.jobId}/cancellations`;
 expect((await f.service.app.inject({method:"POST",url,headers:clientHeaders,payload:{...f.request,ownerToken:"not-a-control-field"}})).statusCode).toBe(400);
 await f.configure(config=>{config.rhizaIngress!.clients[0]!.scopes=["jobs:read"];});expect((await f.service.app.inject({method:"POST",url,headers:clientHeaders,payload:f.request})).statusCode).toBe(403);expect(new RhizaCommandStore(f.service.database).hasCancellation(f.taskId)).toBe(false);
});
it("accepts scoped cleanup cancellation during disable and returns no stopped claim",async()=>{
 const f=await setup();await f.configure(config=>{config.rhizaIngress!.enabled=false;});const url=`/api/integrations/rhiza/v1/jobs/${f.jobId}/cancellations`,response=await f.service.app.inject({method:"POST",url,headers:clientHeaders,payload:f.request});
 expect(response.statusCode,response.body).toBe(202);expect(response.json()).toMatchObject({state:"accepted",kind:"cancel"});expect(response.body).not.toContain("private-context-canary");await f.service["rhizaCancellations"].drain();
 const snapshot=await f.service.app.inject({url:`/api/integrations/rhiza/v1/jobs/${f.jobId}`,headers:clientHeaders});expect(snapshot.json()).toMatchObject({cancellationRequested:true,state:"unknown",processObservation:"unknown"});
 const command=f.service.database.getEntity<JsonValue>("rhiza-job",f.jobId);expect(command).toBeDefined();
});
