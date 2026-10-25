import {expect,it} from "vitest";
import {defaultDispatcherConfig, ConfigurationEngine} from "@dispatcher/config";
import {consoleConfig,applyConfigEdits,consoleConfigPlan,exportConsoleConfig} from "../src/config-edits.js";
import { DispatcherDatabase } from "@dispatcher/persistence";
function config(){const c=structuredClone(defaultDispatcherConfig);c.agentProfiles=[{id:"account",alias:"Account",provider:"codex",runnerId:"local",settings:{codexHome:"/private/account",configDir:"/private/config",model:"native"}}];return c;}
it("omits private native paths and exposes exact protected paths without placeholders",()=>{
  const view=consoleConfig(config());expect(JSON.stringify(view)).not.toContain("/private/");expect(view.config.agentProfiles[0]!.settings).toEqual({model:"native"});expect(view.protectedPaths).toContain("/agentProfiles/0/settings/codexHome");
});
it("changes a bound leaf while retaining private siblings and leaves the source immutable",()=>{
  const c=config(),next=applyConfigEdits(c,[{op:"replace",path:"/agentProfiles/0/alias",value:"Changed",entityId:"account"}]);expect(next.agentProfiles[0]).toMatchObject({alias:"Changed",settings:{codexHome:"/private/account",configDir:"/private/config"}});expect(c.agentProfiles[0]!.alias).toBe("Account");
  expect(applyConfigEdits(c,[{op:"replace",path:"/agentProfiles/0/settings/codexHome",value:"/explicit/new",entityId:"account"}]).agentProfiles[0]!.settings!.codexHome).toBe("/explicit/new");
});
it("rejects protected parent replacement, wrong entity identity and unsafe pointers atomically",()=>{
  const c=config();for(const edit of [
    {op:"replace",path:"/agentProfiles",value:[]},
    {op:"replace",path:"/agentProfiles/0/settings",value:{model:"new"},entityId:"account"},
    {op:"remove",path:"/agentProfiles/0/settings",entityId:"account"},
    {op:"replace",path:"/agentProfiles/0/alias",value:"wrong",entityId:"other"},
    {op:"replace",path:"/agentProfiles/0/alias",value:"missing identity"},
    {op:"add",path:"/agentProfiles/0/settings/__proto__/polluted",value:true,entityId:"account"},
    {op:"add",path:"/unknown/root",value:true},{op:"copy",path:"/policies",value:{}},{op:"add",path:"/policies/~3",value:true},
  ])expect(()=>applyConfigEdits(c,[{op:"replace",path:"/agentProfiles/0/alias",value:"partial",entityId:"account"},edit])).toThrow();expect(c.agentProfiles[0]!.alias).toBe("Account");expect(({} as Record<string,unknown>).polluted).toBeUndefined();
});
it("adds and removes identified entities and validates the final complete configuration",()=>{
  const c=config();expect(applyConfigEdits(c,[{op:"remove",path:"/agentProfiles/0",entityId:"account"}]).agentProfiles).toEqual([]);
  expect(()=>applyConfigEdits(c,[{op:"replace",path:"/agentProfiles/0/runnerId",value:"unknown",entityId:"account"}])).toThrow();
  expect(applyConfigEdits(c,[{op:"add",path:"/agentProfiles/-",value:{id:"second",alias:"Second",provider:"codex",runnerId:"local",settings:{codexHome:"/new"}}}]).agentProfiles).toHaveLength(2);
});

it("requires explicit account replacement instead of silently renaming persisted account identity",()=>{
 const c=config();c.agentProfiles[0]!.provider="cursor";c.agentProfiles[0]!.settings={model:"native"};for(const edit of [
 {op:"replace",path:"/agentProfiles/0/id",entityId:"account",value:"renamed"},
 {op:"replace",path:"/agentProfiles/0",entityId:"account",value:{...c.agentProfiles[0],id:"renamed"}},
 {op:"replace",path:"/agentProfiles",value:[{...c.agentProfiles[0],id:"renamed"}]},
 ])expect(()=>applyConfigEdits(c,[edit])).toThrow(expect.objectContaining({code:"CONFIG_ACCOUNT_ID_IMMUTABLE"}));
 expect(applyConfigEdits(c,[{op:"remove",path:"/agentProfiles/0",entityId:"account"},{op:"add",path:"/agentProfiles/-",value:{...c.agentProfiles[0],id:"new-account"}}]).agentProfiles[0]!.id).toBe("new-account");
});

