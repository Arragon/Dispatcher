import {isGitDeliveryTarget} from "@dispatcher/domain";
import type {ExecutionSelection,GitDeliveryTarget,ModelCatalogContext} from "@dispatcher/domain";
/** Additive capability on transport v1.2; health-only peers never receive native commands. */
export const NATIVE_EXECUTION_CAPABILITY="native-execution-v1";
export const NATIVE_GIT_DELIVERY_CAPABILITY="native-git-delivery-v1";
export interface NativeWorkspacePlan {
  repositoryId:string;taskId:string;runId:string;attempt:number;baseRef:string;scopePaths:string[];baseCommit?:string;targetBranch?:string;
}
export interface NativeStartDescriptor {version:1;profileId:string;workspaceId:string;prompt:string;selection:Omit<ExecutionSelection,"routingDecision">}
export type NativeDeliveryIntent={type:"none"}|{type:"commit";message:string}|{type:"pull-request";message:string;target:GitDeliveryTarget};
export type NativeRunAction="status"|"result"|"usage"|"diagnostics"|"send"|"pause"|"resume"|"cancel";
export type NativeCommandPayload=
  |{type:"native.repository";repositoryId:string;baseRef:string;scopePaths:string[];targetBranch?:string}
  |{type:"native.repository_delivery";repositoryId:string}
  |{type:"native.repository_refs";repositoryId:string;offset:number;limit:number}
  |{type:"native.workspace_plan";profileId:string;plan:NativeWorkspacePlan}
  |{type:"native.workspace_prepare";runId:string;profileId:string;plan:NativeWorkspacePlan;verificationCommandIds:string[];delivery?:NativeDeliveryIntent}
  |{type:"native.model_catalog";profileId:string;repositoryId:string;runId?:string;reason:ModelCatalogContext["reason"]}
  |{type:"native.profile_probe";profileId:string;repositoryId?:string}
  |{type:"native.run";runId:string;action:NativeRunAction;message?:string}
  |{type:"native.run_verify";runId:string}
  |{type:"native.run_push";runId:string}
  |{type:"native.run_commit";runId:string}
  |{type:"native.run_files";runId:string}
  |{type:"native.run_finalize";runId:string};
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==="object"&&!Array.isArray(value));
const keys=(value:Record<string,unknown>,required:string[],optional:string[]=[])=>required.every(key=>key in value)&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
const id=(value:unknown,max=200):value is string=>typeof value==="string"&&value.trim().length>0&&value.length<=max&&Array.from(value).every(character=>character.codePointAt(0)!>=32);
const ids=(value:unknown,max=200):value is string[]=>Array.isArray(value)&&value.length<=max&&value.every(item=>id(item))&&new Set(value).size===value.length;
function scopes(value:unknown):boolean{return Array.isArray(value)&&value.length<=200&&value.every(item=>id(item,4000)&&!/^[/\\]|^[a-z]:/i.test(item)&&!item.split(/[\\/]/).some(segment=>segment===".."||segment===".git"));}
function workspace(value:unknown):value is NativeWorkspacePlan{return object(value)&&keys(value,["repositoryId","taskId","runId","attempt","baseRef","scopePaths"],["baseCommit","targetBranch"])&&[value.repositoryId,value.taskId,value.runId,value.baseRef].every(item=>id(item))&&Number.isSafeInteger(value.attempt)&&Number(value.attempt)>0&&Number(value.attempt)<=1000&&scopes(value.scopePaths)&&(value.baseCommit===undefined||id(value.baseCommit))&&(value.targetBranch===undefined||id(value.targetBranch));}
function delivery(value:unknown):boolean{return object(value)&&(value.type==="none"?keys(value,["type"]):["commit","pull-request"].includes(String(value.type))&&keys(value,value.type==="commit"?["type","message"]:["type","message","target"])&&typeof value.message==="string"&&value.message.trim().length>0&&value.message.length<=1000&&!value.message.includes(String.fromCharCode(0))&&(value.type!=="pull-request"||isGitDeliveryTarget(value.target)));}
export function requiresNativeGitDelivery(payload:{type:string;delivery?:NativeDeliveryIntent}):boolean{return ["native.repository_delivery","native.run_commit","native.run_push"].includes(payload.type)||payload.type==="native.workspace_prepare"&&Boolean(payload.delivery&&payload.delivery.type!=="none");}
function selection(value:unknown):boolean {
  if(!object(value)||!keys(value,["version","mode","source","profileId","runnerId","providerId","backendId","selectionType","nativeParameters","contextFingerprint","configRevision","selectedAt"],["requestedModel","catalogRevision"])||value.version!==1||!["manual","policy-auto","legacy"].includes(String(value.mode))||!["explicit","account-default","policy","native-default","legacy-config"].includes(String(value.source))||!["explicit-model","native-default"].includes(String(value.selectionType))||![value.profileId,value.runnerId,value.providerId,value.backendId,value.contextFingerprint].every(item=>id(item))||!Number.isSafeInteger(value.configRevision)||Number(value.configRevision)<0||typeof value.selectedAt!=="string"||!Number.isFinite(Date.parse(value.selectedAt))||!object(value.nativeParameters)||Object.keys(value.nativeParameters).length>20)return false;
  if(!Object.entries(value.nativeParameters).every(([key,value])=>id(key,100)&&(typeof value==="string"&&value.length<=4000||typeof value==="boolean"||typeof value==="number"&&Number.isFinite(value))))return false;
  if(value.mode==="policy-auto"&&(value.source!=="policy"||value.selectionType!=="explicit-model"))return false;
  return value.selectionType==="explicit-model"?id(value.requestedModel)&&id(value.catalogRevision):value.requestedModel===undefined&&Object.keys(value.nativeParameters).length===0;
}
export function isNativeExecutionCommand(payload:{type:string;execution?:unknown}):boolean{return payload.type.startsWith("native.")||payload.type==="run.start"&&payload.execution!==undefined;}
export function validateNativeExecutionCommand(payload:Record<string,unknown>,authority:{runnerId?:unknown;leaseId?:unknown;generation?:unknown;leaseExpiresAt?:unknown}):boolean {
  const fenced=()=>id(authority.leaseId)&&Number.isSafeInteger(authority.generation)&&Number(authority.generation)>0&&typeof authority.leaseExpiresAt==="string"&&Number.isFinite(Date.parse(authority.leaseExpiresAt));
  switch(payload.type){
    case "native.repository":return keys(payload,["type","repositoryId","baseRef","scopePaths"],["targetBranch"])&&id(payload.repositoryId)&&id(payload.baseRef)&&scopes(payload.scopePaths)&&(payload.targetBranch===undefined||id(payload.targetBranch));
    case "native.repository_delivery":return keys(payload,["type","repositoryId"])&&id(payload.repositoryId);
    case "native.repository_refs":return keys(payload,["type","repositoryId","offset","limit"])&&id(payload.repositoryId)&&Number.isSafeInteger(payload.offset)&&Number(payload.offset)>=0&&Number(payload.offset)<=10_000&&Number.isSafeInteger(payload.limit)&&Number(payload.limit)>=1&&Number(payload.limit)<=100;
    case "native.workspace_plan":return keys(payload,["type","profileId","plan"])&&id(payload.profileId)&&workspace(payload.plan);
    case "native.workspace_prepare":return keys(payload,["type","runId","profileId","plan","verificationCommandIds"],["delivery"])&&id(payload.runId)&&id(payload.profileId)&&workspace(payload.plan)&&payload.plan.runId===payload.runId&&ids(payload.verificationCommandIds)&&(payload.delivery===undefined||delivery(payload.delivery))&&fenced();
    case "native.model_catalog":return keys(payload,["type","profileId","repositoryId","reason"],["runId"])&&id(payload.profileId)&&id(payload.repositoryId)&&["open","selection-change","preflight","before-start","manual-refresh"].includes(String(payload.reason))&&(payload.runId===undefined||id(payload.runId)&&fenced());
    case "native.profile_probe":return keys(payload,["type","profileId"],["repositoryId"])&&id(payload.profileId)&&(payload.repositoryId===undefined||id(payload.repositoryId));
    case "native.run":return keys(payload,["type","runId","action"],payload.action==="send"?["message"]:[])&&id(payload.runId)&&["status","result","usage","diagnostics","send","pause","resume","cancel"].includes(String(payload.action))&&(payload.action!=="send"||typeof payload.message==="string"&&payload.message.length>0&&payload.message.length<=20000)&&fenced();
    case "native.run_push":case "native.run_commit":case "native.run_verify":case "native.run_files":case "native.run_finalize":return keys(payload,["type","runId"])&&id(payload.runId)&&fenced();
    case "run.start":{
      const execution=payload.execution;
      return keys(payload,["type","runId","execution"])&&id(payload.runId)&&object(execution)&&keys(execution,["version","profileId","workspaceId","prompt","selection"])&&execution.version===1&&id(execution.profileId)&&execution.workspaceId===payload.runId&&typeof execution.prompt==="string"&&execution.prompt.length>0&&execution.prompt.length<=128000&&selection(execution.selection)&&object(execution.selection)&&execution.selection.profileId===execution.profileId&&execution.selection.runnerId===authority.runnerId&&fenced();
    }
    default:return false;
  }
}
