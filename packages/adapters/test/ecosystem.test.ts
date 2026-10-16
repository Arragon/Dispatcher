import { describe, expect, it, vi } from "vitest";
import {
  CursorAdapter,
  DevinAdapter,
  GenericCliAdapter,
  KiroAdapter,
  LocalServiceAdapter,
  assessManifestCapabilities,
  buildAdapterCompatibilityMatrix,
  cursorManifest,
  devinManifest,
  kiroManifest,
  localServiceManifest,
  normalizeCliError,
  normalizeCliLine,
  runAdapterContract,
  type CliAgentBackend,
  type AdapterSession,
  type CliTurn,
  type CliTurnResult,
  type DevinBackend,
  type ProcessExecutor,
} from "../src/index.js";

class FakeCliTurn implements CliTurn {
  // Headless follow-up contract uses a completed turn; active turns reject SESSION_BUSY.
  private state: "running" | "completed" = "completed";
  private resultState: CliTurnResult["state"] = "completed";
  async cancel(): Promise<void> { this.state = "completed"; this.resultState = "cancelled"; }
  status(): "running" | "completed" { return this.state; }
  async result(): Promise<CliTurnResult> { return { state: this.resultState, summary: "https://github.com/acme/repo/pull/7", events: [{ type: "activity", summary: "done", providerSessionId: "provider-1" }], providerSessionId: "provider-1" }; }
}

const cliBackend: CliAgentBackend = { start: vi.fn(() => new FakeCliTurn()) };

describe("Cursor and Kiro adapters", () => {
  it("persists STARTING before native spawn and records only an actual backend PID", async () => {
    const saved: AdapterSession[] = [];
    let starts = 0;
    const store = { load: (id: string) => saved.findLast(s => s.id === id), save: (s: AdapterSession) => { saved.push(structuredClone(s)); } };
    const backend: CliAgentBackend = { start: () => { expect(saved.at(-1)?.state).toBe("STARTING"); starts++; return { processId: 1234, cancel: async () => undefined, status: () => "running", result: async () => ({ state: "completed", summary: "done", events: [] }) }; } };
    const profile = { id: "cursor", alias: "Cursor", executable: process.execPath };
    expect(await new CursorAdapter(profile, backend, store).start({ runId: "r", workspacePath: "/work" })).toMatchObject({ state: "RUNNING", processId: 1234 });
    await expect(new CursorAdapter(profile, backend, { load: () => undefined, save: () => { throw new Error("disk full"); } }).start({ runId: "r2", workspacePath: "/work" })).rejects.toThrow("disk full");
    expect(starts).toBe(1);
  });

  it("declare verified backends and pass the capability-aware contract", async () => {
    expect(await runAdapterContract(new CursorAdapter({ id: "cursor-main", alias: "Cursor" }, cliBackend))).toEqual([]);
    expect(await runAdapterContract(new KiroAdapter({ id: "kiro-main", alias: "Kiro" }, cliBackend))).toEqual([]);
    expect(cursorManifest.backends[0]?.capabilities).toContain("structured-events");
    expect(kiroManifest.backends.map((entry) => entry.kind)).toEqual(["headless-cli"]);
  });

  it("cancels a spawned CLI turn when its RUNNING record cannot be saved", async () => {
    let cancelled = 0; const saved: AdapterSession[] = [];
    const adapter = new CursorAdapter({ id: "p", alias: "P", executable: process.execPath }, { start: () => ({ processId: 42, cancel: async () => { cancelled++; }, status: () => "running", result: async () => ({ state: "completed", summary: "done", events: [] }) }) }, {
      load: id => saved.find(s => s.id === id), save: s => { if (s.state === "RUNNING") throw new Error("disk full"); saved.push(structuredClone(s)); },
    });
    await expect(adapter.start({ runId: "r", workspacePath: "/work" })).rejects.toThrow("disk full");
    expect(saved).toMatchObject([{ state: "STARTING", runId: "r" }]); expect(cancelled).toBe(1);
  });

  it("stops owned execution even when the cancellation record cannot be persisted",async()=>{
    let saved:AdapterSession|undefined,cancelled=0;
    const adapter=new CursorAdapter({id:"p",alias:"P"},{start:()=>({status:()=>"running",cancel:async()=>{cancelled++;},result:async()=>({state:"completed",summary:"done",events:[]})})},{load:()=>saved,save:session=>{if(session.state==="CANCELLED")throw new Error("disk full");saved=structuredClone(session);}});
    const session=await adapter.start({runId:"r",workspacePath:"/work"});await expect(adapter.cancel(session.id)).rejects.toThrow("disk full");expect(cancelled).toBe(1);
    await expect(adapter.send(session.id,"must not spawn")).rejects.toMatchObject({code:"SESSION_CANCELLED"});
  });

  it("normalizes session, quota, auth and failure output inside the adapter boundary", () => {
    expect(normalizeCliLine('{"type":"assistant","message":"working","session_id":"chat-1"}')).toMatchObject({ type: "activity", providerSessionId: "chat-1" });
    expect(normalizeCliLine('{"type":"quota","remaining":0}')).toMatchObject({ type: "resource", state: "QUOTA_EXHAUSTED" });
    expect(normalizeCliError("login required")).toMatchObject({ type: "resource", state: "AUTH_ERROR" });
    expect(normalizeCliError("unexpected parser failure")).toMatchObject({ type: "failure" });
  });
});

