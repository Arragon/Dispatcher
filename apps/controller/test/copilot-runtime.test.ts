import { chmodSync, existsSync, statSync, readdirSync, symlinkSync, readFileSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { MemorySessionStore, type AdapterSession, CopilotExecutionBackend, type CopilotExecutionScope, type CliStartInput, type CliAgentProfile } from "@dispatcher/adapters";
import { CopilotAdapter } from "../../../packages/adapters/src/copilot-execution.js";
import { CopilotRpcClient } from "../../../packages/adapters/dist/copilot.js";
import type { ExecutionContextRef, ExecutionSelection, NativeBinding } from "@dispatcher/domain";
import { CopilotExecutionRuntime } from "../src/copilot-runtime.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function captureActualFixture(root: string, phase: string, receipt?: unknown): void {
 const destination = process.env.DISPATCHER_COPILOT_FIXTURE_EVIDENCE; if (!destination) return;
 const key = createHash("sha256").update(root).digest("hex"), output = join(destination, key, phase); mkdirSync(output, { recursive: true });
 const files: unknown[] = [];
 const visit = (directory: string) => { for (const name of readdirSync(directory)) { const path = join(directory, name), stat = statSync(path, { bigint: true }); if (stat.isDirectory()) visit(path); else if (stat.isFile()) {
  const bytes = readFileSync(path), fullPathHash = createHash("sha256").update(path).digest("hex"); writeFileSync(join(output, fullPathHash), bytes);
  files.push({ path, fullPathHash, dev: String(stat.dev), ino: String(stat.ino), mode: String(stat.mode), size: String(stat.size), mtimeNs: String(stat.mtimeNs), sha256: createHash("sha256").update(bytes).digest("hex") });
 } } }; visit(root);
 writeFileSync(join(output, "manifest.json"), JSON.stringify({ classification: "actual-default-owned-stdio-local-fake-child-not-provider-account", root, phase, utc: new Date().toISOString(), files, receipt }, null, 2));
}
function fixture(mode: { skipBinding?: boolean; unawaitedBinding?: boolean; resultId?: "foreign" | "missing"; nativeEvent?: boolean; revokeAfterBinding?: boolean } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "dispatcher-copilot-runtime-"))); roots.push(root);
  const a = join(root, "a"), b = join(root, "b"), copilotHome = join(root, "home"), executable = join(root, "copilot");
  for (const path of [a, b, copilotHome]) mkdirSync(path); writeFileSync(executable, "fixture", { mode: 0o755 });
  const persisted = new Map<string, NativeBinding>(), assertInput = vi.fn(); let unknown = false, wrongStore = false;
  const entries: Array<{ scope: CopilotExecutionScope; reference: ExecutionContextRef; backend: CopilotExecutionBackend; starts: ReturnType<typeof vi.spyOn>; disconnect: ReturnType<typeof vi.spyOn> }> = [];
  const factory = vi.fn((scope: CopilotExecutionScope, reference: ExecutionContextRef) => {
    const backend = new CopilotExecutionBackend({ scope, executionRef: reference });
    const starts = vi.spyOn(backend, "start").mockImplementation(input => {
      const ready = Promise.resolve().then(async () => {
        input.beforePrompt!();
        if (!mode.skipBinding) {
          const persisted = input.onBinding!({ version: 1, product: "copilot", region: "global", profileId: scope.profileId, backendId: "copilot-rpc", runnerId: scope.runnerId, nativeStoreRef: wrongStore ? "foreign-store" : scope.nativeStoreRef, nativeSessionId: "native-" + reference.id, identityState: "bound", executionRefId: reference.id });
          if (mode.revokeAfterBinding) assertInput.mockImplementation(() => { throw Error("revoked before queued persistence"); });
          if (mode.unawaitedBinding) void Promise.resolve(persisted).catch(() => {}); else await persisted;
        }
        if (mode.nativeEvent) input.onNativeEvent!({ state: "running", observedAt: "2026-10-13T00:00:00.000Z", nativeSessionId: "native-" + reference.id });
        input.beforePrompt!();
      }); void ready.catch(() => {});
      return { ready: () => ready, status: () => "completed", result: async () => { await ready; return { state: "completed", summary: "fixture", events: [], ...(mode.resultId === "missing" ? {} : { providerSessionId: mode.resultId === "foreign" ? "foreign" : "native-" + reference.id }) }; }, cancel: async () => { await backend.disconnectLocal(); } };
    });
    const disconnect = vi.spyOn(backend, "disconnectLocal").mockImplementation(async () => ({ version: 1, connection: unknown ? "unknown" : "closed", ownedRoot: unknown ? "unknown" : "not-created", callbacks: unknown ? "unknown" : "drained", backgroundTools: "unknown", nativeSessionDeleted: false }));
    entries.push({ scope, reference, backend, starts, disconnect }); return backend;
  });
  const runtime = new CopilotExecutionRuntime({ profile: { id: "p", alias: "Local", executable }, copilotHome, runnerId: "local", assertInput, bindingFor: id => persisted.get(id), factory });
  const input = (id = "a", path = a): CliStartInput => {
    const selection: ExecutionSelection = { version: 1, mode: "manual", selectionType: "explicit-model", source: "explicit", profileId: "p", providerId: "copilot", backendId: "copilot-rpc", runnerId: "local", requestedModel: "chosen", configRevision: 1, contextFingerprint: "fixture", selectedAt: "2026-10-13T00:00:00.000Z", nativeParameters: {} };
    return { executable, args: [], workspacePath: path, executionRef: { version: 1, id, kind: "managed-worktree", runnerId: "local", repositoryId: "repo", workspaceId: id, pathRef: "workspace:" + id, branch: "codex/" + id, baseRevision: "base" }, nativeInput: { version: 1, profileId: "p", backendId: "copilot-rpc", runId: "run-" + id, sessionId: "session-" + id, commandId: "observer-" + id, newSession: true, prompt: "literal", approveTools: false, executionSelection: selection }, beforePrompt: () => {}, onBinding: async binding => { persisted.set(binding.nativeSessionId, binding); } };
  };
  const options = { profile: { id: "p", alias: "Local", executable }, copilotHome, runnerId: "local", assertInput, bindingFor: (id: string) => persisted.get(id), factory };
  return { root, a, b, executable, copilotHome, runtime, input, factory, assertInput, entries, persisted, options, setUnknown: () => { unknown = true; }, setWrongStore: () => { wrongStore = true; } };
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
it("refuses an overwritten original executable before allocation", async () => {
  const f = fixture(); writeFileSync(f.executable, "different executable contents");
  expect(() => f.runtime.start(f.input())).toThrow(expect.objectContaining({ code: "COPILOT_RPC_SCOPE_CHANGED", creationOutcome: "not-created" }));
  expect(f.factory).not.toHaveBeenCalled(); await f.runtime.disconnectLocal();
});
it.each(["copilotHome", "a"] as const)("refuses replaced physical %s at queued admission", async field => {
  const f = fixture(), turn = f.runtime.start(f.input()); renameSync(f[field], f[field] + "-old"); mkdirSync(f[field]);
  await expect(turn.ready!()).rejects.toMatchObject({ code: "COPILOT_RPC_SCOPE_CHANGED" }); expect(f.entries[0]!.starts).not.toHaveBeenCalled(); await f.runtime.disconnectLocal();
});
it("rejects stale canonical authority before allocation", () => {
  const f = fixture(); f.assertInput.mockImplementation(() => { throw Error("scope changed"); });
  expect(() => f.runtime.start(f.input())).toThrow(expect.objectContaining({ code: "COPILOT_RPC_SCOPE_CHANGED" })); expect(f.factory).not.toHaveBeenCalled();
});
it("does not let a refused duplicate cancel the original producer", async () => {
  const f = fixture(), original = f.runtime.start(f.input()); await original.ready!(); const duplicate = f.runtime.start(f.input());
  await expect(duplicate.ready!()).rejects.toMatchObject({ code: "COPILOT_RPC_SESSION_ALREADY_ADMITTED" }); await duplicate.cancel(); expect(f.entries[0]!.disconnect).not.toHaveBeenCalled(); await f.runtime.disconnectLocal();
});
it("cancels acquisition before producer admission without creating native identity", async () => {
  const f = fixture(), turn = f.runtime.start(f.input()); await turn.cancel(); await expect(turn.ready!()).rejects.toMatchObject({ code: "COPILOT_RPC_LOCAL_CONNECTION_CLOSED" }); expect(f.persisted.size).toBe(0); expect(f.entries[0]!.starts).not.toHaveBeenCalled(); await f.runtime.disconnectLocal();
});
it("checks custom factory native store before original binding persistence", async () => {
  const f = fixture(); f.setWrongStore(); const turn = f.runtime.start(f.input());
  await expect(turn.ready!()).rejects.toMatchObject({ code: "COPILOT_RPC_IDENTITY_CHANGED" }); expect(f.persisted.size).toBe(0); await f.runtime.disconnectLocal();
});
it.each(["home", "workspace", "reference", "store"])("refuses a factory producer with foreign %s before host admission", async mode => {
  const f = fixture(), otherHome = join(f.root, "other-home"); mkdirSync(otherHome);
  f.factory.mockImplementation((scope, reference) => new CopilotExecutionBackend({ scope: { ...scope, ...(mode === "home" ? { copilotHome: otherHome } : mode === "workspace" ? { workspacePath: f.b } : mode === "store" ? { nativeStoreRef: "foreign" } : {}) }, executionRef: mode === "reference" ? { ...reference, branch: "codex/foreign" } : reference }));
  const turn = f.runtime.start(f.input());
  await expect(turn.ready!()).rejects.toMatchObject({ code: "COPILOT_RPC_SCOPE_CHANGED", creationOutcome: "not-created" });
  expect(f.persisted.size).toBe(0); expect(await f.runtime.disconnectLocal()).toEqual([]);
});
it("retains forbidden canonical async Guard drain without allocating a host", async () => {
  const f = fixture(); f.assertInput.mockImplementation(() => new Promise<void>(() => {}));
  expect(() => f.runtime.start(f.input())).toThrow(expect.objectContaining({ code: "COPILOT_RPC_SCOPE_CHANGED" })); expect(f.factory).not.toHaveBeenCalled();
  expect(await f.runtime.disconnectLocal()).toMatchObject([expect.objectContaining({ ownedRoot: "not-created", callbacks: "unknown", product: "copilot" })]); expect(f.runtime.hasUnclosedHosts()).toBe(true);
});
it("retains forbidden original async Guard drain after queued admission", async () => {
  const f = fixture(), input = f.input(); input.beforePrompt = (() => new Promise<void>(() => {})) as unknown as () => void;
  const turn = f.runtime.start(input); await expect(turn.ready!()).rejects.toMatchObject({ code: "COPILOT_RPC_AUTHORITY_CHANGED" }); expect(f.persisted.size).toBe(0);
  expect((await f.runtime.disconnectLocal()).some(receipt => receipt.callbacks === "unknown")).toBe(true); expect(f.runtime.hasUnclosedHosts()).toBe(true);
});
it("unknown cleanup remains idempotent and blocks runtime replacement", async () => {
  const f = fixture(), turn = f.runtime.start(f.input()); await turn.ready!(); f.setUnknown(); const first = await f.runtime.disconnectLocal();
  expect(first).toMatchObject([expect.objectContaining({ connection: "unknown", ownedRoot: "unknown", callbacks: "unknown" })]); expect(f.runtime.hasUnclosedHosts()).toBe(true); expect(await f.runtime.disconnectLocal()).toEqual(first); expect(f.entries[0]!.disconnect).toHaveBeenCalledOnce();
});
it.each([false, true])("does not equate closed admission with proven local connection closure (unknown=%s)", async unknown => {
  const f = fixture(), turn = f.runtime.start(f.input()); await turn.ready!(); if (unknown) f.setUnknown();
  f.runtime.beginShutdown(); expect(f.runtime.diagnostics("native-a")).toEqual({ executionRefId: "a", localConnection: "unknown" });
  await f.runtime.disconnectLocal(); expect(f.runtime.diagnostics("native-a")).toEqual({ executionRefId: "a", localConnection: unknown ? "unknown" : "closed" });
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
  await expect(turn.ready!()).rejects.toMatchObject({ code: "COPILOT_RPC_SCOPE_CHANGED", creationOutcome: "unknown" });
  expect(f.persisted.has("native-a")).toBe(true); await f.runtime.disconnectLocal();
});
it("refuses factory readiness without original binding persistence", async () => {
  const f = fixture({ skipBinding: true }), turn = f.runtime.start(f.input());
  await expect(turn.ready!()).rejects.toMatchObject({ code: "COPILOT_RPC_IDENTITY_CHANGED", creationOutcome: "unknown" });
  expect(f.persisted.size).toBe(0); await f.runtime.disconnectLocal();
});
it.each(["foreign", "missing"] as const)("refuses a completed factory result with %s native identity", async resultId => {
  const f = fixture({ resultId }), turn = f.runtime.start(f.input()); await turn.ready!();
  await expect(turn.result()).rejects.toMatchObject({ code: "COPILOT_RPC_IDENTITY_CHANGED", creationOutcome: "unknown" }); await f.runtime.disconnectLocal();
});
it("owns forbidden native consumer drain despite factory cleanup claims", async () => {
  const f = fixture({ nativeEvent: true }), input = f.input();
  input.onNativeEvent = (() => new Promise<void>(() => {})) as unknown as NonNullable<CliStartInput["onNativeEvent"]>;
  const turn = f.runtime.start(input);
  await expect(turn.ready!()).rejects.toMatchObject({ code: "COPILOT_RPC_CALLBACK_FAILED", creationOutcome: "unknown" });
  expect((await f.runtime.disconnectLocal()).some(receipt => receipt.callbacks === "unknown")).toBe(true); expect(f.runtime.hasUnclosedHosts()).toBe(true);
});
it("fences original native consumers after turn cancellation", async () => {
  const f = fixture(), input = f.input(); input.onNativeEvent = vi.fn(); const turn = f.runtime.start(input); await turn.ready!(); await turn.cancel();
  expect(() => f.entries[0]!.starts.mock.calls[0]![0].onNativeEvent!({ state: "running", observedAt: "2026-10-13T00:00:00.000Z", nativeSessionId: "native-a" })).toThrow(expect.objectContaining({ creationOutcome: "unknown" }));
  expect(input.onNativeEvent).not.toHaveBeenCalled(); await f.runtime.disconnectLocal();
});
it("refuses readiness while a factory ignores unfinished original persistence", async () => {
  const f = fixture({ unawaitedBinding: true }), input = f.input(); input.onBinding = () => new Promise<void>(() => {});
  const turn = f.runtime.start(input);
  await expect(turn.ready!()).rejects.toMatchObject({ code: "COPILOT_RPC_IDENTITY_CHANGED", creationOutcome: "unknown" });
  expect((await f.runtime.disconnectLocal()).some(receipt => receipt.callbacks === "unknown")).toBe(true);
});

