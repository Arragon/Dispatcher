import { execFile, type ChildProcess } from "node:child_process";

interface OwnedTerminalProcess {
  pid: number;
  kill(signal?: string): void;
  onExit(listener: () => void): unknown;
}
export interface OwnedProcessTreeStatus {state:"present"|"empty"|"unknown";scope:"owned-process-group"|"unverified"}

/** Owns only a child created by this process, never a recovered or inferred PID. */
export class OwnedProcessGroup {
  private stopping?:Promise<void>;
  private drained=false;
  private exited=false;
  constructor(private readonly child:ChildProcess|OwnedTerminalProcess){
    const exited=()=>{this.exited=true;void this.stop().catch(()=>undefined);};
    if ("once" in child) {
      child.once("exit", exited);
      child.once("error",()=>{if(!child.pid)this.drained=true;});
    } else child.onExit(exited);
  }
  stop():Promise<void>{return this.stopping??=this.drain();}
  treeStatus():OwnedProcessTreeStatus {
    // PTY and Windows APIs do not establish membership of a POSIX child group.
    if(process.platform==="win32"||!("once" in this.child))return {state:"unknown",scope:"unverified"};
    try{return {state:this.probe(),scope:"owned-process-group"};}
    catch{return {state:"unknown",scope:"owned-process-group"};}
  }
  private probe():OwnedProcessTreeStatus["state"] {
    if(this.drained||!this.child.pid)return "empty";
    try{process.kill(-this.child.pid,0);return "present";}
    catch(error){
      if((error as NodeJS.ErrnoException).code==="ESRCH"){this.drained=true;return "empty";}
      if((error as NodeJS.ErrnoException).code==="EPERM")return "unknown";
      throw error;
    }
  }
  private alive():boolean {
    if(this.drained||!this.child.pid)return false;
    if(process.platform==="win32")return !this.exited;
    // Unknown permissions cannot be treated as absence while draining.
    return this.probe()!=="empty";
  }
  private signal(signal:NodeJS.Signals):void {
    try{if(process.platform!=="win32"&&this.child.pid)process.kill(-this.child.pid,signal);else this.child.kill(signal);}
    catch(error){if((error as NodeJS.ErrnoException).code!=="ESRCH")throw error;}
  }
  private async wait(deadline:number):Promise<boolean>{
    while(this.alive()){if(Date.now()>=deadline)return false;await new Promise(resolve=>setTimeout(resolve,25));}
    return true;
  }
  private async drain():Promise<void>{
    if(!this.alive()){this.drained=true;return;}
    if(process.platform==="win32"&&this.child.pid){
      await new Promise<void>((resolve,reject)=>execFile("taskkill",["/PID",String(this.child.pid),"/T","/F"],{windowsHide:true,timeout:4000},error=>error&&this.alive()?reject(new Error("Owned native process tree termination is unconfirmed")):resolve()));
    }else this.signal("SIGTERM");
    if(!await this.wait(Date.now()+2000)){this.signal("SIGKILL");if(!await this.wait(Date.now()+2000))throw new Error("Owned native process group termination is unconfirmed");}
    // Once absence is established, never signal this numeric PID/group again.
    this.drained=true;
  }
}
