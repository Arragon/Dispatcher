import {spawn,type ChildProcessWithoutNullStreams} from "node:child_process";
import {realpathSync,statSync} from "node:fs";
import {isAbsolute} from "node:path";
import {StringDecoder} from "node:string_decoder";
import {isDeepStrictEqual} from "node:util";
import type {InteractionCapabilities} from "@dispatcher/domain";
import {childExecutionEnvironment} from "@dispatcher/shared";
import {AdapterContractError,AdapterStartError} from "./contracts.js";
import type {LocalRuntimeDisconnect} from "./interaction-contracts.js";
import {NativeRequestError} from "./native-requests.js";
import {readOwnedNativeVersion} from "./native-version-probe.js";

export const codexAppServerProtocolVersion="0.162.0-alpha.17.2";
export interface CodexAppServerScope {
  profileId:string;runnerId:string;nativeStoreRef:string;scopeFingerprint:string;executionRefId:string;
  executable:string;codexHome:string;workspacePath:string;
  approvalPolicy:"on-request"|"untrusted";sandbox:"workspace-write"|"read-only";
  evidence?:Partial<InteractionCapabilities>;
}
export interface CodexRpcTransport {
  request(method:string,params:Record<string,unknown>,signal?:AbortSignal):Promise<unknown>;
  notify(method:string,params:Record<string,unknown>):void;
  onNotification(listener:(method:string,params:unknown)=>void):()=>void;
  onDisconnect(listener:()=>void):()=>void;
  onRequest?(listener:(request:CodexRpcRequest)=>void):()=>void;
  close():Promise<void>;
  disconnectLocal?():Promise<LocalRuntimeDisconnect>;
}
/** The original connection owns this callback. Cancellation cannot grant permission. */
export interface CodexRpcRequest {
  readonly id:string|number;readonly method:string;readonly params:unknown;
  isPending():boolean;respond(result:unknown):void;cancel():void;reject():void;
}
const validText=(value:unknown,max=512):value is string=>typeof value==="string"&&value.length>0&&value.length<=max&&Array.from(value).every(char=>char.charCodeAt(0)>=32&&char.charCodeAt(0)!==127);
const object=(value:unknown):Record<string,unknown>=>{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new AdapterContractError("CODEX_PROTOCOL_INVALID","Codex protocol payload is malformed");return value as Record<string,unknown>;
};
function physical(path:unknown):string {
  try{if(!validText(path,4096)||!isAbsolute(path)||!statSync(path).isDirectory())throw new Error();return realpathSync(path);}catch{throw new AdapterContractError("CODEX_SCOPE_CHANGED","Codex native directory is unavailable or changed");}
}
interface DirectoryIdentity {path:string;dev:bigint;ino:bigint}
function directoryIdentity(path:unknown):DirectoryIdentity {
  const canonical=physical(path);
  try{const stat=statSync(canonical,{bigint:true});if(!stat.isDirectory())throw new Error();return {path:canonical,dev:stat.dev,ino:stat.ino};}
  catch{throw new AdapterContractError("CODEX_SCOPE_CHANGED","Codex native directory is unavailable or changed");}
}
function assertDirectory(path:unknown,identity:DirectoryIdentity):void {
  if(!isDeepStrictEqual(directoryIdentity(path),identity))throw new AdapterContractError("CODEX_SCOPE_CHANGED","Native directory identity has changed");
}

