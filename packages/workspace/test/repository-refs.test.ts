import {execFileSync} from "node:child_process";
import {mkdtempSync,writeFileSync,rmSync,mkdirSync,symlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {expect,it} from "vitest";
import {RepositoryRegistry,WorkspaceManager} from "../src/index.js";
it("reads bounded qualified local refs without fetching or modifying refs",async()=>{
 const directory=mkdtempSync(join(tmpdir(),"repository-refs-"));
 const git=(...args:string[])=>execFileSync("git",["-C",directory,...args],{encoding:"utf8"}).trim();
 try{
  git("init","-b","main");git("config","user.name","Fixture");git("config","user.email","fixture@example.invalid");writeFileSync(join(directory,"README.md"),"fixture");git("add",".");git("commit","-m","fixture");git("branch","feature/example");git("tag","-a","v1","-m","annotated fixture");git("remote","add","origin","https://must-not-fetch.invalid/repository.git");
  const registry=new RepositoryRegistry();registry.register({id:"registered",root:directory});const workspaces=new WorkspaceManager(registry,join(directory,"managed"));
  const before=git("show-ref"),first=await workspaces.refs("registered",0,1),second=await workspaces.refs("registered",first.nextOffset!,2);
  expect(first.refs).toHaveLength(1);expect(first.nextOffset).toBe(1);expect([...first.refs,...second.refs].map(ref=>ref.name)).toEqual(["refs/heads/feature/example","refs/heads/main","refs/tags/v1"]);expect(second.nextOffset).toBeUndefined();expect(first.refs[0]!.commit).toMatch(/^[a-f0-9]{40}$/);expect(git("show-ref")).toBe(before);
  await expect(workspaces.refs("registered",-1,100)).rejects.toMatchObject({code:"INVALID_REF_PAGE"});await expect(workspaces.refs("registered",0,101)).rejects.toMatchObject({code:"INVALID_REF_PAGE"});
 }finally{rmSync(directory,{recursive:true,force:true});}
});
it("rejects private repository roots and explicit scopes including missing descendants and symlink aliases",async()=>{
 const directory=mkdtempSync(join(tmpdir(),"repository-private-paths-")),root=join(directory,"repo"),privateRoot=join(root,"private-account");mkdirSync(privateRoot,{recursive:true});
 const git=(...args:string[])=>execFileSync("git",["-C",root,...args],{stdio:"ignore"});git("init","-b","main");git("config","user.name","Fixture");git("config","user.email","fixture@example.invalid");git("commit","--allow-empty","-m","fixture");symlinkSync(privateRoot,join(root,"alias"),"dir");
 let privatePaths=[privateRoot];const registry=new RepositoryRegistry();registry.register({id:"repo",root});const manager=new WorkspaceManager(registry,join(directory,"worktrees"),()=>privatePaths);
 try{
  for(const scope of ["private-account","private-account/not-created","alias/not-created"])await expect(manager.inspect({repositoryId:"repo",baseRef:"main",scopePaths:[scope]})).rejects.toMatchObject({code:"PRIVATE_PATH_SCOPE"});
  await expect(manager.inspect({repositoryId:"repo",baseRef:"main",scopePaths:["src-new"]})).resolves.toHaveProperty("baseCommit");
  const workspace=await manager.create({repositoryId:"repo",baseRef:"main",scopePaths:[],taskId:"task",runId:"run",attempt:1});mkdirSync(join(workspace.path,"private-account"));writeFileSync(join(workspace.path,"private-account","secret.txt"),"private fixture");
  await expect(manager.resultFiles(workspace)).rejects.toMatchObject({code:"PRIVATE_PATH_SCOPE"});
  registry.clear();await expect(manager.resultFiles(workspace)).rejects.toMatchObject({code:"PRIVATE_PATH_SCOPE"});
  const other=join(directory,"other-repository");mkdirSync(other);registry.register({id:"repo",root:other});
  await expect(manager.assertPathAllowed(workspace,"private-account/secret.txt")).rejects.toMatchObject({code:"PRIVATE_PATH_SCOPE"});
  symlinkSync("loop",join(root,"loop"));registry.register({id:"repo",root});privatePaths=[join(root,"loop")];
  await expect(manager.refs("repo")).rejects.toMatchObject({code:"PRIVATE_PATH_CHECK_UNAVAILABLE",message:"Owning-process private path boundary could not be verified"});
  privatePaths=[directory];await expect(manager.refs("repo")).rejects.toMatchObject({code:"PRIVATE_PATH_SCOPE"});await expect(manager.plan({repositoryId:"repo",baseRef:"main",scopePaths:[],taskId:"task",runId:"run",attempt:1})).rejects.toMatchObject({code:"PRIVATE_PATH_SCOPE"});
 }finally{rmSync(directory,{recursive:true,force:true});}
});
