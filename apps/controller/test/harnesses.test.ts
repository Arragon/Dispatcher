import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import type { CliAgentBackend, CliTurnResult } from "@dispatcher/adapters";
import type { SecretStore } from "@dispatcher/config";
import { ControllerService } from "../src/service.js";

const OWNER = { authorization: "Bearer test-owner" };
const secrets: SecretStore = {
  put: async (reference) => ({ reference, backend: "encrypted-local", exists: true }),
  delete: async () => undefined, test: async () => true,
  metadata: async (reference) => ({ reference, backend: "encrypted-local", exists: false }),
  resolve: async () => { throw new Error("No secrets required"); },
};

describe("native harness Controller composition", () => {
  it("registers ConfigPlan profiles, probes, sessions and exact same-session input for all native harnesses", async () => {
    const directory = mkdtempSync(join(tmpdir(), "dispatcher-harnesses-"));
    const executable = join(directory, "harness");
    const repository = join(directory, "repo");
    execFileSync("git", ["init", "--initial-branch=main", repository]);
    execFileSync("git", ["-C", repository, "config", "user.email", "fixture@example.invalid"]);
    execFileSync("git", ["-C", repository, "config", "user.name", "Fixture"]);
    writeFileSync(join(repository, "README.md"), "fixture\n");
    execFileSync("git", ["-C", repository, "add", "README.md"]);
    execFileSync("git", ["-C", repository, "commit", "-m", "fixture"]);
    writeFileSync(executable, `#!${process.execPath}\nif(process.argv.includes('--help')) console.log('--standalone --format json --session --session-id --resume --mode streaming-messages-json --conversation --print --prompt --json --output-format stream-json --permission-mode'); else console.log('2.0.21');`);
    chmodSync(executable, 0o700);
    let blockedProvider: string | undefined;
    let runningProvider: string | undefined;
    const calls = vi.fn((provider: string) => {
      const result = (): CliTurnResult => provider === blockedProvider
        ? { state: "failed", summary: "requires more credits", events: [{ type: "resource", state: "QUOTA_EXHAUSTED", reason: "requires more credits", source: "error", confidence: "high" }], providerSessionId: `${provider}-exact-session` }
        : { state: "completed", summary: "done", events: [], providerSessionId: `${provider}-exact-session` };
      const backend: CliAgentBackend = { start: vi.fn(() => ({ status: () => provider === runningProvider ? "running" : "completed", result: async () => result(), cancel: async () => undefined })) };
      return backend;
    });
    const codexCalls = vi.fn(() => ({ start: vi.fn(() => ({ status: () => "running" as const, result: async () => ({ state: "completed" as const, summary: "done", events: [], providerSessionId: "codex-exact" }), cancel: async () => undefined })) }));
    const service = new ControllerService({ codexBackendFactory: codexCalls, dataDirectory: directory, ownerToken: "test-owner", withRunner: true, secretStore: secrets, cliBackendFactory: calls });
    try {
      await service.start({ listen: false });
      const current = (await service.app.inject({ method: "GET", url: "/api/config", headers: OWNER })).json().config;
      current.repositories = [{ id: "fixture", root: repository, defaultBaseRef: "main", scopePaths: [], verificationCommands: [] }];
      const plan = (await service.app.inject({ method: "POST", url: "/api/config/plans", headers: OWNER, payload: { config: current } })).json().plan;
      expect((await service.app.inject({ method: "POST", url: `/api/config/plans/${plan.id}/apply`, headers: OWNER, payload: { confirmed: true } })).statusCode).toBe(200);
      const workspace = await service.workspaces.create({ repositoryId: "fixture", taskId: "harness", runId: "test", attempt: 1, baseRef: "main", scopePaths: [] });
      const manifests = (await service.app.inject({ method: "GET", url: "/api/adapters/manifests", headers: OWNER })).json().manifests;
      expect(manifests.map((value: { id: string }) => value.id)).toEqual(expect.arrayContaining(["opencode", "grok", "pi", "antigravity", "zcode", "workbuddy-cli", "qoder-cn"]));
      for (const provider of ["opencode", "grok", "pi", "antigravity", "zcode", "workbuddy-cli", "qoder-cn"]) {
        const discovery = await service.app.inject({ method: "POST", url: `/api/agents/${provider}/discover`, headers: OWNER, payload: { id: provider, alias: provider, executable } });
        expect(discovery.statusCode).toBe(200);
        expect(discovery.json()).toMatchObject({ installed: true, compatible: true, authenticated: false, authentication: "unknown" });
        const saved = await service.app.inject({ method: "POST", url: `/api/agents/${provider}/profiles`, headers: OWNER, payload: { id: provider, alias: provider, executable, ...(["grok", "antigravity"].includes(provider) ? { approveTools: true } : {}) } });
        expect(saved.statusCode).toBe(201);
        expect(saved.json().profile.state).toBe("CONFIGURED");
        expect((await service.app.inject({ method: "POST", url: `/api/agents/profiles/${provider}/runs`, headers: OWNER, payload: { workspacePath: directory, prompt: "hello" } })).statusCode).toBe(400);
        const started = await service.app.inject({ method: "POST", url: `/api/agents/profiles/${provider}/runs`, headers: OWNER, payload: { workspacePath: workspace.path, prompt: "hello" } });
        expect(started.statusCode).toBe(201);
        const id: string = started.json().session.id;
        const status = await service.app.inject({ method: "GET", url: `/api/agents/profiles/${provider}/sessions/${id}`, headers: OWNER });
        expect(status.json().session.state).toBe("COMPLETED");
        expect((await service.app.inject({ method: "POST", url: `/api/agents/profiles/${provider}/sessions/${id}/input`, headers: OWNER, payload: { message: "next" } })).statusCode).toBe(200);
        const tested = await service.app.inject({ method: "POST", url: `/api/agents/profiles/${provider}/test`, headers: OWNER });
        expect(tested.json()).toMatchObject({ compatible: true, authentication: "unknown" });
      }
      const sourceSession = (await service.app.inject({ method: "GET", url: "/api/agents/profiles", headers: OWNER })).json().sessions.find((session: { profileId: string }) => session.profileId === "qoder-cn").id;
      expect((await service.app.inject({ method: "POST", url: "/api/agents/profiles/qoder-cn/enabled", headers: OWNER, payload: { enabled: false } })).statusCode).toBe(200);
      for (const [method, suffix, payload] of [["GET", "", undefined], ["POST", "/input", { message: "wrong account" }]] as const) {
        const wrong = await service.app.inject({ method, url: `/api/agents/profiles/pi/sessions/${sourceSession}${suffix}`, headers: OWNER, ...(payload ? { payload } : {}) });
        expect(wrong.json()).toMatchObject({ code: "SESSION_NOT_FOUND" });
      }
      expect((await service.app.inject({ method: "POST", url: "/api/agents/profiles/qoder-cn/enabled", headers: OWNER, payload: { enabled: true } })).statusCode).toBe(200);
      expect(calls.mock.calls.map(([provider]) => provider)).toEqual(expect.arrayContaining(["opencode", "grok", "pi", "antigravity", "zcode", "workbuddy-cli", "qoder-cn"]));
      const config = (await service.app.inject({ method: "GET", url: "/api/config", headers: OWNER })).json().config;
      expect(config.agentProfiles.find((profile: { id: string }) => profile.id === "grok").settings.approveTools).toBe(true);
      expect(config.agentProfiles.find((profile: { id: string }) => profile.id === "antigravity").settings.approveTools).toBe(true);
      expect((await service.app.inject({ method: "POST", url: "/api/agents/antigravity/profiles", headers: OWNER, payload: { id: "invalid-ag", alias: "Invalid Antigravity", approveTools: "yes" } })).statusCode).toBe(400);
      expect((await service.app.inject({ method: "POST", url: "/api/agents/pi/profiles", headers: OWNER, payload: { id: "invalid-pi", alias: "Invalid pi", approveTools: true } })).statusCode).toBe(400);
      const reserved = await service.app.inject({ method: "POST", url: "/api/agents/codex/profiles", headers: OWNER, payload: { id: "kite", alias: "kite", codexHome: join(directory, "kite-home"), enabled: false } });
      expect(reserved.statusCode, reserved.body).toBe(201);
      expect(reserved.json().profile.state).toBe("DISABLED");
      expect(codexCalls).not.toHaveBeenCalled();
      expect((await service.app.inject({ method: "POST", url: "/api/agents/profiles/kite/runs", headers: OWNER, payload: { workspacePath: workspace.path, prompt: "must not start" } })).statusCode).toBe(404);
      const enableReserved = await service.app.inject({ method: "POST", url: "/api/agents/profiles/kite/enabled", headers: OWNER, payload: { enabled: true } });
      expect(enableReserved.statusCode).toBe(200);
      expect(codexCalls).toHaveBeenCalledTimes(1);
      const disableReserved = await service.app.inject({ method: "POST", url: "/api/agents/profiles/kite/enabled", headers: OWNER, payload: { enabled: false } });
      expect(disableReserved.statusCode).toBe(200);
      codexCalls.mockClear();
      const primary = await service.app.inject({ method: "POST", url: "/api/agents/codex/profiles", headers: OWNER, payload: { id: "ronna", alias: "ronna", codexHome: join(directory, "ronna-home") } });
      expect(primary.statusCode).toBe(201);
      const codexRun = await service.app.inject({ method: "POST", url: "/api/agents/profiles/ronna/runs", headers: OWNER, payload: { workspacePath: workspace.path, prompt: "long task" } });
      expect(codexRun.statusCode).toBe(201);
      const codexSession = codexRun.json().session.id;
      const addAlias = await service.app.inject({ method: "POST", url: "/api/agents/pi/profiles", headers: OWNER, payload: { id: "pi-extra", alias: "Pi extra", executable } });
      expect(addAlias.statusCode).toBe(201);
      expect(codexCalls).toHaveBeenCalledTimes(1);
      expect((await service.app.inject({ method: "GET", url: `/api/agents/profiles/ronna/sessions/${codexSession}`, headers: OWNER })).json().session.state).toBe("RUNNING");
      const disabling = (await service.app.inject({ method: "GET", url: "/api/config", headers: OWNER })).json().config;
      disabling.agentProfiles.find((profile: { id: string }) => profile.id === "ronna").enabled = false;
      const disabledPlan = (await service.app.inject({ method: "POST", url: "/api/config/plans", headers: OWNER, payload: { config: disabling } })).json().plan;
      const disableRejected = await service.app.inject({ method: "POST", url: `/api/config/plans/${disabledPlan.id}/apply`, headers: OWNER, payload: { confirmed: true } });
      expect(disableRejected.json()).toMatchObject({ code: "ACTIVE_AGENT_PROFILE" });
      const views = (await service.app.inject({ method: "GET", url: "/api/agents/profiles", headers: OWNER })).body;
      expect(views).not.toContain(executable);
      const matrix = (await service.app.inject({ method: "GET", url: "/api/adapters/compatibility", headers: OWNER })).json().matrix;
      expect(matrix.find((row: { adapterId: string }) => row.adapterId === "opencode")).toMatchObject({ session: { resume: true, pause: false }, resource: true });
      runningProvider = "grok";
      const active = await service.app.inject({ method: "POST", url: "/api/agents/profiles/grok/runs", headers: OWNER, payload: { workspacePath: workspace.path, prompt: "long-running task" } });
      const sessionId: string = active.json().session.id;
      const configuredBefore = calls.mock.calls.length;
      const added = await service.app.inject({ method: "POST", url: "/api/agents/pi/profiles", headers: OWNER, payload: { id: "pi-second", alias: "Pi second", executable } });
      expect(added.statusCode, added.body).toBe(201);
      expect(calls).toHaveBeenCalledTimes(configuredBefore + 1);
      expect((await service.app.inject({ method: "GET", url: `/api/agents/profiles/grok/sessions/${sessionId}`, headers: OWNER })).json().session.state).toBe("RUNNING");
      for (const remove of [false, true]) {
        const before = (await service.app.inject({ method: "GET", url: "/api/config", headers: OWNER })).json();
        const next = structuredClone(before.config);
        if (remove) next.agentProfiles = next.agentProfiles.filter((profile: { id: string }) => profile.id !== "grok");
        else next.agentProfiles.find((profile: { id: string }) => profile.id === "grok").settings.model = "different-model";
        const change = (await service.app.inject({ method: "POST", url: "/api/config/plans", headers: OWNER, payload: { config: next } })).json().plan;
        const rejected = await service.app.inject({ method: "POST", url: `/api/config/plans/${change.id}/apply`, headers: OWNER, payload: { confirmed: true } });
        expect(rejected.statusCode, rejected.body).toBe(400);
        expect(rejected.json()).toMatchObject({ code: "ACTIVE_AGENT_PROFILE", message: expect.stringContaining("Finish or cancel") });
        expect((await service.app.inject({ method: "GET", url: "/api/config", headers: OWNER })).json().revision).toBe(before.revision);
        expect((await service.app.inject({ method: "GET", url: `/api/agents/profiles/grok/sessions/${sessionId}`, headers: OWNER })).json().session.state).toBe("RUNNING");
      }
      runningProvider = undefined;
      expect((await service.app.inject({ method: "GET", url: `/api/agents/profiles/grok/sessions/${sessionId}`, headers: OWNER })).json().session.state).toBe("COMPLETED");
      const completed = (await service.app.inject({ method: "GET", url: "/api/config", headers: OWNER })).json().config;
      completed.agentProfiles.find((profile: { id: string }) => profile.id === "grok").settings.model = "different-model";
      const replacement = (await service.app.inject({ method: "POST", url: "/api/config/plans", headers: OWNER, payload: { config: completed } })).json().plan;
      expect((await service.app.inject({ method: "POST", url: `/api/config/plans/${replacement.id}/apply`, headers: OWNER, payload: { confirmed: true } })).statusCode).toBe(200);
      for (const provider of ["opencode", "grok", "pi", "antigravity", "zcode", "workbuddy-cli", "qoder-cn"]) {
        const taskId = `${provider}-canonical`;
        const now = new Date().toISOString();
        service.tasks.execute({ id: `create:${taskId}`, taskId, baseRevision: 0, actor: "test", command: { type: "task.create", task: { id: taskId, projectId: "fixture", title: "Harness task", state: "READY", labels: [], createdAt: now, updatedAt: now }, bindings: [] } });
        service.database.saveTaskContract(taskId, { version: 1, revision: 1, goal: "Harness task", scope: ["README.md"], acceptanceCriteria: ["done"], verification: ["check"], constraints: [], delivery: { type: "none", repository: "fixture", baseBranch: "main" } });
        blockedProvider = provider;
        // Embedded capacity is fixed at boot; simulate an online eight-slot Runner for this fixture.
        service.runners.register({ ...service.runners.list()[0]!, capacity: 8 });
        const dispatched = await service.app.inject({ method: "POST", url: `/api/tasks/${taskId}/dispatch`, headers: OWNER, payload: { profileId: provider } });
        expect(dispatched.statusCode, dispatched.body).toBe(201);
        expect(dispatched.json().run.providerId).toBe(provider);
        const advanced = await service.app.inject({ method: "POST", url: `/api/runs/${dispatched.json().run.id}/advance`, headers: OWNER });
        expect(advanced.statusCode).toBe(202);
        expect(advanced.json().run.state).toBe("RESOURCE_BLOCKED");
        expect(advanced.json().task.state).toBe("WAITING_RESOURCE");
      }
    } finally { await service.stop(); rmSync(directory, { recursive: true, force: true }); }
  });
});
