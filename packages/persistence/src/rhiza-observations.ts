import {randomUUID} from "node:crypto";
import type {DatabaseSync} from "node:sqlite";
import type {DispatcherDatabase,JsonValue} from "./index.js";

const utc="strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const notify=(where:string,initial=false)=>initial
 ? `INSERT INTO rhiza_job_revisions(job_id,revision,updated_at) SELECT a.job_id,1,${utc} FROM rhiza_admissions a WHERE ${where};`
 : `UPDATE rhiza_job_revisions SET revision=revision+1,updated_at=${utc} WHERE job_id IN(SELECT a.job_id FROM rhiza_admissions a WHERE ${where});`;
const changed=(fields:string[])=>fields.map(field=>`json_extract(OLD.document_json,'$.${field}') IS NOT json_extract(NEW.document_json,'$.${field}')`).join(" OR ");
const taskRun="EXISTS(SELECT 1 FROM canonical_tasks t WHERE t.id=a.task_id AND json_extract(t.document_json,'$.currentRunId')=NEW.id)";
const sessionRun="EXISTS(SELECT 1 FROM canonical_tasks t JOIN entities r ON r.kind='run' AND r.id=json_extract(t.document_json,'$.currentRunId') WHERE t.id=a.task_id AND json_extract(r.document_json,'$.taskId')=a.task_id AND json_extract(r.document_json,'$.sessionId')=NEW.id)";