it("reads caller getters once before cloning native selection", async () => {
  const f = fixture(), input = f.input(), first = structuredClone(input.nativeInput!); let reads = 0;
  Object.defineProperty(input, "nativeInput", { enumerable: true, get: () => { reads++; return reads === 1 ? first : { ...first, executionSelection: { ...first.executionSelection!, requestedModel: "replacement" } }; } });
  const turn = f.runtime.start(input); await turn.ready!();
  expect(reads).toBe(1); expect(f.entries[0]!.starts.mock.calls[0]![0].nativeInput!.executionSelection!.requestedModel).toBe("chosen"); await f.runtime.disconnectLocal();
});
it("captures original option getters once with their original callback receiver", async () => {
  const f = fixture(); let profileReads = 0, guardReads = 0, factoryReads = 0;
  const guard = vi.fn(function (this: unknown) { expect(this).toBe(options); });
  const options = { ...f.options, get profile(): CliAgentProfile { profileReads++; return profileReads === 1 ? f.options.profile : { ...f.options.profile, id: "replacement" }; }, get assertInput() { guardReads++; return guardReads === 1 ? guard : () => { throw Error("replacement"); }; }, get factory() { factoryReads++; return factoryReads === 1 ? f.factory : () => { throw Error("replacement"); }; } };
  const runtime = new CopilotExecutionRuntime(options), turn = runtime.start(f.input()); await turn.ready!();
  expect([profileReads, guardReads, factoryReads]).toEqual([1, 1, 1]); expect(guard).toHaveBeenCalled(); await runtime.disconnectLocal();
});
it("checks capacity before invoking a 65th asynchronous canonical guard", async () => {
  const f = fixture(), pending: Array<() => void> = [];
  f.assertInput.mockImplementation(() => new Promise<void>(resolve => pending.push(resolve)));
  for (let i = 0; i < 65; i++) expect(() => f.runtime.start(f.input())).toThrow();
  expect(f.assertInput).toHaveBeenCalledTimes(64); expect(f.factory).not.toHaveBeenCalled();
  for (const resolve of pending) resolve(); await Promise.resolve(); await Promise.resolve();
  expect(await f.runtime.disconnectLocal()).toEqual([]); expect(f.runtime.hasUnclosedHosts()).toBe(false);
});
it("rechecks authority inside queued original binding persistence", async () => {
  const f = fixture({ revokeAfterBinding: true }), turn = f.runtime.start(f.input());
  await expect(turn.ready!()).rejects.toMatchObject({ code: "COPILOT_RPC_SCOPE_CHANGED", creationOutcome: "unknown" });
  expect(f.persisted.size).toBe(0); await f.runtime.disconnectLocal();
});
it("does not advertise diagnostics against a replaced persisted tuple", async () => {
  const f = fixture(), turn = f.runtime.start(f.input()); await turn.ready!();
  const binding = f.persisted.get("native-a")!; f.persisted.set("native-a", { ...binding, nativeStoreRef: "replacement" });
  expect(f.runtime.diagnostics("native-a")).toEqual({}); await f.runtime.disconnectLocal();
});
it("keeps profile homes isolated in opaque native store identities", async () => {
  const f = fixture(), otherHome = join(f.root, "other-home"); mkdirSync(otherHome);
  const other = new CopilotExecutionRuntime({ ...f.options, copilotHome: otherHome });
  const a = f.runtime.start(f.input()), b = other.start(f.input("b", f.b)); await Promise.all([a.ready!(), b.ready!()]);
  expect(f.entries[0]!.scope.nativeStoreRef).not.toBe(f.entries[1]!.scope.nativeStoreRef);
  expect(f.entries.every(entry => !entry.scope.nativeStoreRef.includes(f.root))).toBe(true); await f.runtime.disconnectLocal(); await other.disconnectLocal();
});

