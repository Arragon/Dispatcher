import {expect,it} from "vitest";
import {DispatcherDatabase} from "@dispatcher/persistence";
import {ConfigurationEngine,defaultDispatcherConfig,validateConfig} from "../src/index.js";

const interaction={mode:"compatible",backendId:"pi-rpc",executionLocation:"managed-worktree"};
function candidate(){return {...structuredClone(defaultDispatcherConfig),agentProfiles:[{id:"pi-local",alias:"Pi",provider:"pi",runnerId:"local",nativeInteraction:{...interaction},settings:{executable:"/native/bin/pi",agentDirectory:"/native/pi/agent",sessionDirectory:"/native/pi/sessions",model:"provider/model"} as Record<string,unknown>}]};}

it("round-trips explicit Pi RPC configuration without probing native resources",()=>{
 const config=candidate();expect(validateConfig(config)).toEqual(config);
});
it("preserves a default Pi print profile without RPC settings",()=>{
 const config={...structuredClone(defaultDispatcherConfig),agentProfiles:[{id:"pi-local",alias:"Pi",provider:"pi",runnerId:"local",settings:{}}]};
 expect(validateConfig(config)).toEqual(config);
});
it.each([
 ["mode","native-session"],["mode","native-gui"],["mode","control"],
 ["backendId","pi-cli-json"],["backendId","copilot-rpc"],
 ["executionLocation","provider-cloud"],["executionLocation","provider-self-hosted"],
 ["surface","desktop"],["surface","tui"],["enabled",true],
])("rejects unqualified native interaction %s=%s",(field,value)=>{
 const config=candidate();Object.assign(config.agentProfiles[0]!.nativeInteraction,{[field]:value});
 expect(()=>validateConfig(config)).toThrow(/nativeInteraction/);
});
it.each(["codex","cursor","grok","opencode","copilot"])("rejects RPC opt-in for %s",provider=>{
 const config=candidate();config.agentProfiles[0]!.provider=provider;
 expect(()=>validateConfig(config)).toThrow(/Pi RPC/);
});
it("rejects a remote owning Runner",()=>{
 const config=candidate();config.runners.push({id:"remote",displayName:"Remote",mode:"remote",capacity:1,tags:[],credentialRef:"secret://runner/fixture/remote"});config.agentProfiles[0]!.runnerId="remote";
 expect(()=>validateConfig(config)).toThrow(/embedded/);
});
it.each(["executable","agentDirectory","sessionDirectory"])("requires an explicit absolute %s",field=>{
 for(const value of [undefined,"","relative/path","/native/\u0000unsafe","/native/\nunsafe","/"+"a".repeat(4096),42]){
  const config=candidate();config.agentProfiles[0]!.settings[field]=value;
  expect(()=>validateConfig(config),`${field}: ${String(value)}`).toThrow(new RegExp(field));
 }
});
it.each([undefined,"","model","/model","provider/","provider/model name"," provider/model","provider/model\u0000",42])("requires an explicit provider/model instead of %s",model=>{
 const config=candidate();config.agentProfiles[0]!.settings.model=model;
 expect(()=>validateConfig(config)).toThrow(/model/);
});
it.each([true,false])("rejects RPC approveTools=%s",approveTools=>{
 const config=candidate();config.agentProfiles[0]!.settings.approveTools=approveTools;
 expect(()=>validateConfig(config)).toThrow(/approveTools/);
});
it("keeps Pi native credentials outside ConfigPlan",()=>{
 const config=candidate();Object.assign(config.agentProfiles[0]!,{credentialRef:"secret://pi/fixture"});
 expect(()=>validateConfig(config)).toThrow(/native login/);
});
it("reviews RPC activation as a sensitive ConfigPlan before applying it",()=>{
 const database=new DispatcherDatabase(":memory:");
 try{
  const engine=new ConfigurationEngine(database),initial=candidate();Reflect.deleteProperty(initial.agentProfiles[0]!,"nativeInteraction");
  engine.applyPlan(engine.buildPlan(initial,"fixture","web").id,{confirmed:true});
  const plan=engine.buildPlan(candidate(),"fixture","web");expect(plan.risk).toBe("sensitive");expect(plan.requiresConfirmation).toBe(true);
  expect(()=>engine.applyPlan(plan.id)).toThrow(expect.objectContaining({code:"CONFIG_CONFIRMATION_REQUIRED"}));
  expect(engine.current().config.agentProfiles[0]).not.toHaveProperty("nativeInteraction");
  expect(engine.applyPlan(plan.id,{confirmed:true}).config.agentProfiles[0]!.nativeInteraction).toEqual(interaction);
 }finally{database.close();}
});
