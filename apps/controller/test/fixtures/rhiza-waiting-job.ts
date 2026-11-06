import {expect} from "vitest";
import {RhizaAdmissionStore,type JsonValue} from "@dispatcher/persistence";
import type {Run,PricingSnapshotV1} from "@dispatcher/domain";
import {localReviewFixture} from "./local-review.js";
import {clientHeaders,clientToken,grant} from "./rhiza-service.js";
import {workOrder} from "../../../../packages/protocol/test/fixtures/rhiza-v1.js";
import {rhizaSubmissionHash} from "../../src/rhiza-operations.js";
import {rhizaDigest} from "../../src/rhiza-semantics.js";
import type {RhizaJobRecord} from "../../src/rhiza-jobs.js";
const json=(value:unknown):JsonValue=>JSON.parse(JSON.stringify(value)) as JsonValue;
// Controlled backend fixture; no provider, remote PR or real RHIZA client.
export async function waitingRhizaJob(pricing?:{nativePricing:PricingSnapshotV1;clock:()=>Date}){
 const f=await localReviewFixture({advance:false,waiting:true,explicitModel:true,...pricing});try{
  const waiting=await f.service.app.inject({method:"POST",url:`/api/runs/${f.receipt.runId}/advance`,headers:f.headers});expect(waiting.json()).toMatchObject({run:{state:"WAITING_USER"},task:{state:"WAITING_USER"}});
  await f.service.secrets.put(grant.credentialRef,clientToken);const config=f.service.configuration.current().config;config.rhizaIngress={enabled:true,clients:[{...grant,repositoryIds:["repo"],profileIds:["codex"],expiresAt:"2099-01-01T00:00:00.000Z"}]};await f.service.configuration.applyPlan(f.service.configuration.buildPlan(config,"owner","cli").id,{confirmed:true});
  const run=f.service.database.getEntity<JsonValue>("run",f.receipt.runId) as unknown as Run,order={...structuredClone(workOrder),origin:{...workOrder.origin,authorityId:"rhiza-a"},repositoryId:"repo",target:{...workOrder.target,profileId:"codex",harnessId:"codex",runnerId:"local",backendId:run.executionSelection!.backendId,modelId:"fixture-model",modelOptions:{reasoningEffort:"medium"},contextFingerprint:run.executionSelection!.contextFingerprint}};
  const request={requestId:"synthetic-job",preflightId:"synthetic",targetHash:rhizaDigest(order.target),workOrder:order},job:RhizaJobRecord={version:1,jobId:"synthetic-input-job",taskId:run.taskId,publicationId:"synthetic",owner:"rhiza:client-a",principal:{id:"rhiza:client-a",roles:[],service:{clientId:"client-a"}} as RhizaJobRecord["principal"],request,dispatch:{state:"observed",runId:run.id}};
  f.service.database.transaction(()=>new RhizaAdmissionStore(f.service.database).accept({clientId:"client-a",commandScope:"jobs.submit",requestId:request.requestId},rhizaSubmissionHash(request),()=>{f.service.database.saveEntity("rhiza-job",job.jobId,json(job));f.service.database.saveEntity("task-rhiza-binding",run.taskId,json({version:1,jobId:job.jobId,clientId:"client-a",origin:order.origin}));return {jobId:job.jobId,taskId:run.taskId,repositoryId:"repo",profileId:"codex",authorityId:"rhiza-a",receipt:{state:"accepted"}};}));
  const before=await f.service.app.inject({url:`/api/integrations/rhiza/v1/jobs/${job.jobId}`,headers:clientHeaders});expect(before.statusCode,before.body).toBe(200);expect(before.json().allowedOperations).toContain("jobs:input");const snapshot=before.json(),payload={requestId:"same-session-input",expectedJobRevision:snapshot.revision,runId:run.id,runGeneration:run.generation,generation:order.origin.generation,interventionRevision:snapshot.intervention.revision,sessionId:run.sessionId,leaseId:run.leaseId,taskRevision:snapshot.intervention.taskRevision,input:"Modify the original result"};
  return {f,run,job,payload};
 }catch(error){await f.close();throw error;}
}
