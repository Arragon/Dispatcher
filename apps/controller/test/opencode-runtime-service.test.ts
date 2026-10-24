import {execFileSync} from "node:child_process";
import {chmodSync,mkdirSync,mkdtempSync,realpathSync,renameSync,rmSync,writeFileSync,promises as physicalFs} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach,expect,it,vi} from "vitest";
import {OpenCodeAdapter,OpenCodeV2ExecutionBackend,OpenCodeV2InteractionPort,type AgentAdapter,type CliStartInput,type LocalRuntimeDisconnect,type OpenCodeV2OwnedScope} from "@dispatcher/adapters";
import type {ExecutionContextRef,Run} from "@dispatcher/domain";
import {DispatcherDatabase,InteractionStore,type JsonValue} from "@dispatcher/persistence";
import {DatabaseSync} from "node:sqlite";
import type {PiExecutionRuntime} from "../src/pi-runtime.js";
import type {CodexExecutionRuntime} from "../src/codex-runtime.js";
import {ControllerService} from "../src/service.js";
import {OpenCodeExecutionRuntime} from "../src/opencode-runtime.js";
import {normalizeOpenCodeCatalog} from "../../../packages/adapters/src/opencode-catalog.js";
import {isGuardedControllerStart,isReadableManagedCodexRun,isReadableManagedOpenCodeRun} from "../src/start-recovery.js";
vi.mock("node:fs/promises",async importOriginal=>{const actual=await importOriginal<typeof fsPromises>();return {...actual,access:vi.fn(actual.access)};});
import * as fsPromises from "node:fs/promises";
const actualAccess=physicalFs.access;
const fixtures:Array<{service:ControllerService;root:string;manualClose?:boolean}>=[];
afterEach(async()=>{for(const f of fixtures.splice(0)){if(!f.manualClose)await f.service.stop();rmSync(f.root,{recursive:true,force:true});}vi.restoreAllMocks();});
const json=(value:unknown):JsonValue=>JSON.parse(JSON.stringify(value)) as JsonValue;
function registry(service:ControllerService){return service["agentAdapters"];}
type FixtureHost={ready:()=>Promise<OpenCodeV2InteractionPort>;disconnectLocal:()=>Promise<LocalRuntimeDisconnect>};
async function fixture(options:{enabled?:boolean;executable?:"missing"|"directory"|"non-executable";cleanup?:Partial<LocalRuntimeDisconnect>;acquire?:(host:FixtureHost)=>FixtureHost|Promise<FixtureHost>}={}){
 const root=realpathSync(mkdtempSync(join(tmpdir(),"dispatcher-opencode-compose-"))),repo=join(root,"repo"),executable=join(root,"native.cjs");mkdirSync(repo);writeFileSync(executable,"#!"+process.execPath+"\nthrow Error('stub must never execute');\n");chmodSync(executable,0o700);
 execFileSync("git",["init","--initial-branch=main",repo]);execFileSync("git",["-C",repo,"config","user.email","fixture@example.invalid"]);execFileSync("git",["-C",repo,"config","user.name","Fixture"]);writeFileSync(join(repo,"README.md"),"fixture\n");execFileSync("git",["-C",repo,"add","README.md"]);execFileSync("git",["-C",repo,"commit","-m","fixture"]);
 const ports:Array<{scope:OpenCodeV2OwnedScope;port:OpenCodeV2InteractionPort;backend:OpenCodeV2ExecutionBackend;posts:string[];requests:string[];disconnect:ReturnType<typeof vi.fn>;inputs:CliStartInput[];bodies:unknown[]}>=[];
 const factory=vi.fn((scope:OpenCodeV2OwnedScope,ref:ExecutionContextRef)=>{
  const posts:string[]=[],requests:string[]=[],inputs:CliStartInput[]=[],bodies:unknown[]=[],native="ses_"+ref.id.replaceAll(":","_"),at=Date.now();let prompt="";
  // Pin the reviewed 2.0.26 protocol explicitly; its current session/message schema is shared with 2.0.22.
  const port=new OpenCodeV2InteractionPort({...scope,protocolVersion:"2.0.26"},{request:async input=>{input.beforeSend?.();requests.push(`${input.method} ${input.path}`);if(input.method==="POST"){posts.push(input.path);bodies.push(structuredClone(input.body));}
   if(input.path==="/api/info")return {version:"2.0.26",pid:123,urls:[],paths:{tmp:"/tmp"}};
   if(input.path==="/api/location")return {directory:scope.workspacePath,project:{id:"project",directory:scope.workspacePath,canonical:scope.workspacePath}};
   if(input.path==="/api/session"||input.path==="/api/session/"+native)return {data:{id:native,projectID:"project",model:{providerID:"provider",id:"model"},permissions:[],location:{directory:scope.workspacePath},time:{created:at,updated:at}}};
   if(input.path==="/api/session/active")return {data:{}};if(input.path.endsWith("/inbox")||input.path.endsWith("/permission"))return {data:[]};
   if(input.path.endsWith("/prompt")){prompt=(input.body as {text:string}).text;return {data:{id:"msg_receipt",sessionID:native,type:"user",payload:{text:prompt},delivery:"queue",time:{created:at}}};}
   if(input.path.endsWith("/message"))return {data:[{id:"msg_receipt",type:"user",text:prompt,time:{created:at}},{id:"msg_done",type:"idle",outcome:"succeeded",time:{created:at}}],cursor:{previous:null,next:null}};throw Error(input.path);
  }});
  const disconnect=vi.fn(async():Promise<LocalRuntimeDisconnect>=>{port.markDisconnected();return {version:1,connection:"closed",ownedRoot:"exited",callbacks:"drained",backgroundTools:"unknown",nativeSessionDeleted:false,...options.cleanup};});
  const backend=new OpenCodeV2ExecutionBackend({scope,executionRef:ref,hostFactory:()=>{const host={ready:async()=>port,disconnectLocal:disconnect};return options.acquire?options.acquire(host):host;}}),start=backend.start.bind(backend);
  vi.spyOn(backend,"start").mockImplementation(input=>{inputs.push(input);return start(input);});ports.push({scope,port,backend,posts,requests,disconnect,inputs,bodies});return backend;
 });
 const service=new ControllerService({dataDirectory:join(root,"data"),ownerToken:"fixture-owner",withRunner:true,opencodeExecutionFactory:factory,directoryPicker:async()=>repo});const holder={service,root,manualClose:false};fixtures.push(holder);await service.start({listen:false});
 const config=structuredClone(service.configuration.current().config);if(options.executable==="non-executable")chmodSync(executable,0o600);
 config.agentProfiles=[{id:"p",alias:"P",provider:"opencode",runnerId:"local",...(options.enabled===false?{enabled:false}:{}),settings:{executable:options.executable==="missing"?join(root,"missing"):options.executable==="directory"?repo:executable},nativeInteraction:{mode:"compatible",backendId:"opencode-server-v2",executionLocation:"managed-worktree"}}];config.repositories=[{id:"repo",root:repo,defaultBaseRef:"main",scopePaths:[],verificationCommands:[]}];
 const apply=()=>service.configuration.applyPlan(service.configuration.buildPlan(config,"owner","fixture").id,{confirmed:true});
 if(options.executable&&options.enabled!==false){const before=service.configuration.current();expect(apply).toThrow(expect.objectContaining({cause:expect.objectContaining({code:"OPENCODE_SCOPE_CHANGED",creationOutcome:"not-created"})}));expect(service.configuration.current()).toEqual(before);expect(factory).not.toHaveBeenCalled();}else apply();
 const create=async(id:string)=>{
  const w=await service.workspaces.create({repositoryId:"repo",taskId:id,runId:id,attempt:1,baseRef:"main",scopePaths:[]});
  const context=service["resolveProfileExecutionContext"]("p","repo","start");
  const run:Run={executionSelection:{version:1,mode:"manual",source:"explicit",selectionType:"explicit-model",requestedModel:"provider/model",profileId:"p",runnerId:"local",providerId:"opencode",backendId:"opencode-server-v2",nativeParameters:{},contextFingerprint:context.fingerprint,configRevision:context.configRevision,selectedAt:new Date().toISOString()},id,taskId:`task:${id}`,sessionId:`session:${id}`,profileId:"p",providerId:"opencode",runnerId:"local",state:"ACTIVE",generation:1,attempt:1,leaseId:`lease:${id}`,leaseExpiresAt:"2100-01-01T00:00:00Z",taskRevision:1,contractRevision:1,worktree:w.path,executionRef:{version:1,id:`execution:${id}`,kind:"managed-worktree",runnerId:"local",repositoryId:"repo",workspaceId:id,pathRef:`workspace:${id}`,branch:w.branch,baseRevision:w.baseRevision}};
  service.database.saveEntity("run-contract",id,json({version:1,revision:1,goal:"Fixture",scope:["."],acceptanceCriteria:["done"],verification:[],constraints:[],delivery:{type:"none"},workspace:{repositoryId:"repo",baseCommit:w.baseRevision,baseRef:"main"}}));
  service.database.writeCanonicalTask(run.taskId,0,json({id:run.taskId,projectId:"local:repo",state:"RUNNING",currentRunId:id}),new Date().toISOString());service.database.saveEntity("run",id,json(run));service.database.saveEntity("session",run.sessionId,json({id:run.sessionId,profileId:"p",providerId:"opencode",resumable:true,executionRef:run.executionRef,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}));new InteractionStore(service.database).initializeControl({sessionId:run.sessionId,activeRunId:run.id,exclusion:"none",at:new Date().toISOString()});return run;
 };
 const start=(run:Run)=>registry(service).get("p")!.start({runId:run.id,sessionId:run.sessionId,workspacePath:run.worktree,backendId:"opencode-server-v2",prompt:"fixture",executionSelection:run.executionSelection,beforeCreate:()=>{},beforeSend:()=>{},executionRef:run.executionRef,execution:{generation:1,attempt:1,leaseId:run.leaseId}});
 return {service,holder,root,executable,repo,ports,factory,create,start};
}
// S1: exact managed worktrees and native sessions, server selection and no standalone argv.
it("composes two lazy exact server executions without an aggregate or standalone fallback",async()=>{
 const f=await fixture();expect(registry(f.service).get("p")).toBeInstanceOf(OpenCodeAdapter);expect(f.factory).not.toHaveBeenCalled();const a=await f.create("a"),b=await f.create("b"),[sa,sb]=await Promise.all([f.start(a),f.start(b)]);
 expect(f.ports).toHaveLength(2);expect(a.worktree).not.toBe(b.worktree);expect(sa.nativeBinding).toMatchObject({backendId:"opencode-server-v2",executionRefId:a.executionRef!.id});expect(sb.nativeBinding!.nativeSessionId).not.toBe(sa.nativeBinding!.nativeSessionId);expect(new InteractionStore(f.service.database).binding(sa.id)).toEqual(sa.nativeBinding);expect(registry(f.service).get("p")!.interaction).toBeUndefined();
 for(const [index,run] of [a,b].entries()){const leaf=f.ports[index]!;expect(leaf.scope.workspacePath).toBe(run.worktree);expect(leaf.inputs[0]!.args).toEqual([]);expect(leaf.inputs[0]!.nativeInput!.executionSelection!.backendId).toBe("opencode-server-v2");expect(leaf.bodies[0]).toMatchObject({model:{providerID:"provider",id:"model"}});expect(leaf.posts).toEqual(["/api/session",`/api/session/${(index===0?sa:sb).nativeBinding!.nativeSessionId}/prompt`]);await registry(f.service).get("p")!.result((index===0?sa:sb).id);}
 expect(f.service["nativePort"](sa.nativeBinding!)).toBe(f.ports[0]!.port);expect(f.service["nativePort"](sb.nativeBinding!)).toBe(f.ports[1]!.port);
});

