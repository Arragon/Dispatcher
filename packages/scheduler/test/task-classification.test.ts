import {expect,it} from "vitest";
import {arbitrateClassification,validateSemanticClassification} from "../src/task-classification.js";
import type {SemanticClassification,TaskClassification} from "@dispatcher/domain";
const keyword=(candidates:string[]):TaskClassification=>({status:candidates.length===1?"matched":candidates.length?"ambiguous":"unclassified",primaryType:candidates.length===1?candidates[0]!:null,candidates,evidence:[]});
const semantic=(status:SemanticClassification["status"],primaryType:string|null,candidates:string[]):SemanticClassification=>({status,primaryType,candidates,evidence:status==="unclassified"?[]:[{field:"prompt",quote:"修复"}],explanation:"任务目标"});
it.each([
  [[],semantic("matched","fix",["fix"]),"fix",undefined,"semantic"],
  [["fix"],semantic("matched","fix",["fix"]),"fix",undefined,"hybrid"],
  [["fix","ui"],semantic("matched","ui",["ui"]),"ui",undefined,"hybrid"],
  [["fix"],semantic("matched","ui",["ui"]),undefined,"CLASSIFICATION_CONFLICT","hybrid"],
  [[],semantic("ambiguous",null,["fix","ui"]),undefined,"TASK_TYPE_AMBIGUOUS","hybrid"],
  [["fix"],semantic("ambiguous",null,["fix","ui"]),undefined,"TASK_TYPE_AMBIGUOUS","hybrid"],
  [[],semantic("unclassified",null,[]),undefined,"TASK_TYPE_UNCLASSIFIED","hybrid"],
  [["fix"],semantic("unclassified",null,[]),undefined,"CLASSIFICATION_CONFLICT","hybrid"],
] as const)("arbitrates keyword/semantic evidence without guessing (%j)",(candidates,result,taskTypeId,error,source)=>{
  expect(arbitrateClassification(keyword([...candidates]),result,undefined,"stop")).toMatchObject({source,...(taskTypeId?{taskTypeId}:{}),...(error?{error}:{})});
});
it("permits failure downgrade only for an explicitly configured unique keyword",()=>{
  expect(arbitrateClassification(keyword(["fix"]),undefined,{code:"TIMEOUT",message:"Timed out"},"unique-keyword")).toMatchObject({source:"keyword",taskTypeId:"fix",degraded:true});
  for(const candidates of [[],["fix","ui"]])expect(arbitrateClassification(keyword(candidates),undefined,{code:"TIMEOUT",message:"Timed out"},"unique-keyword").taskTypeId).toBeUndefined();
  expect(arbitrateClassification(keyword(["fix"]),undefined,{code:"TIMEOUT",message:"Timed out"},"stop").taskTypeId).toBeUndefined();
});
it("validates exact output keys, enabled type IDs, original evidence, Unicode length and status invariants",()=>{
  const good=semantic("matched","fix",["fix"]),input={title:"🧪标题",description:"修复正文"};
  expect(validateSemanticClassification(good,["fix","ui"],input)).toEqual(good);
  for(const bad of [{...good,model:"admin"},{...good,candidates:["unknown"]},{...good,candidates:["fix","fix"]},{...good,evidence:[]},{...good,primaryType:null},{...good,evidence:[{field:"prompt",quote:"not in input"}]},{...good,evidence:[{field:"prompt",quote:"修复",authority:true}]},{...good,explanation:"😀".repeat(301)},semantic("ambiguous","fix",["fix","ui"]),semantic("unclassified",null,["fix"])])expect(()=>validateSemanticClassification(bad,["fix","ui"],input)).toThrow();
});
