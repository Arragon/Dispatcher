import {execFileSync} from "node:child_process";
import {mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {expect,it} from "vitest";
import {ControllerService} from "../src/service.js";
it("keeps repository identity separate from a durable local project and reads context/refs without mutation",async()=>{
 const directory=mkdtempSync(join(tmpdir(),"repository-context-")),repository=join(directory,"repo"),headers={authorization:"Bearer fixture-owner"};
 execFileSync("git",["init","-b","main",repository]);const git=(...args:string[])=>execFileSync("git",["-C",repository,...args],{encoding:"utf8"}).trim();git("config","user.name","Fixture");git("config","user.email","fixture@example.invalid");writeFileSync(join(repository,"README.md"),"fixture");git("add",".");git("commit","-m","fixture");git("branch","feature/local");
 const service=new ControllerService({dataDirectory:join(directory,"data"),ownerToken:"fixture-owner",withRunner:true,backgroundWorker:{enabled:false},secretStore:{test:async()=>false} as never});
 try{
  const config=service.configuration.current().config;config.repositories=[{id:"my-project",root:repository,defaultBaseRef:"main",scopePaths:[],verificationCommands:[]}];service.configuration.applyPlan(service.configuration.buildPlan(config,"fixture","cli").id,{confirmed:true});await service.start({listen:false});
  expect(service.database.getEntity("project","local:my-project")).toMatchObject({id:"local:my-project",repository:"my-project"});const projects=service.database.listEntities("project"),refs=git("show-ref"),revision=service.configuration.current().revision;
  const context=await service.app.inject({headers,url:"/api/repositories/my-project/context"});expect(context.statusCode).toBe(200);expect(context.json()).toMatchObject({repositoryId:"my-project",projectId:"local:my-project",runnerId:"local",runnerBindingSource:"legacy-local",configRevision:revision,git:{state:"valid",baseRef:"main",baseCommit:git("rev-parse","HEAD")}});
  const page=await service.app.inject({headers,url:"/api/repositories/my-project/refs?limit=1"});expect(page.statusCode).toBe(200);expect(page.json()).toMatchObject({offset:0,limit:1,nextOffset:1,refs:[{name:"refs/heads/feature/local"}]});
  expect((await service.app.inject({headers,url:"/api/repositories/my-project/refs?limit=101"})).statusCode).toBe(400);expect((await service.app.inject({headers,url:"/api/repositories/missing/context"})).statusCode).toBe(404);
  expect(service.configuration.current().revision).toBe(revision);expect(service.database.listEntities("project")).toEqual(projects);expect(git("show-ref")).toBe(refs);
  const privateConfig=service.configuration.current().config;privateConfig.repositories.push({id:"private-data",root:join(directory,"data"),defaultBaseRef:"main",scopePaths:[],verificationCommands:[]});service.configuration.applyPlan(service.configuration.buildPlan(privateConfig,"fixture","cli").id,{confirmed:true});
  expect((await service.app.inject({headers,url:"/api/repositories/private-data/context"})).json()).toMatchObject({git:{state:"invalid",reasonCode:"PRIVATE_PATH_SCOPE"}});
  const next=service.configuration.current().config;next.runners.push({id:"remote",mode:"remote",displayName:"Remote",capacity:1,tags:[],credentialRef:"secret://runner/remote"});next.repositories.push({id:"remote-repo",runnerId:"remote",root:"C:\\registered\\repo",defaultBaseRef:"main",scopePaths:[],verificationCommands:[]});service.configuration.applyPlan(service.configuration.buildPlan(next,"fixture","cli").id,{confirmed:true});
  expect((await service.app.inject({headers,url:"/api/repositories/remote-repo/context"})).json()).toMatchObject({runnerId:"remote",git:{state:"unavailable",reasonCode:"REMOTE_EXECUTION_UNAVAILABLE"}});expect((await service.app.inject({headers,url:"/api/repositories/remote-repo/refs"})).statusCode).toBe(409);
 }finally{await service.stop();rmSync(directory,{recursive:true,force:true});}
});
