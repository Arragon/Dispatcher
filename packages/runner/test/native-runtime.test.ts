import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { CodexAdapter, type SessionStore } from "@dispatcher/adapters";
import { defaultDispatcherConfig } from "@dispatcher/config";
import type { AccountModelCatalog, ExecutionSelection } from "@dispatcher/domain";
import { createEnvelope, type CommandPayload } from "@dispatcher/protocol";
import { NativeRunnerRuntime } from "../src/native-runtime.js";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "runner-native-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, "repo");
  execFileSync("git", ["init", "-b", "main", root], { stdio: "ignore" });
  execFileSync("git", ["-C", root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "base"], { stdio: "ignore" });
  let starts = 0, cancellations = 0, sequence = 0;
  let now = new Date("2026-10-16T12:00:00Z");
  let completed = false;
  const catalog: AccountModelCatalog = { profileId: "p", runnerId: "remote", providerId: "codex", backendId: "codex-exec-json", contextFingerprint: "context", revision: "catalog", fetchedAt: now.toISOString(), freshness: "native-fresh", source: "native-rpc", selectionSupport: "explicit", entries: [{ id: "model", displayName: "Model", kind: "model", selectable: true, access: "account-listed", parameterOptions: { reasoningEffort: ["low"] } }] };
  const options = { runnerId: "remote", dataDirectory: join(directory, "data"), monitorIntervalMs: 0, now: () => now, createAdapter: (_profile: unknown, store: SessionStore) => {
    const adapter = new CodexAdapter({ id: "p", alias: "P", codexHome: join(directory,"native-account") }, { start: input => {
      starts++; writeFileSync(join(input.workspacePath, "result.txt"), "runner-ok\n");
      return { processId: 1234, status: () => completed ? "completed" : "running", cancel: async () => { cancellations++; completed = true; }, result: async () => ({ state: completed ? "completed" : "waiting", summary: "done", providerSessionId: "native-session", events: [] }) };
    } }, store);
    adapter.modelCatalog = async () => structuredClone(catalog);
    return adapter;
  } };
  const runtime = new NativeRunnerRuntime(options);
  cleanups.push(() => runtime.close());
  const config = structuredClone(defaultDispatcherConfig);
  config.runners = [{ id: "remote", displayName: "Remote", mode: "remote", capacity: 1, tags: [], credentialRef: "secret://runner/fixture/remote" }];
  config.agentProfiles = [{ id: "p", alias: "P", provider: "codex", runnerId: "remote", settings: { codexHome: join(directory,"native-account") } }];
  config.repositories = [{ id: "repo", runnerId: "remote", root, defaultBaseRef: "main", scopePaths: ["."], verificationCommands: [{ id: "check", file: process.execPath, args: ["-e", "if(require('node:fs').readFileSync('result.txt','utf8')!=='runner-ok\\n')process.exit(1)"], required: true, timeoutMs: 3000, outputLimitBytes: 1000 }] }];
  const apply = () => runtime.configuration.applyPlan(runtime.configuration.buildPlan(config, "fixture", "cli").id, { confirmed: true });
  const plan = { repositoryId: "repo", taskId: "task", runId: "run", attempt: 1, baseRef: "main", scopePaths: ["."] };
  const selection: ExecutionSelection = { version: 1, mode: "manual", source: "explicit", profileId: "p", runnerId: "remote", providerId: "codex", backendId: "codex-exec-json", selectionType: "explicit-model", requestedModel: "model", nativeParameters: {}, catalogRevision: "catalog", contextFingerprint: "context", configRevision: 1, selectedAt: now.toISOString() };
  const call = async (payload: CommandPayload, messageId = `command-${++sequence}`, overrides = {}) => runtime.handle(payload, createEnvelope({ kind: "command", runnerId: "remote", traceId: "trace", messageId, sequence: ++sequence, leaseId: "lease", generation: 1, leaseExpiresAt: "2026-10-16T12:01:00Z", ...overrides, payload }));
  const prepare = (delivery?: {type:"commit";message:string}) => call({ type: "native.workspace_prepare", runId: "run", profileId: "p", plan, verificationCommandIds: ["check"], ...(delivery?{delivery}:{}) } as CommandPayload);
  const start = () => call({ type: "run.start", runId: "run", execution: { version: 1, profileId: "p", workspaceId: "run", prompt: "write result", selection } });
  return { runtime, options, config, apply, plan, selection, catalog, call, prepare, start, directory, root, starts: () => starts, cancellations: () => cancellations, complete: () => { completed = true; }, expire: () => { now = new Date("2026-10-16T12:02:00Z"); } };
}

