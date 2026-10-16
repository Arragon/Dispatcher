import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { CodexCliBackend, SpawnCliAgentBackend } from "../src/index.js";
function alive(pid:number):boolean {try{process.kill(pid,0);return true;}catch{return false;}}
it.each(["codex","structured"] as const)("awaits actual owned descendant termination when cancelling %s",async(kind)=>{
  const root=mkdtempSync(join(tmpdir(),"native-group-")),ready=join(root,"child.pid");
  const descendant=`process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>{},1000)`;
  const body=`require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'}).unref();process.on('SIGTERM',()=>{});setInterval(()=>{},1000)`;
  const executable=join(root,"native");writeFileSync(executable,`#!${process.execPath}\n${body}`);chmodSync(executable,0o700);
  const turn=kind==="codex"?new CodexCliBackend().start({executable,codexHome:root,workspacePath:root,prompt:"fixture"}):new SpawnCliAgentBackend().start({executable:process.execPath,args:["-e",body],workspacePath:root});
  let pid:number|undefined;
  try{
    await vi.waitFor(()=>expect(existsSync(ready)).toBe(true));pid=Number(readFileSync(ready,"utf8"));
    expect(await Promise.race([turn.cancel().then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),3000))])).toBe(true);
    expect(alive(pid)).toBe(false);expect(await turn.result()).toMatchObject({state:"cancelled"});
  }finally{for(const owned of [pid,turn.processId])if(owned&&alive(owned))process.kill(owned,"SIGKILL");await turn.cancel();rmSync(root,{recursive:true,force:true});}
});
it.each(["codex","structured"] as const)("drains background descendants before reporting normal %s completion",async(kind)=>{
  const root=mkdtempSync(join(tmpdir(),"native-exit-group-")),ready=join(root,"child.pid");
  const descendant=`process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>{},1000)`;
  const body=`require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'}).unref();const t=setInterval(()=>{if(require('node:fs').existsSync(${JSON.stringify(ready)})){console.log(JSON.stringify({type:'thread.started',thread_id:'native'}));console.log(JSON.stringify({type:'turn.completed'}));clearInterval(t);process.exit(0);}},10)`;
  const executable=join(root,"native");writeFileSync(executable,`#!${process.execPath}\n${body}`);chmodSync(executable,0o700);
  const turn=kind==="codex"?new CodexCliBackend().start({executable,codexHome:root,workspacePath:root,prompt:"fixture"}):new SpawnCliAgentBackend().start({executable:process.execPath,args:["-e",body],workspacePath:root});
  let pid:number|undefined;
  try{expect(await turn.result()).toMatchObject({state:"completed"});pid=Number(readFileSync(ready,"utf8"));expect(alive(pid)).toBe(false);}
  finally{if(pid&&alive(pid))process.kill(pid,"SIGKILL");await turn.cancel();rmSync(root,{recursive:true,force:true});}
});
