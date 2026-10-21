import { existsSync, linkSync, lstatSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {acquireInstanceLock} from "@dispatcher/persistence";
import {readControllerLogTail} from "./controller-logs.js";
import {assertControllerReleaseBinding,type ControllerReleaseBinding} from "./release-manifest.js";

export const LAUNCHD_LABEL = "dev.dispatcher.controller";
export interface LaunchAgentDefinition {nodePath:string;cliPath:string;dataDirectory:string;logDirectory:string;rawStdio?:"discard";release?:ControllerReleaseBinding}
export type LaunchctlExecutor = (args: string[]) => Promise<{ stdout: string; stderr: string }>;
interface LaunchAgentOptions extends LaunchAgentDefinition {plistPath:string;executor?:LaunchctlExecutor;uid?:number;waitForExit?:(pid:number)=>Promise<void>}
export interface LaunchAgentStatus {loaded:boolean;state?:string;pid?:number;lastExitCode?:number}
export class LaunchctlError extends Error {
  constructor(readonly command:string,readonly exitCode:number|null,options?:ErrorOptions){super(`LAUNCHCTL_${command.toUpperCase()}_FAILED (${exitCode??"unknown"})`,options);}
}
function xml(value: string): string {return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");}
function absolutePath(value:string):void {
  if(typeof value!=="string"||!isAbsolute(value)||Array.from(value).some(character=>character.charCodeAt(0)<32||character.charCodeAt(0)===127))throw Error("SERVICE_PATH_INVALID");
}
function stablePaths(input:LaunchAgentDefinition):void {
  for(const value of [input.nodePath,input.cliPath,input.dataDirectory,input.logDirectory])absolutePath(value);
  if(input.release){absolutePath(input.release.directory);if(!/^[a-f0-9]{40}$/.test(input.release.sourceSha))throw Error("SERVICE_RELEASE_INVALID");}
  for(const value of [input.nodePath,input.cliPath,input.dataDirectory,input.logDirectory])if(normalize(value).includes("/.codex/worktrees/"))throw Error("SERVICE_PATH_INVALID: select an absolute persistent deployment outside managed worktrees");
  for(const value of [input.nodePath,input.cliPath])if(["/tmp/","/private/tmp/","/var/folders/","/private/var/folders/"].some(prefix=>normalize(value).startsWith(prefix)))throw Error("SERVICE_PATH_INVALID: temporary runtime paths cannot survive login or cleanup");
}
export function launchdPlist(input: LaunchAgentDefinition): string {
  stablePaths(input);
  const releaseEnvironment=input.release?`<key>DISPATCHER_RELEASE_DIRECTORY</key><string>${xml(input.release.directory)}</string><key>DISPATCHER_RELEASE_SHA</key><string>${input.release.sourceSha}</string>`:"";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(input.nodePath)}</string>
    <string>${xml(input.cliPath)}</string>
    <string>serve</string>
    <string>--with-runner</string>
    <string>--data-dir</string><string>${xml(input.dataDirectory)}</string>
    <string>--log-dir</string><string>${xml(join(input.logDirectory,"runtime"))}</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(input.dataDirectory)}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(`${dirname(input.nodePath)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`)}</string>${releaseEnvironment}</dict>
  <key>Umask</key><integer>63</integer>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ProcessType</key><string>Background</string>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ExitTimeOut</key><integer>60</integer>
  <key>StandardOutPath</key><string>/dev/null</string>
  <key>StandardErrorPath</key><string>/dev/null</string>
