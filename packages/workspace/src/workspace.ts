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
}

export interface WorkspaceHandle extends WorkspacePlan {
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

  async create(plan: WorkspacePlan): Promise<WorkspaceHandle> {
    const repository = this.registry.get(plan.repositoryId);
    const root = resolve(this.worktreeRoot);
    await mkdir(root, { recursive: true });
    const name = `${safeSegment(plan.taskId)}-${safeSegment(plan.runId)}-a${plan.attempt}`;
    const path = resolve(root, name);
    if (!within(root, path)) throw new WorkspacePolicyError("WORKSPACE_PATH_ESCAPE", "Worktree path escapes managed root");
    const branch = `dispatcher/${safeSegment(plan.taskId)}-${safeSegment(plan.runId)}-a${plan.attempt}`;
    let baseRevision: string;
    try {
      baseRevision = (await execute("git", ["-C", repository.root, "rev-parse", "--verify", `${plan.baseRef}^{commit}`])).stdout.trim();
      await execute("git", ["-C", repository.root, "worktree", "add", "-b", branch, path, baseRevision]);
    } catch (error) {
      throw new WorkspacePolicyError("WORKTREE_CREATE_FAILED", error instanceof Error ? error.message : "Worktree creation failed");
    }
    const handle = { ...structuredClone(plan), path, branch, baseRevision, createdAt: new Date().toISOString() };
    this.managed.set(path, structuredClone(handle));
    return handle;
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
      const parent = await realpath(dirname(absolute));
      canonical = resolve(parent, absolute.slice(dirname(absolute).length + 1));
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
    const root = resolve(this.worktreeRoot);
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
    const repository = this.registry.get(plan.workspace.repositoryId);
    try {
      await execute("git", ["-C", repository.root, "worktree", "remove", plan.workspace.path]);
      this.managed.delete(resolve(plan.workspace.path));
    }
    catch (error) { throw new WorkspacePolicyError("WORKTREE_REMOVE_FAILED", error instanceof Error ? error.message : "Worktree removal failed"); }
  }
}
