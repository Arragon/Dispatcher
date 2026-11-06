import { chmodSync,existsSync,mkdirSync,readFileSync,renameSync,writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect,it,vi } from "vitest";
import {DispatcherDatabase,InteractionStore} from "@dispatcher/persistence";
import { CopilotRpcClient } from "../../../packages/adapters/dist/copilot.js";
import type {Run,PublishDraftV1,NativeBinding} from "@dispatcher/domain";
import {fixture,registry,source,json,expectRetainedStop,cleanupFixture} from "./fixtures/copilot-runtime-service.js";
function finishRun(f:Awaited<ReturnType<typeof fixture>>,run:Run){const saved=f.service.database.getEntity("run",run.id);f.service.database.saveEntity("run",run.id,json({...saved as object,state:"FAILED",endedAt:new Date().toISOString()}));}
it("composes exact owned Copilot RPC per Run without cloud or read/control qualification", async () => {
  const f = await fixture(), a = await f.create("a"), b = await f.create("b"), adapter = registry(f.service).get("p")!;
  expect(adapter.manifest.id).toBe("copilot"); const sa = await f.start(a), sb = await f.start(b); expect((await adapter.result(sa.id)).state).toBe("COMPLETED"); await adapter.result(sb.id);
  expect(sa.nativeBinding).toEqual(new InteractionStore(f.service.database).binding(sa.id)); expect(sa.providerSessionId).not.toBe(sb.providerSessionId); expect(sa.nativeBinding?.product).toBe("copilot"); expect(f.entries.map(e => e.scope.workspacePath)).toEqual([a.worktree, b.worktree]); expect(source(f.service, sa.nativeBinding!)).toBeUndefined();
  expect(f.rows("wire").filter(row => row.method === "session.send")).toHaveLength(2); expect(f.rows("roots").every(row => JSON.stringify(row.args) === '["--headless","--no-auto-update","--stdio"]' && row.cwd === row.pwd && row.home === f.copilotHome)).toBe(true);
});
it.each(["current run", "session", "provider", "lease", "generation", "attempt", "model"])("rejects canonical %s drift before allocation", async mode => {
  const f = await fixture(), run = await f.create("a");
  if (mode === "current run") f.service.database.writeCanonicalTask(run.taskId, 1, json({ id: run.taskId, state: "RUNNING", currentRunId: "other" }), new Date().toISOString());
  if (mode === "session") run.sessionId = "wrong"; if (mode === "provider") f.service.database.saveEntity("run", run.id, json({ ...run, providerId: "devin" })); if (mode === "lease") run.leaseId = "wrong"; if (mode === "generation") run.generation++; if (mode === "attempt") run.attempt++; if (mode === "model") run.executionSelection!.requestedModel = "other";
  await expect(f.start(run)).rejects.toMatchObject({ creationOutcome: "not-created" }); expect(f.factory).not.toHaveBeenCalled(); expect(f.rows("roots")).toEqual([]);
});
it.each(["executable", "copilotHome"])("requires existing %s before applying enabled config", async field => {
  const f = await fixture(false), before = f.service.configuration.current(); f.config.agentProfiles[0]!.settings![field] = join(f.root, "missing");
  expect(() => f.apply()).toThrowError(expect.objectContaining({ code: "NATIVE_RUNTIME_SCOPE_UNSUPPORTED" })); expect(f.service.configuration.current()).toEqual(before); expect(f.factory).not.toHaveBeenCalled();
});
it("requires this Controller's embedded Runner without configuration side effects", async () => {
  const f = await fixture(false, false), before = f.service.configuration.current(); expect(() => f.apply()).toThrowError(expect.objectContaining({ code: "NATIVE_RUNTIME_SCOPE_UNSUPPORTED" })); expect(f.service.configuration.current()).toEqual(before);
});
it("rejects replacing the live embedded Runner identity", async () => {
  const f = await fixture(); f.config.runners.find(runner => runner.mode === "embedded")!.id = "other"; f.config.agentProfiles[0]!.runnerId = "other"; expect(() => f.apply()).toThrowError(expect.objectContaining({ code: "NATIVE_RUNTIME_SCOPE_UNSUPPORTED" }));
});
it("retains an unchanged Local runtime through unrelated ConfigPlan edits", async () => {
  const f = await fixture(), run = await f.create("a"), session = await f.start(run), adapter = registry(f.service).get("p")!; await adapter.result(session.id);
  f.config.agentProfiles.push({ id: "reserved", provider: "generic", alias: "Reserved", runnerId: "local", enabled: false }); f.apply(); expect(registry(f.service).get("p")).toBe(adapter); expect(f.factory).toHaveBeenCalledOnce();
});
it("requires durable local cleanup before idle profile replacement", async () => {
  const f = await fixture(), run = await f.create("a"), session = await f.start(run); await registry(f.service).get("p")!.result(session.id); finishRun(f,run); f.config.agentProfiles[0]!.alias = "Changed";
  expect(() => f.apply()).toThrowError(expect.objectContaining({ code: "NATIVE_RUNTIME_DRAIN_REQUIRED" })); expect(await f.service.disconnectNativeRuntime("p")).toMatchObject([expect.objectContaining({ backendId: "copilot-rpc", executionRefId: run.executionRef!.id, connection: "closed", ownedRoot: "exited", callbacks: "drained", backgroundTools: "unknown", nativeSessionDeleted: false })]);
  expect(new InteractionStore(f.service.database).observation(session.id)?.state).toBe("unknown"); f.apply(); expect(f.service.database.listEntities("native-runtime-local-disconnect")).toHaveLength(1);
});
it("persists exact binding and cleanup before SQLite closes", async () => {
  const f = await fixture(), run = await f.create("a"), session = await f.start(run); await registry(f.service).get("p")!.result(session.id); const pid = Number(f.rows("roots")[0]!.pid); await f.service.stop();
  const db = new DispatcherDatabase(join(f.root, "data", "dispatcher.sqlite")); try { expect(new InteractionStore(db).binding(session.id)).toEqual(session.nativeBinding); expect(db.listEntities("native-runtime-local-disconnect")).toHaveLength(1); expect(() => process.kill(pid, 0)).toThrow(); } finally { db.close(); }
});
it("retries durable cleanup persistence without closing the owned root twice", async () => {
  const f = await fixture(), run = await f.create("a"), session = await f.start(run); await registry(f.service).get("p")!.result(session.id);
  const close = vi.spyOn(f.entries[0]!.backend, "disconnectLocal"), save = f.service.database.saveEntity.bind(f.service.database); let failed = false;
  const fault = vi.spyOn(f.service.database, "saveEntity").mockImplementation((...args) => { if (args[0] === "native-runtime-local-disconnect" && !failed) { failed = true; throw Error("durable fixture failure"); } return save(...args); });
  await expect(f.service.disconnectNativeRuntime("p")).rejects.toThrow("durable fixture failure"); fault.mockRestore(); await f.service.disconnectNativeRuntime("p");
  expect(close).toHaveBeenCalledOnce(); expect(f.service.database.listEntities("native-runtime-local-disconnect")).toHaveLength(1);
});
it("requires owned cleanup before disabling every owning profile through ConfigPlan", async () => {
  const f = await fixture(); const run = await f.create("a"), session = await f.start(run); await registry(f.service).get("p")!.result(session.id);
  finishRun(f,run);for(const profile of f.config.agentProfiles)profile.enabled=false; expect(() => f.apply()).toThrowError(expect.objectContaining({ code: "NATIVE_RUNTIME_DRAIN_REQUIRED" })); await f.service.disconnectNativeRuntime("p"); f.apply();
});
it("retains storage and prevents replacement on unknown callback drain", async () => {
  const f = await fixture(), run = await f.create("a"), session = await f.start(run); await registry(f.service).get("p")!.result(session.id); const backend = f.entries[0]!.backend, close = backend.disconnectLocal.bind(backend); vi.spyOn(backend, "disconnectLocal").mockImplementation(async () => ({ ...await close(), callbacks: "unknown" }));
  await f.service.disconnectNativeRuntime("p"); finishRun(f,run); f.config.agentProfiles[0]!.alias = "Changed"; expect(() => f.apply()).toThrowError(expect.objectContaining({ code: "NATIVE_RUNTIME_DRAIN_REQUIRED" })); await expectRetainedStop(f.service,{code:"NATIVE_RUNTIME_CLEANUP_UNKNOWN"}); expect(f.service.database.listEntities("native-runtime-local-disconnect")).toHaveLength(1);
});
// Original source restart1 remains C2 readonly certificate work.
it("creates a distinct explicit Local profile through ConfigPlan without starting RPC", async () => {
  const f = await fixture(false), result = await f.service.app.inject({ method: "POST", url: "/api/agents/copilot/profiles", headers: { authorization: "Bearer owner" }, payload: { id: "p", alias: "Copilot RPC", executable: f.executable, copilotHome: f.copilotHome } });
  expect(result.statusCode).toBe(201); expect(result.json()).toMatchObject({ profile: { provider: "copilot", state: "CONFIGURED" } }); expect(f.service.configuration.current().config.agentProfiles.find(p => p.id === "p")).toMatchObject({ nativeInteraction: { backendId: "copilot-rpc", executionLocation: "managed-worktree" }, settings: { executable: f.executable, copilotHome: f.copilotHome } }); expect(f.factory).not.toHaveBeenCalled(); expect(f.rows("roots")).toEqual([]);
});
it("stores a disabled explicit profile and rejects unsupported activation without mutation", async () => {
  const f = await fixture(false, false), result = await f.service.app.inject({ method: "POST", url: "/api/agents/copilot/profiles", headers: { authorization: "Bearer owner" }, payload: { id: "p", alias: "Local", enabled: false, executable: f.executable, copilotHome: f.copilotHome } });
  expect(result.statusCode).toBe(201); expect(result.json()).toMatchObject({ profile: { state: "DISABLED" } }); const before = f.service.configuration.current();
  const enabled = await f.service.app.inject({ method: "POST", url: "/api/agents/profiles/p/enabled", headers: { authorization: "Bearer owner" }, payload: { enabled: true } });
  expect(enabled.statusCode).toBe(400); expect(f.service.configuration.current()).toEqual(before); expect(f.factory).not.toHaveBeenCalled(); expect(f.rows("roots")).toEqual([]);
});
it("rejects an unqualified installed version without a replacement producer", async () => {
  const f = await fixture(), run = await f.create("a"); writeFileSync(join(f.root, "wrong-version"), "fixture");
  await expect(f.start(run)).rejects.toMatchObject({ code: "COPILOT_RPC_VERSION_UNQUALIFIED", creationOutcome: "unknown" }); expect(f.factory).toHaveBeenCalledOnce(); expect(f.rows("roots")).toHaveLength(1); expect(f.rows("wire").some(row => ["session.create", "session.send"].includes(String(row.method)))).toBe(false);
  const runtime=f.service["copilotRuntimes"].get("p")!;await vi.waitFor(()=>expect(runtime.hasActiveOperations()).toBe(false));await expectRetainedStop(f.service,{code:"NATIVE_RUNTIME_CLEANUP_UNKNOWN"});
});
it.each([{ credentialRef: "secret://copilot/copied" }, { approveTools: true }, { cloud: true }, { args: ["--cloud"] }])("rejects unsupported Local profile options %j without persistence", async extra => {
  const f = await fixture(false), before = f.service.configuration.current(), result = await f.service.app.inject({ method: "POST", url: "/api/agents/copilot/profiles", headers: { authorization: "Bearer owner" }, payload: { id: "p", alias: "Local", executable: f.executable, copilotHome: f.copilotHome, ...extra } });
  expect(result.statusCode).toBe(400); expect(f.service.configuration.current()).toEqual(before); expect(f.factory).not.toHaveBeenCalled();
});
it("projects configured support without inventing catalog or authenticated entitlement", async () => {
  const f = await fixture(), profiles = await f.service.app.inject({ method: "GET", url: "/api/agents/profiles", headers: { authorization: "Bearer owner" } });
  expect(profiles.statusCode).toBe(200); expect(profiles.json().profiles.find((profile: { id: string }) => profile.id === "p")).toMatchObject({ adapterId:"copilot", providerId: "copilot", state: "CONFIGURED", executionSupport:"unverified",authentication:{status:"unknown"} });
  expect(f.factory).not.toHaveBeenCalled(); expect(f.rows("roots")).toEqual([]);
});
it("refuses an unconfigured generic authentication probe without a native invocation", async () => {
  const f = await fixture(), response = await f.service.app.inject({ method: "POST", url: "/api/agents/profiles/p/test", headers: { authorization: "Bearer owner" } });
  expect(response.statusCode).toBe(409); expect(response.json()).toEqual({ code: "PROFILE_UNSUPPORTED" });
  expect(f.factory).not.toHaveBeenCalled(); expect(f.rows("roots")).toEqual([]); expect(JSON.stringify(response.json())).not.toContain("authenticated");
});

