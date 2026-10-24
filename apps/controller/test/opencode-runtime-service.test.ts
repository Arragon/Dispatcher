import {execFileSync} from "node:child_process";
import {chmodSync,mkdirSync,mkdtempSync,realpathSync,renameSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach,expect,it,vi} from "vitest";
import {OpenCodeAdapter,OpenCodeV2ExecutionBackend,OpenCodeV2InteractionPort,type AgentAdapter,type CliStartInput,type LocalRuntimeDisconnect,type OpenCodeV2OwnedScope} from "@dispatcher/adapters";
import type {ExecutionContextRef,Run} from "@dispatcher/domain";
import {InteractionStore,type JsonValue} from "@dispatcher/persistence";
import {ControllerService} from "../src/service.js";
import {OpenCodeExecutionRuntime} from "../src/opencode-runtime.js";
import {normalizeOpenCodeCatalog} from "../../../packages/adapters/src/opencode-catalog.js";
const fixtures:Array<{service:ControllerService;root:string;manualClose?:boolean}>=[];
afterEach(async()=>{for(const f of fixtures.splice(0)){if(!f.manualClose)await f.service.stop();rmSync(f.root,{recursive:true,force:true});}vi.restoreAllMocks();});
const json=(value:unknown):JsonValue=>JSON.parse(JSON.stringify(value)) as JsonValue;
function registry(service:ControllerService){return service["agentAdapters"];}
async function fixture(options:{enabled?:boolean;executable?:"missing"|"directory"|"non-executable"}={}){
 const root=realpathSync(mkdtempSync(join(tmpdir(),"dispatcher-opencode-compose-"))),repo=join(root,"repo"),executable=join(root,"native.cjs");mkdirSync(repo);writeFileSync(executable,"#!"+process.execPath+"\nthrow Error('stub must never execute');\n");chmodSync(executable,0o700);
 execFileSync("git",["init","--initial-branch=main",repo]);execFileSync("git",["-C",repo,"config","user.email","fixture@example.invalid"]);execFileSync("git",["-C",repo,"config","user.name","Fixture"]);writeFileSync(join(repo,"README.md"),"fixture\n");execFileSync("git",["-C",repo,"add","README.md"]);execFileSync("git",["-C",repo,"commit","-m","fixture"]);
 const ports:Array<{scope:OpenCodeV2OwnedScope;port:OpenCodeV2InteractionPort;backend:OpenCodeV2ExecutionBackend;posts:string[];inputs:CliStartInput[];bodies:unknown[]}>=[];
 const factory=vi.fn((scope:OpenCodeV2OwnedScope,ref:ExecutionContextRef)=>{
  const posts:string[]=[],inputs:CliStartInput[]=[],bodies:unknown[]=[],native="ses_"+ref.id.replaceAll(":","_"),at=Date.now();let prompt="";
  // Pin the reviewed 2.0.26 protocol explicitly; its current session/message schema is shared with 2.0.22.
  const port=new OpenCodeV2InteractionPort({...scope,protocolVersion:"2.0.26"},{request:async input=>{input.beforeSend?.();if(input.method==="POST"){posts.push(input.path);bodies.push(structuredClone(input.body));}
   if(input.path==="/api/info")return {version:"2.0.26",pid:123,urls:[],paths:{tmp:"/tmp"}};
   if(input.path==="/api/location")return {directory:scope.workspacePath,project:{id:"project",directory:scope.workspacePath,canonical:scope.workspacePath}};
   if(input.path==="/api/session"||input.path==="/api/session/"+native)return {data:{id:native,projectID:"project",model:{providerID:"provider",id:"model"},permissions:[],location:{directory:scope.workspacePath},time:{created:at,updated:at}}};
   if(input.path==="/api/session/active")return {data:{}};if(input.path.endsWith("/inbox")||input.path.endsWith("/permission"))return {data:[]};
   if(input.path.endsWith("/prompt")){prompt=(input.body as {text:string}).text;return {data:{id:"msg_receipt",sessionID:native,type:"user",payload:{text:prompt},delivery:"queue",time:{created:at}}};}
   if(input.path.endsWith("/message"))return {data:[{id:"msg_receipt",type:"user",text:prompt,time:{created:at}},{id:"msg_done",type:"idle",outcome:"succeeded",time:{created:at}}],cursor:{previous:null,next:null}};throw Error(input.path);
  }});
  const disconnect=async():Promise<LocalRuntimeDisconnect>=>{port.markDisconnected();return {version:1,connection:"closed",ownedRoot:"exited",callbacks:"drained",backgroundTools:"unknown",nativeSessionDeleted:false};};
  const backend=new OpenCodeV2ExecutionBackend({scope,executionRef:ref,hostFactory:()=>({ready:async()=>port,disconnectLocal:disconnect})}),start=backend.start.bind(backend);
  vi.spyOn(backend,"start").mockImplementation(input=>{inputs.push(input);return start(input);});ports.push({scope,port,backend,posts,inputs,bodies});return backend;
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
