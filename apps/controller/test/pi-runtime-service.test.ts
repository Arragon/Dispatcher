import {execFileSync} from "node:child_process";
import {existsSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {afterEach,expect,it,vi} from "vitest";
import {PiRpcExecutionBackend,type AgentAdapter,type CliStartInput} from "@dispatcher/adapters";
import {assertRunTransition,assertTaskTransition,isTerminalRunState,type Run,type Task} from "@dispatcher/domain";
import {DispatcherDatabase,InteractionStore} from "@dispatcher/persistence";
import {piRpcFixture} from "../../../packages/adapters/test/fixtures/pi-rpc.js";
import {ControllerService} from "../src/service.js";
import type {PiExecutionRuntime} from "../src/pi-runtime.js";

const roots:string[]=[],services:ControllerService[]=[];
const headers={authorization:"Bearer fixture-owner"};
afterEach(async()=>{for(const service of services.splice(0))await service.stop();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
async function fixture(capacity=1){
 const f=piRpcFixture(roots,"exec-ok");
 const git=(...args:string[])=>execFileSync("git",["-C",f.scope.workspacePath,...args],{stdio:"pipe"});
 git("init","--initial-branch=main");git("config","user.email","fixture@example.invalid");git("config","user.name","Fixture");writeFileSync(join(f.scope.workspacePath,"README.md"),"fixture\n");git("add",".");git("commit","-m","fixture");
 const service=new ControllerService({dataDirectory:join(f.root,"controller"),ownerToken:"fixture-owner",withRunner:true,backgroundWorker:{enabled:false}});services.push(service);await service.start({listen:false});
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
  expect(apply).toThrow(expect.objectContaining({code:"NATIVE_RUNTIME_DRAIN_REQUIRED"}));const receipts=await f.service.disconnectNativeRuntime("pi");expect(receipts).toEqual([expect.objectContaining({connection:"closed",ownedRoot:"exited",callbacks:"unknown",backgroundTools:"unknown",nativeSessionDeleted:false})]);
  expect(apply).toThrow(expect.objectContaining({code:"NATIVE_RUNTIME_DRAIN_REQUIRED"}));held.resolve();await vi.waitFor(()=>expect([...runtime["executions"].values()][0]!.backend["callbacks"].size).toBe(0));
  expect(await f.service.disconnectNativeRuntime("pi")).toEqual(receipts);expect(runtime.hasUnclosedHosts()).toBe(true);expect(apply).toThrow(expect.objectContaining({code:"NATIVE_RUNTIME_DRAIN_REQUIRED"}));expect(f.service.configuration.current()).toEqual(before);expect(new InteractionStore(f.service.database).binding(run.sessionId)).toEqual(binding);
  services.splice(services.indexOf(f.service),1);await expect(f.service.stop()).rejects.toMatchObject({code:"NATIVE_RUNTIME_CLEANUP_UNKNOWN"});f.service.database.close();
 }finally{held.resolve();boundary.mockRestore();}
});
