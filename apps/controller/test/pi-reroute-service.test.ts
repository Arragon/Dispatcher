import {execFileSync} from "node:child_process";
import {existsSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {afterEach,expect,it,vi} from "vitest";
import type {AgentAdapter,CodexBackend} from "@dispatcher/adapters";
import type {Run,Task} from "@dispatcher/domain";
import {InteractionStore} from "@dispatcher/persistence";
import {piRpcFixture} from "../../../packages/adapters/test/fixtures/pi-rpc.js";
import {ControllerService} from "../src/service.js";

const roots:string[]=[],services:ControllerService[]=[];
const headers={authorization:"Bearer fixture-owner"};
const context={principal:{id:"owner",roles:["operator"],channel:"api" as const},workflowId:"pi-reroute",confirmed:true};
afterEach(async()=>{for(const service of services.splice(0))await service.stop();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});

async function fixture(initialProfile="codex"){
 const f=piRpcFixture(roots,"exec-ok");
 const git=(...args:string[])=>execFileSync("git",["-C",f.scope.workspacePath,...args],{stdio:"pipe"});
 git("init","--initial-branch=main");git("config","user.email","fixture@example.invalid");git("config","user.name","Fixture");writeFileSync(join(f.scope.workspacePath,"README.md"),"fixture\n");git("add",".");git("commit","-m","fixture");
 const cancel=vi.fn(async()=>undefined),start=vi.fn<CodexBackend["start"]>(()=>({cancel,status:()=>"running",result:async()=>({state:"completed",summary:"fixture",providerSessionId:"codex-fixture"})}));
 const service=new ControllerService({dataDirectory:join(f.root,"controller"),ownerToken:"fixture-owner",withRunner:true,backgroundWorker:{enabled:false},codexBackendFactory:()=>({start})});services.push(service);await service.start({listen:false});
 const config=structuredClone(service.configuration.current().config);
 config.agentProfiles=[
  {id:"codex",alias:"Codex",provider:"codex",runnerId:"local",settings:{codexHome:join(f.root,"codex")}},
  {id:"pi",alias:"Pi",provider:"pi",runnerId:"local",nativeInteraction:{mode:"compatible",backendId:"pi-rpc",executionLocation:"managed-worktree"},settings:{executable:f.scope.executable,agentDirectory:f.scope.agentDirectory,sessionDirectory:f.scope.sessionDirectory,model:"fixture/exec-ok"}},
 ];
 config.repositories=[{id:"repo",root:f.scope.workspacePath,defaultBaseRef:"main",scopePaths:[],verificationCommands:[]}];
 const plan=service.configuration.buildPlan(config,"fixture","web"),applied=await service.app.inject({headers,method:"POST",url:`/api/config/plans/${plan.id}/apply`,payload:{confirmed:true}});
 expect(applied.statusCode,applied.body).toBe(200);
 const now=new Date().toISOString(),taskId="task";
 service.tasks.execute({id:"create-task",taskId,baseRevision:0,actor:"fixture",command:{type:"task.create",task:{id:taskId,projectId:"fixture",title:"Pi reroute fixture",state:"READY",labels:[],createdAt:now,updatedAt:now},bindings:[]}});
 service.database.saveTaskContract(taskId,{version:1,revision:1,goal:"Frozen reroute goal",scope:["README.md"],acceptanceCriteria:["done"],verification:[],constraints:[],delivery:{type:"none",repository:"repo",baseBranch:"main"}});
 const response=await service.app.inject({headers,method:"POST",url:`/api/tasks/${taskId}/dispatch`,payload:{profileId:initialProfile}});expect(response.statusCode,response.body).toBe(201);
 const old=response.json().run as Run;expect(old.state,old.failureReason).toBe("ACTIVE");
 const adapters=(service as unknown as {agentAdapters:Map<string,AgentAdapter>}).agentAdapters;
 return {...f,service,old,cancel,start,adapters};
}

it("reroutes a stopped legacy owner into Pi with a canonical replacement execution and transferred worktree",async()=>{
 const f=await fixture(),store=new InteractionStore(f.service.database),oldHandle=f.service.workspaces.get(f.old.worktree!)!,originalContract=f.service.database.getEntity("run-contract",f.old.id);
 const pi=f.adapters.get("pi")!,piStart=pi.start.bind(pi),start=vi.spyOn(pi,"start"),observed:unknown[]=[];
 start.mockImplementation(async input=>{
  observed.push({input,old:f.service.database.getEntity("run",f.old.id),replacement:f.service.database.getEntity("run",input.runId),handle:f.service.workspaces.get(input.workspacePath),command:store.command(`native-start:${input.runId}`),control:store.control(input.sessionId!),cancelCount:f.cancel.mock.calls.length});
  return piStart(input);
 });
 const result=await f.service.semanticTools.execute("run.reroute",{target:f.old.id,profileId:"pi"},context) as unknown as {run:Run};
 const run=result.run;
 expect(run.state,run.failureReason).toBe("ACTIVE");
 expect(run).toMatchObject({profileId:"pi",providerId:"pi",generation:2,attempt:2,worktree:f.old.worktree,branch:f.old.branch,resumePolicy:"controlled-reroute",revokedLeaseIds:[f.old.leaseId],executionSelection:{mode:"legacy",profileId:"pi",backendId:"pi-rpc",requestedModel:"fixture/exec-ok"}});
 expect(run.executionRef).toEqual({version:1,id:`execution:${run.id}`,kind:"managed-worktree",runnerId:"local",repositoryId:"repo",workspaceId:run.id,pathRef:`workspace:${run.id}`,branch:oldHandle.branch,baseRevision:oldHandle.baseRevision});
 expect(observed).toEqual([expect.objectContaining({old:expect.objectContaining({state:"SUPERSEDED",sessionId:f.old.sessionId}),replacement:expect.objectContaining({state:"STARTING",executionRef:run.executionRef}),handle:expect.objectContaining({runId:run.id,attempt:2}),command:expect.objectContaining({state:"RESERVED"}),control:expect.objectContaining({state:"AUTOMATED"}),cancelCount:1,input:expect.objectContaining({runId:run.id,sessionId:run.sessionId,executionRef:run.executionRef,execution:{generation:2,attempt:2,leaseId:run.leaseId},beforeCreate:expect.any(Function),beforeSend:expect.any(Function)})})]);
 expect(store.binding(run.sessionId)).toMatchObject({product:"pi",backendId:"pi-rpc",executionRefId:run.executionRef!.id,nativeSessionId:run.providerSessionId});
 expect(store.command(`native-start:${run.id}`)).toMatchObject({state:"ACKNOWLEDGED",fence:{runId:run.id,generation:2,sessionId:run.sessionId,leaseId:run.leaseId}});
 expect(f.service.database.getCanonicalTask<Task>(f.old.taskId)?.document).toMatchObject({state:"RUNNING",currentRunId:run.id});
 expect(f.service.database.getEntity("workspace-handle",run.id)).toMatchObject({runId:run.id,attempt:2,path:f.old.worktree});
 expect(f.service.database.getEntity("workspace-transfer",f.old.id)).toMatchObject({previousRunId:f.old.id,runId:run.id,path:f.old.worktree});
 expect(f.service.database.getEntity("run-contract",run.id)).toEqual(originalContract);
 expect(readFileSync(join(f.root,"prompt-input"),"utf8")).toContain("Frozen reroute goal");
 const repeated=await f.service.semanticTools.execute("run.reroute",{target:f.old.id,profileId:"pi"},context) as unknown as {run:Run};
 expect(repeated.run.id).toBe(run.id);expect(start).toHaveBeenCalledOnce();expect(f.cancel).toHaveBeenCalledOnce();
});

it("does not create a Pi process when replacement worktree ownership drifts before the creation guard",async()=>{
 const f=await fixture(),adapter=f.adapters.get("pi")!,start=adapter.start.bind(adapter),oldHandle=f.service.workspaces.get(f.old.worktree!)!;
 vi.spyOn(adapter,"start").mockImplementation(async input=>{await f.service.workspaces.restore(oldHandle);return start(input);});
 const result=await f.service.semanticTools.execute("run.reroute",{target:f.old.id,profileId:"pi"},context) as unknown as {run:Run};
 expect(result.run.state).toBe("FAILED");expect(result.run.failureReason).toContain("The original managed Pi execution is unavailable");
 expect(result.run.executionRef?.workspaceId).toBe(result.run.id);
 expect(new InteractionStore(f.service.database).command(`native-start:${result.run.id}`)).toMatchObject({state:"FAILED",code:"PI_RPC_SCOPE_CHANGED"});
 expect(existsSync(join(f.root,"rpc-started"))).toBe(false);expect(f.cancel).toHaveBeenCalledOnce();
});

it("retains the native Pi owner when reroute cannot prove writer stop",async()=>{
 const f=await fixture("pi"),cancel=vi.spyOn(f.adapters.get("pi")!,"cancel");
 await expect(f.service.semanticTools.execute("run.reroute",{target:f.old.id,profileId:"codex"},context)).rejects.toMatchObject({code:"NATIVE_STATE_UNKNOWN"});
 expect(cancel).not.toHaveBeenCalled();expect(f.start).not.toHaveBeenCalled();
 expect(f.service.database.getEntity("run",f.old.id)).toMatchObject({state:"ACTIVE",sessionId:f.old.sessionId,leaseId:f.old.leaseId});
 expect(f.service.database.getCanonicalTask<Task>(f.old.taskId)?.document.currentRunId).toBe(f.old.id);
 expect(f.service.workspaces.get(f.old.worktree!)?.runId).toBe(f.old.id);
 expect(f.service.database.listEntities("workspace-transfer")).toHaveLength(0);
});
