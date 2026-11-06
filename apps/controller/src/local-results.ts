import {resolveSnapshotVerification,preparationEvidenceQualifies,type SnapshotPreparation,type SnapshotPreparationEvidence} from "./snapshot-verification.js";
import {isDeepStrictEqual} from "node:util";
import type {ConfigurationEngine} from "@dispatcher/config";
import type {Run,Task,TaskContract,LocalReviewAuthority,LocalVerificationRequest,LocalAcceptanceRequest,LocalAcceptance,LocalResultReview} from "@dispatcher/domain";
import type {CanonicalTaskService} from "@dispatcher/integrations";
import {InteractionStore,type DispatcherDatabase,type JsonValue} from "@dispatcher/persistence";
import {VerificationRegistry,type VerificationCommand,type VerificationResult} from "@dispatcher/runner";
import {WorkspacePolicyError,type WorkspaceManager,type WorkspaceCandidate,type DeliveryCandidate,type VerificationSnapshots} from "@dispatcher/workspace";
import {redactNativeText,redactValue} from "@dispatcher/observability";
import {isGuardedControllerStart} from "./start-recovery.js";
import {contentHash,PublicationError} from "./task-publications.js";

interface ReviewContext extends LocalReviewAuthority {runId:string;taskId:string;sessionId:string;configRevision:number;contractHash:string;profileHash:string;repositoryHash:string;selectionHash:string}
interface ReviewState {run:Run;task:Task;context:ReviewContext;commands:VerificationCommand[];preparation?:SnapshotPreparation;repositoryId:string;repositoryScopePaths:string[];scopePaths:string[]}
interface VerificationReceipt {format:"canonical-local-verification-v1";id:string;actor:string;request:LocalVerificationRequest;context:ReviewContext;state:"SENDING"|"COMPLETED"|"FAILED"|"UNKNOWN";reasonCode?:string;preparation?:SnapshotPreparationEvidence;proof?:{executionBasis?:"isolated-snapshot-v1";snapshot:DeliveryCandidate;verifiedAt:string;commandIds:string[];checks:VerificationResult[]}}
const json=(value:unknown)=>JSON.parse(JSON.stringify(value)) as JsonValue;
const key=(run:Run)=>`${run.id}:g${run.generation}`;
function fail(code:string,message=code):never {throw new PublicationError(code,409,message);}
const text=(v:unknown):v is string=>typeof v==="string"&&v.length>0&&v.length<=200&&!Array.from(v).some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127);
const stableContext=(context:ReviewContext)=>{const value={...context};delete (value as Partial<ReviewContext>).taskRevision;delete (value as Partial<ReviewContext>).configRevision;return value;};
function preparationQualifies(state:ReviewState,receipt:VerificationReceipt):boolean {
 return preparationEvidenceQualifies({preparation:state.preparation,evidence:receipt.preparation,checks:receipt.proof?.checks,commandIds:receipt.proof?.commandIds,verification:state.commands});
}

