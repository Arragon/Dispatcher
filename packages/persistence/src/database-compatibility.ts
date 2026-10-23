import type { DatabaseSync } from "node:sqlite";
import { lstatSync } from "node:fs";
import { dirname, join } from "node:path";

export const RESTORE_BARRIER_KIND = "database-restore-barrier";
export const DATABASE_ARCHIVE_MARKER = ".dispatcher-archive";
export const DATABASE_ARCHIVE_KIND = "database-backup-archive";
export const CONVERGENCE_SCHEMA_NAME = "v3_native_convergence_writer_protocol";
export const CONTROL_RUNTIME_SCHEMA_NAME = "guarded_control_runtime_writer_protocol";
export const GUARDED_START_SCHEMA_NAME = "guarded_controller_start_writer_protocol";
export const AUTOMATIC_VERIFICATION_SCHEMA_NAME = "automatic_verification_receipt_writer_protocol";
export const USAGE_ORIGIN_SCHEMA_NAME = "canonical_usage_origin_writer_protocol";
export function databaseWriterProtocol(db:DatabaseSync):1|2|3|4|5|6 {
  if(!hasTable(db,"schema_migrations"))return 1;
  if(db.prepare("SELECT name FROM schema_migrations WHERE version=10").get()?.name===USAGE_ORIGIN_SCHEMA_NAME)return 6;
  if(db.prepare("SELECT name FROM schema_migrations WHERE version=9").get()?.name===AUTOMATIC_VERIFICATION_SCHEMA_NAME)return 5;
  if(db.prepare("SELECT name FROM schema_migrations WHERE version=8").get()?.name===GUARDED_START_SCHEMA_NAME)return 4;
  if(db.prepare("SELECT name FROM schema_migrations WHERE version=7").get()?.name===CONTROL_RUNTIME_SCHEMA_NAME)return 3;
  const migration=db.prepare("SELECT name FROM schema_migrations WHERE version=6").get();
  return migration?.name===CONVERGENCE_SCHEMA_NAME?2:1;
}
export class DatabaseCompatibilityError extends Error {
  constructor(readonly code: string) { super(code); this.name = "DatabaseCompatibilityError"; }
}
export function hasTable(db:DatabaseSync,name:string):boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name);
}
export function assertDatabaseSchema(db:DatabaseSync,catalog:readonly {version:number;name:string}[]):void {
  if(!hasTable(db,"schema_migrations"))return;
  const supported=new Map(catalog.map(m=>[m.version,m.name]));
  for(const row of db.prepare("SELECT version,name FROM schema_migrations ORDER BY version").all()) {
    if(supported.get(Number(row.version))!==row.name)throw new DatabaseCompatibilityError("DATABASE_SCHEMA_UNSUPPORTED");
  }
}
export function restoreReconciliationRequired(db:DatabaseSync):boolean {
  return hasTable(db,"entities")&&!!db.prepare("SELECT 1 FROM entities WHERE kind=? LIMIT 1").get(RESTORE_BARRIER_KIND);
}
export function assertDatabaseOperational(db:DatabaseSync):void {
  if(restoreReconciliationRequired(db))throw new DatabaseCompatibilityError("RESTORE_RECONCILIATION_REQUIRED");
  if(hasTable(db,"entities")&&db.prepare("SELECT 1 FROM entities WHERE kind=? LIMIT 1").get(DATABASE_ARCHIVE_KIND))throw new DatabaseCompatibilityError("DATABASE_ARCHIVE_READ_ONLY");
}
export function assertDatabaseLocationOperational(path:string):void {
  if(path===":memory:")return;
  try{const info=lstatSync(path);if(!info.isFile()||info.nlink!==1)throw new DatabaseCompatibilityError("DATABASE_PATH_UNSAFE");}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
  for(const [marker,code] of [[`${path}.restore-pending`,"RESTORE_RECONCILIATION_REQUIRED"],[join(dirname(path),DATABASE_ARCHIVE_MARKER),"DATABASE_ARCHIVE_READ_ONLY"]]) {
    try{lstatSync(marker!);}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")continue;throw error;}
    throw new DatabaseCompatibilityError(code!);
  }
}

// SQLite keeps these triggers when an older process ignores the migration ledger.
// That process has no matching connection-local function, so DML fails closed.
export function installWriterGate(db:DatabaseSync,protocol:1|2|3|4|5|6=1):void {
  for(const row of db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
    const table=String(row.name);
    if(!/^[a-z_]+$/.test(table))throw new DatabaseCompatibilityError("DATABASE_SCHEMA_UNSUPPORTED");
    for(const action of ["INSERT","UPDATE","DELETE"])db.exec(`CREATE TRIGGER writer_gate_${table}_${action.toLowerCase()} BEFORE ${action} ON ${table} WHEN dispatcher_writer_protocol() != ${protocol} BEGIN SELECT RAISE(ABORT,'DATABASE_WRITER_UNSUPPORTED'); END;`);
  }
}

export function upgradeConvergenceWriterGate(db:DatabaseSync):void {
  replaceWriterGate(db,2);
}
export function upgradeControlRuntimeWriterGate(db:DatabaseSync):void {
  replaceWriterGate(db,3);
}
export function upgradeGuardedStartWriterGate(db:DatabaseSync):void {
  replaceWriterGate(db,4);
}
export function upgradeAutomaticVerificationWriterGate(db:DatabaseSync):void {
  replaceWriterGate(db,5);
}
export function upgradeUsageOriginWriterGate(db:DatabaseSync):void {
  replaceWriterGate(db,6);
}
function replaceWriterGate(db:DatabaseSync,protocol:2|3|4|5|6):void {
  for(const row of db.prepare("SELECT name FROM sqlite_schema WHERE type='trigger' AND name GLOB 'writer_gate_*'").all()){
    const name=String(row.name);
    if(!/^writer_gate_[a-z_]+_(insert|update|delete)$/.test(name))throw new DatabaseCompatibilityError("DATABASE_SCHEMA_UNSUPPORTED");
    db.exec(`DROP TRIGGER ${name}`);
  }
  installWriterGate(db,protocol);
}
