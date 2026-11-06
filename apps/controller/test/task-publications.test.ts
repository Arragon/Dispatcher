import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync,chmodSync,existsSync,readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexAdapter, StructuredCliAdapter, type CodexBackend, type CliStartInput,type AgentAdapter } from "@dispatcher/adapters";
import {InteractionStore,ModelInvocationStore,type JsonValue} from "@dispatcher/persistence";
import type {Run,TaskContract} from "@dispatcher/domain";
import type {NativeInteractions} from "../src/native-interactions.js";
import {contentHash,type PublicationRecord} from "../src/task-publications.js";
import { createHash } from "node:crypto";
import { renderTaskContract } from "@dispatcher/scheduler";
import type { DispatcherConfig, SecretStore } from "@dispatcher/config";
import { ControllerService } from "../src/service.js";
const OWNER = { authorization: "Bearer publication-test-owner" };
const fixtures: Array<{ directory: string; services: ControllerService[] }> = [];
afterEach(async () => { for (const f of fixtures.splice(0)) { for (const s of f.services) await s.stop(); rmSync(f.directory, { recursive: true, force: true }); } });
async function setup() {
  const directory = mkdtempSync(join(tmpdir(), "dispatcher-publication-"));
  const root = join(directory, "repo"); mkdirSync(root);
  execFileSync("git", ["init", "--initial-branch=main", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "fixture@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Fixture"]);
  writeFileSync(join(root, "README.md"), "fixture\n");
  execFileSync("git", ["-C", root, "add", "."]); execFileSync("git", ["-C", root, "commit", "-m", "fixture"]);
  const f = { directory, services: [] as ControllerService[] }; fixtures.push(f);
  const starts: Array<Parameters<CodexBackend["start"]>[0]> = [];
  const cliStarts: CliStartInput[] = [];
  const control = { usageEvents:[] as Array<{type:"usage";summary:string;observedAt:string;tokens:{input:number;output:number;cachedInput?:number}}>,failStart: false, completed: false, modelId: "catalog-model",modelIds:[] as string[], authenticated:true,efforts:["low","medium"] };
  const classificationRequests:Record<string,unknown>[]=[];
  const backend: CodexBackend = { start(input) { if(control.failStart) throw Object.assign(new Error("spawn fixture ENOENT"),{code:"ENOENT"}); starts.push(input); writeFileSync(join(input.workspacePath,"result.txt"),"completed locally\n"); return {status:()=>control.completed?"completed":"running",events:()=>control.usageEvents,cancel:async()=>undefined,result:async()=>({state:"completed",summary:"implemented",providerSessionId:"native-fixture-thread",events:control.usageEvents})}; } };
  const clock = { now: new Date() };
  const make = async () => { const s = new ControllerService({ dataDirectory: join(directory,"data"), ownerToken: "publication-test-owner", withRunner: true, llmFetch:async(_input,init)=>{classificationRequests.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({status:"matched",primaryType:"fix",candidates:["fix"],evidence:[{field:"title",quote:"修复"}],explanation:"修复任务"})}}],usage:{prompt_tokens:10,completion_tokens:5}}));}, codexBackendFactory: () => backend, cliBackendFactory: () => ({start(input) { cliStarts.push(input); writeFileSync(join(input.workspacePath,"result.txt"),"completed locally\n"); return {status:()=>"completed",cancel:async()=>undefined,result:async()=>({state:"completed",summary:"implemented",providerSessionId:"native-cli-thread",events:[]})}; }}), codexNativeReader: async input => input.method==="account/read"?{account:control.authenticated?{type:"chatgpt",email:"fixture@example.invalid"}:null,requiresOpenaiAuth:true}:{data:(control.modelIds.length?control.modelIds:[control.modelId]).map(model=>({model,displayName:"Catalog model",hidden:false,isDefault:true,defaultReasoningEffort:"medium",supportedReasoningEfforts:control.efforts.map(reasoningEffort=>({reasoningEffort}))})),nextCursor:null}, clock: () => clock.now, secretStore: { test: async (reference:string) => reference==="secret://llm/classifier",resolve:async()=>"fixture-secret" } as unknown as SecretStore }); f.services.push(s); await s.start({listen:false}); return s; };
  const service = await make();
  const config = service.configuration.current().config as DispatcherConfig;
  config.agentProfiles = [{id:"codex-local",alias:"Local",provider:"codex",runnerId:"local",settings:{codexHome:join(directory,"native"),model:"profile-default"}}];
  config.repositories = [{ id:"repo", root, defaultBaseRef:"main", scopePaths:[], verificationCommands:[{id:"check",file:process.execPath,args:["-e","process.exit(0)"],required:true,timeoutMs:5000,outputLimitBytes:1024}] }];
  const plan = service.configuration.buildPlan(config,"owner","web"); await service.configuration.applyPlan(plan.id,{confirmed:true});
  const draft = { schemaVersion:1, clientDraftId:"draft-1", description:"\n完整正文  😀\r\n保持原样\n",projectId:"local:repo",repositoryId:"repo",acceptanceCriteria:["works"],scopePaths:["."],verificationCommandIds:["check"],startMode:"create-only",execution:{selectionMode:"manual",selectionType:"native-default"},delivery:{type:"none"} };
  const preview = async (payload: unknown = draft, s = service) => s.app.inject({method:"POST",url:"/api/task-publications/preview",headers:OWNER,payload});
  const commit = (p: {publicationId:string;revision:number;confirmation:{reviewHash:string}}, key="key-1", s=service, extra={}) => s.app.inject({method:"POST",url:`/api/task-publications/${p.publicationId}/commit`,headers:{...OWNER,"idempotency-key":key},payload:{revision:p.revision,reviewHash:p.confirmation.reviewHash,confirmation:{accepted:true},...extra}});
  return {service,root,clock,make,draft,preview,commit,starts,cliStarts,control,classificationRequests};
}
async function pricedFixture(){
 const f=await setup(),adapter=(f.service as unknown as {agentAdapters:Map<string,AgentAdapter>}).agentAdapters.get("codex-local")!,read=adapter.modelCatalog!.bind(adapter),price={input:"0.1"};
 vi.spyOn(adapter,"modelCatalog").mockImplementation(async context=>{const catalog=await read(context);for(const entry of catalog.entries)entry.billing={mode:"metered",pricing:{version:1,basis:"native-account-model",nativeParameters:{},snapshot:{version:1,id:"native-price",source:"fixture/native-account-model",collectedAt:f.clock.now.toISOString(),unit:"credits",rates:{per:"1000",input:price.input,output:"2",includesMultiplier:true}}}};return catalog;});
 const catalog=(await f.service.app.inject({headers:OWNER,url:"/api/agents/profiles/codex-local/models?repositoryId=repo"})).json();
 const draft={...f.draft,startMode:"dispatch",execution:{profileId:"codex-local",selectionMode:"manual",selectionType:"explicit-model",nativeModelId:"catalog-model",nativeParameters:{},catalogRevision:catalog.revision,contextFingerprint:catalog.contextFingerprint,allowUnconfirmedModelAccess:true}};
 return {...f,price,pricedDraft:draft};
}
it("freezes reviewed native price across pre-start refresh, Run/Session storage, usage projection and restart",async()=>{
 const f=await pricedFixture(),p=(await f.preview(f.pricedDraft)).json();expect(p.effectiveExecution.pricingSnapshot).toMatchObject({id:"native-price",rates:{input:"0.1"}});const frozen=structuredClone(p.effectiveExecution.pricingSnapshot);f.clock.now=new Date(f.clock.now.getTime()+60_000);const receipt=(await f.commit(p,"frozen-price")).json(),run=f.service.database.getEntity("run",receipt.runId) as unknown as Run;expect(run.executionSelection?.pricingSnapshot).toEqual(frozen);expect(f.service.database.getEntity("adapter-session",run.sessionId)).toMatchObject({executionSelection:{pricingSnapshot:frozen}});expect(f.starts).toHaveLength(1);
 const {UsageObservations}=await import("../src/usage-observations.js");new UsageObservations(f.service.database).record([{version:1,eventId:"fixture-native-usage",profileId:run.profileId,runId:run.id,sessionId:run.sessionId,generation:run.generation,scope:"run",mode:"snapshot",observedAt:f.clock.now.toISOString(),source:"native-event",completeness:"complete",metrics:[{name:"input",value:"100",unit:"tokens"},{name:"output",value:"0",unit:"tokens"}]}],{profileId:run.profileId,runId:run.id,sessionId:run.sessionId,generation:run.generation});
 f.price.input="999";expect((await f.service.app.inject({headers:OWNER,url:`/api/usage?runId=${run.id}`})).json().estimation).toMatchObject({status:"available",estimate:{value:"0.01",unit:"credits",pricingSnapshot:frozen}});await f.service.stop();const restarted=await f.make();expect((await restarted.app.inject({headers:OWNER,url:`/api/usage?runId=${run.id}`})).json().estimation.estimate.pricingSnapshot).toEqual(frozen);expect(f.starts).toHaveLength(1);
});
it("rejects changed native price terms before starting even when the catalog revision is unchanged",async()=>{
 const f=await pricedFixture(),p=(await f.preview(f.pricedDraft)).json();expect(p.canCommit).toBe(true);f.price.input="0.2";const response=await f.commit(p,"changed-price");expect(response.statusCode,response.body).toBe(409);expect(response.json().code).toBe("SELECTION_CHANGED");expect(f.starts).toHaveLength(0);
});
it("preserves native event conflicts through background collection and clears the estimate error on valid recovery",async()=>{
 const f=await pricedFixture(),receipt=(await f.commit((await f.preview(f.pricedDraft)).json(),"price-usage-conflict")).json(),run=f.service.database.getEntity("run",receipt.runId) as unknown as Run;
 const event={version:1,eventId:"same-native-event",profileId:run.profileId,runId:run.id,sessionId:run.sessionId,generation:run.generation,scope:"run",mode:"snapshot",observedAt:f.clock.now.toISOString(),source:"native-event",completeness:"complete",metrics:[{name:"input",value:"100",unit:"tokens"},{name:"output",value:"0",unit:"tokens"}]};
 const {UsageObservations}=await import("../src/usage-observations.js");new UsageObservations(f.service.database).record([event],{profileId:run.profileId,runId:run.id,sessionId:run.sessionId,generation:run.generation});
 const adapter=f.service["agentAdapters"].get(run.profileId)!,read=vi.spyOn(adapter,"usage").mockResolvedValue({observations:[{...event,metrics:[{name:"input",value:"999",unit:"tokens"}]}]});
 const collect=async()=>{f.service["kickRunUsage"](run);await Promise.all([...f.service["usageReads"].values()].map(value=>value.promise));};await collect();
 const failed=(await f.service.app.inject({headers:OWNER,url:`/api/usage?runId=${run.id}`})).json();expect(failed.errors).toContainEqual(expect.objectContaining({reasonCode:"USAGE_EVENT_CONFLICT"}));expect(failed.estimation).toEqual({status:"unavailable",reasonCode:"USAGE_EVENT_CONFLICT"});expect(failed.observations[0].metrics[0].value).toBe("100");
 f.clock.now=new Date(f.clock.now.getTime()+5*60_000);read.mockRejectedValue(Error("subsequent native read failed"));await collect();const unread=(await f.service.app.inject({headers:OWNER,url:`/api/usage?runId=${run.id}`})).json();expect(unread.errors).toContainEqual(expect.objectContaining({reasonCode:"USAGE_EVENT_CONFLICT"}));expect(unread.estimation).toEqual({status:"unavailable",reasonCode:"USAGE_EVENT_CONFLICT"});
 f.clock.now=new Date(f.clock.now.getTime()+5*60_000);read.mockResolvedValue({observations:[event]});await collect();const restored=(await f.service.app.inject({headers:OWNER,url:`/api/usage?runId=${run.id}`})).json();expect(restored.errors).toHaveLength(0);expect(restored.estimation).toMatchObject({status:"available",estimate:{value:"0.01",completeness:"complete"}});expect(f.starts).toHaveLength(1);
});
describe("task publication receipts", () => {
  it("retains structured input Context and constraints through canonical publication and prompt rendering", async () => {
    const f = await setup(), content = "\n上下文 😀\r\n  preserve exact bytes\n";
    const inputContext = { packetId: "packet-a", formatVersion: "1", content, inputHash: createHash("sha256").update(content, "utf8").digest("hex") };
    const constraints = ["保持导出接口不变", "Do not edit credentials"];
    const response = await f.preview({ ...f.draft, constraints, inputContext }); expect(response.statusCode).toBe(200);
    const receipt = (await f.commit(response.json())).json(); expect(receipt.state).toBe("TASK_CREATED");
    const contract = f.service.database.getTaskContract<JsonValue>(receipt.taskId) as unknown as TaskContract;
    expect(contract).toMatchObject({ constraints, inputContext });
    expect(renderTaskContract(contract)).toContain(JSON.stringify(inputContext));
    expect(f.starts).toHaveLength(0);
  });
  it("rejects mismatched, malformed and oversized Context before canonical creation", async () => {
    const f = await setup();
    for (const content of ["changed", "😀".repeat(20000), "\ud800"]) {
      const inputHash = content === "changed" ? "a".repeat(64) : createHash("sha256").update(content,"utf8").digest("hex");
      const response = await f.preview({ ...f.draft, inputContext: { packetId: "packet-a", formatVersion: "1", content, inputHash } });
      expect(response.statusCode).toBe(400);
    }
    expect(f.service.database.listCanonicalTasks()).toEqual([]); expect(f.starts).toHaveLength(0);
  });
  it("cancels a reserved unsent local startup atomically and never invokes the SDK after restart/retry",async()=>{
    const f=await setup(),adapter=(f.service as unknown as {agentAdapters:Map<string,AgentAdapter>}).agentAdapters.get("codex-local")!,start=adapter.start.bind(adapter),entered=Promise.withResolvers<void>(),ready=Promise.withResolvers<void>();vi.spyOn(adapter,"start").mockImplementation(async input=>{entered.resolve();await ready.promise;return start(input);});
    const catalog=(await f.service.app.inject({headers:OWNER,url:"/api/agents/profiles/codex-local/models?repositoryId=repo"})).json();const p=(await f.preview({...f.draft,startMode:"dispatch",execution:{profileId:"codex-local",selectionMode:"manual",selectionType:"explicit-model",nativeModelId:"catalog-model",nativeParameters:{},catalogRevision:catalog.revision,contextFingerprint:catalog.contextFingerprint,allowUnconfirmedModelAccess:true}})).json();expect(p.canCommit).toBe(true);const pending=f.commit(p,"unsent-cancel").then(value=>value);
    try{await entered.promise;const run=f.service.database.listEntities("run")[0] as unknown as Run;const cancelled=await f.service.semanticTools.execute("run.cancel",{target:run.id},{principal:{id:"owner",roles:["operator"],channel:"api"},workflowId:"cancel-before-send",confirmed:true});expect(cancelled).toMatchObject({state:"CANCELLED"});expect(f.service.database.getCanonicalTask(run.taskId)?.document).toMatchObject({state:"CANCELLED"});expect(f.service.database.getEntity("native-cancel",run.id)).toMatchObject({actorId:"owner",resolution:{nativeMayBeRunning:false,nativeStopProof:{state:"stopped",code:"NATIVE_START_NOT_SENT"}}});expect(f.starts).toHaveLength(0);ready.resolve();expect((await pending).json()).toMatchObject({state:"START_FAILED",runId:run.id});expect(f.starts).toHaveLength(0);await f.service.stop();const restarted=await f.make();expect((await f.commit(p,"unsent-cancel",restarted)).json()).toMatchObject({state:"START_FAILED",runId:run.id});expect(restarted.database.listCanonicalTasks()).toHaveLength(1);expect(f.starts).toHaveLength(0);}finally{ready.resolve();await pending;}
  });
  it("rolls an unsent cancellation back atomically when its Task transition fails",async()=>{
    const f=await setup(),adapter=(f.service as unknown as {agentAdapters:Map<string,AgentAdapter>}).agentAdapters.get("codex-local")!,start=adapter.start.bind(adapter),entered=Promise.withResolvers<void>(),ready=Promise.withResolvers<void>();vi.spyOn(adapter,"start").mockImplementation(async input=>{entered.resolve();await ready.promise;return start(input);});
    const catalog=(await f.service.app.inject({headers:OWNER,url:"/api/agents/profiles/codex-local/models?repositoryId=repo"})).json();const p=(await f.preview({...f.draft,startMode:"dispatch",execution:{profileId:"codex-local",selectionMode:"manual",selectionType:"explicit-model",nativeModelId:"catalog-model",nativeParameters:{},catalogRevision:catalog.revision,contextFingerprint:catalog.contextFingerprint,allowUnconfirmedModelAccess:true}})).json();expect(p.canCommit).toBe(true);const pending=f.commit(p,"unsent-rollback").then(value=>value);
    try{await entered.promise;const run=f.service.database.listEntities("run")[0] as unknown as Run,beforeRun=f.service.database.getEntity("run",run.id),beforeTask=f.service.database.getCanonicalTask(run.taskId),execute=f.service.tasks.execute.bind(f.service.tasks);const taskSpy=vi.spyOn(f.service.tasks,"execute").mockImplementation((input,...rest)=>{if(input.command.type==="task.transition"&&input.command.state==="CANCELLED")throw Error("temporary task write failure");return execute(input,...rest);});
      await expect(f.service.semanticTools.execute("run.cancel",{target:run.id},{principal:{id:"owner",roles:["operator"],channel:"api"},workflowId:"failed-unsent-cancel",confirmed:true})).rejects.toThrow();expect(taskSpy.mock.calls.some(([input])=>input.command.type==="task.transition"&&input.command.state==="CANCELLED")).toBe(true);taskSpy.mockRestore();expect(f.service.database.getEntity("run",run.id)).toEqual(beforeRun);expect(f.service.database.getCanonicalTask(run.taskId)).toEqual(beforeTask);expect(f.service.database.getEntity("native-cancel",run.id)).toBeUndefined();expect(f.starts).toHaveLength(0);
    }finally{ready.resolve();await pending;}
  });

  it("keeps a sent startup separate from proven unsent cancellation when its acknowledgement is delayed",async()=>{
    const f=await setup(),adapter=(f.service as unknown as {agentAdapters:Map<string,AgentAdapter>}).agentAdapters.get("codex-local")!,start=adapter.start.bind(adapter),entered=Promise.withResolvers<void>(),ready=Promise.withResolvers<void>();vi.spyOn(adapter,"start").mockImplementation(async input=>{const session=await start(input);entered.resolve();await ready.promise;return session;});const cancel=vi.spyOn(adapter,"cancel");
    const catalog=(await f.service.app.inject({headers:OWNER,url:"/api/agents/profiles/codex-local/models?repositoryId=repo"})).json();const p=(await f.preview({...f.draft,startMode:"dispatch",execution:{profileId:"codex-local",selectionMode:"manual",selectionType:"explicit-model",nativeModelId:"catalog-model",nativeParameters:{},catalogRevision:catalog.revision,contextFingerprint:catalog.contextFingerprint,allowUnconfirmedModelAccess:true}})).json();expect(p.canCommit).toBe(true);const pending=f.commit(p,"sent-cancel").then(value=>value);
    try{await entered.promise;const run=f.service.database.listEntities("run")[0] as unknown as Run;expect(f.starts).toHaveLength(1);await f.service.semanticTools.execute("run.cancel",{target:run.id},{principal:{id:"owner",roles:["operator"],channel:"api"},workflowId:"cancel-sent",confirmed:true});expect(cancel).toHaveBeenCalledTimes(1);expect(f.service.database.getEntity("native-cancel",run.id)).toBeUndefined();expect(f.service.database.getEntity("adapter-session",run.sessionId)).toMatchObject({authority:{stopState:"confirmed"}});ready.resolve();expect((await pending).json()).toMatchObject({state:"OUTCOME_UNKNOWN",runId:run.id});expect(f.starts).toHaveLength(1);expect(f.service.database.getCanonicalTask(run.taskId)?.document).toMatchObject({state:"CANCELLED"});}finally{ready.resolve();await pending;}
  });
  it.each(["RESERVED","SENDING","UNKNOWN","ACKNOWLEDGED"] as const)("recovers a %s local start journal without treating its reserved Session ID as creation proof",async state=>{
    const f=await setup(),p=(await f.preview()).json(),receipt=(await f.commit(p,`journal-${state}`)).json(),task=f.service.database.getCanonicalTask(receipt.taskId)!,contract=f.service.database.getTaskContract(receipt.taskId) as unknown as TaskContract,at=new Date().toISOString();
    // Controlled journal fixture, not a real process crash/provider Gate.
    const run:Run={id:`journal-${state}`,taskId:receipt.taskId,sessionId:`reserved-${state}`,profileId:"codex-local",providerId:"codex",runnerId:"local",state:"STARTING",generation:1,attempt:1,leaseId:`lease-${state}`,taskRevision:task.revision,contractRevision:contract.revision,startedAt:at,lastActivityAt:at,worktree:"/synthetic/workspace",executionSelection:{version:1,mode:"legacy",source:"legacy-config",profileId:"codex-local",providerId:"codex",runnerId:"local",backendId:"codex-exec-json",selectionType:"native-default",nativeParameters:{},contextFingerprint:"fixture-context",configRevision:f.service.configuration.current().revision,selectedAt:at}};
    f.service.database.transaction(()=>{f.service.database.saveEntity("run",run.id,JSON.parse(JSON.stringify(run)) as JsonValue);f.service.database.saveEntity("run-contract",run.id,JSON.parse(JSON.stringify(contract)) as JsonValue);const bound=f.service.tasks.execute({id:`${state}-bound`,taskId:run.taskId,baseRevision:task.revision,actor:"fixture",command:{type:"task.set-current-run",runId:run.id}});f.service.tasks.execute({id:`${state}-queued`,taskId:run.taskId,baseRevision:bound.revision,actor:"fixture",command:{type:"task.transition",state:"QUEUED"}});});
    const native=(f.service as unknown as {nativeInteractions:NativeInteractions}).nativeInteractions,command=native.reserveNativeStart({run,actorId:"scheduler",resumable:true,backendId:"codex-exec-json",configRevision:run.executionSelection!.configRevision,semantics:{controllerStartVersion:1,runnerMode:"embedded",contractHash:contentHash(contract)}});
    if(state!=="RESERVED"){native.beginNativeStart(command.id);if(state==="UNKNOWN")native.settleNativeStart(command.id,{kind:"unknown",code:"NATIVE_START_OUTCOME_UNKNOWN"});if(state==="ACKNOWLEDGED"){const session={id:run.sessionId,runId:run.id,profileId:run.profileId,backendId:run.executionSelection!.backendId,workspacePath:run.worktree!,executionSelection:run.executionSelection,execution:{generation:run.generation,attempt:run.attempt,leaseId:run.leaseId},state:"RUNNING" as const,createdAt:at,updatedAt:at};f.service.database.saveEntity("adapter-session",session.id,JSON.parse(JSON.stringify(session)) as JsonValue);native.settleNativeStart(command.id,{kind:"created",session});}}
    const publication=f.service.database.getEntity("task-publication",p.publicationId) as unknown as PublicationRecord;publication.receipt={...receipt,state:"STARTING",runId:run.id};f.service.database.saveEntity("task-publication",p.publicationId,JSON.parse(JSON.stringify(publication)) as JsonValue);await f.service.stop();const restarted=await f.make();
    expect(restarted.database.getEntity("task-publication",p.publicationId)).toMatchObject({receipt:{state:"OUTCOME_UNKNOWN",runId:run.id}});expect(restarted.database.getEntity("run",run.id)).toMatchObject({state:"RUNNER_UNAVAILABLE",recoveryState:"STARTING",resumePolicy:"manual"});expect(new InteractionStore(restarted.database).command(command.id)?.state).toBe(state==="SENDING"?"UNKNOWN":state);expect(f.starts).toHaveLength(0);if(state!=="ACKNOWLEDGED")expect(restarted.database.getEntity("adapter-session",run.sessionId)).toBeUndefined();await restarted.runBackgroundCycle();expect(f.starts).toHaveLength(0);if(state==="RESERVED"){await restarted.semanticTools.execute("run.cancel",{target:run.id},{principal:{id:"owner",roles:["operator"],channel:"api"},workflowId:"cancel-restored-reservation",confirmed:true});expect(restarted.database.getEntity("run",run.id)).toMatchObject({state:"CANCELLED"});expect(restarted.database.getEntity("task-publication",p.publicationId)).toMatchObject({receipt:{state:"START_FAILED"}});expect(f.starts).toHaveLength(0);}
  });
  it("isolates simultaneous model choices and preserves both frozen Runs across restart",async()=>{
    const f=await setup(),config=f.service.configuration.current().config;config.runners[0]!.capacity=2;
    await f.service.configuration.applyPlan(f.service.configuration.buildPlan(config,"owner","web").id,{confirmed:true});
    f.control.modelIds=["model-a","model-b"];
    const catalog=(await f.service.app.inject({headers:OWNER,url:"/api/agents/profiles/codex-local/models?repositoryId=repo"})).json();
    const previews=await Promise.all(f.control.modelIds.map((nativeModelId,index)=>f.preview({...f.draft,clientDraftId:`simultaneous-${index}`,startMode:"dispatch",execution:{profileId:"codex-local",selectionMode:"manual",selectionType:"explicit-model",nativeModelId,nativeParameters:{reasoningEffort:index?"medium":"low"},catalogRevision:catalog.revision,contextFingerprint:catalog.contextFingerprint,allowUnconfirmedModelAccess:true}})));
    for(const response of previews)expect(response.json().canCommit).toBe(true);
    const receipts=await Promise.all(previews.map((response,index)=>f.commit(response.json(),`simultaneous-${index}`).then(value=>value.json())));
    expect(receipts.map(value=>value.state)).toEqual(["STARTED","STARTED"]);
    expect(f.starts).toHaveLength(2);
    for(const [index,receipt] of receipts.entries()){
      const run=f.service.database.getEntity("run",receipt.runId) as {worktree:string;executionSelection:{requestedModel:string;nativeParameters:{reasoningEffort:string}}},model=f.control.modelIds[index],reasoningEffort=index?"medium":"low";
      expect(run.executionSelection).toMatchObject({requestedModel:model,nativeParameters:{reasoningEffort}});
      expect(f.starts.find(call=>call.workspacePath===run.worktree)).toMatchObject({model,reasoningEffort});
    }
    const selections=receipts.map(value=>(f.service.database.getEntity("run",value.runId) as {executionSelection:unknown}).executionSelection);
    await f.service.stop();const restarted=await f.make();
    expect(receipts.map(value=>(restarted.database.getEntity("run",value.runId) as {executionSelection:unknown}).executionSelection)).toEqual(selections);
    expect(restarted.configuration.current().config.agentProfiles[0]!.settings!.model).toBe("profile-default");expect(f.starts).toHaveLength(2);
  });

  it("bounds shutdown and retains unknown cleanup when a catalog reader ignores cancellation",async()=>{
    const f=await setup(),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();
    const original=CodexAdapter.prototype.modelCatalog;
    const reader=vi.spyOn(CodexAdapter.prototype,"modelCatalog").mockImplementation(async function(this:CodexAdapter,context){entered.resolve();await release.promise;const {signal,...scope}=context;void signal;return original.call(this,scope);});
    try{
      const pending=f.service.app.inject({headers:OWNER,url:"/api/agents/profiles/codex-local/models?repositoryId=repo"}).then(value=>value);
      await entered.promise;await expect(f.service.stop()).rejects.toMatchObject({code:"NATIVE_RUNTIME_CLEANUP_UNKNOWN"});expect((await pending).json().code).toBe("CATALOG_CLOSED");
      expect(f.service.database.getEntity("catalog-lifecycle","shutdown")).toMatchObject({state:"unknown",reasonCode:"CATALOG_CLEANUP_UNKNOWN",pendingReads:1});
      const db=new DatabaseSync(join(f.root,"..","data","dispatcher.sqlite"),{readOnly:true});
      try{expect(JSON.parse(String(db.prepare("SELECT document_json FROM entities WHERE kind='catalog-lifecycle' AND id='shutdown'").get()!.document_json))).toMatchObject({state:"unknown",reasonCode:"CATALOG_CLEANUP_UNKNOWN",pendingReads:1});}finally{db.close();}
    }finally{
      release.resolve();reader.mockRestore();
      await Promise.allSettled([...f.service["nativeCatalogReads"]]);
      // This intentional unknown stop keeps storage open. Drain its raw reader,
      // then remove only this service from normal successful-stop fixture cleanup.
      const owner=fixtures.find(entry=>entry.services.includes(f.service))!;
      owner.services=owner.services.filter(service=>service!==f.service);
      f.service.database.close();
    }
  });

  it("aborts owned catalog reads and waits for cleanup before closing storage",async()=>{
    const f=await setup(),entered=Promise.withResolvers<AbortSignal>(),release=Promise.withResolvers<void>();
    const original=CodexAdapter.prototype.modelCatalog;
    const reader=vi.spyOn(CodexAdapter.prototype,"modelCatalog").mockImplementation(async function(this:CodexAdapter,context){
      entered.resolve(context.signal!);await release.promise;return original.call(this,context);
    });
    try{
      const pending=f.service.app.inject({headers:OWNER,url:"/api/agents/profiles/codex-local/models?repositoryId=repo"}).then(value=>value);
      const signal=await entered.promise;expect(signal).toBeInstanceOf(AbortSignal);
      let stopped=false;const closing=f.service.stop().then(()=>{stopped=true;});
      await new Promise(resolve=>setTimeout(resolve,10));expect(signal.aborted).toBe(true);expect(stopped).toBe(false);
      release.resolve();expect((await pending).json().code).toBe("CATALOG_CLOSED");await closing;
    }finally{release.resolve();reader.mockRestore();}
  });

  it("freezes an explicitly reviewed account default as the sole Run selection",async()=>{
    const f=await setup(),config=f.service.configuration.current().config;config.agentProfiles[0]!.settings!.model="catalog-model";
    const plan=f.service.configuration.buildPlan(config,"owner","web");await f.service.configuration.applyPlan(plan.id,{confirmed:true});
    const catalog=(await f.service.app.inject({headers:OWNER,url:"/api/agents/profiles/codex-local/models?repositoryId=repo"})).json();
    const p=(await f.preview({...f.draft,startMode:"dispatch",execution:{profileId:"codex-local",selectionMode:"manual",selectionType:"explicit-model",selectionSource:"account-default",nativeModelId:"catalog-model",catalogRevision:catalog.revision,contextFingerprint:catalog.contextFingerprint,nativeParameters:{reasoningEffort:"low"},allowUnconfirmedModelAccess:true}})).json();
    expect(p.canCommit).toBe(true);expect(p.effectiveExecution).toMatchObject({selectionSource:"account-default",nativeModelId:"catalog-model",nativeParameters:{reasoningEffort:"low"}});
    const receipt=(await f.commit(p)).json();expect(receipt.state).toBe("STARTED");
    expect(f.service.database.getEntity("run",receipt.runId)).toMatchObject({executionSelection:{source:"account-default",requestedModel:"catalog-model",nativeParameters:{reasoningEffort:"low"}}});
    expect(f.service.database.getEntity("run",receipt.runId)).not.toHaveProperty("modelSelection");
    expect(f.starts[0]).toMatchObject({model:"catalog-model",reasoningEffort:"low"});
  });
  it("rejects forged account-default attribution before creating or starting work",async()=>{
    const f=await setup();const catalog=(await f.service.app.inject({headers:OWNER,url:"/api/agents/profiles/codex-local/models?repositoryId=repo"})).json();
    for(const selectionType of ["native-default","explicit-model"]){
      const preview=(await f.preview({...f.draft,startMode:"dispatch",execution:{profileId:"codex-local",selectionMode:"manual",selectionType,selectionSource:"account-default",...(selectionType==="explicit-model"?{nativeModelId:"catalog-model",catalogRevision:catalog.revision,contextFingerprint:catalog.contextFingerprint,allowUnconfirmedModelAccess:true}:{})}})).json();
      expect(preview.canCommit).toBe(false);expect(preview.checks).toEqual(expect.arrayContaining([expect.objectContaining({code:"ACCOUNT_DEFAULT_CHANGED"})]));
    }
    expect(f.starts).toHaveLength(0);expect(f.service.database.listEntities("task")).toHaveLength(0);
  });

  it("refuses an account-default plan if native credentials change after catalog validation",async()=>{
    const f=await setup();const catalog=(await f.service.app.inject({headers:OWNER,url:"/api/agents/profiles/codex-local/models?repositoryId=repo"})).json();
    const current=f.service.configuration.current(),config=structuredClone(current.config);config.agentProfiles[0]!.settings!.model="catalog-model";
    const nativeModelDefault={version:1,profileId:"codex-local",repositoryId:"repo",modelId:"catalog-model",catalogRevision:catalog.revision,contextFingerprint:catalog.contextFingerprint,allowUnconfirmedModelAccess:true};
    const built=(await f.service.app.inject({headers:OWNER,method:"POST",url:"/api/config/plans",payload:{baseRevision:current.revision,config,nativeModelDefault}})).json();
    const entered=Promise.withResolvers<void>(),gate=Promise.withResolvers<void>();
    const target=f.service as unknown as {refreshChangingTrialSessions:(current:DispatcherConfig,next:DispatcherConfig)=>Promise<void>};
    const held=vi.spyOn(target,"refreshChangingTrialSessions").mockImplementation(async()=>{entered.resolve();await gate.promise;});
    try {
      const pending=f.service.app.inject({headers:OWNER,method:"POST",url:`/api/config/plans/${built.plan.id}/apply`,payload:{confirmed:true}}).then(value=>value);
      await entered.promise;
      const home=String(config.agentProfiles[0]!.settings!.codexHome);mkdirSync(home,{recursive:true});writeFileSync(join(home,"auth.json"),"{}");
      gate.resolve();const applied=await pending;
      expect(applied.statusCode).toBe(409);expect(applied.json().code).toBe("MODEL_DEFAULT_PLAN_STALE");
      expect(f.service.configuration.current().config.agentProfiles[0]!.settings!.model).toBe("profile-default");
    } finally {gate.resolve();held.mockRestore();}
  });
  it("applies a fresh account-default review through the existing ConfigPlan path",async()=>{
    const f=await setup();const catalog=(await f.service.app.inject({headers:OWNER,url:"/api/agents/profiles/codex-local/models?repositoryId=repo"})).json();
    const current=f.service.configuration.current(),config=structuredClone(current.config);config.agentProfiles[0]!.settings!.model="catalog-model";
    const nativeModelDefault={version:1,profileId:"codex-local",repositoryId:"repo",modelId:"catalog-model",catalogRevision:catalog.revision,contextFingerprint:catalog.contextFingerprint,allowUnconfirmedModelAccess:true};
    const built=await f.service.app.inject({headers:OWNER,method:"POST",url:"/api/config/plans",payload:{baseRevision:current.revision,config,nativeModelDefault}});
    expect(built.statusCode).toBe(201);const plan=built.json().plan;
    expect(f.service.database.getEntity("model-default-plan",plan.id)).toMatchObject({format:"v3-model-default-plan-v1",configRevision:current.revision,review:nativeModelDefault});
    expect((await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/config/plans/${plan.id}/apply?view=console`,payload:{confirmed:true}})).statusCode).toBe(200);
    expect(f.service.configuration.current().config.agentProfiles[0]!.settings!.model).toBe("catalog-model");
    expect(f.starts).toHaveLength(0);
  });
  it("rolls back plan creation if its native-default evidence cannot be persisted",async()=>{
    const f=await setup();const catalog=(await f.service.app.inject({headers:OWNER,url:"/api/agents/profiles/codex-local/models?repositoryId=repo"})).json();
    const current=f.service.configuration.current(),config=structuredClone(current.config);config.agentProfiles[0]!.settings!.model="catalog-model";
    const count=()=>Number(f.service.database.handle.prepare("SELECT COUNT(*) AS count FROM config_plans").get()!.count),before=count();
    const save=f.service.database.saveEntity.bind(f.service.database);
    const failure=vi.spyOn(f.service.database,"saveEntity").mockImplementation((kind,...args)=>{if(kind==="model-default-plan")throw new Error("injected default proof write failure");save(kind,...args);});
    try {
      const nativeModelDefault={version:1,profileId:"codex-local",repositoryId:"repo",modelId:"catalog-model",catalogRevision:catalog.revision,contextFingerprint:catalog.contextFingerprint,allowUnconfirmedModelAccess:true};
      const built=await f.service.app.inject({headers:OWNER,method:"POST",url:"/api/config/plans",payload:{baseRevision:current.revision,config,nativeModelDefault}});
      expect(built.statusCode).toBe(500);expect(count()).toBe(before);
      expect(f.service.configuration.current().revision).toBe(current.revision);
    } finally {failure.mockRestore();}
  });
  it("revalidates a reviewed account-default catalog before applying its ConfigPlan",async()=>{
    const f=await setup();const catalog=(await f.service.app.inject({headers:OWNER,url:"/api/agents/profiles/codex-local/models?repositoryId=repo"})).json();
    const current=f.service.configuration.current(),config=structuredClone(current.config);config.agentProfiles[0]!.settings!.model="catalog-model";
    const nativeModelDefault={version:1,profileId:"codex-local",repositoryId:"repo",modelId:"catalog-model",catalogRevision:catalog.revision,contextFingerprint:catalog.contextFingerprint,allowUnconfirmedModelAccess:true};
    const response=await f.service.app.inject({headers:OWNER,method:"POST",url:"/api/config/plans",payload:{baseRevision:current.revision,config,nativeModelDefault}});
    expect(response.statusCode).toBe(201);const plan=response.json().plan;
    f.control.modelId="changed-catalog-model";
    const applied=await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/config/plans/${plan.id}/apply`,payload:{confirmed:true}});
    expect(applied.statusCode).toBe(409);expect(applied.json().code).toBe("MODEL_DEFAULT_PLAN_STALE");
    expect(f.service.configuration.current().config.agentProfiles[0]!.settings!.model).toBe("profile-default");
    expect(f.starts).toHaveLength(0);
  });
  it("requires fresh review of legacy native-default plan proofs instead of guessing their catalog hash",async()=>{
    const f=await setup();const current=f.service.configuration.current(),config=structuredClone(current.config);config.agentProfiles[0]!.settings!.model="catalog-model";
    const plan=f.service.configuration.buildPlan(config,"owner","web");
    const historical={profileId:"codex-local",principalId:"owner",catalogVersion:"legacy-catalog-hash",nativeSelectionId:"catalog-model",input:{configRevision:current.revision}};
    f.service.database.saveEntity("model-default-plan",plan.id,historical);
    const applied=await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/config/plans/${plan.id}/apply`,payload:{confirmed:true}});
    expect(applied.statusCode).toBe(409);expect(applied.json().code).toBe("MODEL_DEFAULT_REVIEW_REQUIRED");
    expect(f.service.configuration.current().config.agentProfiles[0]!.settings!.model).toBe("profile-default");
    expect(f.service.database.getEntity("model-default-plan",plan.id)).toEqual(historical);
  });
  it("shares an identical in-flight account/project catalog without superseding either reader",async()=>{
    const f=await setup();let release!:()=>void;let entered!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
    const original=CodexAdapter.prototype.modelCatalog;
    const read=vi.spyOn(CodexAdapter.prototype,"modelCatalog").mockImplementation(async function(input){entered();await gate;return original.call(this,input);});
    try {
      const replies=Promise.all([1,2].map(()=>f.service.app.inject({headers:OWNER,url:"/api/agents/profiles/codex-local/models?repositoryId=repo"}).then(value=>value)));
      await started;release();const [a,b]=await replies;
      expect(a!.statusCode).toBe(200);expect(b!.statusCode).toBe(200);
      expect(a!.json()).toEqual(b!.json());expect(read).toHaveBeenCalledTimes(1);
    } finally {release();read.mockRestore();}
  });
  it("keeps the last successful catalog read-only after a refresh failure",async()=>{
    const f=await setup();const url="/api/agents/profiles/codex-local/models?repositoryId=repo";
    const first=(await f.service.app.inject({headers:OWNER,url})).json();
    const read=vi.spyOn(CodexAdapter.prototype,"modelCatalog").mockRejectedValue(new Error("sk-synthetic-private-catalog-error"));
    try {
      const response=await f.service.app.inject({headers:OWNER,url});expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({freshness:"native-cache",fetchedAt:first.fetchedAt,entries:first.entries,failure:{code:"NATIVE_CATALOG_UNAVAILABLE"}});
      expect(JSON.stringify(response.json())).not.toContain("sk-synthetic-private-catalog-error");
      const preview=(await f.preview({...f.draft,startMode:"dispatch",execution:{profileId:"codex-local",selectionMode:"manual",selectionType:"explicit-model",nativeModelId:"catalog-model",catalogRevision:first.revision,contextFingerprint:first.contextFingerprint}})).json();
      expect(preview.canCommit).toBe(false);expect(f.starts).toHaveLength(0);
    } finally {read.mockRestore();}
  });
  it("rejects a catalog returned for a different account instead of treating it as fresh",async()=>{
    const f=await setup();const original=CodexAdapter.prototype.modelCatalog;
    const read=vi.spyOn(CodexAdapter.prototype,"modelCatalog").mockImplementation(async function(input){return {...await original.call(this,input),profileId:"foreign-profile"};});
    try {
      const response=await f.service.app.inject({headers:OWNER,url:"/api/agents/profiles/codex-local/models?repositoryId=repo"});
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({profileId:"codex-local",freshness:"unverified",entries:[],failure:{code:"NATIVE_CONTEXT_CHANGED"}});
    } finally {read.mockRestore();}
  });
  it("waits for an owned Git hook to terminate before acknowledging canonical cancellation",async()=>{
    const f=await setup();f.control.completed=true;const ready=join(f.root,"..","git-hook.pid"),hook=join(f.root,".git","hooks","pre-commit");
    writeFileSync(hook,`#!${process.execPath}\nconst fs=require('node:fs');process.on('SIGTERM',()=>{});fs.writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>{},1000);\n`);chmodSync(hook,0o755);
    const preview=(await f.preview({...f.draft,startMode:"dispatch",execution:{...f.draft.execution,profileId:"codex-local"},delivery:{type:"commit"}})).json(),receipt=(await f.commit(preview)).json();expect(receipt.state).toBe("STARTED");
    const advancing=f.service.app.inject({headers:OWNER,method:"POST",url:`/api/runs/${receipt.runId}/advance`});void advancing.then(()=>undefined);
    await expect.poll(()=>existsSync(ready),{timeout:5000}).toBe(true);const pid=Number(readFileSync(ready,"utf8"));
    const cancelled=await f.service.semanticTools.execute("run.cancel",{target:receipt.runId},{principal:{id:"operator",roles:["operator"],channel:"api"},workflowId:"cancel-commit",confirmed:true});expect(cancelled).toMatchObject({state:"CANCELLED"});await advancing;
    let stopped=false;try{process.kill(pid,0);}catch(error){stopped=Boolean(error&&typeof error==="object"&&"code" in error&&error.code==="ESRCH");}expect(stopped).toBe(true);const run=f.service.database.getEntity<JsonValue>("run",receipt.runId) as {worktree:string};expect(execFileSync("git",["-C",run.worktree,"rev-list","--count",`${execFileSync("git",["-C",f.root,"rev-parse","HEAD"],{encoding:"utf8"}).trim()}..HEAD`],{encoding:"utf8"}).trim()).toBe("0");
  });
  it("finishes explicit local commit delivery without GitHub, push or changing the original worktree",async()=>{
    const f=await setup();f.control.completed=true;const original=execFileSync("git",["-C",f.root,"rev-parse","HEAD"],{encoding:"utf8"}).trim();execFileSync("git",["-C",f.root,"remote","add","origin","https://must-not-push.invalid/fixture.git"]);
    const draft={...f.draft,startMode:"dispatch",execution:{...f.draft.execution,profileId:"codex-local"},delivery:{type:"commit"}};
    const preview=(await f.preview(draft)).json();expect(preview.canCommit).toBe(true);const receipt=(await f.commit(preview)).json();expect(receipt.state).toBe("STARTED");
    const advanced=await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/runs/${receipt.runId}/advance`});expect(advanced.json()).toMatchObject({run:{state:"COMPLETE",verification:{state:"PASSED"}},task:{state:"REVIEW"},deliveries:[]});
    const result=f.service.database.getEntity("run-result",receipt.runId) as {commit:{commit:string;created:boolean};worktree:string};expect(result.commit).toMatchObject({created:true,commit:expect.stringMatching(/^[a-f0-9]{40}$/)});
    expect(execFileSync("git",["-C",f.root,"rev-parse","HEAD"],{encoding:"utf8"}).trim()).toBe(original);expect(execFileSync("git",["-C",result.worktree,"rev-list","--count",`${original}..HEAD`],{encoding:"utf8"}).trim()).toBe("1");
    expect((await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/runs/${receipt.runId}/advance`})).json().run.state).toBe("COMPLETE");expect(execFileSync("git",["-C",result.worktree,"rev-list","--count",`${original}..HEAD`],{encoding:"utf8"}).trim()).toBe("1");
  });
  async function policyFixture() {
    const f=await setup(),config=f.service.configuration.current().config;
    config.policies.modelRouting={enabled:true,requireConfirmation:true,classificationMode:"keyword",semanticFailureMode:"stop",taskTypes:[{id:"fix",name:"修复",definition:"修复问题",enabled:true,keywordGroups:[{any:["修复"],all:[],exclude:[]}]}],rules:[{id:"fix-local",name:"修复规则",enabled:true,taskTypeId:"fix",profileId:"codex-local",repositoryId:"repo",priority:1,target:{modelSelectionId:"catalog-model",reasoning:{mode:"native-default"}}}]};
    const plan=f.service.configuration.buildPlan(config,"owner","web");await f.service.configuration.applyPlan(plan.id,{confirmed:true});
    const draft={...f.draft,title:"修复问题",startMode:"dispatch",execution:{profileId:"codex-local",selectionMode:"policy-auto",allowUnconfirmedModelAccess:true}};
    return {...f,autoDraft:draft};
  }
  it("freezes keyword policy selection, requires routing approval and never substitutes a native effort default",async()=>{
    const f=await policyFixture(),create=vi.spyOn(f.service.workspaces,"create");
    const p=(await f.preview(f.autoDraft)).json();expect(p.canCommit).toBe(true);
    expect(p.routingDecision).toMatchObject({status:"ready",classification:{source:"keyword",taskTypeId:"fix"},ruleResult:{ruleIds:["fix-local"]},target:{modelId:"catalog-model",nativeParameters:{}},confirmation:{required:true,mode:"pending"}});
    expect(create).not.toHaveBeenCalled();expect(f.starts).toHaveLength(0);
    const again=(await f.preview(f.autoDraft)).json();expect(again.publicationId).toBe(p.publicationId);expect(again.routingDecision.id).toBe(p.routingDecision.id);
    expect((await f.commit(p)).json().code).toBe("ROUTING_CONFIRMATION_REQUIRED");
    const receipt=(await f.commit(p,"approved",f.service,{confirmation:{accepted:true,routingAccepted:true}})).json();expect(receipt.state).toBe("STARTED");
    expect(f.starts[0]).toMatchObject({model:"catalog-model"});expect(f.starts[0]?.reasoningEffort).toBeUndefined();
    expect(f.service.database.getEntity("run",receipt.runId)).toMatchObject({executionSelection:{mode:"policy-auto",source:"policy",routingDecision:{id:p.routingDecision.id,confirmation:{mode:"user-confirmed",actorId:expect.any(String)}}}});
    f.clock.now=new Date(f.clock.now.getTime()+600001);expect((await f.commit(p,"approved",f.service,{confirmation:{accepted:true,routingAccepted:true}})).json().runId).toBe(receipt.runId);expect(f.starts).toHaveLength(1);
  });
  it("blocks no-match, ambiguous rules, invalid winning models and unsupported effort without fallback",async()=>{
    const f=await policyFixture();
    let p=(await f.preview({...f.autoDraft,title:"unclassified"})).json();expect(p.canCommit).toBe(false);expect(p.routingDecision.error.code).toBe("TASK_TYPE_UNCLASSIFIED");
    for(const target of [{modelSelectionId:"missing-model",reasoning:{mode:"native-default"}},{modelSelectionId:"catalog-model",reasoning:{mode:"explicit",value:"unsupported"}}]){
      const config=f.service.configuration.current().config;config.policies.modelRouting!.rules[0]!.target=target as NonNullable<DispatcherConfig["policies"]["modelRouting"]>["rules"][number]["target"];
      config.policies.modelRouting!.rules.push({id:`fallback-${config.policies.modelRouting!.rules.length}`,name:"global fallback",enabled:true,profileId:"codex-local",taskTypeId:"fix",priority:100,target:{modelSelectionId:"catalog-model",reasoning:{mode:"native-default"}}});
      const plan=f.service.configuration.buildPlan(config,"owner","web");await f.service.configuration.applyPlan(plan.id,{confirmed:true});
      p=(await f.preview(f.autoDraft)).json();expect(p.canCommit).toBe(false);expect(p.routingDecision.ruleResult.ruleIds).toEqual(["fix-local"]);expect(p.routingDecision.target).toBeUndefined();
    }
    expect(f.starts).toHaveLength(0);expect(f.service.database.listCanonicalTasks()).toHaveLength(0);
  });
  it("rejects catalog drift at policy commit and preserves read-only applied/draft trial distinction",async()=>{
    const f=await policyFixture();const p=(await f.preview(f.autoDraft)).json();
    const read=await f.service.app.inject({headers:OWNER,url:`/api/model-routing/decisions/${p.routingDecision.id}`});expect(read.statusCode).toBe(200);
    const trial=await f.service.app.inject({headers:OWNER,method:"POST",url:"/api/model-routing/test",payload:{draft:f.autoDraft}});expect(trial.json()).toMatchObject({trial:true,source:"applied",decision:{status:"ready"}});
    f.control.modelId="different";expect((await f.commit(p,"drift",f.service,{confirmation:{accepted:true,routingAccepted:true}})).json().code).toBe("ROUTING_DECISION_STALE");expect(f.starts).toHaveLength(0);expect(f.service.database.listCanonicalTasks()).toHaveLength(0);
  });
  it("uses explicit native effort with an audited policy exemption and blocks create-only auto dispatch bypass",async()=>{
    const f=await policyFixture(),config=f.service.configuration.current().config;
    config.policies.modelRouting!.requireConfirmation=false;config.policies.modelRouting!.rules[0]!.target.reasoning={mode:"explicit",value:"low"};
    const plan=f.service.configuration.buildPlan(config,"owner","web");await f.service.configuration.applyPlan(plan.id,{confirmed:true});
    const p=(await f.preview(f.autoDraft)).json(),receipt=(await f.commit(p)).json();expect(receipt.state).toBe("STARTED");expect(f.starts[0]).toMatchObject({model:"catalog-model",reasoningEffort:"low"});
    expect(f.service.database.getEntity("run",receipt.runId)).toMatchObject({executionSelection:{routingDecision:{confirmation:{mode:"policy-exempt",actorId:"owner"}}}});
    f.control.completed=true;await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/runs/${receipt.runId}/advance`});
    const deferred=(await f.preview({...f.autoDraft,clientDraftId:"deferred-auto",startMode:"create-only"})).json();expect(deferred.routingDecision).toBeUndefined();
    const task=(await f.commit(deferred,"deferred")).json();
    const bypass=await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${task.taskId}/dispatch`,payload:{profileId:"codex-local"}});expect(bypass.json().code).toBe("ROUTING_REVIEW_REQUIRED");expect(f.starts).toHaveLength(1);
  });
  it("classifies hybrid publication once, keeps trials keyword-only by default, and invalidates superseded reanalysis reviews",async()=>{
    const f=await policyFixture(),config=f.service.configuration.current().config;
    config.policies.modelRouting!.classificationMode="hybrid";
    config.internalLlm={configured:true,endpoints:[{id:"llm",protocol:"openai-chat",baseUrl:"http://127.0.0.1:9999/v1",credentialRef:"secret://llm/classifier"}],profiles:[{id:"classifier",endpointId:"llm",alias:"Classifier",model:"classifier-model",enabled:true}],pools:[{id:"pool",profileIds:["classifier"]}],roleBindings:[{role:"task_classifier",poolId:"pool"}]};
    const plan=f.service.configuration.buildPlan(config,"owner","web");await f.service.configuration.applyPlan(plan.id,{confirmed:true});
    const trial=(await f.service.app.inject({headers:OWNER,method:"POST",url:"/api/model-routing/test",payload:{draft:f.autoDraft}})).json();expect(trial.decision.classification.source).toBe("keyword");expect(f.classificationRequests).toHaveLength(0);
    const semanticTrial=(await f.service.app.inject({headers:OWNER,method:"POST",url:"/api/model-routing/test",payload:{draft:f.autoDraft,semantic:true}})).json();expect(semanticTrial.decision.classification.source).toBe("hybrid");expect(f.classificationRequests).toHaveLength(1);
    const p=(await f.preview(f.autoDraft)).json();expect(p.canCommit).toBe(true);expect(p.routingDecision.classification).toMatchObject({source:"hybrid",analysis:{provenance:{profileId:"classifier",model:"classifier-model"}}});
    expect((await f.preview(f.autoDraft)).json().publicationId).toBe(p.publicationId);expect(f.classificationRequests).toHaveLength(1);
    await f.service.app.inject({headers:OWNER,method:"POST",url:"/api/model-routing/preview?reanalyze=true",payload:f.autoDraft});expect(f.classificationRequests).toHaveLength(2);
    const updated=(await f.preview(f.autoDraft)).json();expect(updated.publicationId).not.toBe(p.publicationId);
    expect((await f.commit(p,"old",f.service,{confirmation:{accepted:true,routingAccepted:true}})).json().code).toBe("STALE_REVIEW");
    const receipt=(await f.commit(updated,"new",f.service,{confirmation:{accepted:true,routingAccepted:true}})).json();expect(receipt.state).toBe("STARTED");expect(f.classificationRequests).toHaveLength(2);expect(f.starts).toHaveLength(1);
  });
  it("reviews and dispatches a create-only policy task through the same publication receipt without creating another task",async()=>{
    const f=await policyFixture(),created=(await f.commit((await f.preview({...f.autoDraft,startMode:"create-only"})).json())).json();
    const frozen=f.service.database.getTaskContract<JsonValue>(created.taskId) as {workspace:{baseCommit:string}};
    writeFileSync(join(f.root,"new-source-file"),"Later source commit\n");execFileSync("git",["-C",f.root,"add","."]);execFileSync("git",["-C",f.root,"commit","-m","source advanced after task creation"]);
    const current=f.service.database.getCanonicalTask(created.taskId)!;
    const preview=await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${created.taskId}/publications/preview`,payload:{expectedRevision:current.revision,execution:f.autoDraft.execution}});expect(preview.statusCode).toBe(200);const p=preview.json();expect(p).toMatchObject({canCommit:true,taskBinding:{taskId:created.taskId,taskRevision:current.revision}});expect(f.starts).toHaveLength(0);
    expect(p.effectiveExecution.repositoryBaseCommit).toBe(frozen.workspace.baseCommit);
    const receipt=(await f.commit(p,"dispatch-existing",f.service,{confirmation:{accepted:true,routingAccepted:true}})).json();expect(receipt).toMatchObject({state:"STARTED",taskId:created.taskId});expect(f.service.database.listCanonicalTasks()).toHaveLength(1);expect(f.starts).toHaveLength(1);
    expect((await f.commit(p,"dispatch-existing",f.service,{confirmation:{accepted:true,routingAccepted:true}})).json().runId).toBe(receipt.runId);expect(f.starts).toHaveLength(1);
  });
  it("rejects stale existing-task routing reviews and empty manual overrides of a policy intent",async()=>{
    const f=await policyFixture(),created=(await f.commit((await f.preview({...f.autoDraft,startMode:"create-only"})).json())).json();const current=f.service.database.getCanonicalTask(created.taskId)!;
    const bypass=await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${created.taskId}/dispatch`,payload:{execution:{profileId:"codex-local",selectionMode:"manual",selectionType:"native-default"}}});expect(bypass.json().code).toBe("MANUAL_SELECTION_REQUIRED");
    const p=(await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${created.taskId}/publications/preview`,payload:{expectedRevision:current.revision,execution:f.autoDraft.execution}})).json();
    const contract=f.service.database.getTaskContract<JsonValue>(created.taskId) as Record<string,JsonValue>;f.service.database.saveTaskContract(created.taskId,{...contract,instructions:"Changed after review"});
    expect((await f.commit(p,"changed-task",f.service,{confirmation:{accepted:true,routingAccepted:true}})).json().code).toBe("TASK_CHANGED");expect(f.starts).toHaveLength(0);expect(f.service.database.listCanonicalTasks()).toHaveLength(1);
  });
  it("validates enabled policy targets against native catalogs at ConfigPlan preview and apply",async()=>{
    const f=await policyFixture(),snapshot=f.service.configuration.current(),invalid=structuredClone(snapshot.config);invalid.policies.modelRouting!.rules[0]!.target.modelSelectionId="missing";
    const rejected=await f.service.app.inject({headers:OWNER,method:"POST",url:"/api/config/plans",payload:{baseRevision:snapshot.revision,config:invalid}});expect(rejected.json().code).toBe("ROUTING_RULE_UNAVAILABLE");expect(f.service.configuration.current().revision).toBe(snapshot.revision);
    const valid=structuredClone(snapshot.config);valid.policies.modelRouting!.requireConfirmation=false;
    const planned=await f.service.app.inject({headers:OWNER,method:"POST",url:"/api/config/plans",payload:{baseRevision:snapshot.revision,config:valid}});expect(planned.statusCode).toBe(201);
    f.control.modelId="disappeared";const applied=await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/config/plans/${planned.json().plan.id}/apply`,payload:{confirmed:true}});expect(applied.json().code).toBe("ROUTING_RULE_UNAVAILABLE");expect(f.service.configuration.current().revision).toBe(snapshot.revision);expect(f.starts).toHaveLength(0);
  });
  it("qualifies first-time policy activation when the persisted configuration has no routing block",async()=>{
    const f=await setup(),snapshot=f.service.configuration.current(),config=structuredClone(snapshot.config);
    config.policies.modelRouting={enabled:true,requireConfirmation:true,classificationMode:"keyword",semanticFailureMode:"stop",taskTypes:[{id:"fix",name:"修复",definition:"修复问题",enabled:true,keywordGroups:[]}],rules:[{id:"rule",name:"修复规则",enabled:true,taskTypeId:"fix",profileId:"codex-local",repositoryId:"repo",priority:0,target:{modelSelectionId:"catalog-model",reasoning:{mode:"native-default"}}}]};
    const planned=await f.service.app.inject({headers:OWNER,method:"POST",url:"/api/config/plans",payload:{baseRevision:snapshot.revision,config}});expect(planned.statusCode).toBe(201);
    expect((await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/config/plans/${planned.json().plan.id}/apply`,payload:{confirmed:true}})).statusCode).toBe(200);
  });
  it("requires a new ConfigPlan review for changed native capability evidence and preserves successful apply replay",async()=>{
    const f=await policyFixture(),snapshot=f.service.configuration.current(),config=structuredClone(snapshot.config);config.policies.modelRouting!.requireConfirmation=false;
    const plan=(await f.service.app.inject({headers:OWNER,method:"POST",url:"/api/config/plans",payload:{baseRevision:snapshot.revision,config}})).json().plan;
    f.control.efforts.push("high");expect((await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/config/plans/${plan.id}/apply`,payload:{confirmed:true}})).json().code).toBe("ROUTING_PLAN_STALE");
    f.control.efforts=["low","medium"];expect((await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/config/plans/${plan.id}/apply`,payload:{confirmed:true}})).statusCode).toBe(200);f.control.modelId="gone";expect((await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/config/plans/${plan.id}/apply`,payload:{confirmed:true}})).statusCode).toBe(200);
  });
  it("omits native reasoning parameters when a manual explicit model requests native defaults",async()=>{
    const f=await setup(),catalog=(await f.service.app.inject({headers:OWNER,url:"/api/agents/profiles/codex-local/models?repositoryId=repo"})).json();
    const p=(await f.preview({...f.draft,startMode:"dispatch",execution:{profileId:"codex-local",selectionMode:"manual",selectionType:"explicit-model",nativeModelId:"catalog-model",catalogRevision:catalog.revision,contextFingerprint:catalog.contextFingerprint,nativeParameters:{},allowUnconfirmedModelAccess:true}})).json();
    expect((await f.commit(p)).json().state).toBe("STARTED");expect(f.starts[0]?.reasoningEffort).toBeUndefined();
  });
  it("blocks native-default OpenCode publication when the installed account schema is incompatible", async () => {
    const f = await setup(), data = join(f.root,"native-data"); mkdirSync(data); mkdirSync(join(data,"opencode"));
    new DatabaseSync(join(data,"opencode","opencode.db")).close();
    vi.stubEnv("XDG_DATA_HOME",data);
    try {
      const config = f.service.configuration.current().config;
      config.agentProfiles = [{id:"opencode",alias:"OpenCode",provider:"opencode",runnerId:"local",settings:{executable:process.execPath}}];
      const plan = f.service.configuration.buildPlan(config,"owner","web"); await f.service.configuration.applyPlan(plan.id,{confirmed:true});
      const preview = (await f.preview({...f.draft,startMode:"dispatch",execution:{profileId:"opencode",selectionMode:"manual",selectionType:"native-default"}})).json();
      expect(preview.canCommit).toBe(false);
      expect(preview.checks).toContainEqual(expect.objectContaining({status:"blocked",code:"NATIVE_SELECTION_UNSUPPORTED"}));
      expect((await f.commit(preview)).statusCode).toBe(409); expect(f.cliStarts).toHaveLength(0); expect(f.service.database.listCanonicalTasks()).toHaveLength(0);
    } finally { vi.unstubAllEnvs(); }
  });
  it("dispatches a supported non-Codex native catalog and blocks authentication and unsupported backends", async () => {
    const f = await setup();
    const native = vi.spyOn(StructuredCliAdapter.prototype,"modelCatalog").mockImplementation(async context => ({profileId:context.profileId,runnerId:context.runnerId,providerId:"cursor",backendId:"cursor-local-cli",contextFingerprint:"native-context",revision:"native-revision",fetchedAt:"now",freshness:"native-fresh",source:"cli-query",selectionSupport:"explicit",entries:[{id:"native-choice",displayName:"Native",kind:"model",selectable:true,access:"unconfirmed",parameterOptions:{}}]}));
    try {
      const config = f.service.configuration.current().config;
      config.agentProfiles = [{id:"cursor",alias:"Cursor",provider:"cursor",runnerId:"local",settings:{model:"account-default"}}];
      const plan = f.service.configuration.buildPlan(config,"owner","web"); await f.service.configuration.applyPlan(plan.id,{confirmed:true});
      const execution = {profileId:"cursor",selectionMode:"manual",selectionType:"explicit-model",nativeModelId:"native-choice",catalogRevision:"native-revision",contextFingerprint:"native-context",allowUnconfirmedModelAccess:true};
      const p = (await f.preview({...f.draft,startMode:"dispatch",execution})).json(); expect(p.canCommit).toBe(true);
      const receipt = (await f.commit(p)).json(); expect(receipt.state).toBe("STARTED"); expect(f.cliStarts[0]?.args).toContain("native-choice"); expect(f.cliStarts[0]?.args).not.toContain("account-default");
      const result = (await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/runs/${receipt.runId}/advance`})).json(); expect(result).toMatchObject({run:{state:"COMPLETE",executionSelection:{requestedModel:"native-choice"}},task:{state:"REVIEW"}});
      for (const failure of ["auth","unsupported"]) {
        native.mockResolvedValueOnce({profileId:"cursor",runnerId:"local",providerId:"cursor",backendId:"cursor-local-cli",contextFingerprint:"native-context",revision:"unavailable",fetchedAt:"now",freshness:"unverified",source:"cli-query",selectionSupport:failure==="auth"?"native-default-only":"unsupported",entries:[],failure:{code:failure==="auth"?"NATIVE_AUTH_REQUIRED":"MODEL_CATALOG_UNSUPPORTED",message:"Native unavailable"}});
        const denied = (await f.preview({...f.draft,clientDraftId:`blocked-${failure}`,startMode:"dispatch",execution:{profileId:"cursor",selectionMode:"manual",selectionType:"native-default"}})).json(); expect(denied.canCommit).toBe(false);
      }
      expect(f.cliStarts).toHaveLength(1);
    } finally { native.mockRestore(); }
  });
  it("previews without task/worktree effects, preserves text and atomically creates once across retries and restart", async () => {
    const f=await setup(); const create=vi.spyOn(f.service.workspaces,"create");
    const [response,parallel]=await Promise.all([f.preview(),f.preview()]);expect(parallel.json().publicationId).toBe(response.json().publicationId); expect(response.statusCode).toBe(200); const p=response.json();
    expect(p).toMatchObject({state:"PREVIEW",canCommit:true,effectiveTask:{description:f.draft.description,contractState:"READY"}});
    expect(create).not.toHaveBeenCalled(); expect(f.service.database.listCanonicalTasks()).toHaveLength(0);
    const [a,b]=await Promise.all([f.commit(p),f.commit(p)]); expect(a.statusCode).toBe(200); expect(b.json().taskId).toBe(a.json().taskId);
    expect(f.service.database.listCanonicalTasks()).toHaveLength(1);
    expect(f.service.database.getTaskContract(a.json().taskId)).toMatchObject({instructions:f.draft.description,workspace:{repositoryId:"repo"},delivery:{type:"none"}});
    expect((await f.commit(p,"different-key")).json().taskId).toBe(a.json().taskId);
    expect((await f.commit(p,"key-1",f.service,{reviewHash:"different"})).statusCode).toBe(409);
    await f.service.stop(); const restored=await f.make();
    expect((await f.commit(p,"key-1",restored)).json().taskId).toBe(a.json().taskId);
    expect((await restored.app.inject({headers:OWNER,url:`/api/task-publications/${p.publicationId}`})).json().taskId).toBe(a.json().taskId);
  });
  it("requires confirmation and rejects stale dispatch reviews, invalid links, unknown commands and expanded scope", async () => {
    const f=await setup(); const p=(await f.preview({...f.draft,startMode:"dispatch",execution:{...f.draft.execution,profileId:"codex-local"}})).json();
    expect((await f.commit(p,"missing",f.service,{confirmation:{accepted:false}})).statusCode).toBe(400);
    for(const patch of [{description:123},{schemaVersion:"1"},{arbitraryShell:"touch unsafe"},{referenceLinks:["javascript:alert(1)"]},{scopePaths:["../escape"]},{verificationCommandIds:["arbitrary shell"]},{execution:{selectionMode:"manual",selectionType:"explicit-model"}}]) expect((await f.preview({...f.draft,...patch})).statusCode).toBe(400);
    writeFileSync(join(f.root,"change"),"new"); execFileSync("git",["-C",f.root,"add","."]);execFileSync("git",["-C",f.root,"commit","-m","move base"]);
    expect((await f.commit(p)).json()).toMatchObject({code:"SELECTION_CHANGED"});
    expect(f.service.database.listCanonicalTasks()).toHaveLength(0);
  });
  it("allows incomplete create-only and expires previews without creating tasks",async()=>{
    const f=await setup(); const p=(await f.preview({...f.draft,repositoryId:"",projectId:"local:inbox",acceptanceCriteria:[],scopePaths:[],verificationCommandIds:[]})).json();
    expect(p.effectiveTask.contractState).toBe("NEEDS_SPEC");expect((await f.commit(p)).json().state).toBe("TASK_CREATED");
    const expired=(await f.preview()).json();f.clock.now=new Date(f.clock.now.getTime()+600001);
    expect((await f.commit(expired,"expired")).json().code).toBe("PREVIEW_EXPIRED");
  });
  it("rejects configuration drift and unauthenticated publication reads",async()=>{
    const f=await setup();const p=(await f.preview()).json();
    expect((await f.service.app.inject({url:`/api/task-publications/${p.publicationId}`})).statusCode).toBe(401);
    const config=f.service.configuration.current().config;config.repositories[0]!.verificationCommands[0]!.args=["-e","process.exit(1)"];
    const plan=f.service.configuration.buildPlan(config,"owner","web");await f.service.configuration.applyPlan(plan.id,{confirmed:true});
    expect((await f.commit(p)).json().code).toBe("SELECTION_CHANGED");expect(f.service.database.listCanonicalTasks()).toHaveLength(0);
  });
  it("dispatches once with full instructions, frozen verification and a retained local result",async()=>{
    const f=await setup();const p=(await f.preview({...f.draft,startMode:"dispatch",execution:{selectionMode:"manual",selectionType:"native-default",profileId:"codex-local"}})).json();expect(p.canCommit).toBe(true);
    const a=(await f.commit(p)).json();expect(a).toMatchObject({state:"STARTED",taskId:expect.any(String),runId:expect.any(String)});expect(f.starts).toHaveLength(1);expect(f.starts[0]!.prompt).toContain(f.draft.description);expect(f.starts[0]!.model).toBeUndefined();
    expect((await f.commit(p)).json().runId).toBe(a.runId);expect(f.starts).toHaveLength(1);
    const config=f.service.configuration.current().config;config.repositories[0]!.verificationCommands[0]!.args=["-e","process.exit(1)"];const plan=f.service.configuration.buildPlan(config,"owner","web");await f.service.configuration.applyPlan(plan.id,{confirmed:true});
    f.control.completed=true;const completed=await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/runs/${a.runId}/advance`});expect(completed.json()).toMatchObject({run:{state:"COMPLETE",providerSessionId:"native-fixture-thread",verification:{state:"PASSED"}},task:{state:"REVIEW"}});
    const result=(await f.service.app.inject({headers:OWNER,url:`/api/runs/${a.runId}/result`})).json();expect(result.result).toMatchObject({deliveryType:"none",files:["result.txt"],worktree:expect.any(String)});expect(f.service.database.listDeliveryEvidence(a.taskId)).toHaveLength(0);
    await f.service.stop();const restored=await f.make();expect((await f.commit(p,"key-1",restored)).json().runId).toBe(a.runId);expect(restored.workspaces.get(result.result.worktree)).toBeDefined();expect(f.starts).toHaveLength(1);
  });
  it("retains the task after startup failure and never retries startup on receipt replay",async()=>{
    const f=await setup();f.control.failStart=true;const p=(await f.preview({...f.draft,startMode:"dispatch",execution:{selectionMode:"manual",selectionType:"native-default",profileId:"codex-local"}})).json();
    const a=(await f.commit(p)).json();expect(a).toMatchObject({state:"START_FAILED",taskId:expect.any(String),runId:expect.any(String)});f.control.failStart=false;expect((await f.commit(p,"another-key")).json().runId).toBe(a.runId);expect(f.starts).toHaveLength(0);
  });
  it("reconciles an interrupted STARTING receipt as unknown without spawning",async()=>{
    const f=await setup();const p=(await f.preview()).json();const a=(await f.commit(p)).json();const record=f.service.database.getEntity<JsonValue>("task-publication",p.publicationId) as unknown as {receipt:object};record.receipt={...a,state:"STARTING",runId:"unknown-run"};f.service.database.saveEntity("task-publication",p.publicationId,record as unknown as JsonValue);
    await f.service.stop();const restored=await f.make();expect((await f.commit(p,"key-1",restored)).json().state).toBe("OUTCOME_UNKNOWN");expect(f.starts).toHaveLength(0);
  });
  it("binds explicit models to fresh account/project catalogs and rejects a changed selection before commit",async()=>{
    const f=await setup();const catalog=(await f.service.app.inject({headers:OWNER,url:"/api/agents/profiles/codex-local/models?repositoryId=repo"})).json();expect(catalog).toMatchObject({freshness:"native-fresh",selectionSupport:"explicit"});
    const draft={...f.draft,startMode:"dispatch",execution:{profileId:"codex-local",selectionMode:"manual",selectionType:"explicit-model",nativeModelId:"catalog-model",catalogRevision:catalog.revision,contextFingerprint:catalog.contextFingerprint,nativeParameters:{reasoningEffort:"low"},allowUnconfirmedModelAccess:true}};
    const p=(await f.preview(draft)).json();expect(p.canCommit).toBe(true);const receipt=(await f.commit(p)).json();expect(receipt.state).toBe("STARTED");expect(f.starts[0]).toMatchObject({model:"catalog-model",reasoningEffort:"low"});expect(f.service.configuration.current().config.agentProfiles[0]!.settings!.model).toBe("profile-default");
    f.control.completed=true;await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/runs/${receipt.runId}/advance`});
    const invalid=(await f.preview({...draft,execution:{...draft.execution,nativeParameters:{arbitraryFlag:"yes"}}})).json();expect(invalid.canCommit).toBe(false);
    const unconfirmed=(await f.preview({...draft,execution:{...draft.execution,allowUnconfirmedModelAccess:false}})).json();expect(unconfirmed.canCommit).toBe(false);
    const review=(await f.preview({...draft,clientDraftId:"new-drift-draft"})).json();f.control.modelId="changed-model";expect((await f.commit(review,"changed-catalog")).json().code).toBe("SELECTION_CHANGED");expect(f.starts).toHaveLength(1);
  });
  it("blocks known missing native authentication even for native defaults",async()=>{
    const f=await setup();f.control.authenticated=false;const p=(await f.preview({...f.draft,startMode:"dispatch",execution:{profileId:"codex-local",selectionMode:"manual",selectionType:"native-default"}})).json();
    expect(p.canCommit).toBe(false);expect(p.checks).toContainEqual(expect.objectContaining({code:"NATIVE_AUTH_REQUIRED"}));expect(f.starts).toHaveLength(0);
  });
  it("marks detached active native execution unknown after restart instead of presenting it as live",async()=>{
    const f=await setup();const p=(await f.preview({...f.draft,startMode:"dispatch",execution:{profileId:"codex-local",selectionMode:"manual",selectionType:"native-default"}})).json();const a=(await f.commit(p)).json();
    await f.service.stop();const restored=await f.make();expect((await f.commit(p,"key-1",restored)).json().state).toBe("OUTCOME_UNKNOWN");expect(restored.database.getEntity("run",a.runId)).toMatchObject({state:"RUNNER_UNAVAILABLE",recoveryReason:"NATIVE_OUTCOME_UNKNOWN",resumePolicy:"manual"});expect(f.starts).toHaveLength(1);
    await restored.runBackgroundCycle();expect(f.starts).toHaveLength(1);
  });
  it("checks scope symlinks in the selected baseline worktree before native startup",async()=>{
    const f=await setup();execFileSync("git",["-C",f.root,"checkout","-b","other-baseline"]);symlinkSync(tmpdir(),join(f.root,"src"));execFileSync("git",["-C",f.root,"add","src"]);execFileSync("git",["-C",f.root,"commit","-m","symlink baseline"]);execFileSync("git",["-C",f.root,"checkout","main"]);
    const p=(await f.preview({...f.draft,baseRef:"other-baseline",scopePaths:["src"],startMode:"dispatch",execution:{profileId:"codex-local",selectionMode:"manual",selectionType:"native-default"}})).json();expect(p.canCommit).toBe(true);const a=(await f.commit(p)).json();expect(a.state).toBe("START_FAILED");expect(f.starts).toHaveLength(0);
  });
  it("preserves create-only model intent for fresh validation at later dispatch",async()=>{
    const f=await setup();const catalog=(await f.service.app.inject({headers:OWNER,url:"/api/agents/profiles/codex-local/models?repositoryId=repo"})).json();
    const p=(await f.preview({...f.draft,execution:{selectionMode:"manual",selectionType:"explicit-model",profileId:"codex-local",nativeModelId:"catalog-model",catalogRevision:catalog.revision,contextFingerprint:catalog.contextFingerprint,nativeParameters:{reasoningEffort:"low"},allowUnconfirmedModelAccess:true}})).json();const a=(await f.commit(p)).json();expect(f.starts).toHaveLength(0);
    const dispatched=await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${a.taskId}/dispatch`,payload:{profileId:"codex-local"}});expect(dispatched.statusCode).toBe(201);expect(f.starts[0]).toMatchObject({model:"catalog-model",reasoningEffort:"low"});
    expect((await f.service.app.inject({headers:OWNER,url:`/api/task-publications/${p.publicationId}`})).json().state).toBe("STARTED");
  });
  it("rejects repository overrides and newly restricted scope on a workspace-bound task",async()=>{
    const f=await setup();const p=(await f.preview()).json(),a=(await f.commit(p)).json();
    const override=await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${a.taskId}/dispatch`,payload:{profileId:"codex-local",repositoryId:"another-repository"}});expect(override.json().code).toBe("REPOSITORY_MISMATCH");expect(f.starts).toHaveLength(0);
    const config=f.service.configuration.current().config;config.repositories[0]!.scopePaths=["src"];const plan=f.service.configuration.buildPlan(config,"owner","web");await f.service.configuration.applyPlan(plan.id,{confirmed:true});
    const restricted=await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${a.taskId}/dispatch`,payload:{profileId:"codex-local"}});expect(restricted.json().code).toBe("INVALID_SCOPE");expect(f.starts).toHaveLength(0);
  });
  it("finishes from frozen repository/command metadata after configuration removes the repository",async()=>{
    const f=await setup();const p=(await f.preview({...f.draft,startMode:"dispatch",execution:{profileId:"codex-local",selectionMode:"manual",selectionType:"native-default"}})).json();const a=(await f.commit(p)).json();
    const config=f.service.configuration.current().config;config.repositories=[];const plan=f.service.configuration.buildPlan(config,"owner","web");await f.service.configuration.applyPlan(plan.id,{confirmed:true});
    f.control.completed=true;const result=(await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/runs/${a.runId}/advance`})).json();expect(result.run?.state).toBe("COMPLETE");
    await f.service.stop();const restored=await f.make();expect(restored.workspaces.get(result.run.worktree)).toBeDefined();
  });
  it("rolls back the whole task/receipt reservation on storage failure",async()=>{
    const f=await setup();const p=(await f.preview()).json();const original=f.service.database.saveTaskContract.bind(f.service.database);
    vi.spyOn(f.service.database,"saveTaskContract").mockImplementationOnce(()=>{throw new Error("injected disk failure");});
    expect((await f.commit(p)).statusCode).toBe(500);expect(f.service.database.listCanonicalTasks()).toHaveLength(0);expect(f.service.database.listEntities("operation-receipt")).toHaveLength(0);
    f.service.database.saveTaskContract=original;expect((await f.commit(p)).statusCode).toBe(200);
  });
});

it("creates a canonical task for an offline owning Runner without Controller Git or native execution",async()=>{
 const f=await setup(),config=f.service.configuration.current().config;config.runners.push({id:"offline",displayName:"Offline",mode:"remote",capacity:1,tags:[],credentialRef:"secret://runner/offline/token"});config.repositories[0]!.runnerId="offline";config.agentProfiles[0]!.runnerId="offline";f.service.configuration.applyPlan(f.service.configuration.buildPlan(config,"fixture","cli").id,{confirmed:true});const inspect=vi.spyOn(f.service.workspaces,"inspect"),create=vi.spyOn(f.service.workspaces,"create");
 const response=await f.preview(),p=response.json();expect(response.statusCode,response.body).toBe(200);expect(p).toMatchObject({canCommit:true,effectiveTask:{contractState:"READY"}});expect(p.checks).toContainEqual(expect.objectContaining({id:"workspace",status:"warning",code:"WORKSPACE_UNVERIFIED"}));const saved=await f.commit(p);expect(saved.json()).toMatchObject({state:"TASK_CREATED"});expect(f.service.database.getTaskContract(saved.json().taskId)).not.toHaveProperty("workspace.baseCommit");expect(f.service.database.listEntities("run")).toHaveLength(0);expect(inspect).not.toHaveBeenCalled();expect(create).not.toHaveBeenCalled();expect(f.starts).toHaveLength(0);
});
it("does not require device availability again when committing a create-only review",async()=>{
 const f=await setup(),p=(await f.preview()).json(),inspect=vi.spyOn(f.service.workspaces,"inspect").mockRejectedValue(new Error("device offline"));const saved=await f.commit(p);expect(saved.json()).toMatchObject({state:"TASK_CREATED"});expect(inspect).not.toHaveBeenCalled();expect(f.service.database.listEntities("run")).toHaveLength(0);
});
it("requires fresh Git qualification before dispatching a task saved without a verified baseline",async()=>{
 const f=await setup(),inspect=vi.spyOn(f.service.workspaces,"inspect").mockRejectedValue(new Error("offline")),response=await f.preview();expect(response.statusCode,response.body).toBe(200);const saved=(await f.commit(response.json())).json();expect(saved.state).toBe("TASK_CREATED");inspect.mockRestore();const current=f.service.database.getCanonicalTask(saved.taskId)!;
 const preview=await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${saved.taskId}/publications/preview`,payload:{expectedRevision:current.revision,execution:{profileId:"codex-local",selectionMode:"manual",selectionType:"native-default"}}});expect(preview.json()).toMatchObject({canCommit:true,effectiveExecution:{repositoryBaseCommit:expect.any(String)}});const qualified=preview.json(),head=qualified.effectiveExecution.repositoryBaseCommit,create=vi.spyOn(f.service.workspaces,"create"),receipt=(await f.commit(qualified,"fresh-start")).json();expect(receipt.state).toBe("STARTED");expect(create.mock.calls[0]?.[0]).toMatchObject({baseCommit:head});expect(f.service.database.getTaskContract(saved.taskId)).not.toHaveProperty("workspace.baseCommit");
});
it("preserves physical scope denials while allowing create-only availability warnings",async()=>{
 const f=await setup();symlinkSync(tmpdir(),join(f.root,"outside"));const denied=await f.preview({...f.draft,scopePaths:["outside"]});expect(denied.statusCode,denied.body).toBe(400);expect(denied.json()).toMatchObject({code:"INVALID_WORKSPACE",fieldErrors:[{path:"/scopePaths",code:"invalid"}]});expect(f.service.database.listCanonicalTasks()).toHaveLength(0);
});

