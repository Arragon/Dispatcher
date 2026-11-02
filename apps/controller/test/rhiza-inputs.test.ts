import {afterEach,expect,it,vi} from "vitest";
import {InteractionStore,RhizaCommandStore,RhizaObservationStore,type JsonValue} from "@dispatcher/persistence";
import {RhizaInputs} from "../src/rhiza-inputs.js";
import type {RunInputIdentity} from "../src/run-inputs.js";
import type {ControlPrincipal} from "../src/control-auth.js";
import {rhizaReadJobFixture} from "./fixtures/rhiza-read-job.js";
import {clientToken} from "./fixtures/rhiza-service.js";
import {rhizaDigest} from "../src/rhiza-semantics.js";
const fixtures:Awaited<ReturnType<typeof rhizaReadJobFixture>>[]=[];
afterEach(async()=>{for(const f of fixtures.splice(0))await f.close();});
async function setup(){
 const f=await rhizaReadJobFixture();fixtures.push(f);const task=f.service.database.getCanonicalTask<JsonValue>(f.taskId)!;f.service.database.writeCanonicalTask(f.taskId,task.revision,{...(task.document as object),state:"WAITING_USER"});f.run.state="WAITING_USER";f.service.database.saveEntity("run",f.runId,JSON.parse(JSON.stringify(f.run)));f.service.database.saveEntity("session",f.sessionId,{id:f.sessionId,profileId:f.run.profileId});new InteractionStore(f.service.database).initializeControl({sessionId:f.sessionId,activeRunId:f.runId,exclusion:"none",at:f.clock.now.toISOString()});
 const auth=f.service["rhizaAuth"],decision=await auth.authenticate(clientToken,{method:"POST",url:"/api/integrations/rhiza/v1/jobs/j/inputs",routePath:"/api/integrations/rhiza/v1/jobs/:jobId/inputs",protocol:"http",ip:"127.0.0.1",headers:{host:"localhost"}}),principal=(decision as {principal:ControlPrincipal}).principal;
 const scheduled:Array<()=>Promise<void>>=[],receipts=f.service["runInputs"],send=vi.fn(async(_run:unknown,_request:unknown,reservation:{input:RunInputIdentity},guard:()=>void)=>{guard();expect(receipts.read(reservation.input)?.state).toBe("RESERVED");receipts.finish(reservation.input,"ACCEPTED");});
 const options={now:()=>f.clock.now,schedule:(op:()=>Promise<void>)=>{scheduled.push(op);},supports:()=>true,prepare:(run:typeof f.run,request:{requestId:string;input:string},actor:ControlPrincipal)=>({input:{inputId:`rhiza-${request.requestId}`,actorId:actor.id,runId:run.id,profileId:run.profileId,sessionId:run.sessionId,generation:run.generation,authorityHash:"synthetic-episode",payloadHash:rhizaDigest(request.input)},authority:{runId:run.id,generation:run.generation,leaseId:run.leaseId,taskRevision:f.service.database.getCanonicalTask(f.taskId)!.revision}}),send};
 const controls=new RhizaInputs(f.service.database,auth,f.service["rhizaViews"],receipts,options),request={requestId:"input-a",expectedJobRevision:new RhizaObservationStore(f.service.database).head(f.jobId)!.revision,runId:f.runId,generation:f.request.workOrder.origin.generation,runGeneration:f.run.generation,interventionRevision:1,sessionId:f.sessionId,leaseId:f.run.leaseId,taskRevision:f.service.database.getCanonicalTask(f.taskId)!.revision,input:"Continue the same task"};
 return {...f,principal,controls,request,receipts,scheduled,options,send};
}
it("reserves original native input in the same acceptance transaction before send and replays one receipt",async()=>{
 const f=await setup(),receipt=f.controls.accept(f.principal,f.jobId,f.request);expect(receipt).toMatchObject({kind:"input",state:"accepted"});expect(f.send).not.toHaveBeenCalled();expect(f.service.database.listEntities("run-input")).toEqual([expect.objectContaining({state:"RESERVED",actorId:f.principal.id})]);expect(f.controls.accept(f.principal,f.jobId,f.request)).toEqual(receipt);expect(f.scheduled).toHaveLength(1);
 await f.scheduled[0]!();expect(f.send).toHaveBeenCalledTimes(1);expect(new RhizaCommandStore(f.service.database).latest(receipt.commandId)).toMatchObject({state:"confirmed",proof:{kind:"input_accepted"}});expect(()=>f.controls.accept(f.principal,f.jobId,{...f.request,input:"Another message"})).toThrow(expect.objectContaining({code:"IDEMPOTENCY_CONFLICT"}));
});
it.each(["revision","intervention","task","session","lease","generation","terminal"])("rejects stale %s without reserving or sending",async reason=>{
 const f=await setup(),request={...f.request};if(reason==="revision")request.expectedJobRevision++;if(reason==="intervention")request.interventionRevision++;if(reason==="task")request.taskRevision++;if(reason==="session")request.sessionId="foreign";if(reason==="lease")request.leaseId="foreign";if(reason==="generation")request.runGeneration++;if(reason==="terminal"){f.run.state="CANCELLED";f.service.database.saveEntity("run",f.runId,JSON.parse(JSON.stringify(f.run)));}
 expect(()=>f.controls.accept(f.principal,f.jobId,request)).toThrow();expect(f.service.database.listEntities("run-input")).toEqual([]);expect(f.scheduled).toHaveLength(0);
});
it("never adopts or replays an input reservation after restart",async()=>{
 const f=await setup(),receipt=f.controls.accept(f.principal,f.jobId,f.request);new RhizaInputs(f.service.database,f.service["rhizaAuth"],f.service["rhizaViews"],f.receipts,f.options);await f.scheduled[0]!();expect(f.send).not.toHaveBeenCalled();expect(new RhizaCommandStore(f.service.database).latest(receipt.commandId)?.state).toBe("unknown");expect(f.service.database.listEntities("run-input")).toEqual([expect.objectContaining({state:"OUTCOME_UNKNOWN"})]);expect(()=>f.receipts.assertAvailable({runId:f.runId,sessionId:f.sessionId,generation:f.run.generation,authorityHash:"synthetic-episode"})).toThrow();expect(f.controls.accept(f.principal,f.jobId,f.request)).toEqual(receipt);
});
it.each(["revoke","lease","profile","cancel"])("does not send after %s changes while an accepted input waits",async reason=>{
 const f=await setup(),receipt=f.controls.accept(f.principal,f.jobId,f.request);
 if(reason==="revoke")await f.configure(config=>{config.rhizaIngress!.clients[0]!.enabled=false;});
 if(reason==="lease"||reason==="profile"){const run={...f.run,...(reason==="lease"?{leaseId:"changed"}:{profileId:"foreign"})};f.service.database.saveEntity("run",run.id,JSON.parse(JSON.stringify(run)));}
 if(reason==="cancel")new RhizaCommandStore(f.service.database).insert({clientId:"client-a",scope:"jobs.cancel",requestId:"cancel-first",commandId:"cancel-first",jobId:f.jobId,semanticsHash:"a".repeat(64),request:{},receipt:{state:"accepted"},fence:{runId:f.runId}});
 await f.scheduled[0]!();expect(f.send).not.toHaveBeenCalled();expect(new RhizaCommandStore(f.service.database).latest(receipt.commandId)).toMatchObject({state:"confirmed",proof:{kind:"not_sent"}});expect(f.service.database.listEntities("run-input")).toEqual([expect.objectContaining({state:"REJECTED"})]);
});
