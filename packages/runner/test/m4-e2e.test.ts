import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GenericCliAdapter, type ProcessExecutor } from "@dispatcher/adapters";
import { RepositoryRegistry, WorkspaceManager } from "@dispatcher/workspace";
import { ProcessManager, VerificationRegistry } from "../src/index.js";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("M4 execution gate", () => {
  it("runs two isolated worktrees with bounded logs, cancellation, results, verification, and safe cleanup", async () => {
    const base = mkdtempSync(join(tmpdir(), "dispatcher-m4-e2e-"));
    directories.push(base);
    const repository = join(base, "repository");
    mkdirSync(join(repository, "src"), { recursive: true });
    execFileSync("git", ["init", "-b", "main"], { cwd: repository });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repository });
    execFileSync("git", ["config", "user.name", "Dispatcher Test"], { cwd: repository });
    writeFileSync(join(repository, "src", "same.txt"), "baseline\n");
    execFileSync("git", ["add", "."], { cwd: repository });
    execFileSync("git", ["commit", "-m", "baseline"], { cwd: repository });

    const registry = new RepositoryRegistry();
    registry.register({ id: "fixture", root: repository });
    const workspaces = new WorkspaceManager(registry, join(base, "worktrees"));
    const [one, two] = await Promise.all([
      workspaces.create({ repositoryId: "fixture", taskId: "INH-E2E", runId: "one", attempt: 1, baseRef: "main", scopePaths: ["src"] }),
      workspaces.create({ repositoryId: "fixture", taskId: "INH-E2E", runId: "two", attempt: 1, baseRef: "main", scopePaths: ["src"] }),
    ]);

    const processes = new ProcessManager(join(base, "logs"), { maxFileBytes: 128, maxTotalBytes: 256, retentionFiles: 2, tailBytes: 128 });
    const executor: ProcessExecutor = {
      start: async (input) => {
        const handle = await processes.start({ ...input, timeoutMs: 2_000 });
        return {
          id: handle.id,
          status: async () => {
            if (handle.status().state === "running") return { state: "running" as const };
            const result = await handle.result();
            return { state: result.classification === "success" ? "completed" as const : result.classification === "cancelled" ? "cancelled" as const : "failed" as const };
          },
          send: (data) => handle.send(data),
          cancel: () => handle.cancel(),
          result: async () => {
            const result = await handle.result();
            return { state: result.classification === "success" ? "completed" as const : result.classification === "cancelled" ? "cancelled" as const : "failed" as const, summary: result.stdoutTail || result.classification };
          },
        };
      },
    };
    const template = {
      file: process.execPath,
      args: ["-e", "const fs=require('fs');const v=process.argv[1];fs.writeFileSync('src/same.txt',v);console.log(v.repeat(80));if(v.startsWith('WAIT'))setInterval(()=>{},1000)", "{{prompt}}"],
    };
    const adapterOne = new GenericCliAdapter(executor, template);
    const adapterTwo = new GenericCliAdapter(executor, template);
    const [sessionOne, sessionTwo] = await Promise.all([
      adapterOne.start({ runId: "one", workspacePath: one.path, prompt: "ONE" }),
      adapterTwo.start({ runId: "two", workspacePath: two.path, prompt: "WAIT-TWO" }),
    ]);
    const resultOnePromise = adapterOne.result(sessionOne.id);
    await expect.poll(() => readFileSync(join(two.path, "src", "same.txt"), "utf8"), { timeout: 2_000 }).toBe("WAIT-TWO");
    await adapterTwo.cancel(sessionTwo.id);
    const [resultOne, resultTwo] = await Promise.all([resultOnePromise, adapterTwo.result(sessionTwo.id)]);
    expect(resultOne.state).toBe("COMPLETED");
    expect(resultTwo.state).toBe("CANCELLED");
    expect(readFileSync(join(one.path, "src", "same.txt"), "utf8")).toBe("ONE");
    expect(readFileSync(join(two.path, "src", "same.txt"), "utf8")).toBe("WAIT-TWO");
    expect(one.path).not.toBe(two.path);

    const verification = new VerificationRegistry();
    verification.register({ id: "content", file: process.execPath, args: ["-e", "if(!require('fs').readFileSync('src/same.txt','utf8'))process.exit(1)"], required: true, timeoutMs: 1_000, outputLimitBytes: 128 });
    const verified = await Promise.all([verification.run("content", one.path), verification.run("content", two.path)]);
    expect(verified.every((result) => result.status === "passed")).toBe(true);
    expect(verification.blocksDelivery(verified)).toBe(false);

    for (const workspace of [one, two]) {
      execFileSync("git", ["add", "src/same.txt"], { cwd: workspace.path });
      execFileSync("git", ["commit", "-m", `run ${workspace.runId}`], { cwd: workspace.path });
      const cleanup = await workspaces.cleanupPlan(workspace);
      expect(cleanup.safe).toBe(true);
      await workspaces.cleanup(cleanup);
    }
    const logFiles = execFileSync("find", [join(base, "logs"), "-type", "f"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
    expect(logFiles.length).toBeGreaterThan(0);
    expect(logFiles.every((file) => statSync(file).size <= 128)).toBe(true);
  });
});
