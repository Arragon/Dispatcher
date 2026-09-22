import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ExternalBinding, Run, Task } from "@dispatcher/domain";
import { DispatcherDatabase } from "@dispatcher/persistence";
import {
  CanonicalTaskService,
  ConnectorError,
  ConnectorRegistry,
  DeliveryService,
  FakeScmConnector,
  FakeMessagingConnector,
  FakeTaskConnector,
  LinearTaskConnector,
  ProjectionWorker,
  assertDeliveryGate,
  mergeExternalChanges,
  planTaskPlatformSwitch,
  runScmContract,
  runMessagingContract,
  runTaskPlatformContract,
  type DeliveryRequest,
  type TaskDraft,
  type TaskFieldMapping,
} from "../src/index.js";

function draft(overrides: Partial<TaskDraft> = {}): TaskDraft {
  return {
    externalId: "external-1",
    externalRevision: "r1",
    title: "Task",
    labels: [],
    dependencies: [],
    repository: "acme/repo",
    scope: ["change code"],
    acceptanceCriteria: ["works"],
    verification: ["pnpm test"],
    constraints: [],
    extensions: { provider: { cycle: "opaque" } },
    ...overrides,
  };
}

function binding(connectorInstanceId = "fake-task-main"): ExternalBinding {
  return {
    id: `${connectorInstanceId}:external-1`,
    canonicalEntityId: "task-1",
    connectorInstanceId,
    entityType: "task",
    externalId: "external-1",
    externalRevision: "r1",
    projectionState: "SYNCED",
    updatedAt: "2026-09-22T00:00:00.000Z",
  };
}

function task(bindings = [binding()]): Task {
  return {
    id: "task-1",
    projectId: "project-1",
    title: "Task",
    description: "Description",
    state: "READY",
    revision: 1,
    bindings,
    createdAt: "2026-09-22T00:00:00.000Z",
    updatedAt: "2026-09-22T00:00:00.000Z",
  };
}

describe("connector contracts", () => {
  it("runs the reusable messaging compliance kit without network access", async () => {
    const connector = new FakeMessagingConnector();
    expect(await runMessagingContract(connector)).toEqual([]);
    expect(connector.sent).toHaveLength(1);
  });

  it("runs the reusable task platform compliance kit without network access", async () => {
    const connector = new FakeTaskConnector();
    connector.tasks.set("contract-task", draft({ externalId: "contract-task" }));
    expect(await runTaskPlatformContract(connector)).toEqual([]);
    expect(connector.projections).toHaveLength(1);
  });

  it("rejects a connector that lies about required capabilities", async () => {
    const connector = new FakeTaskConnector(undefined, {
      apiVersion: 1,
      id: "task.fake",
      kind: "task",
      displayName: "Broken",
      capabilities: [],
    });
    expect(await runTaskPlatformContract(connector)).toEqual(expect.arrayContaining(["missing task.ingress", "missing task.reconcile"]));
  });

  it("keeps concurrent common-field conflicts explicit", () => {
    const mapping: TaskFieldMapping = { ownership: { title: "merge", labels: "external" }, statuses: {}, priorities: {}, users: {} };
    const result = mergeExternalChanges({
      base: { title: "old", labels: ["old"] },
      canonical: { title: "canonical", labels: ["old"] },
      external: { title: "external", labels: ["new"] },
      mapping,
    });
    expect(result.conflicts).toEqual(["title"]);
    expect(result.merged.labels).toEqual(["new"]);
  });
});

