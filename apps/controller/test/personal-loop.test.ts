import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CodexBackend, CodexTurnResult } from "@dispatcher/adapters";
import type { DispatcherConfig, SecretMetadata, SecretStore } from "@dispatcher/config";
import type { Run, Task } from "@dispatcher/domain";
import type { JsonValue } from "@dispatcher/persistence";
import { ControllerService } from "../src/service.js";

const OWNER = { authorization: "Bearer test-owner-token" };
const fixtures: Array<{ services: ControllerService[]; directory: string }> = [];
class Secrets implements SecretStore {
  private readonly values = new Map([['secret://linear/token', 'linear-token'], ['secret://linear/webhook', 'linear-signing'], ['secret://slack/bot', 'slack-token'], ['secret://slack/signing', 'slack-signing'], ['secret://github/token', 'github-token']]);
  async put(reference: string, value: string): Promise<SecretMetadata> { this.values.set(reference, value); return this.metadata(reference); }
  async delete(reference: string): Promise<void> { this.values.delete(reference); }
  async test(reference: string): Promise<boolean> { return this.values.has(reference); }
  async metadata(reference: string): Promise<SecretMetadata> { return { reference, backend: "encrypted-local", exists: this.values.has(reference) }; }
  async resolve(reference: string): Promise<string> { const value = this.values.get(reference); if (!value) throw new Error("Missing fixture secret"); return value; }
}
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    for (const service of fixture.services) await service.stop();
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