/** One owned, version-pinned stdio connection. Closing it cannot stop a user's app server. */
export class CodexStdioTransport implements CodexRpcTransport {
  private nextId=1;
  private readonly pending=new Map<number,{resolve:(value:unknown)=>void;reject:(reason:unknown)=>void;cleanup:()=>void}>();
  private readonly listeners=new Set<(method:string,params:unknown)=>void>();
  private readonly disconnects=new Set<()=>void>();
  private readonly incoming=new Map<string,CodexRpcRequest>();
  private requestListener:((request:CodexRpcRequest)=>void)|undefined;
  private closed=false;
  private readonly rootExited:Promise<void>;
  private localDisconnect?:Promise<LocalRuntimeDisconnect>;
  private constructor(private readonly child:ChildProcessWithoutNullStreams) {
    let buffer="";const decoder=new StringDecoder("utf8");
    child.stdout.on("data",(chunk:Buffer)=>{
      if(this.closed)return;buffer+=decoder.write(chunk);
      for(;;){const newline=buffer.indexOf("\n");if(newline<0)break;const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);if(Buffer.byteLength(line)>1_048_576){this.fail();return;}this.line(line);if(this.closed)return;}
      if(Buffer.byteLength(buffer)>1_048_576)this.fail();
    });
    child.stderr.on("data",()=>undefined);
    child.stdin.on("error",()=>this.fail());child.on("error",()=>this.fail());
    this.rootExited=new Promise(resolve=>{child.once("exit",()=>{this.fail();resolve();});child.once("close",()=>{this.fail();resolve();});});
  }
  static async open(scope:CodexAppServerScope):Promise<CodexStdioTransport> {
    scope=structuredClone(scope);
    let home:DirectoryIdentity,workspace:DirectoryIdentity;
    try{home=directoryIdentity(scope.codexHome);workspace=directoryIdentity(scope.workspacePath);}
    catch{throw new AdapterStartError("not-created","CODEX_SCOPE_CHANGED","Codex native directory is unavailable or changed");}
    let version:string;
    try{version=await readOwnedNativeVersion({executable:scope.executable,workspacePath:scope.workspacePath,environment:{...process.env,CODEX_HOME:scope.codexHome},failure:code=>new AdapterContractError(code==="exit-unconfirmed"?"CODEX_PROBE_EXIT_UNCONFIRMED":"CODEX_RUNTIME_UNAVAILABLE","Codex version probe did not finish safely")});}
    catch(error){throw new AdapterStartError("not-created",error instanceof AdapterContractError&&error.code==="CODEX_PROBE_EXIT_UNCONFIRMED"?error.code:"CODEX_RUNTIME_UNAVAILABLE","Codex executable is unavailable");}
    if(version!==`codex-cli ${codexAppServerProtocolVersion}`)throw new AdapterStartError("not-created","CODEX_PROTOCOL_VERSION_UNQUALIFIED","Installed Codex version differs from the pinned protocol");
    try{assertDirectory(scope.codexHome,home);assertDirectory(scope.workspacePath,workspace);}
    catch{throw new AdapterStartError("not-created","CODEX_SCOPE_CHANGED","Codex native directory changed during the version probe");}
    return new CodexStdioTransport(spawn(scope.executable,["app-server","--listen","stdio://"],{cwd:scope.workspacePath,shell:false,stdio:["pipe","pipe","pipe"],env:childExecutionEnvironment(process.env,{PWD:scope.workspacePath,CODEX_HOME:scope.codexHome})}));
  }
  request(method:string,params:Record<string,unknown>,signal?:AbortSignal):Promise<unknown> {
    if(this.closed||signal?.aborted)return Promise.reject(new AdapterContractError("CODEX_NATIVE_UNREACHABLE","Codex native connection is unavailable"));
    if(this.pending.size>=64)return Promise.reject(new AdapterContractError("CODEX_REQUEST_LIMIT","Too many pending native requests"));
    const id=this.nextId++;
    return new Promise((resolve,reject)=>{
      const abort=()=>{const request=this.pending.get(id);if(!request)return;this.pending.delete(id);request.cleanup();reject(new AdapterContractError("CODEX_NATIVE_UNREACHABLE","Codex native request did not finish"));};
      const timer=setTimeout(abort,30_000);const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener("abort",abort);};
      this.pending.set(id,{resolve,reject,cleanup});signal?.addEventListener("abort",abort,{once:true});
      try{this.write({id,method,params});}catch(error){this.pending.delete(id);cleanup();reject(error);}
    });
  }
  notify(method:string,params:Record<string,unknown>):void {this.write({method,params});}
  onNotification(listener:(method:string,params:unknown)=>void):()=>void {this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  onDisconnect(listener:()=>void):()=>void {this.disconnects.add(listener);return()=>this.disconnects.delete(listener);}
  onRequest(listener:(request:CodexRpcRequest)=>void):()=>void {
    if(this.requestListener)throw new AdapterContractError("CODEX_REQUEST_OWNER_CONFLICT","Native callbacks already have an owner");
    this.requestListener=listener;return()=>{if(this.requestListener===listener)this.requestListener=undefined;};
  }
  private write(value:unknown):void {
    if(this.closed)throw new AdapterContractError("CODEX_NATIVE_UNREACHABLE","Codex native connection is unavailable");
    const line=JSON.stringify(value);if(Buffer.byteLength(line)>1_048_576)throw new AdapterContractError("CODEX_REQUEST_TOO_LARGE","Native request exceeds its bound");
    const frame=Buffer.from(`${line}\n`);
    if(this.child.stdin.writableLength+frame.byteLength>4_194_304)throw new AdapterContractError("CODEX_REQUEST_LIMIT","Native write queue exceeds its bound");
    this.child.stdin.write(frame);
  }
  private line(line:string):void {
    if(!line.trim())return;
    try{
      const message=object(JSON.parse(line));
      if(typeof message.method==="string"){
        if(message.id!==undefined){
          if(!(typeof message.id==="number"&&Number.isSafeInteger(message.id)||validText(message.id)))throw new Error();
          const id=message.id as string|number;const key=JSON.stringify(id);
          if(this.incoming.has(key)||this.incoming.size>=128)throw new Error();
          const pending=()=>!this.closed&&this.incoming.get(key)===request;
          const consume=()=>{if(!pending())throw new NativeRequestError("NATIVE_REQUEST_CONSUMED");this.incoming.delete(key);};
          const request:CodexRpcRequest={id,method:message.method,params:message.params,isPending:pending,cancel:()=>{if(pending())this.incoming.delete(key);},respond:result=>{consume();this.write({id,result});},reject:()=>{consume();this.write({id,error:{code:-32601,message:"Native request is unavailable for this connection"}});}};
          this.incoming.set(key,request);if(this.requestListener)this.requestListener(request);else request.reject();return;
        }
        if(message.method==="serverRequest/resolved"&&message.params&&typeof message.params==="object"){
          const params=message.params as Record<string,unknown>;const original=this.incoming.get(JSON.stringify(params.requestId));
          if(original&&(original.params as Record<string,unknown>)?.threadId===params.threadId)original.cancel();
        }
        for(const listener of this.listeners)listener(message.method,message.params);return;
      }
      if(typeof message.id!=="number")throw new Error();const request=this.pending.get(message.id);if(!request)return;
      let failure:AdapterContractError|undefined;
      if("error" in message){
        const error=message.error&&typeof message.error==="object"&&!Array.isArray(message.error)?message.error as Record<string,unknown>:undefined;
        failure=error&&Number.isInteger(error.code)?new AdapterContractError(error.code===-32601?"CODEX_METHOD_UNSUPPORTED":"CODEX_NATIVE_REQUEST_FAILED","Codex native request was rejected"):new AdapterContractError("CODEX_PROTOCOL_INVALID","Codex error response is malformed");
      }else if(!("result" in message))failure=new AdapterContractError("CODEX_PROTOCOL_INVALID","Codex response has no result");
      this.pending.delete(message.id);request.cleanup();if(failure)request.reject(failure);else request.resolve(message.result);
    }catch{this.fail();}
  }
  private fail():void {
    if(this.closed)return;this.closed=true;
    this.incoming.clear();
    for(const request of this.pending.values()){request.cleanup();request.reject(new AdapterContractError("CODEX_NATIVE_UNREACHABLE","Codex native connection ended"));}this.pending.clear();
    for(const listener of this.disconnects)try{listener();}catch{/* Observer failure cannot prevent owned transport cleanup. */}
    this.child.stdin.destroy();this.child.stdout.destroy();this.child.stderr.destroy();this.child.kill("SIGTERM");
    const timer=setTimeout(()=>this.child.kill("SIGKILL"),2_000);timer.unref();this.child.once("exit",()=>clearTimeout(timer));this.child.once("close",()=>clearTimeout(timer));
  }
  async disconnectLocal():Promise<LocalRuntimeDisconnect>{
    this.localDisconnect??=(async()=>{
      this.fail();let timer:ReturnType<typeof setTimeout>|undefined;
      try{await Promise.race([this.rootExited,new Promise<void>(resolve=>{timer=setTimeout(resolve,3_000);})]);}
      finally{if(timer)clearTimeout(timer);this.child.stdout.destroy();this.child.stderr.destroy();}
      const exited=this.child.exitCode!==null||this.child.signalCode!==null;
      return {version:1,connection:"closed",ownedRoot:exited?"exited":this.child.pid===undefined?"not-created":"unknown",callbacks:"drained",backgroundTools:"unknown",nativeSessionDeleted:false,...(this.child.pid?{ownedRootPid:this.child.pid}:{})};
    })();return structuredClone(await this.localDisconnect);
  }
  async close():Promise<void>{const result=await this.disconnectLocal();if(result.ownedRoot==="unknown")throw new AdapterContractError("CODEX_RUNTIME_CLOSE_UNKNOWN","Owned root exit remains unknown");}
}
