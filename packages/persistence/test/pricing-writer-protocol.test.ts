import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {expect,it} from "vitest";
import {createDispatcherBackup,restoreDispatcherBackup,inspectDispatcherDatabase,DispatcherDatabase,MigrationError,migrations,databaseWriterProtocol} from "../src/index.js";
const previous=migrations.filter(m=>m.version<=10);
const gates=(db:DispatcherDatabase)=>db.handle.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND name GLOB 'writer_gate_*' ORDER BY name").all();
it("rejects already-open writer six before it can acknowledge a priced startup without price revalidation",()=>{
 const root=mkdtempSync(join(tmpdir(),"dispatcher-pricing-writer-")),path=join(root,"db.sqlite"),old=new DispatcherDatabase(path,previous),raw=new DatabaseSync(path);raw.function("dispatcher_writer_protocol",()=>6);old.saveEntity("run","priced",{id:"priced",state:"STARTING"});
 try{const current=new DispatcherDatabase(path,migrations.filter(m=>m.version<=11));try{expect(current.schemaVersion()).toBe(11);expect(databaseWriterProtocol(current.handle)).toBe(7);expect(()=>old.saveEntity("run","priced",{id:"priced",state:"ACTIVE"})).toThrow("DATABASE_WRITER_UNSUPPORTED");expect(()=>raw.prepare("UPDATE entities SET document_json=? WHERE kind='run'").run('{"id":"priced","state":"ACTIVE"}')).toThrow("DATABASE_WRITER_UNSUPPORTED");expect(()=>new DispatcherDatabase(path,previous)).toThrowError(expect.objectContaining({code:"DATABASE_SCHEMA_UNSUPPORTED"}));expect(current.getEntity("run","priced")).toEqual({id:"priced",state:"STARTING"});expect(gates(current).every(row=>String(row.sql).includes("dispatcher_writer_protocol() != 7"))).toBe(true);}finally{current.close();}}finally{raw.close();old.close();rmSync(root,{recursive:true,force:true});}
});
it("restores schema ten gate SQL and connection protocol after inner and outer migration failures",()=>{
 const db=new DispatcherDatabase(":memory:",previous);try{const before=gates(db),step=migrations.find(m=>m.version===11);expect(step).toBeDefined();expect(()=>db.migrate([...previous,{...step!,afterApply:database=>{step!.afterApply?.(database);throw Error("interrupted price gate");}}])).toThrow(MigrationError);expect(db.schemaVersion()).toBe(10);expect(databaseWriterProtocol(db.handle)).toBe(6);expect(gates(db)).toEqual(before);expect(()=>db.transaction(()=>{db.migrate();throw Error("outer price rollback");})).toThrow("outer price rollback");expect(db.schemaVersion()).toBe(10);expect(databaseWriterProtocol(db.handle)).toBe(6);expect(gates(db)).toEqual(before);expect(()=>db.saveEntity("receipt","old",{id:"old"})).not.toThrow();}finally{db.close();}
});
it("keeps schema ten archive bytes and writer six while only the restored copy upgrades",async()=>{
 const root=mkdtempSync(join(tmpdir(),"dispatcher-pricing-backup-")),path=join(root,"source.sqlite"),db=new DispatcherDatabase(path,previous);db.saveEntity("evidence","kept",{id:"kept"});db.close();
 try{const before=readFileSync(path),manifest=await createDispatcherBackup(path,join(root,"backup"));expect(manifest.schemaVersion).toBe(10);const archive=join(root,"backup","dispatcher.sqlite"),bytes=readFileSync(archive),snapshot=new DatabaseSync(archive,{readOnly:true});try{expect(databaseWriterProtocol(snapshot)).toBe(6);}finally{snapshot.close();}restoreDispatcherBackup(join(root,"backup"),join(root,"restored"),{execute:true,confirmed:true});expect(inspectDispatcherDatabase(join(root,"restored","dispatcher.sqlite"))).toMatchObject({schemaVersion:18,integrity:true,reconciliationRequired:true});expect(readFileSync(archive)).toEqual(bytes);expect(readFileSync(path)).toEqual(before);}finally{rmSync(root,{recursive:true,force:true});}
});
