import {expect,it} from "vitest";
import {DispatcherDatabase} from "@dispatcher/persistence";
import {ProfileProbeService} from "../src/profile-probes.js";
const context={profileId:"a",runnerId:"local",providerId:"cursor",configRevision:1,fingerprint:"one"};
it("keeps installation, compatibility and authentication independent and persists normalized evidence",async()=>{
  const db=new DispatcherDatabase(":memory:");let now=new Date("2026-10-16T12:00:00Z");const probes=new ProfileProbeService(db,()=>now);let calls=0;
  const record=await probes.run(context,async()=>{calls++;return {installed:true,compatible:true,authenticated:false,authentication:"unknown",executable:"/private/cli",diagnostic:"sk-secret-from-stderr-12345"};},()=>context.fingerprint);
  expect(record).toMatchObject({installation:{status:"ready"},compatibility:{status:"ready"},authentication:{status:"unknown"},observedAt:now.toISOString()});expect(JSON.stringify(record)).not.toMatch(/private|sk-secret/);
  expect(new ProfileProbeService(db,()=>now).current(context)).toEqual(record);now=new Date(now.getTime()+6*60_000);expect(probes.current(context)).toMatchObject({authentication:{status:"stale"}});expect(calls).toBe(1);db.close();
});
it("marks context-changed evidence stale and rejects an in-flight old-context success",async()=>{
  const db=new DispatcherDatabase(":memory:"),probes=new ProfileProbeService(db);await probes.run(context,async()=>({installed:true,compatible:true,authenticated:true,authentication:"ready"}),()=>"one");
  expect(probes.current({...context,fingerprint:"two"})).toMatchObject({authentication:{status:"stale"}});
  await expect(probes.run(context,async()=>({authenticated:true,authentication:"ready"}),()=>"two")).rejects.toMatchObject({code:"PROFILE_CONTEXT_CHANGED"});db.close();
});
it("coalesces same-context reads and never promotes successful exit without authentication evidence",async()=>{
  const db=new DispatcherDatabase(":memory:"),probes=new ProfileProbeService(db),gate=Promise.withResolvers<unknown>();let calls=0;
  const read=()=>{calls++;return gate.promise;};const first=probes.run(context,read,()=>"one"),second=probes.run(context,read,()=>"one");gate.resolve({installed:true,compatible:false,authenticated:false,authentication:"unknown"});
  expect(await first).toEqual(await second);expect(calls).toBe(1);expect(probes.current(context)).toMatchObject({compatibility:{status:"failed"},authentication:{status:"unknown"}});db.close();
});

it("uses applied native directories and keeps account evidence across Controller reload with stale-config fencing",async()=>{
  const {mkdtempSync,rmSync}=await import("node:fs"),{tmpdir}=await import("node:os"),{join}=await import("node:path"),{ControllerService}=await import("../src/service.js"),{defaultDispatcherConfig}=await import("@dispatcher/config");
  const directory=mkdtempSync(join(tmpdir(),"durable-profile-probe-")),seen:unknown[]=[],headers={authorization:"Bearer probe-owner"};let calls=0,held=false;const gate=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>();
  const options={dataDirectory:directory,withRunner:true,ownerToken:"probe-owner",backgroundWorker:{enabled:false},secretStore:{test:async()=>false} as never,profileProbeExecutor:async(profile:unknown)=>{calls++;seen.push(profile);if(held){entered.resolve();await gate.promise;}return {installed:true,compatible:true,authenticated:true,authentication:"ready",version:"native-1",executable:"/private/cli",diagnostic:"private credential must not escape"};}};
  let service=new ControllerService(options);
  try{
    const config=structuredClone(defaultDispatcherConfig);config.agentProfiles=[{id:"a",alias:"A",provider:"qoder-cn",runnerId:"local",settings:{executable:"/private/cli",configDir:"/private/account-a"}}];service.configuration.applyPlan(service.configuration.buildPlan(config,"test","cli").id,{confirmed:true});await service.start({listen:false});
    expect((await service.app.inject({headers,url:"/api/agents/profiles/a"})).json().profile.authentication.status).toBe("unknown");
    const tested=(await service.app.inject({headers,method:"POST",url:"/api/agents/profiles/a/test"})).json();expect(tested).toMatchObject({authenticated:true,evidence:{authentication:{status:"ready"}}});expect(seen[0]).toMatchObject({settings:{configDir:"/private/account-a"}});expect(JSON.stringify(tested)).not.toContain("/private/");
    const observedAt=tested.evidence.observedAt;await service.stop();service=new ControllerService(options);await service.start({listen:false});
    const detail=(await service.app.inject({headers,url:"/api/agents/profiles/a"})).json().profile,list=(await service.app.inject({headers,url:"/api/agents/profiles"})).json().profiles[0];expect(detail).toEqual(list);expect(detail.authentication).toMatchObject({status:"ready",observedAt});expect(calls).toBe(1);
    held=true;const pending=service.app.inject({headers,method:"POST",url:"/api/agents/profiles/a/test"});await entered.promise;const next=service.configuration.current().config;next.agentProfiles[0]!.settings!.configDir="/private/account-b";service.configuration.applyPlan(service.configuration.buildPlan(next,"test","cli").id,{confirmed:true});gate.resolve();expect((await pending).statusCode).toBe(409);
    expect((await service.app.inject({headers,url:"/api/agents/profiles/a"})).json().profile.authentication.status).toBe("stale");
  }finally{gate.resolve();await service.stop();rmSync(directory,{recursive:true,force:true});}
});

