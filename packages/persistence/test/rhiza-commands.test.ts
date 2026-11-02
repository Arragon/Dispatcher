import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {expect,it} from "vitest";
import {DispatcherDatabase,RhizaAdmissionStore,RhizaCommandStore,RhizaObservationStore,migrations,MigrationError,databaseWriterProtocol} from "../src/index.js";
function admission(db:DispatcherDatabase){new RhizaAdmissionStore(db).accept({clientId:"c",commandScope:"jobs.submit",requestId:"r"},"a".repeat(64),()=>({jobId:"j",taskId:"t",repositoryId:"repo",profileId:"p",authorityId:"a",receipt:{state:"accepted"}}));}
const command={clientId:"c",scope:"jobs.cancel",requestId:"stop",commandId:"cmd",jobId:"j",semanticsHash:"a".repeat(64),request:{runId:"r"},receipt:{state:"accepted"},fence:{runId:"r"}};
it("commits immutable command/observation notifications atomically and cannot reset stop outcome",()=>{
 const db=new DispatcherDatabase(":memory:");try{admission(db);const store=new RhizaCommandStore(db),events=new RhizaObservationStore(db),revision=events.head("j")!.revision;
  expect(()=>db.transaction(()=>{store.insert(command);throw Error("rollback");})).toThrow();expect(store.hasCancellation("t")).toBe(false);expect(events.head("j")!.revision).toBe(revision);
  store.insert(command);expect(store.get("c","jobs.cancel","stop")).toEqual(command);expect(store.hasCancellation("t")).toBe(true);expect(events.head("j")!.revision).toBe(revision+1);
  for(const sql of ["UPDATE rhiza_commands SET receipt_json='{}'","DELETE FROM rhiza_commands","INSERT OR REPLACE INTO rhiza_commands SELECT * FROM rhiza_commands","INSERT OR REPLACE INTO rhiza_commands SELECT client_id,command_scope,'other',command_id,job_id,semantics_hash,request_json,receipt_json,fence_json FROM rhiza_commands"])expect(()=>db.handle.exec(sql)).toThrow("RHIZA_COMMAND_IMMUTABLE");
  store.observe("cmd","claimed",{},"2026-10-23T10:00:00.000Z");store.observe("cmd","unknown",{code:"STOP_UNCONFIRMED"},"2026-10-23T10:00:01.000Z");expect(()=>store.observe("cmd","confirmed",{},"2026-10-23T10:00:02.000Z")).toThrow("RHIZA_COMMAND_OUTCOME_FINAL");
  for(const sql of ["UPDATE rhiza_command_observations SET state='confirmed'","DELETE FROM rhiza_command_observations","INSERT OR REPLACE INTO rhiza_command_observations SELECT * FROM rhiza_command_observations"])expect(()=>db.handle.exec(sql)).toThrow();
 }finally{db.close();}
});
it("fences prior observation-only writers and preserves uncertain commands across reopen",()=>{
 const directory=mkdtempSync(join(tmpdir(),"rhiza-command-writer-")),path=join(directory,"db"),old=new DispatcherDatabase(path,migrations.filter(m=>m.version<=15));let current:DispatcherDatabase|undefined;
 try{admission(old);current=new DispatcherDatabase(path);expect(databaseWriterProtocol(current.handle)).toBe(14);expect(()=>old.saveEntity("fixture","old",{})).toThrow("DATABASE_WRITER_UNSUPPORTED");const store=new RhizaCommandStore(current);store.insert(command);store.observe("cmd","claimed",{},"2026-10-23T10:00:00.000Z");current.close();current=new DispatcherDatabase(path);expect(new RhizaCommandStore(current).latest("cmd")?.state).toBe("claimed");expect(new RhizaCommandStore(current).get("c","jobs.cancel","stop")).toEqual(command);
 }finally{current?.close();old.close();rmSync(directory,{recursive:true,force:true});}
});
it("rolls back the control writer gate and journals on migration interruption",()=>{
 const previous=migrations.filter(m=>m.version<=15),upgrade=migrations.find(m=>m.version===16)!,db=new DispatcherDatabase(":memory:",previous);
 try{const before=db.handle.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name").all();expect(()=>db.migrate([...previous,{...upgrade,afterApply:database=>{upgrade.afterApply?.(database);throw Error("interrupted control");}}])).toThrow(MigrationError);expect(db.schemaVersion()).toBe(15);expect(databaseWriterProtocol(db.handle)).toBe(11);expect(db.handle.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name").all()).toEqual(before);expect(db.handle.prepare("SELECT name FROM sqlite_schema WHERE name='rhiza_commands'").get()).toBeUndefined();expect(()=>db.saveEntity("fixture","old-safe",{})).not.toThrow();
 }finally{db.close();}
});
