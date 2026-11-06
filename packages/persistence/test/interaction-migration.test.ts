import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { NativeBinding } from "@dispatcher/domain";
import { DispatcherDatabase, InteractionStore, MigrationError, migrations, type JsonValue } from "../src/index.js";
const json=(value:unknown):JsonValue=>JSON.parse(JSON.stringify(value)) as JsonValue;
const at="2026-10-07T13:00:00Z";
const binding:NativeBinding={version:1,product:"codex",region:"global",profileId:"p",backendId:"exec",runnerId:"local",nativeStoreRef:"store",nativeSessionId:"native",identityState:"bound",executionRefId:"execution"};
function seed(db:DispatcherDatabase,id="session",profileId="p",runId="run"){
  const executionRef={version:1,id:"execution",kind:"managed-worktree",runnerId:"local",repositoryId:"repo",workspaceId:"workspace",pathRef:"workspace:workspace",branch:"task/run",baseRevision:"sha"};
  db.saveEntity("session",id,json({id,providerId:"codex",profileId,executionRef,resumable:true,createdAt:at,updatedAt:at}));
  db.saveEntity("run",runId,json({id:runId,taskId:`task-${runId}`,runnerId:"local",providerId:"codex",profileId,sessionId:id,state:"ACTIVE",generation:1,attempt:1,leaseId:"lease",taskRevision:1,contractRevision:1,worktree:"/managed/workspace",requiredCapabilities:[],startedAt:at,lastActivityAt:at,executionRef}));
  db.writeCanonicalTask(`task-${runId}`,0,{id:`task-${runId}`,currentRunId:runId,state:"RUNNING"},at);
}
const fence={runId:"run",sessionId:"session",expectedTaskRevision:1,expectedCurrentRunId:"run",expectedControlRevision:1,expectedControlEpoch:1,generation:1,leaseId:"lease",commandId:"command"};
const reserve={id:"command",actorId:"owner",profileId:"p",type:"continue" as const,fence,semantics:{message:"private user prompt",a:1}};

it("freezes the v3 execution selection independently of legacy model records",()=>{
  const db=new DispatcherDatabase(":memory:");
  try {
    seed(db);
    const run=db.getEntity<JsonValue>("run","run") as Record<string,JsonValue>;
    const selection={version:1,mode:"manual",source:"native-default",profileId:"p",runnerId:"local",providerId:"codex",backendId:"exec",selectionType:"native-default",nativeParameters:{},contextFingerprint:"frozen",configRevision:1,selectedAt:at};
    db.saveEntity("run","run",json({...run,executionSelection:selection}));
    expect(()=>db.saveEntity("run","run",json({...run,executionSelection:{...selection,runnerId:"other"}}))).toThrowError(expect.objectContaining({code:"IMMUTABLE_RUN_SELECTION"}));
    expect(()=>db.saveEntity("run","run",run)).toThrowError(expect.objectContaining({code:"IMMUTABLE_RUN_SELECTION"}));
    expect(()=>db.saveEntity("run","run",json({...run,executionSelection:selection,modelSelection:{version:1}}))).toThrowError(expect.objectContaining({code:"IMMUTABLE_RUN_SELECTION"}));
    expect(db.getEntity("run","run")).toMatchObject({executionSelection:selection});
  } finally {db.close();}
});

it("binds a v3 selection only against its frozen Run contract and actual context",()=>{
  const db=new DispatcherDatabase(":memory:");
  try {
    seed(db);
    const run=db.getEntity<JsonValue>("run","run") as Record<string,JsonValue>;
    const selection={version:1,mode:"manual",source:"native-default",profileId:"p",runnerId:"local",providerId:"codex",backendId:"exec",selectionType:"native-default",nativeParameters:{},contextFingerprint:"frozen",configRevision:1,selectedAt:at};
    db.saveEntity("run","run",json({...run,executionSelection:selection}));
    db.saveEntity("run-contract","run",{workspace:{repositoryId:"other",baseCommit:"sha"}});
    const store=new InteractionStore(db);
    const request={sessionId:"session",runId:"run",binding,expectedGeneration:1,expectedLeaseId:"lease"};
    expect(()=>store.bindNative(request)).toThrowError(expect.objectContaining({code:"EXECUTION_CONTEXT_DRIFT"}));
    expect(store.binding("session")).toBeUndefined();
    db.saveEntity("run-contract","run",{workspace:{repositoryId:"repo",baseCommit:"sha"}});
    expect(store.bindNative(request)).toEqual(binding);
    expect(db.getEntity("run","run")).toMatchObject({executionSelection:selection});
    expect(db.getEntity("run","run")).not.toHaveProperty("modelSelection");
  } finally {db.close();}
});

