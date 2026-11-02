import {execFileSync} from "node:child_process";
import type * as ChildProcess from "node:child_process";
import {existsSync,mkdtempSync,mkdirSync,readFileSync,realpathSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {afterEach,expect,it,vi} from "vitest";
const state=vi.hoisted(()=>({active:new Set<string>(),queueKeys:[] as string[],overlap:0,failNext:false,entered:undefined as (()=>void)|undefined,snapshotReady:undefined as (()=>void)|undefined,gate:undefined as Promise<void>|undefined}));
vi.mock("node:child_process",async importOriginal=>{
  const original=await importOriginal<typeof ChildProcess>(),{promisify}=await import("node:util"),execute=promisify(original.execFile),wrapped=vi.fn(original.execFile);
  Object.defineProperty(wrapped,promisify.custom,{value:async(file:string,args:string[],options?:object)=>{
    if(file!=="git"||!args.includes("worktree")||!args.some(value=>["add","remove","move"].includes(value))){const result=await execute(file,args,options??{});if(args.includes("commit-tree"))state.snapshotReady?.();if(file==="git"&&args.length===4&&args[2]==="rev-parse"&&args[3]==="--git-common-dir")state.queueKeys.push(realpathSync(resolve(args[1]!,String(result.stdout).trim())));return result;}
    const cwd=original.execFileSync("git",["-C",args[1]!,"rev-parse","--path-format=absolute","--git-common-dir"],{encoding:"utf8"}).trim();if(state.active.has(cwd)){state.overlap++;throw Error("fixture-incomplete-worktree-administration");}
    state.active.add(cwd);
    try{state.entered?.();await state.gate;await new Promise(resolve=>setTimeout(resolve,30));if(state.failNext){state.failNext=false;throw Error("fixture-git-failure");}return await execute(file,args,options??{});}finally{state.active.delete(cwd);}
  }});return {...original,execFile:wrapped};
});
import {RepositoryRegistry,WorkspaceManager,VerificationSnapshots} from "../src/index.js";
const roots:string[]=[];afterEach(()=>{vi.unstubAllEnvs();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});state.active.clear();state.queueKeys.length=0;state.overlap=0;state.failNext=false;state.entered=undefined;state.snapshotReady=undefined;state.gate=undefined;});
function fixture(){const root=mkdtempSync(join(tmpdir(),"worktree-concurrency-"));roots.push(root);const repository=join(root,"repo");mkdirSync(repository);execFileSync("git",["init","-b","main",repository]);execFileSync("git",["-C",repository,"config","user.name","Dispatcher Test"]);execFileSync("git",["-C",repository,"config","user.email","test@example.invalid"]);writeFileSync(join(repository,"file"),"baseline\n");execFileSync("git",["-C",repository,"add","file"]);execFileSync("git",["-C",repository,"commit","-m","fixture"]);
  const registry=new RepositoryRegistry();registry.register({id:"one",root:repository});registry.register({id:"alias",root:repository});return {root,repository,first:new WorkspaceManager(registry,join(root,"worktrees")),second:new WorkspaceManager(registry,join(root,"worktrees"))};}
