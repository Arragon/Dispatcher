import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {gunzipSync} from "node:zlib";
import {DatabaseSync} from "node:sqlite";
import {afterEach,expect,it} from "vitest";
// Exercise the compiled package consumed by Controller, after the normal build.
import {DispatcherDatabase,databaseWriterProtocol,migrations,restoreDispatcherBackup} from "../dist/index.js";
const fixture=fileURLToPath(new URL("./fixtures/rhiza-private16/",import.meta.url)),provenance=JSON.parse(readFileSync(join(fixture,"provenance.json"),"utf8"));
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const root=()=>{const value=mkdtempSync(join(tmpdir(),"rhiza-baseline-catalog-"));roots.push(value);return value;};
const sha=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
function unpack(name:"database.sqlite.gz"|"archive.sqlite.gz",target:string){const compressed=readFileSync(join(fixture,name));expect(sha(compressed)).toBe(provenance.compressed[name].sha256);const bytes=gunzipSync(compressed,{maxOutputLength:2*1024*1024});writeFileSync(target,bytes,{flag:"wx"});return bytes;}
it("preserves committed native usage/pricing and appends one contiguous reviewed RHIZA catalog",()=>{
 expect(migrations.map(m=>m.version)).toEqual(Array.from({length:18},(_,i)=>i+1));
 expect(migrations.find(m=>m.version===10)?.name).toBe("canonical_usage_origin_writer_protocol");expect(migrations.find(m=>m.version===11)?.name).toBe("frozen_native_pricing_writer_protocol");
 const db=new DispatcherDatabase(":memory:");try{expect(db.schemaVersion()).toBe(18);expect(databaseWriterProtocol(db.handle)).toBe(14);}finally{db.close();}
});
it("upgrades an actual native schema11 while preserving data and fencing its already-open writer7",()=>{
 const path=join(root(),"database.sqlite"),old=new DispatcherDatabase(path,migrations.filter(m=>m.version<=11));try{
  expect(old.schemaVersion()).toBe(11);expect(databaseWriterProtocol(old.handle)).toBe(7);old.saveEntity("fixture","native11",{model:"preserved",usageOrigin:"preserved"});
  const current=new DispatcherDatabase(path);try{expect(current.getEntity("fixture","native11")).toEqual({model:"preserved",usageOrigin:"preserved"});expect(current.schemaVersion()).toBe(18);expect(databaseWriterProtocol(current.handle)).toBe(14);expect(()=>old.saveEntity("fixture","late-old-writer",{})).toThrow("DATABASE_WRITER_UNSUPPORTED");}finally{current.close();}
 }finally{old.close();}
});
it("rejects the genuine old private16 database without changing bytes, ledger or journal",()=>{
 const path=join(root(),"old-private.sqlite"),bytes=unpack("database.sqlite.gz",path);expect(sha(bytes)).toBe(provenance.sourceSha256);
 const inspect=()=>{const db=new DatabaseSync(path,{readOnly:true});try{return {ledger:db.prepare("SELECT version,name FROM schema_migrations ORDER BY version").all(),journal:db.prepare("PRAGMA journal_mode").get()};}finally{db.close();}},before=inspect();expect(before.ledger).toEqual(provenance.ledger);
 expect(()=>new DispatcherDatabase(path)).toThrow(expect.objectContaining({code:"DATABASE_SCHEMA_UNSUPPORTED"}));expect(readFileSync(path)).toEqual(bytes);expect(inspect()).toEqual(before);for(const suffix of ["-wal","-shm","-journal"])expect(existsSync(path+suffix)).toBe(false);
});
it("rejects the genuine private16 archive before creating a restore target and preserves every archive byte",()=>{
 const directory=root(),bundle=join(directory,"archive"),target=join(directory,"must-not-exist");mkdirSync(bundle);const database=join(bundle,"dispatcher.sqlite"),bytes=unpack("archive.sqlite.gz",database);
 const manifest=readFileSync(join(fixture,"archive-manifest.json")),marker=readFileSync(join(fixture,"archive-marker.json"));writeFileSync(join(bundle,"manifest.json"),manifest);writeFileSync(join(bundle,provenance.archiveMarker),marker);expect(sha(bytes)).toBe(provenance.archiveManifest.sha256);
 expect(()=>restoreDispatcherBackup(bundle,target,{execute:true,confirmed:true})).toThrow(expect.objectContaining({code:"DATABASE_SCHEMA_UNSUPPORTED"}));expect(existsSync(target)).toBe(false);expect(readFileSync(database)).toEqual(bytes);expect(readFileSync(join(bundle,"manifest.json"))).toEqual(manifest);expect(readFileSync(join(bundle,provenance.archiveMarker))).toEqual(marker);
});
const steps=[{version:12,priorWriter:7},{version:13,priorWriter:8},{version:14,priorWriter:9},{version:15,priorWriter:10},{version:16,priorWriter:11},{version:17,priorWriter:12},{version:18,priorWriter:13}];
const schemaSql=(db:DispatcherDatabase)=>db.handle.prepare("SELECT type,name,sql FROM sqlite_schema WHERE type IN ('table','index','trigger') ORDER BY type,name").all();
it.each(steps)("restores exact schema/writer after step$version fails and safely reopens/retries its prior catalog",({version,priorWriter})=>{
 const path=join(root(),"partial.sqlite"),prior=migrations.filter(m=>m.version<version),step=migrations.find(m=>m.version===version)!,db=new DispatcherDatabase(path,prior);
 try{const before=schemaSql(db);expect(()=>db.migrate([...prior,{...step,afterApply:database=>{step.afterApply?.(database);database.saveEntity("migration-fixture","transient",{step:version});throw Error("injected aligned migration");}}])).toThrow(expect.objectContaining({cause:expect.objectContaining({message:"injected aligned migration"})}));
  expect(db.schemaVersion()).toBe(version-1);expect(databaseWriterProtocol(db.handle)).toBe(priorWriter);expect(schemaSql(db)).toEqual(before);expect(db.getEntity("migration-fixture","transient")).toBeUndefined();expect(()=>db.saveEntity("migration-fixture","prior-safe",{step:version})).not.toThrow();
 }finally{db.close();}
 const reopened=new DispatcherDatabase(path);try{expect(reopened.schemaVersion()).toBe(18);expect(databaseWriterProtocol(reopened.handle)).toBe(14);expect(reopened.getEntity("migration-fixture","prior-safe")).toEqual({step:version});expect(reopened.integrityCheck()).toBe(true);}finally{reopened.close();}
});
it("retains successful prior steps on default failure while an explicit outer transaction rolls back the entire upgrade",()=>{
 const prior=migrations.filter(m=>m.version<=11),final=migrations.find(m=>m.version===18)!,broken=[...migrations.filter(m=>m.version<18),{...final,afterApply:database=>{final.afterApply?.(database);throw Error("final aligned step");}}];
 const partial=new DispatcherDatabase(":memory:",prior);try{expect(()=>partial.migrate(broken)).toThrow();expect(partial.schemaVersion()).toBe(17);expect(databaseWriterProtocol(partial.handle)).toBe(13);expect(partial.handle.prepare("SELECT name FROM sqlite_schema WHERE name='rhiza_commands'").get()).toBeDefined();expect(partial.handle.prepare("SELECT name FROM sqlite_schema WHERE name='native_turn_completions'").get()).toBeUndefined();partial.migrate();expect(partial.schemaVersion()).toBe(18);expect(databaseWriterProtocol(partial.handle)).toBe(14);}finally{partial.close();}
 const atomic=new DispatcherDatabase(":memory:",prior);try{const before=schemaSql(atomic);expect(()=>atomic.transaction(()=>atomic.migrate(broken))).toThrow();expect(atomic.schemaVersion()).toBe(11);expect(databaseWriterProtocol(atomic.handle)).toBe(7);expect(schemaSql(atomic)).toEqual(before);expect(()=>atomic.saveEntity("migration-fixture","still-native11",{})).not.toThrow();atomic.migrate();expect(atomic.schemaVersion()).toBe(18);}finally{atomic.close();}
});