it("does not grant AUTOMATED control to an unbound migrated session",()=>{
  const directory=mkdtempSync(join(tmpdir(),"dispatcher-unbound-control-"));const path=join(directory,"db.sqlite");
  try {
    const old=new DispatcherDatabase(path,migrations.filter(m=>m.version<4));seed(old);old.close();
    const db=new DispatcherDatabase(path);
    try {
      const store=new InteractionStore(db);
      expect(()=>store.initializeControl({sessionId:"session",activeRunId:"run",exclusion:"none",at})).toThrowError(expect.objectContaining({code:"LEGACY_NATIVE_BINDING_MISSING"}));
      expect(store.control("session")).toBeUndefined();
    } finally {db.close();}
  } finally {rmSync(directory,{recursive:true,force:true});}
});
function live(db:DispatcherDatabase){seed(db);const store=new InteractionStore(db);store.bindNative({sessionId:"session",runId:"run",binding,expectedGeneration:1,expectedLeaseId:"lease"});store.initializeControl({sessionId:"session",activeRunId:"run",exclusion:"cooperative",at});return store;}
it("migrates twice without adopting conflicting old owners or changing their records",()=>{
  const directory=mkdtempSync(join(tmpdir(),"dispatcher-native-migration-"));const path=join(directory,"db.sqlite");
  try{
    const old=new DispatcherDatabase(path,migrations.filter(m=>m.version<4));seed(old);seed(old,"alias","other","other-run");
    const original=old.getEntity<JsonValue>("session","session")!;const alias=old.getEntity<JsonValue>("session","alias")!;
    old.saveEntity("session","session",json({...original as object,nativeBinding:binding}));old.saveEntity("session","alias",json({...alias as object,nativeBinding:{...binding,profileId:"other"}}));old.close();
    const db=new DispatcherDatabase(path);const store=new InteractionStore(db);expect(db.schemaVersion()).toBe(19);expect(store.diagnostics().map(d=>d.code)).toEqual(["NATIVE_BINDING_CONFLICT","NATIVE_BINDING_CONFLICT"]);
    expect(store.binding("session")).toBeUndefined();expect(db.getEntity("session","session")).toEqual(json({...original as object,nativeBinding:binding}));
    expect(()=>store.bindNative({sessionId:"session",runId:"run",binding,expectedGeneration:1,expectedLeaseId:"lease"})).toThrowError(expect.objectContaining({code:"NATIVE_BINDING_CONFLICT"}));
    db.migrate();expect(store.diagnostics()).toHaveLength(2);db.close();
    const restarted=new DispatcherDatabase(path);expect(new InteractionStore(restarted).diagnostics()).toHaveLength(2);expect(restarted.integrityCheck()).toBe(true);restarted.close();
  }finally{rmSync(directory,{recursive:true,force:true});}
});
it("binds one native store identity transactionally and rejects duplicate aliases",()=>{
  const db=new DispatcherDatabase(":memory:");try{const store=live(db);seed(db,"alias","other","other-run");
    expect(store.binding("session")).toEqual(binding);expect(db.getEntity("run","run")).toMatchObject({providerSessionId:"native"});
    expect(()=>store.bindNative({sessionId:"alias",runId:"other-run",binding:{...binding,profileId:"other"},expectedGeneration:1,expectedLeaseId:"lease"})).toThrowError(expect.objectContaining({code:"NATIVE_BINDING_CONFLICT"}));
    expect(db.getEntity("run","other-run")).not.toHaveProperty("providerSessionId");expect(store.binding("alias")).toBeUndefined();
  }finally{db.close();}
});
it("rolls back canonical binding, Run projection and uniqueness when a partial write fails",()=>{
  const db=new DispatcherDatabase(":memory:");seed(db);const store=new InteractionStore(db);const save=db.saveEntity.bind(db);
  vi.spyOn(db,"saveEntity").mockImplementation((kind,...args)=>{if(kind==="run")throw Error("injected partial write");save(kind,...args);});
  try{expect(()=>store.bindNative({sessionId:"session",runId:"run",binding,expectedGeneration:1,expectedLeaseId:"lease"})).toThrow("injected partial write");expect(store.binding("session")).toBeUndefined();expect(db.getEntity("session","session")).not.toHaveProperty("nativeBinding");expect(db.getEntity("run","run")).not.toHaveProperty("providerSessionId");}finally{db.close();}
});
it("uses persistent revision and epoch CAS and atomically fences reserved commands",()=>{
  const db=new DispatcherDatabase(":memory:");try{const store=live(db);store.reserveCommand(reserve);const next=store.compareAndSwapControl({sessionId:"session",expectedRevision:1,expectedEpoch:1,actorId:"owner",event:{type:"request-handoff",principalId:"owner",at}});
    expect(next).toMatchObject({state:"HANDOFF_REQUESTED",epoch:2,revision:2});expect(store.command("command")).toMatchObject({state:"CANCELLED",code:"STALE_CONTROL_EPOCH"});
    expect(()=>store.compareAndSwapControl({sessionId:"session",expectedRevision:1,expectedEpoch:1,actorId:"owner",event:{type:"request-handoff",principalId:"owner",at}})).toThrowError(expect.objectContaining({code:"STALE_CONTROL_REVISION"}));
    expect(store.audit("session")).toHaveLength(1);expect(JSON.stringify(store.audit("session"))).not.toContain("private user prompt");
  }finally{db.close();}
});
it("preserves command semantics and UNKNOWN receipts across restart without replaying them",()=>{
  const directory=mkdtempSync(join(tmpdir(),"dispatcher-native-command-"));const path=join(directory,"db.sqlite");
  try{const db=new DispatcherDatabase(path);const store=live(db);const first=store.reserveCommand(reserve);expect(store.reserveCommand({...reserve,semantics:{a:1,message:"private user prompt"}})).toEqual(first);
    expect(()=>store.reserveCommand({...reserve,semantics:{message:"different"}})).toThrowError(expect.objectContaining({code:"IDEMPOTENCY_CONFLICT"}));
    store.updateCommand({id:"command",expectedRevision:1,state:"SENDING"});store.updateCommand({id:"command",expectedRevision:2,state:"UNKNOWN"});expect(JSON.stringify(store.command("command"))).not.toContain("private user prompt");db.close();
    const restarted=new DispatcherDatabase(path);const again=new InteractionStore(restarted);expect(again.command("command")).toMatchObject({state:"UNKNOWN",revision:3});expect(again.reserveCommand(reserve)).toMatchObject({state:"UNKNOWN"});expect(()=>again.updateCommand({id:"command",expectedRevision:3,state:"SENDING"})).toThrowError(expect.objectContaining({code:"INVALID_COMMAND_TRANSITION"}));restarted.close();
  }finally{rmSync(directory,{recursive:true,force:true});}
});
it("deduplicates observation facts while refusing stale control checkpoints",()=>{
  const db=new DispatcherDatabase(":memory:");try{const store=live(db);const observation={version:1 as const,id:"obs",nativeSessionId:"native",scopeFingerprint:"scope",observedAt:at,state:"idle" as const,pendingTools:"none" as const,pendingApprovals:"none" as const,historyMode:"snapshot-only" as const};
    const input={sessionId:"session",observerGeneration:1,observerSequence:1,controlEpoch:1,observation};expect(store.saveObservation(input)).toMatchObject({accepted:true});expect(store.saveObservation(input)).toMatchObject({accepted:false});
    store.compareAndSwapControl({sessionId:"session",expectedRevision:1,expectedEpoch:1,actorId:"owner",event:{type:"request-handoff",principalId:"owner",at}});
    expect(store.saveObservation({...input,observation:{...observation,id:"late"}})).toMatchObject({accepted:false,code:"STALE_CONTROL_EPOCH"});expect(store.observation("session")?.id).toBe("obs");
  }finally{db.close();}
});

