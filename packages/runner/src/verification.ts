import { spawn } from "node:child_process";
import { OwnedProcessGroup } from "@dispatcher/adapters";

export interface VerificationCommand {
  id: string;
  file: string;
  args: string[];
  required: boolean;
  timeoutMs: number;
  outputLimitBytes: number;
}

export interface VerificationResult {
  commandId: string;
  required: boolean;
  status: "passed" | "failed" | "timeout";
  exitCode: number | null;
  durationMs: number;
  output: string;
  truncated: boolean;
}

export class VerificationRegistry {
  private readonly commands = new Map<string, VerificationCommand>();
  register(command: VerificationCommand): void {
    if (!command.id || !command.file || command.timeoutMs <= 0 || command.outputLimitBytes <= 0) throw new Error("Invalid verification command");
    this.commands.set(command.id, structuredClone(command));
  }
  list(): VerificationCommand[] { return [...this.commands.values()].map((value) => structuredClone(value)); }

  async run(commandId: string, cwd: string, signal?: AbortSignal): Promise<VerificationResult> {
    const command = this.commands.get(commandId);
    if (!command) throw new Error(`Verification command is not registered: ${commandId}`);
    const started = Date.now();
    if(signal?.aborted)return this.result(command,"failed",null,"",started);
    const child=spawn(command.file,command.args,{cwd,shell:false,stdio:["ignore","pipe","pipe"],detached:process.platform!=="win32",env:{...process.env,PWD:cwd}});
    const ownership=new OwnedProcessGroup(child);
    return new Promise<VerificationResult>((resolve,reject)=>{
      let output=Buffer.alloc(0),timedOut=false,limited=false,aborted=false;
      const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener("abort",abort);};
      const stop=()=>{void ownership.stop().catch(error=>{cleanup();reject(error);});};
      const abort=()=>{aborted=true;stop();};
      const timer=setTimeout(()=>{timedOut=true;stop();},command.timeoutMs);
      signal?.addEventListener("abort",abort,{once:true});
      const collect=(chunk:Buffer)=>{const room=command.outputLimitBytes*2-output.length;output=Buffer.concat([output,chunk.subarray(0,Math.max(0,room))]);if(chunk.length>room){limited=true;stop();}};
      child.stdout.on("data",collect);child.stderr.on("data",collect);
      child.on("error",()=>undefined);
      child.once("close",code=>{void (async()=>{
        await ownership.stop();cleanup();
        resolve(this.result(command,timedOut?"timeout":code===0&&!limited&&!aborted?"passed":"failed",code,output.toString("utf8"),started));
      })().catch(error=>{cleanup();reject(error);});});
    });
  }

  blocksDelivery(results: VerificationResult[]): boolean { return results.some((result) => result.required && result.status !== "passed"); }

  private result(command: VerificationCommand, status: VerificationResult["status"], exitCode: number | null, output: string, started: number): VerificationResult {
    const bytes = Buffer.from(output);
    const truncated = bytes.length > command.outputLimitBytes;
    return { commandId: command.id, required: command.required, status, exitCode, durationMs: Date.now() - started, output: bytes.subarray(0, command.outputLimitBytes).toString("utf8"), truncated };
  }
}
