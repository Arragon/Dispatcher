import { execFile } from "node:child_process";
import { mkdir, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

export interface RepositoryRecord {
  id: string;
  root: string;
  remote?: string;
}

export interface WorkspacePlan {
  repositoryId: string;
  taskId: string;
  runId: string;
  attempt: number;
  baseRef: string;
  scopePaths: string[];
  baseCommit?: string;
  targetBranch?: string;
}

export interface WorkspaceHandle extends WorkspacePlan {
  repositoryRoot?: string;
  path: string;
  branch: string;
  baseRevision: string;
  createdAt: string;
}

export interface CleanupPlan {
  workspace: WorkspaceHandle;
  safe: boolean;
  reasons: string[];
}

export class WorkspacePolicyError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "WorkspacePolicyError"; }
}

function safeSegment(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  if (!normalized || normalized === "." || normalized === "..") throw new WorkspacePolicyError("INVALID_WORKSPACE_ID", "Workspace identity cannot form a safe path");
  return normalized;
}

function within(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

export class RepositoryRegistry {
  private readonly repositories = new Map<string, RepositoryRecord>();
  register(record: RepositoryRecord): void {
    if (!isAbsolute(record.root)) throw new WorkspacePolicyError("REPOSITORY_PATH_NOT_ABSOLUTE", "Repository root must be absolute");
    this.repositories.set(record.id, { ...record, root: resolve(record.root) });
  }
  get(id: string): RepositoryRecord {
    const record = this.repositories.get(id);
    if (!record) throw new WorkspacePolicyError("REPOSITORY_NOT_FOUND", `Unknown repository ${id}`);
    return structuredClone(record);
  }
  clear(): void { this.repositories.clear(); }
}

export class WorkspaceManager {
  private readonly managed = new Map<string, WorkspaceHandle>();
  constructor(private readonly registry: RepositoryRegistry, private readonly worktreeRoot: string) {}

  get(path: string): WorkspaceHandle | undefined {
    const workspace = this.managed.get(resolve(path));
    return workspace ? structuredClone(workspace) : undefined;
  }

  async inspect(plan: Pick<WorkspacePlan, "repositoryId" | "baseRef" | "scopePaths"> & { targetBranch?: string }): Promise<{ baseCommit: string; root: string }> {
    const repository = this.registry.get(plan.repositoryId);
    const root = await realpath(repository.root);
    const top = (await execute("git", ["-C", root, "rev-parse", "--show-toplevel"])).stdout.trim();
    if (await realpath(top) !== root) throw new WorkspacePolicyError("INVALID_REPOSITORY_ROOT", "Registered root must be the physical Git root");
    if (!plan.baseRef || plan.baseRef.startsWith("-") || Array.from(plan.baseRef).some(c=>c.codePointAt(0)!<=32)) throw new WorkspacePolicyError("INVALID_BASE_REF", "Invalid base reference");
    const baseCommit = (await execute("git", ["-C", root, "rev-parse", "--verify", "--end-of-options", `${plan.baseRef}^{commit}`])).stdout.trim();
    for (const scope of plan.scopePaths) {
      if (!scope || isAbsolute(scope) || scope.split(/[\\/]/).includes("..") || scope.split(/[\\/]/).includes(".git")) throw new WorkspacePolicyError("INVALID_SCOPE", "Scope must stay inside the repository");
      let candidate = resolve(root, scope);
      while (candidate !== root) {
        try { if (!within(root, await realpath(candidate))) throw new WorkspacePolicyError("SYMLINK_ESCAPE", "Scope resolves outside repository"); break; }
        catch (error) { if (error instanceof WorkspacePolicyError) throw error; candidate = dirname(candidate); }
      }
    }
    if (plan.targetBranch) {
      try { await execute("git", ["check-ref-format", "--branch", plan.targetBranch]); }
      catch { throw new WorkspacePolicyError("INVALID_TARGET_BRANCH", "Invalid target branch"); }
      const refs = (await execute("git", ["-C", root, "for-each-ref", "--format=%(refname)", `refs/heads/${plan.targetBranch}`])).stdout.trim();
      if (refs) throw new WorkspacePolicyError("BRANCH_EXISTS", "Target branch already exists");
    }
    return { baseCommit, root };
  }

  async plan(plan:WorkspacePlan):Promise<WorkspaceHandle> {
    if(!Number.isSafeInteger(plan.attempt)||plan.attempt<1)throw new WorkspacePolicyError("INVALID_ATTEMPT","Workspace attempt must be a positive integer");
    const branch=plan.targetBranch??`dispatcher/${safeSegment(plan.taskId)}-${safeSegment(plan.runId)}-a${plan.attempt}`;
    const inspected=await this.inspect({repositoryId:plan.repositoryId,baseRef:plan.baseCommit??plan.baseRef,scopePaths:plan.scopePaths,targetBranch:branch});
    const desired=resolve(this.worktreeRoot);let ancestor=desired;
    for(;;){try{const physical=await realpath(ancestor);ancestor=resolve(physical,relative(ancestor,desired));break;}catch(error){const parent=dirname(ancestor);if(parent===ancestor)throw error;ancestor=parent;}}
    const path=resolve(ancestor,`${safeSegment(plan.taskId)}-${safeSegment(plan.runId)}-a${plan.attempt}`);
    if(!within(ancestor,path))throw new WorkspacePolicyError("WORKSPACE_PATH_ESCAPE","Worktree path escapes managed root");
    return {...structuredClone(plan),repositoryRoot:inspected.root,path,branch,baseRevision:inspected.baseCommit,createdAt:new Date().toISOString()};
  }

  async create(plan: WorkspacePlan): Promise<WorkspaceHandle> {
    const handle=await this.plan(plan);
    await mkdir(this.worktreeRoot,{recursive:true});
    const root=await realpath(this.worktreeRoot);
    if(!within(root,handle.path))throw new WorkspacePolicyError("WORKSPACE_PATH_ESCAPE","Managed root changed after planning");
    try{await execute("git",["-C",handle.repositoryRoot!,"worktree","add","-b",handle.branch,handle.path,handle.baseRevision]);}
    catch(error){throw new WorkspacePolicyError("WORKTREE_CREATE_FAILED",error instanceof Error?error.message:"Worktree creation failed");}
    this.managed.set(handle.path,structuredClone(handle));return handle;
  }

  async restore(handle: WorkspaceHandle): Promise<void> {
    const managedRoot = await realpath(this.worktreeRoot);
    const path = await realpath(handle.path);
    if (!within(managedRoot, path) || path !== resolve(handle.path)) throw new WorkspacePolicyError("WORKSPACE_PATH_ESCAPE", "Restored worktree must be physically inside managed root");
    const repositoryRoot = handle.repositoryRoot ?? this.registry.get(handle.repositoryId).root;
    const git = async (cwd: string, args: string[]) => (await execute("git", ["-C", cwd, ...args])).stdout.trim();
    const common = await realpath(resolve(path, await git(path, ["rev-parse", "--git-common-dir"])));
    const expected = await realpath(resolve(repositoryRoot, await git(repositoryRoot, ["rev-parse", "--git-common-dir"])));
    if (common !== expected || await git(path, ["symbolic-ref", "--short", "HEAD"]) !== handle.branch) throw new WorkspacePolicyError("WORKSPACE_IDENTITY_CHANGED", "Worktree identity changed");
    await git(path, ["merge-base", "--is-ancestor", handle.baseRevision, "HEAD"]);
    this.managed.set(path, structuredClone(handle));
  }

  async resultFiles(workspace: WorkspaceHandle): Promise<string[]> {
    if (!this.get(workspace.path)) throw new WorkspacePolicyError("WORKSPACE_NOT_MANAGED", "Worktree is not restored or registered");
    const git = async (args: string[]) => (await execute("git", ["-C", workspace.path, ...args], { maxBuffer: 1024 * 1024 })).stdout.split("\0").filter(Boolean);
    const files = [...new Set([...(await git(["diff", "--name-only", "-z", workspace.baseRevision, "--"])), ...(await git(["ls-files", "--others", "--exclude-standard", "-z"]))])].sort();
    if (files.length > 5000) throw new WorkspacePolicyError("RESULT_TOO_LARGE", "Change manifest exceeds 5000 files");
    for (const file of files) await this.assertPathAllowed(workspace, file);
    return files;
  }

  async fetch(repositoryId: string): Promise<void> {
    const repository = this.registry.get(repositoryId);
    if (!repository.remote) throw new WorkspacePolicyError("REMOTE_NOT_CONFIGURED", "Repository has no configured remote");
    await execute("git", ["-C", repository.root, "fetch", "--prune", repository.remote]);
  }

  async assertPathAllowed(workspace: WorkspaceHandle, candidate: string): Promise<string> {
    const workspaceRoot = await realpath(workspace.path);
    const absolute = resolve(workspaceRoot, candidate);
    if (!within(workspaceRoot, absolute)) throw new WorkspacePolicyError("PATH_OUT_OF_SCOPE", "Path escapes worktree");
    let canonical: string;
    try { canonical = await realpath(absolute); }
    catch {
      let parent = dirname(absolute);
      while (parent !== workspaceRoot) {
        try { const resolved = await realpath(parent); canonical = resolve(resolved, relative(parent, absolute)); break; }
        catch { parent = dirname(parent); }
      }
      canonical ??= absolute;
    }
    if (!within(workspaceRoot, canonical)) throw new WorkspacePolicyError("SYMLINK_ESCAPE", "Path resolves outside worktree");
    if (workspace.scopePaths.length > 0) {
      const relativePath = relative(workspaceRoot, canonical);
      const allowed = workspace.scopePaths.some((scope) => {
        const normalized = resolve(workspaceRoot, scope);
        return within(normalized, canonical);
      });
      if (!allowed) throw new WorkspacePolicyError("PATH_OUT_OF_SCOPE", `${relativePath} is outside declared scope`);
    }
    return canonical;
  }

  async cleanupPlan(workspace: WorkspaceHandle): Promise<CleanupPlan> {
    const reasons: string[] = [];
    const root = await realpath(this.worktreeRoot);
    const path = resolve(workspace.path);
    if (!within(root, path)) reasons.push("workspace is outside managed root");
    const registered = this.managed.get(path);
    if (!registered || registered.runId !== workspace.runId || registered.branch !== workspace.branch || registered.baseRevision !== workspace.baseRevision) reasons.push("workspace is not registered by this manager");
    try {
      const info = await stat(path);
      if (!info.isDirectory()) reasons.push("workspace is not a directory");
      const status = (await execute("git", ["-C", path, "status", "--porcelain"])).stdout.trim();
      if (status) reasons.push("workspace has uncommitted changes");
    } catch { reasons.push("workspace cannot be inspected"); }
    return { workspace: structuredClone(workspace), safe: reasons.length === 0, reasons };
  }

  async cleanup(plan: CleanupPlan): Promise<void> {
    if (!plan.safe) throw new WorkspacePolicyError("UNSAFE_CLEANUP", plan.reasons.join("; "));
    const repositoryRoot = plan.workspace.repositoryRoot ?? this.registry.get(plan.workspace.repositoryId).root;
    try {
      await execute("git", ["-C", repositoryRoot, "worktree", "remove", plan.workspace.path]);
      this.managed.delete(resolve(plan.workspace.path));
    }
    catch (error) { throw new WorkspacePolicyError("WORKTREE_REMOVE_FAILED", error instanceof Error ? error.message : "Worktree removal failed"); }
  }
}
