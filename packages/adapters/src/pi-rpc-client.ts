import {spawn,type ChildProcessWithoutNullStreams} from "node:child_process";
import {realpathSync,statSync} from "node:fs";
import {isAbsolute} from "node:path";
import {StringDecoder} from "node:string_decoder";
import {isDeepStrictEqual} from "node:util";
import {childExecutionEnvironment} from "@dispatcher/shared";
import {AdapterContractError,AdapterStartError} from "./contracts.js";
import {readOwnedNativeVersion} from "./native-version-probe.js";

export const piRpcProtocolVersion="1.2.0";
export interface PiRpcScope {
  executable:string;workspacePath:string;agentDirectory:string;sessionDirectory:string;
  sessionId:string;mode:"new"|"resume";provider?:string;model?:string;
}
export type PiRpcCommand="get_state"|"get_messages"|"get_entries"|"prompt"|"steer"|"abort";
export interface PiRpcOptions {signal?:AbortSignal;timeoutMs?:number;beforeSend?:()=>void}
export interface PiRpcResult {disposition:"started"|"queued"|"handled";state:"settled"|"handled";aborted?:boolean}
interface Directory {path:string;dev:bigint;ino:bigint}
interface Turn {written:boolean;acked:boolean;settled:boolean;handled:boolean}
interface Pending {command:PiRpcCommand;turn:Turn|undefined;resolve:(value:Record<string,unknown>)=>void;reject:(error:AdapterContractError)=>void;cleanup:()=>void}
const failure=(code:string)=>new AdapterContractError(code,"Pi RPC operation could not be confirmed");
const text=(value:unknown,max=512):value is string=>typeof value==="string"&&value.length>0&&value.length<=max&&Array.from(value).every(char=>char.charCodeAt(0)>=32&&char.charCodeAt(0)!==127);
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==="object"&&!Array.isArray(value));
function directory(path:string):Directory {
  try{if(!text(path,4096)||!isAbsolute(path))throw Error();const physical=realpathSync(path),stat=statSync(physical,{bigint:true});if(!stat.isDirectory())throw Error();return {path:physical,dev:stat.dev,ino:stat.ino};}
  catch{throw failure("PI_RPC_SCOPE_CHANGED");}
}
function synchronous(guard:(()=>void)|undefined):void {
  try{const admitted:unknown=guard?.();if(admitted!==undefined){void Promise.resolve(admitted).catch(()=>undefined);throw failure("PI_RPC_AUTHORITY_CHANGED");}}
  catch{throw failure("PI_RPC_AUTHORITY_CHANGED");}
}
async function readVersion(scope:PiRpcScope,agentDirectory:string):Promise<string>{
  return readOwnedNativeVersion({executable:scope.executable,workspacePath:scope.workspacePath,environment:{...process.env,PI_CODING_AGENT_DIR:agentDirectory},failure:code=>failure(code==="exit-unconfirmed"?"PI_RPC_PROBE_EXIT_UNCONFIRMED":"PI_RPC_RUNTIME_UNAVAILABLE")});
}
/** One pinned owned child. Settled is a run fact, never background-tool/writer release proof. */
export class PiRpcClient {
  private readonly pending=new Map<string,Pending>();
  private readonly listeners=new Set<(event:Record<string,unknown>)=>void>();
  private readonly metadata:Array<{sequence:number;type:string}>=[];
  private readonly disconnects=new Set<()=>void>();
  private readonly disconnected=new AbortController();
  private nextId=0;private sequence=0;private closed=false;private turn:Turn|undefined;
  private writes:Promise<void>=Promise.resolve();private queuedBytes=0;
  private readonly exited:Promise<void>;private shutdown?:Promise<void>;
  private constructor(private readonly child:ChildProcessWithoutNullStreams,private readonly assertScope:()=>void,private readonly originalScope:PiRpcScope){
    this.exited=new Promise(resolve=>{child.once("exit",()=>{resolve();this.fail("PI_RPC_UNREACHABLE");});child.once("close",()=>{this.fail("PI_RPC_UNREACHABLE");resolve();});});
    let buffer="";const decoder=new StringDecoder("utf8");
    child.stdout.on("data",(chunk:Buffer)=>{
      if(this.closed)return;buffer+=decoder.write(chunk);
      for(;;){const newline=buffer.indexOf("\n");if(newline<0)break;const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);if(Buffer.byteLength(line)>1_048_576){this.fail("PI_RPC_PROTOCOL_INVALID");return;}this.line(line.endsWith("\r")?line.slice(0,-1):line);if(this.closed)return;}
      if(Buffer.byteLength(buffer)>1_048_576)this.fail("PI_RPC_PROTOCOL_INVALID");
    });
    child.stdout.once("end",()=>this.fail(buffer.length||decoder.end().length?"PI_RPC_PROTOCOL_INVALID":"PI_RPC_UNREACHABLE"));
    child.stderr.on("data",()=>undefined);
    child.stdin.on("error",()=>this.fail("PI_RPC_UNREACHABLE"));child.once("error",()=>this.fail("PI_RPC_UNREACHABLE"));
  }
  static async open(input:PiRpcScope):Promise<PiRpcClient>{
    const scope=structuredClone(input);
    if(!text(scope.executable,4096)||!isAbsolute(scope.executable)||!/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i.test(scope.sessionId)||scope.sessionId.length!==36||!["new","resume"].includes(scope.mode)||[scope.provider,scope.model].some(value=>value!==undefined&&!text(value)))throw new AdapterStartError("not-created","PI_RPC_SCOPE_INVALID","Pi RPC scope is invalid");
    let paths:Directory[];
    try{paths=[scope.workspacePath,scope.agentDirectory,scope.sessionDirectory].map(directory);}catch{throw new AdapterStartError("not-created","PI_RPC_SCOPE_CHANGED","Pi RPC directories are unavailable");}
    const assertScope=()=>{if(!isDeepStrictEqual([scope.workspacePath,scope.agentDirectory,scope.sessionDirectory].map(directory),paths))throw failure("PI_RPC_SCOPE_CHANGED");};
    let version:string;
    try{version=await readVersion(scope,paths[1]!.path);}
    catch(error){throw new AdapterStartError("not-created",error instanceof AdapterContractError&&error.code==="PI_RPC_PROBE_EXIT_UNCONFIRMED"?error.code:"PI_RPC_RUNTIME_UNAVAILABLE","Pi version probe did not finish safely");}
    if(version!==piRpcProtocolVersion)throw new AdapterStartError("not-created","PI_RPC_VERSION_UNQUALIFIED","Installed Pi differs from the pinned protocol");
    try{assertScope();}catch{throw new AdapterStartError("not-created","PI_RPC_SCOPE_CHANGED","Pi RPC directories changed");}
    const argv=["--mode","rpc","--session-dir",paths[2]!.path,scope.mode==="new"?"--session-id":"--session",scope.sessionId,...(scope.provider?["--provider",scope.provider]:[]),...(scope.model?["--model",scope.model]:[])];
    const child=spawn(scope.executable,argv,{cwd:paths[0]!.path,env:childExecutionEnvironment(process.env,{PWD:paths[0]!.path,PI_CODING_AGENT_DIR:paths[1]!.path}),shell:false,stdio:["pipe","pipe","pipe"]});
    const client=new PiRpcClient(child,assertScope,{...scope,workspacePath:paths[0]!.path,agentDirectory:paths[1]!.path,sessionDirectory:paths[2]!.path});
    try{await new Promise<void>((resolve,reject)=>{child.once("spawn",resolve);child.once("error",reject);});return client;}
    catch{await client.close().catch(()=>undefined);throw new AdapterStartError("not-created","PI_RPC_RUNTIME_UNAVAILABLE","Pi process could not start");}
  }
  get connectionScope():PiRpcScope{return structuredClone(this.originalScope);}
  get disconnectSignal():AbortSignal{return this.disconnected.signal;}
  assertCurrentScope():void{if(this.closed)throw failure("PI_RPC_UNREACHABLE");this.assertScope();}
  request(command:PiRpcCommand,payload:Record<string,unknown>={},options:PiRpcOptions={}):Promise<Record<string,unknown>>{
    if(this.closed)return Promise.reject(failure("PI_RPC_UNREACHABLE"));
    if(options.signal?.aborted)return Promise.reject(failure("PI_RPC_CANCELLED"));
    if(!["get_state","get_messages","get_entries","prompt","steer","abort"].includes(command)||!object(payload)||"toJSON" in payload)return Promise.reject(failure("PI_RPC_REQUEST_INVALID"));
    const timeout=options.timeoutMs??5_000;
    if(!Number.isSafeInteger(timeout)||timeout<1||timeout>30_000)return Promise.reject(failure("PI_RPC_REQUEST_INVALID"));
    if(this.pending.size>=64)return Promise.reject(failure("PI_RPC_REQUEST_LIMIT"));
    if(command==="prompt"&&this.turn)return Promise.reject(failure("PI_RPC_TURN_PENDING"));
    const id=`pi-${++this.nextId}`;let frame:Buffer;
    try{frame=Buffer.from(`${JSON.stringify({...payload,id,type:command})}\n`);}catch{return Promise.reject(failure("PI_RPC_REQUEST_INVALID"));}
    if(frame.byteLength>262_144)return Promise.reject(failure("PI_RPC_REQUEST_TOO_LARGE"));
    if(this.queuedBytes+this.child.stdin.writableLength+frame.byteLength>1_048_576)return Promise.reject(failure("PI_RPC_REQUEST_LIMIT"));
    const signal=options.signal,beforeSend=options.beforeSend,turn=command==="prompt"?{written:false,acked:false,settled:false,handled:false}:undefined;
    if(turn)this.turn=turn;
    const abort=new AbortController();this.queuedBytes+=frame.byteLength;
    const result=new Promise<Record<string,unknown>>((resolve,reject)=>{
      const cancel=()=>this.reject(id,"PI_RPC_CANCELLED"),timer=setTimeout(()=>this.reject(id,"PI_RPC_TIMEOUT"),timeout);
      const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener("abort",cancel);abort.abort();};
      this.pending.set(id,{command,turn,resolve,reject,cleanup});signal?.addEventListener("abort",cancel,{once:true});
    });
    this.writes=this.writes.then(async()=>{
      if(this.child.stdin.writableNeedDrain)await this.drain(abort.signal);
      if(!this.pending.has(id)||this.closed||abort.signal.aborted)return;
      this.assertScope();synchronous(beforeSend);this.assertScope();
      if(!this.pending.has(id)||this.closed||signal?.aborted){this.reject(id,"PI_RPC_CANCELLED");return;}
      if(turn)turn.written=true;
      this.child.stdin.write(frame);
    }).catch(error=>this.reject(id,error instanceof AdapterContractError?error.code:"PI_RPC_UNREACHABLE")).finally(()=>{this.queuedBytes-=frame.byteLength;});
    return result;
  }
  private drain(signal:AbortSignal):Promise<void>{
    if(signal.aborted||this.closed)return Promise.reject(failure("PI_RPC_CANCELLED"));
    return new Promise((resolve,reject)=>{
      const finish=(code?:string)=>{this.child.stdin.removeListener("drain",ready);signal.removeEventListener("abort",cancel);this.child.stdin.removeListener("close",gone);if(code)reject(failure(code));else resolve();};
      const ready=()=>finish(),cancel=()=>finish("PI_RPC_CANCELLED"),gone=()=>finish("PI_RPC_UNREACHABLE");
      this.child.stdin.once("drain",ready);signal.addEventListener("abort",cancel,{once:true});this.child.stdin.once("close",gone);
    });
  }
  private reject(id:string,code:string):void{
    const request=this.pending.get(id);if(!request)return;this.pending.delete(id);request.cleanup();
    if(request.turn&&!request.turn.written&&this.turn===request.turn)this.turn=undefined;
    request.reject(failure(code));
  }
  private releaseTurn():void {if(this.turn?.acked&&(this.turn.handled||this.turn.settled))this.turn=undefined;}
  private line(line:string):void{
    let value:unknown;try{value=JSON.parse(line);}catch{this.fail("PI_RPC_PROTOCOL_INVALID");return;}
    if(!object(value)||!text(value.type,64)||!/^[a-z][a-z0-9_]*$/.test(value.type)){this.fail("PI_RPC_PROTOCOL_INVALID");return;}
    if(value.type==="response"){
      if(typeof value.id!=="string")return;const request=this.pending.get(value.id);if(!request)return;
      if(value.command!==request.command||typeof value.success!=="boolean"){this.reject(value.id,"PI_RPC_RESPONSE_MISMATCH");return;}
      if(!value.success){if(request.turn&&this.turn===request.turn)this.turn=undefined;this.reject(value.id,"PI_RPC_COMMAND_REJECTED");return;}
      const data=value.data===undefined?{}:value.data;
      if(!object(data)){this.reject(value.id,"PI_RPC_PROTOCOL_INVALID");return;}
      if(request.turn){if(typeof data.disposition!=="string"||!["started","queued","handled"].includes(data.disposition)){this.reject(value.id,"PI_RPC_PROTOCOL_INVALID");return;}request.turn.acked=true;request.turn.handled=data.disposition==="handled";this.releaseTurn();}
      this.pending.delete(value.id);request.cleanup();request.resolve(data);return;
    }
    if(value.type==="agent_settled"){
      if(typeof value.aborted!=="boolean"){this.fail("PI_RPC_PROTOCOL_INVALID");return;}
      if(this.turn?.written)this.turn.settled=true;
    }
    this.metadata.push({sequence:++this.sequence,type:value.type});if(this.metadata.length>100)this.metadata.shift();
    try{for(const listener of [...this.listeners])listener(structuredClone(value));}catch{this.fail("PI_RPC_EVENT_HANDLER_FAILED");return;}
    this.releaseTurn();
  }
  onEvent(listener:(event:Record<string,unknown>)=>void):()=>void{
    if(this.closed)throw failure("PI_RPC_UNREACHABLE");if(this.listeners.size>=64)throw failure("PI_RPC_REQUEST_LIMIT");this.listeners.add(listener);return()=>this.listeners.delete(listener);
  }
  recentEvents():Array<{sequence:number;type:string}>{return this.metadata.map(value=>({...value}));}
  async promptAndWait(message:string,options:PiRpcOptions={}):Promise<PiRpcResult>{
    const timeout=options.timeoutMs??30_000,signal=options.signal,beforeSend=options.beforeSend;
    if(this.turn)throw failure("PI_RPC_TURN_PENDING");
    if(!Number.isSafeInteger(timeout)||timeout<1||timeout>30_000||typeof message!=="string"||message.length===0)throw failure("PI_RPC_REQUEST_INVALID");
    if(signal?.aborted)throw failure("PI_RPC_CANCELLED");
    let written=false,expired=false;const local=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;let unsubscribe:(()=>void)|undefined;let stop:(()=>void)|undefined;
    let resolveSettled!:(value:boolean)=>void,rejectSettled!:(error:AdapterContractError)=>void;
    const settled=new Promise<boolean>((resolve,reject)=>{resolveSettled=resolve;rejectSettled=reject;});settled.catch(()=>undefined);
    const cancel=()=>{local.abort();rejectSettled(failure("PI_RPC_CANCELLED"));};
    try{
      unsubscribe=this.onEvent(event=>{if(written&&event.type==="agent_settled")resolveSettled(event.aborted as boolean);});
      stop=()=>rejectSettled(failure("PI_RPC_UNREACHABLE"));this.disconnects.add(stop);signal?.addEventListener("abort",cancel,{once:true});
      timer=setTimeout(()=>{expired=true;local.abort();rejectSettled(failure("PI_RPC_TIMEOUT"));},timeout);
      const data=await this.request("prompt",{message},{signal:local.signal,timeoutMs:timeout,beforeSend:()=>{synchronous(beforeSend);written=true;}});
      const disposition=data.disposition as PiRpcResult["disposition"];
      if(disposition==="handled")return {disposition,state:"handled"};
      return {disposition,state:"settled",aborted:await settled};
    }catch(error){if(expired)throw failure("PI_RPC_TIMEOUT");throw error;}
    finally{if(timer)clearTimeout(timer);unsubscribe?.();if(stop)this.disconnects.delete(stop);signal?.removeEventListener("abort",cancel);local.abort();}
  }
  private fail(code:string):void{
    if(this.closed)return;this.closed=true;this.disconnected.abort(failure(code));for(const id of [...this.pending.keys()])this.reject(id,code);for(const notify of [...this.disconnects])notify();this.listeners.clear();void this.close().catch(()=>undefined);
  }
  /** Only the owned root is stopped. Session files, queue and background tools are untouched. */
  close():Promise<void>{
    return this.shutdown??=this.closeOwned();
  }
  private async closeOwned():Promise<void>{
    if(!this.closed){this.closed=true;this.disconnected.abort(failure("PI_RPC_UNREACHABLE"));for(const id of [...this.pending.keys()])this.reject(id,"PI_RPC_UNREACHABLE");for(const notify of [...this.disconnects])notify();this.listeners.clear();}
    try{
      this.child.stdin.end();
      const wait=(ms:number)=>new Promise<boolean>(resolve=>{const timer=setTimeout(()=>resolve(false),ms);this.exited.then(()=>{clearTimeout(timer);resolve(true);});});
      if(await wait(1_000))return;this.child.kill("SIGTERM");if(await wait(500))return;this.child.kill("SIGKILL");if(!await wait(500))throw failure("PI_RPC_DISCONNECT_UNCONFIRMED");
    }finally{this.child.stdin.destroy();this.child.stdout.destroy();this.child.stderr.destroy();}
  }
}