it("retains the reviewed create-only baseline when its branch moves before saving",async()=>{
 const f=await setup(),p=(await f.preview()).json(),before=execFileSync("git",["-C",f.root,"rev-parse","HEAD"],{encoding:"utf8"}).trim();writeFileSync(join(f.root,"later.txt"),"later");execFileSync("git",["-C",f.root,"add","later.txt"]);execFileSync("git",["-C",f.root,"commit","-m","later"]);const saved=(await f.commit(p)).json();expect(saved.state).toBe("TASK_CREATED");expect(f.service.database.getTaskContract(saved.taskId)).toMatchObject({workspace:{baseCommit:before}});expect(f.starts).toHaveLength(0);
});

it("collects qualified standalone usage in the background with no open session UI or canonical Run",async()=>{
 const f=await setup(),workspace=await f.service.workspaces.create({repositoryId:"repo",taskId:"trial",runId:"trial-workspace",attempt:1,baseRef:"main",scopePaths:["."]}),started=await f.service.app.inject({headers:OWNER,method:"POST",url:"/api/agents/profiles/codex-local/runs",payload:{workspacePath:workspace.path,prompt:"Controlled standalone usage"}});expect(started.statusCode,started.body).toBe(201);const id=started.json().session.id;f.control.usageEvents=[{type:"usage",summary:"Known native usage",observedAt:"2026-10-16T12:00:00Z",tokens:{input:120,output:4,cachedInput:80}}];f.control.completed=true;
 await f.service.runBackgroundCycle();const result=(await f.service.app.inject({headers:OWNER,url:`/api/usage?sessionId=${id}`})).json();expect(result.observations).toHaveLength(1);expect(result.observations[0]).toMatchObject({profileId:"codex-local",sessionId:id,scope:"turn",observedAt:"2026-10-16T12:00:00Z",metrics:expect.arrayContaining([{name:"cachedInput",value:"80",unit:"tokens",includedIn:"input"}])});expect(result.observations[0]).not.toHaveProperty("runId");expect(result.observations[0]).not.toHaveProperty("generation");expect(f.service.database.listEntities("run")).toHaveLength(0);expect(f.service.database.listCanonicalTasks()).toHaveLength(0);await f.service.runBackgroundCycle();expect((await f.service.app.inject({headers:OWNER,url:`/api/usage?sessionId=${id}`})).json().observations).toHaveLength(1);expect((await f.service.app.inject({headers:OWNER,url:"/api/usage?sessionId=another"})).json().observations).toHaveLength(0);expect(f.starts).toHaveLength(1);
});
it("retries standalone usage persistence after terminal state without another native start",async()=>{
 const f=await setup(),workspace=await f.service.workspaces.create({repositoryId:"repo",taskId:"trial",runId:"trial-usage-retry",attempt:1,baseRef:"main",scopePaths:["."]}),started=(await f.service.app.inject({headers:OWNER,method:"POST",url:"/api/agents/profiles/codex-local/runs",payload:{workspacePath:workspace.path,prompt:"Controlled standalone usage"}})).json(),id=started.session.id;f.control.usageEvents=[{type:"usage",summary:"Known usage",observedAt:"2026-10-16T12:00:00Z",tokens:{input:10,output:0}}];f.control.completed=true;
 const original=f.service.database.saveEntity.bind(f.service.database);let fail=true;const save=vi.spyOn(f.service.database,"saveEntity").mockImplementation((type,...args)=>{if(type==="usage-observation"&&fail){fail=false;throw new Error("injected usage disk failure");}return original(type,...args);});
 try{await f.service.runBackgroundCycle();const first=(await f.service.app.inject({headers:OWNER,url:`/api/usage?sessionId=${id}`})).json();expect(first.observations).toHaveLength(0);expect(first.errors).toContainEqual(expect.objectContaining({sessionId:id,status:"unknown"}));expect(f.service.database.getEntity("standalone-usage-cursor",id)).toBeUndefined();await f.service.runBackgroundCycle();const recovered=(await f.service.app.inject({headers:OWNER,url:`/api/usage?sessionId=${id}`})).json();expect(recovered.observations).toHaveLength(1);expect(recovered.errors).toHaveLength(0);expect(f.starts).toHaveLength(1);}finally{save.mockRestore();}
});
it("discards cached standalone observations when their durable session authority changes during collection",async()=>{
 const f=await setup(),workspace=await f.service.workspaces.create({repositoryId:"repo",taskId:"trial",runId:"trial-usage-drift",attempt:1,baseRef:"main",scopePaths:["."]}),started=(await f.service.app.inject({headers:OWNER,method:"POST",url:"/api/agents/profiles/codex-local/runs",payload:{workspacePath:workspace.path,prompt:"Controlled standalone usage"}})).json(),id=started.session.id;f.control.usageEvents=[{type:"usage",summary:"Known usage",observedAt:"2026-10-16T12:00:00Z",tokens:{input:10,output:0}}];const adapter=f.service["agentAdapters"].get("codex-local")!,read=adapter.usageObservations!.bind(adapter),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>(),cached=vi.spyOn(adapter,"usageObservations").mockImplementation(async sessionId=>{const data=await read(sessionId);entered.resolve();await release.promise;return data;});const cycle=f.service.runBackgroundCycle();await entered.promise;const row=f.service.database.getEntity<JsonValue>("adapter-session",id) as Record<string,JsonValue>;f.service.database.saveEntity("adapter-session",id,{...row,authority:{...row.authority as Record<string,JsonValue>,fingerprint:"changed"}});release.resolve();try{await cycle;expect((await f.service.app.inject({headers:OWNER,url:`/api/usage?sessionId=${id}`})).json().observations).toHaveLength(0);expect(f.service.database.getEntity("standalone-usage-cursor",id)).toBeUndefined();}finally{cached.mockRestore();f.service.database.saveEntity("adapter-session",id,row);}
});
it("returns safe draft field locations for schema and semantic validation failures",async()=>{
 const f=await setup(),title=await f.preview({...f.draft,title:"😀".repeat(161),execution:{...f.draft.execution,nativeParameters:{privateFieldCanary:"private-value-canary"}}});expect(title.statusCode).toBe(400);expect(title.json()).toMatchObject({code:"INVALID_DRAFT",fieldErrors:[{path:"/title",code:"too-long"}]});expect(title.body).not.toContain("private-value-canary");
 const blank=await f.preview({...f.draft,description:"   "});expect(blank.json()).toMatchObject({fieldErrors:[{path:"/description",code:"required"}]});const link=await f.preview({...f.draft,referenceLinks:["javascript:bad"]});expect(link.json()).toMatchObject({fieldErrors:[{path:"/referenceLinks",code:"invalid"}]});expect(f.starts).toHaveLength(0);expect(f.service.database.listCanonicalTasks()).toHaveLength(0);
});

