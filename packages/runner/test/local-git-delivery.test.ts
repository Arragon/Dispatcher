import {execFileSync as nativeExecFileSync} from "node:child_process";
import {existsSync,readFileSync,chmodSync,mkdtempSync,writeFileSync,rmSync,mkdirSync,cpSync,appendFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {expect,it,vi} from "vitest";
import {DispatcherDatabase} from "@dispatcher/persistence";
import {RepositoryRegistry,WorkspaceManager} from "@dispatcher/workspace";
import {ProcessManager} from "../src/process.js";
import {LocalGitDelivery} from "../src/local-git-delivery.js";
// Keep actual fixture commands and bytes before cleanup, including failed tests.
const evidence=process.env.DISPATCHER_DELIVERY_URL_FIXTURE_EVIDENCE;
const execFileSync=((...args:Parameters<typeof nativeExecFileSync>)=>{
 try{const result=nativeExecFileSync(...args);if(evidence){mkdirSync(evidence,{recursive:true});appendFileSync(join(evidence,`runner-commands-${process.pid}.jsonl`),JSON.stringify({argv:args,stdout:String(result),exit:0})+"\n");}return result;}
 catch(error){if(evidence){mkdirSync(evidence,{recursive:true});const e=error as {stdout?:unknown;stderr?:unknown;status?:unknown};appendFileSync(join(evidence,`runner-commands-${process.pid}.jsonl`),JSON.stringify({argv:args,stdout:String(e.stdout??""),stderr:String(e.stderr??""),exit:e.status})+"\n");}throw error;}
}) as typeof nativeExecFileSync;
function retain(directory:string){if(evidence){mkdirSync(evidence,{recursive:true});cpSync(directory,join(evidence,directory.split("/").at(-1)!),{recursive:true});}}
async function fixture(){
 if(evidence&&process.env.DISPATCHER_DELIVERY_URL_GIT_BIN)vi.stubEnv("PATH",`${process.env.DISPATCHER_DELIVERY_URL_GIT_BIN}:${process.env.PATH}`);
 const directory=mkdtempSync(join(tmpdir(),"local-git-delivery-")),root=join(directory,"repo"),db=new DispatcherDatabase(join(directory,"state.sqlite"));execFileSync("git",["init","-b","main",root],{stdio:"ignore"});
 const git=(...args:string[])=>execFileSync("git",["-C",root,...args],{encoding:"utf8"}).trim();git("config","user.name","Fixture");git("config","user.email","fixture@example.invalid");writeFileSync(join(root,"base.txt"),"base");git("add",".");git("commit","-m","base");git("remote","add","origin","https://must-not-push.invalid/repo.git");
 const registry=new RepositoryRegistry();registry.register({id:"repo",root});const workspaces=new WorkspaceManager(registry,join(directory,"worktrees")),workspace=await workspaces.create({repositoryId:"repo",taskId:"task",runId:"run",attempt:1,baseRef:"main",scopePaths:["result.txt"]}),processes=new ProcessManager(join(directory,"logs"));
 const service=new LocalGitDelivery(db,processes,workspaces),input={runId:"run",generation:1,leaseId:"lease",workspace,message:"Dispatcher fixture",assertAuthority:()=>undefined};
 return {directory,root,db,git,workspaces,workspace,processes,service,input,close:async()=>{await processes.shutdown();db.close();retain(directory);rmSync(directory,{recursive:true,force:true});vi.unstubAllEnvs();}};
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

async function pushFixture(){
 const f=await fixture(),bare=join(f.directory,"remote.git"),ssh=join(f.directory,"fixture-ssh");execFileSync("git",["init","--bare",bare],{stdio:"ignore"});
 writeFileSync(ssh,`#!${process.execPath}\nconst {spawnSync}=require('node:child_process');const result=spawnSync('git-receive-pack',[${JSON.stringify(bare)}],{stdio:'inherit'});process.exit(result.status??1);\n`);chmodSync(ssh,0o755);
 f.git("remote","set-url","origin","ssh://git@github.example/acme/repo.git");f.git("config","core.sshCommand",ssh);f.git("config","ssh.variant","ssh");return {...f,bare};
}
it("pushes the frozen managed commit through the owning process and replays without another push",async()=>{
 const f=await pushFixture();try{
  const target=await f.workspaces.deliveryTarget("repo");expect(target).toMatchObject({host:"github.example",repository:"acme/repo"});expect(JSON.stringify(target)).not.toContain("ssh://");writeFileSync(join(f.workspace.path,"result.txt"),"published locally\n");
  const start=vi.spyOn(f.processes,"start"),result=await f.service.push({...f.input,target});expect(result).toMatchObject({runId:"run",generation:1,target,branch:f.workspace.branch});
  expect(execFileSync("git",["--git-dir",f.bare,"rev-parse",`refs/heads/${f.workspace.branch}`],{encoding:"utf8"}).trim()).toBe(result.commit);
  expect(await new LocalGitDelivery(f.db,f.processes,f.workspaces).push({...f.input,target})).toEqual(result);expect(start.mock.calls.filter(([input])=>input.args?.includes("push"))).toHaveLength(1);expect(f.processes.activeCount).toBe(0);
 }finally{await f.close();}
});
it("rejects changed, credential-bearing, multiple or mismatched remotes before commit or push",async()=>{
 const f=await pushFixture();try{
  const target=await f.workspaces.deliveryTarget("repo");await expect(f.service.push({...f.input,target,assertAuthority:()=>{throw new Error("revoked push lease");}})).rejects.toThrow("revoked push lease");writeFileSync(join(f.workspace.path,"result.txt"),"must stay uncommitted");f.git("remote","set-url","origin","ssh://git@github.example/acme/other.git");
  await expect(f.service.push({...f.input,target})).rejects.toMatchObject({code:"DELIVERY_TARGET_CHANGED"});expect(execFileSync("git",["-C",f.workspace.path,"diff","--cached","--name-only"],{encoding:"utf8"})).toBe("");
  for(const url of ["https://token@github.example/acme/repo.git","file:///tmp/private","ssh://root@github.example/acme/repo.git","https://github.example/acme/../repo.git"]){f.git("remote","set-url","origin",url);await expect(f.workspaces.deliveryTarget("repo")).rejects.toMatchObject({code:"INVALID_DELIVERY_REMOTE"});}
  f.git("remote","set-url","origin","ssh://git@github.example/acme/repo.git");f.git("remote","set-url","--push","origin","ssh://git@github.example/acme/other.git");await expect(f.workspaces.deliveryTarget("repo")).rejects.toMatchObject({code:"INVALID_DELIVERY_REMOTE"});f.git("config","--unset-all","remote.origin.pushurl");f.git("remote","set-url","--add","--push","origin","ssh://git@github.example/acme/repo.git");f.git("remote","set-url","--add","--push","origin","ssh://git@github.example/acme/other.git");await expect(f.workspaces.deliveryTarget("repo")).rejects.toMatchObject({code:"INVALID_DELIVERY_REMOTE"});
 }finally{await f.close();}
});

it("does not repeat a push after a failed completion receipt and preserves unknown outcome after restart",async()=>{
 const f=await pushFixture();try{
  const target=await f.workspaces.deliveryTarget("repo");writeFileSync(join(f.workspace.path,"result.txt"),"push once");const start=vi.spyOn(f.processes,"start"),original=f.db.saveEntity.bind(f.db),save=vi.spyOn(f.db,"saveEntity").mockImplementation((...args)=>{if(args[0]==="git-push-delivery"&&(args[2] as {state?:string}).state==="COMPLETE")throw new Error("push receipt disk failure");original(...args);});
  await expect(f.service.push({...f.input,target})).rejects.toThrow("push receipt disk failure");save.mockRestore();
  await expect(new LocalGitDelivery(f.db,f.processes,f.workspaces).push({...f.input,target})).rejects.toMatchObject({code:"PUSH_OUTCOME_UNKNOWN"});const known=await f.service.push({...f.input,target});expect(execFileSync("git",["--git-dir",f.bare,"rev-parse",`refs/heads/${f.workspace.branch}`],{encoding:"utf8"}).trim()).toBe(known.commit);expect(start.mock.calls.filter(([input])=>input.args?.includes("push"))).toHaveLength(1);
 }finally{await f.close();}
});
it("cancels and drains an unresponsive owning pre-push hook before returning",async()=>{
 const f=await pushFixture();try{
  const target=await f.workspaces.deliveryTarget("repo"),ready=join(f.directory,"push-hook.pid"),hook=join(f.root,".git","hooks","pre-push");
  writeFileSync(hook,`#!${process.execPath}\nconst fs=require('node:fs');process.on('SIGTERM',()=>{});fs.writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>{},1000);\n`);chmodSync(hook,0o755);writeFileSync(join(f.workspace.path,"result.txt"),"cancel push");
  const abort=new AbortController(),pushing=f.service.push({...f.input,target,signal:abort.signal}),rejected=expect(pushing).rejects.toMatchObject({code:"COMMIT_ABORTED"});await expect.poll(()=>existsSync(ready),{timeout:5000}).toBe(true);const pid=Number(readFileSync(ready,"utf8"));abort.abort();await rejected;
  let absent=false;try{process.kill(pid,0);}catch(error){absent=Boolean(error&&typeof error==="object"&&"code" in error&&error.code==="ESRCH");}expect(absent).toBe(true);expect(f.processes.activeCount).toBe(0);expect(execFileSync("git",["--git-dir",f.bare,"for-each-ref","--format=%(objectname)",`refs/heads/${f.workspace.branch}`],{encoding:"utf8"}).trim()).toBe("");
  await expect(new LocalGitDelivery(f.db,f.processes,f.workspaces).push({...f.input,target})).rejects.toMatchObject({code:"PUSH_OUTCOME_UNKNOWN"});
 }finally{await f.close();}
});

const approvedUrl="ssh://git@github.example/acme/approved.git",otherUrl="ssh://git@github.example/acme/other.git",aliasUrl="ssh://git@github.example/acme/alias.git";
async function rewriteFixture(){
 const f=await fixture(),approved=join(f.directory,"approved.git"),other=join(f.directory,"other.git"),ssh=join(f.directory,"route-ssh.cjs"),routes=join(f.directory,"ssh-routes.jsonl");
 for(const bare of [approved,other])execFileSync("git",["init","--bare",bare],{stdio:"pipe"});
 const program=`#!${process.execPath}\nconst fs=require('node:fs'),{spawnSync}=require('node:child_process');const argv=process.argv.slice(2),routes=${JSON.stringify(routes)};fs.appendFileSync(routes,JSON.stringify({argv})+'\\n');const known=${JSON.stringify({"git-receive-pack '/acme/approved.git'":approved,"git-receive-pack '/acme/other.git'":other})};const path=known[argv.at(-1)];if(!argv.includes('git@github.example')||!path)process.exit(64);const r=spawnSync('git-receive-pack',[path],{stdio:'inherit'});process.exit(r.status??1);\n`;
 writeFileSync(ssh,program);chmodSync(ssh,0o755);f.git("remote","set-url","origin",approvedUrl);f.git("config","core.sshCommand",ssh);f.git("config","ssh.variant","ssh");
 const mappings=(kind:string)=>{f.git("remote","set-url","origin",aliasUrl);f.git("config",`url.${approvedUrl}.insteadOf`,aliasUrl);f.git("config",`url.${otherUrl}.${kind}`,approvedUrl);};
 const state=(phase:string)=>{
  const at=(...args:string[])=>execFileSync("git",["-C",f.workspace.path,...args],{encoding:"utf8"}).trim();
  const refs=(bare:string)=>execFileSync("git",["--git-dir",bare,"for-each-ref","--format=%(refname) %(objectname)"],{encoding:"utf8"});
  const result={head:at("rev-parse","HEAD"),tree:at("rev-parse","HEAD^{tree}"),index:readFileSync(at("rev-parse","--path-format=absolute","--git-path","index")).toString("hex"),bytes:existsSync(join(f.workspace.path,"result.txt"))?readFileSync(join(f.workspace.path,"result.txt")).toString("hex"):null,approvedRefs:refs(approved),otherRefs:refs(other)};
  writeFileSync(join(f.directory,`${phase}.json`),JSON.stringify(result,null,2));return result;
 };
 return {...f,approved,other,routes,mappings,state};
}
for(const kind of ["insteadOf","pushInsteadOf"]){
 it(`refuses ${kind} alias-to-approved-to-other mappings at initial target review`,async()=>{
  const f=await rewriteFixture();try{f.mappings(kind);f.state("before-review");await expect(f.workspaces.deliveryTarget("repo")).rejects.toMatchObject({code:"INVALID_DELIVERY_REMOTE"});}finally{f.state("after-review");await f.close();}
 });
 it(`refuses ${kind} mappings added after review before staging or commit`,async()=>{
  const f=await rewriteFixture();try{
   const target=await f.workspaces.deliveryTarget("repo");writeFileSync(join(f.workspace.path,"result.txt"),"must remain uncommitted\n");const before=f.state("before-mappings");f.mappings(kind);
   expect(f.git("remote","get-url","origin")).toBe(approvedUrl);expect(f.git("remote","get-url","--push","origin")).toBe(approvedUrl);
   const outcome=await f.service.push({...f.input,target}).then(result=>({result,error:undefined}),error=>({result:undefined,error}));const after=f.state("after-push");
   expect(outcome.error).toMatchObject({code:"INVALID_DELIVERY_REMOTE"});expect(after).toEqual(before);expect(existsSync(f.routes)).toBe(false);
  }finally{f.state("final");await f.close();}
 });
 it(`refuses ${kind} mappings added after a real commit while preserving its receipt`,async()=>{
  const f=await rewriteFixture();try{
   const target=await f.workspaces.deliveryTarget("repo");writeFileSync(join(f.workspace.path,"result.txt"),"commit remains owned\n");const before=f.state("before-commit"),commit=f.service.commit.bind(f.service);let actual:Awaited<ReturnType<typeof commit>>|undefined;
   const seam=vi.spyOn(f.service,"commit").mockImplementation(async input=>{actual=await commit(input);f.state("completed-commit");f.mappings(kind);return actual;});
   const outcome=await f.service.push({...f.input,target}).then(result=>({result,error:undefined}),error=>({result:undefined,error}));seam.mockRestore();const after=f.state("after-push");
   expect(actual).toMatchObject({created:true,branch:f.workspace.branch,files:["result.txt"]});expect(after.head).toBe(actual?.commit);expect(after.head).not.toBe(before.head);expect(await f.service.commit(f.input)).toEqual(actual);
   expect(outcome.error).toMatchObject({code:"INVALID_DELIVERY_REMOTE"});expect(after.otherRefs).toBe("");expect(after.approvedRefs).toBe("");expect(existsSync(f.routes)).toBe(false);
  }finally{f.state("final");await f.close();}
 });
}
it("routes a direct approved push only to the approved owned bare repository",async()=>{
 const f=await rewriteFixture();try{const target=await f.workspaces.deliveryTarget("repo");writeFileSync(join(f.workspace.path,"result.txt"),"direct\n");const pushed=await f.service.push({...f.input,target}),after=f.state("direct-push");expect(after.approvedRefs).toContain(pushed.commit);expect(after.otherRefs).toBe("");expect(readFileSync(f.routes,"utf8")).toContain("/acme/approved.git");}finally{await f.close();}
});
