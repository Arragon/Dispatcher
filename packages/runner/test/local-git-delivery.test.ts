import {execFileSync} from "node:child_process";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {expect,it,vi} from "vitest";
import {DispatcherDatabase} from "@dispatcher/persistence";
import {RepositoryRegistry,WorkspaceManager} from "@dispatcher/workspace";
import {ProcessManager} from "../src/process.js";
import {LocalGitDelivery} from "../src/local-git-delivery.js";
async function fixture(){
 const directory=mkdtempSync(join(tmpdir(),"local-git-delivery-")),root=join(directory,"repo"),db=new DispatcherDatabase(join(directory,"state.sqlite"));execFileSync("git",["init","-b","main",root],{stdio:"ignore"});
 const git=(...args:string[])=>execFileSync("git",["-C",root,...args],{encoding:"utf8"}).trim();git("config","user.name","Fixture");git("config","user.email","fixture@example.invalid");writeFileSync(join(root,"base.txt"),"base");git("add",".");git("commit","-m","base");git("remote","add","origin","https://must-not-push.invalid/repo.git");
 const registry=new RepositoryRegistry();registry.register({id:"repo",root});const workspaces=new WorkspaceManager(registry,join(directory,"worktrees")),workspace=await workspaces.create({repositoryId:"repo",taskId:"task",runId:"run",attempt:1,baseRef:"main",scopePaths:["result.txt"]}),processes=new ProcessManager(join(directory,"logs"));
 const service=new LocalGitDelivery(db,processes,workspaces),input={runId:"run",generation:1,leaseId:"lease",workspace,message:"Dispatcher fixture",assertAuthority:()=>undefined};
 return {directory,root,db,git,workspaces,workspace,processes,service,input,close:async()=>{await processes.shutdown();db.close();rmSync(directory,{recursive:true,force:true});}};
}
it("commits only the managed worktree and replays its actual SHA without push or a second commit",async()=>{
 const f=await fixture();try{
  writeFileSync(join(f.workspace.path,"result.txt"),"delivered\n");const main=f.git("rev-parse","HEAD");const first=await f.service.commit(f.input),replay=await new LocalGitDelivery(f.db,f.processes,f.workspaces).commit({...f.input,workspace:Object.fromEntries(Object.entries(f.workspace).reverse()) as typeof f.workspace});
  expect(first).toMatchObject({runId:"run",generation:1,branch:f.workspace.branch,created:true,files:["result.txt"]});expect(first.commit).toMatch(/^[a-f0-9]{40}$/);expect(replay).toEqual(first);expect(f.git("rev-parse","HEAD")).toBe(main);
  expect(execFileSync("git",["-C",f.workspace.path,"rev-list","--count",`${main}..HEAD`],{encoding:"utf8"}).trim()).toBe("1");expect(f.processes.activeCount).toBe(0);
 }finally{await f.close();}
});
it("fences unauthorized and out-of-scope writes before staging/commit",async()=>{
 const f=await fixture();try{
  writeFileSync(join(f.workspace.path,"outside.txt"),"out of scope");await expect(f.service.commit(f.input)).rejects.toMatchObject({code:"PATH_OUT_OF_SCOPE"});
  await expect(f.service.commit({...f.input,assertAuthority:()=>{throw new Error("lease revoked");}})).rejects.toThrow("lease revoked");expect(execFileSync("git",["-C",f.workspace.path,"diff","--cached","--name-only"],{encoding:"utf8"})).toBe("");
 }finally{await f.close();}
});
it("does not repeat a commit after receipt persistence fails, and keeps restart uncertainty explicit",async()=>{
 const f=await fixture();try{
  writeFileSync(join(f.workspace.path,"result.txt"),"once\n");const original=f.db.saveEntity.bind(f.db),save=vi.spyOn(f.db,"saveEntity").mockImplementation((...args)=>{if(args[0]==="local-git-delivery"&&(args[2] as {state?:string}).state==="COMPLETE")throw new Error("receipt disk failure");original(...args);});
  await expect(f.service.commit(f.input)).rejects.toThrow("receipt disk failure");save.mockRestore();
  await expect(new LocalGitDelivery(f.db,f.processes,f.workspaces).commit(f.input)).rejects.toMatchObject({code:"COMMIT_OUTCOME_UNKNOWN"});
  const known=await f.service.commit(f.input);expect(known.created).toBe(true);expect(execFileSync("git",["-C",f.workspace.path,"rev-list","--count",`${f.workspace.baseRevision}..HEAD`],{encoding:"utf8"}).trim()).toBe("1");
 }finally{await f.close();}
});
