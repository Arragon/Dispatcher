import {linkSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,renameSync,rmSync,symlinkSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname,join} from "node:path";
import {afterEach,describe,expect,it} from "vitest";
import {createControllerReleaseManifest,detachReleaseHardlinks,inspectReleaseRuntime,verifyControllerRelease} from "../src/release-manifest.js";

const roots:string[]=[];function root(){const value=realpathSync(mkdtempSync(join(tmpdir(),"dispatcher-release-")));roots.push(value);return value;}
afterEach(()=>{for(const path of roots.splice(0))rmSync(path,{recursive:true,force:true});});
function fixture(){const directory=root(),runtime=join(directory,"runtime");mkdirSync(join(runtime,"dist"),{recursive:true});writeFileSync(join(runtime,"package.json"),JSON.stringify({name:"@dispatcher/controller",type:"module"}));writeFileSync(join(runtime,"dist","cli.js"),'export {};\n');return {directory,runtime};}
const metadata=()=>({sourceSha:"a".repeat(40),nodePath:realpathSync(process.execPath),nodeVersion:process.versions.node,pnpmVersion:"11.19.0",lockSha256:"b".repeat(64),deployedLockSha256:"c".repeat(64),platform:process.platform,architecture:process.arch,schemaVersion:8,writerProtocol:4});
function seal(f:ReturnType<typeof fixture>){const manifest=createControllerReleaseManifest(f.runtime,metadata());writeFileSync(join(f.directory,"release.json"),JSON.stringify(manifest),{mode:0o600});return manifest;}
describe("fixed Controller release closure",()=>{
 it("seals real file bytes and relative links and remains valid after moving the release",()=>{
  const f=fixture();symlinkSync("cli.js",join(f.runtime,"dist","alias.js"));const manifest=seal(f);expect(manifest.runtime.files.length).toBe(3);expect(verifyControllerRelease(f.directory)).toMatchObject({manifest:{sourceSha:"a".repeat(40)},cliPath:join(f.runtime,"dist","cli.js")});const moved=join(root(),"moved");renameSync(f.directory,moved);expect(verifyControllerRelease(moved).cliPath).toBe(join(moved,"runtime","dist","cli.js"));
 });
 it("rejects a link that escapes to a worktree despite a valid runtime entrypoint",()=>{
  const f=fixture(),outside=join(root(),"dependency.js");writeFileSync(outside,"external source");symlinkSync(outside,join(f.runtime,"dependency.js"));expect(()=>inspectReleaseRuntime(f.runtime)).toThrow("RELEASE_SYMLINK_ESCAPE");
 });
 it("rejects absolute internal links that cannot survive relocation",()=>{
  const f=fixture();symlinkSync(join(f.runtime,"dist","cli.js"),join(f.runtime,"absolute.js"));expect(()=>inspectReleaseRuntime(f.runtime)).toThrow("RELEASE_ABSOLUTE_SYMLINK");
 });
 it("refuses a substituted runtime root before detaching or reading its external files",()=>{
  const f=fixture(),external=join(root(),"external");renameSync(f.runtime,external);symlinkSync(external,f.runtime);expect(()=>detachReleaseHardlinks(f.runtime)).toThrow("RELEASE_PATH_UNSAFE");expect(()=>inspectReleaseRuntime(f.runtime)).toThrow("RELEASE_PATH_UNSAFE");expect(readFileSync(join(external,"dist","cli.js"),"utf8")).toBe('export {};\n');
 });
 it("detaches hardlinks before sealing so later source edits do not change the release",()=>{
  const f=fixture(),source=join(root(),"source.js"),copied=join(f.runtime,"linked.js");writeFileSync(source,"frozen bytes");linkSync(source,copied);expect(()=>inspectReleaseRuntime(f.runtime)).toThrow("RELEASE_HARDLINK_SHARED");detachReleaseHardlinks(f.runtime);seal(f);writeFileSync(source,"changed source");expect(readFileSync(copied,"utf8")).toBe("frozen bytes");expect(verifyControllerRelease(f.directory).manifest.sourceSha).toBe("a".repeat(40));
 });
 it.each(["dispatcher.sqlite","secrets.enc",".env",".npmrc"])("refuses to seal persisted or credential material %s",name=>{
  const f=fixture();writeFileSync(join(f.runtime,name),"private state");expect(()=>inspectReleaseRuntime(f.runtime)).toThrow("RELEASE_PERSISTED_STATE");
 });
 it("detects tampering, added files and incomplete preparation without executing code",()=>{
  const f=fixture();seal(f);writeFileSync(join(f.runtime,"dist","cli.js"),"throw Error('do not run');");expect(()=>verifyControllerRelease(f.directory)).toThrow("RELEASE_CONTENT_CHANGED");writeFileSync(join(f.runtime,"dist","cli.js"),'export {};\n');writeFileSync(join(f.runtime,"unexpected.js"),"added");expect(()=>verifyControllerRelease(f.directory)).toThrow("RELEASE_CONTENT_CHANGED");rmSync(join(f.runtime,"unexpected.js"));writeFileSync(join(f.directory,"release-preparing.json"),"{}");expect(()=>verifyControllerRelease(f.directory)).toThrow("RELEASE_NOT_READY");
 });
 it("rejects a mismatched runtime host and leaves every artifact intact",()=>{
  const f=fixture(),manifest=seal(f);writeFileSync(join(f.directory,"release.json"),JSON.stringify({...manifest,platform:"different-host"}));const before=readdirSync(f.runtime);expect(()=>verifyControllerRelease(f.directory)).toThrow("RELEASE_RUNTIME_MISMATCH");expect(readdirSync(f.runtime)).toEqual(before);expect(dirname(f.runtime)).toBe(f.directory);
 });
});
