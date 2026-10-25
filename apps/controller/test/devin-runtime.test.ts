import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { DevinLocalAcpExecutionBackend, type DevinLocalAcpExecutionScope, type CliStartInput, type CliTurnResult } from "@dispatcher/adapters";
import type { ExecutionContextRef, ExecutionSelection, NativeBinding } from "@dispatcher/domain";
import { NativeRuntimeHosts } from "@dispatcher/runner";
import { devinAcpFixture } from "../../../packages/adapters/test/fixtures/devin-acp.js";
import { DevinExecutionRuntime, assertDevinRuntimeSettings } from "../src/devin-runtime.js";

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(mode: { skipBinding?: boolean; unawaitedBinding?: boolean; resultId?: "foreign" | "missing"; nativeEvent?: boolean } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "dispatcher-devin-runtime-"))); roots.push(root);
  const a = join(root, "a"), b = join(root, "b"), dataHome = join(root, "data"), configHome = join(root, "config"), executable = join(root, "devin");
  for (const path of [a, b, dataHome, configHome]) mkdirSync(path); writeFileSync(executable, "fixture", { mode: 0o755 });
  const persisted = new Map<string, NativeBinding>(), assertInput = vi.fn(); let unknown = false, wrongStore = false;
  const entries: Array<{ scope: DevinLocalAcpExecutionScope; reference: ExecutionContextRef; backend: DevinLocalAcpExecutionBackend; starts: ReturnType<typeof vi.spyOn>; disconnect: ReturnType<typeof vi.spyOn> }> = [];
  const factory = vi.fn((scope: DevinLocalAcpExecutionScope, reference: ExecutionContextRef) => {
    const backend = new DevinLocalAcpExecutionBackend({ scope, executionRef: reference });
    const starts = vi.spyOn(backend, "start").mockImplementation(input => {
      const ready = Promise.resolve().then(async () => {
        input.beforePrompt!();
        if (!mode.skipBinding) {
          const persisted = input.onBinding!({ version: 1, product: "devin-local", region: "global", profileId: scope.profileId, backendId: "devin-local-acp", runnerId: scope.runnerId, nativeStoreRef: wrongStore ? "foreign-store" : scope.nativeStoreRef, nativeSessionId: "native-" + reference.id, identityState: "bound", executionRefId: reference.id });
          if (mode.unawaitedBinding) void Promise.resolve(persisted).catch(() => {}); else await persisted;
        }
        if (mode.nativeEvent) await input.onNativeEvent!({ state: "running", observedAt: "2026-10-13T00:00:00.000Z", nativeSessionId: "native-" + reference.id });
        input.beforePrompt!();
      }); void ready.catch(() => {});
      return { ready: () => ready, status: () => "completed", result: async () => { await ready; return { state: "completed", summary: "fixture", events: [], ...(mode.resultId === "missing" ? {} : { providerSessionId: mode.resultId === "foreign" ? "foreign" : "native-" + reference.id }) }; }, cancel: async () => { await backend.disconnectLocal(); } };
    });
    const disconnect = vi.spyOn(backend, "disconnectLocal").mockImplementation(async () => ({ version: 1, connection: unknown ? "unknown" : "closed", ownedRoot: unknown ? "unknown" : "not-created", callbacks: unknown ? "unknown" : "drained", backgroundTools: "unknown", nativeSessionDeleted: false }));
    entries.push({ scope, reference, backend, starts, disconnect }); return backend;
  });
  const runtime = new DevinExecutionRuntime({ profile: { id: "p", alias: "Local", executable }, dataHome, configHome, runnerId: "local", assertInput, bindingFor: id => persisted.get(id), factory });
  const input = (id = "a", path = a): CliStartInput => {
    const selection: ExecutionSelection = { version:1,mode:"manual",selectionType:"explicit-model",source:"explicit",profileId:"p",providerId:"devin-local",backendId:"devin-local-acp",runnerId:"local",configRevision:1,contextFingerprint:"fixture",selectedAt:"2026-10-13T00:00:00.000Z",requestedModel:"chosen",nativeParameters:{} };
    return { executable, args: [], workspacePath: path, executionRef: { version: 1, id, kind: "managed-worktree", runnerId: "local", repositoryId: "repo", workspaceId: id, pathRef: "workspace:" + id, branch: "codex/" + id, baseRevision: "base" }, nativeInput: { version: 1, profileId: "p", backendId: "devin-local-acp", runId: "run-" + id, sessionId: "session-" + id, commandId: "observer-" + id, newSession: true, prompt: "literal", approveTools: false, executionSelection: selection }, beforePrompt: () => {}, onBinding: async binding => { persisted.set(binding.nativeSessionId, binding); } };
  };
  return { root, a, b, executable, dataHome, configHome, runtime, input, factory, assertInput, entries, persisted, setUnknown: () => { unknown = true; }, setWrongStore: () => { wrongStore = true; } };
}
it("lazily owns each exact managed execution without borrowing read/control qualification", async () => {
  const f = fixture(); expect(f.factory).not.toHaveBeenCalled();
  const a = f.runtime.start(f.input()), b = f.runtime.start(f.input("b", f.b)); await Promise.all([a.ready!(), b.ready!()]);
  expect(f.entries.map(e => e.scope.workspacePath)).toEqual([f.a, f.b]); expect(f.persisted.size).toBe(2);
  expect(f.runtime.source(f.persisted.get("native-a")!)).toBeUndefined(); expect(f.runtime.diagnostics("native-a")).toEqual({ executionRefId: "a", localConnection: "open" });
  expect(f.runtime.hasUnclosedHosts()).toBe(true); await f.runtime.disconnectLocal(); expect(f.runtime.hasUnclosedHosts()).toBe(false);
});
it.each(["missing", "remote", "resume", "cloud", "model", "executable", "reserved"])("refuses %s before allocation", mode => {
  const f = fixture(), input = f.input();
  if (mode === "missing") delete input.executionRef;
  if (mode === "remote") input.executionRef!.runnerId = "remote";
  if (mode === "resume") input.nativeInput!.newSession = false;
  if (mode === "cloud") input.nativeInput!.backendId = "devin-organization-api";
  if (mode === "model") input.nativeInput!.executionSelection!.providerId = "devin";
  if (mode === "executable") input.executable = "/foreign";
  if (mode === "reserved") input.nativeInput!.providerSessionId = "foreign";
  expect(() => f.runtime.start(input)).toThrow(expect.objectContaining({ creationOutcome: "not-created" })); expect(f.factory).not.toHaveBeenCalled();
});
it("captures original input and guards before host acquisition awaits", async () => {
  const f = fixture(), input = f.input(), turn = f.runtime.start(input); input.nativeInput!.prompt = "changed"; input.executionRef!.id = "foreign"; input.beforePrompt = () => { throw Error("replacement"); };
  await turn.ready!(); expect(f.entries[0]!.starts.mock.calls[0]![0]).toMatchObject({ nativeInput: { prompt: "literal" }, executionRef: { id: "a" } }); await f.runtime.disconnectLocal();
});
it.each(["dataHome", "configHome", "a"] as const)("refuses replaced physical %s at queued admission", async field => {
  const f = fixture(), turn = f.runtime.start(f.input()); renameSync(f[field], f[field] + "-old"); mkdirSync(f[field]);
  await expect(turn.ready!()).rejects.toMatchObject({ code: "DEVIN_ACP_SCOPE_CHANGED" }); expect(f.entries[0]!.starts).not.toHaveBeenCalled(); await f.runtime.disconnectLocal();
});
it("rejects stale canonical authority before allocation", () => {
  const f = fixture(); f.assertInput.mockImplementation(() => { throw Error("scope changed"); });
  expect(() => f.runtime.start(f.input())).toThrow(expect.objectContaining({ code: "DEVIN_ACP_SCOPE_CHANGED" })); expect(f.factory).not.toHaveBeenCalled();
});
it("does not let a refused duplicate cancel the original producer", async () => {
  const f = fixture(), original = f.runtime.start(f.input()); await original.ready!(); const duplicate = f.runtime.start(f.input());
  await expect(duplicate.ready!()).rejects.toMatchObject({ code: "DEVIN_ACP_SESSION_ALREADY_ADMITTED" }); await duplicate.cancel(); expect(f.entries[0]!.disconnect).not.toHaveBeenCalled(); await f.runtime.disconnectLocal();
});
it("cancels acquisition before producer admission without creating native identity", async () => {
  const f = fixture(), turn = f.runtime.start(f.input()); await turn.cancel(); await expect(turn.ready!()).rejects.toMatchObject({ code: "DEVIN_ACP_LOCAL_CONNECTION_CLOSED" }); expect(f.persisted.size).toBe(0); expect(f.entries[0]!.starts).not.toHaveBeenCalled(); await f.runtime.disconnectLocal();
});
it("checks custom factory native store before original binding persistence", async () => {
  const f = fixture(); f.setWrongStore(); const turn = f.runtime.start(f.input());
  await expect(turn.ready!()).rejects.toMatchObject({ code: "DEVIN_ACP_IDENTITY_CHANGED" }); expect(f.persisted.size).toBe(0); await f.runtime.disconnectLocal();
});
it("retains forbidden canonical async Guard drain without allocating a host", async () => {
  const f = fixture(); f.assertInput.mockImplementation(() => new Promise<void>(() => {}));
  expect(() => f.runtime.start(f.input())).toThrow(expect.objectContaining({ code: "DEVIN_ACP_SCOPE_CHANGED" })); expect(f.factory).not.toHaveBeenCalled();
  expect(await f.runtime.disconnectLocal()).toMatchObject([expect.objectContaining({ ownedRoot: "not-created", callbacks: "unknown", product: "devin-local" })]); expect(f.runtime.hasUnclosedHosts()).toBe(true);
});
it("retains forbidden original async Guard drain after queued admission", async () => {
  const f = fixture(), input = f.input(); input.beforePrompt = (() => new Promise<void>(() => {})) as unknown as () => void;
  const turn = f.runtime.start(input); await expect(turn.ready!()).rejects.toMatchObject({ code: "DEVIN_ACP_AUTHORITY_CHANGED" }); expect(f.persisted.size).toBe(0);
  expect((await f.runtime.disconnectLocal()).some(receipt => receipt.callbacks === "unknown")).toBe(true); expect(f.runtime.hasUnclosedHosts()).toBe(true);
});
it("unknown cleanup remains idempotent and blocks runtime replacement", async () => {
  const f = fixture(), turn = f.runtime.start(f.input()); await turn.ready!(); f.setUnknown(); const first = await f.runtime.disconnectLocal();
  expect(first).toMatchObject([expect.objectContaining({ connection: "unknown", ownedRoot: "unknown", callbacks: "unknown" })]); expect(f.runtime.hasUnclosedHosts()).toBe(true); expect(await f.runtime.disconnectLocal()).toEqual(first); expect(f.entries[0]!.disconnect).toHaveBeenCalledOnce();
});
it("never-started closure allocates no host or fake native Session", async () => {
  const f = fixture(); expect(await f.runtime.disconnectLocal()).toEqual([]); expect(f.factory).not.toHaveBeenCalled(); expect(f.runtime.hasUnclosedHosts()).toBe(false);
});
it("retains its own binding callback despite a factory reporting drained cleanup", async () => {
  const f = fixture(), input = f.input(); let invoked = false;
  input.onBinding = () => { invoked = true; return new Promise<void>(() => {}); };
  const turn = f.runtime.start(input); void turn.ready!().catch(() => {}); void turn.result().catch(() => {});
  await vi.waitFor(() => expect(invoked).toBe(true));
  expect((await f.runtime.disconnectLocal()).some(receipt => receipt.callbacks === "unknown")).toBe(true); expect(f.runtime.hasUnclosedHosts()).toBe(true);
});
it("keeps creation unknown when original binding persistence revokes canonical authority", async () => {
  const f = fixture(), input = f.input();
  input.onBinding = async binding => { f.persisted.set(binding.nativeSessionId, binding); f.assertInput.mockImplementation(() => { throw Error("revoked"); }); };
  const turn = f.runtime.start(input);
  await expect(turn.ready!()).rejects.toMatchObject({ code: "DEVIN_ACP_SCOPE_CHANGED", creationOutcome: "unknown" });
  expect(f.persisted.has("native-a")).toBe(true); await f.runtime.disconnectLocal();
});
it("refuses factory readiness without original binding persistence", async () => {
  const f = fixture({ skipBinding: true }), turn = f.runtime.start(f.input());
  await expect(turn.ready!()).rejects.toMatchObject({ code: "DEVIN_ACP_IDENTITY_CHANGED", creationOutcome: "unknown" });
  expect(f.persisted.size).toBe(0); await f.runtime.disconnectLocal();
});
it.each(["foreign", "missing"] as const)("refuses a completed factory result with %s native identity", async resultId => {
  const f = fixture({ resultId }), turn = f.runtime.start(f.input()); await turn.ready!();
  await expect(turn.result()).rejects.toMatchObject({ code: "DEVIN_ACP_IDENTITY_CHANGED", creationOutcome: "unknown" }); await f.runtime.disconnectLocal();
});
it("owns forbidden native consumer drain despite factory cleanup claims", async () => {
  const f = fixture({ nativeEvent: true }), input = f.input();
  input.onNativeEvent = (() => new Promise<void>(() => {})) as unknown as NonNullable<CliStartInput["onNativeEvent"]>;
  const turn = f.runtime.start(input);
  await expect(turn.ready!()).rejects.toMatchObject({ code: "DEVIN_ACP_CALLBACK_FAILED", creationOutcome: "unknown" });
  expect((await f.runtime.disconnectLocal()).some(receipt => receipt.callbacks === "unknown")).toBe(true); expect(f.runtime.hasUnclosedHosts()).toBe(true);
});
it("fences original native consumers after turn cancellation", async () => {
  const f = fixture(), input = f.input(); input.onNativeEvent = vi.fn(); const turn = f.runtime.start(input); await turn.ready!(); await turn.cancel();
  await expect(Promise.resolve().then(() => f.entries[0]!.starts.mock.calls[0]![0].onNativeEvent!({ state: "running", observedAt: "2026-10-13T00:00:00.000Z", nativeSessionId: "native-a" }))).rejects.toMatchObject({ creationOutcome: "unknown" });
  expect(input.onNativeEvent).not.toHaveBeenCalled(); await f.runtime.disconnectLocal();
});
it("refuses readiness while a factory ignores unfinished original persistence", async () => {
  const f = fixture({ unawaitedBinding: true }), input = f.input(); input.onBinding = () => new Promise<void>(() => {});
  const turn = f.runtime.start(input);
  await expect(turn.ready!()).rejects.toMatchObject({ code: "DEVIN_ACP_IDENTITY_CHANGED", creationOutcome: "unknown" });
  expect((await f.runtime.disconnectLocal()).some(receipt => receipt.callbacks === "unknown")).toBe(true);
});

