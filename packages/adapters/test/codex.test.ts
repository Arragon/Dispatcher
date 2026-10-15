import { describe, expect, it } from "vitest";
import { CodexAdapter, normalizeCodexError, normalizeCodexEvent, type CodexBackend } from "../src/index.js";

describe("Codex adapter", () => {
  it("persists provider sessions and resumes the same session", async () => {
    const starts: Array<{ providerSessionId?: string; prompt: string }> = [];
    const backend: CodexBackend = {
      start: (input) => {
        starts.push({ ...(input.providerSessionId ? { providerSessionId: input.providerSessionId } : {}), prompt: input.prompt });
        return {
          cancel: async () => undefined,
          status: () => "completed",
          result: async () => ({ state: "completed", summary: "done", providerSessionId: input.providerSessionId ?? "thread-1", events: [] }),
        };
      },
    };
    const adapter = new CodexAdapter({ id: "orion", alias: "Orion", codexHome: "/profiles/orion" }, backend);
    const session = await adapter.start({ runId: "run-1", workspacePath: "/worktree", prompt: "first" });
    await adapter.send(session.id, "second");
    expect(starts).toEqual([{ prompt: "first" }, { providerSessionId: "thread-1", prompt: "second" }]);
    expect(await adapter.diagnostics(session.id)).toMatchObject({ alias: "Orion", profileId: "orion", resumable: true });
    expect(JSON.stringify(await adapter.diagnostics(session.id))).not.toContain("/profiles/orion");
  });

  it("normalizes documented turn tokens without turning them into account quota", async () => {
    const event = normalizeCodexEvent({ type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 70, output_tokens: 10 } });
    expect(event).toMatchObject({ type: "usage", tokens: { input: 100, cachedInput: 70, output: 10 } });
    expect(normalizeCodexEvent({ type: "turn.completed", usage: { input_tokens: -2, output_tokens: "10" } })).toEqual({ type: "activity", summary: "turn.completed" });
    const adapter = new CodexAdapter({id: "ronna", alias: "ronna", codexHome: "/private/home"}, { start: () => ({ cancel: async () => undefined, status: () => "completed", result: async () => ({ state: "completed", summary: "done", events: [event!] }) }) });
    const session = await adapter.start({runId: "r", workspacePath: "/worktree"});
    expect(await adapter.usage(session.id)).toMatchObject({ state: "UNKNOWN", tokens: {input: 100, output: 10, cachedInput: 70}, tokenScope: "latest-turn" });
  });

  it("normalizes quota as a recoverable resource condition", () => {
    expect(normalizeCodexEvent({ type: "item.completed", item: { type: "agent_message", text: "implemented" } })).toEqual({ type: "activity", summary: "implemented" });
    expect(normalizeCodexEvent({ type: "quota.exhausted", resets_at: "2026-09-23T00:00:00.000Z" })).toMatchObject({ type: "resource", state: "QUOTA_EXHAUSTED", confidence: "high" });
    expect(normalizeCodexError("429 rate limit")).toMatchObject({ type: "resource", state: "RATE_LIMITED" });
    expect(normalizeCodexError("ordinary crash")).toMatchObject({ type: "failure" });
  });

  it("isolates two profiles and preserves resource events outside failure state", async () => {
    const homes: string[] = [];
    const backend: CodexBackend = {
      start: (input) => {
        homes.push(input.codexHome);
        return {
          cancel: async () => undefined,
          status: () => "completed",
          result: async () => ({
            state: input.codexHome.endsWith("atlas") ? "failed" : "completed",
            summary: "turn ended",
            providerSessionId: input.codexHome.endsWith("atlas") ? "thread-atlas" : "thread-orion",
            events: input.codexHome.endsWith("atlas")
              ? [{ type: "resource", state: "QUOTA_EXHAUSTED", reason: "quota", source: "event", confidence: "high" }]
              : [],
          }),
        };
      },
    };
    const orion = new CodexAdapter({ id: "orion", alias: "Orion", codexHome: "/profiles/orion" }, backend);
    const atlas = new CodexAdapter({ id: "atlas", alias: "Atlas", codexHome: "/profiles/atlas" }, backend);
    const [orionSession, atlasSession] = await Promise.all([
      orion.start({ runId: "run-orion", workspacePath: "/worktree/orion", prompt: "first" }),
      atlas.start({ runId: "run-atlas", workspacePath: "/worktree/atlas", prompt: "second" }),
    ]);

    expect(homes).toEqual(["/profiles/orion", "/profiles/atlas"]);
    expect((await orion.status(orionSession.id)).state).toBe("COMPLETED");
    expect((await atlas.status(atlasSession.id)).state).toBe("FAILED");
    expect(await atlas.usage(atlasSession.id)).toMatchObject({ state: "QUOTA_EXHAUSTED", reason: "quota" });
  });

  it("turns input-required events into a resumable paused session", async () => {
    const starts: Array<{ providerSessionId?: string; prompt: string }> = [];
    const backend: CodexBackend = {
      start: (input) => {
        starts.push({ ...(input.providerSessionId ? { providerSessionId: input.providerSessionId } : {}), prompt: input.prompt });
        const waiting = !input.providerSessionId;
        return {
          cancel: async () => undefined,
          status: () => "completed",
          result: async () => ({
            state: waiting ? "waiting" : "completed",
            summary: waiting ? "approval required" : "continued",
            providerSessionId: "thread-waiting",
            events: waiting ? [{ type: "waiting", reason: "approval_required" }] : [],
          }),
        };
      },
    };
    const adapter = new CodexAdapter({ id: "orion", alias: "Orion", codexHome: "/profiles/orion" }, backend);
    const session = await adapter.start({ runId: "run-waiting", workspacePath: "/worktree", prompt: "start" });
    expect((await adapter.status(session.id)).state).toBe("PAUSED");
    await adapter.send(session.id, "approved");
    expect((await adapter.status(session.id)).state).toBe("COMPLETED");
    expect(starts).toEqual([{ prompt: "start" }, { providerSessionId: "thread-waiting", prompt: "approved" }]);
  });
});

