import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {expect,it} from "vitest";
import {createDispatcherBackup,restoreDispatcherBackup,inspectDispatcherDatabase,DispatcherDatabase,MigrationError,migrations} from "../src/index.js";
import {databaseWriterProtocol} from "../src/database-compatibility.js";
const previous=migrations.filter(m=>m.version<=7);
const gates=(db:DispatcherDatabase)=>db.handle.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND name GLOB 'writer_gate_*' ORDER BY name").all();
it("rejects already-open protocol-three writers after guarded startup activation",()=>{
 const root=mkdtempSync(join(tmpdir(),"dispatcher-start-writer-")),path=join(root,"db.sqlite"),old=new DispatcherDatabase(path,previous),raw=new DatabaseSync(path);raw.function("dispatcher_writer_protocol",()=>3);old.saveEntity("receipt","kept",{id:"kept"});
 try{const current=new DispatcherDatabase(path);try{expect(current.schemaVersion()).toBe(19);expect(databaseWriterProtocol(current.handle)).toBe(15);expect(()=>old.saveEntity("receipt","kept",{id:"changed"})).toThrow("DATABASE_WRITER_UNSUPPORTED");expect(()=>raw.prepare("DELETE FROM entities WHERE kind='receipt'").run()).toThrow("DATABASE_WRITER_UNSUPPORTED");expect(()=>new DispatcherDatabase(path,previous)).toThrowError(expect.objectContaining({code:"DATABASE_SCHEMA_UNSUPPORTED"}));expect(current.getEntity("receipt","kept")).toEqual({id:"kept"});expect(()=>current.saveEntity("receipt","current",{id:"current"})).not.toThrow();expect(gates(current).every(row=>String(row.sql).includes("dispatcher_writer_protocol() != 15"))).toBe(true);}finally{current.close();}}finally{raw.close();old.close();rmSync(root,{recursive:true,force:true});}
});
it("restores schema-seven trigger SQL and connection protocol after interrupted startup upgrade",()=>{
 const db=new DispatcherDatabase(":memory:",previous);try{const before=gates(db),start=migrations.find(m=>m.version===8);expect(start).toBeDefined();expect(()=>db.migrate([...previous,{...start!,afterApply:database=>{start!.afterApply?.(database);database.saveEntity("receipt","temporary",{id:"temporary"});throw Error("interrupted start gate");}}])).toThrow(MigrationError);expect(db.schemaVersion()).toBe(7);expect(databaseWriterProtocol(db.handle)).toBe(3);expect(gates(db)).toEqual(before);expect(db.getEntity("receipt","temporary")).toBeUndefined();expect(()=>db.saveEntity("receipt","previous",{id:"previous"})).not.toThrow();db.migrate();expect(db.schemaVersion()).toBe(19);expect(db.getEntity("receipt","previous")).toEqual({id:"previous"});}finally{db.close();}
});
it("restores protocol three when an outer transaction rolls back a guarded startup upgrade",()=>{
 const db=new DispatcherDatabase(":memory:",previous);try{const before=gates(db);expect(()=>db.transaction(()=>{db.migrate();throw Error("outer startup rollback");})).toThrow("outer startup rollback");expect(db.schemaVersion()).toBe(7);expect(gates(db)).toEqual(before);expect(()=>db.saveEntity("receipt","previous",{id:"previous"})).not.toThrow();db.migrate();expect(db.schemaVersion()).toBe(19);}finally{db.close();}
});
it("backs up schema seven with protocol three and upgrades only its restored copy",async()=>{
 const root=mkdtempSync(join(tmpdir(),"dispatcher-start-backup-")),path=join(root,"live.sqlite"),db=new DispatcherDatabase(path,previous);db.saveEntity("receipt","kept",{id:"kept"});db.close();
 try{const before=readFileSync(path),manifest=await createDispatcherBackup(path,join(root,"backup"));expect(manifest.schemaVersion).toBe(7);expect(readFileSync(path)).toEqual(before);const archive=join(root,"backup","dispatcher.sqlite"),snapshot=new DatabaseSync(archive,{readOnly:true});try{expect(databaseWriterProtocol(snapshot)).toBe(3);}finally{snapshot.close();}const archiveBytes=readFileSync(archive);restoreDispatcherBackup(join(root,"backup"),join(root,"restored"),{execute:true,confirmed:true});expect(inspectDispatcherDatabase(join(root,"restored","dispatcher.sqlite"))).toMatchObject({schemaVersion:19,integrity:true,reconciliationRequired:true});expect(()=>new DispatcherDatabase(join(root,"restored","dispatcher.sqlite"))).toThrowError(expect.objectContaining({code:"RESTORE_RECONCILIATION_REQUIRED"}));expect(readFileSync(archive)).toEqual(archiveBytes);expect(readFileSync(path)).toEqual(before);}finally{rmSync(root,{recursive:true,force:true});}
});
