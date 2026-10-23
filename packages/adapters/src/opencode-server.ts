import { createHash, randomUUID } from "node:crypto";
import {setTimeout as delay} from "node:timers/promises";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { assessInteractionCapability, isExecutionContextRef, validateExecutionBinding, type AttachEvidence, type AttachRequest, type CapabilityEvidence, type ExecutionContextRef, type HistoryPage, type HistoryRequest, type InteractionCapabilities, type InterruptRequest, type MutationFence, type NativeBinding, type NativeCommandReceipt, type NativeHistoryEntry, type NativeObservation, type NativeQuiescenceRuntime, type NativeTurnFact, type ReleaseEvidence, type ReleaseRequest } from "@dispatcher/domain";
import {freezeExecutionSelection} from "./execution-selection.js";
import type { NativeInteractionPort, NativeReadHandle, NativeReadRequest } from "./interaction-contracts.js";

export const opencodeV2ProtocolVersion="2.0.22";
export const opencodeV2ProtocolVersions=Object.freeze([opencodeV2ProtocolVersion,"2.0.26"] as const);
export type OpenCodeV2ProtocolVersion=typeof opencodeV2ProtocolVersions[number];
export function isOpenCodeV2ProtocolVersion(value:unknown):value is OpenCodeV2ProtocolVersion {return opencodeV2ProtocolVersions.some(version=>version===value);}
export interface OpenCodeV2Request {method:"GET"|"POST";path:string;query?:Record<string,string>;body?:unknown;signal?:AbortSignal;beforeSend?:()=>void}
export interface OpenCodeV2Transport {request(input:OpenCodeV2Request):Promise<unknown>}
export interface OpenCodeV2ModelSnapshot {models:unknown[];defaultModel:unknown;protocolVersion:OpenCodeV2ProtocolVersion}
export interface OpenCodeV2Scope {
  profileId:string;runnerId:string;nativeStoreRef:string;workspacePath:string;scopeFingerprint:string;
  backendId:"opencode-server-v2"|"opencode-cli-json";evidence?:Partial<InteractionCapabilities>;
  protocolVersion?:OpenCodeV2ProtocolVersion;
  server?:{pid:number;tmpDirectory:string;ownership:"owned"|"external";shared:boolean};
  interruptWithoutResume?:CapabilityEvidence;
}
export interface OpenCodeV2Model {providerID:string;id:string;variant?:string}
export interface OpenCodeV2Permission {action:string;resource:string;effect:"allow"|"deny"|"ask"}
export interface OpenCodeV2Start {executionRefId:string;executionRef?:ExecutionContextRef;commandId:string;prompt:string;model:OpenCodeV2Model;permissions:OpenCodeV2Permission[];onBinding:(binding:NativeBinding)=>void|Promise<void>;onNativeEvent?:(fact:NativeTurnFact)=>void|Promise<void>;beforePrompt?:()=>void}
export interface OpenCodeV2TurnResult {state:"pending"|"succeeded"|"failed"|"interrupted";nativeSessionId:string;nativeMessageId:string;nativeTerminalMessageId?:string;summary?:string}
export class OpenCodeV2Error extends Error {constructor(readonly code:string,readonly outcome:"not-created"|"unknown"="unknown"){super(code);this.name="OpenCodeV2Error";}}
class OpenCodeV2PreSendRejection extends OpenCodeV2Error {constructor(){super("OPENCODE_WRITE_ADMISSION_REJECTED");}}
function synchronousAdmission(guard:(()=>void)|undefined):void {
  const result:unknown=guard?.();
  if(result!==undefined){void Promise.resolve(result).catch(()=>undefined);throw new OpenCodeV2Error("OPENCODE_ADMISSION_MUST_BE_SYNCHRONOUS");}
}

export class OpenCodeV2HttpTransport implements OpenCodeV2Transport {
  private readonly origin:string;
  constructor(origin:string,private readonly headers?:()=>Promise<Record<string,string>>){
    let url:URL;try{url=new URL(origin);}catch{throw new OpenCodeV2Error("OPENCODE_SERVER_ENTRY_INVALID","not-created");}
    if(url.protocol!=="http:"||!["127.0.0.1","localhost","[::1]"].includes(url.hostname)||url.username||url.password||url.pathname!=="/"||url.search||url.hash)throw new OpenCodeV2Error("OPENCODE_SERVER_ENTRY_INVALID","not-created");
    this.origin=url.origin;
  }
  async request(input:OpenCodeV2Request):Promise<unknown>{
    if(!/^\/api\/[A-Za-z0-9_/-]+$/.test(input.path)||input.path.includes(".."))throw new OpenCodeV2Error("OPENCODE_REQUEST_PATH_INVALID");
    const url=new URL(input.path,this.origin);for(const [key,value] of Object.entries(input.query??{}))url.searchParams.set(key,value);
    const method=input.method,beforeSend=input.beforeSend,originalSignal=input.signal;
    let body:string|undefined;try{body=input.body===undefined?undefined:JSON.stringify(input.body);}catch{throw new OpenCodeV2Error("OPENCODE_REQUEST_INVALID");}if(body!==undefined&&Buffer.byteLength(body)>1_048_576)throw new OpenCodeV2Error("OPENCODE_REQUEST_TOO_LARGE");
    const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),5_000);const signal=()=>abort.abort();originalSignal?.addEventListener("abort",signal,{once:true});if(originalSignal?.aborted)abort.abort();
    let abortHeaders:(()=>void)|undefined;
    try{
      if(abort.signal.aborted)throw new OpenCodeV2Error("OPENCODE_NATIVE_UNREACHABLE");
      const headers=await Promise.race([Promise.resolve().then(()=>this.headers?.()??{}),new Promise<never>((_,reject)=>{abortHeaders=()=>reject(new OpenCodeV2Error("OPENCODE_NATIVE_UNREACHABLE"));abort.signal.addEventListener("abort",abortHeaders,{once:true});})]);
      const options:RequestInit={method,redirect:"error",signal:abort.signal,headers:{...headers,...(body!==undefined?{"content-type":"application/json"}:{})},...(body!==undefined?{body}:{})};
      try{synchronousAdmission(beforeSend);}catch{throw new OpenCodeV2PreSendRejection();}
      if(abort.signal.aborted)throw new OpenCodeV2PreSendRejection();
      const response=await fetch(url,options);
      if(!response.ok)throw new OpenCodeV2Error(response.status===401||response.status===403?"OPENCODE_NATIVE_AUTH_REQUIRED":response.status===404?"OPENCODE_NATIVE_NOT_FOUND":"OPENCODE_NATIVE_REQUEST_FAILED");
      if(!response.body)throw new OpenCodeV2Error("OPENCODE_V2_SCHEMA_INVALID");const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
      try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>1_048_576)throw new OpenCodeV2Error("OPENCODE_RESPONSE_TOO_LARGE");chunks.push(next.value);}}finally{await reader.cancel().catch(()=>{});}
      try{return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;}catch{throw new OpenCodeV2Error("OPENCODE_V2_SCHEMA_INVALID");}
    }catch(error){if(error instanceof OpenCodeV2Error)throw error;throw new OpenCodeV2Error("OPENCODE_NATIVE_UNREACHABLE");}
    finally{clearTimeout(timer);originalSignal?.removeEventListener("abort",signal);if(abortHeaders)abort.signal.removeEventListener("abort",abortHeaders);}
  }
}

