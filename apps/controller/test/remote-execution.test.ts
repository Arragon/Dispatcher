import { execFileSync } from "node:child_process";
import { chmodSync,existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { CodexAdapter } from "@dispatcher/adapters";
import { defaultDispatcherConfig, type SecretStore } from "@dispatcher/config";
import type { AccountModelCatalog, Run, Task } from "@dispatcher/domain";
import { NATIVE_EXECUTION_CAPABILITY } from "@dispatcher/protocol";
import { NativeRunnerRuntime, RemoteRunnerClient, RunnerJournal } from "@dispatcher/runner";
import { ControllerService } from "../src/service.js";
const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function setup(verificationFails = false,holdFirstReconcile = false,deliveryType:"none"|"commit"|"pull-request"="none") {
  const directory = mkdtempSync(join(tmpdir(), "remote-execution-")); cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, "repo"); execFileSync("git", ["init", "-b", "main", root], { stdio: "ignore" }); execFileSync("git", ["-C", root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "base"], { stdio: "ignore" });
  const controllerData = join(directory, "controller"), runnerData = join(directory, "runner");
  const localBackend = vi.fn(() => { throw new Error("Controller must not construct native remote execution"); });
  let clock=new Date();const now=()=>new Date(clock);
  let credential:string|undefined="fixture";
  const secrets={put:async(reference:string,value:string)=>{credential=value;return {reference,backend:"encrypted-local" as const,exists:true};},resolve:async()=>{if(!credential)throw new Error("Missing secret");return credential;},test:async()=>Boolean(credential),metadata:async()=>({exists:Boolean(credential)}),delete:async()=>{credential=undefined;}} as unknown as SecretStore;
  const remoteScm:{bare?:string;created?:Record<string,unknown>;posts:number}={posts:0};
  const connectorRequests:string[]=[];
  const restores:ReturnType<typeof vi.spyOn>[]=[];
  const makeService=async()=>{
    const instance=new ControllerService({dataDirectory:controllerData,host:"127.0.0.1",port:0,withRunner:true,ownerToken:"owner",clock:now,codexBackendFactory:localBackend,backgroundWorker:{enabled:false},secretStore:secrets,integrationFetch:async(input,init)=>{
      const url=new URL(String(input));expect(url.hostname).toBe("api.github.com");connectorRequests.push(url.pathname);
      if(url.pathname.endsWith("/pulls")){
        if(init?.method!=="POST")return new Response(JSON.stringify(remoteScm.created?[remoteScm.created]:[]));
        if(!remoteScm.bare)throw new Error("Controlled remote was not configured");remoteScm.posts++;const body=JSON.parse(String(init.body)),sha=execFileSync("git",["--git-dir",remoteScm.bare,"rev-parse",`refs/heads/${body.head}`],{encoding:"utf8"}).trim();remoteScm.created={id:17,number:1,html_url:"https://github.com/acme/repo/pull/1",state:"open",body:body.body,head:{sha,ref:body.head,repo:{full_name:"acme/repo"}},base:{ref:body.base,repo:{full_name:"acme/repo"}}};return new Response(JSON.stringify(remoteScm.created));
      }
      expect(init?.method??"GET").toBe("GET");if(url.pathname.endsWith("/status")||url.pathname.endsWith("/check-runs"))return new Response(JSON.stringify(url.pathname.endsWith("/status")?{state:"pending",total_count:0,statuses:[]}:{total_count:0,check_runs:[]}));
      return new Response(JSON.stringify(url.pathname.endsWith("/branches/main")?{name:"main",commit:{sha:"a".repeat(40)}}:{full_name:"acme/repo",archived:false,disabled:false,permissions:{push:true}}));
    }});
    restores.push(vi.spyOn(instance.workspaces,"restore"));await instance.start();cleanups.push(()=>instance.stop());return instance;
  };
  let service=await makeService();
  const repository = { id: "repo", runnerId: "remote", root, defaultBaseRef: "main", scopePaths: ["."], verificationCommands: [{ id: "check", file: process.execPath, args: ["-e", "if(require('node:fs').readFileSync('result.txt','utf8')!=='remote-ok\\n')process.exit(1)"], required: true, timeoutMs: 3000, outputLimitBytes: 1000 }] };
  if(verificationFails)repository.verificationCommands[0]!.args=["-e","process.exit(1)"];
  const config = service.configuration.current().config; config.runners.push({ id: "remote", displayName: "Remote", mode: "remote", capacity: 1, tags: [], credentialRef: "secret://runner/fixture/remote" }); config.repositories = [repository]; config.agentProfiles = [{ id: "p", alias: "P", provider: "codex", runnerId: "remote", settings: { codexHome: "/must-not-use/controller-native" } }];
  if(deliveryType==="pull-request")config.connectors=[{id:"chosen",definitionId:"scm.github",kind:"scm",displayName:"Chosen",enabled:true,credentialRef:"secret://github/chosen"}];
  service.configuration.applyPlan(service.configuration.buildPlan(config, "fixture", "cli").id, { confirmed: true });
  const starts: Array<{ workspacePath: string; codexHome: string; model?: string; reasoningEffort?: string }> = [], catalogs: string[] = [];
  const nativeConfig = structuredClone(defaultDispatcherConfig); nativeConfig.runners = [config.runners.find(r => r.id === "remote")!]; nativeConfig.repositories = [repository]; nativeConfig.agentProfiles = [{ ...config.agentProfiles[0]!, settings: { codexHome: join(runnerData, "native-account") } }];
  const catalog: AccountModelCatalog = { profileId: "p", runnerId: "remote", providerId: "codex", backendId: "codex-exec-json", contextFingerprint: "remote-context", revision: "remote-catalog", fetchedAt: new Date().toISOString(), freshness: "native-fresh", source: "native-rpc", selectionSupport: "explicit", entries: [{ id: "model", displayName: "Model", kind: "model", selectable: true, access: "account-listed", parameterOptions: { reasoningEffort: ["low"] } }] };
  const runtime = new NativeRunnerRuntime({ runnerId: "remote", dataDirectory: runnerData, monitorIntervalMs: 0, now, createAdapter: (_profile, store) => {
    const adapter = new CodexAdapter({ id: "p", alias: "P", codexHome: join(runnerData, "native-account") }, { start: input => { starts.push(input); writeFileSync(join(input.workspacePath, "result.txt"), "remote-ok\n"); return { status: () => "completed", cancel: async () => undefined, result: async () => ({ state: "completed", summary: "remote native turn completed", providerSessionId: "native-remote-session", events: [] }) }; } }, store);
    adapter.modelCatalog = async context => { catalogs.push(context.workspacePath); return structuredClone(catalog); }; return adapter;
  } }); cleanups.push(() => runtime.shutdown());
  runtime.configuration.applyPlan(runtime.configuration.buildPlan(nativeConfig, "fixture", "cli").id, { confirmed: true });
  const journal = new RunnerJournal(join(runnerData, "transport.sqlite")); cleanups.push(() => journal.close());
  const verificationGate=Promise.withResolvers<void>(),verificationEntered=Promise.withResolvers<void>();
  const gate=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>(),reconcileGate=Promise.withResolvers<void>(),reconcileEntered=Promise.withResolvers<void>(),control={holdStart:false,invalidatePrepared:false,expireAfterRenew:false,holdReconcile:holdFirstReconcile,mismatchStart:false,holdVerify:false};
  let client!:RemoteRunnerClient;
  const connect=async(bearerToken="fixture",capabilities=runtime.capabilities())=>{
    const address=service.app.server.address() as {port:number};
    const connected=new RemoteRunnerClient({url:`ws://127.0.0.1:${address.port}/runner`,bearerToken,runner:{id:"remote",displayName:"Remote",platform:process.platform as "darwin",architecture:process.arch,capacity:3,state:"ONLINE",capabilities,lastSeenAt:now().toISOString()},profileInventory:["p"],journal,onAuthorizationLost:()=>runtime.shutdown()});
    runtime.registerHandlers({register:(type,handler)=>connected.register(type,async(payload,envelope)=>{
      if(payload.type==="native.workspace_prepare"||payload.type==="run.start"){
        const run=service.database.getEntity("run",payload.runId) as unknown as Run,task=service.database.getCanonicalTask(run.taskId)?.document as unknown as Task;
        expect(run).toMatchObject({state:"STARTING",leaseId:envelope.leaseId,generation:envelope.generation});expect(task).toMatchObject({state:"QUEUED",currentRunId:run.id});
      }
      const value=await handler(payload,envelope);
      if(payload.type==="runner.reconcile"&&control.mismatchStart)for(const row of (value as {runs:Array<{startCommandHash?:string}>}).runs)row.startCommandHash="0".repeat(64);
      if(payload.type==="runner.reconcile"&&control.holdReconcile){reconcileEntered.resolve();await reconcileGate.promise;}
      if(payload.type==="native.workspace_prepare"&&control.invalidatePrepared)catalog.revision="changed-after-prepare";
      if(payload.type==="native.run_verify"&&control.holdVerify){verificationEntered.resolve();await verificationGate.promise;}
      if(payload.type==="run.start"&&control.holdStart){entered.resolve();await gate.promise;}
      if(payload.type==="lease.renew"&&control.expireAfterRenew)clock=new Date(clock.getTime()+2*60_000);
      return value;
    })});
    await connected.start();client=connected;cleanups.push(()=>connected.stop());cleanups.push(()=>{gate.resolve();reconcileGate.resolve();verificationGate.resolve();});return connected;
  };
  await connect();
  const restartController=async()=>{await client.stop();await service.stop();service=await makeService();return service;};
  const createLocal = vi.spyOn(service.workspaces, "create"), headers = { authorization: "Bearer owner" };
  const draft = { schemaVersion: 1, clientDraftId: "draft", projectId: "local:repo", repositoryId: "repo", description: "Write the result", scopePaths: ["."], acceptanceCriteria: ["result is correct"], startMode: "dispatch", execution: { profileId: "p", selectionMode: "manual", selectionType: "explicit-model", nativeModelId: "model", nativeParameters: {}, catalogRevision: catalog.revision, contextFingerprint: catalog.contextFingerprint }, delivery: { type: deliveryType,...(deliveryType==="pull-request"?{scmConnectorId:"chosen",targetRepository:"acme/repo",baseBranch:"main"}:{}) } };
  const preview = async (clientDraftId="draft") => (await service.app.inject({ method: "POST", url: "/api/task-publications/preview", headers, payload: {...draft,clientDraftId} })).json();
  const commit = (p: { publicationId: string; revision: number; confirmation: { reviewHash: string } }) => service.app.inject({ method: "POST", url: `/api/task-publications/${p.publicationId}/commit`, headers: { ...headers, "idempotency-key": "remote-publication" }, payload: { revision: p.revision, reviewHash: p.confirmation.reviewHash, confirmation: { accepted: true } } });
  return {get service(){return service;},runtime,get client(){return client;},root,runnerData,controllerData,starts,catalogs,localBackend,createLocal,headers,preview,commit,gate,entered,control,connect,restartController,restores,now,remoteScm,connectorRequests,reconcileGate,reconcileEntered,verificationGate,verificationEntered,advanceClock:(ms:number)=>{clock=new Date(clock.getTime()+ms);}};
}
it("reads remote registered repository context and references without touching Controller Git or native execution",async()=>{
 const f=await setup();execFileSync("git",["-C",f.root,"branch","feature/remote-read"]);
 const local=vi.spyOn(f.service.workspaces,"refs").mockRejectedValue(new Error("Controller must not inspect remote files"));
 const context=await f.service.app.inject({headers:f.headers,url:"/api/repositories/repo/context"});expect(context.statusCode).toBe(200);expect(context.json()).toMatchObject({runnerId:"remote",git:{state:"valid"}});
 const refs=await f.service.app.inject({headers:f.headers,url:"/api/repositories/repo/refs?offset=0&limit=1"});expect(refs.statusCode,refs.body).toBe(200);expect(refs.json()).toMatchObject({nextOffset:1,refs:[{name:"refs/heads/feature/remote-read"}]});
 expect(local).not.toHaveBeenCalled();expect(f.starts).toHaveLength(0);expect(f.createLocal).not.toHaveBeenCalled();expect(existsSync(join(f.controllerData,"worktrees"))).toBe(false);
});
it("reserves canonical authority before owning-Runner worktree creation and completes remote verification/result delivery", async () => {
  const f = await setup(), p = await f.preview(); expect(p.canCommit).toBe(true); expect(f.starts).toHaveLength(0); expect(existsSync(join(f.runnerData, "worktrees"))).toBe(false);
  const receipt = (await f.commit(p)).json(); expect(receipt).toMatchObject({ state: "STARTED" }); expect(f.starts).toHaveLength(1);
  expect((await f.preview("next-draft")).canCommit).toBe(false);
  const worktree = f.starts[0]!.workspacePath; expect(worktree.startsWith(join(realpathSync(f.runnerData), "worktrees"))).toBe(true); expect(f.starts[0]).toMatchObject({ model: "model", codexHome: join(f.runnerData, "native-account") }); expect(f.starts[0]).not.toHaveProperty("reasoningEffort");
  expect(f.catalogs).toContain(worktree); expect(f.createLocal).not.toHaveBeenCalled(); expect(f.localBackend).not.toHaveBeenCalled(); expect(existsSync(join(f.controllerData, "worktrees"))).toBe(false); expect(existsSync(join(f.root, "result.txt"))).toBe(false);
  const advanced = await f.service.app.inject({ method: "POST", url: `/api/runs/${receipt.runId}/advance`, headers: f.headers });
  expect(advanced.json()).toMatchObject({ run: { state: "COMPLETE", runnerId: "remote", providerSessionId: "native-remote-session", verification: { state: "PASSED" } }, task: { state: "REVIEW" } });
  expect(f.service.database.getEntity("run-result", receipt.runId)).toMatchObject({ files: ["result.txt"], worktree, runnerId: "remote" }); expect(readFileSync(join(worktree, "result.txt"), "utf8")).toBe("remote-ok\n");
  expect(f.runtime.database.getEntity("native-operation",`native-verify:${receipt.runId}:1`)).toMatchObject({state:"COMPLETE",result:[{commandId:"check",status:"passed"}]});
  expect(f.runtime.database.getEntity("native-execution",receipt.runId)).toMatchObject({settledAt:expect.any(String)});
  expect((await f.commit(p)).json()).toEqual(receipt); expect(f.starts).toHaveLength(1);
});
it("keeps a dropped native start response unknown and replays its publication receipt without starting again", async () => {
  const f = await setup(), p = await f.preview(); expect(p.canCommit).toBe(true); f.control.holdStart = true;
  const pending = f.commit(p); await f.entered.promise; const stopping = f.client.stop();
  const receipt = (await pending).json(); expect(receipt).toMatchObject({ state: "OUTCOME_UNKNOWN" }); expect(f.starts).toHaveLength(1);
  expect(f.service.database.getEntity("run", receipt.runId)).toMatchObject({ state: "RUNNER_UNAVAILABLE", recoveryReason: "NATIVE_OUTCOME_UNKNOWN" });
  expect((await f.commit(p)).json()).toEqual(receipt); expect(f.starts).toHaveLength(1); f.gate.resolve(); await stopping;
});
it("revokes a prepared workspace lease when its fresh native catalog invalidates startup",async()=>{
  const f=await setup(),p=await f.preview();expect(p.canCommit).toBe(true);f.control.invalidatePrepared=true;
  const receipt=(await f.commit(p)).json();expect(receipt).toMatchObject({state:"START_FAILED"});expect(f.starts).toHaveLength(0);
  expect(f.runtime.database.getEntity("native-execution",receipt.runId)).toMatchObject({state:"CANCELLED",settledAt:expect.any(String),lease:{revokedAt:expect.any(String)}});
  expect(f.createLocal).not.toHaveBeenCalled();
});
it("retains failed remote verification evidence and releases the settled native capacity",async()=>{
  const f=await setup(true),p=await f.preview(),receipt=(await f.commit(p)).json();expect(receipt).toMatchObject({state:"STARTED"});
  const result=await f.service.app.inject({method:"POST",url:`/api/runs/${receipt.runId}/advance`,headers:f.headers});
  expect(result.json()).toMatchObject({run:{state:"FAILED",verification:{state:"FAILED"}},task:{state:"FAILED"}});
  expect(f.runtime.database.getEntity("native-execution",receipt.runId)).toMatchObject({settledAt:expect.any(String)});
});

