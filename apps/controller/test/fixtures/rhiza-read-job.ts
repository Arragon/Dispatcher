import {randomUUID} from "node:crypto";
import type {ExecutionSelection,Run} from "@dispatcher/domain";
import {RhizaAdmissionStore,ModelInvocationStore,RhizaVerificationStore,type JsonValue} from "@dispatcher/persistence";
import type {RhizaReceiptV1,RhizaSubmitRequestV1,RhizaWorkOrderV1} from "@dispatcher/protocol";
import type {RhizaJobRecord} from "../../src/rhiza-jobs.js";
import {rhizaSubmissionHash} from "../../src/rhiza-operations.js";
import {rhizaDigest,rhizaInputHash,rhizaApprovalDigest} from "../../src/rhiza-semantics.js";
import {workOrder} from "../../../../packages/protocol/test/fixtures/rhiza-v1.js";
import {rhizaServiceFixture} from "./rhiza-service.js";
const json=(v:unknown):JsonValue=>JSON.parse(JSON.stringify(v)) as JsonValue;
/** Seeds explicitly synthetic native/SCM facts through real SQLite; no model or PR is invoked. */
export async function rhizaReadJobFixture(complete=false,unstarted=false){
 const f=await rhizaServiceFixture(),jobId=randomUUID(),taskId=`task-${randomUUID()}`,runId=`run-${randomUUID()}`,sessionId=`session-${randomUUID()}`,requestId=`request-${randomUUID()}`;
 const order={...structuredClone(workOrder),origin:{...workOrder.origin,authorityId:"rhiza-a",generation:5},repositoryId:"repo-a",scopePaths:["."],context:{packetId:"packet-a",formatVersion:"1",content:"private-context-canary",inputHash:rhizaInputHash("private-context-canary")},evidencePolicy:{minimum:"configuration_confirmed"},target:{...workOrder.target,modelId:"model-a",modelOptions:{},profileId:"profile-a",runnerId:"local",contextFingerprint:"d".repeat(64)}} as RhizaWorkOrderV1;
 order.approval.digest=rhizaApprovalDigest(order);
 const request:RhizaSubmitRequestV1={requestId,preflightId:"synthetic-preflight",targetHash:rhizaDigest(order.target),workOrder:order};
 const receipt:RhizaReceiptV1={schemaVersion:1,receiptId:randomUUID(),requestId,clientId:"client-a",requestHash:rhizaSubmissionHash(request),jobId,taskId,state:"accepted",acceptedAt:f.clock.now.toISOString(),origin:order.origin,targetHash:request.targetHash,inputHash:order.context.inputHash};
 const principal={id:"rhiza:client-a",roles:[],channel:"api",authenticatedBy:"service-bearer",service:{clientId:"client-a"}} as RhizaJobRecord["principal"];
 const selection:ExecutionSelection={version:1,mode:"manual",source:"explicit",selectionType:"explicit-model",requestedModel:order.target.modelId,nativeParameters:{},profileId:order.target.profileId,providerId:order.target.harnessId,backendId:order.target.backendId,runnerId:order.target.runnerId,contextFingerprint:order.target.contextFingerprint,catalogRevision:"c".repeat(64),configRevision:f.service.configuration.current().revision,selectedAt:f.clock.now.toISOString()};
 const run={id:runId,taskId,sessionId,providerSessionId:"synthetic-native",runnerId:"local",profileId:"profile-a",providerId:"codex",state:complete?"COMPLETE":"ACTIVE",generation:2,attempt:1,leaseId:"synthetic-lease",branch:"task/synthetic",executionSelection:selection,verification:{state:"PASSED",commands:["test"]},prUrl:"https://github.example/example/repo/pull/1"} as Run;
 const job:RhizaJobRecord={version:1,jobId,taskId,publicationId:"synthetic-publication",owner:principal.id,principal,request,dispatch:unstarted?{state:"pending"}:{state:"observed",runId}};
 f.service.database.transaction(()=>{
  new RhizaAdmissionStore(f.service.database).accept({clientId:"client-a",commandScope:"jobs.submit",requestId},receipt.requestHash,()=>{
   f.service.database.writeCanonicalTask(taskId,0,{id:taskId,state:unstarted?"BACKLOG":complete?"REVIEW":"RUNNING",...(unstarted?{}:{currentRunId:runId})});f.service.database.saveEntity("rhiza-job",jobId,json(job));f.service.database.saveEntity("task-rhiza-binding",taskId,json({version:1,jobId,clientId:"client-a",origin:order.origin}));
   return {jobId,taskId,repositoryId:"repo-a",profileId:"profile-a",authorityId:"rhiza-a",receipt:json(receipt)};
  });
  f.service.database.saveEntity("task-publication",job.publicationId,json({owner:job.owner,preview:{publicationId:job.publicationId},receipt:unstarted?{taskId,state:"QUEUED"}:{runId,taskId,state:"STARTED"}}));
  if(!unstarted){
  f.service.database.saveEntity("run",runId,json(run));
  const execution={generation:run.generation,attempt:run.attempt,leaseId:run.leaseId};
  f.service.database.saveEntity("adapter-session",sessionId,json({id:sessionId,runId,profileId:run.profileId,backendId:order.target.backendId,workspacePath:f.repository,state:complete?"COMPLETED":"RUNNING",providerSessionId:run.providerSessionId,executionSelection:selection,execution,turnId:"synthetic-turn",modelInvocationId:`invocation-${jobId}`,createdAt:f.clock.now.toISOString(),updatedAt:f.clock.now.toISOString()}));
  const session=f.service.database.getEntity<JsonValue>("adapter-session",sessionId) as Record<string,JsonValue>;f.service.database.saveEntity("adapter-session",sessionId,{...session,turnId:`invocation-${jobId}`});
  new ModelInvocationStore(f.service.database).append({version:1,id:`invocation-${jobId}`,sessionId,runId,profileId:run.profileId,backendId:order.target.backendId,kind:"start",invokedAt:f.clock.now.toISOString(),execution,executionSelection:selection,model:{id:order.target.modelId,options:{}}});
  }
 });
 return {...f,jobId,taskId,runId,sessionId,request,receipt,run};
}
export function seedRhizaCandidate(f:Awaited<ReturnType<typeof rhizaReadJobFixture>>):void {
 const commit="a".repeat(40),at=f.clock.now.toISOString(),order=f.request.workOrder,target={version:1,host:"github.example",repository:order.delivery.targetRepository,remoteFingerprint:"e".repeat(64)};
 const localCommit={version:1,runId:f.runId,generation:f.run.generation,commit,tree:"b".repeat(40),branch:f.run.branch,files:["src/result.ts"],created:true,completedAt:at},push={version:1,runId:f.runId,generation:f.run.generation,commit,branch:f.run.branch,target,pushedAt:at};
 f.service.database.transaction(()=>{
  const verification=new RhizaVerificationStore(f.service.database);verification.recordSource({version:1,jobId:f.jobId,runId:f.runId,runGeneration:f.run.generation,sessionId:f.sessionId,leaseId:f.run.leaseId,targetHash:f.request.targetHash,tree:localCommit.tree,commandIds:["test"],commandsDigest:"c".repeat(64),verifiedAt:at});verification.bindCommit(f.runId,f.run.generation,localCommit);
  f.service.database.saveEntity("run-result",f.runId,json({version:1,runId:f.runId,taskId:f.taskId,generation:f.run.generation,deliveryType:"pull-request",commit:localCommit,push,summary:"private-result-canary"}));
  f.service.database.saveEntity("run-delivery-selection",f.runId,json({version:1,scmConnectorId:order.delivery.scmConnectorId,repository:target.repository,baseBranch:order.delivery.baseBranch,target,contextFingerprint:"synthetic-scm",configRevision:f.run.executionSelection!.configRevision,reviewedAt:at}));
  const metadata={idempotencyKey:`delivery:${f.runId}:${f.run.generation}`,generation:f.run.generation,headCommit:commit,headCommitSource:"provider",pullRequestNumber:1};
  for(const [kind,id] of [["commit",commit],["pull-request","1"]]){
   const document={id:`${kind}-${f.jobId}`,taskId:f.taskId,runId:f.runId,connectorInstanceId:order.delivery.scmConnectorId,kind,externalId:id,state:"READY",revision:1,metadata,...(kind==="pull-request"?{url:"https://github.example/example/repo/pull/1"}:{}),createdAt:at,updatedAt:at};
   f.service.database.saveDeliveryEvidence({id:document.id,taskId:f.taskId,runId:f.runId,connectorInstanceId:order.delivery.scmConnectorId,kind:kind!,externalId:id!,document:json(document),updatedAt:at});
  }
 });
}
