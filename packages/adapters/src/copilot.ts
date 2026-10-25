import {spawn,type ChildProcessWithoutNullStreams} from "node:child_process";
import {randomUUID} from "node:crypto";
import {realpathSync,statSync} from "node:fs";
import {isAbsolute} from "node:path";
import {PassThrough,Writable} from "node:stream";
import {isDeepStrictEqual} from "node:util";
import {StreamMessageReader,StreamMessageWriter,type Message} from "vscode-jsonrpc/node";
import {AdapterContractError,AdapterStartError} from "./contracts.js";
import type {LocalRuntimeDisconnect} from "./interaction-contracts.js";
import {OwnedProcessRoot} from "./owned-root-process.js";
import {childExecutionEnvironment} from "@dispatcher/shared";
export const copilotRpcProtocolVersion=3;
export const copilotRpcCliVersion="1.0.97";
export interface CopilotRpcScope {executable:string;workspacePath:string;copilotHome:string}
export interface CopilotRpcOptions {signal?:AbortSignal;timeoutMs?:number;beforeSend?:()=>void|Promise<void>}
export interface CopilotExecutionOptions extends CopilotRpcOptions {beforeMutation:()=>void}
export interface CopilotBootstrapInput {mode:"new"|"resume";model:string;nativeSessionId?:string;onSessionKnown:(id:string)=>void|Promise<void>}
export interface CopilotBootstrapResult {sessionId:string;modelId:string}
export interface CopilotTurnUpdate {kind:"activity"|"tool";sessionId:string;toolCallId?:string;status?:"pending"|"in_progress"|"completed"|"failed"}
export interface CopilotPromptOptions extends CopilotRpcOptions {onUpdate?:(update:CopilotTurnUpdate)=>void}
export interface CopilotPromptResult {messageId:string;nativeStopReason:"idle"|"aborted";executionEvidence:boolean;toolFailure:boolean;permissionDenied:boolean;pendingTools:number}
export type CopilotReadMethod="ping"|"status.get"|"auth.getStatus"|"session.list"|"session.getMetadata";
type CopilotMethod=CopilotReadMethod|"connect"|"session.create"|"session.resume"|"session.model.getCurrent"|"session.send"|"session.abort"|"session.permissions.handlePendingPermissionRequest";
interface BootstrapState {id:string;model:string;sideEffects:boolean;modelDrift:boolean;permissionObserved:boolean;permissionBeforeInput:boolean;deleted:boolean}
interface TurnEvent {type:string;messageId?:string;origin?:string;model?:string;proof?:boolean;tools?:string[];toolId?:string;success?:boolean;aborted?:boolean;mode?:string;requestId?:string;resolved?:boolean;owner?:string;ownerAgent?:string}
interface ActivePrompt {
 id:string;model:string;deadline:number;signal?:AbortSignal;onUpdate?:CopilotPromptOptions["onUpdate"];written:boolean;terminal:boolean;ack?:string;consumed:boolean;proof:boolean;toolFailure:boolean;permissionDenied:boolean;aborted:boolean;updates:number;cancelAdmitted:boolean;
 buffered:TurnEvent[];tools:Map<string,"pending"|"in_progress"|"completed"|"failed">;permissions:Set<string>;decisions:Set<Promise<void>>;finish:()=>void;reject:(error:AdapterContractError)=>void;
}
export interface CopilotRpcEvent {sequence:number;type:"session.event"|"session.lifecycle"}
interface Pending {
 method:CopilotMethod;params:Record<string,unknown>;sent:boolean;seen:boolean;discarded:boolean;
 deadline:number;resolve:(value:unknown)=>void;reject:(error:AdapterContractError)=>void;cleanup:()=>void;
 turn?:ActivePrompt;
}
interface Permit {message:Message;frame:Buffer;pending?:Pending;id?:number;signal?:AbortSignal;deadline:number;beforeSend?:()=>void|Promise<void>}
const failure=(code:string)=>new AdapterContractError(code,"Copilot RPC operation could not be confirmed");
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value);
const text=(value:unknown,max=512):value is string=>typeof value==="string"&&value.length>0&&value.length<=max&&Array.from(value).every(char=>char.charCodeAt(0)>=32&&char.charCodeAt(0)!==127);
const methods=new Set(["ping","status.get","auth.getStatus","session.list","session.getMetadata"]);
function physical(path:string,directory:boolean){
 try{
  if(!text(path,4096)||!isAbsolute(path))throw Error();const resolved=realpathSync(path),stat=statSync(resolved,{bigint:true});
  if(directory?!stat.isDirectory():!stat.isFile())throw Error();
  return {path:resolved,dev:stat.dev,ino:stat.ino,...(!directory?{size:stat.size,mtime:stat.mtimeNs}:{})};
 }catch{throw failure("COPILOT_RPC_SCOPE_CHANGED");}
}
function timeout(value:number|undefined){const ms=value??5000;if(!Number.isSafeInteger(ms)||ms<1||ms>30000)throw failure("COPILOT_RPC_REQUEST_INVALID");return ms;}
function frame(message:unknown){const body=Buffer.from(JSON.stringify(message));return Buffer.concat([Buffer.from("Content-Length: "+body.length+"\r\n\r\n","ascii"),body]);}
function metadata(value:unknown,workspacePath:string){
 if(!object(value)||!text(value.sessionId)||value.isRemote!==false||!object(value.context)||value.context.cwd!==workspacePath||!text(value.startTime,64)||!text(value.modifiedTime,64)||!Number.isFinite(Date.parse(value.startTime))||!Number.isFinite(Date.parse(value.modifiedTime)))throw failure("COPILOT_RPC_PROTOCOL_INVALID");
 return {sessionId:value.sessionId,startTime:value.startTime,modifiedTime:value.modifiedTime,isRemote:false as const,context:{cwd:workspacePath}};
}

/** Owned local RPC; execution is explicit and never grants entitlement or writer authority. */
export class CopilotRpcClient {
 private readonly pending=new Map<number,Pending>();
 private readonly listeners=new Set<(event:CopilotRpcEvent)=>void|Promise<void>>();
 private readonly events:CopilotRpcEvent[]=[];
 private readonly callbacks=new Set<Promise<unknown>>();
 private readonly nativeRequests=new Set<string>();
 private readonly disconnected=new AbortController();
 private readonly projected=new PassThrough();
 private readonly reader:StreamMessageReader;
 private readonly writer:StreamMessageWriter;
 private readonly sink:Writable;
 private readonly owner:OwnedProcessRoot;
 private readonly exited:Promise<void>;
 private closed=false;private rootExited=false;private notCreated=false;private pipeUnknown=false;
 private nextId=0;private sequence=0;private queuedBytes=0;private queuedWrites=0;private queuedIngress=0;
 private writes:Promise<void>=Promise.resolve();private shutdown?:Promise<LocalRuntimeDisconnect>;private permit:Permit|undefined;
 private bootstrapAttempted=false;private bootstrapState:BootstrapState|undefined;
 private qualified=false;private activePrompt:ActivePrompt|undefined;private readonly messageIds=new Set<string>();

