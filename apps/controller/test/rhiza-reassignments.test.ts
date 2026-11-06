import {createHash} from "node:crypto";
import {afterEach,expect,it,vi} from "vitest";
import {CredentialContext} from "../src/credential-context.js";
import {RhizaServiceAuth} from "../src/rhiza-auth.js";
import {RhizaReassignments} from "../src/rhiza-reassignments.js";
import {rhizaApprovalDigest} from "../src/rhiza-semantics.js";
import {RhizaAdmissionStore,RhizaCommandStore,RhizaObservationStore,ModelInvocationStore,type JsonValue} from "@dispatcher/persistence";
import {rhizaReadJobFixture,seedRhizaCandidate} from "./fixtures/rhiza-read-job.js";
import {clientToken} from "./fixtures/rhiza-service.js";
import type {RhizaJobRecord} from "../src/rhiza-jobs.js";
import {rhizaSubmissionHash} from "../src/rhiza-operations.js";
import type {ControlPrincipal} from "../src/control-auth.js";
const opened:Awaited<ReturnType<typeof rhizaReadJobFixture>>[]=[];
afterEach(async()=>{for(const f of opened.splice(0))await f.close();});
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function setup(mode:"queued"|"completed"|"stopped"|"failed"="queued"){
 const f=await rhizaReadJobFixture(mode==="completed",mode==="queued");opened.push(f);const db=f.service.database;
 if(mode==="queued"){
  const task=db.getCanonicalTask<JsonValue>(f.taskId)!;db.writeCanonicalTask(f.taskId,task.revision,{...(task.document as object),currentRunId:null,state:"CANCELLED"});
  const job=db.getEntity<JsonValue>("rhiza-job",f.jobId) as Record<string,JsonValue>;db.saveEntity("rhiza-job",f.jobId,{...job,dispatch:{state:"unknown",code:"CANCELLATION_REQUESTED"}});
  const controls=new RhizaCommandStore(db);controls.insert({clientId:"client-a",scope:"jobs.cancel",requestId:"queued-stop",commandId:"queued-stop",jobId:f.jobId,semanticsHash:"a".repeat(64),request:{runId:null,generation:f.request.workOrder.origin.generation},receipt:{state:"accepted"},fence:{runId:null}});controls.observe("queued-stop","confirmed",{kind:"not_sent",runId:null},f.clock.now.toISOString());
 }else if(mode==="stopped"){
  f.run.state="CANCELLED";db.saveEntity("run",f.runId,JSON.parse(JSON.stringify(f.run)));const task=db.getCanonicalTask<JsonValue>(f.taskId)!;db.writeCanonicalTask(f.taskId,task.revision,{...(task.document as object),state:"CANCELLED"});
  const session=db.getEntity<JsonValue>("adapter-session",f.sessionId) as Record<string,JsonValue>,fence={runId:f.runId,sessionId:f.sessionId,generation:f.run.generation,leaseId:f.run.leaseId};db.saveEntity("adapter-session",f.sessionId,{...session,state:"CANCELLED",authority:{stopState:"confirmed",stopIntent:{operation:"cancel",fence}}});
  const controls=new RhizaCommandStore(db);controls.insert({clientId:"client-a",scope:"jobs.cancel",requestId:"owned-stop",commandId:"owned-stop",jobId:f.jobId,semanticsHash:"a".repeat(64),request:{runId:f.runId,generation:f.request.workOrder.origin.generation},receipt:{state:"accepted"},fence});controls.observe("owned-stop","confirmed",{kind:"stopped",runId:f.runId,runGeneration:f.run.generation,sessionId:f.sessionId,leaseId:f.run.leaseId},f.clock.now.toISOString());new ModelInvocationStore(db).appendCompletion({version:1,invocationId:`invocation-${f.jobId}`,runId:f.runId,sessionId:f.sessionId,profileId:f.run.profileId,backendId:f.request.workOrder.target.backendId,providerSessionId:f.run.providerSessionId!,producer:"owned-process-group",outcome:"cancelled",execution:{generation:f.run.generation,attempt:f.run.attempt,leaseId:f.run.leaseId},completedAt:f.clock.now.toISOString()});
 }else{
  if(mode==="failed"){f.run.state="FAILED";db.saveEntity("run",f.runId,JSON.parse(JSON.stringify(f.run)));const task=db.getCanonicalTask<JsonValue>(f.taskId)!;db.writeCanonicalTask(f.taskId,task.revision,{...(task.document as object),state:"FAILED"});const session=db.getEntity<JsonValue>("adapter-session",f.sessionId) as Record<string,JsonValue>;db.saveEntity("adapter-session",f.sessionId,{...session,state:"FAILED"});}else seedRhizaCandidate(f);const id=`invocation-${f.jobId}`;new ModelInvocationStore(db).appendCompletion({version:1,invocationId:id,runId:f.runId,sessionId:f.sessionId,profileId:f.run.profileId,backendId:f.request.workOrder.target.backendId,providerSessionId:f.run.providerSessionId!,producer:"owned-process-group",outcome:mode==="failed"?"failed":"completed",execution:{generation:f.run.generation,attempt:f.run.attempt,leaseId:f.run.leaseId},completedAt:f.clock.now.toISOString()});
 }
 if(mode!=="queued"){db.saveEntity("session",f.sessionId,{id:f.sessionId,profileId:f.run.profileId,providerId:f.run.providerId});const control={version:1,sessionId:f.sessionId,activeRunId:f.runId,state:"AUTOMATED",epoch:1,revision:1,exclusion:"none",updatedAt:f.clock.now.toISOString()};db.handle.prepare("INSERT INTO session_controls(session_id,active_run_id,epoch,revision,state,document_json) VALUES(?,?,?,?,?,?)").run(f.sessionId,f.runId,1,1,"AUTOMATED",JSON.stringify(control));}
 const auth=new RhizaServiceAuth({config:()=>f.service.configuration.current().config,secrets:f.secrets,credentials:new CredentialContext(db),now:()=>f.clock.now,authorizationRevision:()=>f.service.configuration.current().revision,capabilities:()=>["jobs.reassign"]});
 const decision=await auth.authenticate(clientToken,{method:"POST",url:"/api/integrations/rhiza/v1/jobs",routePath:"/api/integrations/rhiza/v1/jobs",protocol:"http",ip:"127.0.0.1",headers:{host:"localhost"}}),principal=(decision as {principal:ControlPrincipal}).principal;
 const order={...structuredClone(f.request.workOrder),origin:{...f.request.workOrder.origin,executionRunId:"new-execution",dispatchId:"new-dispatch",generation:6},approval:{...f.request.workOrder.approval,reference:"new-approval"},reassignment:{jobId:f.jobId,expectedJobRevision:new RhizaObservationStore(db).head(f.jobId)!.revision,runId:mode==="queued"?null:f.runId,...(mode!=="queued"?{runGeneration:f.run.generation}:{})}};order.approval.digest=rhizaApprovalDigest(order);
 return {...f,db,auth,principal,order,attempts:new RhizaReassignments(db,auth,()=>f.clock.now)};
}
it.each(["queued","stopped","completed","failed"] as const)("allows a new precise attempt only after qualified %s resolution",async mode=>{
 const f=await setup(mode);expect(()=>f.attempts.check(f.principal,f.order)).not.toThrow();
});
it.each(["workspace","authority","run","dispatch","generation","approval","revision","workflow"] as const)("rejects a changed or reused %s lineage fence",async field=>{
 const f=await setup(),order=structuredClone(f.order);
 if(field==="workspace")order.origin.workspaceId="foreign";if(field==="authority")order.origin.authorityId="foreign";if(field==="run")order.origin.executionRunId=f.request.workOrder.origin.executionRunId;if(field==="dispatch")order.origin.dispatchId=f.request.workOrder.origin.dispatchId;if(field==="generation")order.origin.generation=f.request.workOrder.origin.generation;if(field==="approval")order.approval.reference=f.request.workOrder.approval.reference;if(field==="revision")order.reassignment.expectedJobRevision--;if(field==="workflow")order.origin.workflowRunId="foreign-workflow";
 expect(()=>f.attempts.check(f.principal,order)).toThrow();
});
it.each((["stopped","completed"] as const).flatMap(mode=>(["input","git-commit","git-push","pr-create","control","native-command","native-queue","external-write","unqualified-completion"] as const).map(uncertainty=>[mode,uncertainty] as const)))("blocks %s predecessor with %s uncertainty",async(mode,uncertainty)=>{
 const f=await setup(mode);
 if(uncertainty==="input")f.db.saveEntity("run-input","old-episode",{runId:f.runId,generation:f.run.generation,sessionId:f.sessionId,authorityHash:"different-old-episode",state:"OUTCOME_UNKNOWN"});
 if(uncertainty==="git-commit"||uncertainty==="git-push")f.db.saveEntity(uncertainty==="git-commit"?"local-git-delivery":"git-push-delivery",hash({runId:f.runId,generation:f.run.generation}),{state:"PENDING"});
 if(uncertainty==="pr-create")f.db.saveEntity("scm-pr-intent",hash({taskId:f.taskId,runId:f.runId,generation:f.run.generation}),{state:"PENDING"});
 if(uncertainty==="control")new RhizaCommandStore(f.db).insert({clientId:"client-a",scope:"jobs.input",requestId:"pending-input",commandId:"pending-input",jobId:f.jobId,semanticsHash:"a".repeat(64),request:{},receipt:{state:"accepted"},fence:{runId:f.runId}});
 if(uncertainty==="native-command"||uncertainty==="native-queue"){f.db.saveEntity("session",f.sessionId,{id:f.sessionId,profileId:f.run.profileId});f.db.handle.prepare("INSERT INTO interaction_commands(id,session_id,semantic_hash,state,revision,document_json) VALUES(?,?,?,?,?,?)").run("native-pending",f.sessionId,"hash",uncertainty==="native-command"?"SENDING":"ACKNOWLEDGED",1,JSON.stringify({nativeReceipt:{state:"queued"}}));}
 if(uncertainty==="external-write")f.db.saveEntity("native-external-write-blocker",f.sessionId,{sessionId:f.sessionId,runId:f.runId,generation:f.run.generation,leaseId:f.run.leaseId});
 if(uncertainty==="unqualified-completion"&&mode==="stopped"){const session=f.db.getEntity<JsonValue>("adapter-session",f.sessionId) as Record<string,JsonValue>;f.db.saveEntity("adapter-session",f.sessionId,{...session,authority:{stopState:"confirmed",stopIntent:{operation:"cancel",fence:{runId:f.runId,sessionId:f.sessionId,generation:f.run.generation,leaseId:"wrong-lease"}}}});}
 if(uncertainty==="unqualified-completion"&&mode==="completed")f.db.handle.prepare("UPDATE entities SET document_json=json_set(document_json,'$.modelInvocationId','not-this-turn') WHERE kind='adapter-session' AND id=?").run(f.sessionId);
 f.order.reassignment.expectedJobRevision=new RhizaObservationStore(f.db).head(f.jobId)!.revision;expect(()=>f.attempts.check(f.principal,f.order)).toThrow(expect.objectContaining({code:"STOP_UNCONFIRMED"}));
});
it("keeps read-only CI pending distinct from an uncertain PR creation",async()=>{
 const f=await setup("completed");f.db.saveDeliveryEvidence({id:"ci",taskId:f.taskId,runId:f.runId,connectorInstanceId:f.request.workOrder.delivery.scmConnectorId,kind:"ci",externalId:"a".repeat(40),document:{id:"ci",taskId:f.taskId,runId:f.runId,connectorInstanceId:f.request.workOrder.delivery.scmConnectorId,kind:"ci",externalId:"a".repeat(40),state:"PENDING",revision:1,metadata:{idempotencyKey:`delivery:${f.runId}:${f.run.generation}`,generation:f.run.generation},createdAt:f.clock.now.toISOString(),updatedAt:f.clock.now.toISOString()},updatedAt:f.clock.now.toISOString()});f.order.reassignment.expectedJobRevision=new RhizaObservationStore(f.db).head(f.jobId)!.revision;expect(()=>f.attempts.check(f.principal,f.order)).not.toThrow();
});
it("withdraws old candidate/native authority after immutable successor admission while preserving original lookup",async()=>{
 const f=await setup("completed");expect(()=>f.attempts.check(f.principal,f.order)).not.toThrow();
 const before=await f.service.app.inject({url:`/api/integrations/rhiza/v1/jobs/${f.jobId}`,headers:{authorization:`Bearer ${clientToken}`}});expect(before.json().state).toBe("candidate");
 const old=f.db.getEntity<JsonValue>("rhiza-job",f.jobId) as unknown as RhizaJobRecord,request={...old.request,requestId:"new-request",workOrder:f.order},job={...old,jobId:"successor-job",taskId:"successor-task",publicationId:"successor-publication",request,dispatch:{state:"pending" as const}},receipt={...f.receipt,jobId:job.jobId,taskId:job.taskId,requestId:request.requestId,requestHash:rhizaSubmissionHash(request),origin:f.order.origin,reassignment:f.order.reassignment};
 new RhizaAdmissionStore(f.db).accept({clientId:"client-a",commandScope:"jobs.submit",requestId:request.requestId},receipt.requestHash,()=>{f.db.writeCanonicalTask(job.taskId,0,{id:job.taskId,state:"BACKLOG"});f.db.saveEntity("rhiza-job",job.jobId,JSON.parse(JSON.stringify(job)));f.db.saveEntity("task-rhiza-binding",job.taskId,{jobId:job.jobId});return {jobId:job.jobId,taskId:job.taskId,repositoryId:f.order.repositoryId,profileId:f.order.target.profileId,authorityId:f.order.origin.authorityId,receipt:JSON.parse(JSON.stringify(receipt))};});
 expect(()=>f.service["rhizaJobs"].assertCandidate(f.run)).toThrow(expect.objectContaining({code:"TARGET_AUTHORITY_CHANGED"}));
 const after=await f.service.app.inject({url:`/api/integrations/rhiza/v1/jobs/${f.jobId}`,headers:{authorization:`Bearer ${clientToken}`}});expect(after.json().state).toBe("unknown");expect(after.json().revision).toBeGreaterThan(before.json().revision);
 const lookup=await f.service.app.inject({url:`/api/integrations/rhiza/v1/operations/by-key/${f.request.requestId}`,headers:{authorization:`Bearer ${clientToken}`}});expect(lookup.json()).toEqual(f.receipt);expect(f.db.getCanonicalTask(job.taskId)?.document).toMatchObject({state:"BACKLOG"});
});
it.each(["missing-stop-drain","unknown-launch","unknown-publication"] as const)("does not infer resolved prior effects from %s",async reason=>{
 const f=await setup(reason==="missing-stop-drain"?"stopped":"completed");
 if(reason==="missing-stop-drain")f.db.handle.prepare("UPDATE entities SET document_json=json_set(document_json,'$.modelInvocationId','unqualified-turn') WHERE kind='adapter-session' AND id=?").run(f.sessionId);
 if(reason==="unknown-launch"){const job=f.db.getEntity<JsonValue>("rhiza-job",f.jobId) as Record<string,JsonValue>;f.db.saveEntity("rhiza-job",f.jobId,{...job,dispatch:{state:"unknown",code:"LAUNCH_UNCERTAIN",runId:f.runId}});}
 if(reason==="unknown-publication"){const job=f.db.getEntity<JsonValue>("rhiza-job",f.jobId) as Record<string,JsonValue>,publication=f.db.getEntity<JsonValue>("task-publication",String(job.publicationId)) as Record<string,JsonValue>;f.db.saveEntity("task-publication",String(job.publicationId),{...publication,receipt:{...(publication.receipt as object),state:"OUTCOME_UNKNOWN"}});}
 f.order.reassignment.expectedJobRevision=new RhizaObservationStore(f.db).head(f.jobId)!.revision;expect(()=>f.attempts.check(f.principal,f.order)).toThrow(expect.objectContaining({code:"STOP_UNCONFIRMED"}));
});

