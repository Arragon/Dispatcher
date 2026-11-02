import { execFile } from "node:child_process";
import { lstat, opendir, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { WorkspacePolicyError } from "./workspace.js";
import { gitInspectionEnvironment, readWorkspaceStatus } from "./git-inspection.js";

const execute=promisify(execFile),LIMIT=200;
export interface WorkspaceReference {kind:"run"|"session"|"adapter-session";id:string;path:string;}
export interface WorkspaceOrphan {
 path:string;retained:boolean;ownership:"unverified";action:"report";orphan:boolean;
 references:Array<Pick<WorkspaceReference,"kind"|"id">>;git:"worktree"|"repository"|"unavailable";
 branch?:string;dirty?:boolean;changedFiles?:string[];reasonCodes:string[];
}

/** Inventory is evidence, never durable ownership or permission to delete. */
export async function inspectWorkspaceOrphans(directory:string,references:readonly WorkspaceReference[]):Promise<WorkspaceOrphan[]> {
 const deadline=Date.now()+30_000,budget=()=>{const remaining=deadline-Date.now();if(remaining<1)throw new WorkspacePolicyError("ORPHAN_SCAN_TIMEOUT","ORPHAN_SCAN_TIMEOUT");return Math.min(10_000,remaining);};
 if(!isAbsolute(directory))throw new WorkspacePolicyError("ORPHAN_ROOT_UNSAFE","ORPHAN_ROOT_UNSAFE");
 try{if(!(await lstat(directory)).isDirectory())throw new WorkspacePolicyError("ORPHAN_ROOT_UNSAFE","ORPHAN_ROOT_UNSAFE");}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return [];throw error;}
 const root=await realpath(directory),entries:Array<{path:string;retained:boolean}>=[];
 if(references.length>1000)throw new WorkspacePolicyError("ORPHAN_SCAN_LIMIT","ORPHAN_SCAN_LIMIT");
 const canonicalReferences=await Promise.all(references.map(async ref=>({...ref,path:await realpath(ref.path).catch(()=>resolve(ref.path))})));
 const collect=async(parent:string,retained:boolean)=>{
  const stream=await opendir(parent);
  for await(const entry of stream){const path=join(parent,entry.name);
   budget();
   if(!retained&&entry.name===".retained"){
    if(!(await lstat(path)).isDirectory())throw new WorkspacePolicyError("ORPHAN_ROOT_UNSAFE","ORPHAN_ROOT_UNSAFE");
    await collect(path,true);
   }else{entries.push({path,retained});if(entries.length>LIMIT)throw new WorkspacePolicyError("ORPHAN_SCAN_LIMIT","ORPHAN_SCAN_LIMIT");}
  }
 };
 await collect(root,false);
 const results:WorkspaceOrphan[]=[];
 for(const entry of entries.sort((a,b)=>a.path.localeCompare(b.path))){
  budget();
  const refs=canonicalReferences.filter(ref=>ref.path===entry.path).map(({kind,id})=>({kind,id}));
  const row:WorkspaceOrphan={...entry,ownership:"unverified",action:"report",orphan:refs.length===0,references:refs,git:"unavailable",reasonCodes:[]};
  const info=await lstat(entry.path);
  if(!info.isDirectory()||await realpath(entry.path)!==entry.path){row.reasonCodes.push("UNSAFE_DIRECTORY");results.push(row);continue;}
  const git=async(args:string[])=>(await execute("git",["-C",entry.path,"-c","core.fsmonitor=false",...args],{timeout:budget(),maxBuffer:256*1024,env:gitInspectionEnvironment()})).stdout;
  try{
   if(await realpath((await git(["rev-parse","--show-toplevel"])).replace(/\r?\n$/,""))!==entry.path)throw Error("nested");
   const common=await realpath((await git(["rev-parse","--path-format=absolute","--git-common-dir"])).replace(/\r?\n$/,"")),specific=await realpath((await git(["rev-parse","--path-format=absolute","--git-dir"])).replace(/\r?\n$/,""));
   row.git=common===specific?"repository":"worktree";row.branch=(await git(["branch","--show-current"])).replace(/\r?\n$/,"");
   const status=(await readWorkspaceStatus(entry.path,budget())).split("\0").filter(Boolean),files:string[]=[];
   for(let i=0;i<status.length;i++){const item=status[i]!;files.push(item.slice(3));if(/[RC]/.test(item.slice(0,2)))files.push(status[++i]!);}
   row.dirty=status.length>0;row.changedFiles=[...new Set(files)].sort();if(row.dirty)row.reasonCodes.push("UNCOMMITTED_DATA");
   const after=await lstat(entry.path);if(info.dev!==after.dev||info.ino!==after.ino||!after.isDirectory())throw Error("changed");
  }catch{row.git="unavailable";delete row.dirty;delete row.changedFiles;delete row.branch;row.reasonCodes.push("WORKSPACE_INSPECTION_UNAVAILABLE");}
  results.push(row);
 }
 budget();return results;
}
