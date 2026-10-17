import { expect, it, vi } from "vitest";
import { DevinAdapter,GenericCliAdapter, LocalServiceAdapter, MemorySessionStore, QoderAdapter, type ProcessExecution, type QoderBackend } from "../src/index.js";
const profile = { id: "http", alias: "HTTP", provider: "workbuddy" as const, baseUrl: "http://127.0.0.1:9999", healthPath: "/health", startPath: "/start", statusPath: "/sessions/{sessionId}", inputPath: "/sessions/{sessionId}/input", cancelPath: "/sessions/{sessionId}/cancel" };
it.each(["http","devin"])("persists %s startup before an external request and checks shared-store profile ownership",async kind=>{
 const store=new MemorySessionStore(),request=vi.fn(async()=>({sessionId:"native",state:"completed",status:"completed",pullRequests:[]})),fetch=vi.fn(async()=>new Response(JSON.stringify(await request())));
 const backend={health:async()=>({ok:true}),create:request,get:request,send:request};
 const failedStore={load:(id:string)=>store.load(id),save:()=>{throw new Error("startup persistence failed");}};
 const make=(id:string,sessionStore=store)=>kind==="http"?new LocalServiceAdapter({...profile,id},undefined,fetch,sessionStore):new DevinAdapter({id,alias:id,credentialRef:"secret://devin/a",organizationId:"org-fixture"},backend,sessionStore);
 const failed=kind==="http"?new LocalServiceAdapter(profile,undefined,fetch,failedStore):new DevinAdapter({id:"http",alias:"HTTP",credentialRef:"secret://devin/a",organizationId:"org-fixture"},backend,failedStore);
 await expect(failed.start({runId:"run",workspacePath:"/work"})).rejects.toThrow("startup persistence failed");expect(request).not.toHaveBeenCalled();
 const first=await make("a").start({runId:"run",workspacePath:"/work"});request.mockClear();
 await expect(make("b").status(first.id)).rejects.toMatchObject({code:"SESSION_PROFILE_MISMATCH"});expect(request).not.toHaveBeenCalled();
});
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
it.each(["qoder", "generic"] as const)("records STARTING before any %s execution and stops an owned start if persistence fails", async kind => {
  const cancel = vi.fn(async () => undefined), start = vi.fn();
  const execution: ProcessExecution = { id: "process", send: async () => undefined, cancel, status: async () => ({ state: "running" }), result: async () => ({ state: "cancelled", summary: "stopped" }) };
  const turn = { cancel, status: () => "running" as const, result: async () => ({ state: "cancelled" as const, summary: "stopped", events: [] }) };
  for (const rejectedState of ["STARTING", "RUNNING"]) {
    const store = new MemorySessionStore();
    const persistence = { load: (id: string) => store.load(id), save: (session: Parameters<typeof store.save>[0]) => { if (session.state === rejectedState) throw new Error("authority or disk failure"); store.save(session); } };
    const adapter = kind === "qoder" ? new QoderAdapter({ id: "p", alias: "P" }, { start: () => { start(); return turn; } }, persistence) : new GenericCliAdapter({ start: async () => { start(); return execution; } }, { file: "fixture", args: [] }, persistence, "p");
    await expect(adapter.start({ runId: "run", workspacePath: "/work" })).rejects.toThrow("authority or disk failure");
    expect(start).toHaveBeenCalledTimes(rejectedState === "STARTING" ? 0 : 1);
    expect(cancel).toHaveBeenCalledTimes(rejectedState === "STARTING" ? 0 : 1);
  }
});
it("cancels a Generic executor that returns after an uncertain startup stop", async () => {
  let finish!: (execution: ProcessExecution) => void;
  const pending = new Promise<ProcessExecution>(resolve => { finish = resolve; });
  const store = new MemorySessionStore(), cancel = vi.fn(async () => undefined);
  let sessionId: string | undefined;
  const adapter = new GenericCliAdapter({ start: () => pending }, { file: "fixture", args: [] }, { load: id => store.load(id), save: session => { store.save(session); sessionId = session.id; } }, "p");
  const started = adapter.start({ runId: "run", workspacePath: "/work" });
  await vi.waitFor(() => expect(sessionId).toBeDefined());
  await expect(adapter.cancel(sessionId!)).rejects.toMatchObject({ code: "SESSION_DETACHED" });
  finish({ id: "process", cancel, send: async () => undefined, status: async () => ({ state: "running" }), result: async () => ({ state: "cancelled", summary: "stopped" }) });
  await expect(started).rejects.toMatchObject({ code: "SESSION_CANCELLED" }); expect(cancel).toHaveBeenCalledOnce();
});

it.each(["qoder", "generic"] as const)("isolates shared persisted %s sessions from a different configured account", async kind => {
  const store = new MemorySessionStore();
  const execution: ProcessExecution = { id: "process", send: async () => undefined, cancel: async () => undefined, status: async () => ({ state: "running" }), result: async () => ({ state: "completed", summary: "private result" }) };
  const make = (id: string) => kind === "qoder" ? new QoderAdapter({ id, alias: id }, { start: () => ({ status: () => "completed", cancel: async () => undefined, result: async () => ({ state: "completed", summary: "private result", events: [] }) }) }, store) : new GenericCliAdapter({ start: async () => execution }, { file: "fixture", args: [] }, store, id);
  const session = await make("a").start({ runId: "run", workspacePath: "/private-work" });
  const other = make("b");
  for (const operation of [() => other.status(session.id), () => other.result(session.id), () => other.send(session.id, "wrong account"), () => other.cancel(session.id)]) await expect(operation()).rejects.toMatchObject({ code: "SESSION_PROFILE_MISMATCH" });
});
