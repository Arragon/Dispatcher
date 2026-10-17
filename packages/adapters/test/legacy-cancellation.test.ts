import { expect, it, vi } from "vitest";
import { GenericCliAdapter, LocalServiceAdapter, MemorySessionStore, QoderAdapter, type ProcessExecution, type QoderBackend } from "../src/index.js";
const profile = { id: "http", alias: "HTTP", provider: "workbuddy" as const, baseUrl: "http://127.0.0.1:9999", healthPath: "/health", startPath: "/start", statusPath: "/sessions/{sessionId}", inputPath: "/sessions/{sessionId}/input", cancelPath: "/sessions/{sessionId}/cancel" };
it.each(["qoder", "generic"] as const)("refuses a detached active %s cancel without changing persisted state", async kind => {
  const store = new MemorySessionStore();
  store.save({ id: "session", runId: "run", profileId: "p", workspacePath: "/work", backendId: "fixture", state: "RUNNING", createdAt: "2026-10-16T00:00:00Z", updatedAt: "2026-10-16T00:00:00Z" });
  const adapter = kind === "qoder" ? new QoderAdapter({ id: "p", alias: "P" }, undefined, store) : new GenericCliAdapter({ start: async () => { throw new Error("must not spawn"); } }, { file: "fixture", args: [] }, store, "p");
  await expect(adapter.cancel("session")).rejects.toMatchObject({ code: "SESSION_DETACHED" });
  expect(store.load("session")!.state).toBe("RUNNING");
});
it("does not resume Qoder after cancellation overtakes a pending follow-up", async () => {
  let finish!: () => void;
  const done = new Promise<void>(resolve => { finish = resolve; });
  const start = vi.fn<QoderBackend["start"]>(() => ({ status: () => "running", result: async () => { await done; return { state: "cancelled", summary: "stopped", events: [] }; }, cancel: async () => { finish(); } }));
  const adapter = new QoderAdapter({ id: "p", alias: "P" }, { start });
  const session = await adapter.start({ runId: "run", workspacePath: "/work" });
  const sent = adapter.send(session.id, "must not restart");
  const rejected = expect(sent).rejects.toMatchObject({ code: "SESSION_CANCELLED" });
  await adapter.cancel(session.id); await rejected; expect(start).toHaveBeenCalledOnce();
});
it("fences Generic input during stop even if the cancellation record fails to save", async () => {
  let finish!: () => void;
  const stopping = new Promise<void>(resolve => { finish = resolve; });
  const execution: ProcessExecution = { id: "process", send: vi.fn(async () => undefined), cancel: async () => stopping, status: async () => ({ state: "running" }), result: async () => ({ state: "cancelled", summary: "stopped" }) };
  const store = new MemorySessionStore();
  const adapter = new GenericCliAdapter({ start: async () => execution }, { file: "fixture", args: [] }, { load: id => store.load(id), save: session => { if (session.state === "CANCELLED") throw new Error("disk full"); store.save(session); } }, "p");
  const session = await adapter.start({ runId: "run", workspacePath: "/work" });
  const cancelled = adapter.cancel(session.id); const rejected = expect(cancelled).rejects.toThrow("disk full");
  await expect(adapter.send(session.id, "during stop")).rejects.toMatchObject({ code: "SESSION_CANCELLED" });
  finish(); await rejected;
  await expect(adapter.send(session.id, "after failed save")).rejects.toMatchObject({ code: "SESSION_CANCELLED" });
  expect(execution.send).not.toHaveBeenCalled();
});
it.each([undefined, "running", "unrecognized"])("requires explicit terminal HTTP evidence for cancellation (%s)", async state => {
  const store = new MemorySessionStore();
  const adapter = new LocalServiceAdapter(profile, undefined, async input => new Response(JSON.stringify({ sessionId: "native", state: String(input).endsWith("/cancel") ? state : "running" }), { status: 200 }), store);
  const session = await adapter.start({ runId: "run", workspacePath: "/work" });
  await expect(adapter.cancel(session.id)).rejects.toMatchObject({ code: "CANCELLATION_UNCONFIRMED" });
  expect(store.load(session.id)!.state).toBe("RUNNING");
  await expect(adapter.send(session.id, "late input")).rejects.toMatchObject({ code: "SESSION_CANCELLED" });
});
it("waits for a pending HTTP input before the stop request and blocks later input", async () => {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const calls: string[] = [];
  const adapter = new LocalServiceAdapter(profile, undefined, async input => {
    const url = String(input); calls.push(url);
    if (url.endsWith("/input")) await pending;
    return new Response(JSON.stringify({ sessionId: "native", state: url.endsWith("/cancel") ? "cancelled" : "running" }), { status: 200 });
  });
  const session = await adapter.start({ runId: "run", workspacePath: "/work" });
  const sent = adapter.send(session.id, "pending");
  await vi.waitFor(() => expect(calls.some(url => url.endsWith("/input"))).toBe(true));
  const cancelled = adapter.cancel(session.id);
  await expect(adapter.send(session.id, "late")).rejects.toMatchObject({ code: "SESSION_CANCELLED" });
  expect(calls.some(url => url.endsWith("/cancel"))).toBe(false);
  finish(); await sent; expect((await cancelled).state).toBe("CANCELLED");
  expect(calls.filter(url => url.endsWith("/cancel"))).toHaveLength(1);
});
