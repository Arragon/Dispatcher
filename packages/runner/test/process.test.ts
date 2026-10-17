import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoundedLogWriter, ProcessManager, VerificationRegistry } from "../src/index.js";

const directories: string[] = [];
function directory(): string { const value = mkdtempSync(join(tmpdir(), "dispatcher-runner-")); directories.push(value); return value; }
afterEach(() => { for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true }); });

describe("bounded raw logs", () => {
  it("rotates, enforces a total budget, strips ANSI from tails, and redacts credentials", () => {
    const writer = new BoundedLogWriter(directory(), "raw", { maxFileBytes: 48, maxTotalBytes: 96, retentionFiles: 4, tailBytes: 80 });
    for (let index = 0; index < 8; index += 1) writer.write(`\u001b[31mline-${index} sk-secret-canary-1234567890\u001b[0m\n`);
    expect(writer.files().length).toBeLessThanOrEqual(4);
    expect(writer.files().reduce((sum, file) => sum + statSync(file).size, 0)).toBeLessThanOrEqual(96);
    expect(writer.tail()).not.toContain("\u001b[");
    expect(writer.tail()).not.toContain("sk-secret-canary");
  });

  it("shares the total budget across stdout and stderr files", () => {
    const root = directory();
    const budget = { maxFileBytes: 48, maxTotalBytes: 80, retentionFiles: 3, tailBytes: 64 };
    const stdout = new BoundedLogWriter(root, "stdout", budget);
    const stderr = new BoundedLogWriter(root, "stderr", budget);
    for (let index = 0; index < 5; index += 1) { stdout.write("o".repeat(40)); stderr.write("e".repeat(40)); }
    const files = [...stdout.files(), ...stderr.files()];
    expect(new Set(files).size).toBe(files.length);
    expect(files.reduce((sum, file) => sum + statSync(file).size, 0)).toBeLessThanOrEqual(80);
  });
});

describe("ProcessManager", () => {
  it("rejects a missing executable with its spawn cause and no unhandled error", async () => {
    const manager = new ProcessManager(directory());
    await expect(manager.start({ runId: "missing", file: join(directory(), "missing-executable"), args: [], cwd: process.cwd() })).rejects.toThrow(/ENOENT/);
    expect(manager.activeCount).toBe(0);
    await manager.shutdown();
  });
  it("lazily spawns a real child, streams bounded activity, and classifies success", async () => {
    const manager = new ProcessManager(directory(), { maxFileBytes: 1_024, maxTotalBytes: 2_048, retentionFiles: 2, tailBytes: 256 });
    expect(manager.activeCount).toBe(0);
    const handle = await manager.start({ runId: "success", file: process.execPath, args: ["-e", "console.log('hello')"], cwd: process.cwd(), timeoutMs: 2_000 });
    expect(manager.activeCount).toBe(1);
    const result = await handle.result();
    expect(result).toMatchObject({ classification: "success", exitCode: 0, stdoutTail: expect.stringContaining("hello") });
    expect(manager.activeCount).toBe(0);
  });

  it("cancels the controlled process group and classifies timeout", async () => {
    const manager = new ProcessManager(directory());
    const cancelled = await manager.start({ runId: "cancel", file: process.execPath, args: ["-e", "setInterval(()=>{},1000)"], cwd: process.cwd() });
    await cancelled.cancel();
    expect((await cancelled.result()).classification).toBe("cancelled");
    const timed = await manager.start({ runId: "timeout", file: process.execPath, args: ["-e", "setInterval(()=>{},1000)"], cwd: process.cwd(), timeoutMs: 30 });
    expect((await timed.result()).classification).toBe("timeout");
  });
});

describe("VerificationRegistry", () => {
  it("awaits termination of signal-ignoring verification descendants after abort",async()=>{
    const root=directory(),ready=join(root,"child.pid"),abort=new AbortController(),registry=new VerificationRegistry();let pid:number|undefined;
    const alive=()=>{try{process.kill(pid!,0);return true;}catch{return false;}};
    const descendant=`process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>{},1000)`;
    const parent=`require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});process.on('SIGTERM',()=>{});setInterval(()=>{},1000)`;
    registry.register({id:"tree",file:process.execPath,args:["-e",parent],required:true,timeoutMs:5000,outputLimitBytes:1000});const verifying=registry.run("tree",root,abort.signal);
    try{await vi.waitFor(()=>expect(existsSync(ready)).toBe(true));pid=Number(readFileSync(ready,"utf8"));abort.abort();expect(await verifying).toMatchObject({status:"failed"});expect(alive()).toBe(false);}
    finally{if(pid&&alive())process.kill(pid,"SIGKILL");abort.abort();}
  });
  it("runs only registered commands, limits output, and blocks delivery only on required failure", async () => {
    const registry = new VerificationRegistry();
    registry.register({ id: "pass", file: process.execPath, args: ["-e", "console.log('ok')"], required: true, timeoutMs: 5_000, outputLimitBytes: 64 });
    registry.register({ id: "optional-fail", file: process.execPath, args: ["-e", "process.exit(2)"], required: false, timeoutMs: 5_000, outputLimitBytes: 64 });
    expect((await registry.run("pass", process.cwd())).status).toBe("passed");
    const optional = await registry.run("optional-fail", process.cwd());
    expect(optional.status).toBe("failed");
    expect(registry.blocksDelivery([optional])).toBe(false);
    await expect(registry.run("raw command", process.cwd())).rejects.toThrow(/not registered/);
  });
});

it.each(["process", "pty"] as const)("binds Generic CLI PWD to its managed cwd in %s mode", async mode => {
  const root = directory(), manager = new ProcessManager(join(root, "logs"));
  try {
    const handle = await manager.start({ runId: "pwd", file: process.execPath, args: ["-e", "console.log(JSON.stringify({pwd:process.env.PWD,cwd:process.cwd()}))"], cwd: root, mode });
    const result = await handle.result();
    expect(result.classification).toBe("success");
    expect(JSON.parse(result.stdoutTail.trim())).toEqual({ pwd: root, cwd: realpathSync(root) });
  } finally { await manager.shutdown(); }
});
