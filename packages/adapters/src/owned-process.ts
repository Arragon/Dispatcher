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
  private uncertaintyError?:Error;
  private readonly pid:number|undefined;
  private readonly rootKill:(signal:NodeJS.Signals)=>boolean|void;
  constructor(private readonly child:ChildProcess|OwnedTerminalProcess){
    this.pid=child.pid;this.rootKill=child.kill.bind(child);
    const exited=()=>{
      this.exited=true;
      // Observe before another event/await can recycle the numeric group ID.
      if(process.platform!=="win32"&&"once" in child){try{this.probe();}catch(error){this.uncertaintyError??=new Error("LOCAL_PROCESS_IDENTITY_UNKNOWN",{cause:error});}}
      void this.stop().catch(()=>undefined);
    };
    if ("once" in child) {
      child.once("exit", exited);
      child.once("close", exited);
      child.once("error",()=>{if(this.pid===undefined&&child.pid===undefined)this.drained=true;});
    } else child.onExit(exited);
  }
  stop(interruptRoot=false):Promise<void>{return this.stopping??=Promise.resolve().then(()=>this.drain(interruptRoot));}
  treeStatus():OwnedProcessTreeStatus {
    // PTY and Windows APIs do not establish membership of a POSIX child group.
    if(process.platform==="win32"||!("once" in this.child))return {state:"unknown",scope:"unverified"};
    try{return {state:this.probe(),scope:"owned-process-group"};}
    catch{return {state:"unknown",scope:"owned-process-group"};}
  }
  private assertIdentity():void {
    if(this.uncertaintyError)throw this.uncertaintyError;
    if(this.pid===undefined||this.child.pid!==this.pid)throw this.uncertaintyError=new Error("LOCAL_PROCESS_IDENTITY_UNKNOWN");
  }
  private probe():OwnedProcessTreeStatus["state"] {
    if(this.drained)return "empty";
    this.assertIdentity();
    try{process.kill(-this.pid!,0);return "present";}
    catch(error){
      if((error as NodeJS.ErrnoException).code==="ESRCH"){this.drained=true;return "empty";}
      if(this.exited)throw this.uncertaintyError=new Error("LOCAL_PROCESS_IDENTITY_UNKNOWN",{cause:error});
      if((error as NodeJS.ErrnoException).code==="EPERM")return "unknown";
      throw error;
    }
  }
  private alive():boolean {
    if(this.drained)return false;
    this.assertIdentity();
    if(process.platform==="win32")return !this.exited;
    // Unknown permissions cannot be treated as absence while draining.
    return this.probe()!=="empty";
  }
  private signal(signal:NodeJS.Signals):void {
    if(this.drained)return;this.assertIdentity();
    try{if(process.platform!=="win32")process.kill(-this.pid!,signal);else this.rootKill(signal);}
    catch(error){
      if((error as NodeJS.ErrnoException).code==="ESRCH"){this.drained=true;return;}
      if(this.exited)throw this.uncertaintyError=new Error("LOCAL_PROCESS_IDENTITY_UNKNOWN",{cause:error});
      throw error;
    }
  }
  private async wait(deadline:number):Promise<boolean>{
    while(this.alive()){if(Date.now()>=deadline)return false;await new Promise(resolve=>setTimeout(resolve,25));}
    return true;
  }
  private async drain(interruptRoot:boolean):Promise<void>{
    if(interruptRoot&&process.platform!=="win32"&&"once" in this.child&&!this.exited&&this.alive()){
      if(this.rootKill("SIGINT")===false)throw new Error("LOCAL_PROCESS_IDENTITY_UNKNOWN");
      const deadline=Date.now()+1000;
      while(!this.exited&&this.alive()){
        if(Date.now()>=deadline)break;
        await new Promise(resolve=>setTimeout(resolve,25));
      }
    }
    if(!this.alive()){this.drained=true;return;}
    if(process.platform==="win32"&&this.pid){
      await new Promise<void>((resolve,reject)=>execFile("taskkill",["/PID",String(this.pid),"/T","/F"],{windowsHide:true,timeout:4000},error=>error&&this.alive()?reject(new Error("Owned native process tree termination is unconfirmed")):resolve()));
    }else this.signal("SIGTERM");
    if(!await this.wait(Date.now()+2000)){this.signal("SIGKILL");if(!await this.wait(Date.now()+2000))throw new Error("Owned native process group termination is unconfirmed");}
    // Once absence is established, never signal this numeric PID/group again.
    this.drained=true;
  }
}
