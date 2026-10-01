import { describe, expect, it, vi } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GrokAdapter, OpenCodeAdapter, PiAdapter, SpawnCliAgentBackend,
  normalizeGrokLine, normalizeOpenCodeLine, normalizePiLine,
  grokManifest, opencodeManifest, piManifest,
  probeNativeCliProfile,
  type CliAgentBackend, type CliTurnResult,
} from "../src/index.js";

function backend(result: CliTurnResult): CliAgentBackend {
  return { start: vi.fn(() => ({ status: () => "completed", result: async () => result, cancel: async () => undefined })) };
}

describe("installed native CLI harnesses", () => {
  it.each([
    [OpenCodeAdapter, opencodeManifest, "--session"],
    [GrokAdapter, grokManifest, "--resume"],
    [PiAdapter, piManifest, "--session"],
  ] as const)("retains the exact provider session for subsequent turns (%s)", async (Adapter, manifest, resumeFlag) => {
    const calls = backend({ state: "completed", summary: "done", events: [], providerSessionId: "provider-exact-id" });
    const adapter = new Adapter({ id: "local", alias: "Local", executable: "/bin/harness", model: "provider/model" }, calls);
    const session = await adapter.start({ runId: "run", workspacePath: "/workspace", prompt: "-prompt; $(literal)" });
    expect((await adapter.status(session.id)).providerSessionId).toBe("provider-exact-id");
    await adapter.send(session.id, "-next; $(literal)");
    const inputs = vi.mocked(calls.start).mock.calls.map(([input]) => input);
    expect(inputs[0]?.args).toContain(Adapter === GrokAdapter ? "--single=-prompt; $(literal)" : "-prompt; $(literal)");
    const args = inputs[1]!.args;
    expect(args[args.indexOf(resumeFlag) + 1]).toBe("provider-exact-id");
    expect(args).toContain(Adapter === GrokAdapter ? "--single=-next; $(literal)" : "-next; $(literal)");
    expect(adapter.manifest.id).toBe(manifest.id);
    expect((await adapter.result(session.id)).summary).toBe("done");
  });

  it("refuses a second turn while the first is running and returns usage immediately", async () => {
    const never = new Promise<CliTurnResult>(() => {});
    const calls: CliAgentBackend = { start: vi.fn(() => ({ status: () => "running", result: () => never, cancel: async () => undefined, events: () => [] })) };
    const adapter = new PiAdapter({ id: "pi", alias: "Pi", executable: "pi" }, calls);
    const session = await adapter.start({ runId: "run", workspacePath: "/workspace", prompt: "hello" });
    await expect(adapter.send(session.id, "another")).rejects.toMatchObject({ code: "SESSION_BUSY" });
    expect(await adapter.usage!(session.id)).toMatchObject({ state: "UNKNOWN" });
    expect(calls.start).toHaveBeenCalledTimes(1);
  });

  it("normalizes nested native output without turning token usage into quota exhaustion", () => {
    expect(normalizeOpenCodeLine(JSON.stringify({ type: "text", sessionID: "ses_a", part: { type: "text", text: "OpenCode done" } }))).toMatchObject({ type: "activity", summary: "OpenCode done", providerSessionId: "ses_a" });
    expect(normalizeOpenCodeLine(JSON.stringify({ type: "error", error: { name: "APIError", data: { statusCode: 429, message: "Too many requests" } } }))).toMatchObject({ type: "resource", state: "RATE_LIMITED" });
    expect(normalizeGrokLine(JSON.stringify({ type: "assistant", session_id: "grok_a", message: { content: [{ type: "text", text: "Grok done" }] } }))).toMatchObject({ type: "activity", summary: "Grok done", providerSessionId: "grok_a" });
    expect(normalizeGrokLine('{"type":"result","is_error":true,"result":"quota exhausted"}')).toMatchObject({ type: "resource", state: "QUOTA_EXHAUSTED" });
    expect(normalizePiLine('{"type":"session","id":"pi_a"}')).toMatchObject({ type: "activity", providerSessionId: "pi_a" });
    expect(normalizePiLine(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Pi done" }], stopReason: "stop", usage: { output: 0 } } }))).toMatchObject({ type: "activity", summary: "Pi done" });
    expect(normalizePiLine(JSON.stringify({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "Invalid API key" } }))).toMatchObject({ type: "resource", state: "AUTH_ERROR" });
    expect(normalizeOpenCodeLine("not json")).toBeUndefined();
    expect(normalizePiLine("null")).toBeUndefined();
  });

  it("treats a structured error as failure even if the CLI exits zero", async () => {
    const turn = new SpawnCliAgentBackend().start({ executable: process.execPath, args: ["-e", 'console.log(JSON.stringify({type:"result",is_error:true,result:"provider refused"}))'], workspacePath: process.cwd(), normalizeLine: normalizeGrokLine });
    expect(await turn.result()).toMatchObject({ state: "failed", summary: "provider refused" });
  });

  it("reports missing executable failure and bounds retained events", async () => {
    const missing = new SpawnCliAgentBackend().start({ executable: "/dispatcher-missing-cli", args: [], workspacePath: process.cwd() });
    expect(await missing.result()).toMatchObject({ state: "failed", summary: expect.stringContaining("ENOENT") });
    const turn = new SpawnCliAgentBackend().start({ executable: process.execPath, args: ["-e", 'for(let i=0;i<3000;i++) console.log(JSON.stringify({type:"text",part:{text:"event"+i}}))'], workspacePath: process.cwd(), normalizeLine: normalizeOpenCodeLine });
    const result = await turn.result();
    expect(result.events.length).toBeLessThanOrEqual(256);
    expect(result.summary).toBe("event2999");
  });

  it("retains quota evidence through a flood of later output", async () => {
    const turn = new SpawnCliAgentBackend().start({ executable: process.execPath, args: ["-e", 'console.log(JSON.stringify({type:"result",is_error:true,result:"quota exhausted"})); for(let i=0;i<3000;i++) console.log(JSON.stringify({type:"assistant",message:{content:[{type:"text",text:"later"}]}}))'], workspacePath: process.cwd(), normalizeLine: normalizeGrokLine });
    const result = await turn.result();
    expect(result.state).toBe("failed");
    expect(result.events).toContainEqual(expect.objectContaining({ type: "resource", state: "QUOTA_EXHAUSTED" }));
    expect(result.events.length).toBeLessThanOrEqual(256);
  });

  it("fences cancellation while a resumed turn awaits credentials", async () => {
    let release!: (value: string) => void;
    let resolution = 0;
    const resolve = async (): Promise<string> => ++resolution === 1 ? "key" : new Promise((done) => { release = done; });
    const calls = backend({ state: "completed", summary: "done", events: [], providerSessionId: "same" });
    const adapter = new GrokAdapter({ id: "grok", alias: "Grok", executable: "grok", credentialRef: "secret://grok/test" }, calls, undefined, resolve);
    const session = await adapter.start({ runId: "run", workspacePath: "/workspace" });
    const sending = adapter.send(session.id, "next");
    const rejection = expect(sending).rejects.toMatchObject({ code: "SESSION_CANCELLED" });
    await vi.waitFor(() => expect(release).toBeDefined());
    await adapter.cancel(session.id);
    release("key");
    await rejection;
    expect(calls.start).toHaveBeenCalledTimes(1);
    expect((await adapter.status(session.id)).state).toBe("CANCELLED");
  });

  it("probes actual pi readiness and rejects the older OpenCode CLI without leaking probe output", async () => {
    const directory = mkdtempSync(join(tmpdir(), "harness-probe-"));
    const file = join(directory, "harness");
    writeFileSync(file, `#!${process.execPath}\nconst args=process.argv.slice(2); if(args[0]==='auth') console.log(JSON.stringify({status:'ready',provider:'openai'})); else if(args.includes('--help')) console.log('--mode json --session-id --session --format'); else console.log('1.0');`);
    chmodSync(file, 0o700);
    try {
      expect(await probeNativeCliProfile("pi", { id: "pi", alias: "Pi", executable: file, model: "openai/model" })).toMatchObject({ installed: true, compatible: true, authenticated: true, authentication: "ready" });
      expect(await probeNativeCliProfile("opencode", { id: "oc", alias: "OC", executable: file })).toMatchObject({ installed: true, compatible: false, authenticated: false });
      writeFileSync(file, `#!${process.execPath}\nconsole.error('sk-private-test-secret'); process.exit(1);`);
      expect(JSON.stringify(await probeNativeCliProfile("grok", { id: "grok", alias: "Grok", executable: file }))).not.toContain("sk-private-test-secret");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
