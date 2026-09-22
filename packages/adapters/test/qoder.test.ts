import { describe, expect, it } from "vitest";
import { QoderAdapter, normalizeQoderError, normalizeQoderEvent, qoderAuthenticationDiagnostic, runAdapterContract, type QoderBackend, type QoderTurnResult } from "../src/index.js";

function completed(events: QoderTurnResult["events"] = []): QoderTurnResult {
  return { state: "completed", summary: "done", events };
}

describe("Qoder adapter", () => {
  it("uses one explicit provider session for start, send and resume", async () => {
    const starts: Parameters<QoderBackend["start"]>[0][] = [];
    const backend: QoderBackend = { start: (input) => {
      starts.push(input);
      return { cancel: async () => undefined, status: () => "completed", result: async () => completed() };
    } };
    const adapter = new QoderAdapter({ id: "alice", alias: "Alice", executable: "/opt/qoder" }, backend);
    const session = await adapter.start({ runId: "run-1", workspacePath: "/worktree", prompt: "first" });
    await adapter.send(session.id, "second");
    expect(starts).toHaveLength(2);
    expect(starts[0]).toMatchObject({ providerSessionId: session.providerSessionId, resume: false, prompt: "first" });
    expect(starts[1]).toMatchObject({ providerSessionId: session.providerSessionId, resume: true, prompt: "second" });
    expect(await adapter.diagnostics(session.id)).toMatchObject({ alias: "Alice", resumable: true, providerSessionId: session.providerSessionId });
  });

  it("passes the provider-neutral adapter contract", async () => {
    const backend: QoderBackend = { start: () => ({ cancel: async () => undefined, status: () => "completed", result: async () => completed() }) };
    expect(await runAdapterContract(new QoderAdapter({ id: "alice", alias: "Alice" }, backend))).toEqual([]);
  });

  it("normalizes credit and provider failures without leaking them into Core", () => {
    expect(normalizeQoderEvent({ type: "usage", credits_remaining: 0, message: "credits exhausted" })).toMatchObject({ type: "resource", state: "QUOTA_EXHAUSTED", remaining: 0, source: "event" });
    expect(normalizeQoderError("Too many requests")).toMatchObject({ type: "resource", state: "RATE_LIMITED" });
    expect(normalizeQoderError("login required")).toMatchObject({ type: "resource", state: "AUTH_ERROR" });
    expect(normalizeQoderError("network unavailable")).toMatchObject({ type: "resource", state: "PROVIDER_DOWN" });
  });

  it("treats a successful unauthenticated CLI probe as AUTH_REQUIRED", () => {
    expect(qoderAuthenticationDiagnostic("Not logged in. Run qodercli login to authenticate.")).toContain("Not logged in");
    expect(qoderAuthenticationDiagnostic("qoder-max\nqoder-fast")).toBeUndefined();
  });
});