describe("canonical task transaction and projection", () => {
  it("deduplicates commands, rejects stale revisions, and survives connector outages", async () => {
    const db = new DispatcherDatabase(":memory:");
    const connector = new FakeTaskConnector();
    const registry = new ConnectorRegistry();
    registry.register(connector);
    const service = new CanonicalTaskService(db);
    const created = service.execute({ id: "create-1", taskId: "task-1", baseRevision: 0, actor: "test", command: { type: "task.create", task: task() } });
    expect(created.revision).toBe(1);
    const duplicate = service.execute({ id: "create-1", taskId: "task-1", baseRevision: 0, actor: "test", command: { type: "task.create", task: task() } });
    expect(duplicate.duplicate).toBe(true);
    expect(() => service.execute({ id: "stale", taskId: "task-1", baseRevision: 0, actor: "test", command: { type: "task.update", changes: { title: "stale" } } })).toThrow(/revision conflict/i);
    connector.healthFailure = new ConnectorError("TEMPORARY", "offline", { retryable: true });
    const worker = new ProjectionWorker(db, registry, { baseBackoffMs: 10 });
    expect(await worker.drain(new Date("2026-09-23T00:00:00.000Z"))).toMatchObject({ retried: 1 });
    expect(db.getCanonicalTask("task-1")?.document).toMatchObject({ title: "Task" });
    connector.healthFailure = undefined;
    expect(await worker.drain(new Date("2026-09-24T00:00:00.000Z"))).toMatchObject({ delivered: 1 });
    expect(connector.projections).toHaveLength(1);
    db.close();
  });

  it("supports dual projection without changing canonical identity", async () => {
    const db = new DispatcherDatabase(":memory:");
    const first = new FakeTaskConnector();
    const second = new FakeTaskConnector({ ...first.instance, id: "fake-task-secondary", displayName: "Secondary" });
    const registry = new ConnectorRegistry();
    registry.register(first);
    registry.register(second);
    const service = new CanonicalTaskService(db);
    const bindings = [binding(first.instance.id), binding(second.instance.id)];
    service.execute({ id: "dual-create", taskId: "task-1", baseRevision: 0, actor: "test", command: { type: "task.create", task: task(bindings) } });
    await new ProjectionWorker(db, registry).drain(new Date("2026-09-23T00:00:00.000Z"));
    expect(first.projections[0]?.projection.canonicalTaskId).toBe("task-1");
    expect(second.projections[0]?.projection.canonicalTaskId).toBe("task-1");
    expect(db.getCanonicalTask("task-1")?.revision).toBe(1);
    db.close();
  });

  it("dry-runs and switches task platforms without changing execution or delivery identity", async () => {
    const db = new DispatcherDatabase(":memory:");
    const linear = new FakeTaskConnector({ ...new FakeTaskConnector().instance, id: "linear-main", displayName: "Linear fixture" });
    const secondary = new FakeTaskConnector({ ...linear.instance, id: "fake-task-secondary", displayName: "Secondary" });
    const registry = new ConnectorRegistry();
    registry.register(linear);
    registry.register(secondary);
    const service = new CanonicalTaskService(db);
    const initial = task([binding(linear.instance.id), binding(secondary.instance.id)]);
    initial.currentRunId = "run-1";
    initial.dueAt = "2026-09-30T00:00:00.000Z";
    initial.origin = { source: "connector", connectorInstanceId: linear.instance.id };
    initial.platformExtensions = { linear: { cycle: "opaque" } };
    service.execute({ id: "portable-create", taskId: initial.id, baseRevision: 0, actor: "test", command: { type: "task.create", task: initial } });
    const contract = { version: 1, revision: 1, goal: "Portable", scope: ["src"], acceptanceCriteria: ["works"], verification: ["check"], constraints: [], delivery: { type: "pull-request", repository: "acme/repo" } };
    const run = { id: "run-1", taskId: initial.id, state: "ACTIVE", profileId: "orion" };
    const evidence = { id: "evidence-1", taskId: initial.id, runId: "run-1", connectorInstanceId: "github", kind: "pull-request", externalId: "7", state: "READY" };
    db.saveTaskContract(initial.id, contract);
    db.saveEntity("run", "run-1", run);
    db.saveDeliveryEvidence({ id: evidence.id, taskId: initial.id, runId: "run-1", connectorInstanceId: "github", kind: "pull-request", externalId: "7", document: evidence, updatedAt: "2026-09-22T00:00:00.000Z" });
    await new ProjectionWorker(db, registry).drain(new Date("2026-09-23T00:00:00.000Z"));
    expect(linear.projections).toHaveLength(1);
    expect(secondary.projections).toHaveLength(1);

    const current = db.getCanonicalTask(initial.id)!;
    const mapping: TaskFieldMapping = { ownership: { title: "external", status: "external" }, statuses: {}, priorities: {}, users: {} };
    const plan = planTaskPlatformSwitch({
      task: current.document as Task,
      targetDefinition: secondary.definition,
      targetConnectorInstanceId: secondary.instance.id,
      targetExternalId: "secondary-1",
      mapping,
      supportedFields: ["title", "status", "labels"],
      now: "2026-09-22T01:00:00.000Z",
    });
    expect(plan).toMatchObject({ taskId: initial.id, canSwitch: true, sourceConnectorInstanceId: linear.instance.id, targetConnectorInstanceId: secondary.instance.id });
    expect(plan.unmappableFields.map((entry) => entry.field)).toEqual(expect.arrayContaining(["description", "dueAt", "platformExtensions.linear"]));
    const switched = service.execute({
      id: "switch-primary",
      taskId: initial.id,
      baseRevision: current.revision,
      actor: "test",
      command: { type: "task.switch-primary", targetBinding: plan.targetBinding },
    });
    expect(switched.task).toMatchObject({ id: initial.id, currentRunId: "run-1", origin: { connectorInstanceId: secondary.instance.id } });

    const fakeUpdate = await secondary.ingress(new TextEncoder().encode(JSON.stringify({ id: "secondary-update", task: draft({ externalId: "secondary-1", title: "Updated without Linear", externalRevision: "r2" }) })), {});
    const updated = service.applyExternalEvent(fakeUpdate, {
      id: "secondary-update",
      taskId: initial.id,
      baseRevision: switched.revision,
      actor: "connector:fake-task-secondary",
      sourceBinding: { ...plan.targetBinding, externalRevision: "r2", projectionState: "SYNCED" },
      command: { type: "task.update", changes: { title: "Updated without Linear" } },
    }, mapping);
    expect(updated.task).toMatchObject({ id: initial.id, currentRunId: "run-1", title: "Updated without Linear" });
    expect(db.getTaskContract(initial.id)).toEqual(contract);
    expect(db.getEntity("run", "run-1")).toEqual(run);
    expect(db.listDeliveryEvidence(initial.id)).toEqual([evidence]);
    db.close();
  });

  it("dead-letters permanent projection failures and supports an explicit retry", async () => {
    const db = new DispatcherDatabase(":memory:");
    const connector = new FakeTaskConnector();
    connector.healthFailure = new ConnectorError("PERMANENT", "invalid remote state", { retryable: false });
    const registry = new ConnectorRegistry();
    registry.register(connector);
    new CanonicalTaskService(db).execute({ id: "dead-create", taskId: "task-1", baseRevision: 0, actor: "test", command: { type: "task.create", task: task() } });
    const worker = new ProjectionWorker(db, registry);
    expect(await worker.drain(new Date("2026-09-23T00:00:00.000Z"))).toMatchObject({ dead: 1 });
    const [letter] = db.listDeadLetters();
    expect(letter).toMatchObject({ connectorInstanceId: connector.instance.id, source: "outbox", reason: "PERMANENT" });
    connector.healthFailure = undefined;
    expect(db.retryDeadLetter(letter!.id, "2026-09-24T00:00:00.000Z")).toBe(true);
    expect(await worker.drain(new Date("2026-09-24T00:00:00.000Z"))).toMatchObject({ delivered: 1 });
    expect(db.listDeadLetters()).toEqual([]);
    db.close();
  });
});

