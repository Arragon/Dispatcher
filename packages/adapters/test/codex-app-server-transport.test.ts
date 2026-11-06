import {chmodSync,existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import * as adapters from "../src/codex-app-server.js";
import type {CodexRpcRequest,CodexRpcTransport} from "../src/codex-app-server.js";
const directories:string[]=[],connections:CodexRpcTransport[]=[];
let root:string;
beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),"dispatcher-codex-stdio-")));directories.push(root);});
afterEach(async()=>{vi.unstubAllEnvs();for(const connection of connections.splice(0))await connection.close();for(const path of directories.splice(0))rmSync(path,{recursive:true,force:true});});
const scope={profileId:"p",runnerId:"local",nativeStoreRef:"native-store:fixture",scopeFingerprint:"tuple",executionRefId:"execution",executable:"/unused",codexHome:"/unused",workspacePath:"/unused",approvalPolicy:"on-request" as const,sandbox:"read-only" as const};
describe("Codex owned stdio transport",()=>{
  const executable=(reply:string)=>{
    const path=join(root,`codex-fixture-${Math.random().toString(36).slice(2)}.cjs`);
    writeFileSync(path,`#!/usr/bin/env node\nif(process.argv.includes('--version')){console.log('codex-cli 0.166.0-alpha.6');process.exit(0);} const rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',line=>{const request=JSON.parse(line);${reply}});`,{mode:0o755});return path;
  };
  it("rejects a malformed error instead of losing its pending request forever",async()=>{
    const rpc=await adapters.CodexStdioTransport.open({...scope,codexHome:root,workspacePath:root,executable:executable(`console.log(JSON.stringify({id:request.id,error:'malformed'}));`)});
    try{await expect(rpc.request("thread/read",{threadId:"t"})).rejects.toMatchObject({code:"CODEX_PROTOCOL_INVALID"});}finally{await rpc.close();}
  });
  it("reports unsupported methods without exposing native diagnostic contents",async()=>{
    const rpc=await adapters.CodexStdioTransport.open({...scope,codexHome:root,workspacePath:root,executable:executable(`console.log(JSON.stringify({id:request.id,error:{code:-32601,message:'secret-do-not-leak'}}));`)});
    try{await expect(rpc.request("thread/turns/list",{})).rejects.toMatchObject({code:"CODEX_METHOD_UNSUPPORTED",message:"Codex native request was rejected"});}finally{await rpc.close();}
  });
});

function script(source:string){const root=realpathSync(mkdtempSync(join(tmpdir(),"dispatcher-codex-native-")));directories.push(root);const executable=join(root,"codex-fixture");writeFileSync(executable,`#!/usr/bin/env node\n${source}`);chmodSync(executable,0o700);return {root,executable};}
const localScope=(fixture:ReturnType<typeof script>)=>({profileId:"p",runnerId:"local",nativeStoreRef:"native-store:process-fixture",scopeFingerprint:"process-fixture",executionRefId:"execution",executable:fixture.executable,codexHome:fixture.root,workspacePath:fixture.root,approvalPolicy:"on-request" as const,sandbox:"read-only" as const});
const localVersion="if(process.argv.includes('--version')){console.log('codex-cli 0.166.0-alpha.6');process.exit(0);}";
async function protocol(reply:string){const f=script(`${localVersion}const fs=require('node:fs'),rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',line=>{const request=JSON.parse(line);${reply}});`),rpc=await adapters.CodexStdioTransport.open(localScope(f));connections.push(rpc);return {...f,rpc};}

