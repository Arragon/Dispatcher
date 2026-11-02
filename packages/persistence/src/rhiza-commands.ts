import type {DatabaseSync} from "node:sqlite";
import {hasTable} from "./database-compatibility.js";
import type {DispatcherDatabase,JsonValue} from "./index.js";
export function migrateRhizaCommands(db:DatabaseSync):void {
 db.exec(`
 CREATE TABLE rhiza_commands(client_id TEXT NOT NULL,command_scope TEXT NOT NULL,request_id TEXT NOT NULL,command_id TEXT NOT NULL UNIQUE,job_id TEXT NOT NULL REFERENCES rhiza_admissions(job_id),semantics_hash TEXT NOT NULL,request_json TEXT NOT NULL CHECK(json_valid(request_json)),receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json)),fence_json TEXT NOT NULL CHECK(json_valid(fence_json)),PRIMARY KEY(client_id,command_scope,request_id)) WITHOUT ROWID;
 CREATE INDEX rhiza_commands_job ON rhiza_commands(job_id,command_scope);
 CREATE TABLE rhiza_command_observations(command_id TEXT NOT NULL REFERENCES rhiza_commands(command_id),sequence INTEGER NOT NULL CHECK(sequence>0),state TEXT NOT NULL CHECK(state IN ('claimed','confirmed','unknown')),proof_json TEXT NOT NULL CHECK(json_valid(proof_json)),observed_at TEXT NOT NULL,PRIMARY KEY(command_id,sequence)) WITHOUT ROWID;
 CREATE TRIGGER rhiza_command_no_replace BEFORE INSERT ON rhiza_commands WHEN EXISTS(SELECT 1 FROM rhiza_commands WHERE command_id=NEW.command_id OR (client_id=NEW.client_id AND command_scope=NEW.command_scope AND request_id=NEW.request_id)) BEGIN SELECT RAISE(ABORT,'RHIZA_COMMAND_IMMUTABLE'); END;
 CREATE TRIGGER rhiza_command_observation_no_replace BEFORE INSERT ON rhiza_command_observations WHEN EXISTS(SELECT 1 FROM rhiza_command_observations WHERE command_id=NEW.command_id AND sequence=NEW.sequence) BEGIN SELECT RAISE(ABORT,'RHIZA_COMMAND_IMMUTABLE'); END;
 CREATE TRIGGER rhiza_command_observation_sequence BEFORE INSERT ON rhiza_command_observations WHEN NEW.sequence!=(SELECT coalesce(max(sequence),0)+1 FROM rhiza_command_observations WHERE command_id=NEW.command_id) BEGIN SELECT RAISE(ABORT,'RHIZA_COMMAND_SEQUENCE_CONFLICT'); END;
 CREATE TRIGGER rhiza_command_observation_transition BEFORE INSERT ON rhiza_command_observations WHEN EXISTS(SELECT 1 FROM rhiza_command_observations WHERE command_id=NEW.command_id AND (state IN ('confirmed','unknown') OR NEW.state='claimed')) BEGIN SELECT RAISE(ABORT,'RHIZA_COMMAND_OUTCOME_FINAL'); END;
 CREATE TRIGGER rhiza_command_event AFTER INSERT ON rhiza_commands BEGIN UPDATE rhiza_job_revisions SET revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE job_id=NEW.job_id; END;
 CREATE TRIGGER rhiza_command_observation_event AFTER INSERT ON rhiza_command_observations BEGIN UPDATE rhiza_job_revisions SET revision=revision+1,updated_at=NEW.observed_at WHERE job_id=(SELECT job_id FROM rhiza_commands WHERE command_id=NEW.command_id); END;
 `);
 for(const table of ["rhiza_commands","rhiza_command_observations"])for(const action of ["UPDATE","DELETE"])db.exec(`CREATE TRIGGER ${table}_no_${action.toLowerCase()} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'RHIZA_COMMAND_IMMUTABLE'); END;`);
}
export interface RhizaCommandRecord {clientId:string;scope:string;requestId:string;commandId:string;jobId:string;semanticsHash:string;request:JsonValue;receipt:JsonValue;fence:JsonValue}
export interface RhizaCommandObservation {commandId:string;sequence:number;state:"claimed"|"confirmed"|"unknown";proof:JsonValue;observedAt:string}
export class RhizaCommandStore {
 constructor(private readonly db:DispatcherDatabase){}
 hasCancellation(taskId:string):boolean {return hasTable(this.db.handle,"rhiza_commands")&&Boolean(this.db.handle.prepare("SELECT 1 FROM rhiza_commands c JOIN rhiza_admissions a ON a.job_id=c.job_id WHERE a.task_id=? AND c.command_scope='jobs.cancel' LIMIT 1").get(taskId));}
 get(clientId:string,scope:string,requestId:string):RhizaCommandRecord|undefined {const row=this.db.handle.prepare("SELECT * FROM rhiza_commands WHERE client_id=? AND command_scope=? AND request_id=?").get(clientId,scope,requestId);return row?{clientId,scope,requestId,commandId:String(row.command_id),jobId:String(row.job_id),semanticsHash:String(row.semantics_hash),request:JSON.parse(String(row.request_json)) as JsonValue,receipt:JSON.parse(String(row.receipt_json)) as JsonValue,fence:JSON.parse(String(row.fence_json)) as JsonValue}:undefined;}
 forJob(jobId:string):RhizaCommandRecord[] {return this.db.handle.prepare("SELECT client_id,command_scope,request_id FROM rhiza_commands WHERE job_id=?").all(jobId).map(row=>this.get(String(row.client_id),String(row.command_scope),String(row.request_id))!);}
 all():RhizaCommandRecord[]{return this.db.handle.prepare("SELECT client_id,command_scope,request_id FROM rhiza_commands").all().map(row=>this.get(String(row.client_id),String(row.command_scope),String(row.request_id))!);}
 insert(record:RhizaCommandRecord):void {this.db.handle.prepare("INSERT INTO rhiza_commands VALUES (?,?,?,?,?,?,?,?,?)").run(record.clientId,record.scope,record.requestId,record.commandId,record.jobId,record.semanticsHash,JSON.stringify(record.request),JSON.stringify(record.receipt),JSON.stringify(record.fence));}
 latest(commandId:string):RhizaCommandObservation|undefined {const row=this.db.handle.prepare("SELECT * FROM rhiza_command_observations WHERE command_id=? ORDER BY sequence DESC LIMIT 1").get(commandId);return row?{commandId,sequence:Number(row.sequence),state:row.state as RhizaCommandObservation["state"],proof:JSON.parse(String(row.proof_json)) as JsonValue,observedAt:String(row.observed_at)}:undefined;}
 observe(commandId:string,state:RhizaCommandObservation["state"],proof:JsonValue,at:string):void {this.db.transaction(()=>{const last=this.latest(commandId);this.db.handle.prepare("INSERT INTO rhiza_command_observations VALUES (?,?,?,?,?)").run(commandId,(last?.sequence??0)+1,state,JSON.stringify(proof),at);});}
}
