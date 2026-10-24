import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import {spawn,type ChildProcess} from "node:child_process";
import { CodexCliBackend, QoderCliBackend, SpawnCliAgentBackend, SpawnProcessExecutor, OwnedProcessGroup } from "../src/index.js";
import {OwnedProcessRoot} from "../src/owned-root-process.js";
import {drainCatalogProcess} from "../src/catalog-process.js";
function alive(pid:number):boolean {try{process.kill(pid,0);return true;}catch{return false;}}
it.runIf(process.platform!=="win32")("keeps inherited descendants outside root authority and requires their natural pipe closure",async()=>{
  const root=mkdtempSync(join(tmpdir(),"native-root-")),ready=join(root,"child.pid"),body=`require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(`require('node:fs').writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>{},1000)`)}],{stdio:['ignore','inherit','inherit']}).unref();setInterval(()=>{},1000)`;
  const child=spawn(process.execPath,["-e",body],{cwd:root,detached:false,stdio:["ignore","pipe","pipe"]}),owner=new OwnedProcessRoot(child),closed=new Promise<void>(resolve=>child.once("close",()=>resolve()));let pid:number|undefined;
  try{
    await vi.waitFor(()=>expect(existsSync(ready)).toBe(true));pid=Number(readFileSync(ready,"utf8"));await owner.stop();expect(alive(pid)).toBe(true);await expect(drainCatalogProcess(owner,closed,500)).rejects.toMatchObject({code:"MODEL_CATALOG_CLEANUP_UNKNOWN"});expect(alive(pid)).toBe(true);
  }finally{
    if(existsSync(ready)){const captured=Number(readFileSync(ready,"utf8"));if(alive(captured))process.kill(captured,"SIGKILL");}child.kill("SIGKILL");await closed;child.stdout.destroy();child.stderr.destroy();rmSync(root,{recursive:true,force:true});
  }
});
it.runIf(process.platform!=="win32")("lets Codex SIGINT clean its detached tool before draining owned descendants",async()=>{
  const root=mkdtempSync(join(tmpdir(),"codex-cooperative-")),toolFile=join(root,"tool.pid"),ownedFile=join(root,"owned.pid"),interrupted=join(root,"interrupted");
  const descendant=(file:string)=>`process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(file)},String(process.pid));setInterval(()=>{},1000)`;
  const body=`const fs=require('node:fs'),cp=require('node:child_process');const tool=cp.spawn(process.execPath,['-e',${JSON.stringify(descendant(toolFile))}],{detached:true,stdio:'ignore'});tool.unref();cp.spawn(process.execPath,['-e',${JSON.stringify(descendant(ownedFile))}],{stdio:'ignore'}).unref();process.on('SIGINT',()=>{tool.once('exit',()=>{fs.writeFileSync(${JSON.stringify(interrupted)},'tool exited after SIGINT');process.exit(0);});tool.kill('SIGKILL');});setInterval(()=>{},1000)`;
  writeFileSync(join(root,"exec"),body);const turn=await startOwned("codex",root,body);let tool:number|undefined,owned:number|undefined;
  try{
    await vi.waitFor(()=>{expect(existsSync(toolFile)).toBe(true);expect(existsSync(ownedFile)).toBe(true);});tool=Number(readFileSync(toolFile,"utf8"));owned=Number(readFileSync(ownedFile,"utf8"));
    await turn.cancel();expect(readFileSync(interrupted,"utf8")).toBe("tool exited after SIGINT");expect(alive(tool)).toBe(false);expect(alive(owned)).toBe(false);expect(await turn.result()).toMatchObject({state:"cancelled"});
  }finally{
    for(const file of [toolFile,ownedFile])if(existsSync(file)){const captured=Number(readFileSync(file,"utf8"));if(alive(captured))process.kill(captured,"SIGKILL");}
    if(turn.processId&&alive(turn.processId))process.kill(turn.processId,"SIGKILL");await turn.cancel();rmSync(root,{recursive:true,force:true});
  }
});
async function startOwned(kind: "codex" | "structured" | "qoder" | "generic", root: string, body: string): Promise<{ cancel(): Promise<void>; result(): Promise<{ state: string }>; processId?: number }> {
  if (kind === "codex") return new CodexCliBackend().start({ executable: process.execPath, codexHome: root, workspacePath: root, prompt: "fixture" });
  if (kind === "structured") return new SpawnCliAgentBackend().start({ executable: process.execPath, args: ["-e", body], workspacePath: root });
  if (kind === "generic") return new SpawnProcessExecutor().start({ file: process.execPath, args: ["-e", body], cwd: root, runId: "fixture" });
  const executable = fileURLToPath(new URL("./fixtures/owned-qoder.mjs", import.meta.url));
  return new QoderCliBackend().start({ executable, workspacePath: root, prompt: "fixture", providerSessionId: "native", resume: false });
}

