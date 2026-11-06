import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, lstatSync, readlinkSync, readdirSync, statSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { afterEach, vi } from "vitest";
import { CopilotExecutionBackend, type CopilotExecutionScope, type AgentAdapter, type NativeInteractionPort } from "@dispatcher/adapters";
import type { Run, ExecutionContextRef, ExecutionSelection, NativeBinding, TaskContract } from "@dispatcher/domain";
import { InteractionStore, type JsonValue } from "@dispatcher/persistence";
import { ControllerService } from "../../src/service.js";

import { expectRetainedStop, stopFixtureStorage, clearRetainedStop } from "./native-service-fixture-cleanup.js";
export { expectRetainedStop };
export const fixtures: Array<{ service: ControllerService; root: string }> = [];
export function retainFixtureFile(path:string,phase="generated") {
 const evidence=process.env.DISPATCHER_COPILOT_FIXTURE_EVIDENCE;if(!evidence||!existsSync(path))return;
 const s=statSync(path),bytes=readFileSync(path),target=join(evidence,createHash("sha256").update(path).digest("hex"));mkdirSync(target,{recursive:true});
 const sha256=createHash("sha256").update(bytes).digest("hex"),name=basename(path)+"-"+sha256;
 const identity={path,sha256,mode:s.mode,dev:s.dev,ino:s.ino,sourceStatSize:s.size,payloadBytes:bytes.byteLength,mtimeMs:s.mtimeMs,phase,utc:new Date().toISOString()};
 if(!existsSync(join(target,name))){writeFileSync(join(target,name),bytes);writeFileSync(join(target,name+".identity.json"),JSON.stringify(identity)+"\n");}
 appendFileSync(join(target,"captures.jsonl"),JSON.stringify(identity)+"\n");
 return {identity,bytes};
}
let captureSequence=0;
function retainFixtureTree(root:string,phase:string):void{
 const evidence=process.env.DISPATCHER_COPILOT_FIXTURE_EVIDENCE;if(!evidence)return;
 const physicalRoot=realpathSync(root),entries:unknown[]=[],references:unknown[]=[];
 const owned=(path:string)=>{const actual=realpathSync(path);if(actual!==physicalRoot&&!actual.startsWith(physicalRoot+sep))throw Error("Fixture capture refuses an external Git admin reference");return actual;};
 const visit=(path:string)=>{
  const stat=lstatSync(path),identity={path,dev:stat.dev,ino:stat.ino,mode:stat.mode,size:stat.size,mtimeMs:stat.mtimeMs};
  if(stat.isSymbolicLink()){entries.push({...identity,type:"symlink",target:readlinkSync(path)});return;}
  if(stat.isDirectory()){entries.push({...identity,type:"directory"});for(const name of readdirSync(path))visit(join(path,name));return;}
  if(!stat.isFile()){entries.push({...identity,type:"other"});return;}
  const captured=retainFixtureFile(path,phase)!;const bytes=captured.bytes;entries.push({...identity,type:"file",retained:captured.identity});
  if(basename(path)===".git"&&bytes.toString().startsWith("gitdir: "))references.push({path,target:owned(resolve(dirname(path),bytes.toString().slice(8).trim()))});
  else if(path.includes(sep+".git"+sep+"worktrees"+sep)&&["gitdir","commondir"].includes(basename(path)))references.push({path,target:owned(resolve(dirname(path),bytes.toString().trim()))});
 };
 visit(physicalRoot);const target=join(evidence,createHash("sha256").update(physicalRoot).digest("hex"));mkdirSync(target,{recursive:true});
 writeFileSync(join(target,`tree-${++captureSequence}.json`),JSON.stringify({root:physicalRoot,phase,utc:new Date().toISOString(),classification:"controlled-owned-fake-native-root",atomicity:"individual-live-file-bytes-not-a-database-backup-or-hermetic-snapshot",references,entries},null,2)+"\n");
}
export async function cleanupFixture(f:{service:ControllerService;root:string}):Promise<void>{
 const close=await stopFixtureStorage(f.service);if(close)f.service.database.close();
 retainFixtureTree(f.root,"after-drain-before-teardown");
 rmSync(f.root,{recursive:true,force:true});clearRetainedStop(f.service);
 const i=fixtures.findIndex(entry=>entry.service===f.service);if(i>=0)fixtures.splice(i,1);
}
afterEach(async()=>{for(const f of [...fixtures])await cleanupFixture(f);});
export const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value));
export const registry = (service: ControllerService) => (service as unknown as { agentAdapters: Map<string, AgentAdapter> }).agentAdapters;
export const source = (service: ControllerService, binding: NativeBinding) => (service as unknown as { nativePort: (binding: NativeBinding) => NativeInteractionPort | undefined }).nativePort(binding);
export async function fixture(configured = true, withRunner = true, withFactory=true) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "dispatcher-copilot-controller-"))), repo = join(root, "repo"), copilotHome = join(root, "native-home"), executable = join(root, "copilot-fixture");
  for (const path of [repo, copilotHome]) mkdirSync(path);
  execFileSync("git", ["init", "--initial-branch=main", repo]); execFileSync("git", ["-C", repo, "config", "user.email", "fixture@example.invalid"]); execFileSync("git", ["-C", repo, "config", "user.name", "Fixture"]); writeFileSync(join(repo, "README.md"), "fixture\n"); execFileSync("git", ["-C", repo, "add", "README.md"]); execFileSync("git", ["-C", repo, "commit", "-m", "fixture"]);
 writeFileSync(executable,[
  "#!"+process.execPath,
  "const fs=require('node:fs'),path=require('node:path');const root="+JSON.stringify(root)+";let buffer=Buffer.alloc(0),sessionId,model;",
  "fs.appendFileSync(root+'/roots',JSON.stringify({pid:process.pid,args:process.argv.slice(2),cwd:process.cwd(),pwd:process.env.PWD,home:process.env.COPILOT_HOME})+'\\n');",
  "const frame=v=>{const body=Buffer.from(JSON.stringify(v));return Buffer.concat([Buffer.from('Content-Length: '+body.length+'\\r\\n\\r\\n'),body]);};",
  "const emit=v=>process.stdout.write(frame(v));const event=(type,data)=>({jsonrpc:'2.0',method:'session.event',params:{sessionId,event:{type,data}}});",
  "function respond(m){fs.appendFileSync(root+'/wire',JSON.stringify({method:m.method,sid:sessionId,cwd:process.cwd()})+'\\n');let result={};if(m.method==='connect')result={protocolVersion:3};else if(m.method==='status.get')result={protocolVersion:3,version:fs.existsSync(path.join(root,'wrong-version'))?'9.9.9':'1.0.97'};else if(m.method==='session.create'){sessionId=m.params.sessionId;model=m.params.model;result={sessionId};}",
  "else if(m.method==='session.getMetadata')result={session:{sessionId,startTime:'2026-10-13T00:00:00Z',modifiedTime:'2026-10-13T00:00:00Z',isRemote:false,context:{cwd:process.cwd()}}};else if(m.method==='session.model.getCurrent')result={modelId:model};",
  "else if(m.method==='session.send'){fs.writeFileSync(path.join(root,'native-input'),JSON.stringify({bindingPersisted:fs.existsSync(path.join(root,'persisted')),args:process.argv.slice(2),cwd:process.cwd(),home:process.env.COPILOT_HOME,sessionId}));const messageId='wire-1';process.stdout.write(Buffer.concat([frame({jsonrpc:'2.0',id:m.id,result:{messageId}}),frame(event('user.message',{messageId,content:m.params.prompt})),frame(event('assistant.message',{messageId:'answer-1',originatingMessageId:messageId,content:'private-native-output',model})),frame(event('session.idle',{}))]));return;}emit({jsonrpc:'2.0',id:m.id,result});}",
  "process.stdin.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);for(;;){const at=buffer.indexOf('\\r\\n\\r\\n');if(at<0)return;const size=Number(/Content-Length: (\\d+)/.exec(buffer.subarray(0,at).toString())[1]);if(buffer.length<at+4+size)return;const m=JSON.parse(buffer.subarray(at+4,at+4+size).toString());buffer=buffer.subarray(at+4+size);respond(m);}});setInterval(()=>{},1000);",
 ].join("\n"),{mode:0o755});
  retainFixtureFile(executable);for(const name of ["README.md",".git/config",".git/HEAD",".git/index",".git/refs/heads/main"])retainFixtureFile(join(repo,name));
  const entries: Array<{ scope: CopilotExecutionScope; reference: ExecutionContextRef; backend: CopilotExecutionBackend }> = [], factory = vi.fn((scope: CopilotExecutionScope, reference: ExecutionContextRef) => { const backend = new CopilotExecutionBackend({ scope, executionRef: reference }); entries.push({ scope, reference, backend }); return backend; });
  const service = new ControllerService({ dataDirectory: join(root, "data"), withRunner, ownerToken: "owner", ...(withFactory?{copilotExecutionFactory: factory}:{}) }); fixtures.push({ service, root }); await service.start({ listen: false });
  const config = structuredClone(service.configuration.current().config); config.agentProfiles = [{ id: "p", alias: "Copilot RPC", provider: "copilot", runnerId: "local", settings: { executable, copilotHome }, nativeInteraction: { mode: "compatible", backendId: "copilot-rpc", executionLocation: "managed-worktree" } }]; config.repositories = [{ id: "repo", root: repo, defaultBaseRef: "main", scopePaths: [], verificationCommands: [] }];
  const apply = () => service.configuration.applyPlan(service.configuration.buildPlan(config, "owner", "fixture").id, { confirmed: true }); if (configured) apply();
  const admissions=new Map<string,ReturnType<ControllerService["reserveLocalStart"]>>();
  const create = async (id: string, profileId = "p") => {
    const w = await service.workspaces.create({ repositoryId: "repo", taskId: id, runId: id, attempt: 1, baseRef: "main", scopePaths: [] });
    const context=service["resolveProfileExecutionContext"](profileId,"repo","start");
    const selection: ExecutionSelection = { version:1,mode:"manual",source:"explicit",selectionType:"explicit-model",requestedModel:"chosen",profileId,runnerId:"local",providerId:"copilot",backendId:"copilot-rpc",nativeParameters:{},contextFingerprint:context.fingerprint,configRevision:context.configRevision,selectedAt:"2026-10-13T00:00:00.000Z" };
    const run: Run = { id, taskId: "task:" + id, sessionId: "session:" + id, profileId, providerId: "copilot", runnerId: "local", state: "STARTING", startedAt:"2026-10-13T00:00:00.000Z", generation: 1, attempt: 1, leaseId: "lease:" + id, leaseExpiresAt: "2100-01-01T00:00:00Z", taskRevision: 1, contractRevision: 1, executionSelection: selection, worktree: w.path, executionRef: { version: 1, id: "execution:" + id, kind: "managed-worktree", runnerId: "local", repositoryId: "repo", workspaceId: id, pathRef: "workspace:" + id, branch: w.branch, baseRevision: w.baseRevision } };
    service.database.saveEntity("run-contract", id, json({version:1,revision:1,goal:"Fixture",scope:["."],acceptanceCriteria:["done"],verification:[],constraints:[],delivery:{type:"none"},workspace:{repositoryId:"repo",baseCommit:w.baseRevision,baseRef:"main"}}));
    service.database.writeCanonicalTask(run.taskId, 0, json({ id: run.taskId, state: "QUEUED", currentRunId: id }), new Date().toISOString()); service.database.saveEntity("run", id, json(run)); service.database.saveEntity("session", run.sessionId, json({ id: run.sessionId, profileId, providerId: "copilot", resumable: false, executionRef:run.executionRef, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })); new InteractionStore(service.database).initializeControl({ sessionId: run.sessionId, activeRunId: run.id, exclusion: "none", at: new Date().toISOString() }); const contract=service.database.getEntity("run-contract",run.id) as unknown as TaskContract;admissions.set(id,service["reserveLocalStart"](run,contract,registry(service).get(profileId)!,"fixture","repo"));return run;
  };
  const start = async (run:Run) => {
    retainFixtureTree(root,"before-adapter-admission");
    const adapter=registry(service).get(run.profileId)!;
    const admission=admissions.get(run.id)!;
    return adapter.start({runId:run.id,sessionId:run.sessionId,workspacePath:run.worktree!,backendId:"copilot-rpc",executionRef:run.executionRef,execution:{generation:run.generation,attempt:run.attempt,leaseId:run.leaseId},executionSelection:run.executionSelection,beforeCreate:admission.beforeSend,beforeSend:admission.beforeSend,prompt:"literal fixture"});
  };
  const rows = (file: string): Array<Record<string, unknown>> => existsSync(join(root, file)) ? readFileSync(join(root, file), "utf8").trim().split("\n").map(line => JSON.parse(line)) : [];
  return { root, repo, service, config, apply, create, start, entries, factory, copilotHome, executable, rows, capture:()=>retainFixtureTree(root,"before-public-consumer") };
}
