import {execFileSync} from "node:child_process";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach,expect,it,vi} from "vitest";
import type {SecretStore} from "@dispatcher/config";
import {ControllerService} from "../src/service.js";
const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
async function fixture(){
 const directory=mkdtempSync(join(tmpdir(),"scm-publication-")),root=join(directory,"repo");execFileSync("git",["init","-b","main",root],{stdio:"ignore"});const git=(...args:string[])=>execFileSync("git",["-C",root,...args],{encoding:"utf8"}).trim();git("-c","user.name=Fixture","-c","user.email=fixture@example.invalid","commit","--allow-empty","-m","base");git("remote","add","origin","git@github.com:acme/repo.git");
 let credential="fixture";const calls:string[]=[],entered=Promise.withResolvers<void>(),gate=Promise.withResolvers<void>(),control={hold:false,canPush:true,failMetadata:false};
 const native=vi.fn(()=>{throw new Error("No native execution during preflight");}),transport={ensureBranch:vi.fn(async()=>{throw new Error("No branch mutation during preflight");}),push:vi.fn(async()=>{throw new Error("No push during preflight");})};
 const service=new ControllerService({dataDirectory:join(directory,"controller"),withRunner:true,ownerToken:"owner",codexBackendFactory:native,gitTransport:transport,backgroundWorker:{enabled:false},secretStore:{put:async(reference:string,value:string)=>{credential=value;return {reference,backend:"encrypted-local",exists:true};},resolve:async()=>credential,test:async()=>true,metadata:async()=>({exists:true})} as unknown as SecretStore,integrationFetch:async(input,init)=>{
  const url=new URL(String(input));expect(init?.method??"GET").toBe("GET");expect(url.hostname).toBe("api.github.com");calls.push(url.pathname);
  if(control.failMetadata)throw new Error("unsafe-provider-error-secret-canary");
  if(control.hold&&url.pathname==="/repos/acme/repo"){entered.resolve();await gate.promise;}
  return new Response(JSON.stringify(url.pathname.endsWith("/branches/main")?{name:"main",commit:{sha:"a".repeat(40)}}:{full_name:"Acme/Repo",archived:false,disabled:false,permissions:{push:control.canPush}}));
 }});await service.start({listen:false});cleanups.push(async()=>{gate.resolve();await service.stop();rmSync(directory,{recursive:true,force:true});});
 const config=service.configuration.current().config;config.agentProfiles=[];config.repositories=[{id:"local-repo",root,defaultBaseRef:"main",scopePaths:["."],verificationCommands:[{id:"check",file:process.execPath,args:["-e","process.exit(0)"],required:true,timeoutMs:3000,outputLimitBytes:1000}]}];config.connectors=[{id:"unselected",kind:"scm",definitionId:"scm.github",displayName:"Unselected",enabled:true,credentialRef:"secret://github/unselected",settings:{apiBase:"https://unselected.invalid"}},{id:"chosen",kind:"scm",definitionId:"scm.github",displayName:"Chosen",enabled:true,credentialRef:"secret://github/chosen"}];service.configuration.applyPlan(service.configuration.buildPlan(config,"fixture","cli").id,{confirmed:true});
 const draft={schemaVersion:1,clientDraftId:"scm-draft",description:"Explicit delivery",projectId:"local:local-repo",repositoryId:"local-repo",scopePaths:["."],acceptanceCriteria:["works"],verificationCommandIds:["check"],startMode:"create-only",execution:{selectionMode:"manual"},delivery:{type:"pull-request",scmConnectorId:"chosen",targetRepository:"Acme/Repo",baseBranch:"main"}};
 const preview=(delivery:unknown=draft.delivery)=>service.app.inject({headers:{authorization:"Bearer owner"},method:"POST",url:"/api/task-publications/preview",payload:{...draft,delivery}});return {service,git,calls,native,transport,draft,preview,control,entered,gate};
}
it("preflights only the explicitly selected SCM and freezes its delivery identity separately from workspace",async()=>{
 const f=await fixture(),response=await f.preview();expect(response.statusCode).toBe(200);const p=response.json();expect(p.checks).toContainEqual(expect.objectContaining({id:"delivery",status:"passed"}));expect(p.effectiveDelivery).toMatchObject({scmConnectorId:"chosen",repository:"acme/repo",baseBranch:"main",target:{host:"github.com",repository:"acme/repo"}});
 const record=f.service.database.getEntity("task-publication",p.publicationId);expect(record).toMatchObject({contract:{workspace:{repositoryId:"local-repo"},delivery:{type:"pull-request",repository:"acme/repo",baseBranch:"main",scmConnectorId:"chosen"}},deliverySelection:p.effectiveDelivery});
 expect(p.canCommit).toBe(true);expect(f.calls).toEqual(["/repos/acme/repo","/repos/acme/repo/branches/main"]);expect(f.native).not.toHaveBeenCalled();expect(f.transport.push).not.toHaveBeenCalled();
});
it("rejects absent SCM selection and mismatched targets without silently choosing the first connector",async()=>{
 const f=await fixture();for(const delivery of [{type:"pull-request",targetRepository:"acme/repo",baseBranch:"main"},{...f.draft.delivery,scmConnectorId:"missing"},{...f.draft.delivery,targetRepository:"other/repo"}]){const p=(await f.preview(delivery)).json();expect(p.canCommit).toBe(false);expect(p.checks).toContainEqual(expect.objectContaining({id:"delivery",status:"blocked"}));}expect(f.calls).toEqual([]);
});
it("performs no SCM or origin qualification for none and commit",async()=>{
 const f=await fixture();f.git("remote","set-url","origin","file:///unqualified-target");for(const type of ["none","commit"]){const p=(await f.preview({type})).json();expect(p.canCommit).toBe(true);expect(f.service.database.getEntity("task-publication",p.publicationId)).toMatchObject({contract:{delivery:{type}}});}expect(f.calls).toEqual([]);expect(f.transport.push).not.toHaveBeenCalled();
});
it("rejects SCM configuration changes that happen while metadata is being read",async()=>{
 const f=await fixture();f.control.hold=true;const pending=f.preview();void pending.then(()=>undefined);await f.entered.promise;const config=f.service.configuration.current().config;config.connectors.find(connector=>connector.id==="chosen")!.displayName="Changed";f.service.configuration.applyPlan(f.service.configuration.buildPlan(config,"fixture","cli").id,{confirmed:true});f.gate.resolve();const response=await pending;expect(response.statusCode).toBe(409);expect(response.json()).toMatchObject({code:"SELECTION_CHANGED"});expect(f.native).not.toHaveBeenCalled();
});