it("routes the real owned producer through Runtime and Adapter before native input", async () => {
 const f = fixture();
 writeFileSync(f.executable,[
  "#!"+process.execPath,
  "const fs=require('node:fs'),path=require('node:path');const root="+JSON.stringify(f.root)+";let buffer=Buffer.alloc(0),sessionId,model;",
  "const frame=v=>{const body=Buffer.from(JSON.stringify(v));return Buffer.concat([Buffer.from('Content-Length: '+body.length+'\\r\\n\\r\\n'),body]);};",
  "const emit=v=>process.stdout.write(frame(v));const event=(type,data)=>({jsonrpc:'2.0',method:'session.event',params:{sessionId,event:{type,data}}});",
  "function respond(m){let result={};if(m.method==='connect')result={protocolVersion:3};else if(m.method==='status.get')result={protocolVersion:3,version:'1.0.97'};else if(m.method==='session.create'){sessionId=m.params.sessionId;model=m.params.model;result={sessionId};}",
  "else if(m.method==='session.getMetadata')result={session:{sessionId,startTime:'2026-10-13T00:00:00Z',modifiedTime:'2026-10-13T00:00:00Z',isRemote:false,context:{cwd:process.cwd()}}};else if(m.method==='session.model.getCurrent')result={modelId:model};",
  "else if(m.method==='session.send'){fs.writeFileSync(path.join(root,'native-input'),JSON.stringify({bindingPersisted:fs.existsSync(path.join(root,'persisted')),args:process.argv.slice(2),cwd:process.cwd(),home:process.env.COPILOT_HOME,sessionId}));const messageId='wire-1';process.stdout.write(Buffer.concat([frame({jsonrpc:'2.0',id:m.id,result:{messageId}}),frame(event('user.message',{messageId,content:m.params.prompt})),frame(event('assistant.message',{messageId:'answer-1',originatingMessageId:messageId,content:'private-native-output',model})),frame(event('session.idle',{}))]));return;}emit({jsonrpc:'2.0',id:m.id,result});}",
  "process.stdin.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);for(;;){const at=buffer.indexOf('\\r\\n\\r\\n');if(at<0)return;const size=Number(/Content-Length: (\\d+)/.exec(buffer.subarray(0,at).toString())[1]);if(buffer.length<at+4+size)return;const m=JSON.parse(buffer.subarray(at+4,at+4+size).toString());buffer=buffer.subarray(at+4+size);respond(m);}});setInterval(()=>{},1000);",
 ].join("\n"),{mode:0o755});chmodSync(f.executable,0o755);
 const runtime = new CopilotExecutionRuntime({ profile: f.options.profile, copilotHome: f.copilotHome, runnerId: "local", assertInput: f.assertInput, bindingFor: id => f.persisted.get(id) });
 class Store extends MemorySessionStore { override save(session: AdapterSession) { super.save(session); if (session.nativeBinding) { f.persisted.set(session.nativeBinding.nativeSessionId, session.nativeBinding); writeFileSync(join(f.root, "persisted"), "saved"); } } }
 const store = new Store(), adapter = new CopilotAdapter(f.options.profile, runtime, store), input = f.input(), observed: string[] = [];
 let active = true; const admission = vi.fn(() => { if (!active) throw Error("original managed owner revoked"); });
 adapter.setNativeEventSink(event => { admission(); expect(event).toMatchObject({ generation: 1, attempt: 1, leaseId: "lease" }); expect(f.persisted.get(event.nativeSessionId)).toEqual(event.nativeBinding); observed.push(event.turn.state); }, invocation => {
  expect(invocation).toMatchObject({ runId: "run", profileId: "p", backendId: "copilot-rpc", generation: 1, attempt: 1, leaseId: "lease" });
  expect(store.load(invocation.sessionId)).toMatchObject({ state: "STARTING", executionRef: input.executionRef, nativeInvocationId: invocation.invocationId });
  return () => active && store.load(invocation.sessionId)?.nativeInvocationId === invocation.invocationId;
 });
 writeFileSync(join(f.copilotHome, "native-file"), "preserve");
 captureActualFixture(f.root, "before-first-spawn");
 try {
  const session = await adapter.start({ runId: "run", sessionId: "dispatcher-session", workspacePath: f.a, prompt: "original-prompt", executionRef: input.executionRef!, executionSelection: input.nativeInput!.executionSelection!, execution: { generation: 1, attempt: 1, leaseId: "lease" }, beforeCreate: admission, beforeSend: admission, backendId: "copilot-rpc" });
  expect(session.nativeBinding?.nativeSessionId).toMatch(/^[a-f0-9-]{36}$/);
  expect(JSON.parse(readFileSync(join(f.root, "native-input"), "utf8"))).toMatchObject({ bindingPersisted: true, args: ["--headless", "--no-auto-update", "--stdio"], cwd: f.a, home: f.copilotHome, sessionId: session.nativeBinding?.nativeSessionId });
  expect(await adapter.result(session.id)).toMatchObject({ state: "COMPLETED" });
  expect(observed).toEqual(["waiting", "running", "completed"]); expect(admission).toHaveBeenCalled();
  expect(runtime.diagnostics(session.nativeBinding!.nativeSessionId)).toEqual({ executionRefId: "a", localConnection: "open" });
 } finally {
  active = false; const receipt = await runtime.disconnectLocal();
  expect(receipt).toMatchObject([expect.objectContaining({ connection: "closed", ownedRoot: "exited", callbacks: "drained", backgroundTools: "unknown", nativeSessionDeleted: false })]);
  captureActualFixture(f.root, "after-awaited-cleanup-before-teardown", receipt);
 }
 expect(runtime.hasUnclosedHosts()).toBe(false); expect(existsSync(join(f.copilotHome, "native-file"))).toBe(true);
});

