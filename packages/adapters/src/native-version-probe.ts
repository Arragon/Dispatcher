import {spawn} from "node:child_process";
import {childExecutionEnvironment} from "@dispatcher/shared";
import {OwnedProcessGroup} from "./owned-process.js";
import {drainCatalogProcess} from "./catalog-process.js";

/** Only the freshly owned version-probe group; never a recovered native session. */
export async function readOwnedNativeVersion(input:{executable:string;workspacePath:string;environment:NodeJS.ProcessEnv;signal?:AbortSignal;timeoutMs?:number;failure:(code:"unavailable"|"exit-unconfirmed")=>Error}):Promise<string>{
  const {signal,failure}=input,timeout=input.timeoutMs??3_000;
  if(signal?.aborted||!Number.isFinite(timeout)||timeout<=0)throw failure("unavailable");
  const child=spawn(input.executable,["--version"],{cwd:input.workspacePath,env:childExecutionEnvironment(input.environment,{PWD:input.workspacePath}),detached:process.platform!=="win32",shell:false,stdio:["ignore","pipe","pipe"]}),group=new OwnedProcessGroup(child);
  let bytes=0,failed=false,exitCode:number|null=null,stop!:()=>void;
  const chunks:Buffer[]=[],stopped=new Promise<void>(resolve=>{stop=()=>{failed=true;resolve();};}),closed=new Promise<void>(resolve=>child.once("close",code=>{exitCode=code;resolve();}));
  child.once("error",stop);child.stdout.on("data",(chunk:Buffer)=>{bytes+=chunk.byteLength;if(bytes>16_384){stop();return;}chunks.push(chunk);});child.stderr.on("data",()=>undefined);
  const timer=setTimeout(stop,Math.min(timeout,3_000));signal?.addEventListener("abort",stop,{once:true});if(signal?.aborted)stop();
  try{
    await Promise.race([closed,stopped]);
    try{await drainCatalogProcess(group,closed);}catch{throw failure("exit-unconfirmed");}
    if(failed||exitCode!==0)throw failure("unavailable");
    return Buffer.concat(chunks).toString("utf8").trim();
  }finally{clearTimeout(timer);signal?.removeEventListener("abort",stop);child.stdout.destroy();child.stderr.destroy();}
}
