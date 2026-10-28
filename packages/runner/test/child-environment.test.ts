import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProcessManager, VerificationRegistry } from "../src/index.js";

afterEach(() => vi.unstubAllEnvs());
it("keeps Controller credentials out of real process, PTY and registered verification children", async () => {
  vi.stubEnv("DISPATCHER_OWNER_TOKEN", "fixture-owner-canary"); vi.stubEnv("DISPATCHER_SECRET_STORE_KEY", "fixture-key-canary"); vi.stubEnv("PROVIDER_FIXTURE_CONTEXT", "preserved");
  const root = realpathSync(mkdtempSync(join(tmpdir(), "child-environment-"))), manager = new ProcessManager(join(root, "logs"));
  const code = "if(Object.keys(process.env).some(k=>['DISPATCHER_OWNER_TOKEN','DISPATCHER_SECRET_STORE_KEY'].includes(k.toUpperCase())))process.exit(71);if(process.env.PROVIDER_FIXTURE_CONTEXT!=='preserved'||process.env.PWD!==process.cwd())process.exit(72);console.log('safe-child-context')";
  try {
    for (const mode of ["process", "pty"] as const) {
      const handle = await manager.start({ runId: mode, file: process.execPath, args: ["-e", code], cwd: root, mode });
      expect(await handle.result()).toMatchObject({ classification: "success", exitCode: 0 });
    }
    const registry = new VerificationRegistry(); registry.register({ id: "environment", file: process.execPath, args: ["-e", code], required: true, timeoutMs: 3000, outputLimitBytes: 256 });
    expect(await registry.run("environment", root)).toMatchObject({ status: "passed", output: expect.stringContaining("safe-child-context") });
  } finally { await manager.shutdown(); rmSync(root, { recursive: true, force: true }); }
});

import {execFileSync} from "node:child_process";
import {cpSync,mkdirSync,writeFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
it.each(["directory", "index", "config"] as const)("binds a real verifier to its cwd despite inherited Git %s selectors",async selector=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'verification-git-environment-'))),actual=join(root,'actual'),foreign=join(root,'foreign');
 const git=(cwd:string,...args:string[])=>execFileSync('git',args,{cwd,stdio:'pipe'});
 for(const path of [actual,foreign]){mkdirSync(path);git(path,'init','--initial-branch=main');git(path,'config','user.name','Fixture');git(path,'config','user.email','fixture@example.invalid');writeFileSync(join(path,'tracked.txt'),path);git(path,'add','.');git(path,'commit','-m','baseline');}
 const inherited=selector==='directory'?{GIT_DIR:join(foreign,'.git'),GIT_WORK_TREE:foreign}:selector==='index'?{GIT_INDEX_FILE:join(root,'foreign-index')}:{GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'core.bare',GIT_CONFIG_VALUE_0:'true'};
 for(const [key,value] of Object.entries(inherited))vi.stubEnv(key,value);
 vi.stubEnv('gIt_Fixture_Selector','owned-mixed-case');
 vi.stubEnv('DISPATCHER_OWNER_TOKEN','fixture-owner-canary');vi.stubEnv('dispatcher_secret_store_key','fixture-key-canary');vi.stubEnv('PROVIDER_FIXTURE_CONTEXT','preserved');
 const script="const cp=require('node:child_process');let top,index,error;try{top=cp.execFileSync('git',['rev-parse','--show-toplevel'],{stdio:'pipe'}).toString().trim();index=cp.execFileSync('git',['ls-files'],{stdio:'pipe'}).toString().trim()}catch(e){error=String(e)}console.log(JSON.stringify({cwd:process.cwd(),pwd:process.env.PWD,top,index,error,gitKeys:Object.keys(process.env).filter(k=>k.toUpperCase().startsWith('GIT_')),secretKeys:Object.keys(process.env).filter(k=>['DISPATCHER_OWNER_TOKEN','DISPATCHER_SECRET_STORE_KEY'].includes(k.toUpperCase())),provider:process.env.PROVIDER_FIXTURE_CONTEXT}))";
 const registry=new VerificationRegistry();registry.register({id:'git-isolation',file:process.execPath,args:['-e',script],required:true,timeoutMs:3000,outputLimitBytes:4096});
 let result;
 try{
  result=await registry.run('git-isolation',actual);expect(result.status).toBe('passed');
  const facts=JSON.parse(result.output);
  expect(facts).toEqual({cwd:actual,pwd:actual,top:actual,index:'tracked.txt',gitKeys:[],secretKeys:[],provider:'preserved'});
 }finally{
  const evidence=process.env.DISPATCHER_CANONICAL_SNAPSHOT_EVIDENCE;
  if(evidence){const retained=join(evidence,'runner-'+selector+'-'+randomUUID());mkdirSync(retained,{recursive:true});cpSync(root,join(retained,'closed-tree'),{recursive:true});writeFileSync(join(retained,'operations.json'),JSON.stringify({selector,inherited,command:registry.list(),cwd:actual,result},null,2));}
  rmSync(root,{recursive:true,force:true});
 }
});