it("isolates two configured Profile homes and persists their exact independent tuples", async () => {
  const f = await fixture(), otherHome = join(f.root, "other-home"); mkdirSync(otherHome);
  f.config.agentProfiles.push({ ...structuredClone(f.config.agentProfiles[0]!), id: "q", alias: "Other", settings: { executable: f.executable, copilotHome: otherHome } }); f.apply();
  const a = await f.create("a"), b = await f.create("b", "q"), sa = await f.start(a), sb = await f.start(b);
  await registry(f.service).get("p")!.result(sa.id); await registry(f.service).get("q")!.result(sb.id);
  expect(sa.nativeBinding?.profileId).toBe("p"); expect(sb.nativeBinding?.profileId).toBe("q"); expect(sa.nativeBinding?.nativeStoreRef).not.toBe(sb.nativeBinding?.nativeStoreRef);
  expect(new InteractionStore(f.service.database).binding(sb.id)).toEqual(sb.nativeBinding); expect(f.entries.map(entry => entry.scope.copilotHome)).toEqual([f.copilotHome, otherHome]);
  expect(f.rows("roots").map(row => row.home)).toEqual([f.copilotHome, otherHome]);
});

const headers={authorization:"Bearer owner"};
it("persists actual allocated binding and waiting event before native input",async()=>{
 const f=await fixture(),run=await f.create("durable"),apply=f.service["nativeInteractions"].applyNativeBindingEvent.bind(f.service["nativeInteractions"]);
 vi.spyOn(f.service["nativeInteractions"],"applyNativeBindingEvent").mockImplementation(event=>{
  const result=apply(event);if(event.turn.state==="waiting"){
   expect(result).toMatchObject({applied:true});expect(new InteractionStore(f.service.database).binding(run.sessionId)).toEqual(event.nativeBinding);
   expect(f.service.database.getEntity("adapter-session",run.sessionId)).toMatchObject({nativeBinding:event.nativeBinding});writeFileSync(join(f.root,"persisted"),"durable waiting");
  }return result;
 });
 const session=await f.start(run);expect((await registry(f.service).get("p")!.result(session.id)).state).toBe("COMPLETED");
 expect(JSON.parse(readFileSync(join(f.root,"native-input"),"utf8"))).toMatchObject({bindingPersisted:true,sessionId:session.nativeBinding!.nativeSessionId,home:f.copilotHome,cwd:run.worktree});
 expect(f.service.database.listEntities("native-binding-event").length).toBeGreaterThanOrEqual(3);
});
it.each(["canonical","configuration","control","control row","adapter workspace","lease","observer","start reservation","adapter binding","stored binding","both binding"] as const)("jointly fences %s changed by Controller fence reentry before native input",async drift=>{
 const f=await fixture(),run=await f.create("joint"),runtime=f.service["copilotRuntimes"].get("p")!,start=runtime.start.bind(runtime);
 let armed=false,changed=false,eventCount=0,changedControlState:unknown;
 vi.spyOn(runtime,"start").mockImplementation(input=>start({...input,onBinding:async binding=>{await input.onBinding!(binding);armed=true;}}));
 const owner=f.service as unknown as {fenceNativeSpawn:(runId:string,profileId?:string)=>void},fence=owner.fenceNativeSpawn.bind(owner);
 const hook=vi.spyOn(owner,"fenceNativeSpawn").mockImplementation((...args)=>{
  fence(...args);if(!armed||changed)return;changed=true;
  const store=new InteractionStore(f.service.database),saved=f.service.database.getEntity("adapter-session",run.sessionId)! as unknown as {nativeBinding:NativeBinding};
  if(drift==="canonical"){const task=f.service.database.getCanonicalTask(run.taskId)!;f.service.database.writeCanonicalTask(run.taskId,task.revision,json({...task.document as object,state:"CANCELLED"}),new Date().toISOString());}
  if(drift==="configuration"){f.config.agentProfiles.push({id:"reserved",provider:"generic",alias:"Reserved",runnerId:"local",enabled:false});f.apply();}
  if(drift==="control"){const control=store.control(run.sessionId)!;store.compareAndSwapControl({sessionId:run.sessionId,expectedEpoch:control.epoch,expectedRevision:control.revision,actorId:"fixture",event:{type:"conflict",at:new Date().toISOString()}});}
  if(drift==="control row"){f.service.database.handle.prepare("UPDATE session_controls SET state='HUMAN' WHERE session_id=?").run(run.sessionId);changedControlState=(f.service.database.handle.prepare("SELECT state FROM session_controls WHERE session_id=?").get(run.sessionId) as {state:string}).state;}
  if(drift==="adapter workspace")f.service.database.handle.prepare("UPDATE entities SET document_json=json_set(document_json,'$.workspacePath','other') WHERE kind='adapter-session' AND id=?").run(run.sessionId);
  if(drift==="lease")f.service["leaseAuthority"].revoke(run.id,run.leaseId,run.generation,"fixture",new Date().toISOString());
  if(drift==="observer")f.service.database.handle.prepare("DELETE FROM entities WHERE kind='native-observer-authority' AND id=?").run(`${run.sessionId}:${(saved as unknown as {nativeInvocationId:string}).nativeInvocationId}`);
  if(drift==="start reservation"){const command=store.command(`native-start:${run.id}`)!;store.updateCommand({id:command.id,expectedRevision:command.revision,state:"UNKNOWN",code:"fixture"});}
  const binding={...saved.nativeBinding,nativeStoreRef:"native-store:changed"};
  if(drift==="adapter binding"||drift==="both binding")f.service.database.handle.prepare("UPDATE entities SET document_json=json_set(document_json,'$.nativeBinding',json(?)) WHERE kind='adapter-session' AND id=?").run(JSON.stringify(binding),run.sessionId);
  if(drift==="stored binding"||drift==="both binding")f.service.database.handle.prepare("UPDATE native_bindings SET document_json=? WHERE session_id=?").run(JSON.stringify(binding),run.sessionId);
  eventCount=f.service.database.listEntities("native-binding-event").length;
 });
 try{await expect(f.start(run)).rejects.toMatchObject({creationOutcome:"unknown",code:"COPILOT_RPC_SCOPE_CHANGED"});expect(changed).toBe(true);if(drift==="control row")expect(changedControlState).toBe("HUMAN");expect(f.factory).toHaveBeenCalledOnce();expect(f.rows("wire").filter(row=>row.method==="session.create")).toHaveLength(1);expect(f.rows("wire").filter(row=>row.method==="session.send")).toEqual([]);expect(f.service.database.listEntities("native-binding-event")).toHaveLength(eventCount);expect(existsSync(join(f.root,"native-input"))).toBe(false);}
 finally{hook.mockRestore();await vi.waitFor(()=>expect(runtime.hasActiveOperations()).toBe(false));}
});
it.each(["executable","copilotHome"] as const)("fences physical %s replacement before producer construction",async field=>{
 const f=await fixture(),run=await f.create("physical"),path=f[field];renameSync(path,path+".old");
 if(field==="copilotHome")mkdirSync(path);else writeFileSync(path,"#!"+process.execPath+"\nprocess.exit(0)",{mode:0o755});
 await expect(f.start(run)).rejects.toMatchObject({creationOutcome:"not-created"});expect(f.factory).not.toHaveBeenCalled();expect(f.rows("roots")).toEqual([]);
});
it.each(["directory","non-executable"] as const)("preflights %s executable without changing config or registry",async kind=>{
 const f=await fixture(),before=f.service.configuration.current(),adapter=registry(f.service).get("p"),runtime=f.service["copilotRuntimes"].get("p");
 if(kind==="directory")f.config.agentProfiles[0]!.settings!.executable=f.repo;else{const path=join(f.root,"no-exec");writeFileSync(path,"fixture");chmodSync(path,0o600);f.config.agentProfiles[0]!.settings!.executable=path;}
 expect(f.apply).toThrow(expect.objectContaining({code:"NATIVE_RUNTIME_SCOPE_UNSUPPORTED"}));expect(f.service.configuration.current()).toEqual(before);expect(registry(f.service).get("p")).toBe(adapter);expect(f.service["copilotRuntimes"].get("p")).toBe(runtime);expect(f.factory).not.toHaveBeenCalled();
});
it("reserves disabled missing paths without runtime construction and protects private home",async()=>{
 const f=await fixture(false,false);f.config.agentProfiles[0]!.enabled=false;f.config.agentProfiles[0]!.settings!.executable=join(f.root,"missing-executable");f.config.agentProfiles[0]!.settings!.copilotHome=join(f.root,"missing-home");f.apply();
 expect(registry(f.service).has("p")).toBe(false);expect(f.service["copilotRuntimes"].size).toBe(0);
 f.config.repositories.push({id:"private",root:join(f.root,"missing-home"),defaultBaseRef:"main",scopePaths:[],verificationCommands:[]});f.apply();
 const result=await f.service.app.inject({url:"/api/repositories/private/context",headers});expect(result.json()).toMatchObject({git:{state:"invalid",reasonCode:"PRIVATE_PATH_SCOPE"}});expect(f.factory).not.toHaveBeenCalled();expect(f.rows("roots")).toEqual([]);
});
it("previews exact profile ConfigPlan and rejects stale revision without native work",async()=>{
 const f=await fixture(false),before=f.service.configuration.current(),payload={id:"p",alias:"Copilot",executable:f.executable,copilotHome:f.copilotHome,previewOnly:true,baseRevision:before.revision};
 const preview=await f.service.app.inject({method:"POST",url:"/api/agents/copilot/profiles",headers,payload});expect(preview.statusCode,preview.body).toBe(201);expect(preview.json().plan).toBeTruthy();expect(f.service.configuration.current()).toEqual(before);
 const stale=await f.service.app.inject({method:"POST",url:"/api/agents/copilot/profiles",headers,payload:{...payload,baseRevision:before.revision-1}});expect(stale.statusCode).toBe(409);expect(f.service.configuration.current()).toEqual(before);expect(f.factory).not.toHaveBeenCalled();
});
it.each([{model:"chosen"},{env:{TOKEN:"synthetic"}},{unknown:true}])("rejects extra profile option %j",async extra=>{
 const f=await fixture(false),before=f.service.configuration.current();const result=await f.service.app.inject({method:"POST",url:"/api/agents/copilot/profiles",headers,payload:{id:"p",alias:"Copilot",executable:f.executable,copilotHome:f.copilotHome,...extra}});expect(result.statusCode).toBe(400);expect(f.service.configuration.current()).toEqual(before);expect(f.factory).not.toHaveBeenCalled();
});
it("returns unsupported catalog and public trial/publication without Task or native allocation",async()=>{
 const f=await fixture();f.config.repositories[0]!.verificationCommands=[{id:"check",file:process.execPath,args:["-e","process.exit(0)"],required:true,timeoutMs:5000,outputLimitBytes:1024}];f.apply();
 const before=f.service.database.listCanonicalTasks().length,revision=f.service.configuration.current().revision;
 const models=await f.service.app.inject({url:"/api/agents/profiles/p/models?repositoryId=repo&configRevision="+revision,headers});expect(models.statusCode,models.body).toBe(200);expect(models.json()).toMatchObject({freshness:"unverified",selectionSupport:"unsupported",entries:[],failure:{code:"MODEL_CATALOG_UNSUPPORTED"}});
 const draft:PublishDraftV1={schemaVersion:1,clientDraftId:"copilot-trial",title:"fix fixture",description:"Read-only trial",projectId:"local:repo",repositoryId:"repo",acceptanceCriteria:["done"],scopePaths:["."],verificationCommandIds:["check"],startMode:"dispatch",execution:{profileId:"p",selectionMode:"manual",selectionType:"explicit-model",nativeModelId:"chosen",catalogRevision:models.json().revision,contextFingerprint:models.json().contextFingerprint,allowUnconfirmedModelAccess:true},delivery:{type:"none"}};
 const preview=await f.service.app.inject({method:"POST",url:"/api/task-publications/preview",headers,payload:draft});expect(preview.statusCode,preview.body).toBe(200);expect(preview.json()).toMatchObject({canCommit:false,checks:expect.arrayContaining([expect.objectContaining({id:"dispatch",status:"blocked",code:"NATIVE_SELECTION_UNSUPPORTED"})])});
 const reviewed=preview.json();const commit=await f.service.app.inject({method:"POST",url:`/api/task-publications/${reviewed.publicationId}/commit`,headers:{...headers,"idempotency-key":"copilot-unsupported"},payload:{revision:reviewed.revision,reviewHash:reviewed.confirmation.reviewHash,confirmation:{accepted:true}}});expect(commit.statusCode,commit.body).toBe(409);expect(commit.json()).toMatchObject({code:"PRECHECK_BLOCKED"});
 const workspace=await f.service.workspaces.create({repositoryId:"repo",taskId:"standalone-trial",runId:"standalone-trial",attempt:1,baseRef:"main",scopePaths:[]});f.capture();
 const nativeTrial=await f.service.app.inject({method:"POST",url:"/api/agents/profiles/p/runs",headers,payload:{workspacePath:workspace.path,prompt:"literal public trial"}});expect(nativeTrial.statusCode,nativeTrial.body).toBe(409);expect(nativeTrial.json()).toMatchObject({code:"NATIVE_SELECTION_UNSUPPORTED"});
 const policy={enabled:true,requireConfirmation:true,classificationMode:"keyword" as const,semanticFailureMode:"stop" as const,taskTypes:[{id:"fix",name:"Fix",definition:"Fix work",enabled:true,keywordGroups:[{any:["fix"],all:[],exclude:[]}]}],rules:[{id:"exact",name:"Exact",enabled:true,taskTypeId:"fix",profileId:"p",repositoryId:"repo",priority:1,target:{modelSelectionId:"chosen",reasoning:{mode:"native-default" as const}}}]};
 const trial=await f.service.app.inject({method:"POST",url:"/api/model-routing/test",headers,payload:{draft:{...draft,execution:{profileId:"p",selectionMode:"policy-auto",allowUnconfirmedModelAccess:true}},policy}});expect(trial.statusCode,trial.body).toBe(200);expect(trial.json()).toMatchObject({trial:true,decision:{status:"needs-input",error:{code:"CATALOG_UNAVAILABLE"}}});
 expect(f.service.database.listCanonicalTasks()).toHaveLength(before);expect(f.service.database.listEntities("run")).toEqual([]);expect(f.service.database.listEntities("adapter-session")).toEqual([]);expect(f.factory).not.toHaveBeenCalled();expect(f.rows("roots")).toEqual([]);
});
it("retains raw binding callback and cached unknown receipt across shutdown and profile change",async()=>{
 const f=await fixture(),run=await f.create("raw"),runtime=f.service["copilotRuntimes"].get("p")!,start=runtime.start.bind(runtime),entered=Promise.withResolvers<void>(),held=Promise.withResolvers<void>();
 vi.spyOn(runtime,"start").mockImplementation(input=>start({...input,onBinding:async binding=>{await input.onBinding!(binding);entered.resolve();await held.promise;}}));
 const admission=f.start(run).catch(error=>error);await entered.promise;finishRun(f,run);f.config.agentProfiles[0]!.alias="Changed";expect(f.apply).toThrow(expect.objectContaining({code:"ACTIVE_AGENT_PROFILE"}));
 let failure:unknown;
 try{failure=await expectRetainedStop(f.service,{code:"NATIVE_RUNTIME_CLEANUP_UNKNOWN"});expect(await admission).toMatchObject({creationOutcome:"unknown"});expect(runtime.hasActiveOperations()).toBe(true);await expect(cleanupFixture(f)).rejects.toMatchObject({message:"Release and drain retained fixture native operations before storage cleanup",cause:failure});expect(f.service.database.handle.isOpen).toBe(true);expect(f.service.database.listEntities("native-runtime-local-disconnect")).toHaveLength(1);expect(f.rows("wire").filter(row=>row.method==="session.send")).toEqual([]);}
 finally{held.resolve();await admission;await vi.waitFor(()=>expect(runtime.hasActiveOperations()).toBe(false));}
 expect(await f.service.stop().catch(error=>error)).toBe(failure);expect(runtime.hasUnclosedHosts()).toBe(true);expect(f.apply).toThrow(expect.objectContaining({code:"NATIVE_RUNTIME_DRAIN_REQUIRED"}));expect(f.factory).toHaveBeenCalledOnce();
});

