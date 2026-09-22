import { describe, expect, it } from "vitest";
import { EntityResolver, MemorySemanticWorkflowStore, SemanticPolicyError, SemanticToolRegistry, SemanticWorkflowEngine, TaskContractCompiler, parseFixedCommand } from "../src/index.js";
import type { TaskDraft } from "@dispatcher/integrations";

function draft(overrides: Partial<TaskDraft> = {}): TaskDraft {
  return {
    externalId: "external-1",
    title: "Implement the task",
    labels: [], dependencies: [], repository: "acme/repo", scope: ["src"],
    acceptanceCriteria: ["passes"], verification: ["pnpm test"], constraints: [], extensions: {},
    ...overrides,
  };
}

describe("TaskContractCompiler", () => {
  it("compiles platform-neutral drafts with explicit contract revisions", () => {
    expect(new TaskContractCompiler().compile(draft(), 4)).toMatchObject({
      state: "READY",
      contract: { version: 1, revision: 4, goal: "Implement the task", delivery: { type: "pull-request", repository: "acme/repo", baseBranch: "main" } },
    });
  });

  it("routes incomplete drafts to NEEDS_SPEC instead of execution", () => {
    expect(new TaskContractCompiler().compile(draft({ repository: undefined, scope: [], acceptanceCriteria: [], verification: [] }))).toEqual({
      state: "NEEDS_SPEC",
      missing: ["repository", "scope", "acceptanceCriteria", "verification"],
    });
  });
});

describe("semantic controller v2", () => {
  const principal = { id: "admin", roles: ["admin"], channel: "web" as const };

  it("rejects non-allowlisted tools, literal secrets and unconfirmed privileged writes", async () => {
    const tools = new SemanticToolRegistry();
    tools.register({ name: "config.apply", description: "Apply ConfigPlan", risk: "privileged", requiredRoles: ["admin"], input: { required: ["planId"], properties: { planId: "string", token: "string" }, additionalProperties: false }, execute: async () => ({ applied: true }) });
    await expect(tools.execute("shell.exec", {}, { principal, workflowId: "wf-x", confirmed: true })).rejects.toMatchObject({ code: "TOOL_NOT_ALLOWED" });
    await expect(tools.execute("config.apply", { planId: "p1", token: "sk-not-safe-12345678" }, { principal, workflowId: "wf-x", confirmed: true })).rejects.toMatchObject({ code: "SECRET_BLOCKED" });
    await expect(tools.execute("config.apply", { planId: "p1" }, { principal, workflowId: "wf-x", confirmed: false })).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    expect(tools.events()).toHaveLength(3);
  });

  it("clarifies ambiguous entities and persists approval revisions", async () => {
    const tools = new SemanticToolRegistry();
    tools.register({ name: "task.cancel", description: "Cancel task", risk: "privileged", input: { required: ["target"], properties: { target: "string" }, additionalProperties: false }, execute: async ({ target }) => ({ cancelled: target }) });
    const store = new MemorySemanticWorkflowStore();
    const engine = new SemanticWorkflowEngine(tools, store);
    const intent = { version: 2 as const, action: "task.cancel", entities: [{ kind: "task" as const, value: "ship" }], arguments: { target: "task-1" }, confidence: 0.9, source: "assistant" as const };
    const ambiguous = engine.plan({ id: "wf-1", intent, principal, candidates: [{ id: "task-1", kind: "task", label: "Ship API" }, { id: "task-2", kind: "task", label: "Ship UI" }] });
    expect(ambiguous.state).toBe("NEEDS_CLARIFICATION");
    const clarified = engine.clarify("wf-1", 1, { ...intent, entities: [{ kind: "task", value: "task-1" }] }, [{ id: "task-1", kind: "task", label: "Ship API" }]);
    expect(clarified).toMatchObject({ state: "NEEDS_APPROVAL", revision: 2 });
    expect(() => engine.approve("wf-1", 1)).toThrow(SemanticPolicyError);
    const approved = engine.approve("wf-1", clarified.revision);
    await expect(engine.execute("wf-1", clarified.revision)).rejects.toBeInstanceOf(SemanticPolicyError);
    expect((await engine.execute("wf-1", approved.revision)).state).toBe("EXECUTED");
  });

  it("rejects unknown tools before persisting an executable workflow", () => {
    const engine = new SemanticWorkflowEngine(new SemanticToolRegistry(), new MemorySemanticWorkflowStore());
    expect(() => engine.plan({ id: "wf-unknown", principal, intent: { version: 2, action: "shell.exec", entities: [], arguments: {}, confidence: 1, source: "assistant" } })).toThrowError(SemanticPolicyError);
  });

  it("resolves aliases deterministically and parses fixed commands without an LLM", () => {
    const resolution = new EntityResolver().resolve({ kind: "profile", value: "main" }, [{ id: "profile-1", kind: "profile", label: "Codex primary", aliases: ["main"] }]);
    expect(resolution).toMatchObject({ status: "RESOLVED", matches: [{ id: "profile-1" }] });
    expect(parseFixedCommand("/task status INH-42")).toMatchObject({ action: "task.status", confidence: 1, source: "fixed-command" });
    expect(parseFixedCommand("/run reroute run-1 qoder-main")).toMatchObject({ action: "run.reroute", arguments: { target: "run-1", profileId: "qoder-main" } });
  });
});
