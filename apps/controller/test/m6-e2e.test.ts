import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CodexBackend } from "@dispatcher/adapters";
import type { SecretMetadata, SecretStore } from "@dispatcher/config";
import type { GitTransport } from "@dispatcher/integrations";
import { ControllerService } from "../src/service.js";

const directories: string[] = [];

class MemorySecrets implements SecretStore {
  values = new Map<string, string>();
  async put(reference: string, value: string): Promise<SecretMetadata> { this.values.set(reference, value); return { reference, backend: "encrypted-local", exists: true }; }
  async delete(reference: string): Promise<void> { this.values.delete(reference); }
  async test(reference: string): Promise<boolean> { return this.values.has(reference); }
  async metadata(reference: string): Promise<SecretMetadata> { return { reference, backend: "encrypted-local", exists: this.values.has(reference) }; }
  async resolve(reference: string): Promise<string> { const value = this.values.get(reference); if (!value) throw new Error("missing secret"); return value; }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("M6 vertical gate", () => {
  it("converges Linear to Codex to GitHub to Linear across restart, duplicates, and transient outages", async () => {
    const directory = mkdtempSync(join(tmpdir(), "dispatcher-m6-"));
    directories.push(directory);
    const dataDirectory = join(directory, "data");
    const repositoryRoot = join(directory, "repository");
    mkdirSync(repositoryRoot, { recursive: true });
    execFileSync("git", ["init", "--initial-branch=main", repositoryRoot]);
    execFileSync("git", ["-C", repositoryRoot, "config", "user.email", "dispatcher@example.invalid"]);
    execFileSync("git", ["-C", repositoryRoot, "config", "user.name", "Dispatcher Test"]);
    writeFileSync(join(repositoryRoot, "README.md"), "fixture\n");
    execFileSync("git", ["-C", repositoryRoot, "add", "README.md"]);
    execFileSync("git", ["-C", repositoryRoot, "commit", "-m", "fixture"]);
    const secrets = new MemorySecrets();
    secrets.values.set("secret://linear/token", "linear-token");
    secrets.values.set("secret://linear/webhook", "webhook-secret");
    secrets.values.set("secret://github/token", "github-token");
    let linearFails = false;
    let githubFails = true;
    let linearWrites = 0;
    const integrationFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as { query?: string } : {};
      if (url.includes("linear")) {
        if (body.query?.includes("issue(id")) return new Response(JSON.stringify({ data: { issue: {
          id: "linear-1", identifier: "INH-1", title: "Deliver M6", updatedAt: "r1", priority: 2,
          description: "## Scope\n- implement\n## Acceptance Criteria\n- closes\n## Verification\n- check\n## Constraints\n- safe",
          state: { name: "Ready" }, labels: { nodes: [] }, project: { id: "project-1", name: "Project" },
        } } }), { status: 200 });
        if (body.query?.includes("issueUpdate")) {
          if (linearFails) return new Response("offline", { status: 503 });
          linearWrites += 1;
          return new Response(JSON.stringify({ data: { issueUpdate: { success: true, issue: { id: "linear-1", updatedAt: `r${linearWrites + 1}` } } } }), { status: 200 });
        }
        return new Response(JSON.stringify({ data: { viewer: { id: "me" }, issues: { pageInfo: {}, nodes: [] } } }), { status: 200 });
      }
      if (url.includes("github")) {
        if (githubFails) return new Response("offline", { status: 503 });
        if (url.includes("/pulls?") && init?.method !== "POST") return new Response(JSON.stringify([]), { status: 200 });
        if (url.endsWith("/pulls") && init?.method === "POST") return new Response(JSON.stringify({ id: 7, html_url: "https://github.invalid/acme/repo/pull/7", state: "open" }), { status: 201 });
        if (url.includes("/status")) return new Response(JSON.stringify({ state: "success", url: "https://github.invalid/checks/1" }), { status: 200 });
        return new Response(JSON.stringify({ login: "tester" }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    };
    const backend: CodexBackend = {
      start: (input) => ({ cancel: async () => undefined, status: () => "completed", result: async () => ({ state: "completed", summary: "implemented", providerSessionId: input.providerSessionId ?? "thread-1", events: [] }) }),
    };
    const transport: GitTransport = {
      ensureBranch: async () => undefined,
      push: async () => ({ commit: "commit-1" }),
    };

    const first = new ControllerService({ dataDirectory, withRunner: true, secretStore: secrets, integrationFetch, gitTransport: transport, codexBackendFactory: () => backend });
    await first.start({ listen: false });
    const current = (await first.app.inject({ method: "GET", url: "/api/config" })).json();
    current.config.connectors = [
      { id: "linear-main", definitionId: "task.linear", kind: "task", displayName: "Linear", enabled: true, credentialRef: "secret://linear/token", settings: { webhookSecretRef: "secret://linear/webhook", repository: "acme/repo", endpoint: "https://linear.invalid/graphql" } },
      { id: "github-main", definitionId: "scm.github", kind: "scm", displayName: "GitHub", enabled: true, credentialRef: "secret://github/token", settings: { apiBase: "https://github.invalid" } },
    ];
    current.config.agentProfiles = [{ id: "orion", provider: "codex", alias: "Orion", runnerId: "local", settings: { codexHome: "/profiles/orion" } }];
    current.config.repositories = [{
      id: "acme/repo", root: repositoryRoot, defaultBaseRef: "main", scopePaths: [],
      verificationCommands: [{ id: "check", file: process.execPath, args: ["-e", "process.exit(0)"], required: true, timeoutMs: 5_000, outputLimitBytes: 4_096 }],
    }];
    const plan = await first.app.inject({ method: "POST", url: "/api/config/plans", payload: { config: current.config } });
    expect((await first.app.inject({ method: "POST", url: `/api/config/plans/${plan.json().plan.id}/apply`, payload: { confirmed: true } })).statusCode).toBe(200);

    const createdAt = new Date().toISOString();
    const webhookBody = JSON.stringify({ webhookId: "webhook-1", type: "Issue", action: "update", createdAt, data: { id: "linear-1", title: "Deliver M6", updatedAt: "r1" } });
    const signature = createHmac("sha256", "webhook-secret").update(webhookBody).digest("hex");
    const ingress = await first.app.inject({ method: "POST", url: "/api/connectors/linear-main/webhook", headers: { "linear-signature": signature, "content-type": "application/json" }, payload: webhookBody });
    expect(ingress.statusCode).toBe(202);
    const taskList = (await first.app.inject({ method: "GET", url: "/api/tasks" })).json();
    expect(taskList.tasks).toHaveLength(1);
    expect(taskList.tasks[0].document).toMatchObject({ title: "Deliver M6", state: "READY" });
    const initialTaskId = taskList.tasks[0].document.id as string;
    first.tasks.execute({ id: "local-before-outage", taskId: initialTaskId, baseRevision: taskList.tasks[0].revision, actor: "gate", command: { type: "task.update", changes: { title: "Deliver M6 safely" } } });
    linearFails = true;
    expect(await first.projections.drain(new Date(Date.now() + 60_000))).toMatchObject({ retried: 1 });
    await first.stop();

    const second = new ControllerService({ dataDirectory, withRunner: true, secretStore: secrets, integrationFetch, gitTransport: transport, codexBackendFactory: () => backend });
    await second.start({ listen: false });
    const duplicate = await second.app.inject({ method: "POST", url: "/api/connectors/linear-main/webhook", headers: { "linear-signature": signature, "content-type": "application/json" }, payload: webhookBody });
    expect(duplicate.statusCode).toBe(202);
    expect(duplicate.json().duplicate).toBe(true);
    linearFails = false;
    expect(await second.projections.drain(new Date(Date.now() + 24 * 60 * 60_000))).toMatchObject({ delivered: 1 });

    const taskId = (await second.app.inject({ method: "GET", url: "/api/tasks" })).json().tasks[0].document.id as string;
    const dispatched = await second.app.inject({ method: "POST", url: `/api/tasks/${taskId}/dispatch`, payload: { profileId: "orion" } });
    expect(dispatched.statusCode).toBe(201);
    const runId = dispatched.json().run.id as string;
    expect((await second.app.inject({ method: "POST", url: `/api/runs/${runId}/advance` })).statusCode).toBe(503);
    expect((await second.app.inject({ method: "GET", url: `/api/runs/${runId}` })).json().run).toMatchObject({ state: "DELIVERING", verification: { state: "PASSED" } });
    githubFails = false;
    const advanced = await second.app.inject({ method: "POST", url: `/api/runs/${runId}/advance` });
    expect(advanced.statusCode).toBe(200);
    expect(advanced.json()).toMatchObject({ run: { state: "COMPLETE", prUrl: "https://github.invalid/acme/repo/pull/7" }, task: { state: "REVIEW" } });
    expect(advanced.json().deliveries.map((item: { kind: string }) => item.kind)).toEqual(["commit", "pull-request", "ci"]);
    expect((await second.app.inject({ method: "POST", url: `/api/runs/${runId}/advance` })).json().run.state).toBe("COMPLETE");

    const review = second.database.getCanonicalTask(taskId)!;
    second.tasks.execute({ id: "done", taskId, baseRevision: review.revision, actor: "gate", command: { type: "task.transition", state: "DONE" } });
    await second.projections.drain(new Date(Date.now() + 48 * 60 * 60_000));
    expect(second.database.getCanonicalTask(taskId)?.document).toMatchObject({ state: "DONE" });
    expect(second.database.listDeliveryEvidence(taskId)).toHaveLength(3);
    expect(linearWrites).toBeGreaterThan(0);
    await second.stop();
  }, 15_000);
});
