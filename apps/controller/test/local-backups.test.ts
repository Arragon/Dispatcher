import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {afterEach,describe,expect,it} from "vitest";
import {DispatcherDatabase,migrations,inspectDispatcherDatabase,acquireInstanceLock} from "@dispatcher/persistence";
import {createLocalDatabaseBackup,restoreLocalDatabase} from "../src/local-backups.js";

const roots:string[]=[];function root(){const value=mkdtempSync(join(tmpdir(),"dispatcher-local-backup-"));roots.push(value);return value;}
afterEach(()=>{for(const path of roots.splice(0))rmSync(path,{recursive:true,force:true});});
const hash=(path:string)=>createHash("sha256").update(readFileSync(path)).digest("hex");
function fixture(version=8){const directory=root(),path=join(directory,"dispatcher.sqlite"),db=new DispatcherDatabase(path,migrations.slice(0,version));db.saveEntity("fixture","retained",{value:"preserve source records"});db.close();return {directory,path};}
describe("offline database backup and restore preparation",()=>{
 it("creates a verified database-only archive without changing source bytes or legacy schema",async()=>{
  const f=fixture(5),before=hash(f.path),bundle=join(root(),"bundle"),result=await createLocalDatabaseBackup(f.directory,bundle);
  expect(result).toMatchObject({scope:"database-only",secretStoreIncluded:false,nativeStorageIncluded:false,manifest:{schemaVersion:5,inventory:{tasks:0}}});expect(hash(f.path)).toBe(before);expect(result.manifest.sha256).toBe(hash(join(bundle,"dispatcher.sqlite")));expect(()=>new DispatcherDatabase(join(bundle,"dispatcher.sqlite"))).toThrowError(expect.objectContaining({code:"DATABASE_ARCHIVE_READ_ONLY"}));
 });
 it("refuses backup while another Controller owns the data directory and never creates the archive",async()=>{
  const f=fixture(),lock=acquireInstanceLock(f.directory),bundle=join(root(),"bundle"),before=hash(f.path);
  try{await expect(createLocalDatabaseBackup(f.directory,bundle)).rejects.toThrow("DATA_DIRECTORY_IN_USE");expect(existsSync(bundle)).toBe(false);expect(hash(f.path)).toBe(before);}finally{lock.release();}
 });
 it("does not initialize a missing source directory",async()=>{
  const directory=join(root(),"missing");await expect(createLocalDatabaseBackup(directory,join(root(),"bundle"))).rejects.toThrow();expect(existsSync(directory)).toBe(false);
 });
 it("previews restoration without creating a target and requires explicit execution confirmation",async()=>{
  const f=fixture(),bundle=join(root(),"bundle"),target=join(root(),"restored");await createLocalDatabaseBackup(f.directory,bundle);
  expect(restoreLocalDatabase(bundle,target)).toMatchObject({applied:false,reconciliationRequired:true});expect(existsSync(target)).toBe(false);
  expect(()=>restoreLocalDatabase(bundle,target,{execute:true})).toThrowError(expect.objectContaining({code:"RESTORE_CONFIRMATION_REQUIRED"}));expect(existsSync(target)).toBe(false);
 });
 it("restores only a new copy behind both barriers and does not downgrade the source archive",async()=>{
  const f=fixture(5),bundle=join(root(),"bundle"),target=join(root(),"restored");await createLocalDatabaseBackup(f.directory,bundle);const before=hash(join(bundle,"dispatcher.sqlite")),sourceBefore=hash(f.path);
  expect(restoreLocalDatabase(bundle,target,{execute:true,confirmed:true})).toMatchObject({applied:true,reconciliationRequired:true});expect(inspectDispatcherDatabase(join(target,"dispatcher.sqlite"))).toMatchObject({schemaVersion:19,reconciliationRequired:true,integrity:true});expect(existsSync(join(target,"dispatcher.sqlite.restore-pending"))).toBe(true);expect(()=>new DispatcherDatabase(join(target,"dispatcher.sqlite"))).toThrowError(expect.objectContaining({code:"RESTORE_RECONCILIATION_REQUIRED"}));expect(hash(join(bundle,"dispatcher.sqlite"))).toBe(before);
  expect(()=>restoreLocalDatabase(bundle,f.directory,{execute:true,confirmed:true})).toThrow();expect(hash(f.path)).toBe(sourceBefore);
 });
 it("rejects archive tampering before creating target data",async()=>{
  const f=fixture(),bundle=join(root(),"bundle"),target=join(root(),"restored");await createLocalDatabaseBackup(f.directory,bundle);writeFileSync(join(bundle,"dispatcher.sqlite"),"tampered bytes");expect(()=>restoreLocalDatabase(bundle,target,{execute:true,confirmed:true})).toThrowError(expect.objectContaining({code:"BACKUP_CHECKSUM_MISMATCH"}));expect(existsSync(target)).toBe(false);
 });
 it("exposes the same preview/prepare workflow through the actual CLI without starting Controller",()=>{
  const f=fixture(),bundle=join(root(),"bundle"),target=join(root(),"restored"),cli=fileURLToPath(new URL("../src/cli.ts",import.meta.url));
  const run=(args:string[])=>spawnSync(process.execPath,["--import","tsx",cli,...args],{timeout:5000});const backup=run(["backup","--data-dir",f.directory,"--out",bundle]);expect(backup.status,backup.stderr.toString()).toBe(0);expect(JSON.parse(backup.stdout.toString())).toMatchObject({scope:"database-only"});
  const preview=run(["restore","--bundle",bundle,"--target-data-dir",target]);expect(preview.status,preview.stderr.toString()).toBe(0);expect(JSON.parse(preview.stdout.toString())).toMatchObject({applied:false,reconciliationRequired:true});expect(existsSync(target)).toBe(false);
  const execute=run(["restore","--bundle",bundle,"--target-data-dir",target,"--execute","--confirm"]);expect(execute.status,execute.stderr.toString()).toBe(0);expect(JSON.parse(execute.stdout.toString())).toMatchObject({applied:true,reconciliationRequired:true});
 });
});
