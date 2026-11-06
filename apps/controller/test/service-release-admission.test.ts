import {spawnSync} from "node:child_process";
import {existsSync,mkdirSync,mkdtempSync,realpathSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {afterEach,expect,it} from "vitest";
import {createControllerReleaseManifest} from "../src/release-manifest.js";

const roots:string[]=[];function root(){const value=realpathSync(mkdtempSync(join(tmpdir(),"dispatcher-service-admission-")));roots.push(value);return value;}
afterEach(()=>{for(const path of roots.splice(0))rmSync(path,{recursive:true,force:true});});
const cli=fileURLToPath(new URL("../src/cli.ts",import.meta.url));
function fixture(){const directory=root(),runtime=join(directory,"runtime");mkdirSync(join(runtime,"dist"),{recursive:true});writeFileSync(join(runtime,"package.json"),'{"name":"@dispatcher/controller"}');writeFileSync(join(runtime,"dist","cli.js"),'export {};\n');const manifest=createControllerReleaseManifest(runtime,{sourceSha:"a".repeat(40),nodePath:realpathSync(process.execPath),nodeVersion:process.versions.node,pnpmVersion:"11.19.0",lockSha256:"b".repeat(64),deployedLockSha256:"c".repeat(64),platform:process.platform,architecture:process.arch,schemaVersion:8,writerProtocol:4,releaseAdmissionVersion:1});writeFileSync(join(directory,"release.json"),JSON.stringify(manifest));return directory;}
it("rejects a stale launch environment before data initialization, migration or native startup",()=>{
 const directory=fixture(),data=join(root(),"not-created"),result=spawnSync(process.execPath,["--import","tsx",cli,"serve","--data-dir",data,"--port","0"],{timeout:5000,env:{...process.env,DISPATCHER_OWNER_TOKEN:"fixture-service-owner",DISPATCHER_RELEASE_DIRECTORY:directory,DISPATCHER_RELEASE_SHA:"d".repeat(40)}});
 expect(result.status,result.stderr.toString()).toBe(1);expect(result.stderr.toString()).toContain("RELEASE_BINDING_CHANGED");expect(existsSync(data)).toBe(false);
});
it("rejects a partial release environment before creating the data directory",()=>{
 const data=join(root(),"not-created"),result=spawnSync(process.execPath,["--import","tsx",cli,"serve","--data-dir",data,"--port","0"],{timeout:5000,env:{...process.env,DISPATCHER_OWNER_TOKEN:"fixture-service-owner",DISPATCHER_RELEASE_DIRECTORY:root(),DISPATCHER_RELEASE_SHA:""}});
 expect(result.status,result.stderr.toString()).toBe(1);expect(result.stderr.toString()).toContain("RELEASE_BINDING_INVALID");expect(existsSync(data)).toBe(false);
});
it("reports startup contract read-only even when the launch environment needs reconciliation",()=>{
 const data=join(root(),"not-created"),result=spawnSync(process.execPath,["--import","tsx",cli,"runtime-contract","--data-dir",data],{timeout:5000,env:{...process.env,DISPATCHER_RELEASE_DIRECTORY:root(),DISPATCHER_RELEASE_SHA:""}});
 expect(result.status,result.stderr.toString()).toBe(0);expect(JSON.parse(result.stdout.toString())).toEqual({releaseAdmissionVersion:1,scope:"controller-release-startup"});expect(existsSync(data)).toBe(false);
});
