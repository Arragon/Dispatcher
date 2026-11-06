import {rhizaAdmissionFixture} from "./fixtures/rhiza-admission.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanonicalTaskService } from "@dispatcher/integrations";
import type { Run, TaskContract } from "@dispatcher/domain";
import { InteractionStore, ModelInvocationStore,RhizaObservationStore, type JsonValue } from "@dispatcher/persistence";
import type { AgentAdapter } from "@dispatcher/adapters";
import { RhizaJobs } from "../src/rhiza-jobs.js";
import type { RhizaTargetFacts } from "../src/rhiza-targets.js";
import { RhizaOperations } from "../src/rhiza-operations.js";
import { PublicationService } from "../src/task-publications.js";
import { ControllerService } from "../src/service.js";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { rhizaApprovalDigest, rhizaDigest } from "../src/rhiza-semantics.js";
import { clientHeaders, owner } from "./fixtures/rhiza-service.js";

const fixtures: Awaited<ReturnType<typeof rhizaAdmissionFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.close(); });
async function setup(expiryMs?:number){const f=await rhizaAdmissionFixture(expiryMs);fixtures.push(f);return f;}

describe("canonical RHIZA admission and unknown launch recovery", () => {
  it.each(["valid","model-mismatch","session-mismatch","stale-generation"] as const)("checks the immutable %s invocation against the job's frozen policy after preflight expires",async reason=>{
    const f=await setup(),receipt=await f.jobs.submit(f.principal,f.request),job=f.service.database.getEntity("rhiza-job",receipt.jobId) as Record<string,JsonValue>,publication=f.publications.record(f.principal.id,String(job.publicationId));
    const run={id:"candidate-run",taskId:receipt.taskId,sessionId:"candidate-session",providerSessionId:"native-original",profileId:publication.selection!.profileId,providerId:publication.selection!.providerId,runnerId:publication.selection!.runnerId,state:"COMPLETE",generation:1,attempt:1,leaseId:"candidate-lease",executionSelection:publication.selection,verification:{state:"PASSED",commands:[]}} as Run;
    const execution={generation:run.generation,attempt:run.attempt,leaseId:run.leaseId},session={id:run.sessionId,runId:run.id,profileId:run.profileId,backendId:publication.selection!.backendId,executionSelection:publication.selection,execution,state:"COMPLETED",providerSessionId:run.providerSessionId,turnId:"invocation-a",modelInvocationId:"invocation-a"};
    const task=f.service.database.getCanonicalTask<JsonValue>(receipt.taskId)!;
    f.service.database.writeCanonicalTask(receipt.taskId,task.revision,{...(task.document as Record<string,JsonValue>),state:"VERIFYING",currentRunId:run.id});
    f.service.database.saveEntity("run",run.id,JSON.parse(JSON.stringify(run)));f.service.database.saveEntity("adapter-session",session.id,JSON.parse(JSON.stringify(session)));
    new ModelInvocationStore(f.service.database).append({version:1,id:"invocation-a",runId:run.id,sessionId:reason==="session-mismatch"?"foreign":session.id,profileId:run.profileId,backendId:session.backendId,kind:"start",invokedAt:f.clock.now.toISOString(),execution:reason==="stale-generation"?{...execution,generation:2}:execution,executionSelection:publication.selection!,model:{id:reason==="model-mismatch"?"wrong-model":f.request.workOrder.target.modelId,options:{}}});
    f.clock.now=new Date(f.clock.now.getTime()+600000);
    if(reason==="valid"){
      expect(f.jobs.modelEvidence(run)).toMatchObject({candidateAllowed:true,evidence:{status:"configuration_confirmed",reported:null}});expect(()=>f.jobs.assertCandidate(run)).not.toThrow();
      const at=f.clock.now.toISOString(),clock=vi.spyOn(f.options,"now").mockImplementation(()=>{throw Error("clock callback after final authority capture");});
      try{expect(()=>f.jobs.assertCandidate(run,at)).not.toThrow();expect(clock).not.toHaveBeenCalled();}finally{clock.mockRestore();}
      const current=f.service.database.getCanonicalTask<JsonValue>(receipt.taskId)!;
      expect(()=>f.service.tasks.execute({id:"qualified-review",taskId:receipt.taskId,baseRevision:current.revision,actor:"run-worker",command:{type:"task.transition",state:"REVIEW"}})).not.toThrow();
    }else expect(()=>f.jobs.assertCandidate(run)).toThrowError(expect.objectContaining({code:reason==="model-mismatch"?"MODEL_EVIDENCE_MISMATCH":"MODEL_EVIDENCE_REQUIRED"}));
  });
  it.each(["delivery","run","task"] as const)("blocks unverified RHIZA jobs at the canonical %s boundary",async boundary=>{
    const f=await setup(),receipt=await f.jobs.submit(f.principal,f.request),publication=f.publications.record(f.principal.id,String((f.service.database.getEntity("rhiza-job",receipt.jobId) as Record<string,JsonValue>).publicationId));
    const run={id:"candidate-run",taskId:receipt.taskId,sessionId:"candidate-session",profileId:publication.selection!.profileId,providerId:publication.selection!.providerId,runnerId:publication.selection!.runnerId,state:"DELIVERING",generation:1,attempt:1,leaseId:"candidate-lease",executionSelection:publication.selection,verification:{state:"PASSED",commands:[]}} as Run;
    const task=f.service.database.getCanonicalTask<JsonValue>(receipt.taskId)!;
    f.service.database.writeCanonicalTask(receipt.taskId,task.revision,{...(task.document as Record<string,JsonValue>),state:"VERIFYING",currentRunId:run.id});
    f.service.database.saveEntity("run",run.id,JSON.parse(JSON.stringify(run)));
    const internal=f.service as unknown as {fenceDelivery(run:Run,operation:"push"):void;saveAdvancedRun(run:Run,expected:Run["state"]):void};
    const current=f.service.database.getCanonicalTask<JsonValue>(receipt.taskId)!;
    const operation=boundary==="delivery"?()=>internal.fenceDelivery(run,"push"):boundary==="run"?()=>internal.saveAdvancedRun({...run,state:"COMPLETE"},"DELIVERING"):()=>f.service.tasks.execute({id:"force-review",taskId:receipt.taskId,baseRevision:current.revision,actor:"owner",command:{type:"task.transition",state:"REVIEW"}});
    expect(operation).toThrowError(expect.objectContaining({code:"MODEL_EVIDENCE_REQUIRED"}));
    expect((f.service.database.getEntity("run",run.id) as Record<string,JsonValue>).state).toBe("DELIVERING");expect((f.service.database.getCanonicalTask<JsonValue>(receipt.taskId)!.document as Record<string,JsonValue>).state).toBe("VERIFYING");
  });
  it("accepts and replays the maximum schema-valid request ID", async () => {
    const f = await setup(); f.request.requestId = "r".repeat(200);
    const receipt = await f.jobs.submit(f.principal, f.request);
    expect(receipt.requestId).toBe(f.request.requestId); expect(await f.jobs.submit(f.principal, f.request)).toEqual(receipt);
    expect(f.service.database.listCanonicalTasks()).toHaveLength(1); expect(f.scheduled).toHaveLength(1);
  });
  it.each(["expiry", "shutdown"])("checks RHIZA %s at the final synchronous native send boundary", async reason => {
    const f = await setup(60000), receipt = await f.jobs.submit(f.principal, f.request);
    const internal = f.service as unknown as { rhizaTargetFacts(repositoryId:string,profileId:string):RhizaTargetFacts; rhizaJobs:RhizaJobs; resolveProfileExecutionContext(profileId:string,repositoryId:string,purpose:"start"):{fingerprint:string}; agentAdapters:Map<string,AgentAdapter>; reserveLocalStart(run:Run,contract:TaskContract,adapter:AgentAdapter,actorId:string,repositoryId:string):{beforeSend():void} };
    vi.spyOn(internal,"rhizaTargetFacts").mockImplementation(()=>structuredClone(f.facts));
    const job = f.service.database.getEntity("rhiza-job",receipt.jobId) as Record<string,JsonValue>;
    f.service.database.saveEntity("rhiza-job",receipt.jobId,{...job,dispatch:{state:"claimed"}});
    const publication = f.publications.record(f.principal.id,String(job.publicationId));
    f.jobs.assertPublication(publication);
    const selection={...publication.selection!,contextFingerprint:internal.resolveProfileExecutionContext("profile-a","repo-a","start").fingerprint};
    const run={id:"expiry-run",taskId:receipt.taskId,sessionId:"expiry-session",profileId:"profile-a",providerId:"codex",runnerId:"local",state:"STARTING",generation:1,attempt:1,leaseId:"expiry-lease",leaseExpiresAt:new Date(f.clock.now.getTime()+900000).toISOString(),startedAt:f.clock.now.toISOString(),worktree:f.repository,executionSelection:selection} as Run;
    const task=f.service.database.getCanonicalTask<JsonValue>(receipt.taskId)!;
    f.service.database.writeCanonicalTask(receipt.taskId,task.revision,{...(task.document as Record<string,JsonValue>),state:"QUEUED",currentRunId:run.id});
    f.service.database.saveEntity("run",run.id,JSON.parse(JSON.stringify(run)));
    const start=internal.reserveLocalStart(run,publication.contract!,internal.agentAdapters.get("profile-a")!,f.principal.id,"repo-a");
    if(reason==="expiry")f.clock.now=new Date(f.clock.now.getTime()+120000);else internal.rhizaJobs.closeAdmissions();
    expect(()=>start.beforeSend()).toThrowError(expect.objectContaining({code:reason==="expiry"?"AUTH_REQUIRED":"TARGET_AUTHORITY_CHANGED"}));
    expect(new InteractionStore(f.service.database).command(`native-start:${run.id}`)?.state).toBe("RESERVED");
  });
  it("preserves semantic conflicts across independent canonical admission instances", async () => {
    const f=await setup(), otherRequest=structuredClone(f.request);
    otherRequest.workOrder.constraints.push("separately approved constraint"); otherRequest.workOrder.approval.digest=rhizaApprovalDigest(otherRequest.workOrder);
    const reviewed=await f.targets.preflight(f.principal,otherRequest.workOrder); otherRequest.preflightId=reviewed.preflightId;
    const otherPublications=new PublicationService(f.service.database,f.service.configuration,new CanonicalTaskService(f.service.database),{inspect:async()=>({root:f.repository,baseCommit:"base-fixture"})},()=>f.clock.now,f.runtime);
    const other=new RhizaJobs(f.service.database,f.auth,f.targets,otherPublications,f.options);
    const results=await Promise.allSettled([f.jobs.submit(f.principal,f.request),other.submit(f.principal,otherRequest)]);
    expect(results.filter(result=>result.status==="fulfilled")).toHaveLength(1);
    expect(results.find(result=>result.status==="rejected")).toMatchObject({status:"rejected",reason:{code:"IDEMPOTENCY_CONFLICT"}});
    expect(f.service.database.listCanonicalTasks()).toHaveLength(1); expect(f.scheduled).toHaveLength(1);
  });
  it("atomically admits concurrent duplicates once and starts only after the durable acceptance", async () => {
    const f = await setup(), [a, b] = await Promise.all([f.jobs.submit(f.principal, f.request), f.jobs.submit(f.principal, structuredClone(f.request))]);
    expect(a).toEqual(b); expect(a.state).toBe("accepted"); expect(f.service.database.listCanonicalTasks()).toHaveLength(1);
    expect(f.starts).toEqual([]); expect(f.scheduled).toHaveLength(1);
    const contract = f.service.database.getTaskContract<JsonValue>(a.taskId) as unknown as TaskContract;
    expect(contract).toMatchObject({ constraints: f.request.workOrder.constraints, inputContext: f.request.workOrder.context, delivery: { type: "pull-request" } });
    await f.scheduled[0]!(); expect(f.starts).toHaveLength(1); expect(f.starts[0]).toContain(JSON.stringify(f.request.workOrder.context));
    expect(await f.jobs.submit(f.principal, f.request)).toEqual(a); expect(f.scheduled).toHaveLength(1);
    expect(new RhizaOperations(f.service.database, f.auth).lookup(f.principal, f.request.requestId)).toEqual(a);
  });
  it.each(["rhiza-job","task-publication"])("rolls back Task/Contract, intent, association and receipt on %s persistence failure", async failedKind => {
    const f = await setup(), save = f.service.database.saveEntity.bind(f.service.database);
    vi.spyOn(f.service.database, "saveEntity").mockImplementation((kind, ...args) => { if (kind === failedKind) throw Error("injected admission failure"); return save(kind, ...args); });
    await expect(f.jobs.submit(f.principal, f.request)).rejects.toThrow("injected admission failure");
    expect(f.service.database.listCanonicalTasks()).toEqual([]); expect(f.service.database.listEntities("task-execution-intent")).toEqual([]); expect(f.scheduled).toEqual([]);
    expect(f.service.database.handle.prepare("SELECT COUNT(*) AS n FROM rhiza_admissions").get()?.n).toBe(0);
  });
  it("recovers through a fresh Controller and HTTP retry without starting accepted work again", async () => {
    const f=await setup(), receipt=await f.jobs.submit(f.principal,f.request); f.jobs.closeAdmissions(); await f.service.stop();
    const restarted=new ControllerService({dataDirectory:join(f.root,"controller"),ownerToken:"synthetic-owner-rhiza-test",secretStore:f.secrets,clock:()=>f.clock.now});
    try{
      await restarted.start({listen:false});
      const query=await restarted.app.inject({url:`/api/integrations/rhiza/v1/operations/by-key/${f.request.requestId}`,headers:clientHeaders});
      expect(query.statusCode).toBe(200); expect(query.json()).toEqual(receipt);
      const retry=await restarted.app.inject({method:"POST",url:"/api/integrations/rhiza/v1/jobs",headers:clientHeaders,payload:f.request});
      expect(retry.statusCode).toBe(202); expect(retry.json()).toEqual(receipt);
      expect(restarted.database.getEntity("rhiza-job",receipt.jobId)).toMatchObject({dispatch:{state:"unknown"}});
      expect(restarted.database.listEntities("run")).toEqual([]); expect(restarted.database.listCanonicalTasks()).toHaveLength(1);
    }finally{await restarted.stop();}
  });
  it("retains acceptance after a lost reply/restart and never replays a pending or unknown launch", async () => {
    const f = await setup(), accepted = await f.jobs.submit(f.principal, f.request);
    f.jobs.closeAdmissions();
    const restarted = new RhizaJobs(f.service.database, f.auth, f.targets, f.publications, f.options); restarted.reconcile();
    expect(await restarted.submit(f.principal, f.request)).toEqual(accepted); expect(f.scheduled).toHaveLength(1);
    expect(f.service.database.getEntity("rhiza-job", accepted.jobId)).toMatchObject({ dispatch: { state: "unknown" } });
    await f.scheduled[0]!(); expect(f.starts).toEqual([]);
  });
  it("keeps an uncertain native effect queryable without a second start or false failure", async () => {
    const f = await setup(); f.runtime.dispatch.mockImplementation(async () => { throw Error("spawn response lost"); });
    const accepted = await f.jobs.submit(f.principal, f.request); await f.scheduled[0]!();
    expect(f.service.database.getEntity("rhiza-job", accepted.jobId)).toMatchObject({ dispatch: { state: "unknown" } });
    expect(await f.jobs.submit(f.principal, f.request)).toEqual(accepted); expect(f.runtime.dispatch).toHaveBeenCalledTimes(1);
  });
  it.each(["before","after"])("retains uncertainty on %s-spawn fault without replaying the isolated child effect", async position => {
    const f=await setup(), marker=join(f.root,"synthetic-spawn-marker");
    f.runtime.dispatch.mockImplementation(async()=>{
      if(position==="after")execFileSync(process.execPath,["-e","require('node:fs').appendFileSync(process.argv[1], 'started\\n')",marker]);
      throw Error("injected spawn acknowledgement loss");
    });
    const receipt=await f.jobs.submit(f.principal,f.request); await f.scheduled[0]!();
    expect(f.service.database.getEntity("rhiza-job",receipt.jobId)).toMatchObject({dispatch:{state:"unknown"}});
    expect(await f.jobs.submit(f.principal,f.request)).toEqual(receipt); f.jobs.reconcile();
    expect(f.runtime.dispatch).toHaveBeenCalledTimes(1); expect(f.scheduled).toHaveLength(1);
    expect(existsSync(marker)).toBe(position==="after"); if(position==="after")expect(readFileSync(marker,"utf8")).toBe("started\n");
  });
  it("rejects owner redispatch that bypasses the RHIZA attempt and approval", async () => {
    const f = await setup(), accepted = await f.jobs.submit(f.principal, f.request);
    const response = await f.service.app.inject({ method: "POST", url: `/api/tasks/${accepted.taskId}/dispatch`, headers: owner, payload: { profileId: "profile-a", repositoryId: "repo-a" } });
    expect(response.statusCode).toBe(409); expect(response.json().code).toBe("TARGET_AUTHORITY_CHANGED"); expect(f.starts).toEqual([]);
  });
  it("rejects silent operator rerouting before reserving a replacement", async () => {
    const f=await setup(), accepted=await f.jobs.submit(f.principal,f.request);
    f.service.database.saveEntity("run","bound-run",{id:"bound-run",taskId:accepted.taskId,profileId:"profile-a",sessionId:"bound-session",state:"ACTIVE",generation:1,leaseId:"bound-lease"});
    const internal=f.service as unknown as {rerouteRun(runId:string,profileId:string,context:{actorId:string;workflowId:string}):Promise<unknown>};
    await expect(Promise.resolve().then(()=>internal.rerouteRun("bound-run","profile-a",{actorId:"owner",workflowId:"reroute-a"}))).rejects.toMatchObject({code:"TARGET_AUTHORITY_CHANGED"});
    expect(f.service.database.listEntities("run-reroute")).toEqual([]); expect(f.starts).toEqual([]);
  });
  it("rechecks authority after awaits and rejects changed preflight semantics before admission", async () => {
    const f = await setup(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const original = f.runtime.prepare; f.runtime.prepare = async () => { entered.resolve(); await release.promise; return original(); };
    const submitting = f.jobs.submit(f.principal, f.request); await entered.promise;
    await f.configure(config => { config.rhizaIngress!.clients[0]!.enabled = false; }); release.resolve();
    await expect(submitting).rejects.toMatchObject({ code: "AUTH_REQUIRED" }); expect(f.service.database.listCanonicalTasks()).toEqual([]);
  });
  it("rejects non-PR wire submissions and unavailable proof without exposing canonical admission", async () => {
    const f = await setup();
    const invalid = await f.service.app.inject({ method: "POST", url: "/api/integrations/rhiza/v1/jobs", headers: clientHeaders, payload: { ...f.request, workOrder: { ...f.request.workOrder, delivery: { type: "none" } } } });
    expect(invalid.statusCode).toBe(400);
    const unavailable = await f.service.app.inject({ method: "POST", url: "/api/integrations/rhiza/v1/jobs", headers: clientHeaders, payload: f.request });
    expect(unavailable.statusCode).toBeGreaterThanOrEqual(400); expect(unavailable.statusCode).toBeLessThan(500); expect(f.service.database.listCanonicalTasks()).toEqual([]);
    const changed = structuredClone(f.request); changed.workOrder.constraints.push("unapproved");
    await expect(f.jobs.submit(f.principal, changed)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(rhizaDigest(changed.workOrder)).not.toBe(rhizaDigest(f.request.workOrder));
  });
});

async function replacementOrder(f:Awaited<ReturnType<typeof setup>>,jobId:string){
 const order={...structuredClone(f.request.workOrder),origin:{...f.request.workOrder.origin,executionRunId:"replacement-execution",dispatchId:"replacement-dispatch",generation:2},approval:{...f.request.workOrder.approval,reference:"replacement-approval"},reassignment:{jobId,expectedJobRevision:new RhizaObservationStore(f.service.database).head(jobId)!.revision,runId:null}};order.approval.digest=rhizaApprovalDigest(order);return order;
}
async function cancelQueued(f:Awaited<ReturnType<typeof setup>>,jobId:string){
 f.service["rhizaCancellations"].accept(f.principal,jobId,{requestId:"queued-stop",expectedJobRevision:new RhizaObservationStore(f.service.database).head(jobId)!.revision,runId:null,generation:f.request.workOrder.origin.generation});
}
it("rejects rotating only the request key for an already admitted origin dispatch",async()=>{
 const f=await setup(),first=await f.jobs.submit(f.principal,f.request);await expect(f.jobs.submit(f.principal,{...f.request,requestId:"another-key"})).rejects.toMatchObject({code:"TARGET_AUTHORITY_CHANGED"});expect(f.service.database.listCanonicalTasks()).toHaveLength(1);expect(await f.jobs.submit(f.principal,f.request)).toEqual(first);
});
it("rejects a replacement preflight while the original admission has no qualified no-effect or stop proof",async()=>{
 const f=await setup(),first=await f.jobs.submit(f.principal,f.request),order=await replacementOrder(f,first.jobId);await expect(f.targets.preflight(f.principal,order)).rejects.toMatchObject({code:"STOP_UNCONFIRMED"});expect(f.service.database.listCanonicalTasks()).toHaveLength(1);
});
it("atomically admits one fresh successor and preserves both original receipt replays",async()=>{
 const f=await setup(),first=await f.jobs.submit(f.principal,f.request);await cancelQueued(f,first.jobId);const order=await replacementOrder(f,first.jobId),preflight=await f.targets.preflight(f.principal,order),request={...f.request,requestId:"replacement-request",workOrder:order,preflightId:preflight.preflightId,targetHash:preflight.target.targetHash};
 const next=await f.jobs.submit(f.principal,request);expect(next.reassignment).toEqual(order.reassignment);expect(next.jobId).not.toBe(first.jobId);expect(next.taskId).not.toBe(first.taskId);expect(await f.jobs.submit(f.principal,request)).toEqual(next);expect(await f.jobs.submit(f.principal,f.request)).toEqual(first);expect(f.service.database.listCanonicalTasks()).toHaveLength(2);
 f.runtime.dispatch.mockImplementation(async record=>{expect(record.rhizaJobId).toBe(next.jobId);return {id:"replacement-run",state:"ACTIVE"} as Run;});for(const launch of f.scheduled)await launch();expect(f.runtime.dispatch).toHaveBeenCalledTimes(1);
});
it("allows only one competing successor after independent preflights and rejects old authority",async()=>{
 const f=await setup(),first=await f.jobs.submit(f.principal,f.request);await cancelQueued(f,first.jobId);const a=await replacementOrder(f,first.jobId),b={...structuredClone(a),origin:{...a.origin,executionRunId:"other-execution",dispatchId:"other-dispatch"}};b.approval.digest=rhizaApprovalDigest(b);const pa=await f.targets.preflight(f.principal,a),pb=await f.targets.preflight(f.principal,b);
 const outcomes=await Promise.allSettled([f.jobs.submit(f.principal,{...f.request,requestId:"next-a",workOrder:a,preflightId:pa.preflightId,targetHash:pa.target.targetHash}),f.jobs.submit(f.principal,{...f.request,requestId:"next-b",workOrder:b,preflightId:pb.preflightId,targetHash:pb.target.targetHash})]);expect(outcomes.filter(result=>result.status==="fulfilled")).toHaveLength(1);expect(outcomes.filter(result=>result.status==="rejected")).toHaveLength(1);expect(f.service.database.listCanonicalTasks()).toHaveLength(2);
 const job=f.service.database.getEntity("rhiza-job",first.jobId) as Record<string,JsonValue>,record=f.publications.record(f.principal.id,String(job.publicationId));expect(()=>f.jobs.assertPublication(record)).toThrow(expect.objectContaining({code:"TARGET_AUTHORITY_CHANGED"}));
});

it("rolls back a successor and its predecessor notification together on publication failure",async()=>{
 const f=await setup(),first=await f.jobs.submit(f.principal,f.request);await cancelQueued(f,first.jobId);
 const order=await replacementOrder(f,first.jobId),preflight=await f.targets.preflight(f.principal,order),request={...f.request,requestId:"next-rollback",workOrder:order,preflightId:preflight.preflightId,targetHash:preflight.target.targetHash};
 const before=new RhizaObservationStore(f.service.database).head(first.jobId),save=f.service.database.saveEntity.bind(f.service.database);
 vi.spyOn(f.service.database,"saveEntity").mockImplementation((kind,...args)=>{if(kind==="task-publication")throw Error("successor interrupted");return save(kind,...args);});
 await expect(f.jobs.submit(f.principal,request)).rejects.toThrow("successor interrupted");
 expect(new RhizaObservationStore(f.service.database).head(first.jobId)).toEqual(before);expect(f.service.database.listCanonicalTasks()).toHaveLength(1);
 expect(f.service.database.handle.prepare("SELECT count(*) AS n FROM rhiza_admissions").get()?.n).toBe(1);expect(f.scheduled).toHaveLength(1);
});
it("retains both linked receipts after restart without adopting either launch",async()=>{
 const f=await setup(),first=await f.jobs.submit(f.principal,f.request);await cancelQueued(f,first.jobId);const order=await replacementOrder(f,first.jobId),preflight=await f.targets.preflight(f.principal,order),request={...f.request,requestId:"next-restart",workOrder:order,preflightId:preflight.preflightId,targetHash:preflight.target.targetHash},next=await f.jobs.submit(f.principal,request);
 f.jobs.closeAdmissions();await f.service.stop();
 const restarted=new ControllerService({dataDirectory:join(f.root,"controller"),ownerToken:"synthetic-owner-rhiza-test",secretStore:f.secrets,clock:()=>f.clock.now});
 try{await restarted.start({listen:false});
  for(const [input,receipt] of [[f.request,first],[request,next]] as const){const response=await restarted.app.inject({method:"POST",url:"/api/integrations/rhiza/v1/jobs",headers:clientHeaders,payload:input});expect(response.statusCode).toBe(202);expect(response.json()).toEqual(receipt);}
  expect(restarted.database.listEntities("run")).toEqual([]);expect(restarted.database.listCanonicalTasks()).toHaveLength(2);
  expect(restarted.database.getEntity("rhiza-job",next.jobId)).toMatchObject({dispatch:{state:"unknown"}});
 }finally{await restarted.stop();}
});
