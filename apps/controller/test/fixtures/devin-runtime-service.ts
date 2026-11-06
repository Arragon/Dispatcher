import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, vi } from "vitest";
import { DevinLocalAcpExecutionBackend, type DevinLocalAcpExecutionScope, type AgentAdapter, type NativeInteractionPort } from "@dispatcher/adapters";
import type { Run, ExecutionContextRef, ExecutionSelection, NativeBinding } from "@dispatcher/domain";
import { InteractionStore, type JsonValue } from "@dispatcher/persistence";
import { ControllerService } from "../../src/service.js";
import {expectRetainedStop,stopFixtureStorage,clearRetainedStop} from "./native-service-fixture-cleanup.js";

// Optional verification capture retains the exact generated executable and native logs.
function retainFixtureFile(path:string):void {
  const evidence=process.env.DISPATCHER_DEVIN_FIXTURE_EVIDENCE;if(!evidence||!existsSync(path))return;
  const target=join(evidence,createHash("sha256").update(path).digest("hex"));mkdirSync(target,{recursive:true});copyFileSync(path,join(target,basename(path)));
  writeFileSync(join(target,"identity.json"),JSON.stringify({path,sha256:createHash("sha256").update(readFileSync(path)).digest("hex")})+"\n");
}
export {expectRetainedStop};
export const fixtures: Array<{ service: ControllerService; root: string }> = [];
export async function cleanupFixture(f:{service:ControllerService;root:string}):Promise<void> {
  const closeRetainedStorage=await stopFixtureStorage(f.service);
  const held=join(f.root,"model-descendant");
  if(existsSync(held)){
    const pid=Number(readFileSync(held,"utf8"));
    await vi.waitFor(()=>{try{process.kill(pid,0);}catch{return;}throw Error("Held catalog pipe has not naturally closed");},{timeout:3500});
  }
  if(closeRetainedStorage)f.service.database.close();
  for(const name of ["devin-fixture","roots","wire","model-queries","model-descendant"])retainFixtureFile(join(f.root,name));
  rmSync(f.root,{recursive:true,force:true});clearRetainedStop(f.service);
  const index=fixtures.findIndex(entry=>entry.service===f.service);if(index>=0)fixtures.splice(index,1);
}

