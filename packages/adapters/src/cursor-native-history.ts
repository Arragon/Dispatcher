import {childExecutionEnvironment} from "@dispatcher/shared";
import {spawn} from "node:child_process";
import {realpathSync,statSync} from "node:fs";
import {isAbsolute} from "node:path";
import {Readable} from "node:stream";
import {isDeepStrictEqual} from "node:util";
import {ndJsonStream,type AnyMessage} from "@agentclientprotocol/sdk";
import {AdapterContractError} from "./contracts.js";
import {OwnedProcessRoot} from "./owned-root-process.js";
import {readOwnedNativeVersion} from "./native-version-probe.js";

export const cursorLocalReadVersion="2026.10.01-e373342";
export interface CursorLocalReadScope {executable:string;workspacePath:string;homePath:string}
export interface CursorLocalReadInput {scope:CursorLocalReadScope;cursor?:string;signal?:AbortSignal;timeoutMs?:number}
export interface CursorLocalSessionInventory {sessions:Array<{sessionId:string;cwd:string}>;nextCursor?:string}
const failure=(code:string)=>new AdapterContractError(code,code);
const record=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value);
const text=(value:unknown,max=512):value is string=>typeof value==="string"&&value.length>0&&value.length<=max&&!Array.from(value).some(char=>char.charCodeAt(0)<32||char.charCodeAt(0)===127);
export const isCursorLocalSessionId=(value:unknown):value is string=>text(value)&&!value.startsWith("-");
function identity(path:string,directory:boolean){
 if(!text(path,4096)||!isAbsolute(path))throw failure("CURSOR_LOCAL_SCOPE_CHANGED");
 try{const physical=realpathSync(path),stat=statSync(physical,{bigint:true});
  if(directory?!stat.isDirectory():!stat.isFile())throw Error();
  return {path:physical,dev:stat.dev,ino:stat.ino,...(!directory?{size:stat.size,mtime:stat.mtimeNs}:{})};
 }catch{throw failure("CURSOR_LOCAL_SCOPE_CHANGED");}
}
function projectInventory(value:unknown,workspacePath:string):CursorLocalSessionInventory{
 if(!record(value)||!Array.isArray(value.sessions)||value.sessions.length>100||value.nextCursor!=null&&!text(value.nextCursor))throw failure("CURSOR_LOCAL_INVENTORY_INVALID");
 const ids=new Set<string>(),sessions=value.sessions.map(item=>{
  if(!record(item)||!isCursorLocalSessionId(item.sessionId)||!text(item.cwd,4096)||item.cwd!==workspacePath||ids.has(item.sessionId))throw failure("CURSOR_LOCAL_INVENTORY_INVALID");
  ids.add(item.sessionId);return {sessionId:item.sessionId,cwd:item.cwd};
 });
 return {sessions,...(typeof value.nextCursor==="string"?{nextCursor:value.nextCursor}:{})};
}