it("completes an inbox NEEDS_SPEC task and executes the reviewed contract under its original identity",async()=>{
  const f=await setup();
  const initial={...f.draft,repositoryId:"",projectId:"local:inbox",scopePaths:[],verificationCommandIds:[],acceptanceCriteria:[],referenceLinks:["https://example.invalid/spec"]};
  const created=(await f.commit((await f.preview(initial)).json())).json();
  const before=f.service.database.getCanonicalTask(created.taskId)!;
  expect(before.document).toMatchObject({state:"NEEDS_SPEC",projectId:"local:inbox"});
  const context=(await f.service.app.inject({headers:OWNER,url:`/api/tasks/${created.taskId}`})).json();
  expect(context.publicationDraft).toMatchObject({description:initial.description,referenceLinks:initial.referenceLinks});
  const draft={...f.draft,title:"Completed specification",description:"Execute completed specification",startMode:"dispatch",execution:{...f.draft.execution,profileId:"codex-local"}};
  const preview=await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${created.taskId}/publications/preview`,payload:{expectedRevision:before.revision,execution:draft.execution,draft}});
  expect(preview.statusCode).toBe(200);expect(preview.json()).toMatchObject({canCommit:true,effectiveTask:{contractState:"READY"},taskBinding:{taskId:created.taskId,taskRevision:before.revision}});
  expect(f.service.database.getCanonicalTask(created.taskId)).toEqual(before);expect(f.starts).toHaveLength(0);
  const receipt=(await f.commit(preview.json(),"complete-spec")).json();expect(receipt).toMatchObject({state:"STARTED",taskId:created.taskId});
  expect(f.service.database.listCanonicalTasks()).toHaveLength(1);expect(f.starts).toHaveLength(1);
  expect(f.service.database.getCanonicalTask(created.taskId)?.document).toMatchObject({title:draft.title,description:draft.description,projectId:"local:repo"});
  expect(f.service.database.getTaskContract(created.taskId)).toMatchObject({instructions:draft.description,acceptanceCriteria:["works"],verification:["check"],workspace:{repositoryId:"repo"}});
  expect((await f.commit(preview.json(),"complete-spec")).json()).toEqual(receipt);expect(f.starts).toHaveLength(1);
  f.control.completed=true;
  expect((await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/runs/${receipt.runId}/advance`})).json()).toMatchObject({run:{state:"COMPLETE",verification:{state:"PASSED"}}});
});
it("saves partial specification on the same task and restores its fields after restart",async()=>{
  const f=await setup(),initial={...f.draft,acceptanceCriteria:[]};
  const created=(await f.commit((await f.preview(initial)).json())).json(),before=f.service.database.getCanonicalTask(created.taskId)!;
  const draft={...initial,title:"Partial draft",referenceLinks:["https://example.invalid/partial"]};
  const p=(await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${created.taskId}/publications/preview`,payload:{expectedRevision:before.revision,execution:draft.execution,draft}})).json();
  expect(p).toMatchObject({canCommit:true,effectiveTask:{contractState:"NEEDS_SPEC"}});expect((await f.commit(p,"partial-spec")).json()).toMatchObject({state:"TASK_CREATED",taskId:created.taskId});
  await f.service.stop();const restarted=await f.make();const context=(await restarted.app.inject({headers:OWNER,url:`/api/tasks/${created.taskId}`})).json();
  expect(context).toMatchObject({revision:before.revision+1,document:{state:"NEEDS_SPEC",title:"Partial draft"},publicationDraft:{referenceLinks:draft.referenceLinks}});expect(restarted.database.listCanonicalTasks()).toHaveLength(1);expect(f.starts).toHaveLength(0);
});
it("rejects stale or archived specification reviews and refuses to edit a READY contract",async()=>{
  const f=await setup(),created=(await f.commit((await f.preview({...f.draft,acceptanceCriteria:[]})).json())).json();
  const current=f.service.database.getCanonicalTask(created.taskId)!;
  const payload={expectedRevision:current.revision,execution:f.draft.execution,draft:f.draft};
  const url=`/api/tasks/${created.taskId}/publications/preview`;
  const p=await f.service.app.inject({headers:OWNER,method:"POST",url,payload});expect(p.statusCode).toBe(200);
  f.service.tasks.execute({id:"concurrent-spec-edit",taskId:created.taskId,baseRevision:current.revision,actor:"operator",command:{type:"task.update",changes:{description:"Newer content"}}});
  expect((await f.commit(p.json(),"stale-spec")).json().code).toBe("TASK_CHANGED");
  expect(f.service.database.getCanonicalTask(created.taskId)?.document).toMatchObject({description:"Newer content",state:"NEEDS_SPEC"});expect(f.service.database.getTaskContract(created.taskId)).toBeUndefined();
  f.service.database.saveEntity("task-archive",created.taskId,{archivedAt:new Date().toISOString(),revision:1});
  expect((await f.service.app.inject({headers:OWNER,method:"POST",url,payload:{...payload,expectedRevision:current.revision+1}})).statusCode).toBe(409);
  const ready=(await f.commit((await f.preview({...f.draft,clientDraftId:"ready"})).json(),"ready-spec")).json();
  expect((await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${ready.taskId}/publications/preview`,payload:{...payload,expectedRevision:1}})).json().code).toBe("TASK_SPECIFICATION_LOCKED");
});
it("rolls back canonical specification and receipts when saving the compiled contract fails",async()=>{
  const f=await setup(),created=(await f.commit((await f.preview({...f.draft,acceptanceCriteria:[]})).json())).json(),before=f.service.database.getCanonicalTask(created.taskId)!;
  const p=(await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${created.taskId}/publications/preview`,payload:{expectedRevision:before.revision,execution:f.draft.execution,draft:{...f.draft,title:"Must roll back"}}})).json();
  const save=vi.spyOn(f.service.database,"saveTaskContract").mockImplementationOnce(()=>{throw new Error("Fixture contract write failed");});
  expect((await f.commit(p,"rollback-spec")).statusCode).toBe(500);save.mockRestore();
  expect(f.service.database.getCanonicalTask(created.taskId)).toEqual(before);expect(f.service.database.getTaskContract(created.taskId)).toBeUndefined();expect(f.service.database.listCanonicalTasks()).toHaveLength(1);
  expect((await f.commit(p,"rollback-spec")).json()).toMatchObject({state:"TASK_CREATED",taskId:created.taskId});expect(f.service.database.getCanonicalTask(created.taskId)?.document).toMatchObject({state:"READY",title:"Must roll back"});
});
it("requires fresh approval after saving a completed specification without dispatch",async()=>{
  const f=await setup(),created=(await f.commit((await f.preview({...f.draft,acceptanceCriteria:[]})).json())).json();
  const url=`/api/tasks/${created.taskId}/publications/preview`;
  const p=(await f.service.app.inject({headers:OWNER,method:"POST",url,payload:{expectedRevision:1,execution:f.draft.execution,draft:f.draft}})).json();
  expect((await f.commit(p,"save-complete")).json()).toMatchObject({state:"TASK_CREATED",taskId:created.taskId});expect(f.starts).toHaveLength(0);
  const ready=f.service.database.getCanonicalTask(created.taskId)!;expect(ready.document).toMatchObject({state:"READY"});
  const stale=await f.service.app.inject({headers:OWNER,method:"POST",url,payload:{expectedRevision:1,execution:{...f.draft.execution,profileId:"codex-local"}}});expect(stale.json().code).toBe("TASK_CHANGED");
  const execution={...f.draft.execution,profileId:"codex-local"};
  const reviewed=(await f.service.app.inject({headers:OWNER,method:"POST",url,payload:{expectedRevision:ready.revision,execution}})).json();expect(reviewed.canCommit).toBe(true);
  expect((await f.commit(reviewed,"dispatch-completed")).json()).toMatchObject({state:"STARTED",taskId:created.taskId});expect(f.starts).toHaveLength(1);expect(f.service.database.listCanonicalTasks()).toHaveLength(1);
});
it("returns field errors for malformed specification fields without changing the original task",async()=>{
  const f=await setup(),created=(await f.commit((await f.preview({...f.draft,acceptanceCriteria:[]})).json())).json();
  const response=await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${created.taskId}/publications/preview`,payload:{expectedRevision:1,execution:f.draft.execution,draft:{...f.draft,description:5}}});
  expect(response.statusCode).toBe(400);expect(response.json()).toMatchObject({code:"INVALID_DRAFT",fieldErrors:[{path:"/description",code:"invalid"}]});expect(f.service.database.getCanonicalTask(created.taskId)?.revision).toBe(1);expect(f.starts).toHaveLength(0);
});
it("exports applied configuration references without native settings, command arguments or URL credentials",async()=>{
 const f=await setup(),config=f.service.configuration.current().config;
 config.repositories[0]!.remote="https://user:private-pass@example.invalid/repo?token=private-query#private-fragment";
 config.connectors=[{id:"github",kind:"scm",definitionId:"scm.github",displayName:"GitHub",enabled:false,credentialRef:"secret://github/opaque-reference",settings:{apiBase:"https://github.example",custom:"private-custom-setting"}}];
 const plan=f.service.configuration.buildPlan(config,"owner","web");await f.service.configuration.applyPlan(plan.id,{confirmed:true});
 const before=f.service.configuration.current();const response=await f.service.app.inject({headers:OWNER,url:"/api/config/export"});expect(response.statusCode).toBe(200);
 const exported=response.json();expect(exported).toMatchObject({schemaVersion:1,revision:before.revision,config:{connectors:[{id:"github",credentialRef:"secret://github/opaque-reference"}],repositories:[{id:"repo",remote:"https://example.invalid/repo"}]}});
 expect(JSON.stringify(exported)).not.toMatch(/private-pass|private-query|private-fragment|private-custom-setting|process.exit/);expect(JSON.stringify(exported)).not.toContain(String(before.config.agentProfiles[0]?.settings?.codexHome));expect(exported.config.agentProfiles[0]).not.toHaveProperty("settings");expect(exported.config.repositories[0]).not.toHaveProperty("root");expect(exported.config.repositories[0].verificationCommands[0]).not.toHaveProperty("args");expect(exported.omittedPaths.length).toBeGreaterThan(0);
 expect(f.service.configuration.current()).toEqual(before);expect(f.starts).toHaveLength(0);expect((await f.service.app.inject({url:"/api/config/export"})).statusCode).toBe(401);
});