async function endFixtureRun(f:Awaited<ReturnType<typeof fixture>>,run:Run,failedAdmission=false):Promise<void>{
 if(failedAdmission)await expect(registry(f.service).get("p")!.result(run.sessionId)).rejects.toThrow();else await registry(f.service).get("p")!.result(run.sessionId);
 const current=f.service.database.getEntity("run",run.id) as unknown as Run;f.service.database.saveEntity("run",run.id,json({...current,state:"FAILED",endedAt:new Date().toISOString()}));
 const task=f.service.database.getCanonicalTask(run.taskId)!;f.service.database.writeCanonicalTask(run.taskId,task.revision,json({...task.document as object,state:"FAILED"}));
}
function replaceProfile(f:Awaited<ReturnType<typeof fixture>>){
 const changed=structuredClone(f.service.configuration.current().config);changed.agentProfiles[0]!.alias="Changed";
 return ()=>f.service.configuration.applyPlan(f.service.configuration.buildPlan(changed,"owner","fixture").id,{confirmed:true});
}
it.each(["QUEUED","RUNNING"] as const)("recovers a consistent %s OpenCode execution as unknown metadata without another native call",async taskState=>{
 const f=await fixture(),run=await f.create("restart"),session=await f.start(run),store=new InteractionStore(f.service.database);
 await registry(f.service).get("p")!.result(session.id);
 const task=f.service.database.getCanonicalTask(run.taskId)!;
 f.service.database.writeCanonicalTask(run.taskId,task.revision,json({...task.document as object,state:taskState}));
 const original=f.service.database.getEntity("run",run.id),originalSession=f.service.database.getEntity("session",run.sessionId),originalAdapter=f.service.database.getEntity("adapter-session",run.sessionId);
 f.service.database.saveEntity("task-dispatch","restart-receipt",json({run:original,routing:{fixture:true}}));
 store.saveObservation({sessionId:run.sessionId,observerGeneration:1,observerSequence:1,controlEpoch:1,observation:await f.ports[0]!.port.inspect(session.nativeBinding!)});
 await f.service.stop();f.holder.manualClose=true;
 const saved=new DispatcherDatabase(join(f.root,"data","dispatcher.sqlite")),oldBarrier=new InteractionStore(saved).nativeReadBarrier(run.sessionId);saved.close();
 const requests=[...f.ports[0]!.requests],restored=new ControllerService({dataDirectory:join(f.root,"data"),ownerToken:"fixture-owner",withRunner:true,opencodeExecutionFactory:f.factory});
 try{
  await restored.start({listen:false});const headers={authorization:"Bearer fixture-owner"},read=await restored.app.inject({url:`/api/runs/${run.id}`,headers}),recovered=restored.database.getEntity("run",run.id);
  expect(read.statusCode,read.body).toBe(200);expect(read.json()).toMatchObject({run:{id:run.id,sessionId:run.sessionId,state:"RUNNER_UNAVAILABLE",recoveryReason:"NATIVE_OUTCOME_UNKNOWN",resumePolicy:"manual"},nativeSession:{state:"unknown",mutationAvailable:false}});
  expect(recovered).toEqual({...original as object,state:"RUNNER_UNAVAILABLE",recoveryState:"ACTIVE",recoveryReason:"NATIVE_OUTCOME_UNKNOWN",resumePolicy:"manual"});
  expect(restored.database.getEntity("session",run.sessionId)).toEqual(originalSession);expect(restored.database.getEntity("adapter-session",run.sessionId)).toEqual(originalAdapter);
  expect(restored.database.getEntity("task-dispatch","restart-receipt")).toEqual({run:recovered,routing:{fixture:true}});
  expect(restored.database.getCanonicalTask(run.taskId)?.document).toMatchObject({state:taskState==="QUEUED"?"WAITING_RESOURCE":"WAITING_USER"});
  const restoredStore=new InteractionStore(restored.database);expect(restoredStore.binding(run.sessionId)).toEqual(session.nativeBinding);expect(restoredStore.nativeReadBarrier(run.sessionId)).not.toBe(oldBarrier);
  expect(restoredStore.observation(run.sessionId)).toMatchObject({state:"unknown",pendingTools:"unknown",pendingApprovals:"unknown",historyMode:"unknown",readability:"unknown"});
  expect(restored["nativePort"](session.nativeBinding!)).toBeUndefined();expect(registry(restored).get("p")!.interaction).toBeUndefined();
  const recoveredRun=recovered as unknown as Run,fence=restored["nativeInteractions"].fenceFor(recoveredRun,"restart-continue");
  for(const operation of ["continue","steer","approval","verify","deliver"] as const)expect(restored["nativeInteractions"].authorizeInteraction({id:"owner",roles:["operator"],profileId:"p"},operation,fence).allowed).toBe(false);
  const advance=await restored.app.inject({method:"POST",url:`/api/runs/${run.id}/advance`,headers});expect(advance.statusCode).toBe(409);
  expect(f.factory).toHaveBeenCalledOnce();expect(f.ports[0]!.requests).toEqual(requests);expect(f.ports[0]!.disconnect).toHaveBeenCalledOnce();
 }finally{await restored.stop();}
});
it("qualifies only stored OpenCode records without writes or a physical executable",async()=>{
 const f=await fixture(),run=await f.create("readonly"),session=await f.start(run);await registry(f.service).get("p")!.result(session.id);await f.service.stop();f.holder.manualClose=true;rmSync(f.executable);
 const db=new DispatcherDatabase(join(f.root,"data","dispatcher.sqlite"));
 try{const stored=db.getEntity("run",run.id) as unknown as Run,before=db.handle.prepare("SELECT total_changes() AS count").get(),requests=[...f.ports[0]!.requests];
  expect(isReadableManagedOpenCodeRun(db,stored)).toBe(true);expect(isReadableManagedCodexRun(db,stored)).toBe(false);expect(isGuardedControllerStart(db,stored)).toBe(false);expect(db.handle.prepare("SELECT total_changes() AS count").get()).toEqual(before);expect(f.factory).toHaveBeenCalledOnce();expect(f.ports[0]!.requests).toEqual(requests);
 }finally{db.close();}
 // Enabled runtime executable admission remains a separate constructor requirement.
 expect(()=>new ControllerService({dataDirectory:join(f.root,"data"),ownerToken:"fixture-owner",withRunner:true,opencodeExecutionFactory:f.factory})).toThrow(expect.objectContaining({code:"OPENCODE_SCOPE_CHANGED",creationOutcome:"not-created"}));expect(f.factory).toHaveBeenCalledOnce();
});
type StoredEdit=readonly [kind:string,path:string,value:unknown];
const corruptOpenCodeFields:StoredEdit[]=[
 ["run","providerId",undefined],["run","providerId","codex"],["session","providerId",undefined],["session","providerId","codex"],
 ["run","executionSelection",undefined],["run","modelSelection",{}],
 ...["backendId","profileId","runnerId","providerId","contextFingerprint","requestedModel"].map(field=>["run",`executionSelection.${field}`,"other"] as const),
 ["run","executionRef",undefined],["run","executionRef.kind","provider-cloud"],["run","executionRef.workspaceId","other"],["run","executionRef.pathRef","workspace:other"],["run","worktree",undefined],
 ["session","id","other"],["session","profileId","other"],["session","executionRef.id","other"],
 ["run-contract","workspace.repositoryId","other"],["run-contract","workspace.baseCommit","other"],["run-contract","workspace.repositoryId",undefined],["run-contract","workspace.baseCommit",undefined],
 ...["id","runId","profileId","backendId","workspacePath","nativeIdentityIssue"].map(field=>["adapter-session",field,"other"] as const),
 ["adapter-session","nativeInvocationId",undefined],["adapter-session","executionSelection.requestedModel","other"],["adapter-session","executionRef.id","other"],
 ["adapter-session","execution.generation",2],["adapter-session","execution.attempt",2],["adapter-session","execution.leaseId","other"],
 ["session","nativeBinding",undefined],["adapter-session","nativeBinding",undefined],
 ["session","nativeBinding.nativeSessionId","ses_other"],["adapter-session","nativeBinding.nativeStoreRef","other"],
 ["session","nativeSessionId","ses_other"],["adapter-session","providerSessionId","ses_other"],["run","providerSessionId","ses_other"],
];
function editStored(db:DispatcherDatabase,run:Run,[kind,path,value]:StoredEdit){
 const id=kind==="run"||kind==="run-contract"?run.id:run.sessionId,document=db.getEntity(kind,id) as Record<string,unknown>,keys=path.split(".");let target=document;
 for(const key of keys.slice(0,-1))target=target[key] as Record<string,unknown>;
 const key=keys.at(-1)!;if(value===undefined)delete target[key];else target[key]=value;
 db.handle.prepare("UPDATE entities SET document_json=? WHERE kind=? AND id=?").run(JSON.stringify(document),kind,id);
}
function replaceBindingCopies(db:DispatcherDatabase,run:Run,field:string,value:unknown){
 const original=new InteractionStore(db).binding(run.sessionId)!,binding={...original,[field]:value};
 db.handle.prepare("UPDATE native_bindings SET binding_key=?,document_json=? WHERE session_id=?").run(JSON.stringify([binding.product,binding.region,binding.nativeStoreRef,binding.nativeSessionId,binding.nativeThreadId??""]),JSON.stringify(binding),run.sessionId);
 for(const kind of ["session","adapter-session"])editStored(db,run,[kind,"nativeBinding",binding]);
 if(field==="nativeSessionId")for(const [kind,path] of [["run","providerSessionId"],["session","nativeSessionId"],["adapter-session","providerSessionId"]])editStored(db,run,[kind!,path!,value]);
 if(field==="backendId")for(const [kind,path] of [["run","executionSelection.backendId"],["adapter-session","executionSelection.backendId"],["adapter-session","backendId"]])editStored(db,run,[kind!,path!,value]);
}
const corruptOpenCodeRecords=["missing-session","missing-adapter","missing-contract","missing-binding","missing-control","identity-diagnostic","current-run","duplicate-control","control-row-epoch","control-row-revision","control-row-state",
 ...["version","epoch","revision","state","exclusion","sessionId","activeRunId"].flatMap(field=>[`control-missing:${field}`,`control-invalid:${field}`]),
 ...["epoch","revision"].flatMap(field=>[`control-fraction:${field}`,`control-string:${field}`]),
 ...["profileId","runnerId","executionRefId","nativeStoreRef","nativeSessionId"].map(field=>`stored-binding:${field}`),
 ...["product","region","backendId","nativeThreadId","parentSessionId"].map(field=>`provider-binding:${field}`),
 "native-id-prefix","native-id-space","native-id-control","native-id-overlong",
];
it.each([
 ...corruptOpenCodeFields.map(edit=>({label:`${edit[0]}.${edit[1]}=${String(edit[2])}`,edit})),
 ...corruptOpenCodeRecords.map(label=>({label,edit:undefined})),
])("keeps corrupted OpenCode restart closed for $label without changing the original Run",async({label,edit})=>{
 const f=await fixture(),run=await f.create("corrupt-restart"),session=await f.start(run);await registry(f.service).get("p")!.result(session.id);await f.service.stop();f.holder.manualClose=true;
 const path=join(f.root,"data","dispatcher.sqlite"),db=new DispatcherDatabase(path);let closed=false;
 try{
  if(edit)editStored(db,run,edit);
  else if(label.startsWith("missing-")){
   const kind=label.slice(8);if(["binding","control"].includes(kind))db.handle.prepare(`DELETE FROM ${kind==="binding"?"native_bindings":"session_controls"} WHERE session_id=?`).run(run.sessionId);
   else {
    // Simulate damaged on-disk session storage despite the normal foreign-key safeguard.
    if(kind==="session")db.handle.exec("PRAGMA foreign_keys=OFF");
    db.handle.prepare("DELETE FROM entities WHERE kind=? AND id=?").run(kind==="adapter"?"adapter-session":kind==="contract"?"run-contract":kind,kind==="contract"?run.id:run.sessionId);
    if(kind==="session")db.handle.exec("PRAGMA foreign_keys=ON");
   }
  }else if(label==="identity-diagnostic")db.handle.prepare("INSERT INTO native_identity_diagnostics(id,session_id,code) VALUES(?,?,?)").run("corrupt",run.sessionId,"NATIVE_BINDING_CONFLICT");
  else if(label==="current-run"){const task=db.getCanonicalTask(run.taskId)!;db.writeCanonicalTask(run.taskId,task.revision,json({...task.document as object,currentRunId:"other"}));}
  else if(label==="duplicate-control"){const control=new InteractionStore(db).control(run.sessionId)!;db.saveEntity("session","other-session",{id:"other-session",providerId:"opencode",profileId:"p"});db.handle.prepare("INSERT INTO session_controls(session_id,active_run_id,epoch,revision,state,document_json) VALUES(?,?,?,?,?,?)").run("other-session",run.id,control.epoch,control.revision,control.state,JSON.stringify({...control,sessionId:"other-session"}));}
  else if(label.startsWith("control-row-")){const column=label.slice(12);db.handle.prepare(`UPDATE session_controls SET ${column}=? WHERE session_id=?`).run(column==="state"?"HUMAN":2,run.sessionId);}
  else if(label.startsWith("control-")){
   const [variant,field]=label.split(":"),control=new InteractionStore(db).control(run.sessionId)! as unknown as Record<string,unknown>;
   if(variant==="control-missing")delete control[field!];else control[field!]=variant==="control-fraction"?1.5:variant==="control-string"?"1":["epoch","revision"].includes(field!)?0:field==="version"?2:"other";
   db.handle.prepare("UPDATE session_controls SET document_json=? WHERE session_id=?").run(JSON.stringify(control),run.sessionId);
  }else if(label.startsWith("stored-binding:")){
   const field=label.split(":")[1]!,binding=new InteractionStore(db).binding(run.sessionId)!;db.handle.prepare("UPDATE native_bindings SET document_json=? WHERE session_id=?").run(JSON.stringify({...binding,[field]:field==="nativeSessionId"?"ses_other":"other"}),run.sessionId);
  }else if(label.startsWith("provider-binding:")){const field=label.split(":")[1]!;replaceBindingCopies(db,run,field,field==="product"?"codex":field==="backendId"?"codex-app-server":"other");}
  else replaceBindingCopies(db,run,"nativeSessionId",label==="native-id-prefix"?"native_other":label==="native-id-space"?"ses other":label==="native-id-control"?"ses_\u007f":"ses"+"x".repeat(510));
  const before=db.getEntity("run",run.id),writes=db.handle.prepare("SELECT total_changes() AS count").get();expect(isReadableManagedOpenCodeRun(db,before as unknown as Run)).toBe(false);expect(db.handle.prepare("SELECT total_changes() AS count").get()).toEqual(writes);db.close();closed=true;
  const requests=[...f.ports[0]!.requests];let restored:ControllerService|undefined;
  try{expect(()=>{restored=new ControllerService({dataDirectory:join(f.root,"data"),ownerToken:"fixture-owner",withRunner:true,opencodeExecutionFactory:f.factory});}).toThrow(expect.objectContaining({code:"NATIVE_CONTROL_RUNTIME_UNAVAILABLE"}));}finally{if(restored)await restored.stop();}
  const checked=new DispatcherDatabase(path);try{expect(checked.getEntity("run",run.id)).toEqual(before);}finally{checked.close();}expect(f.factory).toHaveBeenCalledOnce();expect(f.ports[0]!.requests).toEqual(requests);
 }finally{if(!closed)db.close();}
});
it.each(["bounded-session","opaque-store"] as const)("checks internally consistent %s storage without claiming external provenance",async variant=>{
 const f=await fixture(),run=await f.create("opaque-storage"),session=await f.start(run);await registry(f.service).get("p")!.result(session.id);await f.service.stop();f.holder.manualClose=true;
 const db=new DispatcherDatabase(join(f.root,"data","dispatcher.sqlite"));
 try{replaceBindingCopies(db,run,variant==="bounded-session"?"nativeSessionId":"nativeStoreRef",variant==="bounded-session"?"ses"+"x".repeat(509):"opaque-rewritten-store");const writes=db.handle.prepare("SELECT total_changes() AS count").get();expect(isReadableManagedOpenCodeRun(db,db.getEntity("run",run.id) as unknown as Run)).toBe(true);expect(db.handle.prepare("SELECT total_changes() AS count").get()).toEqual(writes);expect(f.factory).toHaveBeenCalledOnce();}finally{db.close();}
});
async function pendingRawWork(f:Awaited<ReturnType<typeof fixture>>,run:Run,phase:"access"|"callback"){
 const held=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>(),runtime=f.service["opencodeRuntimes"].get("p")!;
 if(phase==="access")vi.spyOn(fsPromises,"access").mockImplementation(async(path,mode)=>{if(path===f.executable){entered.resolve();await held.promise;}return actualAccess(path,mode);});
 else {const start=runtime.start.bind(runtime);vi.spyOn(runtime,"start").mockImplementation(input=>start({...input,beforePrompt:()=>{input.beforePrompt!();entered.resolve();return held.promise;}}));}
 const outcome=f.start(run).catch(error=>error);await entered.promise;
 return {held,runtime,outcome};
}
it.each(["access","callback"] as const)("blocks replacement on exact raw %s work after terminal Run and durable cleanup",async phase=>{
 const f=await fixture(),run=await f.create("raw-profile"),pending=await pendingRawWork(f,run,phase),adapter=registry(f.service).get("p")! as OpenCodeAdapter;
 try{
  await f.service.disconnectNativeRuntime("p");expect(await pending.outcome).toMatchObject({creationOutcome:phase==="access"?"not-created":"unknown"});await endFixtureRun(f,run,true);
  expect(pending.runtime.hasUnclosedHosts()).toBe(false);expect(adapter.hasActiveOperations()).toBe(false);expect(pending.runtime.hasActiveOperations()).toBe(true);
  expect(f.service.database.listEntities("native-runtime-local-disconnect")).toHaveLength(1);
  const before=f.service.configuration.current();expect(replaceProfile(f)).toThrow(expect.objectContaining({code:"ACTIVE_AGENT_PROFILE"}));expect(f.service.configuration.current()).toEqual(before);expect(f.service["opencodeRuntimes"].get("p")).toBe(pending.runtime);
 }finally{pending.held.resolve();await pending.outcome;await vi.waitFor(()=>expect(pending.runtime.hasActiveOperations()).toBe(false));}
});
it.each(["access","callback"] as const)("retains SQLite for raw %s work despite closed or empty host receipts",async phase=>{
 const f=await fixture(),run=await f.create("raw-stop"),pending=await pendingRawWork(f,run,phase),close=vi.spyOn(f.service.database,"close");f.holder.manualClose=true;
 try{
  const stopped=await f.service.stop().catch(error=>error);await pending.outcome;
  expect(pending.runtime.hasUnclosedHosts()).toBe(false);expect(pending.runtime.hasActiveOperations()).toBe(true);expect(stopped).toMatchObject({code:"NATIVE_RUNTIME_CLEANUP_UNKNOWN"});
  expect(f.service.database.getEntity("run",run.id)).toMatchObject({state:"ACTIVE"});expect(f.service.database.listEntities("native-runtime-local-disconnect")).toHaveLength(1);expect(f.service["opencodeRuntimes"].get("p")).toBe(pending.runtime);
 }finally{pending.held.resolve();await pending.outcome;await vi.waitFor(()=>expect(pending.runtime.hasActiveOperations()).toBe(false));if(close.mock.calls.length===0)f.service.database.close();}
});
function unrelatedRuntime(backendId:"pi-rpc"|"codex-app-server"){
 return {backendId,beginShutdown:vi.fn(),isClosed:()=>true,hasUnclosedHosts:()=>false,...(backendId==="codex-app-server"?{hasActiveOperations:()=>false}:{}),disconnectLocal:vi.fn(async()=>[{version:1 as const,connection:"closed" as const,ownedRoot:"not-created" as const,callbacks:"drained" as const,backgroundTools:"unknown" as const,nativeSessionDeleted:false as const}])};
}
it("aggregates raw cleanup uncertainty with another registry failure",async()=>{
 const f=await fixture(),run=await f.create("raw-and-fault"),pending=await pendingRawWork(f,run,"access"),pi=unrelatedRuntime("pi-rpc"),failure=Error("Pi disconnect failed");
 pi.disconnectLocal.mockRejectedValue(failure);f.service["piRuntimes"].set("pi",pi as unknown as PiExecutionRuntime);f.holder.manualClose=true;
 try{const stopped=await f.service.stop().catch(error=>error);expect(stopped).toBeInstanceOf(AggregateError);expect((stopped as AggregateError).errors).toEqual([failure,expect.objectContaining({code:"NATIVE_RUNTIME_CLEANUP_UNKNOWN"})]);expect(f.service.database.getEntity("run",run.id)).toBeDefined();}
 finally{pending.held.resolve();await pending.outcome;await vi.waitFor(()=>expect(pending.runtime.hasActiveOperations()).toBe(false));f.service.database.close();}
});
it.each(["pi-disconnect","codex-disconnect","opencode-disconnect","pi-receipt","codex-receipt","opencode-receipt","multiple","review-and-runtime"] as const)("drains three registries and retains every shutdown fault: %s",async failure=>{
 const f=await fixture(),run=await f.create("three-registries"),session=await f.start(run);await registry(f.service).get("p")!.result(session.id);
 const pi=unrelatedRuntime("pi-rpc"),codex=unrelatedRuntime("codex-app-server"),opencode=f.service["opencodeRuntimes"].get("p")!;
 f.service["piRuntimes"].set("pi",pi as unknown as PiExecutionRuntime);f.service["codexRuntimes"].set("codex",codex as unknown as CodexExecutionRuntime);
 const originalDisconnect=opencode.disconnectLocal.bind(opencode),begin=vi.spyOn(opencode,"beginShutdown"),disconnect=vi.spyOn(opencode,"disconnectLocal"),save=f.service.database.saveEntity.bind(f.service.database),errors:Error[]=[];
 const faultFor=(provider:string,kind:string)=>failure===`${provider}-${kind}`||failure==="multiple"&&(provider==="pi"&&kind==="disconnect"||provider==="opencode"&&kind==="receipt")||failure==="review-and-runtime"&&provider==="pi"&&kind==="disconnect";
 for(const [provider,runtime] of [["pi",pi],["codex",codex]] as const)if(faultFor(provider,"disconnect")){const error=Error(`${provider} disconnect failed`);errors.push(error);runtime.disconnectLocal.mockRejectedValue(error);}
 if(faultFor("opencode","disconnect")){const error=Error("opencode disconnect failed");errors.push(error);disconnect.mockImplementation(async()=>{await originalDisconnect();throw error;});}
 const fault=vi.spyOn(f.service.database,"saveEntity").mockImplementation((...args)=>{const provider=args[1]==="p"?"opencode":args[1];if(args[0]==="native-runtime-disconnect"&&faultFor(provider,"receipt")){const error=Error(`${provider} receipt failed`);errors.push(error);throw error;}return save(...args);});
 if(failure==="review-and-runtime"){const error=Error("review shutdown failed");errors.push(error);vi.spyOn(f.service["localResults"],"close").mockRejectedValue(error);}
 const http=vi.spyOn(f.service.app,"close"),events=vi.spyOn(f.service.events,"close");f.holder.manualClose=true;
 try{
  const stopped=await f.service.stop().catch(error=>error);if(errors.length===1)expect(stopped).toBe(errors[0]);else {expect(stopped).toBeInstanceOf(AggregateError);expect((stopped as AggregateError).errors).toEqual(expect.arrayContaining(errors));expect((stopped as AggregateError).errors).toHaveLength(errors.length);}
  expect(pi.beginShutdown).toHaveBeenCalledOnce();expect(codex.beginShutdown).toHaveBeenCalledOnce();expect(begin).toHaveBeenCalledTimes(2);expect(begin.mock.invocationCallOrder[0]!).toBeLessThan(disconnect.mock.invocationCallOrder[0]!);
  expect(pi.disconnectLocal).toHaveBeenCalledOnce();expect(codex.disconnectLocal).toHaveBeenCalledOnce();expect(disconnect).toHaveBeenCalledOnce();expect(f.ports[0]!.disconnect).toHaveBeenCalledOnce();expect(http).toHaveBeenCalledOnce();expect(events).toHaveBeenCalledOnce();expect(f.service.database.getEntity("run",run.id)).toMatchObject({state:"ACTIVE"});
  for(const [provider,id,backendId] of [["pi","pi","pi-rpc"],["codex","codex","codex-app-server"],["opencode","p","opencode-server-v2"]])if(!faultFor(provider!,"disconnect")&&!faultFor(provider!,"receipt"))expect(f.service.database.getEntity("native-runtime-disconnect",id!)).toMatchObject({backendId,receipts:[{backgroundTools:"unknown",nativeSessionDeleted:false}]});
  expect(f.factory).toHaveBeenCalledOnce();expect(f.ports[0]!.requests.some(value=>value.startsWith("DELETE "))).toBe(false);
 }finally{fault.mockRestore();f.service.database.close();}
});
// S6: physical drain is independent of the canonical Run lifecycle.
it("requires explicit local drain before replacing a genuinely idle server profile",async()=>{
 const f=await fixture(),run=await f.create("idle"),session=await f.start(run),runtime=f.service["opencodeRuntimes"].get("p")!,adapter=registry(f.service).get("p");await endFixtureRun(f,run);
 const before=f.service.configuration.current();expect(replaceProfile(f)).toThrow(expect.objectContaining({code:"NATIVE_RUNTIME_DRAIN_REQUIRED"}));expect(f.service.configuration.current()).toEqual(before);expect(f.ports[0]!.disconnect).not.toHaveBeenCalled();
 await f.service.disconnectNativeRuntime("p");expect(new InteractionStore(f.service.database).observation(session.id)).toMatchObject({state:"unknown",pendingTools:"unknown",pendingApprovals:"unknown"});expect(f.service.database.listEntities("native-runtime-local-disconnect")).toHaveLength(1);
 replaceProfile(f)();expect(f.service["opencodeRuntimes"].get("p")).not.toBe(runtime);expect(registry(f.service).get("p")).not.toBe(adapter);expect(runtime.isClosed()).toBe(true);expect(f.ports[0]!.disconnect).toHaveBeenCalledOnce();expect(f.factory).toHaveBeenCalledOnce();
});
it("keeps an ACTIVE canonical Run unchanged after physical drain and durable cleanup",async()=>{
 const f=await fixture(),run=await f.create("active"),session=await f.start(run);await registry(f.service).get("p")!.result(session.id);const task=f.service.database.getCanonicalTask(run.taskId),before=f.service.database.getEntity("run",run.id),runtime=f.service["opencodeRuntimes"].get("p");
 await f.service.disconnectNativeRuntime("p");expect(f.service.database.listEntities("native-runtime-local-disconnect")).toHaveLength(1);expect(replaceProfile(f)).toThrow(expect.objectContaining({code:"ACTIVE_AGENT_PROFILE"}));expect(f.service.database.getEntity("run",run.id)).toEqual(before);expect(f.service.database.getCanonicalTask(run.taskId)).toEqual(task);expect(f.service["opencodeRuntimes"].get("p")).toBe(runtime);
});
// S8: receipt and observation invalidation are one transaction; retry is durable-only.
it.each(["native-runtime-local-disconnect","native-read-barrier"])("rolls back %s failure and retries the cached cleanup without disconnecting again",async kind=>{
 const f=await fixture(),run=await f.create("receipt-fault"),session=await f.start(run);await endFixtureRun(f,run);const store=new InteractionStore(f.service.database),runtime=f.service["opencodeRuntimes"].get("p")!,save=f.service.database.saveEntity.bind(f.service.database);
 store.saveObservation({sessionId:session.id,observerGeneration:1,observerSequence:1,controlEpoch:1,observation:await f.ports[0]!.port.inspect(session.nativeBinding!)});const observation=store.observation(session.id),barriers=f.service.database.listEntities("native-read-barrier");
 const fault=vi.spyOn(f.service.database,"saveEntity").mockImplementation((...args)=>{if(args[0]===kind)throw Error("fixture durable write failed");return save(...args);});
 try{await expect(f.service.disconnectNativeRuntime("p")).rejects.toThrow("fixture durable write failed");}finally{fault.mockRestore();}
 expect(f.service.database.listEntities("native-runtime-local-disconnect")).toEqual([]);expect(f.service.database.listEntities("native-read-barrier")).toEqual(barriers);expect(store.observation(session.id)).toEqual(observation);expect(f.service["nativePort"](session.nativeBinding!)===undefined).toBe(true);expect(f.service["opencodeRuntimes"].get("p")).toBe(runtime);expect(replaceProfile(f)).toThrow(expect.objectContaining({code:"NATIVE_RUNTIME_DRAIN_REQUIRED"}));
 await f.service.disconnectNativeRuntime("p");await f.service.disconnectNativeRuntime("p");expect(f.ports[0]!.disconnect).toHaveBeenCalledOnce();expect(f.service.database.listEntities("native-runtime-local-disconnect")).toHaveLength(1);expect(f.service.database.listEntities("native-read-barrier")).toHaveLength(1);expect(store.observation(session.id)?.state).toBe("unknown");replaceProfile(f)();
});
it.each(["connection","ownedRoot","callbacks"] as const)("retains cached cleanup with unknown %s without claiming native release",async field=>{
 const f=await fixture({cleanup:{[field]:"unknown"}}),run=await f.create("unknown-cleanup"),session=await f.start(run);await endFixtureRun(f,run);const runtime=f.service["opencodeRuntimes"].get("p")!;f.holder.manualClose=true;
 try{const receipts=await f.service.disconnectNativeRuntime("p");expect(receipts).toEqual([expect.objectContaining({[field]:"unknown",backgroundTools:"unknown",nativeSessionDeleted:false})]);receipts[0]!.callbacks="drained";expect(await f.service.disconnectNativeRuntime("p")).toEqual([expect.objectContaining({[field]:"unknown"})]);expect(replaceProfile(f)).toThrow(expect.objectContaining({code:"NATIVE_RUNTIME_DRAIN_REQUIRED"}));expect(f.service["nativePort"](session.nativeBinding!)===undefined).toBe(true);await expect(f.service.stop()).rejects.toMatchObject({code:"NATIVE_RUNTIME_CLEANUP_UNKNOWN"});expect(f.service.database.getEntity("session",session.id)).toBeDefined();expect(f.service["opencodeRuntimes"].get("p")).toBe(runtime);expect(f.ports[0]!.disconnect).toHaveBeenCalledOnce();expect(f.ports[0]!.requests.some(value=>value.startsWith("DELETE "))).toBe(false);expect(f.factory).toHaveBeenCalledOnce();}
 finally{f.service.database.close();}
});
// S7: clean close preserves original session/binding and durable cleanup, verified read-only.
it("retains original native metadata and unknown observation in SQLite after clean close",async()=>{
 const f=await fixture(),run=await f.create("clean-close"),session=await f.start(run);await registry(f.service).get("p")!.result(session.id);const close=vi.spyOn(f.service.database,"close").mockImplementation(()=>{expect(f.service.database.listEntities("native-runtime-local-disconnect")).toHaveLength(1);expect(new InteractionStore(f.service.database).observation(session.id)?.state).toBe("unknown");close.mockRestore();f.service.database.close();});
 await f.service.stop();f.holder.manualClose=true;const db=new DatabaseSync(join(f.root,"data","dispatcher.sqlite"),{readOnly:true});
 try{const entity=(kind:string,id:string)=>JSON.parse((db.prepare("SELECT document_json FROM entities WHERE kind=? AND id=?").get(kind,id) as {document_json:string}).document_json);expect(entity("session",session.id)).toMatchObject({id:session.id,nativeBinding:session.nativeBinding});expect(entity("run",run.id)).toMatchObject({state:"ACTIVE"});expect(entity("native-read-barrier",session.id)).toMatchObject({observation:{state:"unknown",pendingTools:"unknown",pendingApprovals:"unknown"}});expect(JSON.parse((db.prepare("SELECT document_json FROM native_bindings WHERE session_id=?").get(session.id) as {document_json:string}).document_json)).toEqual(session.nativeBinding);expect((db.prepare("SELECT COUNT(*) AS count FROM entities WHERE kind='native-runtime-local-disconnect'").get() as {count:number}).count).toBe(1);expect(f.ports[0]!.disconnect).toHaveBeenCalledOnce();expect(f.ports[0]!.requests.some(value=>value.startsWith("DELETE "))).toBe(false);expect(f.ports[0]!.posts.filter(path=>path==="/api/session")).toHaveLength(1);expect(f.factory).toHaveBeenCalledOnce();}finally{db.close();}
});
it("keeps local disconnect behind authentication and explicit confirmation",async()=>{
 const f=await fixture(),run=await f.create("disconnect-route");await f.start(run);const url="/api/agents/profiles/p/runtime/disconnect",headers={authorization:"Bearer fixture-owner"};
 expect((await f.service.app.inject({method:"POST",url,payload:{confirmed:true}})).statusCode).toBe(401);expect((await f.service.app.inject({method:"POST",url,headers,payload:{}})).statusCode).toBe(400);expect(f.ports[0]!.disconnect).not.toHaveBeenCalled();const result=await f.service.app.inject({method:"POST",url,headers,payload:{confirmed:true}});expect(result.statusCode,result.body).toBe(200);expect(result.json()).toMatchObject({receipts:[{backgroundTools:"unknown",nativeSessionDeleted:false}]});expect(f.ports[0]!.disconnect).toHaveBeenCalledOnce();
});
it("cleans known-unsent rejected acquisition without fabricating a process or host barrier",async()=>{
 const f=await fixture({acquire:async()=>{throw Error("fixture host acquisition rejected");}}),run=await f.create("acquisition-rejected"),runtime=f.service["opencodeRuntimes"].get("p")!;
 await expect(f.start(run)).rejects.toMatchObject({creationOutcome:"not-created"});await endFixtureRun(f,run,true);expect(f.ports[0]!.disconnect).not.toHaveBeenCalled();expect(f.ports[0]!.posts).toEqual([]);expect(f.factory).toHaveBeenCalledOnce();const receipt=await f.service.disconnectNativeRuntime("p");expect(receipt).toEqual([expect.objectContaining({connection:"closed",ownedRoot:"not-created",callbacks:"drained",backgroundTools:"unknown",nativeSessionDeleted:false})]);expect(runtime.hasUnclosedHosts()).toBe(false);expect(runtime.hasActiveOperations()).toBe(false);replaceProfile(f)();
});
it("never-started cleanup opens no host and leaves no unjustified barrier",async()=>{
 const f=await fixture(),runtime=f.service["opencodeRuntimes"].get("p")!;expect(await f.service.disconnectNativeRuntime("p")).toEqual([]);expect(runtime.hasUnclosedHosts()).toBe(false);expect(runtime.hasActiveOperations()).toBe(false);replaceProfile(f)();expect(f.factory).not.toHaveBeenCalled();
});
it("retains late acquisition work and its cached unknown receipt after public start is released",async()=>{
 const entered=Promise.withResolvers<void>(),held=Promise.withResolvers<FixtureHost>();let host!:FixtureHost;
 const f=await fixture({acquire:value=>{host=value;entered.resolve();return held.promise;}}),run=await f.create("late-acquisition"),runtime=f.service["opencodeRuntimes"].get("p")!,outcome=f.start(run).catch(error=>error);await entered.promise;f.holder.manualClose=true;vi.useFakeTimers();
 try{const stopping=f.service.stop().catch(error=>error);await vi.advanceTimersByTimeAsync(5_001);expect(await stopping).toMatchObject({code:"NATIVE_RUNTIME_CLEANUP_UNKNOWN"});expect(await outcome).toMatchObject({creationOutcome:"unknown"});expect(runtime.hasActiveOperations()).toBe(true);const original=await f.service.disconnectNativeRuntime("p");expect(original).toEqual([expect.objectContaining({connection:"unknown",ownedRoot:"unknown",callbacks:"unknown",backgroundTools:"unknown",nativeSessionDeleted:false})]);expect(f.service.database.getEntity("run",run.id)).toMatchObject({state:"ACTIVE"});expect(replaceProfile(f)).toThrow(expect.objectContaining({code:"NATIVE_RUNTIME_DRAIN_REQUIRED"}));held.resolve(host);vi.useRealTimers();await vi.waitFor(()=>expect(runtime.hasActiveOperations()).toBe(false));expect(await f.service.disconnectNativeRuntime("p")).toEqual(original);expect(runtime.hasUnclosedHosts()).toBe(true);expect(f.ports[0]!.disconnect).toHaveBeenCalledOnce();expect(f.ports[0]!.posts).toEqual([]);expect(f.service["opencodeRuntimes"].get("p")).toBe(runtime);}
 finally{held.resolve(host);vi.useRealTimers();await outcome;await vi.waitFor(()=>expect(runtime.hasActiveOperations()).toBe(false));f.service.database.close();}
});
it.each(["binding","waiting"] as const)("retains admitted %s callback storage through shutdown without late source reacquisition",async phase=>{
 const f=await fixture(),run=await f.create("callback-stop"),runtime=f.service["opencodeRuntimes"].get("p")!,start=runtime.start.bind(runtime),held=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>();
 vi.spyOn(runtime,"start").mockImplementation(input=>start({...input,...(phase==="binding"?{onBinding:async binding=>{await input.onBinding!(binding);entered.resolve();await held.promise;}}:{onNativeEvent:async fact=>{await input.onNativeEvent!(fact);if(fact.state==="waiting"){entered.resolve();await held.promise;}}})}));const outcome=f.start(run).catch(error=>error);await entered.promise;const binding=new InteractionStore(f.service.database).binding(run.sessionId)!;expect(binding).toBeDefined();f.holder.manualClose=true;vi.useFakeTimers();
 try{const stopping=f.service.stop().catch(error=>error);await vi.advanceTimersByTimeAsync(5_001);expect(await stopping).toMatchObject({code:"NATIVE_RUNTIME_CLEANUP_UNKNOWN"});expect(await outcome).toMatchObject({creationOutcome:"unknown"});expect(runtime.hasActiveOperations()).toBe(true);const original=await f.service.disconnectNativeRuntime("p");expect(original).toEqual([expect.objectContaining({callbacks:"unknown",backgroundTools:"unknown",nativeSessionDeleted:false})]);expect(replaceProfile(f)).toThrow(expect.objectContaining({code:"NATIVE_RUNTIME_DRAIN_REQUIRED"}));expect(f.service.database.getEntity("run",run.id)).toMatchObject({state:"ACTIVE"});held.resolve();vi.useRealTimers();await vi.waitFor(()=>expect(runtime.hasActiveOperations()).toBe(false));expect(await f.service.disconnectNativeRuntime("p")).toEqual(original);expect(f.service["nativePort"](binding)===undefined).toBe(true);expect(new InteractionStore(f.service.database).binding(run.sessionId)).toEqual(binding);expect(f.ports[0]!.posts).toEqual(["/api/session"]);expect(f.ports[0]!.disconnect).toHaveBeenCalledOnce();expect(f.ports[0]!.requests.some(value=>value.startsWith("DELETE "))).toBe(false);expect(f.factory).toHaveBeenCalledOnce();}
 finally{held.resolve();vi.useRealTimers();await outcome;await vi.waitFor(()=>expect(runtime.hasActiveOperations()).toBe(false));f.service.database.close();}
});
it("keeps observer persistence failure bound to the original start invocation without replay",async()=>{
 const f=await fixture(),p=await publication(f),save=f.service.database.saveEntity.bind(f.service.database),fault=vi.spyOn(f.service.database,"saveEntity").mockImplementation((...args)=>{if(args[0]==="native-binding-event")throw Error("fixture observer storage failed");return save(...args);});let response;
 try{response=await f.service.app.inject(p.request);}finally{fault.mockRestore();}
 expect(response.statusCode,response.body).toBe(200);expect(response.json()).toMatchObject({state:"OUTCOME_UNKNOWN"});const run=publishedRun(f,response.json()),store=new InteractionStore(f.service.database),command=store.command(`native-start:${run.id}`),invocation=f.service.database.getEntity("adapter-session",run.sessionId);expect(run).toMatchObject({state:"RUNNER_UNAVAILABLE",recoveryReason:"NATIVE_OUTCOME_UNKNOWN"});expect(command?.state).toBe("UNKNOWN");expect(invocation).toMatchObject({nativeIdentityIssue:"NATIVE_EVENT_PERSISTENCE_FAILED"});
 const retry=await f.service.app.inject(p.request);expect(retry.json().runId).toBe(run.id);expect(store.command(`native-start:${run.id}`)).toEqual(command);expect(f.service.database.getEntity("adapter-session",run.sessionId)).toEqual(invocation);expect(f.ports[0]!.posts).toEqual(["/api/session"]);expect(f.factory).toHaveBeenCalledOnce();
});
it("keeps the canonical start command and invocation unknown when shutdown interrupts observer settlement",async()=>{
 const f=await fixture(),p=await publication(f),runtime=f.service["opencodeRuntimes"].get("p")!,start=runtime.start.bind(runtime),held=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>();
 vi.spyOn(runtime,"start").mockImplementation(input=>start({...input,onNativeEvent:async fact=>{await input.onNativeEvent!(fact);if(fact.state==="waiting"){entered.resolve();await held.promise;}}}));const dispatch=f.service.app.inject(p.request).then(response=>response);await entered.promise;
 const run=f.service.database.listEntities("run")[0] as unknown as Run,invocation=f.service.database.getEntity("adapter-session",run.sessionId) as {nativeInvocationId:string},binding=new InteractionStore(f.service.database).binding(run.sessionId)!;expect(invocation.nativeInvocationId).toBeTruthy();f.holder.manualClose=true;vi.useFakeTimers();
 try{const stopping=f.service.stop().catch(error=>error);await vi.advanceTimersByTimeAsync(5_001);expect(await stopping).toMatchObject({code:"NATIVE_RUNTIME_CLEANUP_UNKNOWN"});const response=await dispatch;expect(response.statusCode,response.body).toBe(200);expect(response.json()).toMatchObject({state:"OUTCOME_UNKNOWN",runId:run.id});const command=new InteractionStore(f.service.database).command(`native-start:${run.id}`);expect(command?.state).toBe("UNKNOWN");expect(f.service.database.getEntity("run",run.id)).toMatchObject({state:"RUNNER_UNAVAILABLE",recoveryReason:"NATIVE_OUTCOME_UNKNOWN"});held.resolve();vi.useRealTimers();await vi.waitFor(()=>expect(runtime.hasActiveOperations()).toBe(false));expect(new InteractionStore(f.service.database).command(`native-start:${run.id}`)).toEqual(command);expect(f.service.database.getEntity("adapter-session",run.sessionId)).toMatchObject({nativeInvocationId:invocation.nativeInvocationId});expect(f.service["nativePort"](binding)===undefined).toBe(true);expect(f.ports[0]!.posts).toEqual(["/api/session"]);expect(f.factory).toHaveBeenCalledOnce();}
 finally{held.resolve();vi.useRealTimers();await dispatch;await vi.waitFor(()=>expect(runtime.hasActiveOperations()).toBe(false));f.service.database.close();}
});
it.each(["missing","directory","non-executable"] as const)("rejects enabled physical executable %s through runtime construction and rolls back apply",async executable=>{await fixture({executable});});
it("keeps disabled structural registration free from runtime/factory/file work",async()=>{const f=await fixture({enabled:false,executable:"missing"});expect(registry(f.service).has("p")).toBe(false);expect(f.service["opencodeRuntimes"].size).toBe(0);expect(f.factory).not.toHaveBeenCalled();});

