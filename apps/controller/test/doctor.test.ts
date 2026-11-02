import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {mkdtempSync,readFileSync,readdirSync,rmSync,symlinkSync,writeFileSync,existsSync} from "node:fs";
import type * as FileSystem from "node:fs";
import type {BigIntStats} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {afterEach,describe,expect,it,vi} from "vitest";
import {DispatcherDatabase,migrations} from "@dispatcher/persistence";
import {inspectLocalController} from "../src/doctor.js";
import {acquireInstanceLock} from "@dispatcher/persistence";

const roots:string[]=[];
const fault=vi.hoisted(()=>({active:false,calls:0}));
vi.mock("node:fs",async importOriginal=>{const fs=await importOriginal<typeof FileSystem>();return {...fs,fstatSync:(...args:Parameters<typeof fs.fstatSync>)=>{const value=fs.fstatSync(...args);if(fault.active&&args[1]?.bigint&&++fault.calls>1)return {...value,mtimeNs:BigInt((value as BigIntStats).mtimeNs)+1n};return value;}};});
afterEach(()=>{fault.active=false;fault.calls=0;for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function root(){const value=mkdtempSync(join(tmpdir(),"dispatcher-doctor-"));roots.push(value);return value;}
function bytes(directory:string){return Object.fromEntries(readdirSync(directory).sort().map(name=>[name,createHash("sha256").update(readFileSync(join(directory,name))).digest("hex")]));}
describe("read-only local doctor",()=>{
  it("reports an uninitialized directory without creating it or a database",()=>{
    const directory=join(root(),"uninitialized");expect(inspectLocalController(directory)).toMatchObject({state:"not-initialized",databaseIntegrity:null,executionReadiness:"not-assessed"});expect(existsSync(directory)).toBe(false);
  });
  it.each([3,5,7,8,9,10,11,12,13,14,15,16,17,18])("inspects schema %s without migration, trigger changes or source byte changes",version=>{
    const directory=root(),db=new DispatcherDatabase(join(directory,"dispatcher.sqlite"),migrations.slice(0,version));db.saveEntity("private","sensitive-id",{token:"private-doctor-canary"});db.close();const before=bytes(directory),result=inspectLocalController(directory);
    expect(result).toMatchObject({state:version===18?"inspection-complete":"upgrade-required",schemaVersion:version,upgradeRequired:version<18,databaseIntegrity:true,executionReadiness:"not-assessed"});expect(JSON.stringify(result)).not.toMatch(/private-doctor-canary|sensitive-id/);expect(bytes(directory)).toEqual(before);
  });
  it.each(["restore","archive"])("keeps the %s filesystem barrier and does not open incomplete data",kind=>{
    const directory=root();writeFileSync(join(directory,"dispatcher.sqlite"),"incomplete data");writeFileSync(join(directory,kind==="restore"?"dispatcher.sqlite.restore-pending":".dispatcher-archive"),"preserve barrier");const before=bytes(directory);
    expect(inspectLocalController(directory)).toMatchObject({state:kind==="restore"?"reconciliation-required":"archive",databaseIntegrity:null,requiresAttention:true});expect(bytes(directory)).toEqual(before);
  });
  it("rejects a database symlink without following or editing its target",()=>{
    const directory=root(),target=join(root(),"private-target");writeFileSync(target,"preserve me");symlinkSync(target,join(directory,"dispatcher.sqlite"));expect(inspectLocalController(directory)).toMatchObject({state:"inspection-failed",reasonCode:"DATABASE_PATH_UNSAFE"});expect(readFileSync(target,"utf8")).toBe("preserve me");
  });
  it("returns sanitized failure metadata for corrupt source data",()=>{
    const directory=root();writeFileSync(join(directory,"dispatcher.sqlite"),"sensitive corrupt content");const before=bytes(directory),report=inspectLocalController(directory);expect(report).toMatchObject({state:"inspection-failed",requiresAttention:true});expect(JSON.stringify(report)).not.toContain("sensitive corrupt content");expect(bytes(directory)).toEqual(before);
  });
  it("fails closed when source metadata changes during diagnostic copying",()=>{
    const directory=root(),db=new DispatcherDatabase(join(directory,"dispatcher.sqlite"));db.close();const before=bytes(directory);fault.active=true;
    expect(inspectLocalController(directory)).toMatchObject({state:"inspection-failed",reasonCode:"DIAGNOSTIC_SOURCE_CHANGED",requiresAttention:true});fault.active=false;expect(bytes(directory)).toEqual(before);
  });
  it("preserves a rollback journal for the owning binary instead of attempting recovery",()=>{
    const directory=root(),db=new DispatcherDatabase(join(directory,"dispatcher.sqlite"));db.close();writeFileSync(join(directory,"dispatcher.sqlite-journal"),"unsettled journal");const before=bytes(directory);expect(inspectLocalController(directory)).toMatchObject({state:"inspection-failed",reasonCode:"DIAGNOSTIC_SOURCE_BUSY"});expect(bytes(directory)).toEqual(before);
  });
  it("rejects an unsupported future schema without rewriting it",()=>{
    const directory=root(),db=new DispatcherDatabase(join(directory,"dispatcher.sqlite"));db.handle.prepare("INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,'future',?)").run(migrations.at(-1)!.version+1,new Date().toISOString());db.close();const before=bytes(directory);expect(inspectLocalController(directory)).toMatchObject({state:"inspection-failed",reasonCode:"DATABASE_SCHEMA_UNSUPPORTED"});expect(bytes(directory)).toEqual(before);
  });
  it("reads committed WAL state through an isolated CLI snapshot while preserving source WAL and SHM",()=>{
    const directory=root(),db=new DispatcherDatabase(join(directory,"dispatcher.sqlite"));db.writeCanonicalTask("committed",0,{id:"committed",title:"private WAL canary"});const before=bytes(directory);
    try{const cli=fileURLToPath(new URL("../src/cli.ts",import.meta.url)),result=spawnSync(process.execPath,["--import","tsx",cli,"doctor","--data-dir",directory],{timeout:5000});expect(result.status,result.stderr.toString()).toBe(0);expect(JSON.parse(result.stdout.toString())).toMatchObject({state:"inspection-complete",inventory:{tasks:1},executionReadiness:"not-assessed"});expect(result.stdout.toString()).not.toContain("private WAL canary");expect(bytes(directory)).toEqual(before);}finally{db.close();}
  });
  it("runs CLI doctor against a directory owned by a running Controller without acquiring writer ownership",()=>{
    const directory=root(),db=new DispatcherDatabase(join(directory,"dispatcher.sqlite"));db.close();const lock=acquireInstanceLock(directory),before=bytes(directory);
    try{const cli=fileURLToPath(new URL("../src/cli.ts",import.meta.url)),result=spawnSync(process.execPath,["--import","tsx",cli,"doctor","--data-dir",directory],{timeout:5000});expect(result.status,result.stderr.toString()).toBe(0);expect(JSON.parse(result.stdout.toString())).toMatchObject({state:"inspection-complete",databaseIntegrity:true,executionReadiness:"not-assessed"});expect(bytes(directory)).toEqual(before);}finally{lock.release();}
  });
});