it("rejects unqualified native requirements in preflight without losing the task body or starting a provider",async()=>{
 const f=await setup();const requirement={version:1,profileId:"codex-local",mode:"native-gui",backendId:"codex-exec-json",surface:"desktop",executionLocation:"managed-worktree"};
 const draft={...f.draft,startMode:"dispatch",execution:{...f.draft.execution,profileId:"codex-local",interactionRequirement:requirement}};
 const disabled=await f.preview(draft);expect(disabled.statusCode).toBe(200);expect(disabled.json()).toMatchObject({canCommit:false,effectiveTask:{description:draft.description},checks:expect.arrayContaining([expect.objectContaining({status:"blocked",code:"NATIVE_INTERACTION_DISABLED"})])});
 const config=structuredClone(f.service.configuration.current().config);Object.assign(config,{nativeInteraction:{enabled:true}});const plan=f.service.configuration.buildPlan(config,"owner","api");f.service.configuration.applyPlan(plan.id,{confirmed:true});
 const unverified=await f.preview(draft);expect(unverified.statusCode).toBe(200);expect(unverified.json()).toMatchObject({canCommit:false,checks:expect.arrayContaining([expect.objectContaining({code:"NATIVE_CAPABILITY_UNVERIFIED"})])});
 expect((await f.commit(unverified.json())).statusCode).toBe(409);expect(f.starts).toHaveLength(0);expect(f.service.database.listCanonicalTasks()).toHaveLength(0);expect(f.service.database.listEntities("run")).toHaveLength(0);
});
it("freezes an explicit compatible requirement through preview commit Run and restart without changing the account default",async()=>{
 const f=await setup();const requirement={version:1,profileId:"codex-local",mode:"compatible",backendId:"codex-exec-json",executionLocation:"managed-worktree"};
 const draft={...f.draft,startMode:"dispatch",execution:{...f.draft.execution,profileId:"codex-local",interactionRequirement:requirement}};
 const p=await f.preview(draft);expect(p.statusCode).toBe(200);expect(p.json()).toMatchObject({canCommit:true,effectiveExecution:{interactionRequirement:requirement}});
 const receipt=await f.commit(p.json());expect(receipt.statusCode).toBe(200);const run=f.service.database.getEntity<JsonValue>("run",receipt.json().runId) as unknown as Run;expect(run.state,run.failureReason).toBe("ACTIVE");expect(run.executionSelection?.interactionRequirement).toEqual(requirement);expect(new ModelInvocationStore(f.service.database).list(run.id)).toContainEqual(expect.objectContaining({executionSelection:expect.objectContaining({interactionRequirement:requirement})}));expect(f.starts).toHaveLength(1);
 await f.service.stop();const restored=await f.make();expect((restored.database.getEntity<JsonValue>("run",run.id) as unknown as Run)?.executionSelection?.interactionRequirement).toEqual(requirement);expect(restored.configuration.current().config.agentProfiles[0]!.settings?.model).toBe("profile-default");expect(f.starts).toHaveLength(1);
});

it("creates an inbox task with compatible interaction intent without requiring execution readiness",async()=>{
 const f=await setup(),requirement={version:1,profileId:"codex-local",mode:"compatible",executionLocation:"managed-worktree"};
 const draft={...f.draft,projectId:"local:inbox",repositoryId:"",scopePaths:[],verificationCommandIds:[],acceptanceCriteria:[],execution:{...f.draft.execution,profileId:"codex-local",interactionRequirement:requirement}};
 const preview=await f.preview(draft);expect(preview.statusCode).toBe(200);expect(preview.json()).toMatchObject({canCommit:true,effectiveTask:{contractState:"NEEDS_SPEC",description:draft.description}});
 const committed=await f.commit(preview.json());expect(committed.statusCode).toBe(200);const context=await f.service.app.inject({headers:OWNER,url:`/api/tasks/${committed.json().taskId}`});expect(context.json()).toMatchObject({document:{state:"NEEDS_SPEC"},executionIntent:{execution:{interactionRequirement:requirement}}});expect(f.starts).toHaveLength(0);expect(f.service.database.listEntities("run")).toHaveLength(0);
});
