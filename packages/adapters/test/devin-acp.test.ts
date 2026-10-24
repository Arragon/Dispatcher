import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { devinAcpFixture } from "./fixtures/devin-acp.js";
import * as adapters from "../src/devin-acp.js";
import type { LocalRuntimeDisconnect } from "../src/interaction-contracts.js";
import type { ExecutionContextRef, ExecutionSelection, NativeBinding } from "@dispatcher/domain";
import type { Writable } from "node:stream";

const roots: string[] = [], clients: Array<{ close(): Promise<LocalRuntimeDisconnect> }> = [];
afterEach(async () => { for (const client of clients.splice(0)) await client.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const fixture = (mode = "normal") => devinAcpFixture(roots, mode);
async function open(f: ReturnType<typeof fixture>) { const client = await adapters.DevinLocalAcpClient.open(f.scope); clients.push(client); return client; }

it("opens a pinned local ACP with literal worktree and native homes", async () => {
  const f = fixture(), client = await open(f);
  expect(JSON.parse(readFileSync(join(f.root, "started"), "utf8"))).toMatchObject({ args: ["acp"], cwd: f.scope.workspacePath, pwd: f.scope.workspacePath, data: f.scope.dataHome, config: f.scope.configHome });
  expect(client.negotiation).toEqual({ protocolVersion: 1, agentName: "affogato", agentVersion: "0.0.0-dev", loadSession: true, listSessions: true });
  expect(f.calls()[0]).toMatchObject({ method: "initialize", params: { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } } });
});
it.each(["wrong-version", "wrong-protocol", "version-mutate", "bad-frame"])("refuses unqualified %s and owns cleanup", async mode => {
  const f = fixture(mode); await expect(open(f)).rejects.toMatchObject({ code: expect.stringMatching(/^DEVIN_ACP_/) });
  if (mode === "wrong-version" || mode === "version-mutate") expect(existsSync(join(f.root, "started"))).toBe(false);
});
it("captures scope before the version probe and returns independent copies", async () => {
  const f = fixture(), original = structuredClone(f.scope), pending = adapters.DevinLocalAcpClient.open(f.scope); f.scope.workspacePath = "/foreign";
  const client = await pending; clients.push(client); expect(client.connectionScope).toEqual(original);
  const exposed = client.connectionScope; exposed.dataHome = "/foreign"; expect(client.connectionScope).toEqual(original);
});
it("reads exact native local IDs without exposing title or extra metadata", async () => {
  const f = fixture(), client = await open(f);
  expect(await client.listSessions({ cursor: "opaque/+=", })).toEqual({ sessions: [{ sessionId: "native-exact", cwd: f.scope.workspacePath }] });
  expect(f.calls().at(-1)).toMatchObject({ method: "session/list", params: { cwd: f.scope.workspacePath, cursor: "opaque/+=" } });
});
it("does not assume list capability from ACP availability", async () => {
  const f = fixture("no-list"), client = await open(f); await expect(client.listSessions({})).rejects.toMatchObject({ code: "DEVIN_ACP_LIST_UNSUPPORTED" });
  expect(f.calls()).toHaveLength(1);
});
it.each(["foreign-cwd", "duplicate", "oversize"])("refuses invalid scoped Session inventory %s", async mode => {
  const f = fixture(mode), client = await open(f); await expect(client.listSessions({})).rejects.toMatchObject({ code: "DEVIN_ACP_SESSION_LIST_INVALID" });
});
it("preserves native Unicode separators inside IDs", async () => {
  const f = fixture("unicode"), client = await open(f); expect((await client.listSessions({})).sessions[0]?.sessionId).toBe("native-\u2028-exact");
});
it("rejects revoked and asynchronous write guards before native input", async () => {
  const f = fixture(), client = await open(f);
  await expect(client.listSessions({}, { beforeSend: () => { throw Error("revoked"); } })).rejects.toMatchObject({ code: "DEVIN_ACP_AUTHORITY_CHANGED" });
  expect(f.calls()).toHaveLength(1);
});
it("does not accept an asynchronous final write guard", async () => {
  const f = fixture(), client = await open(f);
  await expect(client.listSessions({}, { beforeSend: (() => Promise.resolve()) as unknown as () => void })).rejects.toMatchObject({ code: "DEVIN_ACP_AUTHORITY_CHANGED" });
  expect(f.calls()).toHaveLength(1);
});
it("does not execute or load a Session while reading inventory", async () => {
  const f = fixture(), client = await open(f); await client.listSessions({});
  expect(f.calls().map(m => m.method)).toEqual(["initialize", "session/list"]);
});
it("rejects changed directory identity at the final send", async () => {
  const f = fixture(), client = await open(f); renameSync(f.scope.dataHome, f.scope.dataHome + "-old"); mkdirSync(f.scope.dataHome);
  await expect(client.listSessions({})).rejects.toMatchObject({ code: "DEVIN_ACP_SCOPE_CHANGED" }); expect(f.calls()).toHaveLength(1);
});
it("rejects a retargeted native directory alias", async () => {
  const f = fixture(), alias = join(f.root, "alias"); symlinkSync(f.scope.configHome, alias); f.scope.configHome = alias;
  const client = await open(f); rmSync(alias); symlinkSync(f.scope.dataHome, alias);
  await expect(client.listSessions({})).rejects.toMatchObject({ code: "DEVIN_ACP_SCOPE_CHANGED" });
});
it("rejects cancellation before enqueue without a native query", async () => {
  const f = fixture(), client = await open(f), controller = new AbortController(); controller.abort();
  await expect(client.listSessions({}, { signal: controller.signal })).rejects.toMatchObject({ code: "DEVIN_ACP_CANCELLED" }); expect(f.calls()).toHaveLength(1);
});
it("cancellation settles locally when the native agent never replies", async () => {
  const f = fixture("ignore"), client = await open(f), controller = new AbortController();
  const result = client.listSessions({}, { signal: controller.signal }); await vi.waitFor(() => expect(f.calls()).toHaveLength(2)); controller.abort();
  await expect(result).rejects.toMatchObject({ code: "DEVIN_ACP_CANCELLED" }); expect(client.disconnectSignal.aborted).toBe(true);
});
it("a local request deadline does not await cooperative native cancellation", async () => {
  const f = fixture("ignore"), client = await open(f), started = performance.now();
  await expect(client.listSessions({}, { timeoutMs: 30 })).rejects.toMatchObject({ code: "DEVIN_ACP_TIMEOUT" }); expect(performance.now() - started).toBeLessThan(500);
});
it("root exit rejects reads despite inherited stdout pipes", async () => {
  const f = fixture("root-exit"), client = await open(f), started = performance.now();
  await expect(client.listSessions({})).rejects.toMatchObject({ code: "DEVIN_ACP_DISCONNECTED" }); expect(performance.now() - started).toBeLessThan(1_000);
});
it("does not export native error detail", async () => {
  const f = fixture("error"), client = await open(f);
  await expect(client.listSessions({})).rejects.toMatchObject({ code: "DEVIN_ACP_REQUEST_FAILED", message: "DEVIN_ACP_REQUEST_FAILED" });
});
it("defaults permission callbacks to cancellation without tool approval", async () => {
  const f = fixture("permission"), client = await open(f); await client.listSessions({});
  await vi.waitFor(() => expect(f.calls().some(m => m.id === "permission-1" && "result" in m)).toBe(true));
  expect(f.calls().find(m => m.id === "permission-1")).toMatchObject({ result: { outcome: { outcome: "cancelled" } } });
});
it("bounded close preserves Session files and does not prove tools or writer release", async () => {
  const f = fixture(), file = join(f.scope.dataHome, "native-session"); writeFileSync(file, "retain"); const client = await open(f);
  expect(await client.close()).toMatchObject({ version: 1, connection: "closed", ownedRoot: "exited", callbacks: "drained", backgroundTools: "unknown", nativeSessionDeleted: false }); expect(readFileSync(file, "utf8")).toBe("retain");
  await expect(client.listSessions({})).rejects.toMatchObject({ code: "DEVIN_ACP_DISCONNECTED" });
});
it("checks monotonic expiry after a synchronous final Guard", async () => {
  const f = fixture(), client = await open(f);
  await expect(client.listSessions({}, { timeoutMs: 20, beforeSend: () => { const end = performance.now() + 120; while (performance.now() < end) { /* deliberate blocking guard */ } } })).rejects.toMatchObject({ code: "DEVIN_ACP_TIMEOUT" });
  expect(f.calls()).toHaveLength(1);
});
it("retains unknown callback cleanup for an unsettled forbidden async Guard", async () => {
  const f = fixture(), client = await open(f);
  await expect(client.listSessions({}, { beforeSend: (() => new Promise<void>(() => {})) as unknown as () => void })).rejects.toMatchObject({ code: "DEVIN_ACP_AUTHORITY_CHANGED" });
  expect(await client.close()).toMatchObject({ callbacks: "unknown", backgroundTools: "unknown", nativeSessionDeleted: false });
});
it.each(["callback-flood", "callback-big-id"])("bounds callback ingress before the SDK queues %s", async mode => {
  const f = fixture(mode), client = await open(f);
  await expect(client.listSessions({})).rejects.toMatchObject({ code: expect.stringMatching(/^DEVIN_ACP_(INBOUND_LIMIT|PROTOCOL_INVALID)$/) });
  expect(client.disconnectSignal.aborted).toBe(true);
});
it("rejects unexpected native notifications before the SDK can log raw credentials", async () => {
  const logs: unknown[][] = [], spy = vi.spyOn(console, "error").mockImplementation((...args) => { logs.push(args); });
  try {
    const f = fixture("bad-notification"), client = await open(f);
    await expect(client.listSessions({})).rejects.toMatchObject({ code: "DEVIN_ACP_PROTOCOL_INVALID" });
    expect(logs).toEqual([]);
  } finally { spy.mockRestore(); }
});
it("bounds outstanding SDK requests and rejects the sixty-fifth admission", async () => {
  const f = fixture("ignore"), client = await open(f);
  const pending = Array.from({ length: 64 }, () => client.listSessions({}).then(() => "unexpected-success", () => "rejected"));
  await expect(client.listSessions({})).rejects.toMatchObject({ code: "DEVIN_ACP_REQUEST_LIMIT" });
  await client.close(); expect(await Promise.all(pending)).toEqual(Array.from({ length: 64 }, () => "rejected"));
});
it("clones the original cancellation and guard options before queued native work", async () => {
  const f = fixture(), client = await open(f), original = new AbortController(), replacement = new AbortController();
  const options = { signal: original.signal, beforeSend: () => {} }, input = { cursor: "original" }, pending = client.listSessions(input, options);
  options.signal = replacement.signal; options.beforeSend = () => { throw Error("new guard"); }; input.cursor = "changed";
  expect(await pending).toMatchObject({ sessions: [{ sessionId: "native-exact" }] });
  expect(f.calls().at(-1)).toMatchObject({ params: { cursor: "original" } });
});

const executionRef: ExecutionContextRef = { version: 1, id: "execution", kind: "managed-worktree", runnerId: "local", repositoryId: "repository", workspaceId: "run", pathRef: "workspace:run", branch: "codex/run", baseRevision: "base" };
const executionSelection: ExecutionSelection = { version: 1, mode: "manual", source: "explicit", profileId: "local-devin", runnerId: "local", providerId: "devin-local", backendId: "devin-local-acp", selectionType: "explicit-model", requestedModel: "chosen", nativeParameters: {}, contextFingerprint: "fixture", configRevision: 1, selectedAt: "2026-10-13T00:00:00.000Z" };
function bootstrap(f: ReturnType<typeof fixture>, resume = false) {
  const binding: NativeBinding = { version: 1, product: "devin-local", region: "global", profileId: "local-devin", backendId: "devin-local-acp", runnerId: "local", nativeStoreRef: "native-store:devin-local", nativeSessionId: "native-exact", identityState: "bound", executionRefId: "execution" };
  return { mode: resume ? "resume" as const : "new" as const, profileId: "local-devin", runnerId: "local", nativeStoreRef: "native-store:devin-local", dispatcherSessionId: "dispatcher-exact", workspacePath: f.scope.workspacePath, executionRef: structuredClone(executionRef), executionSelection: structuredClone(executionSelection), ...(resume ? { binding } : {}) };
}
it("binds a native new Session before changing its exact offered model", async () => {
  const f = fixture("model-set"), client = await open(f), saved: NativeBinding[] = []; let persisted = false;
  const result = await client.beginSession(bootstrap(f), { beforeSend: () => {}, onBinding: async binding => { saved.push(binding); persisted = true; writeFileSync(join(f.root, "binding-persisted"), "yes"); } });
  expect(result).toMatchObject({ binding: { product: "devin-local", nativeSessionId: "native-exact" }, modelId: "chosen" });
  expect(persisted).toBe(true); expect(f.calls().at(-1)).toMatchObject({ bindingPersisted: true }); expect(saved[0]?.nativeSessionId).not.toBe("dispatcher-exact"); expect(f.calls().map(m => m.method)).toEqual(["initialize", "session/new", "session/set_config_option"]);
});
it.each(["missing-old", "prefix-old"])("never recreates an unproven old Session %s", async mode => {
  const f = fixture(mode), client = await open(f);
  await expect(client.beginSession(bootstrap(f, true), { beforeSend: () => {}, onBinding: async () => {} })).rejects.toMatchObject({ code: "DEVIN_ACP_SESSION_NOT_FOUND", creationOutcome: "not-created" });
  expect(f.calls().map(m => m.method)).toEqual(["initialize", "session/list"]);
});
it("loads only the exact existing native ID without changing its model", async () => {
  const f = fixture(), client = await open(f), input = bootstrap(f, true);
  expect(await client.beginSession(input, { beforeSend: () => {}, onBinding: async () => {} })).toMatchObject({ binding: input.binding, modelId: "chosen" });
  expect(f.calls().map(m => m.method)).toEqual(["initialize", "session/list", "session/load"]);
  expect(f.calls().at(-1)).toMatchObject({ params: { sessionId: "native-exact", cwd: f.scope.workspacePath, mcpServers: [] } });
});
it("refuses model drift on resume without setting the old Session model", async () => {
  const f = fixture("model-set"), client = await open(f);
  await expect(client.beginSession(bootstrap(f, true), { beforeSend: () => {}, onBinding: async () => {} })).rejects.toMatchObject({ code: "DEVIN_ACP_MODEL_DRIFT" });
  expect(f.calls().some(m => m.method === "session/set_config_option" || m.method === "session/new")).toBe(false);
});
it.each(["profileId", "backendId", "nativeStoreRef", "nativeSessionId", "executionRefId"] as const)("rejects drifted resume binding %s before native load", async field => {
  const f = fixture(), client = await open(f), input = bootstrap(f, true); input.binding![field] = "foreign";
  if (field === "nativeSessionId") {
    await expect(client.beginSession(input, { beforeSend: () => {}, onBinding: async () => {} })).rejects.toMatchObject({ code: "DEVIN_ACP_SESSION_NOT_FOUND" });
  } else await expect(client.beginSession(input, { beforeSend: () => {}, onBinding: async () => {} })).rejects.toMatchObject({ code: "DEVIN_ACP_IDENTITY_CHANGED" });
  expect(f.calls().some(m => m.method === "session/load" || m.method === "session/new")).toBe(false);
});
it("refuses a cloud or changed managed execution context before native mutation", async () => {
  const f = fixture(), client = await open(f), input = bootstrap(f); input.executionSelection.providerId = "devin";
  await expect(client.beginSession(input, { beforeSend: () => {}, onBinding: async () => {} })).rejects.toMatchObject({ code: "DEVIN_ACP_SCOPE_CHANGED", creationOutcome: "not-created" }); expect(f.calls()).toHaveLength(1);
});
it("captures bootstrap input before native awaits", async () => {
  const f = fixture(), client = await open(f), input = bootstrap(f);
  const pending = client.beginSession(input, { beforeSend: () => {}, onBinding: async () => {} }); input.profileId = "foreign"; input.executionSelection.requestedModel = "other"; input.executionRef.id = "foreign";
  expect(await pending).toMatchObject({ binding: { profileId: "local-devin", executionRefId: "execution" }, modelId: "chosen" });
});
it("awaits binding persistence and rejects duplicate bootstrap without native input", async () => {
  const f = fixture("model-set"), client = await open(f); let resolve!: () => void;
  const pending = client.beginSession(bootstrap(f), { beforeSend: () => {}, onBinding: () => new Promise<void>(r => { resolve = r; }) });
  await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
  await expect(client.beginSession(bootstrap(f), { beforeSend: () => {}, onBinding: async () => {} })).rejects.toMatchObject({ code: "DEVIN_ACP_SESSION_BUSY" });
  expect(f.calls().some(m => m.method === "session/set_config_option")).toBe(false); resolve(); expect(await pending).toMatchObject({ modelId: "chosen" });
});
it("does not change a model after binding persistence fails", async () => {
  const f = fixture("model-set"), client = await open(f);
  await expect(client.beginSession(bootstrap(f), { beforeSend: () => {}, onBinding: async () => { throw Error("cog-do-not-log"); } })).rejects.toMatchObject({ code: "DEVIN_ACP_BINDING_FAILED", creationOutcome: "unknown" }); expect(f.calls().some(m => m.method === "session/set_config_option")).toBe(false);
});
it("a stalled binding callback has an unknown local cleanup receipt", async () => {
  const f = fixture("model-set"), client = await open(f);
  await expect(client.beginSession(bootstrap(f), { timeoutMs: 100, beforeSend: () => {}, onBinding: () => new Promise(() => {}) })).rejects.toMatchObject({ code: "DEVIN_ACP_TIMEOUT", creationOutcome: "unknown" });
  expect((await client.close()).callbacks).toBe("unknown"); expect(f.calls().some(m => m.method === "session/set_config_option")).toBe(false);
});
it("a lost native create response remains unknown without another create", async () => {
  const f = fixture("create-ignore"), client = await open(f);
  await expect(client.beginSession(bootstrap(f), { timeoutMs: 100, beforeSend: () => {}, onBinding: async () => {} })).rejects.toMatchObject({ code: "DEVIN_ACP_TIMEOUT", creationOutcome: "unknown" }); expect(f.calls().filter(m => m.method === "session/new")).toHaveLength(1);
});
it("refuses an unknown model contract before any model or prompt operation", async () => {
  const f = fixture("missing-model"), client = await open(f);
  await expect(client.beginSession(bootstrap(f), { beforeSend: () => {}, onBinding: async () => {} })).rejects.toMatchObject({ code: "DEVIN_ACP_MODEL_UNQUALIFIED" });
  expect(f.calls().some(m => m.method === "session/set_config_option" || m.method === "session/prompt")).toBe(false);
});
it("refuses a wrong returned load ID", async () => {
  const f = fixture("load-wrong-id"), client = await open(f);
  await expect(client.beginSession(bootstrap(f, true), { beforeSend: () => {}, onBinding: async () => {} })).rejects.toMatchObject({ code: "DEVIN_ACP_IDENTITY_CHANGED" });
});
it("accepts scoped initial metadata without entering SDK notification logs", async () => {
  const f = fixture("metadata-update"), client = await open(f);
  expect(await client.beginSession(bootstrap(f), { beforeSend: () => {}, onBinding: async () => {} })).toMatchObject({ modelId: "chosen" });
});
it("rejects foreign Session updates while loading the original native Session", async () => {
  const f = fixture("foreign-update"), client = await open(f);
  await expect(client.beginSession(bootstrap(f, true), { beforeSend: () => {}, onBinding: async () => {} })).rejects.toMatchObject({ code: "DEVIN_ACP_IDENTITY_CHANGED" });
});
it("persists a known native ID even when model metadata cannot qualify", async () => {
  const f = fixture("missing-model"), client = await open(f), saved: NativeBinding[] = [];
  await expect(client.beginSession(bootstrap(f), { beforeSend: () => {}, onBinding: async binding => { saved.push(binding); } })).rejects.toMatchObject({ code: "DEVIN_ACP_MODEL_UNQUALIFIED", creationOutcome: "unknown" });
  expect(saved).toMatchObject([{ nativeSessionId: "native-exact", product: "devin-local" }]);
});
it.each([false, true])("rejects a newer native model change while binding persistence awaits (resume=%s)", async resume => {
  const f = fixture("model-drift-during-binding"), client = await open(f);
  await expect(client.beginSession(bootstrap(f, resume), { beforeSend: () => {}, onBinding: async () => { await new Promise(resolve => setTimeout(resolve, 40)); } })).rejects.toMatchObject({ code: "DEVIN_ACP_MODEL_DRIFT", creationOutcome: "unknown" });
  expect(f.calls().some(m => m.method === "session/set_config_option")).toBe(false);
});
it("drops valid initial Session info without leaking metadata or blocking resume", async () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const f = fixture("session-info-update"), client = await open(f);
    expect(await client.beginSession(bootstrap(f, true), { beforeSend: () => {}, onBinding: async () => {} })).toMatchObject({ modelId: "chosen" });
    expect(spy).not.toHaveBeenCalled();
  } finally { spy.mockRestore(); }
});
it("rechecks original authority after binding before changing the model", async () => {
  const f = fixture("model-set"), client = await open(f); let allowed = true;
  await expect(client.beginSession(bootstrap(f), { beforeSend: () => { if (!allowed) throw Error("revoked"); }, onBinding: async () => { allowed = false; } })).rejects.toMatchObject({ code: "DEVIN_ACP_AUTHORITY_CHANGED", creationOutcome: "unknown" }); expect(f.calls().some(m => m.method === "session/set_config_option")).toBe(false);
});