it("builds revision-bound console edits through ConfigPlan and recovers safe plan status after reload",async()=>{
  const {mkdtempSync,rmSync}=await import("node:fs"),{tmpdir}=await import("node:os"),{join}=await import("node:path"),{ControllerService}=await import("../src/service.js");const directory=mkdtempSync(join(tmpdir(),"console-edits-"));
  const service=new ControllerService({dataDirectory:directory,ownerToken:"config-console-owner",secretStore:{test:async()=>false} as never});const headers={authorization:"Bearer config-console-owner"};
  try{
    service.configuration.applyPlan(service.configuration.buildPlan(config(),"test","cli").id,{confirmed:true});await service.start({listen:false});
    const read=(await service.app.inject({headers,url:"/api/config?view=console"})).json();expect(JSON.stringify(read)).not.toContain("/private/");expect(read.protectedPaths).toContain("/agentProfiles/0/settings/codexHome");
    expect((await service.app.inject({headers,method:"POST",url:"/api/agents/profiles/account/enabled",payload:{enabled:false,baseRevision:read.revision-1}})).statusCode).toBe(409);expect(service.configuration.current().config.agentProfiles[0]!.enabled).toBeUndefined();
    expect(JSON.stringify((await service.app.inject({headers,url:"/api/setup?view=console"})).json())).not.toContain("/private/");
    const preview=await service.app.inject({headers,method:"POST",url:"/api/agents/codex/profiles",payload:{id:"new",alias:"New",codexHome:"/private/new",baseRevision:read.revision,previewOnly:true}});expect(preview.statusCode).toBe(201);expect(JSON.stringify(preview.json())).not.toContain("/private/");
    const edit={op:"replace",path:"/agentProfiles/0/alias",value:"Safe alias",entityId:"account"};
    for(const body of [{edits:[edit]},{baseRevision:0,edits:[edit]},{baseRevision:read.revision,config:read.config,edits:[edit]}])expect((await service.app.inject({method:"POST",url:"/api/config/plans",headers,payload:body})).statusCode).toBeGreaterThanOrEqual(400);
    const built=await service.app.inject({method:"POST",url:"/api/config/plans",headers,payload:{baseRevision:read.revision,edits:[edit]}});expect(built.statusCode).toBe(201);expect(JSON.stringify(built.json())).not.toContain("/private/");
    const planId=built.json().plan.id;expect((await service.app.inject({url:`/api/config/plans/${planId}`,headers})).json()).toMatchObject({plan:{state:"PLANNED"},currentRevision:read.revision});
    await service.app.inject({method:"POST",url:`/api/config/plans/${planId}/apply?view=console`,headers,payload:{confirmed:true}});
    const applied=(await service.app.inject({url:`/api/config/plans/${planId}`,headers})).json();expect(applied).toMatchObject({plan:{state:"APPLIED"},appliedRevision:read.revision+1,currentRevision:read.revision+1});
    expect(service.configuration.current().config.agentProfiles[0]).toMatchObject({alias:"Safe alias",settings:{codexHome:"/private/account"}});
    const newer=service.configuration.current().config;newer.controller.id="newer-controller";service.configuration.applyPlan(service.configuration.buildPlan(newer,"test","cli").id);
    const replay=await service.app.inject({method:"POST",url:`/api/config/plans/${planId}/apply?view=console`,headers,payload:{confirmed:true}});expect(replay.json()).toMatchObject({repeated:true,appliedRevision:read.revision+1,currentRevision:read.revision+2});expect(JSON.stringify(replay.json())).not.toContain("/private/");

  }finally{await service.stop();rmSync(directory,{recursive:true,force:true});}
});

it("omits secret-like field names and literal secrets inside argument arrays",()=>{
  const c=config();c.agentProfiles[0]!.settings={api_key:"sk-private-key-12345678",args:["--key","sk-private-key-12345678"],environment:{TOKEN:"private"},model:"native"};const view=consoleConfig(c);expect(view.config.agentProfiles[0]!.settings).toEqual({model:"native"});expect(JSON.stringify(view)).not.toContain("sk-private-key");expect(view.protectedPaths).toContain("/agentProfiles/0/settings/args");
});