</dict>
</plist>
`;
}

export const launchctl: LaunchctlExecutor = async (args) => await new Promise((resolve, reject) => {
  const child = spawn("/bin/launchctl", args, { stdio: ["ignore", "pipe", "pipe"],shell:false });
  let stdout="",stderr="",limited=false;
  const timeout=setTimeout(()=>{limited=true;child.kill("SIGKILL");},args[0]==="bootout"?70_000:5_000);
  for(const [stream,kind] of [[child.stdout,"out"],[child.stderr,"err"]] as const)stream.on("data",(chunk:Buffer)=>{if(limited)return;if(kind==="out")stdout+=chunk.toString();else stderr+=chunk.toString();if(Buffer.byteLength(stdout)+Buffer.byteLength(stderr)>64*1024){limited=true;stdout="";stderr="";child.kill("SIGKILL");}});
  child.once("error",error=>{clearTimeout(timeout);reject(new LaunchctlError(args[0]??"command",null,{cause:error}));});
  child.once("close",code=>{clearTimeout(timeout);if(code===0&&!limited)resolve({stdout,stderr});else reject(new LaunchctlError(args[0]??"command",limited?null:code));});
});
const domain=(input:LaunchAgentOptions)=>`gui/${input.uid??process.getuid?.()??0}`;
const target=(input:LaunchAgentOptions)=>`${domain(input)}/${LAUNCHD_LABEL}`;
export async function statusLaunchAgent(input:LaunchAgentOptions):Promise<LaunchAgentStatus>{
  absolutePath(input.plistPath);
  let stdout:string;
  try{({stdout}=await (input.executor??launchctl)(["print",target(input)]));}
  catch(error){if(error instanceof LaunchctlError&&error.command==="print"&&error.exitCode===113)return {loaded:false};throw error;}
  const path=stdout.match(/^\s*path = (.+)$/m)?.[1];
  if(path!==input.plistPath)throw Error("SERVICE_OWNER_UNKNOWN: loaded label belongs to a different or unknown definition");
  const state=stdout.match(/^\s*state = ([a-z-]{1,30})$/m)?.[1],pid=stdout.match(/^\s*pid = ([1-9]\d*)$/m)?.[1],exit=stdout.match(/^\s*last exit code = (-?\d+)$/m)?.[1];
  return {loaded:true,...(state?{state}:{}),...(pid&&Number.isSafeInteger(Number(pid))?{pid:Number(pid)}:{}),...(exit&&Number.isSafeInteger(Number(exit))?{lastExitCode:Number(exit)}:{})};
}
export async function startLaunchAgent(input:LaunchAgentOptions):Promise<void>{
  if(input.release)assertControllerReleaseBinding(input.release,input.cliPath,input.nodePath);
  stablePaths({nodePath:input.nodePath,cliPath:input.cliPath,dataDirectory:input.dataDirectory,logDirectory:input.logDirectory});
  const state=await statusLaunchAgent(input),execute=input.executor??launchctl;
  await execute(["enable",target(input)]);
  if(!state.loaded)await execute(["bootstrap",domain(input),input.plistPath]);
  else await execute(["kickstart",target(input)]);
}
async function waitForControllerExit(pid:number):Promise<void>{
  const deadline=Date.now()+65_000;
  for(;;){
    try{process.kill(pid,0);}catch(error){if(error&&typeof error==="object"&&"code" in error&&error.code==="ESRCH")return;throw Error("CONTROLLER_EXIT_UNCONFIRMED",{cause:error});}
    if(Date.now()>=deadline)throw Error("CONTROLLER_EXIT_UNCONFIRMED");
    await delay(100);
  }
}
export async function stopLaunchAgent(input:LaunchAgentOptions):Promise<void>{
  const state=await statusLaunchAgent(input),execute=input.executor??launchctl;
  await execute(["disable",target(input)]);
  if(state.loaded){
    if(state.state==="running"&&!state.pid)throw Error("CONTROLLER_EXIT_UNCONFIRMED");
    await execute(["bootout",target(input)]);
    if(state.pid)await (input.waitForExit??waitForControllerExit)(state.pid);
    if((await statusLaunchAgent(input)).loaded)throw Error("CONTROLLER_EXIT_UNCONFIRMED");
  }
  // A missing launchd label is not evidence that a manually started Controller stopped.
  const ownership=acquireInstanceLock(input.dataDirectory);ownership.release();
}
export async function restartLaunchAgent(input:LaunchAgentOptions):Promise<void>{if(input.release)assertControllerReleaseBinding(input.release,input.cliPath,input.nodePath);await stopLaunchAgent(input);await startLaunchAgent(input);}
export async function uninstallLaunchAgent(input:LaunchAgentOptions):Promise<void>{await stopLaunchAgent(input);if(existsSync(input.plistPath))unlinkSync(input.plistPath);}
export async function installLaunchAgent(input:LaunchAgentOptions):Promise<void>{
  if(input.release)assertControllerReleaseBinding(input.release,input.cliPath,input.nodePath);
  absolutePath(input.plistPath);const content=launchdPlist(input);
  if(existsSync(input.plistPath)){
    const file=lstatSync(input.plistPath);if(!file.isFile()||file.isSymbolicLink()||file.nlink!==1)throw Error("SERVICE_DEFINITION_UNSAFE");
    if(readFileSync(input.plistPath,"utf8")!==content)throw Error("SERVICE_UPGRADE_REQUIRED: retain the existing definition and use a reviewed upgrade");
  }else{
    mkdirSync(dirname(input.plistPath),{recursive:true});mkdirSync(input.dataDirectory,{recursive:true,mode:0o700});mkdirSync(input.logDirectory,{recursive:true,mode:0o700});
    const temporary=`${input.plistPath}.${randomUUID()}.tmp`;
    try{
      writeFileSync(temporary,content,{flag:"wx",mode:0o600});
      try{linkSync(temporary,input.plistPath);}catch(error){throw Error("SERVICE_INSTALL_CONFLICT: preserve the existing definition and inspect before retry",{cause:error});}
    }finally{if(existsSync(temporary))unlinkSync(temporary);}
  }
  mkdirSync(input.dataDirectory,{recursive:true,mode:0o700});mkdirSync(input.logDirectory,{recursive:true,mode:0o700});
  await startLaunchAgent(input);
}

export async function readLaunchAgent(plistPath:string,read:(path:string)=>Promise<string>=async path=>(await promisify(execFile)("/usr/bin/plutil",["-convert","json","-o","-",path],{timeout:5_000,maxBuffer:64*1024})).stdout):Promise<LaunchAgentDefinition>{
  try{
  absolutePath(plistPath);
  const value=JSON.parse(await read(plistPath)) as Record<string,unknown>,args=value.ProgramArguments;
  if(value.Label!==LAUNCHD_LABEL||!Array.isArray(args)||![6,8].includes(args.length)||!args.every(arg=>typeof arg==="string")||args[2]!=="serve"||args[3]!=="--with-runner"||args[4]!=="--data-dir"||typeof value.StandardOutPath!=="string"||typeof value.StandardErrorPath!=="string")throw Error("SERVICE_DEFINITION_INVALID");
  const discard=value.StandardOutPath==="/dev/null"&&value.StandardErrorPath==="/dev/null";
  if(discard&&args.length!==8)throw Error("SERVICE_DEFINITION_INVALID");
  const definition:LaunchAgentDefinition={nodePath:args[0] as string,cliPath:args[1] as string,dataDirectory:args[5] as string,logDirectory:discard?dirname(args[7] as string):dirname(value.StandardOutPath),...(discard?{rawStdio:"discard" as const}:{})};
  for(const path of [definition.nodePath,definition.cliPath,definition.dataDirectory,definition.logDirectory])absolutePath(path);
  if(!discard&&(value.StandardOutPath!==join(definition.logDirectory,"controller.log")||value.StandardErrorPath!==join(definition.logDirectory,"controller.error.log")))throw Error("SERVICE_DEFINITION_INVALID");
  if(args.length===8&&(args[6]!=="--log-dir"||args[7]!==join(definition.logDirectory,"runtime")))throw Error("SERVICE_DEFINITION_INVALID");
  if(value.EnvironmentVariables!==undefined){
    if(!value.EnvironmentVariables||typeof value.EnvironmentVariables!=="object"||Array.isArray(value.EnvironmentVariables))throw Error("SERVICE_DEFINITION_INVALID");
    const env=value.EnvironmentVariables as Record<string,unknown>,directory=env.DISPATCHER_RELEASE_DIRECTORY,sourceSha=env.DISPATCHER_RELEASE_SHA;
    if(directory!==undefined||sourceSha!==undefined){if(typeof directory!=="string"||typeof sourceSha!=="string"||!/^[a-f0-9]{40}$/.test(sourceSha))throw Error("SERVICE_DEFINITION_INVALID");absolutePath(directory);definition.release={directory,sourceSha};}
  }
  return definition;
  }catch(error){throw Error("SERVICE_DEFINITION_INVALID",{cause:error});}
}
export function tailLog(path: string, lines = 100): string {return readControllerLogTail(path,lines);}

/** New services retain only the bounded redacted stream; legacy files remain inspectable. */
export function serviceLogTail(definition:LaunchAgentDefinition,lines=100,stderr=false):string {
 if(!Number.isSafeInteger(lines)||lines<1||lines>1000)throw Error("LOG_READ_LIMIT_INVALID");
 if(stderr&&definition.rawStdio==="discard")return JSON.stringify({msg:"RAW_STDIO_NOT_RETAINED"});
 const structured=join(definition.logDirectory,"runtime","controller.log");
 if(!stderr&&existsSync(structured))return readControllerLogTail(structured,lines);
 if(definition.rawStdio==="discard")return JSON.stringify({msg:"LOG_NOT_CREATED"});
 return readControllerLogTail(join(definition.logDirectory,stderr?"controller.error.log":"controller.log"),lines);
}