it("keeps metadata write access unknown or denied instead of passing PR preflight",async()=>{
 const f=await fixture();f.control.canPush=false;const p=(await f.preview()).json();expect(p.canCommit).toBe(false);expect(p.checks).toContainEqual(expect.objectContaining({id:"delivery",status:"blocked"}));expect(f.calls).toEqual(["/repos/acme/repo"]);expect(f.transport.push).not.toHaveBeenCalled();
});
it("does not bless SCM evidence observed before a credential replacement",async()=>{
 const f=await fixture();f.control.hold=true;const pending=f.preview();void pending.then(()=>undefined);await f.entered.promise;
 const changed=await f.service.app.inject({headers:{authorization:"Bearer owner"},method:"PUT",url:"/api/secrets/github/chosen",payload:{value:"replacement-fixture"}});expect(changed.statusCode,changed.body).toBe(201);f.gate.resolve();const response=await pending;expect(response.statusCode).toBe(200);expect(response.json().checks).toContainEqual(expect.objectContaining({id:"delivery",code:"SELECTION_CHANGED",status:"blocked"}));expect(response.json()).not.toHaveProperty("effectiveDelivery");
});

it("does not expose provider error text in publication preflight",async()=>{
 const f=await fixture();f.control.failMetadata=true;const p=(await f.preview()).json();expect(p.checks).toContainEqual(expect.objectContaining({id:"delivery",status:"blocked",code:"SCM_PREFLIGHT_UNAVAILABLE"}));expect(JSON.stringify(p)).not.toContain("unsafe-provider-error-secret-canary");
});
