import {spawn,type ChildProcessWithoutNullStreams} from "node:child_process";
import {randomBytes} from "node:crypto";
import {realpathSync,statSync} from "node:fs";
import {isAbsolute} from "node:path";
import {StringDecoder} from "node:string_decoder";
import {isDeepStrictEqual} from "node:util";
import {assertAdapterWriteAdmission} from "./contracts.js";
import type {LocalRuntimeDisconnect} from "./interaction-contracts.js";
import {OpenCodeV2Error,OpenCodeV2HttpTransport,OpenCodeV2InteractionPort,isOpenCodeV2ProtocolVersion,type OpenCodeV2Request,type OpenCodeV2Scope,type OpenCodeV2Transport} from "./opencode-server.js";
import {OwnedProcessGroup} from "./owned-process.js";
import {readOwnedNativeVersion} from "./native-version-probe.js";
import {childExecutionEnvironment} from "@dispatcher/shared";

export type OpenCodeV2OwnedScope=Omit<OpenCodeV2Scope,"server">&{executable:string};
interface DirectoryIdentity {path:string;dev:bigint;ino:bigint}
function directory(path:string):DirectoryIdentity {
 try{const canonical=realpathSync(path),stat=statSync(canonical,{bigint:true});if(!isAbsolute(path)||!stat.isDirectory())throw Error();return {path:canonical,dev:stat.dev,ino:stat.ino};}
 catch{throw new OpenCodeV2Error("OPENCODE_SCOPE_CHANGED");}
}