it("requires applied owning registrations, plans without mutation, executes and verifies only in its managed worktree", async () => {
  const f = fixture();
  await expect(f.call({ type: "native.workspace_plan", profileId: "p", plan: f.plan })).rejects.toMatchObject({ code: "PROFILE_UNAVAILABLE" });
  f.apply();
  const planned = await f.call({ type: "native.workspace_plan", profileId: "p", plan: f.plan }) as { path: string };
  expect(existsSync(planned.path)).toBe(false);
  const workspace = await f.prepare() as { path: string };
  expect(workspace.path).toBe(planned.path);
  expect(await f.start()).toMatchObject({ processId: 1234, state: "RUNNING", workspacePath: workspace.path });
  expect(await f.start()).toMatchObject({ processId: 1234 });
  expect(f.starts()).toBe(1);
  expect(existsSync(join(f.root, "result.txt"))).toBe(false);
  expect(readFileSync(join(workspace.path, "result.txt"), "utf8")).toBe("runner-ok\n");
  f.complete();
  expect(await f.call({ type: "native.run", runId: "run", action: "status" })).toMatchObject({ state: "COMPLETED", providerSessionId: "native-session" });
  expect(await f.call({ type: "native.run_verify", runId: "run" })).toMatchObject([{ commandId: "check", status: "passed" }]);
  expect(await f.call({ type: "native.run_files", runId: "run" })).toEqual(["result.txt"]);
  expect(await f.call({ type: "native.run", runId: "run", action: "result" })).toMatchObject({ state: "COMPLETED", summary: "done" });
});

it("rejects native probe evidence when the owning registration changes during the read",async()=>{
  const f=fixture();f.runtime.close();const entered=Promise.withResolvers<void>(),gate=Promise.withResolvers<void>();
  const runtime=new NativeRunnerRuntime({...f.options,probeProfile:async()=>{entered.resolve();await gate.promise;return {installed:true,authenticated:true};}});cleanups.push(()=>runtime.close());
  runtime.configuration.applyPlan(runtime.configuration.buildPlan(f.config,"fixture","cli").id,{confirmed:true});
  const payload:CommandPayload={type:"native.profile_probe",profileId:"p",repositoryId:"repo"};
  const pending=runtime.handle(payload,createEnvelope({kind:"command",runnerId:"remote",traceId:"probe",messageId:"probe",sequence:1,payload}));
  const rejected=expect(pending).rejects.toMatchObject({code:"SELECTION_CHANGED"});await entered.promise;
  const changed=structuredClone(f.config);changed.agentProfiles[0]!.settings={codexHome:"/different-account"};runtime.configuration.applyPlan(runtime.configuration.buildPlan(changed,"fixture","cli").id,{confirmed:true});gate.resolve();await rejected;
});

it("preserves the owning Runner's observed usage after losing process attachment on restart",async()=>{
 const f=fixture();f.runtime.close();const options={...f.options,createAdapter:(profile:unknown,store:SessionStore)=>{const adapter=f.options.createAdapter(profile,store);adapter.usage=async()=>({state:"AVAILABLE",tokens:{input:12,output:0,apiKey:"sk-private-canary-12345678"},tokenScope:"latest-turn",source:"event",apiKey:"sk-private-canary-12345678",executable:"/private/native"});return adapter;}};
 const runtime=new NativeRunnerRuntime(options);cleanups.push(()=>runtime.close());runtime.configuration.applyPlan(runtime.configuration.buildPlan(f.config,"fixture","cli").id,{confirmed:true});
 const send=(owner:NativeRunnerRuntime,payload:CommandPayload,messageId:string)=>owner.handle(payload,createEnvelope({kind:"command",runnerId:"remote",traceId:"usage",messageId,sequence:1,leaseId:"lease",generation:1,leaseExpiresAt:"2026-10-16T12:01:00Z",payload}));
 await send(runtime,{type:"native.workspace_prepare",runId:"run",profileId:"p",plan:f.plan,verificationCommandIds:["check"]},"prepare");await send(runtime,{type:"run.start",runId:"run",execution:{version:1,profileId:"p",workspaceId:"run",prompt:"write",selection:f.selection}},"start");
 const measured=await send(runtime,{type:"native.run",runId:"run",action:"usage"},"usage");expect(measured).toEqual({state:"AVAILABLE",tokens:{input:12,output:0},tokenScope:"latest-turn",source:"event",checkedAt:expect.any(String)});expect(JSON.stringify(measured)).not.toMatch(/private|apiKey/);runtime.close();const restored=new NativeRunnerRuntime(options);cleanups.push(()=>restored.close());expect(await send(restored,{type:"native.run",runId:"run",action:"usage"},"usage-restored")).toEqual(measured);expect(f.starts()).toBe(1);
});