const privateNativeKeys = ["dataHome", "configHome", "agentDirectory", "sessionDirectory", "copilotHome"];
function nativePathConfig(key: string) {
  const c = structuredClone(defaultDispatcherConfig);
  c.agentProfiles = [{ id: "reserved", alias: "Reserved", provider: "cursor", runnerId: "local", enabled: false, settings: { [key]: "/synthetic/private/native", model: "native" } }];
  return c;
}
it.each(privateNativeKeys)("omits the known native %s from console config and plan before/after", key => {
  const c = nativePathConfig(key), before = structuredClone(c), view = consoleConfig(c);
  expect(view.config.agentProfiles[0]!.settings).toEqual({ model: "native" });
  expect(view.protectedPaths).toEqual([`/agentProfiles/0/settings/${key}`]);
  const database = new DispatcherDatabase(":memory:");
  try {
    const engine = new ConfigurationEngine(database), plan = engine.buildPlan(c, "owner", "import"), safe = consoleConfigPlan(plan);
    expect(JSON.stringify(safe)).not.toContain("/synthetic/private/native"); expect(plan.changes.length).toBeGreaterThan(0);
    engine.applyPlan(plan.id, { confirmed: true });
    const changed = structuredClone(c); changed.agentProfiles[0]!.settings![key] = "/synthetic/private/changed";
    const replaced = engine.buildPlan(changed, "owner", "import");
    expect(JSON.stringify(replaced)).toContain("/synthetic/private/native"); expect(JSON.stringify(replaced)).toContain("/synthetic/private/changed");
    expect(JSON.stringify(consoleConfigPlan(replaced))).not.toContain("/synthetic/private/");
    expect(c).toEqual(before);
  } finally { database.close(); }
});
it.each(privateNativeKeys)("preserves private %s siblings for leaf edits and refuses parent replacements atomically", key => {
  const c = nativePathConfig(key), before = structuredClone(c), alias = { op: "replace", path: "/agentProfiles/0/alias", value: "Changed", entityId: "reserved" };
  const next = applyConfigEdits(c, [alias]);
  expect(next.agentProfiles[0]).toMatchObject({ alias: "Changed", settings: { [key]: "/synthetic/private/native", model: "native" } });
  expect(applyConfigEdits(c, [{ op: "replace", path: `/agentProfiles/0/settings/${key}`, value: "/explicit/new", entityId: "reserved" }]).agentProfiles[0]!.settings![key]).toBe("/explicit/new");
  expect(applyConfigEdits(c, [{ op: "replace", path: "/agentProfiles/0/settings/model", value: "changed", entityId: "reserved" }]).agentProfiles[0]!.settings![key]).toBe("/synthetic/private/native");
  for (const edit of [
    { op: "replace", path: "/agentProfiles/0/settings", value: { model: "new" }, entityId: "reserved" },
    { op: "remove", path: "/agentProfiles/0/settings", entityId: "reserved" },
    { op: "replace", path: "/agentProfiles/0", value: { ...c.agentProfiles[0], settings: { model: "new" } }, entityId: "reserved" },
  ]) expect(() => applyConfigEdits(c, [alias, edit])).toThrow(expect.objectContaining({ code: "CONFIG_PROTECTED_PARENT" }));
  expect(c).toEqual(before);
  expect(applyConfigEdits(c, [{ op: "remove", path: "/agentProfiles/0", entityId: "reserved" }]).agentProfiles).toEqual([]);
});
it("keeps reference export settings-free while retaining only the exact known private key protection", () => {
  const c = nativePathConfig("copilotHome");
  Object.assign(c.agentProfiles[0]!.settings!, { dataHome: "/synthetic/data", configHome: "/synthetic/config", agentDirectory: "/synthetic/agent", sessionDirectory: "/synthetic/sessions", futureDirectory: "ordinary-field" });
  const view = consoleConfig(c); expect(view.config.agentProfiles[0]!.settings).toEqual({ model: "native", futureDirectory: "ordinary-field" });
  const exported = exportConsoleConfig(c);
  expect((exported.config as typeof c).agentProfiles[0]).not.toHaveProperty("settings"); expect(exported.omittedPaths).toContain("/agentProfiles/0/settings");
  for (const key of privateNativeKeys) expect(exported.omittedPaths).toContain(`/agentProfiles/0/settings/${key}`);
  expect(JSON.stringify(exported)).not.toContain("/synthetic/");
});
