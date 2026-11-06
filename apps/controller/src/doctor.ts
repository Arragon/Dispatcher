import {copyStableDatabaseSnapshot} from "./database-snapshot.js";
import {lstatSync} from "node:fs";
import {join,resolve} from "node:path";
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
/** Diagnostics never initialize/migrate a database or acquire execution/writer ownership. */
export function inspectLocalController(directory:string,nodeVersion=process.versions.node):LocalControllerInspection {
  const [major=0,minor=0,patch=0]=nodeVersion.split(".").map(Number),dataDirectory=resolve(directory),path=join(dataDirectory,"dispatcher.sqlite");
  const result:LocalControllerInspection={node:nodeVersion,nodeSupported:major>24||major===24&&(minor>22||minor===22&&patch>=1),dataDirectory,state:"not-initialized",databaseIntegrity:null,supportedSchemaVersion:migrations.at(-1)!.version,upgradeRequired:false,reconciliationRequired:false,requiresAttention:true,executionReadiness:"not-assessed"};
  try{
    if(present(`${path}.restore-pending`)){result.state="reconciliation-required";result.reconciliationRequired=true;return result;}
    if(present(join(dataDirectory,".dispatcher-archive"))){result.state="archive";return result;}
    if(!present(path))return result;
    const file=lstatSync(path);if(!file.isFile()||file.isSymbolicLink()||file.nlink!==1){result.state="inspection-failed";result.reasonCode="DATABASE_PATH_UNSAFE";return result;}
    // Run only in the separate CLI process: never open raw source descriptors
    // inside a process holding SQLite business locks. Readers may create WAL/SHM,
    // so all SQLite inspection runs on a bounded, stability-checked private copy.
    const snapshot=copyStableDatabaseSnapshot(path);
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
