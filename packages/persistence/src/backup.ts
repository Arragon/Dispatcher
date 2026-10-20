import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import { DispatcherDatabase, migrations } from "./index.js";
import { assertDatabaseSchema, databaseWriterProtocol, DATABASE_ARCHIVE_KIND, DATABASE_ARCHIVE_MARKER, DatabaseCompatibilityError, hasTable, RESTORE_BARRIER_KIND, restoreReconciliationRequired } from "./database-compatibility.js";

export interface BackupInventory {tasks:number;runs:number;sessions:number;evidence:number;pendingOutbox:number;unresolvedCommands:number;}
export interface DispatcherBackupManifest {version:1;databaseFile:"dispatcher.sqlite";capturedAt:string;schemaVersion:number;bytes:number;sha256:string;inventory:BackupInventory;}
export interface DatabaseInspection {schemaVersion:number;integrity:boolean;inventory:BackupInventory;reconciliationRequired:boolean;}
export interface DispatcherRestorePlan {version:1;applied:boolean;schemaVersion:number;snapshotSha256:string;inventory:BackupInventory;reconciliationRequired:true;}
const MAX_DATABASE_BYTES=2*1024*1024*1024;
function fail(code:string):never{throw new DatabaseCompatibilityError(code);}
function regular(path:string,maxBytes:number):number {
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{const info=fstatSync(fd);if(!info.isFile()||info.size<1||info.size>maxBytes)fail("BACKUP_FILE_INVALID");return fd;}catch(error){closeSync(fd);throw error;}
}
function digest(fd:number,destination?:number):{sha256:string;bytes:number} {
  const before=fstatSync(fd),chunk=Buffer.alloc(1024*1024),hash=createHash("sha256");let bytes=0;
  while(bytes<before.size){const count=readSync(fd,chunk,0,Math.min(chunk.length,before.size-bytes),bytes);if(!count)fail("BACKUP_FILE_CHANGED");hash.update(chunk.subarray(0,count));if(destination!==undefined){let written=0;while(written<count)written+=writeSync(destination,chunk,written,count-written);}bytes+=count;}
  const after=fstatSync(fd);if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||readSync(fd,chunk,0,1,bytes)!==0)fail("BACKUP_FILE_CHANGED");
  return {sha256:hash.digest("hex"),bytes};
}
function inspect(db:DatabaseSync):DatabaseInspection {
  assertDatabaseSchema(db,migrations);if(!hasTable(db,"schema_migrations"))fail("DATABASE_SCHEMA_UNSUPPORTED");
  const count=(table:string,condition="")=>hasTable(db,table)?Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table} ${condition}`).get()?.count):0;
  const integrity=db.prepare("PRAGMA integrity_check").all().length===1&&db.prepare("PRAGMA integrity_check").get()?.integrity_check==="ok"&&db.prepare("PRAGMA foreign_key_check").all().length===0;
  return {schemaVersion:Number(db.prepare("SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations").get()?.version),integrity,reconciliationRequired:restoreReconciliationRequired(db),inventory:{tasks:count("canonical_tasks"),runs:count("entities","WHERE kind='run'"),sessions:count("entities","WHERE kind='session'"),evidence:count("delivery_evidence"),pendingOutbox:count("outbox_events","WHERE status!='DELIVERED'"),unresolvedCommands:count("interaction_commands","WHERE state IN ('RESERVED','SENDING','UNKNOWN')")}};
}
export function inspectDispatcherDatabase(path:string):DatabaseInspection {
  const fd=regular(path,MAX_DATABASE_BYTES);let db:DatabaseSync|undefined;
  try{db=new DatabaseSync(path,{readOnly:true,timeout:5000});const opened=fstatSync(fd),current=lstatSync(path);if(current.isSymbolicLink()||opened.dev!==current.dev||opened.ino!==current.ino)fail("BACKUP_FILE_CHANGED");return inspect(db);}finally{db?.close();closeSync(fd);}
}
export interface RecoveryInventory {
 version:1;schemaVersion:number;reconciliationRequired:boolean;unresolvedWorkspaceReferences:number;runIds:string[];
 references:Array<{kind:"run"|"session"|"adapter-session";id:string;path:string}>;
 processes:Array<{kind:"native-runtime"|"runner-process";id:string;pid?:number;runId?:string;claimedOwnership?:"owned"|"external";ownership:"unverified";orphan:boolean}>;
}
export function readRecoveryInventory(path:string):RecoveryInventory {
 const fd=regular(path,MAX_DATABASE_BYTES);let db:DatabaseSync|undefined;
 try{
  db=new DatabaseSync(path,{readOnly:true,timeout:5000});const opened=fstatSync(fd),current=lstatSync(path);if(current.isSymbolicLink()||opened.dev!==current.dev||opened.ino!==current.ino)fail("BACKUP_FILE_CHANGED");
  db.exec("BEGIN");const state=inspect(db);if(!state.integrity)fail("BACKUP_INTEGRITY_FAILED");
  const records:Array<{kind:string;id:string;value:Record<string,unknown>}>=[];let bytes=0;
  for(const row of db.prepare("SELECT kind,id,CASE WHEN length(CAST(document_json AS BLOB))<=65536 THEN document_json ELSE NULL END AS document_json FROM entities WHERE kind IN ('run','session','adapter-session','native-runtime','runner-process') ORDER BY kind,id LIMIT 1001").iterate()){
   if(records.length>=1000||typeof row.document_json!=="string"||(bytes+=Buffer.byteLength(row.document_json))>4*1024*1024)fail("RECOVERY_INVENTORY_LIMIT");const value:unknown=JSON.parse(row.document_json);if(!value||typeof value!=="object"||Array.isArray(value)||typeof row.id!=="string"||row.id.length>512)fail("RECOVERY_INVENTORY_INVALID");records.push({kind:String(row.kind),id:row.id,value:value as Record<string,unknown>});
  }
  const runIds=new Set(records.filter(row=>row.kind==="run").map(row=>row.id)),result:RecoveryInventory={version:1,schemaVersion:state.schemaVersion,reconciliationRequired:state.reconciliationRequired,unresolvedWorkspaceReferences:0,runIds:[...runIds],references:[],processes:[]},workspacePaths=new Map<string,string>(),runWorkspacePaths=new Map<string,string>();
  for(const row of records.filter(row=>row.kind==="run")){const p=row.value.worktree;if(typeof p==="string"&&isAbsolute(p)&&p.length<=4096&&!p.includes("\0")){runWorkspacePaths.set(row.id,p);workspacePaths.set(row.id,p);const ref=row.value.executionRef as {workspaceId?:unknown;id?:unknown}|undefined;if(ref&&typeof ref.workspaceId==="string")workspacePaths.set(ref.workspaceId,p);if(ref&&typeof ref.id==="string")workspacePaths.set(ref.id,p);}}
  for(const row of records){
   const text=(value:unknown,max=512)=>typeof value==="string"&&value.length>0&&value.length<=max&&!value.includes("\0")?value:undefined;
   if(row.kind==="native-runtime"||row.kind==="runner-process"){
    const runId=text(row.value.runId),pid=Number.isSafeInteger(row.value.pid)&&Number(row.value.pid)>0?Number(row.value.pid):undefined,claim=row.value.ownership;
    if(!runId||!runWorkspacePaths.has(runId))result.unresolvedWorkspaceReferences++;
    result.processes.push({kind:row.kind,id:row.id,...(pid!==undefined?{pid}:{}),...(runId?{runId}:{}),...(claim==="owned"||claim==="external"?{claimedOwnership:claim}:{}),ownership:"unverified",orphan:!runId||!runIds.has(runId)});continue;
   }
   const ref=row.value.executionRef as {workspaceId?:unknown}|undefined,p=text(row.value.worktree,4096)??text(row.value.workspacePath,4096)??workspacePaths.get(text(ref?.workspaceId)??text(row.value.runId)??"");
   if(p&&isAbsolute(p))result.references.push({kind:row.kind as "run"|"session"|"adapter-session",id:row.id,path:resolve(p)});
   else if(row.kind==="adapter-session"||row.value.nativeSessionId!==undefined||row.value.worktree!==undefined||row.value.workspacePath!==undefined||ref?.workspaceId!==undefined||row.value.runId!==undefined)result.unresolvedWorkspaceReferences++;
  }
  if(hasTable(db,"native_bindings")){
   const retention=db.prepare("SELECT session_id,execution_ref_id AS workspace_key FROM native_bindings UNION ALL SELECT session_id,active_run_id AS workspace_key FROM session_controls UNION ALL SELECT session_id,NULL AS workspace_key FROM interaction_commands WHERE state IN ('RESERVED','SENDING','UNKNOWN') OR json_extract(document_json,'$.nativeReceipt.state')='queued' LIMIT 1001").all();if(retention.length>1000)fail("RECOVERY_INVENTORY_LIMIT");
   for(const row of retention){const sessionId=String(row.session_id),p=workspacePaths.get(String(row.workspace_key))??result.references.find(ref=>ref.kind==="session"&&ref.id===sessionId)?.path;if(!p){result.unresolvedWorkspaceReferences++;continue;}if(!result.references.some(ref=>ref.kind==="session"&&ref.id===sessionId&&ref.path===resolve(p)))result.references.push({kind:"session",id:sessionId,path:resolve(p)});}
  }
  return result;
 }finally{db?.close();closeSync(fd);}
}
function newDirectory(path:string):string {
  const full=resolve(path),directory=join(realpathSync(dirname(full)),basename(full));mkdirSync(directory,{mode:0o700});return directory;
}
function syncFile(path:string):void {const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}}
function syncDirectory(path:string):void {const fd=openSync(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}}
export async function createDispatcherBackup(sourcePath:string,bundlePath:string):Promise<DispatcherBackupManifest> {
  const source=resolve(sourcePath),fd=regular(source,MAX_DATABASE_BYTES);let db:DatabaseSync|undefined;
  try{
    db=new DatabaseSync(source,{readOnly:true,timeout:5000});const original=fstatSync(fd),current=lstatSync(source);if(current.isSymbolicLink()||current.dev!==original.dev||current.ino!==original.ino)fail("BACKUP_FILE_CHANGED");inspect(db);
    const directory=newDirectory(bundlePath),target=join(directory,"dispatcher.sqlite");writeFileSync(join(directory,DATABASE_ARCHIVE_MARKER),'{"version":1}\n',{flag:"wx",mode:0o600});syncFile(join(directory,DATABASE_ARCHIVE_MARKER));syncDirectory(directory);const targetFd=openSync(target,"wx",0o600);closeSync(targetFd);
    await backup(db,target);
    const snapshot=new DatabaseSync(target);try{const writerProtocol=databaseWriterProtocol(snapshot);snapshot.function("dispatcher_writer_protocol",{deterministic:true},()=>writerProtocol);snapshot.prepare("INSERT OR REPLACE INTO entities(kind,id,document_json,updated_at) VALUES (?,?,?,?)").run(DATABASE_ARCHIVE_KIND,"active",'{"version":1}',new Date().toISOString());snapshot.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;");}finally{snapshot.close();}
    const state=inspectDispatcherDatabase(target);if(!state.integrity)fail("BACKUP_INTEGRITY_FAILED");const snapshotFd=regular(target,MAX_DATABASE_BYTES);let fingerprint:{sha256:string;bytes:number};try{fingerprint=digest(snapshotFd);}finally{closeSync(snapshotFd);}
    const manifest:DispatcherBackupManifest={version:1,databaseFile:"dispatcher.sqlite",capturedAt:new Date().toISOString(),schemaVersion:state.schemaVersion,...fingerprint,inventory:state.inventory};syncFile(target);writeFileSync(join(directory,"manifest.json"),JSON.stringify(manifest,null,2)+"\n",{flag:"wx",mode:0o600});syncFile(join(directory,"manifest.json"));syncDirectory(directory);syncDirectory(dirname(directory));return manifest;
  }finally{db?.close();closeSync(fd);}
}
function readManifest(path:string):DispatcherBackupManifest {
  const fd=regular(path,64*1024);let value:unknown;try{const size=fstatSync(fd).size,bytes=Buffer.alloc(size);let count=0;while(count<size){const read=readSync(fd,bytes,count,size-count,count);if(!read)fail("BACKUP_MANIFEST_INVALID");count+=read;}if(fstatSync(fd).size!==size)fail("BACKUP_MANIFEST_INVALID");value=JSON.parse(bytes.toString("utf8"));}finally{closeSync(fd);}
  if(!value||typeof value!=="object"||Array.isArray(value))fail("BACKUP_MANIFEST_INVALID");const m=value as DispatcherBackupManifest;
  if(Object.keys(m).sort().join(",")!==["version","databaseFile","capturedAt","schemaVersion","bytes","sha256","inventory"].sort().join(",")||m.version!==1||m.databaseFile!=="dispatcher.sqlite"||typeof m.capturedAt!=="string"||!Number.isFinite(Date.parse(m.capturedAt))||!Number.isSafeInteger(m.schemaVersion)||m.schemaVersion<1||m.schemaVersion>migrations.at(-1)!.version||!Number.isSafeInteger(m.bytes)||m.bytes<1||m.bytes>MAX_DATABASE_BYTES||typeof m.sha256!=="string"||!/^[a-f0-9]{64}$/.test(m.sha256)||!m.inventory||typeof m.inventory!=="object"||Array.isArray(m.inventory)||Object.keys(m.inventory).sort().join(",")!==["tasks","runs","sessions","evidence","pendingOutbox","unresolvedCommands"].sort().join(",")||Object.values(m.inventory).some(v=>!Number.isSafeInteger(v)||v<0))fail("BACKUP_MANIFEST_INVALID");return m;
}
export function restoreDispatcherBackup(bundlePath:string,targetDirectory:string,options:{execute?:boolean;confirmed?:boolean}={}):DispatcherRestorePlan {
  if(options.execute&&!options.confirmed)fail("RESTORE_CONFIRMATION_REQUIRED");
  const bundle=realpathSync(bundlePath),manifest=readManifest(join(bundle,"manifest.json")),source=join(bundle,manifest.databaseFile),fd=regular(source,MAX_DATABASE_BYTES);
  try{
    for(const suffix of ["-wal","-shm","-journal"]) {
      try{lstatSync(source+suffix);}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")continue;throw error;}
      fail("BACKUP_SIDECAR_UNSUPPORTED");
    }
    if(!isDeepStrictEqual(digest(fd),{sha256:manifest.sha256,bytes:manifest.bytes}))fail("BACKUP_CHECKSUM_MISMATCH");const inspection=inspectDispatcherDatabase(source);if(!inspection.integrity||inspection.schemaVersion!==manifest.schemaVersion||!isDeepStrictEqual(inspection.inventory,manifest.inventory))fail("BACKUP_INTEGRITY_FAILED");
    // Inspection cannot authorize replay: effects may have happened after capture.
    const plan:DispatcherRestorePlan={version:1,applied:false,schemaVersion:manifest.schemaVersion,snapshotSha256:manifest.sha256,inventory:manifest.inventory,reconciliationRequired:true};if(!options.execute)return plan;
    const directory=newDirectory(targetDirectory),target=join(directory,".restore-incomplete.sqlite");writeFileSync(join(directory,"dispatcher.sqlite.restore-pending"),'{"version":1}\n',{flag:"wx",mode:0o600});syncFile(join(directory,"dispatcher.sqlite.restore-pending"));syncDirectory(directory);syncDirectory(dirname(directory));const output=openSync(target,"wx",0o600);try{if(!isDeepStrictEqual(digest(fd,output),{sha256:manifest.sha256,bytes:manifest.bytes}))fail("BACKUP_CHECKSUM_MISMATCH");fsyncSync(output);}finally{closeSync(output);}
    // Only this private staging copy loses the archive marker. The final filename
    // remains blocked by the durable restore-pending file throughout preparation.
    const staging=new DatabaseSync(target);try{const writerProtocol=databaseWriterProtocol(staging);staging.function("dispatcher_writer_protocol",{deterministic:true},()=>writerProtocol);staging.prepare("DELETE FROM entities WHERE kind=?").run(DATABASE_ARCHIVE_KIND);}finally{staging.close();}
    const restored=new DispatcherDatabase(target);try{restored.saveEntity(RESTORE_BARRIER_KIND,"active",{version:1,state:"RECONCILIATION_REQUIRED",snapshotSha256:manifest.sha256,capturedAt:manifest.capturedAt,restoredAt:new Date().toISOString()});restored.checkpoint();}finally{restored.close();}syncFile(target);linkSync(target,join(directory,"dispatcher.sqlite"));unlinkSync(target);syncDirectory(directory);syncDirectory(dirname(directory));return {...plan,applied:true};
  }finally{closeSync(fd);}
}
