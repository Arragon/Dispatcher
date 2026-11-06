import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  it("checks physical scope without Git or child-process creation", async () => {
    const base = mkdtempSync(join(tmpdir(), "dispatcher-scope-")); directories.push(base);
    const root = join(base, "root"), outside = join(base, "outside"), worktrees = join(base, "worktrees"); mkdirSync(root); mkdirSync(outside);
    const registry = new RepositoryRegistry(); registry.register({ id: "repo", root });
    const manager = new WorkspaceManager(registry, worktrees, () => [join(root, "private")]);
    expect(await manager.inspectScope({ repositoryId: "repo", scopePaths: ["new/file.ts"] })).toMatchObject({ root: realpathSync(root) });
    expect(existsSync(join(root, ".git"))).toBe(false); expect(existsSync(worktrees)).toBe(false);
    symlinkSync(outside, join(root, "escape"));
    await expect(manager.inspectScope({ repositoryId: "repo", scopePaths: ["escape/new.ts"] })).rejects.toMatchObject({ code: "SYMLINK_ESCAPE" });
    await expect(manager.inspectScope({ repositoryId: "repo", scopePaths: ["private/new.ts"] })).rejects.toMatchObject({ code: "PRIVATE_PATH_SCOPE" });
    await expect(manager.inspectScope({ repositoryId: "repo", scopePaths: ["../outside", ".git/config"] })).rejects.toMatchObject({ code: "INVALID_SCOPE" });
  });
  it("plans an owning-runner path without creating a worktree or branch",async()=>{
    const fixture=repository(),registry=new RepositoryRegistry();registry.register({id:"repo",root:fixture.root});const manager=new WorkspaceManager(registry,fixture.worktrees);
    const request={repositoryId:"repo",taskId:"task",runId:"run",attempt:1,baseRef:"main",scopePaths:["src"]};
    const plan=await manager.plan(request);expect(existsSync(fixture.worktrees)).toBe(false);expect(execFileSync("git",["-C",fixture.root,"branch","--list",plan.branch],{encoding:"utf8"})).toBe("");
    await expect(manager.create(request,{beforeCreate:()=>{throw new Error("lease expired");}})).rejects.toThrow("lease expired");
    expect(existsSync(fixture.worktrees)).toBe(false);expect(execFileSync("git",["-C",fixture.root,"branch","--list",plan.branch],{encoding:"utf8"})).toBe("");
    const actual=await manager.create({...request,baseCommit:plan.baseRevision});expect(actual).toMatchObject({path:plan.path,branch:plan.branch,baseRevision:plan.baseRevision});
  });
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
    unlinkSync(join(handle.path, "src", "escape"));
    const plan = await manager.cleanupPlan(handle);
    expect(plan.safe).toBe(true);
    const forged = { ...handle, runId: "forged" };
    expect(await manager.cleanupPlan(forged)).toMatchObject({ safe: false, reasons: expect.arrayContaining(["workspace is not registered by this manager"]) });
    await manager.cleanup(plan);
    expect(() => execFileSync("git", ["-C", fixture.root, "worktree", "list", "--porcelain"])).not.toThrow();
  });
  it("keeps native Git hooks and provider context without passing Controller authority",async()=>{
    const fixture=repository(),registry=new RepositoryRegistry();registry.register({id:"repo",root:fixture.root});const manager=new WorkspaceManager(registry,fixture.worktrees),report=join(fixture.root,"hook-report.json"),hook=join(fixture.root,".git","hooks","post-checkout");
    writeFileSync(hook,`#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(report)},JSON.stringify({authority:Object.keys(process.env).some(key=>['DISPATCHER_OWNER_TOKEN','DISPATCHER_SECRET_STORE_KEY'].includes(key.toUpperCase())),provider:process.env.DISPATCHER_TEST_PROVIDER_CONTEXT}));\n`);chmodSync(hook,0o755);
    vi.stubEnv("DISPATCHER_OWNER_TOKEN","fake-controller-canary");vi.stubEnv("DISPATCHER_SECRET_STORE_KEY","fake-encryption-canary");vi.stubEnv("dispatcher_owner_token","fake-lowercase-canary");vi.stubEnv("DISPATCHER_TEST_PROVIDER_CONTEXT","native-provider-context");
    try{await manager.create({repositoryId:"repo",taskId:"env",runId:"env",attempt:1,baseRef:"main",scopePaths:[]});expect(JSON.parse(readFileSync(report,"utf8"))).toEqual({authority:false,provider:"native-provider-context"});}finally{vi.unstubAllEnvs();}
  });
});