it("rejects foreign runners, unsafe scopes, missing commands and stale concrete selections before native start", async () => {
  const f = fixture(); f.apply();
  await expect(f.call({ type: "native.workspace_plan", profileId: "p", plan: f.plan }, undefined, { runnerId: "other" })).rejects.toMatchObject({ code: "RUNNER_MISMATCH" });
  await expect(f.call({ type: "native.workspace_plan", profileId: "p", plan: { ...f.plan, scopePaths: ["../outside"] } })).rejects.toBeDefined();
  await expect(f.call({ type: "native.workspace_prepare", runId: "run", profileId: "p", plan: f.plan, verificationCommandIds: ["check", "foreign-command"] })).rejects.toMatchObject({ code: "VERIFICATION_COMMAND_UNAVAILABLE" });
  await expect(f.call({ type: "native.workspace_prepare", runId: "run", profileId: "p", plan: f.plan, verificationCommandIds: [] })).rejects.toMatchObject({ code: "VERIFICATION_COMMAND_REQUIRED" });
  await f.prepare(); f.catalog.revision = "changed";
  await expect(f.start()).rejects.toMatchObject({ code: "SELECTION_CHANGED" });
  expect(f.starts()).toBe(0);
});

it("preserves start and input receipts across changed-message retries and restart without respawning", async () => {
  const f = fixture(); f.apply(); await f.prepare(); await f.start(); f.complete();
  await f.call({ type: "native.run", runId: "run", action: "status" });
  await f.call({ type: "native.run", runId: "run", action: "send", message: "continue" }, "input-1");
  expect(f.starts()).toBe(2);
  await f.call({ type: "native.run", runId: "run", action: "send", message: "continue" }, "input-1");
  await expect(f.call({ type: "native.run", runId: "run", action: "send", message: "changed" }, "input-1")).rejects.toMatchObject({ code: "COMMAND_IDEMPOTENCY_CONFLICT" });
  f.runtime.close();
  const restored = new NativeRunnerRuntime(f.options); cleanups.push(() => restored.close());
  const input: CommandPayload = { type: "native.run", runId: "run", action: "send", message: "continue" };
  expect(await restored.handle(input, createEnvelope({ kind: "command", runnerId: "remote", traceId: "trace", messageId: "input-1", sequence: 99, leaseId: "lease", generation: 1, leaseExpiresAt: "2026-10-16T12:01:00Z", payload: input }))).toMatchObject({ type: "session.message" });
  const payload: CommandPayload = { type: "run.start", runId: "run", execution: { version: 1, profileId: "p", workspaceId: "run", prompt: "write result", selection: f.selection } };
  await expect(restored.handle(payload, createEnvelope({ kind: "command", runnerId: "remote", traceId: "trace", messageId: "restart-start", sequence: 100, leaseId: "lease", generation: 1, leaseExpiresAt: "2026-10-16T12:01:00Z", payload }))).rejects.toMatchObject({ code: "COMMAND_OUTCOME_UNKNOWN" });
  expect(f.starts()).toBe(2);
});

it("persists revocation and stops expired native processes without reviving their generation", async () => {
  const f = fixture(); f.apply(); await f.prepare(); await f.start(); f.expire();
  await f.runtime.expireLeases();
  expect(f.cancellations()).toBe(1);
  await expect(f.start()).rejects.toMatchObject({ code: "LEASE_REVOKED" });
  await expect(f.call({ type: "lease.renew", leaseId: "lease", generation: 1, expiresAt: "2026-10-16T12:05:00Z" })).rejects.toMatchObject({ code: "LEASE_REVOKED" });
  expect(f.starts()).toBe(1);
});

