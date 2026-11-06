import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {expect,it} from "vitest";
import {DispatcherDatabase,RhizaAdmissionStore,RhizaObservationStore,migrations,databaseWriterProtocol} from "../src/index.js";
const origin={authorityId:"a",workspaceId:"w",executionRunId:"execution",dispatchId:"dispatch",generation:1};
const insert=(db:DispatcherDatabase,id:string,receipt:object)=>new RhizaAdmissionStore(db).accept({clientId:"c",commandScope:"jobs.submit",requestId:id},"a".repeat(64),()=>({jobId:id,taskId:`t-${id}`,repositoryId:"repo",profileId:"p",authorityId:"a",receipt:JSON.parse(JSON.stringify({state:"accepted",...receipt}))}));
it("admits at most one dispatch identity and one immutable successor without globally locking parallel generations",()=>{
 const db=new DispatcherDatabase(":memory:");try{
  insert(db,"old",{origin});expect(()=>insert(db,"duplicate",{origin})).toThrow();
  insert(db,"parallel",{origin:{...origin,dispatchId:"parallel"}});
  const revision=new RhizaObservationStore(db).head("old")!.revision;
  insert(db,"next",{origin:{...origin,dispatchId:"next",executionRunId:"next-run",generation:2},reassignment:{jobId:"old",expectedJobRevision:2,runId:null}});
  expect(new RhizaObservationStore(db).head("old")!.revision).toBe(revision+1);
  expect(()=>insert(db,"competing-next",{origin:{...origin,dispatchId:"competing-next",executionRunId:"other-run",generation:2},reassignment:{jobId:"old",expectedJobRevision:2,runId:null}})).toThrow();
  expect(db.handle.prepare("SELECT count(*) AS n FROM rhiza_admissions").get()?.n).toBe(3);
 }finally{db.close();}
});
it.each(["rowid","origin","predecessor"] as const)("protects immutable acceptance through the added %s replacement key",key=>{
 const db=new DispatcherDatabase(":memory:");try{
  insert(db,"old",{origin});insert(db,"next",{origin:{...origin,dispatchId:"next"},reassignment:{jobId:"old",expectedJobRevision:2,runId:null}});
  const target=key==="predecessor"?"next":"old",row=db.handle.prepare("SELECT rowid,* FROM rhiza_admissions WHERE job_id=?").get(target)!;
  const receipt=JSON.stringify({state:"accepted",origin:key==="origin"?origin:{...origin,dispatchId:"other"},...(key==="predecessor"?{reassignment:{jobId:"old",expectedJobRevision:2,runId:null}}:{})});
  const columns="client_id,command_scope,request_id,request_hash,repository_id,profile_id,authority_id,job_id,task_id,receipt_json",values=["c","jobs.submit","other","a".repeat(64),"repo","p","a","other","t-other",receipt];
  expect(()=>key==="rowid"?db.handle.prepare(`INSERT OR REPLACE INTO rhiza_admissions(rowid,${columns}) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(row.rowid,...values):db.handle.prepare(`INSERT OR REPLACE INTO rhiza_admissions(${columns}) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(...values)).toThrow("RHIZA_RECEIPT_IMMUTABLE");
  expect(db.handle.prepare("SELECT count(*) AS n FROM rhiza_admissions").get()?.n).toBe(2);
 }finally{db.close();}
});
it("fences pre-lineage writers and rolls back completion indexes and gates on migration interruption",()=>{
 const root=mkdtempSync(join(tmpdir(),"rhiza-lineage-writer-")),path=join(root,"db"),previous=migrations.filter(m=>m.version<=17),old=new DispatcherDatabase(path,previous);try{
  const current=new DispatcherDatabase(path);try{expect(databaseWriterProtocol(current.handle)).toBe(15);expect(()=>old.saveEntity("fixture","unsafe",{})).toThrow("DATABASE_WRITER_UNSUPPORTED");}finally{current.close();}
 }finally{old.close();rmSync(root,{recursive:true,force:true});}
 const db=new DispatcherDatabase(":memory:",previous),upgrade=migrations.find(m=>m.version===18)!;try{
  const before=db.handle.prepare("SELECT name,sql FROM sqlite_schema WHERE type IN ('trigger','index') ORDER BY name").all();expect(()=>db.migrate([...previous,{...upgrade,afterApply:database=>{upgrade.afterApply?.(database);throw Error("interrupted lineage");}}])).toThrow();expect(db.schemaVersion()).toBe(17);expect(databaseWriterProtocol(db.handle)).toBe(13);expect(db.handle.prepare("SELECT name,sql FROM sqlite_schema WHERE type IN ('trigger','index') ORDER BY name").all()).toEqual(before);
 }finally{db.close();}
});

it("refuses ambiguous historical dispatch identities without selecting or deleting a winner",()=>{
 const previous=migrations.filter(m=>m.version<=17),db=new DispatcherDatabase(":memory:",previous);try{
  insert(db,"a",{origin});insert(db,"b",{origin});
  const before=db.handle.prepare("SELECT * FROM rhiza_admissions ORDER BY job_id").all();
  expect(()=>db.migrate(migrations)).toThrow(expect.objectContaining({name:"MigrationError",cause:expect.objectContaining({message:expect.stringContaining("UNIQUE constraint failed")})}));
  expect(db.schemaVersion()).toBe(17);expect(databaseWriterProtocol(db.handle)).toBe(13);
  expect(db.handle.prepare("SELECT * FROM rhiza_admissions ORDER BY job_id").all()).toEqual(before);
  expect(db.handle.prepare("SELECT name FROM sqlite_schema WHERE name='native_turn_completions'").get()).toBeUndefined();
 }finally{db.close();}
});
