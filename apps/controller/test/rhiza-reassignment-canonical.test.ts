import {expect,it,vi} from "vitest";
import type {Run} from "@dispatcher/domain";
import {RhizaAdmissionStore,RhizaObservationStore,ModelInvocationStore,type JsonValue} from "@dispatcher/persistence";
import {localReviewFixture} from "./fixtures/local-review.js";
import {clientHeaders,clientToken,grant} from "./fixtures/rhiza-service.js";
import {workOrder} from "../../../packages/protocol/test/fixtures/rhiza-v1.js";
import {rhizaSubmissionHash} from "../src/rhiza-operations.js";
import {rhizaDigest,rhizaApprovalDigest} from "../src/rhiza-semantics.js";
import {RhizaServiceAuth} from "../src/rhiza-auth.js";
import {CredentialContext} from "../src/credential-context.js";
import {RhizaReassignments} from "../src/rhiza-reassignments.js";
import type {RhizaJobRecord} from "../src/rhiza-jobs.js";
import type {ControlPrincipal} from "../src/control-auth.js";
const json=(v:unknown):JsonValue=>JSON.parse(JSON.stringify(v)) as JsonValue;
it("qualifies canonical cancellation for a new attempt using the actual owned Node process drain, not backend self-report",async()=>{
 const f=await localReviewFixture({advance:false,waiting:true,explicitModel:true,ownedCli:true});try{
  await vi.waitFor(async()=>{const response=await f.service.app.inject({method:"POST",url:`/api/runs/${f.receipt.runId}/advance`,headers:f.headers});expect(response.statusCode,response.body).toBe(202);expect(response.json().run.state).toBe("WAITING_USER");});
  await f.service.secrets.put(grant.credentialRef,clientToken);const config=f.service.configuration.current().config;config.rhizaIngress={enabled:true,clients:[{...grant,repositoryIds:["repo"],profileIds:["codex"],expiresAt:"2099-01-01T00:00:00.000Z"}]};await f.service.configuration.applyPlan(f.service.configuration.buildPlan(config,"owner","cli").id,{confirmed:true});
  const run=f.service.database.getEntity<JsonValue>("run",f.receipt.runId) as unknown as Run,order={...structuredClone(workOrder),origin:{...workOrder.origin,authorityId:"rhiza-a"},repositoryId:"repo",target:{...workOrder.target,profileId:"codex",harnessId:"codex",runnerId:"local",backendId:run.executionSelection!.backendId,modelId:"fixture-model",modelOptions:{reasoningEffort:"medium"},contextFingerprint:run.executionSelection!.contextFingerprint}},request={requestId:"owned-job",preflightId:"synthetic",targetHash:rhizaDigest(order.target),workOrder:order};
  const job:RhizaJobRecord={version:1,jobId:"owned-job",taskId:run.taskId,publicationId:"owned-publication",owner:"rhiza:client-a",principal:{id:"rhiza:client-a",roles:[],service:{clientId:"client-a"}} as RhizaJobRecord["principal"],request,dispatch:{state:"observed",runId:run.id}};
  new RhizaAdmissionStore(f.service.database).accept({clientId:"client-a",commandScope:"jobs.submit",requestId:request.requestId},rhizaSubmissionHash(request),()=>{f.service.database.saveEntity("rhiza-job",job.jobId,json(job));f.service.database.saveEntity("task-rhiza-binding",run.taskId,{jobId:job.jobId});return {jobId:job.jobId,taskId:run.taskId,repositoryId:"repo",profileId:"codex",authorityId:"rhiza-a",receipt:json({schemaVersion:1,jobId:job.jobId,taskId:run.taskId,requestId:request.requestId,state:"accepted",origin:order.origin})};});
  const stop=await f.service.app.inject({method:"POST",url:`/api/integrations/rhiza/v1/jobs/${job.jobId}/cancellations`,headers:clientHeaders,payload:{requestId:"owned-cancel",expectedJobRevision:new RhizaObservationStore(f.service.database).head(job.jobId)!.revision,runId:run.id,runGeneration:run.generation,generation:order.origin.generation}});expect(stop.statusCode,stop.body).toBe(202);await f.service["rhizaCancellations"].drain();
  const snapshot=await f.service.app.inject({url:`/api/integrations/rhiza/v1/jobs/${job.jobId}`,headers:clientHeaders});expect(snapshot.json()).toMatchObject({state:"canceled",processObservation:"stopped"});const session=f.service.database.getEntity<JsonValue>("adapter-session",run.sessionId) as {modelInvocationId:string};expect(new ModelInvocationStore(f.service.database).completion(session.modelInvocationId)).toMatchObject({producer:"owned-process-group",outcome:"waiting",runId:run.id,providerSessionId:run.providerSessionId});
  const auth=new RhizaServiceAuth({config:()=>f.service.configuration.current().config,secrets:f.service.secrets,credentials:new CredentialContext(f.service.database),now:()=>new Date(),authorizationRevision:()=>f.service.configuration.current().revision,capabilities:()=>["jobs.reassign"]}),decision=await auth.authenticate(clientToken,{method:"POST",url:"/api/integrations/rhiza/v1/jobs",routePath:"/api/integrations/rhiza/v1/jobs",protocol:"http",ip:"127.0.0.1",headers:{host:"localhost"}}),principal=(decision as {principal:ControlPrincipal}).principal;
  const next={...order,origin:{...order.origin,executionRunId:"next-run",dispatchId:"next-dispatch",generation:order.origin.generation+1},approval:{...order.approval,reference:"next-approval"},reassignment:{jobId:job.jobId,expectedJobRevision:snapshot.json().revision,runId:run.id,runGeneration:run.generation}};next.approval.digest=rhizaApprovalDigest(next);expect(()=>new RhizaReassignments(f.service.database,auth,()=>new Date()).check(principal,next)).not.toThrow();expect(f.starts()).toBe(1);
 }finally{await f.close();}
});
