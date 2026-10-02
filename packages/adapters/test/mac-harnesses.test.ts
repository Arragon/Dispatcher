import { describe, expect, it, vi } from "vitest";
import { AntigravityAdapter, ZCodeAdapter, WorkBuddyCliAdapter, QoderCnAdapter, SpawnCliAgentBackend, normalizeAntigravityLine, normalizeZCodeLine, normalizeWorkBuddyLine, CursorAdapter, CodexAdapter, MemorySessionStore, type CliAgentBackend } from "../src/index.js";

describe("Mac priority native harnesses", () => {
  it.each([[AntigravityAdapter, "--conversation"], [ZCodeAdapter, "--resume"], [WorkBuddyCliAdapter, "--resume"], [QoderCnAdapter, "--resume"]] as const)("continues the exact session with safe permissions and literal argv (%s)", async (Adapter, flag) => {
    const backend: CliAgentBackend = { start: vi.fn(() => ({ status: () => "completed", cancel: async () => undefined, result: async () => ({ state: "completed", summary: "done", events: [], providerSessionId: "exact-session" }) })) };
    const adapter = new Adapter({ id: "local", alias: "Local", executable: "/bin/local-harness", configDir: "/isolated/config" }, backend);
    const session = await adapter.start({ runId: "run", workspacePath: "/worktree", prompt: "-literal; $(never)" });
    await adapter.status(session.id);
    await adapter.send(session.id, "-next; $(never)");
    const inputs = vi.mocked(backend.start).mock.calls.map(([input]) => input);
    expect(inputs[1]!.args[inputs[1]!.args.indexOf(flag) + 1]).toBe("exact-session");
    expect(inputs[0]!.args).toContain("-literal; $(never)");
    expect(inputs[1]!.args).toContain("-next; $(never)");
    for (const input of inputs) {
      expect(input.args).not.toContain("--dangerously-skip-permissions");
      expect(input.args).not.toContain("yolo");
      expect(input.requireExecutionEvidence).toBe(true);
    }
    if (Adapter === ZCodeAdapter) expect(inputs[0]!.args).toEqual(expect.arrayContaining(["--mode", "edit", "--json", "--prompt"]));
    if (Adapter === WorkBuddyCliAdapter) expect(inputs[0]!.args).toEqual(expect.arrayContaining(["--permission-mode", "acceptEdits"]));
    if (Adapter === QoderCnAdapter) expect(inputs[0]!.args).toEqual(expect.arrayContaining(["--config-dir", "/isolated/config", "accept_edits"]));
  });

  it.each([CursorAdapter, AntigravityAdapter, ZCodeAdapter, WorkBuddyCliAdapter, QoderCnAdapter])("refuses all cross-profile session access and mutation (%s)", async (Adapter) => {
    const store = new MemorySessionStore();
    const backend: CliAgentBackend = { start: vi.fn(() => ({ status: () => "completed", cancel: async () => undefined, result: async () => ({ state: "completed", summary: "private", events: [], providerSessionId: "private-session-a" }) })) };
    const a = new Adapter({ id: "a", alias: "A", configDir: "/accounts/a" }, backend, store);
    const b = new Adapter({ id: "b", alias: "B", configDir: "/accounts/b" }, backend, store);
    const session = await a.start({ runId: "run", workspacePath: "/worktree" });
    await a.result(session.id);
    const before = store.load(session.id);
    for (const operation of [() => b.status(session.id), () => b.result(session.id), () => b.send(session.id, "wrong account"), () => b.cancel(session.id), () => b.usage!(session.id), () => b.diagnostics!(session.id)]) {
      await expect(operation()).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
      expect(store.load(session.id)).toEqual(before);
    }
    expect(backend.start).toHaveBeenCalledTimes(1);
  });

  it("isolates Codex account sessions across a shared store", async () => {
    const store = new MemorySessionStore();
    const backend = { start: vi.fn(() => ({ status: () => "completed" as const, cancel: async () => undefined, result: async () => ({ state: "completed" as const, summary: "private", events: [], providerSessionId: "private-ronna" }) })) };
    const a = new CodexAdapter({ id: "ronna", alias: "ronna", codexHome: "/accounts/ronna" }, backend, store);
    const b = new CodexAdapter({ id: "kite", alias: "kite", codexHome: "/accounts/kite" }, backend, store);
    const session = await a.start({ runId: "run", workspacePath: "/worktree" });
    await a.result(session.id);
    const before = store.load(session.id);
    for (const operation of [() => b.status(session.id), () => b.result(session.id), () => b.send(session.id, "wrong account"), () => b.cancel(session.id), () => b.usage(session.id), () => b.diagnostics(session.id)]) {
      await expect(operation()).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
      expect(store.load(session.id)).toEqual(before);
    }
    expect(backend.start).toHaveBeenCalledTimes(1);
  });

  it("rejects Cursor input while its native process is running", async () => {
    const backend: CliAgentBackend = { start: vi.fn(() => ({ status: () => "running", cancel: async () => undefined, result: () => new Promise(() => {}) })) };
    const adapter = new CursorAdapter({ id: "cursor", alias: "Cursor" }, backend);
    const session = await adapter.start({ runId: "run", workspacePath: "/worktree" });
    await expect(adapter.send(session.id, "next")).rejects.toMatchObject({ code: "SESSION_BUSY" });
    expect(backend.start).toHaveBeenCalledTimes(1);
  });

  it("makes Cursor blanket tool approval an explicit opt-in", async () => {
    const backend: CliAgentBackend = { start: vi.fn(() => ({ status: () => "completed", cancel: async () => undefined, result: async () => ({ state: "completed", summary: "done", events: [] }) })) };
    for (const approveTools of [false, true]) {
      const adapter = new CursorAdapter({ id: "cursor", alias: "Cursor", approveTools }, backend);
      await adapter.start({ runId: "run", workspacePath: "/worktree", prompt: "-literal" });
      const input = vi.mocked(backend.start).mock.lastCall![0];
      expect(input.args.includes("--force")).toBe(approveTools);
      expect(input.args.slice(-2)).toEqual(["--", "-literal"]);
      expect(input.requireExecutionEvidence).toBe(true);
    }
  });

  it("separates Cursor workspace trust from blanket tool approval", async () => {
    const backend: CliAgentBackend = { start: vi.fn(() => ({ status: () => "completed", cancel: async () => undefined, result: async () => ({ state: "completed", summary: "done", events: [] }) })) };
    for (const trustWorkspace of [false, true]) {
      const adapter = new CursorAdapter({ id: "cursor", alias: "Cursor", trustWorkspace }, backend);
      await adapter.start({ runId: "run", workspacePath: "/worktree" });
      const args = vi.mocked(backend.start).mock.lastCall![0].args;
      expect(args.includes("--trust")).toBe(trustWorkspace);
      expect(args).not.toContain("--force");
    }
  });

  it("normalizes Antigravity and ZCode result envelopes without accepting startup as execution", () => {
    expect(normalizeAntigravityLine('{"event":"init","conversation_id":"ag-id"}')).toMatchObject({ providerSessionId: "ag-id" });
    expect(normalizeAntigravityLine('{"event":"init","conversation_id":"ag-id"}')).not.toHaveProperty("executionEvidence");
    expect(normalizeAntigravityLine('{"event":"result","result":{"conversation_id":"ag-id","status":"SUCCESS","response":"done"}}')).toMatchObject({ executionEvidence: true, providerSessionId: "ag-id", summary: "done" });
    expect(normalizeAntigravityLine('{"event":"result","result":{"status":"ERROR","error":"Authentication required"}}')).toMatchObject({ type: "resource", state: "AUTH_ERROR" });
    expect(normalizeZCodeLine('{"type":"result","sessionId":"sess-id","response":"done","projection":{"status":"completed"}}')).toMatchObject({ executionEvidence: true, providerSessionId: "sess-id", summary: "done" });
    expect(normalizeZCodeLine('{"type":"result","sessionId":"sess-id","response":"failed","projection":{"status":"failed"}}')).toMatchObject({ type: "failure" });
    expect(normalizeZCodeLine("null")).toBeUndefined();
  });

  it("treats the actual WorkBuddy zero-exit auth envelope as a failure", async () => {
    const payload = { type: "result", subtype: "error_during_execution", is_error: true, errors: ["Authentication required. Please use /login command to sign in"] };
    const turn = new SpawnCliAgentBackend().start({ executable: process.execPath, args: ["-e", `console.log(${JSON.stringify(JSON.stringify(payload))})`], workspacePath: process.cwd(), requireExecutionEvidence: true, normalizeLine: normalizeWorkBuddyLine });
    expect(await turn.result()).toMatchObject({ state: "failed", events: expect.arrayContaining([expect.objectContaining({ type: "resource", state: "AUTH_ERROR" })]) });
  });

  it.each([AntigravityAdapter, ZCodeAdapter, WorkBuddyCliAdapter, QoderCnAdapter])("rejects empty or malformed successful exit (%s)", async (Adapter) => {
    const backend: CliAgentBackend = { start: (input) => new SpawnCliAgentBackend().start({ ...input, executable: process.execPath, args: ["-e", "console.log('not native JSON')"] }) };
    const adapter = new Adapter({ id: "local", alias: "Local", executable: "harness" }, backend);
    const session = await adapter.start({ runId: "run", workspacePath: process.cwd() });
    expect(await adapter.result(session.id)).toMatchObject({ state: "FAILED" });
  });
});