it("does not restart a cancelled session even when the old turn completed", async () => {
  let starts = 0;
  const adapter = new CodexAdapter({id:"p",alias:"P",codexHome:"/profiles/p"},{start: () => { starts++; return {cancel:async()=>undefined,status:()=>"completed",result:async()=>({state:"completed",summary:"done",providerSessionId:"thread",events:[]})}; }});
  const session = await adapter.start({runId:"r",workspacePath:"/workspace"});
  await adapter.status(session.id);
  await adapter.cancel(session.id);
  await expect(adapter.send(session.id,"stale")).rejects.toMatchObject({code:"SESSION_CANCELLED"});
  expect((await adapter.status(session.id)).state).toBe("CANCELLED");
  expect(starts).toBe(1);
});

it("requires a completed native JSON turn and ignores benign stderr on success",async()=>{
  const {mkdtempSync,writeFileSync,chmodSync,rmSync}=await import("node:fs");const {tmpdir}=await import("node:os");const {join}=await import("node:path");const {CodexCliBackend}=await import("../src/index.js");
  const directory=mkdtempSync(join(tmpdir(),"codex-native-turn-"));const executable=join(directory,"codex-fixture");
  try{
    writeFileSync(executable,`#!${process.execPath}\nconsole.error('benign warning');console.log(JSON.stringify({type:'thread.started',thread_id:'native-thread'}));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:1}}));`);chmodSync(executable,0o755);
    const backend=new CodexCliBackend();expect(await backend.start({executable,codexHome:directory,workspacePath:directory,prompt:"test"}).result()).toMatchObject({state:"completed",providerSessionId:"native-thread",summary:"Codex completed"});
    writeFileSync(executable,`#!${process.execPath}\nconsole.log('no native execution evidence');`);
    expect(await backend.start({executable,codexHome:directory,workspacePath:directory,prompt:"test"}).result()).toMatchObject({state:"failed"});
  }finally{rmSync(directory,{recursive:true,force:true});}
});
