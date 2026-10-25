import fs, { readFileSync, renameSync } from "node:fs";
import childProcess from "node:child_process";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { CopilotExecutionBackend } from "@dispatcher/adapters";
import type { Run } from "@dispatcher/domain";
import { DispatcherDatabase, InteractionStore } from "@dispatcher/persistence";
import { assertCopilotRuntimeSettings } from "../src/copilot-runtime.js";
import * as recovery from "../src/start-recovery.js";
import { editStored, replaceBindingCopies, type StoredEdit } from "./fixtures/managed-restart-storage.js";
import { ControllerService } from "../src/service.js";
import { fixture, fixtures, registry, source, json } from "./fixtures/copilot-runtime-service.js";

const headers={authorization:"Bearer owner"};
// Source restart1: preserve literal settings/binding; removing recovery admission fails here.
it.each(["QUEUED","RUNNING"] as const)("restarts literal configuration with a %s Task without reattaching or creating a native Session",async taskState=>{
 const f=await fixture(),run=await f.create("a"),native=await f.start(run);await registry(f.service).get("p")!.result(native.id);
 await vi.waitFor(()=>expect(f.service["copilotRuntimes"].get("p")!.hasActiveOperations()).toBe(false));
 const task=f.service.database.getCanonicalTask(run.taskId)!;f.service.database.writeCanonicalTask(run.taskId,task.revision,json({...task.document as object,state:taskState}));
 expect(f.service.database.getEntity("run",run.id)).toMatchObject({state:"STARTING"});
 const original=f.service.database.getEntity("run",run.id),session=f.service.database.getEntity("session",run.sessionId),adapter=f.service.database.getEntity("adapter-session",run.sessionId),binding=new InteractionStore(f.service.database).binding(run.sessionId)!,startReceipt=new InteractionStore(f.service.database).command(`native-start:${run.id}`);
 expect(startReceipt).toMatchObject({state:"SENDING"});
 f.service.database.saveEntity("task-dispatch","restart-receipt",json({run:original,routing:{fixture:true}}));
 await f.service.stop();f.factory.mockClear();
 const db=new DispatcherDatabase(join(f.root,"data","dispatcher.sqlite")),saved=new InteractionStore(db);
 saved.invalidateObservation({sessionId:run.sessionId,readBarrier:"old-barrier",observation:{version:1,id:"old-observation",nativeSessionId:binding.nativeSessionId,executionRefId:binding.executionRefId,scopeFingerprint:"old-scope",observedAt:new Date().toISOString(),state:"unknown",pendingTools:"unknown",pendingApprovals:"unknown",historyMode:"unknown",readability:"unknown"}});
 expect(saved.saveObservation({sessionId:run.sessionId,observerGeneration:99,observerSequence:99,controlEpoch:saved.control(run.sessionId)!.epoch,readBarrier:"old-barrier",observation:{version:1,id:"prior-readable",nativeSessionId:binding.nativeSessionId,executionRefId:binding.executionRefId,scopeFingerprint:"old-scope",observedAt:new Date().toISOString(),state:"idle",pendingTools:"none",pendingApprovals:"none",historyMode:"snapshot-only",readability:"readable"}})).toEqual({accepted:true});db.close();
 const nativeBytes=["roots","wire","native-input"].map(name=>[name,readFileSync(join(f.root,name),"utf8")] as const),producer=vi.spyOn(CopilotExecutionBackend.prototype,"start");
 try{
  const restarted=new ControllerService({dataDirectory:join(f.root,"data"),withRunner:true,ownerToken:"owner",copilotExecutionFactory:f.factory});fixtures.find(entry=>entry.service===f.service)!.service=restarted;await restarted.start({listen:false});
  expect(registry(restarted).get("p")!.manifest.id).toBe("copilot");expect(restarted.configuration.current().config.agentProfiles[0]?.settings).toEqual({executable:f.executable,copilotHome:f.copilotHome});
  const recovered=restarted.database.getEntity("run",run.id),read=await restarted.app.inject({headers,url:`/api/runs/${run.id}`});
  expect(read.statusCode,read.body).toBe(200);expect(read.json()).toMatchObject({run:{id:run.id,sessionId:run.sessionId,state:"RUNNER_UNAVAILABLE",recoveryReason:"NATIVE_OUTCOME_UNKNOWN",resumePolicy:"manual"},nativeSession:{state:"unknown",mutationAvailable:false}});
  expect(recovered).toEqual({...original as object,state:"RUNNER_UNAVAILABLE",recoveryState:(original as unknown as Run).state,recoveryReason:"NATIVE_OUTCOME_UNKNOWN",resumePolicy:"manual"});
  expect(restarted.database.getEntity("session",run.sessionId)).toEqual(session);expect(restarted.database.getEntity("adapter-session",run.sessionId)).toEqual(adapter);expect(restarted.database.getEntity("task-dispatch","restart-receipt")).toEqual({run:recovered,routing:{fixture:true}});
  expect(restarted.database.getCanonicalTask(run.taskId)?.document).toMatchObject({state:taskState==="QUEUED"?"WAITING_RESOURCE":"WAITING_USER"});
  const store=new InteractionStore(restarted.database),recoveredStart=store.command(`native-start:${run.id}`);
  expect(recoveredStart).toEqual({...startReceipt,state:"UNKNOWN",code:"NATIVE_START_OUTCOME_UNKNOWN",revision:startReceipt!.revision+1,updatedAt:expect.any(String)});expect(Number.isFinite(Date.parse(recoveredStart!.updatedAt))).toBe(true);expect(Date.parse(recoveredStart!.updatedAt)).toBeGreaterThanOrEqual(Date.parse(startReceipt!.updatedAt));
  expect(store.binding(run.sessionId)).toEqual(native.nativeBinding);expect(store.nativeReadBarrier(run.sessionId)).not.toBe("old-barrier");expect(store.observation(run.sessionId)).toMatchObject({state:"unknown",pendingTools:"unknown",pendingApprovals:"unknown",historyMode:"unknown",readability:"unknown"});
  expect(source(restarted,binding)).toBeUndefined();expect(restarted["copilotRuntimes"].get("p")!["executions"].size).toBe(0);
  const fence=restarted["nativeInteractions"].fenceFor(recovered as unknown as Run,"restart-continue");for(const operation of ["continue","steer","approval","verify","deliver"] as const)expect(restarted["nativeInteractions"].authorizeInteraction({id:"owner",roles:["operator"],profileId:"p"},operation,fence).allowed).toBe(false);
  expect((await restarted.app.inject({headers,method:"POST",url:`/api/runs/${run.id}/advance`})).statusCode).toBe(409);
  expect(producer).not.toHaveBeenCalled();expect(f.factory).not.toHaveBeenCalled();expect(f.rows("roots")).toHaveLength(1);for(const [name,bytes] of nativeBytes)expect(readFileSync(join(f.root,name),"utf8")).toBe(bytes);
 }finally{producer.mockRestore();}
});