/** Owns only the newly spawned stdio server; native tool/writer state stays unknown. */
export class OpenCodeV2OwnedServer implements OpenCodeV2Transport {
 private readonly scope:OpenCodeV2OwnedScope;
 private readonly beforeSpawn:(()=>void)|undefined;
 private readonly workspace:DirectoryIdentity;
 private readonly environment:NodeJS.ProcessEnv;
 private temporary?:DirectoryIdentity;
 private readonly opening:Promise<OpenCodeV2InteractionPort>;
 private port?:OpenCodeV2InteractionPort;
 private transport?:OpenCodeV2HttpTransport;
 private child?:ChildProcessWithoutNullStreams;
 private probeState:"pending"|"settled"|"exit-unconfirmed"="settled";
 private cancellation?:OwnedProcessGroup;
 private streamsClosed?:Promise<void>;
 private childDrained=false;
 private rootExited?:Promise<void>;
 private readonly startupAbort=new AbortController();
 private readonly requests=new Map<AbortController,Promise<unknown>>();
 private closed=false;
 #password:string|undefined;
 private childCleanup?:Promise<void>;
 private cleanup?:Promise<LocalRuntimeDisconnect>;
 constructor(scope:OpenCodeV2OwnedScope,beforeSpawn?:()=>void){
  if(![scope.profileId,scope.runnerId,scope.nativeStoreRef,scope.scopeFingerprint,scope.workspacePath,scope.executable].every(value=>typeof value==="string"&&value.length>0&&value.length<=4096&&Array.from(value).every(char=>char.charCodeAt(0)>=32&&char.charCodeAt(0)!==127))||!["opencode-server-v2","opencode-cli-json"].includes(scope.backendId)||scope.protocolVersion!==undefined&&!isOpenCodeV2ProtocolVersion(scope.protocolVersion))throw new OpenCodeV2Error("OPENCODE_SCOPE_INVALID","not-created");
  this.beforeSpawn=beforeSpawn;this.scope=structuredClone(scope);this.environment=childExecutionEnvironment(process.env);try{this.workspace=directory(scope.workspacePath);}catch{throw new OpenCodeV2Error("OPENCODE_SCOPE_CHANGED","not-created");}
  this.opening=this.open().catch(async error=>{this.closeAdmission();await this.cleanChild();throw new OpenCodeV2Error(error instanceof OpenCodeV2Error?error.code:"OPENCODE_RUNTIME_UNAVAILABLE",this.child?"unknown":"not-created");});
  void this.opening.catch(()=>undefined);
 }
 ready():Promise<OpenCodeV2InteractionPort>{return this.opening;}
 private assertScope():void {
  if(!isDeepStrictEqual(directory(this.scope.workspacePath),this.workspace)||this.temporary&&!isDeepStrictEqual(directory(this.temporary.path),this.temporary))throw new OpenCodeV2Error("OPENCODE_SCOPE_CHANGED");
 }
 private assertOpen(outcome:"not-created"|"unknown"="unknown"):void {if(this.closed)throw new OpenCodeV2Error("OPENCODE_LOCAL_CONNECTION_CLOSED",outcome);this.assertScope();}
 private async open():Promise<OpenCodeV2InteractionPort>{
  this.assertOpen("not-created");
  const reported=await this.readVersion();
  this.assertOpen("not-created");
  const version=reported.startsWith("opencode v")?reported.slice(10):undefined;
  if(!isOpenCodeV2ProtocolVersion(version)||this.scope.protocolVersion!==undefined&&version!==this.scope.protocolVersion)throw new OpenCodeV2Error("OPENCODE_VERSION_UNSUPPORTED","not-created");
  this.#password=randomBytes(32).toString("base64url");
  const env=childExecutionEnvironment(this.environment,{PWD:this.workspace.path,OPENCODE_PASSWORD:this.#password});
  // A fresh stdio host has no service password or PTY handoff to inherit.
  delete env.OPENCODE_SERVER_PASSWORD;delete env.OPENCODE_PTY_HANDOFF;
  const ownsGroup=process.platform!=="win32";
  this.assertSpawnAdmission();
  const child=spawn(this.scope.executable,["serve","--stdio","--hostname","127.0.0.1","--port","0"],{cwd:this.workspace.path,env,shell:false,detached:ownsGroup,stdio:["pipe","pipe","pipe"]});
  this.streamsClosed=new Promise(resolve=>child.once("close",()=>resolve()));
  this.child=child;this.cancellation=new OwnedProcessGroup(child);
  this.rootExited=new Promise(resolve=>{child.once("exit",()=>{this.closeAdmission();resolve();});child.once("close",()=>{this.closeAdmission();resolve();});});
  child.on("error",()=>this.closeAdmission());
  child.stderr.on("data",()=>undefined);child.stdin.on("error",()=>this.closeAdmission());
  const origin=await this.readiness(child);child.stdout.on("data",()=>undefined);this.assertOpen();
  this.transport=new OpenCodeV2HttpTransport(origin,async()=>{if(this.closed||!this.#password)throw new OpenCodeV2Error("OPENCODE_LOCAL_CONNECTION_CLOSED");return {authorization:`Basic ${Buffer.from(`opencode:${this.#password}`).toString("base64")}`};});
  const info=await this.exchange({method:"GET",path:"/api/info"});this.assertOpen();
  if(!info||typeof info!=="object"||Array.isArray(info))throw new OpenCodeV2Error("OPENCODE_V2_SCHEMA_INVALID");
  const value=info as {version?:unknown;pid?:unknown;urls?:unknown;paths?:{tmp?:unknown}};
  if(value.version!==version||value.pid!==child.pid||!Number.isSafeInteger(child.pid)||!Array.isArray(value.urls)||typeof value.paths?.tmp!=="string"||!isAbsolute(value.paths.tmp))throw new OpenCodeV2Error("OPENCODE_SERVER_IDENTITY_CHANGED");
  this.temporary=directory(value.paths.tmp);this.assertOpen();
  this.port=new OpenCodeV2InteractionPort({...this.scope,protocolVersion:version,server:{pid:child.pid!,tmpDirectory:this.temporary.path,ownership:"owned",shared:false}},this);
  return this.port;
 }
 private assertSpawnAdmission():void {
  this.assertOpen("not-created");
  try{assertAdapterWriteAdmission(this.beforeSpawn);}catch{throw new OpenCodeV2Error("OPENCODE_SPAWN_ADMISSION_REJECTED","not-created");}
  this.assertOpen("not-created");
 }
 private async readVersion():Promise<string>{
  this.assertSpawnAdmission();
  this.probeState="pending";
  try{return await readOwnedNativeVersion({executable:this.scope.executable,workspacePath:this.workspace.path,environment:this.environment,signal:this.startupAbort.signal,failure:code=>new OpenCodeV2Error(code==="exit-unconfirmed"?"OPENCODE_PROBE_EXIT_UNCONFIRMED":this.closed?"OPENCODE_LOCAL_CONNECTION_CLOSED":"OPENCODE_RUNTIME_UNAVAILABLE","not-created")});}
  catch(error){if(error instanceof OpenCodeV2Error&&error.code==="OPENCODE_PROBE_EXIT_UNCONFIRMED")this.probeState="exit-unconfirmed";throw error;}
  finally{if(this.probeState==="pending")this.probeState="settled";}
 }
 private readiness(child:ChildProcessWithoutNullStreams):Promise<string>{
  return new Promise((resolve,reject)=>{
   let buffer="",bytes=0;const decoder=new StringDecoder("utf8");
   const finish=(error?:OpenCodeV2Error,origin?:string)=>{clearTimeout(timer);child.stdout.off("data",data);child.off("error",failed);child.off("exit",failed);this.startupAbort.signal.removeEventListener("abort",failed);if(error)reject(error);else resolve(origin!);};
   const failed=()=>finish(new OpenCodeV2Error(this.closed?"OPENCODE_LOCAL_CONNECTION_CLOSED":"OPENCODE_RUNTIME_UNAVAILABLE"));
   const data=(chunk:Buffer)=>{
    bytes+=chunk.byteLength;if(bytes>16384){finish(new OpenCodeV2Error("OPENCODE_READINESS_INVALID"));return;}buffer+=decoder.write(chunk);
    const newline=buffer.indexOf("\n");if(newline<0)return;
    try{const record=JSON.parse(buffer.slice(0,newline)) as {url?:unknown};if(typeof record.url!=="string")throw Error();const url=new URL(record.url);if(url.protocol!=="http:"||url.hostname!=="127.0.0.1"||!url.port||url.username||url.password||url.pathname!=="/"||url.search||url.hash)throw Error();finish(undefined,url.origin);}
    catch{finish(new OpenCodeV2Error("OPENCODE_READINESS_INVALID"));}
   };
   const timer=setTimeout(()=>finish(new OpenCodeV2Error("OPENCODE_READINESS_TIMEOUT")),10000);
   child.stdout.on("data",data);child.once("error",failed);child.once("exit",failed);this.startupAbort.signal.addEventListener("abort",failed,{once:true});
   if(this.closed)failed();
  });
 }
 async request(input:OpenCodeV2Request):Promise<unknown>{
  this.assertOpen();
  let captured:OpenCodeV2Request;
  try{captured={...input,...(input.query?{query:{...input.query}}:{}),...(input.body!==undefined?{body:structuredClone(input.body)}:{})};}catch{throw new OpenCodeV2Error("OPENCODE_REQUEST_INVALID");}
  await this.opening;this.assertOpen();return this.exchange(captured);
 }
 private exchange(input:OpenCodeV2Request):Promise<unknown>{
  this.assertOpen();const abort=new AbortController(),cancel=()=>abort.abort();input.signal?.addEventListener("abort",cancel,{once:true});if(input.signal?.aborted)abort.abort();
  const beforeSend=input.beforeSend;
  const captured={...input,...(input.query?{query:{...input.query}}:{}),...(input.body!==undefined?{body:structuredClone(input.body)}:{}),signal:abort.signal,beforeSend:()=>{this.assertOpen();const result=beforeSend?.();this.assertOpen();return result;}};
  const operation=this.transport!.request(captured).then(value=>{this.assertOpen();return value;},error=>{if(this.closed)throw new OpenCodeV2Error("OPENCODE_LOCAL_CONNECTION_CLOSED");throw error;}).finally(()=>{input.signal?.removeEventListener("abort",cancel);this.requests.delete(abort);});
  this.requests.set(abort,operation);return operation;
 }
 private closeAdmission():void {this.closed=true;this.port?.markDisconnected();this.startupAbort.abort();for(const abort of this.requests.keys())abort.abort();}
 private cleanChild():Promise<void>{
  return this.childCleanup??=(async()=>{
   const child=this.child;if(!child)return;
   child.stdin.end();await this.withDeadline(this.rootExited!,1000);
   try{await this.cancellation!.stop();this.childDrained=true;}catch{/* Keep unknown root/tool facts in the cleanup receipt. */}
   await this.withDeadline(this.rootExited!,500);child.stdin.destroy();this.#password=undefined;
   // Destroying inherited pipes is not evidence that their admitted callbacks drained.
   void this.streamsClosed!.then(()=>{child.stdout.destroy();child.stderr.destroy();});
  })();
 }
 private async withDeadline(work:Promise<unknown>,ms:number):Promise<boolean>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([work.then(()=>true,()=>false),new Promise<boolean>(resolve=>{timer=setTimeout(()=>resolve(false),ms);})]);}finally{if(timer)clearTimeout(timer);}}
 async disconnectLocal():Promise<LocalRuntimeDisconnect>{
  this.closeAdmission();
  this.cleanup??=(async()=>{
   const startupSettled=await this.withDeadline(this.opening.then(()=>undefined,()=>undefined),3500);
   const callbacks=this.port?.drainLocalCallbacks()??Promise.resolve();await this.cleanChild();
   const drained=await this.withDeadline(Promise.all([Promise.allSettled([...this.requests.values()]),callbacks,this.streamsClosed??Promise.resolve()]),500);
   const child=this.child,exited=child&&this.childDrained&&(child.exitCode!==null||child.signalCode!==null),probeClosed=this.probeState==="settled";
   return {version:1,connection:probeClosed&&(!child||this.childDrained)?"closed":"unknown",ownedRoot:!probeClosed?"unknown":exited?"exited":child?.pid?"unknown":"not-created",callbacks:startupSettled&&drained&&probeClosed?"drained":"unknown",backgroundTools:"unknown",nativeSessionDeleted:false,...(child?.pid?{ownedRootPid:child.pid}:{})};
  })();return structuredClone(await this.cleanup);
 }
}
