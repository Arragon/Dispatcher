import {lstat,realpath} from "node:fs/promises";
import {basename,dirname,isAbsolute,join} from "node:path";
export interface GitDirectoryIdentity {path:string;device:number;inode:number}
export interface GitWorktreeContext {worktree:GitDirectoryIdentity;gitDirectory:GitDirectoryIdentity;commonDirectory:GitDirectoryIdentity;objectsDirectory:GitDirectoryIdentity;indexPath:string}
export interface DeliveryGitContext {version:1;source:GitWorktreeContext;snapshot:GitWorktreeContext}
export class GitContextError extends Error {constructor(){super("Git administration identity is unavailable");this.name="GitContextError";}}
export function isDeliveryGitContext(value:unknown):value is DeliveryGitContext{
 const record=(item:unknown,keys:string[]):item is Record<string,unknown>=>item!==null&&typeof item==="object"&&!Array.isArray(item)&&Reflect.ownKeys(item).length===keys.length&&keys.every(key=>Object.hasOwn(item,key));
 const path=(item:unknown):item is string=>typeof item==="string"&&isAbsolute(item)&&!item.includes("\0");
 const identity=(item:unknown)=>record(item,["path","device","inode"])&&path(item.path)&&typeof item.device==="number"&&Number.isSafeInteger(item.device)&&item.device>=0&&typeof item.inode==="number"&&Number.isSafeInteger(item.inode)&&item.inode>=0;
 const context=(item:unknown)=>record(item,["worktree","gitDirectory","commonDirectory","objectsDirectory","indexPath"])&&identity(item.worktree)&&identity(item.gitDirectory)&&identity(item.commonDirectory)&&identity(item.objectsDirectory)&&path(item.indexPath);
 return record(value,["version","source","snapshot"])&&value.version===1&&context(value.source)&&context(value.snapshot);
}
export function sameGitWorktreeContext(expected:GitWorktreeContext,actual:GitWorktreeContext):boolean{
 return expected.indexPath===actual.indexPath&&(["worktree","gitDirectory","commonDirectory","objectsDirectory"] as const).every(key=>expected[key].path===actual[key].path&&expected[key].device===actual[key].device&&expected[key].inode===actual[key].inode);
}
/** The callback removes exactly one terminal LF. Every entered query settles. */
export async function readGitWorktreeContext(_cwd:string,query:(args:string[])=>Promise<string>):Promise<GitWorktreeContext>{
 const queries=[["--show-toplevel"],["--absolute-git-dir"],["--git-common-dir"],["--git-path","objects"]].map(args=>["rev-parse","--path-format=absolute",...args]);queries.push(["rev-parse","--git-path","index"]);
 const results=await Promise.allSettled(queries.map(args=>Promise.resolve().then(()=>query(args))));
 // Callback exceptions belong to their owner, including authority/storage errors.
 const values=results.map(result=>{if(result.status==="rejected")throw result.reason;return result.value;});
 try{
  const identity=async(reported:string):Promise<GitDirectoryIdentity>=>{if(!isAbsolute(reported)||reported.includes("\0"))throw new GitContextError();const physical=await realpath(reported),info=await lstat(physical);if(!info.isDirectory()||!Number.isSafeInteger(info.dev)||info.dev<0||!Number.isSafeInteger(info.ino)||info.ino<0)throw new GitContextError();return {path:physical,device:info.dev,inode:info.ino};};
  const worktree=await identity(values[0]!),gitDirectory=await identity(values[1]!),commonDirectory=await identity(values[2]!),objectsDirectory=await identity(values[3]!),index=values[4]!;
  if(!isAbsolute(index)||index.includes("\0"))throw new GitContextError();
  // Git's absolute path-format resolves final symlinks; canonicalize only the parent.
  const indexPath=join(await realpath(dirname(index)),basename(index)),info=await lstat(indexPath).catch(error=>{if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;return undefined;});
  if(info&&!info.isFile())throw new GitContextError();return {worktree,gitDirectory,commonDirectory,objectsDirectory,indexPath};
 }catch{throw new GitContextError();}
}
