import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { DispatcherDatabase, MigrationError, migrations } from "../src/index.js";

it("retains v3 atomic insert-if-absent semantics alongside native persistence",()=>{
  const db=new DispatcherDatabase(":memory:");
  try {
    expect(db.createEntityIfAbsent("receipt","same",{value:"first"})).toBe(true);
    expect(db.createEntityIfAbsent("receipt","same",{value:"second"})).toBe(false);
    expect(db.getEntity("receipt","same")).toEqual({value:"first"});
  } finally {db.close();}
});

it("refuses an old binary and a connection without the required writer function",()=>{
  const root=mkdtempSync(join(tmpdir(),"dispatcher-writer-protocol-"));
  const path=join(root,"db.sqlite");
  try {
    const db=new DispatcherDatabase(path);db.close();
    expect(()=>new DispatcherDatabase(path,migrations.filter(m=>m.version<4))).toThrowError(expect.objectContaining({code:"DATABASE_SCHEMA_UNSUPPORTED"}));
    const old=new DatabaseSync(path);
    try {
      const write=()=>old.prepare("INSERT INTO entities(kind,id,document_json,updated_at) VALUES('run','foreign','{}','now')").run();
      expect(write).toThrow(/dispatcher_writer_protocol/);
      old.function("dispatcher_writer_protocol",()=>0);
      expect(write).toThrow(/DATABASE_WRITER_UNSUPPORTED/);
      expect(old.prepare("SELECT id FROM entities WHERE id='foreign'").all()).toHaveLength(0);
    } finally {old.close();}
  } finally {rmSync(root,{recursive:true,force:true});}
});

it("fences an already-open personal-local protocol-1 writer after v3 convergence",()=>{
  const root=mkdtempSync(join(tmpdir(),"dispatcher-v3-writer-"));const path=join(root,"db.sqlite");
  try {
    const v5=migrations.filter(m=>m.version<=5);
    const original=new DispatcherDatabase(path,v5);original.saveEntity("receipt","kept",{id:"kept"});original.close();
    const legacy=new DatabaseSync(path);legacy.function("dispatcher_writer_protocol",()=>1);
    try {
      const current=new DispatcherDatabase(path);current.close();
      expect(()=>legacy.prepare("UPDATE entities SET document_json='{}' WHERE id='kept'").run()).toThrow(/DATABASE_WRITER_UNSUPPORTED/);
      expect(()=>new DispatcherDatabase(path,v5)).toThrowError(expect.objectContaining({code:"DATABASE_SCHEMA_UNSUPPORTED"}));
    } finally {legacy.close();}
    const verified=new DispatcherDatabase(path);
    try {expect(verified.getEntity("receipt","kept")).toEqual({id:"kept"});}finally{verified.close();}
  } finally {rmSync(root,{recursive:true,force:true});}
});

it("rolls back the convergence writer upgrade and keeps the previous connection writable",()=>{
  const db=new DispatcherDatabase(":memory:",migrations.filter(m=>m.version<=5));
  try {
    const convergence=migrations.find(m=>m.version===6);
    expect(convergence).toBeDefined();
    expect(()=>db.migrate([...migrations.filter(m=>m.version<=5),{...convergence!,afterApply:database=>{
      convergence!.afterApply?.(database);
      database.saveEntity("receipt","temporary",{id:"temporary"});
      throw new Error("interrupted writer upgrade");
    }}])).toThrow(MigrationError);
    expect(db.schemaVersion()).toBe(5);
    expect(db.getEntity("receipt","temporary")).toBeUndefined();
    expect(()=>db.saveEntity("receipt","old-writer",{id:"old-writer"})).not.toThrow();
    db.migrate();
    expect(db.schemaVersion()).toBe(11);
    expect(db.getEntity("receipt","old-writer")).toEqual({id:"old-writer"});
  } finally {db.close();}
});

it("restores connection writer state when an outer transaction rolls back a successful migration",()=>{
  const db=new DispatcherDatabase(":memory:",migrations.filter(m=>m.version<=5));
  try {
    expect(()=>db.transaction(()=>{db.migrate();throw new Error("outer rollback");})).toThrow("outer rollback");
    expect(db.schemaVersion()).toBe(5);
    expect(()=>db.saveEntity("receipt","after-rollback",{id:"after-rollback"})).not.toThrow();
    db.migrate();
    expect(db.schemaVersion()).toBe(11);
  } finally {db.close();}
});