it.each(["acquisition","result"] as const)("retains actual raw %s work after public shutdown until underlying settlement",async phase=>{
 const f=await fixture(),run=await f.create("raw-"+phase),runtime=f.service["copilotRuntimes"].get("p")!,held=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>();
 let restore:()=>void;
 if(phase==="acquisition"){
  const open=CopilotRpcClient.openExecution.bind(CopilotRpcClient),hook=vi.spyOn(CopilotRpcClient,"openExecution").mockImplementation(async(...args)=>{const client=await open(...args);entered.resolve();await held.promise;return client;});restore=()=>hook.mockRestore();
 }else{
  const factory=f.factory.getMockImplementation()!;f.factory.mockImplementation((...args)=>{const backend=factory(...args),start=backend.start.bind(backend);vi.spyOn(backend,"start").mockImplementation(input=>{const turn=start(input),result=turn.result.bind(turn);turn.result=async()=>{const value=await result();entered.resolve();await held.promise;return value;};return turn;});return backend;});restore=()=>{};
 }
 const outcome=f.start(run).then(async session=>registry(f.service).get("p")!.result(session.id)).catch(error=>error);
 await entered.promise;finishRun(f,run);f.config.agentProfiles[0]!.alias="Changed";expect(runtime.hasActiveOperations()).toBe(true);expect(f.apply).toThrow(expect.objectContaining({code:"ACTIVE_AGENT_PROFILE"}));
 let failure:unknown;
 try{failure=await expectRetainedStop(f.service,{code:"NATIVE_RUNTIME_CLEANUP_UNKNOWN"});expect(runtime.hasActiveOperations()).toBe(true);expect(f.service.database.handle.isOpen).toBe(true);await expect(cleanupFixture(f)).rejects.toMatchObject({message:"Release and drain retained fixture native operations before storage cleanup",cause:failure});expect(f.apply).toThrow(expect.objectContaining({code:phase==="acquisition"?"NATIVE_RUNTIME_DRAIN_REQUIRED":"ACTIVE_AGENT_PROFILE"}));}
 finally{held.resolve();restore();await outcome;await vi.waitFor(()=>expect(runtime.hasActiveOperations()).toBe(false));}
 expect(await f.service.stop().catch(error=>error)).toBe(failure);expect(f.factory).toHaveBeenCalledOnce();expect(f.rows("roots")).toHaveLength(1);
 if(phase==="acquisition")expect(f.rows("wire").filter(row=>row.method==="session.create"||row.method==="session.send")).toEqual([]);
 else expect(f.rows("wire").filter(row=>row.method==="session.send")).toHaveLength(1);
});
it("attempts both real profile roots and retains SQLite on one receipt persistence failure",async()=>{
 const f=await fixture(),otherHome=join(f.root,"other-home");mkdirSync(otherHome);f.config.agentProfiles.push({...structuredClone(f.config.agentProfiles[0]!),id:"q",alias:"Other",settings:{executable:f.executable,copilotHome:otherHome}});f.apply();
 const a=await f.create("stop-a"),b=await f.create("stop-b","q"),sa=await f.start(a),sb=await f.start(b);await registry(f.service).get("p")!.result(sa.id);await registry(f.service).get("q")!.result(sb.id);
 const original=f.service.database.saveEntity.bind(f.service.database),fault=vi.spyOn(f.service.database,"saveEntity").mockImplementation((...args)=>{if(args[0]==="native-runtime-local-disconnect"&&(args[2] as {profileId?:string}).profileId==="p")throw Error("receipt persistence failed");return original(...args);}),closed=vi.spyOn(f.service.app,"close"),closes=f.entries.map(entry=>vi.spyOn(entry.backend,"disconnectLocal"));
 try{await expectRetainedStop(f.service,{message:"receipt persistence failed"});expect(closed).toHaveBeenCalledOnce();expect(f.service.database.handle.isOpen).toBe(true);expect(f.service.database.listEntities("native-runtime-local-disconnect")).toHaveLength(1);expect(f.service.database.listEntities("native-runtime-disconnect")).toHaveLength(1);for(const row of f.rows("roots"))expect(()=>process.kill(Number(row.pid),0)).toThrow();}
 finally{fault.mockRestore();}
 await f.service.disconnectNativeRuntime("p");expect(f.service.database.listEntities("native-runtime-local-disconnect")).toHaveLength(2);for(const close of closes)expect(close).toHaveBeenCalledOnce();
});
it("denies aggregate Copilot interaction fallback without any owning registry entry",async()=>{
 const f=await fixture(),run=await f.create("source"),session=await f.start(run),adapter=registry(f.service).get("p")!;await adapter.result(session.id);
 Object.defineProperty(adapter,"interaction",{value:{capabilities:()=>{throw Error("Aggregate port borrowed");}}});registry(f.service).set("missing",adapter);
 try{expect(source(f.service,{...session.nativeBinding!,profileId:"missing"})).toBeUndefined();await f.service.disconnectNativeRuntime("p");expect(source(f.service,session.nativeBinding!)).toBeUndefined();}finally{registry(f.service).delete("missing");}
});

it("composes the default owned producer without any injected backend factory",async()=>{
 const f=await fixture(true,true,false),run=await f.create("default"),session=await f.start(run),adapter=registry(f.service).get("p")!;
 expect((await adapter.result(session.id)).state).toBe("COMPLETED");expect(new InteractionStore(f.service.database).binding(session.id)).toEqual(session.nativeBinding);expect(f.rows("roots")).toHaveLength(1);expect(f.rows("wire").filter(row=>row.method==="session.send")).toHaveLength(1);expect(f.factory).not.toHaveBeenCalled();expect(f.entries).toEqual([]);expect(source(f.service,session.nativeBinding!)).toBeUndefined();
});
