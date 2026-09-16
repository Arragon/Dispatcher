import { describe, expect, it, vi } from "vitest";
import {
  DiscoveryEngine,
  GenericCliAdapter,
  GenericMockAdapter,
  MemorySessionStore,
  genericMockManifest,
  renderCommand,
  runAdapterContract,
  selectBackend,
  validateManifest,
  type AgentAdapter,
  type ProcessExecution,
} from "../src/index.js";

describe("adapter manifest and contract kit", () => {
  it("validates form-driving secret fields and the reference adapter", async () => {
    expect(validateManifest(genericMockManifest).configSchema).toMatchObject({ type: "object" });
    expect(await runAdapterContract(new GenericMockAdapter())).toEqual([]);
    const invalid = structuredClone(genericMockManifest);
    invalid.secretFields = ["apiKey"];
    expect(() => validateManifest(invalid)).toThrow(/missing from config schema/);
  });

  it("fails a deliberately incorrect adapter", async () => {
    const broken = new GenericMockAdapter() as AgentAdapter;
    broken.cancel = vi.fn(async (id) => ({ ...(await broken.status(id)), state: "RUNNING" as const }));
    expect(await runAdapterContract(broken)).toContain("cancel must produce CANCELLED session");
  });

  it("selects the least-privileged declared backend and explains the decision", () => {
    const manifest = structuredClone(genericMockManifest);
    manifest.backends = [
      { id: "pty", kind: "pty", priority: 50, capabilities: [] },
      { id: "api", kind: "api", priority: 10, capabilities: [] },
    ];
    expect(selectBackend(manifest, ["pty", "api"])).toMatchObject({ backendId: "api", explanation: expect.stringContaining("priority 10") });
  });
});

describe("allowlisted discovery", () => {
  it("returns deterministic none/one/multiple/auth results and redacts evidence", async () => {
    const engine = new DiscoveryEngine();
    engine.register(genericMockManifest, {
      "mock-ready": async ({ runnerId }) => ({ candidates: runnerId === "none" ? [] : runnerId === "multiple" ? [candidate("b"), candidate("a")] : [candidate("one", runnerId !== "auth-missing")] }),
    });
    expect((await engine.discover({ adapterId: "generic-mock", runnerId: "none" })).status).toBe("NONE");
    expect((await engine.discover({ adapterId: "generic-mock", runnerId: "one" })).status).toBe("ONE");
    expect((await engine.discover({ adapterId: "generic-mock", runnerId: "multiple" })).candidates.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect((await engine.discover({ adapterId: "generic-mock", runnerId: "auth-missing" })).status).toBe("NEED_USER_INPUT");
    expect((await engine.discover({ adapterId: "generic-mock", runnerId: "one" })).candidates[0]?.evidence[0]?.summary).toContain("[REDACTED]");
  });

  it("rejects undeclared probes", async () => {
    const engine = new DiscoveryEngine();
    engine.register(genericMockManifest, { "mock-ready": async () => ({ candidates: [] }) });
    await expect(engine.discover({ adapterId: "generic-mock", runnerId: "r", probeIds: ["raw-shell"] })).resolves.toMatchObject({ status: "BLOCKED", reason: "PROBE_NOT_ALLOWLISTED" });
  });
});

function candidate(id: string, authenticated = true) {
  return { id, installationPath: `/opt/${id}`, version: "1.0.0", backendIds: ["mock-sdk"], authenticated, capabilities: ["start"], evidence: [{ probeId: "mock-ready", summary: "sk-secret-canary-123456" }] };
}

describe("restricted Generic CLI", () => {
  it("passes placeholders as argv values without shell interpolation", () => {
    expect(renderCommand({ file: "/usr/bin/printf", args: ["%s", "{{prompt}}"] }, { prompt: "hello; rm -rf /", sessionId: "s", workspace: "/tmp/w" })).toEqual({ file: "/usr/bin/printf", args: ["%s", "hello; rm -rf /"] });
    expect(() => renderCommand({ file: "{{workspace}}/agent", args: [] }, { prompt: "", sessionId: "s", workspace: "/tmp/w" })).toThrow(/fixed manifest value/);
    expect(() => renderCommand({ file: "/bin/echo", args: ["prefix={{prompt}}"] }, { prompt: "x", sessionId: "s", workspace: "/tmp/w" })).toThrow(/entire argv/);
  });

  it("supports start/send/status/cancel/result and persisted session identity", async () => {
    let state: "running" | "cancelled" | "completed" | "failed" = "running";
    const execution: ProcessExecution = {
      id: "process",
      status: async () => ({ state }),
      send: vi.fn(async () => undefined),
      cancel: vi.fn(async () => { state = "cancelled"; }),
      result: async () => ({ state: state === "running" ? "completed" : state, summary: "done" }),
    };
    const store = new MemorySessionStore();
    const adapter = new GenericCliAdapter({ start: async () => execution }, { file: "/bin/echo", args: ["{{prompt}}"] }, store);
    const session = await adapter.start({ runId: "run-1", workspacePath: "/tmp/work", prompt: "hello" });
    await adapter.send(session.id, "continue\n");
    expect((await adapter.status(session.id)).state).toBe("RUNNING");
    expect((await adapter.cancel(session.id)).state).toBe("CANCELLED");
    expect((await adapter.result(session.id)).state).toBe("CANCELLED");
    expect((await new GenericCliAdapter({ start: async () => execution }, { file: "/bin/echo", args: [] }, store).status(session.id)).id).toBe(session.id);
  });
});
