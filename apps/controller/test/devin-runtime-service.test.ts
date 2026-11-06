import { chmodSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect,it,vi } from "vitest";
import { DispatcherDatabase, InteractionStore } from "@dispatcher/persistence";
import type { PublishDraftV1, Run } from "@dispatcher/domain";
import type { AgentAdapter, CliStartInput } from "@dispatcher/adapters";
import {cleanupFixture,expectRetainedStop,fixture,fixtures,registry,source,json} from "./fixtures/devin-runtime-service.js";
async function finishRun(f:Awaited<ReturnType<typeof fixture>>,run:Run){const saved=f.service.database.getEntity("run",run.id);f.service.database.saveEntity("run",run.id,json({...saved as object,state:"FAILED",endedAt:new Date().toISOString()}));}
it("composes exact owned Local ACP per Run without cloud or read/control qualification", async () => {
  const f = await fixture(), a = await f.create("a"), b = await f.create("b"), adapter = registry(f.service).get("p")!;
  expect(adapter.manifest.id).toBe("devin-local"); const sa = await f.start(a), sb = await f.start(b); expect((await adapter.result(sa.id)).state).toBe("COMPLETED"); await adapter.result(sb.id);
  expect(sa.nativeBinding).toEqual(new InteractionStore(f.service.database).binding(sa.id)); expect(sa.providerSessionId).not.toBe(sb.providerSessionId); expect(sa.nativeBinding?.product).toBe("devin-local"); expect(f.entries.map(e => e.scope.workspacePath)).toEqual([a.worktree, b.worktree]); expect(source(f.service, sa.nativeBinding!)).toBeUndefined();
  expect(f.rows("wire").filter(row => row.method === "session/prompt")).toHaveLength(2); expect(f.rows("roots").every(row => JSON.stringify(row.args) === '["acp"]' && row.cwd === row.pwd && row.data === f.dataHome && row.config === f.configHome)).toBe(true);
});
it("reports scoped profile catalog support and refreshes exact UID without native Session allocation", async () => {
  const f = await fixture(), revision = f.service.configuration.current().revision, headers = { authorization: "Bearer owner" };
  const profiles = await f.service.app.inject({ method: "GET", url: "/api/agents/profiles", headers });
  const manifests=await f.service.app.inject({url:"/api/adapters/manifests",headers});expect(manifests.json().manifests.filter((entry:{id:string})=>["devin","devin-local"].includes(entry.id)).map((entry:{id:string})=>entry.id)).toEqual(["devin","devin-local"]);
  expect(profiles.statusCode).toBe(200); expect(profiles.json().profiles.find((p: { id: string }) => p.id === "p")).toMatchObject({ adapterId:"devin-local", providerId:"devin-local", state:"CONFIGURED", executionSupport:"unverified", authentication:{status:"unknown"} }); expect(registry(f.service).get("p")!.manifest).toMatchObject({ id: "devin-local", capabilities: { resume: false, usage: false } });
  const query = await f.service.app.inject({ method: "GET", url: "/api/agents/profiles/p/models?repositoryId=repo&configRevision=" + revision, headers });
  expect(query.statusCode).toBe(200); expect(query.json()).toMatchObject({ freshness: "native-fresh", selectionSupport:"explicit", providerId: "devin-local", backendId: "devin-local-acp", entries: [{ id: "chosen", access: "unconfirmed", billing:{mode:"unknown"} }] });
  expect(JSON.stringify(query.json())).not.toContain("cog-private-price"); expect(f.factory).not.toHaveBeenCalled(); expect(f.rows("roots")).toEqual([]); expect(f.rows("model-queries")).toMatchObject([{ args: ["models", "list", "--format", "json"], data: f.dataHome, config: f.configHome }]);
});
it("cancels and drains an active directory query before SQLite closes", async () => {
  const f = await fixture(); writeFileSync(join(f.root, "model-delay"), "fixture"); const revision = f.service.configuration.current().revision;
  const request = f.service.app.inject({ method: "GET", url: "/api/agents/profiles/p/models?repositoryId=repo&configRevision=" + revision, headers: { authorization: "Bearer owner" } }).then(result => result);
  try {
    await vi.waitFor(() => expect(f.rows("model-queries")).toHaveLength(1), { timeout: 3500 }); const pid = Number(f.rows("model-queries")[0]!.pid); await f.service.stop(); expect(() => process.kill(pid, 0)).toThrow();
    const response = await request; expect(response.statusCode).toBe(409); expect(response.json()).toMatchObject({ code: "CATALOG_CLOSED" });
    const db = new DispatcherDatabase(join(f.root, "data", "dispatcher.sqlite")); try { expect(db.listEntities("model-catalog")).toEqual([]); } finally { db.close(); }
  } finally { await request; }
});
it("keeps SQLite open when active catalog pipe cleanup remains unknown", async () => {
  const f = await fixture(); writeFileSync(join(f.root, "model-held-pipe"), "fixture"); const revision = f.service.configuration.current().revision;
  const request = f.service.app.inject({ method: "GET", url: "/api/agents/profiles/p/models?repositoryId=repo&configRevision=" + revision, headers: { authorization: "Bearer owner" } }).then(result => result); let descendant: number | undefined;
  try {
    await vi.waitFor(() => expect(existsSync(join(f.root, "model-descendant"))).toBe(true), { timeout: 3500 }); descendant = Number(readFileSync(join(f.root, "model-descendant"), "utf8"));
    await expectRetainedStop(f.service,{code:"NATIVE_RUNTIME_CLEANUP_UNKNOWN"}); const response = await request; expect(response.statusCode).toBe(409); expect(response.json()).toMatchObject({code:"CATALOG_CLOSED"});
    expect(f.service.database.getEntity("catalog-lifecycle","shutdown")).toMatchObject({state:"unknown",reasonCode:"CATALOG_CLEANUP_UNKNOWN"}); expect(() => process.kill(descendant!, 0)).not.toThrow();
  } finally { if (descendant) await vi.waitFor(() => expect(() => process.kill(descendant!, 0)).toThrow(), { timeout: 3500 }); await request; }
});
it.each(["current run", "session", "provider", "lease", "generation", "attempt", "model"])("rejects canonical %s drift before allocation", async mode => {
  const f = await fixture(), run = await f.create("a");
  if (mode === "current run") f.service.database.writeCanonicalTask(run.taskId, 1, json({ id: run.taskId, state: "RUNNING", currentRunId: "other" }), new Date().toISOString());
  if (mode === "session") run.sessionId = "wrong"; if (mode === "provider") f.service.database.saveEntity("run", run.id, json({ ...run, providerId: "devin" })); if (mode === "lease") run.leaseId = "wrong"; if (mode === "generation") run.generation++; if (mode === "attempt") run.attempt++; if (mode === "model") run.executionSelection!.requestedModel = "other";
  await expect(f.start(run)).rejects.toMatchObject(mode==="current run"?{code:"SESSION_DETACHED"}:{ creationOutcome: "not-created" }); expect(f.factory).not.toHaveBeenCalled(); expect(f.rows("roots")).toEqual([]);
});
it.each(["executable", "dataHome", "configHome"])("requires existing %s before applying enabled config", async field => {
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
  const f = await fixture(), run = await f.create("a"), session = await f.start(run); await registry(f.service).get("p")!.result(session.id); await finishRun(f,run); f.config.agentProfiles[0]!.alias = "Changed";
  expect(() => f.apply()).toThrowError(expect.objectContaining({ code: "NATIVE_RUNTIME_DRAIN_REQUIRED" })); expect(await f.service.disconnectNativeRuntime("p")).toMatchObject([expect.objectContaining({ backendId: "devin-local-acp", executionRefId: run.executionRef!.id, connection: "closed", ownedRoot: "exited", callbacks: "drained", backgroundTools: "unknown", nativeSessionDeleted: false })]);
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
it("requires owned cleanup before disabling all Local profiles through ConfigPlan", async () => {
  const f = await fixture(); const run = await f.create("a"), session = await f.start(run); await registry(f.service).get("p")!.result(session.id);
  await finishRun(f,run); for(const profile of f.config.agentProfiles)profile.enabled=false; expect(() => f.apply()).toThrowError(expect.objectContaining({ code: "NATIVE_RUNTIME_DRAIN_REQUIRED" })); await f.service.disconnectNativeRuntime("p"); f.apply();
});
it("retains storage and prevents replacement on unknown callback drain", async () => {
  const f = await fixture(), run = await f.create("a"), session = await f.start(run); await registry(f.service).get("p")!.result(session.id); const backend = f.entries[0]!.backend, close = backend.disconnectLocal.bind(backend); vi.spyOn(backend, "disconnectLocal").mockImplementation(async () => ({ ...await close(), callbacks: "unknown" }));
  await f.service.disconnectNativeRuntime("p"); await finishRun(f,run); f.config.agentProfiles[0]!.alias = "Changed"; expect(() => f.apply()).toThrowError(expect.objectContaining({ code: "NATIVE_RUNTIME_DRAIN_REQUIRED" })); await expectRetainedStop(f.service,{code:"NATIVE_RUNTIME_CLEANUP_UNKNOWN"}); expect(f.service.database.listEntities("native-runtime-local-disconnect")).toHaveLength(1);
});
// Source restart case is assigned to C2: checked-storage startup certificate.
it("creates a distinct explicit Local profile through ConfigPlan without starting ACP", async () => {
  const f = await fixture(false), result = await f.service.app.inject({ method: "POST", url: "/api/agents/devin-local/profiles", headers: { authorization: "Bearer owner" }, payload: { id: "p", alias: "Devin Local", executable: f.executable, dataHome: f.dataHome, configHome: f.configHome } });
  expect(result.statusCode).toBe(201); expect(result.json()).toMatchObject({ profile: { provider: "devin-local", state: "CONFIGURED" } }); expect(f.service.configuration.current().config.agentProfiles.find(p => p.id === "p")).toMatchObject({ nativeInteraction: { backendId: "devin-local-acp", executionLocation: "managed-worktree" }, settings: { executable: f.executable, dataHome: f.dataHome, configHome: f.configHome } }); expect(f.factory).not.toHaveBeenCalled(); expect(f.rows("roots")).toEqual([]);
});
it("stores a disabled explicit profile and rejects unsupported activation without mutation", async () => {
  const f = await fixture(false, false), result = await f.service.app.inject({ method: "POST", url: "/api/agents/devin-local/profiles", headers: { authorization: "Bearer owner" }, payload: { id: "p", alias: "Local", enabled: false, executable: f.executable, dataHome: f.dataHome, configHome: f.configHome } });
  expect(result.statusCode).toBe(201); expect(result.json()).toMatchObject({ profile: { state: "DISABLED" } }); const before = f.service.configuration.current();
  const enabled = await f.service.app.inject({ method: "POST", url: "/api/agents/profiles/p/enabled", headers: { authorization: "Bearer owner" }, payload: { enabled: true } });
  expect(enabled.statusCode).toBe(400); expect(f.service.configuration.current()).toEqual(before); expect(f.factory).not.toHaveBeenCalled(); expect(f.rows("roots")).toEqual([]);
});
it("rejects an unqualified installed version without a replacement producer", async () => {
  const f = await fixture(true,true,"9.9.9"), run = await f.create("a");
  await expect(f.start(run)).rejects.toMatchObject({ code: "DEVIN_ACP_VERSION_UNQUALIFIED", creationOutcome: "not-created" }); expect(f.factory).toHaveBeenCalledOnce(); expect(f.rows("roots")).toEqual([]);
  const runtime=f.service["devinRuntimes"].get("p")!;await vi.waitFor(()=>expect(runtime.hasActiveOperations()).toBe(false));
  expect(await f.service.disconnectNativeRuntime("p")).toMatchObject([expect.objectContaining({backendId:"devin-local-acp",executionRefId:run.executionRef!.id,connection:"unknown",ownedRoot:"unknown",callbacks:"unknown",backgroundTools:"unknown",nativeSessionDeleted:false})]);
  expect(runtime.hasUnclosedHosts()).toBe(true);expect(runtime.hasActiveOperations()).toBe(false);expect(new InteractionStore(f.service.database).binding(run.sessionId)).toBeUndefined();expect(f.rows("wire")).toEqual([]);
  await expectRetainedStop(f.service,{code:"NATIVE_RUNTIME_CLEANUP_UNKNOWN"});
});
it.each([{ credentialRef: "secret://devin-local/copied" }, { approveTools: true }, { cloud: true }, { args: ["--cloud"] }])("rejects unsupported Local profile options %j without persistence", async extra => {
  const f = await fixture(false), before = f.service.configuration.current(), result = await f.service.app.inject({ method: "POST", url: "/api/agents/devin-local/profiles", headers: { authorization: "Bearer owner" }, payload: { id: "p", alias: "Local", executable: f.executable, dataHome: f.dataHome, configHome: f.configHome, ...extra } });
  expect(result.statusCode).toBe(400); expect(f.service.configuration.current()).toEqual(before); expect(f.factory).not.toHaveBeenCalled();
});

const headers={authorization:"Bearer owner"};
function corrupt(f:Awaited<ReturnType<typeof fixture>>,kind:string,id:string,path:string,value:unknown){f.service.database.handle.prepare("UPDATE entities SET document_json=json_set(document_json,?,json(?)) WHERE kind=? AND id=?").run("$."+path,JSON.stringify(value),kind,id);}
it("rejects physical executable drift with zero producer construction",async()=>{
 const f=await fixture(),run=await f.create("drift");renameSync(f.executable,f.executable+".old");writeFileSync(f.executable,"#!"+process.execPath+"\nprocess.exit(0)",{mode:0o700});
 await expect(f.start(run)).rejects.toMatchObject({creationOutcome:"not-created"});expect(f.factory).not.toHaveBeenCalled();expect(f.rows("roots")).toEqual([]);
});
const adapterDriftFields={"adapter-session":"id","adapter-run":"runId","adapter-profile":"profileId","adapter-backend":"backendId","adapter-selection":"executionSelection.requestedModel","adapter-reference":"executionRef.pathRef"};
const canonicalDrifts=["adapter-session","adapter-run","adapter-profile","adapter-backend","adapter-selection","adapter-reference","invocation","reference","repository","branch","base","native-run","native-session","runtime-removed","adapter-replaced","association-removed","cancelled"] as const;
it.each(canonicalDrifts)("fences actual reserved canonical %s before producer construction",async drift=>{
 const f=await fixture(),run=await f.create("reserved"),runtime=f.service["devinRuntimes"].get("p")!,adapter=registry(f.service).get("p")!,start=runtime.start.bind(runtime);
 vi.spyOn(runtime,"start").mockImplementation((input:CliStartInput)=>{
  if(drift.startsWith("adapter-")&&drift!=="adapter-replaced"){const key=adapterDriftFields[drift as keyof typeof adapterDriftFields];corrupt(f,"adapter-session",run.sessionId,key,"other");}
  else if(drift==="invocation")input.nativeInput!.commandId="other";
  else if(drift==="native-run")input.nativeInput!.runId="other";
  else if(drift==="native-session")input.nativeInput!.sessionId="other";
  else if(drift==="reference")corrupt(f,"run",run.id,"executionRef.pathRef","other");
  else if(drift==="repository"||drift==="branch"||drift==="base"){const key=drift==="repository"?"repositoryId":drift==="base"?"baseRevision":"branch";corrupt(f,"run",run.id,"executionRef."+key,"other");corrupt(f,"adapter-session",run.sessionId,"executionRef."+key,"other");input.executionRef={...input.executionRef!,[key]:"other"};}
  else if(drift==="runtime-removed")f.service["devinRuntimes"].delete("p");
  else if(drift==="adapter-replaced")registry(f.service).set("p",{} as AgentAdapter);
  else if(drift==="association-removed")f.service["nativeRuntimeAdapters"].delete(runtime);
  else if(drift==="cancelled")f.service["cancelledRunIds"].add(run.id);
  return start(input);
 });
 try{await expect(f.start(run)).rejects.toMatchObject({creationOutcome:"not-created"});expect(f.factory).not.toHaveBeenCalled();expect(f.rows("roots")).toEqual([]);}
 finally{f.service["devinRuntimes"].set("p",runtime);registry(f.service).set("p",adapter);f.service["nativeRuntimeAdapters"].set(runtime,adapter);}
});
it.each(["dataHome","configHome"] as const)("keeps disabled %s private during repository selection",async field=>{
 const f=await fixture(false);f.config.agentProfiles[0]!.enabled=false;f.apply();f.config.repositories.push({id:"private",root:f[field],defaultBaseRef:"main",scopePaths:[],verificationCommands:[]});f.apply();
 const response=await f.service.app.inject({headers,url:"/api/repositories/private/context"});expect(response.json()).toMatchObject({git:{state:"invalid",reasonCode:"PRIVATE_PATH_SCOPE"}});expect(f.factory).not.toHaveBeenCalled();expect(f.rows("roots")).toEqual([]);expect(f.rows("model-queries")).toEqual([]);
});
it("reserves disabled explicit missing paths without physical reads or native work",async()=>{
 const f=await fixture(false,false);f.config.agentProfiles[0]!.enabled=false;for(const field of ["executable","dataHome","configHome"])f.config.agentProfiles[0]!.settings![field]=join(f.root,"missing-"+field);f.apply();expect(registry(f.service).has("p")).toBe(false);expect(f.service["devinRuntimes"].size).toBe(0);expect(f.factory).not.toHaveBeenCalled();
});
it.each(["directory","non-executable"] as const)("rejects %s executable before any config registry mutation",async kind=>{
 const f=await fixture(),before=f.service.configuration.current(),adapter=registry(f.service).get("p"),runtime=f.service["devinRuntimes"].get("p");
 if(kind==="directory")f.config.agentProfiles[0]!.settings!.executable=f.repo;else {const candidate=join(f.root,"not-executable");writeFileSync(candidate,"fixture");chmodSync(candidate,0o600);f.config.agentProfiles[0]!.settings!.executable=candidate;}
 expect(f.apply).toThrow(expect.objectContaining({code:"NATIVE_RUNTIME_SCOPE_UNSUPPORTED"}));expect(f.service.configuration.current()).toEqual(before);expect(registry(f.service).get("p")).toBe(adapter);expect(f.service["devinRuntimes"].get("p")).toBe(runtime);expect(f.factory).not.toHaveBeenCalled();
});
it("previews explicit Local ConfigPlan without persistence or native work and honors baseRevision",async()=>{
 const f=await fixture(false),before=f.service.configuration.current(),payload={id:"p",alias:"Local",executable:f.executable,dataHome:f.dataHome,configHome:f.configHome,previewOnly:true,baseRevision:before.revision};
 const preview=await f.service.app.inject({method:"POST",url:"/api/agents/devin-local/profiles",headers,payload});expect(preview.statusCode,preview.body).toBe(201);expect(preview.json().plan).toBeTruthy();expect(f.service.configuration.current()).toEqual(before);expect(f.factory).not.toHaveBeenCalled();
 const stale=await f.service.app.inject({method:"POST",url:"/api/agents/devin-local/profiles",headers,payload:{...payload,baseRevision:before.revision-1}});expect(stale.statusCode).toBe(409);expect(f.service.configuration.current()).toEqual(before);expect(f.rows("roots")).toEqual([]);
});
it.each([{model:"chosen"},{env:{TOKEN:"synthetic"}},{organizationId:"org"},{configDir:"/tmp/unsupported"},{unknown:true}])("rejects every extra profile option %j",async extra=>{
 const f=await fixture(false),before=f.service.configuration.current();const response=await f.service.app.inject({method:"POST",url:"/api/agents/devin-local/profiles",headers,payload:{id:"p",alias:"Local",executable:f.executable,dataHome:f.dataHome,configHome:f.configHome,...extra}});expect(response.statusCode).toBe(400);expect(f.service.configuration.current()).toEqual(before);expect(f.factory).not.toHaveBeenCalled();
});
it("uses exact native UID in the actual read-only routing trial consumer",async()=>{
 const f=await fixture();const policy={enabled:true,requireConfirmation:true,classificationMode:"keyword" as const,semanticFailureMode:"stop" as const,taskTypes:[{id:"fix",name:"Fix",definition:"Fix work",enabled:true,keywordGroups:[{any:["fix"],all:[],exclude:[]}]}],rules:[{id:"exact",name:"Exact",enabled:true,taskTypeId:"fix",profileId:"p",repositoryId:"repo",priority:1,target:{modelSelectionId:"chosen",reasoning:{mode:"native-default" as const}}}]};
 const draft:PublishDraftV1={schemaVersion:1,clientDraftId:"local-trial",title:"fix fixture",description:"Read-only selection trial",projectId:"local:repo",repositoryId:"repo",acceptanceCriteria:["done"],scopePaths:["."],verificationCommandIds:[],startMode:"dispatch",execution:{profileId:"p",selectionMode:"policy-auto",allowUnconfirmedModelAccess:true},delivery:{type:"none"}};
 const before=f.service.configuration.current(),counts=[f.service.database.listEntities("model-routing-decision").length,f.service.database.listEntities("model-routing-draft").length];
 const exact=await f.service.app.inject({method:"POST",url:"/api/model-routing/test",headers,payload:{draft,policy}});expect(exact.statusCode,exact.body).toBe(200);expect(exact.json()).toMatchObject({trial:true,source:"draft",decision:{status:"ready",target:{modelId:"chosen"}}});
 policy.rules[0]!.target.modelSelectionId="cho";const prefix=await f.service.app.inject({method:"POST",url:"/api/model-routing/test",headers,payload:{draft,policy}});expect(prefix.statusCode,prefix.body).toBe(200);expect(prefix.json().decision).toMatchObject({status:"needs-input",error:{code:"MODEL_UNAVAILABLE"}});
 expect(f.service.configuration.current()).toEqual(before);expect([f.service.database.listEntities("model-routing-decision").length,f.service.database.listEntities("model-routing-draft").length]).toEqual(counts);expect(f.factory).not.toHaveBeenCalled();expect(f.rows("roots")).toEqual([]);expect(f.rows("wire")).toEqual([]);expect(f.rows("model-queries")).toHaveLength(2);
});
it("blocks profile replacement during raw catalog work and retains its unknown cleanup fence",async()=>{
 const f=await fixture();writeFileSync(join(f.root,"model-held-pipe"),"fixture");const request=f.service.app.inject({url:"/api/agents/profiles/p/models?repositoryId=repo",headers}).then(r=>r);
 await vi.waitFor(()=>expect(existsSync(join(f.root,"model-descendant"))).toBe(true),{timeout:3500});f.config.agentProfiles[0]!.alias="Changed";expect(f.apply).toThrow(expect.objectContaining({code:"ACTIVE_AGENT_PROFILE"}));
 const response=await request;expect(response.statusCode).toBe(200);expect(response.json()).toMatchObject({freshness:"unverified"});expect(f.apply).toThrow(expect.objectContaining({code:"NATIVE_RUNTIME_DRAIN_REQUIRED"}));
 await expectRetainedStop(f.service,{code:"NATIVE_RUNTIME_CLEANUP_UNKNOWN"});
 const descendant=Number(readFileSync(join(f.root,"model-descendant"),"utf8"));await vi.waitFor(()=>expect(()=>process.kill(descendant,0)).toThrow(),{timeout:3500});
});

it("keeps the exact native runtime and Adapter across Runner label/capacity edits",async()=>{
 const f=await fixture(),runtime=f.service["devinRuntimes"].get("p"),adapter=registry(f.service).get("p");f.config.runners[0]!.capacity=8;f.config.runners[0]!.tags=["updated"];f.apply();expect(registry(f.service).get("p")).toBe(adapter);expect(f.service["devinRuntimes"].get("p")).toBe(runtime);expect(f.factory).not.toHaveBeenCalled();
});
it.each(["runtime","adapter","association","binding-duplicate"] as const)("rechecks exact %s after native binding persistence before prompt",async drift=>{
 const f=await fixture(),run=await f.create("binding"),runtime=f.service["devinRuntimes"].get("p")!,adapter=registry(f.service).get("p")!,start=runtime.start.bind(runtime);
 vi.spyOn(runtime,"start").mockImplementation(input=>start({...input,onBinding:async binding=>{
  await input.onBinding!(binding);
  if(drift==="runtime")f.service["devinRuntimes"].delete("p");
  if(drift==="adapter")registry(f.service).set("p",{} as AgentAdapter);
  if(drift==="association")f.service["nativeRuntimeAdapters"].delete(runtime);
  if(drift==="binding-duplicate"){const session=f.service.database.getEntity("adapter-session",run.sessionId)!;f.service.database.saveEntity("adapter-session","duplicate",json({...session as object,id:"duplicate"}));}
 }}));
 try{await expect(f.start(run)).rejects.toMatchObject({creationOutcome:"unknown"});expect(f.factory).toHaveBeenCalledOnce();expect(f.rows("wire").filter(row=>row.method==="session/new")).toHaveLength(1);expect(f.rows("wire").filter(row=>row.method==="session/prompt")).toEqual([]);}
 finally{f.service["devinRuntimes"].set("p",runtime);registry(f.service).set("p",adapter);f.service["nativeRuntimeAdapters"].set(runtime,adapter);}
});
it("never borrows aggregate interaction when the scoped Local registry is missing",async()=>{
 const f=await fixture(),run=await f.create("no-source"),session=await f.start(run),runtime=f.service["devinRuntimes"].get("p")!;await registry(f.service).get("p")!.result(session.id);f.service["devinRuntimes"].delete("p");Object.defineProperty(registry(f.service).get("p")!,"interaction",{value:{}});
 try{expect(source(f.service,session.nativeBinding!)).toBeUndefined();expect(f.factory).toHaveBeenCalledOnce();expect(f.rows("roots")).toHaveLength(1);}finally{f.service["devinRuntimes"].set("p",runtime);}
});
it("retains raw binding callback activity and cached unknown cleanup after public shutdown",async()=>{
 const f=await fixture(),run=await f.create("raw"),runtime=f.service["devinRuntimes"].get("p")!,start=runtime.start.bind(runtime),entered=Promise.withResolvers<void>(),held=Promise.withResolvers<void>();
 vi.spyOn(runtime,"start").mockImplementation(input=>start({...input,onBinding:async binding=>{await input.onBinding!(binding);entered.resolve();await held.promise;}}));
 const admission=f.start(run).catch(error=>error);await entered.promise;await finishRun(f,run);f.config.agentProfiles[0]!.alias="Changed";expect(f.apply).toThrow(expect.objectContaining({code:"ACTIVE_AGENT_PROFILE"}));
 let failure:unknown;
 try{failure=await expectRetainedStop(f.service,{code:"NATIVE_RUNTIME_CLEANUP_UNKNOWN"});expect(failure).toMatchObject({code:"NATIVE_RUNTIME_CLEANUP_UNKNOWN"});expect(await admission).toMatchObject({creationOutcome:"unknown"});expect(runtime.hasActiveOperations()).toBe(true);await expect(cleanupFixture(f)).rejects.toMatchObject({message:"Release and drain retained fixture native operations before storage cleanup",cause:failure});expect(f.service.database.handle.isOpen).toBe(true);expect(f.service.database.listEntities("native-runtime-local-disconnect")).toHaveLength(1);expect(f.rows("wire").filter(row=>row.method==="session/prompt")).toEqual([]);}
 finally{held.resolve();await admission;await vi.waitFor(()=>expect(runtime.hasActiveOperations()).toBe(false));}
 expect(await f.service.stop().catch(error=>error)).toBe(failure);expect(runtime.hasUnclosedHosts()).toBe(true);expect(f.apply).toThrow(expect.objectContaining({code:"NATIVE_RUNTIME_DRAIN_REQUIRED"}));expect(f.factory).toHaveBeenCalledOnce();
});
it("attempts every real runtime and closes HTTP while catalog and receipt persistence failures aggregate",async()=>{
 const f=await fixture();f.config.agentProfiles.push({...structuredClone(f.config.agentProfiles[0]!),id:"p2",alias:"Second"});f.apply();
 const a=await f.create("aggregate-a"),b=await f.create("aggregate-b","p2"),sa=await f.start(a),sb=await f.start(b);await registry(f.service).get("p")!.result(sa.id);await registry(f.service).get("p2")!.result(sb.id);
 writeFileSync(join(f.root,"model-held-pipe"),"fixture");const query=f.service.app.inject({url:"/api/agents/profiles/p/models?repositoryId=repo",headers}).then(r=>r);await vi.waitFor(()=>expect(existsSync(join(f.root,"model-descendant"))).toBe(true),{timeout:3500});
 const save=f.service.database.saveEntity.bind(f.service.database),fault=vi.spyOn(f.service.database,"saveEntity").mockImplementation((...args)=>{if(args[0]==="catalog-lifecycle")throw Error("catalog receipt failed");if(args[0]==="native-runtime-local-disconnect"&&(args[2] as {profileId?:string}).profileId==="p")throw Error("runtime receipt failed");return save(...args);});
 const closed=vi.spyOn(f.service.app,"close"),quotaClose=f.service["accountQuotas"].close.bind(f.service["accountQuotas"]),reviewClose=f.service["localResults"].close.bind(f.service["localResults"]);
 vi.spyOn(f.service["accountQuotas"],"close").mockImplementation(async()=>{await quotaClose();throw Error("quota close failed");});vi.spyOn(f.service["localResults"],"close").mockImplementation(async()=>{await reviewClose();throw Error("local review failed");});
 try{const error=await expectRetainedStop(f.service,{errors:[expect.objectContaining({message:"catalog receipt failed"}),expect.objectContaining({message:"quota close failed"}),expect.objectContaining({message:"runtime receipt failed"}),expect.objectContaining({message:"local review failed"})]});expect(error).toBeInstanceOf(AggregateError);expect((error as AggregateError).errors.map(e=>e.message)).toEqual(expect.arrayContaining(["catalog receipt failed","runtime receipt failed","quota close failed","local review failed"]));expect(closed).toHaveBeenCalledOnce();expect(f.service.database.listEntities("native-runtime-local-disconnect")).toHaveLength(1);expect(f.service.database.listEntities("native-runtime-disconnect")).toHaveLength(1);for(const row of f.rows("roots"))expect(()=>process.kill(Number(row.pid),0)).toThrow();expect((await query).statusCode).toBe(409);}
 finally{fault.mockRestore();await query;}
});

it.each(["aggregate","unknown"] as const)("propagates unexpected %s from the real fixture cleanup entrypoint",async kind=>{
 const f=await fixture(false),failure=kind==="aggregate"?new AggregateError([Error("unrelated shutdown failure")],"unexpected fixture aggregate"):Object.assign(Error("unexpected fixture cleanup uncertainty"),{code:"NATIVE_RUNTIME_CLEANUP_UNKNOWN"}),close=f.service["localResults"].close.bind(f.service["localResults"]);
 vi.spyOn(f.service["localResults"],"close").mockImplementation(async()=>{await close();throw failure;});
 try{await expect(cleanupFixture(f)).rejects.toBe(failure);expect(f.service.database.handle.isOpen).toBe(true);expect(existsSync(f.root)).toBe(true);}
 finally{disposeInjectedFixture(f);}
});

function injectedShutdownFailure(f:Awaited<ReturnType<typeof fixture>>,failure:Error){
 const close=f.service["localResults"].close.bind(f.service["localResults"]);
 vi.spyOn(f.service["localResults"],"close").mockImplementation(async()=>{await close();throw failure;});
}
function disposeInjectedFixture(f:Awaited<ReturnType<typeof fixture>>){
 const index=fixtures.findIndex(entry=>entry.service===f.service);if(index>=0)fixtures.splice(index,1);
 if(f.service.database.handle.isOpen)f.service.database.close();rmSync(f.root,{recursive:true,force:true});
}
it("rejects a different error even after this service enrolled its asserted failed stop",async()=>{
 const f=await fixture(false),failure=Object.assign(Error("asserted shutdown failure"),{code:"NATIVE_RUNTIME_CLEANUP_UNKNOWN"}),different=Object.assign(Error("different shutdown failure"),{code:"NATIVE_RUNTIME_CLEANUP_UNKNOWN"});injectedShutdownFailure(f,failure);
 await expectRetainedStop(f.service,{code:"NATIVE_RUNTIME_CLEANUP_UNKNOWN"});const stop=vi.spyOn(f.service,"stop").mockRejectedValue(different);
 try{await expect(cleanupFixture(f)).rejects.toBe(different);expect(f.service.database.handle.isOpen).toBe(true);expect(existsSync(f.root)).toBe(true);}
 finally{stop.mockRestore();await cleanupFixture(f);}
});
it("does not enroll a failed expected-stop assertion for later cleanup",async()=>{
 const f=await fixture(false),failure=Object.assign(Error("unmatched shutdown failure"),{code:"NATIVE_RUNTIME_CLEANUP_UNKNOWN"});injectedShutdownFailure(f,failure);
 try{await expect(expectRetainedStop(f.service,{code:"DIFFERENT_EXPECTATION"})).rejects.toThrow();await expect(cleanupFixture(f)).rejects.toBe(failure);expect(f.service.database.handle.isOpen).toBe(true);}
 finally{disposeInjectedFixture(f);}
});
it("does not borrow another service's enrolled error even when the error object is identical",async()=>{
 const enrolled=await fixture(false),ordinary=await fixture(false),failure=Object.assign(Error("service-specific shutdown failure"),{code:"NATIVE_RUNTIME_CLEANUP_UNKNOWN"});injectedShutdownFailure(enrolled,failure);injectedShutdownFailure(ordinary,failure);
 await expectRetainedStop(enrolled.service,{code:"NATIVE_RUNTIME_CLEANUP_UNKNOWN"});
 try{await expect(cleanupFixture(ordinary)).rejects.toBe(failure);expect(ordinary.service.database.handle.isOpen).toBe(true);}
 finally{disposeInjectedFixture(ordinary);await cleanupFixture(enrolled);}
});
