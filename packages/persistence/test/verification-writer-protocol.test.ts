import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {expect,it} from "vitest";
import {createDispatcherBackup,restoreDispatcherBackup,inspectDispatcherDatabase,DispatcherDatabase,MigrationError,migrations} from "../src/index.js";
import {databaseWriterProtocol} from "../src/database-compatibility.js";
const previous=migrations.filter(m=>m.version<=8);
const gates=(db:DispatcherDatabase)=>db.handle.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND name GLOB 'writer_gate_*' ORDER BY name").all();
it("rejects already-open protocol-four writers after automatic verification activation",()=>{
 const root=mkdtempSync(join(tmpdir(),"dispatcher-verification-writer-")),path=join(root,"db.sqlite"),old=new DispatcherDatabase(path,previous),raw=new DatabaseSync(path);raw.function("dispatcher_writer_protocol",()=>4);old.saveEntity("receipt","kept",{id:"kept"});
 try{const current=new DispatcherDatabase(path);try{expect(current.schemaVersion()).toBe(11);expect(databaseWriterProtocol(current.handle)).toBe(7);expect(()=>old.saveEntity("receipt","kept",{id:"changed"})).toThrow("DATABASE_WRITER_UNSUPPORTED");expect(()=>raw.prepare("DELETE FROM entities WHERE kind='receipt'").run()).toThrow("DATABASE_WRITER_UNSUPPORTED");expect(()=>new DispatcherDatabase(path,previous)).toThrowError(expect.objectContaining({code:"DATABASE_SCHEMA_UNSUPPORTED"}));expect(current.getEntity("receipt","kept")).toEqual({id:"kept"});expect(()=>current.saveEntity("receipt","current",{id:"current"})).not.toThrow();expect(gates(current).every(row=>String(row.sql).includes("dispatcher_writer_protocol() != 7"))).toBe(true);}finally{current.close();}}finally{raw.close();old.close();rmSync(root,{recursive:true,force:true});}
});
it("restores schema-eight trigger SQL and connection protocol after interrupted verification upgrade",()=>{
 const db=new DispatcherDatabase(":memory:",previous);try{const before=gates(db),start=migrations.find(m=>m.version===9);expect(start).toBeDefined();expect(()=>db.migrate([...previous,{...start!,afterApply:database=>{start!.afterApply?.(database);database.saveEntity("receipt","temporary",{id:"temporary"});throw Error("interrupted verification gate");}}])).toThrow(MigrationError);expect(db.schemaVersion()).toBe(8);expect(databaseWriterProtocol(db.handle)).toBe(4);expect(gates(db)).toEqual(before);expect(db.getEntity("receipt","temporary")).toBeUndefined();expect(()=>db.saveEntity("receipt","previous",{id:"previous"})).not.toThrow();db.migrate();expect(db.schemaVersion()).toBe(11);expect(db.getEntity("receipt","previous")).toEqual({id:"previous"});}finally{db.close();}
});
it("restores protocol four when an outer transaction rolls back an automatic verification upgrade",()=>{
 const db=new DispatcherDatabase(":memory:",previous);try{const before=gates(db);expect(()=>db.transaction(()=>{db.migrate();throw Error("outer verification rollback");})).toThrow("outer verification rollback");expect(db.schemaVersion()).toBe(8);expect(gates(db)).toEqual(before);expect(()=>db.saveEntity("receipt","previous",{id:"previous"})).not.toThrow();db.migrate();expect(db.schemaVersion()).toBe(11);}finally{db.close();}
});
it("backs up schema eight with protocol four and upgrades only its restored copy",async()=>{
 const root=mkdtempSync(join(tmpdir(),"dispatcher-verification-backup-")),path=join(root,"live.sqlite"),db=new DispatcherDatabase(path,previous);db.saveEntity("receipt","kept",{id:"kept"});db.close();
 try{const before=readFileSync(path),manifest=await createDispatcherBackup(path,join(root,"backup"));expect(manifest.schemaVersion).toBe(8);expect(readFileSync(path)).toEqual(before);const archive=join(root,"backup","dispatcher.sqlite"),snapshot=new DatabaseSync(archive,{readOnly:true});try{expect(databaseWriterProtocol(snapshot)).toBe(4);}finally{snapshot.close();}const archiveBytes=readFileSync(archive);restoreDispatcherBackup(join(root,"backup"),join(root,"restored"),{execute:true,confirmed:true});expect(inspectDispatcherDatabase(join(root,"restored","dispatcher.sqlite"))).toMatchObject({schemaVersion:11,integrity:true,reconciliationRequired:true});expect(()=>new DispatcherDatabase(join(root,"restored","dispatcher.sqlite"))).toThrowError(expect.objectContaining({code:"RESTORE_RECONCILIATION_REQUIRED"}));expect(readFileSync(archive)).toEqual(archiveBytes);expect(readFileSync(path)).toEqual(before);}finally{rmSync(root,{recursive:true,force:true});}
});