it("restores an unstarted prepared workspace while blocking active registration replacement", async () => {
  const f = fixture(); f.apply(); const prepared = await f.prepare();
  const changed = structuredClone(f.config); changed.agentProfiles[0]!.settings = { codexHome: "/different-account" };
  const plan = f.runtime.configuration.buildPlan(changed, "fixture", "cli");
  expect(() => f.runtime.configuration.applyPlan(plan.id, { confirmed: true })).toThrow(expect.objectContaining({ cause: expect.objectContaining({ code: "RUNNER_CONFIGURATION_BUSY" }) }));
  expect(f.runtime.configuration.getPlan(plan.id)?.state).toBe("FAILED");
  expect(f.runtime.configuration.current().config.agentProfiles).toEqual(f.config.agentProfiles);
  f.runtime.close();
  const restored = new NativeRunnerRuntime(f.options); cleanups.push(() => restored.close());
  const payload: CommandPayload = { type: "run.start", runId: "run", execution: { version: 1, profileId: "p", workspaceId: "run", prompt: "write result", selection: f.selection } };
  const session = await restored.handle(payload, createEnvelope({ kind: "command", runnerId: "remote", traceId: "trace", messageId: "prepared-restart", sequence: 100, leaseId: "lease", generation: 1, leaseExpiresAt: "2026-10-16T12:01:00Z", payload }));
  expect(session).toMatchObject({ workspacePath: (prepared as { path: string }).path }); expect(f.starts()).toBe(1);
});

it("fences expiry after an async adapter preparation before the native spawn", async () => {
  const f = fixture();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), waiting = new Promise<void>(resolve => { entered = resolve; });
  f.runtime.close();
  const runtime = new NativeRunnerRuntime({ ...f.options, createAdapter: (profile, store) => {
    const adapter = f.options.createAdapter(profile, store), start = adapter.start.bind(adapter);
    adapter.start = async input => { entered(); await gate; return start(input); }; return adapter;
  } }); cleanups.push(() => runtime.close());
  runtime.configuration.applyPlan(runtime.configuration.buildPlan(f.config, "fixture", "cli").id, { confirmed: true });
  const send = (payload: CommandPayload, messageId: string) => runtime.handle(payload, createEnvelope({ kind: "command", runnerId: "remote", traceId: "trace", messageId, sequence: 1, leaseId: "lease", generation: 1, leaseExpiresAt: "2026-10-16T12:01:00Z", payload }));
  await send({ type: "native.workspace_prepare", runId: "run", profileId: "p", plan: f.plan, verificationCommandIds: ["check"] }, "prepare");
  const pending = send({ type: "run.start", runId: "run", execution: { version: 1, profileId: "p", workspaceId: "run", prompt: "write result", selection: f.selection } }, "start");
  await waiting; f.expire(); await runtime.expireLeases(); release();
  await expect(pending).rejects.toMatchObject({ code: "LEASE_REVOKED" }); expect(f.starts()).toBe(0);
});

it("reserves capacity before workspace effects and never gives a second Run an existing command id", async () => {
  const f = fixture(); f.apply(); await f.prepare();
  const other = { ...f.plan, runId: "other", taskId: "other" };
  await expect(f.call({ type: "native.workspace_prepare", runId: "other", profileId: "p", plan: other, verificationCommandIds: ["check"] }, undefined, { leaseId: "other-lease" })).rejects.toMatchObject({ code: "RUNNER_CAPACITY" });
  await f.start();
  await expect(f.call({ type: "run.start", runId: "other", execution: { version: 1, profileId: "p", workspaceId: "other", prompt: "write result", selection: f.selection } }, "shared-command")).rejects.toMatchObject({ code: "EXECUTION_NOT_FOUND" });
  await expect(f.call({ type: "run.start", runId: "run", execution: { version: 1, profileId: "p", workspaceId: "run", prompt: "write result", selection: f.selection } }, "shared-command")).rejects.toMatchObject({ code: "COMMAND_IDEMPOTENCY_CONFLICT" });
  expect(f.starts()).toBe(1);
});

