import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodexBackend } from "@dispatcher/adapters";
import type { JsonValue } from "@dispatcher/persistence";
import type { DispatcherConfig, SecretStore } from "@dispatcher/config";
import { ControllerService } from "../src/service.js";
const OWNER = { authorization: "Bearer publication-test-owner" };
const fixtures: Array<{ directory: string; services: ControllerService[] }> = [];
afterEach(async () => { for (const f of fixtures.splice(0)) { for (const s of f.services) await s.stop(); rmSync(f.directory, { recursive: true, force: true }); } });
async function setup() {
  const directory = mkdtempSync(join(tmpdir(), "dispatcher-publication-"));
  const root = join(directory, "repo"); mkdirSync(root);
  execFileSync("git", ["init", "--initial-branch=main", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "fixture@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Fixture"]);
  writeFileSync(join(root, "README.md"), "fixture\n");
  execFileSync("git", ["-C", root, "add", "."]); execFileSync("git", ["-C", root, "commit", "-m", "fixture"]);
  const f = { directory, services: [] as ControllerService[] }; fixtures.push(f);
  const starts: Array<Parameters<CodexBackend["start"]>[0]> = [];
  const control = { failStart: false, completed: false };
  const backend: CodexBackend = { start(input) { if(control.failStart) throw new Error("spawn fixture ENOENT"); starts.push(input); writeFileSync(join(input.workspacePath,"result.txt"),"completed locally\n"); return {status:()=>control.completed?"completed":"running",cancel:async()=>undefined,result:async()=>({state:"completed",summary:"implemented",providerSessionId:"native-fixture-thread",events:[]})}; } };
  const clock = { now: new Date() };
  const make = async () => { const s = new ControllerService({ dataDirectory: join(directory,"data"), ownerToken: "publication-test-owner", withRunner: true, codexBackendFactory: () => backend, clock: () => clock.now, secretStore: { test: async () => false } as unknown as SecretStore }); f.services.push(s); await s.start({listen:false}); return s; };
  const service = await make();
  const config = service.configuration.current().config as DispatcherConfig;
  config.agentProfiles = [{id:"codex-local",alias:"Local",provider:"codex",runnerId:"local",settings:{codexHome:join(directory,"native"),model:"profile-default"}}];
  config.repositories = [{ id:"repo", root, defaultBaseRef:"main", scopePaths:[], verificationCommands:[{id:"check",file:process.execPath,args:["-e","process.exit(0)"],required:true,timeoutMs:5000,outputLimitBytes:1024}] }];
  const plan = service.configuration.buildPlan(config,"owner","web"); await service.configuration.applyPlan(plan.id,{confirmed:true});
  const draft = { schemaVersion:1, clientDraftId:"draft-1", description:"\n完整正文  😀\r\n保持原样\n",projectId:"local:repo",repositoryId:"repo",acceptanceCriteria:["works"],scopePaths:["."],verificationCommandIds:["check"],startMode:"create-only",execution:{selectionMode:"manual",selectionType:"native-default"},delivery:{type:"none"} };
  const preview = async (payload: unknown = draft, s = service) => s.app.inject({method:"POST",url:"/api/task-publications/preview",headers:OWNER,payload});
  const commit = (p: {publicationId:string;revision:number;confirmation:{reviewHash:string}}, key="key-1", s=service, extra={}) => s.app.inject({method:"POST",url:`/api/task-publications/${p.publicationId}/commit`,headers:{...OWNER,"idempotency-key":key},payload:{revision:p.revision,reviewHash:p.confirmation.reviewHash,confirmation:{accepted:true},...extra}});
  return {service,root,clock,make,draft,preview,commit,starts,control};
}
describe("task publication receipts", () => {
  it("previews without task/worktree effects, preserves text and atomically creates once across retries and restart", async () => {
    const f=await setup(); const create=vi.spyOn(f.service.workspaces,"create");
    const response=await f.preview(); expect(response.statusCode).toBe(200); const p=response.json();
    expect(p).toMatchObject({state:"PREVIEW",canCommit:true,effectiveTask:{description:f.draft.description,contractState:"READY"}});
    expect(create).not.toHaveBeenCalled(); expect(f.service.database.listCanonicalTasks()).toHaveLength(0);
    const [a,b]=await Promise.all([f.commit(p),f.commit(p)]); expect(a.statusCode).toBe(200); expect(b.json().taskId).toBe(a.json().taskId);
    expect(f.service.database.listCanonicalTasks()).toHaveLength(1);
    expect(f.service.database.getTaskContract(a.json().taskId)).toMatchObject({instructions:f.draft.description,workspace:{repositoryId:"repo"},delivery:{type:"none"}});
    expect((await f.commit(p,"different-key")).json().taskId).toBe(a.json().taskId);
    expect((await f.commit(p,"key-1",f.service,{reviewHash:"different"})).statusCode).toBe(409);
    await f.service.stop(); const restored=await f.make();
    expect((await f.commit(p,"key-1",restored)).json().taskId).toBe(a.json().taskId);
    expect((await restored.app.inject({headers:OWNER,url:`/api/task-publications/${p.publicationId}`})).json().taskId).toBe(a.json().taskId);
  });
  it("requires confirmation and rejects stale reviews, invalid links, unknown commands and expanded scope", async () => {
    const f=await setup(); const p=(await f.preview()).json();
    expect((await f.commit(p,"missing",f.service,{confirmation:{accepted:false}})).statusCode).toBe(400);
    for(const patch of [{referenceLinks:["javascript:alert(1)"]},{scopePaths:["../escape"]},{verificationCommandIds:["arbitrary shell"]},{execution:{selectionMode:"manual",selectionType:"explicit-model"}}]) expect((await f.preview({...f.draft,...patch})).statusCode).toBe(400);
    writeFileSync(join(f.root,"change"),"new"); execFileSync("git",["-C",f.root,"add","."]);execFileSync("git",["-C",f.root,"commit","-m","move base"]);
    expect((await f.commit(p)).json()).toMatchObject({code:"SELECTION_CHANGED"});
    expect(f.service.database.listCanonicalTasks()).toHaveLength(0);
  });
  it("allows incomplete create-only and expires previews without creating tasks",async()=>{
    const f=await setup(); const p=(await f.preview({...f.draft,repositoryId:"",projectId:"local:inbox",acceptanceCriteria:[],scopePaths:[],verificationCommandIds:[]})).json();
    expect(p.effectiveTask.contractState).toBe("NEEDS_SPEC");expect((await f.commit(p)).json().state).toBe("TASK_CREATED");
    const expired=(await f.preview()).json();f.clock.now=new Date(f.clock.now.getTime()+600001);
    expect((await f.commit(expired,"expired")).json().code).toBe("PREVIEW_EXPIRED");
  });
  it("rejects configuration drift and unauthenticated publication reads",async()=>{
    const f=await setup();const p=(await f.preview()).json();
    expect((await f.service.app.inject({url:`/api/task-publications/${p.publicationId}`})).statusCode).toBe(401);
    const config=f.service.configuration.current().config;config.repositories[0]!.verificationCommands[0]!.args=["-e","process.exit(1)"];
    const plan=f.service.configuration.buildPlan(config,"owner","web");await f.service.configuration.applyPlan(plan.id,{confirmed:true});
    expect((await f.commit(p)).json().code).toBe("SELECTION_CHANGED");expect(f.service.database.listCanonicalTasks()).toHaveLength(0);
  });
  it("dispatches once with full instructions, frozen verification and a retained local result",async()=>{
    const f=await setup();const p=(await f.preview({...f.draft,startMode:"dispatch",execution:{selectionMode:"manual",selectionType:"native-default",profileId:"codex-local"}})).json();expect(p.canCommit).toBe(true);
    const a=(await f.commit(p)).json();expect(a).toMatchObject({state:"STARTED",taskId:expect.any(String),runId:expect.any(String)});expect(f.starts).toHaveLength(1);expect(f.starts[0]!.prompt).toContain(f.draft.description);expect(f.starts[0]!.model).toBeUndefined();
    expect((await f.commit(p)).json().runId).toBe(a.runId);expect(f.starts).toHaveLength(1);
    const config=f.service.configuration.current().config;config.repositories[0]!.verificationCommands[0]!.args=["-e","process.exit(1)"];const plan=f.service.configuration.buildPlan(config,"owner","web");await f.service.configuration.applyPlan(plan.id,{confirmed:true});
    f.control.completed=true;const completed=await f.service.app.inject({headers:OWNER,method:"POST",url:`/api/runs/${a.runId}/advance`});expect(completed.json()).toMatchObject({run:{state:"COMPLETE",providerSessionId:"native-fixture-thread",verification:{state:"PASSED"}},task:{state:"REVIEW"}});
    const result=(await f.service.app.inject({headers:OWNER,url:`/api/runs/${a.runId}/result`})).json();expect(result.result).toMatchObject({deliveryType:"none",files:["result.txt"],worktree:expect.any(String)});expect(f.service.database.listDeliveryEvidence(a.taskId)).toHaveLength(0);
    await f.service.stop();const restored=await f.make();expect((await f.commit(p,"key-1",restored)).json().runId).toBe(a.runId);expect(restored.workspaces.get(result.result.worktree)).toBeDefined();expect(f.starts).toHaveLength(1);
  });
  it("retains the task after startup failure and never retries startup on receipt replay",async()=>{
    const f=await setup();f.control.failStart=true;const p=(await f.preview({...f.draft,startMode:"dispatch",execution:{selectionMode:"manual",selectionType:"native-default",profileId:"codex-local"}})).json();
    const a=(await f.commit(p)).json();expect(a).toMatchObject({state:"START_FAILED",taskId:expect.any(String),runId:expect.any(String)});f.control.failStart=false;expect((await f.commit(p,"another-key")).json().runId).toBe(a.runId);expect(f.starts).toHaveLength(0);
  });
  it("reconciles an interrupted STARTING receipt as unknown without spawning",async()=>{
    const f=await setup();const p=(await f.preview()).json();const a=(await f.commit(p)).json();const record=f.service.database.getEntity<JsonValue>("task-publication",p.publicationId) as unknown as {receipt:object};record.receipt={...a,state:"STARTING",runId:"unknown-run"};f.service.database.saveEntity("task-publication",p.publicationId,record as unknown as JsonValue);
    await f.service.stop();const restored=await f.make();expect((await f.commit(p,"key-1",restored)).json().state).toBe("OUTCOME_UNKNOWN");expect(f.starts).toHaveLength(0);
  });
  it("rolls back the whole task/receipt reservation on storage failure",async()=>{
    const f=await setup();const p=(await f.preview()).json();const original=f.service.database.saveTaskContract.bind(f.service.database);
    vi.spyOn(f.service.database,"saveTaskContract").mockImplementationOnce(()=>{throw new Error("injected disk failure");});
    expect((await f.commit(p)).statusCode).toBe(500);expect(f.service.database.listCanonicalTasks()).toHaveLength(0);expect(f.service.database.listEntities("operation-receipt")).toHaveLength(0);
    f.service.database.saveTaskContract=original;expect((await f.commit(p)).statusCode).toBe(200);
  });
});
