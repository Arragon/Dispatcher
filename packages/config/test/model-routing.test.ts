import { expect, it } from "vitest";
import { defaultDispatcherConfig, validateConfig } from "../src/schema.js";
const routing={enabled:true,requireConfirmation:true,classificationMode:"keyword",semanticFailureMode:"stop",taskTypes:[{id:"docs",name:"Documentation",definition:"Docs",enabled:true,keywordGroups:[{any:["readme"],all:[],exclude:[]}]}],rules:[{id:"docs-rule",name:"Docs",enabled:true,taskTypeId:"docs",profileId:"account",priority:0,target:{modelSelectionId:"model",reasoning:{mode:"native-default"}}}]};
function candidate(){const config=structuredClone(defaultDispatcherConfig);config.agentProfiles=[{id:"account",alias:"Account",provider:"generic-cli",runnerId:"local",settings:{}}];return {...config,policies:{...config.policies,modelRouting:structuredClone(routing)}};}
it("accepts opt-in routing and preserves old configuration round trips without injecting rules",()=>{
  expect(validateConfig(defaultDispatcherConfig)).toEqual(defaultDispatcherConfig);
  expect(validateConfig(candidate())).toMatchObject({policies:{modelRouting:routing}});
});
it.each(["empty-group","unknown-type","unknown-profile","unknown-repository","duplicate-rule","duplicate-type","regex","keyword-limit","rules-limit"])("rejects invalid policy configuration: %s",kind=>{
  const config=candidate(),route=config.policies.modelRouting;
  if(kind==="empty-group")route.taskTypes[0]!.keywordGroups=[{any:[],all:[],exclude:["x"]}];
  if(kind==="unknown-type")route.rules[0]!.taskTypeId="missing";
  if(kind==="unknown-profile")route.rules[0]!.profileId="missing";
  if(kind==="unknown-repository")Object.assign(route.rules[0]!,{repositoryId:"missing"});
  if(kind==="duplicate-rule")route.rules.push(route.rules[0]!);
  if(kind==="duplicate-type")route.taskTypes.push(route.taskTypes[0]!);
  if(kind==="regex")Object.assign(route.taskTypes[0]!.keywordGroups[0]!,{regex:".*"});
  if(kind==="keyword-limit")route.taskTypes[0]!.keywordGroups[0]!.any=["x".repeat(129)];
  if(kind==="rules-limit")route.rules=Array.from({length:101},(_,i)=>({...route.rules[0]!,id:`rule-${i}`}));
  expect(()=>validateConfig(config)).toThrow();
});