it("renews authority without changing the frozen start descriptor and persists revocation across restart", async () => {
  const f = fixture(); f.apply(); await f.prepare(); await f.start();
  await f.call({ type: "lease.renew", leaseId: "lease", generation: 1, expiresAt: "2026-10-16T12:05:00Z" }); f.expire();
  expect(await f.start()).toMatchObject({ processId: 1234 }); expect(f.starts()).toBe(1);
  await f.call({ type: "lease.revoke", leaseId: "lease", generation: 1, reason: "operator cancelled" });
  f.runtime.close(); const restored = new NativeRunnerRuntime(f.options); cleanups.push(() => restored.close());
  const payload: CommandPayload = { type: "lease.renew", leaseId: "lease", generation: 1, expiresAt: "2026-10-16T12:10:00Z" };
  await expect(restored.handle(payload, createEnvelope({ kind: "command", runnerId: "remote", traceId: "trace", messageId: "late-renew", sequence: 100, payload }))).rejects.toMatchObject({ code: "LEASE_REVOKED" });
  expect(f.cancellations()).toBe(1);
});

it("aborts a running verification child when its lease expires", async () => {
  const f = fixture();
  f.config.repositories[0]!.verificationCommands[0]!.args = ["-e", "require('node:fs').writeFileSync('check-started.txt','started');setTimeout(()=>require('node:fs').writeFileSync('late-write.txt','unsafe'),10000)"];
  f.apply(); const workspace = await f.prepare() as { path: string }; await f.start(); f.complete(); await f.call({ type: "native.run", runId: "run", action: "status" });
  const verifying = f.call({ type: "native.run_verify", runId: "run" }, "long-verification");
  // Attach rejection handling before revocation aborts the child.
  const rejected = expect(verifying).rejects.toMatchObject({ code: "LEASE_REVOKED" });
  await vi.waitFor(() => expect(existsSync(join(workspace.path, "check-started.txt"))).toBe(true));
  f.expire(); await f.runtime.expireLeases(); await rejected;
  expect(existsSync(join(workspace.path, "late-write.txt"))).toBe(false);
});

it("rejects a second database owner before it can rewrite live executions as recovery records", async () => {
  const f = fixture(); f.apply(); await f.prepare(); await f.start();
  expect(() => new NativeRunnerRuntime(f.options)).toThrow(expect.objectContaining({ code: "RUNNER_ALREADY_RUNNING" }));
  expect(f.runtime.database.getEntity("native-execution", "run")).toMatchObject({ state: "RUNNING" });
  expect(await f.call({ type: "native.run", runId: "run", action: "status" })).toMatchObject({ state: "RUNNING" });
});

it("rechecks expiry after durable STARTING storage returns and before the backend is spawned", async () => {
  const f = fixture(); f.apply(); await f.prepare();
  const save = f.runtime.database.saveEntity.bind(f.runtime.database);
  const delayed = vi.spyOn(f.runtime.database, "saveEntity").mockImplementation((...args) => {
    save(...args);
    if (args[0] === "adapter-session" && (args[2] as { state?: string }).state === "STARTING") f.expire();
  });
  try { await expect(f.start()).rejects.toMatchObject({ code: "LEASE_EXPIRED" }); expect(f.starts()).toBe(0); }
  finally { delayed.mockRestore(); }
});

