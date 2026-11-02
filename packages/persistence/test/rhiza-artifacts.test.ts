import {expect,it} from "vitest";
import {DispatcherDatabase,RhizaAdmissionStore,RhizaArtifactStore,RhizaObservationStore,RhizaVerificationStore} from "../src/index.js";
it("freezes candidate descriptions and their durable notification in the same transaction",()=>{
 const db=new DispatcherDatabase(":memory:");try{
  new RhizaAdmissionStore(db).accept({clientId:"c",commandScope:"jobs.submit",requestId:"r"},"a".repeat(64),()=>({jobId:"job-a",taskId:"task-a",repositoryId:"repo-a",profileId:"p",authorityId:"r",receipt:{state:"accepted"}}));
  const store=new RhizaArtifactStore(db),events=new RhizaObservationStore(db),before=events.head("job-a")!.revision,record={artifactId:"artifact-a",jobId:"job-a",runId:"run-a",runGeneration:2,commit:"a".repeat(40),digest:"b".repeat(64),descriptor:{artifactId:"artifact-a",digest:"b".repeat(64)}};
  expect(()=>db.transaction(()=>{store.freeze(record);throw Error("rollback candidate");})).toThrow();expect(store.find("job-a","run-a",2,record.commit)).toBeUndefined();expect(events.head("job-a")!.revision).toBe(before);
  expect(store.freeze(record)).toEqual(record);expect(store.freeze({...record,artifactId:"replacement-id",descriptor:{...record.descriptor,artifactId:"replacement-id"}})).toEqual(record);expect(events.head("job-a")!.revision).toBe(before+1);
  expect(()=>store.freeze({...record,digest:"c".repeat(64)})).toThrow("RHIZA_ARTIFACT_CONFLICT");
  expect(()=>db.handle.exec("UPDATE rhiza_artifacts SET digest='changed'")).toThrow("RHIZA_ARTIFACT_IMMUTABLE");expect(()=>db.handle.exec("DELETE FROM rhiza_artifacts")).toThrow("RHIZA_ARTIFACT_IMMUTABLE");expect(()=>db.handle.exec("INSERT OR REPLACE INTO rhiza_artifacts SELECT * FROM rhiza_artifacts")).toThrow("RHIZA_ARTIFACT_IMMUTABLE");
 }finally{db.close();}
});
it("retains immutable source and commit verification, rejecting missing or different content",()=>{
 const db=new DispatcherDatabase(":memory:");try{
  new RhizaAdmissionStore(db).accept({clientId:"c",commandScope:"jobs.submit",requestId:"r"},"a".repeat(64),()=>({jobId:"job-a",taskId:"task-a",repositoryId:"repo-a",profileId:"p",authorityId:"r",receipt:{state:"accepted"}}));
  const store=new RhizaVerificationStore(db),source={version:1 as const,jobId:"job-a",runId:"run-a",runGeneration:2,sessionId:"session-a",leaseId:"lease-a",targetHash:"a".repeat(64),tree:"b".repeat(40),commandIds:["test"],commandsDigest:"c".repeat(64),verifiedAt:"2026-10-23T10:00:00.000Z"};
  expect(()=>store.bindCommit("run-a",2,{commit:"a".repeat(40),tree:source.tree})).toThrow("RHIZA_VERIFIED_COMMIT_REQUIRED");store.recordSource(source);
  expect(()=>store.bindCommit("run-a",2,{commit:"a".repeat(40),tree:"d".repeat(40)})).toThrow("RHIZA_VERIFIED_COMMIT_REQUIRED");
  const committed=store.bindCommit("run-a",2,{commit:"a".repeat(40),tree:source.tree});expect(committed).toEqual({...source,commit:"a".repeat(40)});
  expect(()=>store.recordSource({...source,tree:"d".repeat(40)})).toThrow("RHIZA_VERIFICATION_CONFLICT");expect(()=>store.bindCommit("run-a",2,{commit:"d".repeat(40),tree:source.tree})).toThrow("RHIZA_VERIFICATION_CONFLICT");
  for(const sql of ["UPDATE rhiza_verifications SET proof_json='{}'","DELETE FROM rhiza_verifications","INSERT OR REPLACE INTO rhiza_verifications SELECT * FROM rhiza_verifications"])expect(()=>db.handle.exec(sql)).toThrow("RHIZA_VERIFICATION_IMMUTABLE");
 }finally{db.close();}
});