it("reattaches the owning Runner after Controller restart without a second native start or local path restoration",async()=>{
  const f=await setup(),p=await f.preview(),receipt=(await f.commit(p)).json();expect(receipt.state).toBe("STARTED");
  await f.restartController();expect(f.service.runners.list().find(runner=>runner.id==="remote")?.state).toBe("OFFLINE");
  await f.connect();await vi.waitFor(()=>expect(f.service.database.getEntity("run",receipt.runId)).toMatchObject({state:"ACTIVE"}));
  const restored=(await f.service.app.inject({url:`/api/task-publications/${p.publicationId}`,headers:f.headers})).json();expect(restored).toMatchObject({state:"STARTED",runId:receipt.runId});
  const advanced=await f.service.app.inject({method:"POST",url:`/api/runs/${receipt.runId}/advance`,headers:f.headers});expect(advanced.json()).toMatchObject({run:{state:"COMPLETE"},task:{state:"REVIEW"}});
  expect(f.starts).toHaveLength(1);for(const restoredLocally of f.restores)expect(restoredLocally).not.toHaveBeenCalled();expect(f.localBackend).not.toHaveBeenCalled();
});

it("reconciles a lost startup response using its original command identity without executing again",async()=>{
  const f=await setup(),p=await f.preview();f.control.holdStart=true;
  const pending=f.commit(p);await f.entered.promise;const stopping=f.client.stop();const receipt=(await pending).json();expect(receipt.state).toBe("OUTCOME_UNKNOWN");f.gate.resolve();await stopping;
  await f.connect();await vi.waitFor(()=>expect(f.service.database.getEntity("run",receipt.runId)).toMatchObject({state:"ACTIVE"}));expect(f.starts).toHaveLength(1);
  expect((await f.commit(p)).json()).toMatchObject({state:"STARTED",runId:receipt.runId});
});

