import {afterEach,expect,it} from "vitest";
import {ControllerService} from "../src/service.js";
import {join} from "node:path";
import {rhizaReadJobFixture,seedRhizaCandidate} from "./fixtures/rhiza-read-job.js";
import {RhizaArtifactStore,type JsonValue} from "@dispatcher/persistence";
import {clientHeaders,clientToken,grant} from "./fixtures/rhiza-service.js";
const fixtures:Awaited<ReturnType<typeof rhizaReadJobFixture>>[]=[];
afterEach(async()=>{for(const f of fixtures.splice(0))await f.close();});
const open=async(complete=false)=>{const f=await rhizaReadJobFixture(complete);fixtures.push(f);return f;};
const path=(jobId:string)=>`/api/integrations/rhiza/v1/jobs/${jobId}`;
it("reads a scoped snapshot/cursor without leaking Context or implying a process is alive",async()=>{
 const f=await open(),snapshot=await f.service.app.inject({method:"GET",url:path(f.jobId),headers:clientHeaders});
 expect(snapshot.statusCode,snapshot.body).toBe(200);expect(snapshot.json()).toMatchObject({schemaVersion:1,jobId:f.jobId,taskId:f.taskId,state:"running",processObservation:"unknown",runId:f.runId,runGeneration:2,origin:{generation:5},modelEvidence:{status:"configuration_confirmed"}});expect(snapshot.body).not.toContain("private-context-canary");
 const cursor=snapshot.json().cursor;expect(typeof cursor).toBe("string");
 const unchanged=await f.service.app.inject({method:"GET",url:`/api/integrations/rhiza/v1/events?cursor=${cursor}`,headers:clientHeaders});expect(unchanged.statusCode,unchanged.body).toBe(200);expect(unchanged.json()).toMatchObject({schemaVersion:"1",events:[],cursor,hasMore:false});
 f.service.database.saveEntity("run",f.runId,JSON.parse(JSON.stringify({...f.run,state:"WAITING_USER"})));
 const page=await f.service.app.inject({method:"GET",url:`/api/integrations/rhiza/v1/events?cursor=${cursor}`,headers:clientHeaders});expect(page.statusCode,page.body).toBe(200);expect(page.json().events.length).toBeGreaterThan(0);expect(page.json().events[0].revision).toBeGreaterThan(snapshot.json().revision);
 const next=await f.service.app.inject({method:"GET",url:path(f.jobId),headers:clientHeaders});expect(next.json().state).toBe("waiting_input");expect(next.json().allowedOperations).not.toContain("jobs:input");
});
it("retains replay cursors across Controller restart and requires a fresh snapshot after expiry",async()=>{
 const f=await open(),first=await f.service.app.inject({method:"GET",url:path(f.jobId),headers:clientHeaders}),cursor=first.json().cursor;expect(first.statusCode,first.body).toBe(200);await f.service.stop();
 const restarted=new ControllerService({dataDirectory:join(f.root,"controller"),ownerToken:"synthetic-owner-rhiza-test",secretStore:f.secrets,clock:()=>f.clock.now});
 try{await restarted.start({listen:false});const response=await restarted.app.inject({method:"GET",url:`/api/integrations/rhiza/v1/events?cursor=${cursor}`,headers:clientHeaders});expect(response.statusCode,response.body).toBe(200);
  f.clock.now=new Date(f.clock.now.getTime()+86400001);const expired=await restarted.app.inject({method:"GET",url:`/api/integrations/rhiza/v1/events?cursor=${cursor}`,headers:clientHeaders});expect(expired.statusCode,expired.body).toBe(409);expect(expired.json().code).toBe("CURSOR_EXPIRED");
 }finally{await restarted.stop();}
});
it("keeps authorized cleanup reads during disable, but rejects revoked or cross-client authority",async()=>{
 const f=await open(),first=await f.service.app.inject({method:"GET",url:path(f.jobId),headers:clientHeaders});expect(first.statusCode,first.body).toBe(200);
 await f.configure(config=>{config.rhizaIngress!.enabled=false;});expect((await f.service.app.inject({method:"GET",url:path(f.jobId),headers:clientHeaders})).statusCode).toBe(200);
 await f.configure(config=>{config.rhizaIngress!.clients[0]!.enabled=false;});expect((await f.service.app.inject({method:"GET",url:path(f.jobId),headers:clientHeaders})).statusCode).toBe(401);
 await f.configure(config=>{config.rhizaIngress!.enabled=true;config.rhizaIngress!.clients.push({...grant,id:"client-b",credentialRef:"secret://rhiza/client-b"});});
 const token=clientToken.replace(Buffer.from("client-a").toString("base64url"),Buffer.from("client-b").toString("base64url"));await f.secrets.put("secret://rhiza/client-b",token);
 const forbidden=await f.service.app.inject({method:"GET",url:path(f.jobId),headers:{authorization:`Bearer ${token}`}});expect(forbidden.statusCode,forbidden.body).toBe(404);expect(forbidden.body).not.toContain(f.taskId);
});
it("publishes only an immutable qualified PR candidate, with snapshot and cursor after its event commit",async()=>{
 const f=await open(true),before=await f.service.app.inject({method:"GET",url:path(f.jobId),headers:clientHeaders});expect(before.statusCode,before.body).toBe(200);expect(before.json().state).toBe("unknown");
 expect((await f.service.app.inject({method:"GET",url:`${path(f.jobId)}/artifacts`,headers:clientHeaders})).statusCode).toBe(409);
 seedRhizaCandidate(f);
 const snapshot=await f.service.app.inject({method:"GET",url:path(f.jobId),headers:clientHeaders});expect(snapshot.statusCode,snapshot.body).toBe(200);expect(snapshot.json().state).toBe("candidate");expect(snapshot.json().revision).toBeGreaterThan(before.json().revision);
 const first=await f.service.app.inject({method:"GET",url:`${path(f.jobId)}/artifacts`,headers:clientHeaders});expect(first.statusCode,first.body).toBe(200);expect(first.json().artifacts).toHaveLength(1);const descriptor=first.json().artifacts[0];expect(descriptor).toMatchObject({generation:2,commit:"a".repeat(40),modelEvidence:{binding:{generation:5,runGeneration:2}}});expect(first.body).not.toMatch(/private-(?:context|result)-canary/);
 const repeated=await f.service.app.inject({method:"GET",url:`${path(f.jobId)}/artifacts`,headers:clientHeaders});expect(repeated.json()).toEqual(first.json());
 const unchanged=await f.service.app.inject({method:"GET",url:`/api/integrations/rhiza/v1/events?cursor=${snapshot.json().cursor}`,headers:clientHeaders});expect(unchanged.json().events).toEqual([]);
 const pr=f.service.database.listDeliveryEvidence<JsonValue>(f.taskId).find(v=>(v as Record<string,JsonValue>).kind==="pull-request") as Record<string,JsonValue>;
 f.service.database.updateDeliveryEvidence({id:String(pr.id),externalId:String(pr.externalId),document:{...pr,revision:2,metadata:{...(pr.metadata as Record<string,JsonValue>),headCommit:"b".repeat(40)}},updatedAt:f.clock.now.toISOString()},1);
 const changed=await f.service.app.inject({method:"GET",url:`${path(f.jobId)}/artifacts`,headers:clientHeaders});expect(changed.statusCode,changed.body).toBe(409);
 const old=new RhizaArtifactStore(f.service.database).find(f.jobId,f.runId,2,"a".repeat(40));expect(old?.descriptor).toEqual(descriptor);
 expect((await f.service.app.inject({method:"GET",url:path(f.jobId),headers:clientHeaders})).json().state).toBe("unknown");
});
it("keeps cancellation intent separate from stopped proof and withdraws candidate qualification",async()=>{
 const f=await open(true);seedRhizaCandidate(f);const current=f.service.database.getCanonicalTask<JsonValue>(f.taskId)!;
 f.service.database.writeCanonicalTask(f.taskId,current.revision,{...(current.document as Record<string,JsonValue>),state:"CANCELLED"});
 const response=await f.service.app.inject({method:"GET",url:path(f.jobId),headers:clientHeaders});expect(response.statusCode,response.body).toBe(200);expect(response.json()).toMatchObject({state:"unknown",cancellationRequested:true,processObservation:"unknown"});expect((await f.service.app.inject({method:"GET",url:`${path(f.jobId)}/artifacts`,headers:clientHeaders})).statusCode).toBe(409);
});
it("rejects a replacement commit before first artifact read despite unchanged PASSED verification",async()=>{
 const f=await open(true);seedRhizaCandidate(f);const before=f.service.database.getEntity<JsonValue>("run",f.runId),result=f.service.database.getEntity<JsonValue>("run-result",f.runId) as Record<string,JsonValue>,commit="d".repeat(40);
 f.service.database.saveEntity("run-result",f.runId,{...result,commit:{...(result.commit as object),commit},push:{...(result.push as object),commit}} as JsonValue);
 for(const item of f.service.database.listDeliveryEvidence<JsonValue>(f.taskId) as Array<Record<string,JsonValue>>){f.service.database.updateDeliveryEvidence({id:String(item.id),externalId:item.kind==="commit"?commit:String(item.externalId),document:{...item,revision:2,...(item.kind==="commit"?{externalId:commit}:{}),metadata:{...(item.metadata as object),headCommit:commit}},updatedAt:f.clock.now.toISOString()},1);}
 const response=await f.service.app.inject({method:"GET",url:`${path(f.jobId)}/artifacts`,headers:clientHeaders});expect(response.statusCode,response.body).toBe(409);expect(f.service.database.getEntity("run",f.runId)).toEqual(before);expect(new RhizaArtifactStore(f.service.database).find(f.jobId,f.runId,2,commit)).toBeUndefined();
});
it("does not project foreign-profile native facts even if stored source data is corrupted",async()=>{
 const f=await open(),first=await f.service.app.inject({method:"GET",url:path(f.jobId),headers:clientHeaders});expect(first.statusCode,first.body).toBe(200);
 f.service.database.handle.prepare("UPDATE entities SET document_json=json_set(document_json,'$.profileId','foreign-profile','$.executionSelection.requestedModel','foreign-private-model-canary') WHERE kind='run' AND id=?").run(f.runId);
 const next=await f.service.app.inject({method:"GET",url:path(f.jobId),headers:clientHeaders});expect(next.statusCode,next.body).toBe(200);expect(next.json()).toMatchObject({state:"unknown",processObservation:"unknown"});expect(next.json().runId).toBeUndefined();expect(next.json().modelEvidence).toBeUndefined();expect(next.body).not.toContain("foreign-private-model-canary");
});
