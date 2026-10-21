import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,chmodSync} from "node:fs";
import {join} from "node:path";import {tmpdir} from "node:os";
import {afterEach,expect,it,vi} from "vitest";
import {RepositoryRegistry,WorkspaceManager,VerificationSnapshots} from "../src/index.js";
const roots:string[]=[];afterEach(()=>{vi.unstubAllEnvs();for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true});});
async function fixture(){const root=mkdtempSync(join(tmpdir(),"dispatcher-candidate-"));roots.push(root);const repo=join(root,"repo"),worktrees=join(root,"worktrees");mkdirSync(repo);const git=(...args:string[])=>execFileSync("git",["-C",repo,...args],{stdio:"pipe"});git("init","--initial-branch=main");git("config","user.name","Fixture");git("config","user.email","fixture@example.invalid");writeFileSync(join(repo,"README.md"),"baseline\n");git("add",".");git("commit","-m","baseline");const registry=new RepositoryRegistry();registry.register({id:"repo",root:repo});const manager=new WorkspaceManager(registry,worktrees),workspace=await manager.create({repositoryId:"repo",taskId:"task",runId:"run",attempt:1,baseRef:"main",scopePaths:["."]});const source={repositoryId:"repo",worktree:workspace.path,branch:workspace.branch,scopePaths:["."],repositoryScopePaths:[] as string[]};return {root,repo,worktrees,registry,manager,workspace,source,git};}
const hash=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
it("identifies tracked and untracked candidate changes across manager restart",async()=>{
 const f=await fixture();writeFileSync(join(f.workspace.path,"README.md"),"changed\n");writeFileSync(join(f.workspace.path,"result.txt"),"first\n");const one=await f.manager.captureCandidate(f.source);expect(one.changedFiles).toEqual(["README.md","result.txt"]);expect((await new WorkspaceManager(f.registry,f.worktrees).captureCandidate(f.source)).id).toBe(one.id);writeFileSync(join(f.workspace.path,"result.txt"),"second\n");expect((await f.manager.captureCandidate(f.source)).id).not.toBe(one.id);
});
it("rejects source, wrong branch and out-of-scope results",async()=>{
 const f=await fixture();await expect(f.manager.captureCandidate({...f.source,worktree:f.repo})).rejects.toMatchObject({code:"CANDIDATE_WORKSPACE_MISMATCH"});await expect(f.manager.captureCandidate({...f.source,branch:"main"})).rejects.toMatchObject({code:"CANDIDATE_WORKSPACE_MISMATCH"});writeFileSync(join(f.workspace.path,"result.txt"),"candidate\n");await expect(f.manager.captureCandidate({...f.source,scopePaths:["README.md"]})).rejects.toMatchObject({code:"PATH_OUT_OF_SCOPE"});
});
it("refuses unqualified filters before status or diff can invoke them",async()=>{
 const f=await fixture(),sentinel=join(f.root,"filter-ran");f.git('config','filter.probe.clean',`sh -c 'echo unsafe > ${sentinel}; cat'`);writeFileSync(join(f.workspace.path,'.gitattributes'),'*.txt filter=probe\n');writeFileSync(join(f.workspace.path,'result.txt'),'candidate\n');await expect(f.manager.captureCandidate(f.source)).rejects.toMatchObject({code:"CANDIDATE_UNAVAILABLE"});expect(existsSync(sentinel)).toBe(false);
});
it("materializes a retained immutable verification snapshot without changing the execution index",async()=>{
 const f=await fixture();writeFileSync(join(f.workspace.path,"result.txt"),"candidate\n");const index=execFileSync('git',['-C',f.workspace.path,'rev-parse','--path-format=absolute','--git-path','index'],{encoding:'utf8'}).trim(),before=hash(index),snapshots=new VerificationSnapshots(f.manager,join(f.root,"verification")),candidate=await snapshots.createDeliveryCandidate(f.source,()=>{});expect(readFileSync(join(candidate.path,'result.txt'),'utf8')).toBe('candidate\n');expect(hash(index)).toBe(before);await snapshots.assertCandidateAuthority(candidate,()=>{});writeFileSync(join(f.workspace.path,'result.txt'),'changed after verification\n');await expect(snapshots.assertCandidateAuthority(candidate,()=>{})).rejects.toMatchObject({code:'CANDIDATE_CHANGED'});expect(readFileSync(join(candidate.path,'result.txt'),'utf8')).toBe('candidate\n');
});
it("rejects a changed verification snapshot and retains failed/over-capacity artifacts",async()=>{
 const f=await fixture(),snapshots=new VerificationSnapshots(f.manager,join(f.root,"verification"),1);writeFileSync(join(f.workspace.path,"result.txt"),"candidate\n");const candidate=await snapshots.createDeliveryCandidate(f.source,()=>{});writeFileSync(join(candidate.path,'README.md'),'snapshot mutated\n');await expect(snapshots.assertSnapshot(candidate)).rejects.toMatchObject({code:'VERIFICATION_SNAPSHOT_CHANGED'});await expect(snapshots.createDeliveryCandidate(f.source,()=>{})).rejects.toMatchObject({code:'VERIFICATION_CAPACITY_REACHED'});expect(existsSync(candidate.path)).toBe(true);
});
it("does not allocate a snapshot after authority is revoked",async()=>{
 const f=await fixture(),root=join(f.root,'verification'),snapshots=new VerificationSnapshots(f.manager,root);await expect(snapshots.createDeliveryCandidate(f.source,()=>{throw Error('STALE_AUTHORITY');})).rejects.toThrow('STALE_AUTHORITY');expect(existsSync(root)).toBe(false);
});

it("inspects the actual worktree independently of inherited Git directory overrides",async()=>{
 const f=await fixture(),before=await f.manager.captureCandidate(f.source);vi.stubEnv('GIT_DIR',join(f.repo,'.git'));vi.stubEnv('GIT_WORK_TREE',f.repo);expect((await f.manager.captureCandidate(f.source)).id).toBe(before.id);
});
it("does not invoke checkout hooks while materializing the registered verification candidate",async()=>{
 const f=await fixture(),hooks=join(f.root,'hooks'),sentinel=join(f.root,'hook-ran');mkdirSync(hooks);const hook=join(hooks,'post-checkout');writeFileSync(hook,`#!/bin/sh\necho invoked > '${sentinel}'\n`);chmodSync(hook,0o700);f.git('config','core.hooksPath',hooks);const snapshots=new VerificationSnapshots(f.manager,join(f.root,'verification'));await snapshots.createDeliveryCandidate(f.source,()=>{});expect(existsSync(sentinel)).toBe(false);
});
