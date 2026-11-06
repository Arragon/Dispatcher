import {execFileSync} from "node:child_process";
import {existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,statSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach,expect,it} from "vitest";
import {copyStageWorkspace,requireCleanSource} from "../../../scripts/stage-controller.mjs";

const roots:string[]=[];function root(){const path=realpathSync(mkdtempSync(join(tmpdir(),"dispatcher-stage-copy-")));roots.push(path);return path;}
afterEach(()=>{for(const path of roots.splice(0))rmSync(path,{recursive:true,force:true});});
function fixture(){const source=root();for(const name of ["apps/controller/src","apps/controller/dist","node_modules",".dispatcher"])mkdirSync(join(source,name),{recursive:true});
 for(const name of ["package.json","pnpm-lock.yaml","pnpm-workspace.yaml","apps/controller/package.json"])writeFileSync(join(source,name),"{}");
 writeFileSync(join(source,"apps/controller/src/owned.ts"),"export const value=1");writeFileSync(join(source,"apps/controller/dist/cli.js"),"console.log('built')");
 writeFileSync(join(source,"node_modules/.pnpm-workspace-state-v1.json"),"preserve development cache");writeFileSync(join(source,".dispatcher/dispatcher.sqlite"),"private state");writeFileSync(join(source,".npmrc"),"private registry fixture");
 return {source,tracked:["package.json","pnpm-lock.yaml","pnpm-workspace.yaml",".npmrc","apps/controller/package.json","apps/controller/src/owned.ts"],workspace:join(root(),"workspace")};
}
it("copies only tracked package source and built output into a separate workspace",()=>{
 const f=fixture();copyStageWorkspace(f.source,f.workspace,f.tracked);expect(readFileSync(join(f.workspace,"apps/controller/src/owned.ts"),"utf8")).toContain("value=1");expect(readFileSync(join(f.workspace,"apps/controller/dist/cli.js"),"utf8")).toContain("built");expect(statSync(join(f.workspace,"apps/controller/dist/cli.js")).nlink).toBe(1);expect(existsSync(join(f.workspace,"node_modules"))).toBe(false);expect(existsSync(join(f.workspace,".dispatcher"))).toBe(false);expect(existsSync(join(f.workspace,".npmrc"))).toBe(false);expect(readFileSync(join(f.source,"node_modules/.pnpm-workspace-state-v1.json"),"utf8")).toBe("preserve development cache");
});
it("rejects an existing staging workspace and preserves its local contents",()=>{
 const f=fixture();mkdirSync(f.workspace);writeFileSync(join(f.workspace,"local.txt"),"do not replace");expect(()=>copyStageWorkspace(f.source,f.workspace,f.tracked)).toThrow();expect(readFileSync(join(f.workspace,"local.txt"),"utf8")).toBe("do not replace");
});
it("rejects persistent data in build output before copying its bytes",()=>{
 const f=fixture();writeFileSync(join(f.source,"apps/controller/dist/dispatcher.sqlite"),"preserved build-side data");expect(()=>copyStageWorkspace(f.source,f.workspace,f.tracked)).toThrow("RELEASE_PERSISTED_STATE");expect(existsSync(join(f.workspace,"apps/controller/dist/dispatcher.sqlite"))).toBe(false);expect(readFileSync(join(f.source,"apps/controller/dist/dispatcher.sqlite"),"utf8")).toBe("preserved build-side data");
});
it("rejects path traversal in a supplied tracked-file list",()=>{const f=fixture();expect(()=>copyStageWorkspace(f.source,f.workspace,["../outside"])).toThrow("RELEASE_SOURCE_PATH_UNSAFE");});
it("requires a committed clean source and leaves a dirty checkout intact",()=>{
 const source=root(),git=(args:string[])=>execFileSync("git",args,{cwd:source,stdio:"pipe"});git(["init","--quiet"]);writeFileSync(join(source,"package.json"),"{}");git(["add","package.json"]);git(["-c","user.name=Fixture","-c","user.email=fixture@example.invalid","-c","commit.gpgsign=false","commit","--quiet","-m","fixture"]);expect(requireCleanSource(source)).toMatch(/^[a-f0-9]{40}$/);writeFileSync(join(source,"package.json"),'{"private":true}');expect(()=>requireCleanSource(source)).toThrow("RELEASE_SOURCE_DIRTY");expect(readFileSync(join(source,"package.json"),"utf8")).toBe('{"private":true}');
});

it("copies flat and nested Controller capability JSON assets without development cache or persisted state",()=>{const f=fixture(),payload='{"version":1,"rows":[]}';mkdirSync(join(f.source,"apps/controller/dist/nested"));for(const name of ["profile-capability-history.json","nested/profile-capability-history.json"])writeFileSync(join(f.source,"apps/controller/dist",name),payload);copyStageWorkspace(f.source,f.workspace,f.tracked);for(const name of ["profile-capability-history.json","nested/profile-capability-history.json"]){const path=join(f.workspace,"apps/controller/dist",name);expect(readFileSync(path,"utf8")).toBe(payload);expect(statSync(path).nlink).toBe(1);const destination=process.env.DISPATCHER_PROFILE_CAPABILITY_UI_FIXTURE_EVIDENCE;if(destination){mkdirSync(destination,{recursive:true});writeFileSync(join(destination,`stage-asset-${name.replaceAll("/","-")}`),readFileSync(path));}}expect(existsSync(join(f.workspace,"node_modules"))).toBe(false);expect(existsSync(join(f.workspace,".dispatcher"))).toBe(false);expect(readFileSync(join(f.source,"node_modules/.pnpm-workspace-state-v1.json"),"utf8")).toBe("preserve development cache");});
