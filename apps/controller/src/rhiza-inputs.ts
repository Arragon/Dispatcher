import {randomUUID} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import type {Run} from "@dispatcher/domain";
import {RhizaCommandStore,RhizaObservationStore,hasRhizaSuccessor,type DispatcherDatabase,type JsonValue,type RhizaCommandRecord} from "@dispatcher/persistence";
import type {RhizaControlReceiptV1,RhizaInputRequestV1} from "@dispatcher/protocol";
import type {ControlPrincipal} from "./control-auth.js";
import {RhizaIngressError,type RhizaServiceAuth} from "./rhiza-auth.js";
import type {RhizaViews} from "./rhiza-views.js";
import {rhizaDigest} from "./rhiza-semantics.js";
import {InputReceiptError,type RunInputReceipts,type RunInputIdentity,type RunInputAuthority} from "./run-inputs.js";
const json=(value:unknown):JsonValue=>JSON.parse(JSON.stringify(value)) as JsonValue;
export interface RhizaInputReservation {input:RunInputIdentity;authority:RunInputAuthority}
interface Options {now():Date;schedule?(op:()=>Promise<void>):void;supports(run:Run,phase:"admission"|"effect"):boolean;prepare(run:Run,request:RhizaInputRequestV1,principal:ControlPrincipal):RhizaInputReservation;send(run:Run,request:RhizaInputRequestV1,reservation:RhizaInputReservation,guard:()=>void):Promise<void>}
interface Fence {runId:string;runGeneration:number;sessionId:string;leaseId:string;selectionHash:string;reservation:RhizaInputReservation}
/** Uses the canonical input reservation and sender; never replays an uncertain native input. */
export class RhizaInputs {
 private readonly store:RhizaCommandStore;private readonly active=new Set<Promise<void>>();private closed=false;
 constructor(private readonly db:DispatcherDatabase,private readonly auth:RhizaServiceAuth,private readonly views:RhizaViews,private readonly receipts:RunInputReceipts,private readonly options:Options){
  this.store=new RhizaCommandStore(db);
  for(const command of this.store.all())if(command.scope==="jobs.input"&&!["confirmed","unknown"].includes(this.store.latest(command.commandId)?.state??"")){
   const fence=command.fence as unknown as Fence;const receipt=this.receipts.read(fence.reservation.input);if(receipt?.state==="RESERVED")this.receipts.finish(fence.reservation.input,"OUTCOME_UNKNOWN");this.store.observe(command.commandId,"unknown",{code:"INPUT_OUTCOME_UNKNOWN"},options.now().toISOString());
  }
 }
 closeAdmissions():void{this.closed=true;}
 async drain():Promise<void>{await Promise.allSettled([...this.active]);}
 accept(principal:ControlPrincipal|undefined,jobId:string,input:RhizaInputRequestV1):RhizaControlReceiptV1 {
  const request=structuredClone(input),hash=rhizaDigest({jobId,request});let created:RhizaCommandRecord|undefined;
  let receipt:RhizaControlReceiptV1;
  try{receipt=this.db.transaction(()=>{
   const {record,job,task}=this.views.authorize(principal,"jobs:input",jobId),grant=this.auth.current(principal,["jobs:input"],record),previous=this.store.get(grant.id,"jobs.input",request.requestId);
   if(previous){if(previous.jobId!==jobId||previous.semanticsHash!==hash)throw new RhizaIngressError("IDEMPOTENCY_CONFLICT",409,"Command ID already binds another input");return previous.receipt as unknown as RhizaControlReceiptV1;}
   if(hasRhizaSuccessor(this.db,jobId))throw new RhizaIngressError("TARGET_AUTHORITY_CHANGED",409,"An explicit successor owns this external attempt");
   if(this.closed)throw new RhizaIngressError("INGRESS_DISABLED",503,"External input is closing");
   if(!request.input.trim())throw new RhizaIngressError("INVALID_REQUEST",400,"A nonempty bounded input is required");
   if(new RhizaObservationStore(this.db).head(jobId)?.revision!==request.expectedJobRevision)throw new RhizaIngressError("REVISION_CONFLICT",409,"Refresh the authorized job snapshot");
   const run=this.db.getEntity<JsonValue>("run",request.runId) as unknown as Run|undefined,selection=run?.executionSelection,target=job.request.workOrder.target;
   if(!run||task.currentRunId!==run.id||run.taskId!==job.taskId||run.state!=="WAITING_USER"||task.state!=="WAITING_USER"||request.generation!==job.request.workOrder.origin.generation||request.runGeneration!==run.generation||request.sessionId!==run.sessionId||request.leaseId!==run.leaseId||request.taskRevision!==this.db.getCanonicalTask(job.taskId)?.revision||run.profileId!==target.profileId||run.providerId!==target.harnessId||run.runnerId!==target.runnerId||selection?.selectionType!=="explicit-model"||selection.requestedModel!==target.modelId||selection.backendId!==target.backendId||selection.contextFingerprint!==target.contextFingerprint||!isDeepStrictEqual(selection.nativeParameters,target.modelOptions))throw new RhizaIngressError("TARGET_AUTHORITY_CHANGED",409,"Input belongs to another frozen waiting execution");
   if(this.store.hasCancellation(job.taskId))throw new RhizaIngressError("STOP_UNCONFIRMED",409,"Cancellation forbids continuation");
   if(!this.options.supports(run,"admission"))throw new RhizaIngressError("OPERATION_UNSUPPORTED",409,"Frozen backend does not support the original session input");
   const intervention=this.views.intervention(run);if(!intervention||intervention.revision!==request.interventionRevision)throw new RhizaIngressError("REVISION_CONFLICT",409,"Waiting intervention changed or an input remains uncertain");
   const reservation=this.options.prepare(run,request,principal!);this.receipts.assertAvailable(reservation.input);this.receipts.reserve(reservation.input);
   const accepted:RhizaControlReceiptV1={schemaVersion:1,commandId:randomUUID(),requestId:request.requestId,jobId,kind:"input",state:"accepted",acceptedAt:this.options.now().toISOString()};
   created={clientId:grant.id,scope:"jobs.input",requestId:request.requestId,commandId:accepted.commandId,jobId,semanticsHash:hash,request:json(request),receipt:json(accepted),fence:json({runId:run.id,runGeneration:run.generation,sessionId:run.sessionId,leaseId:run.leaseId,selectionHash:rhizaDigest(run.executionSelection),reservation})};this.store.insert(created);return accepted;
  });}catch(error){if(error instanceof InputReceiptError)throw new RhizaIngressError(error.code==="INPUT_PENDING"?"INPUT_PENDING":"INPUT_OUTCOME_UNKNOWN",409,"Original input reservation must be reconciled");throw error;}
  if(created){const command=created;const work=()=>{const operation=this.perform(command,principal!).catch(()=>undefined);this.active.add(operation);void operation.finally(()=>this.active.delete(operation));return operation;};try{(this.options.schedule??(op=>queueMicrotask(()=>{void op();})))(work);}catch{const fence=command.fence as unknown as Fence;this.receipts.finish(fence.reservation.input,"REJECTED");this.store.observe(command.commandId,"confirmed",{kind:"not_sent"},this.options.now().toISOString());}}
  return receipt;
 }
 private async perform(command:RhizaCommandRecord,principal:ControlPrincipal):Promise<void>{
  if(this.store.latest(command.commandId))return;const fence=command.fence as unknown as Fence,request=command.request as unknown as RhizaInputRequestV1;let invoked=false;
  try{
   const guard=()=>{
    if(this.closed)throw Error("CONTROLLER_STOPPING");const status=this.store.latest(command.commandId);if(status&&status.state!=="claimed")throw Error("INPUT_OUTCOME_UNKNOWN");
    if(hasRhizaSuccessor(this.db,command.jobId))throw new RhizaIngressError("TARGET_AUTHORITY_CHANGED",409,"An explicit successor owns this external attempt");
    const {record,task,job}=this.views.authorize(principal,"jobs:input",command.jobId);this.auth.current(principal,["jobs:input"],record);
    const run=this.db.getEntity<JsonValue>("run",fence.runId) as unknown as Run|undefined;this.receipts.assertAvailable(fence.reservation.input,fence.reservation.input);
    if(!run||task.currentRunId!==run.id||task.state!=="WAITING_USER"||run.state!=="WAITING_USER"||run.generation!==fence.runGeneration||run.sessionId!==fence.sessionId||run.leaseId!==fence.leaseId||rhizaDigest(run.executionSelection??null)!==fence.selectionHash||run.profileId!==job.request.workOrder.target.profileId||run.providerId!==job.request.workOrder.target.harnessId||run.runnerId!==job.request.workOrder.target.runnerId||this.db.getCanonicalTask(run.taskId)?.revision!==request.taskRevision||this.store.hasCancellation(run.taskId)||this.views.intervention(run,fence.reservation.input)?.revision!==request.interventionRevision||!this.options.supports(run,"effect"))throw new RhizaIngressError("TARGET_AUTHORITY_CHANGED",409,"Original input authority changed");
   };
   guard();this.store.observe(command.commandId,"claimed",{},this.options.now().toISOString());invoked=true;
   await this.options.send(this.db.getEntity<JsonValue>("run",fence.runId) as unknown as Run,request,fence.reservation,guard);
   if(this.receipts.read(fence.reservation.input)?.state!=="ACCEPTED")throw Error("INPUT_OUTCOME_UNKNOWN");
   this.store.observe(command.commandId,"confirmed",{kind:"input_accepted",runId:fence.runId,sessionId:fence.sessionId,inputId:fence.reservation.input.inputId},this.options.now().toISOString());
  }catch(error){
   let receipt=this.receipts.read(fence.reservation.input);if(receipt?.state==="RESERVED")receipt=this.receipts.finish(fence.reservation.input,invoked?"OUTCOME_UNKNOWN":"REJECTED");
   const code=error&&typeof error==="object"&&"code" in error?String(error.code):"";
   const reasonCode=error instanceof InputReceiptError||error instanceof RhizaIngressError?error.code:["SELECTION_CHANGED","RUN_CONTEXT_UNAVAILABLE","STALE_TASK_REVISION","STALE_CONTROL_REVISION","NATIVE_WRITE_LOCKED","MODEL_BINDING_DRIFT","SESSION_CONTEXT_CHANGED","NATIVE_STATE_UNKNOWN"].includes(code)?code:"INPUT_OUTCOME_UNKNOWN";
   if(!["confirmed","unknown"].includes(this.store.latest(command.commandId)?.state??""))this.store.observe(command.commandId,receipt?.state==="REJECTED"?"confirmed":"unknown",receipt?.state==="REJECTED"?{kind:"not_sent",reasonCode}:{code:"INPUT_OUTCOME_UNKNOWN",reasonCode},this.options.now().toISOString());
  }
 }
}