const record=(value:unknown):Record<string,unknown>=>{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new OpenCodeV2Error("OPENCODE_V2_SCHEMA_INVALID");
  return value as Record<string,unknown>;
};
const text=(value:unknown,max=512):value is string=>typeof value==="string"&&value.length>0&&value.length<=max&&Array.from(value).every(character=>character.charCodeAt(0)>=32&&character.charCodeAt(0)!==127);
const sessionId=(value:unknown):value is string=>text(value)&&/^ses[A-Za-z0-9_-]+$/.test(value);
const messageId=(value:unknown):value is string=>text(value)&&/^msg_[A-Za-z0-9_-]+$/.test(value);
const fingerprint=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
function model(value:unknown):OpenCodeV2Model {
  const r=record(value);if(!text(r.providerID)||!text(r.id)||r.variant!==undefined&&!text(r.variant))throw new OpenCodeV2Error("OPENCODE_V2_SCHEMA_INVALID");
  return {providerID:r.providerID,id:r.id,...(typeof r.variant==="string"?{variant:r.variant}:{})};
}
function permissions(value:unknown):OpenCodeV2Permission[] {
  if(!Array.isArray(value)||value.length>200)throw new OpenCodeV2Error("OPENCODE_V2_SCHEMA_INVALID");
  return value.map(item=>{const r=record(item);if(!text(r.action)||!text(r.resource)||typeof r.effect!=="string"||!["allow","deny","ask"].includes(r.effect))throw new OpenCodeV2Error("OPENCODE_V2_SCHEMA_INVALID");return {action:r.action,resource:r.resource,effect:r.effect as OpenCodeV2Permission["effect"]};});
}
interface SessionSnapshot {id:string;projectID:string;location:{directory:string};model?:OpenCodeV2Model;permissions?:OpenCodeV2Permission[];time:Record<string,unknown>}
function observedPolicy(snapshot:SessionSnapshot):Pick<NativeObservation,"reportedModel"|"permissionFingerprint"> {
  return {...(snapshot.model?{reportedModel:{nativeSelectionId:`${snapshot.model.providerID}/${snapshot.model.id}`,...(snapshot.model.variant?{reasoning:snapshot.model.variant}:{})}}:{}),...(snapshot.permissions?{permissionFingerprint:fingerprint(snapshot.permissions)}:{})};
}
interface DirectoryIdentity {path:string;dev:bigint;ino:bigint}
function directoryIdentity(path:string,code:string):DirectoryIdentity {
  try{const canonical=realpathSync(path),stat=statSync(canonical,{bigint:true});if(!stat.isDirectory())throw new Error();return {path:canonical,dev:stat.dev,ino:stat.ino};}
  catch{throw new OpenCodeV2Error(code);}
}