describe("Linear webhook boundary", () => {
  it("rejects forged and expired payloads and normalizes one valid event", async () => {
    const secret = "webhook-secret";
    const connector = new LinearTaskConnector({
      instance: { id: "linear-main", definitionId: "task.linear", kind: "task", displayName: "Linear", enabled: true, health: "HEALTHY", revision: 1, updatedAt: "2026-09-22T00:00:00.000Z" },
      credentialRef: "secret://linear/token",
      webhookSecretRef: "secret://linear/webhook",
      resolveSecret: async (reference) => reference.endsWith("webhook") ? secret : "token",
      fetch: async () => new Response(JSON.stringify({ data: { viewer: { id: "me" } } }), { status: 200 }),
    });
    const now = new Date("2026-09-22T10:00:00.000Z");
    const raw = new TextEncoder().encode(JSON.stringify({ webhookId: "wh-1", type: "Issue", action: "update", createdAt: now.toISOString(), data: { id: "issue-1", title: "Safe", updatedAt: now.toISOString() } }));
    const signature = createHmac("sha256", secret).update(raw).digest("hex");
    await expect(connector.ingress(raw, { "linear-signature": "00" }, now)).rejects.toMatchObject({ code: "INVALID_EVENT" });
    await expect(connector.ingress(raw, { "linear-signature": signature }, new Date(now.getTime() + 10 * 60_000))).rejects.toMatchObject({ code: "INVALID_EVENT" });
    await expect(connector.ingress(raw, { "linear-signature": signature }, now)).resolves.toMatchObject({ externalEventId: "wh-1", externalEntityId: "issue-1", idempotencyKey: "linear-main:wh-1" });
  });
});

describe("SCM delivery contract", () => {
  function request(): DeliveryRequest {
    const run: Run = {
      id: "run-1", taskId: "task-1", runnerId: "runner", providerId: "codex", profileId: "profile", sessionId: "session",
      state: "DELIVERING", attempt: 1, generation: 2, leaseId: "lease-2", verification: { state: "PASSED", commands: ["pnpm test"] },
    };
    return {
      idempotencyKey: "delivery-1", taskId: "task-1", run, currentGeneration: 2, currentLeaseId: "lease-2",
      repository: { owner: "acme", name: "repo" }, headBranch: "codex/task-1", baseBranch: "main", title: "Deliver", body: "Evidence", verification: run.verification,
    };
  }

  it("prevents unverified and stale runs from delivery", () => {
    const unverified = request();
    unverified.verification = { state: "FAILED", commands: [] };
    expect(() => assertDeliveryGate(unverified)).toThrow(/verification/i);
    const stale = request();
    stale.currentGeneration = 3;
    expect(() => assertDeliveryGate(stale)).toThrow(/stale/i);
  });

  it("does not create duplicate pull requests on retry", async () => {
    const connector = new FakeScmConnector();
    expect(await runScmContract(connector, request())).toEqual([]);
    expect(connector.pullRequests).toHaveLength(1);
  });

  it("rechecks lease authority at every mutating delivery boundary", async () => {
    const database = new DispatcherDatabase(":memory:");
    const operations: string[] = [];
    const input = request();
    input.assertAuthority = (operation) => operations.push(operation);
    await new DeliveryService(database).deliver(new FakeScmConnector(), input);
    expect(operations).toEqual(["branch", "push", "pull-request", "complete"]);
    database.close();
  });
});
