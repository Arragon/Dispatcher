import type {Run,Task} from "@dispatcher/domain";
import {RhizaObservationStore,RhizaArtifactStore,RhizaCommandStore,RhizaCursorError,InteractionStore,hasRhizaSuccessor,type DispatcherDatabase,type JsonValue,type RhizaAdmissionRecord} from "@dispatcher/persistence";
import type {RhizaSnapshotV1,RhizaScope,RhizaEventPageV1,RhizaArtifactsV1,RhizaArtifactV1} from "@dispatcher/protocol";
import type {ControlPrincipal} from "./control-auth.js";
import {RhizaIngressError,type RhizaServiceAuth} from "./rhiza-auth.js";
import {rhizaDigest} from "./rhiza-semantics.js";
import {rhizaSubmissionHash} from "./rhiza-operations.js";
import type {RhizaJobs,RhizaJobRecord} from "./rhiza-jobs.js";
import {readRhizaArtifact} from "./rhiza-artifact-source.js";
import type {RunInputIdentity,RunInputReceipt} from "./run-inputs.js";

const json=(value:unknown):JsonValue=>JSON.parse(JSON.stringify(value)) as JsonValue;
/** Authorized projection of canonical facts; never probes or starts native work. */
export class RhizaViews {
 private readonly observations:RhizaObservationStore;private readonly artifacts:RhizaArtifactStore;
 constructor(private readonly db:DispatcherDatabase,private readonly auth:RhizaServiceAuth,private readonly jobs:RhizaJobs,private readonly now:()=>Date,private readonly canCancel:(run:Run)=>boolean=()=>false,private readonly canInput:(run:Run)=>boolean=()=>false){this.observations=new RhizaObservationStore(db);this.artifacts=new RhizaArtifactStore(db);}
 intervention(run:Run,owned?:RunInputIdentity):RhizaSnapshotV1["intervention"] {
  const task=this.db.getCanonicalTask<JsonValue>(run.taskId),control=new InteractionStore(this.db).control(run.sessionId);
  if(run.state!=="WAITING_USER"||(task?.document as unknown as Task)?.state!=="WAITING_USER"||(task?.document as unknown as Task)?.currentRunId!==run.id||control?.activeRunId!==run.id||control.state!=="AUTOMATED")return;
  const uncertain=(this.db.listEntities<JsonValue>("run-input") as unknown as RunInputReceipt[]).some(receipt=>receipt.runId===run.id&&receipt.sessionId===run.sessionId&&receipt.generation===run.generation&&["RESERVED","OUTCOME_UNKNOWN"].includes(receipt.state)&&!(owned&&receipt.state==="RESERVED"&&receipt.actorId===owned.actorId&&receipt.inputId===owned.inputId));
  return uncertain?undefined:{revision:control.revision,sessionId:run.sessionId,leaseId:run.leaseId,taskRevision:task!.revision};
 }
 authorize(principal:ControlPrincipal|undefined,scope:RhizaScope,jobId:string):{record:RhizaAdmissionRecord;job:RhizaJobRecord;task:Task}{
  const grant=this.auth.current(principal,[scope],undefined,{allowDisabled:true});
  const row=this.db.handle.prepare("SELECT * FROM rhiza_admissions WHERE client_id=? AND job_id=?").get(grant.id,jobId);
  if(!row)throw new RhizaIngressError("NOT_FOUND",404,"External job is unavailable");
  const record={clientId:grant.id,commandScope:"jobs.submit",requestId:String(row.request_id),requestHash:String(row.request_hash),jobId,taskId:String(row.task_id),repositoryId:String(row.repository_id),profileId:String(row.profile_id),authorityId:String(row.authority_id),receipt:JSON.parse(String(row.receipt_json)) as JsonValue} as RhizaAdmissionRecord;
  this.auth.current(principal,[scope],record,{allowDisabled:true});
  const job=this.db.getEntity<JsonValue>("rhiza-job",jobId) as unknown as RhizaJobRecord|undefined;
  if(!job||job.version!==1||job.jobId!==jobId||job.taskId!==record.taskId||job.principal.service?.clientId!==grant.id||rhizaSubmissionHash(job.request)!==record.requestHash)throw new RhizaIngressError("TARGET_AUTHORITY_CHANGED",409,"External job source requires reconciliation");
  const task=this.db.getCanonicalTask<JsonValue>(job.taskId)?.document as unknown as Task|undefined;
  if(!task||task.id!==job.taskId)throw new RhizaIngressError("TARGET_AUTHORITY_CHANGED",409,"Canonical job source is unavailable");
  return {record,job,task};
 }
 private run(job:RhizaJobRecord,task:Task):Run|undefined {
  const run=task?.currentRunId?this.db.getEntity<JsonValue>("run",task.currentRunId) as unknown as Run|undefined:undefined;
  const target=job.request.workOrder.target;
  return run?.id===task.currentRunId&&run?.taskId===job.taskId&&run.profileId===target.profileId&&run.providerId===target.harnessId&&run.runnerId===target.runnerId?run:undefined;
 }
 private candidate(job:RhizaJobRecord,run:Run):RhizaArtifactV1 {
  const task=this.db.getCanonicalTask<JsonValue>(job.taskId)?.document as unknown as Task|undefined;
  if(task?.currentRunId!==run.id||!["REVIEW","DONE"].includes(task.state))throw new RhizaIngressError("TARGET_AUTHORITY_CHANGED",409,"Canonical task does not authorize this candidate");
  this.jobs.assertCandidate(run);const proof=this.jobs.modelEvidence(run)!.evidence;
  const descriptor=readRhizaArtifact(this.db,job,run,proof);
  try{return this.artifacts.freeze({artifactId:descriptor.artifactId,jobId:job.jobId,runId:run.id,runGeneration:run.generation,commit:descriptor.commit,digest:descriptor.digest,descriptor:json(descriptor)}).descriptor as unknown as RhizaArtifactV1;}
  catch{throw new RhizaIngressError("TARGET_AUTHORITY_CHANGED",409,"The immutable candidate differs from current source facts");}
 }
 snapshot(principal:ControlPrincipal|undefined,jobId:string):RhizaSnapshotV1 {
  return this.db.transaction(()=>{
   const {record,job,task}=this.authorize(principal,"jobs:read",jobId),run=this.run(job,task),order=job.request.workOrder;
   let state:RhizaSnapshotV1["state"]=!task.currentRunId&&job.dispatch.state==="pending"?"accepted":"unknown",evidence:RhizaSnapshotV1["modelEvidence"];
   if(run){
    try{evidence=this.jobs.modelEvidence(run)?.evidence;}catch{/* An inconsistent source cannot qualify a candidate. */}
    if(["ACTIVE","VERIFYING","DELIVERING"].includes(run.state))state="running";
    else if(run.state==="WAITING_USER")state="waiting_input";
    else if(run.state==="FAILED")state="failed";
    else if(run.state==="COMPLETE"){try{this.candidate(job,run);state="candidate";}catch{state="unknown";}}
   }
   const commands=new RhizaCommandStore(this.db),cancellation=commands.forJob(jobId).find(command=>command.scope==="jobs.cancel"),stop=cancellation?commands.latest(cancellation.commandId):undefined;
   let processObservation:RhizaSnapshotV1["processObservation"]=!task.currentRunId&&job.dispatch.state==="pending"?"not_started":"unknown";
   if(cancellation){state="unknown";processObservation=stop?.state==="claimed"||!stop?"stop_requested":"unknown";
    const proof=stop?.proof as {kind?:string;runId?:string;runGeneration?:number;sessionId?:string;leaseId?:string}|undefined;
    if(stop?.state==="confirmed"&&proof?.kind==="not_sent"&&!task.currentRunId&&task.state==="CANCELLED"){state="canceled";processObservation="not_started";}
    if(stop?.state==="confirmed"&&proof?.kind==="stopped"&&run?.state==="CANCELLED"&&task.state==="CANCELLED"&&proof.runId===run.id&&proof.runGeneration===run.generation&&proof.sessionId===run.sessionId&&proof.leaseId===run.leaseId){state="canceled";processObservation="stopped";}
   }
   if(hasRhizaSuccessor(this.db,jobId)&&!["canceled","failed"].includes(state))state="unknown";
   const head=this.observations.head(jobId);if(!head)throw new RhizaIngressError("TARGET_AUTHORITY_CHANGED",409,"Durable job revision is unavailable");
   const grant=this.auth.current(principal,["jobs:read"],record,{allowDisabled:true});
   const cursor=this.observations.cursor({clientId:grant.id,jobId,authorizationHash:rhizaDigest(principal!.service),revision:head.revision},this.now());
   let intervention:RhizaSnapshotV1["intervention"];
   if(run&&!cancellation&&!hasRhizaSuccessor(this.db,jobId)&&this.canInput(run)){
    try{this.auth.current(principal,["jobs:input"],record);intervention=this.intervention(run);}
    catch(error){if(!(error instanceof RhizaIngressError))throw error;}
   }
   return {schemaVersion:1,jobId,taskId:job.taskId,revision:head.revision,state,origin:structuredClone(order.origin),target:{...structuredClone(order.target),targetHash:job.request.targetHash},inputHash:order.context.inputHash,processObservation,cancellationRequested:Boolean(cancellation)||task.state==="CANCELLED",allowedOperations:grant.scopes.filter(scope=>["jobs:read","events:read","artifacts:read"].includes(scope)||scope==="jobs:input"&&Boolean(intervention)||scope==="jobs:cancel"&&!cancellation&&(!task.currentRunId&&job.dispatch.state==="pending"||run&&this.canCancel(run)&&!["COMPLETE","FAILED","CANCELLED","SUPERSEDED"].includes(run.state))),cursor,updatedAt:head.updatedAt,...(run?{runId:run.id,runGeneration:run.generation}:{}),...(evidence?{modelEvidence:evidence}:{}),...(intervention?{intervention}:{})};
  });
 }
 events(principal:ControlPrincipal|undefined,input:{cursor?:string;jobId?:string}):RhizaEventPageV1 {
  return this.db.transaction(()=>{
   const grant=this.auth.current(principal,["events:read"],undefined,{allowDisabled:true}),authorizationHash=rhizaDigest(principal!.service);let position:{jobId:string;revision:number};
   try{position=input.cursor?this.observations.resume(input.cursor,grant.id,authorizationHash,this.now()):{jobId:input.jobId??"",revision:0};}catch(error){if(error instanceof RhizaCursorError)throw new RhizaIngressError("CURSOR_EXPIRED",409,"Fetch a fresh authorized snapshot");throw error;}
   if(!position.jobId||input.jobId&&input.jobId!==position.jobId)throw new RhizaIngressError("INVALID_REQUEST",400,"Cursor filters do not match the requested job");
   this.authorize(principal,"events:read",position.jobId);const events=this.observations.events(position.jobId,position.revision),revision=events.at(-1)?.revision??position.revision;
   const cursor=this.observations.cursor({clientId:grant.id,jobId:position.jobId,authorizationHash,revision},this.now());
   return {schemaVersion:"1",events,cursor,hasMore:revision<(this.observations.head(position.jobId)?.revision??revision)};
  });
 }
 artifactList(principal:ControlPrincipal|undefined,jobId:string):RhizaArtifactsV1 {
  return this.db.transaction(()=>{const {job,task}=this.authorize(principal,"artifacts:read",jobId),run=this.run(job,task);return {schemaVersion:1,jobId,artifacts:run?.state==="COMPLETE"?[this.candidate(job,run)]:[]};});
 }
}