export class OpenCodeV2InteractionPort implements NativeInteractionPort {
  readonly eventContinuity="volatile";
  private readonly configuration:OpenCodeV2Scope;
  private readonly workspaceRoot:string;
  private readonly workspaceIdentity:DirectoryIdentity;
  private readonly serverTmpIdentity?:DirectoryIdentity;
  private readonly bindings=new Map<string,NativeBinding>();
  private readonly executionContexts=new Map<string,Extract<ExecutionContextRef,{kind:"managed-worktree"}>>();
  private projectIdentity?:string;
  private readonly policies=new Map<string,{model:OpenCodeV2Model;permissions:OpenCodeV2Permission[]}>();
  private readonly starts=new Map<string,{signature:string;result:Promise<{binding:NativeBinding;receipt:NativeCommandReceipt}>}>();
  private readonly commands=new Map<string,{signature:string;result:Promise<NativeCommandReceipt>}>();
  private readonly acceptedTurns=new Map<string,{binding:NativeBinding;nativeMessageId:string;prompt:string}>();
  private readonly read:OpenCodeV2Transport["request"];
  private serverIdentity?:string;
  private disconnected=false;
  private readonly observerEpoch=randomUUID();
  private observationSequence=0;
  constructor(scope:OpenCodeV2Scope,transport:OpenCodeV2Transport){
    if(![scope.profileId,scope.runnerId,scope.nativeStoreRef,scope.scopeFingerprint,scope.workspacePath].every(value=>text(value))||!isAbsolute(scope.workspacePath)||!["opencode-server-v2","opencode-cli-json"].includes(scope.backendId)||scope.protocolVersion!==undefined&&!isOpenCodeV2ProtocolVersion(scope.protocolVersion))throw new OpenCodeV2Error("OPENCODE_SCOPE_INVALID","not-created");
    try{this.workspaceIdentity=directoryIdentity(scope.workspacePath,"OPENCODE_SCOPE_INVALID");this.workspaceRoot=this.workspaceIdentity.path;}catch{throw new OpenCodeV2Error("OPENCODE_SCOPE_INVALID","not-created");}
    if(scope.server&&(!Number.isSafeInteger(scope.server.pid)||scope.server.pid<1||!text(scope.server.tmpDirectory)||!isAbsolute(scope.server.tmpDirectory)||!["owned","external"].includes(scope.server.ownership)||typeof scope.server.shared!=="boolean"))throw new OpenCodeV2Error("OPENCODE_SCOPE_INVALID","not-created");
    if(scope.server){try{this.serverTmpIdentity=directoryIdentity(scope.server.tmpDirectory,"OPENCODE_SCOPE_INVALID");}catch{throw new OpenCodeV2Error("OPENCODE_SCOPE_INVALID","not-created");}}
    this.configuration=structuredClone(scope);this.read=transport.request.bind(transport);
  }
  private assertScope():void {
    if(!isDeepStrictEqual(directoryIdentity(this.configuration.workspacePath,"OPENCODE_LOCATION_MISMATCH"),this.workspaceIdentity))throw new OpenCodeV2Error("OPENCODE_LOCATION_MISMATCH");
    if(this.serverTmpIdentity&&this.configuration.server&&!isDeepStrictEqual(directoryIdentity(this.configuration.server.tmpDirectory,"OPENCODE_SERVER_IDENTITY_CHANGED"),this.serverTmpIdentity))throw new OpenCodeV2Error("OPENCODE_SERVER_IDENTITY_CHANGED");
  }
  private scopeFailure():string|undefined {try{this.assertScope();}catch(error){return error instanceof OpenCodeV2Error?error.code:"OPENCODE_SCOPE_INVALID";}return undefined;}
  get scope():OpenCodeV2Scope {return structuredClone(this.configuration);}
  capabilities():InteractionCapabilities {
    const failure=this.scopeFailure();
    const unknown:CapabilityEvidence={version:1,support:"unknown",level:"documented",scopeFingerprint:this.configuration.scopeFingerprint,reasonCode:failure??"OPENCODE_RUNTIME_UNQUALIFIED"};
    const qualified=(name:"durableIdentity"|"historyRead"|"sameSessionContinue"|"observeExternalChanges"|"interruptTurn")=>{
      if(failure)return {...unknown};
      const supplied=this.configuration.evidence?.[name];return supplied&&assessInteractionCapability(supplied,this.configuration.scopeFingerprint,"runtime-verified").supported?structuredClone(supplied):{...unknown};
    };
    return {version:1,durableIdentity:qualified("durableIdentity"),historyRead:qualified("historyRead"),sameSessionContinue:qualified("sameSessionContinue"),observeExternalChanges:qualified("observeExternalChanges"),liveSteer:{...unknown},interruptTurn:this.configuration.server&&this.interruptWithoutResume.support==="supported"?qualified("interruptTurn"):{...unknown},nativeApproval:{...unknown},releaseControl:{...unknown},reclaimControl:{...unknown},restartReattach:{...unknown},surfaces:{}};
  }
  get interruptWithoutResume():CapabilityEvidence {
    const failure=this.scopeFailure();const supplied=failure?undefined:this.configuration.interruptWithoutResume;
    return supplied&&assessInteractionCapability(supplied,this.configuration.scopeFingerprint,"runtime-verified").supported?structuredClone(supplied):{version:1,support:"unknown",level:"documented",scopeFingerprint:this.configuration.scopeFingerprint,reasonCode:failure??"OPENCODE_INTERRUPT_UNQUALIFIED"};
  }
  /** An event gap revokes local write admission; read-only reconciliation remains available. */
  markDisconnected():void {this.disconnected=true;}
  async drainLocalCallbacks():Promise<void> {
    this.markDisconnected();
    await Promise.allSettled([...this.starts.values(),...this.commands.values()].map(command=>command.result));
  }
  private captureExecutionContext(ref:ExecutionContextRef,binding:Pick<NativeBinding,"executionRefId"|"runnerId">):Extract<ExecutionContextRef,{kind:"managed-worktree"}> {
    const captured=structuredClone(ref);
    if(!isExecutionContextRef(captured)||captured.kind!=="managed-worktree"||captured.id!==binding.executionRefId||captured.runnerId!==binding.runnerId||captured.runnerId!==this.configuration.runnerId)throw new OpenCodeV2Error("OPENCODE_BINDING_SCOPE_CHANGED");
    return captured;
  }
  registerBinding(ref:NativeBinding,executionRef?:ExecutionContextRef):void {
    ref=structuredClone(ref);
    const context=executionRef===undefined?undefined:this.captureExecutionContext(executionRef,ref);
    const c=this.configuration;
    if(ref.version!==1||ref.product!=="opencode"||ref.region!=="global"||ref.profileId!==c.profileId||ref.runnerId!==c.runnerId||ref.nativeStoreRef!==c.nativeStoreRef||ref.backendId!==c.backendId||ref.identityState!=="bound"||!sessionId(ref.nativeSessionId)||!text(ref.executionRefId)||ref.nativeThreadId!==undefined||ref.parentSessionId!==undefined)throw new OpenCodeV2Error("OPENCODE_BINDING_SCOPE_CHANGED");
    const current=this.bindings.get(ref.nativeSessionId);if(current&&!isDeepStrictEqual(current,ref))throw new OpenCodeV2Error("OPENCODE_BINDING_SCOPE_CHANGED");
    if(current&&context&&!isDeepStrictEqual(this.executionContexts.get(ref.nativeSessionId),context))throw new OpenCodeV2Error("OPENCODE_BINDING_SCOPE_CHANGED");
    if(!current&&context)this.executionContexts.set(ref.nativeSessionId,context);
    this.bindings.set(ref.nativeSessionId,structuredClone(ref));
  }
  private binding(ref:NativeBinding):NativeBinding {
    this.assertScope();
    if(!isDeepStrictEqual(this.bindings.get(ref.nativeSessionId),ref))throw new OpenCodeV2Error("OPENCODE_BINDING_SCOPE_CHANGED");return structuredClone(ref);
  }
  private async request(input:OpenCodeV2Request):Promise<unknown>{
    this.assertScope();
    const signal=input.signal;if(signal?.aborted)throw new OpenCodeV2Error("OPENCODE_NATIVE_UNREACHABLE");
    try {const result=await this.read(input);this.assertScope();if(signal?.aborted)throw new OpenCodeV2Error("OPENCODE_NATIVE_UNREACHABLE");return result;}catch(error){if(error instanceof OpenCodeV2Error)throw error;throw new OpenCodeV2Error("OPENCODE_NATIVE_UNREACHABLE");}
  }
  private admitWrite(guard:(()=>void)|undefined,ref?:NativeBinding):void {
    this.assertScope();if(this.disconnected)throw new OpenCodeV2Error("OPENCODE_RECONCILIATION_REQUIRED");if(ref)this.binding(ref);
    synchronousAdmission(guard);
    this.assertScope();if(this.disconnected)throw new OpenCodeV2Error("OPENCODE_RECONCILIATION_REQUIRED");if(ref)this.binding(ref);
  }
  private async verifyServerIdentity(signal?:AbortSignal):Promise<void>{
    const r=record(await this.request({method:"GET",path:"/api/info",...(signal?{signal}:{})}));
    if(r.version!==(this.configuration.protocolVersion??opencodeV2ProtocolVersion))throw new OpenCodeV2Error("OPENCODE_VERSION_UNSUPPORTED");
    if(!Number.isSafeInteger(r.pid)||Number(r.pid)<0||!Array.isArray(r.urls)||!text(record(r.paths).tmp))throw new OpenCodeV2Error("OPENCODE_V2_SCHEMA_INVALID");
    const tmp=String(record(r.paths).tmp);const expected=this.configuration.server;
    if(expected){
      try{if(r.pid!==expected.pid||!isDeepStrictEqual(directoryIdentity(tmp,"OPENCODE_SERVER_IDENTITY_CHANGED"),this.serverTmpIdentity))throw new Error();}
      catch{throw new OpenCodeV2Error("OPENCODE_SERVER_IDENTITY_CHANGED");}
    }
    const identity=fingerprint([r.version,r.pid,this.serverTmpIdentity?.path??tmp]);
    if(this.serverIdentity&&identity!==this.serverIdentity){this.markDisconnected();throw new OpenCodeV2Error("OPENCODE_SERVER_IDENTITY_CHANGED");}
    this.serverIdentity=identity;
  }
  private async handshake(signal?:AbortSignal):Promise<string>{
    await this.verifyServerIdentity(signal);
    const location=record(await this.request({method:"GET",path:"/api/location",query:{"location[directory]":this.configuration.workspacePath},...(signal?{signal}:{})}));
    this.location(location);
    const project=record(location.project);if(!text(project.id)||!text(project.directory)||!text(project.canonical))throw new OpenCodeV2Error("OPENCODE_V2_SCHEMA_INVALID");
    if(this.projectIdentity!==undefined&&project.id!==this.projectIdentity){this.markDisconnected();throw new OpenCodeV2Error("OPENCODE_LOCATION_MISMATCH");}
    this.projectIdentity=project.id;
    return project.id;
  }
  async readModels(signal?:AbortSignal):Promise<OpenCodeV2ModelSnapshot>{
    if(this.disconnected)throw new OpenCodeV2Error("OPENCODE_RECONCILIATION_REQUIRED");
    const projectId=await this.handshake(signal),query={"location[directory]":this.configuration.workspacePath};
    const read=async(path:string)=>{if(this.disconnected)throw new OpenCodeV2Error("OPENCODE_RECONCILIATION_REQUIRED");const response=record(await this.request({method:"GET",path,query,...(signal?{signal}:{})}));if(this.disconnected)throw new OpenCodeV2Error("OPENCODE_RECONCILIATION_REQUIRED");this.location(response.location);const project=record(response.location).project;if(project!==undefined&&record(project).id!==projectId)throw new OpenCodeV2Error("OPENCODE_LOCATION_MISMATCH");return response.data;};
    let first:unknown[]=[];
    // Native model snapshots can precede initial plugin activation; only retry empty readonly snapshots.
    for(let attempt=0;attempt<10;attempt++){const value=await read("/api/model");if(!Array.isArray(value)||value.length>4000)throw new OpenCodeV2Error("OPENCODE_V2_SCHEMA_INVALID");first=value;if(first.length)break;if(attempt<9)await delay(100,undefined,signal?{signal}:{});}
    if(!first.length)throw new OpenCodeV2Error("OPENCODE_MODEL_CATALOG_NOT_READY");
    const defaultModel=await read("/api/model/default"),last=await read("/api/model");
    if(!Array.isArray(last)||fingerprint(first)!==fingerprint(last))throw new OpenCodeV2Error("OPENCODE_MODEL_CATALOG_CHANGED");
    if(await this.handshake(signal)!==projectId)throw new OpenCodeV2Error("OPENCODE_LOCATION_MISMATCH");
    if(this.disconnected)throw new OpenCodeV2Error("OPENCODE_RECONCILIATION_REQUIRED");
    return structuredClone({models:first,defaultModel,protocolVersion:this.configuration.protocolVersion??opencodeV2ProtocolVersion});
  }
  private location(value:unknown):void {
    const r=record(value);
    try{if(!text(r.directory)||!isAbsolute(r.directory)||resolve(realpathSync(r.directory))!==this.workspaceRoot||realpathSync(this.configuration.workspacePath)!==this.workspaceRoot)throw new Error();}
    catch{throw new OpenCodeV2Error("OPENCODE_LOCATION_MISMATCH");}
  }
  private session(value:unknown,expected?:string):SessionSnapshot {
    const r=record(record(value).data);if(!sessionId(r.id)||expected&&r.id!==expected||!text(r.projectID))throw new OpenCodeV2Error("OPENCODE_V2_SCHEMA_INVALID");
    if(this.projectIdentity===undefined||r.projectID!==this.projectIdentity)throw new OpenCodeV2Error("OPENCODE_OBSERVATION_CHANGED");
    this.location(r.location);const time=record(r.time);if(typeof time.created!=="number"||!Number.isFinite(time.created)||typeof time.updated!=="number"||!Number.isFinite(time.updated))throw new OpenCodeV2Error("OPENCODE_V2_SCHEMA_INVALID");
    return {id:r.id,projectID:r.projectID,location:{directory:this.configuration.workspacePath},time,...(r.model!==undefined?{model:model(r.model)}:{}),...(r.permissions!==undefined?{permissions:permissions(r.permissions)}:{})};
  }
  private async get(ref:NativeBinding,signal?:AbortSignal):Promise<SessionSnapshot>{
    this.binding(ref);return this.session(await this.request({method:"GET",path:`/api/session/${ref.nativeSessionId}`,...(signal?{signal}:{})}),ref.nativeSessionId);
  }
  async create(input:OpenCodeV2Start):Promise<{binding:NativeBinding;receipt:NativeCommandReceipt}>{
    input={...input};
    if(this.disconnected)throw new OpenCodeV2Error("OPENCODE_RECONCILIATION_REQUIRED","not-created");
    if(this.configuration.backendId!=="opencode-server-v2"||!text(input.executionRefId)||!text(input.commandId,200)||typeof input.prompt!=="string"||!input.prompt.length||input.prompt.length>262_144||typeof input.onBinding!=="function"||input.beforePrompt!==undefined&&typeof input.beforePrompt!=="function"||input.onNativeEvent!==undefined&&typeof input.onNativeEvent!=="function")throw new OpenCodeV2Error("OPENCODE_START_INVALID","not-created");
    let selected:OpenCodeV2Model;let rules:OpenCodeV2Permission[];
    try{selected=model(input.model);rules=permissions(input.permissions);}catch{throw new OpenCodeV2Error("OPENCODE_START_INVALID","not-created");}
    if(input.executionRef!==undefined){try{input.executionRef=this.captureExecutionContext(input.executionRef,{executionRefId:input.executionRefId,runnerId:this.configuration.runnerId});}catch{throw new OpenCodeV2Error("OPENCODE_BINDING_SCOPE_CHANGED","not-created");}}
    const signature=fingerprint([input.executionRefId,input.executionRef,input.prompt,selected,rules]);const prior=this.starts.get(input.commandId);
    if(prior){if(prior.signature!==signature)throw new OpenCodeV2Error("OPENCODE_COMMAND_CONFLICT","not-created");return structuredClone(await prior.result);}
    const frozen={...input,model:selected,permissions:rules};const result=this.createOnce(frozen);this.starts.set(input.commandId,{signature,result});return structuredClone(await result);
  }
  private async createOnce(input:OpenCodeV2Start):Promise<{binding:NativeBinding;receipt:NativeCommandReceipt}>{
    try{await this.handshake();await this.verifyServerIdentity();if(this.disconnected)throw new OpenCodeV2Error("OPENCODE_RECONCILIATION_REQUIRED");}catch(error){throw new OpenCodeV2Error(error instanceof OpenCodeV2Error?error.code:"OPENCODE_NATIVE_UNREACHABLE","not-created");}
    const beforeSend=()=>this.admitWrite(input.beforePrompt);
    try{beforeSend();}catch{throw new OpenCodeV2Error("OPENCODE_START_ADMISSION_REJECTED","not-created");}
    let snapshot:SessionSnapshot;
    try{snapshot=this.session(await this.request({method:"POST",path:"/api/session",body:{location:{directory:this.configuration.workspacePath},model:input.model,permissions:input.permissions},beforeSend}));}catch(error){if(error instanceof OpenCodeV2PreSendRejection)throw new OpenCodeV2Error("OPENCODE_START_ADMISSION_REJECTED","not-created");throw new OpenCodeV2Error("OPENCODE_CREATE_OUTCOME_UNKNOWN");}
    const c=this.configuration;const ref:NativeBinding={version:1,product:"opencode",region:"global",profileId:c.profileId,runnerId:c.runnerId,backendId:c.backendId,nativeStoreRef:c.nativeStoreRef,nativeSessionId:snapshot.id,executionRefId:input.executionRefId,identityState:"bound"};
    this.registerBinding(ref,input.executionRef);
    try{await input.onBinding(structuredClone(ref));}catch{this.markDisconnected();throw new OpenCodeV2Error("OPENCODE_BINDING_PERSISTENCE_UNKNOWN");}
    if(this.disconnected)throw new OpenCodeV2Error("OPENCODE_RECONCILIATION_REQUIRED");
    this.binding(ref);
    await this.persistEvent(input.onNativeEvent,{state:"waiting",nativeSessionId:ref.nativeSessionId,observedAt:new Date().toISOString()});
    this.admitWrite(undefined,ref);
    if(!snapshot.model||snapshot.model.providerID!==input.model.providerID||snapshot.model.id!==input.model.id||input.model.variant!==undefined&&snapshot.model.variant!==input.model.variant||!isDeepStrictEqual(snapshot.permissions??[],input.permissions))throw new OpenCodeV2Error("OPENCODE_NATIVE_POLICY_DRIFT");
    // A native-default request may resolve to a concrete variant. Freeze that result;
    // subsequent continuation must not silently adopt a different default.
    this.policies.set(ref.nativeSessionId,{model:structuredClone(snapshot.model),permissions:structuredClone(input.permissions)});
    const receipt=await this.prompt(ref,input.commandId,input.prompt,input.beforePrompt);
    if(receipt.state==="accepted")await this.persistEvent(input.onNativeEvent,{state:"received",nativeSessionId:ref.nativeSessionId,observedAt:new Date().toISOString()});
    return {binding:ref,receipt};
  }
  private async persistEvent(sink:OpenCodeV2Start["onNativeEvent"],fact:NativeTurnFact):Promise<void> {
    try{await sink?.(fact);}catch{this.markDisconnected();throw new OpenCodeV2Error("OPENCODE_BINDING_PERSISTENCE_UNKNOWN");}
  }
  readHandle(ref:NativeBinding):NativeReadHandle {
    const binding=this.binding(ref);return {binding,scopeFingerprint:this.configuration.scopeFingerprint,inspect:request=>this.inspect(binding,request)};
  }
  async inspect(ref:NativeBinding,request?:NativeReadRequest):Promise<NativeObservation>{
    request=request?{...request}:undefined;
    const selected=this.binding(ref);await this.handshake(request?.signal);const snapshot=structuredClone(await this.get(selected,request?.signal));
    const active=record(record(await this.request({method:"GET",path:"/api/session/active",...(request?.signal?{signal:request.signal}:{})})).data);
    for(const [id,value] of Object.entries(active)){if(!sessionId(id)||record(value).type!=="running")throw new OpenCodeV2Error("OPENCODE_V2_SCHEMA_INVALID");}
    const pending=record(await this.request({method:"GET",path:`/api/session/${selected.nativeSessionId}/permission`,...(request?.signal?{signal:request.signal}:{})}));if(!Array.isArray(pending.data))throw new OpenCodeV2Error("OPENCODE_V2_SCHEMA_INVALID");
    await this.handshake(request?.signal);const current=await this.get(selected,request?.signal);this.binding(selected);
    if(!isDeepStrictEqual(current,snapshot))throw new OpenCodeV2Error("OPENCODE_OBSERVATION_CHANGED");
    return {version:1,id:request?.requestId??randomUUID(),nativeSessionId:selected.nativeSessionId,scopeFingerprint:this.configuration.scopeFingerprint,executionRefId:selected.executionRefId,observedAt:new Date().toISOString(),...(this.serverIdentity?{serverEpoch:this.serverIdentity}:{}),state:active[selected.nativeSessionId]?"running":"idle",pendingTools:"unknown",pendingApprovals:pending.data.length?"present":"none",historyMode:"snapshot-only",readability:"readable",...observedPolicy(snapshot)};
  }
  async history(ref:NativeBinding,inputRequest:HistoryRequest,readRequest?:NativeReadRequest):Promise<HistoryPage>{
    const selected=this.binding(ref),input={limit:inputRequest.limit,cursor:inputRequest.cursor},signal=readRequest?.signal;
    if(!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>100||input.cursor!==undefined&&!text(input.cursor,4096))throw new OpenCodeV2Error("OPENCODE_HISTORY_REQUEST_INVALID");
    await this.handshake(signal);await this.get(selected,signal);
    const response=record(await this.request({method:"GET",path:`/api/session/${selected.nativeSessionId}/message`,query:{limit:String(input.limit),...(input.cursor?{cursor:input.cursor}:{order:"asc"})},...(signal?{signal}:{})}));
    await this.get(selected,signal);await this.handshake(signal);this.binding(selected);
    if(!Array.isArray(response.data)||response.data.length>input.limit)throw new OpenCodeV2Error("OPENCODE_V2_SCHEMA_INVALID");
    const cursor=record(response.cursor);if([cursor.previous,cursor.next].some(value=>value!==undefined&&value!==null&&!text(value,4096)))throw new OpenCodeV2Error("OPENCODE_V2_SCHEMA_INVALID");
    const gaps:string[]=[];const ids=new Set<string>();
    const entries=response.data.map((value):NativeHistoryEntry=>{
      const r=record(value);const time=record(r.time);if(!messageId(r.id)||ids.has(r.id)||!text(r.type)||typeof time.created!=="number"||!Number.isFinite(time.created)||!Number.isFinite(new Date(time.created).getTime()))throw new OpenCodeV2Error("OPENCODE_V2_SCHEMA_INVALID");ids.add(r.id);
      let kind:NativeHistoryEntry["kind"]="other";let content:string;
      if(r.type==="user"&&typeof r.text==="string"){kind="user";content=r.text;if(Array.isArray(r.files)&&r.files.length)gaps.push("OPENCODE_HISTORY_CONTENT_UNSUPPORTED");}
      else if(r.type==="assistant"&&Array.isArray(r.content)){
        kind="assistant";const parts:string[]=[];
        for(const item of r.content){const part=record(item);if(["text","reasoning"].includes(String(part.type))&&typeof part.text==="string")parts.push(part.text);else gaps.push("OPENCODE_HISTORY_CONTENT_UNSUPPORTED");}content=parts.join("\n");
      }else if(r.type==="idle"&&["succeeded","failed","interrupted"].includes(String(r.outcome)))content=`Native idle: ${String(r.outcome)}`;
      else {content=`Native message: ${r.type}`;gaps.push("OPENCODE_HISTORY_CONTENT_UNSUPPORTED");}
      const truncated=content.length>16_384;if(truncated)gaps.push("HISTORY_CONTENT_TRUNCATED");
      return {id:r.id,kind,text:content.slice(0,16_384),occurredAt:new Date(time.created).toISOString(),...(truncated?{truncated:true}:{})};
    });
    if(cursor.previous)gaps.push("OPENCODE_HISTORY_EARLIER_PAGE");if(cursor.next)gaps.push("HISTORY_MORE_PAGES");
    return {version:1,nativeSessionId:selected.nativeSessionId,entries,source:"opencode",state:"available",range:"native-history",completeness:gaps.length?"partial":"complete",...(typeof cursor.next==="string"?{nextCursor:cursor.next}:{}),...(gaps.length?{gaps:[...new Set(gaps)]}:{})};
  }
  async continueTurn(ref:NativeBinding,request:Parameters<NonNullable<NativeInteractionPort["continueTurn"]>>[1],beforePrompt?:(()=>void)):Promise<NativeCommandReceipt>{
    const selected=this.binding(ref);const fence=request.fence;
    if(!fence||request.commandId!==fence.commandId||![fence.runId,fence.sessionId,fence.expectedCurrentRunId,fence.leaseId,request.commandId].every(value=>text(value))||![fence.generation,fence.expectedTaskRevision,fence.expectedControlRevision,fence.expectedControlEpoch].every(value=>Number.isSafeInteger(value)&&value>=1)||typeof request.message!=="string"||!request.message.length||request.message.length>262_144)throw new OpenCodeV2Error("OPENCODE_COMMAND_INVALID");
    if(!assessInteractionCapability(this.capabilities().sameSessionContinue,this.configuration.scopeFingerprint,"runtime-verified").supported)throw new OpenCodeV2Error("NATIVE_CAPABILITY_UNVERIFIED");
    const signature=fingerprint([selected,request]);const prior=this.commands.get(request.commandId);if(prior){if(prior.signature!==signature)throw new OpenCodeV2Error("OPENCODE_COMMAND_CONFLICT");return structuredClone(await prior.result);}
    const result=this.prompt(selected,request.commandId,request.message,beforePrompt);this.commands.set(request.commandId,{signature,result});return structuredClone(await result);
  }
  private async prompt(ref:NativeBinding,commandId:string,prompt:string,beforePrompt?:(()=>void)):Promise<NativeCommandReceipt>{
    if(this.disconnected)throw new OpenCodeV2Error("OPENCODE_RECONCILIATION_REQUIRED");
    const prior=this.acceptedTurns.get(commandId);
    if(prior){if(!isDeepStrictEqual(prior.binding,ref)||prior.prompt!==prompt)throw new OpenCodeV2Error("OPENCODE_COMMAND_CONFLICT");return {version:1,commandId,state:"accepted",nativeMessageId:prior.nativeMessageId};}
    await this.handshake();const current=await this.get(ref);const policy=this.policies.get(ref.nativeSessionId);
    if(!policy||!isDeepStrictEqual(current.model,policy.model)||!isDeepStrictEqual(current.permissions??[],policy.permissions))throw new OpenCodeV2Error("OPENCODE_NATIVE_POLICY_DRIFT");
    const active=record(record(await this.request({method:"GET",path:"/api/session/active"})).data);
    const inbox=record(await this.request({method:"GET",path:`/api/session/${ref.nativeSessionId}/inbox`}));if(!Array.isArray(inbox.data))throw new OpenCodeV2Error("OPENCODE_V2_SCHEMA_INVALID");
    if(active[ref.nativeSessionId]||inbox.data.length)throw new OpenCodeV2Error("OPENCODE_SESSION_BUSY");
    const approvals=record(await this.request({method:"GET",path:`/api/session/${ref.nativeSessionId}/permission`}));
    if(!Array.isArray(approvals.data))throw new OpenCodeV2Error("OPENCODE_V2_SCHEMA_INVALID");
    if(approvals.data.length)throw new OpenCodeV2Error("OPENCODE_APPROVAL_PENDING");
    await this.verifyServerIdentity();if(this.disconnected)throw new OpenCodeV2Error("OPENCODE_RECONCILIATION_REQUIRED");this.binding(ref);
    const beforeSend=()=>this.admitWrite(beforePrompt,ref);beforeSend();
    try{
      const r=record(record(await this.request({method:"POST",path:`/api/session/${ref.nativeSessionId}/prompt`,body:{text:prompt,delivery:"queue",resume:true},beforeSend})).data);
      const timestamp=record(r.time).created;
      if(!messageId(r.id)||r.sessionID!==ref.nativeSessionId||r.type!=="user"||r.delivery!=="queue"||record(r.payload).text!==prompt||typeof timestamp!=="number"||!Number.isFinite(timestamp))throw new OpenCodeV2Error("OPENCODE_V2_SCHEMA_INVALID");
      await this.get(ref);await this.handshake();this.acceptedTurns.set(commandId,{binding:structuredClone(ref),nativeMessageId:r.id,prompt});return {version:1,commandId,state:"accepted",nativeMessageId:r.id};
    }catch(error){return {version:1,commandId,state:error instanceof OpenCodeV2PreSendRejection?"rejected":"unknown",code:error instanceof OpenCodeV2PreSendRejection?"OPENCODE_PROMPT_ADMISSION_REJECTED":"OPENCODE_PROMPT_OUTCOME_UNKNOWN"};}
  }