it("closes only the captured local root while a second owned host remains alive",async()=>{
 const a=script(`${localVersion}require('node:fs').writeFileSync('root.pid',String(process.pid));setInterval(()=>{},1000);`),b=script(`${localVersion}require('node:fs').writeFileSync('root.pid',String(process.pid));setInterval(()=>{},1000);`);
 const first=await adapters.CodexStdioTransport.open(localScope(a)),second=await adapters.CodexStdioTransport.open(localScope(b));
 try{await vi.waitFor(()=>expect(existsSync(join(a.root,"root.pid"))&&existsSync(join(b.root,"root.pid"))).toBe(true));
  const pid=Number(readFileSync(join(a.root,"root.pid"),"utf8")),peer=Number(readFileSync(join(b.root,"root.pid"),"utf8"));
  expect(await first.disconnectLocal()).toMatchObject({connection:"closed",ownedRoot:"exited",ownedRootPid:pid,backgroundTools:"unknown",nativeSessionDeleted:false});expect(()=>process.kill(pid,0)).toThrow();expect(()=>process.kill(peer,0)).not.toThrow();
 }finally{await first.close();await second.close();}
});
it("reports root exit without claiming an inherited background pipe or child was stopped",async()=>{
 const fixture=script(`${localVersion}const fs=require('node:fs');const child=require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>process.exit(0),10000);setInterval(()=>{},1000)'],{detached:true,stdio:['ignore','inherit','inherit']});fs.writeFileSync('child.pid',String(child.pid));setInterval(()=>{},1000);`);
 const transport=await adapters.CodexStdioTransport.open(localScope(fixture));let child:number|undefined;
 try{await vi.waitFor(()=>expect(existsSync(join(fixture.root,"child.pid"))).toBe(true));child=Number(readFileSync(join(fixture.root,"child.pid"),"utf8"));expect(Number.isSafeInteger(child)&&child>0).toBe(true);
  const started=Date.now();expect(await transport.disconnectLocal()).toMatchObject({connection:"closed",ownedRoot:"exited",backgroundTools:"unknown",nativeSessionDeleted:false});expect(Date.now()-started).toBeLessThan(4_000);expect(()=>process.kill(child!,0)).not.toThrow();
 }finally{if(child===undefined&&existsSync(join(fixture.root,"child.pid")))child=Number(readFileSync(join(fixture.root,"child.pid"),"utf8"));if(child&&Number.isSafeInteger(child)&&child>0)try{process.kill(child,"SIGKILL");}catch{/* The owned fixture child may already have exited. */}await transport.close();}
});
it("finishes owned root cleanup even when a local disconnect observer throws",async()=>{
 const fixture=script(`${localVersion}require('node:fs').writeFileSync('root.pid',String(process.pid));setInterval(()=>{},1000);`),transport=await adapters.CodexStdioTransport.open(localScope(fixture));
 try{await vi.waitFor(()=>expect(existsSync(join(fixture.root,"root.pid"))).toBe(true));const pid=Number(readFileSync(join(fixture.root,"root.pid"),"utf8"));transport.onDisconnect(()=>{throw new Error("observer failed");});expect(await transport.disconnectLocal()).toMatchObject({ownedRoot:"exited",ownedRootPid:pid,backgroundTools:"unknown"});expect(()=>process.kill(pid,0)).toThrow();}finally{await transport.close();}
});


it.each(["home","cwd"] as const)("does not spawn app-server after %s replacement during the executable version probe",async kind=>{
 const home=join(root,"home"),cwd=join(root,"cwd"),path=kind==="home"?home:cwd,marker=join(root,"spawned"),executable=join(root,"codex.cjs");mkdirSync(home);mkdirSync(cwd);
  writeFileSync(executable,`#!${process.execPath}\nconst fs=require('node:fs');if(process.argv.includes('--version')){fs.renameSync(${JSON.stringify(path)},${JSON.stringify(`${path}-retained`)});fs.mkdirSync(${JSON.stringify(path)});console.log('codex-cli 0.166.0-alpha.6');}else{fs.writeFileSync(${JSON.stringify(marker)},'spawned');}`,{mode:0o755});
 await expect(adapters.CodexStdioTransport.open({...scope,codexHome:home,workspacePath:cwd,executable})).rejects.toMatchObject({creationOutcome:"not-created",code:"CODEX_SCOPE_CHANGED"});expect(existsSync(marker)).toBe(false);
});
it("keeps version and RPC native context while stripping Controller authority",async()=>{
 vi.stubEnv("DISPATCHER_OWNER_TOKEN","fake-owner-canary");vi.stubEnv("dispatcher_secret_store_key","fake-key-canary");vi.stubEnv("DISPATCHER_TEST_PROVIDER_CONTEXT","provider-context");
 const f=script(`const fs=require('node:fs');const kind=process.argv.includes('--version')?'version':'rpc';fs.appendFileSync(require('node:path').join(process.env.CODEX_HOME,'environment.jsonl'),JSON.stringify({kind,authority:Object.keys(process.env).some(key=>['DISPATCHER_OWNER_TOKEN','DISPATCHER_SECRET_STORE_KEY'].includes(key.toUpperCase())),provider:process.env.DISPATCHER_TEST_PROVIDER_CONTEXT,cwd:process.cwd(),pwd:process.env.PWD,home:process.env.CODEX_HOME})+'\\n');${localVersion}const rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',line=>{const request=JSON.parse(line);console.log(JSON.stringify({id:request.id,result:{ok:true}}));});`);
 const rpc=await adapters.CodexStdioTransport.open(localScope(f));connections.push(rpc);await rpc.request("thread/read",{threadId:"fixture"});
 expect(readFileSync(join(f.root,"environment.jsonl"),"utf8").trim().split("\n").map(value=>JSON.parse(value))).toEqual(["version","rpc"].map(kind=>({kind,authority:false,provider:"provider-context",cwd:f.root,pwd:f.root,home:f.root})));
});

