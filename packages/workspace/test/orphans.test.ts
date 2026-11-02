import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { inspectWorkspaceOrphans, RepositoryRegistry, WorkspaceManager } from "../src/index.js";

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
async function fixture(){
 const root=mkdtempSync(join(tmpdir(),"dispatcher-orphan-git-"));roots.push(root);const repo=join(root,"repo"),trees=join(root,"worktrees");mkdirSync(repo);
 const git=(args:string[])=>execFileSync("git",["-C",repo,...args],{stdio:"pipe",encoding:"utf8"});git(["init","-b","main"]);git(["config","user.email","test@example.com"]);git(["config","user.name","Test"]);writeFileSync(join(repo,"file"),"baseline");writeFileSync(join(repo,".gitignore"),"private\n");git(["add","."]);git(["commit","-m","baseline"]);
 const registry=new RepositoryRegistry();registry.register({id:"repo",root:repo});const manager=new WorkspaceManager(registry,trees);const workspace=await manager.create({repositoryId:"repo",taskId:"task",runId:"run",attempt:1,baseRef:"main",scopePaths:["."]});return {root,repo,trees,manager,workspace};
}
it("reports a real unreferenced Git worktree without inferring ownership or changing its index",async()=>{
 const f=await fixture(),index=execFileSync("git",["-C",f.workspace.path,"rev-parse","--path-format=absolute","--git-path","index"],{encoding:"utf8"}).trim(),before=readFileSync(index);
 const report=await inspectWorkspaceOrphans(f.trees,[]);expect(report).toEqual([expect.objectContaining({path:realpathSync(f.workspace.path),orphan:true,ownership:"unverified",git:"worktree",dirty:false,action:"report",references:[]})]);expect(readFileSync(index)).toEqual(before);expect(existsSync(f.workspace.path)).toBe(true);
});
it("keeps references and NUL-delimited dirty, untracked and ignored names",async()=>{
 const f=await fixture();writeFileSync(join(f.workspace.path,"file"),"changed");writeFileSync(join(f.workspace.path,"line\nbreak"),"user");writeFileSync(join(f.workspace.path,"private"),"ignored");
 const result=(await inspectWorkspaceOrphans(f.trees,[{kind:"session",id:"retained",path:f.workspace.path}]))[0]!;expect(result.orphan).toBe(false);expect(result.references).toEqual([{kind:"session",id:"retained"}]);expect(result.dirty).toBe(true);expect(result.changedFiles).toEqual(["file","line\nbreak","private"]);
});
it("does not follow worktree or root symlinks and reports unrelated directories",async()=>{
 const f=await fixture();symlinkSync(f.repo,join(f.trees,"alias"));mkdirSync(join(f.trees,"unknown"));const rows=await inspectWorkspaceOrphans(f.trees,[]);expect(rows.find(r=>r.path.endsWith("/alias"))).toMatchObject({git:"unavailable",reasonCodes:["UNSAFE_DIRECTORY"],action:"report"});expect(rows.find(r=>r.path.endsWith("/unknown"))).toMatchObject({git:"unavailable",action:"report"});const alias=join(f.root,"root-alias");symlinkSync(f.trees,alias);await expect(inspectWorkspaceOrphans(alias,[])).rejects.toMatchObject({code:"ORPHAN_ROOT_UNSAFE"});
});
it("includes retained trees and never treats retirement as deletion authority",async()=>{
 const f=await fixture(),result=await f.manager.cleanup(await f.manager.cleanupPlan(f.workspace));const rows=await inspectWorkspaceOrphans(f.trees,[]);expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({path:result.retainedPath,retained:true,ownership:"unverified",action:"report"});expect(existsSync(result.retainedPath)).toBe(true);
});
it("fails closed when the bounded directory inventory is incomplete",async()=>{
 const f=await fixture();for(let i=0;i<200;i++)mkdirSync(join(f.trees,`unknown-${i}`));await expect(inspectWorkspaceOrphans(f.trees,[])).rejects.toMatchObject({code:"ORPHAN_SCAN_LIMIT"});expect(existsSync(f.workspace.path)).toBe(true);
});
it("never creates a missing inventory root",async()=>{
 const root=mkdtempSync(join(tmpdir(),"dispatcher-orphan-missing-"));roots.push(root);const missing=join(root,"missing");expect(await inspectWorkspaceOrphans(missing,[])).toEqual([]);expect(existsSync(missing)).toBe(false);
});
it.each(["clean","process"])("never executes an untrusted Git %s filter during inventory or cleanup preview",async driver=>{
 const f=await fixture(),marker=join(f.root,"filter-executed"),git=(args:string[])=>execFileSync("git",["-C",f.workspace.path,...args],{stdio:"pipe"});writeFileSync(join(f.workspace.path,".gitattributes"),"file filter=probe\n");git(["add",".gitattributes"]);git(["commit","-m","attributes"]);git(["config",`filter.probe.${driver}`,`touch '${marker}'; cat`]);writeFileSync(join(f.workspace.path,"file"),"modified");utimesSync(join(f.workspace.path,"file"),new Date(Date.now()+2000),new Date(Date.now()+2000));
 const rows=await inspectWorkspaceOrphans(f.trees,[]);expect(existsSync(marker)).toBe(false);expect(rows[0]).toMatchObject({git:"unavailable",action:"report"});const plan=await f.manager.cleanupPlan(f.workspace);expect(plan.safe).toBe(false);expect(existsSync(marker)).toBe(false);expect(existsSync(f.workspace.path)).toBe(true);
});
it("never descends into a submodule with its own untrusted filter",async()=>{
 const parent=await fixture(),source=await fixture(),marker=join(parent.root,"submodule-filter-executed"),sourceGit=(args:string[])=>execFileSync("git",["-C",source.repo,...args],{stdio:"pipe"});writeFileSync(join(source.repo,".gitattributes"),"file filter=probe\n");sourceGit(["add",".gitattributes"]);sourceGit(["commit","-m","attributes"]);
 const git=(args:string[])=>execFileSync("git",["-C",parent.workspace.path,...args],{stdio:"pipe"});git(["-c","protocol.file.allow=always","submodule","add",source.repo,"child"]);git(["commit","-m","child"]);const child=join(parent.workspace.path,"child");execFileSync("git",["-C",child,"config","filter.probe.clean",`touch '${marker}'; cat`],{stdio:"pipe"});writeFileSync(join(child,"file"),"modified");utimesSync(join(child,"file"),new Date(Date.now()+2000),new Date(Date.now()+2000));
 const rows=await inspectWorkspaceOrphans(parent.trees,[]);expect(existsSync(marker)).toBe(false);expect(rows[0]).toMatchObject({git:"unavailable",action:"report"});expect((await parent.manager.cleanupPlan(parent.workspace)).safe).toBe(false);expect(existsSync(marker)).toBe(false);
});
it("never lazy-fetches a missing promised tree or invokes its remote helper",async()=>{
 const f=await fixture(),marker=join(f.root,"remote-helper-executed"),bin=join(f.root,"bin"),beforePath=process.env.PATH;mkdirSync(bin);writeFileSync(join(bin,"git-remote-probe"),`#!/bin/sh\n: > '${marker}'\nexit 1\n`,{mode:0o700});const git=(args:string[])=>execFileSync("git",["-C",f.workspace.path,...args],{stdio:"pipe",encoding:"utf8"}),tree=git(["rev-parse","HEAD^{tree}"]).trim();git(["config","remote.origin.url","probe::synthetic"]);git(["config","remote.origin.promisor","true"]);git(["config","extensions.partialClone","origin"]);rmSync(join(f.repo,".git","objects",tree.slice(0,2),tree.slice(2)));process.env.PATH=`${bin}:${beforePath??""}`;
 try{const rows=await inspectWorkspaceOrphans(f.trees,[]);expect(existsSync(marker)).toBe(false);expect(rows[0]).toMatchObject({git:"unavailable",action:"report"});expect((await f.manager.cleanupPlan(f.workspace)).safe).toBe(false);expect(existsSync(marker)).toBe(false);}finally{if(beforePath===undefined)delete process.env.PATH;else process.env.PATH=beforePath;}
});