it("awaits legitimate deferred native running and terminal durability", async () => {
  const f=fixture({nativeEvent:true}),input=f.input(),running=Promise.withResolvers<void>(),terminal=Promise.withResolvers<void>();let entered=0;
  input.onNativeEvent=async fact=>{entered++;await (fact.state==='running'?running.promise:terminal.promise);};
  const turn=f.runtime.start(input);await vi.waitFor(()=>expect(entered).toBe(1));let ready=false;void turn.ready!().then(()=>{ready=true;},()=>{});await Promise.resolve();expect(ready).toBe(false);
  running.resolve();await turn.ready!();
  const native=f.entries[0]!.starts.mock.calls[0]![0],ack=native.onNativeEvent!({state:'completed',observedAt:'2026-10-24T00:00:00Z',nativeSessionId:'native-a'});
  let completed=false,resultCompleted=false;void Promise.resolve(ack).then(()=>{completed=true;},()=>{});const result=turn.result();void result.then(()=>{resultCompleted=true;},()=>{});await vi.waitFor(()=>expect(entered).toBe(2));expect(completed).toBe(false);expect(resultCompleted).toBe(false);terminal.resolve();await ack;
  expect((await result).state).toBe('completed');await f.runtime.disconnectLocal();
});
it("rechecks the durable association after async binding persistence",async()=>{
 const f=fixture(),input=f.input();input.onBinding=async()=>{await Promise.resolve();};const turn=f.runtime.start(input);
 await expect(turn.ready!()).rejects.toMatchObject({creationOutcome:'unknown',code:'DEVIN_ACP_IDENTITY_CHANGED'});expect(f.persisted.size).toBe(0);await f.runtime.disconnectLocal();
});