async function ready(f: ReturnType<typeof fixture>) {
  const client = await open(f), { binding } = await client.beginSession(bootstrap(f), { beforeSend: () => {}, onBinding: async () => {} });
  return { client, binding };
}
it("requires a successful exact bootstrap before prompt input", async () => {
  const f = fixture(), client = await open(f);
  await expect(client.prompt({ binding: bootstrap(f, true).binding!, message: "inspect" }, { beforeSend: () => {} })).rejects.toMatchObject({ code: "DEVIN_ACP_IDENTITY_CHANGED" });
  expect(f.calls().some(m => m.method === "session/prompt")).toBe(false);
});
it("sends one literal text prompt under the bound Session and projects updates", async () => {
  const f = fixture(), { client, binding } = await ready(f), updates: unknown[] = [];
  expect(await client.prompt({ binding, message: "inspect\nexact input" }, { beforeSend: () => {}, onUpdate: update => { updates.push(update); } })).toEqual({ stopReason: "end_turn", executionEvidence: true, toolFailure: false, permissionDenied: false, pendingTools: 0 });
  expect(f.calls().at(-1)).toMatchObject({ method: "session/prompt", params: { sessionId: "native-exact", prompt: [{ type: "text", text: "inspect\nexact input" }] } });
  expect(updates).toEqual([{ kind: "activity", nativeSessionId: "native-exact" }, { kind: "tool", nativeSessionId: "native-exact", toolCallId: "tool-0", status: "in_progress" }, { kind: "tool", nativeSessionId: "native-exact", toolCallId: "tool-0", status: "completed" }]);
  expect(JSON.stringify(updates)).not.toMatch(/cog|credential|rawInput|rawOutput|title/);
});
it.each(["max_tokens", "max_turn_requests", "refusal", "cancelled"])("retains the actual prompt stopReason %s without rewriting success", async stopReason => {
  const f = fixture("stop-" + stopReason), { client, binding } = await ready(f);
  expect(await client.prompt({ binding, message: "inspect" }, { beforeSend: () => {} })).toMatchObject({ stopReason });
});
it.each(["prompt-foreign", "prompt-drift", "prompt-bad-text", "prompt-bad-tool", "prompt-huge", "prompt-many-tools", "prompt-flood", "stop-invented"])("refuses invalid active prompt metadata %s", async mode => {
  const f = fixture(mode), { client, binding } = await ready(f);
  await expect(client.prompt({ binding, message: "inspect" }, { beforeSend: () => {} })).rejects.toMatchObject({ code: expect.stringMatching(/^DEVIN_ACP_(IDENTITY_CHANGED|MODEL_DRIFT|PROTOCOL_INVALID|INBOUND_LIMIT)$/) });
});
it.each(["prompt-tool-failed", "prompt-tool-pending", "prompt-permission"])("does not hide failed, unfinished or denied native operations %s", async mode => {
  const f = fixture(mode), { client, binding } = await ready(f);
  const result = await client.prompt({ binding, message: "inspect" }, { beforeSend: () => {} });
  expect(result).toMatchObject({ stopReason: "end_turn", toolFailure: mode === "prompt-tool-failed", pendingTools: mode === "prompt-tool-pending" ? 1 : 0, permissionDenied: mode === "prompt-permission" });
  if (mode === "prompt-permission") { await vi.waitFor(() => expect(f.calls().find(m => m.id === "prompt-permission-1")).toMatchObject({ result: { outcome: { outcome: "cancelled" } } })); }
});
it("refuses another active prompt without changing its owned connection", async () => {
  const f = fixture("prompt-ignore"), { client, binding } = await ready(f), pending = client.prompt({ binding, message: "first" }, { beforeSend: () => {} });
  void pending.catch(() => {}); await vi.waitFor(() => expect(f.calls().some(m => m.method === "session/prompt")).toBe(true));
  await expect(client.prompt({ binding, message: "second" }, { beforeSend: () => {} })).rejects.toMatchObject({ code: "DEVIN_ACP_SESSION_BUSY" });
  expect(client.disconnectSignal.aborted).toBe(false); await client.close(); await expect(pending).rejects.toMatchObject({ code: "DEVIN_ACP_DISCONNECTED" });
});
it("captures exact prompt binding, message, signal and Guard before queued input", async () => {
  const f = fixture(), { client, binding } = await ready(f), controller = new AbortController();
  const input = { binding, message: "original" }, options = { signal: controller.signal, beforeSend: () => {} }, pending = client.prompt(input, options);
  input.binding.nativeSessionId = "foreign"; input.message = "changed"; options.beforeSend = () => { throw Error("replacement"); };
  expect(await pending).toMatchObject({ stopReason: "end_turn" }); expect(f.calls().at(-1)).toMatchObject({ params: { sessionId: "native-exact", prompt: [{ text: "original" }] } });
});
it("refuses revoked prompt authority before native bytes", async () => {
  const f = fixture(), { client, binding } = await ready(f);
  await expect(client.prompt({ binding, message: "inspect" }, { beforeSend: () => { throw Error("revoked"); } })).rejects.toMatchObject({ code: "DEVIN_ACP_AUTHORITY_CHANGED" }); expect(f.calls().some(m => m.method === "session/prompt")).toBe(false);
});
it("bounds a missing prompt response and closes without reporting native completion", async () => {
  const f = fixture("prompt-ignore"), { client, binding } = await ready(f);
  await expect(client.prompt({ binding, message: "inspect" }, { beforeSend: () => {}, timeoutMs: 100 })).rejects.toMatchObject({ code: "DEVIN_ACP_TIMEOUT" });
  expect(await client.close()).toMatchObject({ backgroundTools: "unknown", nativeSessionDeleted: false });
});
it("cannot cancel a foreign Session and does not submit its notification", async () => {
  const f = fixture("prompt-ignore"), { client, binding } = await ready(f), pending = client.prompt({ binding, message: "inspect" }, { beforeSend: () => {} }); void pending.catch(() => {});
  await vi.waitFor(() => expect(f.calls().some(m => m.method === "session/prompt")).toBe(true));
  await expect(client.cancelPrompt({ binding: { ...binding, nativeSessionId: "foreign" } }, { beforeSend: () => {} })).rejects.toMatchObject({ code: "DEVIN_ACP_IDENTITY_CHANGED" }); expect(f.calls().some(m => m.method === "session/cancel")).toBe(false);
});
it("separates guarded cancellation submission from the original prompt terminal", async () => {
  const f = fixture("prompt-ignore"), { client, binding } = await ready(f), pending = client.prompt({ binding, message: "inspect" }, { beforeSend: () => {} });
  await vi.waitFor(() => expect(f.calls().some(m => m.method === "session/prompt")).toBe(true));
  expect(await client.cancelPrompt({ binding }, { beforeSend: () => {} })).toEqual({ disposition: "submitted" });
  expect(await pending).toMatchObject({ stopReason: "cancelled" }); expect(f.calls().filter(m => m.method === "session/cancel")).toEqual([expect.objectContaining({ params: { sessionId: "native-exact" } })]);
});
it("does not fabricate cancellation when the original native terminal is lost", async () => {
  const f = fixture("prompt-lost-cancel"), { client, binding } = await ready(f), pending = client.prompt({ binding, message: "inspect" }, { beforeSend: () => {}, timeoutMs: 150 }); void pending.catch(() => {});
  await vi.waitFor(() => expect(f.calls().some(m => m.method === "session/prompt")).toBe(true));
  expect(await client.cancelPrompt({ binding }, { beforeSend: () => {} })).toMatchObject({ disposition: "submitted" }); await expect(pending).rejects.toMatchObject({ code: "DEVIN_ACP_TIMEOUT" });
});
it("rejects a failing synchronous update consumer without forwarding its error", async () => {
  const f = fixture(), { client, binding } = await ready(f);
  await expect(client.prompt({ binding, message: "inspect" }, { beforeSend: () => {}, onUpdate: () => { throw Error("cog-credential"); } })).rejects.toMatchObject({ code: "DEVIN_ACP_CALLBACK_FAILED", message: "DEVIN_ACP_CALLBACK_FAILED" });
});
it("retains unknown cleanup for an unsettled forbidden async update consumer", async () => {
  const f = fixture(), { client, binding } = await ready(f);
  await expect(client.prompt({ binding, message: "inspect" }, { beforeSend: () => {}, onUpdate: (() => new Promise<void>(() => {})) as unknown as () => void })).rejects.toMatchObject({ code: "DEVIN_ACP_CALLBACK_FAILED" });
  expect((await client.close()).callbacks).toBe("unknown");
});
it("continues two prompts on the same bound Session without new/load or model setters", async () => {
  const f = fixture(), { client, binding } = await ready(f);
  for (const message of ["first", "second"]) expect(await client.prompt({ binding, message }, { beforeSend: () => {} })).toMatchObject({ stopReason: "end_turn", executionEvidence: true, pendingTools: 0 });
  expect(f.calls().map(m => m.method)).toEqual(["initialize", "session/new", "session/prompt", "session/prompt"]);
  expect(f.calls().filter(m => m.method === "session/prompt").map(m => m.params)).toEqual([expect.objectContaining({ sessionId: "native-exact" }), expect.objectContaining({ sessionId: "native-exact" })]);
});
it("drops a valid multiline tool title while retaining its exact status", async () => {
  const f = fixture(), script = readFileSync(f.scope.executable, "utf8");
  writeFileSync(f.scope.executable, script.replace("title:'Raw secret title'", "title:" + JSON.stringify("Tool\nTitle")));
  const { client, binding } = await ready(f);
  expect(await client.prompt({ binding, message: "inspect" }, { beforeSend: () => {} })).toMatchObject({ stopReason: "end_turn", toolFailure: false, pendingTools: 0 });
});
it("checks the entire binding before prompt and does not infer cloud identity", async () => {
  const f = fixture(), { client, binding } = await ready(f);
  await expect(client.prompt({ binding: { ...binding, product: "devin" }, message: "inspect" }, { beforeSend: () => {} })).rejects.toMatchObject({ code: "DEVIN_ACP_IDENTITY_CHANGED" }); expect(f.calls().some(m => m.method === "session/prompt")).toBe(false);
});
it("rejects an empty prompt and oversized serialized input before native writes", async () => {
  const f = fixture(), { client, binding } = await ready(f);
  await expect(client.prompt({ binding, message: "" }, { beforeSend: () => {} })).rejects.toMatchObject({ code: "DEVIN_ACP_PROMPT_INVALID" });
  await expect(client.prompt({ binding, message: "\u0001".repeat(100_000) }, { beforeSend: () => {} })).rejects.toMatchObject({ code: "DEVIN_ACP_REQUEST_LIMIT" }); expect(f.calls().some(m => m.method === "session/prompt")).toBe(false);
});
it("keeps original cancellation even if the caller replaces options", async () => {
  const f = fixture("prompt-ignore"), { client, binding } = await ready(f), original = new AbortController();
  const options = { beforeSend: () => {}, signal: original.signal }, pending = client.prompt({ binding, message: "inspect" }, options); void pending.catch(() => {}); options.signal = new AbortController().signal;
  await vi.waitFor(() => expect(f.calls().some(m => m.method === "session/prompt")).toBe(true)); original.abort(); await expect(pending).rejects.toMatchObject({ code: "DEVIN_ACP_CANCELLED" });
});
it("does not submit duplicate cancel notifications for an active prompt", async () => {
  const f = fixture("prompt-ignore"), { client, binding } = await ready(f), pending = client.prompt({ binding, message: "inspect" }, { beforeSend: () => {} });
  await vi.waitFor(() => expect(f.calls().some(m => m.method === "session/prompt")).toBe(true));
  const submitted = client.cancelPrompt({ binding }, { beforeSend: () => {} });
  await expect(client.cancelPrompt({ binding }, { beforeSend: () => {} })).rejects.toMatchObject({ code: "DEVIN_ACP_SESSION_BUSY" }); await submitted; expect(await pending).toMatchObject({ stopReason: "cancelled" });
  expect(f.calls().filter(m => m.method === "session/cancel")).toHaveLength(1);
});
it("rechecks monotonic prompt deadline after the final cancellation Guard", async () => {
  const f = fixture("prompt-ignore"), { client, binding } = await ready(f), pending = client.prompt({ binding, message: "inspect" }, { beforeSend: () => {}, timeoutMs: 200 }); void pending.catch(() => {}); let checks = 0;
  await vi.waitFor(() => expect(f.calls().some(m => m.method === "session/prompt")).toBe(true));
  await expect(client.cancelPrompt({ binding }, { beforeSend: () => { if (++checks === 2) { const end = performance.now() + 250; while (performance.now() < end) { /* final send expires */ } } } })).rejects.toMatchObject({ code: "DEVIN_ACP_TIMEOUT" });
  expect(f.calls().some(m => m.method === "session/cancel")).toBe(false); await expect(pending).rejects.toMatchObject({ code: "DEVIN_ACP_TIMEOUT" });
});
it.each([{ delay: 150, timeout: 1_000 }, { delay: 250, timeout: 100 }])("drops an unsent stale cancellation without closing the completed Session (%s)", async ({ delay, timeout }) => {
  const f = fixture(), { client, binding } = await ready(f), stdin = (client as unknown as { child: { stdin: Writable } }).child.stdin;
  const originalWrite = stdin.write.bind(stdin); let signalWritten!: () => void;
  const written = new Promise<void>(resolve => { signalWritten = resolve; });
  const spy = vi.spyOn(stdin, "write").mockImplementation(((bytes: Uint8Array, callback: (error?: Error | null) => void) => {
    if (JSON.parse(Buffer.from(bytes).toString("utf8")).method === "session/prompt") {
      const accepted = originalWrite(bytes, error => { setTimeout(() => callback(error), delay); }); signalWritten(); return accepted;
    }
    return originalWrite(bytes, callback);
  }) as typeof stdin.write);
  try {
    const pending = client.prompt({ binding, message: "inspect" }, { beforeSend: () => {}, timeoutMs: timeout }); await written;
    const cancel = client.cancelPrompt({ binding }, { beforeSend: () => {} }); void cancel.catch(() => {});
    expect(await pending).toMatchObject({ stopReason: "end_turn" }); expect(await cancel).toEqual({ disposition: "not-submitted" });
    expect(client.disconnectSignal.aborted).toBe(false); expect(f.calls().some(m => m.method === "session/cancel")).toBe(false);
    expect(await client.prompt({ binding, message: "next" }, { beforeSend: () => {} })).toMatchObject({ stopReason: "end_turn" });
  } finally { spy.mockRestore(); }
});

