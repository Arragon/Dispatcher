import {execFileSync} from "node:child_process";
import {existsSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {afterEach,expect,it,vi} from "vitest";
import {PiRpcExecutionBackend,StructuredCliAdapter,type AgentAdapter,type CliStartInput} from "@dispatcher/adapters";
import {assertRunTransition,assertTaskTransition,isTerminalRunState,type Run,type Task} from "@dispatcher/domain";
import {DispatcherDatabase,InteractionStore} from "@dispatcher/persistence";
import {piRpcFixture} from "../../../packages/adapters/test/fixtures/pi-rpc.js";
import {ControllerService} from "../src/service.js";
import {isGuardedControllerStart,isReadableManagedCodexRun,isReadableManagedOpenCodeRun,isReadableManagedPiRun} from "../src/start-recovery.js";
import {editStored,replaceBindingCopies,type StoredEdit} from "./fixtures/managed-restart-storage.js";
import type {PiExecutionRuntime} from "../src/pi-runtime.js";
import {EncryptedLocalSecretStore} from "@dispatcher/config";
import {admitRhizaNative} from "./fixtures/rhiza-native-admission.js";
import {assertRhizaUnknownRestart} from "./fixtures/rhiza-native-restart.js";
import {clientHeaders} from "./fixtures/rhiza-service.js";

const roots:string[]=[],services:ControllerService[]=[];
const headers={authorization:"Bearer fixture-owner"};
afterEach(async()=>{for(const service of services.splice(0))await service.stop();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
async function fixture(capacity=1){
 const f=piRpcFixture(roots,"exec-ok");
 const git=(...args:string[])=>execFileSync("git",["-C",f.scope.workspacePath,...args],{stdio:"pipe"});
 git("init","--initial-branch=main");git("config","user.email","fixture@example.invalid");git("config","user.name","Fixture");writeFileSync(join(f.scope.workspacePath,"README.md"),"fixture\n");git("add",".");git("commit","-m","fixture");
 const service=new ControllerService({dataDirectory:join(f.root,"controller"),ownerToken:"fixture-owner",secretStore:new EncryptedLocalSecretStore(join(f.root,"vault"),"synthetic-pi-runtime-master"),withRunner:true,backgroundWorker:{enabled:false}});services.push(service);await service.start({listen:false});
 const config=structuredClone(service.configuration.current().config);
 config.runners[0]!.capacity=capacity;
 config.agentProfiles=[{id:"pi",alias:"Pi",provider:"pi",runnerId:"local",nativeInteraction:{mode:"compatible",backendId:"pi-rpc",executionLocation:"managed-worktree"},settings:{executable:f.scope.executable,agentDirectory:f.scope.agentDirectory,sessionDirectory:f.scope.sessionDirectory,model:"fixture/exec-ok"}}];
 config.repositories=[{id:"repo",root:f.scope.workspacePath,defaultBaseRef:"main",scopePaths:[],verificationCommands:[]}];
 const plan=service.configuration.buildPlan(config,"fixture","web"),applied=await service.app.inject({headers,method:"POST",url:`/api/config/plans/${plan.id}/apply`,payload:{confirmed:true}});
 expect(applied.statusCode,applied.body).toBe(200);
 const dispatchResponse=async(taskId="task")=>{
  const now=new Date().toISOString();
  service.tasks.execute({id:`create-task:${taskId}`,taskId,baseRevision:0,actor:"fixture",command:{type:"task.create",task:{id:taskId,projectId:"fixture",title:"Pi fixture",state:"READY",labels:[],createdAt:now,updatedAt:now},bindings:[]}});
  service.database.saveTaskContract(taskId,{version:1,revision:1,goal:"Pi fixture",scope:["README.md"],acceptanceCriteria:["done"],verification:[],constraints:[],delivery:{type:"none",repository:"repo",baseBranch:"main"}});
  return service.app.inject({headers,method:"POST",url:`/api/tasks/${taskId}/dispatch`,payload:{profileId:"pi"}});
 };
 const dispatch=async(taskId="task")=>{const response=await dispatchResponse(taskId);expect(response.statusCode,response.body).toBe(201);return response.json().run as Run;};
 const adapter=(service as unknown as {agentAdapters:Map<string,AgentAdapter>}).agentAdapters.get("pi")!;
 return {...f,service,dispatch,dispatchResponse,adapter};
}
it("registers the configured Pi RPC backend without starting native processes",async()=>{
 const f=await fixture();expect(f.adapter.supportsExecutionRef).toBe(true);expect(f.adapter.legacyInvocationDefaults?.()).toMatchObject({backendId:"pi-rpc"});expect(existsSync(join(f.root,"environment.jsonl"))).toBe(false);
});
it("keeps a RHIZA Pi restart queryable without restoring a native writer or candidate",async()=>{
 const f=await fixture(),accepted=await admitRhizaNative(f.service,async context=>({profileId:context.profileId,runnerId:context.runnerId,providerId:"pi",backendId:"pi-rpc",contextFingerprint:"c".repeat(64),revision:"d".repeat(64),freshness:"native-fresh",fetchedAt:new Date().toISOString(),source:"native-rpc",selectionSupport:"explicit",entries:[{id:"fixture/exec-ok",displayName:"Synthetic Pi",kind:"model",access:"account-listed",selectable:true,parameterOptions:{}}]}),"pi");await f.service["rhizaJobs"].drain();const current=f.service.database.listEntities("run")[0] as unknown as Run;await f.adapter.result(current.sessionId);
 const run=f.service.database.getEntity("run",current.id) as unknown as Run,oldSession=f.service.database.getEntity("session",run.sessionId),oldAdapter=f.service.database.getEntity("adapter-session",run.sessionId),binding=new InteractionStore(f.service.database).binding(run.sessionId)!;
 const before=(await f.service.app.inject({url:`/api/integrations/rhiza/v1/jobs/${accepted.receipt.jobId}`,headers:clientHeaders})).json();await f.service.stop();const wire=readFileSync(join(f.root,"wire-types"),"utf8");
 const restored=new ControllerService({dataDirectory:join(f.root,"controller"),ownerToken:"fixture-owner",secretStore:f.service.secrets,withRunner:true,backgroundWorker:{enabled:false}});
 try{await restored.start({listen:false});await assertRhizaUnknownRestart(restored,accepted,run,before);expect(restored.database.getEntity("session",run.sessionId)).toEqual(oldSession);expect(restored.database.getEntity("adapter-session",run.sessionId)).toEqual(oldAdapter);expect(new InteractionStore(restored.database).binding(run.sessionId)).toEqual(binding);expect(restored["nativePort"](binding)).toBeUndefined();expect(readFileSync(join(f.root,"wire-types"),"utf8")).toBe(wire);}
 finally{await restored.stop();}
});
it("binds a canonical Pi session before prompting and keeps continuation unqualified",async()=>{
 const f=await fixture(),run=await f.dispatch();expect(run.state,run.failureReason).toBe("ACTIVE");expect(run.resumePolicy).toBe("controlled-reroute");expect(run.executionRef).toMatchObject({kind:"managed-worktree",runnerId:"local",repositoryId:"repo",workspaceId:run.id});
 const store=new InteractionStore(f.service.database);expect(store.binding(run.sessionId)).toMatchObject({product:"pi",backendId:"pi-rpc",executionRefId:run.executionRef!.id,nativeSessionId:run.providerSessionId});expect(store.command(`native-start:${run.id}`)?.state).toBe("ACKNOWLEDGED");
 expect(f.service.database.listEntities("native-binding-event").length).toBeGreaterThan(0);expect(readFileSync(join(f.root,"wire-types"),"utf8")).toContain("prompt");
 await expect(f.adapter.send(run.sessionId,"unqualified continuation")).rejects.toMatchObject({code:"UNSUPPORTED_CAPABILITY"});
 await f.adapter.result(run.sessionId);
 const wireBefore=readFileSync(join(f.root,"wire-types"),"utf8"),advance=await f.service.app.inject({headers,method:"POST",url:`/api/runs/${run.id}/advance`});
 expect(advance.statusCode,advance.body).toBe(409);expect(advance.json().code).toBe("NATIVE_STATE_UNKNOWN");
 expect(f.service.database.getEntity("run",run.id)).toMatchObject({state:"ACTIVE"});expect(readFileSync(join(f.root,"wire-types"),"utf8")).toBe(wireBefore);
});
it("retains unknown creation and blocks prompt when binding ingestion cannot persist",async()=>{
 const f=await fixture(),save=f.service.database.saveEntity.bind(f.service.database);
 const write=vi.spyOn(f.service.database,"saveEntity").mockImplementation((...args)=>{if(args[0]==="native-binding-event")throw Error("fixture event storage failure");return save(...args);});
 let run:Run;try{run=await f.dispatch();}finally{write.mockRestore();}
 expect(run!.state).toBe("RUNNER_UNAVAILABLE");expect(new InteractionStore(f.service.database).command(`native-start:${run!.id}`)?.state).toBe("UNKNOWN");
 expect(f.service.database.getEntity("adapter-session",run!.sessionId)).toMatchObject({nativeIdentityIssue:"NATIVE_EVENT_PERSISTENCE_FAILED"});
 expect(readFileSync(join(f.root,"wire-types"),"utf8")).not.toContain("prompt");
});
it("preserves an owned runtime on profile replacement and records local-only shutdown",async()=>{
 const f=await fixture(),run=await f.dispatch();await f.adapter.result(run.sessionId);
 const config=structuredClone(f.service.configuration.current().config);config.agentProfiles[0]!.settings!.model="fixture/different";
 const plan=f.service.configuration.buildPlan(config,"fixture","web"),response=await f.service.app.inject({headers,method:"POST",url:`/api/config/plans/${plan.id}/apply`,payload:{confirmed:true}});
 expect(response.statusCode).toBe(400);expect(["ACTIVE_AGENT_PROFILE","NATIVE_RUNTIME_DRAIN_REQUIRED"]).toContain(response.json().code);
 await f.service.stop();const db=new DispatcherDatabase(join(f.root,"controller","dispatcher.sqlite"));
 try{expect(db.getEntity("native-runtime-disconnect","pi")).toMatchObject({backendId:"pi-rpc",receipts:[{connection:"closed",callbacks:"drained",backgroundTools:"unknown",nativeSessionDeleted:false}]});}finally{db.close();}
 const pid=Number(readFileSync(join(f.root,"rpc-pid"),"utf8"));expect(()=>process.kill(pid,0)).toThrow();
});
it.each(["receipt","disconnect"] as const)("drains every runtime and closes HTTP after a Pi %s failure",async failure=>{
 const f=await fixture(),runtimeMap=(f.service as unknown as {piRuntimes:Map<string,PiExecutionRuntime>}).piRuntimes;
 const receipt={version:1,connection:"closed",ownedRoot:"not-created",callbacks:"drained",backgroundTools:"unknown",nativeSessionDeleted:false};
 const first={beginShutdown:vi.fn(),disconnectLocal:vi.fn(async()=>{if(failure==="disconnect")throw Error("fixture disconnect failure");return [receipt];}),hasUnclosedHosts:()=>false};
 const second={beginShutdown:vi.fn(),disconnectLocal:vi.fn(async()=>[receipt]),hasUnclosedHosts:()=>false};
 runtimeMap.set("pi",first as unknown as PiExecutionRuntime);runtimeMap.set("second",second as unknown as PiExecutionRuntime);
 const close=vi.spyOn(f.service.app,"close"),closeEvents=vi.spyOn(f.service.events,"close"),save=f.service.database.saveEntity.bind(f.service.database);
 const write=vi.spyOn(f.service.database,"saveEntity").mockImplementation((...args)=>{if(failure==="receipt"&&args[0]==="native-runtime-disconnect"&&args[1]==="pi")throw Error("fixture receipt failure");return save(...args);});
 services.splice(services.indexOf(f.service),1);
 try{
  await expect(f.service.stop()).rejects.toThrow(`fixture ${failure} failure`);
  expect(first.beginShutdown).toHaveBeenCalledOnce();expect(second.beginShutdown).toHaveBeenCalledOnce();expect(first.disconnectLocal).toHaveBeenCalledOnce();expect(second.disconnectLocal).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();expect(closeEvents).toHaveBeenCalledOnce();expect(f.service.database.getEntity("native-runtime-disconnect","second")).toMatchObject({receipts:[receipt]});
 }finally{write.mockRestore();await f.service.app.close();f.service.events.close();f.service.database.close();}
});

// These cases catch removal of the Controller's individual canonical Pi start fences.
it.each([
 ["currentRun",409,"TASK_CHANGED","FAILED"],
 ["session",409,"STALE_RUN_AUTHORITY","STARTING"],
 ["provider",409,"STALE_RUN_AUTHORITY","FAILED"],
 ["lease",409,"STALE_RUN_AUTHORITY","STARTING"],
 ["generation",409,"STALE_RUN_AUTHORITY","STARTING"],
 ["attempt",201,undefined,"FAILED"],
] as const)("rejects canonical %s drift at Pi admission before allocating a native backend",async(drift,status,code,state)=>{
 const f=await fixture(),runtime=f.service["piRuntimes"].get("pi")!,start=runtime.start.bind(runtime),producer=vi.spyOn(PiRpcExecutionBackend.prototype,"start");let rejected:unknown,reserved:Run|undefined;
 const boundary=vi.spyOn(runtime,"start").mockImplementation(input=>{
  const run=f.service.database.getEntity("run",input.nativeInput!.runId) as unknown as Run;reserved=structuredClone(run);
  if(drift==="currentRun"){
   const task=f.service.database.getCanonicalTask(run.taskId)!;
   f.service.database.writeCanonicalTask(run.taskId,task.revision,{...task.document as object,currentRunId:"other"});
  }else{
   const field=drift==="session"?"sessionId":drift==="provider"?"providerId":drift==="lease"?"leaseId":drift;
   f.service.database.handle.prepare("UPDATE entities SET document_json=json_set(document_json,?,json(?)) WHERE kind='run' AND id=?").run("$."+field,JSON.stringify(drift==="generation"||drift==="attempt"?2:"other"),run.id);
  }
  try{return start(input);}catch(error){rejected=error;throw error;}
 });
 try{
  const response=await f.dispatchResponse(),run=f.service.database.listEntities("run")[0] as unknown as Run;
  expect(response.statusCode,response.body).toBe(status);if(code)expect(response.json().code).toBe(code);
  expect(boundary).toHaveBeenCalledOnce();expect(rejected).toMatchObject({creationOutcome:"not-created",code:"PI_RPC_SCOPE_CHANGED"});
  expect(run.state).toBe(state);expect(new InteractionStore(f.service.database).command(`native-start:${run.id}`)).toMatchObject({state:"FAILED",code:"PI_RPC_SCOPE_CHANGED",fence:{runId:reserved!.id,sessionId:reserved!.sessionId,generation:reserved!.generation,leaseId:reserved!.leaseId}});
  expect(run.executionRef).toEqual(reserved!.executionRef);expect(run.executionSelection).toEqual(reserved!.executionSelection);expect(run.providerSessionId).toBeUndefined();expect(new InteractionStore(f.service.database).binding(reserved!.sessionId)).toBeUndefined();
  expect(runtime["executions"].size).toBe(0);expect(producer).not.toHaveBeenCalled();
  for(const name of ["environment.jsonl","rpc-started","rpc-pid","wire-types","prompt-input","child-trace.jsonl"])expect(existsSync(join(f.root,name)),name).toBe(false);
 }finally{boundary.mockRestore();producer.mockRestore();}
});

type ChildTrace={command:string;pid:number;workspace:string;agentDirectory:string;args:string[];sessionId:string;message:string};
const trace=(root:string)=>readFileSync(join(root,"child-trace.jsonl"),"utf8").trim().split("\n").map(line=>JSON.parse(line) as ChildTrace);
it("routes two canonical Runs to their original real RPC children and exact persisted sources",async()=>{
 const f=await fixture(2),a=await f.dispatch("a"),b=await f.dispatch("b"),store=new InteractionStore(f.service.database);
 expect(a.worktree).not.toBe(b.worktree);expect(a.providerSessionId).toMatch(/^[a-f0-9-]{36}$/i);expect(b.providerSessionId).toMatch(/^[a-f0-9-]{36}$/i);expect(a.providerSessionId).not.toBe(b.providerSessionId);
 for(const run of [a,b]){
  const session=f.service.database.getEntity("adapter-session",run.sessionId) as unknown as {nativeBinding:NonNullable<ReturnType<InteractionStore["binding"]>>;executionSelection:Run["executionSelection"];executionRef:Run["executionRef"]};
  expect(session.executionSelection).toEqual(run.executionSelection);expect(session.executionRef).toEqual(run.executionRef);expect(store.binding(run.sessionId)).toEqual(session.nativeBinding);
  expect(session.nativeBinding).toMatchObject({product:"pi",region:"global",profileId:"pi",backendId:"pi-rpc",nativeSessionId:run.providerSessionId,executionRefId:run.executionRef!.id});
  expect(session.nativeBinding).not.toHaveProperty("nativeThreadId");expect(session.nativeBinding).not.toHaveProperty("parentSessionId");
  expect(f.service["nativePort"](session.nativeBinding)?.capabilities().durableIdentity.support).toBe("unknown");
  expect(f.service["nativePort"]({...session.nativeBinding,executionRefId:(run===a?b:a).executionRef!.id})).toBeUndefined();
  expect(await f.adapter.result(run.sessionId)).toMatchObject({state:"COMPLETED"});
 }
 const prompts=trace(f.root).filter(row=>row.command==="prompt");expect(prompts).toHaveLength(2);expect(new Set(prompts.map(row=>row.pid)).size).toBe(2);
 for(const run of [a,b]){
  const row=prompts.find(row=>row.sessionId===run.providerSessionId)!;expect(row.workspace).toBe(run.worktree);expect(row.agentDirectory).toBe(f.scope.agentDirectory);expect(row.message).toContain("Pi fixture");
  expect(row.args[row.args.indexOf("--session-dir")+1]).toBe(f.scope.sessionDirectory);expect(row.args[row.args.indexOf("--session-id")+1]).toBe(run.providerSessionId);expect(row.args).not.toContain("--print");expect(row.args).not.toContain("--no-session");
 }
});

it("keeps the original real RPC child and exact source alive after cancelling a refused duplicate",async()=>{
 const f=await fixture(),runtime=f.service["piRuntimes"].get("pi")!,start=runtime.start.bind(runtime);let original:CliStartInput|undefined;
 const boundary=vi.spyOn(runtime,"start").mockImplementation(input=>{original=input;return start(input);});
 try{
  const run=await f.dispatch();expect(await f.adapter.result(run.sessionId)).toMatchObject({state:"COMPLETED"});const binding=new InteractionStore(f.service.database).binding(run.sessionId)!,source=f.service["nativePort"](binding),pid=Number(readFileSync(join(f.root,"rpc-pid"),"utf8"));
  expect(source).toBeDefined();const duplicate=start(original!);await expect(duplicate.ready!()).rejects.toMatchObject({creationOutcome:"not-created",code:"PI_RPC_SESSION_ALREADY_ADMITTED"});await duplicate.cancel();
  expect(()=>process.kill(pid,0)).not.toThrow();expect(f.service["nativePort"](binding)).toBe(source);expect(trace(f.root).filter(row=>row.command==="prompt")).toEqual([expect.objectContaining({pid,workspace:run.worktree,sessionId:run.providerSessionId})]);
  const receipts=await f.service.disconnectNativeRuntime("pi");expect(receipts).toEqual([expect.objectContaining({connection:"closed",ownedRoot:"exited",callbacks:"drained",backgroundTools:"unknown",nativeSessionDeleted:false})]);expect(()=>process.kill(pid,0)).toThrow();
 }finally{boundary.mockRestore();}
});

it("rehydrates an applied Pi ConfigPlan before dispatch without any probe or native launch",async()=>{
 const f=await fixture(),config=f.service.configuration.current();await f.service.stop();services.splice(services.indexOf(f.service),1);
 const reopened=new ControllerService({dataDirectory:join(f.root,"controller"),ownerToken:"fixture-owner",withRunner:true,backgroundWorker:{enabled:false}});services.push(reopened);
 expect(reopened.configuration.current()).toEqual(config);expect(reopened["agentAdapters"].get("pi")?.legacyInvocationDefaults?.().backendId).toBe("pi-rpc");await reopened.start({listen:false});
 expect(reopened["agentAdapters"].get("pi")?.supportsExecutionRef).toBe(true);expect(reopened["piRuntimes"].get("pi")!["executions"].size).toBe(0);
 for(const name of ["environment.jsonl","rpc-started","rpc-pid","wire-types","prompt-input","child-trace.jsonl"])expect(existsSync(join(f.root,name)),name).toBe(false);
});

type ProfileChange="disable"|"remove";
function changeProfile(f:Awaited<ReturnType<typeof fixture>>,change:ProfileChange){
 const config=structuredClone(f.service.configuration.current().config);
 if(change==="disable")config.agentProfiles[0]!.enabled=false;else config.agentProfiles=[];
 return ()=>f.service.configuration.applyPlan(f.service.configuration.buildPlan(config,"fixture","profile drain").id,{confirmed:true});
}
// Explicit synthetic terminal setup isolates the host gate; Adapter completion never implies terminality.
async function terminalFixture(f:Awaited<ReturnType<typeof fixture>>,run:Run,result:"COMPLETED"|"FAILED"="COMPLETED"){
 expect(await f.adapter.result(run.sessionId)).toMatchObject({state:result});
 const current=f.service.database.getEntity("run",run.id) as unknown as Run,task=f.service.database.getCanonicalTask<Task>(run.taskId)!;
 assertRunTransition(current.state,"FAILED");assertTaskTransition(task.document.state,"FAILED");
 f.service.database.saveEntity("run",run.id,JSON.parse(JSON.stringify({...current,state:"FAILED",endedAt:new Date().toISOString()})));
 f.service.database.writeCanonicalTask(run.taskId,task.revision,JSON.parse(JSON.stringify({...task.document,state:"FAILED"})));
 expect(isTerminalRunState((f.service.database.getEntity("run",run.id) as unknown as Run).state)).toBe(true);expect(f.service.database.getCanonicalTask<Task>(run.taskId)?.document.state).toBe("FAILED");
}
it.each(["disable","remove"] as const)("blocks profile %s for an ACTIVE canonical Run even after Adapter completion and real local drain",async change=>{
 const f=await fixture(),run=await f.dispatch();expect(await f.adapter.result(run.sessionId)).toMatchObject({state:"COMPLETED"});
 const original=f.service.database.getEntity("run",run.id),task=f.service.database.getCanonicalTask(run.taskId),binding=new InteractionStore(f.service.database).binding(run.sessionId),before=f.service.configuration.current(),apply=changeProfile(f,change);
 expect(apply).toThrow(expect.objectContaining({code:"ACTIVE_AGENT_PROFILE"}));expect(f.service.configuration.current()).toEqual(before);
 expect(await f.service.disconnectNativeRuntime("pi")).toEqual([expect.objectContaining({connection:"closed",ownedRoot:"exited",callbacks:"drained",backgroundTools:"unknown",nativeSessionDeleted:false})]);
 expect(apply).toThrow(expect.objectContaining({code:"ACTIVE_AGENT_PROFILE"}));expect(f.service.configuration.current()).toEqual(before);expect(f.service.database.getEntity("run",run.id)).toEqual(original);expect(f.service.database.getCanonicalTask(run.taskId)).toEqual(task);expect(new InteractionStore(f.service.database).binding(run.sessionId)).toEqual(binding);
});
it.each(["disable","remove"] as const)("requires proven local host drain before profile %s for an explicitly terminal fixture",async change=>{
 const f=await fixture(),run=await f.dispatch();await terminalFixture(f,run);const store=new InteractionStore(f.service.database),binding=store.binding(run.sessionId),apply=changeProfile(f,change),before=f.service.configuration.current(),runtime=f.service["piRuntimes"].get("pi")!;
 const marker=join(f.scope.sessionDirectory,"retain-native-session");writeFileSync(marker,"synthetic native session");
 expect(runtime.hasUnclosedHosts()).toBe(true);expect(apply).toThrow(expect.objectContaining({code:"NATIVE_RUNTIME_DRAIN_REQUIRED"}));expect(f.service.configuration.current()).toEqual(before);
 expect(await f.service.disconnectNativeRuntime("pi")).toEqual([expect.objectContaining({connection:"closed",ownedRoot:"exited",callbacks:"drained",backgroundTools:"unknown",nativeSessionDeleted:false})]);expect(runtime.hasUnclosedHosts()).toBe(false);
 apply();expect(f.service["agentAdapters"].has("pi")).toBe(false);expect(store.binding(run.sessionId)).toEqual(binding);expect(readFileSync(marker,"utf8")).toBe("synthetic native session");expect(store.observation(run.sessionId)).toMatchObject({state:"unknown",pendingTools:"unknown",pendingApprovals:"unknown"});
});
it.each(["disable","remove"] as const)("retains unknown callback cleanup as a profile %s barrier for a terminal fixture",async change=>{
 const f=await fixture(),runtime=f.service["piRuntimes"].get("pi")!,start=runtime.start.bind(runtime),held=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>();
 const boundary=vi.spyOn(runtime,"start").mockImplementation(input=>start({...input,onNativeEvent:async fact=>{await input.onNativeEvent?.(fact);if(fact.state==="completed"){entered.resolve();await held.promise;}}}));
 try{
  const run=await f.dispatch();await entered.promise;await terminalFixture(f,run,"FAILED");const binding=new InteractionStore(f.service.database).binding(run.sessionId),apply=changeProfile(f,change),before=f.service.configuration.current();
  const backend=[...runtime["executions"].values()][0]!.backend;expect(runtime.hasActiveOperations()).toBe(true);expect(backend.hasActiveOperations()).toBe(true);
  expect(apply).toThrow(expect.objectContaining({code:"ACTIVE_AGENT_PROFILE"}));const receipts=await f.service.disconnectNativeRuntime("pi");expect(receipts).toEqual([expect.objectContaining({connection:"closed",ownedRoot:"exited",callbacks:"unknown",backgroundTools:"unknown",nativeSessionDeleted:false})]);
  expect(runtime.hasActiveOperations()).toBe(true);expect(backend.hasActiveOperations()).toBe(true);expect(apply).toThrow(expect.objectContaining({code:"NATIVE_RUNTIME_DRAIN_REQUIRED"}));held.resolve();await vi.waitFor(()=>{expect(runtime.hasActiveOperations()).toBe(false);expect(backend.hasActiveOperations()).toBe(false);});
  expect(await f.service.disconnectNativeRuntime("pi")).toEqual(receipts);expect(runtime.hasUnclosedHosts()).toBe(true);expect(apply).toThrow(expect.objectContaining({code:"NATIVE_RUNTIME_DRAIN_REQUIRED"}));expect(f.service.configuration.current()).toEqual(before);expect(new InteractionStore(f.service.database).binding(run.sessionId)).toEqual(binding);
  services.splice(services.indexOf(f.service),1);await expect(f.service.stop()).rejects.toMatchObject({code:"NATIVE_RUNTIME_CLEANUP_UNKNOWN"});f.service.database.close();
 }finally{held.resolve();boundary.mockRestore();}
});

it.each(["resolve","reject"] as const)("retains the registered Pi runtime and SQLite while rejected raw guard work awaits late %s",async settlement=>{
 const f=await fixture(),runtime=f.service["piRuntimes"].get("pi")!,start=runtime.start.bind(runtime);let original:CliStartInput|undefined;
 const capture=vi.spyOn(runtime,"start").mockImplementation(input=>{original=input;return start(input);});
 const held=Promise.withResolvers<void>(),databaseClose=vi.spyOn(f.service.database,"close");let guard:ReturnType<typeof vi.spyOn>|undefined;
 try{
  const run=await f.dispatch();await terminalFixture(f,run);capture.mockRestore();
  const binding=new InteractionStore(f.service.database).binding(run.sessionId)!,wireBefore=readFileSync(join(f.root,"wire-types"),"utf8"),adapter=f.service["agentAdapters"].get("pi")!;
  // Adversarial entered callback; the production Controller guard is synchronous.
  guard=vi.spyOn(f.service as unknown as {assertManagedPiInput:(profileId:string,input:CliStartInput)=>void},"assertManagedPiInput").mockImplementation(()=>held.promise);
  expect(()=>start(original!)).toThrowError(expect.objectContaining({code:"PI_RPC_SCOPE_CHANGED",creationOutcome:"not-created"}));guard.mockRestore();
  const receipts=await f.service.disconnectNativeRuntime("pi");expect(receipts).toEqual([expect.objectContaining({connection:"closed",ownedRoot:"exited",callbacks:"drained",backgroundTools:"unknown",nativeSessionDeleted:false})]);
  expect(runtime.hasUnclosedHosts()).toBe(false);expect(adapter).toBeInstanceOf(StructuredCliAdapter);expect((adapter as StructuredCliAdapter).hasActiveOperations()).toBe(false);
  expect(runtime.hasActiveOperations()).toBe(true);expect([...runtime["executions"].values()][0]!.backend.hasActiveOperations()).toBe(false);
  expect(f.service["piRuntimes"].get("pi")).toBe(runtime);expect(runtime.isClosed()).toBe(true);expect(f.service["nativePort"](binding)).toBeUndefined();
  const close=vi.spyOn(f.service.app,"close"),closeEvents=vi.spyOn(f.service.events,"close");services.splice(services.indexOf(f.service),1);
  await expect(f.service.stop()).rejects.toMatchObject({code:"NATIVE_RUNTIME_CLEANUP_UNKNOWN"});expect(close).toHaveBeenCalledOnce();expect(closeEvents).toHaveBeenCalledOnce();expect(databaseClose).not.toHaveBeenCalled();
  expect(f.service.database.getEntity("native-runtime-disconnect","pi")).toMatchObject({backendId:"pi-rpc",receipts});expect(f.service["piRuntimes"].get("pi")).toBe(runtime);
  const apply=changeProfile(f,"disable"),before=f.service.configuration.current();
  expect(apply).toThrow(expect.objectContaining({code:"ACTIVE_AGENT_PROFILE"}));expect(f.service.configuration.current()).toEqual(before);
  if(settlement==="resolve")held.resolve();else held.reject(Error("late private service guard"));await vi.waitFor(()=>expect(runtime.hasActiveOperations()).toBe(false));
  expect(await f.service.disconnectNativeRuntime("pi")).toEqual(receipts);expect(readFileSync(join(f.root,"wire-types"),"utf8")).toBe(wireBefore);expect(f.service["nativePort"](binding)).toBeUndefined();expect(f.service["piRuntimes"].get("pi")).toBe(runtime);expect(f.service["agentAdapters"].get("pi")).toBe(adapter);expect(new InteractionStore(f.service.database).binding(run.sessionId)).toEqual(binding);expect(databaseClose).not.toHaveBeenCalled();
 }finally{held.resolve();guard?.mockRestore();capture.mockRestore();const index=services.indexOf(f.service);if(index>=0)services.splice(index,1);await f.service.app.close();f.service.events.close();if(databaseClose.mock.calls.length===0)f.service.database.close();}
});

// Removing the Pi read-only constructor/reconcile admission must fail these assertions.
it.each(["QUEUED","RUNNING"] as const)("recovers a consistent %s Pi saved binding without new native work",async taskState=>{
 const f=await fixture(),run=await f.dispatch("restart"),store=new InteractionStore(f.service.database);
 expect(await f.adapter.result(run.sessionId)).toMatchObject({state:"COMPLETED"});
 const task=f.service.database.getCanonicalTask(run.taskId)!;
 f.service.database.writeCanonicalTask(run.taskId,task.revision,JSON.parse(JSON.stringify({...task.document as object,state:taskState})));
 const original=f.service.database.getEntity("run",run.id),session=f.service.database.getEntity("session",run.sessionId),adapter=f.service.database.getEntity("adapter-session",run.sessionId),binding=store.binding(run.sessionId)!;
 f.service.database.saveEntity("task-dispatch","restart-receipt",JSON.parse(JSON.stringify({run:original,routing:{fixture:true}})));
 await f.service.stop();services.splice(services.indexOf(f.service),1);
 const db=new DispatcherDatabase(join(f.root,"controller","dispatcher.sqlite")),saved=new InteractionStore(db);
 saved.invalidateObservation({sessionId:run.sessionId,readBarrier:"old-barrier",observation:{version:1,id:"old-observation",nativeSessionId:binding.nativeSessionId,executionRefId:binding.executionRefId,scopeFingerprint:"old-scope",observedAt:new Date().toISOString(),state:"unknown",pendingTools:"unknown",pendingApprovals:"unknown",historyMode:"unknown",readability:"unknown"}});
 expect(saved.saveObservation({sessionId:run.sessionId,observerGeneration:99,observerSequence:99,controlEpoch:saved.control(run.sessionId)!.epoch,readBarrier:"old-barrier",observation:{version:1,id:"prior-readable",nativeSessionId:binding.nativeSessionId,executionRefId:binding.executionRefId,scopeFingerprint:"old-scope",observedAt:new Date().toISOString(),state:"idle",pendingTools:"none",pendingApprovals:"none",historyMode:"snapshot-only",readability:"readable"}})).toEqual({accepted:true});db.close();
 const wireBefore=readFileSync(join(f.root,"wire-types"),"utf8"),traceBefore=readFileSync(join(f.root,"child-trace.jsonl"),"utf8"),environmentBefore=readFileSync(join(f.root,"environment.jsonl"),"utf8"),producer=vi.spyOn(PiRpcExecutionBackend.prototype,"start");
 let restored:ControllerService|undefined;
 try{
  expect(()=>{restored=new ControllerService({dataDirectory:join(f.root,"controller"),ownerToken:"fixture-owner",withRunner:true,backgroundWorker:{enabled:false}});}).not.toThrow();
  await restored!.start({listen:false});const recovered=restored!.database.getEntity("run",run.id),read=await restored!.app.inject({headers,url:`/api/runs/${run.id}`});
  expect(read.statusCode,read.body).toBe(200);expect(read.json()).toMatchObject({run:{id:run.id,sessionId:run.sessionId,state:"RUNNER_UNAVAILABLE",recoveryReason:"NATIVE_OUTCOME_UNKNOWN",resumePolicy:"manual"},nativeSession:{state:"unknown",mutationAvailable:false}});
  expect(recovered).toEqual({...original as object,state:"RUNNER_UNAVAILABLE",recoveryState:"ACTIVE",recoveryReason:"NATIVE_OUTCOME_UNKNOWN",resumePolicy:"manual"});
  expect(restored!.database.getEntity("session",run.sessionId)).toEqual(session);expect(restored!.database.getEntity("adapter-session",run.sessionId)).toEqual(adapter);
  expect(restored!.database.getEntity("task-dispatch","restart-receipt")).toEqual({run:recovered,routing:{fixture:true}});
  expect(restored!.database.getCanonicalTask(run.taskId)?.document).toMatchObject({state:taskState==="QUEUED"?"WAITING_RESOURCE":"WAITING_USER"});
  const restoredStore=new InteractionStore(restored!.database);expect(restoredStore.binding(run.sessionId)).toEqual(binding);expect(restoredStore.nativeReadBarrier(run.sessionId)).not.toBe("old-barrier");expect(restoredStore.observation(run.sessionId)).toMatchObject({state:"unknown",pendingTools:"unknown",pendingApprovals:"unknown",historyMode:"unknown",readability:"unknown"});
  expect(restored!["nativePort"](binding)).toBeUndefined();expect(restored!["piRuntimes"].get("pi")!["executions"].size).toBe(0);
  const fence=restored!["nativeInteractions"].fenceFor(recovered as unknown as Run,"restart-continue");
  for(const operation of ["continue","steer","approval","verify","deliver"] as const)expect(restored!["nativeInteractions"].authorizeInteraction({id:"owner",roles:["operator"],profileId:"pi"},operation,fence).allowed).toBe(false);
  const advance=await restored!.app.inject({headers,method:"POST",url:`/api/runs/${run.id}/advance`});expect(advance.statusCode).toBe(409);
  expect(producer).not.toHaveBeenCalled();expect(readFileSync(join(f.root,"wire-types"),"utf8")).toBe(wireBefore);expect(readFileSync(join(f.root,"child-trace.jsonl"),"utf8")).toBe(traceBefore);expect(readFileSync(join(f.root,"environment.jsonl"),"utf8")).toBe(environmentBefore);
 }finally{producer.mockRestore();await restored?.stop();}
});

async function savedPiFixture(taskId:string){
 const f=await fixture(),run=await f.dispatch(taskId);expect(await f.adapter.result(run.sessionId)).toMatchObject({state:"COMPLETED"});
 await f.service.stop();services.splice(services.indexOf(f.service),1);
 return {...f,run,path:join(f.root,"controller","dispatcher.sqlite"),nativeBytes:["wire-types","environment.jsonl","child-trace.jsonl"].map(name=>[name,readFileSync(join(f.root,name),"utf8")] as const)};
}
it("qualifies only stored Pi ownership with zero writes and no physical/native/account read",async()=>{
 const f=await savedPiFixture("readonly"),db=new DispatcherDatabase(f.path);
 // Physical admission remains independent of cold metadata qualification.
 rmSync(f.scope.executable);rmSync(f.scope.agentDirectory,{recursive:true});rmSync(f.scope.sessionDirectory,{recursive:true});rmSync(f.run.worktree!,{recursive:true});
 const producer=vi.spyOn(PiRpcExecutionBackend.prototype,"start");
 try{
  const stored=db.getEntity("run",f.run.id) as unknown as Run,writes=db.handle.prepare("SELECT total_changes() AS count").get();
  expect(isReadableManagedPiRun(db,stored)).toBe(true);expect(isReadableManagedCodexRun(db,stored)).toBe(false);expect(isReadableManagedOpenCodeRun(db,stored)).toBe(false);expect(isGuardedControllerStart(db,stored)).toBe(false);
  expect(db.handle.prepare("SELECT total_changes() AS count").get()).toEqual(writes);expect(producer).not.toHaveBeenCalled();for(const [name,bytes] of f.nativeBytes)expect(readFileSync(join(f.root,name),"utf8")).toBe(bytes);
 }finally{db.close();producer.mockRestore();}
 expect(()=>new ControllerService({dataDirectory:join(f.root,"controller"),ownerToken:"fixture-owner",withRunner:true,backgroundWorker:{enabled:false}})).toThrow(expect.objectContaining({code:"PI_RPC_SCOPE_CHANGED",creationOutcome:"not-created"}));
});
// The unchanged OpenCode matrix covers all shared checkedManagedRun field guards.
// These real Pi rows exercise each ownership boundary plus decisive Pi shape checks.
const corruptPiFields:StoredEdit[]=[
 ["run","providerId","codex"],["run","modelSelection",{}],["run","executionSelection.contextFingerprint","other"],
 ["run","executionRef.workspaceId","other"],["run","worktree","/other"],
 ["session","profileId","other"],["session","executionRef.id","other"],
 ["run-contract","workspace.repositoryId","other"],["run-contract","workspace.baseCommit","other"],
 ["adapter-session","runId","other"],["adapter-session","backendId","other"],["adapter-session","workspacePath","/other"],
 ["adapter-session","nativeInvocationId",undefined],["adapter-session","executionSelection.requestedModel","other"],
 ["adapter-session","execution.generation",2],["adapter-session","execution.attempt",2],["adapter-session","execution.leaseId","other"],
 ["adapter-session","nativeIdentityIssue","NATIVE_BINDING_CONFLICT"],
 ["adapter-session","nativeBinding.nativeStoreRef","opaque-other-store"],["session","nativeSessionId","00000000-0000-4000-8000-000000000000"],
];
const corruptPiBindings:readonly (readonly [field:string,value:unknown])[]=[
 ["product","codex"],["backendId","codex-app-server"],["region","cn"],["nativeThreadId","thread"],["parentSessionId","parent"],
 ["nativeSessionId",""],["nativeSessionId","00000000-0000-4000-8000-00000000000"],["nativeSessionId","00000000-0000-4000-8000-0000000000000"],
 ["nativeSessionId","00000000-0000-4000-8000-00000000000g"],["nativeSessionId","00000000000040008000000000000000"],
 ["nativeSessionId","00000000-0000-4000-8000-000000000000\n"],
];
it.each([
 ...corruptPiFields.map(edit=>({label:`${edit[0]}.${edit[1]}`,edit,binding:undefined})),
 ...corruptPiBindings.map(binding=>({label:`consistent-binding:${binding[0]}=${JSON.stringify(binding[1])}`,binding,edit:undefined})),
 ...["missing-session","missing-adapter","missing-contract","missing-binding","missing-control","identity-diagnostic","current-run","duplicate-control","control-row-epoch","control-row-revision","control-row-state","control-document-owner","stored-binding-store"].map(label=>({label,edit:undefined,binding:undefined})),
])("keeps corrupted Pi restart closed for $label without modifying the original Run",async({label,edit,binding})=>{
 const f=await savedPiFixture("corrupt"),db=new DispatcherDatabase(f.path);let closed=false;
 const producer=vi.spyOn(PiRpcExecutionBackend.prototype,"start");
 try{
  if(edit)editStored(db,f.run,edit);
  else if(binding)replaceBindingCopies(db,f.run,...binding);
  else if(label.startsWith("missing-")){
   const kind=label.slice(8);if(kind==="binding"||kind==="control")db.handle.prepare(`DELETE FROM ${kind==="binding"?"native_bindings":"session_controls"} WHERE session_id=?`).run(f.run.sessionId);
   else {if(kind==="session")db.handle.exec("PRAGMA foreign_keys=OFF");db.handle.prepare("DELETE FROM entities WHERE kind=? AND id=?").run(kind==="adapter"?"adapter-session":kind==="contract"?"run-contract":kind,kind==="contract"?f.run.id:f.run.sessionId);if(kind==="session")db.handle.exec("PRAGMA foreign_keys=ON");}
  }else if(label==="identity-diagnostic")db.handle.prepare("INSERT INTO native_identity_diagnostics(id,session_id,code) VALUES(?,?,?)").run("corrupt",f.run.sessionId,"NATIVE_BINDING_CONFLICT");
  else if(label==="current-run"){const task=db.getCanonicalTask(f.run.taskId)!;db.writeCanonicalTask(f.run.taskId,task.revision,JSON.parse(JSON.stringify({...task.document as object,currentRunId:"other"})));}
  else if(label==="duplicate-control"){
   const control=new InteractionStore(db).control(f.run.sessionId)!;db.saveEntity("session","other-session",{id:"other-session",providerId:"pi",profileId:"pi"});db.handle.prepare("INSERT INTO session_controls(session_id,active_run_id,epoch,revision,state,document_json) VALUES(?,?,?,?,?,?)").run("other-session",f.run.id,control.epoch,control.revision,control.state,JSON.stringify({...control,sessionId:"other-session"}));
  }else if(label.startsWith("control-row-")){const column=label.slice(12);db.handle.prepare(`UPDATE session_controls SET ${column}=? WHERE session_id=?`).run(column==="state"?"HUMAN":2,f.run.sessionId);}
  else if(label==="control-document-owner"){const control=new InteractionStore(db).control(f.run.sessionId)!;db.handle.prepare("UPDATE session_controls SET document_json=? WHERE session_id=?").run(JSON.stringify({...control,activeRunId:"other"}),f.run.sessionId);}
  else {const stored=new InteractionStore(db).binding(f.run.sessionId)!;db.handle.prepare("UPDATE native_bindings SET document_json=? WHERE session_id=?").run(JSON.stringify({...stored,nativeStoreRef:"opaque-other-store"}),f.run.sessionId);}
  const before=db.getEntity("run",f.run.id),writes=db.handle.prepare("SELECT total_changes() AS count").get();expect(isReadableManagedPiRun(db,before as unknown as Run)).toBe(false);expect(db.handle.prepare("SELECT total_changes() AS count").get()).toEqual(writes);db.close();closed=true;
  let restored:ControllerService|undefined;try{expect(()=>{restored=new ControllerService({dataDirectory:join(f.root,"controller"),ownerToken:"fixture-owner",withRunner:true,backgroundWorker:{enabled:false}});}).toThrow(expect.objectContaining({code:"NATIVE_CONTROL_RUNTIME_UNAVAILABLE"}));}finally{await restored?.stop();}
  const checked=new DispatcherDatabase(f.path);try{expect(checked.getEntity("run",f.run.id)).toEqual(before);}finally{checked.close();}
  expect(producer).not.toHaveBeenCalled();for(const [name,bytes] of f.nativeBytes)expect(readFileSync(join(f.root,name),"utf8")).toBe(bytes);
 }finally{if(!closed)db.close();producer.mockRestore();}
});
it.each([
 ["nativeSessionId","ABCDEFAB-CDEF-ABCD-EFAB-CDEFABCDEFAB"],
 ["nativeStoreRef","opaque-rewritten-store"],
] as const)("accepts consistent opaque Pi %s agreement without claiming external provenance",async(field,value)=>{
 const f=await savedPiFixture("opaque"),db=new DispatcherDatabase(f.path);
 try{replaceBindingCopies(db,f.run,field,value);const writes=db.handle.prepare("SELECT total_changes() AS count").get();expect(isReadableManagedPiRun(db,db.getEntity("run",f.run.id) as unknown as Run)).toBe(true);expect(db.handle.prepare("SELECT total_changes() AS count").get()).toEqual(writes);for(const [name,bytes] of f.nativeBytes)expect(readFileSync(join(f.root,name),"utf8")).toBe(bytes);}finally{db.close();}
});