/** Canonical writes and their low-frequency notifications share the SQLite commit. */
export function migrateRhizaObservations(db:DatabaseSync):void {
 db.exec(`
 CREATE TABLE rhiza_job_revisions(job_id TEXT PRIMARY KEY REFERENCES rhiza_admissions(job_id),revision INTEGER NOT NULL CHECK(revision>0),updated_at TEXT NOT NULL) WITHOUT ROWID;
 CREATE TABLE rhiza_job_events(job_id TEXT NOT NULL REFERENCES rhiza_admissions(job_id),revision INTEGER NOT NULL,event_id TEXT NOT NULL UNIQUE,committed_at TEXT NOT NULL,PRIMARY KEY(job_id,revision)) WITHOUT ROWID;
 CREATE TABLE rhiza_event_cursors(id TEXT PRIMARY KEY,client_id TEXT NOT NULL,job_id TEXT NOT NULL REFERENCES rhiza_admissions(job_id),authorization_hash TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>=0),schema_version TEXT NOT NULL,expires_at TEXT NOT NULL,UNIQUE(client_id,job_id,authorization_hash,revision,schema_version)) WITHOUT ROWID;
 CREATE TABLE rhiza_artifacts(artifact_id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES rhiza_admissions(job_id),run_id TEXT NOT NULL,run_generation INTEGER NOT NULL,commit_id TEXT NOT NULL,digest TEXT NOT NULL,descriptor_json TEXT NOT NULL CHECK(json_valid(descriptor_json)),UNIQUE(job_id,run_id,run_generation,commit_id)) WITHOUT ROWID;
 CREATE TABLE rhiza_verifications(run_id TEXT NOT NULL,run_generation INTEGER NOT NULL,phase TEXT NOT NULL CHECK(phase IN ('source','commit')),job_id TEXT NOT NULL REFERENCES rhiza_admissions(job_id),proof_json TEXT NOT NULL CHECK(json_valid(proof_json)),PRIMARY KEY(run_id,run_generation,phase)) WITHOUT ROWID;
 CREATE TRIGGER rhiza_verification_no_update BEFORE UPDATE ON rhiza_verifications BEGIN SELECT RAISE(ABORT,'RHIZA_VERIFICATION_IMMUTABLE'); END;
 CREATE TRIGGER rhiza_verification_no_delete BEFORE DELETE ON rhiza_verifications BEGIN SELECT RAISE(ABORT,'RHIZA_VERIFICATION_IMMUTABLE'); END;
 CREATE TRIGGER rhiza_verification_no_replace BEFORE INSERT ON rhiza_verifications WHEN EXISTS(SELECT 1 FROM rhiza_verifications WHERE run_id=NEW.run_id AND run_generation=NEW.run_generation AND phase=NEW.phase) BEGIN SELECT RAISE(ABORT,'RHIZA_VERIFICATION_IMMUTABLE'); END;
 CREATE TRIGGER rhiza_event_no_update BEFORE UPDATE ON rhiza_job_events BEGIN SELECT RAISE(ABORT,'RHIZA_EVENT_IMMUTABLE'); END;
 CREATE TRIGGER rhiza_event_no_delete BEFORE DELETE ON rhiza_job_events BEGIN SELECT RAISE(ABORT,'RHIZA_EVENT_IMMUTABLE'); END;
 CREATE TRIGGER rhiza_event_no_replace BEFORE INSERT ON rhiza_job_events WHEN EXISTS(SELECT 1 FROM rhiza_job_events WHERE (job_id=NEW.job_id AND revision=NEW.revision) OR event_id=NEW.event_id) BEGIN SELECT RAISE(ABORT,'RHIZA_EVENT_IMMUTABLE'); END;
 CREATE TRIGGER rhiza_revision_no_replace BEFORE INSERT ON rhiza_job_revisions WHEN EXISTS(SELECT 1 FROM rhiza_job_revisions WHERE job_id=NEW.job_id) BEGIN SELECT RAISE(ABORT,'RHIZA_REVISION_CONFLICT'); END;
 CREATE TRIGGER rhiza_revision_no_delete BEFORE DELETE ON rhiza_job_revisions BEGIN SELECT RAISE(ABORT,'RHIZA_REVISION_CONFLICT'); END;
 CREATE TRIGGER rhiza_revision_event_insert AFTER INSERT ON rhiza_job_revisions BEGIN INSERT INTO rhiza_job_events VALUES(NEW.job_id,NEW.revision,'evt:'||lower(hex(randomblob(16))),NEW.updated_at); END;
 CREATE TRIGGER rhiza_revision_event_update AFTER UPDATE ON rhiza_job_revisions BEGIN INSERT INTO rhiza_job_events VALUES(NEW.job_id,NEW.revision,'evt:'||lower(hex(randomblob(16))),NEW.updated_at); END;
 CREATE TRIGGER rhiza_revision_monotonic BEFORE UPDATE ON rhiza_job_revisions WHEN NEW.job_id!=OLD.job_id OR NEW.revision!=OLD.revision+1 BEGIN SELECT RAISE(ABORT,'RHIZA_REVISION_CONFLICT'); END;
 CREATE TRIGGER rhiza_artifact_no_update BEFORE UPDATE ON rhiza_artifacts BEGIN SELECT RAISE(ABORT,'RHIZA_ARTIFACT_IMMUTABLE'); END;
 CREATE TRIGGER rhiza_artifact_no_delete BEFORE DELETE ON rhiza_artifacts BEGIN SELECT RAISE(ABORT,'RHIZA_ARTIFACT_IMMUTABLE'); END;
 CREATE TRIGGER rhiza_artifact_no_replace BEFORE INSERT ON rhiza_artifacts WHEN EXISTS(SELECT 1 FROM rhiza_artifacts WHERE artifact_id=NEW.artifact_id OR (job_id=NEW.job_id AND run_id=NEW.run_id AND run_generation=NEW.run_generation AND commit_id=NEW.commit_id)) BEGIN SELECT RAISE(ABORT,'RHIZA_ARTIFACT_IMMUTABLE'); END;
 INSERT INTO rhiza_job_revisions SELECT job_id,1,${utc} FROM rhiza_admissions;
 CREATE TRIGGER rhiza_admission_event AFTER INSERT ON rhiza_admissions BEGIN ${notify("a.job_id=NEW.job_id",true)} END;
 CREATE TRIGGER rhiza_artifact_event AFTER INSERT ON rhiza_artifacts BEGIN ${notify("a.job_id=NEW.job_id")} END;
 CREATE TRIGGER rhiza_verification_event AFTER INSERT ON rhiza_verifications BEGIN ${notify("a.job_id=NEW.job_id")} END;
 `);
 for(const action of ["INSERT","UPDATE"]){
  db.exec(`CREATE TRIGGER rhiza_task_event_${action.toLowerCase()} AFTER ${action} ON canonical_tasks BEGIN ${notify("a.task_id=NEW.id")} END;`);
  for(const [kind,where,fields] of [
   ["rhiza-job","a.job_id=NEW.id",["dispatch"]],
   ["run",`a.task_id=json_extract(NEW.document_json,'$.taskId') AND ${taskRun}`,["state","generation","attempt","leaseId","sessionId","providerSessionId","profileId","providerId","runnerId","executionSelection","verification","prUrl","recoveryReason"]],
   ["adapter-session",sessionRun,["state","providerSessionId","turnId","modelInvocationId","executionResource.state","profileId","backendId","runId","executionSelection"]],
   ["run-result",taskRun,["generation","deliveryState","commit","push"]],
  ] as const){
   db.exec(`CREATE TRIGGER rhiza_entity_${kind.replaceAll("-","_")}_${action.toLowerCase()} AFTER ${action} ON entities WHEN NEW.kind='${kind}' ${action==="UPDATE"?`AND (${changed([...fields])})`:""} BEGIN ${notify(where)} END;`);
  }
  db.exec(`CREATE TRIGGER rhiza_delivery_event_${action.toLowerCase()} AFTER ${action} ON delivery_evidence BEGIN ${notify("a.task_id=NEW.task_id AND EXISTS(SELECT 1 FROM canonical_tasks t WHERE t.id=a.task_id AND json_extract(t.document_json,'$.currentRunId')=NEW.run_id)")} END;`);
 }
}
/** Input receipts participate in the current waiting intervention, including owner and resource inputs. */
export function migrateRhizaInputObservations(db:DatabaseSync):void {
 const source=(row:string)=>`${row}.kind='run-input' AND EXISTS(SELECT 1 FROM canonical_tasks t JOIN entities r ON r.kind='run' AND r.id=json_extract(t.document_json,'$.currentRunId') WHERE t.id=a.task_id AND json_extract(r.document_json,'$.taskId')=a.task_id AND r.id=json_extract(${row}.document_json,'$.runId') AND json_extract(r.document_json,'$.sessionId')=json_extract(${row}.document_json,'$.sessionId') AND json_extract(r.document_json,'$.generation')=json_extract(${row}.document_json,'$.generation'))`;
 for(const action of ["INSERT","UPDATE","DELETE"]){
  const where=action==="INSERT"?source("NEW"):action==="DELETE"?source("OLD"):`(${source("OLD")}) OR (${source("NEW")})`;
  const when=action==="UPDATE"?`(OLD.kind='run-input' OR NEW.kind='run-input') AND (OLD.kind IS NOT NEW.kind OR ${changed(["runId","sessionId","generation","profileId","actorId","inputId","authorityHash","payloadHash","state"])})`:`${action==="INSERT"?"NEW":"OLD"}.kind='run-input'`;
  db.exec(`CREATE TRIGGER rhiza_input_event_${action.toLowerCase()} AFTER ${action} ON entities WHEN ${when} BEGIN ${notify(where)} END;`);
 }
}
export interface RhizaVerificationProof {version:1;jobId:string;runId:string;runGeneration:number;sessionId:string;leaseId:string;targetHash:string;tree:string;commandIds:string[];commandsDigest:string;verifiedAt:string;commit?:string}
/** Source verification and its later observed Git commit are separate append-only facts. */
export class RhizaVerificationStore {
 constructor(private readonly db:DispatcherDatabase){}
 get(runId:string,generation:number,phase:"source"|"commit"):RhizaVerificationProof|undefined {
  const row=this.db.handle.prepare("SELECT proof_json FROM rhiza_verifications WHERE run_id=? AND run_generation=? AND phase=?").get(runId,generation,phase);return row?JSON.parse(String(row.proof_json)) as RhizaVerificationProof:undefined;
 }
 recordSource(proof:RhizaVerificationProof):RhizaVerificationProof {
  if(proof.commit!==undefined||!proof.commandIds.length||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(proof.tree)||!Number.isSafeInteger(proof.runGeneration)||proof.runGeneration<1)throw Error("RHIZA_VERIFICATION_INVALID");
  return this.append(proof,"source");
 }
 bindCommit(runId:string,generation:number,commit:{commit:string;tree?:string}):RhizaVerificationProof {
  const source=this.get(runId,generation,"source");if(!source||commit.tree!==source.tree||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit.commit))throw Error("RHIZA_VERIFIED_COMMIT_REQUIRED");
  return this.append({...source,commit:commit.commit},"commit");
 }
 private append(proof:RhizaVerificationProof,phase:"source"|"commit"):RhizaVerificationProof {
  return this.db.transaction(()=>{const prior=this.get(proof.runId,proof.runGeneration,phase);if(prior){if(JSON.stringify(prior)!==JSON.stringify(proof))throw Error("RHIZA_VERIFICATION_CONFLICT");return prior;}
   this.db.handle.prepare("INSERT INTO rhiza_verifications VALUES (?,?,?,?,?)").run(proof.runId,proof.runGeneration,phase,proof.jobId,JSON.stringify(proof));return this.get(proof.runId,proof.runGeneration,phase)!;
  });
 }
}
export interface RhizaDurableEvent {schemaVersion:"1";eventId:string;jobId:string;revision:number;type:"job.changed";committedAt:string}
export class RhizaCursorError extends Error {readonly code="CURSOR_EXPIRED";constructor(){super("CURSOR_EXPIRED");}}
interface CursorPosition {clientId:string;jobId:string;authorizationHash:string;revision:number}
export class RhizaObservationStore {
 constructor(private readonly db:DispatcherDatabase){}
 head(jobId:string):{revision:number;updatedAt:string}|undefined {
  const row=this.db.handle.prepare("SELECT revision,updated_at FROM rhiza_job_revisions WHERE job_id=?").get(jobId);
  return row?{revision:Number(row.revision),updatedAt:String(row.updated_at)}:undefined;
 }
 events(jobId:string,after:number,limit=100):RhizaDurableEvent[]{
  if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new RhizaCursorError();
  return this.db.handle.prepare("SELECT * FROM rhiza_job_events WHERE job_id=? AND revision>? ORDER BY revision LIMIT ?").all(jobId,after,limit).map(row=>({schemaVersion:"1",eventId:String(row.event_id),jobId,revision:Number(row.revision),type:"job.changed",committedAt:String(row.committed_at)}));
 }
 cursor(position:CursorPosition,now:Date):string {
  return this.db.transaction(()=>{
   const head=this.head(position.jobId);if(!head||!Number.isSafeInteger(position.revision)||position.revision<0||position.revision>head.revision)throw new RhizaCursorError();
   const p=[position.clientId,position.jobId,position.authorizationHash,position.revision,"1"];
   const old=this.db.handle.prepare("SELECT id,expires_at FROM rhiza_event_cursors WHERE client_id=? AND job_id=? AND authorization_hash=? AND revision=? AND schema_version=?").get(...p);
   if(old&&Date.parse(String(old.expires_at))>now.getTime())return String(old.id);
   const id=randomUUID(),expiresAt=new Date(now.getTime()+86400000).toISOString();
   if(old)this.db.handle.prepare("UPDATE rhiza_event_cursors SET id=?,expires_at=? WHERE id=?").run(id,expiresAt,String(old.id));
   else this.db.handle.prepare("INSERT INTO rhiza_event_cursors(id,client_id,job_id,authorization_hash,revision,schema_version,expires_at) VALUES (?,?,?,?,?,?,?)").run(id,...p,expiresAt);
   return id;
  });
 }
 resume(id:string,clientId:string,authorizationHash:string,now:Date):{jobId:string;revision:number}{
  const row=this.db.handle.prepare("SELECT job_id,revision,expires_at FROM rhiza_event_cursors WHERE id=? AND client_id=? AND authorization_hash=? AND schema_version='1'").get(id,clientId,authorizationHash);
  if(!row||Date.parse(String(row.expires_at))<=now.getTime()||Number(row.revision)>(this.head(String(row.job_id))?.revision??-1))throw new RhizaCursorError();
  return {jobId:String(row.job_id),revision:Number(row.revision)};
 }
}
export interface RhizaArtifactRecord {artifactId:string;jobId:string;runId:string;runGeneration:number;commit:string;digest:string;descriptor:JsonValue}
export class RhizaArtifactStore {
 constructor(private readonly db:DispatcherDatabase){}
 find(jobId:string,runId:string,runGeneration:number,commit:string):RhizaArtifactRecord|undefined {
  const row=this.db.handle.prepare("SELECT * FROM rhiza_artifacts WHERE job_id=? AND run_id=? AND run_generation=? AND commit_id=?").get(jobId,runId,runGeneration,commit);
  return row?{artifactId:String(row.artifact_id),jobId,runId,runGeneration,commit,digest:String(row.digest),descriptor:JSON.parse(String(row.descriptor_json)) as RhizaArtifactRecord["descriptor"]}:undefined;
 }
 freeze(record:RhizaArtifactRecord):RhizaArtifactRecord {
  return this.db.transaction(()=>{
   const previous=this.find(record.jobId,record.runId,record.runGeneration,record.commit);
   if(previous){if(previous.digest!==record.digest)throw Error("RHIZA_ARTIFACT_CONFLICT");return previous;}
   this.db.handle.prepare("INSERT INTO rhiza_artifacts(artifact_id,job_id,run_id,run_generation,commit_id,digest,descriptor_json) VALUES (?,?,?,?,?,?,?)").run(record.artifactId,record.jobId,record.runId,record.runGeneration,record.commit,record.digest,JSON.stringify(record.descriptor));
   return this.find(record.jobId,record.runId,record.runGeneration,record.commit)!;
  });
 }
}