describe("Devin API adapter", () => {
  it("maps waiting, budget and PR results without leaking provider types", async () => {
    let status = "running";
    const backend: DevinBackend = {
      health: async () => ({ ok: true }),
      create: async () => ({ sessionId: "devin-1", status, acusConsumed: 1, pullRequests: [] }),
      get: async () => ({ sessionId: "devin-1", status, acusConsumed: 8, pullRequests: [{ url: "https://github.com/acme/repo/pull/9", state: "open" }], waitingReason: status === "suspended" ? "Need clarification" : undefined }),
      send: async () => { status = "running"; return { sessionId: "devin-1", status, acusConsumed: 8, pullRequests: [] }; },
    };
    const adapter = new DevinAdapter({ id: "devin-main", alias: "Devin", organizationId: "org-test", credentialRef: "secret://devin/main", maxSessionAcu: 10 }, backend);
    const session = await adapter.start({ runId: "run", workspacePath: "/workspace", prompt: "implement" });
    status = "suspended";
    expect((await adapter.status(session.id)).state).toBe("PAUSED");
    expect(await adapter.usage!(session.id)).toMatchObject({ state: "LOW", consumed: 8, limit: 10 });
    expect((await adapter.result(session.id)).artifacts).toEqual([{ path: "https://github.com/acme/repo/pull/9", kind: "pull-request" }]);
    await adapter.send(session.id, "continue");
    expect((await adapter.status(session.id)).state).toBe("RUNNING");
  });

  it("passes the contract when the verified backend has no remote cancel operation", async () => {
    const backend: DevinBackend = {
      health: async () => ({ ok: true }),
      create: async () => ({ sessionId: "devin-contract", status: "running", pullRequests: [] }),
      get: async () => ({ sessionId: "devin-contract", status: "running", pullRequests: [] }),
      send: async () => ({ sessionId: "devin-contract", status: "running", pullRequests: [] }),
    };
    expect(await runAdapterContract(new DevinAdapter({ id: "devin", alias: "Devin", organizationId: "org-test", credentialRef: "secret://devin/main" }, backend))).toEqual([]);
  });
});

describe("WorkBuddy / CodeBuddy local-service adapter", () => {
  it("uses explicit endpoint templates and supports the full run contract", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      const cancelled = url.endsWith("/cancel");
      return new Response(JSON.stringify({ sessionId: "local-1", state: cancelled ? "cancelled" : "running", summary: "ok", artifacts: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const adapter = new LocalServiceAdapter({
      id: "workbuddy-main",
      alias: "WorkBuddy",
      provider: "workbuddy",
      baseUrl: "http://127.0.0.1:9010",
      healthPath: "/health",
      startPath: "/sessions",
      statusPath: "/sessions/{sessionId}",
      inputPath: "/sessions/{sessionId}/messages",
      cancelPath: "/sessions/{sessionId}/cancel",
    }, undefined, fetchImpl);
    expect(await runAdapterContract(adapter)).toEqual([]);
    expect(calls).toContain("POST http://127.0.0.1:9010/sessions/local-1/messages");
    expect(calls).toContain("POST http://127.0.0.1:9010/sessions/local-1/cancel");
  });

  it("rejects endpoint templates that could interpolate a session id into another segment", () => {
    expect(() => new LocalServiceAdapter({
      id: "bad", alias: "Bad", provider: "codebuddy", baseUrl: "http://127.0.0.1:1", healthPath: "/health", startPath: "/sessions",
      statusPath: "/sessions/prefix-{sessionId}", inputPath: "/sessions/{sessionId}/messages", cancelPath: "/sessions/{sessionId}/cancel",
    })).toThrow(/complete path segment/);
  });
});

describe("compatibility matrix", () => {
  it("derives routing capabilities and concrete unsupported reasons from manifests", () => {
    const matrix = buildAdapterCompatibilityMatrix([cursorManifest, devinManifest, kiroManifest, localServiceManifest]);
    expect(matrix.find((row) => row.backendId === "devin-v3-api")).toMatchObject({ artifacts: true, resource: true, session: { resume: true, pause: false } });
    expect(matrix.find((row) => row.backendId === "cursor-local-cli")).toMatchObject({
      input: { initial: true, interactive: true },
      session: { resume: true, pause: false },
    });
    expect(assessManifestCapabilities(cursorManifest, ["code", "git"]).supported).toBe(true);
    expect(assessManifestCapabilities(cursorManifest, ["interactive-input"])).toMatchObject({ supported: true, missing: [] });
  });
});

describe("Generic CLI adapter", () => {
  it("routes PTY profiles through the executor without shell interpolation", async () => {
    let startInput: Parameters<ProcessExecutor["start"]>[0] | undefined;
    const executor: ProcessExecutor = {
      start: async (input) => {
        startInput = input;
        return {
          id: input.runId,
          status: async () => ({ state: "running" }),
          send: async () => undefined,
          cancel: async () => undefined,
          result: async () => ({ state: "completed", summary: "done" }),
        };
      },
    };
    const adapter = new GenericCliAdapter(executor, { file: "/usr/bin/example-agent", args: ["--prompt", "{{prompt}}"], mode: "pty" });
    const session = await adapter.start({ runId: "run-pty", workspacePath: "/workspace", prompt: "hello; echo unsafe" });
    expect(startInput).toMatchObject({
      file: "/usr/bin/example-agent",
      args: ["--prompt", "hello; echo unsafe"],
      cwd: "/workspace",
      mode: "pty",
    });
    expect(session.backendId).toBe("restricted-pty");
  });
});
