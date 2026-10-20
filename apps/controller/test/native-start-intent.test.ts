import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { Run } from "@dispatcher/domain";
import { DispatcherDatabase, InteractionStore, type JsonValue } from "@dispatcher/persistence";
import { NativeInteractions } from "../src/native-interactions.js";

const json=(value:unknown):JsonValue=>JSON.parse(JSON.stringify(value)) as JsonValue;
const at="2026-10-07T14:00:00Z";
const run:Run={id:"run",taskId:"task",sessionId:"reserved-session",profileId:"p",providerId:"codex",runnerId:"local",state:"STARTING",generation:1,attempt:1,leaseId:"lease",taskRevision:1,contractRevision:1,worktree:"/managed/workspace",requiredCapabilities:[],startedAt:at,lastActivityAt:at,executionRef:{version:1,id:"execution",kind:"managed-worktree",runnerId:"local",repositoryId:"repo",workspaceId:"workspace",pathRef:"workspace:workspace",branch:"task/run",baseRevision:"sha"}};
function fixture(db=new DispatcherDatabase(":memory:")){
  db.writeCanonicalTask("task",0,{id:"task",state:"QUEUED",currentRunId:"run"},at);db.saveEntity("run","run",json(run));
  const coordinator=new NativeInteractions(db);const input={run,actorId:"owner",resumable:true,backendId:"exec",semantics:{prompt:"private prompt",goal:"goal"}};
  return {db,coordinator,input};
}
it("persists canonical Session and start intent before sending, with only a semantic digest",()=>{
  const f=fixture();try{const intent=f.coordinator.reserveNativeStart(f.input);expect(intent).toMatchObject({type:"start",state:"RESERVED",fence:{runId:"run",sessionId:"reserved-session"}});expect(f.db.getEntity("session","reserved-session")).toMatchObject({profileId:"p",executionRef:run.executionRef});expect(JSON.stringify(intent)).not.toContain("private prompt");expect(f.coordinator.reserveNativeStart(f.input)).toEqual(intent);expect(()=>f.coordinator.reserveNativeStart({...f.input,semantics:{prompt:"different"}})).toThrowError(expect.objectContaining({code:"IDEMPOTENCY_CONFLICT"}));}finally{f.db.close();}
});
it("keeps a crash before send retryable but turns uncertain in-flight starts into UNKNOWN after restart",()=>{
  const directory=mkdtempSync(join(tmpdir(),"dispatcher-start-intent-"));const path=join(directory,"db.sqlite");
  try{const f=fixture(new DispatcherDatabase(path));const intent=f.coordinator.reserveNativeStart(f.input);f.db.close();const db=new DispatcherDatabase(path);const restarted=new NativeInteractions(db);expect(restarted.startForRun("run")).toMatchObject({state:"RESERVED"});restarted.beginNativeStart(intent.id);db.close();
    const again=new DispatcherDatabase(path);const recovered=new NativeInteractions(again);expect(recovered.startForRun("run")).toMatchObject({state:"UNKNOWN",code:"NATIVE_START_OUTCOME_UNKNOWN"});expect(()=>recovered.beginNativeStart(intent.id)).toThrowError(expect.objectContaining({code:"NATIVE_START_OUTCOME_UNKNOWN"}));expect(again.getEntity("run","run")).toMatchObject({state:"STARTING"});again.close();
  }finally{rmSync(directory,{recursive:true,force:true});}
});
it("settles proven pre-create failure and retains its diagnostic without marking an ambiguous result failed",()=>{
  const f=fixture();try{const intent=f.coordinator.reserveNativeStart(f.input);f.coordinator.beginNativeStart(intent.id);expect(f.coordinator.settleNativeStart(intent.id,{kind:"not-created",code:"SPAWN_FAILED"})).toMatchObject({state:"FAILED",code:"SPAWN_FAILED"});expect(f.coordinator.startForRun("run")?.state).toBe("FAILED");}finally{f.db.close();}
});
it("retains unknown receipt and capacity until exact read-only evidence resolves it",()=>{
  const f=fixture();try{const intent=f.coordinator.reserveNativeStart(f.input);f.coordinator.beginNativeStart(intent.id);f.coordinator.settleNativeStart(intent.id,{kind:"unknown",code:"NATIVE_START_OUTCOME_UNKNOWN"});expect(f.coordinator.hasUncertainStart("run")).toBe(true);expect(()=>f.coordinator.beginNativeStart(intent.id)).toThrowError(expect.objectContaining({code:"NATIVE_START_OUTCOME_UNKNOWN"}));expect(f.db.getEntity("run","run")).toMatchObject({state:"STARTING"});expect(f.db.getCanonicalTask("task")?.document).toMatchObject({currentRunId:"run",state:"QUEUED"});}finally{f.db.close();}
});
it("acknowledges a created session only with the exact reserved identity and backend",()=>{
  const f=fixture();try{const intent=f.coordinator.reserveNativeStart(f.input);f.coordinator.beginNativeStart(intent.id);const session={id:"reserved-session",runId:"run",profileId:"p",backendId:"exec",workspacePath:run.worktree,state:"RUNNING" as const,createdAt:at,updatedAt:at,providerSessionId:"native"};
    expect(()=>f.coordinator.settleNativeStart(intent.id,{kind:"created",session:{...session,id:"different"}})).toThrowError(expect.objectContaining({code:"NATIVE_IDENTITY_CHANGED"}));expect(()=>f.coordinator.settleNativeStart(intent.id,{kind:"created",session:{...session,backendId:"wrong"}})).toThrowError(expect.objectContaining({code:"NATIVE_IDENTITY_CHANGED"}));expect(f.coordinator.startForRun("run")?.state).toBe("SENDING");expect(f.coordinator.settleNativeStart(intent.id,{kind:"created",session})).toMatchObject({state:"ACKNOWLEDGED"});expect(f.db.getEntity("session","reserved-session")).toMatchObject({nativeSessionId:"native"});
  }finally{f.db.close();}
});
it("atomically rolls start reservation back when the surrounding dispatch reservation fails",()=>{
  const f=fixture();try{expect(()=>f.db.transaction(()=>{f.coordinator.reserveNativeStart(f.input);throw Error("receipt failure");})).toThrow("receipt failure");expect(f.coordinator.startForRun("run")).toBeUndefined();expect(f.db.getEntity("session","reserved-session")).toBeUndefined();}finally{f.db.close();}
});

