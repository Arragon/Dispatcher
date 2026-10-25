import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ExecutionContextRef, ExecutionSelection, NativeBinding } from "@dispatcher/domain";
import type { CliStartInput } from "../src/ecosystem-cli.js";
import type { LocalRuntimeDisconnect } from "../src/interaction-contracts.js";
import { DevinLocalAcpExecutionBackend, DevinLocalAcpAdapter } from "../src/devin-acp-execution.js";
import { DevinLocalAcpClient } from "../src/devin-acp.js";
import { MemorySessionStore } from "../src/generic.js";
import { devinManifest } from "../src/devin.js";
import { devinAcpFixture } from "./fixtures/devin-acp.js";
const adapters = { DevinLocalAcpExecutionBackend, DevinLocalAcpAdapter, DevinLocalAcpClient, MemorySessionStore, devinManifest };
const roots: string[] = [], clients: Array<{ close(): Promise<LocalRuntimeDisconnect> }> = [];
const phases = new Map<string, Array<{ phase: string; utc: string }>>(), captured = new Set<string>();
let setupObserver: { resolve(): void; reject(error: unknown): void; holdDelivery?: () => Promise<void> } | undefined;
let restoreOpen: (() => void) | undefined;
function markPhase(root: string, phase: string): void {
  const events = phases.get(root) ?? []; events.push({ phase, utc: new Date().toISOString() }); phases.set(root, events);
}
function captureActualFixture(root: string, phase: string, receipts?: LocalRuntimeDisconnect[]): void {
  const destination = process.env.DISPATCHER_DEVIN_FIXTURE_EVIDENCE; if (!destination) return;
  const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
  const output = join(destination, hash(root), phase); mkdirSync(output, { recursive: true });
  const files: unknown[] = [];
  const visit = (directory: string) => { for (const name of readdirSync(directory)) {
    const path = join(directory, name), stat = statSync(path, { bigint: true });
    if (stat.isDirectory()) visit(path);
    else if (stat.isFile()) {
      const bytes = readFileSync(path), fullPathHash = hash(path); writeFileSync(join(output, fullPathHash), bytes);
      files.push({ path, fullPathHash, dev: String(stat.dev), ino: String(stat.ino), mode: String(stat.mode), size: String(stat.size), mtimeNs: String(stat.mtimeNs), sha256: hash(bytes) });
    }
  } }; visit(root);
  writeFileSync(join(output, "manifest.json"), JSON.stringify({ classification: "actual-local-stdio-fixture-not-provider-account", root, phase, utc: new Date().toISOString(), files, events: phases.get(root), receipts }, null, 2));
}
beforeEach(() => {
  const open = DevinLocalAcpClient.open;
  const spy = vi.spyOn(DevinLocalAcpClient, "open").mockImplementation(async function (this: typeof DevinLocalAcpClient, scope, options) {
    const root = dirname(scope.executable), observer = setupObserver;
    if (!captured.has(root)) { captureActualFixture(root, "before-first-spawn"); captured.add(root); }
    markPhase(root, "open-called");
    let client: DevinLocalAcpClient;
    try { client = await open.call(this, scope, options); }
    catch (error) { markPhase(root, "open-rejected"); observer?.reject(error); throw error; }
    // Setup ends at actual open, before a test may deliberately hold delivery.
    markPhase(root, "open-resolved"); observer?.resolve();
    await observer?.holdDelivery?.(); return client;
  });
  restoreOpen = () => spy.mockRestore();
});
afterEach(async () => {
  const receipts: LocalRuntimeDisconnect[] = [];
  try { for (const client of clients.splice(0)) receipts.push(await client.close()); }
  finally {
    try { for (const root of roots.splice(0)) { captureActualFixture(root, "after-awaited-cleanup-before-teardown", receipts); rmSync(root, { recursive: true, force: true }); } }
    finally { restoreOpen?.(); restoreOpen = undefined; setupObserver = undefined; captured.clear(); phases.clear(); }
  }
});
const fixture = (mode = "normal") => devinAcpFixture(roots, mode);
async function withOpenSetup(action: (opened: Promise<void>) => Promise<void>, holdDelivery?: () => Promise<void>): Promise<void> {
  let resolve!: () => void, reject!: (error: unknown) => void;
  const opened = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); void opened.catch(() => {});
  setupObserver = { resolve, reject, holdDelivery };
  try { await action(opened); } finally { setupObserver = undefined; }
}
function delayVersion(f: ReturnType<typeof fixture>): void {
  const script = readFileSync(f.scope.executable, "utf8"), output = "process.stdout.write(mode==='wrong-version'?'devin 1.0.0':'devin 3000.11.3 (9c803229faa4)');process.exit(0);";
  if (script.split(output).length !== 2) throw Error("fixture version output changed");
  writeFileSync(f.scope.executable, script.replace(output, "fs.writeFileSync(path.join(root,'version-started'),String(Date.now()));setTimeout(()=>{fs.writeFileSync(path.join(root,'version-finished'),String(Date.now()));" + output + "},1200);return;"));
}
const executionRef: ExecutionContextRef = { version: 1, id: "execution", kind: "managed-worktree", runnerId: "local", repositoryId: "repository", workspaceId: "run", pathRef: "workspace:run", branch: "codex/run", baseRevision: "base" };
const executionSelection: ExecutionSelection = { version: 1, mode: "manual", source: "explicit", profileId: "local-devin", runnerId: "local", providerId: "devin-local", backendId: "devin-local-acp", selectionType: "explicit-model", requestedModel: "chosen", nativeParameters: {}, contextFingerprint: "fixture", configRevision: 1, selectedAt: "2026-10-13T00:00:00.000Z" };
function producer(f: ReturnType<typeof fixture>) {
  const backend = new adapters.DevinLocalAcpExecutionBackend({ scope: { ...f.scope, profileId: "local-devin", runnerId: "local", nativeStoreRef: "native-store:devin-local" }, executionRef });
  clients.push({ close: () => backend.disconnectLocal() }); return backend;
}
function executionInput(f: ReturnType<typeof fixture>): CliStartInput {
  return { executable: f.scope.executable, args: [], workspacePath: f.scope.workspacePath, executionRef: structuredClone(executionRef), beforePrompt: () => {}, onBinding: async () => {},
    nativeInput: { version: 1, profileId: "local-devin", backendId: "devin-local-acp", runId: "run", sessionId: "dispatcher-exact", commandId: "observer-exact", newSession: true, prompt: "inspect", approveTools: false, executionSelection: structuredClone(executionSelection) } };
}
function delayTerminal(f: ReturnType<typeof fixture>): void {
  const script = readFileSync(f.scope.executable, "utf8"), write = "process.stdout.write(JSON.stringify(value)+'\\n')";
  writeFileSync(f.scope.executable, script.replace("const emit=value=>" + write + ";", "const emit=value=>{const send=()=>" + write + ";if(value.result&&value.result.stopReason)setTimeout(send,200);else send();};"));
}
it("producer persists binding before guarded prompt and reports only normalized native facts", async () => {
  const f = fixture("model-set"), backend = producer(f), input = executionInput(f), facts: unknown[] = [];
  input.onBinding = async () => { writeFileSync(join(f.root, "binding-persisted"), "yes"); }; input.onNativeEvent = fact => { facts.push(fact); };
  const turn = backend.start(input); await turn.ready?.();
  expect(await turn.result()).toMatchObject({ state: "completed", providerSessionId: "native-exact", summary: "Native Devin Local turn completed" });
  expect(f.calls().map(m => m.method)).toEqual(["initialize", "session/new", "session/set_config_option", "session/prompt"]); expect(f.calls()[2]).toMatchObject({ bindingPersisted: true });
  expect(facts).toContainEqual(expect.objectContaining({ state: "running", nativeSessionId: "native-exact" })); expect(facts).toContainEqual(expect.objectContaining({ state: "completed", nativeSessionId: "native-exact" })); expect(JSON.stringify(facts)).not.toMatch(/cog|credential|rawInput|rawOutput|title/);
});
it.each(["model", "profile", "execution", "environment", "argv", "approve", "resume"])("producer refuses invalid original %s before acquiring a native root", async mode => {
  const f = fixture(), backend = producer(f), input = executionInput(f);
  if (mode === "model") delete input.nativeInput!.executionSelection;
  if (mode === "profile") input.nativeInput!.profileId = "foreign";
  if (mode === "execution") input.executionRef!.id = "foreign";
  if (mode === "environment") input.environment = { DEVIN_API_KEY: "cog-do-not-log" };
  if (mode === "argv") input.args = ["--cloud"];
  if (mode === "approve") input.nativeInput!.approveTools = true;
  if (mode === "resume") input.nativeInput!.newSession = false;
  expect(() => backend.start(input)).toThrow(expect.objectContaining({ creationOutcome: "not-created", code: expect.stringMatching(/^DEVIN_ACP_/) })); expect(existsSync(join(f.root, "started"))).toBe(false);
});
it("producer captures the original selection/reference and callbacks before acquisition", async () => {
  const f = fixture(), backend = producer(f), input = executionInput(f), saved: NativeBinding[] = [];
  input.onBinding = async binding => { saved.push(binding); }; const turn = backend.start(input);
  input.onBinding = async () => { throw Error("replacement"); }; input.beforePrompt = () => { throw Error("replacement"); }; input.nativeInput!.prompt = "changed"; input.nativeInput!.executionSelection!.requestedModel = "other"; input.executionRef!.id = "foreign";
  await turn.ready?.(); expect((await turn.result()).state).toBe("completed"); expect(saved).toMatchObject([{ nativeSessionId: "native-exact", executionRefId: "execution" }]); expect(f.calls().at(-1)).toMatchObject({ params: { prompt: [{ text: "inspect" }] } });
});
it("producer refuses prompt after failed original binding persistence", async () => {
  const f = fixture(), backend = producer(f), input = executionInput(f); input.onBinding = async () => { throw Error("cog-credential"); };
  const turn = backend.start(input); await expect(turn.ready?.()).rejects.toMatchObject({ code: "DEVIN_ACP_BINDING_FAILED", creationOutcome: "unknown" }); await expect(turn.result()).rejects.toMatchObject({ creationOutcome: "unknown" }); expect(f.calls().some(m => m.method === "session/prompt")).toBe(false);
});
it("producer leaves held binding callbacks unknown during local closure", async () => withOpenSetup(async opened => {
  const f = fixture(), backend = producer(f), input = executionInput(f); let invoked = false;
  input.onBinding = () => { invoked = true; return new Promise<void>(() => {}); }; const turn = backend.start(input); void turn.ready?.().catch(() => {}); void turn.result().catch(() => {});
  await opened; await vi.waitFor(() => expect(invoked).toBe(true)); expect(await backend.disconnectLocal()).toMatchObject({ callbacks: "unknown", backgroundTools: "unknown", nativeSessionDeleted: false }); await expect(turn.ready?.()).rejects.toMatchObject({ creationOutcome: "unknown" }); expect(f.calls().some(m => m.method === "session/prompt")).toBe(false);
}));
it.each(["prompt-tool-failed", "prompt-tool-pending", "prompt-permission", "stop-max_tokens", "stop-refusal"])("producer does not turn native %s into file success", async mode => {
  const f = fixture(mode), backend = producer(f), turn = backend.start(executionInput(f)); await turn.ready?.(); expect((await turn.result()).state).toBe("failed");
});
it("producer records native cancelled terminal separately from completed execution", async () => {
  const f = fixture("stop-cancelled"), backend = producer(f), turn = backend.start(executionInput(f)); await turn.ready?.(); expect((await turn.result()).state).toBe("cancelled");
});
it("producer admission waits for actual native output rather than stdin submission", async () => withOpenSetup(async opened => {
  const f = fixture("prompt-ignore"), backend = producer(f), turn = backend.start(executionInput(f)); let ready = false; void turn.ready?.().then(() => { ready = true; }, () => {}); void turn.result().catch(() => {});
  await opened; await vi.waitFor(() => expect(f.calls().some(m => m.method === "session/prompt")).toBe(true)); expect(ready).toBe(false); await turn.cancel(); await expect(turn.ready?.()).rejects.toMatchObject({ creationOutcome: "unknown" }); expect(await backend.disconnectLocal()).toMatchObject({ ownedRoot: "exited", backgroundTools: "unknown", nativeSessionDeleted: false });
}));
it("producer readiness does not wait for a delayed native terminal", async () => {
  const f = fixture(); delayTerminal(f);
  const backend = producer(f), turn = backend.start(executionInput(f)); await turn.ready?.(); expect(turn.status()).toBe("running"); expect((await turn.result()).state).toBe("completed");
});
it("producer rejects duplicate admission without cancelling the first owned turn", async () => withOpenSetup(async opened => {
  const f = fixture("prompt-ignore"), backend = producer(f), input = executionInput(f), turn = backend.start(input); void turn.ready?.().catch(() => {}); void turn.result().catch(() => {});
  await opened; await vi.waitFor(() => expect(f.calls().some(m => m.method === "session/prompt")).toBe(true)); expect(() => backend.start(input)).toThrow(expect.objectContaining({ code: "DEVIN_ACP_SESSION_ALREADY_ADMITTED" })); expect(f.calls().filter(m => m.method === "session/new")).toHaveLength(1); await turn.cancel();
}));
it("producer treats an unsettled async native consumer as failed/unknown cleanup", async () => {
  const f = fixture(), backend = producer(f), input = executionInput(f); input.onNativeEvent = (() => new Promise<void>(() => {})) as unknown as () => void;
  const turn = backend.start(input); void turn.result().catch(() => {}); await expect(turn.ready?.()).rejects.toMatchObject({ creationOutcome: "unknown" }); expect(await backend.disconnectLocal()).toMatchObject({ callbacks: "unknown", backgroundTools: "unknown" });
});
it("distinct Local Adapter reuses structured binding/event lifecycle and leaves v3 separate", async () => {
  const f = fixture(), backend = producer(f), store = new adapters.MemorySessionStore(), adapter = new adapters.DevinLocalAcpAdapter({ id: "local-devin", alias: "local", executable: f.scope.executable }, backend, store);
  expect(adapter.manifest).toMatchObject({ id: "devin-local", capabilities: { resume: false }, backends: [expect.objectContaining({ id: "devin-local-acp" })] }); expect(adapters.devinManifest.id).toBe("devin");
  adapter.setNativeEventSink(() => {}, () => () => true);
  const session = await adapter.start({ runId: "run", sessionId: "dispatcher-exact", workspacePath: f.scope.workspacePath, prompt: "inspect", execution: { generation: 1, attempt: 1, leaseId: "lease" }, beforeCreate: () => {}, beforeSend: () => {}, executionRef, executionSelection, backendId: "devin-local-acp" }); expect(session.nativeBinding).toMatchObject({ nativeSessionId: "native-exact", product: "devin-local" });
  expect((await adapter.result(session.id)).state).toBe("COMPLETED"); await expect(adapter.send(session.id, "again")).rejects.toMatchObject({ code: "UNSUPPORTED_CAPABILITY" });
});
it("producer cannot claim not-created or closed when owned cleanup fails", async () => {
  const f = fixture(), backend = producer(f), turn = backend.start(executionInput(f)); await turn.ready?.(); await turn.result();
  const client = (backend as unknown as { client: DevinLocalAcpClient }).client, spy = vi.spyOn(client, "close").mockRejectedValue(new Error("fixture cleanup failed"));
  try { expect(await backend.disconnectLocal()).toMatchObject({ connection: "unknown", ownedRoot: "unknown" }); }
  finally { spy.mockRestore(); await client.close(); }
});
it("producer retains unknown process ownership if acquisition returns no cleanup receipt", async () => {
  const f = fixture("wrong-protocol"), backend = producer(f), turn = backend.start(executionInput(f)); void turn.result().catch(() => {});
  await expect(turn.ready?.()).rejects.toMatchObject({ creationOutcome: "not-created", code: "DEVIN_ACP_PROTOCOL_UNQUALIFIED" }); expect(await backend.disconnectLocal()).toMatchObject({ connection: "unknown", ownedRoot: "unknown" });
});
it("producer cancels a lost creation without repeating it or claiming known identity", async () => withOpenSetup(async opened => {
  const f = fixture("create-ignore"), backend = producer(f), turn = backend.start(executionInput(f)); void turn.ready?.().catch(() => {}); void turn.result().catch(() => {});
  await opened; await vi.waitFor(() => expect(f.calls().some(m => m.method === "session/new")).toBe(true)); await turn.cancel(); await expect(turn.ready?.()).rejects.toMatchObject({ creationOutcome: "unknown" }); expect(f.calls().filter(m => m.method === "session/new")).toHaveLength(1); expect(f.calls().some(m => m.method === "session/prompt")).toBe(false);
}));
it("producer keeps forbidden async Guard drain unknown before acquiring any root", async () => {
  const f = fixture(), backend = producer(f), input = executionInput(f); input.beforePrompt = (() => new Promise<void>(() => {})) as unknown as () => void;
  expect(() => backend.start(input)).toThrow(expect.objectContaining({ creationOutcome: "not-created", code: "DEVIN_ACP_AUTHORITY_CHANGED" })); expect(existsSync(join(f.root, "started"))).toBe(false); expect(await backend.disconnectLocal()).toMatchObject({ ownedRoot: "not-created", callbacks: "unknown" });
});
it("producer preserves constructor scope and reference when caller options change", async () => {
  const f = fixture(), options = { scope: { ...f.scope, profileId: "local-devin", runnerId: "local", nativeStoreRef: "native-store:devin-local" }, executionRef: structuredClone(executionRef) };
  const backend = new adapters.DevinLocalAcpExecutionBackend(options); clients.push({ close: () => backend.disconnectLocal() }); options.scope.configHome = "/foreign"; options.executionRef.id = "foreign";
  const turn = backend.start(executionInput(f)); await turn.ready?.(); expect((await turn.result()).state).toBe("completed");
});
it.each(["authority", "workspace", "shutdown"])("producer rechecks %s after the terminal consumer before successful result", async mode => {
  const f = fixture(), backend = producer(f), input = executionInput(f); let allowed = true;
  input.beforePrompt = () => { if (!allowed) throw Error("revoked"); };
  input.onNativeEvent = fact => { if (fact.state === "completed") { if (mode === "authority") allowed = false; if (mode === "workspace") renameSync(f.scope.workspacePath, f.scope.workspacePath + "-moved"); if (mode === "shutdown") backend.beginShutdown(); } };
  const turn = backend.start(input); await turn.ready?.(); expect((await turn.result()).state).toBe(mode === "shutdown" ? "cancelled" : "failed");
});
it("producer classifies scope disappearance in the initial Guard before root acquisition", async () => {
  const f = fixture(), backend = producer(f), input = executionInput(f); input.beforePrompt = () => { renameSync(f.scope.dataHome, f.scope.dataHome + "-moved"); };
  expect(() => backend.start(input)).toThrow(expect.objectContaining({ creationOutcome: "not-created", code: "DEVIN_ACP_SCOPE_CHANGED" })); expect(existsSync(join(f.root, "started"))).toBe(false);
});
it("producer rechecks real Adapter observation persistence after native terminal publication", async () => {
  const f = fixture(); delayTerminal(f);
  const backend = producer(f), store = new adapters.MemorySessionStore(), adapter = new adapters.DevinLocalAcpAdapter({ id: "local-devin", alias: "local", executable: f.scope.executable }, backend, store);
  adapter.setNativeEventSink(event => { if (event.turn.state === "completed") throw Error("fixture terminal sink failed"); }, () => () => true);
  const session = await adapter.start({ runId: "run", sessionId: "dispatcher-exact", workspacePath: f.scope.workspacePath, prompt: "inspect", execution: { generation: 1, attempt: 1, leaseId: "lease" }, beforeCreate: () => {}, beforeSend: () => {}, executionRef, executionSelection, backendId: "devin-local-acp" });
  expect((await adapter.result(session.id)).state).toBe("FAILED"); expect(store.load(session.id)).toMatchObject({ nativeIdentityIssue: "NATIVE_EVENT_PERSISTENCE_FAILED" });
});

