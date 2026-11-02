import {isDeepStrictEqual} from "node:util";
import {capturePricingSnapshot,type ExecutionSelection} from "@dispatcher/domain";
import {AdapterContractError,type AdapterSession} from "./contracts.js";

const text=(value:unknown):value is string=>typeof value==="string"&&value.length>0&&value.length<=240&&!Array.from(value).some(character=>character.charCodeAt(0)<32||character.charCodeAt(0)===127);
const fail=(code:string,message:string):never=>{throw new AdapterContractError(code,message);};

/** Validate at the owning adapter before native preparation; keep one immutable choice. */
export function freezeExecutionSelection(value:ExecutionSelection|undefined,owner:{profileId:string;providerId:string;backendId:string;selection:boolean;reasoning:boolean;legacyModel?:boolean}):ExecutionSelection|undefined{
  if(value===undefined)return;
  if(!value||typeof value!=="object"||value.version!==1||!text(value.profileId)||!text(value.providerId)||!text(value.backendId)||!text(value.runnerId)||!text(value.contextFingerprint)||!text(value.selectedAt)||!Number.isSafeInteger(value.configRevision)||value.configRevision<0||!value.nativeParameters||typeof value.nativeParameters!=="object"||Array.isArray(value.nativeParameters))return fail("EXECUTION_SELECTION_INVALID","Frozen execution selection is malformed");
  if(value.profileId!==owner.profileId||value.providerId!==owner.providerId||value.backendId!==owner.backendId)return fail("EXECUTION_SELECTION_CONTEXT_MISMATCH","Frozen selection belongs to another account or backend");
  const explicit=value.selectionType==="explicit-model",source=value.source;
  if(!["manual","policy-auto","legacy"].includes(value.mode)||!["explicit-model","native-default"].includes(value.selectionType)||(value.mode==="policy-auto"?source!=="policy":value.mode==="legacy"?source!=="legacy-config":!["explicit","account-default","native-default"].includes(source)))return fail("EXECUTION_SELECTION_INVALID","Frozen selection provenance is malformed");
  if(explicit? !text(value.requestedModel)||source==="native-default" : value.requestedModel!==undefined||Object.keys(value.nativeParameters).length>0||!["native-default","legacy-config"].includes(source))return fail("EXECUTION_SELECTION_INVALID","Model choice contradicts native-default semantics");
  if(explicit&&!owner.selection&&!(value.mode==="legacy"&&owner.legacyModel))return fail("UNSUPPORTED_MODEL_SELECTION","This native backend cannot submit a model choice");
  if(Object.entries(value.nativeParameters).some(([key,value])=>!owner.reasoning||key!=="reasoningEffort"||!text(value)))return fail("UNSUPPORTED_NATIVE_PARAMETERS","This native backend cannot submit the requested parameters");
  if(value.pricingSnapshot!==undefined){try{if(!explicit||value.mode==="legacy")throw Error();capturePricingSnapshot(value.pricingSnapshot);}catch{return fail("PRICE_EVIDENCE_INVALID","Price requires a qualified explicit native model choice");}}
  return structuredClone(value);
}

export function assertSessionModelBinding(current:AdapterSession|undefined,expected:AdapterSession,reportedProviderSessionId?:string):void{
  for(const session of current?[current,expected]:[expected]){
    if(Object.hasOwn(session,"modelSelection"))fail("MODEL_LEGACY_REVIEW_REQUIRED","Legacy model selection requires source-specific reconciliation before continuation");
    if(session.executionSelection===undefined&&session.legacyModel===undefined)fail("MODEL_SNAPSHOT_UNKNOWN","Historical session model choice is unknown; review before continuation");
    if(session.legacyModel!==undefined&&(session.executionSelection!==undefined||!session.legacyModel||typeof session.legacyModel!=="object"||Array.isArray(session.legacyModel)||session.legacyModel.id!==undefined&&!text(session.legacyModel.id)))fail("EXECUTION_SELECTION_INVALID","Legacy default snapshot is malformed or conflicts with a current choice");
  }
  if(current&&!isDeepStrictEqual([current.execution,current.executionRef],[expected.execution,expected.executionRef]))fail("EXECUTION_CONTEXT_DRIFT","Stored execution context changed during native preparation");
  // The first completed turn may establish its native identity. Once learned,
  // neither another store callback nor a later turn may silently replace it.
  if(expected.providerSessionId!==undefined&&current?.providerSessionId!==expected.providerSessionId
    ||reportedProviderSessionId!==undefined&&[expected.providerSessionId,current?.providerSessionId].some(id=>id!==undefined&&id!==reportedProviderSessionId))fail("NATIVE_IDENTITY_CHANGED","The original provider session identity changed");
  const fields=(session:AdapterSession)=>[session.id,session.runId,session.profileId,session.backendId,session.workspacePath,session.executionSelection,session.legacyModel];
  if(!current||!isDeepStrictEqual(fields(current),fields(expected)))fail("MODEL_BINDING_DRIFT","Stored model binding changed during native preparation");
}
export function sessionModel(session:AdapterSession):string|undefined{
  return session.executionSelection?session.executionSelection.requestedModel:session.legacyModel?.id;
}
