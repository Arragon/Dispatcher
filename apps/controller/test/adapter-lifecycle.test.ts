import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AgentAdapter, DevinBackend, QoderBackend } from "@dispatcher/adapters";
import type { DispatcherConfig, SecretStore } from "@dispatcher/config";
import { contentHash } from "../src/task-publications.js";
import { ControllerService } from "../src/service.js";

const OWNER = { authorization: "Bearer test-owner" };
const secrets: SecretStore = {
  put: async reference => ({ reference, backend: "encrypted-local", exists: true }),
  metadata: async reference => ({ reference, backend: "encrypted-local", exists: true }),
  delete: async () => undefined, test: async () => true, resolve: async () => "fixture",
};
async function fixture(options: Partial<ConstructorParameters<typeof ControllerService>[0]> = {}) {
  const directory = mkdtempSync(join(tmpdir(), "dispatcher-adapter-lifecycle-"));
  const repository = join(directory, "repo");
  execFileSync("git", ["init", "--initial-branch=main", repository]);
  execFileSync("git", ["-C", repository, "config", "user.email", "fixture@example.invalid"]);
  execFileSync("git", ["-C", repository, "config", "user.name", "Fixture"]);
  writeFileSync(join(repository, "README.md"), "fixture\n");
  execFileSync("git", ["-C", repository, "add", "."]);
  execFileSync("git", ["-C", repository, "commit", "-m", "fixture"]);
  const service = new ControllerService({ dataDirectory: directory, ownerToken: "test-owner", withRunner: true, secretStore: secrets, backgroundWorker: { enabled: false }, ...options });
  await service.start({ listen: false });
  const apply = async (mutate: (config: DispatcherConfig) => void) => {
    const config = structuredClone(service.configuration.current().config);
    mutate(config);
    const plan = service.configuration.buildPlan(config, "fixture", "web");
    return service.app.inject({ method: "POST", url: `/api/config/plans/${plan.id}/apply`, headers: OWNER, payload: { confirmed: true } });
  };
  await apply(config => { config.agentProfiles = []; config.repositories = [{ id: "fixture", root: repository, defaultBaseRef: "main", scopePaths: [], verificationCommands: [] }]; });
  const workspace = await service.workspaces.create({ repositoryId: "fixture", taskId: "trial", runId: "trial", attempt: 1, baseRef: "main", scopePaths: [] });
  const start = (id: string, path = workspace.path) => service.app.inject({ method: "POST", url: `/api/agents/profiles/${id}/runs`, headers: OWNER, payload: { workspacePath: path, prompt: "hello" } });
  return { service, apply, start, workspace, directory, close: async () => { await service.stop(); rmSync(directory, { recursive: true, force: true }); } };
}

