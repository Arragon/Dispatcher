import {randomUUID} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {isGitDeliveryTarget,type Run,type RunGitDelivery,type ScmDeliverySelection,type DeliveryEvidence,type Task} from "@dispatcher/domain";
import type {RhizaArtifactV1,RhizaWorkOrderV1,RhizaModelEvidenceV1} from "@dispatcher/protocol";
import {RhizaVerificationStore,type DispatcherDatabase,type JsonValue,type RhizaVerificationProof} from "@dispatcher/persistence";
import type {RhizaJobRecord} from "./rhiza-jobs.js";
import {RhizaIngressError} from "./rhiza-auth.js";
import {rhizaDigest} from "./rhiza-semantics.js";
function fail():never {throw new RhizaIngressError("TARGET_AUTHORITY_CHANGED",409,"Candidate source or provenance is not qualified for the frozen execution");}
interface Input {jobId:string;order:RhizaWorkOrderV1;targetHash:string;run:Run;selection:ScmDeliverySelection;git:RunGitDelivery;evidence:DeliveryEvidence[];proof:RhizaModelEvidenceV1;verification:RhizaVerificationProof|undefined}
/** A candidate describes recorded commit/PR facts; it never accepts RHIZA quality. */
export function buildRhizaArtifact({jobId,order,targetHash,run,selection,git,evidence,proof,verification}:Input):RhizaArtifactV1 {
 const commit=git?.commit,push=git?.push;
 if(run.state!=="COMPLETE"||run.verification?.state!=="PASSED"||!isDeepStrictEqual(run.verification.commands,order.verificationCommandIds)||rhizaDigest(order.target)!==targetHash||!selection||selection.version!==1||selection.scmConnectorId!==order.delivery.scmConnectorId||selection.repository!==order.delivery.targetRepository.toLowerCase()||selection.baseBranch!==order.delivery.baseBranch||!isGitDeliveryTarget(selection.target)||selection.target.repository!==selection.repository)fail();
 if(git?.version!==1||commit?.version!==1||push?.version!==1||commit.runId!==run.id||push.runId!==run.id||commit.generation!==run.generation||push.generation!==run.generation||commit.branch!==run.branch||push.branch!==run.branch||typeof commit.commit!=="string"||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit.commit)||push.commit!==commit.commit||!isDeepStrictEqual(push.target,selection.target))fail();
 if(!verification||verification.version!==1||verification.jobId!==jobId||verification.runId!==run.id||verification.runGeneration!==run.generation||verification.sessionId!==run.sessionId||verification.leaseId!==run.leaseId||verification.targetHash!==targetHash||verification.commit!==commit.commit||verification.tree!==commit.tree||!verification.tree||!isDeepStrictEqual(verification.commandIds,order.verificationCommandIds))fail();
 const binding={...order.origin,runId:run.id,runGeneration:run.generation,sessionId:run.sessionId,targetHash};
 if(!proof||!isDeepStrictEqual(proof.binding,binding)||proof.requested.modelId!==order.target.modelId||!isDeepStrictEqual(proof.requested.modelOptions,order.target.modelOptions)||!isDeepStrictEqual(proof.requested,proof.resolved)||!(proof.status==="verified"||proof.status==="configuration_confirmed"&&order.evidencePolicy.minimum==="configuration_confirmed"))throw new RhizaIngressError("MODEL_EVIDENCE_REQUIRED",409,"Candidate model evidence does not satisfy its frozen policy");
 const scoped=evidence.filter(item=>item.taskId===run.taskId&&item.runId===run.id&&item.connectorInstanceId===selection.scmConnectorId&&item.metadata?.idempotencyKey===`delivery:${run.id}:${run.generation}`&&item.metadata.generation===run.generation);
 const commits=scoped.filter(item=>item.kind==="commit"&&item.state==="READY"&&item.externalId===commit.commit),prs=scoped.filter(item=>item.kind==="pull-request"&&["READY","MERGED"].includes(item.state));
 if(commits.length!==1||prs.length!==1)fail();
 const pr=prs[0]!;if(pr.metadata.headCommitSource!=="provider"||pr.metadata.headCommit!==commit.commit||typeof pr.url!=="string")fail();
 let url:URL;try{url=new URL(pr.url!);}catch{fail();}
 if(url!.protocol!=="https:"||url!.host!==selection.target.host||url!.username||url!.password||url!.search||url!.hash||url!.pathname!==`/${selection.repository}/pull/${pr.metadata.pullRequestNumber}`||!Number.isSafeInteger(pr.metadata.pullRequestNumber)||Number(pr.metadata.pullRequestNumber)<1)fail();
 const description={jobId,runId:run.id,generation:run.generation,targetHash,inputHash:order.context.inputHash,repositoryId:order.repositoryId,commit:commit.commit,prUrl:pr.url!,verification:{state:"passed" as const,commandIds:[...run.verification.commands],commit:commit.commit},modelEvidence:structuredClone(proof)};
 return {artifactId:randomUUID(),...description,digest:rhizaDigest(description)};
}

/** Read the canonical source without freezing an artifact or performing external work. */
export function readRhizaArtifact(db:DispatcherDatabase,job:RhizaJobRecord,run:Run,proof:RhizaModelEvidenceV1):RhizaArtifactV1 {
 const task=db.getCanonicalTask<JsonValue>(job.taskId)?.document as unknown as Task|undefined;
 if(task?.currentRunId!==run.id||!["REVIEW","DONE"].includes(task.state))fail();
 const result=db.getEntity<JsonValue>("run-result",run.id) as unknown as {version:number;runId:string;taskId:string;generation:number;deliveryType:string;commit:RunGitDelivery["commit"];push:RunGitDelivery["push"]}|undefined;
 const selection=db.getEntity<JsonValue>("run-delivery-selection",run.id) as unknown as ScmDeliverySelection;
 if(!result||result.version!==1||result.runId!==run.id||result.taskId!==job.taskId||result.generation!==run.generation||result.deliveryType!=="pull-request")fail();
 return buildRhizaArtifact({jobId:job.jobId,order:job.request.workOrder,targetHash:job.request.targetHash,run,selection,git:{version:1,commit:result.commit,push:result.push},evidence:db.listDeliveryEvidence<JsonValue>(job.taskId) as unknown as DeliveryEvidence[],proof,verification:new RhizaVerificationStore(db).get(run.id,run.generation,"commit")});
}
