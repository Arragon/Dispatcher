import {expect,it} from "vitest";
import {DispatcherDatabase} from "@dispatcher/persistence";
import {ConfigurationEngine,configToJson,defaultDispatcherConfig,validateConfig} from "../src/index.js";

const configured=(profile?:unknown)=>({...structuredClone(defaultDispatcherConfig),repositories:[{id:"repo",root:"/fixture/repo",defaultBaseRef:"main",scopePaths:[],verificationCommands:["check","prepare-b","prepare-a"].map(id=>({id,file:"node",args:[],required:true,timeoutMs:1000,outputLimitBytes:1024})),...(profile===undefined?{}:{snapshotVerification:profile})}]});
const profile={version:1,id:"fixture-preparation",preparationCommandIds:["prepare-b","prepare-a"]};
it("preserves optional absence, explicit order and an empty preparation profile through validation and JSON",()=>{
 const legacy=validateConfig(configured());expect(legacy.repositories[0]).not.toHaveProperty("snapshotVerification");
 for(const value of [profile,{...profile,preparationCommandIds:[]},{...profile,id:"🙂".repeat(100)}]){
  const config=validateConfig(configured(value));expect(config.repositories[0]).toHaveProperty("snapshotVerification",value);
  expect(validateConfig(configToJson(config))).toEqual(config);
 }
});
it.each([
 {version:2,id:"fixture",preparationCommandIds:[]},
 {...profile,shell:"echo unsafe"},
 {...profile,id:""},{...profile,id:"x".repeat(101)},{...profile,id:"🙂".repeat(101)},
 {...profile,preparationCommandIds:["prepare-a","prepare-a"]},
 {...profile,preparationCommandIds:[""]},
 {...profile,preparationCommandIds:["missing"]},
 {version:1,id:"fixture"},{id:"fixture",preparationCommandIds:[]},
])("rejects invalid or unregistered snapshot preparation %j",value=>{expect(()=>validateConfig(configured(value))).toThrow();});
it("requires sensitive ConfigPlan confirmation and exports the applied ordered profile",()=>{
 const database=new DispatcherDatabase(":memory:"),engine=new ConfigurationEngine(database);
 try{
  const plan=engine.buildPlan(configured(profile),"owner","cli");expect(plan.risk).toBe("sensitive");expect(plan.requiresConfirmation).toBe(true);
  expect(()=>engine.applyPlan(plan.id)).toThrow(expect.objectContaining({code:"CONFIG_CONFIRMATION_REQUIRED"}));
  expect(engine.current().config.repositories).toEqual([]);
  engine.applyPlan(plan.id,{confirmed:true});
  const exported=validateConfig(engine.exportRedacted());expect(exported.repositories[0]).toHaveProperty("snapshotVerification",profile);
  expect(validateConfig(configToJson(exported))).toEqual(exported);
 }finally{database.close();}
});