  /** The durable idle marker settles this accepted input; an idle read alone does not. */
  async readTurn(ref:NativeBinding,commandId:string,request?:{signal?:AbortSignal}):Promise<OpenCodeV2TurnResult> {
    const selected=this.binding(ref),accepted=this.acceptedTurns.get(commandId),signal=request?.signal;
    if(!accepted||!isDeepStrictEqual(accepted.binding,selected))throw new OpenCodeV2Error("OPENCODE_TURN_RECEIPT_UNAVAILABLE");
    if(this.disconnected)throw new OpenCodeV2Error("OPENCODE_RECONCILIATION_REQUIRED");
    await this.handshake(signal);const initial=await this.get(selected,signal),policy=this.policies.get(selected.nativeSessionId);
    if(!policy||!isDeepStrictEqual(initial.model,policy.model)||!isDeepStrictEqual(initial.permissions??[],policy.permissions))throw new OpenCodeV2Error("OPENCODE_NATIVE_POLICY_DRIFT");
    const initialTime=structuredClone(initial.time),pending:OpenCodeV2TurnResult={state:"pending",nativeSessionId:selected.nativeSessionId,nativeMessageId:accepted.nativeMessageId};
    let found=false,priorTurnContent=false,terminal:{id:string;outcome:"succeeded"|"failed"|"interrupted"}|undefined,summary="",unsettled=false,cursor:string|undefined;
    const ids=new Set<string>(),cursors=new Set<string>();
    for(let page=0;page<20;page++){
      const response=record(await this.request({method:"GET",path:`/api/session/${selected.nativeSessionId}/message`,query:{limit:"100",...(cursor?{cursor}:{order:"asc"})},...(signal?{signal}:{})}));
      if(!Array.isArray(response.data)||response.data.length>100)throw new OpenCodeV2Error("OPENCODE_V2_SCHEMA_INVALID");
      const pagination=record(response.cursor);if([pagination.previous,pagination.next].some(value=>value!==undefined&&value!==null&&!text(value,4096)))throw new OpenCodeV2Error("OPENCODE_V2_SCHEMA_INVALID");
      for(const value of response.data){
        const message=record(value),time=record(message.time);
        if(!messageId(message.id)||ids.has(message.id)||!text(message.type)||typeof time.created!=="number"||!Number.isFinite(time.created)||!Number.isFinite(new Date(time.created).getTime()))throw new OpenCodeV2Error("OPENCODE_V2_SCHEMA_INVALID");ids.add(message.id);
        if(message.id===accepted.nativeMessageId){if(message.type!=="user"||message.text!==accepted.prompt)throw new OpenCodeV2Error("OPENCODE_TURN_IDENTITY_CHANGED");if(priorTurnContent)throw new OpenCodeV2Error("OPENCODE_EXTERNAL_INPUT_CONFLICT");found=true;continue;}
        if(!found){
          if(message.type==="idle"){if(!["succeeded","failed","interrupted"].includes(String(message.outcome)))throw new OpenCodeV2Error("OPENCODE_V2_SCHEMA_INVALID");priorTurnContent=false;}
          else priorTurnContent=true;
          continue;
        }
        if(["user","synthetic","skill","model-switched","location-switched","agent-switched"].includes(message.type))throw new OpenCodeV2Error("OPENCODE_EXTERNAL_INPUT_CONFLICT");
        if(message.type==="idle"){
          if(!["succeeded","failed","interrupted"].includes(String(message.outcome)))throw new OpenCodeV2Error("OPENCODE_V2_SCHEMA_INVALID");
          terminal??={id:message.id,outcome:message.outcome as "succeeded"|"failed"|"interrupted"};
        }else if(message.type==="assistant"){
          if(!Array.isArray(message.content)||time.completed!==undefined&&(typeof time.completed!=="number"||!Number.isFinite(time.completed)||time.completed<time.created))throw new OpenCodeV2Error("OPENCODE_V2_SCHEMA_INVALID");
          unsettled ||= time.completed===undefined;
          for(const value of message.content){const part=record(value);
            if(part.type==="text"&&typeof part.text==="string")summary=(summary+part.text).slice(-2_000);
            else if(part.type==="reasoning"&&typeof part.text==="string")continue;
            else if(part.type==="tool"){const state=record(part.state);if(!["streaming","running","completed","error"].includes(String(state.status)))throw new OpenCodeV2Error("OPENCODE_V2_SCHEMA_INVALID");unsettled ||= state.status==="streaming"||state.status==="running";}
            else throw new OpenCodeV2Error("OPENCODE_V2_SCHEMA_INVALID");
          }
        }else if(message.type==="shell"||message.type==="compaction"){
          const states=message.type==="shell"?["running","exited","timeout","killed"]:["running","completed","failed"];
          if(!states.includes(String(message.status)))throw new OpenCodeV2Error("OPENCODE_V2_SCHEMA_INVALID");unsettled ||= message.status==="running";
        }else if(message.type!=="system")throw new OpenCodeV2Error("OPENCODE_V2_SCHEMA_INVALID");
      }
      if(!pagination.next)break;
      if(cursors.has(pagination.next as string))throw new OpenCodeV2Error("OPENCODE_V2_SCHEMA_INVALID");cursors.add(pagination.next as string);cursor=pagination.next as string;
      if(page===19)throw new OpenCodeV2Error("OPENCODE_TURN_HISTORY_LIMIT");
    }
    const active=record(record(await this.request({method:"GET",path:"/api/session/active",...(signal?{signal}:{})})).data);
    for(const [id,value] of Object.entries(active)){if(!sessionId(id)||record(value).type!=="running")throw new OpenCodeV2Error("OPENCODE_V2_SCHEMA_INVALID");}
    const inbox=record(await this.request({method:"GET",path:`/api/session/${selected.nativeSessionId}/inbox`,...(signal?{signal}:{})}));
    const approvals=record(await this.request({method:"GET",path:`/api/session/${selected.nativeSessionId}/permission`,...(signal?{signal}:{})}));
    if(!Array.isArray(inbox.data)||!Array.isArray(approvals.data))throw new OpenCodeV2Error("OPENCODE_V2_SCHEMA_INVALID");
    await this.handshake(signal);const current=await this.get(selected,signal);this.binding(selected);
    if(this.disconnected)throw new OpenCodeV2Error("OPENCODE_RECONCILIATION_REQUIRED");
    if(!isDeepStrictEqual(current.model,policy.model)||!isDeepStrictEqual(current.permissions??[],policy.permissions))throw new OpenCodeV2Error("OPENCODE_NATIVE_POLICY_DRIFT");
    if(!isDeepStrictEqual(current.time,initialTime)||!found||!terminal||unsettled||active[selected.nativeSessionId]||inbox.data.length||approvals.data.length)return pending;
    return {...pending,state:terminal.outcome,nativeTerminalMessageId:terminal.id,...(summary?{summary}:{})};
  }

