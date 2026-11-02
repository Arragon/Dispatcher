import {mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {expect,it} from "vitest";
import {DispatcherDatabase,RhizaAdmissionStore,RhizaObservationStore,migrations,databaseWriterProtocol,MigrationError} from "../src/index.js";
function accept(db:DispatcherDatabase){
 return new RhizaAdmissionStore(db).accept({clientId:"client-a",commandScope:"jobs.submit",requestId:"request-a"},"a".repeat(64),()=>{
  db.writeCanonicalTask("task-a",0,{id:"task-a",state:"READY"});db.saveEntity("rhiza-job","job-a",{version:1,jobId:"job-a",taskId:"task-a",dispatch:{state:"pending"}});db.saveEntity("task-rhiza-binding","task-a",{jobId:"job-a"});
  return {jobId:"job-a",taskId:"task-a",repositoryId:"repo-a",profileId:"profile-a",authorityId:"rhiza-a",receipt:{state:"accepted"}};
 });
}
it("commits business revision and durable notification atomically with canonical writes",()=>{
 const db=new DispatcherDatabase(":memory:");try{
  accept(db);const store=new RhizaObservationStore(db),head=store.head("job-a")!;expect(head.revision).toBe(1);expect(store.events("job-a",0)).toMatchObject([{jobId:"job-a",revision:1,type:"job.changed",schemaVersion:"1"}]);
  expect(()=>db.transaction(()=>{db.writeCanonicalTask("task-a",1,{id:"task-a",state:"RUNNING",currentRunId:"run-a"});throw Error("rollback source and event");})).toThrow();
  expect(store.head("job-a")).toEqual(head);expect(store.events("job-a",0)).toHaveLength(1);expect(db.getCanonicalTask("task-a")?.revision).toBe(1);
  db.transaction(()=>{db.saveEntity("run","run-a",{id:"run-a",taskId:"task-a",sessionId:"session-a",state:"ACTIVE",generation:1,leaseId:"lease-a"});db.writeCanonicalTask("task-a",1,{id:"task-a",state:"RUNNING",currentRunId:"run-a"});});
  const after=store.head("job-a")!;expect(after.revision).toBeGreaterThan(head.revision);const events=store.events("job-a",head.revision);expect(events.at(-1)?.revision).toBe(after.revision);
  const beforeTelemetry=after.revision;db.saveEntity("run","run-a",{id:"run-a",taskId:"task-a",sessionId:"session-a",state:"ACTIVE",generation:1,leaseId:"lease-a",tokens:{input:100},activitySummary:"private output",lastActivityAt:new Date().toISOString()});expect(store.head("job-a")?.revision).toBe(beforeTelemetry);
  db.saveEntity("run","run-a",{id:"run-a",taskId:"task-a",sessionId:"session-a",state:"WAITING_USER",generation:1,leaseId:"lease-a"});expect(store.head("job-a")?.revision).toBe(beforeTelemetry+1);expect(JSON.stringify(store.events("job-a",0))).not.toContain("private output");
 }finally{db.close();}
});
it("does not notify unrelated jobs or an obsolete Run",()=>{
 const db=new DispatcherDatabase(":memory:");try{accept(db);const store=new RhizaObservationStore(db),head=store.head("job-a");
  db.saveEntity("run","foreign",{taskId:"other",state:"ACTIVE"});db.saveEntity("adapter-session","foreign",{state:"RUNNING"});db.saveEntity("run","obsolete",{taskId:"task-a",state:"FAILED"});expect(store.head("job-a")).toEqual(head);
 }finally{db.close();}
});
it("retains cursor identity, replay and expiry semantics across restart without issuing unlimited unchanged cursors",()=>{
 const dir=mkdtempSync(join(tmpdir(),"rhiza-events-")),path=join(dir,"db.sqlite"),db=new DispatcherDatabase(path),at=new Date("2026-10-23T10:00:00.000Z");let cursor="";
 try{accept(db);const store=new RhizaObservationStore(db);cursor=store.cursor({clientId:"client-a",jobId:"job-a",authorizationHash:"auth-a",revision:1},at);
  expect(store.cursor({clientId:"client-a",jobId:"job-a",authorizationHash:"auth-a",revision:1},at)).toBe(cursor);expect(store.resume(cursor,"client-a","auth-a",at)).toMatchObject({jobId:"job-a",revision:1});
  expect(()=>store.resume(cursor,"client-b","auth-a",at)).toThrow("CURSOR_EXPIRED");expect(()=>store.resume(cursor,"client-a","auth-b",at)).toThrow("CURSOR_EXPIRED");
 }finally{db.close();}
 const reopened=new DispatcherDatabase(path);try{const store=new RhizaObservationStore(reopened);expect(store.resume(cursor,"client-a","auth-a",at).revision).toBe(1);expect(()=>store.resume(cursor,"client-a","auth-a",new Date(at.getTime()+86400001))).toThrow("CURSOR_EXPIRED");
 }finally{reopened.close();rmSync(dir,{recursive:true,force:true});}
});
it("keeps event IDs and revisions immutable even through replacement keys",()=>{
 const db=new DispatcherDatabase(":memory:");try{accept(db);const store=new RhizaObservationStore(db),event=store.events("job-a",0)[0]!;
  expect(()=>db.handle.exec("UPDATE rhiza_job_events SET revision=revision+1")).toThrow("RHIZA_EVENT_IMMUTABLE");expect(()=>db.handle.exec("DELETE FROM rhiza_job_events")).toThrow("RHIZA_EVENT_IMMUTABLE");expect(()=>db.handle.exec("INSERT OR REPLACE INTO rhiza_job_events SELECT * FROM rhiza_job_events")).toThrow("RHIZA_EVENT_IMMUTABLE");
  expect(()=>db.handle.exec("INSERT OR REPLACE INTO rhiza_job_events SELECT job_id,revision+1,event_id,committed_at FROM rhiza_job_events")).toThrow("RHIZA_EVENT_IMMUTABLE");expect(store.events("job-a",0)).toEqual([event]);
 }finally{db.close();}
});
it("cannot reset or delete a job revision through a current-writer replacement",()=>{
 const db=new DispatcherDatabase(":memory:");try{accept(db);const store=new RhizaObservationStore(db),head=store.head("job-a");
  expect(()=>db.handle.exec("INSERT OR REPLACE INTO rhiza_job_revisions SELECT * FROM rhiza_job_revisions")).toThrow("RHIZA_REVISION_CONFLICT");
  expect(()=>db.handle.exec("DELETE FROM rhiza_job_revisions")).toThrow("RHIZA_REVISION_CONFLICT");expect(store.head("job-a")).toEqual(head);
 }finally{db.close();}
});
it("fences already-open writers before installing durable observations and backfills prior acceptances",()=>{
 const dir=mkdtempSync(join(tmpdir(),"rhiza-observation-writer-")),path=join(dir,"db.sqlite"),previous=migrations.filter(m=>m.version<=14),old=new DispatcherDatabase(path,previous);
 try{accept(old);const current=new DispatcherDatabase(path);try{
  expect(current.schemaVersion()).toBe(19);expect(databaseWriterProtocol(current.handle)).toBe(15);expect(new RhizaObservationStore(current).head("job-a")?.revision).toBe(1);
  expect(()=>old.saveEntity("fixture","unsafe-writer",{})).toThrow("DATABASE_WRITER_UNSUPPORTED");expect(()=>new DispatcherDatabase(path,previous)).toThrowError(expect.objectContaining({code:"DATABASE_SCHEMA_UNSUPPORTED"}));
 }finally{current.close();}}finally{old.close();rmSync(dir,{recursive:true,force:true});}
});
it("rolls back notification triggers, backfill and connection protocol if migration is interrupted",()=>{
 const previous=migrations.filter(m=>m.version<=14),db=new DispatcherDatabase(":memory:",previous),upgrade=migrations.find(m=>m.version===15)!;
 try{accept(db);const before=db.handle.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name").all();
  expect(()=>db.migrate([...previous,{...upgrade,afterApply:database=>{upgrade.afterApply?.(database);throw Error("observation interruption");}}])).toThrow(MigrationError);
  expect(db.schemaVersion()).toBe(14);expect(databaseWriterProtocol(db.handle)).toBe(10);expect(db.handle.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name").all()).toEqual(before);expect(db.handle.prepare("SELECT name FROM sqlite_schema WHERE name='rhiza_job_events'").get()).toBeUndefined();expect(()=>db.saveEntity("fixture","prior-writer-safe",{})).not.toThrow();
 }finally{db.close();}
});
