import {spawn} from "node:child_process";
import {childExecutionEnvironment} from "@dispatcher/shared";
import {OwnedProcessGroup} from "./owned-process.js";
import {OwnedProcessRoot} from "./owned-root-process.js";
import {drainCatalogProcess} from "./catalog-process.js";

/** Only a freshly owned version probe; root mode makes no descendant claim. */
export async function readOwnedNativeVersion(input:{executable:string;workspacePath:string;environment:NodeJS.ProcessEnv;signal?:AbortSignal;timeoutMs?:number;ownsGroup?:false;strictOutput?:{stderrMaxBytes:number};failure:(code:"unavailable"|"exit-unconfirmed")=>Error}):Promise<string>{
  const {signal,failure}=input,timeout=input.timeoutMs??3_000,strictOutput=input.strictOutput,stderrMaxBytes=strictOutput?.stderrMaxBytes;
  if(signal?.aborted||!Number.isFinite(timeout)||timeout<=0)throw failure("unavailable");
  if(strictOutput!==undefined&&(!strictOutput||typeof strictOutput!=="object"||Array.isArray(strictOutput)||Object.keys(strictOutput).some(key=>key!=="stderrMaxBytes")||!Number.isSafeInteger(stderrMaxBytes)||stderrMaxBytes!<1||stderrMaxBytes!>1_048_576))throw failure("unavailable");
  const child=spawn(input.executable,["--version"],{cwd:input.workspacePath,env:childExecutionEnvironment(input.environment,{PWD:input.workspacePath}),detached:input.ownsGroup===false?false:process.platform!=="win32",shell:false,stdio:["ignore","pipe","pipe"]}),owner=input.ownsGroup===false?new OwnedProcessRoot(child):new OwnedProcessGroup(child);
  let bytes=0,diagnostics=0,failed=false,pipeError=false,exitCode:number|null=null,stop!:()=>void;
  const chunks:Buffer[]=[],diagnosticChunks:Buffer[]=[],stopped=new Promise<void>(resolve=>{stop=()=>{failed=true;resolve();};}),closed=new Promise<void>(resolve=>child.once("close",code=>{exitCode=code;resolve();}));
  child.once("error",stop);child.stdout.on("data",(chunk:Buffer)=>{bytes+=chunk.byteLength;if(bytes>16_384){stop();return;}chunks.push(chunk);});child.stderr.on("data",(chunk:Buffer)=>{if(strictOutput===undefined)return;diagnostics+=chunk.byteLength;if(diagnostics>stderrMaxBytes!){stop();return;}diagnosticChunks.push(chunk);});
  const onPipeError=()=>{pipeError=true;stop();};child.stdout.once("error",onPipeError);child.stderr.once("error",onPipeError);
  const timer=setTimeout(stop,Math.min(timeout,3_000));signal?.addEventListener("abort",stop,{once:true});if(signal?.aborted)stop();
  try{
    await Promise.race([closed,stopped]);
    try{await drainCatalogProcess(owner,closed,input.ownsGroup===false?500:2000);}catch{throw failure("exit-unconfirmed");}
    if(pipeError)throw failure("exit-unconfirmed");
    if(failed||exitCode!==0)throw failure("unavailable");
    if(strictOutput!==undefined){
      // Decode complete streams only after ownership and callback closure are proven.
      try{new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(diagnosticChunks));return new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks)).trim();}catch{throw failure("unavailable");}
    }
    return Buffer.concat(chunks).toString("utf8").trim();
  }finally{clearTimeout(timer);signal?.removeEventListener("abort",stop);child.stdout.destroy();child.stderr.destroy();}
}
