import {expect,it,vi} from "vitest";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {ControllerService} from "../src/service.js";
import {buildDiagnostics} from "../src/diagnostics.js";
import type {ProfileConsoleView} from "@dispatcher/domain";
it("does not promote an untimed ready label into verified execution or connector health",()=>{
 const profile:ProfileConsoleView={id:"p",alias:"P",providerId:"codex",adapterId:"codex",runnerId:"local",dispatchEnabled:true,configRevision:1,installation:{status:"ready"},compatibility:{status:"ready"},authentication:{status:"ready"},resources:{status:"unknown"},configuration:{complete:true,missingFields:[]},executionSupport:"local-ready",actions:{}};
 const report=buildDiagnostics({now:"2026-10-16T12:00:00Z",revision:1,lifecycle:"READY",profiles:[profile],runners:[],connectors:[{id:"c",health:"HEALTHY"}],runs:[],publications:[],deliveries:[],deadLetters:[]});expect(report.executionReadiness).toBe("unverified");expect(report.entries.filter(entry=>entry.entityRef.kind!=="controller").every(entry=>entry.status==="unknown")).toBe(true);
});
it("expires old connector checks without issuing another query",()=>{
 const report=buildDiagnostics({now:"2026-10-16T12:10:00Z",revision:1,lifecycle:"READY",profiles:[],runners:[],connectors:[{id:"c",health:"HEALTHY",updatedAt:"2026-10-16T12:00:00Z"}],runs:[],publications:[],deliveries:[],deadLetters:[]});expect(report.entries).toContainEqual(expect.objectContaining({category:"integration",status:"stale",freshness:"stale",observedAt:"2026-10-16T12:00:00Z",reasonCode:"CONNECTOR_PROBE_EXPIRED"}));
});
it("binds platform checks to applied configuration and rejects a result from an in-flight old connection",async()=>{
 const root=mkdtempSync(join(tmpdir(),"diagnostic-connector-")),headers={authorization:"Bearer diagnostics-owner"},entered=Promise.withResolvers<void>(),gate=Promise.withResolvers<void>();let held=false;
 const service=new ControllerService({dataDirectory:root,ownerToken:"diagnostics-owner",backgroundWorker:{enabled:false},secretStore:{test:async()=>true,resolve:async()=>"fixture-api-value"} as never,integrationFetch:async()=>{if(held){entered.resolve();await gate.promise;}return new Response(JSON.stringify({login:"fixture"}));}});
 try{const config=service.configuration.current().config;config.connectors=[{id:"github",definitionId:"scm.github",kind:"scm",displayName:"GitHub",enabled:true,credentialRef:"secret://github/fixture",settings:{apiBase:"https://github.invalid"}}];service.configuration.applyPlan(service.configuration.buildPlan(config,"test","cli").id,{confirmed:true});await service.start({listen:false});
  const request={headers,method:"POST" as const,url:"/api/diagnostics/checks",payload:{checkId:"connector.health",entityId:"github"}};expect((await service.app.inject(request)).statusCode).toBe(200);
  held=true;const pending=service.app.inject(request);await entered.promise;const next=service.configuration.current().config;next.connectors[0]!.settings!.apiBase="https://changed.invalid";service.configuration.applyPlan(service.configuration.buildPlan(next,"test","cli").id,{confirmed:true});gate.resolve();expect((await pending).statusCode).toBe(409);
  expect((await service.app.inject({headers,url:"/api/diagnostics"})).json().entries).toContainEqual(expect.objectContaining({category:"integration",status:"stale",reasonCode:"CONNECTOR_CONTEXT_CHANGED"}));
 }finally{gate.resolve();await service.stop();rmSync(root,{recursive:true,force:true});}
});
it("reads saved diagnostics without native work, keeps unknown distinct and exports only aggregate facts",async()=>{
 const root=mkdtempSync(join(tmpdir(),"dispatcher-diagnostics-")),probe=vi.fn(async()=>({installed:true,compatible:true,authenticated:false,authentication:"unknown"})),headers={authorization:"Bearer diagnostics-owner"};
 const service=new ControllerService({dataDirectory:root,withRunner:true,ownerToken:"diagnostics-owner",backgroundWorker:{enabled:false},secretStore:{test:async()=>false} as never,profileProbeExecutor:probe});
 try{const config=service.configuration.current().config;config.agentProfiles=[{id:"p",alias:"private user description sk-canary-secret-123456",provider:"codex",runnerId:"local",settings:{codexHome:"/private/account",executable:"/private/executable"}}];service.configuration.applyPlan(service.configuration.buildPlan(config,"test","cli").id,{confirmed:true});await service.start({listen:false});
  const result=await service.app.inject({headers,url:"/api/diagnostics"});expect(result.statusCode).toBe(200);expect(result.json().entries).toContainEqual(expect.objectContaining({entityRef:{kind:"profile",id:"p"},category:"authentication",status:"unknown"}));expect(result.json().executionReadiness).toBe("unverified");expect(probe).not.toHaveBeenCalled();
  const impact=(await service.app.inject({headers,url:"/api/system-impact"})).json();expect(impact).toMatchObject({activeLocalProcesses:null,llmCallsLastHour:null,llmCallsSinceStart:0,llmCallScope:{includesExplicitProbes:false}});
  const exported=await service.app.inject({headers,url:"/api/diagnostics/export"});expect(exported.statusCode).toBe(200);expect(exported.body).not.toMatch(/private|sk-canary|user description|codexHome|executable|profileId/);expect(exported.json()).toHaveProperty("summary");expect(probe).not.toHaveBeenCalled();
  for(const payload of [{checkId:"inference",entityId:"p"},{checkId:"profile.native",entityId:"p",command:"arbitrary executable"},{checkId:"profile.native",entityId:"p",cost:"read-only"}])expect((await service.app.inject({headers,method:"POST",url:"/api/diagnostics/checks",payload})).statusCode).toBe(400);
  expect(probe).not.toHaveBeenCalled();const checked=await service.app.inject({headers,method:"POST",url:"/api/diagnostics/checks",payload:{checkId:"profile.native",entityId:"p"}});expect(checked.statusCode).toBe(200);expect(probe).toHaveBeenCalledOnce();expect(checked.json().diagnostics.entries).toContainEqual(expect.objectContaining({entityRef:{kind:"profile",id:"p"},category:"authentication",status:"unknown",observedAt:expect.any(String)}));
 }finally{await service.stop();rmSync(root,{recursive:true,force:true});}
});