it("releases cancelled waiters as unknown after actual producer entry before binding", async () => {
 const f = fixture(), entered = Promise.withResolvers<void>(), raw = Promise.withResolvers<CopilotRpcClient>();
 const open = vi.spyOn(CopilotRpcClient, "openExecution").mockImplementation(() => { entered.resolve(); return raw.promise; });
 const runtime = new CopilotExecutionRuntime({ ...f.options, factory: undefined }), turn = runtime.start(f.input());
 const ready = turn.ready!().catch(error => error), result = turn.result().catch(error => error);
 await entered.promise; const closing = turn.cancel();
 try {
  expect(await Promise.race([ready, new Promise(resolve => setTimeout(() => resolve("blocked waiter"), 100))])).toMatchObject({ creationOutcome: "unknown" });
  expect(await result).toMatchObject({ creationOutcome: "unknown" }); expect(runtime.hasActiveOperations()).toBe(true);
 } finally { raw.reject(Error("controlled acquisition rejected")); await closing; await runtime.disconnectLocal(); open.mockRestore(); }
});
it("snapshots producer result before awaited authority callbacks can mutate it", async () => {
 const f = fixture(), value = { state: "completed" as const, summary: "original", providerSessionId: "native-a", events: [] };
 const turn = f.runtime.start(f.input()); await turn.ready!();
 f.entries[0]!.starts.mock.results[0]!.value.result = async () => value;
 f.assertInput.mockImplementation(() => { value.summary = "mutated"; value.providerSessionId = "foreign"; });
 try { expect(await turn.result()).toMatchObject({ summary: "original", providerSessionId: "native-a" }); } finally { await f.runtime.disconnectLocal(); }
});