// Direct regressions for the current admission and root-only cleanup boundary.
it.each(["abort", "revoked", "async"])("rejects creation admission %s before the version probe", async mode => {
  const f = fixture(), controller = new AbortController();
  const script = readFileSync(f.scope.executable, "utf8").replace("if(process.argv.includes('--version')){", "if(process.argv.includes('--version')){fs.writeFileSync(path.join(root,'version-probed'),'yes');"); writeFileSync(f.scope.executable, script);
  if (mode === "abort") controller.abort();
  const beforeCreate = mode === "revoked" ? () => { throw Error("revoked"); } : mode === "async" ? (() => Promise.resolve()) as unknown as () => void : () => {};
  const pending = adapters.DevinLocalAcpClient.open(f.scope, { signal: controller.signal, beforeCreate });
  void pending.then(client => { clients.push(client); }, () => {});
  await expect(pending).rejects.toMatchObject({ code: mode === "abort" ? "DEVIN_ACP_CANCELLED" : "DEVIN_ACP_AUTHORITY_CHANGED" });
  expect(existsSync(join(f.root, "version-probed"))).toBe(false); expect(existsSync(join(f.root, "started"))).toBe(false);
});
it.each(["abort", "revoked", "async", "scope"])("rechecks captured creation admission %s after the version probe", async mode => {
  const f = fixture(), controller = new AbortController(); let checks = 0;
  const options = { signal: controller.signal, beforeCreate: (() => { if (++checks !== 2) return; if (mode === "abort") controller.abort(); if (mode === "revoked") throw Error("revoked"); if (mode === "async") return Promise.resolve(); if (mode === "scope") { renameSync(f.scope.dataHome, f.scope.dataHome + "-old"); mkdirSync(f.scope.dataHome); } }) as () => void };
  const pending = adapters.DevinLocalAcpClient.open(f.scope, options); void pending.then(client => { clients.push(client); }, () => {});
  await expect(pending).rejects.toMatchObject({ code: mode === "abort" ? "DEVIN_ACP_CANCELLED" : mode === "scope" ? "DEVIN_ACP_SCOPE_CHANGED" : "DEVIN_ACP_AUTHORITY_CHANGED" });
  expect(checks).toBe(2); expect(existsSync(join(f.root, "started"))).toBe(false);
});
it("captures original creation options while the version probe awaits", async () => {
  const f = fixture(), controller = new AbortController(); let checks = 0;
  const options = { signal: controller.signal, beforeCreate: () => { checks++; } };
  const pending = adapters.DevinLocalAcpClient.open(f.scope, options); options.beforeCreate = () => { throw Error("replacement"); }; options.signal = AbortSignal.abort();
  const client = await pending; clients.push(client); expect(checks).toBe(2); expect(client.disconnectSignal.aborted).toBe(false);
});
it("removes Controller token and key from both native children", async () => {
  const f = fixture();
  const script = readFileSync(f.scope.executable, "utf8").replace("if(process.argv.includes('--version')){", "fs.writeFileSync(path.join(root,process.argv.includes('--version')?'probe-env':'acp-env'),JSON.stringify(Object.keys(process.env).filter(k=>/^DISPATCHER_(OWNER_TOKEN|SECRET_STORE_KEY)$/i.test(k))));if(process.argv.includes('--version')){"); writeFileSync(f.scope.executable, script);
  vi.stubEnv("DISPATCHER_OWNER_TOKEN", "fixture-controller-token"); vi.stubEnv("DISPATCHER_SECRET_STORE_KEY", "fixture-controller-key");
  try { await open(f); for (const name of ["probe-env", "acp-env"]) expect(JSON.parse(readFileSync(join(f.root, name), "utf8"))).toEqual([]); } finally { vi.unstubAllEnvs(); }
});
it.each(["legacy-only", "both", "owner", "runner", "context", "default", "model", "parameters"])("rejects canonical selection conflict %s before native session mutation", async kind => {
  const f = fixture(), client = await open(f), input = bootstrap(f);
  if (kind === "legacy-only" || kind === "both") { Object.assign(input, { modelSelection: { nativeSelectionId: "chosen" } }); if (kind === "legacy-only") delete (input as Partial<typeof input>).executionSelection; }
  if (kind === "owner") input.executionSelection.profileId = "foreign";
  if (kind === "runner") input.executionSelection.runnerId = "foreign";
  if (kind === "context") input.executionRef.runnerId = "foreign";
  if (kind === "default") Object.assign(input.executionSelection, { selectionType: "native-default", source: "native-default", requestedModel: undefined });
  if (kind === "model") input.executionSelection.requestedModel = "";
  if (kind === "parameters") input.executionSelection.nativeParameters = { reasoningEffort: "high" };
  await expect(client.beginSession(input, { beforeSend: () => {}, onBinding: async () => {} })).rejects.toMatchObject({ creationOutcome: "not-created" });
  expect(f.calls().map(call => call.method)).toEqual(["initialize"]);
});
it.each(["denied", "false"])("retains unknown cleanup and exact original PID after %s root stop", async mode => {
  const { EventEmitter } = await import("node:events"), { PassThrough } = await import("node:stream");
  const f = fixture(), pid = 123456;
  const child = Object.assign(new EventEmitter(), { pid, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(() => { queueMicrotask(() => { child.emit("exit", 0); Object.assign(child, { pid: undefined }); }); if (mode === "denied") throw Object.assign(Error("denied"), { code: "EPERM" }); return false; }) });
  const Constructor = adapters.DevinLocalAcpClient as unknown as new (...args: unknown[]) => adapters.DevinLocalAcpClient;
  const client = new Constructor(f.scope, structuredClone(f.scope), [], child); clients.push(client);
  const receipt = await client.close(); expect(receipt).toMatchObject({ ownedRoot: "unknown", ownedRootPid: pid, callbacks: "drained", backgroundTools: "unknown", nativeSessionDeleted: false });
  expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM"); expect(await client.close()).toBe(receipt);
});
it("normalizes forbidden returned Guard work exactly once and caches unknown drainage", async () => {
  const f = fixture(), client = await open(f); let assimilations = 0, settle!: () => void;
  const forbidden = { then(resolve: () => void) { assimilations++; settle = resolve; } };
  await expect(client.listSessions({}, { beforeSend: (() => forbidden) as unknown as () => void })).rejects.toMatchObject({ code: "DEVIN_ACP_AUTHORITY_CHANGED" });
  const receipt = await client.close(); expect(assimilations).toBe(1); expect(receipt.callbacks).toBe("unknown"); settle(); await Promise.resolve(); expect(await client.close()).toBe(receipt); expect(receipt.callbacks).toBe("unknown");
});
it("preserves both Unicode line separators in an exact native Session ID", async () => {
  const f = fixture("unicode"); writeFileSync(f.scope.executable, readFileSync(f.scope.executable, "utf8").replace("native-\\u2028-exact", "native-\\u2028-\\u2029-exact"));
  const client = await open(f); expect((await client.listSessions({})).sessions[0]?.sessionId).toBe("native-\u2028-\u2029-exact");
});
it("normalizes forbidden update work once and retains the cached unknown receipt", async () => {
  const f = fixture(), { client, binding } = await ready(f); let assimilations = 0, settle!: () => void;
  const forbidden = { then(resolve: () => void) { assimilations++; settle = resolve; } };
  await expect(client.prompt({ binding, message: "inspect" }, { beforeSend: () => {}, onUpdate: (() => forbidden) as unknown as () => void })).rejects.toMatchObject({ code: "DEVIN_ACP_CALLBACK_FAILED" });
  const receipt = await client.close(); expect(assimilations).toBe(1); expect(receipt.callbacks).toBe("unknown"); settle(); await Promise.resolve(); expect(await client.close()).toBe(receipt); expect(receipt.callbacks).toBe("unknown");
});
