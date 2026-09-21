import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SecretAccessContext, SecretMetadata, SecretStore } from "@dispatcher/config";
import type { CodexBackend } from "@dispatcher/adapters";
import { ControllerService } from "../src/service.js";
import { LifecycleManager } from "../src/lifecycle.js";

const temporaryDirectories: string[] = [];
function dataDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "dispatcher-controller-"));
  temporaryDirectories.push(directory);
  return directory;
}
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

class FakeSecretStore implements SecretStore {
  values = new Map<string, string>();
  async put(reference: string, value: string): Promise<SecretMetadata> { this.values.set(reference, value); return { reference, backend: "encrypted-local", exists: true }; }
  async delete(reference: string): Promise<void> { this.values.delete(reference); }
  async test(reference: string, context: SecretAccessContext): Promise<boolean> { void context; return this.values.has(reference); }
  async metadata(reference: string): Promise<SecretMetadata> { return { reference, backend: "encrypted-local", exists: this.values.has(reference) }; }
  async resolve(reference: string, context: SecretAccessContext): Promise<string> { void context; const value = this.values.get(reference); if (!value) throw new Error("missing"); return value; }
}

describe("ControllerService", () => {
  it("starts with an Embedded Runner and distinguishes readiness", async () => {
    const service = new ControllerService({ dataDirectory: dataDirectory(), withRunner: true, secretStore: new FakeSecretStore() });
    await service.start({ listen: false });
    const health = await service.app.inject({ method: "GET", url: "/health" });
    const ready = await service.app.inject({ method: "GET", url: "/ready" });
    const runners = await service.app.inject({ method: "GET", url: "/api/runners" });
    expect(health.json()).toMatchObject({ status: "ok", lifecycle: "READY", mode: "embedded" });
    expect(ready.statusCode).toBe(200);
    expect(runners.json().runners[0]).toMatchObject({ id: "local", state: "ONLINE" });
    await service.stop();
  });

  it("restores persisted runner state across restart", async () => {
    const directory = dataDirectory();
    const first = new ControllerService({ dataDirectory: directory, withRunner: true, secretStore: new FakeSecretStore() });
    await first.start({ listen: false });
    await first.stop();
    const second = new ControllerService({ dataDirectory: directory, withRunner: true, secretStore: new FakeSecretStore() });
    await second.start({ listen: false });
    const runners = await second.app.inject({ method: "GET", url: "/api/runners" });
    expect(runners.json().runners[0]).toMatchObject({ id: "local", state: "ONLINE" });
    await second.stop();
  });

  it("creates and applies configuration plans through the API", async () => {
    const service = new ControllerService({ dataDirectory: dataDirectory(), secretStore: new FakeSecretStore() });
    await service.start({ listen: false });
    const current = (await service.app.inject({ method: "GET", url: "/api/config" })).json();
    current.config.controller.id = "api-controller";
    const built = await service.app.inject({ method: "POST", url: "/api/config/plans", payload: { config: current.config } });
    expect(built.statusCode).toBe(201);
    const applied = await service.app.inject({ method: "POST", url: `/api/config/plans/${built.json().plan.id}/apply`, payload: {} });
    expect(applied.statusCode).toBe(200);
    expect(applied.json().config.controller.id).toBe("api-controller");
    await service.stop();
  });

  it("never exposes a secret read endpoint", async () => {
    const secrets = new FakeSecretStore();
    const directory = dataDirectory();
    const service = new ControllerService({ dataDirectory: directory, secretStore: secrets });
    await service.start({ listen: false });
    const saved = await service.app.inject({ method: "PUT", url: "/api/secrets/linear/main", payload: { value: "canary-secret-value" } });
    expect(saved.statusCode).toBe(201);
    expect(saved.body).not.toContain("canary-secret-value");
    expect(saved.json().secret).toMatchObject({
      reference: "secret://linear/main",
      backend: "encrypted-local",
      exists: true,
      lastTestStatus: null,
      lastTestedAt: null,
    });
    const tested = await service.app.inject({ method: "POST", url: "/api/secrets/linear/main/test" });
    expect(tested.json()).toMatchObject({ ok: true, secret: { lastTestStatus: "ok" } });
    expect(tested.body).not.toContain("canary-secret-value");
    const read = await service.app.inject({ method: "GET", url: "/api/secrets/linear/main" });
    expect(read.statusCode).toBe(404);
    expect(JSON.stringify(service.configuration.exportRedacted())).not.toContain("canary-secret-value");
    expect(JSON.stringify(service.database.listAudit())).not.toContain("canary-secret-value");
    await service.stop();
    for (const name of readdirSync(directory).filter((entry) => entry.startsWith("dispatcher.sqlite"))) {
      expect(readFileSync(join(directory, name)).toString("utf8")).not.toContain("canary-secret-value");
    }
  });

  it("blocks activation until every required secret reference exists", async () => {
    const secrets = new FakeSecretStore();
    const service = new ControllerService({ dataDirectory: dataDirectory(), secretStore: secrets });
    await service.start({ listen: false });
    const current = (await service.app.inject({ method: "GET", url: "/api/config" })).json();
    current.config.integrations.linear = { enabled: true, credentialRef: "secret://linear/main" };
    const built = await service.app.inject({ method: "POST", url: "/api/config/plans", payload: { config: current.config } });
    const missing = await service.app.inject({
      method: "POST",
      url: `/api/config/plans/${built.json().plan.id}/apply`,
      payload: { confirmed: true },
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({ code: "SECRET_REFERENCE_MISSING" });
    expect((await service.app.inject({ method: "GET", url: "/api/config" })).json().revision).toBe(current.revision);
    await service.app.inject({ method: "PUT", url: "/api/secrets/linear/main", payload: { value: "canary-secret-value" } });
    const applied = await service.app.inject({
      method: "POST",
      url: `/api/config/plans/${built.json().plan.id}/apply`,
      payload: { confirmed: true },
    });
    expect(applied.statusCode).toBe(200);
    const inUse = await service.app.inject({ method: "DELETE", url: "/api/secrets/linear/main" });
    expect(inUse.statusCode).toBe(409);
    expect(inUse.json()).toMatchObject({ code: "SECRET_IN_USE" });
    await service.app.inject({ method: "POST", url: `/api/config/plans/${built.json().plan.id}/rollback` });
    expect((await service.app.inject({ method: "DELETE", url: "/api/secrets/linear/main" })).statusCode).toBe(204);
    await service.stop();
  });

  it("returns schema validation failures as safe client errors", async () => {
    const service = new ControllerService({ dataDirectory: dataDirectory(), secretStore: new FakeSecretStore() });
    await service.start({ listen: false });
    const current = (await service.app.inject({ method: "GET", url: "/api/config" })).json();
    current.config.integrations.linear = { enabled: true };
    const response = await service.app.inject({ method: "POST", url: "/api/config/plans", payload: { config: current.config } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "INVALID_CONFIGURATION" });
    await service.stop();
  });

  it("manages Internal LLM profiles through ConfigPlan and preserves the active profile on failed switch", async () => {
    const secrets = new FakeSecretStore();
    secrets.values.set("secret://llm/primary", "primary-secret");
    secrets.values.set("secret://llm/backup", "backup-secret");
    let backupFails = false;
    const service = new ControllerService({
      dataDirectory: dataDirectory(),
      secretStore: secrets,
      llmFetch: async (input) => {
        const url = String(input);
        if (url.includes("backup") && backupFails) return new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401 });
        return url.includes("chat/completions")
          ? new Response(JSON.stringify({ choices: [{ message: { content: "backup" } }], usage: {} }), { status: 200 })
          : new Response(JSON.stringify({ output_text: "primary", usage: {} }), { status: 200 });
      },
    });
    await service.start({ listen: false });
    const config = {
      configured: true,
      endpoints: [
        { id: "primary", protocol: "openai-responses", baseUrl: "https://primary.example/v1", credentialRef: "secret://llm/primary" },
        { id: "backup", protocol: "openai-chat", baseUrl: "https://backup.example/v1", credentialRef: "secret://llm/backup" },
      ],
      profiles: [
        { id: "primary", endpointId: "primary", alias: "Primary", model: "a", enabled: true },
        { id: "backup", endpointId: "backup", alias: "Backup", model: "b", enabled: true },
      ],
      pools: [{ id: "default", profileIds: ["primary", "backup"] }],
      roleBindings: [{ role: "command_parser", poolId: "default" }],
      defaultPoolId: "default",
    };
    const applied = await service.app.inject({ method: "PUT", url: "/api/llm/config", payload: { config, confirmed: true } });
    expect(applied.statusCode).toBe(200);
    expect(applied.json().plan).toMatchObject({ risk: "sensitive", state: "PLANNED" });
    await service.app.inject({ method: "POST", url: "/api/llm/roles/command_parser/switch", payload: { profileId: "primary" } });
    backupFails = true;
    const failed = await service.app.inject({ method: "POST", url: "/api/llm/roles/command_parser/switch", payload: { profileId: "backup" } });
    expect(failed.statusCode).toBe(503);
    const view = (await service.app.inject({ method: "GET", url: "/api/llm" })).json();
    expect(view.state.activeProfileByRole.command_parser).toBe("primary");
    expect(JSON.stringify(view)).not.toContain("primary-secret");
    await service.stop();
  });

  it("persists wizard progress without draft secret data", async () => {
    const service = new ControllerService({ dataDirectory: dataDirectory(), secretStore: new FakeSecretStore() });
    await service.start({ listen: false });
    const setup = (await service.app.inject({ method: "GET", url: "/api/setup" })).json();
    const saved = await service.app.inject({ method: "POST", url: "/api/setup", payload: { step: 2, completed: false, configRevision: setup.config.revision } });
    expect(saved.statusCode).toBe(200);
    expect(saved.body).not.toContain("secret");
    expect((await service.app.inject({ method: "GET", url: "/api/setup" })).json().state.step).toBe(2);
    await service.stop();
  });

  it("restores the completed setup step and canonical config after restart", async () => {
    const directory = dataDirectory();
    const first = new ControllerService({ dataDirectory: directory, secretStore: new FakeSecretStore() });
    await first.start({ listen: false });
    const current = (await first.app.inject({ method: "GET", url: "/api/config" })).json();
    current.config.controller.id = "wizard-controller";
    const built = await first.app.inject({ method: "POST", url: "/api/config/plans", payload: { config: current.config, actor: "setup-wizard" } });
    const applied = await first.app.inject({ method: "POST", url: `/api/config/plans/${built.json().plan.id}/apply`, payload: {} });
    await first.app.inject({ method: "POST", url: "/api/setup", payload: { step: 4, completed: true, configRevision: applied.json().revision } });
    await first.stop();

    const second = new ControllerService({ dataDirectory: directory, secretStore: new FakeSecretStore() });
    await second.start({ listen: false });
    const restored = (await second.app.inject({ method: "GET", url: "/api/setup" })).json();
    expect(restored.state).toMatchObject({ step: 4, completed: true, configRevision: applied.json().revision });
    expect(restored.config.config.controller.id).toBe("wizard-controller");
    expect(() => JSON.parse(JSON.stringify(second.configuration.exportRedacted()))).not.toThrow();
    await second.stop();
  });

  it("configures Codex profiles through ConfigPlan without exposing CODEX_HOME or accepting unmanaged workspaces", async () => {
    const backend: CodexBackend = {
      start: (input) => ({
        cancel: async () => undefined,
        status: () => "completed",
        result: async () => ({ state: "completed", summary: "done", providerSessionId: input.providerSessionId ?? "thread-1", events: [] }),
      }),
    };
    const service = new ControllerService({ dataDirectory: dataDirectory(), withRunner: true, secretStore: new FakeSecretStore(), codexBackendFactory: () => backend });
    await service.start({ listen: false });
    const manifests = await service.app.inject({ method: "GET", url: "/api/adapters/manifests" });
    expect(manifests.json().manifests.map((manifest: { id: string }) => manifest.id)).toContain("codex");
    const created = await service.app.inject({ method: "POST", url: "/api/agents/codex/profiles", payload: { id: "orion", alias: "Orion", runnerId: "local", codexHome: "/private/orion" } });
    expect(created.statusCode).toBe(201);
    const profiles = await service.app.inject({ method: "GET", url: "/api/agents/profiles" });
    expect(profiles.json().profiles).toContainEqual(expect.objectContaining({ id: "orion", alias: "Orion", state: "CONFIGURED" }));
    expect(profiles.body).not.toContain("/private/orion");
    const run = await service.app.inject({ method: "POST", url: "/api/agents/profiles/orion/runs", payload: { workspacePath: "/worktree", prompt: "do it" } });
    expect(run.statusCode).toBe(400);
    expect(run.json()).toMatchObject({ code: "UNMANAGED_WORKSPACE" });
    await service.stop();
  });

  it("keeps concurrently running Codex profiles isolated and does not start idle backends", async () => {
    const directory = dataDirectory();
    const repositoryRoot = join(directory, "repository");
    mkdirSync(repositoryRoot, { recursive: true });
    execFileSync("git", ["init", "--initial-branch=main", repositoryRoot]);
    execFileSync("git", ["-C", repositoryRoot, "config", "user.email", "dispatcher@example.invalid"]);
    execFileSync("git", ["-C", repositoryRoot, "config", "user.name", "Dispatcher Test"]);
    writeFileSync(join(repositoryRoot, "README.md"), "fixture\n");
    execFileSync("git", ["-C", repositoryRoot, "add", "README.md"]);
    execFileSync("git", ["-C", repositoryRoot, "commit", "-m", "fixture"]);
    const starts: Array<{ codexHome: string; workspacePath: string }> = [];
    const service = new ControllerService({
      dataDirectory: directory,
      withRunner: true,
      secretStore: new FakeSecretStore(),
      codexBackendFactory: () => ({
        start: (input) => {
          starts.push({ codexHome: input.codexHome, workspacePath: input.workspacePath });
          return {
            cancel: async () => undefined,
            status: () => "completed",
            result: async () => ({ state: "completed", summary: "done", providerSessionId: `thread-${input.codexHome.split("/").at(-1)}`, events: [] }),
          };
        },
      }),
    });
    await service.start({ listen: false });
    const current = (await service.app.inject({ method: "GET", url: "/api/config" })).json();
    current.config.agentProfiles = [
      { id: "atlas", provider: "codex", alias: "Atlas", runnerId: "local", settings: { codexHome: "/profiles/atlas" } },
      { id: "orion", provider: "codex", alias: "Orion", runnerId: "local", settings: { codexHome: "/profiles/orion" } },
    ];
    current.config.repositories = [{ id: "acme/repo", root: repositoryRoot, defaultBaseRef: "main", scopePaths: [], verificationCommands: [] }];
    const plan = await service.app.inject({ method: "POST", url: "/api/config/plans", payload: { config: current.config } });
    expect((await service.app.inject({ method: "POST", url: `/api/config/plans/${plan.json().plan.id}/apply`, payload: { confirmed: true } })).statusCode).toBe(200);
    expect(starts).toEqual([]);

    const [atlasWorkspace, orionWorkspace] = await Promise.all([
      service.workspaces.create({ repositoryId: "acme/repo", taskId: "task-atlas", runId: "run-atlas", attempt: 1, baseRef: "main", scopePaths: [] }),
      service.workspaces.create({ repositoryId: "acme/repo", taskId: "task-orion", runId: "run-orion", attempt: 1, baseRef: "main", scopePaths: [] }),
    ]);
    const [atlas, orion] = await Promise.all([
      service.app.inject({ method: "POST", url: "/api/agents/profiles/atlas/runs", payload: { workspacePath: atlasWorkspace.path, prompt: "atlas work" } }),
      service.app.inject({ method: "POST", url: "/api/agents/profiles/orion/runs", payload: { workspacePath: orionWorkspace.path, prompt: "orion work" } }),
    ]);
    expect([atlas.statusCode, orion.statusCode]).toEqual([201, 201]);
    expect(atlas.json().session).toMatchObject({ profileId: "atlas" });
    expect(orion.json().session).toMatchObject({ profileId: "orion" });
    expect(starts).toEqual(expect.arrayContaining([
      { codexHome: "/profiles/atlas", workspacePath: atlasWorkspace.path },
      { codexHome: "/profiles/orion", workspacePath: orionWorkspace.path },
    ]));
    expect(new Set(starts.map((entry) => entry.codexHome)).size).toBe(2);
    expect(new Set(starts.map((entry) => entry.workspacePath)).size).toBe(2);
    await service.stop();
  });

  it("moves runs through WAITING_USER recovery and required verification failure", async () => {
    const directory = dataDirectory();
    const repositoryRoot = join(directory, "repository");
    mkdirSync(repositoryRoot, { recursive: true });
    execFileSync("git", ["init", "--initial-branch=main", repositoryRoot]);
    execFileSync("git", ["-C", repositoryRoot, "config", "user.email", "dispatcher@example.invalid"]);
    execFileSync("git", ["-C", repositoryRoot, "config", "user.name", "Dispatcher Test"]);
    writeFileSync(join(repositoryRoot, "README.md"), "fixture\n");
    execFileSync("git", ["-C", repositoryRoot, "add", "README.md"]);
    execFileSync("git", ["-C", repositoryRoot, "commit", "-m", "fixture"]);
    const backendInputs: Array<{ prompt: string; providerSessionId?: string }> = [];
    const backend: CodexBackend = {
      start: (input) => {
        backendInputs.push({ prompt: input.prompt, ...(input.providerSessionId ? { providerSessionId: input.providerSessionId } : {}) });
        return {
        cancel: async () => undefined,
        status: () => "completed",
        result: async () => input.prompt === "needs input" && !input.providerSessionId
          ? { state: "waiting", summary: "approval required", providerSessionId: "thread-waiting", events: [{ type: "waiting", reason: "approval_required" }] }
          : { state: "completed", summary: "done", providerSessionId: input.providerSessionId ?? "thread-complete", events: [] },
        };
      },
    };
    const service = new ControllerService({ dataDirectory: directory, withRunner: true, secretStore: new FakeSecretStore(), codexBackendFactory: () => backend });
    await service.start({ listen: false });
    const current = (await service.app.inject({ method: "GET", url: "/api/config" })).json();
    current.config.agentProfiles = [{ id: "atlas", provider: "codex", alias: "Atlas", runnerId: "local", settings: { codexHome: "/profiles/atlas" } }];
    current.config.repositories = [{
      id: "acme/repo",
      root: repositoryRoot,
      defaultBaseRef: "main",
      scopePaths: [],
      verificationCommands: [{ id: "fail", file: process.execPath, args: ["-e", "process.exit(1)"], required: true, timeoutMs: 5_000, outputLimitBytes: 4_096 }],
    }];
    const plan = await service.app.inject({ method: "POST", url: "/api/config/plans", payload: { config: current.config } });
    expect((await service.app.inject({ method: "POST", url: `/api/config/plans/${plan.json().plan.id}/apply`, payload: { confirmed: true } })).statusCode).toBe(200);

    const waitingWorkspace = await service.workspaces.create({ repositoryId: "acme/repo", taskId: "task-waiting", runId: "run-waiting", attempt: 1, baseRef: "main", scopePaths: [] });
    const failingWorkspace = await service.workspaces.create({ repositoryId: "acme/repo", taskId: "task-failing", runId: "run-failing", attempt: 1, baseRef: "main", scopePaths: [] });
    const waitingSession = (await service.app.inject({ method: "POST", url: "/api/agents/profiles/atlas/runs", payload: { workspacePath: waitingWorkspace.path, prompt: "needs input" } })).json().session;
    const failingSession = (await service.app.inject({ method: "POST", url: "/api/agents/profiles/atlas/runs", payload: { workspacePath: failingWorkspace.path, prompt: "complete" } })).json().session;
    expect(backendInputs).toEqual([{ prompt: "needs input" }, { prompt: "complete" }]);
    expect((await service.app.inject({ method: "GET", url: `/api/agents/profiles/atlas/sessions/${waitingSession.id}` })).json().session).toMatchObject({ state: "PAUSED" });
    for (const fixture of [
      { taskId: "task-waiting", runId: "run-waiting", sessionId: waitingSession.id as string, workspace: waitingWorkspace, verification: [] },
      { taskId: "task-failing", runId: "run-failing", sessionId: failingSession.id as string, workspace: failingWorkspace, verification: ["fail"] },
    ]) {
      service.database.writeCanonicalTask(fixture.taskId, 0, {
        id: fixture.taskId, projectId: "project", title: fixture.taskId, state: "RUNNING",
        createdAt: "2026-09-22T00:00:00.000Z", updatedAt: "2026-09-22T00:00:00.000Z",
      });
      service.database.saveTaskContract(fixture.taskId, {
        version: 1, revision: 1, goal: "Work", scope: ["README.md"], acceptanceCriteria: ["done"],
        verification: fixture.verification, constraints: [], delivery: { type: "pull-request", repository: "acme/repo" },
      });
      service.database.saveEntity("run", fixture.runId, {
        id: fixture.runId, taskId: fixture.taskId, runnerId: "local", providerId: "codex", profileId: "atlas",
        sessionId: fixture.sessionId, state: "ACTIVE", attempt: 1, generation: 1, leaseId: "lease", taskRevision: 1,
        contractRevision: 1, worktree: fixture.workspace.path, branch: fixture.workspace.branch,
        startedAt: "2026-09-22T00:00:00.000Z", lastActivityAt: "2026-09-22T00:00:00.000Z",
        verification: { state: "PENDING", commands: fixture.verification },
      });
    }

    const waiting = await service.app.inject({ method: "POST", url: "/api/runs/run-waiting/advance" });
    expect(waiting.json()).toMatchObject({ run: { state: "WAITING_USER" }, task: { state: "WAITING_USER" } });
    expect(waiting.statusCode).toBe(202);
    expect((await service.app.inject({
      method: "POST",
      url: `/api/agents/profiles/atlas/sessions/${waitingSession.id}/input`,
      payload: { message: "approved" },
    })).statusCode).toBe(200);
    expect(service.database.getEntity("run", "run-waiting")).toMatchObject({ state: "ACTIVE", sessionId: waitingSession.id });
    expect(service.database.getCanonicalTask("task-waiting")?.document).toMatchObject({ state: "RUNNING" });

    const failed = await service.app.inject({ method: "POST", url: "/api/runs/run-failing/advance" });
    expect(failed.statusCode).toBe(200);
    expect(failed.json()).toMatchObject({
      run: { state: "FAILED", failureReason: "Required verification failed", verification: { state: "FAILED", commands: ["fail"] } },
      task: { state: "FAILED" },
    });
    await service.stop();
  });

  it("persists Codex quota signals and blocks the run, task, and future routing", async () => {
    const directory = dataDirectory();
    const repositoryRoot = join(directory, "repository");
    mkdirSync(repositoryRoot, { recursive: true });
    execFileSync("git", ["init", "--initial-branch=main", repositoryRoot]);
    execFileSync("git", ["-C", repositoryRoot, "config", "user.email", "dispatcher@example.invalid"]);
    execFileSync("git", ["-C", repositoryRoot, "config", "user.name", "Dispatcher Test"]);
    writeFileSync(join(repositoryRoot, "README.md"), "fixture\n");
    execFileSync("git", ["-C", repositoryRoot, "add", "README.md"]);
    execFileSync("git", ["-C", repositoryRoot, "commit", "-m", "fixture"]);
    const backend: CodexBackend = {
      start: () => ({
        cancel: async () => undefined,
        status: () => "completed",
        result: async () => ({
          state: "failed",
          summary: "quota",
          providerSessionId: "thread-quota",
          events: [{ type: "resource", state: "QUOTA_EXHAUSTED", reason: "quota exhausted", source: "event", confidence: "high" }],
        }),
      }),
    };
    const service = new ControllerService({ dataDirectory: directory, withRunner: true, secretStore: new FakeSecretStore(), codexBackendFactory: () => backend });
    await service.start({ listen: false });
    const current = (await service.app.inject({ method: "GET", url: "/api/config" })).json();
    current.config.agentProfiles = [{ id: "atlas", provider: "codex", alias: "Atlas", runnerId: "local", settings: { codexHome: "/profiles/atlas" } }];
    current.config.repositories = [{ id: "acme/repo", root: repositoryRoot, defaultBaseRef: "main", scopePaths: [], verificationCommands: [] }];
    const plan = await service.app.inject({ method: "POST", url: "/api/config/plans", payload: { config: current.config } });
    expect((await service.app.inject({ method: "POST", url: `/api/config/plans/${plan.json().plan.id}/apply`, payload: { confirmed: true } })).statusCode).toBe(200);
    const workspace = await service.workspaces.create({ repositoryId: "acme/repo", taskId: "task-quota", runId: "run-quota", attempt: 1, baseRef: "main", scopePaths: [] });
    const started = await service.app.inject({ method: "POST", url: "/api/agents/profiles/atlas/runs", payload: { workspacePath: workspace.path, prompt: "work" } });
    const sessionId = started.json().session.id as string;
    service.database.writeCanonicalTask("task-quota", 0, {
      id: "task-quota", projectId: "project", title: "Quota task", state: "RUNNING",
      createdAt: "2026-09-22T00:00:00.000Z", updatedAt: "2026-09-22T00:00:00.000Z",
    });
    service.database.saveTaskContract("task-quota", {
      version: 1, revision: 1, goal: "Work", scope: ["README.md"], acceptanceCriteria: ["done"],
      verification: ["check"], constraints: [], delivery: { type: "pull-request", repository: "acme/repo" },
    });
    service.database.saveEntity("run", "run-quota", {
      id: "run-quota", taskId: "task-quota", runnerId: "local", providerId: "codex", profileId: "atlas",
      sessionId, state: "ACTIVE", attempt: 1, generation: 1, leaseId: "lease", taskRevision: 1,
      contractRevision: 1, worktree: workspace.path, branch: workspace.branch,
      startedAt: "2026-09-22T00:00:00.000Z", lastActivityAt: "2026-09-22T00:00:00.000Z",
      verification: { state: "PENDING", commands: ["check"] },
    });

    const advanced = await service.app.inject({ method: "POST", url: "/api/runs/run-quota/advance" });
    expect(advanced.statusCode).toBe(202);
    expect(advanced.json()).toMatchObject({ run: { state: "RESOURCE_BLOCKED", resourceBlockReason: "quota exhausted" }, task: { state: "WAITING_RESOURCE" } });
    const profiles = await service.app.inject({ method: "GET", url: "/api/agents/profiles" });
    expect(profiles.json().profiles).toContainEqual(expect.objectContaining({ id: "atlas", resourceState: "QUOTA_EXHAUSTED" }));
    await service.stop();
  });
});

describe("LifecycleManager", () => {
  it("rolls back already-started modules when startup fails", async () => {
    const stopped = vi.fn();
    const lifecycle = new LifecycleManager([
      { name: "first", start: vi.fn(), stop: stopped },
      { name: "broken", start: () => { throw new Error("broken"); }, stop: vi.fn() },
    ]);
    await expect(lifecycle.start()).rejects.toThrow("broken");
    expect(stopped).toHaveBeenCalledOnce();
    expect(lifecycle.state).toBe("FAILED");
  });
});