function wrapProducer(f: ReturnType<typeof fixture>, wrap: (input: CliStartInput, delegate: (input: CliStartInput) => ReturnType<CopilotExecutionBackend["start"]>) => ReturnType<CopilotExecutionBackend["start"]>): void {
 const original = f.factory.getMockImplementation()!;
 f.factory.mockImplementation((scope, reference) => { const backend = original(scope, reference), starts = f.entries.at(-1)!.starts, delegate = starts.getMockImplementation()!; starts.mockImplementation(input => wrap(input, delegate)); return backend; });
}
it.each(["selection-profile", "selection-provider", "selection-backend", "selection-runner", "legacy-mode", "native-default", "parameters", "legacyModel", "modelSelection", "args", "environment", "approve", "prompt-empty", "prompt-cap", "run", "session", "command"])("fences canonical %s before host allocation", mode => {
 const f = fixture(), input = f.input(), n = input.nativeInput!, selection = n.executionSelection!;
 if (mode === "selection-profile") selection.profileId = "foreign";
 if (mode === "selection-provider") selection.providerId = "devin";
 if (mode === "selection-backend") selection.backendId = "other";
 if (mode === "selection-runner") selection.runnerId = "remote";
 if (mode === "legacy-mode") { selection.mode = "legacy"; selection.source = "legacy-config"; }
 if (mode === "native-default") { selection.selectionType = "native-default"; selection.source = "native-default"; delete selection.requestedModel; }
 if (mode === "parameters") selection.nativeParameters = { reasoningEffort: "high" };
 if (mode === "legacyModel") Object.assign(n, { legacyModel: {} });
 if (mode === "modelSelection") Object.assign(n, { modelSelection: {} });
 if (mode === "args") input.args = ["--resume", "latest"];
 if (mode === "environment") input.environment = { COPILOT_HOME: "foreign" };
 if (mode === "approve") n.approveTools = true;
 if (mode === "prompt-empty") n.prompt = " ";
 if (mode === "prompt-cap") n.prompt = "a".repeat(196609);
 if (mode === "run") n.runId = "";
 if (mode === "session") n.sessionId = "bad\nidentity";
 if (mode === "command") n.commandId = "x".repeat(513);
 expect(() => f.runtime.start(input)).toThrow(expect.objectContaining({ creationOutcome: "not-created" })); expect(f.factory).not.toHaveBeenCalled();
});
it.each(["version", "product", "region", "profileId", "backendId", "runnerId", "nativeStoreRef", "identityState", "executionRefId", "nativeThreadId", "parentSessionId", "empty-id", "long-id", "control-id", "reserved-id"])("rejects foreign complete binding %s before persistence", async field => {
 const f = fixture(); wrapProducer(f, (input, delegate) => delegate({ ...input, onBinding: binding => {
  const changed = { ...binding, [field]: field === "version" ? 2 : "foreign" };
  if (field === "empty-id") changed.nativeSessionId = "";
  if (field === "long-id") changed.nativeSessionId = "x".repeat(513);
  if (field === "control-id") changed.nativeSessionId = "native\u007f";
  if (field === "reserved-id") changed.nativeSessionId = "unstarted:foreign";
  if (["empty-id", "long-id", "control-id", "reserved-id"].includes(field)) delete changed[field as keyof typeof changed];
  return input.onBinding!(changed as NativeBinding);
 } }));
 const turn = f.runtime.start(f.input()); await expect(turn.ready!()).rejects.toMatchObject({ creationOutcome: "unknown", code: "COPILOT_RPC_IDENTITY_CHANGED" }); expect(f.persisted.size).toBe(0); await f.runtime.disconnectLocal();
});
it("uses the configured alias for Controller authority and one physical executable for producer scope and input", async () => {
 const f = fixture(), alias = join(f.root, "alias"); symlinkSync(f.executable, alias);
 const assertInput = vi.fn((input: CliStartInput) => { expect(input.executable).toBe(alias); });
 const runtime = new CopilotExecutionRuntime({ ...f.options, profile: { ...f.options.profile, executable: alias }, assertInput });
 const input = f.input(); input.executable = alias; const turn = runtime.start(input); await turn.ready!();
 expect(f.entries[0]!.scope.executable).toBe(f.executable); expect(f.entries[0]!.starts.mock.calls[0]![0].executable).toBe(f.executable); expect(assertInput).toHaveBeenCalled(); await runtime.disconnectLocal();
});
it("rechecks executable alias identity after a callback replaces its target", async () => {
 const f = fixture(), alias = join(f.root, "alias"), other = join(f.root, "other"); symlinkSync(f.executable, alias); writeFileSync(other, "other", { mode: 0o755 });
 let replace = false; const runtime = new CopilotExecutionRuntime({ ...f.options, profile: { ...f.options.profile, executable: alias }, assertInput: () => { if (replace) { rmSync(alias); symlinkSync(other, alias); } } });
 replace = true; const input = f.input(); input.executable = alias; expect(() => runtime.start(input)).toThrow(expect.objectContaining({ creationOutcome: "not-created" })); expect(f.factory).not.toHaveBeenCalled(); await runtime.disconnectLocal();
});
it("rejects a nonexecutable regular file before producer allocation", () => {
 const f = fixture(); chmodSync(f.executable, 0o644); expect(() => f.runtime.start(f.input())).toThrow(); expect(f.factory).not.toHaveBeenCalled();
});
it("keeps a reentrant factory winner owned when the outer acquisition loses", async () => {
 const f = fixture(), original = f.factory.getMockImplementation()!; let winner: ReturnType<typeof f.runtime.start> | undefined;
 f.factory.mockImplementationOnce((scope, reference) => { winner = f.runtime.start(f.input()); return original(scope, reference); });
 const loser = f.runtime.start(f.input()); await expect(loser.ready!()).rejects.toMatchObject({ code: "COPILOT_RPC_SESSION_ALREADY_ADMITTED", creationOutcome: "not-created" });
 await winner!.ready!(); await loser.cancel(); expect(f.entries[0]!.disconnect).not.toHaveBeenCalled(); expect(f.persisted.has("native-a")).toBe(true); await f.runtime.disconnectLocal();
});
it.each(["beforePrompt", "onBinding", "onNativeEvent"] as const)("captures original %s receiver and getter once", async field => {
 const f = fixture({ nativeEvent: true }), input = f.input(); let reads = 0; const original = input[field];
 const callback = vi.fn(function (this: unknown, ...args: unknown[]) { expect(this).toBe(input); return (original as (...values: unknown[]) => unknown)?.(...args); });
 Object.defineProperty(input, field, { enumerable: true, get: () => { reads++; return callback; } });
 const turn = f.runtime.start(input); await turn.ready!(); await turn.result(); expect(reads).toBe(1); expect(callback).toHaveBeenCalled(); await f.runtime.disconnectLocal();
});
it("normalizes forbidden Guard thenables once and retains raw settlement after cancellation", async () => {
 const f = fixture(); let reads = 0, entered = 0, release!: () => void;
 f.assertInput.mockImplementation(() => ({ get then() { reads++; return (resolve: () => void) => { entered++; release = resolve; }; } }));
 expect(() => f.runtime.start(f.input())).toThrow(); await Promise.resolve(); expect([reads, entered]).toEqual([1, 1]); expect(f.runtime.hasActiveOperations()).toBe(true);
 const receipt = await f.runtime.disconnectLocal(); expect(receipt.some(row => row.callbacks === "unknown")).toBe(true); release(); await Promise.resolve(); await Promise.resolve();
 expect(await f.runtime.disconnectLocal()).toEqual(receipt); expect(f.runtime.hasUnclosedHosts()).toBe(true);
});
it("reserves raw callback capacity before synchronous Guard shutdown reentry", async () => {
 const f = fixture(), gate = Promise.withResolvers<void>(); let receipt!: Promise<unknown>;
 f.assertInput.mockImplementation(() => { receipt = f.runtime.disconnectLocal(); expect(f.runtime.hasActiveOperations()).toBe(true); return gate.promise; });
 expect(() => f.runtime.start(f.input())).toThrow(); expect(await receipt).toMatchObject([expect.objectContaining({ callbacks: "unknown", ownedRoot: "not-created" })]); gate.resolve();
});
it("allows legitimate async binding and event durability with original values", async () => {
 const f = fixture({ nativeEvent: true }), input = f.input(), facts: string[] = [];
 input.onBinding = async binding => { await Promise.resolve(); f.persisted.set(binding.nativeSessionId, binding); };
 input.onNativeEvent = async fact => { await Promise.resolve(); facts.push(fact.state); };
 const turn = f.runtime.start(input); await turn.ready!(); expect((await turn.result()).state).toBe("completed"); expect(facts).toEqual(["running"]); await f.runtime.disconnectLocal();
});
it.each(["binding", "running", "completed"] as const)("bounds blocked %s persistence and caches separate callback uncertainty", async phase => {
 const f = fixture({ nativeEvent: phase !== "binding" }), input = f.input(), gate = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
 if (phase === "binding") input.onBinding = binding => { f.persisted.set(binding.nativeSessionId, binding); entered.resolve(); return gate.promise; };
 else input.onNativeEvent = fact => { if (fact.state === phase) { entered.resolve(); return gate.promise; } };
 if (phase === "completed") wrapProducer(f, (producerInput, delegate) => { const turn = delegate(producerInput), original = turn.result.bind(turn); turn.result = async () => { const result = await original(); void Promise.resolve(producerInput.onNativeEvent!({ state: "completed", observedAt: "2026-10-25T00:00:00Z", nativeSessionId: "native-a" })).catch(() => {}); return result; }; return turn; });
 const turn = f.runtime.start(input), ready = turn.ready!().catch(error => error), result = turn.result().catch(error => error); await entered.promise;
 const outcome = await (phase === "completed" ? result : ready); expect(outcome).toMatchObject({ creationOutcome: "unknown" }); expect(f.runtime.hasActiveOperations()).toBe(true);
 const receipts = await f.runtime.disconnectLocal(); expect(receipts.some(row => row.callbacks === "unknown")).toBe(true); gate.resolve(); await result; await ready;
 expect(await f.runtime.disconnectLocal()).toEqual(receipts); expect(f.runtime.hasUnclosedHosts()).toBe(true);
});
it.each(["binding", "running", "completed"] as const)("fences rejected %s persistence without accepting completion", async phase => {
 const f = fixture({ nativeEvent: phase !== "binding" }), input = f.input();
 if (phase === "binding") input.onBinding = async () => { throw Error("rejected binding"); };
 else input.onNativeEvent = async fact => { if (fact.state === phase) throw Error("rejected event"); };
 if (phase === "completed") wrapProducer(f, (producerInput, delegate) => { const turn = delegate(producerInput), original = turn.result.bind(turn); turn.result = async () => { const result = await original(); void Promise.resolve(producerInput.onNativeEvent!({ state: "completed", observedAt: "2026-10-25T00:00:00Z", nativeSessionId: "native-a" })).catch(() => {}); return result; }; return turn; });
 const turn = f.runtime.start(input); if (phase !== "completed") await expect(turn.ready!()).rejects.toMatchObject({ creationOutcome: "unknown" });
 await expect(turn.result()).rejects.toMatchObject({ creationOutcome: "unknown" }); await f.runtime.disconnectLocal();
});
it("freezes getter-backed result once before awaiting pending terminal callback mutation", async () => {
 const f = fixture(), input = f.input(), entered = Promise.withResolvers<void>(), gate = Promise.withResolvers<void>(); let summaryReads = 0, idReads = 0, summary = "original", nativeId = "native-a", acquired = 0;
 const value = { state: "completed" as const, get summary() { summaryReads++; return summary; }, get providerSessionId() { idReads++; return nativeId; }, events: [] };
 input.onNativeEvent = async () => { entered.resolve(); await gate.promise; summary = "mutated"; nativeId = "foreign"; };
 const turn = f.runtime.start(input); await turn.ready!(); const inner = f.entries[0]!.starts.mock.results[0]!.value;
 inner.result = async () => { acquired++; void innerInput.onNativeEvent!({ state: "completed", observedAt: "2026-10-25T00:00:00Z", nativeSessionId: "native-a" }); return value; };
 const innerInput = f.entries[0]!.starts.mock.calls[0]![0], result = turn.result(); await entered.promise; await Promise.resolve(); gate.resolve();
 const first = await result; expect(first).toMatchObject({ summary: "original", providerSessionId: "native-a" }); first.summary = "caller";
 expect(await turn.result()).toMatchObject({ summary: "original", providerSessionId: "native-a" }); expect([summaryReads, idReads, acquired]).toEqual([1, 1, 1]); await f.runtime.disconnectLocal();
});
it("fences current binding getter reentry that shuts down the runtime", async () => {
 const f = fixture(); let shutdown = false; const runtime = new CopilotExecutionRuntime({ ...f.options, bindingFor: id => { if (shutdown) runtime.beginShutdown(); return f.persisted.get(id); } });
 const turn = runtime.start(f.input()); await turn.ready!(); shutdown = true; await expect(turn.result()).rejects.toMatchObject({ creationOutcome: "unknown" }); await runtime.disconnectLocal();
});
it("bounds the aggregate readiness checkpoint across individually short event acknowledgements", async () => {
 const f = fixture(), input = f.input(); let calls = 0;
 input.onNativeEvent = async () => { calls++; await new Promise(resolve => setTimeout(resolve, 100)); };
 wrapProducer(f, (producerInput, delegate) => { const turn = delegate(producerInput), ready = turn.ready!.bind(turn); turn.ready = async () => { await ready(); for (let i = 0; i < 6; i++) void Promise.resolve(producerInput.onNativeEvent!({ state: "running", observedAt: "2026-10-25T00:00:00Z", nativeSessionId: "native-a" })).catch(() => {}); }; return turn; });
 const turn = f.runtime.start(input); await expect(turn.ready!()).rejects.toMatchObject({ creationOutcome: "unknown", code: "COPILOT_RPC_CALLBACK_FAILED" });
 expect(calls).toBeLessThan(6); expect(f.runtime.hasActiveOperations()).toBe(true); await f.runtime.disconnectLocal();
});