/** Inventory is a locator only, never full history, native idle state or writer authority. */
export function readCursorLocalSessions(input:CursorLocalReadInput):Promise<CursorLocalSessionInventory>{
 return readInventory(input);
}
/** Exhaust bounded native inventory before declaring an exact ID unique/present. */
export async function locateCursorLocalSession(input:CursorLocalReadInput&{nativeSessionId:string}):Promise<{sessionId:string;cwd:string}>{
 const nativeSessionId=input.nativeSessionId;
 if(!isCursorLocalSessionId(nativeSessionId))throw failure("CURSOR_LOCAL_SESSION_ID_INVALID");
 const page=await readInventory(input,nativeSessionId),found=page.sessions.find(item=>item.sessionId===nativeSessionId);
 if(!found)throw failure("CURSOR_LOCAL_SESSION_NOT_FOUND");
 return found;
}
async function readInventory(original:CursorLocalReadInput,findId?:string):Promise<CursorLocalSessionInventory>{
 const scope=structuredClone(original.scope),signal=original.signal,cursor=original.cursor,timeoutMs=original.timeoutMs??5000;
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000||cursor!==undefined&&!text(cursor)||findId!==undefined&&cursor!==undefined)throw failure("CURSOR_LOCAL_READ_INVALID");
 const deadline=performance.now()+timeoutMs;
 const capture=()=>[identity(scope.executable,false),identity(scope.workspacePath,true),identity(scope.homePath,true)],paths=capture();
 const guard=()=>{
  if(signal?.aborted)throw failure("CURSOR_LOCAL_READ_CANCELLED");
  if(performance.now()>=deadline)throw failure("CURSOR_LOCAL_READ_TIMEOUT");
  if(!isDeepStrictEqual(capture(),paths))throw failure("CURSOR_LOCAL_SCOPE_CHANGED");
 };
 guard();
 const environment=childExecutionEnvironment(process.env,{HOME:paths[2]!.path,PWD:paths[1]!.path});
 let version:string;
 try{version=await readOwnedNativeVersion({executable:paths[0]!.path,workspacePath:paths[1]!.path,environment,ownsGroup:false,strictOutput:{stderrMaxBytes:1048576},...(signal?{signal}:{}),timeoutMs:Math.max(1,deadline-performance.now()),failure:code=>failure(code==="exit-unconfirmed"?"CURSOR_LOCAL_CLEANUP_UNKNOWN":"CURSOR_LOCAL_RUNTIME_UNAVAILABLE")});}
 catch(error){if(error instanceof AdapterContractError&&error.code==="CURSOR_LOCAL_CLEANUP_UNKNOWN")throw error;guard();throw error;}
 guard();if(version!==cursorLocalReadVersion)throw failure("CURSOR_LOCAL_VERSION_UNQUALIFIED");
 const child=spawn(paths[0]!.path,["acp"],{cwd:paths[1]!.path,env:environment,shell:false,detached:false,stdio:["pipe","pipe","pipe"]}),owner=new OwnedProcessRoot(child);
 let rejected:AdapterContractError|undefined,rejectRead!:(error:AdapterContractError)=>void,bytes=0,records=0,stderrBytes=0,allowedFrame:Buffer|undefined,allowedId:number|undefined,expectedResponseId:number|undefined,pipeFailed=false;
 const aborted=new Promise<never>((_,reject)=>{rejectRead=reject;});void aborted.catch(()=>{});
 const abort=(code:string)=>{rejected??=failure(code);rejectRead(rejected);};
 child.once("error",()=>abort("CURSOR_LOCAL_RUNTIME_UNAVAILABLE"));
 child.stdin.on("error",()=>abort("CURSOR_LOCAL_RUNTIME_UNAVAILABLE"));
 const pipeError=()=>{pipeFailed=true;abort("CURSOR_LOCAL_CLEANUP_UNKNOWN");};
 child.stdout.on("error",pipeError);child.stderr.on("error",pipeError);
 const stderrDecoder=new TextDecoder("utf-8",{fatal:true});
 child.stderr.on("data",(chunk:Buffer)=>{stderrBytes+=chunk.length;try{if(stderrBytes>1048576)throw Error();stderrDecoder.decode(chunk,{stream:true});}catch{abort("CURSOR_LOCAL_PROTOCOL_INVALID");}});
 const closed=new Promise<void>(resolve=>child.once("close",()=>resolve()));
 const onAbort=()=>abort("CURSOR_LOCAL_READ_CANCELLED"),timer=setTimeout(()=>abort("CURSOR_LOCAL_READ_TIMEOUT"),Math.max(1,deadline-performance.now()));
 signal?.addEventListener("abort",onAbort,{once:true});if(signal?.aborted)onAbort();
 const decoder=new TextDecoder("utf-8",{fatal:true}),encoder=new TextEncoder();let inputBuffer="";
 const projectFrame=(line:string):Uint8Array|undefined=>{
  if(!line.trim())return undefined;
  guard();
  let packet:unknown;try{packet=JSON.parse(line);}catch{throw failure("CURSOR_LOCAL_PROTOCOL_INVALID");}
  if(!record(packet)||packet.jsonrpc!=="2.0"||expectedResponseId===undefined||packet.id!==expectedResponseId||"method" in packet||("result" in packet)===("error" in packet))throw failure("CURSOR_LOCAL_PROTOCOL_INVALID");
  const id=expectedResponseId;expectedResponseId=undefined;
  if("error" in packet){
   if(!record(packet.error)||!Number.isSafeInteger(packet.error.code))throw failure("CURSOR_LOCAL_PROTOCOL_INVALID");
   return encoder.encode(JSON.stringify({jsonrpc:"2.0",id,error:{code:packet.error.code,message:"CURSOR_LOCAL_READ_REJECTED"}})+"\n");
  }
  let result:unknown;
  if(id===1){
   const value=record(packet.result)?packet.result:{},caps=record(value.agentCapabilities)?value.agentCapabilities:undefined;
   const listed=caps&&record(caps.sessionCapabilities)&&record(caps.sessionCapabilities.list);
   result={protocolVersion:value.protocolVersion,agentCapabilities:caps?{sessionCapabilities:listed?{list:{}}:{}}:null};
  }else result=projectInventory(packet.result,paths[1]!.path);
  return encoder.encode(JSON.stringify({jsonrpc:"2.0",id,result})+"\n");
 };
 const streamFailure=(cause:unknown)=>cause instanceof AdapterContractError?cause:failure("CURSOR_LOCAL_PROTOCOL_INVALID");
 const bounded=Readable.toWeb(child.stdout).pipeThrough(new TransformStream<Uint8Array,Uint8Array>({
  transform(chunk,controller){
   try{bytes+=chunk.byteLength;for(const byte of chunk)if(byte===10)records++;
    if(bytes>1048576||records>64)throw Error();
    inputBuffer+=decoder.decode(chunk,{stream:true});
    while(inputBuffer.includes("\n")){
     const at=inputBuffer.indexOf("\n"),line=inputBuffer.slice(0,at);inputBuffer=inputBuffer.slice(at+1);
     const projected=projectFrame(line);if(projected)controller.enqueue(projected);
    }
   }catch(cause){const error=streamFailure(cause);abort(error.code);controller.error(error);}
  },
  flush(controller){try{inputBuffer+=decoder.decode();if(inputBuffer.trim()){const projected=projectFrame(inputBuffer);if(projected)controller.enqueue(projected);}inputBuffer="";}catch(cause){const error=streamFailure(cause);abort(error.code);controller.error(error);}}
 }),{preventCancel:true});
 // Use the pinned SDK's codec, without its router/logging/permission queue.
 // Only an exact locally admitted frame may reach stdin, including codec errors.
 const stream=ndJsonStream(new WritableStream<Uint8Array>({
  write(chunk){
   guard();
   if(!allowedFrame||allowedId===undefined||expectedResponseId!==undefined||!Buffer.from(chunk).equals(allowedFrame))throw failure("CURSOR_LOCAL_PROTOCOL_INVALID");
   allowedFrame=undefined;expectedResponseId=allowedId;allowedId=undefined;
   return new Promise<void>((resolve,reject)=>{child.stdin.write(Buffer.from(chunk),error=>error?reject(failure("CURSOR_LOCAL_RUNTIME_UNAVAILABLE")):resolve());});
  }
 }),bounded,{maxMessageBytes:1048576});
 const reader=stream.readable.getReader(),writer=stream.writable.getWriter();
 let requestId=0,completion:CursorLocalSessionInventory|undefined,error:unknown,confirmation:ReturnType<typeof setTimeout>|undefined;
 const request=async(method:"initialize"|"session/list",params:Record<string,unknown>):Promise<unknown>=>{
  guard();if(rejected)throw rejected;
  const id=++requestId,message={jsonrpc:"2.0" as const,id,method,params};
  allowedFrame=Buffer.from(JSON.stringify(message)+"\n");allowedId=id;
  await Promise.race([writer.write(message as AnyMessage),aborted]);guard();
  const response=await Promise.race([reader.read(),aborted]);guard();const packet:unknown=response.value;
  if(response.done||!record(packet)||packet.jsonrpc!=="2.0"||packet.id!==id||"method" in packet||("result" in packet)===("error" in packet))throw failure("CURSOR_LOCAL_PROTOCOL_INVALID");
  if("error" in packet)throw failure("CURSOR_LOCAL_READ_REJECTED");
  return packet.result;
 };
 try{
  const initialized=await request("initialize",{protocolVersion:1,clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false},clientInfo:{name:"dispatcher-readonly",version:"1"}});
  if(!record(initialized)||initialized.protocolVersion!==1||!record(initialized.agentCapabilities))throw failure("CURSOR_LOCAL_PROTOCOL_UNQUALIFIED");
  const capabilities=initialized.agentCapabilities;
  if(!record(capabilities.sessionCapabilities)||!record(capabilities.sessionCapabilities.list))throw failure("CURSOR_LOCAL_LIST_UNSUPPORTED");
  const ids=new Set<string>(),cursors=new Set<string>(),sessions:CursorLocalSessionInventory["sessions"]=[];
  let next=cursor;
  for(let page=0;page<10;page++){
   const inventory=projectInventory(await request("session/list",{cwd:paths[1]!.path,...(next!==undefined?{cursor:next}:{})}),paths[1]!.path);
   if(findId===undefined){completion=inventory;break;}
   for(const item of inventory.sessions){if(ids.has(item.sessionId))throw failure("CURSOR_LOCAL_INVENTORY_INVALID");ids.add(item.sessionId);sessions.push(item);}
   if(!inventory.nextCursor){completion={sessions};break;}
   if(cursors.has(inventory.nextCursor))throw failure("CURSOR_LOCAL_LOOKUP_INCOMPLETE");
   cursors.add(inventory.nextCursor);next=inventory.nextCursor;
  }
  if(!completion)throw failure("CURSOR_LOCAL_LOOKUP_INCOMPLETE");
  guard();
 }catch(cause){error=cause instanceof AdapterContractError?cause:failure("CURSOR_LOCAL_PROTOCOL_INVALID");}
 finally{
  clearTimeout(timer);signal?.removeEventListener("abort",onAbort);allowedFrame=undefined;allowedId=undefined;expectedResponseId=undefined;
  child.stdin.end();await owner.stop().catch(()=>{error=failure("CURSOR_LOCAL_CLEANUP_UNKNOWN");});
  const confirmed=await Promise.race([closed.then(()=>true),new Promise<boolean>(resolve=>{confirmation=setTimeout(()=>resolve(false),500);})]);
  if(!confirmed)error=failure("CURSOR_LOCAL_CLEANUP_UNKNOWN");
  if(confirmation)clearTimeout(confirmation);
  child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();
  void reader.cancel().catch(()=>{});reader.releaseLock();writer.releaseLock();
 }
 try{stderrDecoder.decode();}catch{abort("CURSOR_LOCAL_PROTOCOL_INVALID");}
 if(pipeFailed)throw failure("CURSOR_LOCAL_CLEANUP_UNKNOWN");
 if(error)throw error;if(rejected)throw rejected;guard();return completion!;
}