it("renews matching remote leases through Runner acknowledgement before persisting Controller authority",async()=>{
  const f=await setup(),p=await f.preview(),receipt=(await f.commit(p)).json();
  const before=f.service.database.getEntity("run",receipt.runId) as unknown as Run;f.advanceClock(14*60_000);
  await f.client.sendEvent({type:"runner.heartbeat",runnerId:"remote",state:"ONLINE"});
  await vi.waitFor(()=>expect(Date.parse((f.service.database.getEntity("run",receipt.runId) as unknown as Run).leaseExpiresAt!)).toBeGreaterThan(Date.parse(before.leaseExpiresAt!)));
  const after=f.service.database.getEntity("run",receipt.runId) as unknown as Run;
  expect(f.runtime.database.getEntity("native-execution",receipt.runId)).toMatchObject({lease:{leaseId:after.leaseId,generation:after.generation,expiresAt:after.leaseExpiresAt}});expect(f.starts).toHaveLength(1);
});

it("revokes remote authority when canonical expiry passes while renewal acknowledgement is in flight",async()=>{
  const f=await setup(),p=await f.preview(),receipt=(await f.commit(p)).json(),before=f.service.database.getEntity("run",receipt.runId) as unknown as Run;
  f.control.expireAfterRenew=true;f.advanceClock(14*60_000);await f.client.sendEvent({type:"runner.heartbeat",runnerId:"remote",state:"ONLINE"});
  await vi.waitFor(()=>expect(f.runtime.database.getEntity("native-execution",receipt.runId)).toMatchObject({lease:{revokedAt:expect.any(String)}}));
  expect(f.service.database.getEntity("run",receipt.runId)).toMatchObject({leaseExpiresAt:before.leaseExpiresAt,state:"RUNNER_UNAVAILABLE"});expect(f.starts).toHaveLength(1);
});