  private validateCommand(commandId:string,fence:MutationFence):void {
    if(!fence||commandId!==fence.commandId||!text(commandId,200)||![fence.runId,fence.sessionId,fence.expectedCurrentRunId,fence.leaseId].every(value=>text(value))||fence.runId!==fence.expectedCurrentRunId||![fence.generation,fence.expectedTaskRevision,fence.expectedControlRevision,fence.expectedControlEpoch].every(value=>Number.isSafeInteger(value)&&value>=1))throw new OpenCodeV2Error("OPENCODE_COMMAND_INVALID");
  }

  async interrupt(ref:NativeBinding,request:InterruptRequest):Promise<NativeCommandReceipt> {
    const selected=this.binding(ref);this.validateCommand(request.commandId,request.fence);
    // This API has no atomic turn-id compare; never substitute a session-only interrupt.
    if(request.activeTurnId!==undefined)throw new OpenCodeV2Error("OPENCODE_TURN_INTERRUPT_UNSUPPORTED");
    const signature=fingerprint(["interrupt",selected,request]);const prior=this.commands.get(request.commandId);
    if(prior){if(prior.signature!==signature)throw new OpenCodeV2Error("OPENCODE_COMMAND_CONFLICT");return structuredClone(await prior.result);}
    if(this.disconnected)throw new OpenCodeV2Error("OPENCODE_RECONCILIATION_REQUIRED");
    if(!assessInteractionCapability(this.capabilities().interruptTurn,this.configuration.scopeFingerprint,"runtime-verified").supported)throw new OpenCodeV2Error("NATIVE_CAPABILITY_UNVERIFIED");
    const result=this.interruptOnce(selected,structuredClone(request));this.commands.set(request.commandId,{signature,result});return structuredClone(await result);
  }
  private async interruptOnce(ref:NativeBinding,request:InterruptRequest):Promise<NativeCommandReceipt> {
    await this.handshake();await this.get(ref);await this.verifyServerIdentity();this.binding(ref);
    const beforeSend=()=>{
      this.admitWrite(undefined,ref);
      if(!assessInteractionCapability(this.capabilities().interruptTurn,this.configuration.scopeFingerprint,"runtime-verified").supported)throw new OpenCodeV2Error("NATIVE_CAPABILITY_UNVERIFIED");
    };
    try{
      try{beforeSend();}catch{throw new OpenCodeV2PreSendRejection();}
      const response=record(await this.request({method:"POST",path:`/api/session/${ref.nativeSessionId}/interrupt`,query:{resume:"false"},beforeSend}));
      if(typeof response.interrupted!=="boolean")throw new OpenCodeV2Error("OPENCODE_V2_SCHEMA_INVALID");
      await this.get(ref);await this.handshake();
      return {version:1,commandId:request.commandId,state:"accepted",...(response.interrupted?{}:{code:"OPENCODE_INTERRUPT_IDLE_NOOP"})};
    }catch(error){
      if(error instanceof OpenCodeV2PreSendRejection)return {version:1,commandId:request.commandId,state:"rejected",code:"OPENCODE_INTERRUPT_ADMISSION_REJECTED"};
      this.markDisconnected();return {version:1,commandId:request.commandId,state:"unknown",code:"OPENCODE_INTERRUPT_OUTCOME_UNKNOWN"};
    }
  }

