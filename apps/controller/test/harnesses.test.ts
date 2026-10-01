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
  it("registers ConfigPlan profiles, probes, sessions and exact same-session input for all three harnesses", async () => {
    const directory = mkdtempSync(join(tmpdir(), "dispatcher-harnesses-"));
    const executable = join(directory, "harness");
    const repository = join(directory, "repo");
    execFileSync("git", ["init", "--initial-branch=main", repository]);
    execFileSync("git", ["-C", repository, "config", "user.email", "fixture@example.invalid"]);
    execFileSync("git", ["-C", repository, "config", "user.name", "Fixture"]);
    writeFileSync(join(repository, "README.md"), "fixture\n");
    execFileSync("git", ["-C", repository, "add", "README.md"]);
    execFileSync("git", ["-C", repository, "commit", "-m", "fixture"]);
    writeFileSync(executable, `#!${process.execPath}\nif(process.argv.includes('--help')) console.log('--standalone --format json --session --session-id --resume --mode streaming-messages-json'); else console.log('2.0.21');`);
    chmodSync(executable, 0o700);
    const calls = vi.fn((provider: string) => {
      const result: CliTurnResult = { state: "completed", summary: "done", events: [], providerSessionId: `${provider}-exact-session` };
      const backend: CliAgentBackend = { start: vi.fn(() => ({ status: () => "completed", result: async () => result, cancel: async () => undefined })) };
      return backend;
    });
    const service = new ControllerService({ dataDirectory: directory, ownerToken: "test-owner", withRunner: true, secretStore: secrets, cliBackendFactory: calls });
    try {
      await service.start({ listen: false });
      const current = (await service.app.inject({ method: "GET", url: "/api/config", headers: OWNER })).json().config;
      current.repositories = [{ id: "fixture", root: repository, defaultBaseRef: "main", scopePaths: [], verificationCommands: [] }];
      const plan = (await service.app.inject({ method: "POST", url: "/api/config/plans", headers: OWNER, payload: { config: current } })).json().plan;
      expect((await service.app.inject({ method: "POST", url: `/api/config/plans/${plan.id}/apply`, headers: OWNER, payload: { confirmed: true } })).statusCode).toBe(200);
      const workspace = await service.workspaces.create({ repositoryId: "fixture", taskId: "harness", runId: "test", attempt: 1, baseRef: "main", scopePaths: [] });
      const manifests = (await service.app.inject({ method: "GET", url: "/api/adapters/manifests", headers: OWNER })).json().manifests;
      expect(manifests.map((value: { id: string }) => value.id)).toEqual(expect.arrayContaining(["opencode", "grok", "pi"]));
      for (const provider of ["opencode", "grok", "pi"]) {
        const discovery = await service.app.inject({ method: "POST", url: `/api/agents/${provider}/discover`, headers: OWNER, payload: { id: provider, alias: provider, executable } });
        expect(discovery.statusCode).toBe(200);
        expect(discovery.json()).toMatchObject({ installed: true, compatible: true, authenticated: false, authentication: "unknown" });
        const saved = await service.app.inject({ method: "POST", url: `/api/agents/${provider}/profiles`, headers: OWNER, payload: { id: provider, alias: provider, executable } });
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
      expect(calls.mock.calls.map(([provider]) => provider)).toEqual(expect.arrayContaining(["opencode", "grok", "pi"]));
      const views = (await service.app.inject({ method: "GET", url: "/api/agents/profiles", headers: OWNER })).body;
      expect(views).not.toContain(executable);
      const matrix = (await service.app.inject({ method: "GET", url: "/api/adapters/compatibility", headers: OWNER })).json().matrix;
      expect(matrix.find((row: { adapterId: string }) => row.adapterId === "opencode")).toMatchObject({ session: { resume: true, pause: false }, resource: true });
    } finally { await service.stop(); rmSync(directory, { recursive: true, force: true }); }
  });
});