it("ignores foreign native paths and rejects cross-device repository use and scope widening", async () => {
  const f = fixture();
  f.config.runners.push({ id: "windows", displayName: "Windows", mode: "remote", capacity: 1, tags: [], credentialRef: "secret://runner/fixture/windows" });
  f.config.repositories.push({ id: "foreign", runnerId: "windows", root: "C:\\code\\repo", defaultBaseRef: "main", scopePaths: ["."], verificationCommands: [] });
  f.config.repositories[0]!.scopePaths = ["src"]; f.apply();
  await expect(f.call({ type: "native.workspace_plan", profileId: "p", plan: { ...f.plan, repositoryId: "foreign" } })).rejects.toMatchObject({ code: "REPOSITORY_UNAVAILABLE" });
  for (const scopePaths of [[], ["."], ["src-other"]]) await expect(f.call({ type: "native.workspace_plan", profileId: "p", plan: { ...f.plan, scopePaths } })).rejects.toMatchObject({ code: "SCOPE_NOT_REGISTERED" });
  expect(f.starts()).toBe(0);
});
it("reads references only from its registered repository without starting a native session",async()=>{
 const f=fixture();f.apply();execFileSync("git",["-C",f.root,"branch","feature/ref-read"]);
 const refs=await f.call({type:"native.repository_refs",repositoryId:"repo",offset:0,limit:1});expect(refs).toMatchObject({offset:0,limit:1,nextOffset:1,refs:[{name:"refs/heads/feature/ref-read",kind:"branch"}]});
 await expect(f.call({type:"native.repository_refs",repositoryId:"unknown",offset:0,limit:10})).rejects.toMatchObject({code:"REPOSITORY_UNAVAILABLE"});
 expect(f.starts()).toBe(0);
});
it("rejects owning Runner data/account roots before repository reads or workspace creation",async()=>{
 const f=fixture();
 for(const root of [f.options.dataDirectory,join(f.directory,"native-account")]){
  f.config.repositories[0]!.root=root;f.apply();
  await expect(f.call({type:"native.repository_refs",repositoryId:"repo",offset:0,limit:10})).rejects.toMatchObject({code:"PRIVATE_PATH_SCOPE"});
  await expect(f.call({type:"native.workspace_plan",profileId:"p",plan:f.plan})).rejects.toMatchObject({code:"PRIVATE_PATH_SCOPE"});
 }
 expect(f.starts()).toBe(0);
});

it("holds capacity through native completion until Controller finalization and then prevents further input", async () => {
  const f = fixture(); f.apply(); await f.prepare(); await f.start(); f.complete(); await f.call({ type: "native.run", runId: "run", action: "status" });
  const other = { ...f.plan, runId: "next", taskId: "next" }, prepareNext = () => f.call({ type: "native.workspace_prepare", runId: "next", profileId: "p", plan: other, verificationCommandIds: ["check"] }, undefined, { leaseId: "next-lease" });
  await expect(prepareNext()).rejects.toMatchObject({ code: "RUNNER_CAPACITY" });
  await f.call({ type: "native.run_finalize", runId: "run" });
  expect(await prepareNext()).toMatchObject({ runId: "next" });
  await expect(f.call({ type: "native.run", runId: "run", action: "send", message: "late input" })).rejects.toMatchObject({ code: "EXECUTION_SETTLED" });
  expect(f.starts()).toBe(1);
});

it("preserves completed native result evidence across Runner restart without claiming a live process handle",async()=>{
  const f=fixture();f.apply();await f.prepare();await f.start();f.complete();await f.call({type:"native.run",runId:"run",action:"status"});
  f.runtime.close();const restored=new NativeRunnerRuntime(f.options);cleanups.push(()=>restored.close());
  const payload={type:"native.run" as const,runId:"run",action:"result" as const};
  const result=await restored.handle(payload,createEnvelope({kind:"command",runnerId:"remote",traceId:"trace",messageId:"completed-result",sequence:100,leaseId:"lease",generation:1,leaseExpiresAt:"2026-10-16T12:01:00Z",payload}));
  expect(result).toMatchObject({state:"COMPLETED",summary:"done"});expect(restored.reconcile()).toMatchObject({runs:[{attached:false,state:"COMPLETE",resultAvailable:true}]});expect(f.starts()).toBe(1);
});

it("revokes every admitted lease before awaiting any shutdown cancellation",async()=>{
  const f=fixture();f.runtime.close();f.config.runners[0]!.capacity=2;
  const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();let cancelling=0;
  const runtime=new NativeRunnerRuntime({...f.options,createAdapter:(profile,store)=>{const adapter=f.options.createAdapter(profile,store),cancel=adapter.cancel.bind(adapter);adapter.cancel=async id=>{if(++cancelling===1){entered.resolve();await release.promise;}return cancel(id);};return adapter;}});cleanups.push(()=>runtime.close());
  runtime.configuration.applyPlan(runtime.configuration.buildPlan(f.config,"fixture","cli").id,{confirmed:true});
  const call=(payload:CommandPayload,leaseId:string)=>runtime.handle(payload,createEnvelope({kind:"command",runnerId:"remote",traceId:"trace",messageId:Math.random().toString(),sequence:1,leaseId,generation:1,leaseExpiresAt:"2026-10-16T12:01:00Z",payload}));
  for(const runId of ["one","two"]){await call({type:"native.workspace_prepare",runId,profileId:"p",plan:{...f.plan,runId,taskId:runId},verificationCommandIds:["check"]},runId);await call({type:"run.start",runId,execution:{version:1,profileId:"p",workspaceId:runId,prompt:"start",selection:f.selection}},runId);}
  const shutdown=runtime.shutdown();await entered.promise;
  try{for(const id of ["one","two"])expect(runtime.database.getEntity("native-execution",id)).toMatchObject({lease:{revokedAt:expect.any(String)}});}finally{release.resolve();await shutdown;}
});