it("invalidates connector health in diagnostics and the console after same-reference rotation",async()=>{
 const root=mkdtempSync(join(tmpdir(),"connector-credential-")),headers={authorization:"Bearer diagnostics-owner"},entered=Promise.withResolvers<void>(),gate=Promise.withResolvers<void>();let held=false;
 const service=new ControllerService({dataDirectory:root,ownerToken:"diagnostics-owner",backgroundWorker:{enabled:false},secretStore:{test:async()=>true,resolve:async()=>"fixture",put:async(reference:string)=>({reference,backend:"encrypted-local",exists:true})} as never,integrationFetch:async()=>{if(held){entered.resolve();await gate.promise;}return new Response(JSON.stringify({login:"fixture"}));}});
 try{
  const config=service.configuration.current().config;config.connectors=[{id:"github",definitionId:"scm.github",kind:"scm",displayName:"GitHub",enabled:true,credentialRef:"secret://github/fixture",settings:{apiBase:"https://github.invalid"}}];service.configuration.applyPlan(service.configuration.buildPlan(config,"test","cli").id,{confirmed:true});await service.start({listen:false});
  const check=()=>service.app.inject({headers,method:"POST",url:"/api/connectors/github/test"});expect((await check()).statusCode).toBe(200);
  expect((await service.app.inject({headers,url:"/api/fleet/connectors"})).json().connectors[0].health).toBe("HEALTHY");
  held=true;const pending=check();await entered.promise;expect((await service.app.inject({headers,method:"PUT",url:"/api/secrets/github/fixture",payload:{value:"private-rotated-value"}})).statusCode).toBe(201);gate.resolve();expect((await pending).statusCode).toBe(409);
  expect((await service.app.inject({headers,url:"/api/fleet/connectors"})).json().connectors[0]).toMatchObject({health:"UNKNOWN"});
  expect((await service.app.inject({headers,url:"/api/diagnostics"})).json().entries).toContainEqual(expect.objectContaining({category:"integration",status:"stale",reasonCode:"CONNECTOR_CONTEXT_CHANGED"}));
 }finally{gate.resolve();await service.stop();rmSync(root,{recursive:true,force:true});}
});
