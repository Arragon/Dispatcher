import Ajv from "ajv";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as adapters from "../src/index.js";
import type { CapabilityEvidence, NativeBinding } from "@dispatcher/domain";
import { DevinAdapter, HttpDevinBackend, MemorySessionStore, probeDevinProfile, type DevinProfileConfig } from "../src/index.js";

const profile: DevinProfileConfig = { id: "devin", alias: "Devin", organizationId: "org-exact", credentialRef: "secret://devin/exact" };
const snapshot = (extra: Record<string, unknown> = {}) => ({ org_id: "org-exact", session_id: "devin-exact", status: "running", pull_requests: [], ...extra });
const credential = async () => "cog-fixture-do-not-export";
function fixture(config: DevinProfileConfig = profile) {
  const fetchImpl = capturedFetch(vi.fn<typeof fetch>(async () => Response.json(snapshot())));
  return { fetchImpl, backend: new HttpDevinBackend(config, credential, fetchImpl) };
}
describe("Devin v3 organization and principal boundary", () => {
  it("keeps service-user creation un-attributed by default", async () => {
    const f = fixture(); await f.backend.create({ prompt: "task" });
    expect(JSON.parse(String(f.fetchImpl.mock.calls[0]![1]!.body))).toEqual({ prompt: "task" });
    expect(f.fetchImpl.mock.calls[0]![1]).toMatchObject({ redirect: "error" });
  });
  it("sends explicit human attribution and the configured native ACU limit", async () => {
    const f = fixture({ ...profile, createAsUserId: "user-exact", maxSessionAcu: 12 });
    f.fetchImpl.mockResolvedValueOnce(Response.json(snapshot({ user_id: "user-exact" })));
    await f.backend.create({ prompt: "task", maxSessionAcu: 12 });
    expect(JSON.parse(String(f.fetchImpl.mock.calls[0]![1]!.body))).toEqual({ prompt: "task", create_as_user_id: "user-exact", max_acu_limit: 12 });
  });
  it("reports attribution denial without a retry, elevation or provider detail", async () => {
    const f = fixture({ ...profile, createAsUserId: "user-exact" });
    f.fetchImpl.mockResolvedValueOnce(Response.json({ detail: "cog-sensitive denied" }, { status: 403 }));
    await expect(f.backend.create({ prompt: "task" })).rejects.toMatchObject({ code: "DEVIN_ATTRIBUTION_DENIED", message: "Devin user attribution was denied" });
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each(["org-foreign", undefined])("refuses an unproven response organization %s", async org_id => {
    const f = fixture(); f.fetchImpl.mockResolvedValueOnce(Response.json(snapshot({ org_id })));
    await expect(f.backend.get("devin-exact")).rejects.toMatchObject({ code: "DEVIN_IDENTITY_CHANGED" });
  });
  it.each(["devin-foreign", "devin-exact-prefix"])('refuses a different exact response session %s', async session_id => {
    const f = fixture(); f.fetchImpl.mockResolvedValueOnce(Response.json(snapshot({ session_id })));
    await expect(f.backend.get("devin-exact")).rejects.toMatchObject({ code: "DEVIN_IDENTITY_CHANGED" });
  });
  it.each(["user-foreign", undefined])("refuses unproven requested human attribution %s", async user_id => {
    const f = fixture({ ...profile, createAsUserId: "user-exact" }); f.fetchImpl.mockResolvedValueOnce(Response.json(snapshot({ user_id })));
    await expect(f.backend.create({ prompt: "task" })).rejects.toMatchObject({ code: "DEVIN_ATTRIBUTION_CHANGED" });
  });
  it("captures configuration before credential resolution awaits", async () => {
    const supplied = { ...profile, createAsUserId: "user-exact" }; const f = fixture(supplied);
    supplied.organizationId = "org-foreign"; supplied.createAsUserId = "user-foreign";
    f.fetchImpl.mockResolvedValueOnce(Response.json(snapshot({ user_id: "user-exact" })));
    await f.backend.create({ prompt: "task" });
    expect(f.fetchImpl.mock.calls[0]![0]).toBe("https://api.devin.ai/v3/organizations/org-exact/sessions");
    expect(JSON.parse(String(f.fetchImpl.mock.calls[0]![1]!.body)).create_as_user_id).toBe("user-exact");
  });
  it("rejects a send response for a different native session", async () => {
    const f = fixture(); f.fetchImpl.mockResolvedValueOnce(Response.json(snapshot({ session_id: "devin-foreign" })));
    await expect(f.backend.send("devin-exact", "follow-up")).rejects.toMatchObject({ code: "DEVIN_IDENTITY_CHANGED" });
  });
  it("does not expose raw credential resolver failure in diagnostics", async () => {
    const result = await probeDevinProfile(profile, async () => { throw new Error("cog-do-not-export"); });
    expect(result.authenticated).toBe(false); expect(JSON.stringify(result)).not.toContain("cog-do-not-export");
  });
  it("does not infer remaining ACU when native consumption is unknown", async () => {
    const f = fixture({ ...profile, maxSessionAcu: 12 }); const adapter = new DevinAdapter({ ...profile, maxSessionAcu: 12 }, f.backend);
    const session = await adapter.start({ runId: "run", workspacePath: "/workspace" });
    expect(await adapter.usage(session.id)).toEqual({ state: "UNKNOWN", limit: 12, source: "sdk", confidence: "low" });
  });
  it("preserves stored identity when a native read fails identity verification", async () => {
    const f = fixture(); const store = new MemorySessionStore(); const adapter = new DevinAdapter(profile, f.backend, store);
    const session = await adapter.start({ runId: "run", workspacePath: "/workspace" }); const before = store.load(session.id);
    f.fetchImpl.mockResolvedValueOnce(Response.json(snapshot({ session_id: "devin-other", status: "exit" })));
    await expect(adapter.status(session.id)).rejects.toMatchObject({ code: "DEVIN_IDENTITY_CHANGED" });
    expect(store.load(session.id)).toEqual(before);
  });
  it("does not fake native cancellation", async () => {
    const f = fixture(); const adapter = new DevinAdapter(profile, f.backend); const session = await adapter.start({ runId: "run", workspacePath: "/workspace" });
    await expect(adapter.cancel(session.id)).rejects.toMatchObject({ code: "UNSUPPORTED_CAPABILITY" });
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("rejects a Local ACP backend before cloud creation", async () => {
    const f = fixture(); const adapter = new DevinAdapter(profile, f.backend);
    await expect(adapter.start({ runId: "run", workspacePath: "/workspace", backendId: "devin-local-acp" })).rejects.toMatchObject({ creationOutcome: "not-created", code: "DEVIN_BACKEND_MISMATCH" });
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it("refuses a Session belonging to another profile before native reads", async () => {
    const f = fixture(); const store = new MemorySessionStore(); const adapter = new DevinAdapter(profile, f.backend, store);
    const session = await adapter.start({ runId: "run", workspacePath: "/workspace" }); store.save({ ...session, profileId: "foreign" }); f.fetchImpl.mockClear();
    await expect(adapter.status(session.id)).rejects.toMatchObject({ code: "SESSION_PROFILE_MISMATCH" }); expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it("does not store a factory-created Session with a wrong organization or owner", async () => {
    const store = new MemorySessionStore();
    const adapter = new DevinAdapter({ ...profile, createAsUserId: "user-exact" }, { health: async () => ({ ok: true }), create: async () => ({ sessionId: "devin-other", status: "running", organizationId: "org-other", userId: "user-other", pullRequests: [] }), get: async () => { throw Error(); }, send: async () => { throw Error(); } }, store);
    await expect(adapter.start({ runId: "run", sessionId: "reserved", workspacePath: "/workspace" })).rejects.toMatchObject({ code: "DEVIN_IDENTITY_CHANGED" }); expect(store.load("reserved")).toMatchObject({ id: "reserved", state: "STARTING", profileId: "devin" }); expect(store.load("reserved")).not.toHaveProperty("providerSessionId");
  });
  it("captures Dispatcher startup identity before awaiting cloud creation", async () => {
    const input = { runId: "run", sessionId: "reserved", workspacePath: "/workspace" }; const f = fixture();
    f.fetchImpl.mockImplementation(async () => { input.runId = "foreign"; input.workspacePath = "/foreign"; return Response.json(snapshot()); });
    const adapter = new DevinAdapter(profile, f.backend); expect(await adapter.start(input)).toMatchObject({ runId: "run", id: "reserved", workspacePath: "/workspace" });
  });
  it.each([0, -1, 12.5])("rejects a native creation ACU budget %s before sending", async maxSessionAcu => {
    const f = fixture(); await expect(f.backend.create({ prompt: "task", maxSessionAcu })).rejects.toMatchObject({ creationOutcome: "not-created", code: "DEVIN_ACU_LIMIT_INVALID" }); expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it("retains a configured ACU limit on direct native creation", async () => {
    const f = fixture({ ...profile, maxSessionAcu: 12 }); await f.backend.create({ prompt: "task" });
    expect(JSON.parse(String(f.fetchImpl.mock.calls[0]![1]!.body)).max_acu_limit).toBe(12);
  });
});

const binding: NativeBinding = { version: 1, product: "devin", region: "global", profileId: "devin", backendId: "devin-v3-api", runnerId: "cloud", nativeStoreRef: "devin-org:org-exact", nativeSessionId: "devin-exact", identityState: "bound", executionRefId: "cloud-execution" };
const evidence: CapabilityEvidence = { version: 1, support: "supported", level: "runtime-verified", scopeFingerprint: "scope", verifiedAt: "2026-10-13T00:00:00.000Z", evidenceRef: "evidence:fixture" };
const message = (extra: Record<string, unknown> = {}) => ({ event_id: "event-1", source: "user", message: "literal \u2028 text", created_at: 1791849600, ...extra });
function readFixture(qualified = true) {
  const f = fixture(); let page: Record<string, unknown> = { items: [message()], has_next_page: true, end_cursor: "opaque/+=" };
  f.fetchImpl.mockImplementation(async url => Response.json(String(url).includes("/messages?") ? page : snapshot({ service_user_id: "service-original" })));
  const scope = { binding: structuredClone(binding), organizationId: "org-exact", scopeFingerprint: "scope", ...(qualified ? { evidence: { durableIdentity: structuredClone(evidence), historyRead: structuredClone(evidence) } } : {}) };
  const port = new adapters.DevinV3InteractionPort(scope, f.backend);
  return { ...f, port, scope, setPage: (value: Record<string, unknown>) => { page = value; } };
}
describe("Devin read-only native interaction", () => {
  it("exports the internal readonly port through the existing root library", () => { expect(adapters).toHaveProperty("DevinV3InteractionPort", expect.any(Function)); });
  it("leaves all capabilities unknown without tuple evidence", async () => {
    const f = readFixture(false); expect(f.port.capabilities().historyRead.support).toBe("unknown");
    await expect(f.port.history(binding, { limit: 10 })).rejects.toMatchObject({ code: "NATIVE_CAPABILITY_UNVERIFIED" });
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it("does not upgrade mutation, GUI, stop or writer capabilities from read evidence", () => {
    const caps = readFixture().port.capabilities();
    expect(caps.durableIdentity.support).toBe("supported"); expect(caps.historyRead.support).toBe("supported");
    for (const name of ["sameSessionContinue", "liveSteer", "interruptTurn", "nativeApproval", "releaseControl", "reclaimControl", "restartReattach"] as const) expect(caps[name].support).not.toBe("supported");
    expect(caps.surfaces).toEqual({});
  });
  it.each(["product", "region", "profileId", "backendId", "runnerId", "nativeStoreRef", "nativeSessionId", "executionRefId"] as const)("rejects changed binding %s before a read", async field => {
    const f = readFixture(); await expect(f.port.history({ ...binding, [field]: "foreign" }, { limit: 10 })).rejects.toMatchObject({ code: "DEVIN_IDENTITY_CHANGED" }); expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it("returns native chronological event IDs and opaque pagination as partial coverage", async () => {
    const f = readFixture(); const page = await f.port.history(binding, { limit: 10, cursor: "native/+=" });
    expect(page).toMatchObject({ nativeSessionId: "devin-exact", source: "devin", state: "available", completeness: "partial", range: "native-history", nextCursor: "opaque/+=", entries: [{ id: "event-1", kind: "user", text: "literal \u2028 text", occurredAt: "2026-10-13T00:00:00.000Z" }] });
    const call = f.fetchImpl.mock.calls.find(([url]) => String(url).includes("/messages?"))!;
    expect(new URL(String(call[0])).searchParams.get("after")).toBe("native/+="); expect(new URL(String(call[0])).searchParams.get("first")).toBe("10");
    expect(f.fetchImpl.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  });
  it("captures request, scope and evidence before async reads", async () => {
    const f = readFixture(); const selected = structuredClone(binding); const request = { limit: 10, cursor: "original" }; const read = f.fetchImpl.getMockImplementation()!;
    f.fetchImpl.mockImplementation(async (...args) => { selected.nativeSessionId = "other"; request.cursor = "changed"; request.limit = 1; f.scope.binding.nativeSessionId = "other"; f.scope.evidence!.historyRead.support = "unknown"; return read(...args); });
    expect((await f.port.history(selected, request)).nativeSessionId).toBe("devin-exact");
    const call = f.fetchImpl.mock.calls.find(([url]) => String(url).includes("/messages?"))!; expect(new URL(String(call[0])).searchParams.get("after")).toBe("original");
  });
  it("does not start a read after cancellation", async () => {
    const f = readFixture(); const controller = new AbortController(); controller.abort();
    await expect(f.port.history(binding, { limit: 10 }, { requestId: "read", observerEpoch: "epoch", sequence: 1, signal: controller.signal })).rejects.toMatchObject({ code: "DEVIN_READ_CANCELLED" }); expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it("cancels a read even if the credential resolver ignores its signal", async () => {
    const backend = new HttpDevinBackend(profile, async () => new Promise(() => {}), vi.fn());
    const port = new adapters.DevinV3InteractionPort({ binding, organizationId: "org-exact", scopeFingerprint: "scope", evidence: { durableIdentity: evidence, historyRead: evidence } }, backend);
    const controller = new AbortController(); const result = port.history(binding, { limit: 10 }, { requestId: "read", observerEpoch: "epoch", sequence: 1, signal: controller.signal }); controller.abort();
    await expect(result).rejects.toMatchObject({ code: "DEVIN_READ_CANCELLED" });
  });
  it.each([
    { items: [message(), message()] }, { items: [message({ event_id: "" })] }, { items: [message({ source: "unknown" })] }, { items: [message({ created_at: "now" })] },
    { items: [], has_next_page: true, end_cursor: null }, { items: [message()], has_next_page: true, end_cursor: "loop" }, { items: [message()], has_next_page: "true" },
  ])("rejects invalid native history %j", async page => {
    const f = readFixture(); f.setPage(page); await expect(f.port.history(binding, { limit: 10, cursor: "loop" })).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
  });
  it("rejects an oversized response without claiming a complete history", async () => {
    const f = readFixture(); f.setPage({ items: [message({ message: "x".repeat(1_048_577) })] });
    await expect(f.port.history(binding, { limit: 10 })).rejects.toMatchObject({ code: "DEVIN_RESPONSE_TOO_LARGE" });
  });
  it("keeps partial range and explicit truncation on long native text", async () => {
    const f = readFixture(); f.setPage({ items: [message({ message: "x".repeat(30_000) })], has_next_page: false, end_cursor: null });
    const page = await f.port.history(binding, { limit: 10 }); expect(page.entries[0]).toMatchObject({ truncated: true }); expect(Buffer.byteLength(page.entries[0]!.text)).toBeLessThanOrEqual(16_384); expect(page.completeness).toBe("partial"); expect(page.truncation).toBeDefined();
  });
  it("does not turn a native finished state into tool or writer release", async () => {
    const f = readFixture(); f.fetchImpl.mockResolvedValueOnce(Response.json(snapshot({ status: "exit", status_detail: "finished" })));
    expect(await f.port.inspect(binding)).toMatchObject({ state: "idle", pendingTools: "unknown", pendingApprovals: "unknown", historyMode: "snapshot-only" });
  });
  it("returns conservative exact cloud instructions without launching or executing", async () => {
    const f = readFixture(false); const access = await f.port.access(binding);
    expect(access[0]).toMatchObject({ availability: "unverified", surface: "web", action: { kind: "instructions" } }); expect(JSON.stringify(access)).toContain("devin-exact"); expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it("aborts a stalled native response body without later queries", async () => {
    const f = readFixture(); const controller = new AbortController();
    f.fetchImpl.mockResolvedValueOnce(new Response(new ReadableStream({ start() {} })));
    const result = f.port.history(binding, { limit: 10 }, { requestId: "read", observerEpoch: "epoch", sequence: 1, signal: controller.signal });
    await vi.waitFor(() => expect(f.fetchImpl).toHaveBeenCalledTimes(1)); controller.abort();
    await expect(result).rejects.toMatchObject({ code: "DEVIN_READ_CANCELLED" }); expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("bounds the entire multi-query read to five seconds", async () => {
    const f = readFixture(); f.fetchImpl.mockImplementation(async () => new Promise(() => {}));
    const started = performance.now();
    await expect(f.port.history(binding, { limit: 10 })).rejects.toMatchObject({ code: "DEVIN_READ_CANCELLED" });
    expect(performance.now() - started).toBeLessThan(7_000); expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  }, 8_000);
  it("rejects native attribution drift across a page read", async () => {
    const f = readFixture();
    f.fetchImpl.mockResolvedValueOnce(Response.json(snapshot({ service_user_id: "service-original" }))).mockResolvedValueOnce(Response.json({ items: [message()] })).mockResolvedValueOnce(Response.json(snapshot({ service_user_id: "service-other" })));
    await expect(f.port.history(binding, { limit: 10 })).rejects.toMatchObject({ code: "DEVIN_ATTRIBUTION_CHANGED" });
  });
  it("rejects a nonstring message source rather than coercing it into an identity", async () => {
    const f = readFixture(); f.setPage({ items: [message({ source: ["user"] })] });
    await expect(f.port.history(binding, { limit: 10 })).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
  });
  it("rejects JSON escaping that would exceed the retained page byte bound", async () => {
    const f = readFixture(); f.setPage({ items: Array.from({ length: 10 }, (_, i) => message({ event_id: "event-" + i, message: "\u0001".repeat(10_000) })) });
    const page = await f.port.history(binding, { limit: 10 }); expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(262_144); expect(page.truncation).toBeDefined();
  });
});

let captureIndex = 0;
function retain(value: Record<string, unknown>): void {
  const root = process.env.DISPATCHER_DEVIN_FIXTURE_EVIDENCE; if (!root) return;
  mkdirSync(root, { recursive: true }); appendFileSync(join(root, "http-" + process.pid + ".jsonl"), JSON.stringify({ index: ++captureIndex, utc: new Date().toISOString(), test: expect.getState().currentTestName, ...value }) + "\n");
}
function capturedFetch<T extends typeof fetch>(mock: T): T {
  return new Proxy(mock, { apply(target, receiver, args: Parameters<typeof fetch>) {
    const [url, init] = args; const requestId = ++captureIndex, test = expect.getState().currentTestName;
    const record = (value: Record<string, unknown>) => retain({ requestId, test, ...value });
    const aborted = () => record({ phase: "abort", signalAborted: true });
    const settled = () => init?.signal?.removeEventListener("abort", aborted);
    record({ phase: "request", requestId, url: String(url), method: init?.method ?? "GET", body: init?.body, redirect: init?.redirect, signalAborted: init?.signal?.aborted, authorization: "controlled fixture token withheld" });
    init?.signal?.addEventListener("abort", aborted, { once: true });
    return Reflect.apply(target, receiver, args).then((response: Response) => {
      record({ phase: "response", requestId, status: response.status, headers: [...response.headers] });
      if (response.body) {
        const body = response.body, getReader = body.getReader.bind(body), cancelBody = body.cancel.bind(body);
        body.cancel = async reason => { record({ phase: "body-cancel-request", requestId }); const result = await cancelBody(reason); settled(); record({ phase: "body-cancel-settled", requestId }); return result; };
        body.getReader = (() => {
          const reader = getReader(), read = reader.read.bind(reader), cancel = reader.cancel.bind(reader);
          reader.read = async () => { const chunk = await read(); if (chunk.done) settled(); record({ phase: "body", requestId, done: chunk.done, bytes: chunk.value ? Buffer.from(chunk.value).toString("base64") : undefined }); return chunk; };
          reader.cancel = async reason => { record({ phase: "cancel-request", requestId }); const result = await cancel(reason); settled(); record({ phase: "cancel-settled", requestId }); return result; };
          return reader;
        }) as typeof body.getReader;
      }
      if (!response.body) settled();
      return response;
    }, (error: unknown) => { settled(); record({ phase: "fetch-rejected", requestId, diagnostic: error instanceof Error ? error.message : "unknown" }); throw error; });
  } });
}
beforeEach(() => { vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected real I/O"); })); });
afterEach(() => { retain({ phase: "test-ended" }); vi.unstubAllGlobals(); });

describe("Devin current contract regressions", () => {
  it("holds the reserved identity across credential preparation and rejects duplicate create", async () => {
    const entered = Promise.withResolvers<void>(), ready = Promise.withResolvers<string>();
    const f = fixture(), store = new MemorySessionStore();
    const backend = new HttpDevinBackend(profile, async () => { entered.resolve(); return ready.promise; }, f.fetchImpl);
    const adapter = new DevinAdapter(profile, backend, store), input = { runId: "run", sessionId: "held", workspacePath: "/workspace" }, first = adapter.start(input);
    try {
      await entered.promise; const reserved = store.load("held");
      expect(reserved).toMatchObject({ state: "STARTING" }); expect(reserved).not.toHaveProperty("providerSessionId");
      await expect(adapter.start(input)).rejects.toMatchObject({ creationOutcome: "not-created", code: "SESSION_ID_CONFLICT" }); expect(f.fetchImpl).not.toHaveBeenCalled();
      ready.resolve("controlled-token"); expect((await first).id).toBe("held"); expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    } finally { ready.resolve("controlled-token"); await first.catch(() => undefined); }
  });
  it("redacts read credential failures without claiming creation absence", async () => {
    const backend = new HttpDevinBackend(profile, async () => { throw new Error("cog-private credential"); }, vi.fn());
    const result = backend.get("devin-exact");
    await expect(result).rejects.toMatchObject({ code: "DEVIN_CREDENTIAL_UNAVAILABLE" }); await expect(result).rejects.not.toHaveProperty("creationOutcome"); await expect(result).rejects.not.toThrow("cog-private");
  });
  it("caps direct creation at the lesser configured and supplied budgets and captures input", async () => {
    const f = fixture({ ...profile, maxSessionAcu: 12 }), input = { prompt: "original", maxSessionAcu: 8 };
    const pending = f.backend.create(input); input.prompt = "changed"; input.maxSessionAcu = 20; await pending;
    expect(JSON.parse(String(f.fetchImpl.mock.calls[0]![1]!.body))).toEqual({ prompt: "original", max_acu_limit: 8 });
  });
  it("retains explicit approval uncertainty and strips private message fields", async () => {
    const f = readFixture(); f.fetchImpl.mockResolvedValueOnce(Response.json(snapshot({ status_detail: "waiting_for_approval" })));
    expect(await f.port.inspect(binding)).toMatchObject({ pendingApprovals: "present", pendingTools: "unknown" });
    f.setPage({ items: [message({ user_id: "private-user", username: "private-name", origin: "private-origin" })] });
    expect(Object.keys((await f.port.history(binding, { limit: 10 })).entries[0]!).sort()).toEqual(["id", "kind", "occurredAt", "text", "truncated"]);
  });
  it("redacts readonly fetch rejection and rejects malformed UTF8 and non-object JSON", async () => {
    const f = readFixture(); f.fetchImpl.mockRejectedValueOnce(new Error("cog-private fetch diagnostic"));
    await expect(f.port.inspect(binding)).rejects.toMatchObject({ code: "DEVIN_READ_UNAVAILABLE" });
    f.fetchImpl.mockResolvedValueOnce(new Response(new Uint8Array([255])));
    await expect(f.port.inspect(binding)).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
    f.fetchImpl.mockResolvedValueOnce(Response.json([])); await expect(f.port.inspect(binding)).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
  });
});

it.each(["create", "send"] as const)("redacts arbitrary private %s fetch rejection without inventing creation absence", async operation => {
  const fetchImpl = capturedFetch(vi.fn<typeof fetch>(async () => { throw new Error("cog-private-network-token"); }));
  const backend = new HttpDevinBackend(profile, credential, fetchImpl);
  const pending = operation === "create" ? backend.create({ prompt: "task" }) : backend.send("devin-exact", "next");
  await expect(pending).rejects.toMatchObject({ code: "DEVIN_WRITE_UNAVAILABLE", message: "Devin write response is unavailable; delivery is unconfirmed" });
  await expect(pending).rejects.not.toHaveProperty("creationOutcome", "not-created"); expect(fetchImpl).toHaveBeenCalledTimes(1);
});

describe("Devin profile boundary validation", () => {
  const validate = new Ajv({ strict: false, validateFormats: false }).compile(adapters.devinManifest.configSchema);
  it.each([123, true, null, "", " ", "\nuser", "x".repeat(513)])("rejects invalid explicit owner across manifest/create/probe %j", async createAsUserId => {
    const invalid = { ...profile, createAsUserId } as DevinProfileConfig, f = fixture(invalid);
    expect(validate(invalid)).toBe(false);
    await expect(f.backend.create({ prompt: "task" })).rejects.toMatchObject({ creationOutcome: "not-created", code: "DEVIN_ATTRIBUTION_INVALID" });
    expect((await probeDevinProfile(invalid, credential, f.fetchImpl)).authenticated).toBe(false); expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it.each([0, -1, 12.5, "12", null])("rejects invalid ACU across manifest/create/probe %j", async maxSessionAcu => {
    const invalid = { ...profile, maxSessionAcu } as DevinProfileConfig, f = fixture(invalid);
    expect(validate(invalid)).toBe(false);
    await expect(f.backend.create({ prompt: "task" })).rejects.toMatchObject({ creationOutcome: "not-created", code: "DEVIN_ACU_LIMIT_INVALID" });
    expect((await probeDevinProfile(invalid, credential, f.fetchImpl)).authenticated).toBe(false); expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it("accepts exact explicit owner in manifest without trimming or coercion", () => { expect(validate({ ...profile, createAsUserId: "user-exact", maxSessionAcu: 12 })).toBe(true); });
  it("calls the captured callback once with its original receiver after credentials", async () => {
    const ready = Promise.withResolvers<string>(), entered = Promise.withResolvers<void>(), f = fixture();
    let guardCalls = 0, credentialsReady = false;
    const adapter = new DevinAdapter(profile, undefined, undefined, async () => { entered.resolve(); const value = await ready.promise; credentialsReady = true; return value; }, f.fetchImpl);
    const receiver = { guard() { expect(this).toBe(receiver); expect(credentialsReady).toBe(true); expect(f.fetchImpl).not.toHaveBeenCalled(); guardCalls++; } };
    const input = { runId: "run", workspacePath: "/workspace", beforeSend: receiver.guard.bind(receiver) };
    const pending = adapter.start(input); await entered.promise; expect(guardCalls).toBe(0); ready.resolve("controlled-token"); await pending; expect(guardCalls).toBe(1); expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  });
});

it("publishes the same captured custom snapshot identity that passed validation", async () => {
  let reads = 0;
  const backend = { health: async () => ({ ok: true }), create: async () => ({ get sessionId() { return ++reads <= 5 ? "devin-exact" : "devin-foreign"; }, status: "running", organizationId: "org-exact", pullRequests: [] }), get: async () => ({ sessionId: "devin-exact", status: "running", pullRequests: [] }), send: async () => ({ sessionId: "devin-exact", status: "running", pullRequests: [] }) };
  const store = new MemorySessionStore(), adapter = new DevinAdapter(profile, backend, store);
  const session = await adapter.start({ runId: "run", sessionId: "captured", workspacePath: "/workspace" });
  expect(session.providerSessionId).toBe("devin-exact"); expect(store.load("captured")?.providerSessionId).toBe("devin-exact"); expect(reads).toBe(1);
});
