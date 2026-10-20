import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { DispatcherDatabase,InteractionStore,type JsonValue } from "@dispatcher/persistence";
import type {Run} from "@dispatcher/domain";
import {NativeInteractions} from "../src/native-interactions.js";
import {contentHash} from "../src/task-publications.js";
import { ControllerService } from "../src/service.js";
import {isGuardedControllerStart} from "../src/start-recovery.js";

it.each(["execution-context","control","binding","legacy-selection"])("does not restore native authority from %s before the control runtime is composed",kind=>{
  const dataDirectory=mkdtempSync(join(tmpdir(),"dispatcher-native-recovery-"));
  try {
    const db=new DispatcherDatabase(join(dataDirectory,"dispatcher.sqlite"));
    const run={id:"native-run",taskId:"task",runnerId:"local",providerId:"codex",profileId:"p",sessionId:"native-session",state:"ACTIVE",generation:1,attempt:1,leaseId:"lease",verification:{required:[],passed:[],failed:[],state:"PENDING"},...(kind==="execution-context"?{executionRef:{version:1,id:"execution",kind:"managed-worktree",runnerId:"local",repositoryId:"repo",workspaceId:"workspace",pathRef:"workspace:workspace",branch:"task/native",baseRevision:"sha"}}:{})};
    db.saveEntity("session","native-session",{id:"native-session",profileId:"p"});
    if(kind==="control")db.handle.prepare("INSERT INTO session_controls(session_id,active_run_id,epoch,revision,state,document_json) VALUES(?,?,2,2,'HUMAN','{}')").run("native-session","native-run");
    if(kind==="binding")db.handle.prepare("INSERT INTO native_bindings(session_id,binding_key,profile_id,execution_ref_id,document_json) VALUES(?,?,?,?,?)").run("native-session","key","p","execution","{}");
    const expectedRun={...run,...(kind==="legacy-selection"?{modelSelection:{version:1,profileId:"p",providerId:"codex",backendId:"exec",nativeSelectionId:"frozen-model",kind:"model",source:"explicit",catalogVersion:"catalog",selectedAt:"2026-10-20T00:00:00Z",reasoning:{mode:"native-default"},context:{repositoryId:"repo",baseRevision:"sha",configRevision:1}}}:{})};
    db.saveEntity("run","native-run",expectedRun);db.close();
    let service:ControllerService|undefined;
    try {
      expect(()=>{service=new ControllerService({dataDirectory,ownerToken:"test-owner",withRunner:true});}).toThrowError(expect.objectContaining({code:"NATIVE_CONTROL_RUNTIME_UNAVAILABLE"}));
    } finally {service?.database.close();}
    const verified=new DispatcherDatabase(join(dataDirectory,"dispatcher.sqlite"));
    try {expect(verified.getEntity("run","native-run")).toEqual(expectedRun);}finally{verified.close();}
  } finally {rmSync(dataDirectory,{recursive:true,force:true});}
});