it("does not acknowledge revocation until the verification process group has stopped",async()=>{
  const f=fixture(),ready="verification-child.pid";
  const descendant=`process.on('SIGTERM',()=>{});require('node:fs').writeFileSync('${ready}',String(process.pid));setInterval(()=>{},1000)`;
  f.config.repositories[0]!.verificationCommands[0]!.args=["-e",`require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});process.on('SIGTERM',()=>{});setInterval(()=>{},1000)`];
  f.apply();const workspace=await f.prepare() as {path:string};await f.start();f.complete();await f.call({type:"native.run",runId:"run",action:"status"});
  const verifying=f.call({type:"native.run_verify",runId:"run"},"kill-verification"),rejected=expect(verifying).rejects.toMatchObject({code:"LEASE_REVOKED"});let pid:number|undefined;
  const alive=()=>{try{process.kill(pid!,0);return true;}catch{return false;}};
  try{await vi.waitFor(()=>expect(existsSync(join(workspace.path,ready))).toBe(true));pid=Number(readFileSync(join(workspace.path,ready),"utf8"));await f.call({type:"lease.revoke",leaseId:"lease",generation:1,reason:"operator cancellation"});expect(alive()).toBe(false);await rejected;}
  finally{if(pid&&alive())process.kill(pid,"SIGKILL");}
});


it("commits only the frozen explicit intent after successful verification on the owning Runner",async()=>{
 const f=fixture();f.apply();execFileSync("git",["-C",f.root,"config","user.name","Fixture"]);execFileSync("git",["-C",f.root,"config","user.email","fixture@example.invalid"]);
 const source=execFileSync("git",["-C",f.root,"rev-parse","HEAD"],{encoding:"utf8"}).trim();
 const workspace=await f.prepare({type:"commit",message:"Dispatcher: explicit remote commit"}) as {path:string;branch:string};
 const commit={type:"native.run_commit",runId:"run"} as CommandPayload;
 await expect(f.call(commit)).rejects.toMatchObject({code:"EXECUTION_NOT_COMPLETE"});await f.start();f.complete();await f.call({type:"native.run",runId:"run",action:"status"});
 await expect(f.call(commit)).rejects.toMatchObject({code:"VERIFICATION_REQUIRED"});
 await f.call({type:"native.run_verify",runId:"run"});
 const result=await f.call(commit,"commit") as {commit:string};expect(result).toMatchObject({version:1,runId:"run",generation:1,branch:workspace.branch,created:true,files:["result.txt"]});
 expect(execFileSync("git",["-C",workspace.path,"rev-parse","HEAD"],{encoding:"utf8"}).trim()).toBe(result.commit);
 expect(execFileSync("git",["-C",f.root,"rev-parse","HEAD"],{encoding:"utf8"}).trim()).toBe(source);
 expect(execFileSync("git",["-C",workspace.path,"rev-list","--count",`${source}..HEAD`],{encoding:"utf8"}).trim()).toBe("1");
 expect(await f.call(commit,"commit")).toEqual(result);expect(await f.call(commit,"new-transport-id")).toEqual(result);
 await expect(f.call({type:"native.run",runId:"run",action:"send",message:"mutate after commit"})).rejects.toMatchObject({code:"DELIVERY_STARTED"});
 await expect(f.call(commit,"stale",{generation:2})).rejects.toBeDefined();expect(f.starts()).toBe(1);
});