async function setup(options: { realCodex?: boolean; executable?: string; verificationFails?: boolean; doneOnCiPassed?: boolean } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "dispatcher-personal-loop-"));
  const fixture = { directory, services: [] as ControllerService[] };
  fixtures.push(fixture);
  const root = join(directory, "repository");
  mkdirSync(root);
  execFileSync("git", ["init", "--initial-branch=main", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "fixture@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Fixture"]);
  writeFileSync(join(root, "README.md"), "fixture\n");
  execFileSync("git", ["-C", root, "add", "README.md"]);
  execFileSync("git", ["-C", root, "commit", "-m", "fixture"]);
  const starts: Array<{ providerSessionId?: string; prompt: string }> = [];
  const slack: Array<Record<string, unknown>> = [];
  const linear: Array<Record<string, unknown>> = [];
  const control = { turn: "running" as "running" | "waiting" | "completed" | "failed", ci: "pending" as "pending" | "success" | "failure", slackFailures: 0, ciFailures: 0, prs: 0, pushes: 0, now: new Date(), throwStart: false };
  const backend: CodexBackend = { start: (input) => {
    if (control.throwStart) throw new Error("spawn missing-codex ENOENT");
    starts.push({ prompt: input.prompt, ...(input.providerSessionId ? { providerSessionId: input.providerSessionId } : {}) });
    return { cancel: async () => undefined, status: () => control.turn === "running" ? "running" : "completed", result: async (): Promise<CodexTurnResult> => ({ state: control.turn === "running" ? "completed" : control.turn, summary: control.turn === "waiting" ? "Choose the implementation approach" : control.turn === "failed" ? "agent crashed" : "implemented", providerSessionId: "provider-thread-1", events: control.turn === "waiting" ? [{ type: "waiting", reason: "input_required" }] : [] }) };
  } };
  const secrets = new Secrets();
  const integrationFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
    const respond = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    if (url.includes("linear.invalid")) {
      if (String(body.query).includes("issue(id")) return respond({ data: { issue: { id: "linear-1", identifier: "INH-42", title: "Personal loop", updatedAt: "r1", priority: 2, description: "## Scope\n- implement\n## Acceptance Criteria\n- works\n## Verification\n- check", state: { name: "Todo" }, labels: { nodes: [] }, project: { id: "project-1" } } } });
      linear.push(body);
      return respond({ data: { issueUpdate: { success: true, issue: { id: "linear-1", updatedAt: `r${linear.length + 1}` } }, commentCreate: { success: true } } });
    }
    if (url.includes("slack.invalid")) {
      if (url.endsWith("/auth.test")) return respond({ ok: true, user_id: "BOT" });
      if (control.slackFailures-- > 0) return respond({ ok: false }, 429);
      slack.push(body);
      return respond({ ok: true, ts: `200.${slack.length}` });
    }
    if (url.includes("github.invalid")) {
      if (url.includes("/status") || url.includes("/check-runs")) {
        if (control.ciFailures-- > 0) return respond({}, 503);
        if (url.includes("/check-runs")) return respond({ total_count: 0, check_runs: [] });
        return respond({ state: control.ci, total_count: 1, statuses: [{ context: "test", state: control.ci }], url: "https://github.invalid/checks/1" });
      }
      if (url.includes("/pulls?")) return respond(control.prs ? [{ id: 7, html_url: "https://github.invalid/acme/repo/pull/7", state: "open" }] : []);
      if (url.endsWith("/pulls")) { control.prs += 1; return respond({ id: 7, html_url: "https://github.invalid/acme/repo/pull/7", state: "open" }, 201); }
      return respond({ login: "fixture" });
    }
    throw new Error(`Unexpected fixture URL ${url}`);
  };
  const make = async () => {
    const service = new ControllerService({ ownerToken: "test-owner-token", dataDirectory: join(directory, "data"), withRunner: true, secretStore: secrets, integrationFetch, clock: () => control.now, gitTransport: { ensureBranch: async () => undefined, push: async () => { control.pushes += 1; return { commit: "commit-1" }; } }, ...(options.realCodex ? {} : { codexBackendFactory: () => backend }) });
    fixture.services.push(service);
    await service.start({ listen: false });
    return service;
  };
  const service = await make();
  const config = (await service.app.inject({ headers: OWNER, method: "GET", url: "/api/config" })).json().config as DispatcherConfig;
  config.connectors = [
    { id: "linear", definitionId: "task.linear", kind: "task", displayName: "Linear", enabled: true, credentialRef: "secret://linear/token", settings: { webhookSecretRef: "secret://linear/webhook", repository: "acme/repo", endpoint: "https://linear.invalid/graphql", statusIds: { REVIEW: "in-review", DONE: "done" } } },
    { id: "slack", definitionId: "messaging.slack", kind: "messaging", displayName: "Slack", enabled: true, credentialRef: "secret://slack/bot", settings: { signingSecretRef: "secret://slack/signing", alertChannel: "C-alert", apiBase: "https://slack.invalid/api" } },
    { id: "github", definitionId: "scm.github", kind: "scm", displayName: "GitHub", enabled: true, credentialRef: "secret://github/token", settings: { apiBase: "https://github.invalid", doneOnCiPassed: options.doneOnCiPassed ?? false } },
  ];
  config.agentProfiles = [{ id: "orion", alias: "Orion", provider: "codex", runnerId: "local", settings: { codexHome: join(directory, "profile"), ...(options.executable ? { executable: options.executable } : {}) } }];
  config.repositories = [{ id: "acme/repo", root, defaultBaseRef: "main", scopePaths: [], verificationCommands: [{ id: "check", file: process.execPath, args: ["-e", options.verificationFails ? "process.exit(1)" : "process.exit(0)"], required: true, timeoutMs: 5_000, outputLimitBytes: 1_024 }] }];
  const plan = (await service.app.inject({ headers: OWNER, method: "POST", url: "/api/config/plans", payload: { config } })).json().plan;
  expect((await service.app.inject({ headers: OWNER, method: "POST", url: `/api/config/plans/${plan.id}/apply`, payload: { confirmed: true } })).statusCode).toBe(200);
  service.messagingIdentity.link({ connectorInstanceId: "slack", externalPrincipalId: "U1", principalId: "owner", roles: ["operator"] });
  service.messagingIdentity.link({ connectorInstanceId: "slack", externalPrincipalId: "U-viewer", principalId: "viewer", roles: [] });
  const payload = JSON.stringify({ webhookId: "import-1", type: "Issue", action: "update", createdAt: new Date().toISOString(), data: { id: "linear-1", updatedAt: "r1" } });
  expect((await service.app.inject({ method: "POST", url: "/api/connectors/linear/webhook", headers: { "content-type": "application/json", "linear-signature": createHmac("sha256", "linear-signing").update(payload).digest("hex") }, payload })).statusCode).toBe(202);
  const taskId = service.database.listCanonicalTasks<Task>()[0]!.document.id;
  const send = async (target: ControllerService, eventId: string, text: string, user = "U1", action?: { workflowId: string; expectedRevision: number }, thread = "100.1") => {
    const body = JSON.stringify(action ? { trigger_id: eventId, user: { id: user }, channel: { id: "C1" }, container: { message_ts: "200.1", thread_ts: thread }, actions: [{ action_id: "workflow.approve", value: JSON.stringify(action) }] } : { event_id: eventId, event: { type: "message", ts: eventId === "dispatch" ? thread : "100.2", thread_ts: thread, channel: "C1", user, text } });
    const timestamp = String(Math.floor(Date.now() / 1_000));
    return target.app.inject({ method: "POST", url: "/api/connectors/slack/webhook", headers: { "content-type": "application/json", "x-slack-request-timestamp": timestamp, "x-slack-signature": `v0=${createHmac("sha256", "slack-signing").update(`v0:${timestamp}:${body}`).digest("hex")}` }, payload: body });
  };
  const approve = async (target = service) => {
    const workflow = target.database.listEntities<JsonValue>("semantic-workflow")[0] as unknown as { id: string; revision: number; state: string };
    expect(workflow.state).toBe("NEEDS_APPROVAL");
    await send(target, "approve", "", "U1", { workflowId: workflow.id, expectedRevision: workflow.revision });
    await target.runBackgroundCycle();
    return target.database.listEntities<JsonValue>("run")[0] as unknown as Run;
  };
  return { service, control, starts, slack, linear, taskId, send, approve, make, task: (target = service) => target.database.getCanonicalTask<Task>(taskId)!.document, run: (target = service) => target.database.listEntities<JsonValue>("run")[0] as unknown as Run };
}