function exactBinding(f:ReturnType<typeof fixture>,id='native-a'):NativeBinding {
 const {scope,reference}=f.entries[0]!;return {version:1,product:'devin-local',region:'global',profileId:scope.profileId,backendId:'devin-local-acp',runnerId:scope.runnerId,nativeStoreRef:scope.nativeStoreRef,nativeSessionId:id,identityState:'bound',executionRefId:reference.id};
}
function controlledTurn(ready:Promise<void>,id='native-a') {
 void ready.catch(()=>{});return {ready:()=>ready,status:()=> 'completed' as const,result:async()=>{await ready;return {state:'completed' as const,summary:'fixture',providerSessionId:id,events:[]};},cancel:async()=>{}};
}
it.each(['product','region','profileId','backendId','runnerId','nativeStoreRef','executionRefId','identityState','nativeThreadId','parentSessionId','version'])(
 'rejects the complete foreign binding tuple before original persistence: %s',async field=>{
 const f=fixture(),input=f.input(),persist=vi.fn(input.onBinding);input.onBinding=persist;const turn=f.runtime.start(input);
 f.entries[0]!.starts.mockImplementation(native=>controlledTurn(Promise.resolve().then(async()=>{await native.onBinding!({...exactBinding(f),[field]:'foreign'});})));await expect(turn.ready!()).rejects.toMatchObject({creationOutcome:'unknown',code:'DEVIN_ACP_IDENTITY_CHANGED'});expect(persist).not.toHaveBeenCalled();await f.runtime.disconnectLocal();
});
it.each(['','x'.repeat(513),'native\0id','native\nid','native\u007fid','unstarted:reserved'])(
 'rejects malformed or reserved opaque identity %j',async id=>{
 const f=fixture(),input=f.input(),persist=vi.fn(input.onBinding);input.onBinding=persist;const turn=f.runtime.start(input);
 f.entries[0]!.starts.mockImplementation(native=>controlledTurn(Promise.resolve().then(async()=>{await native.onBinding!(exactBinding(f,id));}),id));await expect(turn.ready!()).rejects.toMatchObject({creationOutcome:'unknown'});expect(persist).not.toHaveBeenCalled();await f.runtime.disconnectLocal();
});
it.each(['x','native-\u2028-\u2029-exact','x'.repeat(512)])('preserves exact opaque identity %j without a provider prefix grammar',async id=>{
 const f=fixture(),turn=f.runtime.start(f.input());f.entries[0]!.starts.mockImplementation(native=>controlledTurn(Promise.resolve().then(async()=>{await native.onBinding!(exactBinding(f,id));}),id));await turn.ready!();expect((await turn.result()).providerSessionId).toBe(id);expect(f.persisted.get(id)!.nativeSessionId).toBe(id);expect(f.runtime.source(f.persisted.get(id)!)).toBeUndefined();await f.runtime.disconnectLocal();
});
it.each(['undefined-owned','cloud','legacy','native-default','parameters','args','environment','approveTools','runId','sessionId','commandId'])(
 'rejects noncanonical input before factory: %s',mode=>{
 const f=fixture(),input=f.input(),n=input.nativeInput!,selection=n.executionSelection!;
 if(mode==='undefined-owned')Object.assign(n,{providerSessionId:undefined});if(mode==='cloud')selection.providerId='devin';if(mode==='legacy'){selection.mode='legacy';selection.source='legacy-config';}if(mode==='native-default'){selection.selectionType='native-default';selection.source='native-default';delete selection.requestedModel;}if(mode==='parameters')selection.nativeParameters={reasoningEffort:'high'};
 if(mode==='args')input.args=['override'];if(mode==='environment')input.environment={X:'override'};if(mode==='approveTools')n.approveTools=true;if(['runId','sessionId','commandId'].includes(mode))Object.assign(n,{[mode]:''});expect(()=>f.runtime.start(input)).toThrowError(expect.objectContaining({creationOutcome:'not-created'}));expect(f.factory).not.toHaveBeenCalled();
});
it.each(['assertInput','beforePrompt'] as const)('normalizes forbidden %s thenables and throwing getters once, retaining raw work',async boundary=>{
 for(const throwing of [false,true]){
  const f=fixture(),held=Promise.withResolvers<void>();let getters=0,assimilations=0;
  const returned={get then(){getters++;if(throwing)throw Error('private getter');return (resolve:()=>void,reject:(reason:unknown)=>void)=>{assimilations++;void held.promise.then(resolve,reject);};}};
  const input=f.input();if(boundary==='assertInput')f.assertInput.mockReturnValue(returned);else input.beforePrompt=()=>returned as never;
  if(boundary==='assertInput')expect(()=>f.runtime.start(input)).toThrowError(expect.objectContaining({code:'DEVIN_ACP_SCOPE_CHANGED'}));else {const turn=f.runtime.start(input);await expect(turn.ready!()).rejects.toMatchObject({code:'DEVIN_ACP_AUTHORITY_CHANGED'});}
  if(!throwing){expect(f.runtime.hasActiveOperations()).toBe(true);const receipt=await f.runtime.disconnectLocal();expect(receipt.some(r=>r.callbacks==='unknown')).toBe(true);held.reject(Error('late private rejection'));await vi.waitFor(()=>expect(f.runtime.hasActiveOperations()).toBe(false));expect(await f.runtime.disconnectLocal()).toEqual(receipt);}else await f.runtime.disconnectLocal();
  expect(getters).toBe(1);expect(assimilations).toBe(throwing?0:1);
 }
});
it('enforces Guard capacity before calling another original authority callback',async()=>{
 const f=fixture(),held=Promise.withResolvers<void>();f.assertInput.mockReturnValue(held.promise);
 for(let i=0;i<64;i++)expect(()=>f.runtime.start(f.input())).toThrow();expect(f.assertInput).toHaveBeenCalledTimes(64);
 expect(()=>f.runtime.start(f.input())).toThrowError(expect.objectContaining({code:'DEVIN_ACP_CALLBACK_LIMIT'}));expect(f.assertInput).toHaveBeenCalledTimes(64);expect(f.factory).not.toHaveBeenCalled();const receipt=await f.runtime.disconnectLocal();held.resolve();await vi.waitFor(()=>expect(f.runtime.hasActiveOperations()).toBe(false));expect(await f.runtime.disconnectLocal()).toEqual(receipt);
});
it('enforces beforePrompt capacity before invoking the original callback',async()=>{
 const f=fixture(),input=f.input(),guard=vi.fn();input.beforePrompt=guard;const turn=f.runtime.start(input);await turn.ready!();const held=Promise.withResolvers<void>();
 const native=f.entries[0]!.starts.mock.calls[0]![0];
 const capturedGuard=native.beforePrompt!;f.assertInput.mockReturnValue(held.promise);
 for(let i=0;i<64;i++)expect(()=>f.runtime.start(f.input())).toThrow();const calls=guard.mock.calls.length;expect(()=>capturedGuard()).toThrowError(expect.objectContaining({code:'DEVIN_ACP_CALLBACK_LIMIT'}));expect(guard).toHaveBeenCalledTimes(calls);
 const receipt=await f.runtime.disconnectLocal();held.resolve();await vi.waitFor(()=>expect(f.runtime.hasActiveOperations()).toBe(false));expect(await f.runtime.disconnectLocal()).toEqual(receipt);
});
it.each(['binding','native'] as const)('retains original %s callback through bounded public failure and immutable cached cleanup',async phase=>{
 const f=fixture({nativeEvent:phase==='native'}),input=f.input(),held=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>();
 if(phase==='binding')input.onBinding=async binding=>{f.persisted.set(binding.nativeSessionId,binding);entered.resolve();await held.promise;};else input.onNativeEvent=async()=>{entered.resolve();await held.promise;};
 const turn=f.runtime.start(input);await entered.promise;expect(f.runtime.hasActiveOperations()).toBe(true);await expect(turn.ready!()).rejects.toMatchObject({creationOutcome:'unknown',code:phase==='binding'?'DEVIN_ACP_BINDING_FAILED':'DEVIN_ACP_CALLBACK_FAILED'});await expect(turn.result()).rejects.toThrow();expect(f.runtime.hasActiveOperations()).toBe(true);
 const receipt=await f.runtime.disconnectLocal();const own=receipt.find(row=>row.callbacks==='unknown'&&row.executionRefId===undefined)!;expect(own).toMatchObject({callbacks:'unknown',backgroundTools:'unknown',nativeSessionDeleted:false});own.callbacks='drained';held.reject(Error('late private sink rejection'));await vi.waitFor(()=>expect(f.runtime.hasActiveOperations()).toBe(false));expect((await f.runtime.disconnectLocal()).some(row=>row.callbacks==='unknown')).toBe(true);expect(f.entries[0]!.disconnect).toHaveBeenCalledOnce();
});
it('waits for a custom factory native callback even if the factory ignores its Promise',async()=>{
 const f=fixture(),input=f.input(),held=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>();input.onNativeEvent=async()=>{entered.resolve();await held.promise;};const turn=f.runtime.start(input);
 f.entries[0]!.starts.mockImplementation(native=>controlledTurn(Promise.resolve().then(async()=>{await native.onBinding!(exactBinding(f));void Promise.resolve(native.onNativeEvent!({state:'running',observedAt:'now',nativeSessionId:'native-a'})).catch(()=>{});})));await entered.promise;
 await expect(turn.ready!()).rejects.toMatchObject({code:'DEVIN_ACP_CALLBACK_FAILED',creationOutcome:'unknown'});expect(f.runtime.hasActiveOperations()).toBe(true);const receipt=await f.runtime.disconnectLocal();expect(receipt.some(row=>row.callbacks==='unknown')).toBe(true);held.resolve();await vi.waitFor(()=>expect(f.runtime.hasActiveOperations()).toBe(false));expect(await f.runtime.disconnectLocal()).toEqual(receipt);
});
it('sanitizes a deferred native sink rejection and fences result success',async()=>{
 const f=fixture({nativeEvent:true}),input=f.input(),held=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>();input.onNativeEvent=async()=>{entered.resolve();await held.promise;};const turn=f.runtime.start(input);await entered.promise;held.reject(Error('private credential rejection'));
 await expect(turn.ready!()).rejects.toMatchObject({creationOutcome:'unknown',code:'DEVIN_ACP_CALLBACK_FAILED',message:'DEVIN_ACP_CALLBACK_FAILED'});await expect(turn.result()).rejects.toThrow('DEVIN_ACP_CALLBACK_FAILED');await f.runtime.disconnectLocal();
});
it.each(['authority','dataHome','configHome','workspace','lookup'] as const)('rechecks %s after owning deferred native persistence',async mode=>{
 const f=fixture({nativeEvent:true}),input=f.input(),held=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>();input.onNativeEvent=async()=>{entered.resolve();await held.promise;};const turn=f.runtime.start(input);await entered.promise;
 if(mode==='authority')f.assertInput.mockImplementation(()=>{throw Error('private revoked');});else if(mode==='lookup')f.persisted.delete('native-a');else {const path=mode==='workspace'?f.a:f[mode];renameSync(path,path+'.old');mkdirSync(path);}held.resolve();await expect(turn.ready!()).rejects.toMatchObject({creationOutcome:'unknown'});await expect(turn.result()).rejects.toThrow();await f.runtime.disconnectLocal();
});
it('rechecks physical and closure authority after the injected diagnostics lookup',async()=>{
 const f=fixture();let action:undefined|(()=>void)=undefined;const runtime=new DevinExecutionRuntime({profile:{id:'p',alias:'Local',executable:f.executable},dataHome:f.dataHome,configHome:f.configHome,runnerId:'local',assertInput:f.assertInput,bindingFor:id=>{const binding=f.persisted.get(id);action?.();return binding;},factory:f.factory});const turn=runtime.start(f.input());await turn.ready!();expect(runtime.diagnostics('native-a')).toEqual({executionRefId:'a',localConnection:'open'});action=()=>runtime.beginShutdown();expect(runtime.diagnostics('native-a')).toEqual({});await runtime.disconnectLocal();await f.runtime.disconnectLocal();
});
it('captures callbacks, their receivers and cloned data before options or caller mutation',async()=>{
 const f=fixture(),input=f.input();let owners=0,bindings=0,events=0;
 input.beforePrompt=function(){expect(this).toBe(input);};input.onBinding=function(binding){expect(this).toBe(input);bindings++;f.persisted.set(binding.nativeSessionId,structuredClone(binding));binding.runnerId='mutated';};input.onNativeEvent=function(){expect(this).toBe(input);events++;};
 const options={profile:{id:'p',alias:'Local',executable:f.executable},dataHome:f.dataHome,configHome:f.configHome,runnerId:'local',assertInput:function(this:unknown,received:CliStartInput){expect(this).toBe(options);owners++;expect(received.nativeInput!.prompt).toBe('literal');received.nativeInput!.prompt='mutated';received.executionRef!.id='mutated';received.args.push('mutated');},bindingFor:function(this:unknown,id:string){expect(this).toBe(options);return f.persisted.get(id);},factory:function(this:unknown,scope:DevinLocalAcpExecutionScope,ref:ExecutionContextRef){expect(this).toBe(options);return f.factory(scope,ref);}};
 const runtime=new DevinExecutionRuntime(options),turn=runtime.start(input);const replaced=vi.fn();input.beforePrompt=replaced;input.onBinding=replaced;input.onNativeEvent=replaced;input.nativeInput!.prompt='changed';input.nativeInput!.executionSelection!.requestedModel='changed';input.executionRef!.id='changed';input.args.push('changed');options.profile.executable='/missing';options.dataHome='/missing';options.runnerId='remote';options.assertInput=replaced;options.bindingFor=()=>undefined;options.factory=()=>{throw Error('changed');};
 await turn.ready!();const native=f.entries[0]!.starts.mock.calls[0]![0];await native.onNativeEvent!({state:'running',observedAt:'now',nativeSessionId:'native-a'});expect((await turn.result()).state).toBe('completed');expect(native.nativeInput!.prompt).toBe('literal');expect(owners).toBeGreaterThan(1);expect(bindings).toBe(1);expect(events).toBe(1);expect(replaced).not.toHaveBeenCalled();await runtime.disconnectLocal();await f.runtime.disconnectLocal();
});
it('reads getter-backed options and input values once',async()=>{
 const f=fixture(),input=f.input(),reads=new Map<string,number>();for(const key of Object.keys(input) as Array<keyof CliStartInput>){const value=input[key];Object.defineProperty(input,key,{enumerable:true,get(){reads.set(key,(reads.get(key)??0)+1);return value;}});}const turn=f.runtime.start(input);await turn.ready!();await turn.result();expect([...reads.values()].every(n=>n===1)).toBe(true);await f.runtime.disconnectLocal();
});
it('closes a reentrant factory result without admitting native creation',async()=>{
 const f=fixture(),original=f.factory.getMockImplementation()!;f.factory.mockImplementation((scope,ref)=>{const backend=original(scope,ref);f.runtime.beginShutdown();return backend;});const turn=f.runtime.start(f.input());await expect(turn.ready!()).rejects.toMatchObject({code:'DEVIN_ACP_LOCAL_CONNECTION_CLOSED'});expect(f.entries[0]!.starts).not.toHaveBeenCalled();expect(f.entries[0]!.disconnect).toHaveBeenCalledOnce();expect(await f.runtime.disconnectLocal()).toEqual([]);
});
it.each(['acquisition','ready','result'] as const)('retains actual pending %s after public shutdown',async phase=>{
 const f=fixture(),held=Promise.withResolvers<void>();let entered=false;
 const original=NativeRuntimeHosts.prototype.acquireRuntime;
 if(phase==='acquisition')vi.spyOn(NativeRuntimeHosts.prototype,'acquireRuntime').mockImplementation(async function(...args){const handle=await original.apply(this,args);entered=true;await held.promise;return handle;});
 const turn=f.runtime.start(f.input());if(phase==='ready')f.entries[0]!.starts.mockImplementation(()=>{entered=true;return controlledTurn(held.promise);});
 if(phase==='result'){
  f.entries[0]!.starts.mockImplementation(native=>{
   const ready=Promise.resolve().then(async()=>{await native.onBinding!(exactBinding(f));});
   return {...controlledTurn(ready),result:async()=>{entered=true;await held.promise;return {state:'completed',providerSessionId:'native-a',summary:'fixture',events:[]};}};
  });await turn.ready!();
 }
 let work:Promise<unknown>|undefined;if(phase==='result')work=turn.result();else work=turn.ready!();void work.catch(()=>{});await vi.waitFor(()=>expect(entered).toBe(true));expect(turn.ready!()).toBe(turn.ready!());f.runtime.beginShutdown();await expect(work).rejects.toMatchObject({code:'DEVIN_ACP_LOCAL_CONNECTION_CLOSED'});expect(f.runtime.hasActiveOperations()).toBe(true);const receipt=await f.runtime.disconnectLocal();held.resolve();await vi.waitFor(()=>expect(f.runtime.hasActiveOperations()).toBe(false));expect(await f.runtime.disconnectLocal()).toEqual(receipt);
});
it.each(['relative','missing','directory','not-executable'] as const)('asserts actual executable settings before runtime allocation: %s',mode=>{
 const f=fixture();let executable=f.executable;if(mode==='relative')executable='devin';if(mode==='missing')executable+='.missing';if(mode==='directory')executable=f.a;if(mode==='not-executable')chmodSync(executable,0o600);expect(()=>assertDevinRuntimeSettings({id:'p',alias:'Local',executable},f.dataHome,f.configHome)).toThrowError(expect.objectContaining({creationOutcome:'not-created'}));expect(f.factory).not.toHaveBeenCalled();
});
it('uses the actual ACP producer and preserves original owned-root receipt facts',async()=>{
 const native=devinAcpFixture(roots),f=fixture(),input=f.input(),persisted=new Map<string,NativeBinding>();input.executable=native.scope.executable;input.workspacePath=native.scope.workspacePath;input.onBinding=async binding=>{persisted.set(binding.nativeSessionId,binding);};
 const runtime=new DevinExecutionRuntime({profile:{id:'p',alias:'Local',executable:native.scope.executable},dataHome:native.scope.dataHome,configHome:native.scope.configHome,runnerId:'local',assertInput:()=>{},bindingFor:id=>persisted.get(id)});
 try{const turn=runtime.start(input);await turn.ready!();expect((await turn.result()).providerSessionId).toBe('native-exact');expect(native.calls().filter(call=>call.method==='session/new')).toHaveLength(1);expect(runtime.source(persisted.get('native-exact')!)).toBeUndefined();const receipt=await runtime.disconnectLocal();expect(receipt[0]).toMatchObject({connection:'closed',ownedRoot:'exited',callbacks:'drained',backgroundTools:'unknown',nativeSessionDeleted:false,backendId:'devin-local-acp',executionRefId:'a'});expect(receipt[0]!.ownedRootPid).toBeGreaterThan(0);expect(existsSync(join(native.root,'started'))).toBe(true);expect(await runtime.disconnectLocal()).toEqual(receipt);}finally{await runtime.disconnectLocal();await f.runtime.disconnectLocal();}
});
it('consults actual producer raw activity after public shutdown while owning persistence remains entered',async()=>{
 const native=devinAcpFixture(roots),f=fixture(),input=f.input(),held=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>(),persisted=new Map<string,NativeBinding>();let producer:DevinLocalAcpExecutionBackend|undefined;
 input.executable=native.scope.executable;input.workspacePath=native.scope.workspacePath;input.onBinding=async binding=>{persisted.set(binding.nativeSessionId,binding);entered.resolve();await held.promise;};
 const runtime=new DevinExecutionRuntime({profile:{id:'p',alias:'Local',executable:native.scope.executable},dataHome:native.scope.dataHome,configHome:native.scope.configHome,runnerId:'local',assertInput:()=>{},bindingFor:id=>persisted.get(id),factory:(scope,executionRef)=>{producer=new DevinLocalAcpExecutionBackend({scope,executionRef});return producer;}});
 try{
  const turn=runtime.start(input);await entered.promise;runtime.beginShutdown();await expect(turn.ready!()).rejects.toMatchObject({creationOutcome:'unknown'});await expect(turn.result()).rejects.toThrow();
  expect(producer!.hasActiveOperations()).toBe(true);expect(runtime.hasActiveOperations()).toBe(true);const first=await runtime.disconnectLocal();expect(first.some(row=>row.callbacks==='unknown')).toBe(true);expect(runtime.hasActiveOperations()).toBe(true);const calls=native.calls().length;held.resolve();await vi.waitFor(()=>expect(producer!.hasActiveOperations()).toBe(false));await vi.waitFor(()=>expect(runtime.hasActiveOperations()).toBe(false));expect(native.calls()).toHaveLength(calls);expect(await runtime.disconnectLocal()).toEqual(first);expect(first[0]!.ownedRootPid).toBeGreaterThan(0);
 }finally{held.resolve();await runtime.disconnectLocal();await f.runtime.disconnectLocal();}
});
it.each(['binding','native'] as const)('reserves original %s callback drain before reentrant shutdown',async phase=>{
 const f=fixture({nativeEvent:phase==='native'}),input=f.input(),held=Promise.withResolvers<void>();let receipt:Promise<unknown>|undefined;
 if(phase==='binding')input.onBinding=binding=>{f.persisted.set(binding.nativeSessionId,binding);receipt=f.runtime.disconnectLocal();return held.promise;};else input.onNativeEvent=()=>{receipt=f.runtime.disconnectLocal();return held.promise;};
 const turn=f.runtime.start(input);await expect(turn.ready!()).rejects.toThrow();await vi.waitFor(()=>expect(receipt).toBeDefined());const first=await receipt as Array<{callbacks:string}>;expect(first[0]!.callbacks).toBe('drained');expect(first[1]!.callbacks).toBe('unknown');expect(f.runtime.hasActiveOperations()).toBe(true);held.resolve();await vi.waitFor(()=>expect(f.runtime.hasActiveOperations()).toBe(false));expect(await f.runtime.disconnectLocal()).toEqual(first);
});
it('does not replace a host registered by a reentrant factory admission',async()=>{
 const f=fixture(),factory=f.factory.getMockImplementation()!;let nested:ReturnType<DevinExecutionRuntime['start']>|undefined,once=false;
 f.factory.mockImplementation((scope,ref)=>{const backend=factory(scope,ref);if(!once){once=true;nested=f.runtime.start(f.input());}return backend;});const outer=f.runtime.start(f.input());await expect(outer.ready!()).rejects.toMatchObject({code:'DEVIN_ACP_SESSION_ALREADY_ADMITTED'});await nested!.ready!();expect((await nested!.result()).providerSessionId).toBe('native-a');expect(f.entries[0]!.starts).not.toHaveBeenCalled();expect(f.entries[0]!.disconnect).toHaveBeenCalledOnce();expect(f.entries[1]!.starts).toHaveBeenCalledOnce();await outer.cancel();expect(f.entries[1]!.disconnect).not.toHaveBeenCalled();await f.runtime.disconnectLocal();
});
it('rechecks canonical authority after durable lookup before invoking an original native consumer',async()=>{
 const f=fixture(),input=f.input(),sink=vi.fn();input.onNativeEvent=sink;let revoke=false;
 const runtime=new DevinExecutionRuntime({profile:{id:'p',alias:'Local',executable:f.executable},dataHome:f.dataHome,configHome:f.configHome,runnerId:'local',assertInput:f.assertInput,bindingFor:id=>{const binding=f.persisted.get(id);if(revoke)f.assertInput.mockImplementation(()=>{throw Error('private lookup revocation');});return binding;},factory:f.factory});
 const turn=runtime.start(input);await turn.ready!();revoke=true;await expect(f.entries[0]!.starts.mock.calls[0]![0].onNativeEvent!({state:'running',observedAt:'now',nativeSessionId:'native-a'})).rejects.toMatchObject({code:'DEVIN_ACP_SCOPE_CHANGED',creationOutcome:'unknown'});expect(sink).not.toHaveBeenCalled();await runtime.disconnectLocal();await f.runtime.disconnectLocal();
});
it('captures binding data before rechecking physical authority and invoking original persistence',async()=>{
 const f=fixture(),input=f.input(),persist=vi.fn(input.onBinding);input.onBinding=persist;const turn=f.runtime.start(input);
 f.entries[0]!.starts.mockImplementation(native=>controlledTurn(Promise.resolve().then(async()=>{const binding=exactBinding(f);Object.defineProperty(binding,'nativeSessionId',{enumerable:true,get(){renameSync(f.a,f.a+'.old');mkdirSync(f.a);return 'native-a';}});await native.onBinding!(binding);})));await expect(turn.ready!()).rejects.toMatchObject({creationOutcome:'unknown',code:'DEVIN_ACP_SCOPE_CHANGED'});expect(persist).not.toHaveBeenCalled();await f.runtime.disconnectLocal();
});
it('rejects a new public result waiter after shutdown before invoking producer work',async()=>{
 const f=fixture(),turn=f.runtime.start(f.input()),result=vi.fn(async()=>({state:'completed' as const,summary:'fixture',providerSessionId:'native-a',events:[]}));f.entries[0]!.starts.mockImplementation(native=>({...controlledTurn(Promise.resolve().then(async()=>{await native.onBinding!(exactBinding(f));})),result}));await turn.ready!();f.runtime.beginShutdown();await expect(turn.result()).rejects.toMatchObject({creationOutcome:'unknown',code:'DEVIN_ACP_LOCAL_CONNECTION_CLOSED'});expect(result).not.toHaveBeenCalled();await f.runtime.disconnectLocal();
});
it('reads original options and nested profile properties once before cloning',async()=>{
 const f=fixture(),profile={id:'p',alias:'Local',executable:f.executable},reads=new Map<string,number>(),options={profile,dataHome:f.dataHome,configHome:f.configHome,runnerId:'local',assertInput:f.assertInput,bindingFor:(id:string)=>f.persisted.get(id),factory:f.factory};
 for(const key of Object.keys(profile) as Array<keyof typeof profile>){const value=profile[key];Object.defineProperty(profile,key,{enumerable:true,get(){reads.set('profile.'+key,(reads.get('profile.'+key)??0)+1);return value;}});}
 for(const key of Object.keys(options) as Array<keyof typeof options>){const value=options[key];Object.defineProperty(options,key,{enumerable:true,get(){reads.set('options.'+key,(reads.get('options.'+key)??0)+1);return value;}});}
 const runtime=new DevinExecutionRuntime(options),turn=runtime.start(f.input());await turn.ready!();await turn.result();expect([...reads.values()].every(n=>n===1)).toBe(true);await runtime.disconnectLocal();await f.runtime.disconnectLocal();
});
it('preserves original host receipt facts alongside separately scoped runtime callback uncertainty',async()=>{
 const f=fixture({nativeEvent:true}),input=f.input(),held=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>();input.onNativeEvent=async()=>{entered.resolve();await held.promise;};const turn=f.runtime.start(input),entry=f.entries[0]!;
 entry.disconnect.mockResolvedValue({version:1,connection:'closed',ownedRoot:'exited',callbacks:'drained',backgroundTools:'unknown',nativeSessionDeleted:false,ownedRootPid:4321});await entered.promise;
 const first=await f.runtime.disconnectLocal();expect(first).toHaveLength(2);expect(first[0]).toMatchObject({version:1,connection:'closed',ownedRoot:'exited',callbacks:'drained',backgroundTools:'unknown',nativeSessionDeleted:false,ownedRootPid:4321,profileId:'p',backendId:'devin-local-acp',runnerId:'local',nativeStoreRef:entry.scope.nativeStoreRef,product:'devin-local',region:'global',ownership:'owned',executionRefId:'a'});expect(first[0]!.hostId).toEqual(expect.any(String));
 expect(first[1]).toEqual({version:1,connection:'closed',ownedRoot:'not-created',callbacks:'unknown',backgroundTools:'unknown',nativeSessionDeleted:false,profileId:'p',backendId:'devin-local-acp',runnerId:'local',nativeStoreRef:entry.scope.nativeStoreRef,product:'devin-local',region:'global',ownership:'owned'});
 expect(f.factory).toHaveBeenCalledOnce();expect(entry.disconnect).toHaveBeenCalledOnce();expect(f.runtime.hasUnclosedHosts()).toBe(true);expect(f.runtime.hasActiveOperations()).toBe(true);const original=structuredClone(first);first[0]!.ownedRootPid=1;first[1]!.callbacks='drained';held.resolve();await expect(turn.ready!()).rejects.toMatchObject({creationOutcome:'unknown'});await vi.waitFor(()=>expect(f.runtime.hasActiveOperations()).toBe(false));expect(await f.runtime.disconnectLocal()).toEqual(original);expect(entry.disconnect).toHaveBeenCalledOnce();expect(f.runtime.hasUnclosedHosts()).toBe(true);
});