function corrupt(service:ControllerService,kind:string,id:string,path:string,value:unknown){service.database.handle.prepare("UPDATE entities SET document_json=json_set(document_json,?,json(?)) WHERE kind=? AND id=?").run("$."+path,JSON.stringify(value),kind,id);}
// The Adapter reserves a real session/invocation first. Mutate at the real runtime admission seam.
const precreateDrifts=["workspace-missing","workspace-replaced","currentRun","canonical","profile","provider","runner","native-run","native-session","adapter-session","adapter-run","adapter-profile","adapter-backend","adapter-selection","adapter-reference","invocation","generation","attempt","lease","selection","reference","repository","branch","base","terminal","shutdown","runtime-replaced","adapter-replaced","executable-replaced"] as const;
function change(f:Awaited<ReturnType<typeof fixture>>,run:Run,input:CliStartInput,drift:typeof precreateDrifts[number]){
 const s=f.service;
 if(drift==="workspace-missing")input.workspacePath=join(f.root,"missing-workspace");
 else if(drift==="workspace-replaced"){renameSync(run.worktree!,run.worktree+".old");mkdirSync(run.worktree!);}
 else if(drift==="currentRun"){const task=s.database.getCanonicalTask(run.taskId)!;s.database.writeCanonicalTask(run.taskId,task.revision,json({...task.document as object,currentRunId:"other"}));}
 else if(drift==="canonical")corrupt(s,"run",run.id,"id","other");
 else if(drift==="profile")corrupt(s,"run",run.id,"profileId","other");
 else if(drift==="native-run")input.nativeInput!.runId="other";
 else if(drift==="native-session")input.nativeInput!.sessionId="other";
 else if(drift==="adapter-session")corrupt(s,"adapter-session",run.sessionId,"id","other");
 else if(drift==="adapter-run")corrupt(s,"adapter-session",run.sessionId,"runId","other");
 else if(drift==="adapter-profile")corrupt(s,"adapter-session",run.sessionId,"profileId","other");
 else if(drift==="adapter-backend")corrupt(s,"adapter-session",run.sessionId,"backendId","opencode-cli-json");
 else if(drift==="adapter-selection")corrupt(s,"adapter-session",run.sessionId,"executionSelection.selectedAt","2030-01-01T00:00:00Z");
 else if(drift==="adapter-reference")corrupt(s,"adapter-session",run.sessionId,"executionRef.pathRef","other");
 else if(drift==="invocation")input.nativeInput!.commandId="stale-invocation";
 else if(drift==="generation"||drift==="attempt"||drift==="lease")corrupt(s,"run",run.id,drift==="lease"?"leaseId":drift,drift==="lease"?"other":2);
 else if(drift==="selection")corrupt(s,"run",run.id,"executionSelection.selectedAt","2030-01-01T00:00:00Z");
 else if(drift==="reference")corrupt(s,"run",run.id,"executionRef.pathRef","other");
 else if(drift==="repository"||drift==="branch"||drift==="base"){const key=drift==="repository"?"repositoryId":drift==="base"?"baseRevision":"branch";corrupt(s,"run",run.id,"executionRef."+key,"other");input.executionRef={...input.executionRef!,[key]:"other"};corrupt(s,"adapter-session",run.sessionId,"executionRef."+key,"other");}
 else if(drift==="provider"||drift==="runner")corrupt(s,"run",run.id,drift+"Id","other");
 else if(drift==="terminal")corrupt(s,"run",run.id,"state","FAILED");
 else if(drift==="shutdown")s["opencodeRuntimes"].get("p")!.beginShutdown();
 else if(drift==="runtime-replaced")s["opencodeRuntimes"].delete("p");
 else if(drift==="adapter-replaced")registry(s).set("p",{} as AgentAdapter);
 else if(drift==="executable-replaced"){renameSync(f.executable,f.executable+".old");writeFileSync(f.executable,"replacement");chmodSync(f.executable,0o700);}
}
it.each(precreateDrifts)("rejects %s before producer factory/create/prompt",async drift=>{
 const f=await fixture(),run=await f.create("drift"),runtime=f.service["opencodeRuntimes"].get("p")!,start=runtime.start.bind(runtime);
 vi.spyOn(runtime,"start").mockImplementation(input=>{if(drift==="workspace-replaced"){const turn=start(input);change(f,run,input,drift);return turn;}change(f,run,input,drift);return start(input);});await expect(f.start(run)).rejects.toMatchObject({creationOutcome:"not-created"});expect(f.factory).not.toHaveBeenCalled();
 // Replacement simulation must retain the original runtime for orderly fixture cleanup.
 f.service["opencodeRuntimes"].set("p",runtime);
});
it.each(["binding","observer"] as const)("rechecks currentRun after awaited %s durability and never prompts",async stage=>{
 const f=await fixture(),run=await f.create("late"),runtime=f.service["opencodeRuntimes"].get("p")!,start=runtime.start.bind(runtime),entered=Promise.withResolvers<void>(),held=Promise.withResolvers<void>();
 vi.spyOn(runtime,"start").mockImplementation(input=>start({...input,...(stage==="binding"?{onBinding:async binding=>{await input.onBinding!(binding);entered.resolve();await held.promise;}}:{onNativeEvent:async fact=>{await input.onNativeEvent!(fact);if(fact.state==="waiting"){entered.resolve();await held.promise;}}})}));
 const result=f.start(run).catch(error=>error);await entered.promise;const task=f.service.database.getCanonicalTask(run.taskId)!;f.service.database.writeCanonicalTask(run.taskId,task.revision,json({...task.document as object,currentRunId:"other"}));held.resolve();expect(await result).toMatchObject({creationOutcome:"unknown"});expect(f.ports[0]!.posts).toEqual(["/api/session"]);
});
it.each(["adapter","runtime","runtime-missing-aggregate","binding","closed","source","foreign"] as const)("withdraws exact source on %s without borrowing another session or creating a host",async drift=>{
 const f=await fixture(),a=await f.create("a"),b=await f.create("b"),sa=await f.start(a),sb=await f.start(b),binding=sa.nativeBinding!,runtime=f.service["opencodeRuntimes"].get("p")!;
 await registry(f.service).get("p")!.result(sa.id);await registry(f.service).get("p")!.result(sb.id);expect(f.service["nativePort"](binding)).toBe(f.ports[0]!.port);
 if(drift==="adapter")registry(f.service).set("p",{interaction:f.ports[1]!.port} as AgentAdapter);
 if(drift==="runtime")f.service["opencodeRuntimes"].set("p",new OpenCodeExecutionRuntime({profile:{id:"p",alias:"P",executable:f.executable},runnerId:"local",assertInput:()=>{},bindingFor:()=>undefined,factory:f.factory}));
 if(drift==="runtime-missing-aggregate"){f.service["opencodeRuntimes"].delete("p");Object.defineProperty(registry(f.service).get("p")!,"interaction",{value:f.ports[1]!.port});}
 if(drift==="binding")corrupt(f.service,"adapter-session",sa.id,"nativeBinding.nativeSessionId","ses_replaced");
 if(drift==="closed")runtime.beginShutdown();if(drift==="source")f.ports[0]!.backend.beginShutdown();if(drift==="foreign")binding.executionRefId=b.executionRef!.id;
 expect(f.service["nativePort"](binding)===undefined).toBe(true);expect(f.factory).toHaveBeenCalledTimes(2);f.service["opencodeRuntimes"].set("p",runtime);
});
it("preserves the same Adapter/runtime across unrelated config and Runner capacity/labels",async()=>{
 const f=await fixture(),adapter=registry(f.service).get("p"),runtime=f.service["opencodeRuntimes"].get("p"),config=structuredClone(f.service.configuration.current().config);config.runners[0]!.capacity=8;config.runners[0]!.tags=["updated"];
 f.service.configuration.applyPlan(f.service.configuration.buildPlan(config,"owner","unrelated").id,{confirmed:true});expect(registry(f.service).get("p")).toBe(adapter);expect(f.service["opencodeRuntimes"].get("p")).toBe(runtime);expect(f.factory).not.toHaveBeenCalled();
});

