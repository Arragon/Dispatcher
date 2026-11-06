import {createHash} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import type {Run,Task} from "@dispatcher/domain";
import type {AdapterSession} from "@dispatcher/adapters";
import {RhizaCommandStore,RhizaObservationStore,ModelInvocationStore,InteractionStore,hasRhizaSuccessor,type DispatcherDatabase,type JsonValue} from "@dispatcher/persistence";
import type {RhizaWorkOrderV1,RhizaReceiptV1} from "@dispatcher/protocol";
import type {ControlPrincipal} from "./control-auth.js";
import type {RhizaJobRecord} from "./rhiza-jobs.js";
import {RhizaIngressError,type RhizaServiceAuth} from "./rhiza-auth.js";
import {rhizaSubmissionHash} from "./rhiza-operations.js";
import {hasNativeExternalWriteBlocker} from "./native-external-changes.js";
import {projectRhizaModelEvidence} from "./rhiza-model-evidence.js";
import {readRhizaArtifact} from "./rhiza-artifact-source.js";
const identity=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
function changed():never {throw new RhizaIngressError("TARGET_AUTHORITY_CHANGED",409,"A new explicit attempt with current predecessor authority is required");}
function unknown():never {throw new RhizaIngressError("STOP_UNCONFIRMED",409,"Original effects require reconciliation before another attempt");}
/** A read-only admission predicate, reused before preflight and inside canonical commit. */
export class RhizaReassignments {
 constructor(private readonly db:DispatcherDatabase,private readonly auth:RhizaServiceAuth,private readonly now:()=>Date){}
 check(principal:ControlPrincipal|undefined,order:RhizaWorkOrderV1,acceptedJobId?:string):void {
  const grant=this.auth.current(principal,["jobs:submit","targets:read"],{repositoryId:order.repositoryId,profileId:order.target.profileId,authorityId:order.origin.authorityId});
  const duplicate=this.db.handle.prepare("SELECT job_id FROM rhiza_admissions WHERE client_id=? AND authority_id=? AND json_extract(receipt_json,'$.origin.workspaceId')=? AND json_extract(receipt_json,'$.origin.dispatchId')=?").get(grant.id,order.origin.authorityId,order.origin.workspaceId,order.origin.dispatchId);
  if(duplicate&&duplicate.job_id!==acceptedJobId)changed();
  if(acceptedJobId&&hasRhizaSuccessor(this.db,acceptedJobId))changed();
  const fence=order.reassignment;if(!fence)return;
  if(!this.auth.capabilities(principal).capabilities.includes("jobs.reassign"))throw new RhizaIngressError("CAPABILITY_REQUIRED",409,"Explicit reassignment is not enabled for this service");
  const row=this.db.handle.prepare("SELECT * FROM rhiza_admissions WHERE client_id=? AND job_id=?").get(grant.id,fence.jobId);
  if(!row)throw new RhizaIngressError("NOT_FOUND",404,"Original acceptance is unavailable");
  this.auth.current(principal,["jobs:submit","targets:read"],{repositoryId:String(row.repository_id),profileId:String(row.profile_id),authorityId:String(row.authority_id)});
  const receipt=JSON.parse(String(row.receipt_json)) as RhizaReceiptV1,origin=receipt.origin;
  const job=this.db.getEntity<JsonValue>("rhiza-job",fence.jobId) as unknown as RhizaJobRecord|undefined;
  if(!origin||!job||job.version!==1||job.taskId!==row.task_id||job.jobId!==fence.jobId||job.principal.service?.clientId!==grant.id||rhizaSubmissionHash(job.request)!==row.request_hash||!isDeepStrictEqual(job.request.workOrder.origin,origin))changed();
  const next=order.origin;
  if(next.authorityId!==origin.authorityId||next.workspaceId!==origin.workspaceId||next.workflowRunId!==origin.workflowRunId||next.executionRunId===origin.executionRunId||next.dispatchId===origin.dispatchId||next.generation<=origin.generation||order.approval.reference===job.request.workOrder.approval.reference||origin.workflowRunId&&(!origin.stepAttemptId||!next.stepAttemptId||next.stepAttemptId===origin.stepAttemptId))changed();
  const successor=this.db.handle.prepare("SELECT job_id,receipt_json FROM rhiza_admissions WHERE json_extract(receipt_json,'$.reassignment.jobId')=?").get(fence.jobId);
  if(successor&&(successor.job_id!==acceptedJobId||!isDeepStrictEqual((JSON.parse(String(successor.receipt_json)) as RhizaReceiptV1).reassignment,fence)))changed();
  // A committed own successor has already consumed this revision. Its immutable
  // fence is replayed, while current physical uncertainty is still rechecked.
  if(!successor&&new RhizaObservationStore(this.db).head(fence.jobId)?.revision!==fence.expectedJobRevision)throw new RhizaIngressError("REVISION_CONFLICT",409,"Refresh the original authorized job snapshot");
  const task=this.db.getCanonicalTask<JsonValue>(job.taskId)?.document as unknown as Task|undefined;
  if(!task||task.id!==job.taskId||(task.currentRunId??null)!==fence.runId)changed();
  const history=this.db.listTaskRunsPage<JsonValue>(job.taskId,0,1);if(history.total>1)unknown();
  const runs=history.runs.map(value=>value as unknown as Run);
  this.assertNoUncertainty(job,runs);
  const commands=new RhizaCommandStore(this.db),cancel=commands.forJob(job.jobId).find(command=>command.scope==="jobs.cancel"),stop=cancel?commands.latest(cancel.commandId):undefined;
  const proof=stop?.proof as {kind?:string;runId?:string|null;runGeneration?:number;sessionId?:string;leaseId?:string}|undefined;
  if(!task.currentRunId){
   if(task.state!=="CANCELLED"||runs.length||job.dispatch.code!=="CANCELLATION_REQUESTED"||!cancel||stop?.state!=="confirmed"||proof?.kind!=="not_sent"||proof.runId!==null||(cancel.fence as {runId?:string|null}).runId!==null)unknown();return;
  }
  // Canonical ingress permits one Run per accepted job. Unexpected older Runs
  // require reconciliation rather than borrowing the latest turn's drain.
  if(job.dispatch.state!=="observed"||runs.some(run=>run.id!==task.currentRunId))unknown();
  const run=runs.find(run=>run.id===task.currentRunId),target=job.request.workOrder.target;
  if(!run||run.generation!==fence.runGeneration||run.profileId!==target.profileId||run.providerId!==target.harnessId||run.runnerId!==target.runnerId||run.executionSelection?.requestedModel!==target.modelId||run.executionSelection.backendId!==target.backendId||run.executionSelection.contextFingerprint!==target.contextFingerprint||!isDeepStrictEqual(run.executionSelection.nativeParameters,target.modelOptions))changed();
  const session=this.db.getEntity<JsonValue>("adapter-session",run.sessionId) as unknown as AdapterSession&{authority?:{stopState:string;stopIntent?:{operation:string;fence:{runId:string;sessionId:string;generation:number;leaseId:string}}}}|undefined;
  if(!session||session.id!==run.sessionId||session.runId!==run.id||session.providerSessionId!==run.providerSessionId||session.profileId!==run.profileId||session.backendId!==target.backendId||!isDeepStrictEqual(session.execution,{generation:run.generation,attempt:run.attempt,leaseId:run.leaseId})||session.nativeBinding||run.executionRef)unknown();
  const interactions=new InteractionStore(this.db),control=interactions.control(run.sessionId);
  if(!control||control.state!=="AUTOMATED"||control.activeRunId!==run.id||interactions.binding(run.sessionId))unknown();
  if(!session.modelInvocationId)unknown();
  const invocations=new ModelInvocationStore(this.db),completion=invocations.completion(session.modelInvocationId),invocation=invocations.get(session.modelInvocationId);
  if(!completion||completion.producer!=="owned-process-group"||completion.runId!==run.id||completion.sessionId!==run.sessionId||completion.providerSessionId!==run.providerSessionId||completion.profileId!==run.profileId||completion.backendId!==target.backendId||!isDeepStrictEqual(completion.execution,{generation:run.generation,attempt:run.attempt,leaseId:run.leaseId}))unknown();
  const intent=session.authority?.stopIntent;
  if(run.state==="CANCELLED"&&task.state==="CANCELLED"&&stop?.state==="confirmed"&&proof?.kind==="stopped"&&proof.runId===run.id&&proof.runGeneration===run.generation&&proof.sessionId===run.sessionId&&proof.leaseId===run.leaseId&&session.authority?.stopState==="confirmed"&&intent?.operation==="cancel"&&intent.fence.runId===run.id&&intent.fence.sessionId===run.sessionId&&intent.fence.generation===run.generation&&intent.fence.leaseId===run.leaseId)return;
  if(run.state==="FAILED"&&task.state==="FAILED"&&["FAILED","CANCELLED"].includes(session.state)&&completion.outcome==="failed")return;
  if(run.state!=="COMPLETE"||!["REVIEW","DONE"].includes(task.state)||session.state!=="COMPLETED"||completion.outcome!=="completed")unknown();
  const model=projectRhizaModelEvidence({order:job.request.workOrder,targetHash:job.request.targetHash,run,session,invocation,now:this.now()});if(!model.candidateAllowed)unknown();
  readRhizaArtifact(this.db,job,run,model.evidence);
 }
 private assertNoUncertainty(job:RhizaJobRecord,runs:Run[]):void {
  const publication=this.db.getEntity<JsonValue>("task-publication",job.publicationId) as {receipt?:{state?:string}}|undefined;
  if(publication?.receipt?.state&&["STARTING","OUTCOME_UNKNOWN"].includes(publication.receipt.state))unknown();
  const controls=new RhizaCommandStore(this.db);
  if(controls.forJob(job.jobId).some(command=>controls.latest(command.commandId)?.state!=="confirmed"))unknown();
  for(const run of runs){
   if(this.db.handle.prepare("SELECT 1 FROM entities WHERE kind='run-input' AND json_extract(document_json,'$.runId')=? AND COALESCE(json_extract(document_json,'$.state'),'') NOT IN ('ACCEPTED','REJECTED') LIMIT 1").get(run.id))unknown();
   if(hasNativeExternalWriteBlocker(this.db,run))unknown();
   const session=this.db.getEntity<JsonValue>("adapter-session",run.sessionId) as {authority?:{stopState?:string}}|undefined;
   if(session?.authority?.stopState&&!['none','confirmed'].includes(session.authority.stopState))unknown();
   if(this.db.handle.prepare("SELECT 1 FROM interaction_commands WHERE session_id=? AND (state IN ('RESERVED','SENDING','UNKNOWN') OR state='ACKNOWLEDGED' AND json_extract(document_json,'$.nativeReceipt.state')='queued') LIMIT 1").get(run.sessionId))unknown();
   const cancel=this.db.getEntity<JsonValue>("native-cancel",run.id) as {resolution?:{nativeMayBeRunning?:boolean}}|undefined;if(cancel&&cancel.resolution?.nativeMayBeRunning!==false)unknown();
   for(const kind of ["local-git-delivery","git-push-delivery"]){const receipt=this.db.getEntity<JsonValue>(kind,identity({runId:run.id,generation:run.generation})) as {state?:string}|undefined;if(receipt&&receipt.state!=="COMPLETE")unknown();}
   const pr=this.db.getEntity<JsonValue>("scm-pr-intent",identity({taskId:run.taskId,runId:run.id,generation:run.generation})) as {state?:string}|undefined;if(pr&&pr.state!=="COMPLETE")unknown();
   if(this.db.handle.prepare("SELECT 1 FROM entities WHERE kind IN ('local-review-verification','run-verification-command') AND json_extract(document_json,'$.runId')=? AND json_extract(document_json,'$.state') IN ('SENDING','UNKNOWN') LIMIT 1").get(run.id))unknown();
  }
 }
}
