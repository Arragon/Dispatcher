import { describe, expect, it } from "vitest";
import { TaskContractCompiler } from "../src/index.js";
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

