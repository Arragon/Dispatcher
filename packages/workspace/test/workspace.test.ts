import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RepositoryRegistry, WorkspaceManager } from "../src/index.js";

const directories: string[] = [];
function repository(): { root: string; worktrees: string } {
  const base = mkdtempSync(join(tmpdir(), "dispatcher-workspace-"));
  directories.push(base);
  const root = join(base, "repo");
  const worktrees = join(base, "worktrees");
  mkdirSync(root);
  execFileSync("git", ["init", "-b", "main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Dispatcher Test"], { cwd: root });
  writeFileSync(join(root, "README.md"), "baseline\n");
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "same.txt"), "baseline\n");
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-m", "baseline"], { cwd: root });
  return { root, worktrees };
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("WorkspaceManager", () => {
  it("creates traceable isolated worktrees for concurrent runs", async () => {
    const fixture = repository();
    const registry = new RepositoryRegistry();
    registry.register({ id: "repo", root: fixture.root });
    const manager = new WorkspaceManager(registry, fixture.worktrees);
    const [one, two] = await Promise.all([
      manager.create({ repositoryId: "repo", taskId: "INH-1", runId: "run-one", attempt: 1, baseRef: "main", scopePaths: ["src"] }),
      manager.create({ repositoryId: "repo", taskId: "INH-1", runId: "run-two", attempt: 1, baseRef: "main", scopePaths: ["src"] }),
    ]);
    expect(one.path).not.toBe(two.path);
    expect(one.branch).toContain("inh-1-run-one-a1");
    writeFileSync(join(one.path, "src", "same.txt"), "one\n");
    writeFileSync(join(two.path, "src", "same.txt"), "two\n");
    expect(await manager.assertPathAllowed(one, "src/same.txt")).toContain(one.path);
    await expect(manager.assertPathAllowed(one, "../repo/README.md")).rejects.toMatchObject({ code: "PATH_OUT_OF_SCOPE" });
    expect((await manager.cleanupPlan(one))).toMatchObject({ safe: false, reasons: ["workspace has uncommitted changes"] });
  });

  it("rejects symlink escape and only removes clean known worktrees", async () => {
    const fixture = repository();
    const registry = new RepositoryRegistry();
    registry.register({ id: "repo", root: fixture.root });
    const manager = new WorkspaceManager(registry, fixture.worktrees);
    const handle = await manager.create({ repositoryId: "repo", taskId: "INH-2", runId: "clean", attempt: 1, baseRef: "main", scopePaths: ["src"] });
    symlinkSync("/tmp", join(handle.path, "src", "escape"));
    await expect(manager.assertPathAllowed(handle, "src/escape/file.txt")).rejects.toMatchObject({ code: "SYMLINK_ESCAPE" });
    rmSync(join(handle.path, "src", "escape"));
    const plan = await manager.cleanupPlan(handle);
    expect(plan.safe).toBe(true);
    const forged = { ...handle, runId: "forged" };
    expect(await manager.cleanupPlan(forged)).toMatchObject({ safe: false, reasons: expect.arrayContaining(["workspace is not registered by this manager"]) });
    await manager.cleanup(plan);
    expect(() => execFileSync("git", ["-C", fixture.root, "worktree", "list", "--porcelain"])).not.toThrow();
  });
});