it("gives canonical assertions detached payloads without replacing captured selection or workspace", async () => {
 const f = fixture(); f.assertInput.mockImplementation((input: CliStartInput) => { input.executionRef!.id = "foreign"; input.nativeInput!.executionSelection!.requestedModel = "foreign"; input.workspacePath = f.b; });
 const turn = f.runtime.start(f.input()); await turn.ready!(); const sent = f.entries[0]!.starts.mock.calls[0]![0];
 expect(sent).toMatchObject({ workspacePath: f.a, executionRef: { id: "a" }, nativeInput: { executionSelection: { requestedModel: "chosen" } } }); await f.runtime.disconnectLocal();
});
it("rejects replaced stored bindings after lookup reentry and before a native consumer", async () => {
 const f = fixture(), consumer = vi.fn(); let replace = false;
 const runtime = new CopilotExecutionRuntime({ ...f.options, bindingFor: id => { const original = f.persisted.get(id); if (replace && original) { replace = false; f.persisted.set(id, { ...original, nativeStoreRef: "replacement" }); } return original; } });
 const input = f.input(); input.onNativeEvent = consumer; const turn = runtime.start(input); await turn.ready!(); replace = true;
 expect(() => f.entries[0]!.starts.mock.calls[0]![0].onNativeEvent!({ state: "running", observedAt: "2026-10-25T00:00:00Z", nativeSessionId: "native-a" })).toThrow(expect.objectContaining({ creationOutcome: "unknown" }));
 expect(consumer).not.toHaveBeenCalled(); expect(runtime.diagnostics("native-a")).toEqual({}); await runtime.disconnectLocal();
});
it("releases synchronous thrown callback slots before the next independent admission", () => {
 const f = fixture(); f.assertInput.mockImplementation(() => { throw Error("immediate refusal"); });
 for (let i = 0; i < 65; i++) expect(() => f.runtime.start(f.input())).toThrow();
 expect(f.assertInput).toHaveBeenCalledTimes(65); expect(f.runtime.hasActiveOperations()).toBe(false); expect(f.factory).not.toHaveBeenCalled();
});
it("does not reacquire a raw result after public cancellation", async () => {
 const f = fixture(), turn = f.runtime.start(f.input()); await turn.ready!(); const result = vi.fn(); f.entries[0]!.starts.mock.results[0]!.value.result = result;
 await turn.cancel(); await expect(turn.result()).rejects.toMatchObject({ creationOutcome: "unknown" }); expect(result).not.toHaveBeenCalled(); await f.runtime.disconnectLocal();
});
it("retains one raw result operation after its public cancellation releases callers", async () => {
 const f = fixture(), turn = f.runtime.start(f.input()), gate = Promise.withResolvers<{ state: "completed"; summary: string; providerSessionId: string; events: [] }>(); await turn.ready!();
 const getResult = vi.fn(() => gate.promise); f.entries[0]!.starts.mock.results[0]!.value.result = getResult;
 const first = turn.result().catch(error => error), second = turn.result().catch(error => error); await vi.waitFor(() => expect(getResult).toHaveBeenCalledOnce());
 await turn.cancel(); expect(await first).toMatchObject({ creationOutcome: "unknown" }); expect(await second).toMatchObject({ creationOutcome: "unknown" }); expect(f.runtime.hasActiveOperations()).toBe(true);
 gate.resolve({ state: "completed", summary: "late", providerSessionId: "native-a", events: [] }); await vi.waitFor(() => expect(f.runtime.hasActiveOperations()).toBe(false)); await f.runtime.disconnectLocal();
});
it("includes callbacks enqueued during an awaited readiness checkpoint", async () => {
 const f = fixture({ nativeEvent: true }), input = f.input(), first = Promise.withResolvers<void>(), second = Promise.withResolvers<void>(), enteredFirst = Promise.withResolvers<void>(), enteredSecond = Promise.withResolvers<void>(); let calls = 0;
 input.onNativeEvent = async () => {
  if (++calls === 1) { enteredFirst.resolve(); await first.promise; void Promise.resolve(f.entries[0]!.starts.mock.calls[0]![0].onNativeEvent!({ state: "completed", observedAt: "2026-10-25T00:00:00Z", nativeSessionId: "native-a" })).catch(() => {}); }
  else { enteredSecond.resolve(); await second.promise; }
 };
 const turn = f.runtime.start(input), ready = turn.ready!(); await enteredFirst.promise; await Promise.resolve(); first.resolve(); await enteredSecond.promise;
 try { expect(await Promise.race([ready.then(() => "ready"), new Promise(resolve => setTimeout(() => resolve("waiting"), 25))])).toBe("waiting"); }
 finally { second.resolve(); await ready; await f.runtime.disconnectLocal(); }
});