function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
it("awaits asynchronous running acknowledgements before readiness and terminal persistence before result", async () => withOpenSetup(async opened => {
  const f = fixture(), backend = producer(f), input = executionInput(f), running = deferred(), terminal = deferred();
  let runningEntered = false, terminalEntered = false, ready = false, finished = false;
  input.onNativeEvent = async fact => { if (fact.state === "running") { runningEntered = true; await running.promise; } if (fact.state === "completed") { terminalEntered = true; await terminal.promise; } };
  const turn = backend.start(input); void turn.ready?.().then(() => { ready = true; }, () => {}); const result = turn.result(); void result.then(() => { finished = true; }, () => {});
  await opened; await vi.waitFor(() => expect(runningEntered).toBe(true)); expect(ready).toBe(false); expect(backend.hasActiveOperations()).toBe(true);
  running.resolve(); await turn.ready?.(); await vi.waitFor(() => expect(terminalEntered).toBe(true)); expect(finished).toBe(false);
  terminal.resolve(); expect((await result).state).toBe("completed");
}));
it.each(["running", "completed"] as const)("rejects deferred %s observer failure without successful execution", async state => withOpenSetup(async opened => {
  const f = fixture(), backend = producer(f), input = executionInput(f), held = deferred(); let entered = false;
  input.onNativeEvent = fact => { if (fact.state === state) { entered = true; return held.promise; } };
  const turn = backend.start(input), result = turn.result(); void result.catch(() => {}); void turn.ready?.().catch(() => {});
  await opened; await vi.waitFor(() => expect(entered).toBe(true)); held.reject(new Error("private persistence failure"));
  if (state === "running") { await expect(turn.ready?.()).rejects.toMatchObject({ creationOutcome: "unknown" }); await expect(result).rejects.toMatchObject({ creationOutcome: "unknown" }); }
  else { await turn.ready?.(); expect((await result).state).toBe("failed"); }
}));
it("retains raw observer activity after bounded failure and preserves the cached unknown receipt", async () => withOpenSetup(async opened => {
  const f = fixture(), backend = producer(f), input = executionInput(f), held = deferred(); let entered = false;
  input.onNativeEvent = () => { entered = true; return held.promise; };
  const turn = backend.start(input); void turn.result().catch(() => {}); void turn.ready?.().catch(() => {});
  await opened; await vi.waitFor(() => expect(entered).toBe(true)); await expect(turn.ready?.()).rejects.toMatchObject({ creationOutcome: "unknown" });
  const receipt = await backend.disconnectLocal(); expect(receipt).toMatchObject({ callbacks: "unknown", backgroundTools: "unknown" }); expect(backend.hasActiveOperations()).toBe(true);
  held.resolve(); await vi.waitFor(() => expect(backend.hasActiveOperations()).toBe(false)); expect(await backend.disconnectLocal()).toEqual(receipt);
}));
it.each(["running", "completed"] as const)("rechecks authority after asynchronous %s observation settles", async state => withOpenSetup(async opened => {
  const f = fixture(), backend = producer(f), input = executionInput(f), held = deferred(); let allowed = true, entered = false;
  input.beforePrompt = () => { if (!allowed) throw Error("revoked"); };
  input.onNativeEvent = async fact => { if (fact.state === state) { entered = true; await held.promise; allowed = false; } };
  const turn = backend.start(input), result = turn.result(); void result.catch(() => {}); void turn.ready?.().catch(() => {});
  await opened; await vi.waitFor(() => expect(entered).toBe(true)); held.resolve();
  if (state === "running") await expect(turn.ready?.()).rejects.toMatchObject({ creationOutcome: "unknown" });
  else { await turn.ready?.(); expect((await result).state).toBe("failed"); }
}));
it("normalizes a forbidden asynchronous Guard once and retains its raw lifetime before acquisition", async () => {
  const f = fixture(), backend = producer(f), input = executionInput(f), held = deferred(); let assimilations = 0;
  input.beforePrompt = (() => ({ then(resolve: () => void, reject: (error: Error) => void) { assimilations++; return held.promise.then(resolve, reject); } })) as unknown as () => void;
  expect(() => backend.start(input)).toThrow(expect.objectContaining({ code: "DEVIN_ACP_AUTHORITY_CHANGED", creationOutcome: "not-created" }));
  await Promise.resolve(); expect(assimilations).toBe(1); expect(backend.hasActiveOperations()).toBe(true); expect(existsSync(join(f.root, "started"))).toBe(false);
  const receipt = await backend.disconnectLocal(); expect(receipt.callbacks).toBe("unknown"); held.resolve(); await vi.waitFor(() => expect(backend.hasActiveOperations()).toBe(false)); expect(await backend.disconnectLocal()).toEqual(receipt);
});
it("allocates the real Adapter identity before awaiting its durable observer and before native model or prompt", async () => withOpenSetup(async opened => {
  const f = fixture("model-set"), backend = producer(f), store = new MemorySessionStore(), adapter = new DevinLocalAcpAdapter({ id: "local-devin", alias: "local", executable: f.scope.executable }, backend, store), held = deferred(); let observed = false;
  adapter.setNativeEventSink(async event => { if (event.turn.state === "waiting") { observed = true; expect(store.load("dispatcher-exact")).toMatchObject({ providerSessionId: "native-exact", nativeBinding: { product: "devin-local", nativeSessionId: "native-exact" } }); await held.promise; writeFileSync(join(f.root, "binding-persisted"), "yes"); } }, () => () => true);
  const pending = adapter.start({ runId: "run", sessionId: "dispatcher-exact", workspacePath: f.scope.workspacePath, execution: { generation: 1, attempt: 1, leaseId: "lease" }, executionRef, executionSelection, backendId: "devin-local-acp", beforeCreate: () => {}, beforeSend: () => {}, prompt: "inspect" }); void pending.catch(() => {});
  await opened; await vi.waitFor(() => expect(observed).toBe(true)); expect(f.calls().map(call => call.method)).toEqual(["initialize", "session/new"]); held.resolve(); const session = await pending;
  expect(f.calls()[2]).toMatchObject({ method: "session/set_config_option", bindingPersisted: true }); expect((await adapter.result(session.id)).state).toBe("COMPLETED");
}));
it.each(["profile", "backend", "provider", "runner", "reference", "observer"])("rejects real Adapter foreign %s before host acquisition", async mode => {
  const f = fixture(), backend = producer(f), store = new MemorySessionStore(), adapter = new DevinLocalAcpAdapter({ id: "local-devin", alias: "local", executable: f.scope.executable }, backend, store);
  writeFileSync(f.scope.executable, readFileSync(f.scope.executable, "utf8").replace("if(process.argv.includes('--version')){", "if(process.argv.includes('--version')){fs.writeFileSync(path.join(root,'probe-started'),'yes');"));
  adapter.setNativeEventSink(() => {}, () => () => mode !== "observer");
  const selection = structuredClone(executionSelection), reference = structuredClone(executionRef);
  if (mode === "profile") selection.profileId = "foreign";
  if (mode === "backend") selection.backendId = "foreign";
  if (mode === "provider") selection.providerId = "foreign";
  if (mode === "runner") selection.runnerId = "foreign";
  if (mode === "reference") reference.id = "foreign";
  await expect(adapter.start({ runId: "run", sessionId: "dispatcher-exact", workspacePath: f.scope.workspacePath, execution: { generation: 1, attempt: 1, leaseId: "lease" }, executionRef: reference, executionSelection: selection, backendId: "devin-local-acp", beforeCreate: () => {}, beforeSend: () => {}, prompt: "inspect" })).rejects.toMatchObject({ creationOutcome: "not-created" });
  expect(existsSync(join(f.root, "started"))).toBe(false); expect(existsSync(join(f.root, "probe-started"))).toBe(false); expect(f.calls()).toEqual([]);
});
it("keeps a later running observer failure failed after readiness rather than reporting cancellation", async () => {
  const f = fixture(), backend = producer(f), input = executionInput(f), held = deferred(); let calls = 0, entered = false;
  input.onNativeEvent = fact => { if (fact.state === "running" && ++calls === 2) { entered = true; return held.promise; } };
  const turn = backend.start(input); await turn.ready?.(); await vi.waitFor(() => expect(entered).toBe(true)); held.reject(new Error("second running sink failed")); expect((await turn.result()).state).toBe("failed");
});
it("retains raw binding work after its bounded wait fails and preserves the unknown receipt after late settlement", async () => withOpenSetup(async opened => {
  const f = fixture(), backend = producer(f), input = executionInput(f), held = deferred(); let entered = false;
  input.onBinding = () => { entered = true; return held.promise; };
  const turn = backend.start(input); void turn.result().catch(() => {}); void turn.ready?.().catch(() => {});
  await opened; await vi.waitFor(() => expect(entered).toBe(true)); await expect(turn.ready?.()).rejects.toMatchObject({ creationOutcome: "unknown", code: "DEVIN_ACP_BINDING_FAILED" });
  expect(backend.hasActiveOperations()).toBe(true); const receipt = await backend.disconnectLocal(); expect(receipt.callbacks).toBe("unknown");
  held.resolve(); await vi.waitFor(() => expect(backend.hasActiveOperations()).toBe(false)); expect(await backend.disconnectLocal()).toEqual(receipt); expect(f.calls().map(call => call.method)).toEqual(["initialize", "session/new"]);
}));
it("retains late real acquisition work after the local closure deadline and never upgrades cached unknown ownership", async () => {
  const f = fixture(), backend = producer(f), input = executionInput(f), held = deferred(); let entered = false;
  try {
    await withOpenSetup(async opened => {
      const turn = backend.start(input); void turn.result().catch(() => {}); void turn.ready?.().catch(() => {}); await opened; await vi.waitFor(() => expect(entered).toBe(true));
      expect(backend.hasActiveOperations()).toBe(true); const receipt = await backend.disconnectLocal(); expect(receipt).toMatchObject({ connection: "unknown", ownedRoot: "unknown", callbacks: "unknown" }); expect(backend.hasActiveOperations()).toBe(true);
      held.resolve(); await expect(turn.ready?.()).rejects.toMatchObject({ creationOutcome: "not-created" }); await vi.waitFor(() => expect(backend.hasActiveOperations()).toBe(false)); expect(await backend.disconnectLocal()).toEqual(receipt); expect(f.calls().map(call => call.method)).toEqual(["initialize"]);
    }, async () => { entered = true; await held.promise; });
  } finally { held.resolve(); }
});
it.each(["native\tunsafe", "native\u0001unsafe", "native\u001funsafe", "native\u007funsafe", "unstarted:native"])("refuses allocated unsafe native identity %j before the owning callback, model or prompt", async id => {
  const f = fixture("model-set"); writeFileSync(f.scope.executable, readFileSync(f.scope.executable, "utf8").replaceAll("'native-exact'", JSON.stringify(id)));
  const backend = producer(f), input = executionInput(f); let bindings = 0;
  input.onBinding = async () => { bindings++; };
  const turn = backend.start(input); void turn.result().catch(() => {});
  await expect(turn.ready?.()).rejects.toMatchObject({ creationOutcome: "unknown", code: "DEVIN_ACP_BINDING_FAILED" }); await expect(turn.result()).rejects.toMatchObject({ creationOutcome: "unknown" });
  expect(bindings).toBe(0); expect(f.calls().map(call => call.method)).toEqual(["initialize", "session/new"]); expect(() => backend.start(input)).toThrow(expect.objectContaining({ code: "DEVIN_ACP_SESSION_ALREADY_ADMITTED" }));
});
it.each(["native-\u2028-\u2029", "原生标识", "x".repeat(512)])("preserves allocated opaque qualified native identity %j", async id => {
  const f = fixture(); writeFileSync(f.scope.executable, readFileSync(f.scope.executable, "utf8").replaceAll("'native-exact'", JSON.stringify(id)));
  const backend = producer(f), input = executionInput(f), bindings: NativeBinding[] = [];
  input.onBinding = async binding => { bindings.push(binding); };
  const turn = backend.start(input); await turn.ready?.(); expect(await turn.result()).toMatchObject({ state: "completed", providerSessionId: id }); expect(bindings).toMatchObject([{ nativeSessionId: id, product: "devin-local", region: "global" }]);
});
it("bounds the aggregate post-prompt observation checkpoint across serial legitimate short consumers", async () => {
  const f = fixture(), backend = producer(f), input = executionInput(f); let running = 0, pending = 0, terminal = false;
  input.onNativeEvent = async fact => {
    if (fact.state === "running" && ++running <= 2) { pending++; await new Promise<void>(resolve => setTimeout(resolve, 350)); pending--; }
    if (fact.state === "completed") terminal = true;
  };
  const turn = backend.start(input); await turn.ready?.(); expect((await turn.result()).state).toBe("failed"); expect(terminal).toBe(false);
  if (pending) expect(backend.hasActiveOperations()).toBe(true);
  await vi.waitFor(() => expect(backend.hasActiveOperations()).toBe(false)); expect(await backend.disconnectLocal()).toMatchObject({ backgroundTools: "unknown", nativeSessionDeleted: false });
});
it("rejects a full raw callback budget before invoking another forbidden pre-root Guard", async () => {
  const f = fixture(), backend = producer(f), input = executionInput(f), held: Array<ReturnType<typeof deferred>> = [];
  input.beforePrompt = (() => { const work = deferred(); held.push(work); return work.promise; }) as unknown as () => void;
  for (let attempt = 0; attempt < 64; attempt++) expect(() => backend.start(input)).toThrow(expect.objectContaining({ code: "DEVIN_ACP_AUTHORITY_CHANGED", creationOutcome: "not-created" }));
  expect(() => backend.start(input)).toThrow(expect.objectContaining({ code: "DEVIN_ACP_CALLBACK_LIMIT", creationOutcome: "not-created" })); expect(held).toHaveLength(64); expect(existsSync(join(f.root, "started"))).toBe(false); expect(backend.hasActiveOperations()).toBe(true);
  const receipt = await backend.disconnectLocal(); expect(receipt).toMatchObject({ ownedRoot: "not-created", callbacks: "unknown" }); for (const work of held) work.resolve();
  await vi.waitFor(() => expect(backend.hasActiveOperations()).toBe(false)); expect(await backend.disconnectLocal()).toEqual(receipt);
});