it("does not mark a newly started Run missing from an older in-flight reconciliation snapshot",async()=>{
  const f=await setup(false,true);await f.reconcileEntered.promise;
  const p=await f.preview(),receipt=(await f.commit(p)).json();expect(receipt.state).toBe("STARTED");
  f.control.holdReconcile=false;f.reconcileGate.resolve();await f.client.sendEvent({type:"runner.heartbeat",runnerId:"remote",state:"ONLINE"});
  await vi.waitFor(()=>expect(f.service.database.getEntity("remote-reconciliation",receipt.runId)).toMatchObject({action:"KEEP"}));
  expect(f.service.database.getEntity("run",receipt.runId)).toMatchObject({state:"ACTIVE"});expect(f.starts).toHaveLength(1);
});

it("leaves a mismatched native start fingerprint unavailable instead of reattaching it",async()=>{
  const f=await setup(),p=await f.preview(),receipt=(await f.commit(p)).json();await f.client.stop();f.control.mismatchStart=true;await f.connect();
  await vi.waitFor(()=>expect(f.service.database.getEntity("run",receipt.runId)).toMatchObject({state:"RUNNER_UNAVAILABLE",recoveryReason:"NATIVE_OUTCOME_UNKNOWN"}));expect(f.starts).toHaveLength(1);
});