it.each(["HUMAN","CONFLICT","other-run"] as const)("rejects predecessor authority controlled by %s despite old process drain",async state=>{
 const f=await setup("completed");f.db.handle.prepare("UPDATE session_controls SET state=?,active_run_id=?,revision=revision+1,document_json=json_set(document_json,'$.state',?,'$.activeRunId',?) WHERE session_id=?").run(state==="other-run"?"AUTOMATED":state,state==="other-run"?"other-run":f.runId,state==="other-run"?"AUTOMATED":state,state==="other-run"?"other-run":f.runId,f.sessionId);
 f.order.reassignment.expectedJobRevision=new RhizaObservationStore(f.db).head(f.jobId)!.revision;expect(()=>f.attempts.check(f.principal,f.order)).toThrow(expect.objectContaining({code:"STOP_UNCONFIRMED"}));
});

it("rejects native takeover bindings even with an old owned-process drain",async()=>{
 const f=await setup("completed");f.db.handle.prepare("INSERT INTO native_bindings(session_id,binding_key,profile_id,execution_ref_id,document_json) VALUES(?,?,?,?,?)").run(f.sessionId,"native-key",f.run.profileId,"native-ref",JSON.stringify({sessionId:f.sessionId}));
 f.order.reassignment.expectedJobRevision=new RhizaObservationStore(f.db).head(f.jobId)!.revision;expect(()=>f.attempts.check(f.principal,f.order)).toThrow(expect.objectContaining({code:"STOP_UNCONFIRMED"}));
});