it("bounds a TERM-resistant version probe and confirms owned exit before refusing RPC",async()=>{
 const f=script(`if(process.argv.includes('--version')){require('node:fs').writeFileSync(require('node:path').join(process.env.CODEX_HOME,'version.pid'),String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000);}else{require('node:fs').writeFileSync('spawned','yes');setInterval(()=>{},1000);}`),path=join(f.root,"version.pid");
 const pending=adapters.CodexStdioTransport.open(localScope(f)).then(value=>{connections.push(value);return "unexpected-rpc";},error=>error);let timer:ReturnType<typeof setTimeout>|undefined;
 try{const result=await Promise.race([pending,new Promise(resolve=>{timer=setTimeout(()=>resolve("still-pending"),6_500);})]);expect(result).toMatchObject({creationOutcome:"not-created",code:"CODEX_RUNTIME_UNAVAILABLE"});const pid=Number(readFileSync(path,"utf8"));expect(()=>process.kill(pid,0)).toThrow();expect(existsSync(join(f.root,"spawned"))).toBe(false);}
 finally{if(timer)clearTimeout(timer);if(existsSync(path)){const pid=Number(readFileSync(path,"utf8"));try{process.kill(pid,"SIGKILL");}catch{/* This fixture's owned probe already exited. */}}await pending;}
},8_000);

it("rejects pending reads when the root exits while a background child retains its pipes",async()=>{
 const pipes=()=>process.getActiveResourcesInfo().filter(type=>type==="PipeWrap").length,baseline=pipes();
 const f=script(`${localVersion}const fs=require('node:fs'),cp=require('node:child_process'),rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',()=>{const child=cp.spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:['ignore',1,2]});fs.writeFileSync('child.pid',String(child.pid));setTimeout(()=>process.exit(9),20);});`),rpc=await adapters.CodexStdioTransport.open(localScope(f));connections.push(rpc);let timer:ReturnType<typeof setTimeout>|undefined;
 try{const read=rpc.request("thread/read",{}).catch(error=>error);const result=await Promise.race([read,new Promise(resolve=>{timer=setTimeout(()=>resolve("still-pending"),1_000);})]);expect(result).toMatchObject({code:"CODEX_NATIVE_UNREACHABLE"});await vi.waitFor(()=>expect(pipes()).toBeLessThanOrEqual(baseline),{timeout:1_000});expect(await rpc.disconnectLocal()).toMatchObject({ownedRoot:"exited",backgroundTools:"unknown",nativeSessionDeleted:false});const pid=Number(readFileSync(join(f.root,"child.pid"),"utf8"));expect(()=>process.kill(pid,0)).not.toThrow();}
 finally{if(timer)clearTimeout(timer);if(existsSync(join(f.root,"child.pid"))){const pid=Number(readFileSync(join(f.root,"child.pid"),"utf8"));try{process.kill(pid,"SIGKILL");}catch{/* Only this fixture's captured child is cleaned. */}}await rpc.close();}
});

it("correlates reversed responses and preserves split UTF-8 and CRLF framing",async()=>{
 const {rpc}=await protocol(`if(request.method==='first')setTimeout(()=>console.log(JSON.stringify({id:request.id,result:{method:request.method}})),20);else {const frame=Buffer.from(JSON.stringify({id:request.id,result:{text:'甲🙂乙'}})+'\\r\\n'),cut=frame.indexOf(Buffer.from('甲'))+1;process.stdout.write(frame.subarray(0,cut));setTimeout(()=>process.stdout.write(frame.subarray(cut)),5);}`);
 const first=rpc.request("first",{}),second=rpc.request("second",{});expect(await second).toEqual({text:"甲🙂乙"});expect(await first).toEqual({method:"first"});
});