it("cancels an unknown remote startup using its lease even when no Controller session id was received",async()=>{
  const f=await setup(),p=await f.preview();f.control.holdStart=true;const pending=f.commit(p);await f.entered.promise;const stopping=f.client.stop();const receipt=(await pending).json();expect(receipt.state).toBe("OUTCOME_UNKNOWN");f.gate.resolve();await stopping;
  f.control.holdReconcile=true;await f.connect();
  try{
    const cancelled=await f.service.semanticTools.execute("run.cancel",{target:receipt.runId},{principal:{id:"operator",roles:["operator"],channel:"api"},workflowId:"cancel-unknown",confirmed:true});
    expect(cancelled).toMatchObject({state:"CANCELLED"});expect(f.runtime.database.getEntity("native-execution",receipt.runId)).toMatchObject({state:"CANCELLED",lease:{revokedAt:expect.any(String)}});expect(f.starts).toHaveLength(1);
  }finally{f.control.holdReconcile=false;f.reconcileGate.resolve();}
});

it("revokes canonical authority and blocks old credential reconnection when Runner credentials are revoked",async()=>{
  const f=await setup(),p=await f.preview(),receipt=(await f.commit(p)).json();
  const response=await f.service.app.inject({method:"POST",url:"/api/runners/remote/credential/revoke",headers:f.headers});expect(response.statusCode).toBe(200);
  expect(f.service.database.getEntity("run",receipt.runId)).toMatchObject({revokedLeaseIds:expect.arrayContaining([expect.any(String)])});
  expect(f.service.database.getEntity("run",receipt.runId)).toMatchObject({state:"RUNNER_UNAVAILABLE",resumePolicy:"manual"});
  await expect(f.connect()).rejects.toThrow("unauthorized");expect(f.starts).toHaveLength(1);
});
it("requires ownership reconciliation before an unavailable remote Run can resume",async()=>{
  const f=await setup(),p=await f.preview(),receipt=(await f.commit(p)).json();await f.client.stop();await vi.waitFor(()=>expect(f.service.database.getEntity("run",receipt.runId)).toMatchObject({state:"RUNNER_UNAVAILABLE"}));
  await expect(f.service.semanticTools.execute("run.resume",{target:receipt.runId},{principal:{id:"operator",roles:["operator"],channel:"api"},workflowId:"resume-disconnected",confirmed:true})).rejects.toThrow("must reconcile");expect(f.starts).toHaveLength(1);
});

it("restores the verification phase and reuses its durable receipt after a lost verification response",async()=>{
  const f=await setup(),p=await f.preview(),receipt=(await f.commit(p)).json();f.control.holdVerify=true;
  const advancing=f.service.app.inject({method:"POST",url:`/api/runs/${receipt.runId}/advance`,headers:f.headers});await f.verificationEntered.promise;
  const stopped=f.client.stop();await advancing;f.verificationGate.resolve();await stopped;
  await vi.waitFor(()=>expect(f.service.database.getEntity("run",receipt.runId)).toMatchObject({state:"RUNNER_UNAVAILABLE",recoveryState:"VERIFYING"}));f.control.holdVerify=false;await f.connect();
  await vi.waitFor(()=>expect(f.service.database.getEntity("run",receipt.runId)).toMatchObject({state:"VERIFYING"}));
  const replay=await f.service.app.inject({method:"POST",url:`/api/runs/${receipt.runId}/advance`,headers:f.headers});expect(replay.json()).toMatchObject({run:{state:"COMPLETE",verification:{state:"PASSED"}}});expect(f.starts).toHaveLength(1);
  const operations=f.runtime.database.listEntities("native-operation") as unknown as Array<{state:string}>;expect(operations.filter(operation=>operation.state==="COMPLETE")).toHaveLength(1);
});

