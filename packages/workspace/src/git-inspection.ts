import { childExecutionEnvironment } from "@dispatcher/shared";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute=promisify(execFile);
export function gitInspectionEnvironment():NodeJS.ProcessEnv {const env=childExecutionEnvironment(process.env);for(const key of Object.keys(env))if(key.startsWith("GIT_"))delete env[key];return {...env,GIT_OPTIONAL_LOCKS:"0",GIT_NO_LAZY_FETCH:"1",GIT_TERMINAL_PROMPT:"0"};}

export function gitUrlRewriteConfigured(keys:string):boolean {return keys.split("\0").some(key=>/^url\.[\s\S]*\.(insteadof|pushinsteadof)$/i.test(key));}

export async function readWorkspaceStatus(path:string,timeoutMs=10_000,query?:(args:string[],remainingMs:number)=>Promise<string>):Promise<string> {
 const deadline=Date.now()+timeoutMs,options={maxBuffer:256*1024,env:gitInspectionEnvironment()};
 const git=(args:string[])=>{const timeout=deadline-Date.now();if(timeout<1)throw Error("GIT_INSPECTION_TIMEOUT");if(query)return query(args,timeout).then(stdout=>({stdout}));return execute("git",["-C",path,"-c","core.fsmonitor=false","-c","core.hooksPath=/dev/null",...args],{...options,timeout});};
 // Git status can invoke clean/process filters even without optional index locks.
 // Config includes/global drivers count too; an unqualified driver fails closed.
 // Both policy reads are passive. Settle every started query, including sync failures.
 const group=(commands:string[][])=>Promise.allSettled(commands.map(args=>Promise.resolve().then(()=>git(args))));
 const policies=await group([["config","--null","--get-regexp","^filter\\."],["config","--null","--get-regexp","^(extensions\\.partialclone|remote\\..*\\.promisor)$"]]);
 const policyOutput=policies.map(result=>{if(result.status==="fulfilled")return result.value.stdout;if((result.reason as {code?:unknown}).code===1)return "";throw result.reason;});
 if(policyOutput[0])throw Error("UNTRUSTED_GIT_FILTER_CONFIG");
 if(policyOutput[1])throw Error("UNQUALIFIED_GIT_PARTIAL_CLONE");
 // Index and HEAD reads are independent; neither visits submodule worktrees.
 // Their complete policy barrier must settle before status can traverse them.
 const gitlinks=await group([["ls-files","--stage","-z"],["ls-tree","-r","-z","HEAD"]]);
 const gitlinkOutput=gitlinks.map(result=>{if(result.status==="rejected")throw result.reason;return result.value.stdout;});
 if(gitlinkOutput.some(stdout=>stdout.split("\0").some(entry=>entry.startsWith("160000 "))))throw Error("UNQUALIFIED_GIT_SUBMODULE");
 return (await git(["status","--porcelain=v1","-z","--untracked-files=all","--ignored=matching"])).stdout;
}
