import {randomUUID} from "node:crypto";
import type {Run} from "@dispatcher/domain";
import {RhizaCommandStore,RhizaObservationStore,type DispatcherDatabase,type JsonValue,type RhizaCommandRecord} from "@dispatcher/persistence";
import type {RhizaCancellationRequestV1,RhizaControlReceiptV1} from "@dispatcher/protocol";
import type {ControlPrincipal} from "./control-auth.js";
import {RhizaIngressError,type RhizaServiceAuth} from "./rhiza-auth.js";
import type {RhizaViews} from "./rhiza-views.js";
import {rhizaDigest} from "./rhiza-semantics.js";
const json=(value:unknown):JsonValue=>JSON.parse(JSON.stringify(value)) as JsonValue;
export interface RhizaStopProof {kind:"stopped";runId:string;runGeneration:number;sessionId:string;leaseId:string}
interface Options {now():Date;schedule?(op:()=>Promise<void>):void;supports(run:Run):boolean;stop(run:Run,principal:ControlPrincipal,guard:()=>void):Promise<RhizaStopProof>;cancelUnstarted(taskId:string,commandId:string,guard:()=>void):void}
/** Receipt acceptance never claims that an external process has stopped. */
export class RhizaCancellations {
 private readonly store:RhizaCommandStore;private readonly active=new Set<Promise<void>>();private closed=false;
 constructor(private readonly db:DispatcherDatabase,private readonly auth:RhizaServiceAuth,private readonly views:RhizaViews,private readonly options:Options){
  this.store=new RhizaCommandStore(db);
  for(const command of this.store.all())if(command.scope==="jobs.cancel"&&!["confirmed","unknown"].includes(this.store.latest(command.commandId)?.state??""))this.store.observe(command.commandId,"unknown",{code:"STOP_UNCONFIRMED"},options.now().toISOString());
 }
 closeAdmissions():void{this.closed=true;}
 async drain():Promise<void>{await Promise.allSettled([...this.active]);}
 accept(principal:ControlPrincipal|undefined,jobId:string,input:RhizaCancellationRequestV1):RhizaControlReceiptV1 {
  const request=structuredClone(input),hash=rhizaDigest({jobId,request});let created:RhizaCommandRecord|undefined;
  const receipt=this.db.transaction(()=>{
   const {record,job,task}=this.views.authorize(principal,"jobs:cancel",jobId),grant=this.auth.current(principal,["jobs:cancel"],record,{allowDisabled:true});
   const previous=this.store.get(grant.id,"jobs.cancel",request.requestId);if(previous){if(previous.jobId!==jobId||previous.semanticsHash!==hash)throw new RhizaIngressError("IDEMPOTENCY_CONFLICT",409,"Command ID already binds another cancellation");return previous.receipt as unknown as RhizaControlReceiptV1;}
   if(this.closed)throw new RhizaIngressError("INGRESS_DISABLED",503,"External controls are closing");
   if(request.expectedJobRevision!==new RhizaObservationStore(this.db).head(jobId)?.revision)throw new RhizaIngressError("REVISION_CONFLICT",409,"Refresh the authorized job snapshot");
   if(request.generation!==job.request.workOrder.origin.generation||request.runId!==(task.currentRunId??null))throw new RhizaIngressError("TARGET_AUTHORITY_CHANGED",409,"Cancellation belongs to another execution generation");
   const run=task.currentRunId?this.db.getEntity<JsonValue>("run",task.currentRunId) as unknown as Run|undefined:undefined;
   if(run&&(run.taskId!==job.taskId||run.generation!==request.runGeneration||run.profileId!==job.request.workOrder.target.profileId||run.providerId!==job.request.workOrder.target.harnessId||run.runnerId!==job.request.workOrder.target.runnerId))throw new RhizaIngressError("TARGET_AUTHORITY_CHANGED",409,"Canonical cancellation target changed");
   if(run&&!this.options.supports(run))throw new RhizaIngressError("OPERATION_UNSUPPORTED",409,"Frozen backend has no qualified cancellation path");
   if(task.currentRunId&&!run||run&&["COMPLETE","FAILED","CANCELLED","SUPERSEDED"].includes(run.state)||!run&&job.dispatch.state!=="pending"||this.store.hasCancellation(job.taskId))throw new RhizaIngressError("STOP_UNCONFIRMED",409,"Original execution requires reconciliation; no new stop is inferred");
   const accepted:RhizaControlReceiptV1={schemaVersion:1,commandId:randomUUID(),requestId:request.requestId,jobId,kind:"cancel",state:"accepted",acceptedAt:this.options.now().toISOString()};
   created={clientId:grant.id,scope:"jobs.cancel",requestId:request.requestId,commandId:accepted.commandId,jobId,semanticsHash:hash,request:json(request),receipt:json(accepted),fence:run?json({runId:run.id,runGeneration:run.generation,sessionId:run.sessionId,leaseId:run.leaseId,selectionHash:rhizaDigest(run.executionSelection??null)}):{runId:null}};
   this.store.insert(created);
   if(!run){
    const guard=()=>{this.auth.current(principal,["jobs:cancel"],record,{allowDisabled:true});};
    guard();job.dispatch={state:"unknown",code:"CANCELLATION_REQUESTED"};this.db.saveEntity("rhiza-job",jobId,json(job));this.options.cancelUnstarted(job.taskId,accepted.commandId,guard);this.store.observe(accepted.commandId,"confirmed",{kind:"not_sent",runId:null},this.options.now().toISOString());created=undefined;
   }
   return accepted;
  });
  if(created){const command=created;const work=()=>{const operation=this.perform(command,principal!).catch(()=>undefined);this.active.add(operation);void operation.finally(()=>this.active.delete(operation));return operation;};try{(this.options.schedule??(op=>queueMicrotask(()=>{void op();})))(work);}catch{this.store.observe(command.commandId,"unknown",{code:"STOP_UNCONFIRMED"},this.options.now().toISOString());}}
  return receipt;
 }
 private async perform(command:RhizaCommandRecord,principal:ControlPrincipal):Promise<void>{
  if(this.store.latest(command.commandId))return;
  try{
   const fence=command.fence as {runId:string;runGeneration:number;sessionId:string;leaseId:string;selectionHash:string};
   const guard=()=>{
    if(this.closed)throw Error("CONTROLLER_STOPPING");
    const status=this.store.latest(command.commandId);if(status&&status.state!=="claimed")throw new RhizaIngressError("STOP_UNCONFIRMED",409,"Original cancellation is no longer owned");
    const {task,job}=this.views.authorize(principal,"jobs:cancel",command.jobId),run=this.db.getEntity<JsonValue>("run",fence.runId) as unknown as Run|undefined;
    if(task.currentRunId!==fence.runId||!run||run.generation!==fence.runGeneration||run.sessionId!==fence.sessionId||run.leaseId!==fence.leaseId||rhizaDigest(run.executionSelection??null)!==fence.selectionHash||run.profileId!==job.request.workOrder.target.profileId||run.providerId!==job.request.workOrder.target.harnessId||run.runnerId!==job.request.workOrder.target.runnerId||!this.options.supports(run))throw new RhizaIngressError("TARGET_AUTHORITY_CHANGED",409,"Original stop authority changed");
   };
   guard();this.store.observe(command.commandId,"claimed",{},this.options.now().toISOString());
   const run=this.db.getEntity<JsonValue>("run",fence.runId) as unknown as Run,proof=await this.options.stop(run,principal,guard);
   if(proof.kind!=="stopped"||proof.runId!==fence.runId||proof.runGeneration!==fence.runGeneration||proof.sessionId!==fence.sessionId||proof.leaseId!==fence.leaseId)throw Error("STOP_UNCONFIRMED");
   this.store.observe(command.commandId,"confirmed",json(proof),this.options.now().toISOString());
  }catch{if(!["confirmed","unknown"].includes(this.store.latest(command.commandId)?.state??""))this.store.observe(command.commandId,"unknown",{code:"STOP_UNCONFIRMED"},this.options.now().toISOString());}
 }
}
