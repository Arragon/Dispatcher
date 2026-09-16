import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
  it("runs only registered commands, limits output, and blocks delivery only on required failure", async () => {
    const registry = new VerificationRegistry();
    registry.register({ id: "pass", file: process.execPath, args: ["-e", "console.log('ok')"], required: true, timeoutMs: 1_000, outputLimitBytes: 64 });
    registry.register({ id: "optional-fail", file: process.execPath, args: ["-e", "process.exit(2)"], required: false, timeoutMs: 1_000, outputLimitBytes: 64 });
    expect((await registry.run("pass", process.cwd())).status).toBe("passed");
    const optional = await registry.run("optional-fail", process.cwd());
    expect(optional.status).toBe("failed");
    expect(registry.blocksDelivery([optional])).toBe(false);
    await expect(registry.run("raw command", process.cwd())).rejects.toThrow(/not registered/);
  });
});
