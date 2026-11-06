import type { ModelRoutingDecision, SemanticClassification, TaskClassification, TaskModelRoutingConfig } from "@dispatcher/domain";
function object(value:unknown,keys:string[]):value is Record<string,unknown>{return Boolean(value&&typeof value==="object"&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>key in value));}
export function validateSemanticClassification(value:unknown,allowedTypes:string[],input:{title:string;description:string}):SemanticClassification {
  const fail=()=>{throw new Error("Classification response does not satisfy the task-type/evidence contract");};
  if(!object(value,["status","primaryType","candidates","evidence","explanation"]))return fail();
  if(!["matched","ambiguous","unclassified"].includes(String(value.status))||!Array.isArray(value.candidates)||!value.candidates.every(id=>typeof id==="string"&&allowedTypes.includes(id))||new Set(value.candidates).size!==value.candidates.length||!Array.isArray(value.evidence)||value.evidence.length>4||typeof value.explanation!=="string"||Array.from(value.explanation).length>300)return fail();
  if(value.status==="matched"&&(typeof value.primaryType!=="string"||!value.candidates.includes(value.primaryType)||!value.evidence.length))return fail();
  if(value.status==="ambiguous"&&(value.primaryType!==null||value.candidates.length<2||!value.evidence.length))return fail();
  if(value.status==="unclassified"&&(value.primaryType!==null||value.candidates.length))return fail();
  for(const evidence of value.evidence){
    if(!object(evidence,["field","quote"])||!["title","prompt"].includes(String(evidence.field))||typeof evidence.quote!=="string"||!evidence.quote.length||Array.from(evidence.quote).length>160||!(evidence.field==="title"?input.title:input.description).includes(evidence.quote))return fail();
  }
  return structuredClone(value) as unknown as SemanticClassification;
}
export function arbitrateClassification(keyword:TaskClassification,semantic:SemanticClassification|undefined,failure:{code:string;message:string}|undefined,failureMode:TaskModelRoutingConfig["semanticFailureMode"]):{source:ModelRoutingDecision["classification"]["source"];taskTypeId?:string;error?:string;degraded?:boolean} {
  if(failure||!semantic)return failureMode==="unique-keyword"&&keyword.candidates.length===1?{source:"keyword",taskTypeId:keyword.candidates[0]!,degraded:true}:{source:"hybrid",error:failure?.code??"SEMANTIC_CLASSIFIER_UNAVAILABLE"};
  if(semantic.status==="ambiguous")return {source:"hybrid",error:"TASK_TYPE_AMBIGUOUS"};
  if(semantic.status==="unclassified")return {source:"hybrid",error:keyword.candidates.length?"CLASSIFICATION_CONFLICT":"TASK_TYPE_UNCLASSIFIED"};
  if(keyword.candidates.length&&!keyword.candidates.includes(semantic.primaryType!))return {source:"hybrid",error:"CLASSIFICATION_CONFLICT"};
  return {source:keyword.candidates.length?"hybrid":"semantic",taskTypeId:semantic.primaryType!};
}
