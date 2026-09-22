import { describe, expect, it } from "vitest";
import { GenericMockAdapter } from "@dispatcher/adapters";
import { CanonicalScheduler, routeDeterministically, type DispatchCandidate } from "../src/index.js";

function candidate(overrides: Partial<DispatchCandidate> = {}): DispatchCandidate {
  return {
    runnerId: "runner-b", runnerTags: ["personal"], capacity: 2, activeRuns: 0,
    providerId: "codex", profileId: "profile-b", resourceState: "AVAILABLE", capabilities: ["code", "git"], adapter: new GenericMockAdapter(),
    ...overrides,
  };
}

describe("canonical deterministic scheduler", () => {
  it("filters capacity, resource, capability and picks a stable identity", () => {
    const decision = routeDeterministically({ capabilities: ["code"], runnerTags: ["personal"] }, [
      candidate(),
      candidate({ runnerId: "runner-a", profileId: "profile-a" }),
      candidate({ runnerId: "runner-c", profileId: "profile-c", resourceState: "QUOTA_EXHAUSTED" }),
      candidate({ runnerId: "runner-d", profileId: "profile-d", resourceState: "RATE_LIMITED" }),
    ]);
    expect(decision.selected).toMatchObject({ runnerId: "runner-a", profileId: "profile-a" });
    expect(decision.rejected[0]?.reasons).toContain("resource state QUOTA_EXHAUSTED");
    expect(decision.rejected[1]?.reasons).toContain("resource state RATE_LIMITED");
  });

  it("selects a runner by OS and native capability without importing platform code", () => {
    const decision = routeDeterministically({ capabilities: ["code", "os:win32", "pty:conpty"] }, [
      candidate({ runnerId: "mac", profileId: "mac-profile", capabilities: ["code", "os:darwin", "pty:unix-pty"] }),
      candidate({ runnerId: "windows", profileId: "windows-profile", capabilities: ["code", "os:win32", "pty:conpty"] }),
    ]);
    expect(decision.selected).toMatchObject({ runnerId: "windows" });
    expect(decision.rejected[0]?.reasons).toEqual(expect.arrayContaining(["missing capability os:win32", "missing capability pty:conpty"]));
  });

  it("binds task and contract revisions to the run", async () => {
    const scheduler = new CanonicalScheduler(() => [candidate({ runnerId: "runner-a", profileId: "profile-a" })]);
    const result = await scheduler.dispatch({
      task: { id: "task-1", projectId: "project", title: "Task", state: "READY", createdAt: "2026-09-22T00:00:00.000Z", updatedAt: "2026-09-22T00:00:00.000Z" },
      taskRevision: 3,
      contract: { version: 1, revision: 2, goal: "Do it", scope: ["src"], acceptanceCriteria: ["passes"], verification: ["pnpm test"], constraints: [], delivery: { type: "pull-request", repository: "acme/repo" } },
      requirements: { capabilities: ["code"] },
      workspacePath: "/tmp/worktree",
    });
    expect(result.run).toMatchObject({ taskId: "task-1", taskRevision: 3, contractRevision: 2, state: "ACTIVE", runnerId: "runner-a" });
  });
});
