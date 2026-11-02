import {execFileSync as nativeExecFileSync} from "node:child_process";
import {existsSync,readFileSync,chmodSync,mkdtempSync,writeFileSync,rmSync,mkdirSync,cpSync,appendFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {expect,it,vi} from "vitest";
import {DispatcherDatabase} from "@dispatcher/persistence";
import {RepositoryRegistry,WorkspaceManager,VerificationSnapshots} from "@dispatcher/workspace";
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
it("refuses post-verification edits before commit and never labels their tree as verified",async()=>{
 const f=await fixture();try{
  writeFileSync(join(f.workspace.path,"result.txt"),"verified\n");
  const snapshots=new VerificationSnapshots(f.workspaces,join(f.directory,"snapshots")),snapshot=await snapshots.createDeliveryCandidate({repositoryId:"repo",worktree:f.workspace.path,branch:f.workspace.branch,scopePaths:["result.txt"],repositoryScopePaths:["result.txt"]},()=>undefined);
  await snapshots.assertCandidateAuthority(snapshot,()=>undefined);
  writeFileSync(join(f.workspace.path,"result.txt"),"not verified\n");
  await expect(f.service.commit({...f.input,verifiedTree:snapshot.tree})).rejects.toMatchObject({code:"VERIFIED_TREE_CHANGED"});
  expect(execFileSync("git",["-C",f.workspace.path,"rev-parse","HEAD"],{encoding:"utf8"}).trim()).toBe(f.workspace.baseRevision);
 }finally{await f.close();}
});
it("records the actual committed tree when it matches the content-bound verification",async()=>{
 const f=await fixture();try{
  writeFileSync(join(f.workspace.path,"result.txt"),"verified\n");
  const snapshots=new VerificationSnapshots(f.workspaces,join(f.directory,"snapshots")),snapshot=await snapshots.createDeliveryCandidate({repositoryId:"repo",worktree:f.workspace.path,branch:f.workspace.branch,scopePaths:["result.txt"],repositoryScopePaths:["result.txt"]},()=>undefined);
  const result=await f.service.commit({...f.input,verifiedTree:snapshot.tree});
  expect(result.tree).toBe(snapshot.tree);expect(execFileSync("git",["-C",f.workspace.path,"rev-parse",`${result.commit}^{tree}`],{encoding:"utf8"}).trim()).toBe(snapshot.tree);
  const candidate=await snapshots.createDeliveryCandidate(snapshot.source,()=>undefined),input={...f.input,proof:{id:"after-verified-tree",hash:"a".repeat(64)},candidate,assertSource:()=>snapshots.assertCandidateAuthority(candidate,()=>undefined),assertSnapshot:()=>snapshots.assertSnapshot(candidate)};
  expect(await f.service.commitSnapshot(input)).toMatchObject({commit:result.commit,created:false});
  const row=f.db.handle.prepare("SELECT id,document_json FROM entities WHERE kind='local-git-delivery'").get() as {id:string;document_json:string},receipt=JSON.parse(row.document_json);receipt.result.tree="invalid-tree";f.db.saveEntity("local-git-delivery",row.id,receipt);
  await expect(new LocalGitDelivery(f.db,f.processes,f.workspaces).commitSnapshot(input)).rejects.toMatchObject({code:"SNAPSHOT_COMMIT_OUTCOME_UNKNOWN"});
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

// Command-result observations are private facts, separate from legacy operation receipts.
import {createHash} from "node:crypto";
import type {ManagedProcessHandle,ProcessResult} from "../src/process.js";
const journalHash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
type JournalPhase="stage"|"commit"|"push";
const ownerId=()=>journalHash({runId:"run",generation:1});
const journalId=(phase:JournalPhase)=>journalHash(["local-git-command",phase==="push"?"git-push-delivery":"local-git-delivery",ownerId(),phase]);
const mutationPhase=(args:readonly string[]|undefined):JournalPhase|undefined=>args?.[1]==="add"?"stage":args?.[1]==="commit"?"commit":args?.[1]==="push"?"push":undefined;
type JournalFixture=Awaited<ReturnType<typeof pushFixture>>&{work:<T>(work:Promise<T>)=>Promise<T>;expected:<T>(work:Promise<T>)=>Promise<T>};
interface OwnedWorkObservation {state:"pending"|"fulfilled"|"rejected";expectedRejection:boolean;error?:unknown;settledAt?:string;settlement?:Promise<void>}
interface CommandObservation {phase:JournalPhase|undefined;input:Parameters<ProcessManager["start"]>[0];handle?:{id:string;pid:number};result?:ProcessResult;fault?:string}
async function observedFixture(body:(f:JournalFixture,observations:CommandObservation[],boundary:{afterResult?:(phase:JournalPhase,result:ProcessResult,handle:ManagedProcessHandle)=>void|Promise<void>;returnedResult?:(phase:JournalPhase,result:ProcessResult)=>unknown})=>Promise<void>){
 const base=await pushFixture(),observations:CommandObservation[]=[],boundary:{afterResult?:(phase:JournalPhase,result:ProcessResult,handle:ManagedProcessHandle)=>void|Promise<void>;returnedResult?:(phase:JournalPhase,result:ProcessResult)=>unknown}={},errors:unknown[]=[],ownedWork=new Map<Promise<unknown>,OwnedWorkObservation>();
 const register=<T>(work:Promise<T>,expectedRejection=false):Promise<T>=>{
  let entry=ownedWork.get(work);if(!entry){entry={state:"pending",expectedRejection};ownedWork.set(work,entry);const observed=entry;
   observed.settlement=work.then(()=>{observed.state="fulfilled";observed.settledAt=new Date().toISOString();},error=>{observed.state="rejected";observed.error=error;observed.settledAt=new Date().toISOString();});
  }if(expectedRejection)entry.expectedRejection=true;return work;
 };
 const f:JournalFixture=Object.assign(base,{work:<T>(work:Promise<T>)=>register(work),expected:<T>(work:Promise<T>)=>register(work,true)});
 const start=f.processes.start.bind(f.processes),spy=vi.spyOn(f.processes,"start").mockImplementation(async input=>{
  const observation:CommandObservation={phase:mutationPhase(input.args),input:structuredClone(input)};observations.push(observation);const handle=await start(input);observation.handle={id:handle.id,pid:handle.pid};
  return {...handle,result:async()=>{const result=await handle.result();observation.result=structuredClone(result);if(observation.phase){try{await boundary.afterResult?.(observation.phase,result,handle);}catch(error){observation.fault=String(error);throw error;}if(boundary.returnedResult)return boundary.returnedResult(observation.phase,result) as ProcessResult;}return result;}};
 });
 const addError=(error:unknown)=>{if(!errors.includes(error))errors.push(error);};
 try{await body(f,observations,boundary);}catch(error){addError(error);}
 // Bodies release their owned gates in finally before we drain service work, including child-free reads.
 try{
  for(;;){const pending=[...ownedWork.values()].filter(entry=>entry.state==="pending");if(!pending.length)break;const drained=await Promise.allSettled(pending.map(entry=>entry.settlement!));for(const result of drained)if(result.status==="rejected")addError(result.reason);}
  for(const entry of ownedWork.values())if(entry.state==="rejected"&&!entry.expectedRejection)addError(entry.error);
 }catch(error){addError(error);}
 try{await f.processes.shutdown();}catch(error){addError(error);}
 try{
  const tables=f.db.handle.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{name:string}>;
  const inventory=Object.fromEntries(tables.map(({name})=>[name,f.db.handle.prepare(`SELECT * FROM "${name.replaceAll('"','""')}"`).all()]));
  writeFileSync(join(f.directory,"journal-original-observations.json"),JSON.stringify({capturedAt:new Date().toISOString(),scope:"Actual original ProcessManager calls/results and SQL inventories before original fixture cleanup; labelled callbacks are faults, not native/provider Gates",observations,workOutcomes:[...ownedWork.values()].map(({state,expectedRejection,error,settledAt})=>({state,expectedRejection,error:error===undefined?undefined:String(error),settledAt})),errors:errors.map(String),inventory},null,2));
 }catch(error){addError(error);}
 spy.mockRestore();try{await f.close();}catch(error){addError(error);}
 if(errors.length)throw new AggregateError(errors,"Journal fixture body/pending/capture/cleanup failures");
}
const commandFact=(f:JournalFixture,phase:JournalPhase)=>f.db.getEntity("local-git-command",journalId(phase));
const scalarResult=(result:ProcessResult)=>({sessionId:result.sessionId,exitCode:result.exitCode,signal:result.signal,classification:result.classification,durationMs:result.durationMs});
it.each(["stage","commit","push"] as const)("records returned owned Git mutation facts before authority refusal (%s)",async phase=>{
 await observedFixture(async(f,observations,boundary)=>{
  const target=await f.workspaces.deliveryTarget("repo");writeFileSync(join(f.workspace.path,"result.txt"),"actual command outcome\n");let revoked=false;
  boundary.afterResult=actual=>{if(actual===phase)revoked=true;};
  const input={...f.input,target,assertAuthority:()=>{if(revoked)throw new Error("labelled callback authority refusal");}};
  const outcome=await f.expected((phase==="push"?f.work(f.service.push(input)):f.work(f.service.commit(input)))).then(value=>({value,error:undefined}),error=>({value:undefined,error}));
  const actual=observations.find(observation=>observation.phase===phase)!;
  const physical={index:execFileSync("git",["-C",f.workspace.path,"diff","--cached","--name-only"],{encoding:"utf8"}),head:execFileSync("git",["-C",f.workspace.path,"rev-parse","HEAD"],{encoding:"utf8"}).trim(),remote:execFileSync("git",["--git-dir",f.bare,"for-each-ref","--format=%(objectname)"],{encoding:"utf8"}).trim()};
  writeFileSync(join(f.directory,"authority-refusal-facts.json"),JSON.stringify({phase,actual,physical,fact:commandFact(f,phase),error:String(outcome.error)},null,2));
  expect(outcome.error).toMatchObject({message:"labelled callback authority refusal"});expect(actual.result?.classification).toBe("success");
  if(phase==="stage")expect(physical.index.trim()).toBe("result.txt");else expect(physical.head).not.toBe(f.workspace.baseRevision);
  if(phase==="push")expect(physical.remote).toBe(physical.head);
  expect(commandFact(f,phase)).toMatchObject({version:1,id:journalId(phase),ownerKind:phase==="push"?"git-push-delivery":"local-git-delivery",ownerId:ownerId(),phase,runId:"run",generation:1,leaseId:"lease",cwd:f.workspace.path,commandHash:journalHash({file:"git",args:actual.input.args,cwd:actual.input.cwd}),state:"SETTLED",handle:actual.handle,result:scalarResult(actual.result!)});
  const fact=commandFact(f,phase) as {observedAt?:string};expect(Number.isFinite(Date.parse(fact.observedAt!))).toBe(true);
  expect(JSON.stringify(fact)).not.toContain("actual command outcome");expect(JSON.stringify(fact)).not.toContain("ssh://");expect(JSON.stringify(fact)).not.toContain(f.input.message);
 });
});

it.each(["commit","push"] as const)("keeps an actually successful %s with lost returned result uncertain, including a removed legacy receipt",async phase=>{
 await observedFixture(async(f,observations,boundary)=>{
  const target=await f.workspaces.deliveryTarget("repo");writeFileSync(join(f.workspace.path,"result.txt"),"lost result\n");boundary.afterResult=actual=>{if(actual===phase)throw new Error("labelled returned-result loss");};
  const call=(service:LocalGitDelivery)=>phase==="push"?f.work(service.push({...f.input,target})):f.work(service.commit(f.input));
  await expect(f.expected(call(f.service))).rejects.toThrow("labelled returned-result loss");const actual=observations.find(o=>o.phase===phase)!;expect(actual.result?.classification).toBe("success");expect(commandFact(f,phase)).toMatchObject({state:"SENDING"});
  const head=execFileSync("git",["-C",f.workspace.path,"rev-parse","HEAD"],{encoding:"utf8"}).trim();expect(head).not.toBe(f.workspace.baseRevision);if(phase==="push")expect(execFileSync("git",["--git-dir",f.bare,"rev-parse",`refs/heads/${f.workspace.branch}`],{encoding:"utf8"}).trim()).toBe(head);
  const count=observations.length,code=phase==="push"?"PUSH_OUTCOME_UNKNOWN":"COMMIT_OUTCOME_UNKNOWN";
  await expect(f.expected(call(new LocalGitDelivery(f.db,f.processes,f.workspaces)))).rejects.toMatchObject({code});
  f.db.handle.prepare("DELETE FROM entities WHERE kind=? AND id=?").run(phase==="push"?"git-push-delivery":"local-git-delivery",ownerId());
  await expect(f.expected(call(new LocalGitDelivery(f.db,f.processes,f.workspaces)))).rejects.toMatchObject({code});await expect(f.expected(call(f.service))).rejects.toMatchObject({code});expect(observations).toHaveLength(count);
 });
});
it.each(["stage","commit","push"] as const)("retains uncertainty and the original storage error when %s settlement fails",async phase=>{
 await observedFixture(async(f,observations)=>{
  const target=await f.workspaces.deliveryTarget("repo");writeFileSync(join(f.workspace.path,"result.txt"),"settlement failure\n");const save=f.db.saveEntity.bind(f.db),fault=vi.spyOn(f.db,"saveEntity").mockImplementation((...args)=>{if(args[0]==="local-git-command"&&(args[2] as {phase?:string;state?:string}).phase===phase&&(args[2] as {state?:string}).state==="SETTLED")throw new Error("labelled journal settlement storage failure");save(...args);});
  try{await expect(f.expected(phase==="push"?f.work(f.service.push({...f.input,target})):f.work(f.service.commit(f.input)))).rejects.toThrow("labelled journal settlement storage failure");}finally{fault.mockRestore();}
  expect(observations.find(o=>o.phase===phase)?.result?.classification).toBe("success");expect(commandFact(f,phase)).toMatchObject({state:"SENDING"});const count=observations.length;
  await expect(f.expected(phase==="push"?f.work(new LocalGitDelivery(f.db,f.processes,f.workspaces).push({...f.input,target})):f.work(new LocalGitDelivery(f.db,f.processes,f.workspaces).commit(f.input)))).rejects.toMatchObject({code:phase==="push"?"PUSH_OUTCOME_UNKNOWN":"COMMIT_OUTCOME_UNKNOWN"});expect(observations).toHaveLength(count);
 });
});
it("retains the actual nonzero hook result before the existing Git failure",async()=>{
 await observedFixture(async(f,observations)=>{
  const hook=join(f.root,".git/hooks/pre-commit");writeFileSync(hook,"#!/bin/sh\nexit 23\n");chmodSync(hook,0o755);writeFileSync(join(f.workspace.path,"result.txt"),"rejected by real hook\n");
  await expect(f.expected(f.work(f.service.commit(f.input)))).rejects.toMatchObject({code:"LOCAL_GIT_FAILED"});const actual=observations.find(o=>o.phase==="commit")!;expect(actual.result).toMatchObject({classification:"nonzero",exitCode:1});expect(commandFact(f,"commit")).toMatchObject({state:"SETTLED",handle:actual.handle,result:scalarResult(actual.result!)});
  expect(execFileSync("git",["-C",f.workspace.path,"rev-parse","HEAD"],{encoding:"utf8"}).trim()).toBe(f.workspace.baseRevision);
 });
});
it("retains the actual cancelled push result and drains the owning hook before refusal",async()=>{
 await observedFixture(async(f,observations)=>{
  const target=await f.workspaces.deliveryTarget("repo"),ready=join(f.directory,"journal-hook.pid"),hook=join(f.root,".git/hooks/pre-push");
  writeFileSync(hook,`#!${process.execPath}\nconst fs=require('node:fs');process.on('SIGTERM',()=>{});fs.writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>{},1000);\n`);chmodSync(hook,0o755);writeFileSync(join(f.workspace.path,"result.txt"),"cancelled owned push\n");
  const abort=new AbortController(),work=f.work(f.service.push({...f.input,target,signal:abort.signal})),rejection=expect(f.expected(work)).rejects.toMatchObject({code:"COMMIT_ABORTED"});
  try{await expect.poll(()=>existsSync(ready),{timeout:5000}).toBe(true);}finally{abort.abort();await rejection;}
  const actual=observations.find(o=>o.phase==="push")!;expect(actual.result?.classification).toBe("cancelled");expect(commandFact(f,"push")).toMatchObject({state:"SETTLED",handle:actual.handle,result:scalarResult(actual.result!)});expect(f.processes.activeCount).toBe(0);
  const pid=Number(readFileSync(ready,"utf8"));expect(()=>process.kill(pid,0)).toThrow();
 });
});
it.each(["commit","push"] as const)("coalesces an equivalent currently owned held %s with its intact legacy receipt",async phase=>{
 await observedFixture(async(f,observations,boundary)=>{
  const target=await f.workspaces.deliveryTarget("repo");writeFileSync(join(f.workspace.path,"result.txt"),"coalesced mutation\n");let release!:()=>void,reached!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{reached=resolve;});
  boundary.afterResult=async actual=>{if(actual===phase){reached();await held;}};
  const call=()=>phase==="push"?f.work(f.service.push({...f.input,target})):f.work(f.service.commit(f.input)),first=call();let second:ReturnType<typeof call>|undefined;
  try{await ready;expect(commandFact(f,phase)).toMatchObject({state:"SENDING"});second=call();}finally{release();}
  const results=await Promise.all([first,second!]);expect(results[0]).toEqual(results[1]);expect(observations.filter(o=>o.phase===phase)).toHaveLength(1);
 });
});
it("coalesces a genuine pre-parent held restore and still calls the original restore",async()=>{
 await observedFixture(async(f,observations)=>{
  writeFileSync(join(f.workspace.path,"result.txt"),"coalesced restore\n");let release!:()=>void,reached!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{reached=resolve;}),restore=f.workspaces.restore.bind(f.workspaces);
  const seam=vi.spyOn(f.workspaces,"restore").mockImplementation(async(...args)=>{reached();await held;return restore(...args);});const first=f.work(f.service.commit(f.input));let second:ReturnType<LocalGitDelivery["commit"]>|undefined;
  try{await ready;expect(f.db.getEntity("local-git-delivery",ownerId())).toBeUndefined();expect(commandFact(f,"stage")).toBeUndefined();second=f.work(f.service.commit(f.input));}finally{release();}
  try{const results=await Promise.all([first,second!]);expect(results[0]).toEqual(results[1]);expect(seam).toHaveBeenCalledTimes(1);expect(observations.filter(o=>o.phase==="commit")).toHaveLength(1);}finally{seam.mockRestore();}
 });
});
it.each(["commit","push"] as const)("replays an actual old COMPLETE %s with only its new journal removed",async phase=>{
 await observedFixture(async(f,observations)=>{
  const target=await f.workspaces.deliveryTarget("repo");writeFileSync(join(f.workspace.path,"result.txt"),"actual legacy completion\n");const call=(service:LocalGitDelivery)=>phase==="push"?f.work(service.push({...f.input,target})):f.work(service.commit(f.input)),completed=await call(f.service),count=observations.length;
  f.db.handle.prepare("DELETE FROM entities WHERE kind=?").run("local-git-command");
  expect(await call(new LocalGitDelivery(f.db,f.processes,f.workspaces))).toEqual(completed);expect(observations).toHaveLength(count);
 });
});
it.each(["malformed-json","wrong-binding","wrong-cwd","wrong-owner","wrong-result"] as const)("refuses an actual completed owner's %s command fact without overwriting or spawning",async fault=>{
 await observedFixture(async(f,observations)=>{
  writeFileSync(join(f.workspace.path,"result.txt"),"tampered receipt\n");await f.work(f.service.commit(f.input));const original=commandFact(f,"commit") as Record<string,unknown>;
  const changed=fault==="malformed-json"?"{invalid":JSON.stringify({...original,...(fault==="wrong-binding"?{binding:"foreign"}:fault==="wrong-cwd"?{cwd:f.root}:fault==="wrong-owner"?{ownerKind:"git-push-delivery"}:{result:{sessionId:"foreign"}})});
  f.db.handle.prepare("UPDATE entities SET document_json=? WHERE kind=? AND id=?").run(changed,"local-git-command",journalId("commit"));const count=observations.length;
  await expect(f.expected(f.work(new LocalGitDelivery(f.db,f.processes,f.workspaces).commit(f.input)))).rejects.toMatchObject({code:"COMMIT_OUTCOME_UNKNOWN"});expect(observations).toHaveLength(count);
  expect((f.db.handle.prepare("SELECT document_json FROM entities WHERE kind=? AND id=?").get("local-git-command",journalId("commit")) as {document_json:string}).document_json).toBe(changed);
 });
});
it.each(["insert-abort","insert-ignore","insert-tamper","insert-read-error"] as const)("starts no mutation when command journal qualification encounters %s",async fault=>{
 await observedFixture(async(f,observations)=>{
  writeFileSync(join(f.workspace.path,"result.txt"),"must not stage\n");let restore=()=>undefined;
  if(fault==="insert-read-error"){
   const prepare=f.db.handle.prepare.bind(f.db.handle),insert=f.db.createEntityIfAbsent.bind(f.db);let inserted=false;
   const reader=vi.spyOn(f.db.handle,"prepare").mockImplementation(sql=>{if(inserted&&sql==="SELECT document_json FROM entities WHERE kind=? AND id=?")throw new Error("labelled journal reread storage failure");return prepare(sql);});
   const writer=vi.spyOn(f.db,"createEntityIfAbsent").mockImplementation((...args)=>{const value=insert(...args);if(args[0]==="local-git-command")inserted=true;return value;});restore=()=>{reader.mockRestore();writer.mockRestore();return undefined;};
  }else{
   const program=fault==="insert-abort"?"SELECT RAISE(ABORT,'labelled insert storage failure');":fault==="insert-ignore"?"SELECT RAISE(IGNORE);":"UPDATE entities SET document_json=json_set(document_json,'$.binding','foreign') WHERE kind=NEW.kind AND id=NEW.id;";
   f.db.handle.exec(`CREATE TRIGGER journal_insert ${fault==="insert-tamper"?"AFTER":"BEFORE"} INSERT ON entities WHEN NEW.kind='local-git-command' BEGIN ${program} END`);
  }
  try{const error=await f.expected(f.work(f.service.commit(f.input))).catch(error=>error);if(fault==="insert-abort")expect(String(error)).toContain("labelled insert storage failure");else if(fault==="insert-read-error")expect(String(error)).toContain("labelled journal reread storage failure");else expect(error).toMatchObject({code:"COMMIT_OUTCOME_UNKNOWN"});}finally{restore();}
  expect(observations.filter(o=>o.phase)).toHaveLength(0);expect(execFileSync("git",["-C",f.workspace.path,"diff","--cached","--name-only"],{encoding:"utf8"})).toBe("");
 });
});
it.each(["commit","push"] as const)("does not overwrite a %s command fact tampered while its real result returns",async phase=>{
 await observedFixture(async(f,observations,boundary)=>{
  const target=await f.workspaces.deliveryTarget("repo");writeFileSync(join(f.workspace.path,"result.txt"),"in-flight tamper\n");boundary.afterResult=actual=>{if(actual===phase)f.db.handle.prepare("UPDATE entities SET document_json=json_set(document_json,'$.binding','foreign') WHERE kind=? AND id=?").run("local-git-command",journalId(phase));};
  await expect(f.expected(phase==="push"?f.work(f.service.push({...f.input,target})):f.work(f.service.commit(f.input)))).rejects.toMatchObject({code:phase==="push"?"PUSH_OUTCOME_UNKNOWN":"COMMIT_OUTCOME_UNKNOWN"});expect(observations.find(o=>o.phase===phase)?.result?.classification).toBe("success");expect(commandFact(f,phase)).toMatchObject({state:"SENDING",binding:"foreign"});
 });
});
it("rolls back a synchronous settlement trigger's rewrite rather than consuming it",async()=>{
 await observedFixture(async(f)=>{
  writeFileSync(join(f.workspace.path,"result.txt"),"settlement trigger\n");f.db.handle.exec("CREATE TRIGGER journal_settle AFTER UPDATE ON entities WHEN NEW.kind='local-git-command' AND json_extract(NEW.document_json,'$.state')='SETTLED' BEGIN UPDATE entities SET document_json=json_set(document_json,'$.binding','foreign') WHERE kind=NEW.kind AND id=NEW.id; END");
  await expect(f.expected(f.work(f.service.commit(f.input)))).rejects.toMatchObject({code:"COMMIT_OUTCOME_UNKNOWN"});expect(commandFact(f,"stage")).toMatchObject({state:"SENDING"});expect((commandFact(f,"stage") as {binding:string}).binding).not.toBe("foreign");
 });
});
it("does not turn a mismatched returned result into a settled command",async()=>{
 await observedFixture(async(f,observations,boundary)=>{
  writeFileSync(join(f.workspace.path,"result.txt"),"bad result shape\n");boundary.afterResult=(phase,result)=>{if(phase==="commit")result.sessionId="labelled foreign session";};
  await expect(f.expected(f.work(f.service.commit(f.input)))).rejects.toMatchObject({code:"COMMIT_OUTCOME_UNKNOWN"});expect(observations.find(o=>o.phase==="commit")?.result?.classification).toBe("success");expect(commandFact(f,"commit")).toMatchObject({state:"SENDING"});
 });
});

it.each(["commit","push"] as const)("retains a returned %s fact but refuses completion after its legacy parent disappears in flight",async phase=>{
 await observedFixture(async(f,observations,boundary)=>{
  const target=await f.workspaces.deliveryTarget("repo");writeFileSync(join(f.workspace.path,"result.txt"),"missing in-flight parent\n");const kind=phase==="push"?"git-push-delivery":"local-git-delivery",code=phase==="push"?"PUSH_OUTCOME_UNKNOWN":"COMMIT_OUTCOME_UNKNOWN",call=()=>phase==="push"?f.work(f.service.push({...f.input,target})):f.work(f.service.commit(f.input));
  boundary.afterResult=async actual=>{if(actual===phase){f.db.handle.prepare("DELETE FROM entities WHERE kind=? AND id=?").run(kind,ownerId());await expect(f.expected(call())).rejects.toMatchObject({code});}};
  const outcome=await f.expected(call()).then(value=>({value,error:undefined}),error=>({value:undefined,error}));writeFileSync(join(f.directory,"missing-parent-outcome.json"),JSON.stringify({outcome,fact:commandFact(f,phase)},null,2));
  expect(outcome.error).toMatchObject({code});expect(observations.filter(o=>o.phase===phase)).toHaveLength(1);expect(commandFact(f,phase)).toMatchObject({state:"SETTLED"});expect(f.db.getEntity(kind,ownerId())).toBeUndefined();
 });
});
it("keeps a missing returned result uncertain with the journal outcome error",async()=>{
 await observedFixture(async(f,observations,boundary)=>{
  writeFileSync(join(f.workspace.path,"result.txt"),"missing returned shape\n");boundary.returnedResult=(phase,result)=>phase==="commit"?undefined:result;
  await expect(f.expected(f.work(f.service.commit(f.input)))).rejects.toMatchObject({code:"COMMIT_OUTCOME_UNKNOWN"});expect(observations.find(o=>o.phase==="commit")?.result?.classification).toBe("success");expect(commandFact(f,"commit")).toMatchObject({state:"SENDING"});
 });
});
it.each(["commit","push"] as const)("does not repair %s from same-process memory after its legacy receipt and journal are removed",async phase=>{
 await observedFixture(async(f,observations)=>{
  const target=await f.workspaces.deliveryTarget("repo");writeFileSync(join(f.workspace.path,"result.txt"),"known result needs its original parent\n");const kind=phase==="push"?"git-push-delivery":"local-git-delivery",save=f.db.saveEntity.bind(f.db),fault=vi.spyOn(f.db,"saveEntity").mockImplementation((...args)=>{if(args[0]===kind&&(args[2] as {state?:string}).state==="COMPLETE")throw new Error("labelled legacy completion failure");save(...args);});
  const call=()=>phase==="push"?f.work(f.service.push({...f.input,target})):f.work(f.service.commit(f.input));try{await expect(f.expected(call())).rejects.toThrow("labelled legacy completion failure");}finally{fault.mockRestore();}
  const count=observations.length;f.db.handle.prepare("DELETE FROM entities WHERE kind=? AND id=?").run(kind,ownerId());f.db.handle.prepare("DELETE FROM entities WHERE kind=?").run("local-git-command");
  await expect(f.expected(call())).rejects.toMatchObject({code:phase==="push"?"PUSH_OUTCOME_UNKNOWN":"COMMIT_OUTCOME_UNKNOWN"});expect(observations).toHaveLength(count);expect(f.db.getEntity(kind,ownerId())).toBeUndefined();
 });
});

it.each(["commit","push"] as const)("does not repair a known %s with an intact legacy parent but removed new command facts",async phase=>{
 await observedFixture(async(f,observations)=>{
  const target=await f.workspaces.deliveryTarget("repo");writeFileSync(join(f.workspace.path,"result.txt"),"known result needs its command facts\n");const kind=phase==="push"?"git-push-delivery":"local-git-delivery",save=f.db.saveEntity.bind(f.db),fault=vi.spyOn(f.db,"saveEntity").mockImplementation((...args)=>{if(args[0]===kind&&(args[2] as {state?:string}).state==="COMPLETE")throw new Error("labelled legacy completion failure");save(...args);});
  const call=()=>phase==="push"?f.work(f.service.push({...f.input,target})):f.work(f.service.commit(f.input));try{await expect(f.expected(call())).rejects.toThrow("labelled legacy completion failure");}finally{fault.mockRestore();}
  const count=observations.length;expect(f.db.getEntity(kind,ownerId())).toMatchObject({state:"PENDING"});f.db.handle.prepare("DELETE FROM entities WHERE kind=? AND id=?").run("local-git-command",journalId(phase));
  await expect(f.expected(call())).rejects.toMatchObject({code:phase==="push"?"PUSH_OUTCOME_UNKNOWN":"COMMIT_OUTCOME_UNKNOWN"});expect(observations).toHaveLength(count);expect(f.db.getEntity(kind,ownerId())).toMatchObject({state:"PENDING"});
 });
});

it("preserves target property-order independent replay of an actual completed push",async()=>{
 await observedFixture(async(f,observations)=>{
  const target=await f.workspaces.deliveryTarget("repo");writeFileSync(join(f.workspace.path,"result.txt"),"equivalent frozen target\n");const completed=await f.work(f.service.push({...f.input,target})),count=observations.length,reordered=Object.fromEntries(Object.entries(target).reverse()) as typeof target;
  expect(await f.work(new LocalGitDelivery(f.db,f.processes,f.workspaces).push({...f.input,target:reordered}))).toEqual(completed);expect(observations).toHaveLength(count);
 });
});

it("refuses before spawn when a real synchronous journal insert trigger revokes labelled authority",async()=>{
 await observedFixture(async(f,observations)=>{
  writeFileSync(join(f.workspace.path,"result.txt"),"trigger must prevent stage\n");let revoked=false;f.db.handle.function("labelled_revoke_authority",()=>{revoked=true;return 1;});
  f.db.handle.exec("CREATE TRIGGER journal_revoke AFTER INSERT ON entities WHEN NEW.kind='local-git-command' BEGIN SELECT labelled_revoke_authority(); END");
  await expect(f.expected(f.work(f.service.commit({...f.input,assertAuthority:()=>{if(revoked)throw new Error("labelled synchronous insert authority refusal");}})))).rejects.toThrow("labelled synchronous insert authority refusal");
  expect(commandFact(f,"stage")).toMatchObject({state:"SENDING"});expect(observations.filter(o=>o.phase)).toHaveLength(0);expect(execFileSync("git",["-C",f.workspace.path,"diff","--cached","--name-only"],{encoding:"utf8"})).toBe("");
 });
});
it.each(["commit","push"] as const)("refuses removed-parent %s recovery when its surviving owner fact has a moved SQL key",async phase=>{
 await observedFixture(async(f,observations)=>{
  const target=await f.workspaces.deliveryTarget("repo");writeFileSync(join(f.workspace.path,"result.txt"),"moved owner fact\n");const call=(service:LocalGitDelivery)=>phase==="push"?f.work(service.push({...f.input,target})):f.work(service.commit(f.input));await call(f.service);const count=observations.length,kind=phase==="push"?"git-push-delivery":"local-git-delivery";
  f.db.handle.prepare("DELETE FROM entities WHERE kind=? AND id=?").run(kind,ownerId());if(phase==="commit")f.db.handle.prepare("DELETE FROM entities WHERE kind=? AND id=?").run("local-git-command",journalId("stage"));
  const moved=`labelled-moved-${phase}`;f.db.handle.prepare("UPDATE entities SET id=? WHERE kind=? AND id=?").run(moved,"local-git-command",journalId(phase));const retained=f.db.getEntity("local-git-command",moved);
  await expect(f.expected(call(new LocalGitDelivery(f.db,f.processes,f.workspaces)))).rejects.toMatchObject({code:phase==="push"?"PUSH_OUTCOME_UNKNOWN":"COMMIT_OUTCOME_UNKNOWN"});expect(observations).toHaveLength(count);expect(f.db.getEntity("local-git-command",moved)).toEqual(retained);expect(f.db.getEntity(kind,ownerId())).toBeUndefined();
 });
});

it("qualifies the unchanged SENDING fact after the last pre-start authority callback",async()=>{
 await observedFixture(async(f,observations)=>{
  writeFileSync(join(f.workspace.path,"result.txt"),"callback must not hide tamper\n");let tampered=false;
  await expect(f.expected(f.work(f.service.commit({...f.input,assertAuthority:()=>{if(!tampered&&(commandFact(f,"stage") as {state?:string}|undefined)?.state==="SENDING"){tampered=true;f.db.handle.prepare("UPDATE entities SET document_json=json_set(document_json,'$.binding','foreign') WHERE kind=? AND id=?").run("local-git-command",journalId("stage"));}}})))).rejects.toMatchObject({code:"COMMIT_OUTCOME_UNKNOWN"});
  expect(tampered).toBe(true);expect(observations.filter(o=>o.phase)).toHaveLength(0);expect(commandFact(f,"stage")).toMatchObject({state:"SENDING",binding:"foreign"});expect(execFileSync("git",["-C",f.workspace.path,"diff","--cached","--name-only"],{encoding:"utf8"})).toBe("");
 });
});

it("repairs an actual clean no-op commit after COMPLETE storage fails without requiring mutation facts",async()=>{
 await observedFixture(async(f,observations)=>{
  const save=f.db.saveEntity.bind(f.db),fault=vi.spyOn(f.db,"saveEntity").mockImplementation((...args)=>{if(args[0]==="local-git-delivery"&&(args[2] as {state?:string}).state==="COMPLETE")throw new Error("labelled clean completion storage failure");save(...args);});
  try{await expect(f.expected(f.work(f.service.commit(f.input)))).rejects.toThrow("labelled clean completion storage failure");}finally{fault.mockRestore();}
  expect(f.db.getEntity("local-git-delivery",ownerId())).toMatchObject({state:"PENDING"});expect(commandFact(f,"stage")).toBeUndefined();expect(commandFact(f,"commit")).toBeUndefined();const count=observations.length;
  await expect(f.expected(f.work(new LocalGitDelivery(f.db,f.processes,f.workspaces).commit(f.input)))).rejects.toMatchObject({code:"COMMIT_OUTCOME_UNKNOWN"});const repaired=await f.work(f.service.commit(f.input));
  expect(repaired).toMatchObject({created:false,commit:f.workspace.baseRevision});expect(observations).toHaveLength(count);expect(observations.filter(o=>o.phase)).toHaveLength(0);
 });
});
it("does not repair an actually sent commit after hook HEAD rewind when its original command fact was removed",async()=>{
 await observedFixture(async(f,observations)=>{
  writeFileSync(join(f.workspace.path,"result.txt"),"physically committed before rewind\n");const proof=join(f.directory,"hook-physical-commit.sha"),hook=join(f.root,".git/hooks/post-commit");
  writeFileSync(hook,`#!${process.execPath}\nconst fs=require('node:fs'),{spawnSync}=require('node:child_process');const prefix=${JSON.stringify(["-C",f.workspace.path])};const head=spawnSync('git',[...prefix,'rev-parse','HEAD'],{encoding:'utf8'});if(head.status!==0)process.exit(71);fs.writeFileSync(${JSON.stringify(proof)},head.stdout.trim());const reset=spawnSync('git',[...prefix,'reset','--hard',${JSON.stringify(f.workspace.baseRevision)}],{stdio:'inherit'});process.exit(reset.status??72);\n`);chmodSync(hook,0o755);
  let attempted:unknown;const save=f.db.saveEntity.bind(f.db),fault=vi.spyOn(f.db,"saveEntity").mockImplementation((...args)=>{if(args[0]==="local-git-delivery"&&(args[2] as {state?:string}).state==="COMPLETE"){attempted=structuredClone(args[2]);throw new Error("labelled rewound completion storage failure");}save(...args);});
  try{await expect(f.expected(f.work(f.service.commit(f.input)))).rejects.toThrow("labelled rewound completion storage failure");}finally{fault.mockRestore();}
  const physicallyCreated=readFileSync(proof,"utf8"),head=execFileSync("git",["-C",f.workspace.path,"rev-parse","HEAD"],{encoding:"utf8"}).trim();writeFileSync(join(f.directory,"rewound-physical-facts.json"),JSON.stringify({physicallyCreated,head,attempted,observations},null,2));
  expect(physicallyCreated).toMatch(/^[a-f0-9]{40}$/);expect(physicallyCreated).not.toBe(f.workspace.baseRevision);expect(head).toBe(f.workspace.baseRevision);expect(attempted).toMatchObject({state:"COMPLETE",result:{created:false,commit:head}});expect(observations.filter(o=>o.phase==="commit")).toHaveLength(1);expect(commandFact(f,"commit")).toMatchObject({state:"SETTLED",result:{classification:"success",exitCode:0}});
  const count=observations.length;f.db.handle.prepare("DELETE FROM entities WHERE kind=? AND id=?").run("local-git-command",journalId("commit"));await expect(f.expected(f.work(f.service.commit(f.input)))).rejects.toMatchObject({code:"COMMIT_OUTCOME_UNKNOWN"});expect(observations).toHaveLength(count);expect(f.db.getEntity("local-git-delivery",ownerId())).toMatchObject({state:"PENDING"});
 });
});

it("drains a registered held restore work before final SQL and close while retaining body and unexpected work failures",async()=>{
 const events:string[]=[],bodyError=new Error("labelled early body failure"),workError=new Error("labelled unexpected held restore rejection"),restores:Array<()=>void>=[];let pending:Promise<unknown>|undefined,failure:unknown;
 try{
  await observedFixture(async f=>{
   const ready=Promise.withResolvers<void>(),release=Promise.withResolvers<void>(),restore=f.workspaces.restore.bind(f.workspaces),prepare=f.db.handle.prepare.bind(f.db.handle),close=f.db.close.bind(f.db);
   const restoreSpy=vi.spyOn(f.workspaces,"restore").mockImplementation(async(...args)=>{await restore(...args);events.push("real-restore-completed");ready.resolve();await release.promise;await new Promise(resolve=>setTimeout(resolve,20));events.push("work-rejected");throw workError;});
   const prepareSpy=vi.spyOn(f.db.handle,"prepare").mockImplementation(sql=>{if(sql==="SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")events.push("final-sql");return prepare(sql);});
   const closeSpy=vi.spyOn(f.db,"close").mockImplementation(()=>{events.push("db-close");close();});restores.push(()=>restoreSpy.mockRestore(),()=>prepareSpy.mockRestore(),()=>closeSpy.mockRestore());
   pending=f.work(f.service.commit(f.input));await ready.promise;expect(f.processes.activeCount).toBe(0);
   try{events.push("body-failed");throw bodyError;}finally{events.push("gate-released");release.resolve();}
  });
 }catch(error){failure=error;}finally{if(pending)await Promise.allSettled([pending]);for(const restore of restores)restore();}
 const errors=failure instanceof AggregateError?failure.errors:[];
 if(evidence)writeFileSync(join(evidence,`held-service-work-control-${process.pid}.json`),JSON.stringify({events,errors:errors.map(String),scope:"Actual controlled body failure, completed real restore, held service work rejection and final SQL/DB-close ordering; not a native/provider Gate"},null,2));
 expect(failure).toBeInstanceOf(AggregateError);expect(errors).toContain(bodyError);expect(errors).toContain(workError);expect(events.indexOf("gate-released")).toBeLessThan(events.indexOf("work-rejected"));expect(events.indexOf("work-rejected")).toBeLessThan(events.indexOf("final-sql"));expect(events.indexOf("final-sql")).toBeLessThan(events.indexOf("db-close"));
});

it.each((["stage","commit","push"] as const).flatMap(phase=>(["removed","foreign-binding"] as const).map(fault=>({phase,fault}))))("refuses $phase before its child when the last authority callback changes only its legacy parent ($fault)",async({phase,fault})=>{
 await observedFixture(async(f,observations)=>{
  const target=await f.workspaces.deliveryTarget("repo");writeFileSync(join(f.workspace.path,"result.txt"),"must qualify parent before selected child\n");let tampered=false,commandBefore:string|undefined,commandAfter:string|undefined;
  const kind=phase==="push"?"git-push-delivery":"local-git-delivery",input={...f.input,target,assertAuthority:()=>{
   if(tampered||(commandFact(f,phase) as {state?:string}|undefined)?.state!=="SENDING")return;tampered=true;
   commandBefore=(f.db.handle.prepare("SELECT document_json FROM entities WHERE kind=? AND id=?").get("local-git-command",journalId(phase)) as {document_json:string}).document_json;
   if(fault==="removed")f.db.handle.prepare("DELETE FROM entities WHERE kind=? AND id=?").run(kind,ownerId());else f.db.handle.prepare("UPDATE entities SET document_json=json_set(document_json,'$.binding','foreign') WHERE kind=? AND id=?").run(kind,ownerId());
   commandAfter=(f.db.handle.prepare("SELECT document_json FROM entities WHERE kind=? AND id=?").get("local-git-command",journalId(phase)) as {document_json:string}).document_json;
  }};
  const error=await f.expected(phase==="push"?f.work(f.service.push(input)):f.work(f.service.commit(input))).then(()=>undefined,error=>error);
  writeFileSync(join(f.directory,"pre-start-parent-facts.json"),JSON.stringify({phase,fault,commandBefore,commandAfter,tampered,observations,error:String(error),fact:commandFact(f,phase)},null,2));
  expect(tampered).toBe(true);expect(commandAfter).toBe(commandBefore);expect(error).toMatchObject({code:phase==="push"?"PUSH_OUTCOME_UNKNOWN":"COMMIT_OUTCOME_UNKNOWN"});expect(observations.filter(o=>o.phase===phase)).toHaveLength(0);expect(commandFact(f,phase)).toMatchObject({state:"SENDING"});
  if(phase!=="stage")expect(observations.filter(o=>o.phase==="stage")).toHaveLength(1);
 });
});