  async inspectQuiescence(ref:NativeBinding,request:{requestId:string;signal:AbortSignal}):Promise<{observation:NativeObservation;runtime:NativeQuiescenceRuntime}> {
    request={...request};
    const selected=this.binding(ref);if(!text(request.requestId))throw new OpenCodeV2Error("OPENCODE_COMMAND_INVALID");
    const sequence=++this.observationSequence;
    const inspect=this.inspect.bind(this),read={...request,observerEpoch:this.observerEpoch,sequence};
    const before=structuredClone(await inspect(selected,read));
    const readInbox=async()=>{
      const inbox=structuredClone(record(await this.request({method:"GET",path:`/api/session/${selected.nativeSessionId}/inbox`,signal:request.signal})));
      if(!Array.isArray(inbox.data)||inbox.data.some(item=>{const r=record(item);return !messageId(r.id)||r.sessionID!==selected.nativeSessionId||!text(r.type);}))throw new OpenCodeV2Error("OPENCODE_V2_SCHEMA_INVALID");
      return inbox.data;
    };
    const inbox=await readInbox();
    const observation=await inspect(selected,read);
    const currentInbox=await readInbox();
    const finalPolicy=observedPolicy(await this.get(selected,request.signal));await this.verifyServerIdentity(request.signal);
    if(!isDeepStrictEqual({...before,observedAt:observation.observedAt},observation)||!isDeepStrictEqual(inbox,currentInbox)||!isDeepStrictEqual(finalPolicy.reportedModel,observation.reportedModel)||finalPolicy.permissionFingerprint!==observation.permissionFingerprint)throw new OpenCodeV2Error("OPENCODE_OBSERVATION_CHANGED");
    observation.read={requestId:request.requestId,observerEpoch:this.observerEpoch,observerGeneration:1,sequence,processState:"unknown",readability:"readable"};
    const evidence=this.capabilities().interruptTurn;const host=this.configuration.server;
    return {observation,runtime:{version:1,binding:selected,scopeFingerprint:this.configuration.scopeFingerprint,observationRef:observation.id,pendingCommands:currentInbox.length?"present":"none",backgroundTools:"unknown",evidence,
      readProof:{kind:"live-native-read",requestId:request.requestId,evidence},processScope:{kind:"native-service",state:observation.state==="running"?"active":"unknown",evidence},
      host:{id:this.serverIdentity??"unknown",ownership:host?.ownership??"external",shared:host?.shared??"unknown",releaseBoundary:"session"}}};
  }

