import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {expect,it} from "vitest";
import {DispatcherDatabase,RhizaAdmissionStore,RhizaObservationStore,InteractionStore,migrations,MigrationError,databaseWriterProtocol} from "../src/index.js";
it("notifies intervention control changes atomically without changing the canonical Task",()=>{
 const db=new DispatcherDatabase(":memory:");try{
  db.writeCanonicalTask("t",0,{id:"t",state:"WAITING_USER",currentRunId:"r"});db.saveEntity("run","r",{id:"r",taskId:"t",profileId:"p",sessionId:"s",state:"WAITING_USER"});db.saveEntity("session","s",{id:"s",profileId:"p"});new RhizaAdmissionStore(db).accept({clientId:"c",commandScope:"jobs.submit",requestId:"r"},"a".repeat(64),()=>({jobId:"j",taskId:"t",repositoryId:"repo",profileId:"p",authorityId:"a",receipt:{state:"accepted"}}));const events=new RhizaObservationStore(db),before=events.head("j")!.revision;
  new InteractionStore(db).initializeControl({sessionId:"s",activeRunId:"r",exclusion:"none",at:"2026-10-23T10:00:00.000Z"});expect(events.head("j")!.revision).toBe(before+1);const update=()=>db.handle.exec("UPDATE session_controls SET revision=revision+1,document_json=json_set(document_json,'$.revision',revision+1) WHERE session_id='s'");
  expect(()=>db.transaction(()=>{update();throw Error("rollback control");})).toThrow();expect(events.head("j")!.revision).toBe(before+1);update();expect(events.head("j")!.revision).toBe(before+2);expect(db.getCanonicalTask("t")!.revision).toBe(1);
 }finally{db.close();}
});
it("fences writers that predate external input reservation and restores their gate on interrupted migration",()=>{
 const root=mkdtempSync(join(tmpdir(),"rhiza-input-writer-")),path=join(root,"db"),previous=migrations.filter(m=>m.version<=16),old=new DispatcherDatabase(path,previous);try{
  const current=new DispatcherDatabase(path);try{expect(databaseWriterProtocol(current.handle)).toBe(15);expect(()=>old.saveEntity("fixture","unsafe",{})).toThrow("DATABASE_WRITER_UNSUPPORTED");}finally{current.close();}
 }finally{old.close();rmSync(root,{recursive:true,force:true});}
 const db=new DispatcherDatabase(":memory:",previous),upgrade=migrations.find(m=>m.version===17)!;try{const before=db.handle.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name").all();expect(()=>db.migrate([...previous,{...upgrade,afterApply:database=>{upgrade.afterApply?.(database);throw Error("interrupted input");}}])).toThrow(MigrationError);expect(db.schemaVersion()).toBe(16);expect(databaseWriterProtocol(db.handle)).toBe(12);expect(db.handle.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name").all()).toEqual(before);expect(()=>db.saveEntity("fixture","old-safe",{})).not.toThrow();}finally{db.close();}
});

it("notifies material current-run input receipt changes atomically and ignores old authority and timestamps",()=>{
 const db=new DispatcherDatabase(":memory:");try{
  db.writeCanonicalTask("t",0,{id:"t",state:"WAITING_USER",currentRunId:"r"});db.saveEntity("run","r",{id:"r",taskId:"t",profileId:"p",sessionId:"s",generation:1,state:"WAITING_USER"});
  new RhizaAdmissionStore(db).accept({clientId:"c",commandScope:"jobs.submit",requestId:"submit"},"a".repeat(64),()=>({jobId:"j",taskId:"t",repositoryId:"repo",profileId:"p",authorityId:"a",receipt:{state:"accepted"}}));
  const observations=new RhizaObservationStore(db),before=observations.head("j")!.revision,receipt={actorId:"owner",inputId:"reply",runId:"r",profileId:"p",sessionId:"s",generation:1,authorityHash:"episode",payloadHash:"payload",state:"RESERVED",updatedAt:"first"};
  const save=(value:typeof receipt)=>db.saveEntity("run-input","reply",value);
  expect(()=>db.transaction(()=>{save(receipt);throw Error("rollback input");})).toThrow("rollback input");expect(observations.head("j")!.revision).toBe(before);expect(observations.events("j",before)).toEqual([]);
  save(receipt);expect(observations.head("j")!.revision).toBe(before+1);
  save({...receipt,updatedAt:"timestamp-only"});expect(observations.head("j")!.revision).toBe(before+1);
  save({...receipt,state:"OUTCOME_UNKNOWN"});expect(observations.head("j")!.revision).toBe(before+2);
  save({...receipt,state:"REJECTED"});expect(observations.head("j")!.revision).toBe(before+3);
  save({...receipt,sessionId:"old-session"});expect(observations.head("j")!.revision).toBe(before+4);
  save({...receipt,sessionId:"old-session",generation:0});expect(observations.head("j")!.revision).toBe(before+4);
  save(receipt);expect(observations.head("j")!.revision).toBe(before+5);
  db.handle.prepare("DELETE FROM entities WHERE kind='run-input' AND id='reply'").run();expect(observations.head("j")!.revision).toBe(before+6);expect(observations.events("j",before)).toHaveLength(6);
  db.saveEntity("run-input","old-run",{...receipt,runId:"old-run"});db.saveEntity("run-input","old-generation",{...receipt,generation:0});expect(observations.head("j")!.revision).toBe(before+6);
 }finally{db.close();}
});