it("consumes the original callback once and only honors matching resolved notifications",async()=>{
 const {rpc,root}=await protocol(`if(request.method==='callback'){console.log(JSON.stringify({id:'native-1',method:'item/commandExecution/requestApproval',params:{threadId:'thread-1'}}));console.log(JSON.stringify({id:request.id,result:{}}));}else if(request.method==='resolved'){console.log(JSON.stringify({method:'serverRequest/resolved',params:request.params}));console.log(JSON.stringify({id:request.id,result:{}}));}else if(request.method==='again'){console.log(JSON.stringify({id:'native-2',method:'item/commandExecution/requestApproval',params:{threadId:'thread-1'}}));console.log(JSON.stringify({id:request.id,result:{}}));}else if(request.id==='native-1'){fs.writeFileSync('reply.tmp',JSON.stringify(request));fs.renameSync('reply.tmp','reply.json');}`),callbacks:CodexRpcRequest[]=[];
 rpc.onRequest(value=>callbacks.push(value));expect(()=>rpc.onRequest(()=>undefined)).toThrowError(expect.objectContaining({code:"CODEX_REQUEST_OWNER_CONFLICT"}));
 await rpc.request("callback",{});const callback=callbacks[0]!;expect(callback.isPending()).toBe(true);
 await rpc.request("resolved",{requestId:"native-1",threadId:"other"});expect(callback.isPending()).toBe(true);
 callback.respond({decision:"decline"});expect(callback.isPending()).toBe(false);expect(()=>callback.respond({decision:"accept"})).toThrowError(expect.objectContaining({code:"NATIVE_REQUEST_CONSUMED"}));
 await vi.waitFor(()=>expect(existsSync(join(root,"reply.json"))).toBe(true));expect(JSON.parse(readFileSync(join(root,"reply.json"),"utf8"))).toEqual({id:"native-1",result:{decision:"decline"}});
 await rpc.request("again",{});const other=callbacks[1]!;await rpc.request("resolved",{requestId:"native-2",threadId:"thread-1"});expect(other.isPending()).toBe(false);expect(()=>other.reject()).toThrowError(expect.objectContaining({code:"NATIVE_REQUEST_CONSUMED"}));
});

it("rejects an unowned callback instead of granting native permission",async()=>{
 const {rpc}=await protocol(`if(request.method==='callback')console.log(JSON.stringify({id:'native-unowned',method:'item/commandExecution/requestApproval',params:{threadId:'thread-1'}}));else if(request.id==='native-unowned')console.log(JSON.stringify({id:1,result:{rejection:request.error}}));`);
 expect(await rpc.request("callback",{})).toEqual({rejection:{code:-32601,message:"Native request is unavailable for this connection"}});
});

it("bounds pending requests and rejects every waiter on local disconnect",async()=>{
 const {rpc}=await protocol("void request;");const pending=Array.from({length:64},()=>rpc.request("thread/read",{})),outcomes=Promise.allSettled(pending);
 await expect(rpc.request("thread/read",{})).rejects.toMatchObject({code:"CODEX_REQUEST_LIMIT"});await rpc.close();expect((await outcomes).every(result=>result.status==="rejected"&&result.reason.code==="CODEX_NATIVE_UNREACHABLE")).toBe(true);
});

it("rejects an oversized unframed response and keeps native diagnostics private",async()=>{
 const {rpc}=await protocol("process.stderr.write('private-native-diagnostic');process.stdout.write('x'.repeat(1_048_577));");
 const failure=await rpc.request("thread/read",{}).catch(error=>error);expect(failure).toMatchObject({code:"CODEX_NATIVE_UNREACHABLE"});expect(String(failure)).not.toContain("private-native");
});

it.each(["0.162.0-alpha.17.2","0.166.0-alpha.5.1","0.166.0-alpha.7","99.0.0"])("refuses unqualified installed version %s before starting app-server",async version=>{
 const f=script(`if(process.argv.includes('--version')){console.log(${JSON.stringify(`codex-cli ${version}`)});process.exit(0);}require('node:fs').writeFileSync('spawned','yes');setInterval(()=>{},1000);`);
  const pending=adapters.CodexStdioTransport.open(localScope(f)).then(connection=>{connections.push(connection);return connection;});
  await expect(pending).rejects.toMatchObject({code:"CODEX_PROTOCOL_VERSION_UNQUALIFIED",creationOutcome:"not-created"});expect(existsSync(join(f.root,"spawned"))).toBe(false);
});
