import {execFileSync} from "node:child_process";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
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
