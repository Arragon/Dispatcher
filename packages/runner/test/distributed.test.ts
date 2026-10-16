import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LeaseFenceError,
  RemoteRunnerClient,
  RemoteRunnerServer,
  RunnerJournal,
  RunnerLeaseAuthority,
  RunnerRegistry,
  reconcileRunnerState,
} from "../src/index.js";
import {remoteCommandHash} from "../src/remote.js";

const tempDirectories: string[] = [];
it("binds raw command content independently of object key order and renewable expiry",()=>{
  const a={payload:{type:"run.send_input" as const,runId:"run",input:"Task Ａ"},leaseId:"lease",generation:1,leaseExpiresAt:"before"};
  const b={payload:{input:"Task Ａ",runId:"run",type:"run.send_input" as const},generation:1,leaseId:"lease",leaseExpiresAt:"renewed"};
  expect(remoteCommandHash(a)).toBe(remoteCommandHash(b));expect(remoteCommandHash({...a,payload:{...a.payload,input:"Task A"}})).not.toBe(remoteCommandHash(a));
});

it("cannot renew an expired lease or revive revoked or old generation authority", () => {
  const authority = new RunnerLeaseAuthority();
  authority.issue({ runId: "renew", runnerId: "local", leaseId: "lease-1", generation: 1, expiresAt: "2026-10-01T00:15:00Z" }, "2026-10-01T00:00:00Z");
  expect(() => authority.renew("renew", "lease-1", 1, "2026-10-01T00:30:00Z", "2026-10-01T00:16:00Z")).toThrow(/expired/);
  authority.issue({ runId: "renew", runnerId: "local", leaseId: "lease-2", generation: 2, expiresAt: "2026-10-01T00:30:00Z" }, "2026-10-01T00:16:00Z");
  expect(() => authority.renew("renew", "lease-1", 1, "2026-10-01T00:40:00Z", "2026-10-01T00:17:00Z")).toThrow(/not current/);
  authority.revoke("renew", "lease-2", 2, "cancelled", "2026-10-01T00:17:00Z");
  expect(() => authority.renew("renew", "lease-2", 2, "2026-10-01T00:40:00Z", "2026-10-01T00:18:00Z")).toThrow(/revoked/);
});

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function runner(id = "remote-mac") {
  return {
    id,
    displayName: "Remote Mac",
    platform: "darwin" as const,
    architecture: "arm64",
    state: "ONLINE" as const,
    capabilities: ["remote", "codex"],
    capacity: 2,
    lastSeenAt: new Date().toISOString(),
  };
}

