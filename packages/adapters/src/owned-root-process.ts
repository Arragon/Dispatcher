import type {ChildProcess} from "node:child_process";

/** Authority over only the original freshly spawned root, never its descendants. */
export class OwnedProcessRoot {
  private readonly pid:number|undefined;
  private readonly rootKill:ChildProcess["kill"];
  private ended=false;
  private stopping?:Promise<void>;
  constructor(private readonly child:ChildProcess){
    this.pid=child.pid;this.rootKill=child.kill.bind(child);
    child.once("exit",()=>{this.ended=true;});
    child.once("close",()=>{this.ended=true;});
    child.once("error",()=>{if(this.pid===undefined&&child.pid===undefined)this.ended=true;});
  }
  stop():Promise<void>{return this.stopping??=Promise.resolve().then(()=>this.stopOnce());}
  private alive():boolean {
    if(this.ended)return false;
    if(this.pid===undefined||this.child.pid!==this.pid)throw new Error("LOCAL_PROCESS_IDENTITY_UNKNOWN");
    return true;
  }
  private signal(signal:NodeJS.Signals):void {
    if(this.alive()&&this.rootKill(signal)===false)throw new Error("LOCAL_PROCESS_IDENTITY_UNKNOWN");
  }
  private async stopOnce():Promise<void>{
    if(!this.alive())return;
    this.signal("SIGTERM");
    const deadline=Date.now()+2000;
    while(this.alive()){
      if(Date.now()>=deadline){this.signal("SIGKILL");return;}
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    // Callers confirm actual exit/close separately, including after SIGKILL.
  }
}