const json=(value:unknown):JsonValue=>JSON.parse(JSON.stringify(value)) as JsonValue;
const at="2026-10-20T00:00:00Z";
function guardedFixture(db:DispatcherDatabase){
  const selection:NonNullable<Run["executionSelection"]>={version:1,mode:"legacy",source:"legacy-config",profileId:"p",runnerId:"local",providerId:"codex",backendId:"exec",selectionType:"native-default",nativeParameters:{},configRevision:1,contextFingerprint:"context",selectedAt:at};
  const run:Run={id:"guarded-run",taskId:"task",sessionId:"reserved-session",profileId:"p",providerId:"codex",runnerId:"local",state:"STARTING",generation:1,attempt:1,leaseId:"lease",taskRevision:1,contractRevision:1,worktree:"/managed/workspace",startedAt:at,lastActivityAt:at,verification:{state:"PENDING",commands:[]},executionSelection:selection};
  const contract={taskId:"task",revision:1,workspace:{repositoryId:"repo",baseRef:"main",baseCommit:"frozen"}};
  db.writeCanonicalTask("task",0,{id:"task",state:"QUEUED",currentRunId:run.id});db.saveEntity("run",run.id,json(run));db.saveEntity("run-contract",run.id,contract);
  const native=new NativeInteractions(db,()=>new Date(at)),command=native.reserveNativeStart({run,actorId:"scheduler",resumable:true,backendId:"exec",configRevision:1,semantics:{controllerStartVersion:1,runnerMode:"embedded",contractHash:contentHash(contract)}});
  return {run,command,native};
}
it.each(["RESERVED","UNKNOWN","ACKNOWLEDGED"] as const)("admits only the local Controller's qualified unbound %s start journal without spawning",async state=>{
  const dataDirectory=mkdtempSync(join(tmpdir(),"dispatcher-guarded-start-recovery-"));let service:ControllerService|undefined;
  try{const path=join(dataDirectory,"dispatcher.sqlite"),db=new DispatcherDatabase(path),f=guardedFixture(db);
    if(state!=="RESERVED"){f.native.beginNativeStart(f.command.id);if(state==="UNKNOWN")f.native.settleNativeStart(f.command.id,{kind:"unknown",code:"NATIVE_START_OUTCOME_UNKNOWN"});else {const session={id:f.run.sessionId,runId:f.run.id,profileId:"p",backendId:"exec",workspacePath:f.run.worktree!,execution:{generation:1,attempt:1,leaseId:"lease"},executionSelection:f.run.executionSelection,state:"RUNNING" as const,createdAt:at,updatedAt:at};db.saveEntity("adapter-session",session.id,json(session));f.native.settleNativeStart(f.command.id,{kind:"created",session});}}
    const writes=db.handle.prepare("SELECT total_changes() AS count").get();expect(isGuardedControllerStart(db,f.run)).toBe(true);expect(db.handle.prepare("SELECT total_changes() AS count").get()).toEqual(writes);
    db.close();expect(()=>{service=new ControllerService({dataDirectory,ownerToken:"test-owner",withRunner:false});}).not.toThrow();expect(service!.database.getEntity("run",f.run.id)).toEqual(json({...f.run,state:"RUNNER_UNAVAILABLE",recoveryState:"STARTING",recoveryReason:"NATIVE_OUTCOME_UNKNOWN",resumePolicy:"manual"}));expect(new InteractionStore(service!.database).command(f.command.id)?.state).toBe(state);expect(service!.database.getCanonicalTask("task")?.document).toMatchObject({state:"WAITING_RESOURCE"});
  }finally{if(service)await service.stop();rmSync(dataDirectory,{recursive:true,force:true});}
});
it.each(["marker","contract","selection","control","session","fence","backend"] as const)("keeps the native recovery barrier closed for a corrupted local %s certificate",kind=>{
  const dataDirectory=mkdtempSync(join(tmpdir(),"dispatcher-corrupt-start-recovery-"));let service:ControllerService|undefined;
  try{const db=new DispatcherDatabase(join(dataDirectory,"dispatcher.sqlite")),f=guardedFixture(db);
    if(kind==="marker"||kind==="fence"||kind==="backend"){const command={...f.command,...(kind==="marker"?{semanticHash:"corrupt"}:{}),fence:kind==="fence"?{...f.command.fence,leaseId:"other"}:f.command.fence,...(kind==="backend"?{backendId:"other"}:{})};db.handle.prepare("UPDATE interaction_commands SET document_json=? WHERE id=?").run(JSON.stringify(command),command.id);}
    if(kind==="contract")db.saveEntity("run-contract",f.run.id,{taskId:"task",revision:2});
    if(kind==="selection")db.saveEntity("adapter-session",f.run.sessionId,json({id:f.run.sessionId,runId:f.run.id,profileId:"p",backendId:"exec",workspacePath:f.run.worktree,execution:{generation:1,attempt:1,leaseId:"lease"},executionSelection:{...f.run.executionSelection!,contextFingerprint:"changed"},state:"STARTING",createdAt:at,updatedAt:at}));
    if(kind==="control")new InteractionStore(db).compareAndSwapControl({sessionId:f.run.sessionId,expectedRevision:1,expectedEpoch:1,actorId:"owner",event:{type:"conflict",at}});
    if(kind==="session")db.saveEntity("session",f.run.sessionId,{id:f.run.sessionId,profileId:"other",providerId:"codex"});
    const before=db.getEntity("run",f.run.id);db.close();expect(()=>{service=new ControllerService({dataDirectory,ownerToken:"test-owner",withRunner:false});}).toThrowError(expect.objectContaining({code:"NATIVE_CONTROL_RUNTIME_UNAVAILABLE"}));const after=new DispatcherDatabase(join(dataDirectory,"dispatcher.sqlite"));try{expect(after.getEntity("run",f.run.id)).toEqual(before);}finally{after.close();}
  }finally{service?.database.close();rmSync(dataDirectory,{recursive:true,force:true});}
});
