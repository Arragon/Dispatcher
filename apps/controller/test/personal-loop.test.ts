import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdapterContractError, type AgentAdapter, type CodexBackend, type CodexTurnResult } from "@dispatcher/adapters";
import type { DispatcherConfig, SecretMetadata, SecretStore } from "@dispatcher/config";
import type { Run, Task, TaskContract } from "@dispatcher/domain";
import { DispatcherDatabase,InteractionStore,type JsonValue } from "@dispatcher/persistence";
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

async function setup(options: { realCodex?: boolean; executable?: string; verificationFails?: boolean; doneOnCiPassed?: boolean; secondProfile?: boolean; model?:string } = {}) {
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
  const starts: Array<{ providerSessionId?: string; prompt: string; model?:string }> = [];
  const slack: Array<Record<string, unknown>> = [];
  const linear: Array<Record<string, unknown>> = [];
  const control = { turn: "running" as "running" | "waiting" | "completed" | "failed", ci: "pending" as "pending" | "success" | "failure", slackFailures: 0, ciFailures: 0, prs: 0, pushes: 0, cancellations: 0, now: new Date(), throwStart: false, prState: "open" as "open" | "closed", merged: false, headCommit: "commit-1", pushGate: undefined as Promise<void> | undefined, onStart: undefined as (() => void) | undefined };
  const backend: CodexBackend = { start: (input) => {
    if (control.throwStart) throw Object.assign(new Error("spawn missing-codex ENOENT"),{code:"ENOENT"});
    starts.push({ prompt: input.prompt, ...(input.model?{model:input.model}:{}), ...(input.providerSessionId ? { providerSessionId: input.providerSessionId } : {}) });
    control.onStart?.();
    return { cancel: async () => { control.cancellations += 1; }, status: () => control.turn === "running" ? "running" : "completed", result: async (): Promise<CodexTurnResult> => ({ state: control.turn === "running" ? "completed" : control.turn, summary: control.turn === "waiting" ? "Choose the implementation approach" : control.turn === "failed" ? "agent crashed" : "implemented", providerSessionId: "provider-thread-1", events: control.turn === "waiting" ? [{ type: "waiting", reason: "input_required" }] : [] }) };
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
      if (url.endsWith("/pulls")) { control.prs += 1; return respond({ id: 7, number: 7, html_url: "https://github.invalid/acme/repo/pull/7", state: "open", head: { sha: control.headCommit } }, 201); }
      if (url.endsWith("/pulls/7")) return respond({ id: 7, number: 7, html_url: "https://github.invalid/acme/repo/pull/7", state: control.prState, merged_at: control.merged ? new Date().toISOString() : null, head: { sha: control.headCommit } });
      return respond({ login: "fixture" });
    }
    throw new Error(`Unexpected fixture URL ${url}`);
  };
  const make = async () => {
    const service = new ControllerService({ ownerToken: "test-owner-token", dataDirectory: join(directory, "data"), withRunner: true, secretStore: secrets, integrationFetch, clock: () => control.now, gitTransport: { ensureBranch: async () => undefined, push: async () => { control.pushes += 1; await control.pushGate; return { commit: "commit-1" }; } }, ...(options.realCodex ? {} : { codexBackendFactory: () => backend }) });
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
  config.agentProfiles = [{ id: "orion", alias: "Orion", provider: "codex", runnerId: "local", settings: { codexHome: join(directory, "profile"), ...(options.model?{model:options.model}:{}), ...(options.executable ? { executable: options.executable } : {}) } }];
  if (options.secondProfile) config.agentProfiles.push({ id: "vega", alias: "Vega", provider: "codex", runnerId: "local", settings: { codexHome: join(directory, "vega-profile") } });
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
  it.each(["http","slack"] as const)("freezes a %s legacy dispatch choice on the Run and actual native invocation",async channel=>{
    const f=await setup({model:"legacy-configured-model"});
    if(channel==="http")expect((await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${f.taskId}/dispatch`,payload:{profileId:"orion"}})).statusCode).toBe(201);
    else{await f.send(f.service,"dispatch","task dispatch INH-42");await f.service.runBackgroundCycle();await f.approve();}
    const run=f.run();
    expect(run.executionSelection).toMatchObject({version:1,mode:"legacy",source:"legacy-config",profileId:"orion",runnerId:"local",providerId:"codex",backendId:"codex-exec-json",selectionType:"explicit-model",requestedModel:"legacy-configured-model",nativeParameters:{}});
    expect(run.executionSelection?.catalogRevision).toBeUndefined();
    expect(f.starts).toHaveLength(1);expect(f.starts[0]?.model).toBe("legacy-configured-model");
    expect(f.service.database.getEntity("adapter-session",run.sessionId)).toMatchObject({executionSelection:run.executionSelection});
    const contract=f.service.database.getEntity<JsonValue>("run-contract",run.id) as unknown as TaskContract;
    expect(contract.workspace).toMatchObject({repositoryId:"acme/repo",baseCommit:expect.stringMatching(/^[0-9a-f]{40}$/)});
  });

  async function waitingFixture() {
    const f = await setup();
    await f.send(f.service, "dispatch", "task dispatch INH-42");
    await f.service.runBackgroundCycle();
    await f.approve();
    f.control.turn = "waiting";
    await f.service.runBackgroundCycle();
    return f;
  }

  const resumeContext = { principal: { id: "owner", roles: ["operator"], channel: "api" as const }, workflowId: "reviewed-resume", confirmed: true };

  function controlled(f:Awaited<ReturnType<typeof setup>>){
    const run=f.run(),store=new InteractionStore(f.service.database);
    f.service.database.saveEntity("session",run.sessionId,{id:run.sessionId,profileId:run.profileId,providerId:run.providerId,resumable:true,createdAt:run.startedAt!,updatedAt:run.startedAt!});
    store.initializeControl({sessionId:run.sessionId,activeRunId:run.id,exclusion:"none",at:run.startedAt!});
    return ()=>store.compareAndSwapControl({sessionId:run.sessionId,expectedRevision:1,expectedEpoch:1,actorId:"owner",event:{type:"conflict",at:f.control.now.toISOString()}});
  }
  function humanOwned(f:Awaited<ReturnType<typeof setup>>){
    controlled(f);const store=new InteractionStore(f.service.database),run=f.run(),current=store.control(run.sessionId)!;
    // Persisted-owner fixture only; this is not evidence of a native handoff.
    f.service.database.handle.prepare("UPDATE session_controls SET state='HUMAN',epoch=2,revision=2,document_json=? WHERE session_id=?").run(JSON.stringify({...current,state:"HUMAN",epoch:2,revision:2}),run.sessionId);
  }
  it("waits for owned stop before marking a lease-expired Run failed",async()=>{
    const f=await setup();await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${f.taskId}/dispatch`,payload:{}});
    const adapter=(f.service as unknown as {agentAdapters:Map<string,AgentAdapter>}).agentAdapters.get("orion")!,cancel=adapter.cancel.bind(adapter),entered=Promise.withResolvers<void>(),ready=Promise.withResolvers<void>();
    vi.spyOn(adapter,"cancel").mockImplementation(async(...args)=>{entered.resolve();await ready.promise;return cancel(...args);});f.control.now=new Date(f.control.now.getTime()+16*60_000);
    const cycle=f.service.runBackgroundCycle();
    try{await entered.promise;expect(f.run().state).not.toBe("FAILED");expect(f.task().state).not.toBe("FAILED");ready.resolve();await cycle;expect(f.run().state).toBe("FAILED");expect(f.control.cancellations).toBe(1);}finally{ready.resolve();await cycle;}
  });
  it("keeps unconfirmed failure cleanup unavailable and never blindly repeats the stop",async()=>{
    const f=await setup();await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${f.taskId}/dispatch`,payload:{}});
    const adapter=(f.service as unknown as {agentAdapters:Map<string,AgentAdapter>}).agentAdapters.get("orion")!,cancel=vi.spyOn(adapter,"cancel").mockRejectedValue(Error("owned stop outcome unavailable"));f.control.now=new Date(f.control.now.getTime()+16*60_000);
    await f.service.runBackgroundCycle();expect(f.run()).toMatchObject({state:"RUNNER_UNAVAILABLE",recoveryReason:"NATIVE_OUTCOME_UNKNOWN"});expect(f.task().state).not.toBe("FAILED");
    f.control.now=new Date(f.control.now.getTime()+60_000);await f.service.runBackgroundCycle();expect(cancel).toHaveBeenCalledTimes(1);expect(f.service.database.getEntity("adapter-session",f.run().sessionId)).toMatchObject({authority:{stopState:"unconfirmed"}});
  });
  it.each(["failure","cancel"] as const)("does not stop a persisted HUMAN owner through %s cleanup",async action=>{
    const f=await setup();await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${f.taskId}/dispatch`,payload:{}});humanOwned(f);
    if(action==="failure"){f.control.now=new Date(f.control.now.getTime()+16*60_000);await f.service.runBackgroundCycle();}
    else await expect(f.service.semanticTools.execute("run.cancel",{target:f.run().id},{...resumeContext,workflowId:"human-owner-cancel"})).rejects.toMatchObject({code:"HUMAN_CANCEL_CONFIRMATION_REQUIRED"});
    expect(f.run().state).toBe("ACTIVE");expect(f.task().state).toBe("RUNNING");expect(f.control.cancellations).toBe(0);
  });
  it("rejects pause of a persisted HUMAN owner before invoking the adapter",async()=>{
    const f=await setup();await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${f.taskId}/dispatch`,payload:{}});humanOwned(f);
    const adapter=(f.service as unknown as {agentAdapters:Map<string,AgentAdapter>}).agentAdapters.get("orion")!,pause=vi.spyOn(adapter,"pause");
    await expect(f.service.semanticTools.execute("run.pause",{target:f.run().id},{...resumeContext,workflowId:"human-pause"})).rejects.toMatchObject({code:"NATIVE_WRITE_LOCKED"});expect(pause).not.toHaveBeenCalled();expect(f.run().state).toBe("ACTIVE");
  });
  it.each(["cancel","failure"] as const)("rechecks control at the final %s stop after an adapter await",async action=>{
    const f=await setup();await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${f.taskId}/dispatch`,payload:{}});const lock=controlled(f),adapter=(f.service as unknown as {agentAdapters:Map<string,AgentAdapter>}).agentAdapters.get("orion")!,cancel=adapter.cancel.bind(adapter),entered=Promise.withResolvers<void>(),ready=Promise.withResolvers<void>();
    vi.spyOn(adapter,"cancel").mockImplementation(async(...args)=>{entered.resolve();await ready.promise;return cancel(...args);});
    if(action==="failure")f.control.now=new Date(f.control.now.getTime()+16*60_000);
    const pending=action==="failure"?f.service.runBackgroundCycle().then(value=>({value}),error=>({error})):f.service.semanticTools.execute("run.cancel",{target:f.run().id},{...resumeContext,workflowId:"late-cancel"}).then(value=>({value}),error=>({error}));
    try{await entered.promise;lock();ready.resolve();await pending;expect(f.control.cancellations).toBe(0);expect(f.run().state).toBe("RUNNER_UNAVAILABLE");expect(f.task().state).not.toBe("CANCELLED");}finally{ready.resolve();await pending;}
  });
  it("rechecks Task revision at final pause and never overwrites a concurrent edit",async()=>{
    const f=await setup();await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${f.taskId}/dispatch`,payload:{}});const adapter=(f.service as unknown as {agentAdapters:Map<string,AgentAdapter>}).agentAdapters.get("orion")!,entered=Promise.withResolvers<void>(),ready=Promise.withResolvers<void>();let writes=0;
    vi.spyOn(adapter,"pause").mockImplementation(async(id,beforeSend)=>{entered.resolve();await ready.promise;beforeSend?.();writes++;return {...(await adapter.status(id)),state:"PAUSED"};});
    const pending=f.service.semanticTools.execute("run.pause",{target:f.run().id},{...resumeContext,workflowId:"late-pause"}).then(value=>({value}),error=>({error}));
    try{await entered.promise;const task=f.service.database.getCanonicalTask<JsonValue>(f.taskId)!;f.service.database.writeCanonicalTask(f.taskId,task.revision,task.document);ready.resolve();expect(await pending).toHaveProperty("error");expect(writes).toBe(0);expect(f.task().state).toBe("RUNNING");expect(f.run().state).toBe("ACTIVE");}finally{ready.resolve();await pending;}
  });
  it("keeps an opaque cancellation acknowledgement unconfirmed when the final callback was skipped",async()=>{
    const f=await setup();await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${f.taskId}/dispatch`,payload:{}});const adapter=(f.service as unknown as {agentAdapters:Map<string,AgentAdapter>}).agentAdapters.get("orion")!,cancel=adapter.cancel.bind(adapter);
    vi.spyOn(adapter,"cancel").mockImplementation(id=>cancel(id));
    await expect(f.service.semanticTools.execute("run.cancel",{target:f.run().id},{...resumeContext,workflowId:"opaque-stop"})).rejects.toMatchObject({code:"NATIVE_CAPABILITY_UNVERIFIED"});expect(f.run().state).toBe("RUNNER_UNAVAILABLE");expect(f.service.database.getEntity("adapter-session",f.run().sessionId)).toMatchObject({authority:{stopState:"unconfirmed"}});
  });
  it("does not blindly resend a stop whose native acknowledgement was lost",async()=>{
    const f=await setup();await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${f.taskId}/dispatch`,payload:{}});const adapter=(f.service as unknown as {agentAdapters:Map<string,AgentAdapter>}).agentAdapters.get("orion")!,cancel=vi.spyOn(adapter,"cancel").mockRejectedValue(Error("lost stop acknowledgement"));
    await expect(f.service.semanticTools.execute("run.cancel",{target:f.run().id},{...resumeContext,workflowId:"unknown-stop-one"})).rejects.toThrow();
    await expect(f.service.semanticTools.execute("run.cancel",{target:f.run().id},{...resumeContext,workflowId:"unknown-stop-two"})).rejects.toMatchObject({code:"CANCELLATION_UNCONFIRMED"});expect(cancel).toHaveBeenCalledTimes(1);expect(f.run().state).toBe("RUNNER_UNAVAILABLE");
  });
  it("permits explicit owned cancellation after lease expiry without granting continuation",async()=>{
    const f=await setup();await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${f.taskId}/dispatch`,payload:{}});const run=f.run();f.control.now=new Date(f.control.now.getTime()+16*60_000);
    await f.service.semanticTools.execute("run.cancel",{target:run.id},{...resumeContext,workflowId:"expired-stop"});expect(f.run().state).toBe("CANCELLED");expect(f.task().state).toBe("CANCELLED");expect(f.control.cancellations).toBe(1);
  });
  it("aborts owned verification before waiting for its mutation lane during failure",async()=>{
    const f=await setup();await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${f.taskId}/dispatch`,payload:{}});const run=f.run(),entered=Promise.withResolvers<void>(),ready=Promise.withResolvers<void>(),controller=new AbortController();
    const internals=f.service as unknown as {nativeInteractions:{withMutationLane<T>(id:string,operation:()=>Promise<T>):Promise<T>};localCommands:Map<string,{controller:AbortController;settled:Promise<void>}>;failRun(run:Run,reason:string):Promise<void>};
    const lane=internals.nativeInteractions.withMutationLane(run.sessionId,async()=>{entered.resolve();await ready.promise;});await entered.promise;internals.localCommands.set(run.id,{controller,settled:ready.promise});
    const pending=internals.failRun(run,"owned verification lease expired");
    try{await Promise.resolve();expect(controller.signal.aborted).toBe(true);expect(f.run().state).not.toBe("FAILED");ready.resolve();await Promise.all([lane,pending]);expect(f.run().state).toBe("FAILED");expect(f.control.cancellations).toBe(1);}finally{ready.resolve();await Promise.all([lane,pending]);internals.localCommands.delete(run.id);}
  });
  it("retains unavailable failure when owned command drain is unconfirmed",async()=>{
    const f=await setup();await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${f.taskId}/dispatch`,payload:{}});const run=f.run(),controller=new AbortController();
    const internals=f.service as unknown as {localCommands:Map<string,{controller:AbortController;settled:Promise<void>}>;failRun(run:Run,reason:string):Promise<void>};const settled=Promise.reject(Error("unconfirmed descendant stop"));void settled.catch(()=>undefined);internals.localCommands.set(run.id,{controller,settled});
    try{await internals.failRun(run,"lease expired");expect(controller.signal.aborted).toBe(true);expect(f.run().state).toBe("RUNNER_UNAVAILABLE");expect(f.task().state).not.toBe("FAILED");}finally{internals.localCommands.delete(run.id);}
  });
  it("persists the real cancellation actor and captured fence through adapter saves and restart",async()=>{
    const f=await setup();await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${f.taskId}/dispatch`,payload:{}});const run=f.run();await f.service.semanticTools.execute("run.cancel",{target:run.id},{...resumeContext,principal:{...resumeContext.principal,id:"reviewed-operator"},workflowId:"stop-audit"});await f.service.stop();const restored=await f.make();
    expect(restored.database.getEntity("adapter-session",run.sessionId)).toMatchObject({authority:{stopState:"confirmed",stopIntent:{version:1,actorId:"reviewed-operator",operation:"cancel",fence:{runId:run.id,sessionId:run.sessionId,generation:run.generation,leaseId:run.leaseId,expectedCurrentRunId:run.id}}}});expect(f.starts).toHaveLength(1);
  });
  it("does not turn confirmed failure cleanup unknown when attention notification fails",async()=>{
    const f=await setup();await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${f.taskId}/dispatch`,payload:{}});const internals=f.service as unknown as {failRun(run:Run,reason:string):Promise<void>;notifyAttention(run:Run):Promise<void>;markRemoteUnavailable(...args:unknown[]):void};vi.spyOn(internals,"notifyAttention").mockRejectedValue(Error("notification unavailable"));const unavailable=vi.spyOn(internals,"markRemoteUnavailable");await internals.failRun(f.run(),"lease expired");
    expect(f.run().state).toBe("FAILED");expect(f.task().state).toBe("FAILED");expect(unavailable).toHaveBeenCalledTimes(1);expect(f.service.database.getEntity("adapter-session",f.run().sessionId)).toMatchObject({authority:{stopState:"confirmed"}});
  });
  it("reserves one local Session and start receipt before native creation",async()=>{
    const f=await setup();let during:unknown;f.control.onStart=()=>{const run=f.run();during={run,command:new InteractionStore(f.service.database).command(`native-start:${run.id}`),control:new InteractionStore(f.service.database).control(run.sessionId)};};
    expect((await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${f.taskId}/dispatch`,payload:{}})).statusCode).toBe(201);const run=f.run();
    expect(during).toMatchObject({run:{id:run.id,sessionId:run.sessionId,state:"STARTING"},command:{state:"SENDING",fence:{sessionId:run.sessionId,generation:run.generation,leaseId:run.leaseId}},control:{state:"AUTOMATED",epoch:1,revision:1}});expect(run.sessionId).not.toMatch(/^unstarted:/);expect(new InteractionStore(f.service.database).command(`native-start:${run.id}`)?.state).toBe("ACKNOWLEDGED");expect(f.starts).toHaveLength(1);
  });
  it.each(["task","control"] as const)("rejects local native creation when %s authority changes during adapter preparation",async change=>{
    const f=await setup(),adapter=(f.service as unknown as {agentAdapters:Map<string,AgentAdapter>}).agentAdapters.get("orion")!,start=adapter.start.bind(adapter),entered=Promise.withResolvers<void>(),ready=Promise.withResolvers<void>();vi.spyOn(adapter,"start").mockImplementation(async input=>{entered.resolve();await ready.promise;return start(input);});
    const pending=f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${f.taskId}/dispatch`,payload:{}}).then(value=>value);
    try{await entered.promise;if(change==="control")controlled(f)();else{const task=f.service.database.getCanonicalTask<JsonValue>(f.taskId)!;f.service.database.writeCanonicalTask(f.taskId,task.revision,{...(task.document as Record<string,JsonValue>),title:"Concurrent reviewed edit"});}ready.resolve();expect((await pending).statusCode).toBe(409);expect(f.starts).toHaveLength(0);if(change==="task")expect(f.task()).toMatchObject({title:"Concurrent reviewed edit",state:"QUEUED"});}finally{ready.resolve();await pending;}
  });
  it("recovers direct non-publication execution as unavailable without replaying native creation",async()=>{
    const f=await setup();await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${f.taskId}/dispatch`,payload:{}});const run=f.run();expect(f.service.database.listEntities("task-publication")).toHaveLength(0);await f.service.stop();const restored=await f.make();
    expect(f.run(restored)).toMatchObject({id:run.id,state:"RUNNER_UNAVAILABLE",recoveryState:"ACTIVE",recoveryReason:"NATIVE_OUTCOME_UNKNOWN",resumePolicy:"manual",sessionId:run.sessionId,generation:run.generation,leaseId:run.leaseId});expect(f.task(restored).state).toBe("WAITING_USER");await restored.runBackgroundCycle();expect(f.starts).toHaveLength(1);expect(restored.database.listEntities("run")).toHaveLength(1);
  });
  it.each([false,true])("projects only the original failed-start Task authority after restart (concurrent edit=%s)",async edited=>{
    const f=await setup();f.control.throwStart=true;const execute=f.service.tasks.execute.bind(f.service.tasks),writer=vi.spyOn(f.service.tasks,"execute").mockImplementation((input,...rest)=>{if(input.command.type==="task.transition"&&input.command.state==="FAILED")throw Error("interrupted final Task projection");return execute(input,...rest);});
    try{expect((await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${f.taskId}/dispatch`,payload:{}})).statusCode).toBe(500);}finally{writer.mockRestore();}
    const run=f.run();expect(f.task().state).toBe("QUEUED");expect(new InteractionStore(f.service.database).command(`native-start:${run.id}`)?.state).toBe("FAILED");expect(f.starts).toHaveLength(0);
    if(edited){const task=f.service.database.getCanonicalTask<JsonValue>(f.taskId)!;f.service.database.writeCanonicalTask(f.taskId,task.revision,{...(task.document as Record<string,JsonValue>),title:"New reviewed intent"});}
    if(!edited)f.control.now=new Date(f.control.now.getTime()+24*60*60_000);
    f.control.throwStart=false;await f.service.stop();const restored=await f.make();
    if(edited)expect(f.task(restored)).toMatchObject({state:"QUEUED",title:"New reviewed intent"});else expect(f.task(restored).state).toBe("FAILED");expect(f.starts).toHaveLength(0);const revision=restored.database.getCanonicalTask(f.taskId)!.revision;await restored.stop();const again=await f.make();expect(again.database.getCanonicalTask(f.taskId)!.revision).toBe(revision);expect(f.starts).toHaveLength(0);
  });
  function webAnswer(f:Awaited<ReturnType<typeof setup>>,id:string){
    const run=f.run();return f.service.app.inject({headers:OWNER,method:"POST",url:`/api/agents/profiles/${run.profileId}/sessions/${run.sessionId}/input`,payload:{inputId:id,message:"continue",authority:{runId:run.id,generation:run.generation,leaseId:run.leaseId,lastActivityAt:run.lastActivityAt,taskRevision:f.service.database.getCanonicalTask(f.taskId)!.revision}}}).then(value=>value);
  }
  it("blocks background verification and delivery under a locked control epoch",async()=>{
    const f=await setup();expect((await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${f.taskId}/dispatch`,payload:{profileId:"orion"}})).statusCode).toBe(201);
    controlled(f)();f.control.turn="completed";await f.service.runBackgroundCycle();
    expect(f.run().state).toBe("ACTIVE");expect(f.task().state).toBe("RUNNING");expect(f.control.pushes).toBe(0);expect(f.control.prs).toBe(0);expect(f.control.cancellations).toBe(0);
  });
  it.each(["reply","cancel","lease"] as const)("keeps %s independent of a pending usage reader",async action=>{
    const f=await setup();await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${f.taskId}/dispatch`,payload:{profileId:"orion"}});
    const adapter=(f.service as unknown as {agentAdapters:Map<string,AgentAdapter>}).agentAdapters.get("orion")!,entered=Promise.withResolvers<void>(),ready=Promise.withResolvers<Record<string,unknown>>();
    const usage=vi.spyOn(adapter,"usage").mockImplementation(async()=>{entered.resolve();return ready.promise;});
    const quick=async<T>(pending:PromiseLike<T>)=>Promise.race([pending,new Promise<undefined>(resolve=>setTimeout(resolve,500))]);
    if(action==="reply")f.control.turn="waiting";
    const advancing=action==="lease"?f.service.runBackgroundCycle():f.service.app.inject({headers:OWNER,method:"POST",url:`/api/runs/${f.run().id}/advance`}).then(value=>value);
    let cancellation:Promise<unknown>|undefined;
    try{
      await entered.promise;
      if(action==="reply"){
        expect(await quick(advancing)).toBeDefined();expect(f.run().state).toBe("WAITING_USER");f.control.turn="running";
        const reply=await quick(webAnswer(f,"usage-held-answer"));expect(reply?.statusCode).toBe(200);expect(f.starts).toHaveLength(2);
      }else if(action==="cancel"){
        cancellation=f.service.semanticTools.execute("run.cancel",{target:f.run().id},{...resumeContext,workflowId:"usage-held-cancel"});
        expect(await quick(cancellation)).toMatchObject({state:"CANCELLED"});expect(f.run().state).toBe("CANCELLED");
      }else{
        expect(await quick(Promise.resolve(advancing).then(()=>true))).toBe(true);
        const before=f.run().leaseExpiresAt;f.control.now=new Date(f.control.now.getTime()+11*60_000);
        expect(await quick(f.service.runBackgroundCycle().then(()=>true))).toBe(true);expect(f.run().leaseExpiresAt).not.toBe(before);expect(usage).toHaveBeenCalledTimes(1);
      }
    }finally{ready.resolve({state:"UNKNOWN",source:"probe",confidence:"low"});await advancing;await cancellation;}
  });
  it("keeps telemetry read failure separate from a completed native execution",async()=>{
    const f=await setup();await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${f.taskId}/dispatch`,payload:{profileId:"orion"}});
    const adapter=(f.service as unknown as {agentAdapters:Map<string,AgentAdapter>}).agentAdapters.get("orion")!;vi.spyOn(adapter,"usage").mockRejectedValue(Error("telemetry reader unavailable"));f.control.turn="completed";
    await f.service.runBackgroundCycle();expect(f.run().state).toBe("COMPLETE");expect(f.task().state).toBe("REVIEW");
    expect(f.service.database.listEntities("usage-error")).toContainEqual(expect.objectContaining({status:"unknown"}));
  });
  function usageFact(f:Awaited<ReturnType<typeof setup>>,eventId:string){
    const run=f.run();return {observations:[{version:1,eventId,profileId:run.profileId,runId:run.id,sessionId:run.sessionId,turnId:"native-turn",scope:"turn",mode:"snapshot",observedAt:f.control.now.toISOString(),source:"native-event",completeness:"complete",metrics:[{name:"input",value:"12",unit:"tokens"}]}]};
  }
  it("rejects late usage after account context changes and keeps historical sessions out of new credentials",async()=>{
    const f=await setup();await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${f.taskId}/dispatch`,payload:{}});
    const adapter=(f.service as unknown as {agentAdapters:Map<string,AgentAdapter>}).agentAdapters.get("orion")!,ready=Promise.withResolvers<Record<string,unknown>>(),entered=Promise.withResolvers<void>();
    const usage=vi.spyOn(adapter,"usage").mockImplementation(async()=>{entered.resolve();return ready.promise;});f.control.turn="completed";
    try{
      await f.service.runBackgroundCycle();await entered.promise;expect(f.run().state).toBe("COMPLETE");
      const config=structuredClone(f.service.configuration.current().config);config.agentProfiles[0]!.alias="Changed account context";const plan=f.service.configuration.buildPlan(config,"fixture","web");expect((await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/config/plans/${plan.id}/apply`,payload:{confirmed:true}})).statusCode).toBe(200);
      ready.resolve(usageFact(f,"late-old-account"));await new Promise(resolve=>setTimeout(resolve,0));
      expect(f.service.database.listEntities("usage-observation")).toHaveLength(0);expect(f.service.database.getEntity("usage-read-state",f.run().id)).toMatchObject({state:"unknown",reasonCode:"USAGE_SOURCE_CHANGED"});
      f.control.now=new Date(f.control.now.getTime()+60_000);await f.service.runBackgroundCycle();expect(usage).toHaveBeenCalledTimes(1);
    }finally{ready.resolve({});}
  });
  it("closes pending usage admission during shutdown and rejects a late result",async()=>{
    const f=await setup();await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${f.taskId}/dispatch`,payload:{}});
    const adapter=(f.service as unknown as {agentAdapters:Map<string,AgentAdapter>}).agentAdapters.get("orion")!,ready=Promise.withResolvers<Record<string,unknown>>(),entered=Promise.withResolvers<void>();
    vi.spyOn(adapter,"usage").mockImplementation(async()=>{entered.resolve();return ready.promise;});f.control.turn="completed";
    try{
      await f.service.runBackgroundCycle();await entered.promise;const runId=f.run().id,fact=usageFact(f,"late-after-shutdown");await f.service.stop();ready.resolve(fact);await new Promise(resolve=>setTimeout(resolve,0));
      const db=new DispatcherDatabase(join(f.service.options.dataDirectory,"dispatcher.sqlite"));try{expect(db.listEntities("usage-observation")).toHaveLength(0);expect(db.getEntity("usage-read-state",runId)).toMatchObject({state:"unknown",reasonCode:"USAGE_SHUTDOWN_PENDING"});}finally{db.close();}
    }finally{ready.resolve({});}
  });
  it("retries terminal usage failures independently and retains the last successful read scope",async()=>{
    const f=await setup();await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${f.taskId}/dispatch`,payload:{}});
    const adapter=(f.service as unknown as {agentAdapters:Map<string,AgentAdapter>}).agentAdapters.get("orion")!,usage=vi.spyOn(adapter,"usage").mockRejectedValueOnce(Error("transient reader failure")).mockResolvedValue(usageFact(f,"terminal-usage-retry"));f.control.turn="completed";
    await f.service.runBackgroundCycle();expect(f.run().state).toBe("COMPLETE");expect(f.service.database.getEntity("usage-read-state",f.run().id)).toMatchObject({state:"unknown",readAttempts:1});
    f.control.now=new Date(f.control.now.getTime()+2_000);await f.service.runBackgroundCycle();await vi.waitFor(()=>expect(f.service.database.getEntity("usage-read-state",f.run().id)).toMatchObject({state:"complete",readAttempts:2,lastSuccessAt:f.control.now.toISOString(),lastSuccessfulScopeKey:expect.any(String)}));
    expect(f.service.database.listEntities("usage-observation")).toHaveLength(1);expect(usage).toHaveBeenCalledTimes(2);expect(f.starts).toHaveLength(1);
  });
  it("does not invoke queued usage after its captured control scope changes",async()=>{
    const f=await setup();await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${f.taskId}/dispatch`,payload:{}});
    const adapter=(f.service as unknown as {agentAdapters:Map<string,AgentAdapter>}).agentAdapters.get("orion")!,usage=vi.spyOn(adapter,"usage");
    (f.service as unknown as {kickDueRunUsage:()=>void}).kickDueRunUsage();controlled(f)();await new Promise(resolve=>setTimeout(resolve,0));
    expect(usage).not.toHaveBeenCalled();expect(f.service.database.getEntity("usage-read-state",f.run().id)).toMatchObject({state:"unknown",reasonCode:"USAGE_SOURCE_CHANGED"});
  });
  it.each(["control","task-revision"] as const)("rechecks %s after background native status awaited",async change=>{
    const f=await setup();await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${f.taskId}/dispatch`,payload:{profileId:"orion"}});
    const lock=controlled(f),adapter=(f.service as unknown as {agentAdapters:Map<string,AgentAdapter>}).agentAdapters.get("orion")!,status=adapter.status.bind(adapter),entered=Promise.withResolvers<void>(),ready=Promise.withResolvers<void>();
    vi.spyOn(adapter,"status").mockImplementation(async(...args)=>{entered.resolve();await ready.promise;return status(...args);});f.control.turn="completed";
    const cycle=f.service.runBackgroundCycle();
    try{await entered.promise;if(change==="control")lock();else{const task=f.service.database.getCanonicalTask<Task>(f.taskId)!;f.service.database.writeCanonicalTask(f.taskId,task.revision,JSON.parse(JSON.stringify({...task.document,title:"Concurrent edit"})) as JsonValue);}ready.resolve();await cycle;
      expect(f.run().state).toBe("ACTIVE");expect(f.task().state).toBe("RUNNING");expect(f.control.pushes).toBe(0);expect(f.control.prs).toBe(0);expect(f.control.cancellations).toBe(0);
    }finally{ready.resolve();await cycle;}
  });
  it.each(["http","operator","slack"] as const)("blocks %s continuation under a locked control epoch",async channel=>{
    const f=await waitingFixture();controlled(f)();f.control.turn="running";
    if(channel==="http")expect((await webAnswer(f,"locked-input-123")).statusCode).toBe(409);
    else if(channel==="operator")await expect(f.service.semanticTools.execute("run.resume",{target:f.run().id},resumeContext)).rejects.toThrow();
    else{await f.send(f.service,"locked-reply","continue");await f.service.runBackgroundCycle();}
    expect(f.starts).toHaveLength(1);expect(f.control.cancellations).toBe(0);expect(f.run().state).toBe("WAITING_USER");
  });
  it.each(["http","operator"] as const)("rechecks control at the final %s native boundary after awaited preparation",async channel=>{
    const f=await waitingFixture(),lock=controlled(f),adapter=(f.service as unknown as {agentAdapters:Map<string,AgentAdapter>}).agentAdapters.get(f.run().profileId)!;
    const send=adapter.send.bind(adapter),entered=Promise.withResolvers<void>(),ready=Promise.withResolvers<void>();
    vi.spyOn(adapter,"send").mockImplementation(async(...args)=>{entered.resolve();await ready.promise;return send(...args);});
    const pending=channel==="http"?webAnswer(f,"late-control-123"):f.service.semanticTools.execute("run.resume",{target:f.run().id},resumeContext).then(value=>({value}),error=>({error}));
    try{await entered.promise;lock();ready.resolve();await pending;expect(f.starts).toHaveLength(1);expect(f.control.cancellations).toBe(0);expect(f.run().state).toBe("WAITING_USER");expect(f.service.database.listEntities("run-input")).toContainEqual(expect.objectContaining({state:"REJECTED"}));}
    finally{ready.resolve();await pending;}
  });
  it("does not cancel a new control owner after native input already crossed the boundary",async()=>{
    const f=await waitingFixture(),lock=controlled(f);f.control.turn="running";f.control.onStart=()=>{lock();};
    expect((await webAnswer(f,"post-native-control")).statusCode).toBe(409);
    expect(f.starts).toHaveLength(2);expect(f.control.cancellations).toBe(0);expect(f.run()).toMatchObject({state:"RUNNER_UNAVAILABLE",recoveryReason:"NATIVE_OUTCOME_UNKNOWN"});
    expect(f.service.database.listEntities("run-input")).toContainEqual(expect.objectContaining({state:"OUTCOME_UNKNOWN"}));
  });
  it("keeps uncertain Slack input durable across later replies and channels",async()=>{
    const f=await waitingFixture(),adapter=(f.service as unknown as {agentAdapters:Map<string,AgentAdapter>}).agentAdapters.get(f.run().profileId)!,send=adapter.send.bind(adapter);
    vi.spyOn(adapter,"send").mockImplementation(async(...args)=>{await send(...args);throw Error("native messaging acknowledgement lost");});f.control.turn="running";
    await f.send(f.service,"lost-native-reply","continue");await f.service.runBackgroundCycle();
    expect(f.starts).toHaveLength(2);expect(f.run()).toMatchObject({state:"RUNNER_UNAVAILABLE",recoveryReason:"NATIVE_OUTCOME_UNKNOWN"});
    expect(f.service.database.listEntities("run-input")).toContainEqual(expect.objectContaining({state:"OUTCOME_UNKNOWN"}));
    f.control.now=new Date(f.control.now.getTime()+60_000);await f.send(f.service,"second-native-reply","continue again");await f.service.runBackgroundCycle();
    expect((await webAnswer(f,"cross-channel-retry")).statusCode).toBe(409);expect(f.starts).toHaveLength(2);
  });
  it("rejects persisted lease revocation before Web input even with a cached in-memory lease",async()=>{
    const f=await waitingFixture(),run=f.run();f.service.database.saveEntity("run",run.id,JSON.parse(JSON.stringify({...run,revokedLeaseIds:[run.leaseId]})) as JsonValue);
    const reply=await webAnswer(f,"revoked-owner-input");expect(reply.statusCode).toBe(409);expect(reply.json()).toMatchObject({code:"STALE_RUN_AUTHORITY"});expect(f.starts).toHaveLength(1);
  });

  async function rerouteFixture() {
    const f = await setup({ secondProfile: true });
    const contract = f.service.database.getTaskContract<JsonValue>(f.taskId) as unknown as TaskContract;
    f.service.database.saveTaskContract(f.taskId, JSON.parse(JSON.stringify({ ...contract, instructions: "Keep the frozen instructions", scope: ["README.md"], acceptanceCriteria: ["Frozen acceptance"], constraints: ["Keep the source checkout intact"], referenceLinks: ["https://example.invalid/frozen-spec"], delivery: { type: "commit", repository: "acme/repo" } })) as JsonValue);
    expect((await f.service.app.inject({ headers: OWNER, method: "POST", url: `/api/tasks/${f.taskId}/dispatch`, payload: { profileId: "orion" } })).statusCode).toBe(201);
    return f;
  }

  it("stops old ownership before a reserved reroute and retains frozen context through owning commit and restart", async () => {
    const f = await rerouteFixture(), old = f.run(), adapters = (f.service as unknown as { agentAdapters: Map<string, AgentAdapter> }).agentAdapters;
    const originalContract = f.service.database.getEntity("run-contract", old.id), verification = f.service.database.getEntity("run-verification-config", old.id);
    f.service.database.saveTaskContract(old.taskId, { ...(originalContract as object), goal: "MUTATED task contract", verification: ["not-the-frozen-check"] } as JsonValue);
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), cancel = adapters.get(old.profileId)!.cancel.bind(adapters.get(old.profileId)!);
    vi.spyOn(adapters.get(old.profileId)!, "cancel").mockImplementation(async (...args) => { entered.resolve(); await release.promise; return cancel(...args); });
    let observed: unknown;
    f.control.onStart = () => { const id = f.task().currentRunId!; observed = { run: f.service.database.getEntity("run", id), old: f.service.database.getEntity("run", old.id), currentRunId: id }; };
    const pending = f.service.semanticTools.execute("run.reroute", { target: old.id, profileId: "vega" }, { ...resumeContext, workflowId: "frozen-reroute" });
    await entered.promise; const startsBeforeStop = f.starts.length; release.resolve();
    const result = await pending as unknown as { run: Run };
    expect(startsBeforeStop).toBe(1);
    expect(observed).toMatchObject({ run: { id: result.run.id, state: "STARTING", profileId: "vega" }, old: { state: "SUPERSEDED" }, currentRunId: result.run.id });
    expect(result.run).toMatchObject({ state: "ACTIVE", attempt: 2, generation: 2, worktree: old.worktree });
    expect(f.service.database.getEntity("run-contract", result.run.id)).toEqual(originalContract);
    expect(f.service.database.getEntity("run-verification-config", result.run.id)).toEqual(verification);
    expect(f.service.workspaces.get(old.worktree!)).toMatchObject({ runId: result.run.id, taskId: old.taskId, attempt: 2 });
    expect(f.starts[1]!.prompt).toContain("Keep the frozen instructions");expect(f.starts[1]!.prompt).toContain("Frozen acceptance");expect(f.starts[1]!.prompt).toContain("https://example.invalid/frozen-spec");expect(f.starts[1]!.prompt).not.toContain("MUTATED");
    writeFileSync(join(old.worktree!, "README.md"), "rerouted implementation\n");f.control.turn = "completed";
    const advanced = await f.service.app.inject({ headers: OWNER, method: "POST", url: `/api/runs/${result.run.id}/advance` });
    expect(advanced.statusCode, advanced.body).toBe(200);expect(advanced.json()).toMatchObject({ run: { state: "COMPLETE", verification: { state: "PASSED" } }, task: { state: "REVIEW", currentRunId: result.run.id } });
    expect(execFileSync("git", ["-C", old.worktree!, "show", "HEAD:README.md"], { encoding: "utf8" })).toBe("rerouted implementation\n");
    await f.service.stop();const restored = await f.make();expect(restored.workspaces.get(old.worktree!)).toMatchObject({ runId: result.run.id, attempt: 2 });
  });

  it("lets task cancellation win while reroute is awaiting the original writer stop", async () => {
    const f = await rerouteFixture(), old = f.run(), adapter = (f.service as unknown as { agentAdapters: Map<string, AgentAdapter> }).agentAdapters.get(old.profileId)!;
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), cancel = adapter.cancel.bind(adapter);
    vi.spyOn(adapter, "cancel").mockImplementation(async (...args) => { entered.resolve(); await release.promise; return cancel(...args); });
    const reroute = f.service.semanticTools.execute("run.reroute", { target: old.id, profileId: "vega" }, { ...resumeContext, workflowId: "racing-reroute" }).then(value => ({ value }), error => ({ error }));
    await entered.promise;
    const cancelling = f.service.semanticTools.execute("task.cancel", { target: old.taskId }, { ...resumeContext, workflowId: "cancel-reroute" }).then(value => ({ value }), error => ({ error }));release.resolve();
    const results = await Promise.all([reroute, cancelling]);expect(results[0]).toHaveProperty("error");expect(results[1]).toHaveProperty("value");
    expect(f.starts).toHaveLength(1);expect(f.task()).toMatchObject({ state: "CANCELLED", currentRunId: old.id });expect(f.run().state).toBe("CANCELLED");
  });

  it("retains a reroute's reserved native owner after a lost start response and never starts its retry again", async () => {
    const f = await rerouteFixture(), old = f.run(), adapter = (f.service as unknown as { agentAdapters: Map<string, AgentAdapter> }).agentAdapters.get("vega")!, start = adapter.start.bind(adapter);
    adapter.start = async input => { await start(input); throw new AdapterContractError("COMMAND_OUTCOME_UNKNOWN", "start acknowledgement lost"); };
    const context = { ...resumeContext, workflowId: "unknown-reroute" };
    const first = await f.service.semanticTools.execute("run.reroute", { target: old.id, profileId: "vega" }, context) as unknown as { run: Run };
    expect(first.run).toMatchObject({ state: "RUNNER_UNAVAILABLE", recoveryReason: "NATIVE_OUTCOME_UNKNOWN", generation: 2 });expect(f.task().currentRunId).toBe(first.run.id);
    const repeated = await f.service.semanticTools.execute("run.reroute", { target: old.id, profileId: "vega" }, context) as unknown as { run: Run };
    expect(repeated.run.id).toBe(first.run.id);expect(f.starts).toHaveLength(2);
    await f.service.semanticTools.execute("run.cancel", { target: first.run.id }, { ...resumeContext, workflowId: "stop-unknown-reroute" });
    expect(f.service.database.getEntity("run", first.run.id)).toMatchObject({ state: "CANCELLED" });
  });

  it("records a stopped replacement as unavailable when task authority changes during its start acknowledgement", async () => {
    const f = await rerouteFixture(), old = f.run(), adapter = (f.service as unknown as { agentAdapters: Map<string, AgentAdapter> }).agentAdapters.get("vega")!, start = adapter.start.bind(adapter);
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    adapter.start = async input => { const session = await start(input);entered.resolve();await release.promise;return session; };
    const pending = f.service.semanticTools.execute("run.reroute", { target: old.id, profileId: "vega" }, { ...resumeContext, workflowId: "stale-reroute-start" }).then(value => ({ value }), error => ({ error }));
    await entered.promise;const replacementId = f.task().currentRunId!, task = f.service.database.getCanonicalTask<Task>(old.taskId)!;
    f.service.database.writeCanonicalTask(old.taskId, task.revision, { ...task.document, title: "Changed during native acknowledgement" });release.resolve();
    expect(await pending).toHaveProperty("error");
    expect(f.service.database.getEntity("run", replacementId)).toMatchObject({ state: "RUNNER_UNAVAILABLE", recoveryReason: "NATIVE_OUTCOME_UNKNOWN" });
    expect(f.control.cancellations).toBe(2);expect(f.starts).toHaveLength(2);
  });

  it.each(["operator", "resource-monitor"] as const)("does not revive a cancelled Run after %s resume starts a native turn", async source => {
    const f = await waitingFixture(), run = f.run();
    if (source === "resource-monitor") {
      f.service.database.saveEntity("run", run.id, JSON.parse(JSON.stringify({ ...run, state: "RESOURCE_BLOCKED" })) as JsonValue);
      const task = f.service.database.getCanonicalTask<Task>(run.taskId)!;
      f.service.database.writeCanonicalTask(run.taskId, task.revision, { ...task.document, state: "WAITING_RESOURCE" });
    }
    f.control.turn = "running";
    f.control.onStart = () => f.service.database.saveEntity("run", run.id, JSON.parse(JSON.stringify({ ...run, state: "CANCELLED" })) as JsonValue);
    if (source === "operator") {
      await expect(f.service.semanticTools.execute("run.resume", { target: run.id }, resumeContext)).rejects.toThrow();
    } else {
      const adapter = (f.service as unknown as { agentAdapters: Map<string, AgentAdapter> }).agentAdapters.get(run.profileId)!;
      adapter.usage = async () => ({ state: "AVAILABLE", source: "probe", confidence: "high", checkedAt: f.control.now.toISOString() });
      expect((await f.service.app.inject({ headers: OWNER, method: "POST", url: `/api/resources/${run.profileId}/probe` })).statusCode).toBe(200);
    }
    expect(f.run().state).toBe("CANCELLED");
    expect(f.task().state).toBe(source === "operator" ? "WAITING_USER" : "WAITING_RESOURCE");
    expect(f.control.cancellations).toBe(1);
    expect(f.starts).toHaveLength(2);
    expect(f.service.database.listEntities("run-input")).toContainEqual(expect.objectContaining({ runId: run.id, state: "OUTCOME_UNKNOWN" }));
  });

  it("retains an uncertain resume acknowledgement and prevents another native continuation", async () => {
    const f = await waitingFixture(), run = f.run();
    const adapter = (f.service as unknown as { agentAdapters: Map<string, AgentAdapter> }).agentAdapters.get(run.profileId)!;
    const resume = adapter.resume.bind(adapter);
    adapter.resume = async sessionId => { await resume(sessionId); throw new Error("resume acknowledgement lost"); };
    f.control.turn = "running";
    await expect(f.service.semanticTools.execute("run.resume", { target: run.id }, resumeContext)).rejects.toMatchObject({ code: "INPUT_OUTCOME_UNKNOWN" });
    expect(f.run()).toMatchObject({ state: "RUNNER_UNAVAILABLE", recoveryReason: "NATIVE_OUTCOME_UNKNOWN" });
    await expect(f.service.semanticTools.execute("run.resume", { target: run.id }, { ...resumeContext, workflowId: "retry-resume" })).rejects.toThrow();
    expect(f.starts).toHaveLength(2);
    expect(f.service.database.listEntities("run-input")).toContainEqual(expect.objectContaining({ runId: run.id, state: "OUTCOME_UNKNOWN" }));
  });

  it("does not mark a cancelled native resume response as ACTIVE", async () => {
    const f = await waitingFixture(), run = f.run();
    const adapter = (f.service as unknown as { agentAdapters: Map<string, AgentAdapter> }).agentAdapters.get(run.profileId)!;
    adapter.resume = async sessionId => adapter.cancel(sessionId);
    await expect(f.service.semanticTools.execute("run.resume", { target: run.id }, resumeContext)).rejects.toThrow();
    expect(f.run().state).not.toBe("ACTIVE");
    expect(f.task().state).toBe("WAITING_USER");
    expect(f.starts).toHaveLength(1);
  });

  it("retries only the consumed answer's acknowledgement after restart", async () => {
    const f = await waitingFixture();
    f.control.turn = "running";
    f.control.slackFailures = 1;
    await f.send(f.service, "answer-one", "approved answer for first question");
    await f.service.runBackgroundCycle();
    expect(f.starts).toHaveLength(2);
    f.control.turn = "waiting";
    await f.service.runBackgroundCycle();
    expect(f.run().state).toBe("WAITING_USER");
    await f.service.stop();
    const restored = await f.make();
    f.control.now = new Date(f.control.now.getTime() + 60_000);
    await restored.runBackgroundCycle();
    expect(f.starts).toHaveLength(2);
    expect(f.run(restored).state).toBe("WAITING_USER");
    expect(f.slack.some((body) => String(body.text).includes("Resumed run"))).toBe(true);
  });

  it("rejects archiving during workspace creation before reserving or starting a run", async () => {
    const f = await setup();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const create = f.service.workspaces.create.bind(f.service.workspaces);
    vi.spyOn(f.service.workspaces, "create").mockImplementation(async (input) => { entered.resolve(); await release.promise; return create(input); });
    const dispatch = f.service.app.inject({ headers: OWNER, method: "POST", url: `/api/tasks/${f.taskId}/dispatch`, payload: {} });
    const response = dispatch.then((value) => value);
    await entered.promise;
    const revision = f.service.database.getCanonicalTask(f.taskId)!.revision;
    expect((await f.service.app.inject({ headers: OWNER, method: "POST", url: `/api/tasks/${f.taskId}/archive`, payload: { archived: true, revision, archiveRevision: 0 } })).statusCode).toBe(200);
    release.resolve();
    expect((await response).statusCode).toBe(409);
    expect(f.starts).toHaveLength(0);
    expect(f.service.database.listEntities("run")).toHaveLength(0);
    expect(f.task().state).toBe("READY");
  });

  it("fences Web replies before sending and resumes the original waiting conversation", async () => {
    const f = await waitingFixture();
    const run = f.run();
    const url = `/api/agents/profiles/${run.profileId}/sessions/${run.sessionId}/input`;
    const authority = { runId: run.id, generation: run.generation, leaseId: run.leaseId, lastActivityAt: run.lastActivityAt, taskRevision: f.service.database.getCanonicalTask(f.taskId)!.revision };
    expect((await f.service.app.inject({headers: OWNER, method:"POST", url, payload:{message:"continue"}})).statusCode).toBe(409);
    expect((await f.service.app.inject({headers: OWNER, method:"POST", url, payload:{message:"continue",authority:{...authority,generation:0}}})).statusCode).toBe(409);
    expect(f.starts).toHaveLength(1);
    f.control.turn = "running";
    expect((await f.service.app.inject({headers: OWNER, method:"POST", url, payload:{message:"continue",authority}})).statusCode).toBe(200);
    expect(f.starts).toHaveLength(2);
    expect(f.run().state).toBe("ACTIVE");
    expect(f.task().state).toBe("RUNNING");
    expect(f.service.database.listEntities<JsonValue>("messaging-conversation")[0]).toMatchObject({state:"ACTIVE"});
    expect((await f.service.app.inject({headers: OWNER, method:"POST", url, payload:{message:"stale",authority}})).statusCode).toBe(409);
    expect(f.starts).toHaveLength(2);
  });

  it("rejects duplicate Web input and cancels input whose authority changed during send", async () => {
    const f = await waitingFixture();
    const run = f.run();
    const agent = (f.service as unknown as { agentAdapters: Map<string, AgentAdapter> }).agentAdapters.get("orion")!;
    const original = agent.send.bind(agent);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    agent.send = async (...args) => { entered.resolve(); await release.promise; return original(...args); };
    const request = { headers:OWNER, method:"POST" as const, url:`/api/agents/profiles/${run.profileId}/sessions/${run.sessionId}/input`, payload:{message:"continue",authority:{runId:run.id,generation:run.generation,leaseId:run.leaseId,lastActivityAt:run.lastActivityAt,taskRevision:f.service.database.getCanonicalTask(f.taskId)!.revision}} };
    const response = f.service.app.inject(request).then((value) => value);
    await entered.promise;
    expect((await f.service.app.inject(request)).statusCode).toBe(409);
    f.service.database.saveEntity("run", run.id, JSON.parse(JSON.stringify({...run,state:"CANCELLED"})) as JsonValue);
    release.resolve();
    expect((await response).statusCode).toBe(409);
    expect(f.run().state).toBe("CANCELLED");
    expect(f.task().state).toBe("WAITING_USER");
    expect(f.control.cancellations).toBe(0);
    expect(f.starts).toHaveLength(1); // Final spawn fence rejects before creating another child.
  });

  it("replays a durable Web input acknowledgement across reload without another native turn",async()=>{
    const f=await waitingFixture(),run=f.run(),url=`/api/agents/profiles/${run.profileId}/sessions/${run.sessionId}/input`,authority={runId:run.id,generation:run.generation,leaseId:run.leaseId,lastActivityAt:run.lastActivityAt,taskRevision:f.service.database.getCanonicalTask(f.taskId)!.revision};
    const request={headers:OWNER,method:"POST" as const,url,payload:{inputId:"web-input-1234",message:"approved",authority}};f.control.turn="running";
    const first=await f.service.app.inject(request);expect(first.statusCode).toBe(200);expect(first.json()).toMatchObject({receipt:{state:"ACCEPTED"}});expect(f.starts).toHaveLength(2);
    expect((await f.service.app.inject({...request,payload:{...request.payload,message:"changed"}})).json()).toMatchObject({code:"INPUT_IDEMPOTENCY_CONFLICT"});
    await f.service.stop();const restored=await f.make();const replay=await restored.app.inject(request);expect(replay.statusCode).toBe(200);expect(replay.json()).toMatchObject({repeated:true,receipt:{state:"ACCEPTED"}});expect(f.starts).toHaveLength(2);
    expect((await restored.app.inject({headers:OWNER,url:`/api/runs/${run.id}/inputs/web-input-1234`})).json()).toMatchObject({receipt:{state:"ACCEPTED"}});
  });

  it("collects normalized usage in the background without a console and preserves it across restart",async()=>{
    const f=await setup();await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${f.taskId}/dispatch`,payload:{}});const run=f.run(),adapter=(f.service as unknown as {agentAdapters:Map<string,AgentAdapter>}).agentAdapters.get(run.profileId)!;
    const usage=vi.fn(async()=>({state:"UNKNOWN",observations:[{version:1,eventId:"native-usage-1",profileId:run.profileId,runId:run.id,sessionId:run.sessionId,turnId:"turn-1",scope:"turn",mode:"snapshot",observedAt:f.control.now.toISOString(),source:"native-event",completeness:"complete",metrics:[{name:"input",value:"100",unit:"tokens"},{name:"output",value:"0",unit:"tokens"}]}]}));adapter.usage=usage;
    expect((await f.service.app.inject({headers:OWNER,url:`/api/usage?runId=${run.id}`})).json().observations).toEqual([]);await f.service.runBackgroundCycle();await f.service.runBackgroundCycle();
    const report=(await f.service.app.inject({headers:OWNER,url:`/api/usage?runId=${run.id}`})).json();expect(report.observations).toHaveLength(1);expect(report.totals).toContainEqual({profileId:run.profileId,scope:"turn",name:"output",unit:"tokens",value:"0"});expect(f.run().state).toBe("ACTIVE");expect(f.starts).toHaveLength(1);
    const calls=usage.mock.calls.length;expect((await f.service.app.inject({headers:OWNER,url:"/api/usage?from=invalid"})).statusCode).toBe(400);expect(usage.mock.calls.length).toBe(calls);
    await f.service.stop();const restored=await f.make();expect((await restored.app.inject({headers:OWNER,url:`/api/usage?runId=${run.id}`})).json().observations).toHaveLength(1);expect(f.starts).toHaveLength(1);
  });
  it("does not refresh old cached resource evidence into a new successful check",async()=>{
    const f=await setup();await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${f.taskId}/dispatch`,payload:{}});const run=f.run(),adapter=(f.service as unknown as {agentAdapters:Map<string,AgentAdapter>}).agentAdapters.get(run.profileId)!,checkedAt=new Date(f.control.now.getTime()-7*60*60_000).toISOString();adapter.usage=async()=>({state:"AVAILABLE",source:"event",confidence:"medium",checkedAt});await f.service.runBackgroundCycle();
    const report=(await f.service.app.inject({headers:OWNER,url:"/api/diagnostics"})).json();expect(report.entries).toContainEqual(expect.objectContaining({entityRef:{kind:"profile",id:run.profileId},category:"resources",status:"stale",observedAt:checkedAt}));
  });

  it("still stops a newly owned child if authority changes after the final spawn fence",async()=>{
    const f=await waitingFixture(),run=f.run();f.control.onStart=()=>f.service.database.saveEntity("run",run.id,JSON.parse(JSON.stringify({...run,state:"CANCELLED"})) as JsonValue);
    const response=await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/agents/profiles/${run.profileId}/sessions/${run.sessionId}/input`,payload:{inputId:"post-spawn-change",message:"continue",authority:{runId:run.id,generation:run.generation,leaseId:run.leaseId,lastActivityAt:run.lastActivityAt,taskRevision:f.service.database.getCanonicalTask(f.taskId)!.revision}}});
    expect(response.statusCode).toBe(409);expect(f.starts).toHaveLength(2);expect(f.control.cancellations).toBe(1);expect(f.run().state).toBe("CANCELLED");
  });

  it("retains uncertain input after a failed acknowledgement and never sends its retry again",async()=>{
    const f=await waitingFixture(),run=f.run(),agent=(f.service as unknown as {agentAdapters:Map<string,AgentAdapter>}).agentAdapters.get(run.profileId)!;const send=agent.send.bind(agent);
    agent.send=async(...args)=>{await send(...args);throw new Error("native acknowledgement lost");};
    const request={headers:OWNER,method:"POST" as const,url:`/api/agents/profiles/${run.profileId}/sessions/${run.sessionId}/input`,payload:{inputId:"unknown-input-123",message:"approved",authority:{runId:run.id,generation:run.generation,leaseId:run.leaseId,lastActivityAt:run.lastActivityAt,taskRevision:f.service.database.getCanonicalTask(f.taskId)!.revision}}};
    expect((await f.service.app.inject(request)).json()).toMatchObject({code:"INPUT_OUTCOME_UNKNOWN"});expect(f.run()).toMatchObject({state:"RUNNER_UNAVAILABLE",recoveryReason:"NATIVE_OUTCOME_UNKNOWN"});expect(f.starts).toHaveLength(2);expect((await f.service.app.inject(request)).json()).toMatchObject({code:"INPUT_OUTCOME_UNKNOWN"});
    expect((await f.service.app.inject({...request,payload:{...request.payload,inputId:"different-input-123"}})).json()).toMatchObject({code:"INPUT_OUTCOME_UNKNOWN"});expect(f.starts).toHaveLength(2);
  });

  it("fences cancellation after restart without falsely confirming a detached local process stopped",async()=>{
    const f=await setup();await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/tasks/${f.taskId}/dispatch`,payload:{}});const run=f.run();await f.service.stop();const restored=await f.make();
    await expect((restored as unknown as {cancelRunExecution(run:Run):Promise<Run>}).cancelRunExecution(f.run(restored))).rejects.toMatchObject({code:"SESSION_DETACHED"});
    expect(f.run(restored)).toMatchObject({state:"RUNNER_UNAVAILABLE",recoveryReason:"NATIVE_OUTCOME_UNKNOWN",revokedLeaseIds:[run.leaseId]});expect(f.control.cancellations).toBe(0);
  });

  it("projects the second WAITING_USER episode independently of the first", async () => {
    const f = await waitingFixture();
    f.control.turn = "running";
    await f.send(f.service, "answer-one", "continue");
    await f.service.runBackgroundCycle();
    f.control.turn = "waiting";
    await f.service.runBackgroundCycle();
    expect(f.run().state).toBe("WAITING_USER");
    expect(f.task().state).toBe("WAITING_USER");
  });

  it("rechecks run authority after awaiting agent input and preserves a renewed lease", async () => {
    const f = await waitingFixture();
    const agent = (f.service as unknown as { agentAdapters: Map<string, AgentAdapter> }).agentAdapters.get("orion")!;
    const original = agent.send.bind(agent);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    agent.send = async (...args) => { entered.resolve(); await release.promise; return original(...args); };
    f.control.turn = "running";
    await f.send(f.service, "held-answer", "continue");
    const cycle = f.service.runBackgroundCycle();
    try {
      await entered.promise;
      f.control.now = new Date(f.control.now.getTime() + 11 * 60_000);
      await f.service.events.publish("runnerChanged", f.service.runners.heartbeat("local", f.control.now.toISOString()));
      const renewed = f.run();
      f.service.database.saveEntity("run", renewed.id, JSON.parse(JSON.stringify({ ...renewed, state: "SUPERSEDED", generation: 2 })) as JsonValue);
      release.resolve();
      await cycle;
      expect(f.run()).toMatchObject({ state: "SUPERSEDED", generation: 2, leaseExpiresAt: renewed.leaseExpiresAt });
      expect(f.task().state).toBe("WAITING_USER");
      expect(f.control.cancellations).toBe(0);
      expect(f.starts).toHaveLength(1);
    } finally { release.resolve(); await cycle; }
  });

  it("keeps waiting runs within runner capacity", async () => {
    const f = await waitingFixture();
    const second = "task-second";
    const task = { ...f.task(), id: second, state: "READY", currentRunId: null };
    f.service.database.writeCanonicalTask(second, 0, JSON.parse(JSON.stringify(task)) as JsonValue);
    f.service.database.saveTaskContract(second, { ...(f.service.database.getTaskContract<JsonValue>(f.taskId) as Record<string, JsonValue>), taskId: second });
    const response = await f.service.app.inject({ headers: OWNER, method: "POST", url: `/api/tasks/${second}/dispatch`, payload: {} });
    expect(response.statusCode).toBe(409);
    expect(f.starts).toHaveLength(1);
    expect(f.service.database.listEntities("run")).toHaveLength(1);
  });

  it("preserves a concurrent comment and requires reconciliation after native startup loses its Task revision", async () => {
    const f = await setup();
    f.control.onStart = () => {
      const current = f.service.database.getCanonicalTask<JsonValue>(f.taskId)!;
      expect(f.task()).toMatchObject({ state: "QUEUED", currentRunId: f.run().id });
      expect(f.run().state).toBe("STARTING");
      f.service.tasks.execute({ id: "comment-during-start", taskId: f.taskId, baseRevision: current.revision, actor: "owner", command: { type: "task.comment", body: "Keep this comment" } });
    };
    const response = await f.service.app.inject({ headers: OWNER, method: "POST", url: `/api/tasks/${f.taskId}/dispatch`, payload: {} });
    expect(response.statusCode).toBe(409);
    expect(f.task()).toMatchObject({ state: "QUEUED", currentRunId: f.run().id });
    expect(f.run()).toMatchObject({state:"RUNNER_UNAVAILABLE",recoveryReason:"NATIVE_OUTCOME_UNKNOWN",resumePolicy:"manual"});
    expect(new InteractionStore(f.service.database).command(`native-start:${f.run().id}`)?.state).toBe("UNKNOWN");
    expect(f.starts).toHaveLength(1);expect(f.control.cancellations).toBe(0);
    expect(f.service.database.getInboxEvent("command:comment-during-start")?.normalized).toMatchObject({command:{type:"task.comment",body:"Keep this comment"}});
  });

  it("reports a closed PR and invalidates old CI evidence even when the CI read is unavailable", async () => {
    const f = await setup({ doneOnCiPassed: true });
    await f.service.app.inject({ headers: OWNER, method: "POST", url: `/api/tasks/${f.taskId}/dispatch`, payload: {} });
    f.control.turn = "completed";
    f.control.ci = "success";
    await f.service.runBackgroundCycle();
    f.control.prState = "closed";
    f.control.headCommit = "commit-2";
    f.control.ciFailures = 1;
    f.control.now = new Date(f.control.now.getTime() + 60_000);
    await f.service.runBackgroundCycle();
    expect(f.service.database.listDeliveryEvidence(f.taskId)).toContainEqual(expect.objectContaining({ kind: "pull-request", state: "FAILED", metadata: expect.objectContaining({ headCommit: "commit-2" }) }));
    expect(f.service.database.listDeliveryEvidence(f.taskId)).toContainEqual(expect.objectContaining({ kind: "ci", state: "PENDING", externalId: "commit-2" }));
    expect(f.service.database.listDeliveryEvidence(f.taskId).find((entry) => entry.kind === "ci")).not.toHaveProperty("url");
    expect(f.slack.some((body) => String(body.text).includes("PR_CLOSED"))).toBe(true);
  });

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
    expect(f.control.cancellations).toBe(1);
    expect(f.control.prs).toBe(0);
  });

  it("preserves heartbeat renewal while an asynchronous delivery holds an older run snapshot", async () => {
    const f = await setup();
    await f.service.app.inject({ headers: OWNER, method: "POST", url: `/api/tasks/${f.taskId}/dispatch`, payload: {} });
    const release = Promise.withResolvers<void>();
    f.control.pushGate = release.promise;
    f.control.turn = "completed";
    const cycle = f.service.runBackgroundCycle();
    try {
      await expect.poll(() => f.control.pushes).toBe(1);
      f.control.now = new Date(f.control.now.getTime() + 11 * 60_000);
      await f.service.events.publish("runnerChanged", f.service.runners.heartbeat("local", f.control.now.toISOString()));
      const renewedExpiry = f.run().leaseExpiresAt;
      release.resolve();
      await cycle;
      expect(f.run()).toMatchObject({ state: "COMPLETE", leaseExpiresAt: renewedExpiry });
    } finally {
      release.resolve();
      await cycle;
    }
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

  it("keeps pending CI in review, feeds failures to Linear/Slack, retries Slack, and converges after restart", async () => {
    const f = await setup({ doneOnCiPassed: true });
    await f.send(f.service, "dispatch", "task dispatch INH-42");
    await f.service.runBackgroundCycle();
    await f.approve();
    f.control.turn = "completed";
    await f.service.runBackgroundCycle();
    expect(f.run().state).toBe("COMPLETE");
    expect(f.task().state).toBe("REVIEW");
    expect(f.control.prs).toBe(1);
    expect(f.linear.some((body) => (body.variables as { input?: { stateId?: string } }).input?.stateId === "in-review")).toBe(true);
    f.control.ci = "failure";
    f.control.slackFailures = 1;
    f.control.now = new Date(f.control.now.getTime() + 60_000);
    await f.service.runBackgroundCycle();
    expect(f.task().state).toBe("REVIEW");
    expect(f.service.database.listDeliveryEvidence(f.taskId)).toContainEqual(expect.objectContaining({ kind: "ci", state: "FAILED" }));
    expect(f.linear.some((body) => String((body.variables as { input?: { body?: string } }).input?.body).includes("CI_FAILED"))).toBe(true);
    f.control.now = new Date(f.control.now.getTime() + 60_000);
    await f.service.runBackgroundCycle();
    expect(f.slack.some((body) => body.channel === "C1" && body.thread_ts === "100.1" && String(body.text).includes("CI_FAILED"))).toBe(true);
    const commentsBefore = f.linear.filter((body) => String(body.query).includes("commentCreate")).length;
    await f.service.stop();
    const restored = await f.make();
    f.control.ci = "success";
    f.control.now = new Date(f.control.now.getTime() + 60_000);
    await restored.runBackgroundCycle();
    expect(f.task(restored).state).toBe("DONE");
    expect(f.control.prs).toBe(1);
    expect(f.control.pushes).toBe(1);
    expect(f.slack.some((body) => body.thread_ts === "100.1" && String(body.text).includes("CI_PASSED"))).toBe(true);
    expect(f.linear.filter((body) => String(body.query).includes("commentCreate")).length).toBe(commentsBefore + 1);
  });

  it("persists PR evidence even if the initial CI read fails and leaves passed CI in review by default", async () => {
    const f = await setup();
    const dispatched = await f.service.app.inject({ headers: OWNER, method: "POST", url: `/api/tasks/${f.taskId}/dispatch`, payload: {} });
    expect(dispatched.statusCode).toBe(201);
    f.control.turn = "completed";
    f.control.ciFailures = 1;
    await f.service.runBackgroundCycle();
    expect(f.run().state).toBe("COMPLETE");
    expect(f.service.database.listDeliveryEvidence(f.taskId)).toContainEqual(expect.objectContaining({ kind: "pull-request", externalId: "7" }));
    f.control.ci = "success";
    f.control.now = new Date(f.control.now.getTime() + 60_000);
    await f.service.runBackgroundCycle();
    expect(f.task().state).toBe("REVIEW");
    expect(f.control.prs).toBe(1);
    expect(f.control.pushes).toBe(1);
    f.control.headCommit = "commit-2";
    f.control.ci = "pending";
    f.control.now = new Date(f.control.now.getTime() + 60_000);
    await f.service.runBackgroundCycle();
    expect(f.service.database.listDeliveryEvidence(f.taskId)).toContainEqual(expect.objectContaining({ kind: "ci", externalId: "commit-2", state: "PENDING" }));
    f.control.prState = "closed";
    f.control.now = new Date(f.control.now.getTime() + 60_000);
    await f.service.runBackgroundCycle();
    expect(f.slack.some((body) => String(body.text).includes("PR_CLOSED"))).toBe(true);
  });

  it("blocks PR delivery on verification failure and reports the failure to Linear and Slack", async () => {
    const f = await setup({ verificationFails: true });
    await f.send(f.service, "dispatch", "task dispatch INH-42");
    await f.service.runBackgroundCycle();
    await f.approve();
    f.control.turn = "completed";
    await f.service.runBackgroundCycle();
    expect(f.run()).toMatchObject({ state: "FAILED", verification: { state: "FAILED" } });
    expect(f.control.prs).toBe(0);
    expect(f.slack.some((body) => String(body.text).includes("Required verification failed"))).toBe(true);
    expect(f.linear.some((body) => String((body.variables as { input?: { body?: string } }).input?.body).includes("Required verification failed"))).toBe(true);
  });
});
