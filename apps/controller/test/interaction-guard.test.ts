import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { MutationFence, NativeBinding, NativeObservation, Run, SessionControl } from "@dispatcher/domain";
import { DispatcherDatabase, InteractionStore, type JsonValue } from "@dispatcher/persistence";
import { NativeInteractions } from "../src/native-interactions.js";

const json=(value:unknown):JsonValue=>JSON.parse(JSON.stringify(value)) as JsonValue;
const at="2026-10-07T16:00:00Z";
const run:Run={id:"run",taskId:"task",sessionId:"session",profileId:"p",providerId:"codex",runnerId:"local",state:"WAITING_USER",generation:1,attempt:1,leaseId:"lease",leaseExpiresAt:"2026-10-07T17:00:00Z",taskRevision:1,contractRevision:1,worktree:"/workspace",startedAt:at,lastActivityAt:at,executionRef:{version:1,id:"execution",kind:"managed-worktree",runnerId:"local",repositoryId:"repo",workspaceId:"workspace",pathRef:"workspace:workspace",branch:"task/run",baseRevision:"sha"}};
const binding:NativeBinding={version:1,product:"codex",region:"global",profileId:"p",backendId:"exec",runnerId:"local",nativeStoreRef:"store",nativeSessionId:"native",executionRefId:"execution",identityState:"bound"};
const observation:NativeObservation={version:1,id:"idle",nativeSessionId:"native",scopeFingerprint:"scope",observedAt:at,state:"idle",pendingTools:"none",pendingApprovals:"none",historyMode:"snapshot-only",executionRefId:"execution"};
const principal={id:"owner",roles:["operator"],profileId:"p"};
function fixture(db=new DispatcherDatabase(":memory:"),legacy=false){
  db.writeCanonicalTask("task",0,{id:"task",state:"WAITING_USER",currentRunId:"run"},at);db.saveEntity("run","run",json(run));db.saveEntity("adapter-session","session",{id:"session",runId:"run",profileId:"p",backendId:"exec",workspacePath:"/workspace",state:"PAUSED",createdAt:at,updatedAt:at});
  const store=new InteractionStore(db);if(!legacy){db.saveEntity("session","session",{id:"session",profileId:"p",providerId:"codex",createdAt:at,updatedAt:at,resumable:true});store.bindNative({sessionId:"session",runId:"run",binding,expectedGeneration:1,expectedLeaseId:"lease"});store.initializeControl({sessionId:"session",activeRunId:"run",exclusion:"cooperative",at});store.saveObservation({sessionId:"session",observerGeneration:1,observerSequence:1,controlEpoch:1,observation});}
  const interactions=new NativeInteractions(db,()=>new Date(at));
  const fence:MutationFence={runId:"run",sessionId:"session",commandId:"command",generation:1,leaseId:"lease",expectedTaskRevision:1,expectedCurrentRunId:"run",expectedControlRevision:legacy?0:1,expectedControlEpoch:legacy?0:1};
  return {db,store,interactions,fence};
}
function human(f:ReturnType<typeof fixture>){
  const handoff=f.store.compareAndSwapControl({sessionId:"session",expectedRevision:1,expectedEpoch:1,actorId:"owner",event:{type:"request-handoff",principalId:"owner",at}});
  return f.store.compareAndSwapControl({sessionId:"session",expectedRevision:handoff.revision,expectedEpoch:handoff.epoch,actorId:"owner",event:{type:"release-verified",at,evidence:{version:1,nativeSessionId:"native",quiescent:true,pendingCommands:"none",lockReleased:"unsupported",exclusion:"cooperative",observation}}});
}
it("prevents legacy input from bypassing HUMAN control while preserving scoped read access",()=>{
  const f=fixture();try{const control=human(f);const fence={...f.fence,expectedControlRevision:control.revision,expectedControlEpoch:control.epoch};expect(f.interactions.authorizeInteraction(principal,"continue",fence)).toEqual({allowed:false,code:"NATIVE_WRITE_LOCKED"});expect(f.interactions.authorizeInteraction(principal,"history",fence)).toEqual({allowed:true});expect(f.interactions.authorizeInteraction(principal,"cancel",fence)).toEqual({allowed:false,code:"HUMAN_CANCEL_CONFIRMATION_REQUIRED"});}finally{f.db.close();}
});
it("rejects stale Task/currentRun, thread, profile, control, generation, lease and expired authority",()=>{
  const f=fixture();try{expect(f.interactions.authorizeInteraction(principal,"continue",f.fence)).toEqual({allowed:true});
    for(const changed of [{expectedTaskRevision:0},{expectedCurrentRunId:"other"},{sessionId:"other"},{generation:2},{leaseId:"other"},{expectedControlRevision:0},{expectedControlEpoch:0}])expect(f.interactions.authorizeInteraction(principal,"continue",{...f.fence,...changed}).allowed).toBe(false);
    expect(f.interactions.authorizeInteraction({...principal,profileId:"other"},"continue",f.fence)).toEqual({allowed:false,code:"SESSION_OWNER_MISMATCH"});expect(f.interactions.authorizeInteraction({...principal,roles:[]},"continue",f.fence)).toEqual({allowed:false,code:"FORBIDDEN"});
    f.db.saveEntity("run","run",json({...run,nativeBinding:binding,providerSessionId:"native",leaseExpiresAt:"2000-01-01T00:00:00Z"}));expect(f.interactions.authorizeInteraction(principal,"continue",f.fence)).toEqual({allowed:false,code:"STALE_RUN_AUTHORITY"});
  }finally{f.db.close();}
});
it("keeps a real legacy Adapter session writable without inventing native binding evidence",()=>{
  const f=fixture(undefined,true);try{expect(f.interactions.authorizeInteraction(principal,"continue",f.fence)).toEqual({allowed:true});expect(f.store.binding("session")).toBeUndefined();f.db.saveEntity("adapter-session","session",{id:"session",runId:"other",profileId:"p",backendId:"exec"});expect(f.interactions.authorizeInteraction(principal,"continue",f.fence).allowed).toBe(false);}finally{f.db.close();}
});
it("never permits a new write while any command may have been delivered",()=>{
  const f=fixture();try{const command=f.store.reserveCommand({id:"command",actorId:"owner",profileId:"p",type:"continue",fence:f.fence,semantics:{message:"private"}});f.store.updateCommand({id:command.id,expectedRevision:1,state:"SENDING"});f.store.updateCommand({id:command.id,expectedRevision:2,state:"UNKNOWN"});expect(f.interactions.authorizeInteraction(principal,"continue",f.fence)).toEqual({allowed:false,code:"NATIVE_COMMAND_OUTCOME_UNKNOWN"});expect(f.interactions.authorizeInteraction(principal,"history",f.fence)).toEqual({allowed:true});}finally{f.db.close();}
});
it("rejects bound identity drift and pending background work instead of inferring idle permission",()=>{
  const f=fixture();try{
    f.db.handle.prepare("UPDATE entities SET document_json=? WHERE kind='run' AND id='run'").run(JSON.stringify({...run,nativeBinding:binding,providerSessionId:"changed"}));expect(f.interactions.authorizeInteraction(principal,"continue",f.fence).allowed).toBe(false);
    f.db.saveEntity("run","run",json({...run,nativeBinding:binding,providerSessionId:"native"}));f.store.saveObservation({sessionId:"session",observerGeneration:1,observerSequence:2,controlEpoch:1,observation:{...observation,id:"pending",pendingTools:"present"}});expect(f.interactions.authorizeInteraction(principal,"continue",f.fence).allowed).toBe(false);
  }finally{f.db.close();}
});
it("keeps a quarantined legacy native identity read-only",()=>{
  const f=fixture(undefined,true);try{
    f.db.handle.prepare("INSERT INTO native_identity_diagnostics(id,session_id,code) VALUES(?,?,?)").run("conflict","session","NATIVE_BINDING_CONFLICT");
    expect(f.interactions.authorizeInteraction(principal,"continue",f.fence)).toEqual({allowed:false,code:"NATIVE_BINDING_CONFLICT"});expect(f.interactions.authorizeInteraction(principal,"history",f.fence)).toEqual({allowed:true});
  }finally{f.db.close();}
});
it("permits owned standalone trials but rejects canonical or bound sessions whose Run is missing",()=>{
  const f=fixture();try{
    f.db.saveEntity("adapter-session","trial",{id:"trial",runId:"trial-run",profileId:"p",backendId:"exec"});expect(f.interactions.authorizeStandaloneInput(principal,"trial")).toEqual({allowed:true});expect(f.interactions.authorizeStandaloneInput({...principal,profileId:"other"},"trial").allowed).toBe(false);expect(f.interactions.authorizeStandaloneInput({...principal,roles:[]},"trial").allowed).toBe(false);
    f.db.handle.prepare("INSERT INTO native_identity_diagnostics(id,session_id,code) VALUES(?,?,?)").run("missing","trial","LEGACY_NATIVE_BINDING_MISSING");expect(f.interactions.authorizeStandaloneInput(principal,"trial")).toEqual({allowed:true});
    f.db.handle.prepare("DELETE FROM entities WHERE kind='run' AND id='run'").run();expect(f.interactions.authorizeStandaloneInput(principal,"session").allowed).toBe(false);
  }finally{f.db.close();}
});
it("does not hold a SQL transaction during a slow native mutation and serializes only its Session",async()=>{
  const directory=mkdtempSync(join(tmpdir(),"dispatcher-guard-"));const path=join(directory,"db.sqlite");const f=fixture(new DispatcherDatabase(path));const other=new DispatcherDatabase(path);const release=Promise.withResolvers<void>();const entered=Promise.withResolvers<void>();const order:string[]=[];
  try{const first=f.interactions.withMutationLane("session",async()=>{order.push("first");entered.resolve();await release.promise;order.push("done");});await entered.promise;
    other.saveEntity("probe","probe",{value:"written during native await"});expect(other.getEntity("probe","probe")).toEqual({value:"written during native await"});
    const second=f.interactions.withMutationLane("session",async()=>{order.push("second");});await f.interactions.withMutationLane("other",async()=>{order.push("other");});expect(order).toEqual(["first","other"]);release.resolve();await Promise.all([first,second]);expect(order).toEqual(["first","other","done","second"]);
  }finally{release.resolve();other.close();f.db.close();rmSync(directory,{recursive:true,force:true});}
});
it("rechecks queued command fences so a duplicated intervention cannot send twice",async()=>{
  const f=fixture();let sends=0;
  try{const send=()=>f.interactions.withMutationLane("session",async()=>{const decision=f.interactions.authorizeInteraction(principal,"continue",f.fence);if(!decision.allowed)return decision;sends++;f.db.writeCanonicalTask("task",1,{id:"task",state:"RUNNING",currentRunId:"run"},at);return decision;});const results=await Promise.all([send(),send()]);expect(sends).toBe(1);expect(results[1]!.allowed).toBe(false);}finally{f.db.close();}
});
it("captures the lane's control epoch so a return to AUTOMATED cannot grant old in-flight work",async()=>{
  const f=fixture();try{await f.interactions.withMutationLane("session",async()=>{const before=f.interactions.fenceFor(run,"work");const old=f.store.control("session")!;f.store.compareAndSwapControl({sessionId:"session",expectedRevision:old.revision,expectedEpoch:old.epoch,actorId:"owner",event:{type:"conflict",at}});const changed=f.store.control("session")!;
    const reset:SessionControl={...changed,state:"AUTOMATED",epoch:changed.epoch+1,revision:changed.revision+1};f.db.handle.prepare("UPDATE session_controls SET epoch=?,revision=?,state=?,document_json=? WHERE session_id=?").run(reset.epoch,reset.revision,reset.state,JSON.stringify(reset),"session");
    const after=f.interactions.fenceFor(run,"work");expect(after.expectedControlEpoch).toBe(before.expectedControlEpoch);expect(f.interactions.authorizeInteraction(principal,"continue",after)).toEqual({allowed:false,code:"STALE_CONTROL_REVISION"});
  });}finally{f.db.close();}
});
