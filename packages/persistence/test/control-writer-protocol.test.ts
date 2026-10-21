import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {expect,it} from "vitest";
import {DispatcherDatabase,MigrationError,migrations} from "../src/index.js";

it("rejects an already-open intermediate v3 writer after control-runtime upgrade",()=>{
 const root=mkdtempSync(join(tmpdir(),"dispatcher-control-writer-")),path=join(root,"db.sqlite"),v6=migrations.filter(m=>m.version<=6);
 const old=new DispatcherDatabase(path,v6);old.saveEntity("receipt","kept",{id:"kept"});
 try{
  const current=new DispatcherDatabase(path);
  try{
   expect(current.schemaVersion()).toBe(9);
   expect(()=>old.saveEntity("receipt","kept",{id:"changed"})).toThrow("DATABASE_WRITER_UNSUPPORTED");
   expect(()=>new DispatcherDatabase(path,v6)).toThrowError(expect.objectContaining({code:"DATABASE_SCHEMA_UNSUPPORTED"}));
   expect(current.getEntity("receipt","kept")).toEqual({id:"kept"});
   expect(()=>current.saveEntity("receipt","current",{id:"current"})).not.toThrow();
  }finally{current.close();}
 }finally{old.close();rmSync(root,{recursive:true,force:true});}
});

it("rolls back a failed control writer upgrade with its connection protocol",()=>{
 const db=new DispatcherDatabase(":memory:",migrations.filter(m=>m.version<=6));
 try{
  const control=migrations.find(m=>m.version===7);expect(control).toBeDefined();
  expect(()=>db.migrate([...migrations.filter(m=>m.version<=6),{...control!,afterApply:database=>{
   control!.afterApply?.(database);database.saveEntity("receipt","temporary",{id:"temporary"});throw Error("interrupted control upgrade");
  }}])).toThrow(MigrationError);
  expect(db.schemaVersion()).toBe(6);expect(db.getEntity("receipt","temporary")).toBeUndefined();
  expect(()=>db.saveEntity("receipt","previous",{id:"previous"})).not.toThrow();
  db.migrate();expect(db.schemaVersion()).toBe(9);expect(db.getEntity("receipt","previous")).toEqual({id:"previous"});
 }finally{db.close();}
});

it("restores protocol two after an outer rollback of the control migration",()=>{
 const db=new DispatcherDatabase(":memory:",migrations.filter(m=>m.version<=6));
 try{
  expect(()=>db.transaction(()=>{db.migrate();throw Error("outer rollback");})).toThrow("outer rollback");
  expect(db.schemaVersion()).toBe(6);expect(()=>db.saveEntity("receipt","previous",{id:"previous"})).not.toThrow();
  db.migrate();expect(db.schemaVersion()).toBe(9);
 }finally{db.close();}
});