it("keeps remote draft discovery off Controller and permits structurally valid unverified account plans",async()=>{
  const {mkdtempSync,rmSync}=await import("node:fs"),{tmpdir}=await import("node:os"),{join}=await import("node:path"),{ControllerService}=await import("../src/service.js");const directory=mkdtempSync(join(tmpdir(),"remote-draft-probe-")),headers={authorization:"Bearer probe-owner"};
  const service=new ControllerService({dataDirectory:directory,ownerToken:"probe-owner",secretStore:{test:async()=>false} as never});
  try{const config=service.configuration.current().config;config.runners.push({id:"remote",displayName:"Remote",mode:"remote",capacity:1,tags:[],credentialRef:"secret://runner/fixture/remote"});service.configuration.applyPlan(service.configuration.buildPlan(config,"test","cli").id,{confirmed:true});await service.start({listen:false});
    const discovery=await service.app.inject({headers,method:"POST",url:"/api/agents/qoder-cn/discover",payload:{id:"remote-a",alias:"Remote A",runnerId:"remote",executable:"/must-not-run/on/controller",configDir:"C:\\native\\account"}});expect(discovery.statusCode).toBe(409);expect(discovery.json()).toMatchObject({code:"REMOTE_DRAFT_PROBE_UNAVAILABLE"});
    for(const provider of ["qoder","qoder-cn"]){const immediate=await service.app.inject({headers,method:"POST",url:`/api/agents/${provider}/profiles`,payload:{id:"remote-immediate",alias:"Remote",runnerId:"remote",executable:"/must-not-run/on/controller"}});expect(immediate.statusCode).toBe(409);expect(immediate.json()).toMatchObject({code:"REMOTE_DRAFT_PROBE_UNAVAILABLE"});}
    const preview=await service.app.inject({headers,method:"POST",url:"/api/agents/qoder-cn/profiles",payload:{id:"remote-a",alias:"Remote A",runnerId:"remote",executable:"/not-installed/explicit-native",configDir:"C:\\native\\account",previewOnly:true,baseRevision:service.configuration.current().revision}});expect(preview.statusCode).toBe(201);expect(service.configuration.current().config.agentProfiles).toEqual([]);expect(service.configuration.proposedConfig(preview.json().plan.id).agentProfiles[0]).toMatchObject({runnerId:"remote",settings:{configDir:"C:\\native\\account"}});
  }finally{await service.stop();rmSync(directory,{recursive:true,force:true});}
});

it("does not describe a version timeout as a missing executable or verified incompatibility",async()=>{
 const db=new DispatcherDatabase(":memory:"),probes=new ProfileProbeService(db);const evidence=await probes.run(context,async()=>({installed:false,compatible:false,authenticated:false,authentication:"unknown",failure:{stage:"version",code:"TIMEOUT"}}),()=>context.fingerprint);expect(evidence).toMatchObject({installation:{status:"failed",reasonCode:"NATIVE_VERSION_TIMEOUT"},compatibility:{status:"unknown"},authentication:{status:"unknown"}});db.close();
});

it("preserves a waiting canonical account even when no native child is currently attached",async()=>{
 const {mkdtempSync,rmSync}=await import("node:fs"),{tmpdir}=await import("node:os"),{join}=await import("node:path"),{ControllerService}=await import("../src/service.js");const directory=mkdtempSync(join(tmpdir(),"waiting-profile-guard-"));
 const service=new ControllerService({dataDirectory:directory,withRunner:true,backgroundWorker:{enabled:false},secretStore:{test:async()=>false} as never});
 try{const config=service.configuration.current().config;config.agentProfiles=[{id:"a",alias:"A",provider:"codex",runnerId:"local",settings:{codexHome:directory}}];service.configuration.applyPlan(service.configuration.buildPlan(config,"test","cli").id,{confirmed:true});
 service.database.saveEntity("run","waiting-run",{id:"waiting-run",profileId:"a",state:"WAITING_USER"});const changed=structuredClone(config);changed.agentProfiles[0]!.enabled=false;
 expect(()=>service.configuration.applyPlan(service.configuration.buildPlan(changed,"test","cli").id,{confirmed:true})).toThrow(expect.objectContaining({code:"ACTIVE_AGENT_PROFILE"}));expect(service.configuration.current().config.agentProfiles[0]!.enabled).toBeUndefined();
 }finally{await service.stop();rmSync(directory,{recursive:true,force:true});}
});
