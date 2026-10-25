import fs, { readFileSync, rmSync } from "node:fs";
import childProcess from "node:child_process";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { DevinLocalAcpExecutionBackend } from "@dispatcher/adapters";
import type { Run } from "@dispatcher/domain";
import { DispatcherDatabase, InteractionStore } from "@dispatcher/persistence";
import { assertDevinRuntimeSettings } from "../src/devin-runtime.js";
import { isGuardedControllerStart, isReadableManagedCodexRun, isReadableManagedOpenCodeRun, isReadableManagedPiRun, isReadableManagedDevinRun } from "../src/start-recovery.js";
import { editStored, replaceBindingCopies, type StoredEdit } from "./fixtures/managed-restart-storage.js";
import { ControllerService } from "../src/service.js";
import { fixture, fixtures, registry, source, json } from "./fixtures/devin-runtime-service.js";

const headers={authorization:"Bearer owner"};
// Source restart1: preserve literal settings/binding; removing recovery admission fails here.
it.each(["QUEUED","RUNNING"] as const)("restarts literal configuration with a %s Task without reattaching or creating a native Session",async taskState=>{
 const f=await fixture(),run=await f.create("a"),native=await f.start(run);await registry(f.service).get("p")!.result(native.id);
 const task=f.service.database.getCanonicalTask(run.taskId)!;f.service.database.writeCanonicalTask(run.taskId,task.revision,json({...task.document as object,state:taskState}));
 const original=f.service.database.getEntity("run",run.id),session=f.service.database.getEntity("session",run.sessionId),adapter=f.service.database.getEntity("adapter-session",run.sessionId),binding=new InteractionStore(f.service.database).binding(run.sessionId)!;
 f.service.database.saveEntity("task-dispatch","restart-receipt",json({run:original,routing:{fixture:true}}));
 await f.service.stop();f.factory.mockClear();
 const db=new DispatcherDatabase(join(f.root,"data","dispatcher.sqlite")),saved=new InteractionStore(db);
 saved.invalidateObservation({sessionId:run.sessionId,readBarrier:"old-barrier",observation:{version:1,id:"old-observation",nativeSessionId:binding.nativeSessionId,executionRefId:binding.executionRefId,scopeFingerprint:"old-scope",observedAt:new Date().toISOString(),state:"unknown",pendingTools:"unknown",pendingApprovals:"unknown",historyMode:"unknown",readability:"unknown"}});
 expect(saved.saveObservation({sessionId:run.sessionId,observerGeneration:99,observerSequence:99,controlEpoch:saved.control(run.sessionId)!.epoch,readBarrier:"old-barrier",observation:{version:1,id:"prior-readable",nativeSessionId:binding.nativeSessionId,executionRefId:binding.executionRefId,scopeFingerprint:"old-scope",observedAt:new Date().toISOString(),state:"idle",pendingTools:"none",pendingApprovals:"none",historyMode:"snapshot-only",readability:"readable"}})).toEqual({accepted:true});db.close();
 const nativeBytes=["roots","wire"].map(name=>[name,readFileSync(join(f.root,name),"utf8")] as const),producer=vi.spyOn(DevinLocalAcpExecutionBackend.prototype,"start");
 try{
  const restarted=new ControllerService({dataDirectory:join(f.root,"data"),withRunner:true,ownerToken:"owner",devinExecutionFactory:f.factory});fixtures.find(entry=>entry.service===f.service)!.service=restarted;await restarted.start({listen:false});
  expect(registry(restarted).get("p")!.manifest.id).toBe("devin-local");expect(restarted.configuration.current().config.agentProfiles[0]?.settings).toEqual({executable:f.executable,dataHome:f.dataHome,configHome:f.configHome});
  const recovered=restarted.database.getEntity("run",run.id),read=await restarted.app.inject({headers,url:`/api/runs/${run.id}`});
  expect(read.statusCode,read.body).toBe(200);expect(read.json()).toMatchObject({run:{id:run.id,sessionId:run.sessionId,state:"RUNNER_UNAVAILABLE",recoveryReason:"NATIVE_OUTCOME_UNKNOWN",resumePolicy:"manual"},nativeSession:{state:"unknown",mutationAvailable:false}});
  expect(recovered).toEqual({...original as object,state:"RUNNER_UNAVAILABLE",recoveryState:"ACTIVE",recoveryReason:"NATIVE_OUTCOME_UNKNOWN",resumePolicy:"manual"});
  expect(restarted.database.getEntity("session",run.sessionId)).toEqual(session);expect(restarted.database.getEntity("adapter-session",run.sessionId)).toEqual(adapter);expect(restarted.database.getEntity("task-dispatch","restart-receipt")).toEqual({run:recovered,routing:{fixture:true}});
  expect(restarted.database.getCanonicalTask(run.taskId)?.document).toMatchObject({state:taskState==="QUEUED"?"WAITING_RESOURCE":"WAITING_USER"});
  const store=new InteractionStore(restarted.database);expect(store.binding(run.sessionId)).toEqual(native.nativeBinding);expect(store.nativeReadBarrier(run.sessionId)).not.toBe("old-barrier");expect(store.observation(run.sessionId)).toMatchObject({state:"unknown",pendingTools:"unknown",pendingApprovals:"unknown",historyMode:"unknown",readability:"unknown"});
  expect(source(restarted,binding)).toBeUndefined();expect(restarted["devinRuntimes"].get("p")!["executions"].size).toBe(0);
  const fence=restarted["nativeInteractions"].fenceFor(recovered as unknown as Run,"restart-continue");for(const operation of ["continue","steer","approval","verify","deliver"] as const)expect(restarted["nativeInteractions"].authorizeInteraction({id:"owner",roles:["operator"],profileId:"p"},operation,fence).allowed).toBe(false);
  expect((await restarted.app.inject({headers,method:"POST",url:`/api/runs/${run.id}/advance`})).statusCode).toBe(409);
  expect(producer).not.toHaveBeenCalled();expect(f.factory).not.toHaveBeenCalled();expect(f.rows("roots")).toHaveLength(1);for(const [name,bytes] of nativeBytes)expect(readFileSync(join(f.root,name),"utf8")).toBe(bytes);
 }finally{producer.mockRestore();}
});

