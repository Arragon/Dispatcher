import { expect, it } from "vitest";
import { classifyKeywords, selectModelRoutingRule } from "../src/model-routing.js";
import type { TaskModelRoutingConfig, TaskTypeDefinition } from "@dispatcher/domain";
const types:TaskTypeDefinition[]=[{id:"docs",name:"Docs",definition:"Documentation",enabled:true,keywordGroups:[{any:["README","文档"],all:[],exclude:["不要文档"]}]},{id:"bug",name:"Bug",definition:"Fix defects",enabled:true,keywordGroups:[{any:["bug","修复"],all:["test"],exclude:["ignore"]}]}];
const rule=(id:string,priority=0,model="native",repositoryId?:string)=>({id,name:id,enabled:true,taskTypeId:"docs",profileId:"account",priority,target:{modelSelectionId:model,reasoning:{mode:"native-default" as const}},...(repositoryId?{repositoryId}:{})});
const config=(rules:TaskModelRoutingConfig["rules"]):TaskModelRoutingConfig=>({enabled:true,requireConfirmation:true,classificationMode:"keyword",semanticFailureMode:"stop",taskTypes:types,rules});
it("normalizes fullwidth case and spaces while preserving original evidence offsets",()=>{
  const input={title:"😀 ＲＥＡＤＭＥ",description:"keep raw\r\ncode"};const result=classifyKeywords(input,types);
  expect(result).toMatchObject({status:"matched",primaryType:"docs",candidates:["docs"]});
  const hit=result.evidence[0]!;expect(hit).toMatchObject({field:"title",quote:"ＲＥＡＤＭＥ",keyword:"README"});expect(input.title.slice(hit.start,hit.end)).toBe(hit.quote);
  expect(classifyKeywords({title:"unit\t  TEST",description:"修复"},types)).toMatchObject({status:"matched",primaryType:"bug"});
});
it("uses English boundaries and any/all/exclude without resolving ambiguity by hit count",()=>{
  expect(classifyKeywords({title:"debug test",description:""},types).status).toBe("unclassified");
  expect(classifyKeywords({title:"bug",description:""},types).status).toBe("unclassified");
  expect(classifyKeywords({title:"bug test ignore",description:""},types).status).toBe("unclassified");
  expect(classifyKeywords({title:"修复 bug test README",description:""},types)).toMatchObject({status:"ambiguous",primaryType:null,candidates:["bug","docs"]});
  expect(classifyKeywords({title:"不要文档",description:""},types).status).toBe("unclassified");
});
it("keeps project priority above global priority and reports excluded accounts",()=>{
  const result=selectModelRoutingRule(config([rule("global",100),rule("project",1,"local-model","repo"),{...rule("other",999),profileId:"other"}]),{repositoryId:"repo",profileId:"account",taskTypeId:"docs"});
  expect(result).toMatchObject({status:"matched",ruleIds:["project"],scope:"project",target:{modelSelectionId:"local-model"}});expect(result.excluded).toContainEqual({ruleId:"other",reason:"profile-mismatch"});
});
it("merges equal winning targets, rejects conflicts and never falls back to defaults",()=>{
  const context={repositoryId:"repo",profileId:"account",taskTypeId:"docs"};
  expect(selectModelRoutingRule(config([rule("z"),rule("a")]),context)).toMatchObject({status:"matched",ruleIds:["a","z"]});
  expect(selectModelRoutingRule(config([rule("a"),rule("b",0,"different")]),context)).toMatchObject({status:"RULE_CONFLICT",ruleIds:["a","b"]});
  expect(selectModelRoutingRule(config([]),context)).toMatchObject({status:"NO_MATCHING_RULE"});
  expect(selectModelRoutingRule(config([rule("invalid",10,"missing","repo"),rule("valid",0,"present")]),context)).toMatchObject({status:"matched",target:{modelSelectionId:"missing"}});
});
it("does not classify disabled types and supports complete-group OR",()=>{
  const alternatives=[{...types[0]!,keywordGroups:[{any:[],all:["write","guide"],exclude:[]},{any:["说明"],all:[],exclude:[]}]},{...types[1]!,enabled:false}];
  expect(classifyKeywords({title:"WRITE guide bug test",description:""},alternatives)).toMatchObject({status:"matched",primaryType:"docs"});
  expect(classifyKeywords({title:"说明",description:""},alternatives).status).toBe("matched");
});