describe("remote runner control plane", () => {
  it.each([true,false])("replays before immediate reconnect RPC and flushes late old-socket replies (journal=%s)",async(durable)=>{
    const directory=mkdtempSync(join(tmpdir(),"runner-reconnect-order-"));tempDirectories.push(directory);
    const journal=durable?new RunnerJournal(join(directory,"journal.sqlite")):undefined;
    const first=new RemoteRunnerServer({registry:new RunnerRegistry(),port:0,authenticate:()=>true,rpcTimeoutMs:1000});await first.ready();const port=first.address()!.port;
    const client=new RemoteRunnerClient({url:`ws://127.0.0.1:${port}`,bearerToken:"fixture",runner:runner(),...(journal?{journal}:{}),reconnectBackoffMs:250});
    const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();client.register("runner.health",()=>({ok:true}));client.register("runner.reconcile",async()=>{entered.resolve();await release.promise;return {runs:[]};});
    let second:RemoteRunnerServer|undefined;
    try{
      await client.start();await first.sendCommand("remote-mac",{type:"runner.health"});
      const old=first.sendCommand("remote-mac",{type:"runner.reconcile"}).catch(()=>undefined);await entered.promise;await first.close();await old;
      const immediate=Promise.withResolvers<unknown>();
      second=new RemoteRunnerServer({registry:new RunnerRegistry(),port,authenticate:()=>true,rpcTimeoutMs:1000,onRunnerChanged:runner=>{if(runner.state==="ONLINE")void second!.sendCommand(runner.id,{type:"runner.health"}).then(immediate.resolve,immediate.resolve);}});await second.ready();
      expect(await immediate.promise).toMatchObject({payload:{type:"rpc.result",result:{ok:true}}});release.resolve();
      await vi.waitFor(()=>expect(journal?.replay(0).some(entry=>entry.envelope.kind==="response"&&entry.envelope.payload.type==="rpc.result"&&JSON.stringify(entry.envelope.payload.result)==='{"runs":[]}')??true).toBe(true));
      expect((await second.sendCommand("remote-mac",{type:"runner.health"})).payload).toMatchObject({type:"rpc.result",result:{ok:true}});
    }finally{release.resolve();await client.stop();await second?.close();if(!second)await first.close();journal?.close();}
  });
  it("requires matching native start/session identity and owned handles or durable completion during reconciliation",()=>{
    const expected={runId:"run",runnerId:"remote",generation:1,leaseId:"lease",workspace:"/work",sessionId:"session",startCommandHash:"start",requiresNativeOwnership:true};
    const actual={runId:"run",generation:1,leaseId:"lease",workspace:"/work",sessionId:"session",startCommandHash:"start",attached:true,nativeState:"RUNNING",resultAvailable:false};
    expect(reconcileRunnerState("remote",[expected],[actual])[0]?.action).toBe("KEEP");
    for(const patch of [{startCommandHash:"other"},{sessionId:"other"},{attached:false},{attached:false,nativeState:"OUTCOME_UNKNOWN"}])expect(reconcileRunnerState("remote",[expected],[{...actual,...patch}])[0]?.action).toBe("ATTENTION");
    expect(reconcileRunnerState("remote",[expected],[{...actual,attached:false,nativeState:"COMPLETE",resultAvailable:true}])[0]?.action).toBe("KEEP");
  });
  it("stops reconnecting and reports authorization loss when the Controller revokes its connection", async () => {
    const authenticate = vi.fn(() => true), revoked = vi.fn();
    const server = new RemoteRunnerServer({ registry: new RunnerRegistry(), port: 0, authenticate }); await server.ready();
    const client = new RemoteRunnerClient({ url: `ws://127.0.0.1:${server.address()!.port}`, bearerToken: "fixture", runner: runner(), reconnectBackoffMs: 250, onAuthorizationLost: revoked });
    try { await client.start(); server.disconnect("remote-mac", "credential revoked"); await vi.waitFor(() => expect(revoked).toHaveBeenCalledOnce()); await new Promise(resolve => setTimeout(resolve, 300)); expect(authenticate).toHaveBeenCalledOnce(); }
    finally { await client.stop(); await server.close(); }
  });
  it("merges concurrent retries and rejects a changed payload on a used command ID",async()=>{
    const server=new RemoteRunnerServer({registry:new RunnerRegistry(),port:0,authenticate:()=>true,rpcTimeoutMs:1000});await server.ready();
    const client=new RemoteRunnerClient({url:`ws://127.0.0.1:${server.address()!.port}`,bearerToken:"fixture",runner:runner()});const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();const handler=vi.fn(async()=>{entered.resolve();await release.promise;return {started:true};});client.register("run.start",handler);await client.start();
    try{
      const first=server.sendCommand("remote-mac",{type:"run.start",runId:"run"},{messageId:"shared"}).catch(error=>error);await entered.promise;
      const second=server.sendCommand("remote-mac",{type:"run.start",runId:"run"},{messageId:"shared"}).catch(error=>error);
      await expect(server.sendCommand("remote-mac",{type:"run.start",runId:"different"},{messageId:"shared"})).rejects.toThrow(/different payload/);release.resolve();
      const results=await Promise.all([first,second]);for(const result of results)expect(result).toMatchObject({payload:{type:"rpc.result",result:{started:true}}});expect(handler).toHaveBeenCalledOnce();
      expect((await server.sendCommand("remote-mac",{type:"run.start",runId:"different"},{messageId:"shared"})).payload).toMatchObject({type:"rpc.error",code:"COMMAND_IDEMPOTENCY_CONFLICT"});expect(handler).toHaveBeenCalledOnce();
      expect((await server.sendCommand("remote-mac",{type:"run.start",runId:"run"},{messageId:"shared"})).payload).toMatchObject({type:"rpc.result",result:{started:true}});expect(handler).toHaveBeenCalledOnce();
    }finally{release.resolve();await client.stop();await server.close();}
  });
  it("does not send native commands to a health-only Runner",async()=>{
    const server=new RemoteRunnerServer({registry:new RunnerRegistry(),port:0,authenticate:()=>true});await server.ready();const client=new RemoteRunnerClient({url:`ws://127.0.0.1:${server.address()!.port}`,bearerToken:"fixture",runner:runner()});await client.start();
    try{await expect(server.sendCommand("remote-mac",{type:"native.model_catalog",profileId:"account",repositoryId:"repo",reason:"open"})).rejects.toThrow(/native execution capability/i);}finally{await client.stop();await server.close();}
  });
  it("keeps the outgoing sequence above fully compacted acknowledged journal entries",async()=>{
    const directory=mkdtempSync(join(tmpdir(),"dispatcher-remote-compacted-"));tempDirectories.push(directory);const journal=new RunnerJournal(join(directory,"journal.sqlite"));
    journal.append({protocolVersion:"1.2",messageId:"old",traceId:"old",runnerId:"remote-mac",sequence:7,sentAt:new Date().toISOString(),kind:"event",payload:{type:"runner.heartbeat",runnerId:"remote-mac",state:"ONLINE"}});journal.acknowledge(7);journal.compact(0);
    const server=new RemoteRunnerServer({registry:new RunnerRegistry(),port:0,authenticate:()=>true,rpcTimeoutMs:1000});await server.ready();const client=new RemoteRunnerClient({url:`ws://127.0.0.1:${server.address()!.port}`,bearerToken:"fixture",runner:runner(),journal});client.register("runner.health",()=>({ok:true}));await client.start();
    try{expect((await server.sendCommand("remote-mac",{type:"runner.health"})).payload).toMatchObject({type:"rpc.result",result:{ok:true}});}finally{await client.stop();journal.close();await server.close();}
  });
  it("authenticates registration and executes RPC over the versioned websocket channel", async () => {
    const registry = new RunnerRegistry();
    const server = new RemoteRunnerServer({ registry, port: 0, authenticate: ({ bearerToken }) => bearerToken === "test-token" });
    await server.ready();
    const address = server.address()!;
    const client = new RemoteRunnerClient({ url: `ws://127.0.0.1:${address.port}`, bearerToken: "test-token", runner: runner() });
    const handler = vi.fn(() => ({ status: "ok" }));
    client.register("runner.health", handler);
    await client.start();

    const response = await server.sendCommand("remote-mac", { type: "runner.health" });

    expect(response.payload).toMatchObject({ type: "rpc.result", result: { status: "ok" } });
    expect(handler).toHaveBeenCalledOnce();
    expect(registry.list()[0]).toMatchObject({ id: "remote-mac", state: "ONLINE" });
    const drained = await server.sendCommand("remote-mac", { type: "runner.drain", draining: true });
    expect(drained.payload).toMatchObject({ type: "rpc.result", result: { state: "DRAINING" } });
    expect(registry.list()[0]?.state).toBe("DRAINING");
    await expect(server.sendCommand("remote-mac", { type: "run.start", runId: "blocked" })).rejects.toThrow("draining");
    await client.stop();
    await server.close();
  });

  it("rejects an unauthorized runner before it enters the registry", async () => {
    const registry = new RunnerRegistry();
    const server = new RemoteRunnerServer({ registry, port: 0, authenticate: () => false });
    await server.ready();
    const address = server.address()!;
    const client = new RemoteRunnerClient({ url: `ws://127.0.0.1:${address.port}`, bearerToken: "wrong", runner: runner("intruder") });
    await expect(client.start()).rejects.toThrow("unauthorized");
    expect(registry.list()).toEqual([]);
    await server.close();
  });

  it("settles a registration closed before acknowledgement without leaking authentication errors",async()=>{
    const server=new RemoteRunnerServer({registry:new RunnerRegistry(),port:0,authenticate:()=>{throw new Error("private credential-store failure");}});await server.ready();
    const client=new RemoteRunnerClient({url:`ws://127.0.0.1:${server.address()!.port}`,bearerToken:"wrong",runner:runner()});
    try{await expect(Promise.race([client.start().then(()=>"accepted",error=>String(error)),new Promise(resolve=>setTimeout(()=>resolve("hung"),300))])).resolves.toBe("Error: Remote runner registration closed");}
    finally{await client.stop();await server.close();}
  });

  it("drains an in-flight command on shutdown and replays its durable response after restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "dispatcher-remote-shutdown-"));
    tempDirectories.push(directory);
    const journalPath = join(directory, "runner.sqlite");
    const server = new RemoteRunnerServer({ registry: new RunnerRegistry(), port: 0, authenticate: () => true });
    await server.ready();
    const url = `ws://127.0.0.1:${server.address()!.port}`;
    const journal = new RunnerJournal(journalPath);
    const client = new RemoteRunnerClient({ url, bearerToken: "token", runner: runner(), journal });
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    client.register("run.start", async () => { entered.resolve(); await release.promise; return { started: true }; });
    await client.start();
    const pending = server.sendCommand("remote-mac", { type: "run.start", runId: "run-1" }, { messageId: "start-during-shutdown" }).catch(() => undefined);
    await entered.promise;
    const stopped = client.stop();
    // Let the socket close before the handler finishes; journal closure must wait for it.
    await new Promise((resolve) => setTimeout(resolve, 20));
    release.resolve();
    await stopped;
    await pending;
    expect(journal.replay(0)).toContainEqual(expect.objectContaining({ envelope: expect.objectContaining({ payload: { type: "rpc.result", correlationId: "start-during-shutdown", result: { started: true } } }) }));
    journal.close();
    const restoredJournal = new RunnerJournal(journalPath);
    const restored = new RemoteRunnerClient({ url, bearerToken: "token", runner: runner(), journal: restoredJournal });
    const duplicateHandler = vi.fn();
    restored.register("run.start", duplicateHandler);
    await restored.start();
    expect((await server.sendCommand("remote-mac", { type: "run.start", runId: "run-1" }, { messageId: "start-during-shutdown" })).payload).toMatchObject({ type: "rpc.result", result: { started: true } });
    expect(duplicateHandler).not.toHaveBeenCalled();
    await restored.stop();
    restoredJournal.close();
    await server.close();
  });

  it("rejects an unsafe runner version before authentication", async () => {
    const registry = new RunnerRegistry();
    const server = new RemoteRunnerServer({ registry, port: 0, authenticate: () => true });
    await server.ready();
    const address = server.address()!;
    const client = new RemoteRunnerClient({ url: `ws://127.0.0.1:${address.port}`, bearerToken: "token", runner: runner("old"), runnerVersion: "0.0.9" });
    await expect(client.start()).rejects.toThrow("incompatible runner version");
    expect(registry.list()).toEqual([]);
    await server.close();
  });

  it("bounds connection buffering and requires TLS outside loopback", () => {
    const registry = new RunnerRegistry();
    expect(() => new RemoteRunnerServer({ registry, host: "0.0.0.0", port: 0, authenticate: () => true })).toThrow("TLS server");
  });

  it("replays acknowledgements after runner restart without executing duplicate run.start", async () => {
    const directory = mkdtempSync(join(tmpdir(), "dispatcher-remote-replay-"));
    tempDirectories.push(directory);
    const journalPath = join(directory, "runner.sqlite");
    const registry = new RunnerRegistry();
    const server = new RemoteRunnerServer({ registry, port: 0, authenticate: () => true });
    await server.ready();
    const address = server.address()!;
    const firstJournal = new RunnerJournal(journalPath);
    const first = new RemoteRunnerClient({ url: `ws://127.0.0.1:${address.port}`, bearerToken: "token", runner: runner(), journal: firstJournal });
    const firstHandler = vi.fn(() => ({ started: true }));
    first.register("run.start", firstHandler);
    await first.start();
    const initial = await server.sendCommand("remote-mac", { type: "run.start", runId: "run-1" }, { messageId: "start-run-1" });
    expect(initial.payload).toMatchObject({ type: "rpc.result", result: { started: true } });
    expect((await server.sendCommand("remote-mac",{type:"run.start",runId:"changed"},{messageId:"start-run-1"})).payload).toMatchObject({type:"rpc.error",code:"COMMAND_IDEMPOTENCY_CONFLICT"});
    await first.stop();
    firstJournal.close();

    const restoredJournal = new RunnerJournal(journalPath);
    const restored = new RemoteRunnerClient({ url: `ws://127.0.0.1:${address.port}`, bearerToken: "token", runner: runner(), journal: restoredJournal });
    const restoredHandler = vi.fn(() => ({ started: "twice" }));
    restored.register("run.start", restoredHandler);
    await restored.start();
    const duplicate = await server.sendCommand("remote-mac", { type: "run.start", runId: "run-1" }, { messageId: "start-run-1" });
    expect(duplicate.payload).toMatchObject({ type: "rpc.result", result: { started: true } });
    expect(firstHandler).toHaveBeenCalledOnce();
    expect(restoredHandler).not.toHaveBeenCalled();
    await restored.stop();
    restoredJournal.close();
    await server.close();
  });
});