async function publication(f:Awaited<ReturnType<typeof fixture>>,verificationArgs=["-e","process.exit(0)"]){
 const headers={authorization:"Bearer fixture-owner"},config=structuredClone(f.service.configuration.current().config);config.repositories[0]!.scopePaths=["."];config.repositories[0]!.verificationCommands=[{id:"verify",file:process.execPath,args:verificationArgs,required:true,timeoutMs:5000,outputLimitBytes:1024}];f.service.configuration.applyPlan(f.service.configuration.buildPlan(config,"owner","publication fixture").id,{confirmed:true});
 registry(f.service).get("p")!.modelCatalog=async context=>normalizeOpenCodeCatalog([{providerID:"provider",id:"model",name:"Test",enabled:true,capabilities:{input:["text"],output:["text"]}}],context,"fixture-catalog-context","opencode-server-v2");
 const catalog=(await f.service.app.inject({url:"/api/agents/profiles/p/models?repositoryId=repo",headers})).json();
 const execution={catalogRevision:catalog.revision,contextFingerprint:catalog.contextFingerprint,selectionMode:"manual",selectionType:"explicit-model",profileId:"p",nativeModelId:"provider/model",nativeParameters:{},allowUnconfirmedModelAccess:true};
 const preview=await f.service.app.inject({method:"POST",url:"/api/task-publications/preview",headers,payload:{schemaVersion:1,clientDraftId:"startup-publication",title:"Startup approval",description:"Write a local result",projectId:"local:repo",repositoryId:"repo",acceptanceCriteria:["Result exists"],scopePaths:["."],verificationCommandIds:["verify"],startMode:"create-only",execution,delivery:{type:"none"}}});expect(preview.statusCode,preview.body).toBe(200);
 const p=preview.json(),created=await f.service.app.inject({method:"POST",url:`/api/task-publications/${p.publicationId}/commit`,headers:{...headers,"idempotency-key":"startup-create"},payload:{revision:p.revision,reviewHash:p.confirmation.reviewHash,confirmation:{accepted:true}}});expect(created.statusCode,created.body).toBe(200);
 const task=f.service.database.getCanonicalTask(created.json().taskId)!;expect(task.document).toMatchObject({state:"READY"});
 const review=await f.service.app.inject({method:"POST",url:`/api/tasks/${created.json().taskId}/publications/preview`,headers,payload:{expectedRevision:task.revision,execution}});expect(review.statusCode,review.body).toBe(200);const r=review.json();expect(r.canCommit,review.body).toBe(true);
 return {headers,task,request:{method:"POST" as const,url:`/api/task-publications/${r.publicationId}/commit`,headers:{...headers,"idempotency-key":"startup-dispatch"},payload:{revision:r.revision,reviewHash:r.confirmation.reviewHash,confirmation:{accepted:true}}}};
}
function publishedRun(f:Awaited<ReturnType<typeof fixture>>,body:{runId:string}):Run{return f.service.database.getEntity("run",body.runId) as unknown as Run;}
it("publishes the actual server backend selection without standalone or native-default fallback",async()=>{
 const f=await fixture(),p=await publication(f),started=await f.service.app.inject(p.request);expect(started.statusCode,started.body).toBe(200);const run=publishedRun(f,started.json());
 expect(run.executionSelection).toMatchObject({providerId:"opencode",backendId:"opencode-server-v2",selectionType:"explicit-model",requestedModel:"provider/model"});
 expect(run.executionSelection!.backendId).toBe(f.ports[0]!.backend.backendId);expect(f.ports[0]!.inputs[0]!.args).toEqual([]);expect(f.ports[0]!.posts.filter(path=>path.endsWith("/prompt"))).toHaveLength(1);
});
it("refuses native-default before factory work",async()=>{
 const f=await fixture(),run=await f.create("default");run.executionSelection={...run.executionSelection!,source:"native-default",selectionType:"native-default"};delete run.executionSelection.requestedModel;
 // Out-of-band canonical mutation is deliberate; regular persistence freezes selection.
 corrupt(f.service,"run",run.id,"executionSelection",run.executionSelection);await expect(f.start(run)).rejects.toThrow();expect(f.factory).not.toHaveBeenCalled();
});
it("fences a canonical cancelled Run before producer allocation",async()=>{const f=await fixture(),run=await f.create("cancelled");const runtime=f.service["opencodeRuntimes"].get("p")!,start=runtime.start.bind(runtime);vi.spyOn(runtime,"start").mockImplementation(input=>{f.service["cancelledRunIds"].add(run.id);return start(input);});await expect(f.start(run)).rejects.toMatchObject({creationOutcome:"not-created"});expect(f.factory).not.toHaveBeenCalled();});
it("refuses admission after Controller shutdown begins",async()=>{const f=await fixture(),run=await f.create("shutdown"),adapter=registry(f.service).get("p")!,closing=f.service.stop();await expect(adapter.start({runId:run.id,sessionId:run.sessionId,workspacePath:run.worktree,prompt:"fixture",beforeCreate:()=>{},beforeSend:()=>{},backendId:"opencode-server-v2",executionRef:run.executionRef,executionSelection:run.executionSelection,execution:{generation:1,attempt:1,leaseId:run.leaseId}})).rejects.toThrow();expect(f.factory).not.toHaveBeenCalled();await closing;f.holder.manualClose=true;});
// I1: the real producer resolves its source through this synchronous port callback.
it.each(["stable","runtime-removed","runtime-replaced","adapter-replaced","association-removed","association-replaced"] as const)("rechecks Controller ownership after nested source callback: %s",async drift=>{
 const f=await fixture(),run=await f.create("source-callback"),session=await f.start(run),adapter=registry(f.service).get("p")!,runtime=f.service["opencodeRuntimes"].get("p")!,leaf=f.ports[0]!,binding=session.nativeBinding!;
 await adapter.result(session.id);const posts=[...leaf.posts],readHandle=leaf.port.readHandle.bind(leaf.port),replacement={interaction:leaf.port} as AgentAdapter;
 const nested=vi.spyOn(leaf.port,"readHandle").mockImplementation(ref=>{const handle=readHandle(ref);
  if(drift==="runtime-removed")f.service["opencodeRuntimes"].delete("p");
  if(drift==="runtime-replaced")f.service["opencodeRuntimes"].set("p",new OpenCodeExecutionRuntime({profile:{id:"p",alias:"P",executable:f.executable},runnerId:"local",assertInput:()=>{},bindingFor:()=>undefined,factory:f.factory}));
  if(drift==="adapter-replaced")registry(f.service).set("p",replacement);
  if(drift==="association-removed")f.service["nativeRuntimeAdapters"].delete(runtime);
  if(drift==="association-replaced")f.service["nativeRuntimeAdapters"].set(runtime,replacement);
  return handle;
 });
 try{const source=f.service["nativePort"](binding);expect(drift==="stable"?source===leaf.port:source===undefined).toBe(true);expect(nested).toHaveBeenCalledOnce();expect(f.factory).toHaveBeenCalledTimes(1);expect(f.ports).toHaveLength(1);expect(leaf.posts).toEqual(posts);}
 finally{nested.mockRestore();f.service["opencodeRuntimes"].set("p",runtime);registry(f.service).set("p",adapter);f.service["nativeRuntimeAdapters"].set(runtime,adapter);}
});
it("requires a defined saved owner before entering the native source callback",async()=>{
 const f=await fixture(),run=await f.create("missing-owner"),session=await f.start(run),adapter=registry(f.service).get("p")!,runtime=f.service["opencodeRuntimes"].get("p")!,leaf=f.ports[0]!;
 await adapter.result(session.id);const posts=[...leaf.posts],nested=vi.spyOn(leaf.port,"readHandle");f.service["nativeRuntimeAdapters"].delete(runtime);registry(f.service).delete("p");
 try{expect(f.service["nativePort"](session.nativeBinding!)===undefined).toBe(true);expect(nested).not.toHaveBeenCalled();expect(f.factory).toHaveBeenCalledTimes(1);expect(f.ports).toHaveLength(1);expect(leaf.posts).toEqual(posts);}
 finally{nested.mockRestore();registry(f.service).set("p",adapter);f.service["nativeRuntimeAdapters"].set(runtime,adapter);}
});