async function savedDevinFixture(id:string){
 const f=await fixture(),run=await f.create(id),session=await f.start(run);expect(await registry(f.service).get("p")!.result(session.id)).toMatchObject({state:"COMPLETED"});await f.service.stop();f.factory.mockClear();
 return {...f,run,path:join(f.root,"data","dispatcher.sqlite"),nativeBytes:["roots","wire"].map(name=>[name,readFileSync(join(f.root,name),"utf8")] as const)};
}
// Removing stored-only qualification, or adding physical admission here, breaks this case.
it("qualifies Local stored ownership with zero writes or filesystem/process reads after physical paths disappear",async()=>{
 const f=await savedDevinFixture("readonly"),db=new DispatcherDatabase(f.path);
 for(const path of [f.executable,f.dataHome,f.configHome,f.run.worktree!])rmSync(path,{recursive:true});
 const producer=vi.spyOn(DevinLocalAcpExecutionBackend.prototype,"start"),physical=[vi.spyOn(fs,"realpathSync"),vi.spyOn(fs,"statSync"),vi.spyOn(fs,"accessSync"),vi.spyOn(fs,"readFileSync"),vi.spyOn(fs,"existsSync"),vi.spyOn(childProcess,"spawn"),vi.spyOn(childProcess,"execFileSync")];
 try{
  const stored=db.getEntity("run",f.run.id) as unknown as Run,writes=db.handle.prepare("SELECT total_changes() AS count").get();
  expect(isReadableManagedDevinRun(db,stored)).toBe(true);expect(isReadableManagedCodexRun(db,stored)).toBe(false);expect(isReadableManagedOpenCodeRun(db,stored)).toBe(false);expect(isReadableManagedPiRun(db,stored)).toBe(false);expect(isGuardedControllerStart(db,stored)).toBe(false);
  expect(db.handle.prepare("SELECT total_changes() AS count").get()).toEqual(writes);expect(producer).not.toHaveBeenCalled();expect(f.factory).not.toHaveBeenCalled();for(const call of physical)expect(call).not.toHaveBeenCalled();
 }finally{db.close();producer.mockRestore();for(const call of physical)call.mockRestore();}
 expect(()=>assertDevinRuntimeSettings({id:"p",alias:"Devin Local",executable:f.executable},f.dataHome,f.configHome)).toThrow(expect.objectContaining({code:"DEVIN_ACP_SCOPE_CHANGED",creationOutcome:"not-created"}));
 for(const [name,bytes] of f.nativeBytes)expect(readFileSync(join(f.root,name),"utf8")).toBe(bytes);
});
// Preserve the existing OpenCode full shared matrix. These rows cover the actual Pi narrow boundary set.
const corruptDevinFields:StoredEdit[]=[
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
const corruptDevinBindings:readonly (readonly [field:string,value:unknown])[]=[
 ["product","devin"],["backendId","devin-cli"],["region","cn"],["nativeThreadId","thread"],["parentSessionId","parent"],
 ["profileId","other"],["runnerId","other"],["executionRefId","other"],["identityState","ambiguous"],
 ["nativeSessionId",""],["nativeSessionId","x".repeat(513)],["nativeSessionId","unstarted:native"],["nativeSessionId",42],
 ...Array.from({length:32},(_,code)=>["nativeSessionId",`a${String.fromCharCode(code)}b`] as const),["nativeSessionId","a\x7fb"],
 ...["\nopaque","opaque\n","\ropaque","opaque\r","\x7fopaque","opaque\x7f"].map(value=>["nativeSessionId",value] as const),
];
it.each([
 ...corruptDevinFields.map(edit=>({label:`${edit[0]}.${edit[1]}`,edit,binding:undefined})),
 ...corruptDevinBindings.map(binding=>({label:`consistent-binding:${binding[0]}=${JSON.stringify(binding[1])}`,binding,edit:undefined})),
 ...["missing-task","missing-session","missing-adapter","missing-contract","missing-binding","missing-control","identity-diagnostic","current-run","duplicate-control","control-row-epoch","control-row-revision","control-row-state","control-document-owner","stored-binding-store"].map(label=>({label,edit:undefined,binding:undefined})),
])("keeps corrupted Local restart closed for $label without modifying the original Run or native logs",async({label,edit,binding})=>{
 const f=await savedDevinFixture("corrupt"),db=new DispatcherDatabase(f.path);let closed=false;
 const producer=vi.spyOn(DevinLocalAcpExecutionBackend.prototype,"start");
 try{
  if(edit)editStored(db,f.run,edit);
  else if(binding)replaceBindingCopies(db,f.run,...binding);
  else if(label.startsWith("missing-")){
   const kind=label.slice(8);if(kind==="task")db.handle.prepare("DELETE FROM canonical_tasks WHERE id=?").run(f.run.taskId);
   else if(kind==="binding"||kind==="control")db.handle.prepare(`DELETE FROM ${kind==="binding"?"native_bindings":"session_controls"} WHERE session_id=?`).run(f.run.sessionId);
   else {if(kind==="session")db.handle.exec("PRAGMA foreign_keys=OFF");db.handle.prepare("DELETE FROM entities WHERE kind=? AND id=?").run(kind==="adapter"?"adapter-session":kind==="contract"?"run-contract":kind,kind==="contract"?f.run.id:f.run.sessionId);if(kind==="session")db.handle.exec("PRAGMA foreign_keys=ON");}
  }else if(label==="identity-diagnostic")db.handle.prepare("INSERT INTO native_identity_diagnostics(id,session_id,code) VALUES(?,?,?)").run("corrupt",f.run.sessionId,"NATIVE_BINDING_CONFLICT");
  else if(label==="current-run"){const task=db.getCanonicalTask(f.run.taskId)!;db.writeCanonicalTask(f.run.taskId,task.revision,json({...task.document as object,currentRunId:"other"}));}
  else if(label==="duplicate-control"){
   const control=new InteractionStore(db).control(f.run.sessionId)!;db.saveEntity("session","other-session",{id:"other-session",providerId:"devin-local",profileId:"p"});db.handle.prepare("INSERT INTO session_controls(session_id,active_run_id,epoch,revision,state,document_json) VALUES(?,?,?,?,?,?)").run("other-session",f.run.id,control.epoch,control.revision,control.state,JSON.stringify({...control,sessionId:"other-session"}));
  }else if(label.startsWith("control-row-")){const column=label.slice(12);db.handle.prepare(`UPDATE session_controls SET ${column}=? WHERE session_id=?`).run(column==="state"?"HUMAN":2,f.run.sessionId);}
  else if(label==="control-document-owner"){const control=new InteractionStore(db).control(f.run.sessionId)!;db.handle.prepare("UPDATE session_controls SET document_json=? WHERE session_id=?").run(JSON.stringify({...control,activeRunId:"other"}),f.run.sessionId);}
  else {const stored=new InteractionStore(db).binding(f.run.sessionId)!;db.handle.prepare("UPDATE native_bindings SET document_json=? WHERE session_id=?").run(JSON.stringify({...stored,nativeStoreRef:"opaque-other-store"}),f.run.sessionId);}
  const before=db.getEntity("run",f.run.id),writes=db.handle.prepare("SELECT total_changes() AS count").get();expect(isReadableManagedDevinRun(db,before as unknown as Run)).toBe(false);expect(db.handle.prepare("SELECT total_changes() AS count").get()).toEqual(writes);db.close();closed=true;
  const physical=[vi.spyOn(fs,"realpathSync"),vi.spyOn(fs,"statSync"),vi.spyOn(fs,"accessSync"),vi.spyOn(childProcess,"spawn")];let restored:ControllerService|undefined;
  try{expect(()=>{restored=new ControllerService({dataDirectory:join(f.root,"data"),ownerToken:"owner",withRunner:true,devinExecutionFactory:f.factory});}).toThrow(expect.objectContaining({code:"NATIVE_CONTROL_RUNTIME_UNAVAILABLE"}));for(const call of physical)expect(call).not.toHaveBeenCalled();}finally{for(const call of physical)call.mockRestore();await restored?.stop();}
  const checked=new DispatcherDatabase(f.path);try{expect(checked.getEntity("run",f.run.id)).toEqual(before);}finally{checked.close();}
  expect(producer).not.toHaveBeenCalled();expect(f.factory).not.toHaveBeenCalled();for(const [name,bytes] of f.nativeBytes)expect(readFileSync(join(f.root,name),"utf8")).toBe(bytes);
 }finally{if(!closed)db.close();producer.mockRestore();}
});
it.each([
 ["nativeSessionId","a"],["nativeSessionId","opaque-会话-é-🧭"],["nativeSessionId","e\u0301"],["nativeSessionId","🧭".repeat(256)],
 ["nativeStoreRef","opaque-rewritten-store"],
] as const)("accepts consistent opaque Local %s=%s stored agreement without external provenance",async(field,value)=>{
 const f=await savedDevinFixture("opaque"),db=new DispatcherDatabase(f.path);
 try{replaceBindingCopies(db,f.run,field,value);const writes=db.handle.prepare("SELECT total_changes() AS count").get();expect(isReadableManagedDevinRun(db,db.getEntity("run",f.run.id) as unknown as Run)).toBe(true);expect(db.handle.prepare("SELECT total_changes() AS count").get()).toEqual(writes);for(const [name,bytes] of f.nativeBytes)expect(readFileSync(join(f.root,name),"utf8")).toBe(bytes);}finally{db.close();}
});