describe("all-provider adapter lifecycle", () => {
  it("changes local catalog identity after a credential write and rejects a late old-context catalog",async()=>{
    const f=await fixture(),entered=Promise.withResolvers<void>(),gate=Promise.withResolvers<void>();let held=false;
    try{
      expect((await f.apply(config=>{config.agentProfiles=[{id:"grok",alias:"Grok",provider:"grok",runnerId:"local",credentialRef:"secret://grok/account"}];})).statusCode).toBe(200);
      const adapter=(f.service as unknown as {agentAdapters:Map<string,AgentAdapter>}).agentAdapters.get("grok")!;
      adapter.modelCatalog=async context=>{if(held){entered.resolve();await gate.promise;}return {profileId:"grok",runnerId:"local",providerId:"grok",backendId:"grok-headless",contextFingerprint:contentHash(context.executionContextRef),revision:"fixture",fetchedAt:new Date().toISOString(),freshness:"native-fresh",source:"cli-query",selectionSupport:"explicit",entries:[]};};
      const catalog=()=>f.service.app.inject({headers:OWNER,url:"/api/agents/profiles/grok/models?repositoryId=fixture"});
      const before=await catalog();expect(before.statusCode).toBe(200);
      held=true;const pending=catalog();await entered.promise;expect((await f.service.app.inject({headers:OWNER,method:"PUT",url:"/api/secrets/grok/account",payload:{value:"rotated-secret"}})).statusCode).toBe(201);gate.resolve();expect((await pending).statusCode).toBe(409);held=false;
      const after=await catalog();expect(after.statusCode).toBe(200);expect(after.json().contextFingerprint).not.toBe(before.json().contextFingerprint);
    }finally{gate.resolve();await f.close();}
  });
  it("refuses a same-reference credential replacement during a pending provider start or canonical wait",async()=>{
    const entered=Promise.withResolvers<void>(),gate=Promise.withResolvers<void>();
    const f=await fixture({devinBackendFactory:()=>({health:async()=>({ok:true}),create:async()=>{entered.resolve();await gate.promise;return {sessionId:"credential-start",status:"completed",pullRequests:[]};},get:async()=>({sessionId:"credential-start",status:"completed",pullRequests:[]}),send:async()=>{}})});
    const put=()=>f.service.app.inject({headers:OWNER,method:"PUT",url:"/api/secrets/devin/account",payload:{value:"rotated-private-value"}});
    try{
      expect((await f.apply(config=>{config.agentProfiles=[{id:"devin",alias:"Devin",provider:"devin",runnerId:"local",credentialRef:"secret://devin/account",settings:{organizationId:"org"}}];})).statusCode).toBe(200);
      const pending=f.start("devin");await entered.promise;expect((await put()).statusCode).toBe(409);gate.resolve();expect((await pending).statusCode).toBe(201);
      expect((await put()).statusCode).toBe(201);
      f.service.database.saveEntity("run","credential-wait",{id:"credential-wait",profileId:"devin",state:"WAITING_USER"});expect((await put()).statusCode).toBe(409);
    }finally{gate.resolve();await f.close();}
  });
  it("retains Qoder handles and Devin/HTTP snapshots across unrelated applies, and blocks busy account or runner changes", async () => {
    let running = true;
    const cancel = vi.fn(async () => { running = false; });
    const qoderBackend: QoderBackend = { start: () => ({ status: () => running ? "running" : "completed", cancel, result: async () => ({ state: "completed", summary: "original Qoder result", events: [] }) }) };
    const qoderFactory = vi.fn(() => qoderBackend);
    const devinFactory = vi.fn((): DevinBackend => ({ health: async () => ({ ok: true }), create: async () => ({ sessionId: "devin-native", status: "completed", pullRequests: [], summary: "original Devin result" }), get: async () => ({ sessionId: "devin-native", status: "completed", pullRequests: [], summary: "original Devin result" }), send: async () => { throw new Error("unexpected send"); } }));
    const f = await fixture({ qoderBackendFactory: qoderFactory, devinBackendFactory: devinFactory, integrationFetch: async () => new Response(JSON.stringify({ sessionId: "http-native", state: "completed", summary: "original HTTP result" }), { status: 200 }) });
    try {
      expect((await f.apply(config => { config.agentProfiles = [
        { id: "qoder", alias: "Qoder", provider: "qoder", runnerId: "local" },
        { id: "devin", alias: "Devin", provider: "devin", runnerId: "local", credentialRef: "secret://devin/account", settings: { organizationId: "org-fixture" } },
        { id: "http", alias: "HTTP", provider: "workbuddy", runnerId: "local", settings: { baseUrl: "http://127.0.0.1:9999", healthPath: "/health", startPath: "/start", statusPath: "/sessions/{sessionId}", inputPath: "/sessions/{sessionId}/input", cancelPath: "/sessions/{sessionId}/cancel" } },
      ]; })).statusCode).toBe(200);
      const adapters = (f.service as unknown as { agentAdapters: Map<string, AgentAdapter> }).agentAdapters;
      const originals = new Map(adapters);
      await f.apply(config => { config.runners[0]!.capacity = 8; });
      expect(f.service.runners.list()[0]!.capacity).toBe(8);
      const sessions = new Map<string, string>();
      for (const id of ["qoder", "devin", "http"]) {
        const workspace = await f.service.workspaces.create({ repositoryId: "fixture", taskId: id, runId: id, attempt: 1, baseRef: "main", scopePaths: [] });
        const response = await f.start(id, workspace.path); expect(response.statusCode, response.body).toBe(201); sessions.set(id, response.json().session.id); }
      expect((await f.apply(config => { config.runners[0]!.displayName = "Renamed device"; })).statusCode).toBe(200);
      expect(qoderFactory).toHaveBeenCalledTimes(1);
      expect(devinFactory).toHaveBeenCalledTimes(1);
      for (const id of ["devin", "http"]) {
        expect(adapters.get(id)).toBe(originals.get(id));
        const result = await adapters.get(id)!.result(sessions.get(id)!);
        expect(result.summary).toContain(`original ${id === "http" ? "HTTP" : "Devin"} result`);
      }
      for (const mutate of [
        (config: DispatcherConfig) => { config.agentProfiles.find(profile => profile.id === "qoder")!.enabled = false; },
        (config: DispatcherConfig) => { config.agentProfiles = config.agentProfiles.filter(profile => profile.id !== "qoder"); },
        (config: DispatcherConfig) => { config.agentProfiles.find(profile => profile.id === "qoder")!.settings = { model: "other" }; },
        (config: DispatcherConfig) => { config.runners[0]!.mode = "remote"; config.runners[0]!.credentialRef = "secret://runner/local"; },
      ]) {
        const revision = f.service.configuration.current().revision;
        const rejected = await f.apply(mutate);
        expect(rejected.json()).toMatchObject({ code: "ACTIVE_AGENT_PROFILE" });
        expect(f.service.configuration.current().revision).toBe(revision);
      }
      const stopped = await adapters.get("qoder")!.cancel(sessions.get("qoder")!);
      expect(stopped.state).toBe("CANCELLED"); expect(cancel).toHaveBeenCalledOnce();
      expect((await f.apply(config => { config.agentProfiles.find(profile => profile.id === "qoder")!.enabled = false; })).statusCode).toBe(200);
    } finally { await f.close(); }
  });

  it("protects a legacy start before its provider returns a session, while preserving it through unrelated changes", async () => {
    let finish!: () => void;
    let entered!: () => void;
    const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const factory = vi.fn((): DevinBackend => ({ health: async () => ({ ok: true }), create: async () => { entered(); await pending; return { sessionId: "native", status: "running", pullRequests: [] }; }, get: async () => ({ sessionId: "native", status: "completed", pullRequests: [] }), send: async () => { throw new Error("unused"); } }));
    const f = await fixture({ devinBackendFactory: factory });
    try {
      await f.apply(config => { config.agentProfiles = [{ id: "devin", alias: "Devin", provider: "devin", runnerId: "local", credentialRef: "secret://devin/account", settings: { organizationId: "org-fixture" } }]; });
      const started = f.start("devin"); void started.then(() => undefined);
      await enteredPromise;
      expect((await f.apply(config => { config.agentProfiles[0]!.enabled = false; })).json()).toMatchObject({ code: "ACTIVE_AGENT_PROFILE" });
      expect((await f.apply(config => { config.runners[0]!.capacity += 1; })).statusCode).toBe(200);
      finish(); const response = await started; expect(response.statusCode).toBe(201);
      expect(factory).toHaveBeenCalledOnce();
      expect((await f.apply(config => { config.agentProfiles[0]!.enabled = false; })).json()).toMatchObject({ code: "ACTIVE_AGENT_PROFILE" });
      await f.service.app.inject({ method: "GET", url: `/api/agents/profiles/devin/sessions/${response.json().session.id}`, headers: OWNER });
      expect((await f.apply(config => { config.agentProfiles[0]!.enabled = false; })).statusCode).toBe(200);
    } finally { finish?.(); await f.close(); }
  });
  it("keeps the actual Generic CLI process attached across an apply and protects canonical work after the native turn ends", async () => {
    const f = await fixture();
    let adapter: AgentAdapter | undefined;
    let sessionId: string | undefined;
    try {
      await f.apply(config => { config.agentProfiles = [{ id: "generic", alias: "Generic", provider: "generic-cli", runnerId: "local", settings: { executable: process.execPath, args: ["-e", "process.stdin.resume()"] } }]; });
      const adapters = (f.service as unknown as { agentAdapters: Map<string, AgentAdapter> }).agentAdapters;
      adapter = adapters.get("generic")!;
      const started = await f.start("generic"); expect(started.statusCode, started.body).toBe(201);
      sessionId = started.json().session.id;
      expect((await f.apply(config => { config.runners[0]!.tags.push("renamed-tag"); })).statusCode).toBe(200);
      expect(adapters.get("generic")).toBe(adapter);
      expect((await f.apply(config => { config.agentProfiles[0]!.enabled = false; })).json()).toMatchObject({ code: "ACTIVE_AGENT_PROFILE" });
      await adapter.cancel(sessionId!);
      f.service.database.saveEntity("run", "verification", { id: "verification", profileId: "generic", state: "VERIFYING" });
      expect((await f.apply(config => { config.agentProfiles[0]!.enabled = false; })).json()).toMatchObject({ code: "ACTIVE_AGENT_PROFILE" });
      f.service.database.saveEntity("run", "verification", { id: "verification", profileId: "generic", state: "COMPLETE" });
      expect((await f.apply(config => { config.agentProfiles[0]!.enabled = false; })).statusCode).toBe(200);
    } finally { if (adapter && sessionId) await adapter.cancel(sessionId); await f.close(); }
  });

  it("protects a pending legacy input even when its saved session was completed", async () => {
    let finish!: () => void;
    let entered!: () => void;
    const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const factory = vi.fn((): DevinBackend => ({ health: async () => ({ ok: true }), create: async () => ({ sessionId: "native", status: "completed", pullRequests: [] }), get: async () => ({ sessionId: "native", status: "completed", pullRequests: [] }), send: async () => { entered(); await pending; return { sessionId: "native", status: "waiting", pullRequests: [] }; } }));
    const f = await fixture({ devinBackendFactory: factory });
    try {
      await f.apply(config => { config.agentProfiles = [{ id: "devin", alias: "Devin", provider: "devin", runnerId: "local", credentialRef: "secret://devin/account", settings: { organizationId: "org-fixture" } }]; });
      const started = await f.start("devin");
      const input = f.service.app.inject({ method: "POST", url: `/api/agents/profiles/devin/sessions/${started.json().session.id}/input`, headers: OWNER, payload: { message: "continue" } }); void input.then(() => undefined);
      await enteredPromise;
      expect((await f.apply(config => { config.agentProfiles[0]!.alias = "Changed account"; })).json()).toMatchObject({ code: "ACTIVE_AGENT_PROFILE" });
      expect((await f.apply(config => { config.runners[0]!.capacity += 1; })).statusCode).toBe(200);
      finish(); expect((await input).statusCode).toBe(200);
      expect(factory).toHaveBeenCalledOnce();
      expect((await f.apply(config => { config.agentProfiles[0]!.enabled = false; })).json()).toMatchObject({ code: "ACTIVE_AGENT_PROFILE" });
    } finally { finish?.(); await f.close(); }
  });

  it("does not acknowledge canonical cancellation until the active verification process tree has stopped", async () => {
    const f = await fixture({ qoderBackendFactory: () => ({ start: () => ({ status: () => "completed", cancel: async () => undefined, result: async () => ({ state: "completed", summary: "done", events: [] }) }) }) });
    const ready = join(f.directory, "verify-child.pid");
    let child: number | undefined, parent: number | undefined;
    let advancing: ReturnType<typeof f.service.app.inject> | undefined;
    const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    try {
      const descendant = `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(ready)},JSON.stringify({pid:process.pid,parent:process.ppid}));setInterval(()=>{},1000)`;
      const body = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'}).unref();process.on('SIGTERM',()=>{});setInterval(()=>{},1000)`;
      await f.apply(config => { config.agentProfiles = [{ id: "qoder", alias: "Qoder", provider: "qoder", runnerId: "local" }]; config.repositories[0]!.verificationCommands = [{ id: "wait", file: process.execPath, args: ["-e", body], required: true, timeoutMs: 15_000, outputLimitBytes: 1024 }]; });
      const session = (await f.start("qoder")).json().session;
      const now = new Date().toISOString();
      f.service.database.writeCanonicalTask("task", 0, { id: "task", projectId: "fixture", title: "Task", state: "VERIFYING", currentRunId: "run", createdAt: now, updatedAt: now });
      f.service.database.saveTaskContract("task", { version: 1, revision: 1, goal: "done", scope: ["README.md"], acceptanceCriteria: ["done"], verification: ["wait"], constraints: [], delivery: { type: "none", repository: "fixture" } });
      f.service.database.saveEntity("run", "run", { id: "run", taskId: "task", runnerId: "local", providerId: "qoder", profileId: "qoder", sessionId: session.id, state: "VERIFYING", attempt: 1, generation: 1, leaseId: "lease", taskRevision: 1, contractRevision: 1, worktree: f.workspace.path, branch: f.workspace.branch, startedAt: now, lastActivityAt: now, verification: { state: "PENDING", commands: ["wait"] } });
      f.service.database.saveEntity("task-publication", "publication", { owner: "operator", preview: { publicationId: "publication" }, receipt: { publicationId: "publication", taskId: "task", runId: "run", state: "STARTED" } });
      advancing = f.service.app.inject({ method: "POST", url: "/api/runs/run/advance", headers: OWNER }); void advancing.then(() => undefined);
      await vi.waitFor(() => expect(existsSync(ready)).toBe(true)); ({ pid: child, parent } = JSON.parse(readFileSync(ready, "utf8")));
      const cancelled = await f.service.semanticTools.execute("run.cancel", { target: "run" }, { principal: { id: "operator", roles: ["operator"], channel: "api" }, workflowId: "cancel-verification", confirmed: true });
      expect(cancelled).toMatchObject({ state: "CANCELLED" });
      expect(alive(child!)).toBe(false);
      await advancing;
      expect(f.service.database.getEntity("run", "run")).toMatchObject({ state: "CANCELLED" });
      expect(f.service.database.getCanonicalTask("task")!.document).toMatchObject({ state: "CANCELLED" });
      expect(f.service.database.getEntity("run-result", "run")).toBeUndefined();
      expect(f.service.database.getEntity("task-publication", "publication")).toMatchObject({ receipt: { state: "STARTED" } });
    } finally { for (const pid of [child, parent]) if (pid && alive(pid)) process.kill(pid, "SIGKILL"); await advancing; await f.close(); }
  });

  it("reserves standalone capacity/workspace before provider awaits and offers an explicit standalone cancel", async () => {
    let finish!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const admitted = new Promise<void>(resolve => { entered = resolve; });
    const create = vi.fn(async () => { entered(); await gate; return { sessionId: "native", status: "running", pullRequests: [] }; });
    const f = await fixture({ devinBackendFactory: () => ({ health: async () => ({ ok: true }), create, get: async () => ({ sessionId: "native", status: "completed", pullRequests: [] }), send: async () => { throw new Error("unused"); } }) });
    let started: ReturnType<typeof f.start> | undefined;
    try {
      await f.apply(config => { config.agentProfiles = [{ id: "devin", alias: "Devin", provider: "devin", runnerId: "local", credentialRef: "secret://devin/account", settings: { organizationId: "org-fixture" } }]; });
      const second = await f.service.workspaces.create({ repositoryId: "fixture", taskId: "trial-2", runId: "trial-2", attempt: 1, baseRef: "main", scopePaths: [] });
      started = f.start("devin"); void started.then(() => undefined); await admitted;
      expect((await Promise.race([f.start("devin"), new Promise<undefined>(resolve => setTimeout(resolve, 500))]))?.json()).toMatchObject({ code: "TRIAL_WORKSPACE_BUSY" });
      expect((await f.start("devin", second.path)).json()).toMatchObject({ code: "RUNNER_CAPACITY_EXHAUSTED" });
      expect(create).toHaveBeenCalledOnce();
      const now = new Date().toISOString();
      f.service.database.writeCanonicalTask("queued", 0, { id: "queued", projectId: "fixture", title: "Queued", state: "READY", labels: [], createdAt: now, updatedAt: now });
      f.service.database.saveTaskContract("queued", { version: 1, revision: 1, goal: "done", scope: ["README.md"], acceptanceCriteria: ["done"], verification: [], constraints: [], delivery: { type: "none", repository: "fixture" } });
      const dispatch = () => f.service.app.inject({ method: "POST", url: "/api/tasks/queued/dispatch", headers: OWNER, payload: { profileId: "devin" } });
      expect((await dispatch()).json()).toMatchObject({ code: "DISPATCH_UNAVAILABLE" });
      expect(create).toHaveBeenCalledOnce();
      finish(); const response = await started; expect(response.statusCode).toBe(201);
      const cancelled = await f.service.app.inject({ method: "POST", url: `/api/agents/profiles/devin/sessions/${response.json().session.id}/cancel`, headers: OWNER });
      expect(cancelled.json()).toMatchObject({ code: "UNSUPPORTED_CAPABILITY" });
      await f.service.app.inject({ method: "GET", url: `/api/agents/profiles/devin/sessions/${response.json().session.id}`, headers: OWNER });
      const canonical = await dispatch(); expect(canonical.statusCode, canonical.body).toBe(201);
      expect(create).toHaveBeenCalledTimes(2);
      expect((await f.start("devin", second.path)).json()).toMatchObject({ code: "RUNNER_CAPACITY_EXHAUSTED" });
    } finally { finish?.(); await started; await f.close(); }
  });

  it("rejects a canonical worktree and a foreign Runner before any legacy native start", async () => {
    const start = vi.fn<QoderBackend["start"]>(() => ({ status: () => "completed", cancel: async () => undefined, result: async () => ({ state: "completed", summary: "done", events: [] }) }));
    const f = await fixture({ qoderBackendFactory: () => ({ start }) });
    try {
      await f.apply(config => { config.agentProfiles = [{ id: "qoder", alias: "Qoder", provider: "qoder", runnerId: "local" }]; });
      f.service.database.saveEntity("run", "canonical", { id: "canonical", profileId: "qoder", state: "COMPLETE", worktree: f.workspace.path });
      expect((await f.start("qoder")).json()).toMatchObject({ code: "CANONICAL_WORKSPACE_OWNED" });
      await f.apply(config => { config.runners.push({ id: "remote", displayName: "Remote", mode: "remote", capacity: 1, tags: [], credentialRef: "secret://runner/remote" }); config.agentProfiles[0]!.runnerId = "remote"; });
      expect((await f.start("qoder")).json()).toMatchObject({ code: "CANONICAL_EXECUTION_REQUIRED" });
      expect(start).not.toHaveBeenCalled();
    } finally { await f.close(); }
  });

  it("keeps a pending standalone stop bound to its account and routes canonical sessions to canonical cancellation", async () => {
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const stops = vi.fn(async () => { await gate; });
    const f = await fixture({ integrationFetch: async input => { const stopping = String(input).endsWith("/cancel"); if (stopping) await stops(); return new Response(JSON.stringify({ sessionId: "native", state: stopping ? "cancelled" : "completed" })); } });
    let cancelled: ReturnType<typeof f.service.app.inject> | undefined;
    try {
      await f.apply(config => { config.agentProfiles = [{ id: "http", alias: "HTTP", provider: "workbuddy", runnerId: "local", settings: { baseUrl: "http://127.0.0.1:9999", healthPath: "/health", startPath: "/start", statusPath: "/sessions/{sessionId}", inputPath: "/sessions/{sessionId}/input", cancelPath: "/sessions/{sessionId}/cancel" } }]; });
      const session = (await f.start("http")).json().session;
      const stop = (profileId: string) => f.service.app.inject({ method: "POST", url: `/api/agents/profiles/${profileId}/sessions/${session.id}/cancel`, headers: OWNER });
      expect((await stop("other")).statusCode).toBe(404);
      cancelled = stop("http"); void cancelled.then(() => undefined); await vi.waitFor(() => expect(stops).toHaveBeenCalledOnce());
      expect((await f.apply(config => { config.agentProfiles[0]!.enabled = false; })).json()).toMatchObject({ code: "ACTIVE_AGENT_PROFILE" });
      finish(); expect((await cancelled).json()).toMatchObject({ session: { state: "CANCELLED" }, canonical: false });
      expect(stops).toHaveBeenCalledOnce();
      f.service.database.saveEntity("run", "canonical", { id: "canonical", profileId: "http", sessionId: session.id, state: "COMPLETE" });
      expect((await stop("http")).json()).toMatchObject({ code: "CANONICAL_EXECUTION_REQUIRED" });
      expect(stops).toHaveBeenCalledOnce();
    } finally { finish?.(); await cancelled; await f.close(); }
  });

  it("finds an already persisted native session when cancellation overtakes the canonical startup acknowledgement", async () => {
    const cancel = vi.fn(async () => undefined);
    const f = await fixture({ qoderBackendFactory: () => ({ start: () => ({ status: () => "running", cancel, result: async () => ({ state: "cancelled", summary: "stopped", events: [] }) }) }) });
    try {
      await f.apply(config => { config.agentProfiles = [{ id: "qoder", alias: "Qoder", provider: "qoder", runnerId: "local" }]; });
      const session = (await f.start("qoder")).json().session;
      const now = new Date().toISOString();
      f.service.database.writeCanonicalTask("startup", 0, { id: "startup", projectId: "fixture", title: "Task", state: "QUEUED", currentRunId: session.runId, labels: [], createdAt: now, updatedAt: now });
      f.service.database.saveEntity("run", session.runId, { id: session.runId, taskId: "startup", runnerId: "local", providerId: "qoder", profileId: "qoder", sessionId: `unstarted:${session.runId}`, state: "STARTING", attempt: 1, generation: 1, leaseId: "lease", taskRevision: 1, contractRevision: 1, startedAt: now, lastActivityAt: now, verification: { state: "PENDING", commands: [] } });
      expect(await f.service.semanticTools.execute("run.cancel", { target: session.runId }, { principal: { id: "operator", roles: ["operator"], channel: "api" }, workflowId: "cancel-startup", confirmed: true })).toMatchObject({ state: "CANCELLED", sessionId: session.id });
      expect(cancel).toHaveBeenCalledOnce();
    } finally { await f.close(); }
  });

  it("requires a Controller restart before replacing its live embedded executor identity", async () => {
    const f = await fixture();
    try {
      const before = f.service.configuration.current().revision;
      const response = await f.apply(config => { config.runners[0]!.mode = "remote"; config.runners[0]!.credentialRef = "secret://runner/local"; });
      expect(response.json()).toMatchObject({ code: "EMBEDDED_RUNNER_RESTART_REQUIRED" });
      expect(f.service.configuration.current().revision).toBe(before);
      expect(f.service.runners.list()[0]).toMatchObject({ id: "local", state: "ONLINE" });
    } finally { await f.close(); }
  });

});
