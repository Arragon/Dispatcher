import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute=promisify(execFile);
export function gitInspectionEnvironment():NodeJS.ProcessEnv {const env={...process.env};for(const key of Object.keys(env))if(key.startsWith("GIT_"))delete env[key];return {...env,GIT_OPTIONAL_LOCKS:"0",GIT_NO_LAZY_FETCH:"1",GIT_TERMINAL_PROMPT:"0"};}

export async function readWorkspaceStatus(path:string,timeoutMs=10_000):Promise<string> {
 const deadline=Date.now()+timeoutMs,options={maxBuffer:256*1024,env:gitInspectionEnvironment()};
 const git=(args:string[])=>{const timeout=deadline-Date.now();if(timeout<1)throw Error("GIT_INSPECTION_TIMEOUT");return execute("git",["-C",path,"-c","core.fsmonitor=false","-c","core.hooksPath=/dev/null",...args],{...options,timeout});};
 // Git status can invoke clean/process filters even without optional index locks.
 // Config includes/global drivers count too; an unqualified driver fails closed.
 try{const configured=await git(["config","--null","--get-regexp","^filter\\."]);if(configured.stdout)throw Error("UNTRUSTED_GIT_FILTER_CONFIG");}
 catch(error){if((error as {code?:unknown}).code!==1)throw error;}
 try{const partial=await git(["config","--null","--get-regexp","^(extensions\\.partialclone|remote\\..*\\.promisor)$"]);if(partial.stdout)throw Error("UNQUALIFIED_GIT_PARTIAL_CLONE");}
 catch(error){if((error as {code?:unknown}).code!==1)throw error;}
 // Parent status also visits submodules and can execute their separate filters.
 // Check both index and HEAD; an index deletion cannot qualify the old Gitlink.
 for(const args of [["ls-files","--stage","-z"],["ls-tree","-r","-z","HEAD"]])if((await git(args)).stdout.split("\0").some(entry=>entry.startsWith("160000 ")))throw Error("UNQUALIFIED_GIT_SUBMODULE");
 return (await git(["status","--porcelain=v1","-z","--untracked-files=all","--ignored=matching"])).stdout;
}
