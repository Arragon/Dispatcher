import { describe, expect, it,vi } from "vitest";
import { CodexAdapter,CodexCliBackend, normalizeCodexError, normalizeCodexEvent, type CodexBackend, type AdapterSession } from "../src/index.js";

describe("Codex adapter", () => {
  it("retains native usage through bounded noisy output without losing turn completion",async()=>{
    const {mkdtempSync,writeFileSync,rmSync}=await import("node:fs"),{tmpdir}=await import("node:os"),{join}=await import("node:path");const root=mkdtempSync(join(tmpdir(),"codex-usage-events-"));
    try{writeFileSync(join(root,"exec"),`console.log(JSON.stringify({type:'thread.started',thread_id:'native'}));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:100,output_tokens:0,cached_input_tokens:50}}));for(let i=0;i<4000;i++)console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'activity '+i}}));`);
      const turn=new CodexCliBackend().start({executable:process.execPath,codexHome:root,workspacePath:root,prompt:"fixture"}),result=await turn.result();expect(result.state).toBe("completed");expect(result.events.length).toBeLessThanOrEqual(256);expect(result.events).toContainEqual(expect.objectContaining({type:"usage",tokens:{input:100,output:0,cachedInput:50}}));
    }finally{rmSync(root,{recursive:true,force:true});}
  });
  it("reads active usage without waiting for native completion and retains a stable turn observation",async()=>{
    const result=vi.fn(async()=>{throw new Error("usage waited for native completion");}),event=normalizeCodexEvent({type:"turn.completed",usage:{input_tokens:10,cached_input_tokens:5,output_tokens:0}})!;
    const adapter=new CodexAdapter({id:"p",alias:"P",codexHome:"/native"},{start:()=>({cancel:async()=>undefined,status:()=>"running",events:()=>[event],result})});const session=await adapter.start({runId:"r",workspacePath:"/work"});
    const first=await adapter.usage(session.id),second=await adapter.usage(session.id);expect(result).not.toHaveBeenCalled();expect(first.tokens).toEqual({input:10,cachedInput:5,output:0});expect(first.observations).toMatchObject([{version:1,scope:"turn",mode:"snapshot",profileId:"p",runId:"r",metrics:[{name:"input",value:"10",unit:"tokens"},{name:"output",value:"0",unit:"tokens"},{name:"cachedInput",value:"5",unit:"tokens",includedIn:"input"}]}]);expect(second.observations).toEqual(first.observations);
  });
  it("cannot acknowledge cancellation or resume of an active session without owned process handles",async()=>{
    const saved:AdapterSession[]=[];let starts=0;const store={load:(id:string)=>saved.findLast(s=>s.id===id),save:(session:AdapterSession)=>{saved.push(structuredClone(session));}};
    const profile={id:"p",alias:"P",codexHome:"/native"},backend:CodexBackend={start:()=>{starts++;return {cancel:async()=>undefined,status:()=>"running",result:async()=>({state:"completed",summary:"",providerSessionId:"native",events:[]})};}};
    const session=await new CodexAdapter(profile,backend,store).start({runId:"r",workspacePath:"/work"});const restored=new CodexAdapter(profile,backend,store);
    await expect(restored.cancel(session.id)).rejects.toMatchObject({code:"SESSION_DETACHED"});expect((await restored.status(session.id)).state).toBe("RUNNING");await expect(restored.send(session.id,"again")).rejects.toMatchObject({code:"SESSION_DETACHED"});expect(starts).toBe(1);
  });
  it("persists a STARTING session before spawning and retains the real process identity", async () => {
    const saved: AdapterSession[] = [];
    let starts = 0;
    const store = { load: (id: string) => saved.findLast(s => s.id === id), save: (session: AdapterSession) => { saved.push(structuredClone(session)); } };
    const backend: CodexBackend = { start: () => {
      expect(saved.at(-1)?.state).toBe("STARTING"); starts++;
      return { processId: 4321, cancel: async () => undefined, status: () => "running", result: async () => ({ state: "completed", summary: "done", events: [] }) };
    } };
    const profile = { id: "p", alias: "P", codexHome: "/profiles/p" };
    const session = await new CodexAdapter(profile, backend, store).start({ runId: "r", workspacePath: "/work" });
    expect(session).toMatchObject({ state: "RUNNING", processId: 4321 });
    await expect(new CodexAdapter(profile, backend, { load: () => undefined, save: () => { throw new Error("disk full"); } }).start({ runId: "r2", workspacePath: "/work" })).rejects.toThrow("disk full");
    expect(starts).toBe(1);
  });

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

  it("cancels the owned turn if its post-spawn persistence fails", async () => {
    let cancelled = 0; const saved: AdapterSession[] = [];
    const adapter = new CodexAdapter({ id: "p", alias: "P", codexHome: "/profiles/p" }, { start: () => ({ processId: 42, cancel: async () => { cancelled++; }, status: () => "running", result: async () => ({ state: "completed", summary: "done", events: [] }) }) }, {
      load: id => saved.find(s => s.id === id), save: s => { if (s.state === "RUNNING") throw new Error("disk full"); saved.push(structuredClone(s)); },
    });
    await expect(adapter.start({ runId: "r", workspacePath: "/work" })).rejects.toThrow("disk full");
    expect(saved).toMatchObject([{ state: "STARTING", runId: "r" }]); expect(cancelled).toBe(1);
  });

  it("normalizes documented turn tokens without turning them into account quota", async () => {
    const event = normalizeCodexEvent({ type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 70, output_tokens: 10 } });
    expect(event).toMatchObject({ type: "usage", tokens: { input: 100, cachedInput: 70, output: 10 } });
    expect(normalizeCodexEvent({ type: "turn.completed", usage: { input_tokens: -2, output_tokens: "10" } })).toEqual({ type: "activity", summary: "turn.completed" });
    const adapter = new CodexAdapter({id: "ronna", alias: "ronna", codexHome: "/private/home"}, { start: () => ({ cancel: async () => undefined, status: () => "completed", result: async () => ({ state: "completed", summary: "done", events: [event!] }) }) });
    const session = await adapter.start({runId: "r", workspacePath: "/worktree"});
    expect(await adapter.usage(session.id)).toMatchObject({ state: "AVAILABLE", reason:"Native turn completed; remaining quota was not reported", tokens: {input: 100, output: 10, cachedInput: 70}, tokenScope: "latest-turn" });
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

it("keeps concurrent per-session models and effort frozen on resume without changing the profile",async()=>{
  const calls:Array<Parameters<CodexBackend["start"]>[0]>=[];
  const profile={id:"p",alias:"P",codexHome:"/profiles/p",model:"profile-default"};
  const backend:CodexBackend={start:input=>{calls.push(input);return{cancel:async()=>undefined,status:()=>"completed",result:async()=>({state:"completed",summary:"done",providerSessionId:input.providerSessionId??input.model??"native",events:[]})};}};
  const adapter=new CodexAdapter(profile,backend);
  const selection={version:1 as const,mode:"manual" as const,source:"explicit" as const,selectionType:"explicit-model" as const,profileId:"p",runnerId:"local",providerId:"codex",backendId:"codex-exec-json",contextFingerprint:"context",configRevision:1,selectedAt:"now"};
  const a=await adapter.start({runId:"a",workspacePath:"/work/a",executionSelection:{...selection,requestedModel:"model-a",nativeParameters:{reasoningEffort:"low"}}});
  const b=await adapter.start({runId:"b",workspacePath:"/work/b",executionSelection:{...selection,requestedModel:"model-b",nativeParameters:{reasoningEffort:"medium"}}});
  expect(profile.model).toBe("profile-default");profile.model="later-default";
  await adapter.send(a.id,"continue a");await adapter.send(b.id,"continue b");
  expect(calls.map(c=>[c.model,c.reasoningEffort])).toEqual([["model-a","low"],["model-b","medium"],["model-a","low"],["model-b","medium"]]);
});