  async release(ref:NativeBinding,request:ReleaseRequest):Promise<ReleaseEvidence> {
    ref=structuredClone(ref);request=structuredClone(request);
    this.validateCommand(request.commandId,request.fence);if(!["wait","interrupt"].includes(request.settlePolicy))throw new OpenCodeV2Error("OPENCODE_COMMAND_INVALID");
    const result=await this.inspectQuiescence(ref,{requestId:randomUUID(),signal:new AbortController().signal});
    // Process-local idle leaves escaped/background jobs and other clients unproven.
    return {version:1,nativeSessionId:ref.nativeSessionId,quiescent:false,pendingCommands:result.runtime.pendingCommands,lockReleased:"unknown",exclusion:"cooperative",observation:result.observation,
      reasonCode:result.runtime.pendingCommands==="present"?"OPENCODE_PENDING_NATIVE_QUEUE":result.observation.state==="running"?"OPENCODE_SESSION_BUSY":"OPENCODE_BACKGROUND_TOOLS_UNQUALIFIED"};
  }

  async attach(ref:NativeBinding,request:AttachRequest):Promise<AttachEvidence> {
    ref=structuredClone(ref);request=structuredClone(request);
    this.validateCommand(request.commandId,request.fence);this.binding(ref);
    const original=this.executionContexts.get(ref.nativeSessionId);
    let selected:ReturnType<typeof freezeExecutionSelection>;
    try{selected=freezeExecutionSelection(request.executionSelection,{profileId:this.configuration.profileId,providerId:"opencode",backendId:this.configuration.backendId,selection:true,reasoning:true});}catch{throw new OpenCodeV2Error("OPENCODE_BINDING_SCOPE_CHANGED");}
    if(!original||!selected||!isDeepStrictEqual(request.executionRef,original)||!validateExecutionBinding({profileId:this.configuration.profileId,providerId:"opencode",backendId:this.configuration.backendId,runnerId:this.configuration.runnerId,executionRef:request.executionRef,nativeBinding:ref},selected,{repositoryId:original.repositoryId,baseRevision:original.baseRevision}).valid)throw new OpenCodeV2Error("OPENCODE_BINDING_SCOPE_CHANGED");
    const observation=await this.inspect(ref);
    const matches=selected.selectionType==="native-default"||observation.reportedModel?.nativeSelectionId===selected.requestedModel&&(selected.nativeParameters.reasoningEffort===undefined||observation.reportedModel?.reasoning===selected.nativeParameters.reasoningEffort);
    return {version:1,nativeSessionId:ref.nativeSessionId,attached:false,method:"unknown",observation,reasonCode:matches?"OPENCODE_RECLAIM_UNQUALIFIED":"OPENCODE_NATIVE_POLICY_DRIFT"};
  }
}