async function savedCopilotFixture(id:string){
 const f=await fixture(),run=await f.create(id),session=await f.start(run);
 expect(await registry(f.service).get("p")!.result(session.id)).toMatchObject({state:"COMPLETED"});
 await vi.waitFor(()=>expect(f.service["copilotRuntimes"].get("p")!.hasActiveOperations()).toBe(false));
 expect(f.service.database.getEntity("run",run.id)).toMatchObject({state:"STARTING"});
 await f.service.stop();f.factory.mockClear();
 return {...f,run,path:join(f.root,"data","dispatcher.sqlite"),nativeBytes:["roots","wire","native-input"].map(name=>[name,readFileSync(join(f.root,name),"utf8")] as const)};
}
it("qualifies stored Copilot ownership with zero writes or filesystem/process reads after physical paths disappear",async()=>{
 const f=await savedCopilotFixture("readonly"),db=new DispatcherDatabase(f.path),paths=[f.executable,f.copilotHome,f.run.worktree!];
 for(const path of paths)renameSync(path,path+".removed");
 const producer=vi.spyOn(CopilotExecutionBackend.prototype,"start"),physical=[vi.spyOn(fs,"realpathSync"),vi.spyOn(fs,"statSync"),vi.spyOn(fs,"accessSync"),vi.spyOn(fs,"readFileSync"),vi.spyOn(fs,"existsSync"),vi.spyOn(childProcess,"spawn"),vi.spyOn(childProcess,"execFileSync"),vi.spyOn(childProcess,"exec"),vi.spyOn(childProcess,"execFile"),vi.spyOn(childProcess,"spawnSync"),vi.spyOn(childProcess,"execSync")];
 try{
  const stored=db.getEntity("run",f.run.id) as unknown as Run,writes=db.handle.prepare("SELECT total_changes() AS count").get();
  expect(recovery.isReadableManagedCopilotRun(db,stored)).toBe(true);
  for(const other of [recovery.isReadableManagedCodexRun,recovery.isReadableManagedOpenCodeRun,recovery.isReadableManagedPiRun,recovery.isReadableManagedDevinRun,recovery.isGuardedControllerStart])expect(other(db,stored)).toBe(false);
  expect(db.handle.prepare("SELECT total_changes() AS count").get()).toEqual(writes);expect(producer).not.toHaveBeenCalled();expect(f.factory).not.toHaveBeenCalled();for(const call of physical)expect(call).not.toHaveBeenCalled();
 }finally{
  db.close();producer.mockRestore();for(const call of physical)call.mockRestore();
  try{expect(()=>assertCopilotRuntimeSettings({id:"p",alias:"Copilot",executable:f.executable},f.copilotHome)).toThrow(expect.objectContaining({code:"COPILOT_RPC_SCOPE_CHANGED",creationOutcome:"not-created"}));}
  finally{for(const path of paths)renameSync(path+".removed",path);}
 }
 for(const [name,bytes] of f.nativeBytes)expect(readFileSync(join(f.root,name),"utf8")).toBe(bytes);
});

