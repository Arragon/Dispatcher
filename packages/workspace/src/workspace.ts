import {constants} from "node:fs";
import {gitInspectionEnvironment,readWorkspaceStatus} from "./git-inspection.js";
import {createHash} from "node:crypto";
import {isGitDeliveryTarget,type GitDeliveryTarget} from "@dispatcher/domain";
import { execFile } from "node:child_process";
import { mkdir, realpath, stat, lstat, readlink, open } from "node:fs/promises";
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

export interface WorkspaceCandidate {
  version: 1;
  id: string;
  headRevision: string;
  rootIdentity: { device: number; inode: number };
  changedFiles: string[];
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

export async function assertRepositoryIdentity(preview: {root:string;rootIdentity:{device:number;inode:number}}): Promise<void> {
  try {
    const canonical = await realpath(preview.root);
    const identity = await stat(canonical);
    if (canonical !== preview.root || !identity.isDirectory() || identity.dev !== preview.rootIdentity.device || identity.ino !== preview.rootIdentity.inode) throw Error("changed");
  } catch { throw new WorkspacePolicyError("REPOSITORY_CHANGED", "所选仓库目录已改变，请重新选择。"); }
}


export class WorkspaceManager {
  private readonly managed = new Map<string, WorkspaceHandle>();
  constructor(private readonly registry: RepositoryRegistry, private readonly worktreeRoot: string,private readonly owningPrivatePaths:()=>readonly string[]=()=>[]) {}

  get(path: string): WorkspaceHandle | undefined {
    const workspace = this.managed.get(resolve(path));
    return workspace ? structuredClone(workspace) : undefined;
  }
  private async physicalCandidate(path:string):Promise<string>{
    let ancestor=resolve(path);
    for(;;){
      try{return resolve(await realpath(ancestor),relative(ancestor,resolve(path)));}
      catch(error){if(!error||typeof error!=="object"||!("code" in error)||!["ENOENT","ENOTDIR"].includes(String(error.code)))throw error;const parent=dirname(ancestor);if(parent===ancestor)throw error;ancestor=parent;}
    }
  }
  private async assertPublicScope(repository:RepositoryRecord,scopePaths:string[]):Promise<void>{
    const privatePaths=this.owningPrivatePaths();
    if(!privatePaths.length)return;
    try{
      const root=await this.physicalCandidate(repository.root),candidates=await Promise.all([root,...scopePaths.map(path=>resolve(root,path))].map(path=>this.physicalCandidate(path)));
      for(const path of privatePaths){const privatePath=await this.physicalCandidate(isAbsolute(path)?path:resolve(root,path));if(candidates.some(candidate=>within(privatePath,candidate)))throw new WorkspacePolicyError("PRIVATE_PATH_SCOPE","Repository or requested scope enters an owning-process private directory");}
    }catch(error){if(error instanceof WorkspacePolicyError)throw error;throw new WorkspacePolicyError("PRIVATE_PATH_CHECK_UNAVAILABLE","Owning-process private path boundary could not be verified");}
  }