it("rolls back migration data and DDL together before retrying",()=>{
  const directory=mkdtempSync(join(tmpdir(),"dispatcher-native-migration-fail-"));const path=join(directory,"db.sqlite");
  try{
    const old=new DispatcherDatabase(path,migrations.filter(m=>m.version<4));seed(old);old.close();
    const v4=migrations.find(m=>m.version===4)!;
    expect(()=>new DispatcherDatabase(path,[...migrations.filter(m=>m.version<4),{...v4,afterApply:db=>{
      db.saveEntity("session","session",{id:"changed"});throw Error("migration interrupted");
    }}])).toThrow(MigrationError);
    const rollback=new DispatcherDatabase(path,migrations.filter(m=>m.version<4));expect(rollback.schemaVersion()).toBe(3);expect(rollback.getEntity("session","session")).toMatchObject({id:"session",profileId:"p"});
    expect(rollback.handle.prepare("SELECT name FROM sqlite_master WHERE name='native_bindings'").all()).toHaveLength(0);rollback.close();
    const recovered=new DispatcherDatabase(path);expect(recovered.schemaVersion()).toBe(19);expect(new InteractionStore(recovered).diagnostics()).toMatchObject([{code:"LEGACY_NATIVE_BINDING_MISSING"}]);expect(recovered.integrityCheck()).toBe(true);recovered.close();
  }finally{rmSync(directory,{recursive:true,force:true});}
});
it("rolls back a failed binding inside a caller transaction that catches the failure",()=>{
  const db=new DispatcherDatabase(":memory:");seed(db);const store=new InteractionStore(db);const save=db.saveEntity.bind(db);
  vi.spyOn(db,"saveEntity").mockImplementation((kind,...args)=>{if(kind==="run")throw Error("nested partial write");save(kind,...args);});
  try{db.transaction(()=>{expect(()=>store.bindNative({sessionId:"session",runId:"run",binding,expectedGeneration:1,expectedLeaseId:"lease"})).toThrow("nested partial write");db.saveEntity("runner","local",{id:"local"});});expect(db.getEntity("session","session")).not.toHaveProperty("nativeBinding");expect(db.getEntity("runner","local")).toEqual({id:"local"});}finally{db.close();}
});
it("migrates a verified explicit binding and all its legacy projections, leaving missing identities read only",()=>{
  const directory=mkdtempSync(join(tmpdir(),"dispatcher-native-legacy-"));const path=join(directory,"db.sqlite");
  try{
    const old=new DispatcherDatabase(path,migrations.filter(m=>m.version<4));seed(old);seed(old,"missing","other","other-run");
    old.saveEntity("session","session",json({...old.getEntity("session","session") as object,nativeBinding:binding}));old.saveEntity("adapter-session","session",{id:"session",runId:"run",profileId:"p",backendId:"exec"});old.close();
    const db=new DispatcherDatabase(path);const store=new InteractionStore(db);expect(store.binding("session")).toEqual(binding);expect(db.getEntity("run","run")).toMatchObject({providerSessionId:"native"});expect(db.getEntity("adapter-session","session")).toMatchObject({nativeBinding:binding,providerSessionId:"native"});expect(store.binding("missing")).toBeUndefined();expect(store.diagnostics()).toMatchObject([{sessionId:"missing",code:"LEGACY_NATIVE_BINDING_MISSING"}]);db.close();
  }finally{rmSync(directory,{recursive:true,force:true});}
});
it("rejects stale creation and terminal reconcile even when the caller claims the Run is active",()=>{
  const db=new DispatcherDatabase(":memory:");try{
    const store=live(db);store.compareAndSwapControl({sessionId:"session",expectedRevision:1,expectedEpoch:1,actorId:"owner",event:{type:"conflict",at}});store.compareAndSwapControl({sessionId:"session",expectedRevision:2,expectedEpoch:2,actorId:"owner",event:{type:"begin-reconcile",at}});
    db.saveEntity("run","run",json({...db.getEntity("run","run") as object,state:"COMPLETE"}));
    expect(()=>store.compareAndSwapControl({sessionId:"session",expectedRevision:3,expectedEpoch:3,actorId:"owner",event:{type:"reconcile-verified",runTerminal:false,observationRef:"claimed",at}})).toThrowError(expect.objectContaining({code:"TERMINAL_RUN"}));expect(store.control("session")?.state).toBe("RECONCILING");
    expect(()=>store.initializeControl({sessionId:"session",activeRunId:"run",exclusion:"cooperative",at})).toThrowError(expect.objectContaining({code:"TERMINAL_RUN"}));
  }finally{db.close();}
});
it("arbitrates takeover through two database connections and rejects stale observations",()=>{
  const directory=mkdtempSync(join(tmpdir(),"dispatcher-native-cas-"));const path=join(directory,"db.sqlite");
  try{
    const first=new DispatcherDatabase(path);const store=live(first);const second=new DispatcherDatabase(path);const other=new InteractionStore(second);
    const observation={version:1 as const,id:"new",nativeSessionId:"native",scopeFingerprint:"scope",observedAt:at,state:"idle" as const,pendingTools:"none" as const,pendingApprovals:"none" as const,historyMode:"snapshot-only" as const};
    expect(store.saveObservation({sessionId:"session",observerGeneration:2,observerSequence:1,controlEpoch:1,observation})).toMatchObject({accepted:true});
    expect(other.saveObservation({sessionId:"session",observerGeneration:1,observerSequence:1,controlEpoch:1,observation:{...observation,id:"old"}})).toMatchObject({accepted:false,code:"STALE_OBSERVER_GENERATION"});
    store.compareAndSwapControl({sessionId:"session",expectedRevision:1,expectedEpoch:1,actorId:"owner",event:{type:"request-handoff",principalId:"owner",at}});
    expect(()=>other.compareAndSwapControl({sessionId:"session",expectedRevision:1,expectedEpoch:1,actorId:"other",event:{type:"request-handoff",principalId:"other",at}})).toThrowError(expect.objectContaining({code:"STALE_CONTROL_REVISION"}));expect(other.audit("session")).toHaveLength(1);expect(other.observation("session")?.id).toBe("new");second.close();first.close();
  }finally{rmSync(directory,{recursive:true,force:true});}
});
it("requires a current, quiescent persisted observation before reclaiming automatic control",()=>{
  const db=new DispatcherDatabase(":memory:");try{
    const store=live(db);store.compareAndSwapControl({sessionId:"session",expectedRevision:1,expectedEpoch:1,actorId:"owner",event:{type:"conflict",at}});store.compareAndSwapControl({sessionId:"session",expectedRevision:2,expectedEpoch:2,actorId:"owner",event:{type:"begin-reconcile",at}});
    const event={type:"reconcile-verified" as const,runTerminal:false,observationRef:"claimed",at};const input={sessionId:"session",expectedRevision:3,expectedEpoch:3,actorId:"owner",event};
    expect(()=>store.compareAndSwapControl(input)).toThrowError(expect.objectContaining({code:"NATIVE_STATE_UNKNOWN"}));
    const observation={version:1 as const,id:"claimed",nativeSessionId:"native",scopeFingerprint:"scope",observedAt:at,state:"running" as const,pendingTools:"none" as const,pendingApprovals:"none" as const,historyMode:"snapshot-only" as const};store.saveObservation({sessionId:"session",observerGeneration:1,observerSequence:1,controlEpoch:3,observation});
    expect(()=>store.compareAndSwapControl(input)).toThrowError(expect.objectContaining({code:"HANDOFF_NOT_QUIESCENT"}));
    store.saveObservation({sessionId:"session",observerGeneration:1,observerSequence:2,controlEpoch:3,observation:{...observation,id:"idle",state:"idle"}});expect(store.compareAndSwapControl({...input,event:{...event,observationRef:"idle"}})).toMatchObject({state:"AUTOMATED",epoch:4,revision:4});
  }finally{db.close();}
});
it("rechecks Run authority at send time after a command has been reserved",()=>{
  const db=new DispatcherDatabase(":memory:");try{const store=live(db);store.reserveCommand(reserve);db.writeCanonicalTask("task-run",1,{id:"task-run",currentRunId:"another",state:"RUNNING"},at);
    expect(()=>store.updateCommand({id:"command",expectedRevision:1,state:"SENDING"})).toThrowError(expect.objectContaining({code:"STALE_RUN_AUTHORITY"}));expect(store.command("command")).toMatchObject({state:"RESERVED",revision:1});
  }finally{db.close();}
});
it("does not let an observation id from another native store claim the current checkpoint",()=>{
  const db=new DispatcherDatabase(":memory:");try{
    const store=live(db);seed(db,"alias","other","other-run");store.bindNative({sessionId:"alias",runId:"other-run",binding:{...binding,profileId:"other",nativeStoreRef:"other-store"},expectedGeneration:1,expectedLeaseId:"lease"});store.initializeControl({sessionId:"alias",activeRunId:"other-run",exclusion:"cooperative",at});
    const observation={version:1 as const,id:"shared-id",nativeSessionId:"native",scopeFingerprint:"scope",observedAt:at,state:"idle" as const,pendingTools:"none" as const,pendingApprovals:"none" as const,historyMode:"snapshot-only" as const};store.saveObservation({sessionId:"session",observerGeneration:1,observerSequence:1,controlEpoch:1,observation});
    expect(()=>store.saveObservation({sessionId:"alias",observerGeneration:1,observerSequence:1,controlEpoch:1,observation})).toThrowError(expect.objectContaining({code:"NATIVE_OBSERVATION_CONFLICT"}));expect(store.observation("alias")).toBeUndefined();
  }finally{db.close();}
});
it("preserves canonical binding and derived provider id across ordinary entity saves",()=>{
  const db=new DispatcherDatabase(":memory:");try{live(db);
    const run=db.getEntity("run","run")!;const session=db.getEntity("session","session")!;
    expect(()=>db.saveEntity("run","run",json({...run as object,providerSessionId:"changed"}))).toThrowError(expect.objectContaining({code:"NATIVE_IDENTITY_CHANGED"}));
    expect(()=>db.saveEntity("session","session",json({...session as object,nativeBinding:{...binding,nativeSessionId:"changed"},nativeSessionId:"changed"}))).toThrowError(expect.objectContaining({code:"NATIVE_IDENTITY_CHANGED"}));
    db.saveEntity("run","run",json({...run as object,state:"WAITING_USER"}));expect(db.getEntity("run","run")).toMatchObject({state:"WAITING_USER",providerSessionId:"native"});
  }finally{db.close();}
});
it("quarantines conflicting legacy keys even when a new alias tries to acquire them",()=>{
  const directory=mkdtempSync(join(tmpdir(),"dispatcher-native-quarantine-"));const path=join(directory,"db.sqlite");
  try{
    const old=new DispatcherDatabase(path,migrations.filter(m=>m.version<4));seed(old);seed(old,"alias","other","other-run");
    for(const [id,profileId] of [["session","p"],["alias","other"]])old.saveEntity("session",id!,json({...old.getEntity("session",id!) as object,nativeBinding:{...binding,profileId}}));old.close();
    const db=new DispatcherDatabase(path);seed(db,"new-alias","third","new-run");const store=new InteractionStore(db);
    expect(()=>store.bindNative({sessionId:"new-alias",runId:"new-run",binding:{...binding,profileId:"third"},expectedGeneration:1,expectedLeaseId:"lease"})).toThrowError(expect.objectContaining({code:"NATIVE_BINDING_CONFLICT"}));expect(store.binding("new-alias")).toBeUndefined();db.close();
  }finally{rmSync(directory,{recursive:true,force:true});}
});
it("preserves contradictory adapter bindings as migration diagnostics instead of failing upgrade",()=>{
  const directory=mkdtempSync(join(tmpdir(),"dispatcher-native-adapter-conflict-"));const path=join(directory,"db.sqlite");
  try{
    const old=new DispatcherDatabase(path,migrations.filter(m=>m.version<4));seed(old);
    old.saveEntity("session","session",json({...old.getEntity("session","session") as object,nativeBinding:binding}));old.saveEntity("adapter-session","session",json({id:"session",runId:"run",profileId:"p",backendId:"exec",nativeBinding:{...binding,nativeSessionId:"contradictory"},providerSessionId:"native"}));old.close();
    const db=new DispatcherDatabase(path);const store=new InteractionStore(db);expect(db.schemaVersion()).toBe(19);expect(store.diagnostics().every(d=>d.code==="NATIVE_IDENTITY_CHANGED")).toBe(true);expect(store.binding("session")).toBeUndefined();expect(db.getEntity("adapter-session","session")).toMatchObject({nativeBinding:{nativeSessionId:"contradictory"}});
    seed(db,"new","other","other-run");expect(()=>store.bindNative({sessionId:"new",runId:"other-run",binding:{...binding,profileId:"other",nativeSessionId:"contradictory"},expectedGeneration:1,expectedLeaseId:"lease"})).toThrowError(expect.objectContaining({code:"NATIVE_IDENTITY_CHANGED"}));db.close();
  }finally{rmSync(directory,{recursive:true,force:true});}
});
it("rejects an older idle response arriving after a newer running observation in the same connection",()=>{
  const db=new DispatcherDatabase(":memory:");try{
    const store=live(db);store.compareAndSwapControl({sessionId:"session",expectedRevision:1,expectedEpoch:1,actorId:"owner",event:{type:"conflict",at}});store.compareAndSwapControl({sessionId:"session",expectedRevision:2,expectedEpoch:2,actorId:"owner",event:{type:"begin-reconcile",at}});
    const newer={version:1 as const,id:"running",nativeSessionId:"native",scopeFingerprint:"scope",observedAt:"2026-10-07T13:10:00Z",state:"running" as const,pendingTools:"none" as const,pendingApprovals:"none" as const,historyMode:"snapshot-only" as const};
    store.saveObservation({sessionId:"session",observerGeneration:1,observerSequence:2,controlEpoch:3,observation:newer});
    expect(store.saveObservation({sessionId:"session",observerGeneration:1,observerSequence:1,controlEpoch:3,observation:{...newer,id:"old-idle",state:"idle",observedAt:at}})).toMatchObject({accepted:false,code:"STALE_OBSERVER_SEQUENCE"});expect(store.observation("session")?.id).toBe("running");
    expect(()=>store.compareAndSwapControl({sessionId:"session",expectedRevision:3,expectedEpoch:3,actorId:"owner",event:{type:"reconcile-verified",runTerminal:false,observationRef:"old-idle",at}})).toThrowError(expect.objectContaining({code:"NATIVE_STATE_UNKNOWN"}));
  }finally{db.close();}
});
it("freezes identity-context fields on native-bound records while allowing lifecycle changes",()=>{
  const db=new DispatcherDatabase(":memory:");try{
    seed(db);db.saveEntity("adapter-session","session",{id:"session",runId:"run",profileId:"p",backendId:"exec"});const store=new InteractionStore(db);store.bindNative({sessionId:"session",runId:"run",binding,expectedGeneration:1,expectedLeaseId:"lease"});
    const run=db.getEntity("run","run")!;const session=db.getEntity("session","session")!;const adapter=db.getEntity("adapter-session","session")!;
    for(const [kind,value] of [["run",{...run as object,providerId:"other"}],["session",{...session as object,executionRef:{id:"changed"}}],["session",{...session as object,providerId:"other"}],["adapter-session",{...adapter as object,runId:"other"}],["adapter-session",{...adapter as object,backendId:"other"}]] as const)expect(()=>db.saveEntity(kind,kind==="run"?"run":"session",json(value))).toThrowError(expect.objectContaining({code:"NATIVE_IDENTITY_CHANGED"}));
  }finally{db.close();}
});
it("quarantines identities belonging to orphan Adapter records",()=>{
  const db=new DispatcherDatabase(":memory:",migrations.filter(m=>m.version<4));try{
    db.saveEntity("adapter-session","orphan",json({id:"orphan",runId:"missing",profileId:"p",backendId:"exec",nativeBinding:binding,providerSessionId:"native"}));db.migrate();seed(db);const store=new InteractionStore(db);
    expect(()=>store.bindNative({sessionId:"session",runId:"run",binding,expectedGeneration:1,expectedLeaseId:"lease"})).toThrowError(expect.objectContaining({code:"LEGACY_NATIVE_BINDING_MISSING"}));expect(store.binding("session")).toBeUndefined();
  }finally{db.close();}
});
it("does not abort migration when untrusted Adapter binding fields are malformed",()=>{
  const db=new DispatcherDatabase(":memory:",migrations.filter(m=>m.version<4));try{
    seed(db);db.saveEntity("session","session",json({...db.getEntity("session","session") as object,nativeBinding:binding}));db.saveEntity("adapter-session","session",json({id:"session",runId:"run",profileId:"p",backendId:"exec",nativeBinding:{...binding,nativeSessionId:123}}));
    expect(()=>db.migrate()).not.toThrow();expect(db.schemaVersion()).toBe(19);expect(new InteractionStore(db).diagnostics()).toMatchObject([{code:"LEGACY_NATIVE_BINDING_UNVERIFIED"}]);expect(db.getEntity("adapter-session","session")).toMatchObject({nativeBinding:{nativeSessionId:123}});
  }finally{db.close();}
});
it("does not migrate an apparently valid owner whose key is disputed by another Adapter record",()=>{
  const db=new DispatcherDatabase(":memory:",migrations.filter(m=>m.version<4));try{
    seed(db);seed(db,"alias","other","other-run");db.saveEntity("session","session",json({...db.getEntity("session","session") as object,nativeBinding:binding}));db.saveEntity("session","alias",json({...db.getEntity("session","alias") as object,nativeBinding:{...binding,profileId:"other",nativeSessionId:"other-native"}}));db.saveEntity("adapter-session","alias",json({id:"alias",runId:"other-run",profileId:"other",backendId:"exec",nativeBinding:{...binding,profileId:"other"}}));db.migrate();const store=new InteractionStore(db);
    expect(store.binding("session")).toBeUndefined();expect(store.binding("alias")).toBeUndefined();expect(store.diagnostics().some(d=>d.sessionId==="session"&&d.code==="NATIVE_BINDING_CONFLICT")).toBe(true);
  }finally{db.close();}
});
it("quarantines identifiable native keys even when ownership or execution fields are malformed",()=>{
  for(const kind of ["session","adapter-session"]){
    const db=new DispatcherDatabase(":memory:",migrations.filter(m=>m.version<4));try{
      seed(db);const legacy={...db.getEntity(kind,"session") as object,id:"session",runId:"run",profileId:"p",backendId:"exec",nativeBinding:{...binding,executionRefId:""}};db.saveEntity(kind,"session",json(legacy));db.migrate();seed(db,"alias","other","other-run");const store=new InteractionStore(db);
      expect(()=>store.bindNative({sessionId:"alias",runId:"other-run",binding:{...binding,profileId:"other"},expectedGeneration:1,expectedLeaseId:"lease"})).toThrowError(expect.objectContaining({code:kind==="session"?"LEGACY_NATIVE_BINDING_UNVERIFIED":"LEGACY_NATIVE_BINDING_MISSING"}));expect(store.binding("alias")).toBeUndefined();
    }finally{db.close();}
  }
});


