import { describe, expect, it } from "vitest";
import {
  InvalidStateTransitionError,
  assertRunTransition,
  assertTaskTransition,
  domainContractSchema,
  isTerminalRunState,
  negotiateCapabilities,
  upgradeLegacyTask,
} from "../src/index.js";

describe("domain state contracts", () => {
  it.each([
    ["READY", "QUEUED"],
    ["RUNNING", "WAITING_RESOURCE"],
    ["WAITING_RESOURCE", "RUNNING"],
    ["VERIFYING", "REVIEW"],
  ] as const)("accepts task transition %s -> %s", (from, to) => {
    expect(() => assertTaskTransition(from, to)).not.toThrow();
  });

  it.each([
    ["ACTIVE", "RESOURCE_BLOCKED"],
    ["RESOURCE_BLOCKED", "ACTIVE"],
    ["VERIFYING", "DELIVERING"],
    ["DELIVERING", "COMPLETE"],
  ] as const)("accepts run transition %s -> %s", (from, to) => {
    expect(() => assertRunTransition(from, to)).not.toThrow();
  });

  it("rejects an illegal transition with a classified error", () => {
    expect(() => assertRunTransition("COMPLETE", "ACTIVE")).toThrow(InvalidStateTransitionError);
  });

  it("keeps resource blocking distinct from failure", () => {
    expect(isTerminalRunState("RESOURCE_BLOCKED")).toBe(false);
    expect(isTerminalRunState("FAILED")).toBe(true);
  });

  it("publishes stable JSON schema identifiers", () => {
    expect(domainContractSchema.$id).toContain("domain-v1");
    expect(domainContractSchema.$defs.runState.enum).toContain("SUPERSEDED");
  });

  it("negotiates versioned connector capabilities without provider-specific types", () => {
    const result = negotiateCapabilities({
      id: "task.example",
      kind: "task",
      displayName: "Example",
      apiVersion: 1,
      capabilities: [{ namespace: "task.read", version: 1, support: "supported" }],
    }, [
      { namespace: "task.read", minimumVersion: 1, required: true },
      { namespace: "task.future", minimumVersion: 1 },
      { namespace: "task.write", minimumVersion: 1, required: true },
    ]);
    expect(result.accepted.map((entry) => entry.namespace)).toEqual(["task.read"]);
    expect(result.rejected).toEqual(["task.write"]);
  });

  it("upgrades a legacy task without changing its canonical id", () => {
    const task = upgradeLegacyTask({
      id: "task-1",
      projectId: "project-1",
      linearIssueId: "INH-1",
      title: "Legacy",
      state: "READY",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    });
    expect(task.id).toBe("task-1");
    expect(task.revision).toBe(1);
    expect(task.bindings).toEqual([expect.objectContaining({ externalId: "INH-1", canonicalEntityId: "task-1" })]);
  });
});
