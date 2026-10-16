import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AgentAdapter, DevinBackend, QoderBackend } from "@dispatcher/adapters";
import type { DispatcherConfig, SecretStore } from "@dispatcher/config";
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
  const start = (id: string) => service.app.inject({ method: "POST", url: `/api/agents/profiles/${id}/runs`, headers: OWNER, payload: { workspacePath: workspace.path, prompt: "hello" } });
  return { service, apply, start, close: async () => { await service.stop(); rmSync(directory, { recursive: true, force: true }); } };
}

describe("all-provider adapter lifecycle", () => {
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
      const sessions = new Map<string, string>();
      for (const id of ["qoder", "devin", "http"]) { const response = await f.start(id); expect(response.statusCode, response.body).toBe(201); sessions.set(id, response.json().session.id); }
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

});