it.each([0, 1200])("observes raw callback lifetime after actual open with a %ims version delay", async delay => {
  const f = fixture(); if (delay) delayVersion(f);
  const backend = producer(f), input = executionInput(f), held = deferred(); let entered = false;
  input.onNativeEvent = () => { entered = true; markPhase(f.root, "observer-entered"); return held.promise; };
  await withOpenSetup(async opened => {
    const turn = backend.start(input); void turn.result().catch(() => {}); void turn.ready?.().catch(() => {});
    try {
      await opened; await vi.waitFor(() => expect(entered).toBe(true)); await expect(turn.ready?.()).rejects.toMatchObject({ creationOutcome: "unknown" });
      const receipt = await backend.disconnectLocal(); expect(receipt).toMatchObject({ callbacks: "unknown", backgroundTools: "unknown" }); expect(backend.hasActiveOperations()).toBe(true);
      held.resolve(); await vi.waitFor(() => expect(backend.hasActiveOperations()).toBe(false)); expect(await backend.disconnectLocal()).toEqual(receipt); markPhase(f.root, "late-observer-settled-cached-unknown");
    } finally { held.resolve(); await backend.disconnectLocal(); }
  });
});
it.each([0, 1200])("observes actual open before holding late acquisition delivery with a %ims version delay", async delay => {
  const f = fixture(); if (delay) delayVersion(f);
  const backend = producer(f), input = executionInput(f), held = deferred(); let entered = false;
  await withOpenSetup(async opened => {
    const turn = backend.start(input); void turn.result().catch(() => {}); void turn.ready?.().catch(() => {});
    try {
      await opened; await vi.waitFor(() => expect(entered).toBe(true)); expect(backend.hasActiveOperations()).toBe(true);
      const receipt = await backend.disconnectLocal(); expect(receipt).toMatchObject({ connection: "unknown", ownedRoot: "unknown", callbacks: "unknown" }); expect(backend.hasActiveOperations()).toBe(true);
      held.resolve(); await expect(turn.ready?.()).rejects.toMatchObject({ creationOutcome: "not-created" }); await vi.waitFor(() => expect(backend.hasActiveOperations()).toBe(false)); expect(await backend.disconnectLocal()).toEqual(receipt); expect(f.calls().map(call => call.method)).toEqual(["initialize"]); markPhase(f.root, "late-acquisition-settled-cached-unknown");
    } finally { held.resolve(); await backend.disconnectLocal(); }
  }, async () => { entered = true; markPhase(f.root, "acquisition-delivery-held"); await held.promise; });
});
it("propagates actual open rejection before observer entry", async () => {
  const f = fixture("wrong-version"), backend = producer(f), input = executionInput(f), observe = vi.fn(); input.onNativeEvent = observe;
  await withOpenSetup(async opened => {
    const turn = backend.start(input); void turn.result().catch(() => {}); void turn.ready?.().catch(() => {});
    await expect(opened).rejects.toMatchObject({ code: "DEVIN_ACP_VERSION_UNQUALIFIED" }); expect(observe).not.toHaveBeenCalled();
    await expect(turn.ready?.()).rejects.toMatchObject({ creationOutcome: "not-created", code: "DEVIN_ACP_VERSION_UNQUALIFIED" }); await expect(turn.result()).rejects.toMatchObject({ creationOutcome: "not-created" });
    expect(existsSync(join(f.root, "started"))).toBe(false); expect(f.calls()).toEqual([]); expect(await backend.disconnectLocal()).toMatchObject({ ownedRoot: "unknown", backgroundTools: "unknown", nativeSessionDeleted: false });
  });
});