it.each(["metadata", "delete"] as const)("fences Runner authorization before awaiting failing secret %s", async operation => {
  const f = await setup(), preview = await f.preview(), receipt = (await f.commit(preview)).json();
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const store = vi.spyOn(f.service.secrets, operation).mockImplementation(async () => { entered.resolve(); await release.promise; throw new Error("controlled credential-store failure"); });
  const shutdown = vi.spyOn(f.runtime, "shutdown");
  const revoking = f.service.app.inject({ method: "POST", url: "/api/runners/remote/credential/revoke", headers: f.headers }); void revoking.then(() => undefined);
  try {
    await entered.promise;
    expect(f.service.database.getEntity("runner-identity", "remote")).toMatchObject({ revokedAt: expect.any(String), epoch: expect.any(String) });
    await vi.waitFor(() => expect(shutdown).toHaveBeenCalled());
    await expect(f.connect()).rejects.toThrow("unauthorized");
    expect(f.service.database.getEntity("run", receipt.runId)).toMatchObject({ state: "RUNNER_UNAVAILABLE", revokedLeaseIds: expect.arrayContaining([expect.any(String)]) });
    release.resolve(); expect((await revoking).statusCode).toBe(500);
    await expect(f.connect()).rejects.toThrow("unauthorized");
    expect(f.starts).toHaveLength(1);
  } finally { release.resolve(); await revoking; store.mockRestore(); shutdown.mockRestore(); }
});
it("rejects an authentication result that resolved after credential revocation", async () => {
  const f = await setup(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const resolve = vi.spyOn(f.service.secrets, "resolve").mockImplementation(async () => { entered.resolve(); await release.promise; return "fixture"; });
  const connecting = f.connect(), rejected = expect(connecting).rejects.toThrow("unauthorized");
  try {
    await entered.promise;
    expect((await f.service.app.inject({ method: "POST", url: "/api/runners/remote/credential/revoke", headers: f.headers })).statusCode).toBe(200);
    release.resolve(); await rejected;
  } finally { release.resolve(); await connecting.catch(() => undefined); resolve.mockRestore(); }
});
it("changes the Runner identity epoch for re-enrollment even with an unchanged clock", async () => {
  const f = await setup();
  const enroll = async () => {
    const issued = await f.service.app.inject({ method: "POST", url: "/api/runners/remote/enrollment", headers: f.headers });
    const enrolled = await f.service.app.inject({ method: "POST", url: "/api/runners/enroll", payload: { runnerId: "remote", token: issued.json().token } });
    expect(enrolled.statusCode, enrolled.body).toBe(201);
    return f.service.database.getEntity("runner-identity", "remote") as { epoch?: string; enrolledAt?: string };
  };
  const before = await enroll(), after = await enroll();
  expect(before.epoch).toEqual(expect.any(String)); expect(after.epoch).not.toBe(before.epoch);
  expect(after.enrolledAt).toBe(before.enrolledAt);
});
it("serializes credential changes and blocks generic secret mutation or identity edits during a change", async () => {
  const f = await setup(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const original = f.service.secrets.delete.bind(f.service.secrets);
  const deleting = vi.spyOn(f.service.secrets, "delete").mockImplementation(async reference => { entered.resolve(); await release.promise; await original(reference); });
  const pending = f.service.app.inject({ method: "POST", url: "/api/runners/remote/credential/revoke", headers: f.headers }); void pending.then(() => undefined);
  try {
    await entered.promise;
    for (const suffix of ["credential/revoke", "credential/rotate", "enrollment"]) {
      const blocked = await f.service.app.inject({ method: "POST", url: `/api/runners/remote/${suffix}`, headers: f.headers });
      expect(blocked.statusCode).toBe(409); expect(blocked.json()).toMatchObject({ code: "RUNNER_CREDENTIAL_BUSY" });
    }
    expect((await f.service.app.inject({ method: "PUT", url: "/api/secrets/runner/fixture%2Fremote", headers: f.headers, payload: { value: "replacement" } })).json()).toMatchObject({ code: "RUNNER_CREDENTIAL_MANAGED" });
    expect((await f.service.app.inject({ method: "DELETE", url: "/api/secrets/runner/fixture%2Fremote", headers: f.headers })).json()).toMatchObject({ code: "SECRET_IN_USE" });
    const next = structuredClone(f.service.configuration.current().config); next.runners.find(runner => runner.id === "remote")!.credentialRef = "secret://runner/other";
    const plan = f.service.configuration.buildPlan(next, "fixture", "cli");
    expect(() => f.service.configuration.applyPlan(plan.id, { confirmed: true })).toThrow(expect.objectContaining({ code: "RUNNER_CREDENTIAL_BUSY" }));
    release.resolve(); expect((await pending).statusCode).toBe(200);
  } finally { release.resolve(); await pending; deleting.mockRestore(); }
});
it("revokes one shared-reference identity without deleting another Runner's credential", async () => {
  const f = await setup();
  const next = f.service.configuration.current().config;
  next.runners.push({ id: "other", displayName: "Other", mode: "remote", capacity: 1, tags: [], credentialRef: "secret://runner/fixture/remote" });
  f.service.configuration.applyPlan(f.service.configuration.buildPlan(next, "fixture", "cli").id, { confirmed: true });
  expect((await f.service.app.inject({ method: "POST", url: "/api/runners/remote/credential/rotate", headers: f.headers })).json()).toMatchObject({ code: "SHARED_RUNNER_CREDENTIAL" });
  expect((await f.service.app.inject({ method: "POST", url: "/api/runners/remote/enrollment", headers: f.headers })).json()).toMatchObject({ code: "SHARED_RUNNER_CREDENTIAL" });
  expect((await f.service.app.inject({ method: "POST", url: "/api/runners/enroll", payload: { runnerId: "remote", token: "invalid-token" } })).statusCode).toBe(401);
  expect((await f.service.app.inject({ method: "POST", url: "/api/runners/remote/credential/revoke", headers: f.headers })).statusCode).toBe(200);
  await expect(f.connect()).rejects.toThrow("unauthorized");
  expect((await f.service.secrets.metadata("secret://runner/fixture/remote")).exists).toBe(true);
  const address = f.service.app.server.address() as { port: number }, journal = new RunnerJournal(join(f.runnerData, "other-transport.sqlite"));
  const other = new RemoteRunnerClient({ url: `ws://127.0.0.1:${address.port}/runner`, bearerToken: "fixture", runner: { id: "other", displayName: "Other", platform: process.platform as "darwin", architecture: process.arch, capacity: 1, state: "ONLINE", capabilities: [], lastSeenAt: f.now().toISOString() }, profileInventory: [], journal });
  try {
    await other.start(); expect(f.service.runners.list().find(runner => runner.id === "other")).toMatchObject({ state: "ONLINE" });
    const changed = structuredClone(f.service.configuration.current().config); changed.runners.find(runner => runner.id === "other")!.credentialRef = "secret://runner/dedicated";
    const plan = f.service.configuration.buildPlan(changed, "fixture", "cli");
    expect(() => f.service.configuration.applyPlan(plan.id, { confirmed: true })).toThrow(expect.objectContaining({ code: "RUNNER_CONNECTED" }));
  }
  finally { await other.stop(); journal.close(); }
});

it("keeps a Runner revoked in memory when the durable identity write fails", async () => {
  const f = await setup(), preview = await f.preview(), receipt = (await f.commit(preview)).json();
  const original = f.service.database.saveEntity.bind(f.service.database);
  const save = vi.spyOn(f.service.database, "saveEntity").mockImplementation((kind, id, value, updatedAt) => {
    if (kind === "runner-identity") throw new Error("controlled identity persistence failure");
    return original(kind, id, value, updatedAt);
  });
  try {
    expect((await f.service.app.inject({ method: "POST", url: "/api/runners/remote/credential/revoke", headers: f.headers })).statusCode).toBe(500);
    await expect(f.connect()).rejects.toThrow("unauthorized");
    const advanced = await f.service.app.inject({ method: "POST", url: `/api/runs/${receipt.runId}/advance`, headers: f.headers });
    expect(advanced.statusCode).not.toBe(200); expect(f.service.database.getEntity("run-result", receipt.runId)).toBeUndefined(); expect(f.starts).toHaveLength(1);
  } finally { save.mockRestore(); }
});


it("delivers an explicit remote commit through the owning Runner with no Controller Git or push",async()=>{
 const f=await setup(false,false,"commit");execFileSync("git",["-C",f.root,"config","user.name","Fixture"]);execFileSync("git",["-C",f.root,"config","user.email","fixture@example.invalid"]);
 execFileSync("git",["-C",f.root,"remote","add","origin","https://example.invalid/never-push/repo.git"]);
 const source=execFileSync("git",["-C",f.root,"rev-parse","HEAD"],{encoding:"utf8"}).trim();
 const local=vi.spyOn(f.service["localGitDelivery"],"commit").mockRejectedValue(new Error("Controller must not commit remote work"));
 const p=await f.preview();expect(p.canCommit,p).toBe(true);const receipt=(await f.commit(p)).json();expect(receipt.state).toBe("STARTED");
 const advanced=await f.service.app.inject({method:"POST",url:`/api/runs/${receipt.runId}/advance`,headers:f.headers});expect(advanced.json()).toMatchObject({run:{state:"COMPLETE",verification:{state:"PASSED"}},task:{state:"REVIEW"}});
 const result=f.service.database.getEntity("run-result",receipt.runId) as unknown as {commit:{commit:string}};expect(result).toMatchObject({deliveryType:"commit",commit:{created:true,runId:receipt.runId,generation:1,files:["result.txt"]}});
 expect(execFileSync("git",["-C",f.starts[0]!.workspacePath,"rev-parse","HEAD"],{encoding:"utf8"}).trim()).toBe(result.commit.commit);expect(execFileSync("git",["-C",f.root,"rev-parse","HEAD"],{encoding:"utf8"}).trim()).toBe(source);
 expect(f.runtime.database.getEntity("native-execution",receipt.runId)).toMatchObject({delivery:{type:"commit"},deliveryState:"complete",settledAt:expect.any(String)});
 expect(f.runtime.database.getEntity("native-operation",`native-commit:${receipt.runId}:1`)).toMatchObject({state:"COMPLETE",result:result.commit});expect(local).not.toHaveBeenCalled();expect(f.localBackend).not.toHaveBeenCalled();expect(f.createLocal).not.toHaveBeenCalled();
 expect((await f.commit(p)).json()).toEqual(receipt);expect(f.starts).toHaveLength(1);
});

it("blocks explicit commit on an older native Runner while preserving its none execution capability",async()=>{
 const f=await setup(false,false,"commit");await f.client.stop();await f.connect("fixture",[NATIVE_EXECUTION_CAPABILITY]);const preview=await f.preview();expect(preview.canCommit).toBe(false);expect(preview.checks).toContainEqual(expect.objectContaining({code:"REMOTE_DELIVERY_UNAVAILABLE",status:"blocked"}));expect(f.starts).toHaveLength(0);expect(existsSync(join(f.runnerData,"worktrees"))).toBe(false);
 await expect(f.service["remoteRunnerServer"].sendCommand("remote",{type:"native.run_push",runId:"run"},{leaseId:"lease",generation:1,leaseExpiresAt:new Date(Date.now()+60_000).toISOString()})).rejects.toThrow("native git delivery capability");
});

it("qualifies remote PR origin on the owning Runner while SCM reads remain on Controller",async()=>{
 const f=await setup(false,false,"pull-request");execFileSync("git",["-C",f.root,"remote","add","origin","git@github.com:acme/repo.git"]);const local=vi.spyOn(f.service.workspaces,"deliveryTarget").mockRejectedValue(new Error("Controller cannot inspect foreign Git"));
 const p=await f.preview();expect(p.checks).toContainEqual(expect.objectContaining({id:"delivery",status:"passed"}));expect(p.effectiveDelivery).toMatchObject({scmConnectorId:"chosen",target:{host:"github.com",repository:"acme/repo"}});expect(p.canCommit).toBe(true);expect(f.connectorRequests).toEqual(["/repos/acme/repo","/repos/acme/repo/branches/main"]);expect(local).not.toHaveBeenCalled();expect(f.localBackend).not.toHaveBeenCalled();expect(f.starts).toHaveLength(0);expect(f.runtime.configuration.current().config.connectors).toEqual([]);
});

it("completes explicit remote PR delivery using only owning-Runner Git and selected Controller SCM APIs",async()=>{
 const f=await setup(false,false,"pull-request"),bare=join(f.root,"..","remote.git"),ssh=join(f.root,"..","fixture-ssh");execFileSync("git",["init","--bare",bare],{stdio:"ignore"});f.remoteScm.bare=bare;
 const git=(...args:string[])=>execFileSync("git",["-C",f.root,...args],{encoding:"utf8"}).trim();git("config","user.name","Fixture");git("config","user.email","fixture@example.invalid");writeFileSync(ssh,`#!${process.execPath}\nconst {spawnSync}=require('node:child_process');const result=spawnSync('git-receive-pack',[${JSON.stringify(bare)}],{stdio:'inherit'});process.exit(result.status??1);\n`);chmodSync(ssh,0o755);git("remote","add","origin","git@github.com:acme/repo.git");git("config","core.sshCommand",ssh);git("config","ssh.variant","ssh");git("push","origin","main");const source=git("rev-parse","HEAD");
 const local=vi.spyOn(f.service["localGitDelivery"],"push").mockRejectedValue(new Error("Controller must not push remote work"));const p=await f.preview();expect(p.canCommit,p).toBe(true);const receipt=(await f.commit(p)).json();expect(receipt.state).toBe("STARTED");
 const response=await f.service.app.inject({headers:f.headers,method:"POST",url:`/api/runs/${receipt.runId}/advance`});expect(response.json()).toMatchObject({run:{state:"COMPLETE",prUrl:"https://github.com/acme/repo/pull/1",verification:{state:"PASSED"}},task:{state:"REVIEW"}});
 const result=f.service.database.getEntity("run-result",receipt.runId) as unknown as {push:{commit:string}};expect(result).toMatchObject({deliveryState:"complete",deliveryType:"pull-request",commit:{files:["result.txt"]},push:{target:{repository:"acme/repo"}}});expect(f.runtime.database.getEntity("native-execution",receipt.runId)).toMatchObject({delivery:{type:"pull-request"},push:{commit:result.push.commit},settledAt:expect.any(String)});expect(git("rev-parse","HEAD")).toBe(source);expect(local).not.toHaveBeenCalled();expect(f.createLocal).not.toHaveBeenCalled();expect(f.localBackend).not.toHaveBeenCalled();expect(f.remoteScm.posts).toBe(1);expect(f.starts).toHaveLength(1);
});
