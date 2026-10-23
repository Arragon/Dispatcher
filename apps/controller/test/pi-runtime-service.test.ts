import {execFileSync} from "node:child_process";
import {existsSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {afterEach,expect,it,vi} from "vitest";
import type {AgentAdapter} from "@dispatcher/adapters";
import type {Run} from "@dispatcher/domain";
import {DispatcherDatabase,InteractionStore} from "@dispatcher/persistence";
import {piRpcFixture} from "../../../packages/adapters/test/fixtures/pi-rpc.js";
import {ControllerService} from "../src/service.js";
import type {PiExecutionRuntime} from "../src/pi-runtime.js";

const roots:string[]=[],services:ControllerService[]=[];
const headers={authorization:"Bearer fixture-owner"};
afterEach(async()=>{for(const service of services.splice(0))await service.stop();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
async function fixture(){
 const f=piRpcFixture(roots,"exec-ok");
 const git=(...args:string[])=>execFileSync("git",["-C",f.scope.workspacePath,...args],{stdio:"pipe"});
 git("init","--initial-branch=main");git("config","user.email","fixture@example.invalid");git("config","user.name","Fixture");writeFileSync(join(f.scope.workspacePath,"README.md"),"fixture\n");git("add",".");git("commit","-m","fixture");
 const service=new ControllerService({dataDirectory:join(f.root,"controller"),ownerToken:"fixture-owner",withRunner:true,backgroundWorker:{enabled:false}});services.push(service);await service.start({listen:false});
 const config=structuredClone(service.configuration.current().config);
 config.agentProfiles=[{id:"pi",alias:"Pi",provider:"pi",runnerId:"local",nativeInteraction:{mode:"compatible",backendId:"pi-rpc",executionLocation:"managed-worktree"},settings:{executable:f.scope.executable,agentDirectory:f.scope.agentDirectory,sessionDirectory:f.scope.sessionDirectory,model:"fixture/exec-ok"}}];
 config.repositories=[{id:"repo",root:f.scope.workspacePath,defaultBaseRef:"main",scopePaths:[],verificationCommands:[]}];
 const plan=service.configuration.buildPlan(config,"fixture","web"),applied=await service.app.inject({headers,method:"POST",url:`/api/config/plans/${plan.id}/apply`,payload:{confirmed:true}});
 expect(applied.statusCode,applied.body).toBe(200);
 const dispatch=async()=>{
  const now=new Date().toISOString(),taskId="task";
  service.tasks.execute({id:"create-task",taskId,baseRevision:0,actor:"fixture",command:{type:"task.create",task:{id:taskId,projectId:"fixture",title:"Pi fixture",state:"READY",labels:[],createdAt:now,updatedAt:now},bindings:[]}});
  service.database.saveTaskContract(taskId,{version:1,revision:1,goal:"Pi fixture",scope:["README.md"],acceptanceCriteria:["done"],verification:[],constraints:[],delivery:{type:"none",repository:"repo",baseBranch:"main"}});
  const response=await service.app.inject({headers,method:"POST",url:`/api/tasks/${taskId}/dispatch`,payload:{profileId:"pi"}});expect(response.statusCode,response.body).toBe(201);return response.json().run as Run;
 };
 const adapter=(service as unknown as {agentAdapters:Map<string,AgentAdapter>}).agentAdapters.get("pi")!;
 return {...f,service,dispatch,adapter};
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
