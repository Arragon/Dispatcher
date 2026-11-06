import {expect,it} from "vitest";
import {DispatcherDatabase} from "@dispatcher/persistence";
import {ConfigurationEngine,defaultDispatcherConfig,validateConfig} from "../src/index.js";

const interaction={mode:"compatible",backendId:"codex-app-server",executionLocation:"managed-worktree"};
function candidate(){return {...structuredClone(defaultDispatcherConfig),agentProfiles:[{id:"codex-local",alias:"Codex",provider:"codex",runnerId:"local",nativeInteraction:{...interaction},settings:{executable:"/native/bin/codex",codexHome:"/native/codex"} as Record<string,unknown>}]};}
it("preserves an explicit compatible App Server profile without probing native resources",()=>{
 const config=candidate();expect(validateConfig(config)).toEqual(config);expect(config.agentProfiles[0]!.settings).not.toHaveProperty("model");
});
it("preserves the omitted interaction as the existing Codex exec registration",()=>{
 const config=candidate();Reflect.deleteProperty(config.agentProfiles[0]!,"nativeInteraction");config.agentProfiles[0]!.settings.executable="codex";expect(validateConfig(config)).toEqual(config);
});
it.each([["mode","native-session"],["mode","native-gui"],["backendId","codex-exec-json"],["backendId","pi-rpc"],["executionLocation","provider-cloud"],["executionLocation","provider-self-hosted"],["surface","desktop"]])("rejects unqualified Codex interaction %s=%s",(field,value)=>{
 const config=candidate();Object.assign(config.agentProfiles[0]!.nativeInteraction,{[field]:value});expect(()=>validateConfig(config)).toThrow(/nativeInteraction/);
});
it.each(["pi","opencode","generic","cursor"])("rejects the Codex backend on provider %s",provider=>{
 const config=candidate();config.agentProfiles[0]!.provider=provider;expect(()=>validateConfig(config)).toThrow(/nativeInteraction/);
});
it("rejects an App Server profile on a remote owning Runner",()=>{
 const config=candidate();config.runners.push({id:"remote",displayName:"Remote",mode:"remote",capacity:1,tags:[],credentialRef:"secret://runner/fixture/remote"});config.agentProfiles[0]!.runnerId="remote";expect(()=>validateConfig(config)).toThrow(/embedded/);
});
it.each(["executable","codexHome"])("requires an explicit absolute Codex %s",field=>{
 for(const value of [undefined,"","relative/path","/native/\u0000unsafe","/native/\nunsafe","/"+"a".repeat(4096),42]){const config=candidate();config.agentProfiles[0]!.settings[field]=value;expect(()=>validateConfig(config),`${field}: ${String(value)}`).toThrow(new RegExp(field));}
});
it("keeps Codex native login outside ConfigPlan credential storage",()=>{
 const config=candidate();Object.assign(config.agentProfiles[0]!,{credentialRef:"secret://codex/fixture"});expect(()=>validateConfig(config)).toThrow(/native login/);
});
it("reviews native activation through a confirmed sensitive ConfigPlan",()=>{
 const database=new DispatcherDatabase(":memory:");try{const engine=new ConfigurationEngine(database),initial=candidate();Reflect.deleteProperty(initial.agentProfiles[0]!,"nativeInteraction");engine.applyPlan(engine.buildPlan(initial,"fixture","web").id,{confirmed:true});const plan=engine.buildPlan(candidate(),"fixture","web");expect(plan.risk).toBe("sensitive");expect(plan.requiresConfirmation).toBe(true);expect(()=>engine.applyPlan(plan.id)).toThrow(expect.objectContaining({code:"CONFIG_CONFIRMATION_REQUIRED"}));expect(engine.current().config.agentProfiles[0]).not.toHaveProperty("nativeInteraction");expect(engine.applyPlan(plan.id,{confirmed:true}).config.agentProfiles[0]!.nativeInteraction).toEqual(interaction);}finally{database.close();}
});