describe("runner journal", () => {
  it("persists replay order, acknowledgements, checksums, and compaction across restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "dispatcher-runner-journal-"));
    tempDirectories.push(directory);
    const path = join(directory, "runner.sqlite");
    const first = new RunnerJournal(path);
    first.append({
      protocolVersion: "1.2",
      messageId: "event-1",
      traceId: "trace-1",
      runnerId: "remote-mac",
      sequence: 1,
      sentAt: new Date().toISOString(),
      kind: "event",
      payload: { type: "runner.heartbeat", runnerId: "remote-mac", state: "ONLINE" },
    });
    first.append({
      protocolVersion: "1.2",
      messageId: "event-2",
      traceId: "trace-2",
      runnerId: "remote-mac",
      sequence: 2,
      sentAt: new Date().toISOString(),
      kind: "event",
      payload: { type: "runner.heartbeat", runnerId: "remote-mac", state: "ONLINE" },
    });
    first.acknowledge(2);
    first.close();

    const restored = new RunnerJournal(path);
    expect(restored.schemaVersion).toBe(1);
    expect(restored.replay(0).map((entry) => entry.sequence)).toEqual([1, 2]);
    expect(restored.replay()).toEqual([]);
    expect(restored.compact(0)).toBe(2);
    restored.close();
  });
});

