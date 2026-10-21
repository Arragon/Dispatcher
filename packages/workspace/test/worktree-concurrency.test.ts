import {execFileSync} from "node:child_process";
import type * as ChildProcess from "node:child_process";
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach,expect,it,vi} from "vitest";
const state=vi.hoisted(()=>({active:new Set<string>(),overlap:0,failNext:false}));
vi.mock("node:child_process",async importOriginal=>{
  const original=await importOriginal<typeof ChildProcess>(),{promisify}=await import("node:util"),execute=promisify(original.execFile),wrapped=vi.fn(original.execFile);
  Object.defineProperty(wrapped,promisify.custom,{value:async(file:string,args:string[],options?:object)=>{
    if(file!=="git"||!args.includes("worktree")||!args.some(value=>["add","remove"].includes(value)))return execute(file,args,options??{});
    const cwd=args[1]!;if(state.active.has(cwd)){state.overlap++;throw Error("fixture-incomplete-worktree-administration");}
    state.active.add(cwd);
    try{await new Promise(resolve=>setTimeout(resolve,30));if(state.failNext){state.failNext=false;throw Error("fixture-git-failure");}return await execute(file,args,options??{});}finally{state.active.delete(cwd);}
  }});return {...original,execFile:wrapped};
});
import {RepositoryRegistry,WorkspaceManager} from "../src/index.js";
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});state.active.clear();state.overlap=0;state.failNext=false;});
function fixture(){const root=mkdtempSync(join(tmpdir(),"worktree-concurrency-"));roots.push(root);const repository=join(root,"repo");mkdirSync(repository);execFileSync("git",["init","-b","main",repository]);execFileSync("git",["-C",repository,"config","user.name","Dispatcher Test"]);execFileSync("git",["-C",repository,"config","user.email","test@example.invalid"]);writeFileSync(join(repository,"file"),"baseline\n");execFileSync("git",["-C",repository,"add","file"]);execFileSync("git",["-C",repository,"commit","-m","fixture"]);
  const registry=new RepositoryRegistry();registry.register({id:"one",root:repository});registry.register({id:"alias",root:repository});return {root,repository,first:new WorkspaceManager(registry,join(root,"worktrees")),second:new WorkspaceManager(registry,join(root,"worktrees"))};}
const plan=(repositoryId:string,runId:string)=>({repositoryId,taskId:runId,runId,attempt:1,baseRef:"main",scopePaths:[]});
it("serializes same-repository Git administration across aliases and managers while retaining distinct workspaces",async()=>{
  const f=fixture(),results=await Promise.allSettled([f.first.create(plan("one","first")),f.second.create(plan("alias","second"))]);
  expect(results.every(result=>result.status==="fulfilled")).toBe(true);expect(state.overlap).toBe(0);
  const list=execFileSync("git",["-C",f.repository,"worktree","list","--porcelain"],{encoding:"utf8"});expect(list).toContain("first-first-a1");expect(list).toContain("second-second-a1");
});
it("releases a failed Git mutation so the queued request can proceed",async()=>{
  const f=fixture();state.failNext=true;
  const results=await Promise.allSettled([f.first.create(plan("one","failed")),f.second.create(plan("alias","survivor"))]);
  expect(results.map(result=>result.status).sort()).toEqual(["fulfilled","rejected"]);expect(state.overlap).toBe(0);
  expect(await f.first.create(plan("one","later"))).toMatchObject({runId:"later"});
});
it("orders owned removal with another creation in the same Git administration directory",async()=>{
  const f=fixture(),workspace=await f.first.create(plan("one","old")),cleanup=await f.first.cleanupPlan(workspace);expect(cleanup.safe).toBe(true);
  const results=await Promise.allSettled([f.first.cleanup(cleanup),f.second.create(plan("alias","new"))]);
  expect(results.every(result=>result.status==="fulfilled")).toBe(true);expect(state.overlap).toBe(0);
  expect(execFileSync("git",["-C",f.repository,"worktree","list","--porcelain"],{encoding:"utf8"})).not.toContain("old-old-a1");
});