it("does not accept a late creation result from a revoked generation or lease",()=>{
  for(const changed of [{generation:2},{leaseId:"new-lease"}]){
    const f=fixture();try{const intent=f.coordinator.reserveNativeStart(f.input);f.coordinator.beginNativeStart(intent.id);f.db.saveEntity("run","run",json({...run,...changed}));
      expect(()=>f.coordinator.settleNativeStart(intent.id,{kind:"created",session:{id:run.sessionId,runId:run.id,profileId:"p",backendId:"exec",workspacePath:run.worktree,state:"RUNNING",createdAt:at,updatedAt:at,providerSessionId:"native"}})).toThrowError(expect.objectContaining({code:"STALE_RUN_AUTHORITY"}));
      expect(f.coordinator.startForRun("run")?.state).toBe("SENDING");expect(f.db.getEntity("session",run.sessionId)).not.toHaveProperty("nativeSessionId");
    }finally{f.db.close();}
  }
});
it("rejects an expired lease before sending a reserved creation",()=>{
  const f=fixture();try{f.db.saveEntity("run","run",json({...run,leaseExpiresAt:"2000-01-01T00:00:00Z"}));const intent=f.coordinator.reserveNativeStart({...f.input,run:{...run,leaseExpiresAt:"2000-01-01T00:00:00Z"}});
    expect(()=>f.coordinator.beginNativeStart(intent.id)).toThrowError(expect.objectContaining({code:"STALE_RUN_AUTHORITY"}));expect(f.coordinator.startForRun("run")?.state).toBe("RESERVED");
  }finally{f.db.close();}
});
function selectedFixture(){
 const f=fixture();const selected:Run={...f.input.run,executionSelection:{version:1,mode:"manual",source:"explicit",profileId:"p",runnerId:"local",providerId:"codex",backendId:"exec",selectionType:"explicit-model",requestedModel:"model",nativeParameters:{reasoningEffort:"medium"},configRevision:1,contextFingerprint:"scope",selectedAt:at}};
 f.db.saveEntity("run","run",json(selected));return {...f,input:{...f.input,run:selected}};
}
it("rejects a forged v3 choice before reserving any native creation",()=>{
 const f=selectedFixture();try{
  expect(()=>f.coordinator.reserveNativeStart({...f.input,run:{...f.input.run,executionSelection:{...f.input.run.executionSelection!,requestedModel:"forged"}}})).toThrowError(expect.objectContaining({code:"STALE_RUN_AUTHORITY"}));
  expect(f.coordinator.startForRun("run")).toBeUndefined();expect(f.db.getEntity("session","reserved-session")).toBeUndefined();
 }finally{f.db.close();}
});
it("rechecks current Task and control epoch before a reserved creation is sent",()=>{
 for(const change of ["task","control"] as const){const f=fixture();try{
  const intent=f.coordinator.reserveNativeStart(f.input);
  if(change==="task")f.db.writeCanonicalTask("task",1,{id:"task",state:"QUEUED",currentRunId:"replacement"},at);
  else new InteractionStore(f.db).compareAndSwapControl({sessionId:"reserved-session",expectedRevision:1,expectedEpoch:1,actorId:"owner",event:{type:"conflict",at}});
  expect(()=>f.coordinator.beginNativeStart(intent.id)).toThrowError(expect.objectContaining({code:change==="task"?"STALE_RUN_AUTHORITY":"START_ALREADY_SETTLED"}));
  expect(f.coordinator.startForRun("run")?.state).toBe(change==="task"?"RESERVED":"CANCELLED");
 }finally{f.db.close();}}
});
it("requires the created adapter session to retain the exact frozen v3 choice and execution context",()=>{
 const f=selectedFixture();try{
  const intent=f.coordinator.reserveNativeStart(f.input);f.coordinator.beginNativeStart(intent.id);
  const session={id:"reserved-session",runId:"run",profileId:"p",backendId:"exec",workspacePath:run.worktree,state:"RUNNING" as const,createdAt:at,updatedAt:at,executionSelection:f.input.run.executionSelection!,executionRef:run.executionRef};
  expect(()=>f.coordinator.settleNativeStart(intent.id,{kind:"created",session:{...session,executionSelection:{...session.executionSelection,requestedModel:"different"}}})).toThrowError(expect.objectContaining({code:"MODEL_BINDING_DRIFT"}));
  expect(()=>f.coordinator.settleNativeStart(intent.id,{kind:"created",session:{...session,executionRef:undefined}})).toThrowError(expect.objectContaining({code:"EXECUTION_CONTEXT_DRIFT"}));
  expect(f.coordinator.startForRun("run")?.state).toBe("SENDING");
  expect(f.coordinator.settleNativeStart(intent.id,{kind:"created",session})).toMatchObject({state:"ACKNOWLEDGED"});
 }finally{f.db.close();}
});

