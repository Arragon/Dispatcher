import type {DatabaseSync} from "node:sqlite";
import type {DispatcherDatabase} from "./index.js";
import {hasTable} from "./database-compatibility.js";
/** Accepted predecessor linkage is immutable receipt data, never mutable job state. */
export function migrateRhizaLineage(db:DatabaseSync):void {
 db.exec(`
 CREATE TABLE native_turn_completions(invocation_id TEXT PRIMARY KEY REFERENCES native_model_invocations(id),record_json TEXT NOT NULL CHECK(json_valid(record_json))) WITHOUT ROWID;
 CREATE TRIGGER native_completion_no_update BEFORE UPDATE ON native_turn_completions BEGIN SELECT RAISE(ABORT,'NATIVE_COMPLETION_IMMUTABLE'); END;
 CREATE TRIGGER native_completion_no_delete BEFORE DELETE ON native_turn_completions BEGIN SELECT RAISE(ABORT,'NATIVE_COMPLETION_IMMUTABLE'); END;
 CREATE TRIGGER native_completion_no_replace BEFORE INSERT ON native_turn_completions WHEN EXISTS(SELECT 1 FROM native_turn_completions WHERE invocation_id=NEW.invocation_id) BEGIN SELECT RAISE(ABORT,'NATIVE_COMPLETION_IMMUTABLE'); END;
 CREATE UNIQUE INDEX rhiza_origin_dispatch ON rhiza_admissions(client_id,authority_id,json_extract(receipt_json,'$.origin.workspaceId'),json_extract(receipt_json,'$.origin.dispatchId')) WHERE json_type(receipt_json,'$.origin.workspaceId')='text' AND json_type(receipt_json,'$.origin.dispatchId')='text';
 CREATE TRIGGER rhiza_successor_event AFTER INSERT ON rhiza_admissions WHEN json_type(NEW.receipt_json,'$.reassignment.jobId')='text' BEGIN UPDATE rhiza_job_revisions SET revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE job_id=json_extract(NEW.receipt_json,'$.reassignment.jobId'); END;
 CREATE UNIQUE INDEX rhiza_predecessor ON rhiza_admissions(json_extract(receipt_json,'$.reassignment.jobId')) WHERE json_type(receipt_json,'$.reassignment.jobId')='text';
 DROP TRIGGER rhiza_admission_no_replace;
 CREATE TRIGGER rhiza_admission_no_replace BEFORE INSERT ON rhiza_admissions WHEN EXISTS(SELECT 1 FROM rhiza_admissions WHERE rowid=NEW.rowid OR (client_id=NEW.client_id AND command_scope=NEW.command_scope AND request_id=NEW.request_id) OR job_id=NEW.job_id OR task_id=NEW.task_id OR (client_id=NEW.client_id AND authority_id=NEW.authority_id AND json_type(NEW.receipt_json,'$.origin.workspaceId')='text' AND json_type(NEW.receipt_json,'$.origin.dispatchId')='text' AND json_extract(receipt_json,'$.origin.workspaceId')=json_extract(NEW.receipt_json,'$.origin.workspaceId') AND json_extract(receipt_json,'$.origin.dispatchId')=json_extract(NEW.receipt_json,'$.origin.dispatchId')) OR (json_type(NEW.receipt_json,'$.reassignment.jobId')='text' AND json_extract(receipt_json,'$.reassignment.jobId')=json_extract(NEW.receipt_json,'$.reassignment.jobId'))) BEGIN SELECT RAISE(ABORT,'RHIZA_RECEIPT_IMMUTABLE'); END;
 `);
}
export function hasRhizaSuccessor(db:DispatcherDatabase,jobId:string):boolean {
 return hasTable(db.handle,"rhiza_admissions")&&Boolean(db.handle.prepare("SELECT 1 FROM rhiza_admissions WHERE json_type(receipt_json,'$.reassignment.jobId')='text' AND json_extract(receipt_json,'$.reassignment.jobId')=? LIMIT 1").get(jobId));
}
