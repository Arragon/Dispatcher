import type { DispatcherDatabase, JsonValue } from "./index.js";

export interface RhizaAdmissionKey { clientId: string; commandScope: "jobs.submit"; requestId: string }
export interface RhizaAdmission {
  repositoryId: string; profileId: string; authorityId: string; jobId: string; taskId: string; receipt: JsonValue;
}
export interface RhizaAdmissionRecord extends RhizaAdmission, RhizaAdmissionKey { requestHash: string }
export class RhizaAdmissionError extends Error {
  readonly code = "IDEMPOTENCY_CONFLICT";
  constructor() { super("The request key already binds a different semantic payload"); }
}

/** Immutable original acceptance, separate from mutable publication/job state. */
export class RhizaAdmissionStore {
  constructor(private readonly db: DispatcherDatabase) {}

  get(key: RhizaAdmissionKey): RhizaAdmissionRecord | undefined {
    const row = this.db.handle.prepare("SELECT * FROM rhiza_admissions WHERE client_id=? AND command_scope=? AND request_id=?").get(key.clientId, key.commandScope, key.requestId);
    if (!row) return undefined;
    return { ...key, requestHash: String(row.request_hash), repositoryId: String(row.repository_id), profileId: String(row.profile_id), authorityId: String(row.authority_id), jobId: String(row.job_id), taskId: String(row.task_id), receipt: JSON.parse(String(row.receipt_json)) as JsonValue };
  }

  /** create may perform only synchronous canonical writes on this connection. */
  accept(key: RhizaAdmissionKey, requestHash: string, create: () => RhizaAdmission): RhizaAdmissionRecord {
    return this.db.transaction(() => {
      const previous = this.get(key);
      if (previous) { if (previous.requestHash !== requestHash) throw new RhizaAdmissionError(); return previous; }
      const record = create();
      this.db.handle.prepare("INSERT INTO rhiza_admissions(client_id,command_scope,request_id,request_hash,repository_id,profile_id,authority_id,job_id,task_id,receipt_json) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .run(key.clientId, key.commandScope, key.requestId, requestHash, record.repositoryId, record.profileId, record.authorityId, record.jobId, record.taskId, JSON.stringify(record.receipt));
      return this.get(key)!;
    });
  }
}