/** Canonical Task approval only. A retired Run lease is compared as identity, never renewed or used for native input. */
export class CanonicalLocalResults {
 private readonly store:InteractionStore;
 private readonly active=new Map<string,{id:string;controller:AbortController;promise:Promise<LocalResultReview>}>();
 private closed=false;
 private cleanupUnknown=false;
 constructor(private readonly db:DispatcherDatabase,private readonly configuration:ConfigurationEngine,private readonly tasks:CanonicalTaskService,private readonly workspaces:WorkspaceManager,private readonly snapshots:VerificationSnapshots,private readonly now:()=>Date=()=>new Date()) {this.store=new InteractionStore(db);}
 private context(runId:string):ReviewState {
  const run=this.db.getEntity<JsonValue>("run",runId) as unknown as Run|undefined,task=run?this.db.getCanonicalTask<JsonValue>(run.taskId):undefined,document=task?.document as unknown as Task|undefined;
  if(!run||!task||!document||document.currentRunId!==runId||run.state!=="COMPLETE"||!["REVIEW","DONE"].includes(document.state)||!run.worktree||!run.branch)fail("LOCAL_RESULT_UNAVAILABLE");
  if((this.db.getEntity<JsonValue>("task-archive",run.taskId) as {archivedAt?:string}|undefined)?.archivedAt)fail("TASK_ARCHIVED");
  const control=this.store.control(run.sessionId);
  if(!control||control.state!=="AUTOMATED"||control.activeRunId!==run.id)fail("NATIVE_WRITE_LOCKED");
  const start=this.store.command(`native-start:${run.id}`),adapter=this.db.getEntity<JsonValue>("adapter-session",run.sessionId) as {state?:string}|undefined;
  if(!isGuardedControllerStart(this.db,run)||start?.state!=="ACKNOWLEDGED"||adapter?.state!=="COMPLETED")fail("LOCAL_REVIEW_UNQUALIFIED");
  if(this.db.handle.prepare("SELECT 1 FROM interaction_commands WHERE session_id=? AND state IN ('RESERVED','SENDING','UNKNOWN') LIMIT 1").get(run.sessionId))fail("NATIVE_COMMAND_OUTCOME_UNKNOWN");
  const contract=this.db.getEntity<JsonValue>("run-contract",run.id) as unknown as TaskContract|undefined,currentContract=this.db.getTaskContract<JsonValue>(run.taskId),frozen=this.db.getEntity<JsonValue>("run-verification-config",run.id) as unknown as VerificationCommand[]|undefined;
  if(!contract||contract.delivery.type!=="none"||contract.revision!==run.contractRevision||contentHash(contract)!==contentHash(currentContract)||!Array.isArray(frozen)||!contract.verification.length)fail("LOCAL_RESULT_UNAVAILABLE");
  const snapshot=this.configuration.current(),repositoryId=contract.workspace?.repositoryId??contract.delivery.repository,repository=snapshot.config.repositories.find(r=>r.id===repositoryId),profile=snapshot.config.agentProfiles.find(p=>p.id===run.profileId);
  if(!repository||!profile||profile.runnerId!==run.runnerId)fail("LOCAL_REVIEW_CONTEXT_CHANGED");
  const selection=resolveSnapshotVerification({marker:this.db.getEntity<JsonValue>("run-snapshot-verification-config",run.id),currentRepository:repository,frozenCommands:frozen,selectedIds:contract.verification,requirePreparationProfile:false});
  if(selection.state==="unavailable")fail(selection.code);
  const commands=selection.verification;
  return {run,task:document,commands:structuredClone(commands as VerificationCommand[]),...(selection.preparation?{preparation:selection.preparation}:{}),repositoryId:repository.id,repositoryScopePaths:[...repository.scopePaths],scopePaths:[...contract.scope],context:{runId:run.id,taskId:run.taskId,sessionId:run.sessionId,taskRevision:task.revision,generation:run.generation,leaseId:run.leaseId,controlEpoch:control.epoch,controlRevision:control.revision,configRevision:snapshot.revision,contractHash:contentHash(contract),selectionHash:contentHash(run.executionSelection),profileHash:contentHash(profile),repositoryHash:contentHash({repository,commands})}};
 }
 private assertContext(context:ReviewContext):void {if(this.closed||!isDeepStrictEqual(this.context(context.runId).context,context))fail("LOCAL_REVIEW_CONTEXT_CHANGED");}
 private authority(context:ReviewContext):LocalReviewAuthority {return {taskRevision:context.taskRevision,generation:context.generation,leaseId:context.leaseId,controlEpoch:context.controlEpoch,controlRevision:context.controlRevision};}
 private request(state:ReviewState,body:LocalVerificationRequest,actor:string):void {
  if(!text(actor)||!text(body.idempotencyKey)||body.confirmed!==true||!/^[a-f0-9]{64}$/u.test(body.candidateId))throw new PublicationError("LOCAL_REVIEW_CONFIRMATION_REQUIRED",400,"确认当前候选后再执行验证或接受。");
  if(!isDeepStrictEqual(this.authority(state.context),{taskRevision:body.taskRevision,generation:body.generation,leaseId:body.leaseId,controlEpoch:body.controlEpoch,controlRevision:body.controlRevision}))fail("LOCAL_REVIEW_AUTHORITY_CHANGED");
 }
 private current(runId:string):VerificationReceipt|undefined {const pointer=this.db.getEntity<JsonValue>("local-review-current",runId) as {id?:string}|undefined;const receipt=pointer?.id?this.db.getEntity<JsonValue>("local-review-verification",pointer.id) as unknown as VerificationReceipt|undefined:undefined;return receipt?.format==="canonical-local-verification-v1"?receipt:undefined;}
 private async assertSnapshot(snapshot:DeliveryCandidate,context:ReviewContext):Promise<void> {
  try{await this.snapshots.assertCandidateAuthority(snapshot,()=>this.assertContext(context));}
  catch(error){if(error instanceof PublicationError)throw error;if(error instanceof WorkspacePolicyError)fail(error.code);fail("LOCAL_RESULT_INSPECTION_UNAVAILABLE");}
 }
 private async candidate(state:ReviewState):Promise<WorkspaceCandidate>{const candidate=await this.workspaces.captureCandidate({repositoryId:state.repositoryId,worktree:state.run.worktree!,branch:state.run.branch!,scopePaths:state.scopePaths});this.assertContext(state.context);return candidate;}
 async read(runId:string):Promise<LocalResultReview> {
  const run=this.db.getEntity<JsonValue>("run",runId) as unknown as Run|undefined;if(!run)throw new PublicationError("RUN_NOT_FOUND",404,"运行不存在。");
  const base:LocalResultReview={version:1,runId,taskId:run.taskId,sessionId:run.sessionId,state:"unavailable"};
  const accepted=this.db.getEntity<JsonValue>("local-review-acceptance",key(run)) as unknown as LocalAcceptance|undefined;if(accepted){base.state="accepted";base.acceptance=accepted;return base;}
  const pending=this.current(runId);if(pending&&(pending.state==="SENDING"||pending.state==="UNKNOWN")){const owned=pending.state==="SENDING"&&this.active.get(runId)?.id===pending.id;base.state=owned?"running":"unknown";base.pendingVerification={id:pending.id,owned};base.reasonCode="VERIFICATION_OUTCOME_UNKNOWN";return base;}
  try{const state=this.context(runId),candidate=await this.candidate(state);base.authority=this.authority(state.context);base.candidate={id:candidate.id,headRevision:candidate.headRevision,files:candidate.changedFiles,worktree:state.run.worktree!};const receipt=this.current(runId);
   if(!receipt){base.state="unverified";return base;}
   if(receipt.state==="SENDING"||receipt.state==="UNKNOWN"){base.state=this.active.has(runId)?"running":"unknown";base.reasonCode="VERIFICATION_OUTCOME_UNKNOWN";return base;}
   if(receipt.state!=="COMPLETED"||!receipt.proof){base.state="failed";base.reasonCode=receipt.reasonCode??"REQUIRED_VERIFICATION_FAILED";return base;}
   if(receipt.proof.executionBasis!=="isolated-snapshot-v1"){base.state="unverified";base.reasonCode="ISOLATED_VERIFICATION_REQUIRED";return base;}
   if(!preparationQualifies(state,receipt)){base.state="unverified";base.reasonCode="SNAPSHOT_PREPARATION_REQUIRED";return base;}
   base.verification={id:receipt.id,verifiedAt:receipt.proof.verifiedAt,commandIds:receipt.proof.commandIds,basis:"matching-managed-source",snapshotCommit:receipt.proof.snapshot.commit};
   if(!isDeepStrictEqual(stableContext(receipt.context),stableContext(state.context))||receipt.proof.snapshot.candidate.id!==candidate.id){base.state="changed";base.reasonCode="CANDIDATE_CHANGED";return base;}
   await this.assertSnapshot(receipt.proof.snapshot,state.context);base.state="verified";return base;
  }catch(error){base.state="unavailable";base.reasonCode=error instanceof PublicationError?error.code:"LOCAL_RESULT_INSPECTION_UNAVAILABLE";return base;}
 }
 verify(runId:string,body:LocalVerificationRequest,actor:string):Promise<LocalResultReview> {
  if(this.closed)return Promise.reject(new PublicationError("CONTROLLER_STOPPING",409,"Controller 正在停止。"));
  try{body=structuredClone(body);const id=contentHash(["local-verification",runId,actor,body.idempotencyKey]),prior=this.db.getEntity<JsonValue>("local-review-verification",id) as unknown as VerificationReceipt|undefined;
   if(prior){if(!isDeepStrictEqual(prior.request,json(body))||prior.actor!==actor)fail("IDEMPOTENCY_CONFLICT");const work=this.active.get(runId);if(work?.id===id)return work.promise;if(prior.state==="SENDING"||prior.state==="UNKNOWN")fail("VERIFICATION_OUTCOME_UNKNOWN");return this.read(runId);}
   const state=this.context(runId);if(state.task.state!=="REVIEW")fail("TASK_REVIEW_REQUIRED");this.request(state,body,actor);
   const current=this.current(runId);if(current&&(current.state==="SENDING"||current.state==="UNKNOWN"))fail("VERIFICATION_OUTCOME_UNKNOWN");
   const receipt:VerificationReceipt={format:"canonical-local-verification-v1",id,actor,request:structuredClone(body),context:state.context,state:"SENDING"};
   this.db.transaction(()=>{this.assertContext(state.context);const latest=this.current(runId);if(latest&&(latest.state==="SENDING"||latest.state==="UNKNOWN"))fail("VERIFICATION_OUTCOME_UNKNOWN");this.db.saveEntity("local-review-verification",id,json(receipt));this.db.saveEntity("local-review-current",runId,{id});});
   const controller=new AbortController(),promise=this.perform(state,receipt,controller.signal).finally(()=>{if(this.active.get(runId)?.id===id)this.active.delete(runId);});this.active.set(runId,{id,controller,promise});return promise;
  }catch(error){return Promise.reject(error);}
 }
 private async perform(state:ReviewState,receipt:VerificationReceipt,signal:AbortSignal):Promise<LocalResultReview> {
  let executing=false;
  try{const candidate=await this.candidate(state);if(candidate.id!==receipt.request.candidateId)fail("CANDIDATE_CHANGED");
   const snapshot=await this.snapshots.createDeliveryCandidate({repositoryId:state.repositoryId,worktree:state.run.worktree!,branch:state.run.branch!,scopePaths:state.scopePaths,repositoryScopePaths:state.repositoryScopePaths},()=>this.assertContext(state.context));if(snapshot.candidate.id!==candidate.id)fail("CANDIDATE_CHANGED");
   const preparation=state.preparation?.commands??[],commands=[...preparation,...state.commands],registry=new VerificationRegistry();for(const command of commands)registry.register(command);const checks:VerificationResult[]=[];
   if(state.preparation)receipt.preparation={...structuredClone(state.preparation),checks:[]};
   for(const [index,command] of commands.entries()){
    await this.assertSnapshot(snapshot,state.context);if(signal.aborted)fail("LOCAL_VERIFICATION_CANCELLED");
    executing=true;const result=await registry.run(command.id,snapshot.path,signal);executing=false;
    const check={...result,output:redactNativeText(String(redactValue(result.output)))};checks.push(check);if(index<preparation.length)receipt.preparation!.checks.push(check);
    await this.assertSnapshot(snapshot,state.context);if(signal.aborted)fail("LOCAL_VERIFICATION_CANCELLED");
    if(index<preparation.length&&(result.status!=="passed"||result.exitCode!==0))fail("SNAPSHOT_PREPARATION_FAILED");
   }
   await this.assertSnapshot(snapshot,state.context);
   if(checks.some(c=>c.required&&c.status!=="passed")){receipt.state="FAILED";receipt.reasonCode="REQUIRED_VERIFICATION_FAILED";}
   else {receipt.state="COMPLETED";receipt.proof={executionBasis:"isolated-snapshot-v1",snapshot,verifiedAt:this.now().toISOString(),commandIds:commands.map(c=>c.id),checks};}
   this.db.transaction(()=>{this.assertContext(state.context);this.db.saveEntity("local-review-verification",receipt.id,json(receipt));});
  }catch(error){receipt.state=executing?"UNKNOWN":"FAILED";if(executing)this.cleanupUnknown=true;receipt.reasonCode=executing?"VERIFICATION_OUTCOME_UNKNOWN":error instanceof PublicationError?error.code:"LOCAL_VERIFICATION_FAILED";this.db.saveEntity("local-review-verification",receipt.id,json(receipt));}
  return this.read(state.run.id);
 }
 async accept(runId:string,body:LocalAcceptanceRequest,actor:string):Promise<{acceptance:LocalAcceptance;revision:number;repeated:boolean}> {
  body=structuredClone(body);
  const receiptId=contentHash(["local-acceptance",runId,actor,body.idempotencyKey]),previous=this.db.getEntity<JsonValue>("local-review-receipt",receiptId) as unknown as {request:LocalAcceptanceRequest;acceptance:LocalAcceptance;revision:number}|undefined;
  if(previous){if(!isDeepStrictEqual(previous.request,json(body)))fail("IDEMPOTENCY_CONFLICT");return {acceptance:previous.acceptance,revision:previous.revision,repeated:true};}
  const state=this.context(runId);if(state.task.state!=="REVIEW")fail("TASK_REVIEW_REQUIRED");this.request(state,body,actor);const receipt=this.current(runId);
  if(!receipt||receipt.state!=="COMPLETED"||!receipt.proof||receipt.proof.executionBasis!=="isolated-snapshot-v1"||!preparationQualifies(state,receipt)||receipt.id!==body.verificationId)fail("VERIFIED_CANDIDATE_REQUIRED");
  if(receipt.proof.snapshot.candidate.id!==body.candidateId||!isDeepStrictEqual(stableContext(receipt.context),stableContext(state.context)))fail("CANDIDATE_CHANGED");
  const candidate=await this.candidate(state);if(candidate.id!==body.candidateId)fail("CANDIDATE_CHANGED");await this.assertSnapshot(receipt.proof.snapshot,state.context);
  return this.db.transaction(()=>{const prior=this.db.getEntity<JsonValue>("local-review-receipt",receiptId) as unknown as {request:LocalAcceptanceRequest;acceptance:LocalAcceptance;revision:number}|undefined;if(prior){if(!isDeepStrictEqual(prior.request,json(body)))fail("IDEMPOTENCY_CONFLICT");return {acceptance:prior.acceptance,revision:prior.revision,repeated:true};}
   this.assertContext(state.context);if(this.current(runId)?.id!==receipt.id)fail("VERIFIED_CANDIDATE_REQUIRED");
   const acceptance:LocalAcceptance={version:1,taskId:state.run.taskId,runId,generation:state.run.generation,candidateId:body.candidateId,verificationId:receipt.id,snapshotCommit:receipt.proof!.snapshot.commit,actor,acceptedAt:this.now().toISOString()};
   const result=this.tasks.execute({id:`local-review:${receiptId}`,taskId:state.run.taskId,baseRevision:body.taskRevision,actor,command:{type:"task.transition",state:"DONE"}});this.db.saveEntity("local-review-acceptance",key(state.run),json(acceptance));this.db.saveEntity("local-review-receipt",receiptId,json({request:body,acceptance,revision:result.revision}));return {acceptance,revision:result.revision,repeated:false};});
 }
 async cancel(runId:string,verificationId:string,actor:string):Promise<LocalResultReview> {
  const receipt=this.current(runId);if(!receipt||receipt.id!==verificationId)fail("VERIFICATION_NOT_OWNED");
  if(receipt.actor!==actor)throw new PublicationError("FORBIDDEN",403,"只能停止本人提交的验证。");
  if(receipt.state==="UNKNOWN")fail("VERIFICATION_OUTCOME_UNKNOWN");
  const active=this.active.get(runId);if(active?.id!==verificationId){if(receipt.state==="SENDING")fail("VERIFICATION_OUTCOME_UNKNOWN");return this.read(runId);}
  // Cleanup is limited to the captured verifier, even if Task/control authority changed.
  active.controller.abort();await active.promise;return this.read(runId);
 }
 async close():Promise<void>{this.closed=true;const work=[...this.active.values()];for(const item of work)item.controller.abort();await Promise.allSettled(work.map(item=>item.promise));if(this.cleanupUnknown)fail("LOCAL_VERIFICATION_CLEANUP_UNKNOWN");}
}