describe("lease fencing and reconciliation", () => {
  it("denies expired, revoked, and stale generations and audits every fence", () => {
    const authority = new RunnerLeaseAuthority();
    authority.issue({ runId: "run-1", runnerId: "runner-a", leaseId: "lease-1", generation: 1, expiresAt: "2026-09-23T10:00:00.000Z" }, "2026-09-23T09:00:00.000Z");
    expect(authority.fence("run-1", "lease-1", 1, "push", "2026-09-23T09:30:00.000Z")).toMatchObject({ leaseId: "lease-1" });
    expect(() => authority.fence("run-1", "lease-1", 1, "push", "2026-09-23T10:00:00.000Z")).toThrowError(LeaseFenceError);
    authority.issue({ runId: "run-1", runnerId: "runner-b", leaseId: "lease-2", generation: 2, expiresAt: "2026-09-23T12:00:00.000Z" });
    expect(() => authority.fence("run-1", "lease-1", 1, "pull-request")).toThrow("not current");
    authority.revoke("run-1", "lease-2", 2, "rerouted");
    expect(() => authority.fence("run-1", "lease-2", 2, "complete")).toThrow("revoked");
    expect(authority.audit("run-1").map((entry) => entry.action)).toEqual(expect.arrayContaining(["ISSUE", "FENCE_ALLOW", "FENCE_DENY", "REVOKE"]));
  });

  it("produces deterministic recovery, stale-stop, and human-attention decisions", () => {
    const decisions = reconcileRunnerState(
      "runner-a",
      [
        { runId: "missing", runnerId: "runner-a", generation: 1, leaseId: "l1" },
        { runId: "stale", runnerId: "runner-a", generation: 2, leaseId: "l2" },
        { runId: "ahead", runnerId: "runner-a", generation: 2, leaseId: "l2" },
      ],
      [
        { runId: "orphan", generation: 1, leaseId: "old" },
        { runId: "stale", generation: 1, leaseId: "old" },
        { runId: "ahead", generation: 3, leaseId: "l3" },
      ],
    );
    expect(decisions).toEqual([
      { runId: "ahead", action: "ATTENTION", reason: "runner generation is ahead of canonical state" },
      { runId: "missing", action: "RECOVER", reason: "controller run is missing from runner" },
      { runId: "orphan", action: "STOP_STALE", reason: "runner reports an unowned run" },
      { runId: "stale", action: "STOP_STALE", reason: "runner holds a stale generation or lease" },
    ]);
  });
});