// Full shared ownership boundary rows; existing provider matrices remain unchanged.
const corruptCopilotFields:StoredEdit[]=[
 ["run","providerId","codex"],["run","modelSelection",{}],["run","executionSelection.contextFingerprint","other"],
 ["run","executionRef.workspaceId","other"],["run","worktree","/other"],
 ["session","profileId","other"],["session","executionRef.id","other"],
 ["run-contract","workspace.repositoryId","other"],["run-contract","workspace.baseCommit","other"],
 ["adapter-session","runId","other"],["adapter-session","backendId","other"],["adapter-session","workspacePath","/other"],
 ["adapter-session","nativeInvocationId",undefined],["adapter-session","executionSelection.requestedModel","other"],
 ["adapter-session","execution.generation",2],["adapter-session","execution.attempt",2],["adapter-session","execution.leaseId","other"],
 ["adapter-session","nativeIdentityIssue","NATIVE_BINDING_CONFLICT"],
 ["adapter-session","nativeBinding.nativeStoreRef","opaque-other-store"],["session","nativeSessionId","other-session"],
];
const corruptCopilotBindings:readonly (readonly [field:string,value:unknown])[]=[
 ["product","devin-local"],["backendId","codex-app-server"],["region","cn"],["nativeThreadId","thread"],["parentSessionId","parent"],
 ["profileId","other"],["runnerId","other"],["executionRefId","other"],["identityState","ambiguous"],
 ["nativeSessionId",""],["nativeSessionId","x".repeat(513)],["nativeSessionId","unstarted:native"],["nativeSessionId",42],
 ...Array.from({length:32},(_,code)=>["nativeSessionId",`a${String.fromCharCode(code)}b`] as const),["nativeSessionId","a\x7fb"],
 ...["\nopaque","opaque\n","\ropaque","opaque\r","\x7fopaque","opaque\x7f"].map(value=>["nativeSessionId",value] as const),
];

