import {expect,it} from "vitest";
import type {Run,RunGitDelivery,ScmDeliverySelection,DeliveryEvidence} from "@dispatcher/domain";
import type {RhizaWorkOrderV1,RhizaModelEvidenceV1} from "@dispatcher/protocol";
import type {RhizaVerificationProof} from "@dispatcher/persistence";
import {workOrder,modelEvidence} from "../../../packages/protocol/test/fixtures/rhiza-v1.js";
import {buildRhizaArtifact} from "../src/rhiza-artifact-source.js";
import {rhizaDigest} from "../src/rhiza-semantics.js";
function fixture(){
 const order=structuredClone(workOrder) as RhizaWorkOrderV1;order.origin.generation=5;order.evidencePolicy.minimum="configuration_confirmed";
 const targetHash=rhizaDigest(order.target),run={id:"run-a",taskId:"task-a",sessionId:"session-a",providerId:"codex",profileId:order.target.profileId,runnerId:order.target.runnerId,generation:2,attempt:1,leaseId:"lease-a",state:"COMPLETE",branch:"task/branch",verification:{state:"PASSED",commands:order.verificationCommandIds}} as Run;
 const selection={version:1,scmConnectorId:order.delivery.scmConnectorId,repository:order.delivery.targetRepository,baseBranch:order.delivery.baseBranch,target:{version:1,host:"github.example",repository:order.delivery.targetRepository,remoteFingerprint:"a".repeat(64)},contextFingerprint:"scm",configRevision:1,reviewedAt:"2026-10-23T10:00:00.000Z"} as ScmDeliverySelection;
 const commit="a".repeat(40),git={version:1,commit:{version:1,runId:run.id,generation:2,commit,branch:run.branch,files:["src/result.ts"],created:true,completedAt:"2026-10-23T10:00:00.000Z"},push:{version:1,runId:run.id,generation:2,commit,branch:run.branch,target:selection.target,pushedAt:"2026-10-23T10:00:00.000Z"}} as RunGitDelivery;
 const metadata={idempotencyKey:`delivery:${run.id}:2`,generation:2,headCommit:commit,headCommitSource:"provider",pullRequestNumber:1};
 const evidence=[{id:"commit",taskId:run.taskId,runId:run.id,connectorInstanceId:selection.scmConnectorId,kind:"commit",externalId:commit,state:"READY",revision:1,metadata},{id:"pr",taskId:run.taskId,runId:run.id,connectorInstanceId:selection.scmConnectorId,kind:"pull-request",externalId:"1",url:"https://github.example/example/repo/pull/1",state:"READY",revision:1,metadata}] as DeliveryEvidence[];
 const proof={...structuredClone(modelEvidence),status:"configuration_confirmed",source:"invocation-record",reported:null,binding:{...order.origin,runId:run.id,runGeneration:2,sessionId:run.sessionId,targetHash}} as RhizaModelEvidenceV1;
 git.commit.tree="b".repeat(40);
 const verification:RhizaVerificationProof={version:1,jobId:"job-a",runId:run.id,runGeneration:2,sessionId:run.sessionId,leaseId:run.leaseId,targetHash,tree:git.commit.tree,commandIds:order.verificationCommandIds,commandsDigest:"c".repeat(64),verifiedAt:"2026-10-23T10:00:00.000Z",commit};
 return {jobId:"job-a",order,targetHash,run,selection,git,evidence,proof,verification:verification as RhizaVerificationProof|undefined};
}
it("binds a stable candidate digest to original provenance, with separate RHIZA and Dispatcher generations",()=>{
 const f=fixture(),first=buildRhizaArtifact(f);expect(first).toMatchObject({jobId:"job-a",runId:"run-a",generation:2,commit:f.git.commit.commit,modelEvidence:{binding:{generation:5,runGeneration:2}}});
 expect(buildRhizaArtifact(f).digest).toBe(first.digest);expect(JSON.stringify(first)).not.toContain("Frozen fixture context");
});
it.each(["head-echo","head-changed","wrong-run","wrong-generation","foreign-url","wrong-target","failed-verification","wrong-proof","unverified","missing-commit"])("refuses %s provenance",reason=>{
 const f=fixture();if(reason==="head-echo")f.evidence[1]!.metadata.headCommitSource="push-record";if(reason==="head-changed")f.evidence[1]!.metadata.headCommit="b".repeat(40);if(reason==="wrong-run")f.git.commit.runId="foreign";if(reason==="wrong-generation")f.git.push.generation=1;if(reason==="foreign-url")f.evidence[1]!.url="https://foreign.invalid/example/repo/pull/1";if(reason==="wrong-target")f.selection.target.repository="foreign/repo";if(reason==="failed-verification")f.run.verification.state="FAILED";if(reason==="wrong-proof")f.proof.binding.generation=1;if(reason==="unverified")f.proof.status="unverified";if(reason==="missing-commit")f.evidence.shift();
 expect(()=>buildRhizaArtifact(f)).toThrow();
});
it("does not infer content-bound verification from a PASSED Run alone",()=>{
 const f=fixture();f.verification=undefined;expect(()=>buildRhizaArtifact(f)).toThrow();
});
it.each(["changed-commit","changed-tree","wrong-verification-generation"])("refuses %s even when Run verification still says PASSED",reason=>{
 const f=fixture();if(reason==="changed-commit"){f.git.commit.commit="d".repeat(40);f.git.push.commit=f.git.commit.commit;f.evidence[0]!.externalId=f.git.commit.commit;f.evidence[1]!.metadata.headCommit=f.git.commit.commit;}
 if(reason==="changed-tree")f.git.commit.tree="d".repeat(40);if(reason==="wrong-verification-generation")f.verification!.runGeneration=1;
 expect(()=>buildRhizaArtifact(f)).toThrow();
});