  async refs(repositoryId:string,offset=0,limit=50) {
    if(!Number.isSafeInteger(offset)||offset<0||offset>10_000||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new WorkspacePolicyError("INVALID_REF_PAGE","Ref offset/limit are outside the supported range");
    const repository=this.registry.get(repositoryId);await this.assertPublicScope(repository,[]);
    const root=await realpath(repository.root),signal=AbortSignal.timeout(8_000);
    const top=(await execute("git",["-C",root,"rev-parse","--show-toplevel"],{signal,timeout:8_000,maxBuffer:1024*1024})).stdout.trim();
    if(await realpath(top)!==root)throw new WorkspacePolicyError("INVALID_REPOSITORY_ROOT","Registered root must be the physical Git root");
    const output=(await execute("git",["-C",root,"for-each-ref",`--count=${offset+limit+1}`,"--sort=refname","--format=%(refname)%09%(objectname)","refs/heads","refs/remotes","refs/tags"],{signal,timeout:8_000,maxBuffer:2*1024*1024})).stdout;
    const all=output.trim()?output.trimEnd().split("\n"):[],page=all.slice(offset,offset+limit);
    const refs:Array<{name:string;commit:string;kind:"branch"|"tag"|"remote"}>=[];
    for(const line of page){
      const [name,object]=line.split("\t");
      if(!name||!object||!/^refs\/(heads|remotes|tags)\//.test(name)||!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(object))throw new WorkspacePolicyError("INVALID_REF_RESULT","Git returned an invalid reference");
      // Resolve annotated tags to the exact commit; non-commit tags are not execution bases.
      let commit:string;try{commit=(await execute("git",["-C",root,"rev-parse","--verify","--end-of-options",`${name}^{commit}`],{signal,timeout:8_000,maxBuffer:1024})).stdout.trim();}catch(error){if(signal.aborted)throw error;continue;}
      if(!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(commit))throw new WorkspacePolicyError("INVALID_REF_RESULT","Git returned an invalid commit");
      const kind=name.startsWith("refs/heads/")?"branch" as const:name.startsWith("refs/tags/")?"tag" as const:"remote" as const;
      refs.push({name,commit,kind});
    }
    return {refs,offset,limit,...(all.length>offset+limit?offset+limit<=10_000?{nextOffset:offset+limit}:{truncated:true}:{})};
  }

  async deliveryTarget(repositoryId:string):Promise<GitDeliveryTarget>{
    const {root}=await this.inspect({repositoryId,baseRef:"HEAD",scopePaths:[]});return (await this.deliveryRemote(root)).target;
  }
  async resolvePushTarget(workspace:WorkspaceHandle,expected:GitDeliveryTarget):Promise<string>{
    await this.restore(workspace);const current=await this.deliveryRemote(workspace.path);
    if(expected.version!==1||current.target.host!==expected.host||current.target.repository!==expected.repository||current.target.remoteFingerprint!==expected.remoteFingerprint)throw new WorkspacePolicyError("DELIVERY_TARGET_CHANGED","Owning repository push target changed; review again");
    return current.url;
  }
  private async deliveryRemote(cwd:string):Promise<{target:GitDeliveryTarget;url:string}>{
    const invalid=():never=>{throw new WorkspacePolicyError("INVALID_DELIVERY_REMOTE","Delivery requires one matching credential-free HTTPS or Git SSH origin fetch/push target");};
    let urls:string[];
    try{const signal=AbortSignal.timeout(8000);urls=await Promise.all([["remote","get-url","--all","origin"],["remote","get-url","--push","--all","origin"]].map(async args=>{const value=(await execute("git",args,{cwd,signal,timeout:8000,maxBuffer:8192})).stdout.trim();if(!value||value.includes("\n"))return invalid();return value;}));}catch{return invalid();}
    const identity=(raw:string):{host:string;repository:string}=>{
      if(raw.length>4000||/[\\%\s?#]/.test(raw))return invalid();
      let host:string,path:string;const scp=/^git@([a-zA-Z0-9.-]+):([^:]+)$/.exec(raw);
      if(scp){host=scp[1]!.toLowerCase();path=scp[2]!;}
      else{let url:URL;try{url=new URL(raw);}catch{return invalid();}if(!["https:","ssh:"].includes(url.protocol)||url.password||url.protocol==="https:"&&url.username||url.protocol==="ssh:"&&url.username!=="git"||raw.split("/").some(part=>part==="."||part===".."))return invalid();host=url.hostname.toLowerCase();path=url.pathname.replace(/^\//,"");}
      path=path.replace(/\/$/,"").replace(/\.git$/,"");const parts=path.split("/");
      if(!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host)||parts.length!==2||parts.some(part=>! /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(part)||part==="."||part===".."))return invalid();
      return {host,repository:path.toLowerCase()};
    };
    const fetch=identity(urls[0]!),push=identity(urls[1]!);if(fetch.host!==push.host||fetch.repository!==push.repository)return invalid();
    const target={version:1,...push,remoteFingerprint:createHash("sha256").update(JSON.stringify(urls)).digest("hex")};if(!isGitDeliveryTarget(target))return invalid();return {target,url:urls[1]!};
  }

  async inspect(plan: Pick<WorkspacePlan, "repositoryId" | "baseRef" | "scopePaths"> & { targetBranch?: string }): Promise<{ baseCommit: string; root: string }> {
    const repository = this.registry.get(plan.repositoryId);
    await this.assertPublicScope(repository,plan.scopePaths);
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

  async captureCandidate(input: { repositoryId: string; worktree: string; branch: string; scopePaths: string[] }): Promise<WorkspaceCandidate> {
    const repository = this.registry.get(input.repositoryId);
    await this.assertPublicScope(repository,input.scopePaths);
    const options = { timeout: 10_000, maxBuffer: 16 * 1024 * 1024,env:gitInspectionEnvironment() };
    let path: string;
    let identity: Awaited<ReturnType<typeof stat>>;
    try {
      const root = await realpath(this.worktreeRoot);
      path = await realpath(input.worktree);
      identity = await stat(path);
      const source = await realpath(repository.root);
      const git = async (directory: string, args: string[]) => (await execute("git", ["-C", directory,"-c","core.fsmonitor=false","-c","core.hooksPath=/dev/null", ...args], options)).stdout.replace(/\r?\n$/, "");
      if (!within(root, path) || path === root || path === source || !identity.isDirectory() || await realpath(await git(path, ["rev-parse", "--show-toplevel"])) !== path || await git(path, ["branch", "--show-current"]) !== input.branch || await realpath(await git(path, ["rev-parse", "--path-format=absolute", "--git-common-dir"])) !== await realpath(await git(source, ["rev-parse", "--path-format=absolute", "--git-common-dir"]))) throw Error("mismatch");
    } catch { throw new WorkspacePolicyError("CANDIDATE_WORKSPACE_MISMATCH", "Result must belong to its recorded managed Git worktree and branch"); }
    try {
      await readWorkspaceStatus(path);
      const git = async (args: string[]) => (await execute("git", ["-C", path,"-c","core.fsmonitor=false","-c","core.hooksPath=/dev/null", ...args], options)).stdout;
      const headRevision = (await git(["rev-parse", "--verify", "HEAD"])).trim();
      const patch = await git(["diff", "--no-ext-diff", "--no-textconv", "--binary", "HEAD", "--"]);
      const tracked = (await git(["diff", "--no-ext-diff", "--no-textconv", "--name-only", "-z", "HEAD", "--"])).split("\0").filter(Boolean);
      const untracked = (await git(["ls-files", "--others", "--exclude-standard", "-z"])).split("\0").filter(Boolean).sort();
      if (untracked.length > 10_000) throw Error("candidate limit");
      const changedFiles = [...new Set([...tracked, ...untracked])].sort();
      for (const file of changedFiles) {
        const absolute = resolve(path, file);
        if (!within(path, absolute) || input.scopePaths.length && !input.scopePaths.some(scope => within(resolve(path, scope), absolute))) throw new WorkspacePolicyError("PATH_OUT_OF_SCOPE", "Result contains changes outside the registered scope");
      }
      const rootIdentity = { device: identity.dev, inode: identity.ino };
      const hash = createHash("sha256").update(JSON.stringify({ headRevision, rootIdentity, branch: input.branch, patch }));
      let bytes = 0;
      for (const file of untracked) {
        const absolute = resolve(path, file);
        if (!within(path, await realpath(dirname(absolute)))) throw Error("symlink parent");
        const info = await lstat(absolute);
        if (!info.isFile() && !info.isSymbolicLink()) throw Error("unsupported file");
        bytes += info.size;
        if (bytes > 64 * 1024 * 1024) throw Error("candidate limit");
        let contents: string | Buffer;
        if (info.isSymbolicLink()) contents = await readlink(absolute);
        else {
          const file = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          try {
            const opened = await file.stat();
            if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino || opened.size !== info.size) throw Error("file changed");
            contents = await file.readFile();
            if (contents.length !== info.size) throw Error("file changed");
          } finally { await file.close(); }
        }
        hash.update(JSON.stringify({ file, mode: info.mode & 0o777, contentHash: createHash("sha256").update(contents).digest("hex") }));
      }
      await assertRepositoryIdentity({ root: path, rootIdentity });
      if ((await git(["rev-parse", "--verify", "HEAD"])).trim() !== headRevision) throw new WorkspacePolicyError("CANDIDATE_CHANGED", "Result changed while it was being inspected");
      return { version: 1, id: hash.digest("hex"), headRevision, rootIdentity, changedFiles };
    } catch (error) {
      if (error instanceof WorkspacePolicyError) throw error;
      throw new WorkspacePolicyError("CANDIDATE_UNAVAILABLE", "Result contents could not be safely inspected within the configured limits");
    }
  }


  async create(plan: WorkspacePlan, options: { beforeCreate?: () => void } = {}): Promise<WorkspaceHandle> {
    const handle=await this.plan(plan);
    options.beforeCreate?.();
    await mkdir(this.worktreeRoot,{recursive:true});
    const root=await realpath(this.worktreeRoot);
    if(!within(root,handle.path))throw new WorkspacePolicyError("WORKSPACE_PATH_ESCAPE","Managed root changed after planning");
    await this.assertPublicScope(this.registry.get(plan.repositoryId),plan.scopePaths);
    options.beforeCreate?.();
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
    let repository:RepositoryRecord;
    try{repository=this.registry.get(workspace.repositoryId);}
    catch(error){if(!(error instanceof WorkspacePolicyError)||error.code!=="REPOSITORY_NOT_FOUND"||!workspace.repositoryRoot)throw error;repository={id:workspace.repositoryId,root:workspace.repositoryRoot};}
    await this.assertPublicScope({...repository,root:workspace.repositoryRoot??repository.root},[candidate]);
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
