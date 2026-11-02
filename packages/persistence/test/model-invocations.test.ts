import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {expect,it} from "vitest";
import {DispatcherDatabase,migrations,ModelInvocationStore,databaseWriterProtocol,createDispatcherBackup,restoreDispatcherBackup} from "../src/index.js";
import {DatabaseSync} from "node:sqlite";
import type {NativeModelInvocation} from "@dispatcher/domain";
const record:NativeModelInvocation={version:1,id:"turn-a",sessionId:"session-a",runId:"run-a",profileId:"p",backendId:"codex-exec-json",kind:"start",invokedAt:"2026-10-23T09:00:00.000Z",execution:{generation:2,attempt:1,leaseId:"lease"},model:{id:"m",options:{reasoningEffort:"high"}}};
it("appends immutable per-invocation facts across reopen and never stores a second payload under the same ID",()=>{
 const dir=mkdtempSync(join(tmpdir(),"model-invocations-")),path=join(dir,"db.sqlite"),db=new DispatcherDatabase(path);
 try{const store=new ModelInvocationStore(db);store.append(record);store.append(structuredClone(record));store.append({...record,id:"turn-b",kind:"input",nativeSessionId:"native"});expect(store.list("run-a")).toHaveLength(2);
  expect(()=>store.append({...record,model:{id:"other",options:{}}})).toThrow("MODEL_INVOCATION_IMMUTABLE");
  expect(()=>db.handle.exec("UPDATE native_model_invocations SET record_json='{}'")).toThrow("MODEL_INVOCATION_IMMUTABLE");
  expect(()=>db.handle.exec("DELETE FROM native_model_invocations")).toThrow("MODEL_INVOCATION_IMMUTABLE");
  expect(()=>db.handle.exec("INSERT OR REPLACE INTO native_model_invocations SELECT * FROM native_model_invocations")).toThrow("MODEL_INVOCATION_IMMUTABLE");
 }finally{db.close();}
 const reopened=new DispatcherDatabase(path);try{expect(new ModelInvocationStore(reopened).get("turn-a")).toEqual(record);}finally{reopened.close();rmSync(dir,{recursive:true,force:true});}
});
it("rejects already-open prior writers which can bypass RHIZA candidate evidence policy",()=>{
 const dir=mkdtempSync(join(tmpdir(),"model-writer-")),path=join(dir,"db.sqlite"),previous=migrations.filter(m=>m.version<=13),old=new DispatcherDatabase(path,previous);
 try{expect(databaseWriterProtocol(old.handle)).toBe(9);const current=new DispatcherDatabase(path);try{
  expect(current.schemaVersion()).toBe(18);expect(databaseWriterProtocol(current.handle)).toBe(14);
  expect(()=>old.saveEntity("run","old-complete",{})).toThrow("DATABASE_WRITER_UNSUPPORTED");
  expect(()=>new DispatcherDatabase(path,previous)).toThrowError(expect.objectContaining({code:"DATABASE_SCHEMA_UNSUPPORTED"}));
 }finally{current.close();}}finally{old.close();rmSync(dir,{recursive:true,force:true});}
});
it.each(["prompt","version","model","counter","identity"])("rejects invalid or private %s data instead of appending it",reason=>{
 const db=new DispatcherDatabase(":memory:"),changed=structuredClone(record) as unknown as Record<string,unknown>;
 try{if(reason==="prompt")changed.prompt="private content";if(reason==="version")changed.version=2;if(reason==="model")changed.model={id:"m",options:{secret:{nested:"not a native option"}}};if(reason==="counter")changed.execution={generation:0,attempt:1};if(reason==="identity")changed.sessionId="";
  expect(()=>new ModelInvocationStore(db).append(changed as unknown as NativeModelInvocation)).toThrow("MODEL_INVOCATION_INVALID");expect(new ModelInvocationStore(db).list(record.runId)).toEqual([]);
 }finally{db.close();}
});
it("restores prior writer and table state when model-evidence migration is interrupted",()=>{
 const previous=migrations.filter(m=>m.version<=13),db=new DispatcherDatabase(":memory:",previous),upgrade=migrations.find(m=>m.version===14)!;
 try{const before=db.handle.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name").all();
  expect(()=>db.migrate([...previous,{...upgrade,afterApply:database=>{upgrade.afterApply?.(database);throw Error("interrupted model evidence");}}])).toThrow();
  expect(db.schemaVersion()).toBe(13);expect(databaseWriterProtocol(db.handle)).toBe(9);expect(db.handle.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name").all()).toEqual(before);expect(db.handle.prepare("SELECT name FROM sqlite_schema WHERE name='native_model_invocations'").get()).toBeUndefined();expect(()=>db.saveEntity("fixture","old-still-works",{})).not.toThrow();
 }finally{db.close();}
});
it.each(["rowid","oid","_rowid_"])("does not permit a %s replacement to delete an earlier invocation",alias=>{
 const db=new DispatcherDatabase(":memory:");try{
  const store=new ModelInvocationStore(db);store.append(record);
  expect(()=>db.handle.exec(`INSERT OR REPLACE INTO native_model_invocations(${alias},id,run_id,session_id,record_json) SELECT ${alias},'different-id',run_id,session_id,record_json FROM native_model_invocations`)).toThrow();
  expect(store.get(record.id)).toEqual(record);
 }finally{db.close();}
});
it("rejects a replacement through the immutable append-order key",()=>{
 const db=new DispatcherDatabase(":memory:");try{
  const store=new ModelInvocationStore(db);store.append(record);
  expect(()=>db.handle.exec("INSERT OR REPLACE INTO native_model_invocations(id,run_id,session_id,record_json,sequence) SELECT 'different-id',run_id,session_id,record_json,sequence FROM native_model_invocations")).toThrow("MODEL_INVOCATION_IMMUTABLE");
  expect(store.get(record.id)).toEqual(record);
 }finally{db.close();}
});
it("preserves invocation records and writer fences through backup/restore without opening execution",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"model-invocation-backup-")),source=join(dir,"source.sqlite"),bundle=join(dir,"backup"),target=join(dir,"restored"),db=new DispatcherDatabase(source);
 try{
  new ModelInvocationStore(db).append(record);await createDispatcherBackup(source,bundle);
  expect(restoreDispatcherBackup(bundle,target,{execute:true,confirmed:true})).toMatchObject({applied:true,reconciliationRequired:true});
  const raw=new DatabaseSync(join(target,"dispatcher.sqlite"),{readOnly:true});try{
   expect(databaseWriterProtocol(raw)).toBe(14);expect(JSON.parse(String(raw.prepare("SELECT record_json FROM native_model_invocations WHERE id=?").get(record.id)?.record_json))).toEqual(record);
  }finally{raw.close();}
  expect(()=>new DispatcherDatabase(join(target,"dispatcher.sqlite"))).toThrowError(expect.objectContaining({code:"RESTORE_RECONCILIATION_REQUIRED"}));expect(new ModelInvocationStore(db).get(record.id)).toEqual(record);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