it("does not release an older unresolved Run when the latest Run has completed",async()=>{
 const f=await setup("completed");f.db.saveEntity("run","older-active-run",JSON.parse(JSON.stringify({...f.run,id:"older-active-run",sessionId:"older-session",generation:1,state:"ACTIVE"})));
 f.order.reassignment.expectedJobRevision=new RhizaObservationStore(f.db).head(f.jobId)!.revision;expect(()=>f.attempts.check(f.principal,f.order)).toThrow(expect.objectContaining({code:"STOP_UNCONFIRMED"}));
});

it("checks one task without hydrating unrelated large Run/input/verification history",async()=>{
 const f=await setup("completed");for(let i=0;i<8;i++)for(const kind of ["run","run-input","local-review-verification","run-verification-command"])f.db.saveEntity(kind,`unrelated-${i}`,{id:`unrelated-${i}`,taskId:`foreign-task-${i}`,runId:`foreign-run-${i}`,state:"UNKNOWN",payload:"x".repeat(256*1024)});
 const read=f.db.listEntities.bind(f.db),bounded=vi.spyOn(f.db,"listEntities").mockImplementation(kind=>{if(["run","run-input","local-review-verification","run-verification-command"].includes(kind))throw Error("UNBOUNDED_AUTHORITY_HISTORY_READ");return read(kind);});
 try{expect(()=>f.attempts.check(f.principal,f.order)).not.toThrow();}finally{bounded.mockRestore();}
});
it.each(["COMPLETE","FAILED","CANCELLED","SUPERSEDED"])("never truncates an extra same-task %s Run out of predecessor authority",async state=>{
 const f=await setup("completed");f.db.saveEntity("run","older-terminal",JSON.parse(JSON.stringify({...f.run,id:"older-terminal",sessionId:"old-terminal-session",generation:1,state})));f.order.reassignment.expectedJobRevision=new RhizaObservationStore(f.db).head(f.jobId)!.revision;expect(()=>f.attempts.check(f.principal,f.order)).toThrow(expect.objectContaining({code:"STOP_UNCONFIRMED"}));
});