it("does not reserve creation under an existing locked control epoch",()=>{
 const f=fixture();try{
  f.db.saveEntity("session",run.sessionId,json({id:run.sessionId,profileId:run.profileId,providerId:run.providerId,resumable:true,executionRef:run.executionRef,createdAt:at,updatedAt:at}));
  const store=new InteractionStore(f.db);store.initializeControl({sessionId:run.sessionId,activeRunId:run.id,exclusion:"none",at});
  store.compareAndSwapControl({sessionId:run.sessionId,expectedRevision:1,expectedEpoch:1,actorId:"owner",event:{type:"conflict",at}});
  expect(()=>f.coordinator.reserveNativeStart(f.input)).toThrowError(expect.objectContaining({code:"NATIVE_WRITE_LOCKED"}));
  expect(f.coordinator.startForRun("run")).toBeUndefined();
 }finally{f.db.close();}
});
it("keeps an acknowledged creation receipt readable after authority changes without sending again",()=>{
 const f=fixture();try{
  const intent=f.coordinator.reserveNativeStart(f.input);f.coordinator.beginNativeStart(intent.id);
  const session={id:run.sessionId,runId:run.id,profileId:run.profileId,backendId:"exec",workspacePath:run.worktree,state:"RUNNING" as const,createdAt:at,updatedAt:at};
  const settled=f.coordinator.settleNativeStart(intent.id,{kind:"created",session});
  new InteractionStore(f.db).compareAndSwapControl({sessionId:run.sessionId,expectedRevision:1,expectedEpoch:1,actorId:"owner",event:{type:"conflict",at}});
  expect(f.coordinator.reserveNativeStart(f.input)).toEqual(settled);
  expect(()=>f.coordinator.beginNativeStart(intent.id)).toThrowError(expect.objectContaining({code:"START_ALREADY_SETTLED"}));
 }finally{f.db.close();}
});
