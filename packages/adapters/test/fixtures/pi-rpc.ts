import {mkdtempSync,mkdirSync,writeFileSync,realpathSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {PiRpcScope} from "../../src/pi-rpc-client.js";
export const sessionId="4b5ab6ec-9f88-4fc7-b991-0abb673a3f4e";
export function piRpcFixture(roots:string[],model="normal",version="1.2.0"){
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