it.each(['shutdown','cancel'] as const)('reports unknown for %s after session/new is written but before binding',async mode=>{
 const native=devinAcpFixture(roots,'create-ignore'),f=fixture(),input=f.input(),persist=vi.fn();input.executable=native.scope.executable;input.workspacePath=native.scope.workspacePath;input.onBinding=persist;
 const runtime=new DevinExecutionRuntime({profile:{id:'p',alias:'Local',executable:native.scope.executable},dataHome:native.scope.dataHome,configHome:native.scope.configHome,runnerId:'local',assertInput:()=>{},bindingFor:()=>undefined});
 try{
  const turn=runtime.start(input);await vi.waitFor(()=>expect(native.calls().filter(call=>call.method==='session/new')).toHaveLength(1));expect(persist).not.toHaveBeenCalled();
  const cancelled=mode==='cancel'?turn.cancel():undefined;if(mode==='shutdown')runtime.beginShutdown();
  await expect(turn.ready!()).rejects.toMatchObject({code:'DEVIN_ACP_LOCAL_CONNECTION_CLOSED',creationOutcome:'unknown'});await expect(turn.result()).rejects.toMatchObject({creationOutcome:'unknown'});await cancelled;
  const receipt=await runtime.disconnectLocal();expect(receipt[0]).toMatchObject({backgroundTools:'unknown',nativeSessionDeleted:false});expect(receipt[0]!.ownedRootPid).toBeGreaterThan(0);expect(persist).not.toHaveBeenCalled();expect(native.calls().filter(call=>call.method==='session/new')).toHaveLength(1);expect(await runtime.disconnectLocal()).toEqual(receipt);
 }finally{await runtime.disconnectLocal();await f.runtime.disconnectLocal();}
});
it.each(['shutdown','cancel'] as const)('retains proven not-created for %s before producer entry',async mode=>{
 const f=fixture(),turn=f.runtime.start(f.input()),cancelled=mode==='cancel'?turn.cancel():undefined;if(mode==='shutdown')f.runtime.beginShutdown();await expect(turn.ready!()).rejects.toMatchObject({code:'DEVIN_ACP_LOCAL_CONNECTION_CLOSED',creationOutcome:'not-created'});await expect(turn.result()).rejects.toMatchObject({creationOutcome:'not-created'});await cancelled;expect(f.entries[0]!.starts).not.toHaveBeenCalled();expect(f.persisted.size).toBe(0);await f.runtime.disconnectLocal();
});
function resultFixture(result:()=>CliTurnResult|Promise<CliTurnResult>){
 const f=fixture(),turn=f.runtime.start(f.input());f.entries[0]!.starts.mockImplementation(native=>({...controlledTurn(Promise.resolve().then(async()=>{await native.onBinding!(exactBinding(f));})),result:async()=>result()}));return {...f,turn};
}
const completedResult=():CliTurnResult=>({state:'completed',summary:'original',providerSessionId:'native-a',events:[]});
it('captures a changing result identity getter once before validating or returning it',async()=>{
 const shared=completedResult();let reads=0;Object.defineProperty(shared,'providerSessionId',{enumerable:true,get(){reads++;return reads<=3?'native-a':'foreign';}});const f=resultFixture(()=>shared);
 try{await f.turn.ready!();expect((await f.turn.result()).providerSessionId).toBe('native-a');expect(reads).toBe(1);}finally{await f.runtime.disconnectLocal();}
});
it('rejects the captured foreign result identity even if later getter reads would match',async()=>{
 const shared=completedResult();let reads=0;Object.defineProperty(shared,'providerSessionId',{enumerable:true,get(){return ++reads===1?'foreign':'native-a';}});const f=resultFixture(()=>shared);
 try{await f.turn.ready!();await expect(f.turn.result()).rejects.toMatchObject({code:'DEVIN_ACP_IDENTITY_CHANGED',creationOutcome:'unknown'});expect(reads).toBe(1);}finally{await f.runtime.disconnectLocal();}
});
it('validates only the result snapshot despite shared object mutation during awaited authority checks',async()=>{
 const shared=completedResult();let delivered=false,mutated=false;const f=resultFixture(()=>{delivered=true;return shared;});f.assertInput.mockImplementation(()=>{if(delivered&&!mutated){mutated=true;queueMicrotask(()=>{shared.providerSessionId='foreign';shared.summary='changed';shared.events.push({type:'activity',summary:'changed'});});}});
 try{await f.turn.ready!();expect(await f.turn.result()).toEqual(completedResult());expect(shared.providerSessionId).toBe('foreign');expect(mutated).toBe(true);}finally{await f.runtime.disconnectLocal();}
});
it('rechecks physical authority after result getter capture before publishing success',async()=>{
 const shared=completedResult(),f=resultFixture(()=>shared);let changed=false;Object.defineProperty(shared,'providerSessionId',{enumerable:true,get(){if(!changed){changed=true;renameSync(f.a,f.a+'.old');mkdirSync(f.a);}return 'native-a';}});
 try{await f.turn.ready!();await expect(f.turn.result()).rejects.toMatchObject({code:'DEVIN_ACP_SCOPE_CHANGED',creationOutcome:'unknown'});expect(changed).toBe(true);}finally{await f.runtime.disconnectLocal();}
});
it.each(['getter','uncloneable'] as const)('sanitizes %s result capture failure without publishing success',async mode=>{
 const shared=completedResult();if(mode==='getter')Object.defineProperty(shared,'providerSessionId',{enumerable:true,get(){throw Error('private result credential');}});else Object.assign(shared,{uncloneable:()=>{}});const f=resultFixture(()=>shared);
 try{await f.turn.ready!();await expect(f.turn.result()).rejects.toMatchObject({code:'DEVIN_ACP_CALLBACK_FAILED',creationOutcome:'unknown',message:'DEVIN_ACP_CALLBACK_FAILED'});}finally{await f.runtime.disconnectLocal();}
});
it('returns independent copies of the validated ordinary result snapshot',async()=>{
 const shared=completedResult(),f=resultFixture(()=>shared);try{await f.turn.ready!();const first=await f.turn.result();expect(first).toEqual(completedResult());shared.providerSessionId='foreign';shared.summary='changed';first.providerSessionId='caller-change';first.events.push({type:'activity',summary:'caller-change'});expect(await f.turn.result()).toEqual(completedResult());}finally{await f.runtime.disconnectLocal();}
});
