import {assessInteractionRequirement,type AgentAdapter} from "@dispatcher/adapters";
import {InteractionRequirementError,resolveInteractionRequirement,type DispatcherConfig} from "@dispatcher/config";
import {isInteractionRequirement,type InteractionRequirement} from "@dispatcher/domain";
import {PublicationError} from "./task-publications.js";

export function assertFrozenInteractionRequirement(selection:{profileId:string;backendId:string;contextFingerprint:string;interactionRequirement?:InteractionRequirement},adapter:AgentAdapter):void {
 const requirement=selection.interactionRequirement;if(requirement===undefined)return;
 if(!isInteractionRequirement(requirement)||requirement.profileId!==selection.profileId||requirement.backendId!==selection.backendId)throw new PublicationError("EXECUTION_CONTEXT_DRIFT",409,"原生交互要求与冻结账号或后端不一致，请重新审阅。");
 const assessment=assessInteractionRequirement(adapter,requirement,selection.contextFingerprint);
 if(!assessment.supported)throw new PublicationError(assessment.code??"NATIVE_CAPABILITY_UNVERIFIED",409,"所需原生会话或界面能力尚未通过当前上下文验证；请保留要求或明确改选兼容执行。");
}
export function publicationInteraction(config:DispatcherConfig,adapter:AgentAdapter,profileId:string,input:unknown,backendId:string,scopeFingerprint:string):InteractionRequirement|undefined {
 if(input!==undefined&&(!isInteractionRequirement(input)||input.profileId!==profileId))throw new PublicationError("INVALID_INTERACTION_REQUIREMENT",400,"请重新选择原生交互要求。");
 if(input?.backendId!==undefined&&input.backendId!==backendId)throw new PublicationError("EXECUTION_CONTEXT_DRIFT",409,"实际模型目录后端已变化，请重新选择。");
 let requirement:InteractionRequirement;
 try{requirement=resolveInteractionRequirement(config,{profileId,backendId,...(input?{mode:input.mode,executionLocation:input.executionLocation,...(input.surface?{surface:input.surface}:{})}:{})});}
 catch(error){if(error instanceof InteractionRequirementError)throw new PublicationError(error.code,409,"此账号的原生交互要求当前不可用，请核对功能开关和账号设置。");throw error;}
 assertFrozenInteractionRequirement({profileId,backendId,contextFingerprint:scopeFingerprint,interactionRequirement:requirement},adapter);
 return input!==undefined||requirement.mode!=="compatible"?requirement:undefined;
}
