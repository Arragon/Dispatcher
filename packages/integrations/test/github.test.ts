import { describe, expect, it } from "vitest";
import { GitHubScmConnector } from "../src/github.js";

function connector(status: Record<string, unknown>, pages: Array<Record<string, unknown>>) {
  const paths: string[] = [];
  const adapter = new GitHubScmConnector({
    instance: { id: "github", definitionId: "scm.github", kind: "scm", displayName: "GitHub", enabled: true, health: "HEALTHY", revision: 1, updatedAt: new Date(0).toISOString() },
    credentialRef: "secret://github/token", resolveSecret: async () => "fixture-token",
    transport: { ensureBranch: async () => undefined, push: async () => ({ commit: "abc" }) },
    fetch: async (input) => {
      const url = new URL(String(input));
      paths.push(url.pathname + url.search);
      const value = url.pathname.endsWith("/status") ? status : pages[Number(url.searchParams.get("page") ?? "1") - 1];
      if (!value) throw new Error("Unexpected page");
      return new Response(JSON.stringify(value));
    },
  });
  return { adapter, paths };
}

describe("GitHub CI aggregation", () => {
  it.each([
    { statuses: { state: "pending", total_count: 0, statuses: [] }, checks: [], want: "PENDING" },
    { statuses: { state: "pending", total_count: 0, statuses: [] }, checks: [{ status: "completed", conclusion: "success" }], want: "PASSED" },
    { statuses: { state: "success", total_count: 1, statuses: [{ state: "success" }] }, checks: [{ status: "in_progress", conclusion: null }], want: "PENDING" },
    { statuses: { state: "success", total_count: 1, statuses: [{ state: "success" }] }, checks: [{ status: "completed", conclusion: "failure" }], want: "FAILED" },
    { statuses: { state: "failure", total_count: 1, statuses: [{ state: "failure" }] }, checks: [{ status: "queued", conclusion: null }], want: "FAILED" },
    { statuses: { state: "pending", total_count: 1, statuses: [{ state: "pending" }] }, checks: [{ status: "completed", conclusion: "success" }], want: "PENDING" },
    { statuses: { state: "pending", total_count: 0, statuses: [] }, checks: [{ status: "completed", conclusion: "cancelled" }], want: "FAILED" },
    { statuses: { state: "pending", total_count: 0, statuses: [] }, checks: [{ status: "completed", conclusion: "neutral" }, { status: "completed", conclusion: "skipped" }], want: "PASSED" },
    { statuses: { state: "pending", total_count: 0, statuses: [] }, checks: [{ status: "completed", conclusion: "unexpected" }], want: "PENDING" },
  ])("combines statuses and Checks conservatively: $want ($checks)", async ({ statuses, checks, want }) => {
    const { adapter } = connector(statuses, [{ total_count: checks.length, check_runs: checks }]);
    expect((await adapter.getCiStatus({ owner: "acme", name: "repo" }, "abc")).state).toBe(want);
  });

  it("includes check runs on later pages", async () => {
    const { adapter, paths } = connector({ state: "pending", total_count: 0, statuses: [] }, [
      { total_count: 101, check_runs: Array.from({ length: 100 }, () => ({ status: "completed", conclusion: "success" })) },
      { total_count: 101, check_runs: [{ status: "completed", conclusion: "timed_out" }] },
    ]);
    expect((await adapter.getCiStatus({ owner: "acme", name: "repo" }, "abc")).state).toBe("FAILED");
    expect(paths).toContain("/repos/acme/repo/commits/abc/check-runs?filter=latest&per_page=100&page=2");
  });
});