it.each(["codex","structured","qoder","generic"] as const)("awaits actual owned descendant termination when cancelling %s",async(kind)=>{
  const root=mkdtempSync(join(tmpdir(),"native-group-")),ready=join(root,"child.pid");
  const descendant=`process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>{},1000)`;
  const body=`require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'}).unref();process.on('SIGTERM',()=>{});setInterval(()=>{},1000)`;
  // Exercise Codex argv through Node and a script named exec; avoid host shebang admission latency.
  writeFileSync(join(root,"exec"),body);
  const turn=await startOwned(kind,root,body);
  let pid:number|undefined;
  try{
    await vi.waitFor(()=>expect(existsSync(ready)).toBe(true));pid=Number(readFileSync(ready,"utf8"));
    expect(await Promise.race([turn.cancel().then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),3000))])).toBe(true);
    expect(alive(pid)).toBe(false);expect(await turn.result()).toMatchObject({state:"cancelled"});
  }finally{for(const owned of [pid,turn.processId])if(owned&&alive(owned))process.kill(owned,"SIGKILL");await turn.cancel();rmSync(root,{recursive:true,force:true});}
});
it.each(["codex","structured","qoder","generic"] as const)("drains background descendants before reporting normal %s completion",async(kind)=>{
  const root=mkdtempSync(join(tmpdir(),"native-exit-group-")),ready=join(root,"child.pid");
  const descendant=`process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>{},1000)`;
  const body=`require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'}).unref();const t=setInterval(()=>{if(require('node:fs').existsSync(${JSON.stringify(ready)})){console.log(JSON.stringify({type:'thread.started',thread_id:'native'}));console.log(JSON.stringify({type:'turn.completed'}));clearInterval(t);process.exit(0);}},10)`;
  // Exercise Codex argv through Node and a script named exec; avoid host shebang admission latency.
  writeFileSync(join(root,"exec"),body);
  const turn=await startOwned(kind,root,body);
  let pid:number|undefined;
  try{expect(await turn.result()).toMatchObject({state:"completed"});pid=Number(readFileSync(ready,"utf8"));expect(alive(pid)).toBe(false);}
  finally{if(pid&&alive(pid))process.kill(pid,"SIGKILL");await turn.cancel();rmSync(root,{recursive:true,force:true});}
});

it("keeps checking uncertain group presence and acknowledges only an observed absence", async () => {
  const pid = 123456789, original = process.kill;
  let observations = 0;
  const signals: Array<string | number | undefined> = [];
  const kill = vi.spyOn(process, "kill").mockImplementation((target, signal) => {
    if (target !== -pid) return original(target, signal);
    signals.push(signal);
    if (signal === 0) {
      observations++;
      if (observations === 2) throw Object.assign(new Error("permission uncertain"), { code: "EPERM" });
      if (observations >= 3) throw Object.assign(new Error("absent"), { code: "ESRCH" });
    }
    return true;
  });
  try {
    const child = Object.assign(new EventEmitter(), { pid, kill: () => true }) as ChildProcess;
    await new OwnedProcessGroup(child).stop();
    expect(observations).toBe(3); expect(signals).toContain("SIGTERM"); expect(signals).not.toContain("SIGKILL");
  } finally { kill.mockRestore(); }
});
it("never confirms termination while group presence remains permission-uncertain", async () => {
  const pid = 123456789, original = process.kill;
  vi.useFakeTimers();
  const kill = vi.spyOn(process, "kill").mockImplementation((target, signal) => {
    if (target !== -pid) return original(target, signal);
    if (signal === 0) throw Object.assign(new Error("permission uncertain"), { code: "EPERM" });
    return true;
  });
  try {
    const child = Object.assign(new EventEmitter(), { pid, kill: () => true }) as ChildProcess;
    const rejection = expect(new OwnedProcessGroup(child).stop()).rejects.toThrow("termination is unconfirmed");
    await vi.advanceTimersByTimeAsync(4100); await rejection;
  } finally { kill.mockRestore(); vi.useRealTimers(); }
});

it("keeps Generic stop pending nonterminal while blocking input until owned drain completes",async()=>{
  const release=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>(),original=OwnedProcessGroup.prototype.stop;let cleanup:(()=>Promise<void>)|undefined;
  const spy=vi.spyOn(OwnedProcessGroup.prototype,"stop").mockImplementation(function(this:OwnedProcessGroup){cleanup=()=>original.call(this);entered.resolve();return release.promise.then(()=>original.call(this));});
  const execution=await new SpawnProcessExecutor().start({file:process.execPath,args:["-e","setInterval(()=>{},1000)"],cwd:tmpdir(),runId:"pending-generic-stop"}),result=execution.result(),pending=execution.cancel();void result.catch(()=>undefined);void pending.catch(()=>undefined);
  try{await entered.promise;expect(await execution.status()).toEqual({state:"running"});await expect(execution.send("must not be written")).rejects.toMatchObject({code:"SESSION_NOT_INTERACTIVE"});release.resolve();await pending;expect(await execution.status()).toEqual({state:"cancelled"});expect(await result).toMatchObject({state:"cancelled"});}
  finally{release.resolve();spy.mockRestore();if(cleanup)await cleanup();await pending.catch(()=>undefined);await result.catch(()=>undefined);}
});
it("keeps Generic termination unconfirmed when owned drain rejects",async()=>{
  const original=OwnedProcessGroup.prototype.stop;let cleanup:(()=>Promise<void>)|undefined;
  const spy=vi.spyOn(OwnedProcessGroup.prototype,"stop").mockImplementation(function(this:OwnedProcessGroup){cleanup=()=>original.call(this);return Promise.reject(Error("owned drain is unconfirmed"));});
  const execution=await new SpawnProcessExecutor().start({file:process.execPath,args:["-e","setInterval(()=>{},1000)"],cwd:tmpdir(),runId:"unknown-generic-stop"}),result=execution.result();void result.catch(()=>undefined);
  try{await expect(execution.cancel()).rejects.toThrow("owned drain is unconfirmed");expect(await execution.status()).toEqual({state:"running"});await expect(execution.send("must stay fenced")).rejects.toMatchObject({code:"SESSION_NOT_INTERACTIVE"});}
  finally{spy.mockRestore();if(cleanup)await cleanup();await result.catch(()=>undefined);}
});
