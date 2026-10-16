import type { AccountModelCatalog, NativeParameter } from "./publication.js";

export interface KeywordGroup { any:string[]; all:string[]; exclude:string[] }
export interface TaskTypeDefinition { id:string; name:string; definition:string; enabled:boolean; keywordGroups:KeywordGroup[] }
export type NativeReasoning = {mode:"native-default"} | {mode:"explicit";value:string};
export interface ModelRoutingTarget {modelSelectionId:string;reasoning:NativeReasoning}
export interface ModelRoutingRule {id:string;name:string;enabled:boolean;taskTypeId:string;profileId:string;repositoryId?:string;priority:number;target:ModelRoutingTarget}
export interface TaskModelRoutingConfig {
  enabled:boolean;requireConfirmation:boolean;classificationMode:"keyword"|"hybrid";semanticFailureMode:"stop"|"unique-keyword";
  taskTypes:TaskTypeDefinition[];rules:ModelRoutingRule[];
}
export interface KeywordEvidence {taskTypeId:string;keyword:string;field:"title"|"description";quote:string;start:number;end:number}
export interface TaskClassification {status:"matched"|"ambiguous"|"unclassified";primaryType:string|null;candidates:string[];evidence:KeywordEvidence[]}
export interface RoutingRuleResult {
  status:"matched"|"NO_MATCHING_RULE"|"RULE_CONFLICT";ruleIds:string[];excluded:Array<{ruleId:string;reason:string}>;
  scope?:"project"|"global";priority?:number;target?:ModelRoutingTarget;
}
export interface SemanticClassification {
  status:"matched"|"ambiguous"|"unclassified";primaryType:string|null;candidates:string[];
  evidence:Array<{field:"title"|"prompt";quote:string}>;explanation:string;
}
export interface ModelRoutingDecision {
  version:1;id:string;actorId:string;clientDraftId:string;inputHash:string;repositoryId:string;profileId:string;
  configRevision:number;policyVersion:string;typeVersion:string;ruleVersions:Record<string,string>;
  classification:{source:"keyword"|"semantic"|"hybrid"|"user";keyword:TaskClassification;semantic?:SemanticClassification;taskTypeId?:string;failure?:{code:string;message:string};degraded?:boolean};
  ruleResult:RoutingRuleResult;catalog?:AccountModelCatalog;
  target?:{modelId:string;nativeParameters:Record<string,NativeParameter>};
  status:"ready"|"needs-input";error?:{code:string;message:string};
  confirmation:{required:boolean;mode:"pending"|"policy-exempt"|"user-confirmed";actorId?:string;confirmedAt?:string};
  createdAt:string;expiresAt:string;
}
export const disabledModelRouting:TaskModelRoutingConfig={enabled:false,requireConfirmation:true,classificationMode:"keyword",semanticFailureMode:"stop",taskTypes:[],rules:[]};
const identifier={type:"string",minLength:1,maxLength:100,pattern:"^[a-zA-Z0-9][a-zA-Z0-9._:-]*$"} as const;
const keywords={type:"array",maxItems:30,uniqueItems:true,items:{type:"string",minLength:1,maxLength:128,pattern:"\\S"}} as const;
export const taskModelRoutingSchema={
  type:"object",additionalProperties:false,required:["enabled","requireConfirmation","classificationMode","semanticFailureMode","taskTypes","rules"],
  properties:{
    enabled:{type:"boolean",default:false},requireConfirmation:{type:"boolean",default:true},classificationMode:{enum:["keyword","hybrid"],default:"keyword"},semanticFailureMode:{enum:["stop","unique-keyword"],default:"stop"},
    taskTypes:{type:"array",maxItems:100,items:{type:"object",additionalProperties:false,required:["id","name","definition","enabled","keywordGroups"],properties:{id:identifier,name:{type:"string",minLength:1,maxLength:100},definition:{type:"string",minLength:1,maxLength:1000},enabled:{type:"boolean",default:true},keywordGroups:{type:"array",maxItems:100,items:{type:"object",additionalProperties:false,required:["any","all","exclude"],properties:{any:keywords,all:keywords,exclude:keywords},anyOf:[{properties:{any:{minItems:1}}},{properties:{all:{minItems:1}}}]}}}}},
    rules:{type:"array",maxItems:100,items:{type:"object",additionalProperties:false,required:["id","name","enabled","taskTypeId","profileId","priority","target"],properties:{id:identifier,name:{type:"string",minLength:1,maxLength:100},enabled:{type:"boolean",default:true},taskTypeId:identifier,profileId:identifier,repositoryId:identifier,priority:{type:"integer",minimum:-1000000,maximum:1000000},target:{type:"object",additionalProperties:false,required:["modelSelectionId","reasoning"],properties:{modelSelectionId:{type:"string",minLength:1,maxLength:200},reasoning:{oneOf:[{type:"object",additionalProperties:false,required:["mode"],properties:{mode:{const:"native-default"}}},{type:"object",additionalProperties:false,required:["mode","value"],properties:{mode:{const:"explicit"},value:{type:"string",minLength:1,maxLength:128}}}]}}}}}},
  },
} as const;