describe("personal Slack–Linear loop", () => {
  it("confirms dispatch without an LLM, deduplicates, and resumes in the originating thread", async () => {
    const f = await setup();
    expect((await f.send(f.service, "dispatch", "task dispatch INH-42 Orion")).statusCode).toBe(202);
    await f.service.runBackgroundCycle();
    expect(f.starts).toHaveLength(0);
    expect(f.slack[0]).toMatchObject({ channel: "C1", thread_ts: "100.1", blocks: expect.any(Array) });
    const run = await f.approve();
    expect(run.state).toBe("ACTIVE");
    expect(f.task()).toMatchObject({ state: "RUNNING", currentRunId: run.id });
    expect(f.slack.at(-1)?.text).toContain(run.id);
    expect(f.slack.at(-1)?.text).toContain("Selected local/orion");
    await f.send(f.service, "dispatch", "task dispatch INH-42 Orion");
    await f.service.runBackgroundCycle();
    expect(f.starts).toHaveLength(1);
    f.control.turn = "waiting";
    await f.service.runBackgroundCycle();
    expect(f.run().state).toBe("WAITING_USER");
    expect(f.slack.at(-1)).toMatchObject({ channel: "C1", thread_ts: "100.1", text: expect.stringContaining("Choose the implementation") });
    f.control.turn = "running";
    await f.send(f.service, "resume", "use the simple option");
    await f.service.runBackgroundCycle();
    expect(f.starts[1]).toMatchObject({ providerSessionId: "provider-thread-1", prompt: "use the simple option" });
    expect(f.run()).toMatchObject({ id: run.id, sessionId: run.sessionId, state: "ACTIVE" });
    expect(f.task().state).toBe("RUNNING");
  });

  it("rejects unlinked/viewer users and refuses non-READY tasks before creating a worktree", async () => {
    const f = await setup();
    await f.send(f.service, "unlinked", "task dispatch INH-42", "U-unknown");
    await f.send(f.service, "viewer", "task dispatch INH-42", "U-viewer");
    await f.service.runBackgroundCycle();
    expect(f.starts).toHaveLength(0);
    await f.send(f.service, "dispatch", "task dispatch INH-42");
    await f.service.runBackgroundCycle();
    await f.approve();
    const rejected = await f.service.app.inject({ headers: OWNER, method: "POST", url: `/api/tasks/${f.taskId}/dispatch`, payload: {} });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().message).toContain("RUNNING");
    expect(f.service.database.listEntities("run")).toHaveLength(1);
    expect(f.starts).toHaveLength(1);
  });

  it("recovers an approved dispatch after reply failure and restart without starting another run", async () => {
    const f = await setup();
    await f.send(f.service, "dispatch", "task dispatch INH-42");
    await f.service.runBackgroundCycle();
    f.control.slackFailures = 1;
    const run = await f.approve();
    expect(f.starts).toHaveLength(1);
    await f.service.stop();
    f.control.now = new Date(f.control.now.getTime() + 60_000);
    const restored = await f.make();
    await restored.runBackgroundCycle();
    expect(f.starts).toHaveLength(1);
    expect(f.run(restored).id).toBe(run.id);
    expect(f.slack.at(-1)).toMatchObject({ channel: "C1", thread_ts: "100.1", text: expect.stringContaining(run.id) });
    expect(restored.database.listEntities("run")).toHaveLength(1);
  });

  it("requires operator permission for waiting-user replies and rejects a stale run generation", async () => {
    const f = await setup();
    await f.send(f.service, "dispatch", "task dispatch INH-42");
    await f.service.runBackgroundCycle();
    await f.approve();
    f.control.turn = "waiting";
    await f.service.runBackgroundCycle();
    await f.send(f.service, "viewer-input", "continue", "U-viewer");
    await f.service.runBackgroundCycle();
    expect(f.starts).toHaveLength(1);
    const run = f.run();
    f.service.database.saveEntity("run", run.id, JSON.parse(JSON.stringify({ ...run, generation: run.generation + 1 })) as JsonValue);
    await f.send(f.service, "stale-input", "continue");
    await f.service.runBackgroundCycle();
    expect(f.starts).toHaveLength(1);
    expect(f.service.database.getEntity("messaging-conversation", "slack:C1:100.1")).toMatchObject({ state: "WAITING_USER", revision: 1 });
  });

  it("renews a live embedded run beyond forty minutes and rejects expiry after missed heartbeats", async () => {
    const f = await setup();
    const dispatched = await f.service.app.inject({ headers: OWNER, method: "POST", url: `/api/tasks/${f.taskId}/dispatch`, payload: {} });
    expect(dispatched.statusCode).toBe(201);
    for (let tick = 0; tick < 9; tick += 1) {
      f.control.now = new Date(f.control.now.getTime() + 5 * 60_000);
      await f.service.events.publish("runnerChanged", f.service.runners.heartbeat("local", f.control.now.toISOString()));
      await f.service.runBackgroundCycle();
      expect(Date.parse(f.run().leaseExpiresAt!)).toBeGreaterThan(f.control.now.getTime());
      expect(f.run().state).toBe("ACTIVE");
    }
    f.control.now = new Date(f.control.now.getTime() + 16 * 60_000);
    await f.service.runBackgroundCycle();
    expect(f.run()).toMatchObject({ state: "FAILED", failureReason: expect.stringMatching(/lease expired/i) });
    expect(f.control.prs).toBe(0);
  });

  it("persists synchronous start failure and notifies its dispatch thread without delivery", async () => {
    const f = await setup();
    f.control.throwStart = true;
    await f.send(f.service, "dispatch", "task dispatch INH-42");
    await f.service.runBackgroundCycle();
    await f.approve();
    expect(f.run()).toMatchObject({ state: "FAILED", failureReason: expect.stringContaining("ENOENT") });
    expect(f.task().state).toBe("FAILED");
    expect(f.slack.some((message) => message.channel === "C1" && message.thread_ts === "100.1" && String(message.text).includes("FAILED") && String(message.text).includes("ENOENT"))).toBe(true);
    expect(f.control.prs).toBe(0);
  });

  it("reports a real missing Codex executable as FAILED with a readable Slack cause", async () => {
    const f = await setup({ realCodex: true, executable: "/nonexistent/dispatcher-codex" });
    await f.send(f.service, "dispatch", "task dispatch INH-42");
    await f.service.runBackgroundCycle();
    await f.approve();
    await expect.poll(async () => { await f.service.runBackgroundCycle(); return f.run().state; }).toBe("FAILED");
    expect(f.run()).toMatchObject({ state: "FAILED", failureReason: expect.stringContaining("ENOENT") });
    expect(f.task().state).toBe("FAILED");
    expect(f.slack.some((message) => String(message.text).includes("FAILED") && String(message.text).includes("ENOENT"))).toBe(true);
    expect(f.control.prs).toBe(0);
  });
});