afterEach(async()=>{for(const f of fixtures.splice(0))await cleanupFixture(f);});
export const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value));
export const registry = (service: ControllerService) => (service as unknown as { agentAdapters: Map<string, AgentAdapter> }).agentAdapters;
export const source = (service: ControllerService, binding: NativeBinding) => (service as unknown as { nativePort: (binding: NativeBinding) => NativeInteractionPort | undefined }).nativePort(binding);
export async function fixture(configured = true, withRunner = true, version = "3000.11.3") {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "dispatcher-devin-controller-"))), repo = join(root, "repo"), dataHome = join(root, "native-data"), configHome = join(root, "native-config"), executable = join(root, "devin-fixture");
  for (const path of [repo, dataHome, configHome]) mkdirSync(path);
  execFileSync("git", ["init", "--initial-branch=main", repo]); execFileSync("git", ["-C", repo, "config", "user.email", "fixture@example.invalid"]); execFileSync("git", ["-C", repo, "config", "user.name", "Fixture"]); writeFileSync(join(repo, "README.md"), "fixture\n"); execFileSync("git", ["-C", repo, "add", "README.md"]); execFileSync("git", ["-C", repo, "commit", "-m", "fixture"]);
  writeFileSync(executable, [
    "#!" + process.execPath,
    "const fs=require('node:fs'),root=" + JSON.stringify(root) + ";",
    "if(process.argv.includes('--version')){process.stdout.write('devin 3000.11.3 (9c803229faa4)');process.exit(0);}",
    "if(process.argv[2]==='models'){fs.appendFileSync(root+'/model-queries',JSON.stringify({pid:process.pid,args:process.argv.slice(2),cwd:process.cwd(),data:process.env.XDG_DATA_HOME,config:process.env.XDG_CONFIG_HOME})+'\\n');const reply=()=>{process.stdout.write(JSON.stringify({families:[{family_uid:'family',variants:[{model_uid:'chosen',label:'Chosen',cost_summary:'cog-private-price'}]}]}));process.exit(0);};if(fs.existsSync(root+'/model-held-pipe')){const child=require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},2500)'],{stdio:['ignore',process.stdout,process.stderr]});fs.writeFileSync(root+'/model-descendant',String(child.pid));setInterval(()=>{},1000);setTimeout(()=>process.exit(0),1800);}else if(fs.existsSync(root+'/model-delay'))setTimeout(reply,1500);else reply();return;}",
    "fs.appendFileSync(root+'/roots',JSON.stringify({pid:process.pid,args:process.argv.slice(2),cwd:process.cwd(),pwd:process.env.PWD,data:process.env.XDG_DATA_HOME,config:process.env.XDG_CONFIG_HOME})+'\\n');",
    "let buffer='';const sid='native-'+process.pid,emit=v=>process.stdout.write(JSON.stringify(v)+'\\n'),options=[{id:'model',name:'Model',category:'model',type:'select',currentValue:'chosen',options:[{value:'chosen',name:'Chosen'}]}];",
    "process.stdin.on('data',chunk=>{buffer+=chunk;while(buffer.includes('\\n')){const at=buffer.indexOf('\\n'),m=JSON.parse(buffer.slice(0,at));buffer=buffer.slice(at+1);fs.appendFileSync(root+'/wire',JSON.stringify({method:m.method,sid,cwd:process.cwd()})+'\\n');let result;if(m.method==='initialize')result={protocolVersion:1,agentCapabilities:{loadSession:true,sessionCapabilities:{list:{}}},agentInfo:{name:'affogato',version:'0.0.0-dev'},authMethods:[]};else if(m.method==='session/new')result={sessionId:sid,configOptions:options};else if(m.method==='session/prompt'){emit({jsonrpc:'2.0',method:'session/update',params:{sessionId:sid,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'fixture'}}}});result={stopReason:'end_turn'};}else continue;emit({jsonrpc:'2.0',id:m.id,result});}});setInterval(()=>{},1000);",
  ].join("\n").replace("3000.11.3", version), { mode: 0o700 });
  retainFixtureFile(executable);
  const entries: Array<{ scope: DevinLocalAcpExecutionScope; reference: ExecutionContextRef; backend: DevinLocalAcpExecutionBackend }> = [], factory = vi.fn((scope: DevinLocalAcpExecutionScope, reference: ExecutionContextRef) => { const backend = new DevinLocalAcpExecutionBackend({ scope, executionRef: reference }); entries.push({ scope, reference, backend }); return backend; });
  const service = new ControllerService({ dataDirectory: join(root, "data"), withRunner, ownerToken: "owner", devinExecutionFactory: factory }); fixtures.push({ service, root }); await service.start({ listen: false });
  const config = structuredClone(service.configuration.current().config); config.agentProfiles = [{ id: "p", alias: "Devin Local", provider: "devin-local", runnerId: "local", settings: { executable, dataHome, configHome }, nativeInteraction: { mode: "compatible", backendId: "devin-local-acp", executionLocation: "managed-worktree" } }]; config.repositories = [{ id: "repo", root: repo, defaultBaseRef: "main", scopePaths: [], verificationCommands: [] }];
  const apply = () => service.configuration.applyPlan(service.configuration.buildPlan(config, "owner", "fixture").id, { confirmed: true }); if (configured) apply();
  const create = async (id: string,profileId = "p") => {
    const w = await service.workspaces.create({ repositoryId: "repo", taskId: id, runId: id, attempt: 1, baseRef: "main", scopePaths: [] });
    const context=service["resolveProfileExecutionContext"](profileId,"repo","start");
    const selection: ExecutionSelection = { version:1,mode:"manual",source:"explicit",selectionType:"explicit-model",requestedModel:"chosen",profileId,runnerId:"local",providerId:"devin-local",backendId:"devin-local-acp",nativeParameters:{},contextFingerprint:context.fingerprint,configRevision:context.configRevision,selectedAt:"2026-10-13T00:00:00.000Z" };
    const run: Run = { id, taskId: "task:" + id, sessionId: "session:" + id, profileId, providerId: "devin-local", runnerId: "local", state: "ACTIVE", generation: 1, attempt: 1, leaseId: "lease:" + id, leaseExpiresAt: "2100-01-01T00:00:00Z", taskRevision: 1, contractRevision: 1, executionSelection: selection, worktree: w.path, executionRef: { version: 1, id: "execution:" + id, kind: "managed-worktree", runnerId: "local", repositoryId: "repo", workspaceId: id, pathRef: "workspace:" + id, branch: w.branch, baseRevision: w.baseRevision } };
    service.database.saveEntity("run-contract", id, json({version:1,revision:1,goal:"Fixture",scope:["."],acceptanceCriteria:["done"],verification:[],constraints:[],delivery:{type:"none"},workspace:{repositoryId:"repo",baseCommit:w.baseRevision,baseRef:"main"}}));
    service.database.writeCanonicalTask(run.taskId, 0, json({ id: run.taskId, state: "RUNNING", currentRunId: id }), new Date().toISOString()); service.database.saveEntity("run", id, json(run)); service.database.saveEntity("session", run.sessionId, json({ id: run.sessionId, profileId, providerId: "devin-local", resumable: false, executionRef:run.executionRef, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })); new InteractionStore(service.database).initializeControl({ sessionId: run.sessionId, activeRunId: run.id, exclusion: "none", at: new Date().toISOString() }); return run;
  };
  const start = (run: Run) => registry(service).get(run.profileId)!.start({ runId: run.id, sessionId: run.sessionId, workspacePath: run.worktree!, backendId: "devin-local-acp", executionRef: run.executionRef, execution: { generation: run.generation, attempt: run.attempt, leaseId: run.leaseId }, executionSelection: run.executionSelection, beforeCreate:()=>{}, beforeSend:()=>{}, prompt: "literal fixture" });
  const rows = (file: string): Array<Record<string, unknown>> => existsSync(join(root, file)) ? readFileSync(join(root, file), "utf8").trim().split("\n").map(line => JSON.parse(line)) : [];
  return { root, repo, service, config, apply, create, start, entries, factory, dataHome, configHome, executable, rows };
}
