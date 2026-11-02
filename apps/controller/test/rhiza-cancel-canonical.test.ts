import {expect,it} from "vitest";
import {RhizaAdmissionStore,RhizaObservationStore,RhizaCommandStore,type JsonValue} from "@dispatcher/persistence";
import type {Run} from "@dispatcher/domain";
import {localReviewFixture} from "./fixtures/local-review.js";
import {clientHeaders,clientToken,grant} from "./fixtures/rhiza-service.js";
import {workOrder} from "../../../packages/protocol/test/fixtures/rhiza-v1.js";
import {rhizaSubmissionHash} from "../src/rhiza-operations.js";
import type {RhizaJobRecord} from "../src/rhiza-jobs.js";
const json=(value:unknown):JsonValue=>JSON.parse(JSON.stringify(value)) as JsonValue;
it("uses the canonical stop path and exposes stopped only after its original backend settles",async()=>{
 const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>(),f=await localReviewFixture({advance:false,onCancel:async()=>{entered.resolve();await release.promise;}});
 try{
  await f.service.secrets.put(grant.credentialRef,clientToken);const config=f.service.configuration.current().config;config.rhizaIngress={enabled:true,clients:[{...grant,repositoryIds:["repo"],profileIds:["codex"],expiresAt:"2099-01-01T00:00:00.000Z"}]};await f.service.configuration.applyPlan(f.service.configuration.buildPlan(config,"owner","cli").id,{confirmed:true});
  const run=f.service.database.getEntity<JsonValue>("run",f.receipt.runId) as unknown as Run,order={...structuredClone(workOrder),origin:{...workOrder.origin,authorityId:"rhiza-a"},repositoryId:"repo",target:{...workOrder.target,profileId:"codex",harnessId:"codex",runnerId:"local",backendId:run.executionSelection!.backendId}};
  const request={requestId:"synthetic-job",preflightId:"synthetic",targetHash:"a".repeat(64),workOrder:order},job:RhizaJobRecord={version:1,jobId:"synthetic-job",taskId:run.taskId,publicationId:"synthetic",owner:"rhiza:client-a",principal:{id:"rhiza:client-a",roles:[],service:{clientId:"client-a"}} as RhizaJobRecord["principal"],request,dispatch:{state:"observed",runId:run.id}};
  f.service.database.transaction(()=>new RhizaAdmissionStore(f.service.database).accept({clientId:"client-a",commandScope:"jobs.submit",requestId:request.requestId},rhizaSubmissionHash(request),()=>{f.service.database.saveEntity("rhiza-job",job.jobId,json(job));f.service.database.saveEntity("task-rhiza-binding",run.taskId,json({version:1,jobId:job.jobId,clientId:"client-a",origin:order.origin}));return {jobId:job.jobId,taskId:run.taskId,repositoryId:"repo",profileId:"codex",authorityId:"rhiza-a",receipt:{state:"accepted"}};}));
  const response=await f.service.app.inject({method:"POST",url:`/api/integrations/rhiza/v1/jobs/${job.jobId}/cancellations`,headers:clientHeaders,payload:{requestId:"cancel-original",expectedJobRevision:new RhizaObservationStore(f.service.database).head(job.jobId)!.revision,runId:run.id,generation:order.origin.generation,runGeneration:run.generation}});expect(response.statusCode,response.body).toBe(202);await entered.promise;
  const pending=await f.service.app.inject({url:`/api/integrations/rhiza/v1/jobs/${job.jobId}`,headers:clientHeaders});expect(pending.json()).toMatchObject({state:"unknown",cancellationRequested:true,processObservation:"stop_requested"});expect(new RhizaCommandStore(f.service.database).latest(response.json().commandId)?.state).toBe("claimed");
  const fence=f.service["nativeInteractions"].fenceFor(run,"late-continue");expect(f.service["nativeInteractions"].authorizeInteraction({id:"owner",roles:["operator"]},"continue",fence)).toMatchObject({allowed:false,code:"NATIVE_WRITE_LOCKED"});
  release.resolve();await f.service["rhizaCancellations"].drain();const snapshot=await f.service.app.inject({url:`/api/integrations/rhiza/v1/jobs/${job.jobId}`,headers:clientHeaders});expect(snapshot.json()).toMatchObject({state:"canceled",processObservation:"stopped",cancellationRequested:true});expect(f.service.database.getEntity("run",run.id)).toMatchObject({state:"CANCELLED",sessionId:run.sessionId,generation:run.generation});expect(f.starts()).toBe(1);
 }finally{release.resolve();await f.close();}
});
