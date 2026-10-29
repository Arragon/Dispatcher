import {gitInspectionEnvironment,gitUrlRewriteConfigured} from "./git-inspection.js";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, readlink, realpath, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { assertRepositoryIdentity, mutateWorktrees, type WorkspaceManager, WorkspacePolicyError, type WorkspaceCandidate } from "./workspace.js";
const execute=promisify(execFile);
export interface CandidateSource {repositoryId:string;worktree:string;branch:string;scopePaths:string[];repositoryScopePaths:string[]}
export interface GitDirectoryIdentity {path:string;device:number;inode:number}
export interface GitWorktreeContext {worktree:GitDirectoryIdentity;gitDirectory:GitDirectoryIdentity;commonDirectory:GitDirectoryIdentity;objectsDirectory:GitDirectoryIdentity;indexPath:string}
export interface DeliveryGitContext {version:1;source:GitWorktreeContext;snapshot:GitWorktreeContext}
export interface DeliveryCandidate {version:1;id:string;source:CandidateSource;candidate:WorkspaceCandidate;commit:string;tree:string;path:string;rootIdentity:{device:number;inode:number};commonDirectory:string;contentFingerprint:string;pushRemoteFingerprint:string;pushUrl?:string;gitContext?:DeliveryGitContext}
/** Snapshot capacity includes uncertain/failed directories; they are retained, never force-deleted. */
export class VerificationSnapshots {
  private allocation:Promise<unknown>=Promise.resolve();
  constructor(private readonly workspaces:WorkspaceManager,private readonly root:string,private readonly capacity=128){}
  private async gitRaw(cwd:string,args:string[],index?:string):Promise<string>{
    const env:NodeJS.ProcessEnv=gitInspectionEnvironment();
    if(index)env.GIT_INDEX_FILE=index;
    env.GIT_AUTHOR_NAME="Dispatcher";env.GIT_AUTHOR_EMAIL="dispatcher@localhost";env.GIT_COMMITTER_NAME="Dispatcher";env.GIT_COMMITTER_EMAIL="dispatcher@localhost";
    return (await execute("git",["-C",cwd,"-c","core.fsmonitor=false","-c","core.untrackedCache=false","-c","core.ignoreStat=false","-c","core.hooksPath=/dev/null",...args],{env,timeout:30_000,maxBuffer:16*1024*1024})).stdout.replace(/\n$/,"");
  }
  private async git(cwd:string,args:string[],index?:string):Promise<string>{return (await this.gitRaw(cwd,args,index)).trim();}
  private gitContextError(side:"source"|"snapshot"):WorkspacePolicyError{return side==="source"?new WorkspacePolicyError("CANDIDATE_GIT_CONTEXT_CHANGED","Candidate Git administration identity changed"):new WorkspacePolicyError("VERIFICATION_SNAPSHOT_CHANGED","Verification snapshot identity or code changed");}
  private gitContextShape(value:unknown):value is DeliveryGitContext{
    const record=(item:unknown,keys:string[]):item is Record<string,unknown>=>item!==null&&typeof item==="object"&&!Array.isArray(item)&&Reflect.ownKeys(item).length===keys.length&&keys.every(key=>Object.hasOwn(item,key));
    const path=(item:unknown):item is string=>typeof item==="string"&&isAbsolute(item)&&!item.includes("\0");
    const identity=(item:unknown)=>record(item,["path","device","inode"])&&path(item.path)&&typeof item.device==="number"&&Number.isSafeInteger(item.device)&&item.device>=0&&typeof item.inode==="number"&&Number.isSafeInteger(item.inode)&&item.inode>=0;
    const context=(item:unknown)=>record(item,["worktree","gitDirectory","commonDirectory","objectsDirectory","indexPath"])&&identity(item.worktree)&&identity(item.gitDirectory)&&identity(item.commonDirectory)&&identity(item.objectsDirectory)&&path(item.indexPath);
    return record(value,["version","source","snapshot"])&&value.version===1&&context(value.source)&&context(value.snapshot);
  }
  private async captureGitContext(path:string,side:"source"|"snapshot"):Promise<GitWorktreeContext>{
    try{
      const query=(args:string[])=>this.gitRaw(path,["rev-parse","--path-format=absolute",...args]);
      const identity=async(reported:string):Promise<GitDirectoryIdentity>=>{
        if(!isAbsolute(reported)||reported.includes("\0"))throw Error("path");
        const physical=await realpath(reported),info=await lstat(physical);
        if(!info.isDirectory()||!Number.isSafeInteger(info.dev)||info.dev<0||!Number.isSafeInteger(info.ino)||info.ino<0)throw Error("directory");
        return {path:physical,device:info.dev,inode:info.ino};
      };
      // These reads are independent. Settle every child before returning, including on failure.
      const [top,gitDir,common,objects,indexQuery]=await Promise.allSettled([query(["--show-toplevel"]),query(["--absolute-git-dir"]),query(["--git-common-dir"]),query(["--git-path","objects"]),this.gitRaw(path,["rev-parse","--git-path","index"])] as const);
      const value=(result:PromiseSettledResult<string>):string=>{if(result.status==="rejected")throw result.reason;return result.value;};
      const worktree=await identity(value(top)),gitDirectory=await identity(value(gitDir)),commonDirectory=await identity(value(common)),objectsDirectory=await identity(value(objects)),index=value(indexQuery);
      if(!isAbsolute(index)||index.includes("\0"))throw Error("index path");
      // Absolute path-format resolves the final symlink. Preserve Git's index basename,
      // canonicalize only its parent, and allow normal regular-file replacement.
      const indexPath=join(await realpath(dirname(index)),basename(index));
      const info=await lstat(indexPath).catch(error=>{if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;return undefined;});
      if(info&&!info.isFile())throw Error("index type");
      return {worktree,gitDirectory,commonDirectory,objectsDirectory,indexPath};
    }catch{throw this.gitContextError(side);}
  }
  private sameGitContext(expected:GitWorktreeContext,actual:GitWorktreeContext):boolean{
    return expected.indexPath===actual.indexPath&&(["worktree","gitDirectory","commonDirectory","objectsDirectory"] as const).every(key=>expected[key].path===actual[key].path&&expected[key].device===actual[key].device&&expected[key].inode===actual[key].inode);
  }
  private async assertGitContext(candidate:DeliveryCandidate,side:"source"|"snapshot"):Promise<void>{
    if(!Object.hasOwn(candidate,"gitContext"))return;
    try{
      const frozen=candidate.gitContext;
      if(!this.gitContextShape(frozen)||!this.sameGitContext(frozen[side],await this.captureGitContext(side==="source"?candidate.source.worktree:candidate.path,side)))throw Error("context");
    }catch{throw this.gitContextError(side);}
  }
  private async remote(path:string):Promise<{pushRemoteFingerprint:string;pushUrl?:string}>{
    let urls:string[]=[];try{urls=(await this.git(path,["remote","get-url","--push","--all","origin"])).split("\n").filter(Boolean);}catch{/* An unconfigured origin is valid for a local-only result. */}
    if(urls.length>1||urls.some(url=>/[\0\r\n]/.test(url)))throw new WorkspacePolicyError("UNSAFE_CANDIDATE_REMOTE","UNSAFE_CANDIDATE_REMOTE");
    let mappings="";try{mappings=await this.git(path,["config","--name-only","--null","--get-regexp","^url\\."]);}catch(error){if((error as {code?:number}).code!==1)throw new WorkspacePolicyError("UNSAFE_CANDIDATE_REMOTE","UNSAFE_CANDIDATE_REMOTE");}
    if(urls.length&&gitUrlRewriteConfigured(mappings))throw new WorkspacePolicyError("UNSAFE_CANDIDATE_REMOTE","UNSAFE_CANDIDATE_REMOTE");
    const url=urls[0];
    if(url&&/^https?:\/\//i.test(url)){let parsed:URL;try{parsed=new URL(url);}catch{throw new WorkspacePolicyError("UNSAFE_CANDIDATE_REMOTE","UNSAFE_CANDIDATE_REMOTE");}if(parsed.username||parsed.password||parsed.search||parsed.hash)throw new WorkspacePolicyError("UNSAFE_CANDIDATE_REMOTE","UNSAFE_CANDIDATE_REMOTE");}
    return {pushRemoteFingerprint:createHash("sha256").update(JSON.stringify(urls)).digest("hex"),...(url?{pushUrl:url}:{})};
  }
  private async assertIndex(path:string):Promise<void>{if((await this.git(path,["ls-files","-v","-z"])).split("\0").filter(Boolean).some(entry=>entry[0]!=="H"))throw new WorkspacePolicyError("UNSAFE_CANDIDATE_INDEX","UNSAFE_CANDIDATE_INDEX");}
  private async content(path:string):Promise<string>{
    const files=(await this.git(path,["ls-tree","-rz","--name-only","HEAD"])).split("\0").filter(Boolean);if(files.length>10_000)throw Error("snapshot limit");
    const hash=createHash("sha256");let bytes=0;
    for(const name of files){const absolute=resolve(path,name);const parent=await realpath(dirname(absolute));const rel=relative(path,parent);if(isAbsolute(rel)||rel===".."||rel.startsWith(`..${sep}`))throw Error("snapshot escape");const info=await lstat(absolute);bytes+=info.size;if(bytes>64*1024*1024)throw Error("snapshot limit");let contents:string|Buffer;if(info.isSymbolicLink())contents=await readlink(absolute);else{const file=await open(absolute,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const opened=await file.stat();if(!opened.isFile()||opened.dev!==info.dev||opened.ino!==info.ino||opened.size!==info.size)throw Error("snapshot changed");contents=await file.readFile();if(contents.length!==info.size)throw Error("snapshot changed");}finally{await file.close();}}hash.update(JSON.stringify({name,mode:info.mode&0o777,hash:createHash("sha256").update(contents).digest("hex")}));}
    return hash.digest("hex");
  }
  private async capture(source:CandidateSource):Promise<WorkspaceCandidate>{
    const candidate=await this.workspaces.captureCandidate(source);
    if(source.repositoryScopePaths.length){const registered=await this.workspaces.captureCandidate({...source,scopePaths:source.repositoryScopePaths});if(registered.id!==candidate.id)throw new WorkspacePolicyError("CANDIDATE_CHANGED","Candidate changed during scope qualification");}
    return candidate;
  }
  private async tree(source:CandidateSource):Promise<string>{
    const index=join(this.root,`.index-${randomUUID()}`);
    try{await this.git(source.worktree,["read-tree","HEAD"],index);await this.git(source.worktree,["add","--all","--"],index);return await this.git(source.worktree,["write-tree"],index);}finally{await rm(index,{force:true});await rm(`${index}.lock`,{force:true});}
  }
  createDeliveryCandidate(input:CandidateSource,assertAuthority:()=>void):Promise<DeliveryCandidate>{
    const captured=structuredClone(input);
    const pending=this.allocation.catch(()=>undefined).then(()=>this.allocate(captured,assertAuthority));
    this.allocation=pending;return pending;
  }
  private async allocate(input:CandidateSource,assertAuthority:()=>void):Promise<DeliveryCandidate>{
    const source=structuredClone(input);assertAuthority();
    await mkdir(this.root,{recursive:true,mode:0o700});
    if(!(await lstat(this.root)).isDirectory())throw new WorkspacePolicyError("VERIFICATION_ROOT_CHANGED","Verification root identity changed");
    if((await readdir(this.root)).filter(name=>/^[0-9a-f-]{36}$/.test(name)).length>=this.capacity)throw new WorkspacePolicyError("VERIFICATION_CAPACITY_REACHED","Retained verification snapshot capacity reached");
    const sourceContext=await this.captureGitContext(source.worktree,"source");assertAuthority();
    await this.assertIndex(source.worktree);
    const candidate=await this.capture(source);assertAuthority();
    const remote=await this.remote(source.worktree);
    const tree=await this.tree(source);assertAuthority();
    const after=await this.capture(source);
    if(after.id!==candidate.id)throw new WorkspacePolicyError("CANDIDATE_CHANGED","Execution contents changed during candidate creation");
    // Gitlinks need a separately registered materialization contract; don't test an empty submodule.
    if((await this.git(source.worktree,["ls-tree","-r",tree])).split("\n").some(line=>line.startsWith("160000 ")))throw new WorkspacePolicyError("VERIFICATION_ENVIRONMENT_UNAVAILABLE","Submodule verification environment is not registered");
    const commit=await this.git(source.worktree,["commit-tree",tree,"-p",candidate.headRevision,"-m","Dispatcher verified candidate"]);assertAuthority();
    const id=randomUUID();const path=join(await realpath(this.root),id);
    await mutateWorktrees(source.worktree,async()=>{assertAuthority();await this.git(source.worktree,["worktree","add","--detach",path,commit]);});
    const snapshotContext=await this.captureGitContext(path,"snapshot");assertAuthority();
    const info=await lstat(path),commonDirectory=sourceContext.commonDirectory.path,gitContext:DeliveryGitContext={version:1,source:sourceContext,snapshot:snapshotContext};
    const result:DeliveryCandidate={version:1,id,source,candidate,commit,tree,path,rootIdentity:{device:info.dev,inode:info.ino},commonDirectory,contentFingerprint:await this.content(path),gitContext,...remote};
    await writeFile(join(this.root,`${id}.json`),JSON.stringify(result),{flag:"wx",mode:0o600});
    await this.assertCandidateAuthority(result,assertAuthority);return result;
  }
  async assertCandidateAuthority(candidate:DeliveryCandidate,assertAuthority:()=>void):Promise<void>{
    assertAuthority();
    if(Object.hasOwn(candidate,"gitContext")){await this.assertGitContext(candidate,"source");assertAuthority();}
    if((await this.remote(candidate.source.worktree)).pushRemoteFingerprint!==candidate.pushRemoteFingerprint)throw new WorkspacePolicyError("CANDIDATE_REMOTE_CHANGED","CANDIDATE_REMOTE_CHANGED");
    await this.assertIndex(candidate.source.worktree);
    const source=await this.capture(candidate.source);assertAuthority();
    if(source.id!==candidate.candidate.id||await this.tree(candidate.source)!==candidate.tree)throw new WorkspacePolicyError("CANDIDATE_CHANGED","Execution contents no longer match the verified candidate");
    await this.assertSnapshot(candidate);assertAuthority();
  }
  async assertSnapshot(candidate:DeliveryCandidate):Promise<void>{
    try{
      await this.assertGitContext(candidate,"snapshot");
      if(candidate.path!==join(await realpath(this.root),candidate.id)||!(await lstat(this.root)).isDirectory())throw Error("root");
      await this.assertIndex(candidate.path);
      if(await this.content(candidate.path)!==candidate.contentFingerprint)throw Error("snapshot content");
      await assertRepositoryIdentity({root:candidate.path,rootIdentity:candidate.rootIdentity});
      if(await realpath(await this.gitRaw(candidate.path,["rev-parse","--show-toplevel"]))!==candidate.path||await realpath(await this.gitRaw(candidate.path,["rev-parse","--path-format=absolute","--git-common-dir"]))!==candidate.commonDirectory||await this.git(candidate.path,["rev-parse","HEAD"])!==candidate.commit||await this.git(candidate.path,["rev-parse","HEAD^{tree}"])!==candidate.tree||await this.git(candidate.path,["status","--porcelain=v1","--untracked-files=all"]))throw Error("snapshot");
    }catch{throw new WorkspacePolicyError("VERIFICATION_SNAPSHOT_CHANGED","Verification snapshot identity or code changed");}
  }
}