it("cannot add commit authority to an existing none execution or use failed verification",async()=>{
 const f=fixture();f.config.repositories[0]!.verificationCommands[0]!.args=["-e","process.exit(1)"];f.apply();await f.prepare();
 await expect(f.prepare({type:"commit",message:"late permission"})).rejects.toMatchObject({code:"EXECUTION_CONFLICT"});
 await expect(f.call({type:"native.run_commit",runId:"run"} as CommandPayload)).rejects.toMatchObject({code:"DELIVERY_NOT_SELECTED"});
 const g=fixture();g.config.repositories[0]!.verificationCommands[0]!.args=["-e","process.exit(1)"];g.apply();const workspace=await g.prepare({type:"commit",message:"blocked"}) as {path:string};await g.start();g.complete();await g.call({type:"native.run",runId:"run",action:"status"});
 expect(await g.call({type:"native.run_verify",runId:"run"})).toMatchObject([{status:"failed"}]);
 await expect(g.call({type:"native.run_commit",runId:"run"} as CommandPayload)).rejects.toMatchObject({code:"VERIFICATION_REQUIRED"});
 expect(execFileSync("git",["-C",workspace.path,"diff","--cached","--name-only"],{encoding:"utf8"}).trim()).toBe("");
});


it("waits for the owning Git hook group to stop before acknowledging remote lease revocation",async()=>{
 const f=fixture();f.apply();execFileSync("git",["-C",f.root,"config","user.name","Fixture"]);execFileSync("git",["-C",f.root,"config","user.email","fixture@example.invalid"]);
 const ready=join(f.directory,"hook.pid"),hook=join(f.root,".git","hooks","pre-commit");writeFileSync(hook,`#!${process.execPath}\nconst fs=require('node:fs');process.on('SIGTERM',()=>{});fs.writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>{},1000);\n`);chmodSync(hook,0o755);
 const workspace=await f.prepare({type:"commit",message:"cancel owned remote commit"}) as {path:string};await f.start();f.complete();await f.call({type:"native.run",runId:"run",action:"status"});await f.call({type:"native.run_verify",runId:"run"});
 const committing=f.call({type:"native.run_commit",runId:"run"});const rejected=expect(committing).rejects.toBeDefined();
 await expect.poll(()=>existsSync(ready),{timeout:5000}).toBe(true);const pid=Number(readFileSync(ready,"utf8"));
 expect(await f.call({type:"lease.revoke",leaseId:"lease",generation:1,reason:"operator cancel"})).toMatchObject({revokedAt:expect.any(String)});await rejected;
 let absent=false;try{process.kill(pid,0);}catch(error){absent=Boolean(error&&typeof error==="object"&&"code" in error&&error.code==="ESRCH");}expect(absent).toBe(true);
 expect(execFileSync("git",["-C",workspace.path,"rev-list","--count","main..HEAD"],{encoding:"utf8"}).trim()).toBe("0");expect(f.runtime.database.getEntity("native-execution","run")).toMatchObject({state:"CANCELLED",deliveryState:"unknown"});
});

it("invalidates prior verification on new native input and restores completed commit receipts after restart",async()=>{
 const f=fixture();f.apply();execFileSync("git",["-C",f.root,"config","user.name","Fixture"]);execFileSync("git",["-C",f.root,"config","user.email","fixture@example.invalid"]);
 await f.prepare({type:"commit",message:"verified latest turn"});await f.start();f.complete();await f.call({type:"native.run",runId:"run",action:"status"});await f.call({type:"native.run_verify",runId:"run"});await f.call({type:"native.run",runId:"run",action:"send",message:"one more turn"});await f.call({type:"native.run",runId:"run",action:"status"});
 await expect(f.call({type:"native.run_commit",runId:"run"})).rejects.toMatchObject({code:"VERIFICATION_REQUIRED"});await f.call({type:"native.run_verify",runId:"run"});
 const result=await f.call({type:"native.run_commit",runId:"run"},"commit-before-restart");f.runtime.close();const restored=new NativeRunnerRuntime(f.options);cleanups.push(()=>restored.close());
 const payload:CommandPayload={type:"native.run_commit",runId:"run"};expect(await restored.handle(payload,createEnvelope({kind:"command",runnerId:"remote",traceId:"restart",messageId:"commit-before-restart",sequence:999,leaseId:"lease",generation:1,leaseExpiresAt:"2026-10-16T12:01:00Z",payload}))).toEqual(result);expect(f.starts()).toBe(2);
});