it("preserves adapter-session execution and known legacy-default snapshots without native binding",()=>{
  const db=new DispatcherDatabase(":memory:");
  try{
    for(const frozen of [{executionSelection:{version:1,requestedModel:"chosen"}},{legacyModel:{}},{legacyModel:{id:"configured"}}]){
      const session={id:JSON.stringify(frozen),profileId:"p",backendId:"exec",runId:"run",workspacePath:"/managed",state:"RUNNING",...frozen};
      db.saveEntity("adapter-session",session.id,json(session));
      expect(()=>db.saveEntity("adapter-session",session.id,json({...session,...("legacyModel" in frozen?{legacyModel:{id:"replaced"}}:{executionSelection:{version:1,requestedModel:"replaced"}})}))).toThrowError(expect.objectContaining({code:"IMMUTABLE_SESSION_SELECTION"}));
      expect(()=>db.saveEntity("adapter-session",session.id,json({...session,workspacePath:"/other"}))).toThrowError(expect.objectContaining({code:"IMMUTABLE_SESSION_SELECTION"}));
      db.saveEntity("adapter-session",session.id,json({...session,state:"COMPLETED"}));
      expect(db.getEntity("adapter-session",session.id)).toMatchObject({...session,state:"COMPLETED"});
    }
    expect(()=>db.saveEntity("adapter-session","dual",json({id:"dual",executionSelection:{version:1},legacyModel:{id:"second"}}))).toThrowError(expect.objectContaining({code:"IMMUTABLE_SESSION_SELECTION"}));
  }finally{db.close();}
});