const plan=(repositoryId:string,runId:string)=>({repositoryId,taskId:runId,runId,attempt:1,baseRef:"main",scopePaths:[]});
it.each(["retirement","verification"] as const)("uses the physical repository queue for %s under inherited Git selectors",async operation=>{
 const f=fixture(),foreign=fixture(),workspace=await f.first.create(plan("one","retire")),preview=await f.first.cleanupPlan(workspace);expect(preview.safe).toBe(true);state.queueKeys.length=0;
 vi.stubEnv("GIT_DIR",join(foreign.repository,".git"));
 const retainedPath=operation==="retirement"?(await f.first.cleanup(preview)).retainedPath:(await new VerificationSnapshots(f.first,join(f.root,"verification")).createDeliveryCandidate({repositoryId:"one",worktree:workspace.path,branch:workspace.branch,scopePaths:[],repositoryScopePaths:[]},()=>{})).path;
 vi.unstubAllEnvs();
 expect(state.queueKeys).toEqual([realpathSync(join(f.repository,".git"))]);expect(readFileSync(join(retainedPath,"file"),"utf8")).toBe("baseline\n");expect(readFileSync(join(foreign.repository,"file"),"utf8")).toBe("baseline\n");
});

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
it("orders owned retirement with another creation in the same Git administration directory",async()=>{
  const f=fixture(),workspace=await f.first.create(plan("one","old")),cleanup=await f.first.cleanupPlan(workspace);expect(cleanup.safe).toBe(true);
  const retiring=f.first.cleanup(cleanup),creating=f.second.create(plan("alias","new"));
  const results=await Promise.allSettled([retiring,creating]);
  expect(results.every(result=>result.status==="fulfilled")).toBe(true);expect(state.overlap).toBe(0);
  const retired=await retiring,created=await creating,list=execFileSync("git",["-C",f.repository,"worktree","list","--porcelain"],{encoding:"utf8"}).split("\n");
  expect(existsSync(workspace.path)).toBe(false);expect(list).not.toContain(`worktree ${workspace.path}`);expect(list).toContain(`worktree ${retired.retainedPath}`);expect(list).toContain(`worktree ${created.path}`);
  expect(readFileSync(join(retired.retainedPath,"file"),"utf8")).toBe("baseline\n");expect(execFileSync("git",["-C",retired.retainedPath,"branch","--show-current"],{encoding:"utf8"}).trim()).toBe(workspace.branch);
});
it.each(["create","retire"] as const)("orders retained verification snapshot creation with Manager %s",async operation=>{
  const f=fixture(),source=await f.first.create(plan("one","source")),old=await f.second.create(plan("alias","old")),cleanup=await f.second.cleanupPlan(old);
  const entered=Promise.withResolvers<void>(),gate=Promise.withResolvers<void>();state.entered=entered.resolve;state.gate=gate.promise;
  const snapshot=new VerificationSnapshots(f.first,join(f.root,"verification")).createDeliveryCandidate({repositoryId:"one",worktree:source.path,branch:source.branch,scopePaths:[],repositoryScopePaths:[]},()=>{});
  await entered.promise;
  const other=operation==="create"?f.second.create(plan("alias","new")):f.second.cleanup(cleanup);
  const results=Promise.allSettled([snapshot,other]);await new Promise(resolve=>setTimeout(resolve,100));gate.resolve();
  expect((await results).every(result=>result.status==="fulfilled")).toBe(true);expect(state.overlap).toBe(0);
});
it("rechecks snapshot authority after admission to a busy shared Git queue",async()=>{
  const f=fixture(),source=await f.first.create(plan("one","source")),entered=Promise.withResolvers<void>(),gate=Promise.withResolvers<void>(),ready=Promise.withResolvers<void>();
  state.entered=entered.resolve;state.gate=gate.promise;state.snapshotReady=ready.resolve;
  const manager=f.second.create(plan("alias","other"));await entered.promise;let authorized=true;
  const snapshot=new VerificationSnapshots(f.first,join(f.root,"verification")).createDeliveryCandidate({repositoryId:"one",worktree:source.path,branch:source.branch,scopePaths:[],repositoryScopePaths:[]},()=>{if(!authorized)throw Error("STALE_AUTHORITY");});
  const results=Promise.allSettled([manager,snapshot]);await ready.promise;await new Promise(resolve=>setTimeout(resolve,50));authorized=false;gate.resolve();
  expect(await results).toEqual([expect.objectContaining({status:"fulfilled"}),{status:"rejected",reason:expect.objectContaining({message:"STALE_AUTHORITY"})}]);expect(state.overlap).toBe(0);
  expect(execFileSync("git",["-C",f.repository,"worktree","list","--porcelain"],{encoding:"utf8"})).not.toContain("verification/");
});
