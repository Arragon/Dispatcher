import {randomUUID} from "node:crypto";
import {lstatSync,realpathSync,statSync} from "node:fs";
import {basename,dirname,isAbsolute,join,relative,sep} from "node:path";
import {StringDecoder} from "node:string_decoder";
import {isDeepStrictEqual} from "node:util";
import {assessInteractionCapability,type CapabilityEvidence,type HistoryPage,type HistoryRequest,type InteractionCapabilities,type NativeBinding,type NativeHistoryEntry,type NativeObservation} from "@dispatcher/domain";
import {AdapterContractError} from "./contracts.js";
import type {NativeInteractionPort,NativeReadHandle,NativeReadRequest} from "./interaction-contracts.js";
import {type PiRpcClient,directory,text,object,failure,type Directory} from "./pi-rpc-client.js";
export interface PiRpcInteractionScope {binding:NativeBinding;scopeFingerprint:string;evidence?:Partial<InteractionCapabilities>}
type PiReadCapability="durableIdentity"|"historyRead";
interface PiState {
 sessionId:string;isStreaming:boolean;isCompacting:boolean;messageCount:number;pendingMessageCount:number;
 steeringMode:string;followUpMode:string;thinkingLevel:string;autoCompactionEnabled:boolean;
 model?:{provider:string;id:string};sessionFile?:string;sessionName?:string;
}
interface PiFile {reportedPath:string;path:string;parent:Directory;materialized:boolean;dev?:bigint;ino?:bigint}
function record(value:unknown):Record<string,unknown>{if(!object(value))throw failure("PI_RPC_PROTOCOL_INVALID");return value;}
const entryId=(value:unknown):value is string=>text(value)&&/^[A-Za-z0-9_-]+$/.test(value);
/** One owned UUID, read-only projections. No print execution or writer authority is inferred. */
export class PiRpcInteractionPort implements NativeInteractionPort {
 readonly eventContinuity="volatile";
 private readonly configuration:PiRpcInteractionScope;
 private file?:PiFile;
 constructor(scope:PiRpcInteractionScope,private readonly client:PiRpcClient){
  const c=structuredClone(scope),b=c.binding;
  if(!b||b.version!==1||b.product!=="pi"||b.region!=="global"||b.backendId!=="pi-rpc"||b.identityState!=="bound"||b.nativeThreadId!==undefined||b.parentSessionId!==undefined||![b.profileId,b.runnerId,b.nativeStoreRef,b.executionRefId,c.scopeFingerprint].every(value=>text(value))||b.nativeSessionId!==client.connectionScope.sessionId)throw failure("PI_RPC_IDENTITY_CHANGED");
  client.assertCurrentScope();this.configuration=c;
 }
 capabilities():InteractionCapabilities{
  let reason="PI_RPC_RUNTIME_UNQUALIFIED";try{this.assertScope();}catch(error){reason=error instanceof AdapterContractError?error.code:"PI_RPC_SCOPE_CHANGED";}
  const unknown:CapabilityEvidence={version:1,support:"unknown",level:"documented",scopeFingerprint:this.configuration.scopeFingerprint,reasonCode:reason};
  const qualified=(key:PiReadCapability)=>{const supplied=this.configuration.evidence?.[key];return reason==="PI_RPC_RUNTIME_UNQUALIFIED"&&assessInteractionCapability(supplied,this.configuration.scopeFingerprint,"runtime-verified").supported?structuredClone(supplied!):{...unknown};};
  return {version:1,durableIdentity:qualified("durableIdentity"),historyRead:qualified("historyRead"),observeExternalChanges:{...unknown},sameSessionContinue:{...unknown},liveSteer:{...unknown},interruptTurn:{...unknown},nativeApproval:{...unknown},releaseControl:{...unknown},reclaimControl:{...unknown},restartReattach:{...unknown},surfaces:{}};
 }
 private assertScope():void{
  this.client.assertCurrentScope();if(!this.file)return;
  this.retainFile(this.fileIdentity(this.file.reportedPath));
 }
 private fileIdentity(reportedPath:string):PiFile{
  try{
   if(!text(reportedPath,4096)||!isAbsolute(reportedPath))throw Error();
   const parent=directory(dirname(reportedPath)),root=this.client.connectionScope.sessionDirectory,inside=(path:string)=>{const value=relative(root,path);return value!==".."&&!value.startsWith(`..${sep}`)&&!isAbsolute(value);};
   if(!inside(parent.path))throw Error();
   try{lstatSync(reportedPath);}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;return {reportedPath,path:join(parent.path,basename(reportedPath)),parent,materialized:false};}
   const path=realpathSync(reportedPath),stat=statSync(path,{bigint:true});if(!inside(path)||path===root||!stat.isFile())throw Error();return {reportedPath,path,parent,materialized:true,dev:stat.dev,ino:stat.ino};
  }catch{throw failure("PI_RPC_IDENTITY_CHANGED");}
 }
 private retainFile(current:PiFile):void{
  const previous=this.file;
  if(previous&&(previous.materialized?!isDeepStrictEqual(previous,current):!isDeepStrictEqual([previous.reportedPath,previous.path,previous.parent],[current.reportedPath,current.path,current.parent])))throw failure("PI_RPC_IDENTITY_CHANGED");
  this.file=current;
 }
 private guard(ref:NativeBinding,capability:PiReadCapability,signal?:AbortSignal):void{
  if(!isDeepStrictEqual(ref,this.configuration.binding))throw failure("PI_RPC_IDENTITY_CHANGED");
  this.assertScope();if(signal?.aborted)throw failure("PI_RPC_CANCELLED");
  const caps=this.capabilities();if(!assessInteractionCapability(caps.durableIdentity,this.configuration.scopeFingerprint,"runtime-verified").supported||!assessInteractionCapability(caps[capability],this.configuration.scopeFingerprint,"runtime-verified").supported)throw failure("NATIVE_CAPABILITY_UNVERIFIED");
 }
 private async bounded<T>(signal:AbortSignal|undefined,work:(signal:AbortSignal)=>Promise<T>):Promise<T>{
  const local=new AbortController();let expired=false;const cancel=()=>local.abort();signal?.addEventListener("abort",cancel,{once:true});if(signal?.aborted)local.abort();
  const deadline=setTimeout(()=>{expired=true;local.abort();},5_000);
  try{return await work(local.signal);}catch(error){if(expired)throw failure("PI_RPC_TIMEOUT");throw error;}finally{clearTimeout(deadline);signal?.removeEventListener("abort",cancel);local.abort();}
 }
 private async query(command:"get_state"|"get_entries",ref:NativeBinding,capability:PiReadCapability,signal:AbortSignal,payload:Record<string,unknown>={}):Promise<Record<string,unknown>>{
  this.guard(ref,capability,signal);
  try{const value=await this.client.request(command,payload,{signal,beforeSend:()=>this.guard(ref,capability,signal)});this.guard(ref,capability,signal);return value;}
  catch(error){if(error instanceof AdapterContractError&&error.code==="PI_RPC_AUTHORITY_CHANGED")this.guard(ref,capability,signal);throw error;}
 }
 private async state(ref:NativeBinding,capability:PiReadCapability,signal:AbortSignal):Promise<PiState>{
  const r=await this.query("get_state",ref,capability,signal);
  if(r.sessionId!==ref.nativeSessionId)throw failure("PI_RPC_IDENTITY_CHANGED");
  if(typeof r.isStreaming!=="boolean"||typeof r.isCompacting!=="boolean"||typeof r.autoCompactionEnabled!=="boolean"||![r.messageCount,r.pendingMessageCount].every(value=>Number.isSafeInteger(value)&&Number(value)>=0)||typeof r.steeringMode!=="string"||!["all","one-at-a-time"].includes(r.steeringMode)||typeof r.followUpMode!=="string"||!["all","one-at-a-time"].includes(r.followUpMode)||!text(r.thinkingLevel,64)||r.sessionName!==undefined&&!text(r.sessionName))throw failure("PI_RPC_PROTOCOL_INVALID");
  let model:PiState["model"];if(r.model!==undefined){const m=record(r.model);if(!text(m.provider)||!text(m.id))throw failure("PI_RPC_PROTOCOL_INVALID");model={provider:m.provider,id:m.id};}
  let sessionFile:string|undefined;
  if(r.sessionFile!==undefined){
   if(!text(r.sessionFile,4096))throw failure("PI_RPC_IDENTITY_CHANGED");const file=this.fileIdentity(r.sessionFile);
   if(!file.materialized&&(this.client.connectionScope.mode!=="new"||r.messageCount!==0||r.isStreaming||r.isCompacting||r.pendingMessageCount!==0))throw failure("PI_RPC_IDENTITY_CHANGED");
   this.retainFile(file);sessionFile=file.path;
  }else if(this.file)throw failure("PI_RPC_IDENTITY_CHANGED");
  return {sessionId:ref.nativeSessionId,isStreaming:r.isStreaming,isCompacting:r.isCompacting,autoCompactionEnabled:r.autoCompactionEnabled,messageCount:r.messageCount as number,pendingMessageCount:r.pendingMessageCount as number,steeringMode:r.steeringMode,followUpMode:r.followUpMode,thinkingLevel:r.thinkingLevel,...(model?{model}:{}),...(sessionFile?{sessionFile}:{}),...(typeof r.sessionName==="string"?{sessionName:r.sessionName}:{})};
 }
 readHandle(ref:NativeBinding):NativeReadHandle{
  const selected=structuredClone(ref);this.guard(selected,"durableIdentity");return {binding:structuredClone(selected),scopeFingerprint:this.configuration.scopeFingerprint,inspect:request=>this.inspect(selected,request)};
 }
 async inspect(ref:NativeBinding,request?:NativeReadRequest):Promise<NativeObservation>{
  const selected=structuredClone(ref),input=request?{...request}:undefined;
  return this.bounded(input?.signal,async signal=>{
   const first=await this.state(selected,"durableIdentity",signal),last=await this.state(selected,"durableIdentity",signal);
   if(!isDeepStrictEqual(first,last))throw failure("PI_RPC_OBSERVATION_CHANGED");
   return {version:1,id:input?.requestId??randomUUID(),nativeSessionId:selected.nativeSessionId,scopeFingerprint:this.configuration.scopeFingerprint,executionRefId:selected.executionRefId,observedAt:new Date().toISOString(),state:first.isStreaming||first.isCompacting?"running":first.pendingMessageCount?"unknown":"idle",pendingTools:"unknown",pendingApprovals:"unknown",historyMode:"snapshot-only",readability:"readable",...(first.model?{reportedModel:{nativeSelectionId:`${first.model.provider}/${first.model.id}`,reasoning:first.thinkingLevel}}:{})};
  });
 }
 private async entries(ref:NativeBinding,cursor:string|undefined,signal:AbortSignal):Promise<{entries:Record<string,unknown>[];leafId:string|null}>{
  const r=await this.query("get_entries",ref,"historyRead",signal,cursor?{since:cursor}:{});
  if(!Array.isArray(r.entries)||r.entries.length>10_000||r.leafId!==null&&!entryId(r.leafId))throw failure("PI_RPC_PROTOCOL_INVALID");
  const ids=new Set<string>(),entries=r.entries.map(item=>{const entry=record(item);if(!entryId(entry.id)||ids.has(entry.id)||!text(entry.type,64)||entry.parentId!==null&&!entryId(entry.parentId)||!text(entry.timestamp,64)||!/^\d{4}-\d{2}-\d{2}T/.test(entry.timestamp)||!Number.isFinite(Date.parse(entry.timestamp)))throw failure("PI_RPC_PROTOCOL_INVALID");ids.add(entry.id);return entry;});
  return {entries,leafId:r.leafId};
 }
 private project(entry:Record<string,unknown>,gaps:Set<string>):NativeHistoryEntry{
  let kind:NativeHistoryEntry["kind"]="other",content="Native metadata entry omitted";
  const extract=(value:unknown):string=>{
   if(typeof value==="string")return value;if(!Array.isArray(value)){gaps.add("PI_HISTORY_CONTENT_UNSUPPORTED");return "";}
   const parts:string[]=[];for(const item of value){const part=record(item);if(part.type==="text"&&typeof part.text==="string")parts.push(part.text);else gaps.add("PI_HISTORY_CONTENT_UNSUPPORTED");}return parts.join("\n");
  };
  if(entry.type==="message"){
   const message=record(entry.message);if(!text(message.role,64))throw failure("PI_RPC_PROTOCOL_INVALID");if(["user","assistant","toolResult"].includes(message.role)){kind=message.role==="toolResult"?"tool":message.role as "user"|"assistant";content=extract(message.content);}else gaps.add("PI_HISTORY_CONTENT_UNSUPPORTED");
  }else if(typeof entry.type==="string"&&["compaction","branch_summary"].includes(entry.type)&&typeof entry.summary==="string"){kind="summary";content=entry.summary;gaps.add("PI_HISTORY_CONTENT_UNSUPPORTED");}
  else gaps.add("PI_HISTORY_CONTENT_UNSUPPORTED");
  const bytes=Buffer.from(content),truncated=bytes.byteLength>16_384;if(truncated){gaps.add("HISTORY_CONTENT_TRUNCATED");content=new StringDecoder("utf8").write(bytes.subarray(0,16_384));}
  return {id:entry.id as string,kind,text:content,occurredAt:entry.timestamp as string,...(truncated?{truncated:true}:{})};
 }
 async history(ref:NativeBinding,request:HistoryRequest,read?:NativeReadRequest):Promise<HistoryPage>{
  const selected=structuredClone(ref),input={limit:request.limit,cursor:request.cursor},signal=read?.signal;
  if(!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>100||input.cursor!==undefined&&!entryId(input.cursor))throw failure("PI_RPC_HISTORY_REQUEST_INVALID");
  return this.bounded(signal,async original=>{
   const first=await this.state(selected,"historyRead",original),history=await this.entries(selected,input.cursor,original),again=await this.entries(selected,input.cursor,original),last=await this.state(selected,"historyRead",original);
   if(!isDeepStrictEqual(first,last)||!isDeepStrictEqual(history,again))throw failure("PI_RPC_OBSERVATION_CHANGED");
   const gaps=new Set(["PI_HISTORY_TREE_NOT_PROJECTED"]);if(input.cursor)gaps.add("PI_HISTORY_EARLIER_ENTRIES_OMITTED");
   const entries:NativeHistoryEntry[]=[];let bytes=0;
   for(const entry of history.entries.slice(0,input.limit)){const projected=this.project(entry,gaps),size=Buffer.byteLength(JSON.stringify(projected))+1;if(bytes+size>258_048){gaps.add("HISTORY_PAGE_BYTES_LIMIT");break;}bytes+=size;entries.push(projected);}
   const more=entries.length<history.entries.length;if(more)gaps.add("HISTORY_MORE_PAGES");
   return {version:1,nativeSessionId:selected.nativeSessionId,entries,...(more&&entries.length?{nextCursor:entries.at(-1)!.id}:{}),completeness:"partial",range:"native-history",state:"available",source:"pi-rpc:append-order",gaps:[...gaps]};
  });
 }
}