 private constructor(private readonly child:ChildProcessWithoutNullStreams,private readonly scope:CopilotRpcScope,private readonly guardScope:()=>void,private readonly mutationGuard:(()=>void)|undefined){
  this.owner=new OwnedProcessRoot(child);
  this.exited=new Promise(resolve=>{
   child.once("exit",()=>{this.rootExited=true;resolve();this.fail("COPILOT_RPC_UNREACHABLE");});
   child.once("error",()=>{this.notCreated=child.pid===undefined;resolve();this.fail("COPILOT_RPC_UNREACHABLE");});
  });
  const pipeError=()=>{this.pipeUnknown=true;this.fail("COPILOT_RPC_CLEANUP_UNKNOWN");};
  child.stdout.on("error",pipeError);child.stderr.on("error",pipeError);child.stdin.on("error",pipeError);
  let stderrBytes=0;child.stderr.on("data",(chunk:Buffer)=>{stderrBytes+=chunk.length;if(stderrBytes>1048576)this.fail("COPILOT_RPC_PROTOCOL_INVALID");});
  let incoming=Buffer.alloc(0);
  child.stdout.on("data",(chunk:Buffer)=>{
   if(this.closed)return;
   try{
    if(incoming.length+chunk.length>1064960)throw failure("COPILOT_RPC_PROTOCOL_INVALID");
    incoming=Buffer.concat([incoming,chunk]);
    for(;;){
     const at=incoming.indexOf("\r\n\r\n");
     if(at<0){if(incoming.length>16384)throw failure("COPILOT_RPC_PROTOCOL_INVALID");return;}
     if(at>16384)throw failure("COPILOT_RPC_PROTOCOL_INVALID");
     const header=incoming.subarray(0,at);
     if(header.some(byte=>byte>127))throw failure("COPILOT_RPC_PROTOCOL_INVALID");
     const lines=header.toString("ascii").split("\r\n"),lengths=lines.filter(line=>/^Content-Length:/i.test(line));
     if(lengths.length!==1||lines.some(line=>!/^[-a-z0-9]+: [\x20-\x7e]+$/i.test(line))||!/^Content-Length: [1-9][0-9]*$/i.test(lengths[0]!))throw failure("COPILOT_RPC_PROTOCOL_INVALID");
     const size=Number(lengths[0]!.slice(lengths[0]!.indexOf(":")+2));if(!Number.isSafeInteger(size)||size>1048576)throw failure("COPILOT_RPC_PROTOCOL_INVALID");
     if(incoming.length<at+4+size)return;
     const body=incoming.subarray(at+4,at+4+size);incoming=incoming.subarray(at+4+size);
     const packet:unknown=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(body)),safe=this.project(packet);
     if(safe!==undefined){
      if(++this.queuedIngress>64)throw failure("COPILOT_RPC_PROTOCOL_INVALID");
      this.projected.write(frame(safe));
     }
    }
   }catch(error){this.fail(error instanceof AdapterContractError?error.code:"COPILOT_RPC_PROTOCOL_INVALID");}
  });
  child.stdout.once("end",()=>this.fail(incoming.length?"COPILOT_RPC_PROTOCOL_INVALID":"COPILOT_RPC_UNREACHABLE"));
  this.reader=new StreamMessageReader(this.projected);this.reader.partialMessageTimeout=0;
  this.reader.onError(()=>this.fail("COPILOT_RPC_PROTOCOL_INVALID"));
  this.reader.listen(message=>{this.queuedIngress--;if(this.closed)return;this.receive(message);});
  let outgoing=Buffer.alloc(0);
  this.sink=new Writable({write:(chunk:Buffer,_encoding,done)=>{
   const permit=this.permit;
   if(!permit){done();this.fail("COPILOT_RPC_PROTOCOL_INVALID");return;}
   outgoing=Buffer.concat([outgoing,chunk]);
   if(outgoing.length>permit.frame.length||!permit.frame.subarray(0,outgoing.length).equals(outgoing)){done();this.fail("COPILOT_RPC_PROTOCOL_INVALID");return;}
   if(outgoing.length<permit.frame.length){done();return;}
   const complete=outgoing;outgoing=Buffer.alloc(0);
   // Codec encoding is async: authority, original signal, deadline and scope belong at this final sink.
   void this.sendFrame(permit,complete).then(()=>done(),()=>done());
  }});
  this.sink.on("error",()=>this.fail("COPILOT_RPC_UNREACHABLE"));
  this.writer=new StreamMessageWriter(this.sink);this.writer.onError(()=>this.fail("COPILOT_RPC_UNREACHABLE"));
 }
 static async open(input:CopilotRpcScope,options:CopilotRpcOptions={}):Promise<CopilotRpcClient>{
  return this.openOwned(input,options);
 }
 static async openExecution(input:CopilotRpcScope,options:CopilotExecutionOptions):Promise<CopilotRpcClient>{
  const beforeMutation=options?.beforeMutation;if(typeof beforeMutation!=="function")throw failure("COPILOT_RPC_AUTHORITY_CHANGED");
  return this.openOwned(input,options,beforeMutation);
 }
 private static async openOwned(input:CopilotRpcScope,options:CopilotRpcOptions={},beforeMutation?:()=>void):Promise<CopilotRpcClient>{
  const scope=structuredClone(input),signal=options.signal,beforeSend=options.beforeSend,deadline=performance.now()+timeout(options.timeoutMs);
  if([scope.executable,scope.workspacePath,scope.copilotHome].some(path=>!text(path,4096)||!isAbsolute(path)))throw failure("COPILOT_RPC_SCOPE_INVALID");
  if(signal?.aborted)throw failure("COPILOT_RPC_CANCELLED");
  const capture=()=>[physical(scope.executable,false),physical(scope.workspacePath,true),physical(scope.copilotHome,true)],paths=capture();
  const guard=()=>{if(!isDeepStrictEqual(capture(),paths))throw failure("COPILOT_RPC_SCOPE_CHANGED");};
  const canonical={executable:paths[0]!.path,workspacePath:paths[1]!.path,copilotHome:paths[2]!.path};
  const child=spawn(canonical.executable,["--headless","--no-auto-update","--stdio"],{cwd:canonical.workspacePath,env:childExecutionEnvironment(process.env,{PWD:canonical.workspacePath,COPILOT_HOME:canonical.copilotHome}),shell:false,detached:false,stdio:["pipe","pipe","pipe"]});
  const client=new CopilotRpcClient(child,canonical,guard,beforeMutation);
  const remaining=()=>{const ms=Math.floor(deadline-performance.now());if(ms<1)throw failure("COPILOT_RPC_TIMEOUT");return ms;};
  try{
   const connected=await client.read("connect",{supportedTaskKinds:[]},{...(signal?{signal}:{}),...(beforeSend?{beforeSend}:{}),timeoutMs:remaining()}) as {protocolVersion:number};
   const status=await client.read("status.get",{},{...(signal?{signal}:{}),...(beforeSend?{beforeSend}:{}),timeoutMs:remaining()}) as {protocolVersion:number;version:string};
   if(connected.protocolVersion!==copilotRpcProtocolVersion||status.protocolVersion!==copilotRpcProtocolVersion||status.version!==copilotRpcCliVersion)throw failure("COPILOT_RPC_VERSION_UNQUALIFIED");
   client.assertCurrentScope();if(signal?.aborted)throw failure("COPILOT_RPC_CANCELLED");if(performance.now()>=deadline)throw failure("COPILOT_RPC_TIMEOUT");
   return client;
  }catch(error){
   const receipt=await client.close();if(receipt.connection==="unknown"||receipt.ownedRoot==="unknown"||receipt.callbacks==="unknown")throw failure("COPILOT_RPC_CLEANUP_UNKNOWN");
   throw error;
  }
 }
 get connectionScope():CopilotRpcScope{return structuredClone(this.scope);}
 get disconnectSignal():AbortSignal{return this.disconnected.signal;}
 assertCurrentScope():void {if(this.closed)throw failure("COPILOT_RPC_UNREACHABLE");this.guardScope();}
 request(method:CopilotReadMethod,params:Record<string,unknown>={},options:CopilotRpcOptions={}):Promise<unknown>{
  if(!methods.has(method)||!object(params)||Object.keys(params).some(key=>method!=="session.getMetadata"||key!=="sessionId"))return Promise.reject(failure("COPILOT_RPC_REQUEST_INVALID"));
  const sessionId=method==="session.getMetadata"?params.sessionId:undefined;
  if(method==="session.getMetadata"&&!text(sessionId))return Promise.reject(failure("COPILOT_RPC_REQUEST_INVALID"));
  const payload=method==="session.list"?{filter:{cwd:this.scope.workspacePath}}:method==="session.getMetadata"?{sessionId}:{};
  return this.read(method,payload,options);
 }
 private read(method:CopilotMethod,params:Record<string,unknown>,options:CopilotRpcOptions):Promise<unknown>{
  const signal=options.signal,beforeSend=options.beforeSend;
  if(this.closed)return Promise.reject(failure("COPILOT_RPC_UNREACHABLE"));if(signal?.aborted)return Promise.reject(failure("COPILOT_RPC_CANCELLED"));
  let ms:number;try{ms=timeout(options.timeoutMs);}catch(error){return Promise.reject(error);}
  if(this.pending.size>=64||this.queuedWrites>=64)return Promise.reject(failure("COPILOT_RPC_REQUEST_LIMIT"));
  const id=++this.nextId,message={jsonrpc:"2.0",id,method,params},encoded=frame(message),deadline=performance.now()+ms;
  if(encoded.length>262144)return Promise.reject(failure("COPILOT_RPC_REQUEST_TOO_LARGE"));
  if(this.queuedBytes+this.child.stdin.writableLength+encoded.length>1048576)return Promise.reject(failure("COPILOT_RPC_REQUEST_LIMIT"));
  let pending!:Pending;
  const result=new Promise((resolve,reject)=>{
   const cancel=()=>this.reject(id,"COPILOT_RPC_CANCELLED"),timer=setTimeout(()=>this.reject(id,"COPILOT_RPC_TIMEOUT"),ms);
   const turn=["session.send","session.abort","session.permissions.handlePendingPermissionRequest"].includes(method)?this.activePrompt:undefined;
   pending={method,params,sent:false,seen:false,discarded:false,deadline,resolve,reject,cleanup:()=>{clearTimeout(timer);signal?.removeEventListener("abort",cancel);},...(turn?{turn}:{})};
   this.pending.set(id,pending);signal?.addEventListener("abort",cancel,{once:true});if(signal?.aborted)cancel();
  });
  this.enqueue({message,frame:encoded,pending,id,...(signal?{signal}:{}),deadline,...(beforeSend?{beforeSend}:{})});return result;
 }
 private enqueue(permit:Permit):void{
  this.queuedBytes+=permit.frame.length;this.queuedWrites++;
  this.writes=this.writes.then(async()=>{
   if(this.closed||permit.pending?.discarded||permit.id!==undefined&&!this.pending.has(permit.id))return;
   this.permit=permit;try{await this.writer.write(permit.message);}finally{this.permit=undefined;}
  }).catch(()=>this.fail("COPILOT_RPC_UNREACHABLE")).finally(()=>{this.queuedBytes-=permit.frame.length;this.queuedWrites--;});
 }
 /** Reserve ownership before user code can synchronously reenter local shutdown. */
 private invoke(callback:()=>unknown):Promise<unknown>|undefined{
  if(this.callbacks.size>=64)throw failure("COPILOT_RPC_REQUEST_LIMIT");
  let settle!:()=>void;const owned=new Promise<void>(resolve=>{settle=resolve;});this.callbacks.add(owned);
  const release=()=>{this.callbacks.delete(owned);settle();};
  try{
   const value=callback();if(value===undefined){release();return undefined;}
   // Normalize a thenable once; public cancellation does not release its raw work.
   const raw=Promise.resolve(value);void raw.then(release,release);return raw;
  }catch(error){release();throw error;}
 }
 private assertMutation():void{
  if(!this.mutationGuard)throw failure("COPILOT_RPC_READ_ONLY");
  try{const checked=this.invoke(()=>this.mutationGuard!());if(checked!==undefined){void checked.catch(()=>{});throw Error();}}
  catch(error){if(error instanceof AdapterContractError&&error.code==="COPILOT_RPC_REQUEST_LIMIT")throw error;throw failure("COPILOT_RPC_AUTHORITY_CHANGED");}
 }
 private async sendFrame(permit:Permit,complete:Buffer):Promise<void>{
  try{
   const admitted=()=>{
    this.assertCurrentScope();if(permit.signal?.aborted)throw failure("COPILOT_RPC_CANCELLED");
    if(performance.now()>=permit.deadline)throw failure("COPILOT_RPC_TIMEOUT");
    return !(permit.pending?.discarded||permit.id!==undefined&&!this.pending.has(permit.id));
   };
   if(!admitted())return;
   if(this.child.stdin.writableNeedDrain)await new Promise<void>((resolve,reject)=>{
    const finish=(error?:AdapterContractError)=>{this.child.stdin.off("drain",ready);this.disconnected.signal.removeEventListener("abort",cancel);if(error)reject(error);else resolve();};
    const ready=()=>finish(),cancel=()=>finish(failure("COPILOT_RPC_UNREACHABLE"));this.child.stdin.once("drain",ready);this.disconnected.signal.addEventListener("abort",cancel,{once:true});if(this.closed)cancel();
   });
   if(!admitted())return;
   if(permit.beforeSend){
    if(this.callbacks.size>=64)throw failure("COPILOT_RPC_REQUEST_LIMIT");
    try{const guarded=this.invoke(()=>permit.beforeSend!());if(guarded!==undefined)await guarded;}catch{throw failure("COPILOT_RPC_AUTHORITY_CHANGED");}
   }
   if(!admitted())return;
   if(permit.pending?.method==="session.create"||permit.pending?.method==="session.resume"){
    this.assertMutation();if(!admitted())return;
    if(!this.bootstrapState)throw failure("COPILOT_RPC_AUTHORITY_CHANGED");this.bootstrapState.sideEffects=true;
   }
   if(permit.pending&&["session.send","session.abort","session.permissions.handlePendingPermissionRequest"].includes(permit.pending.method)){
    const active=permit.pending.turn;if(!active||permit.pending.params.sessionId!==active.id)throw failure("COPILOT_RPC_IDENTITY_CHANGED");
    this.assertPrompt(active);this.assertMutation();this.assertPrompt(active);if(!admitted())return;
    if(permit.pending.method==="session.send"){if(active.written||active.terminal)throw failure("COPILOT_RPC_SESSION_BUSY");active.written=true;}
    if(permit.pending.method==="session.abort"&&(active.terminal||!active.written))throw failure("COPILOT_RPC_SESSION_BUSY");
   }
   if(permit.pending)permit.pending.sent=true;
   this.child.stdin.write(complete);
  }catch(error){
   if(permit.id!==undefined)this.reject(permit.id,error instanceof AdapterContractError?error.code:"COPILOT_RPC_UNREACHABLE");
   else this.fail("COPILOT_RPC_UNREACHABLE");
  }
 }
 private reject(id:number,code:string):void{
  const pending=this.pending.get(id);if(!pending||pending.discarded)return;pending.discarded=true;pending.cleanup();pending.reject(failure(code));
  // A sent response remains correlated until consumed, rather than becoming an unknown late ID.
  if(!pending.sent)this.pending.delete(id);
 }
 private project(packet:unknown):Record<string,unknown>|undefined{
  if(!object(packet)||packet.jsonrpc!=="2.0")throw failure("COPILOT_RPC_PROTOCOL_INVALID");
  if("method" in packet){
   if(!text(packet.method,128)||"result" in packet||"error" in packet)throw failure("COPILOT_RPC_PROTOCOL_INVALID");
   if("id" in packet){
    if(!(typeof packet.id==="string"&&text(packet.id,128)||Number.isSafeInteger(packet.id)&&Number(packet.id)>=0)||this.queuedWrites>=64||this.nativeRequests.size>=64)throw failure("COPILOT_RPC_PROTOCOL_INVALID");
    const key=JSON.stringify(packet.id);if(this.nativeRequests.has(key))throw failure("COPILOT_RPC_PROTOCOL_INVALID");this.nativeRequests.add(key);
    const message={jsonrpc:"2.0",id:packet.id,error:{code:-32601,message:"COPILOT_RPC_CLIENT_METHOD_UNSUPPORTED"}},encoded=frame(message);
    if(this.queuedBytes+encoded.length>1048576)throw failure("COPILOT_RPC_PROTOCOL_INVALID");
    this.enqueue({message,frame:encoded,deadline:performance.now()+5000});return undefined;
   }
   if(!["session.event","session.lifecycle"].includes(packet.method))throw failure("COPILOT_RPC_PROTOCOL_INVALID");
   const state=this.bootstrapState,params=packet.params;
   // Preserve identity loss before the async codec can settle an earlier response in this batch.
   if(state&&packet.method==="session.lifecycle"&&object(params)&&params.sessionId===state.id&&params.type==="session.deleted")state.deleted=true;
   if(state&&packet.method==="session.event"&&object(params)&&params.sessionId===state.id&&object(params.event)){
    const event=params.event,data=event.data;
    if(event.type==="session.model_change"){
     if(!object(data)||!text(data.newModel)||data.providerId!==undefined&&!text(data.providerId)||data.previousProviderId!==undefined&&!text(data.previousProviderId))throw failure("COPILOT_RPC_PROTOCOL_INVALID");
     if(data.newModel!==state.model||data.previousProviderId!==undefined&&data.providerId!==data.previousProviderId)state.modelDrift=true;
    }
    const active=this.activePrompt;
    if(event.type==="permission.requested"){
     state.permissionObserved=true;
     if(this.qualified&&!active?.written){
      if(event.agentId!==undefined&&!text(event.agentId))throw failure("COPILOT_RPC_PROTOCOL_INVALID");
      if(event.agentId===undefined){
       const permission=this.projectTurnEvent(event)!;
       if(!permission.resolved){
        if(permission.owner!==state.id||permission.ownerAgent!==undefined)throw failure("COPILOT_RPC_IDENTITY_CHANGED");
        // No pre-input decision path is qualified; later idle/hook events cannot clear this fact.
        state.permissionBeforeInput=true;
       }
      }
     }
    }
    if(active&&active.written){
     this.assertPrompt(active);
     if(event.agentId!==undefined&&!text(event.agentId))throw failure("COPILOT_RPC_PROTOCOL_INVALID");
     if(event.agentId===undefined){const projected=this.projectTurnEvent(event);if(projected){if(++active.updates>1024)throw failure("COPILOT_RPC_REQUEST_LIMIT");if(active.ack)this.observeTurn(active,projected);else{if(active.buffered.length>=64)throw failure("COPILOT_RPC_REQUEST_LIMIT");active.buffered.push(projected);}}}
    }
   }
   return {jsonrpc:"2.0",method:packet.method};
  }
  if(!Number.isSafeInteger(packet.id)||Number(packet.id)<1||("result" in packet)===("error" in packet))throw failure("COPILOT_RPC_PROTOCOL_INVALID");
  const pending=this.pending.get(Number(packet.id));if(!pending||!pending.sent||pending.seen)throw failure("COPILOT_RPC_PROTOCOL_INVALID");pending.seen=true;
  if("error" in packet){if(!object(packet.error)||!Number.isSafeInteger(packet.error.code))throw failure("COPILOT_RPC_PROTOCOL_INVALID");return {jsonrpc:"2.0",id:packet.id,error:{code:packet.error.code,message:"COPILOT_RPC_COMMAND_REJECTED"}};}
  const value=packet.result;if(!object(value))throw failure("COPILOT_RPC_PROTOCOL_INVALID");let result:unknown;
  if(pending.method==="connect"||pending.method==="status.get"||pending.method==="ping"){
   if(!Number.isSafeInteger(value.protocolVersion)||Number(value.protocolVersion)<1)throw failure("COPILOT_RPC_PROTOCOL_INVALID");
   if(pending.method==="status.get"){if(!text(value.version,128))throw failure("COPILOT_RPC_PROTOCOL_INVALID");result={protocolVersion:value.protocolVersion,version:value.version};}
   else if(pending.method==="ping"){if(!text(value.timestamp,64)||!Number.isFinite(Date.parse(value.timestamp)))throw failure("COPILOT_RPC_PROTOCOL_INVALID");result={protocolVersion:value.protocolVersion,timestamp:value.timestamp};}
   else result={protocolVersion:value.protocolVersion};
  }else if(pending.method==="auth.getStatus"){
   if(typeof value.isAuthenticated!=="boolean")throw failure("COPILOT_RPC_PROTOCOL_INVALID");result={isAuthenticated:value.isAuthenticated};
  }else if(pending.method==="session.list"){
   if(!Array.isArray(value.sessions)||value.sessions.length>1000)throw failure("COPILOT_RPC_PROTOCOL_INVALID");
   const sessions=value.sessions.map(item=>metadata(item,this.scope.workspacePath));if(new Set(sessions.map(item=>item.sessionId)).size!==sessions.length)throw failure("COPILOT_RPC_PROTOCOL_INVALID");result={sessions};
  }else if(pending.method==="session.getMetadata"){
   if(value.session==null)result={};else{const session=metadata(value.session,this.scope.workspacePath);if(session.sessionId!==pending.params.sessionId)throw failure("COPILOT_RPC_PROTOCOL_INVALID");result={session};}
  }else if(pending.method==="session.create"){
   if(!text(value.sessionId))throw failure("COPILOT_RPC_PROTOCOL_INVALID");result={sessionId:value.sessionId};
  }else if(pending.method==="session.resume"){
   if(value.sessionId!==undefined&&!text(value.sessionId))throw failure("COPILOT_RPC_PROTOCOL_INVALID");
   result={...(typeof value.sessionId==="string"?{sessionId:value.sessionId}:{}),...(value.transcriptRecovery!=null?{recovered:true}:{})};
  }else if(pending.method==="session.send"){
   const active=this.activePrompt;if(!active||!active.written||pending.params.sessionId!==active.id||!text(value.messageId)||this.messageIds.has(value.messageId))throw failure("COPILOT_RPC_PROTOCOL_INVALID");
   this.assertPrompt(active);active.ack=value.messageId;this.messageIds.add(value.messageId);
   for(const event of active.buffered)this.observeTurn(active,event);active.buffered.length=0;result={messageId:value.messageId};
  }else if(pending.method==="session.abort")result={};
  else if(pending.method==="session.permissions.handlePendingPermissionRequest"){
   if(typeof value.success!=="boolean")throw failure("COPILOT_RPC_PROTOCOL_INVALID");result={success:value.success};
  }else{
   if(value.modelId!==undefined&&!text(value.modelId))throw failure("COPILOT_RPC_PROTOCOL_INVALID");
   result=typeof value.modelId==="string"?{modelId:value.modelId}:{};
  }
  return {jsonrpc:"2.0",id:packet.id,result};
 }
 private receive(message:Message):void{
  const packet=message as Record<string,unknown>;
  if("id" in packet){
   const id=Number(packet.id),pending=this.pending.get(id);if(!pending)return;
   this.pending.delete(id);pending.cleanup();if(pending.discarded)return;
   try{this.assertCurrentScope();if(performance.now()>=pending.deadline)throw failure("COPILOT_RPC_TIMEOUT");if("error" in packet)throw failure("COPILOT_RPC_COMMAND_REJECTED");pending.resolve(packet.result);}
   catch(error){pending.reject(error instanceof AdapterContractError?error:failure("COPILOT_RPC_PROTOCOL_INVALID"));}return;
  }
  const event:CopilotRpcEvent={sequence:++this.sequence,type:packet.method as CopilotRpcEvent["type"]};this.events.push(event);if(this.events.length>100)this.events.shift();
  try{for(const listener of [...this.listeners]){
   this.assertCurrentScope();const value=this.invoke(()=>listener({...event}));
   if(value!==undefined){void value.catch(()=>this.fail("COPILOT_RPC_EVENT_HANDLER_FAILED"));}
  }}catch{this.fail("COPILOT_RPC_EVENT_HANDLER_FAILED");}
 }
 onEvent(listener:(event:CopilotRpcEvent)=>void|Promise<void>):()=>void{
  this.assertCurrentScope();if(this.listeners.size>=64)throw failure("COPILOT_RPC_REQUEST_LIMIT");this.listeners.add(listener);return()=>this.listeners.delete(listener);
 }
 recentEvents():CopilotRpcEvent[]{return this.events.map(value=>({...value}));}
 async bootstrap(input:CopilotBootstrapInput,options:CopilotRpcOptions={}):Promise<CopilotBootstrapResult>{
  if(!this.mutationGuard)throw failure("COPILOT_RPC_READ_ONLY");
  if(this.bootstrapAttempted)throw failure("COPILOT_RPC_BOOTSTRAP_NOT_RETRYABLE");
  const mode=input.mode,model=input.model,requestedId=input.nativeSessionId,onSessionKnown=input.onSessionKnown,signal=options.signal,beforeSend=options.beforeSend;
  let duration:number;
  try{
   duration=timeout(options.timeoutMs);
   if(!["new","resume"].includes(mode)||!text(model)||typeof onSessionKnown!=="function"||mode==="resume"&&!text(requestedId)||mode==="new"&&requestedId!==undefined&&(!text(requestedId)||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(requestedId)))throw failure("COPILOT_RPC_REQUEST_INVALID");
  }catch{throw new AdapterStartError("not-created","COPILOT_RPC_REQUEST_INVALID","Copilot bootstrap input is invalid");}
  const state:BootstrapState={id:requestedId??randomUUID(),model,sideEffects:false,modelDrift:false,permissionObserved:false,permissionBeforeInput:false,deleted:false},deadline=performance.now()+duration;
  this.bootstrapAttempted=true;this.bootstrapState=state;
  const check=()=>{
   this.assertCurrentScope();if(signal?.aborted)throw failure("COPILOT_RPC_CANCELLED");if(performance.now()>=deadline)throw failure("COPILOT_RPC_TIMEOUT");
   if(state.deleted)throw failure("COPILOT_RPC_SESSION_NOT_FOUND");
   if(state.modelDrift)throw failure("COPILOT_RPC_MODEL_DRIFT");if(state.permissionObserved)throw failure("COPILOT_RPC_PERMISSION_UNCONFIRMED");
  };
  const scopedOptions=():CopilotRpcOptions=>{
   check();const remaining=Math.floor(deadline-performance.now());if(remaining<1)throw failure("COPILOT_RPC_TIMEOUT");
   return {timeoutMs:remaining,...(signal?{signal}:{}),...(beforeSend?{beforeSend}:{})};
  };
  const wait=<T>(work:Promise<T>):Promise<T>=>new Promise((resolve,reject)=>{
   const cancel=()=>finish(failure("COPILOT_RPC_CANCELLED")),gone=()=>finish(failure("COPILOT_RPC_UNREACHABLE")),timer=setTimeout(()=>finish(failure("COPILOT_RPC_TIMEOUT")),Math.max(1,deadline-performance.now()));
   const finish=(error?:AdapterContractError,value?:T)=>{clearTimeout(timer);signal?.removeEventListener("abort",cancel);this.disconnected.signal.removeEventListener("abort",gone);if(error)reject(error);else resolve(value as T);};
   signal?.addEventListener("abort",cancel,{once:true});this.disconnected.signal.addEventListener("abort",gone,{once:true});
   void work.then(value=>finish(undefined,value),error=>finish(error instanceof AdapterContractError?error:failure("COPILOT_RPC_BINDING_FAILED")));
   if(signal?.aborted)cancel();else if(this.closed)gone();
  });
  try{
   check();
   if(mode==="resume"){
    const existing=await this.read("session.getMetadata",{sessionId:state.id},scopedOptions()) as {session?:unknown};
    if(!existing.session)throw failure("COPILOT_RPC_SESSION_NOT_FOUND");check();
   }
   const result=await this.read(mode==="new"?"session.create":"session.resume",{
    sessionId:state.id,remoteSession:"off",enableSessionStore:true,
    ...(mode==="new"?{model,workingDirectory:this.scope.workspacePath}:{allowTranscriptRecovery:false,continuePendingWork:false}),
   },scopedOptions()) as {sessionId?:string;recovered?:boolean};
   if(mode==="new"&&result.sessionId!==state.id||mode==="resume"&&result.sessionId!==undefined&&result.sessionId!==state.id)throw failure("COPILOT_RPC_IDENTITY_CHANGED");
   if(result.recovered)throw failure("COPILOT_RPC_RECOVERY_UNEXPECTED");
   // Keep the exact identity before later qualification can fail; the original consumer owns durable binding.
   let known:Promise<unknown>|undefined;try{known=this.invoke(()=>onSessionKnown(state.id));}catch{throw failure("COPILOT_RPC_BINDING_FAILED");}
   if(known!==undefined)await wait(known);check();
   const observed=await this.read("session.getMetadata",{sessionId:state.id},scopedOptions()) as {session?:unknown};
   if(!observed.session)throw failure("COPILOT_RPC_SESSION_NOT_FOUND");check();
   const current=await this.read("session.model.getCurrent",{sessionId:state.id},scopedOptions()) as {modelId?:string};check();
   if(!current.modelId)throw failure("COPILOT_RPC_MODEL_UNQUALIFIED");if(current.modelId!==model)throw failure("COPILOT_RPC_MODEL_DRIFT");
   this.assertMutation();check();this.qualified=true;return {sessionId:state.id,modelId:current.modelId};
  }catch(error){
   throw new AdapterStartError(state.sideEffects?"unknown":"not-created",error instanceof AdapterContractError?error.code:"COPILOT_RPC_PROTOCOL_INVALID","Copilot bootstrap could not be confirmed");
  }
 }
 private assertPrompt(active:ActivePrompt):void{
  this.assertCurrentScope();const state=this.bootstrapState;
  if(this.activePrompt!==active||!this.qualified||state?.id!==active.id)throw failure("COPILOT_RPC_IDENTITY_CHANGED");
  if(state.deleted)throw failure("COPILOT_RPC_SESSION_NOT_FOUND");if(state.modelDrift||state.model!==active.model)throw failure("COPILOT_RPC_MODEL_DRIFT");
  if(state.permissionBeforeInput)throw failure("COPILOT_RPC_PERMISSION_UNCONFIRMED");
  if(active.signal?.aborted)throw failure("COPILOT_RPC_CANCELLED");if(performance.now()>=active.deadline)throw failure("COPILOT_RPC_TIMEOUT");
 }
 private projectTurnEvent(event:Record<string,unknown>):TurnEvent|undefined{
  const type=event.type,data=event.data;if(typeof type!=="string")throw failure("COPILOT_RPC_PROTOCOL_INVALID");
  if(!["user.message","assistant.message","tool.execution_start","tool.execution_complete","session.idle","session.error","permission.requested"].includes(type))return undefined;
  if(!object(data))throw failure("COPILOT_RPC_PROTOCOL_INVALID");
  const optional=(value:unknown)=>value===undefined||text(value);
  if(type==="user.message"){
   if(!optional(data.messageId)||typeof data.content!=="string"||Buffer.byteLength(data.content)>196608)throw failure("COPILOT_RPC_PROTOCOL_INVALID");
   return {type,...(typeof data.messageId==="string"?{messageId:data.messageId}:{})};
  }
  if(type==="assistant.message"){
   if(!text(data.messageId)||!optional(data.originatingMessageId)||!optional(data.model)||typeof data.content!=="string"||Buffer.byteLength(data.content)>16384||data.toolRequests!==undefined&&(!Array.isArray(data.toolRequests)||data.toolRequests.length>64))throw failure("COPILOT_RPC_PROTOCOL_INVALID");
   const tools:string[]=[];for(const item of data.toolRequests as unknown[]??[]){if(!object(item)||!text(item.toolCallId)||tools.includes(item.toolCallId))throw failure("COPILOT_RPC_PROTOCOL_INVALID");tools.push(item.toolCallId);}
   return {type,messageId:data.messageId,...(typeof data.originatingMessageId==="string"?{origin:data.originatingMessageId}:{}),...(typeof data.model==="string"?{model:data.model}:{}),proof:data.content.length>0,tools};
  }
  if(type==="tool.execution_start"||type==="tool.execution_complete"){
   if(!text(data.toolCallId)||!optional(data.model)||type==="tool.execution_complete"&&typeof data.success!=="boolean")throw failure("COPILOT_RPC_PROTOCOL_INVALID");
   return {type,toolId:data.toolCallId,...(typeof data.model==="string"?{model:data.model}:{}),...(type==="tool.execution_complete"?{success:data.success as boolean}:{})};
  }
  if(type==="session.idle"){
   if(data.aborted!==undefined&&typeof data.aborted!=="boolean"||data.mode!==undefined&&!["interactive","plan","autopilot"].includes(data.mode as string))throw failure("COPILOT_RPC_PROTOCOL_INVALID");
   return {type,...(typeof data.aborted==="boolean"?{aborted:data.aborted}:{}),...(typeof data.mode==="string"?{mode:data.mode}:{})};
  }
  if(type==="permission.requested"){
   if(!text(data.requestId)||!object(data.permissionRequest)||data.resolvedByHook!==undefined&&typeof data.resolvedByHook!=="boolean"||!optional(data.ownerSessionId)||!optional(data.ownerAgentId))throw failure("COPILOT_RPC_PROTOCOL_INVALID");
   return {type,requestId:data.requestId,...(typeof data.resolvedByHook==="boolean"?{resolved:data.resolvedByHook}:{}),...(typeof data.ownerSessionId==="string"?{owner:data.ownerSessionId}:{}),...(typeof data.ownerAgentId==="string"?{ownerAgent:data.ownerAgentId}:{})};
  }
  return {type};
 }
 private updateTurn(active:ActivePrompt,update:CopilotTurnUpdate):void{
  this.assertPrompt(active);this.assertMutation();this.assertPrompt(active);
  try{const value=this.invoke(()=>active.onUpdate?.({...update}));if(value!==undefined){void value.catch(()=>{});throw Error();}}
  catch{throw failure("COPILOT_RPC_CALLBACK_FAILED");}
 }
 private observeTurn(active:ActivePrompt,event:TurnEvent):void{
  this.assertPrompt(active);
  if(event.type==="session.error")throw failure("COPILOT_RPC_COMMAND_REJECTED");
  if(event.type==="permission.requested"){
   if(event.resolved)return;
   if(event.owner!==active.id||event.ownerAgent!==undefined)throw failure("COPILOT_RPC_IDENTITY_CHANGED");
   if(active.permissions.has(event.requestId!)||active.permissions.size>=64)throw failure("COPILOT_RPC_PROTOCOL_INVALID");
   active.permissions.add(event.requestId!);active.permissionDenied=true;
   const work=this.invoke(()=>this.read("session.permissions.handlePendingPermissionRequest",{sessionId:active.id,requestId:event.requestId!,result:{kind:"user-not-available"}},{timeoutMs:Math.max(1,Math.floor(active.deadline-performance.now())),...(active.signal?{signal:active.signal}:{})}).then(value=>{if(!(value as {success:boolean}).success)throw failure("COPILOT_RPC_PERMISSION_UNCONFIRMED");}))!;
   const decision=work.then(()=>{});active.decisions.add(decision);void decision.catch(error=>this.fail(error instanceof AdapterContractError?error.code:"COPILOT_RPC_PERMISSION_UNCONFIRMED"));return;
  }
  if(event.type==="user.message"){if(event.messageId===active.ack)active.consumed=true;return;}
  if(event.type==="assistant.message"){
   if(event.origin!==active.ack)return;if(active.terminal)throw failure("COPILOT_RPC_PROTOCOL_INVALID");active.consumed=true;
   if(event.model!==undefined&&event.model!==active.model)throw failure("COPILOT_RPC_MODEL_DRIFT");
   if(event.proof){active.proof=true;this.updateTurn(active,{kind:"activity",sessionId:active.id});}
   for(const tool of event.tools??[]){if(active.tools.has(tool)||active.tools.size>=64)throw failure("COPILOT_RPC_PROTOCOL_INVALID");active.tools.set(tool,"pending");this.updateTurn(active,{kind:"tool",sessionId:active.id,toolCallId:tool,status:"pending"});}return;
  }
  if(!active.consumed)return;
  if(event.type==="session.idle"){
   if(event.mode==="autopilot")return;if(active.terminal)throw failure("COPILOT_RPC_PROTOCOL_INVALID");active.terminal=true;active.aborted=event.aborted===true;active.finish();return;
  }
  if(active.terminal)throw failure("COPILOT_RPC_PROTOCOL_INVALID");
  if(event.model!==undefined&&event.model!==active.model)throw failure("COPILOT_RPC_MODEL_DRIFT");
  const tool=event.toolId!,previous=active.tools.get(tool);
  if(previous==="completed"||previous==="failed"||event.type==="tool.execution_complete"&&!previous||!previous&&active.tools.size>=64)throw failure("COPILOT_RPC_PROTOCOL_INVALID");
  const status=event.type==="tool.execution_start"?"in_progress":event.success?"completed":"failed";
  active.tools.set(tool,status);active.toolFailure ||= status==="failed";active.proof ||= status==="completed";this.updateTurn(active,{kind:"tool",sessionId:active.id,toolCallId:tool,status});
 }
 async prompt(input:{sessionId:string;message:string},options:CopilotPromptOptions={}):Promise<CopilotPromptResult>{
  if(!this.mutationGuard)throw failure("COPILOT_RPC_READ_ONLY");if(!this.qualified||!this.bootstrapState)throw failure("COPILOT_RPC_SESSION_UNQUALIFIED");
  if(this.activePrompt)throw failure("COPILOT_RPC_SESSION_BUSY");if(this.messageIds.size>=1024)throw failure("COPILOT_RPC_REQUEST_LIMIT");
  const id=input.sessionId,message=input.message,signal=options.signal,beforeSend=options.beforeSend,onUpdate=options.onUpdate,duration=timeout(options.timeoutMs);
  if(id!==this.bootstrapState.id)throw failure("COPILOT_RPC_IDENTITY_CHANGED");
  if(typeof message!=="string"||!message.trim()||Buffer.byteLength(message)>196608||onUpdate!==undefined&&typeof onUpdate!=="function")throw failure("COPILOT_RPC_REQUEST_INVALID");
  let finish!:()=>void,reject!:(error:AdapterContractError)=>void;
  const completed=new Promise<void>((resolve,decline)=>{finish=resolve;reject=decline;});void completed.catch(()=>{});
  const active:ActivePrompt={id,model:this.bootstrapState.model,deadline:performance.now()+duration,...(signal?{signal}:{}),...(onUpdate?{onUpdate}:{}),written:false,terminal:false,consumed:false,proof:false,toolFailure:false,permissionDenied:false,aborted:false,updates:0,cancelAdmitted:false,buffered:[],tools:new Map(),permissions:new Set(),decisions:new Set(),finish,reject};
  this.activePrompt=active;
  const cancel=()=>this.fail("COPILOT_RPC_CANCELLED"),timer=setTimeout(()=>this.fail("COPILOT_RPC_TIMEOUT"),duration);signal?.addEventListener("abort",cancel,{once:true});
  const scoped=():CopilotRpcOptions=>{this.assertPrompt(active);return {timeoutMs:Math.max(1,Math.floor(active.deadline-performance.now())),...(signal?{signal}:{}),...(beforeSend?{beforeSend}:{})};};
  try{
   this.assertPrompt(active);const meta=await this.read("session.getMetadata",{sessionId:id},scoped()) as {session?:unknown};if(!meta.session)throw failure("COPILOT_RPC_SESSION_NOT_FOUND");
   const model=await this.read("session.model.getCurrent",{sessionId:id},scoped()) as {modelId?:string};if(model.modelId!==active.model)throw failure("COPILOT_RPC_MODEL_DRIFT");
   const ack=await this.read("session.send",{sessionId:id,prompt:message,mode:"enqueue"},scoped()) as {messageId:string};
   await completed;
   // An ACK batch can introduce another exact decision while an earlier snapshot drains.
   for(;;){const decisions=[...active.decisions];await Promise.all(decisions);this.assertPrompt(active);if(decisions.length===active.decisions.size)break;}
   this.assertPrompt(active);this.assertMutation();this.assertPrompt(active);
   return {messageId:ack.messageId,nativeStopReason:active.aborted?"aborted":"idle",executionEvidence:active.proof,toolFailure:active.toolFailure,permissionDenied:active.permissionDenied,pendingTools:[...active.tools.values()].filter(status=>status==="pending"||status==="in_progress").length};
  }catch(error){const reason:unknown=this.disconnected.signal.reason,code=reason instanceof AdapterContractError?reason.code:error instanceof AdapterContractError?error.code:"COPILOT_RPC_OUTCOME_UNKNOWN";this.fail(code);throw failure(code);}
  finally{clearTimeout(timer);signal?.removeEventListener("abort",cancel);if(this.activePrompt===active)this.activePrompt=undefined;}
 }
 async cancelPrompt(input:{sessionId:string},options:CopilotRpcOptions={}):Promise<{disposition:"submitted"}>{
  if(!this.mutationGuard)throw failure("COPILOT_RPC_READ_ONLY");
  const active=this.activePrompt,id=input.sessionId,signal=options.signal,beforeSend=options.beforeSend;
  if(!active||id!==active.id)throw failure("COPILOT_RPC_IDENTITY_CHANGED");this.assertPrompt(active);
  const remaining=Math.min(timeout(options.timeoutMs),Math.floor(active.deadline-performance.now()));if(remaining<1)throw failure("COPILOT_RPC_TIMEOUT");
  if(!active.written||active.terminal||active.cancelAdmitted)throw failure("COPILOT_RPC_SESSION_BUSY");active.cancelAdmitted=true;
  await this.read("session.abort",{sessionId:id},{timeoutMs:remaining,...(signal?{signal}:{}),...(beforeSend?{beforeSend}:{})});
  return {disposition:"submitted"};
 }
 private stop(code:string):void {
  if(this.closed)return;this.closed=true;this.disconnected.abort(failure(code));this.activePrompt?.reject(failure(code));for(const[id,pending]of this.pending){pending.cleanup();if(!pending.discarded)pending.reject(failure(code));this.pending.delete(id);}this.listeners.clear();
 }
 private fail(code:string):void{this.stop(code);void this.close();}
 close():Promise<LocalRuntimeDisconnect>{
  this.stop("COPILOT_RPC_UNREACHABLE");return this.shutdown??=this.closeOwned();
 }
 private async closeOwned():Promise<LocalRuntimeDisconnect>{
  let rootUnknown=false;
  try{if(!this.notCreated)await this.owner.stop();}catch{rootUnknown=true;}
  if(!this.rootExited&&!this.notCreated)await new Promise<void>(resolve=>{const timer=setTimeout(resolve,500);void this.exited.then(()=>{clearTimeout(timer);resolve();});});
  this.reader.dispose();this.writer.dispose();this.projected.destroy();this.sink.destroy();this.child.stdin.destroy();this.child.stdout.destroy();this.child.stderr.destroy();
  const draining=Promise.allSettled([this.writes,...this.callbacks]),callbacks=await new Promise<"drained"|"unknown">(resolve=>{const timer=setTimeout(()=>resolve("unknown"),500);void draining.then(()=>{clearTimeout(timer);resolve("drained");});});
  const ownedRoot=this.notCreated?"not-created":this.rootExited&&!rootUnknown?"exited":"unknown";
  return {version:1,connection:this.pipeUnknown||ownedRoot==="unknown"?"unknown":"closed",ownedRoot,callbacks,backgroundTools:"unknown",nativeSessionDeleted:false,...(this.child.pid?{ownedRootPid:this.child.pid}:{})};
 }
}
