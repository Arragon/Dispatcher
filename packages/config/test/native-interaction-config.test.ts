import { expect, it } from "vitest";
import { DispatcherDatabase } from "@dispatcher/persistence";
import { canMutate } from "@dispatcher/domain";
import { ConfigurationEngine, defaultDispatcherConfig, resolveInteractionRequirement, validateConfig } from "../src/index.js";
function configuration(){const config=structuredClone(defaultDispatcherConfig);config.agentProfiles=[{id:"p",provider:"generic",alias:"P",runnerId:"local"}];return config;}
it("keeps omitted configuration compatible and never enables a reserved disabled profile",()=>{
  const config=configuration();expect(validateConfig(config)).toEqual(config);
  expect(resolveInteractionRequirement(config,{profileId:"p"})).toMatchObject({mode:"compatible",executionLocation:"managed-worktree"});
  config.agentProfiles.push({id:"kite",provider:"generic",alias:"Kite",runnerId:"local",enabled:false});
  config.nativeInteraction={enabled:true};
  expect(()=>resolveInteractionRequirement(config,{profileId:"kite"})).toThrowError(expect.objectContaining({code:"PROFILE_UNAVAILABLE"}));
});
it("saves explicit backend and GUI policy through a confirmed ConfigPlan without cloud fallback",()=>{
  const database=new DispatcherDatabase(":memory:");const engine=new ConfigurationEngine(database);
  const config=configuration();config.nativeInteraction={enabled:true};config.agentProfiles[0] = {...config.agentProfiles[0]!,provider:"codex",settings:{executable:process.execPath,codexHome:"/tmp/dispatcher-config-native-fixture"},nativeInteraction:{mode:"native-gui",backendId:"codex-app-server",executionLocation:"managed-worktree",surface:"desktop"}};
  try{
    const plan=engine.buildPlan(config,"owner","api");expect(plan.risk).toBe("privileged");expect(plan.requiresConfirmation).toBe(true);
    expect(()=>engine.applyPlan(plan.id,{confirmed:false})).toThrow();engine.applyPlan(plan.id,{confirmed:true});
    const requirement=resolveInteractionRequirement(engine.current().config,{profileId:"p"});
    expect(requirement).toMatchObject({backendId:"codex-app-server",mode:"native-gui",surface:"desktop"});
    expect(()=>resolveInteractionRequirement(engine.current().config,{profileId:"p",mode:"compatible"})).toThrowError(expect.objectContaining({code:"NATIVE_REQUIREMENT_WEAKENED"}));
    expect(()=>resolveInteractionRequirement(config,{profileId:"p",executionLocation:"provider-cloud"})).toThrowError(expect.objectContaining({code:"EXECUTION_CONTEXT_DRIFT"}));
  }finally{database.close();}
});
it("rejects GUI requirements without a surface and keeps HUMAN locked when the feature is disabled",()=>{
  const config=configuration();config.nativeInteraction={enabled:false};
  config.agentProfiles[0] = {...config.agentProfiles[0]!,provider:"codex",settings:{executable:process.execPath,codexHome:"/tmp/dispatcher-config-native-fixture"},nativeInteraction:{mode:"native-gui",backendId:"codex-app-server",executionLocation:"managed-worktree"}};
  expect(()=>validateConfig(config)).toThrow();
  config.agentProfiles[0]!.nativeInteraction!.surface="desktop";expect(()=>resolveInteractionRequirement(config,{profileId:"p"})).toThrowError(expect.objectContaining({code:"NATIVE_INTERACTION_DISABLED"}));
  expect(canMutate({control:{version:1,sessionId:"s",activeRunId:"r",state:"HUMAN",epoch:2,revision:2,exclusion:"cooperative",updatedAt:"now"},run:{id:"r",sessionId:"s",state:"DELIVERING"},nativeState:"idle"},"deliver")).toEqual({allowed:false,code:"NATIVE_WRITE_LOCKED"});
});
it("includes removing the optional feature in the concrete ConfigPlan diff",()=>{
  const database=new DispatcherDatabase(":memory:");const engine=new ConfigurationEngine(database);
  try{const config=configuration();config.nativeInteraction={enabled:true};const first=engine.buildPlan(config,"owner","api");engine.applyPlan(first.id,{confirmed:true});const removed=structuredClone(engine.current().config);delete removed.nativeInteraction;const plan=engine.buildPlan(removed,"owner","api");expect(plan.changes).toContainEqual({op:"replace",path:"/nativeInteraction",before:{enabled:true},after:null});expect(plan.requiresConfirmation).toBe(true);}finally{database.close();}
});