type StorageMutation=(db:DispatcherDatabase,run:Run)=>void;
const structuralCorruptions:readonly (readonly [string,StorageMutation])[]=[
 ...["task","session","adapter","contract","binding","control"].map(kind=>["missing-"+kind,(db:DispatcherDatabase,run:Run)=>{
  if(kind==="task")db.handle.prepare("DELETE FROM canonical_tasks WHERE id=?").run(run.taskId);
  else if(kind==="binding"||kind==="control")db.handle.prepare(`DELETE FROM ${kind==="binding"?"native_bindings":"session_controls"} WHERE session_id=?`).run(run.sessionId);
  else{
   if(kind==="session")db.handle.exec("PRAGMA foreign_keys=OFF");
   try{db.handle.prepare("DELETE FROM entities WHERE kind=? AND id=?").run(kind==="adapter"?"adapter-session":kind==="contract"?"run-contract":kind,kind==="contract"?run.id:run.sessionId);}
   finally{if(kind==="session")db.handle.exec("PRAGMA foreign_keys=ON");}
  }
 }] as const),
 ["identity-diagnostic",(db,run)=>{db.handle.prepare("INSERT INTO native_identity_diagnostics(id,session_id,code) VALUES(?,?,?)").run("corrupt",run.sessionId,"NATIVE_BINDING_CONFLICT");}],
 ["current-run",(db,run)=>{const task=db.getCanonicalTask(run.taskId)!;db.writeCanonicalTask(run.taskId,task.revision,json({...task.document as object,currentRunId:"other"}));}],
 ["duplicate-control",(db,run)=>{
  const control=new InteractionStore(db).control(run.sessionId)!;
  db.saveEntity("session","other-session",{id:"other-session",providerId:"copilot",profileId:"p"});
  db.handle.prepare("INSERT INTO session_controls(session_id,active_run_id,epoch,revision,state,document_json) VALUES(?,?,?,?,?,?)").run("other-session",run.id,control.epoch,control.revision,control.state,JSON.stringify({...control,sessionId:"other-session"}));
 }],
 ...(["epoch","revision","state"] as const).map(column=>["control-row-"+column,(db:DispatcherDatabase,run:Run)=>{db.handle.prepare(`UPDATE session_controls SET ${column}=? WHERE session_id=?`).run(column==="state"?"HUMAN":2,run.sessionId);}] as const),
 ...(["epoch","revision","state","activeRunId"] as const).map(field=>["control-document-"+field,(db:DispatcherDatabase,run:Run)=>{
  const control=new InteractionStore(db).control(run.sessionId)!;
  db.handle.prepare("UPDATE session_controls SET document_json=? WHERE session_id=?").run(JSON.stringify({...control,[field]:field==="state"?"HUMAN":field==="activeRunId"?"other":2}),run.sessionId);
 }] as const),
 ["stored-binding-store",(db,run)=>{const binding=new InteractionStore(db).binding(run.sessionId)!;db.handle.prepare("UPDATE native_bindings SET document_json=? WHERE session_id=?").run(JSON.stringify({...binding,nativeStoreRef:"opaque-other-store"}),run.sessionId);}],
];
const corruptionCases:readonly (readonly [string,StorageMutation])[]=[
 ...corruptCopilotFields.map(edit=>[`${edit[0]}.${edit[1]}`,(db:DispatcherDatabase,run:Run)=>editStored(db,run,edit)] as const),
 ...corruptCopilotBindings.map(([field,value])=>[`consistent-binding:${field}=${JSON.stringify(value)}`,(db:DispatcherDatabase,run:Run)=>replaceBindingCopies(db,run,field,value)] as const),
 ...structuralCorruptions,
];
it.each(corruptionCases)("keeps corrupted Copilot restart closed for %s before physical/native admission",async(_label,mutate)=>{
 const f=await savedCopilotFixture("corrupt"),db=new DispatcherDatabase(f.path),producer=vi.spyOn(CopilotExecutionBackend.prototype,"start");let closed=false;
 try{
  mutate(db,f.run);
  const before=db.handle.prepare("SELECT document_json FROM entities WHERE kind='run' AND id=?").get(f.run.id),writes=db.handle.prepare("SELECT total_changes() AS count").get(),stored=db.getEntity("run",f.run.id) as unknown as Run;
  const physical=[vi.spyOn(fs,"realpathSync"),vi.spyOn(fs,"statSync"),vi.spyOn(fs,"accessSync"),vi.spyOn(childProcess,"spawn"),vi.spyOn(childProcess,"execFileSync")];let restarted:ControllerService|undefined;
  try{
   expect(recovery.isReadableManagedCopilotRun(db,stored)).toBe(false);expect(db.handle.prepare("SELECT total_changes() AS count").get()).toEqual(writes);db.close();closed=true;
   expect(()=>{restarted=new ControllerService({dataDirectory:join(f.root,"data"),ownerToken:"owner",withRunner:true,copilotExecutionFactory:f.factory});}).toThrow(expect.objectContaining({code:"NATIVE_CONTROL_RUNTIME_UNAVAILABLE"}));
   for(const call of physical)expect(call).not.toHaveBeenCalled();
  }finally{for(const call of physical)call.mockRestore();await restarted?.stop();}
  const checked=new DispatcherDatabase(f.path);try{expect(checked.handle.prepare("SELECT document_json FROM entities WHERE kind='run' AND id=?").get(f.run.id)).toEqual(before);}finally{checked.close();}
  expect(producer).not.toHaveBeenCalled();expect(f.factory).not.toHaveBeenCalled();for(const [name,bytes] of f.nativeBytes)expect(readFileSync(join(f.root,name),"utf8")).toBe(bytes);
 }finally{if(!closed)db.close();producer.mockRestore();}
});
it.each([
 ["nativeSessionId","a"],["nativeSessionId","opaque-会话-é-🧭"],["nativeSessionId","e\u0301"],["nativeSessionId","🧭".repeat(256)],
 ["nativeStoreRef","opaque-rewritten-store"],
] as const)("accepts consistent opaque Copilot %s=%s as stored agreement without external provenance",async(field,value)=>{
 const f=await savedCopilotFixture("opaque"),db=new DispatcherDatabase(f.path);
 try{
  replaceBindingCopies(db,f.run,field,value);const writes=db.handle.prepare("SELECT total_changes() AS count").get();
  expect(recovery.isReadableManagedCopilotRun(db,db.getEntity("run",f.run.id) as unknown as Run)).toBe(true);expect(db.handle.prepare("SELECT total_changes() AS count").get()).toEqual(writes);
  expect(new InteractionStore(db).binding(f.run.sessionId)?.[field]).toBe(value);expect(source(f.service,new InteractionStore(db).binding(f.run.sessionId)!)).toBeUndefined();
  expect(f.factory).not.toHaveBeenCalled();for(const [name,bytes] of f.nativeBytes)expect(readFileSync(join(f.root,name),"utf8")).toBe(bytes);
 }finally{db.close();}
});
it.each([null,undefined,{},42])("rejects malformed Copilot Run %j without throwing",value=>{
 expect(recovery.isReadableManagedCopilotRun({} as DispatcherDatabase,value as Run)).toBe(false);
});
