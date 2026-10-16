import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
async function setup(verificationFails = false) {
  const directory = mkdtempSync(join(tmpdir(), "remote-execution-")); cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, "repo"); execFileSync("git", ["init", "-b", "main", root], { stdio: "ignore" }); execFileSync("git", ["-C", root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "base"], { stdio: "ignore" });
  const controllerData = join(directory, "controller"), runnerData = join(directory, "runner");
  const localBackend = vi.fn(() => { throw new Error("Controller must not construct native remote execution"); });
  let clock=new Date();const now=()=>new Date(clock);
  const restores:ReturnType<typeof vi.spyOn>[]=[];
  const makeService=async()=>{
    const instance=new ControllerService({dataDirectory:controllerData,host:"127.0.0.1",port:0,withRunner:true,ownerToken:"owner",clock:now,codexBackendFactory:localBackend,backgroundWorker:{enabled:false},secretStore:{resolve:async()=>"fixture",test:async()=>true} as unknown as SecretStore});
    restores.push(vi.spyOn(instance.workspaces,"restore"));await instance.start();cleanups.push(()=>instance.stop());return instance;
  };
  let service=await makeService();
  const repository = { id: "repo", runnerId: "remote", root, defaultBaseRef: "main", scopePaths: ["."], verificationCommands: [{ id: "check", file: process.execPath, args: ["-e", "if(require('node:fs').readFileSync('result.txt','utf8')!=='remote-ok\\n')process.exit(1)"], required: true, timeoutMs: 3000, outputLimitBytes: 1000 }] };
  if(verificationFails)repository.verificationCommands[0]!.args=["-e","process.exit(1)"];
  const config = service.configuration.current().config; config.runners.push({ id: "remote", displayName: "Remote", mode: "remote", capacity: 1, tags: [], credentialRef: "secret://runner/fixture/remote" }); config.repositories = [repository]; config.agentProfiles = [{ id: "p", alias: "P", provider: "codex", runnerId: "remote", settings: { codexHome: "/must-not-use/controller-native" } }];
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
  const gate=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>(),control={holdStart:false,invalidatePrepared:false,expireAfterRenew:false};
  let client!:RemoteRunnerClient;
  const connect=async()=>{
    const address=service.app.server.address() as {port:number};
    const connected=new RemoteRunnerClient({url:`ws://127.0.0.1:${address.port}/runner`,bearerToken:"fixture",runner:{id:"remote",displayName:"Remote",platform:process.platform as "darwin",architecture:process.arch,capacity:3,state:"ONLINE",capabilities:[NATIVE_EXECUTION_CAPABILITY],lastSeenAt:now().toISOString()},profileInventory:["p"],journal});
    runtime.registerHandlers({register:(type,handler)=>connected.register(type,async(payload,envelope)=>{
      if(payload.type==="native.workspace_prepare"||payload.type==="run.start"){
        const run=service.database.getEntity("run",payload.runId) as unknown as Run,task=service.database.getCanonicalTask(run.taskId)?.document as unknown as Task;
        expect(run).toMatchObject({state:"STARTING",leaseId:envelope.leaseId,generation:envelope.generation});expect(task).toMatchObject({state:"QUEUED",currentRunId:run.id});
      }
      const value=await handler(payload,envelope);
      if(payload.type==="native.workspace_prepare"&&control.invalidatePrepared)catalog.revision="changed-after-prepare";
      if(payload.type==="run.start"&&control.holdStart){entered.resolve();await gate.promise;}
      if(payload.type==="lease.renew"&&control.expireAfterRenew)clock=new Date(clock.getTime()+2*60_000);
      return value;
    })});
    await connected.start();client=connected;cleanups.push(()=>connected.stop());cleanups.push(()=>gate.resolve());return connected;
  };
  await connect();
  const restartController=async()=>{await client.stop();await service.stop();service=await makeService();return service;};
  const createLocal = vi.spyOn(service.workspaces, "create"), headers = { authorization: "Bearer owner" };
  const draft = { schemaVersion: 1, clientDraftId: "draft", projectId: "local:repo", repositoryId: "repo", description: "Write the result", scopePaths: ["."], acceptanceCriteria: ["result is correct"], startMode: "dispatch", execution: { profileId: "p", selectionMode: "manual", selectionType: "explicit-model", nativeModelId: "model", nativeParameters: {}, catalogRevision: catalog.revision, contextFingerprint: catalog.contextFingerprint }, delivery: { type: "none" } };
  const preview = async (clientDraftId="draft") => (await service.app.inject({ method: "POST", url: "/api/task-publications/preview", headers, payload: {...draft,clientDraftId} })).json();
  const commit = (p: { publicationId: string; revision: number; confirmation: { reviewHash: string } }) => service.app.inject({ method: "POST", url: `/api/task-publications/${p.publicationId}/commit`, headers: { ...headers, "idempotency-key": "remote-publication" }, payload: { revision: p.revision, reviewHash: p.confirmation.reviewHash, confirmation: { accepted: true } } });
  return {get service(){return service;},runtime,get client(){return client;},root,runnerData,controllerData,starts,catalogs,localBackend,createLocal,headers,preview,commit,gate,entered,control,connect,restartController,restores,now,advanceClock:(ms:number)=>{clock=new Date(clock.getTime()+ms);}};
}
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
