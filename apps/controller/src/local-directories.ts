import {execFile} from "node:child_process";
import {randomUUID} from "node:crypto";
import {isAbsolute} from "node:path";
import {realpath,stat} from "node:fs/promises";
import {promisify} from "node:util";
import {ConfigPlanError} from "@dispatcher/config";
import type {DirectorySelection} from "@dispatcher/domain";
const execute=promisify(execFile);
export type DirectoryPicker=(signal:AbortSignal)=>Promise<string|undefined>;
/** Fixed OS dialog only: no browser-controlled scripts, prompt, starting path or argv. */
export const nativeDirectoryPicker:DirectoryPicker=async signal=>{
  if(process.platform!=="darwin"||process.env.SSH_CONNECTION||!process.getuid)throw new Error("Interactive macOS desktop required");
  const owner=(await execute("/usr/bin/stat",["-f","%u","/dev/console"],{signal,timeout:3_000,maxBuffer:1024})).stdout.trim();
  if(owner!==String(process.getuid()))throw new Error("Controller does not own the desktop session");
  try{
    const result=await execute("/usr/bin/osascript",["-e",'POSIX path of (choose folder with prompt "选择需要登记的 Git 仓库目录")'],{signal,timeout:120_000,maxBuffer:16_384});
    const path=result.stdout.trimEnd();
    if(!isAbsolute(path)||path.length>4_000)throw new Error("Invalid native selection");
    const physical=await realpath(path);if(!(await stat(physical)).isDirectory())throw new Error("Directory required");return physical;
  }catch(error){if(error&&typeof error==="object"&&"stderr" in error&&typeof error.stderr==="string"&&error.stderr.includes("(-128)"))return undefined;throw error;}
};

export class DirectorySelections {
  private readonly records=new Map<string,DirectorySelection>();
  private active:{id:string;controller:AbortController;work:Promise<void>}|undefined;
  private closed=false;
  constructor(private readonly picker:DirectoryPicker=nativeDirectoryPicker){}
  begin(runnerId:string):DirectorySelection{
    if(this.closed)throw new ConfigPlanError("NATIVE_PICKER_UNAVAILABLE","Controller is shutting down");
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
      }catch{selection.state=controller.signal.aborted?"cancelled":"unavailable";if(selection.state==="unavailable")selection.reasonCode="NATIVE_PICKER_UNAVAILABLE";}
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
