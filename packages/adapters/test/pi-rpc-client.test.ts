import {mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync,existsSync,renameSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach,expect,it,vi} from "vitest";
import {PiRpcClient,type PiRpcScope} from "../src/pi-rpc-client.js";

const roots:string[]=[],clients:PiRpcClient[]=[];
afterEach(async()=>{for(const client of clients.splice(0))await client.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const sessionId="4b5ab6ec-9f88-4fc7-b991-0abb673a3f4e";
function fixture(model="normal",version="1.2.0"){
 const root=mkdtempSync(join(realpathSync(tmpdir()),"dispatcher-pi-rpc-"));roots.push(root);const workspacePath=join(root,"workspace"),agentDirectory=join(root,"native"),sessionDirectory=join(root,"sessions");for(const path of [workspacePath,agentDirectory,sessionDirectory])mkdirSync(path);
 const executable=join(root,"pi");writeFileSync(executable,`#!${process.execPath}
(()=>{
require('node:fs').appendFileSync(${JSON.stringify(join(root,"environment.jsonl"))},JSON.stringify({kind:process.argv.includes('--version')?'version':'rpc',authority:Object.keys(process.env).some(key=>['DISPATCHER_OWNER_TOKEN','DISPATCHER_SECRET_STORE_KEY'].includes(key.toUpperCase())),provider:process.env.DISPATCHER_TEST_PROVIDER_CONTEXT,pwd:process.env.PWD,agent:process.env.PI_CODING_AGENT_DIR})+'\\n');
if(process.argv.includes('--version')){if(${JSON.stringify(version)}==='term-resistant'){require('node:fs').writeFileSync(${JSON.stringify(join(root,"version-pid"))},String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000);return;}if(${JSON.stringify(version)}==='mutate'){const fs=require('node:fs'),p=process.env.PI_CODING_AGENT_DIR;fs.renameSync(p,p+'-old');fs.mkdirSync(p);}process.stdout.write(${JSON.stringify(version==="mutate"?"1.2.0":version)});process.exit(0);}
require('node:fs').writeFileSync(${JSON.stringify(join(root,"rpc-started"))},'started');
require('node:fs').writeFileSync(${JSON.stringify(join(root,'rpc-pid'))},String(process.pid));const args=process.argv.slice(2),mode=args[args.indexOf('--model')+1];let count=0,stateReads=0,buffer=Buffer.alloc(0);
if(mode==='slow'){process.stdin.pause();setTimeout(()=>process.stdin.resume(),100);}
const emit=value=>process.stdout.write(JSON.stringify(value)+'\\r\\n');
const reply=(c,data)=>emit({id:c.id,type:'response',command:c.type,success:true,data});
const inherit=()=>{const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore',1,2]});require('node:fs').writeFileSync(${JSON.stringify(join(root,"descendant-pid"))},String(child.pid));};
process.stdin.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);for(;;){const i=buffer.indexOf(10);if(i<0)break;const line=buffer.subarray(0,i).toString('utf8');buffer=buffer.subarray(i+1);const c=JSON.parse(line);count++;require('node:fs').appendFileSync(${JSON.stringify(join(root,"wire-types"))},c.type+'\\n');
 if(mode==='hung')continue;
 if(mode.startsWith('exec-')){
  const sid=args[args.indexOf('--session-id')+1];
  if(c.type==='get_state'){reply(c,{sessionId:mode==='exec-wrong-id'?'00000000-0000-4000-8000-000000000000':sid,model:{provider:'fixture',id:mode==='exec-wrong-model'||mode==='exec-late-model'&&require('node:fs').existsSync(${JSON.stringify(join(root,'change-model'))})?'different':mode},thinkingLevel:'medium',isStreaming:false,isCompacting:false,steeringMode:'one-at-a-time',followUpMode:'one-at-a-time',autoCompactionEnabled:true,messageCount:0,pendingMessageCount:0});continue;}
  if(c.type==='prompt'){
   require('node:fs').writeFileSync(${JSON.stringify(join(root,'prompt-input'))},c.message);
   if(mode==='exec-rejected'){emit({type:'response',id:c.id,command:c.type,success:false,error:'private rejection'});continue;}
   if(mode==='exec-handled'){reply(c,{disposition:'handled'});continue;}
   const assistant=()=>emit({type:'message_end',message:{role:'assistant',content:[{type:'text',text:mode==='exec-burst'?'🙂'.repeat(3000):'native answer'}],stopReason:mode==='exec-error'?'error':'stop',errorMessage:'secret=private-native-error'}});
   const done=()=>{if(mode!=='exec-no-proof')assistant();emit({type:'agent_end'});emit({type:'agent_settled',aborted:false});};
   emit({type:'agent_start'});if(mode==='exec-fast'){done();reply(c,{disposition:'started'});continue;}reply(c,{disposition:'started'});
   if(mode==='exec-exit'){emit({type:'message_update'});setTimeout(()=>process.exit(9),20);continue;}
   if(mode==='exec-pending'){emit({type:'agent_end'});continue;}
   if(mode==='exec-burst'){for(let i=0;i<300;i++)assistant();done();continue;}
   emit({type:'agent_end'});setTimeout(()=>{if(mode==='exec-callbacks')for(let i=0;i<100;i++)emit({type:'agent_start'});done();},100);continue;
  }
 }
 if(mode.startsWith('port-')){
  if(c.type==='get_state'){stateReads++;const state={sessionId:${JSON.stringify(sessionId)},model:{provider:'fixture',id:'model'},thinkingLevel:'medium',isStreaming:mode==='port-running',isCompacting:false,steeringMode:'one-at-a-time',followUpMode:'one-at-a-time',autoCompactionEnabled:true,messageCount:3,pendingMessageCount:mode==='port-queued'?1:0};if(mode==='port-bad-mode')state.steeringMode={toString:'private-mode'};if(mode==='port-hung')continue;if(mode==='port-identity')state.sessionId='00000000-0000-4000-8000-000000000000';if(mode==='port-drift'&&stateReads>1)state.messageCount++;if(mode==='port-cancel')emit({type:'port_state_read'});if(mode.startsWith('port-file')){const fs=require('node:fs'),path=${JSON.stringify(join("placeholder","session.jsonl"))}.replace('placeholder',mode==='port-file-outside'?${JSON.stringify(join(root,"native"))}:${JSON.stringify(join(root,"sessions"))});if(mode==='port-file-empty'||mode==='port-file-born')state.messageCount=0;if(!fs.existsSync(path)&&mode!=='port-file-empty'&&(mode!=='port-file-born'||stateReads>1))fs.writeFileSync(path,'fixture');if(mode==='port-file-replaced'&&stateReads>1){fs.renameSync(path,path+'-old');fs.writeFileSync(path,'new fixture');}if(mode==='port-file-alias'){const alias=path+'-alias';if(!fs.existsSync(alias))fs.symlinkSync(path,alias);state.sessionFile=alias;}else state.sessionFile=path;}if(mode==='port-file-entries'&&stateReads===3){process.stdin.pause();setTimeout(()=>process.stdin.resume(),100);emit({type:'port_after_state'});}reply(c,state);continue;}
  if(c.type==='get_entries'){
   let entries=Array.from({length:mode==='port-large'?20:3},(_,i)=>({type:'message',id:'entry-'+(i+1),parentId:i?'entry-'+i:null,timestamp:'2026-10-13T10:00:00.000Z',message:{role:i===1?'assistant':'user',content:mode==='port-large'?(i===1?[{type:'text',text:'🙂'.repeat(10000)}]:'🙂'.repeat(10000)):i===0?'hello':i===1?[{type:'text',text:'answer'}]:'branch',timestamp:1791885600000}}));
   if(mode==='port-duplicate')entries[1].id=entries[0].id;if(mode==='port-late-duplicate')entries[2].id=entries[0].id;if(mode==='port-bad-role')entries[0].message.role={toString:'private-role'};
   if(mode==='port-invalid-time')entries[0].timestamp='not-a-date';
   if(mode==='port-missing-id')delete entries[0].id;
   if(mode==='port-media')entries[0].message.content=[{type:'text',text:'visible'},{type:'image',data:'private-image-payload',mimeType:'image/png'},{type:'thinking',thinking:'private-thinking'},{type:'toolCall',id:'tool-1',name:'bash',arguments:{token:'private-tool-argument'}}];
   if(mode==='port-custom'){entries[0]={...entries[0],type:'custom',customType:'private-kind',data:{token:'private-extension-data'}};}
   if(mode==='port-file-empty'||mode==='port-file-born')entries=[];if(c.since){const at=entries.findIndex(entry=>entry.id===c.since);if(at<0){emit({type:'response',id:c.id,command:c.type,success:false,error:'private bad cursor'});continue;}entries=entries.slice(at+1);}
   reply(c,{entries,leafId:mode==='port-file-empty'||mode==='port-file-born'?null:mode==='port-leaf-drift'&&count===3?'entry-3':'entry-2'});continue;
  }
 }
 if(c.type==='get_state'){if(mode==='inherited-close')inherit();const data={sessionId:${JSON.stringify(sessionId)},argv:args,cwd:process.cwd(),count,isStreaming:false,isCompacting:false,pendingMessageCount:0};if(mode==='reverse')setTimeout(()=>reply(c,data),20);else reply(c,data);}
 else if(c.type==='get_messages'){
  if(mode==='mismatch'){emit({id:c.id,type:'response',command:'abort',success:true});continue;}
  if(mode==='oversized'){process.stdout.write('x'.repeat(1048577));continue;}
  if(mode==='rejected'){process.stderr.write('access_token=private-native-diagnostic');emit({id:c.id,type:'response',command:c.type,success:false,error:'access_token=private-native-diagnostic'});continue;}
  const frame=Buffer.from(JSON.stringify({id:c.id,type:'response',command:c.type,success:true,data:{text:'甲\\u2028乙\\u2029🙂'}})+'\\r\\n');const cut=frame.indexOf(Buffer.from('甲'))+1;process.stdout.write(frame.subarray(0,cut));setTimeout(()=>process.stdout.write(frame.subarray(cut)),5);
 }else if(c.type==='prompt'){
  if(mode==='prompt-rejected'){if(count===1)emit({id:c.id,type:'response',command:c.type,success:false,error:'rejected before acceptance'});else reply(c,{disposition:'handled'});continue;}
  emit({type:'agent_start'});
  if(mode==='inherited-exit'){inherit();setTimeout(()=>process.exit(9),15);continue;}
  if(mode==='burst'){for(let i=0;i<250;i++)emit({type:'message_update',text:'private payload'});reply(c,{disposition:'started'});emit({type:'agent_settled',aborted:false});continue;}
  if(mode==='exit'){emit({type:'message_update'});process.stderr.write('secret=private-exit-diagnostic');setTimeout(()=>process.exit(9),5);continue;}
  if(mode==='handled'){reply(c,{disposition:'handled'});continue;}
  if(mode==='malformed-disposition'){reply(c,{disposition:['started']});emit({type:'agent_settled',aborted:false});continue;}
  if(mode==='fast'){emit({type:'agent_end'});emit({type:'agent_settled',aborted:false});reply(c,{disposition:'started'});continue;}
  reply(c,{disposition:'started'});emit({type:'agent_end'});
  if(mode==='never-settled')continue;
  setTimeout(()=>{emit({type:'agent_start'});emit({type:'agent_end'});emit({type:'agent_settled',aborted:false});},30);
 }else reply(c,{});
}});
process.stdin.on('end',()=>process.exit(0));
})();
`,{mode:0o700});const scope:PiRpcScope={executable,workspacePath,agentDirectory,sessionDirectory,sessionId,mode:"new",model};return {root,scope};
}
async function open(model="normal"){const f=fixture(model),client=await PiRpcClient.open(f.scope);clients.push(client);return {...f,client};}
it.each(["new","resume"] as const)("uses a persistent exact session and literal argv in %s mode",async mode=>{
 const f=fixture();f.scope.mode=mode;const client=await PiRpcClient.open(f.scope);clients.push(client);const state=await client.request("get_state");expect(state).toMatchObject({sessionId,cwd:f.scope.workspacePath});expect(state.argv).toEqual(["--mode","rpc","--session-dir",f.scope.sessionDirectory,mode==="new"?"--session-id":"--session",sessionId,"--model","normal"]);expect(state.argv).not.toContain("--no-session");
});
it("refuses an unqualified version before starting RPC",async()=>{const f=fixture("normal","9.9.9");await expect(PiRpcClient.open(f.scope)).rejects.toMatchObject({code:"PI_RPC_VERSION_UNQUALIFIED",creationOutcome:"not-created"});expect(existsSync(join(f.root,"rpc-started"))).toBe(false);});
it("refuses changed directory identity during the version probe",async()=>{const f=fixture("normal","mutate");await expect(PiRpcClient.open(f.scope)).rejects.toMatchObject({code:"PI_RPC_SCOPE_CHANGED",creationOutcome:"not-created"});expect(existsSync(join(f.root,"rpc-started"))).toBe(false);});
it("captures scope before awaiting the version probe",async()=>{const f=fixture(),original=structuredClone(f.scope),pending=PiRpcClient.open(f.scope);f.scope.sessionId="00000000-0000-4000-8000-000000000000";f.scope.workspacePath="/missing";const client=await pending;clients.push(client);expect(await client.request("get_state")).toMatchObject({sessionId:original.sessionId,cwd:original.workspacePath});});
it("keeps LF/CRLF and split UTF-8 framing separate from Unicode separators",async()=>{const f=await open();expect(await f.client.request("get_messages")).toEqual({text:"甲\u2028乙\u2029🙂"});});
it("correlates out-of-order responses by ID and command",async()=>{const f=await open("reverse");const state=f.client.request("get_state"),messages=f.client.request("get_messages");expect(await messages).toEqual({text:"甲\u2028乙\u2029🙂"});expect(await state).toMatchObject({sessionId});});
it("rejects a response for the wrong command",async()=>{const f=await open("mismatch");await expect(f.client.request("get_messages")).rejects.toMatchObject({code:"PI_RPC_RESPONSE_MISMATCH"});});
it("bounds unframed stdout and never exposes native diagnostics",async()=>{const f=await open("oversized");await expect(f.client.request("get_messages")).rejects.toMatchObject({code:"PI_RPC_PROTOCOL_INVALID"});expect(f.client.recentEvents()).toEqual([]);});
it("drains stderr separately and sanitizes command failures",async()=>{const f=await open("rejected");const error=await f.client.request("get_messages").catch(e=>e);expect(error.code).toBe("PI_RPC_COMMAND_REJECTED");expect(String(error)).not.toContain("private-native-diagnostic");expect(JSON.stringify(f.client.recentEvents())).not.toContain("private");});
it("does not treat agent_end as settled while follow-up work remains",async()=>{const f=await open(),types:string[]=[];let finished=false;f.client.onEvent(event=>{types.push(String(event.type));if(event.type==="agent_end")expect(finished).toBe(false);});const result=await f.client.promptAndWait("task");finished=true;expect(result).toEqual({disposition:"started",state:"settled",aborted:false});expect(types).toEqual(["agent_start","agent_end","agent_start","agent_end","agent_settled"]);});
it("captures a fast settled event before the prompt response",async()=>{const f=await open("fast");await expect(f.client.promptAndWait("task")).resolves.toEqual({disposition:"started",state:"settled",aborted:false});});
it("returns handled without waiting for a run to settle",async()=>{const f=await open("handled");await expect(f.client.promptAndWait("extension command",{timeoutMs:100})).resolves.toEqual({disposition:"handled",state:"handled"});await expect(f.client.promptAndWait("another command",{timeoutMs:100})).resolves.toMatchObject({state:"handled"});});
it("retains partial metadata on exit and rejects raw diagnostic disclosure",async()=>{const f=await open("exit");const error=await f.client.promptAndWait("task").catch(e=>e);expect(error.code).toBe("PI_RPC_UNREACHABLE");expect(String(error)).not.toContain("private-exit-diagnostic");expect(f.client.recentEvents().map(event=>event.type)).toEqual(["agent_start","message_update"]);});
it("does not blindly retry after a settled deadline expires",async()=>{const f=await open("never-settled");await expect(f.client.promptAndWait("task",{timeoutMs:50})).rejects.toMatchObject({code:"PI_RPC_TIMEOUT"});await expect(f.client.promptAndWait("duplicate")).rejects.toMatchObject({code:"PI_RPC_TURN_PENDING"});expect(f.client.recentEvents().map(event=>event.type)).toEqual(["agent_start","agent_end"]);});
it("rejects a duplicate prompt while the first one is unsettled",async()=>{const f=await open(),first=f.client.promptAndWait("task");await expect(f.client.promptAndWait("duplicate")).rejects.toMatchObject({code:"PI_RPC_TURN_PENDING"});await first;const state=await f.client.request("get_state");expect(state.count).toBe(2);});
it("bounds pending requests and settles them all when the owned connection closes",async()=>{const f=await open("hung"),pending=Array.from({length:64},()=>f.client.request("get_state"));const outcomes=Promise.allSettled(pending);await expect(f.client.request("get_state")).rejects.toMatchObject({code:"PI_RPC_REQUEST_LIMIT"});await f.client.close();expect((await outcomes).every(value=>value.status==="rejected")).toBe(true);});
it("blocks canceled or revoked writes before native input",async()=>{const f=await open(),abort=new AbortController();abort.abort();await expect(f.client.request("get_messages",{},{signal:abort.signal})).rejects.toMatchObject({code:"PI_RPC_CANCELLED"});await expect(f.client.request("get_messages",{},{beforeSend:()=>{throw Error("private authority diagnostic");}})).rejects.toMatchObject({code:"PI_RPC_AUTHORITY_CHANGED"});expect(await f.client.request("get_state")).toMatchObject({count:1});});
it("bounds queued bytes while honoring slow stdin backpressure",async()=>{const f=await open("slow"),payload={padding:"x".repeat(220_000)},pending=Array.from({length:4},()=>f.client.request("get_state",payload));await expect(f.client.request("get_state",payload)).rejects.toMatchObject({code:"PI_RPC_REQUEST_LIMIT"});expect((await Promise.all(pending)).map(value=>value.count)).toEqual([1,2,3,4]);});
it("never invokes a revoked queued write's guard after a slow drain",async()=>{const f=await open("slow"),payload={padding:"x".repeat(220_000)},abort=new AbortController(),guard=vi.fn();const first=f.client.request("get_state",payload),second=f.client.request("get_state",payload,{signal:abort.signal,beforeSend:guard}),third=f.client.request("get_state",payload);abort.abort();await expect(second).rejects.toMatchObject({code:"PI_RPC_CANCELLED"});await Promise.all([first,third]);expect(guard).not.toHaveBeenCalled();expect(await f.client.request("get_state")).toMatchObject({count:3});});
it("retains at most one hundred event metadata records without transcript payload",async()=>{const f=await open("burst");await f.client.promptAndWait("task");const metadata=f.client.recentEvents();expect(metadata).toHaveLength(100);expect(metadata.at(-1)).toMatchObject({type:"agent_settled",sequence:252});expect(JSON.stringify(metadata)).not.toContain("private payload");expect(metadata.every(value=>Object.keys(value).sort().join(",")==="sequence,type")).toBe(true);});
it("reports a deadline before the prompt ACK without retrying",async()=>{const f=await open("hung");await expect(f.client.promptAndWait("task",{timeoutMs:50})).rejects.toMatchObject({code:"PI_RPC_TIMEOUT"});await expect(f.client.promptAndWait("duplicate")).rejects.toMatchObject({code:"PI_RPC_TURN_PENDING"});});
it("caller cancellation closes local waiting without auto abort or clearing the native queue",async()=>{const f=await open("never-settled"),abort=new AbortController();f.client.onEvent(event=>{if(event.type==="agent_end")abort.abort();});await expect(f.client.promptAndWait("task",{signal:abort.signal})).rejects.toMatchObject({code:"PI_RPC_CANCELLED"});expect(await f.client.request("get_state")).toMatchObject({count:2});await expect(f.client.promptAndWait("duplicate")).rejects.toMatchObject({code:"PI_RPC_TURN_PENDING"});});
it("does not let another event listener forge a settled result",async()=>{const f=await open();f.client.onEvent(event=>{event.type="agent_settled";event.aborted=true;});await expect(f.client.promptAndWait("task")).resolves.toEqual({disposition:"started",state:"settled",aborted:false});});
it("requires the final native-write guard to finish synchronously",async()=>{const f=await open();await expect(f.client.request("get_messages",{},{beforeSend:async()=>undefined})).rejects.toMatchObject({code:"PI_RPC_AUTHORITY_CHANGED"});expect(await f.client.request("get_state")).toMatchObject({count:1});});
it("consumes a rejected asynchronous guard without revealing its diagnostic or writing",async()=>{const f=await open();const error=await f.client.request("get_messages",{},{beforeSend:async()=>{throw Error("private asynchronous authority");}}).catch(e=>e);expect(error.code).toBe("PI_RPC_AUTHORITY_CHANGED");expect(String(error)).not.toContain("private");expect(await f.client.request("get_state")).toMatchObject({count:1});});
it("rechecks directory identity after the final synchronous guard",async()=>{const f=await open();await expect(f.client.request("get_messages",{},{beforeSend:()=>{renameSync(f.scope.workspacePath,`${f.scope.workspacePath}-old`);mkdirSync(f.scope.workspacePath);}})).rejects.toMatchObject({code:"PI_RPC_SCOPE_CHANGED"});expect(existsSync(join(f.root,"wire-types"))).toBe(false);});
it("rejects a Promise-returning promptAndWait guard before writing",async()=>{const f=await open();await expect(f.client.promptAndWait("task",{beforeSend:async()=>undefined})).rejects.toMatchObject({code:"PI_RPC_AUTHORITY_CHANGED"});expect(existsSync(join(f.root,"wire-types"))).toBe(false);});
it("consumes the high-level wait guard rejection without a native prompt",async()=>{const f=await open();const error=await f.client.promptAndWait("task",{beforeSend:async()=>{throw Error("private wait guard");}}).catch(e=>e);expect(error.code).toBe("PI_RPC_AUTHORITY_CHANGED");expect(String(error)).not.toContain("private");expect(existsSync(join(f.root,"wire-types"))).toBe(false);});
it("permits corrected input after an exact rejection before acceptance",async()=>{const f=await open("prompt-rejected");await expect(f.client.promptAndWait("invalid")).rejects.toMatchObject({code:"PI_RPC_COMMAND_REJECTED"});await expect(f.client.promptAndWait("corrected")).resolves.toEqual({disposition:"handled",state:"handled"});expect(await f.client.request("get_state")).toMatchObject({count:3});});
it("bounds a TERM-resistant version probe and confirms owned exit before refusing RPC",async()=>{
 const f=fixture("normal","term-resistant"),pending=PiRpcClient.open(f.scope).then(client=>{clients.push(client);return "unexpected-rpc";},error=>error);let timer:ReturnType<typeof setTimeout>|undefined;
 try{const result=await Promise.race([pending,new Promise(resolve=>{timer=setTimeout(()=>resolve("still-pending"),6_500);})]);expect(result).toMatchObject({code:"PI_RPC_RUNTIME_UNAVAILABLE",creationOutcome:"not-created"});const pid=Number(readFileSync(join(f.root,"version-pid"),"utf8"));expect(()=>process.kill(pid,0)).toThrow();expect(existsSync(join(f.root,"rpc-started"))).toBe(false);}
 finally{if(timer)clearTimeout(timer);if(existsSync(join(f.root,"version-pid"))){const pid=Number(readFileSync(join(f.root,"version-pid"),"utf8"));try{process.kill(pid,"SIGKILL");}catch{/* This fixture probe already exited. */}}await pending;}
},8_000);
it.each(["inherited-close","inherited-exit"] as const)("releases local pipes without stopping the fixture's background child: %s",async mode=>{
 const pipes=()=>process.getActiveResourcesInfo().filter(type=>type==="PipeWrap").length,baseline=pipes(),f=await open(mode);
 try{if(mode==="inherited-close")await f.client.request("get_state");else {await expect(f.client.promptAndWait("task",{timeoutMs:1_000})).rejects.toMatchObject({code:"PI_RPC_UNREACHABLE"});expect(f.client.recentEvents()).toMatchObject([{type:"agent_start"}]);}await f.client.close();await new Promise(resolve=>setTimeout(resolve,25));expect(pipes()).toBeLessThanOrEqual(baseline);const pid=Number(readFileSync(join(f.root,"descendant-pid"),"utf8"));expect(()=>process.kill(pid,0)).not.toThrow();}
 finally{if(existsSync(join(f.root,"descendant-pid"))){const pid=Number(readFileSync(join(f.root,"descendant-pid"),"utf8"));try{process.kill(pid,"SIGKILL");}catch{/* Only this test's known child is cleaned. */}}}
});
it("refuses a malformed disposition without clearing the uncertain turn",async()=>{const f=await open("malformed-disposition");await expect(f.client.promptAndWait("task")).rejects.toMatchObject({code:"PI_RPC_PROTOCOL_INVALID"});await expect(f.client.promptAndWait("duplicate")).rejects.toMatchObject({code:"PI_RPC_TURN_PENDING"});});
it("keeps version and RPC native context while stripping Controller authority",async()=>{
 vi.stubEnv("DISPATCHER_OWNER_TOKEN","fake-owner-canary");vi.stubEnv("dispatcher_secret_store_key","fake-key-canary");vi.stubEnv("DISPATCHER_TEST_PROVIDER_CONTEXT","provider-context");
 try{const f=await open();await f.client.request("get_state");const values=readFileSync(join(f.root,"environment.jsonl"),"utf8").trim().split("\n").map(value=>JSON.parse(value));expect(values).toEqual(["version","rpc"].map(kind=>({kind,authority:false,provider:"provider-context",pwd:f.scope.workspacePath,agent:f.scope.agentDirectory})));}finally{vi.unstubAllEnvs();}
});

