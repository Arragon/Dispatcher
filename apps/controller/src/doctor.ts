import {closeSync,constants,fstatSync,lstatSync,mkdtempSync,openSync,readSync,rmSync,writeSync} from "node:fs";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {isDeepStrictEqual} from "node:util";
import {DatabaseCompatibilityError,inspectDispatcherDatabase,migrations,readRecoveryInventory} from "@dispatcher/persistence";

type InspectionState="not-initialized"|"archive"|"reconciliation-required"|"upgrade-required"|"inspection-complete"|"inspection-failed";
export interface LocalControllerInspection {
  node:string;nodeSupported:boolean;dataDirectory:string;state:InspectionState;
  databaseIntegrity:boolean|null;schemaVersion?:number;supportedSchemaVersion:number;upgradeRequired:boolean;
  reconciliationRequired:boolean;requiresAttention:boolean;executionReadiness:"not-assessed";reasonCode?:string;
  inventory?:{tasks:number;runs:number;sessions:number;evidence:number;pendingOutbox:number;unresolvedCommands:number};
  recovery?:{unresolvedWorkspaceReferences:number;unverifiedProcesses:number;orphanProcesses:number};
}
function present(path:string):boolean {
  try{lstatSync(path);return true;}catch(error){if(error&&typeof error==="object"&&"code" in error&&error.code==="ENOENT")return false;throw error;}
}
function snapshotForInspection(path:string):{path:string;close():void}{
  const temporary=mkdtempSync(join(tmpdir(),"dispatcher-doctor-snapshot-")),descriptors:number[]=[],copies:Array<{source:string;fd:number;before:ReturnType<typeof signature>}>=[];
  function signature(fd:number){const value=fstatSync(fd,{bigint:true});return {dev:value.dev,ino:value.ino,size:value.size,mtime:value.mtimeNs,ctime:value.ctimeNs};}
  try{
    if(present(`${path}-journal`))throw new DatabaseCompatibilityError("DIAGNOSTIC_SOURCE_BUSY");
    const hadWal=present(`${path}-wal`);
    for(const source of [path,...(hadWal?[`${path}-wal`]:[])]){
      const fd=openSync(source,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);descriptors.push(fd);copies.push({source,fd,before:signature(fd)});
      const info=fstatSync(fd);if(!info.isFile()||info.nlink!==1||info.size>256*1024*1024)throw new DatabaseCompatibilityError("DIAGNOSTIC_SNAPSHOT_LIMIT");
    }
    const destination=join(temporary,"dispatcher.sqlite"),chunk=Buffer.alloc(64*1024);
    for(const copy of copies){
      const output=openSync(copy.source===path?destination:`${destination}-wal`,"wx",0o600);
      try{let position=0;while(position<Number(copy.before.size)){const count=readSync(copy.fd,chunk,0,Math.min(chunk.length,Number(copy.before.size)-position),position);if(count===0)throw new DatabaseCompatibilityError("DIAGNOSTIC_SOURCE_CHANGED");let written=0;while(written<count)written+=writeSync(output,chunk,written,count-written);position+=count;}}finally{closeSync(output);}
    }
    for(const copy of copies){const current=lstatSync(copy.source,{bigint:true});if(current.isSymbolicLink()||current.dev!==copy.before.dev||current.ino!==copy.before.ino||!isDeepStrictEqual(signature(copy.fd),copy.before))throw new DatabaseCompatibilityError("DIAGNOSTIC_SOURCE_CHANGED");}
    if(hadWal!==present(`${path}-wal`)||present(`${path}-journal`))throw new DatabaseCompatibilityError("DIAGNOSTIC_SOURCE_CHANGED");
    return {path:destination,close:()=>rmSync(temporary,{recursive:true,force:true})};
  }catch(error){rmSync(temporary,{recursive:true,force:true});throw error;}
  finally{for(const fd of descriptors)closeSync(fd);}
}
/** Diagnostics never initialize/migrate a database or acquire execution/writer ownership. */
export function inspectLocalController(directory:string,nodeVersion=process.versions.node):LocalControllerInspection {
  const [major=0,minor=0]=nodeVersion.split(".").map(Number),dataDirectory=resolve(directory),path=join(dataDirectory,"dispatcher.sqlite");
  const result:LocalControllerInspection={node:nodeVersion,nodeSupported:major>24||major===24&&minor>=12,dataDirectory,state:"not-initialized",databaseIntegrity:null,supportedSchemaVersion:migrations.at(-1)!.version,upgradeRequired:false,reconciliationRequired:false,requiresAttention:true,executionReadiness:"not-assessed"};
  try{
    if(present(`${path}.restore-pending`)){result.state="reconciliation-required";result.reconciliationRequired=true;return result;}
    if(present(join(dataDirectory,".dispatcher-archive"))){result.state="archive";return result;}
    if(!present(path))return result;
    const file=lstatSync(path);if(!file.isFile()||file.isSymbolicLink()||file.nlink!==1){result.state="inspection-failed";result.reasonCode="DATABASE_PATH_UNSAFE";return result;}
    // Run only in the separate CLI process: never open raw source descriptors
    // inside a process holding SQLite business locks. Readers may create WAL/SHM,
    // so all SQLite inspection runs on a bounded, stability-checked private copy.
    const snapshot=snapshotForInspection(path);
    let inspected:ReturnType<typeof inspectDispatcherDatabase>,recovery:ReturnType<typeof readRecoveryInventory>;
    try{inspected=inspectDispatcherDatabase(snapshot.path);recovery=readRecoveryInventory(snapshot.path);}finally{snapshot.close();}
    result.schemaVersion=inspected.schemaVersion;result.databaseIntegrity=inspected.integrity;result.inventory=inspected.inventory;
    result.upgradeRequired=inspected.schemaVersion<result.supportedSchemaVersion;result.reconciliationRequired=inspected.reconciliationRequired;
    result.recovery={unresolvedWorkspaceReferences:recovery.unresolvedWorkspaceReferences,unverifiedProcesses:recovery.processes.length,orphanProcesses:recovery.processes.filter(process=>process.orphan).length};
    result.state=!inspected.integrity?"inspection-failed":result.reconciliationRequired?"reconciliation-required":result.upgradeRequired?"upgrade-required":"inspection-complete";
    result.requiresAttention=!result.nodeSupported||result.state!=="inspection-complete"||inspected.inventory.unresolvedCommands>0||recovery.unresolvedWorkspaceReferences>0||recovery.processes.length>0;
    return result;
  }catch(error){result.state="inspection-failed";result.reasonCode=error instanceof DatabaseCompatibilityError?error.code:"DATABASE_INSPECTION_FAILED";return result;}
}
