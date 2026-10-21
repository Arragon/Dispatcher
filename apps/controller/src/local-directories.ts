import {OwnedProcessGroup} from "@dispatcher/adapters";
import {execFile,spawn,type ChildProcess} from "node:child_process";
import {randomUUID} from "node:crypto";
import {isAbsolute} from "node:path";
import {realpath,stat} from "node:fs/promises";
import {promisify} from "node:util";
import {StringDecoder} from "node:string_decoder";
import {ConfigPlanError} from "@dispatcher/config";
import type {DirectorySelection} from "@dispatcher/domain";
const execute=promisify(execFile);
export type DirectoryPicker=(signal:AbortSignal)=>Promise<string|undefined>;
/** Fixed OS dialog only: no browser-controlled scripts, prompt, starting path or argv. */
export const nativeDirectoryPicker:DirectoryPicker=async signal=>{
  if(process.platform!=="darwin"||process.env.SSH_CONNECTION||!process.getuid)throw new Error("Interactive macOS desktop required");
  const owner=(await execute("/usr/bin/stat",["-f","%u","/dev/console"],{signal,timeout:3_000,maxBuffer:1024})).stdout.trim();
  if(owner!==String(process.getuid()))throw new Error("Controller does not own the desktop session");
  const path=await readNativeDirectoryDialog(signal);if(path===undefined)return;
  if(!isAbsolute(path)||path.length>4_000)throw new Error("Invalid native selection");
  const physical=await realpath(path);if(!(await stat(physical)).isDirectory())throw new Error("Directory required");return physical;
};

/** Only the fixed OS dialog is used in production; factory injection is for owned-process tests. */
export async function readNativeDirectoryDialog(signal:AbortSignal,options:{spawn?:()=>ChildProcess}={}):Promise<string|undefined> {
 if(signal.aborted)throw Error("NATIVE_PICKER_CANCELLED");
 const child=options.spawn?options.spawn():spawn("/usr/bin/osascript",["-e",'POSIX path of (choose folder with prompt "选择需要登记的 Git 仓库目录")'],{detached:process.platform!=="win32",stdio:["ignore","pipe","pipe"]});
 const group=new OwnedProcessGroup(child),outDecoder=new StringDecoder("utf8"),errDecoder=new StringDecoder("utf8");let bytes=0,stdout="",stderr="",failed=false,cancelled=false,cleanup:Promise<void>|undefined;
 let onClose!:(code:number|null)=>void,onAbortWork!:()=>void;
 const closed=new Promise<number|null>(r=>{onClose=r;}),aborted=new Promise<void>(r=>{onAbortWork=r;});
 const stop=()=>{cleanup??=group.stop();void cleanup.catch(()=>undefined);onAbortWork();};
 const onAbort=()=>{cancelled=true;stop();};
 child.once("error",()=>{failed=true;stop();});child.once("close",code=>{stdout+=outDecoder.end();stderr+=errDecoder.end();onClose(code);});
 const receive=(chunk:Buffer,stream:"stdout"|"stderr")=>{bytes+=chunk.byteLength;if(bytes>16_384){failed=true;stop();return;}if(stream==="stdout")stdout+=outDecoder.write(chunk);else stderr+=errDecoder.write(chunk);};
 child.stdout?.on("data",(chunk:Buffer)=>receive(chunk,"stdout"));child.stderr?.on("data",(chunk:Buffer)=>receive(chunk,"stderr"));
 const timer=setTimeout(()=>{failed=true;stop();},120_000);signal.addEventListener("abort",onAbort,{once:true});if(signal.aborted)onAbort();
 let closeTimer:ReturnType<typeof setTimeout>|undefined;
 try{
  const outcome=await Promise.race([closed.then(code=>({code})),aborted.then(()=>({code:null}))]);
  cleanup??=group.stop();
  try{await cleanup;const drained=await Promise.race([closed.then(()=>true),new Promise<boolean>(r=>{closeTimer=setTimeout(()=>r(false),2000);})]);if(!drained)throw Error();}
  catch{throw Error("NATIVE_PICKER_CLEANUP_UNKNOWN");}
  if(cancelled)throw Error("NATIVE_PICKER_CANCELLED");
  if(failed)throw Error("NATIVE_PICKER_UNAVAILABLE");
  if(outcome.code!==0){if(stderr.includes("(-128)"))return;throw Error("NATIVE_PICKER_UNAVAILABLE");}
  return stdout.trimEnd();
 }finally{clearTimeout(timer);if(closeTimer)clearTimeout(closeTimer);signal.removeEventListener("abort",onAbort);}
}

export class DirectorySelections {
  private readonly records=new Map<string,DirectorySelection>();
  private active:{id:string;controller:AbortController;work:Promise<void>}|undefined;
  private closed=false;
  private cleanupUnknown=false;
  constructor(private readonly picker:DirectoryPicker=nativeDirectoryPicker){}
  begin(runnerId:string):DirectorySelection{
    if(this.closed||this.cleanupUnknown)throw new ConfigPlanError("NATIVE_PICKER_UNAVAILABLE","Controller is shutting down");
    if(this.active)throw new ConfigPlanError("NATIVE_PICKER_BUSY","One directory dialog is already active");
    for(const [id,entry] of this.records)if(Date.now()-Date.parse(entry.createdAt)>10*60_000)this.records.delete(id);
    while(this.records.size>=32)this.records.delete(this.records.keys().next().value!);
    const selection:DirectorySelection={id:randomUUID(),runnerId,purpose:"repository",state:"pending",createdAt:new Date().toISOString()},controller=new AbortController();this.records.set(selection.id,selection);
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(125_000)]);
    const work=Promise.resolve().then(async()=>{
      try{
        const path=await this.picker(signal);
        if(controller.signal.aborted)selection.state="cancelled";
        else if(signal.aborted){selection.state="unavailable";selection.reasonCode="NATIVE_PICKER_UNAVAILABLE";}
        else if(path===undefined)selection.state="cancelled";
        else if(isAbsolute(path)&&path.length<=4_000){selection.state="selected";selection.path=path;}
        else{selection.state="unavailable";selection.reasonCode="NATIVE_PICKER_UNAVAILABLE";}
      }catch(error){if(error instanceof Error&&error.message==="NATIVE_PICKER_CLEANUP_UNKNOWN")this.cleanupUnknown=true;selection.state=this.cleanupUnknown?"unavailable":controller.signal.aborted?"cancelled":"unavailable";if(selection.state==="unavailable")selection.reasonCode=this.cleanupUnknown?"NATIVE_PICKER_CLEANUP_UNKNOWN":"NATIVE_PICKER_UNAVAILABLE";}
      finally{if(this.active?.id===selection.id)this.active=undefined;}
    });
    this.active={id:selection.id,controller,work};return structuredClone(selection);
  }
  get(id:string):DirectorySelection|undefined{const entry=this.records.get(id);return entry?structuredClone(entry):undefined;}
  cancel(id:string):DirectorySelection|undefined{
    if(this.active?.id===id){this.records.get(id)!.state="cancelling";this.active.controller.abort();}
    return this.get(id);
  }
  async settle():Promise<void>{await this.active?.work;}
  async close():Promise<void>{this.closed=true;if(this.active)this.cancel(this.active.id);await this.settle();}
}
