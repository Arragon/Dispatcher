import { afterEach, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, statSync, symlinkSync, mkdirSync, linkSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import * as persistence from "../src/index.js";

const roots:string[]=[];
const root=()=>{const dir=mkdtempSync(join(tmpdir(),"dispatcher-upgrade-"));roots.push(dir);return dir;};
afterEach(()=>{for(const dir of roots.splice(0))rmSync(dir,{recursive:true,force:true});});
const at="2026-10-11T10:00:00Z";
function seed(db:persistence.DispatcherDatabase){
  const executionRef={version:1,id:"execution",kind:"managed-worktree",runnerId:"local",repositoryId:"repo",workspaceId:"workspace",pathRef:"workspace:workspace",branch:"task/run",baseRevision:"sha"};
  db.writeCanonicalTask("task",0,{id:"task",state:"RUNNING",currentRunId:"run"},at);
  db.saveEntity("run","run",{id:"run",taskId:"task",sessionId:"session",profileId:"p",providerId:"codex",runnerId:"local",state:"ACTIVE",generation:1,leaseId:"lease",worktree:"/synthetic/worktree",executionRef});
  db.saveEntity("session","session",{id:"session",profileId:"p",providerId:"codex",executionRef});
  db.saveDeliveryEvidence({id:"evidence",taskId:"task",runId:"run",connectorInstanceId:"github",kind:"pull-request",externalId:"pr",document:{id:"evidence",revision:1,url:"https://example.invalid/pr/1"},updatedAt:at});
  db.enqueueOutboxEvent({id:"projection",connectorInstanceId:"linear",idempotencyKey:"stable",eventType:"task.project",payload:{taskId:"task"},status:"PENDING",attempt:0,availableAt:at,createdAt:at});
}
const backupApi=()=>{expect(persistence).toHaveProperty("createDispatcherBackup");return persistence.createDispatcherBackup;};
const restoreApi=()=>{expect(persistence).toHaveProperty("restoreDispatcherBackup");return persistence.restoreDispatcherBackup;};

it.each([3,5,6])("backs up schema %s with its own writer and upgrades only the restored copy",async version=>{
  const directory=root(),source=join(directory,"source.sqlite"),bundle=join(directory,"archive"),target=join(directory,"restored");
  const db=new persistence.DispatcherDatabase(source,persistence.migrations.filter(m=>m.version<=version));
  db.saveEntity("receipt","kept",{id:"kept"});db.close();
  const manifest=await backupApi()(source,bundle);
  expect(manifest.schemaVersion).toBe(version);
  expect(restoreApi()(bundle,target,{execute:true,confirmed:true})).toMatchObject({applied:true,reconciliationRequired:true});
  expect(persistence.inspectDispatcherDatabase(join(target,"dispatcher.sqlite"))).toMatchObject({schemaVersion:7,integrity:true,reconciliationRequired:true});
  const raw=new DatabaseSync(join(target,"dispatcher.sqlite"),{readOnly:true});
  try {expect(JSON.parse(String(raw.prepare("SELECT document_json FROM entities WHERE kind='receipt' AND id='kept'").get()?.document_json))).toEqual({id:"kept"});}finally{raw.close();}
  expect(persistence.inspectDispatcherDatabase(source).schemaVersion).toBe(version);
  expect(()=>new persistence.DispatcherDatabase(join(target,"dispatcher.sqlite"))).toThrowError(expect.objectContaining({code:"RESTORE_RECONCILIATION_REQUIRED"}));
});

it("rejects a newer schema before an older writer changes journal or stored data",()=>{
  const dir=root(),path=join(dir,"db.sqlite"),db=new persistence.DispatcherDatabase(path);seed(db);db.close();const before=readFileSync(path);
  let opened:persistence.DispatcherDatabase|undefined;try{expect(()=>{opened=new persistence.DispatcherDatabase(path,persistence.migrations.filter(m=>m.version<4));}).toThrowError(expect.objectContaining({code:"DATABASE_SCHEMA_UNSUPPORTED"}));}finally{opened?.close();}
  expect(readFileSync(path)).toEqual(before);
});
it("fences an already-open old SQL connection after upgrade without altering canonical data",()=>{
  const path=join(root(),"db.sqlite"),old=new persistence.DispatcherDatabase(path,persistence.migrations.filter(m=>m.version<=4));seed(old);const rawOld=new DatabaseSync(path);
  const store=new persistence.InteractionStore(old);store.bindNative({sessionId:"session",runId:"run",expectedGeneration:1,expectedLeaseId:"lease",binding:{version:1,product:"codex",region:"global",profileId:"p",backendId:"exec",runnerId:"local",nativeStoreRef:"store",nativeSessionId:"native",executionRefId:"execution",identityState:"bound"}});store.initializeControl({sessionId:"session",activeRunId:"run",exclusion:"cooperative",at});const before=store.control("session"),run=old.getEntity("run","run") as Record<string,persistence.JsonValue>;
  try{const upgraded=new persistence.DispatcherDatabase(path);try{expect(upgraded.schemaVersion()).toBe(7);expect(()=>rawOld.prepare("UPDATE canonical_tasks SET revision=revision+1 WHERE id='task'").run()).toThrow("no such function: dispatcher_writer_protocol");expect(()=>rawOld.prepare("UPDATE session_controls SET epoch=epoch+1 WHERE session_id='session'").run()).toThrow("no such function: dispatcher_writer_protocol");expect(()=>old.saveEntity("run","run",{...run,state:"COMPLETE"})).toThrow("DATABASE_WRITER_UNSUPPORTED");expect(upgraded.getCanonicalTask("task")?.revision).toBe(1);expect(new persistence.InteractionStore(upgraded).control("session")).toEqual(before);expect(upgraded.getEntity("run","run")).toMatchObject({state:"ACTIVE"});expect(()=>upgraded.saveEntity("runner","local",{id:"local"})).not.toThrow();}finally{upgraded.close();}}finally{rawOld.close();old.close();}
});
it("rejects an unknown applied migration name without writing to the database",()=>{
  const path=join(root(),"db.sqlite"),db=new persistence.DispatcherDatabase(path);db.handle.prepare("UPDATE schema_migrations SET name='foreign-format' WHERE version=4").run();db.close();const before=readFileSync(path);let opened:persistence.DispatcherDatabase|undefined;
  try{expect(()=>{opened=new persistence.DispatcherDatabase(path);}).toThrowError(expect.objectContaining({code:"DATABASE_SCHEMA_UNSUPPORTED"}));}finally{opened?.close();}expect(readFileSync(path)).toEqual(before);
});
it("online WAL backup preserves snapshot canonical revision, run, session, evidence and pending outbox",async()=>{
  const dir=root(),db=new persistence.DispatcherDatabase(join(dir,"live.sqlite"));seed(db);expect(existsSync(join(dir,"live.sqlite-wal"))).toBe(true);
  try{const manifest=await backupApi()(db.path,join(dir,"backup"));expect(manifest).toMatchObject({version:1,schemaVersion:7,inventory:{tasks:1,runs:1,sessions:1,evidence:1,pendingOutbox:1}});expect(statSync(join(dir,"backup","dispatcher.sqlite")).mode&0o777).toBe(0o600);expect(statSync(join(dir,"backup")).mode&0o777).toBe(0o700);
    db.writeCanonicalTask("task",1,{id:"task",state:"DONE"},at);const plan=restoreApi()(join(dir,"backup"),join(dir,"restored"));expect(plan).toMatchObject({applied:false,reconciliationRequired:true});expect(existsSync(join(dir,"restored"))).toBe(false);
    restoreApi()(join(dir,"backup"),join(dir,"restored"),{execute:true,confirmed:true});const restored=new DatabaseSync(join(dir,"restored","dispatcher.sqlite"),{readOnly:true});try{expect(restored.prepare("SELECT revision FROM canonical_tasks WHERE id='task'").get()).toEqual({revision:1});expect(restored.prepare("SELECT COUNT(*) AS count FROM delivery_evidence").get()).toEqual({count:1});expect(restored.prepare("SELECT status FROM outbox_events WHERE id='projection'").get()).toEqual({status:"PENDING"});}finally{restored.close();}
    expect(()=>new persistence.DispatcherDatabase(join(dir,"restored","dispatcher.sqlite"))).toThrowError(expect.objectContaining({code:"RESTORE_RECONCILIATION_REQUIRED"}));
  }finally{db.close();}
});
it("backup uses SQLite consistency while another connection commits paired changes",async()=>{
  const dir=root(),db=new persistence.DispatcherDatabase(join(dir,"live.sqlite"));for(let n=0;n<100;n++)db.saveEntity("padding",String(n),{text:"x".repeat(32_000)});seed(db);const writer=new persistence.DispatcherDatabase(db.path);
  try{const promise=backupApi()(db.path,join(dir,"backup"));try{writer.transaction(()=>{writer.writeCanonicalTask("task",1,{id:"task",state:"DONE"},at);writer.saveEntity("run","run",{...writer.getEntity("run","run") as Record<string,persistence.JsonValue>,state:"COMPLETE"});});}finally{await promise;}
    const snapshot=new DatabaseSync(join(dir,"backup","dispatcher.sqlite"),{readOnly:true});try{const task=snapshot.prepare("SELECT document_json FROM canonical_tasks WHERE id='task'").get() as {document_json:string};const run=snapshot.prepare("SELECT document_json FROM entities WHERE kind='run' AND id='run'").get() as {document_json:string};expect([["RUNNING","ACTIVE"],["DONE","COMPLETE"]]).toContainEqual([JSON.parse(task.document_json).state,JSON.parse(run.document_json).state]);}finally{snapshot.close();}
  }finally{writer.close();db.close();}
});
it("restore requires explicit confirmation and refuses any existing target, preserving its bytes",async()=>{
  const dir=root(),db=new persistence.DispatcherDatabase(join(dir,"live.sqlite"));db.close();await backupApi()(join(dir,"live.sqlite"),join(dir,"backup"));
  expect(()=>restoreApi()(join(dir,"backup"),join(dir,"restored"),{execute:true})).toThrowError(expect.objectContaining({code:"RESTORE_CONFIRMATION_REQUIRED"}));writeFileSync(join(dir,"occupied"),"preserve");expect(()=>restoreApi()(join(dir,"backup"),join(dir,"occupied"),{execute:true,confirmed:true})).toThrow();expect(readFileSync(join(dir,"occupied"),"utf8")).toBe("preserve");
});
it("rejects tampered or unknown backup manifest and snapshot before creating a target",async()=>{
  const dir=root(),db=new persistence.DispatcherDatabase(join(dir,"live.sqlite"));db.close();await backupApi()(join(dir,"live.sqlite"),join(dir,"backup"));const path=join(dir,"backup","manifest.json"),original=readFileSync(path,"utf8");writeFileSync(path,JSON.stringify({...JSON.parse(original),unexpected:true}));expect(()=>restoreApi()(join(dir,"backup"),join(dir,"restored"),{execute:true,confirmed:true})).toThrow();writeFileSync(path,original);writeFileSync(join(dir,"backup","dispatcher.sqlite"),"corrupted");expect(()=>restoreApi()(join(dir,"backup"),join(dir,"restored"),{execute:true,confirmed:true})).toThrow();expect(existsSync(join(dir,"restored"))).toBe(false);
});
it("does not create a missing source or overwrite an existing backup destination",async()=>{
  const dir=root();await expect(backupApi()(join(dir,"missing"),join(dir,"backup"))).rejects.toThrow();expect(existsSync(join(dir,"missing"))).toBe(false);const db=new persistence.DispatcherDatabase(join(dir,"live.sqlite"));db.close();await backupApi()(join(dir,"live.sqlite"),join(dir,"backup"));const bytes=readFileSync(join(dir,"backup","dispatcher.sqlite"));await expect(backupApi()(join(dir,"live.sqlite"),join(dir,"backup"))).rejects.toThrow();expect(readFileSync(join(dir,"backup","dispatcher.sqlite"))).toEqual(bytes);
});
it("rejects snapshot/source symlinks and never follows a linked restore target",async()=>{
  const dir=root(),db=new persistence.DispatcherDatabase(join(dir,"live.sqlite"));db.close();symlinkSync(join(dir,"live.sqlite"),join(dir,"source-link"));await expect(backupApi()(join(dir,"source-link"),join(dir,"backup"))).rejects.toThrow();await backupApi()(join(dir,"live.sqlite"),join(dir,"backup"));symlinkSync(join(dir,"backup"),join(dir,"target-link"));expect(()=>restoreApi()(join(dir,"backup"),join(dir,"target-link"),{execute:true,confirmed:true})).toThrow();rmSync(join(dir,"backup","dispatcher.sqlite"));symlinkSync(join(dir,"live.sqlite"),join(dir,"backup","dispatcher.sqlite"));expect(()=>restoreApi()(join(dir,"backup"),join(dir,"restored"))).toThrow();
});
it("backup archives cannot be used as a live Controller database",async()=>{
  const dir=root(),db=new persistence.DispatcherDatabase(join(dir,"live.sqlite"));seed(db);db.close();await backupApi()(join(dir,"live.sqlite"),join(dir,"backup"));let live:persistence.DispatcherDatabase|undefined;
  try{expect(()=>{live=new persistence.DispatcherDatabase(join(dir,"backup","dispatcher.sqlite"));}).toThrowError(expect.objectContaining({code:"DATABASE_ARCHIVE_READ_ONLY"}));}finally{live?.close();}
});
it("a crashed restore marker blocks startup even before the final database exists",()=>{
  const dir=root(),target=join(dir,"restored");mkdirSync(target);writeFileSync(join(target,"dispatcher.sqlite.restore-pending"),'{"version":1}');let db:persistence.DispatcherDatabase|undefined;
  try{expect(()=>{db=new persistence.DispatcherDatabase(join(target,"dispatcher.sqlite"));}).toThrowError(expect.objectContaining({code:"RESTORE_RECONCILIATION_REQUIRED"}));}finally{db?.close();}expect(existsSync(join(target,"dispatcher.sqlite"))).toBe(false);
});
it.each(["symlink","hardlink","copy"] as const)("a %s alias cannot open or mutate an archived snapshot",async kind=>{
  const dir=root(),db=new persistence.DispatcherDatabase(join(dir,"live.sqlite"));seed(db);db.close();await backupApi()(join(dir,"live.sqlite"),join(dir,"backup"));const source=join(dir,"backup","dispatcher.sqlite"),before=readFileSync(source),aliasDir=join(dir,"alias");mkdirSync(aliasDir);const alias=join(aliasDir,"dispatcher.sqlite");if(kind==="symlink")symlinkSync(source,alias);else if(kind==="hardlink")linkSync(source,alias);else copyFileSync(source,alias);let opened:persistence.DispatcherDatabase|undefined;
  try{expect(()=>{opened=new persistence.DispatcherDatabase(alias);}).toThrow();}finally{opened?.close();}expect(readFileSync(source)).toEqual(before);expect(readFileSync(alias)).toEqual(before);
});
it("rejects uncovered SQLite sidecars before inspecting or restoring a backup",async()=>{
  const dir=root(),db=new persistence.DispatcherDatabase(join(dir,"live.sqlite"));db.close();await backupApi()(join(dir,"live.sqlite"),join(dir,"backup"));writeFileSync(join(dir,"backup","dispatcher.sqlite-wal"),"uncovered WAL");expect(()=>restoreApi()(join(dir,"backup"),join(dir,"restored"),{execute:true,confirmed:true})).toThrowError(expect.objectContaining({code:"BACKUP_SIDECAR_UNSUPPORTED"}));expect(existsSync(join(dir,"restored"))).toBe(false);
});
