import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename,join} from "node:path";
import type * as fsModule from "node:fs";
import type * as pathModule from "node:path";
import {afterEach,expect,it} from "vitest";
import {CopilotRpcClient,type CopilotRpcOptions} from "../src/copilot.js";

const id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
interface Update {kind:"activity"|"tool";sessionId:string;toolCallId?:string;status?:string}
interface Result {messageId:string;nativeStopReason:"idle"|"aborted";executionEvidence:boolean;toolFailure:boolean;permissionDenied:boolean;pendingTools:number}
type Client=CopilotRpcClient&{
 prompt(input:{sessionId:string;message:string},options?:CopilotRpcOptions&{onUpdate?:(update:Update)=>void}):Promise<Result>;
 cancelPrompt(input:{sessionId:string},options?:CopilotRpcOptions):Promise<{disposition:"submitted"}>;
};
const roots:string[]=[],clients:Client[]=[];
afterEach(async()=>{await Promise.all(clients.splice(0).map(c=>c.close()));for(const root of roots.splice(0)){captureFixture(root);rmSync(root,{recursive:true,force:true});}});

function native(mode:string,root:string){
 const fs=process.getBuiltinModule("fs") as typeof fsModule,path=process.getBuiltinModule("path") as typeof pathModule;
 let buffer=Buffer.alloc(0),sessionId="",metadataReads=0,modelReads=0,sends=0,held:unknown[]=[];
 const calls:unknown[]=[];
 const frame=(v:unknown)=>{const body=Buffer.from(JSON.stringify(v));return Buffer.concat([Buffer.from("Content-Length: "+body.length+"\r\n\r\n"),body]);};
 const emit=(v:unknown)=>process.stdout.write(frame(v));
 const event=(type:string,data:unknown={},extra={})=>({jsonrpc:"2.0",method:"session.event",params:{sessionId,event:{type,data,...extra}}});
 const batch=(v:unknown[])=>process.stdout.write(Buffer.concat(v.map(frame)));
 const turn=(messageId:string)=>{
  const user=event("user.message",{messageId,content:"private-user"});
  const assistant=event("assistant.message",{messageId:"assistant-"+messageId,originatingMessageId:messageId,content:"private-assistant",model:mode==="pre-ack-model"?"different":"chosen"});
  const idle=event("session.idle",{mode:"interactive"});
  if(mode==="error")return [user,event("session.error",{errorType:"quota",message:"private-provider-error"})];
  if(mode==="idle-only")return [idle];
  if(mode==="foreign-origin")return [event("assistant.message",{messageId:"other",originatingMessageId:"old",content:"private-old"}),idle];
  if(mode==="subagent")return [event("assistant.message",{messageId:"other",originatingMessageId:messageId,content:"private-subagent"},{agentId:"subagent"}),idle];
  if(mode==="pending-tool"||mode==="failed-tool"||mode==="tool"||mode==="tool-model-drift"){
   const tools=[user,event("assistant.message",{messageId:"tool-message",originatingMessageId:messageId,content:"",toolRequests:[{toolCallId:"tool-1",name:"private-tool",arguments:{secret:"private-arguments"}}]}),event("tool.execution_start",{toolCallId:"tool-1",toolName:"private-tool",arguments:"private-arguments",model:mode==="tool-model-drift"?"different":"chosen"})];
   if(mode!=="pending-tool")tools.push(event("tool.execution_complete",{toolCallId:"tool-1",success:mode!=="failed-tool",result:"private-result",error:"private-error"}));
   return [...tools,assistant,idle];
  }
  if(mode==="permission"||mode==="permission-tail"||mode==="permission-unresolved"||mode==="permission-hook"||mode==="permission-foreign-owner")return [user,event("permission.requested",{requestId:"permission-1",ownerSessionId:mode==="permission-foreign-owner"?"sibling":sessionId,permissionRequest:{kind:"shell",command:"private-command"},resolvedByHook:mode==="permission-hook"}),assistant,idle];
  if(mode==="autopilot")return [user,assistant,event("session.idle",{mode:"autopilot"})];
  if(mode==="idle-invalid-mode")return [user,assistant,event("session.idle",{mode:"unqualified-mode"})];
  if(mode==="aborted")return [user,assistant,event("session.idle",{aborted:true})];
  if(mode==="duplicate-idle")return [user,assistant,idle,idle];
  if(mode==="huge-content")return [user,event("assistant.message",{messageId:"huge",originatingMessageId:messageId,content:"x".repeat(16385)}),idle];
  if(mode==="flood-before-ack")return Array.from({length:65},()=>user);
  return [user,assistant,idle,...(mode==="deleted-tail"?[{jsonrpc:"2.0",method:"session.lifecycle",params:{sessionId,type:"session.deleted"}}]:mode==="model-tail"?[event("session.model_change",{newModel:"different"})]:[])];
 };
 const respond=(m:{id:number;method:string;params:Record<string,unknown>})=>{
  calls.push(m);fs.writeFileSync(path.join(root,"calls"),JSON.stringify(calls));
  let result:unknown={};
  if(m.method==="connect")result={protocolVersion:3};
  else if(m.method==="status.get")result={protocolVersion:3,version:"1.0.97"};
  else if(m.method==="session.create"){sessionId=m.params.sessionId as string;result={sessionId};}
  else if(m.method==="session.getMetadata"){metadataReads++;result=mode==="missing-before-input"&&metadataReads>1?{}:{session:{sessionId,startTime:"2026-10-13T00:00:00Z",modifiedTime:"2026-10-13T00:00:00Z",isRemote:false,context:{cwd:process.cwd()}}};}
  else if(m.method==="session.model.getCurrent"){modelReads++;result={modelId:mode==="drift-before-input"&&modelReads>1?"different":"chosen"};}
  else if(m.method==="session.send"){
   sends++;const messageId="turn-"+sends,ack={jsonrpc:"2.0",id:m.id,result:mode==="bad-ack"?{messageId:4}:{messageId}};
   if(mode==="hold"||mode==="held-until-release"){emit(ack);held=turn(messageId);return;}
   if(mode==="ack-only"){emit(ack);return;}
   const events=turn(messageId);batch(mode==="pre-ack"||mode==="pre-ack-model"||mode==="flood-before-ack"?[...events,ack]:[ack,...events]);return;
  }else if(m.method==="session.abort"){emit({jsonrpc:"2.0",id:m.id,result:{}});batch([held[0],held[1],event("session.idle",{aborted:true})]);return;}
  else if(m.method==="session.permissions.handlePendingPermissionRequest"){
   result={success:mode!=="permission-unresolved"};
   if(mode==="permission-tail"){
    const count=(calls as Array<{method:string}>).filter(c=>c.method===m.method).length;
    if(count===1)batch([{jsonrpc:"2.0",id:m.id,result},event("permission.requested",{requestId:"permission-2",ownerSessionId:sessionId,permissionRequest:{kind:"shell"}})]);
    else setTimeout(()=>{fs.writeFileSync(path.join(root,"denial-2-ack"),"confirmed");emit({jsonrpc:"2.0",id:m.id,result});},25);
    return;
   }
  }
  emit({jsonrpc:"2.0",id:m.id,result});
 };
 process.stdin.on("data",(chunk:Buffer)=>{buffer=Buffer.concat([buffer,chunk]);for(;;){const at=buffer.indexOf("\r\n\r\n");if(at<0)return;const match=/Content-Length: (\d+)/.exec(buffer.subarray(0,at).toString());if(!match)throw Error();const size=Number(match[1]);if(buffer.length<at+4+size)return;const packet=JSON.parse(buffer.subarray(at+4,at+4+size).toString());buffer=buffer.subarray(at+4+size);respond(packet);}});
 if(mode==="held-until-release")setInterval(()=>{if(held.length&&fs.existsSync(path.join(root,"release"))){batch(held);held=[];}},5);
 setInterval(()=>{},1000);
}
function captureFixture(root:string){
 const destination=process.env.DISPATCHER_COPILOT_FIXTURE_EVIDENCE;if(!destination)return;
 mkdirSync(destination,{recursive:true});cpSync(root,join(destination,basename(root)),{recursive:true});
}

function fixture(mode="normal"){
 const root=mkdtempSync(join(realpathSync(tmpdir()),"dispatcher-copilot-prompt-"));roots.push(root);
 const scope={executable:join(root,"copilot"),workspacePath:join(root,"workspace"),copilotHome:join(root,"home")};
 mkdirSync(scope.workspacePath);mkdirSync(scope.copilotHome);writeFileSync(join(scope.copilotHome,"native-file"),"preserve");
 writeFileSync(scope.executable,"#!"+process.execPath+"\n("+native.toString()+")("+JSON.stringify(mode)+","+JSON.stringify(root)+");\n",{mode:0o755});
 captureFixture(root);
 return {root,scope,calls:()=>existsSync(join(root,"calls"))?JSON.parse(readFileSync(join(root,"calls"),"utf8")) as Array<{method:string;params:Record<string,unknown>}>:[]};
}
async function execution(f:ReturnType<typeof fixture>,guard=()=>{}){
 const c=await CopilotRpcClient.openExecution(f.scope,{beforeMutation:guard}) as Client;clients.push(c);
 await c.bootstrap({mode:"new",model:"chosen",nativeSessionId:id,onSessionKnown:()=>{}});return c;
}
const input={sessionId:id,message:"private-prompt\nwith multiline"};
const expected={messageId:"turn-1",nativeStopReason:"idle",executionEvidence:true,toolFailure:false,permissionDenied:false,pendingTools:0};

it("never upgrades a readonly connection through prompt options",async()=>{
 const f=fixture(),c=await CopilotRpcClient.open(f.scope) as Client;clients.push(c);
 await expect(c.prompt(input)).rejects.toMatchObject({code:"COPILOT_RPC_READ_ONLY"});expect(f.calls()).toHaveLength(2);
});
it("requires qualified bootstrap before native prompt",async()=>{
 const f=fixture(),c=await CopilotRpcClient.openExecution(f.scope,{beforeMutation:()=>{}}) as Client;clients.push(c);
 await expect(c.prompt(input)).rejects.toMatchObject({code:"COPILOT_RPC_SESSION_UNQUALIFIED"});expect(f.calls()).toHaveLength(2);
});
it("does not let readonly options request native abort",async()=>{
 const f=fixture(),c=await CopilotRpcClient.open(f.scope) as Client;clients.push(c);
 await expect(c.cancelPrompt({sessionId:id})).rejects.toMatchObject({code:"COPILOT_RPC_READ_ONLY"});expect(f.calls()).toHaveLength(2);
});
it("retains model attribution when correlated assistant arrives before native send ACK",async()=>{
 const c=await execution(fixture("pre-ack-model"));await expect(c.prompt(input)).rejects.toMatchObject({code:"COPILOT_RPC_MODEL_DRIFT"});
});
it("refuses an unconfirmed native permission decision ACK despite idle",async()=>{
 const c=await execution(fixture("permission-unresolved"));await expect(c.prompt(input)).rejects.toMatchObject({code:"COPILOT_RPC_PERMISSION_UNCONFIRMED"});
});
it.each(["idle-invalid-mode","tool-model-drift"])("refuses %s native qualification despite later idle",async mode=>{
 const c=await execution(fixture(mode));await expect(c.prompt(input)).rejects.toMatchObject({code:mode==="tool-model-drift"?"COPILOT_RPC_MODEL_DRIFT":"COPILOT_RPC_PROTOCOL_INVALID"});
});
it.each(["normal","pre-ack"])("correlates %s ACK/events and exposes only static activity/result facts",async mode=>{
 const f=fixture(mode),c=await execution(f),updates:Update[]=[];expect(await c.prompt(input,{onUpdate:u=>{updates.push(u);}})).toEqual(expected);
 expect(updates).toEqual([{kind:"activity",sessionId:id}]);expect(JSON.stringify([updates,c.recentEvents()])).not.toContain("private-");
 expect(f.calls().find(v=>v.method==="session.send")?.params).toEqual({sessionId:id,prompt:input.message,mode:"enqueue"});
 expect(f.calls().slice(-3).map(v=>v.method)).toEqual(["session.getMetadata","session.model.getCurrent","session.send"]);
});
it.each(["ack-only","idle-only","foreign-origin","subagent","autopilot"])("does not complete from %s without a correlated main-agent terminal",async mode=>{
 const f=fixture(mode),c=await execution(f);await expect(c.prompt(input,{timeoutMs:150})).rejects.toMatchObject({code:"COPILOT_RPC_TIMEOUT"});
 expect(f.calls().filter(v=>v.method==="session.send")).toHaveLength(1);expect(readFileSync(join(f.scope.copilotHome,"native-file"),"utf8")).toBe("preserve");
});
it.each(["missing-before-input","drift-before-input"])("refuses %s before input without repair/model override",async mode=>{
 const f=fixture(mode),c=await execution(f);await expect(c.prompt(input)).rejects.toMatchObject({code:mode==="missing-before-input"?"COPILOT_RPC_SESSION_NOT_FOUND":"COPILOT_RPC_MODEL_DRIFT"});
 expect(f.calls().some(v=>v.method==="session.send"||/set|create/.test(v.method)&&v.method!=="session.create")).toBe(false);
});
it.each(["bad-ack","error","deleted-tail","model-tail","duplicate-idle","huge-content","flood-before-ack"])("fails closed on %s and never echoes raw native content",async mode=>{
 const c=await execution(fixture(mode));const result=await c.prompt(input).catch(e=>e);expect(result).toBeInstanceOf(Error);expect(String(result)).not.toContain("private-");
});
it("tracks completed tools without exposing their arguments/results",async()=>{
 const f=fixture("tool"),c=await execution(f),updates:Update[]=[];expect(await c.prompt(input,{onUpdate:u=>{updates.push(u);}})).toEqual(expected);
 expect(updates.filter(u=>u.kind==="tool")).toEqual([{kind:"tool",sessionId:id,toolCallId:"tool-1",status:"pending"},{kind:"tool",sessionId:id,toolCallId:"tool-1",status:"in_progress"},{kind:"tool",sessionId:id,toolCallId:"tool-1",status:"completed"}]);
});
it.each(["pending-tool","failed-tool"])("retains %s as non-success facts despite idle",async mode=>{
 const c=await execution(fixture(mode));expect(await c.prompt(input)).toEqual({...expected,toolFailure:mode==="failed-tool",pendingTools:mode==="pending-tool"?1:0});
});
it("denies an unresolved exact permission through native decision RPC and waits for ACK",async()=>{
 const f=fixture("permission"),c=await execution(f);expect(await c.prompt(input)).toEqual({...expected,permissionDenied:true});
 expect(f.calls().find(v=>v.method==="session.permissions.handlePendingPermissionRequest")?.params).toEqual({sessionId:id,requestId:"permission-1",result:{kind:"user-not-available"}});
 expect(f.calls().some(v=>/approve|configure|auth/.test(v.method))).toBe(false);
});
it("drains a second permission arriving with the first denial ACK after idle before returning",async()=>{
 const f=fixture("permission-tail"),c=await execution(f);expect(await c.prompt(input)).toEqual({...expected,permissionDenied:true});
 expect(f.calls().filter(v=>v.method==="session.permissions.handlePendingPermissionRequest").map(v=>v.params.requestId)).toEqual(["permission-1","permission-2"]);
 expect(existsSync(join(f.root,"denial-2-ack"))).toBe(true);c.assertCurrentScope();
});
it("does not act on a permission already resolved by a native hook",async()=>{
 const f=fixture("permission-hook"),c=await execution(f);expect(await c.prompt(input)).toEqual(expected);
 expect(f.calls().some(v=>v.method==="session.permissions.handlePendingPermissionRequest")).toBe(false);
});
it("rejects another execution owner rather than resolving its permission",async()=>{
 const f=fixture("permission-foreign-owner"),c=await execution(f);await expect(c.prompt(input)).rejects.toMatchObject({code:"COPILOT_RPC_IDENTITY_CHANGED"});
 expect(f.calls().some(v=>v.method==="session.permissions.handlePendingPermissionRequest")).toBe(false);
});
it("keeps native abort disposition separate from aborted turn completion",async()=>{
 const f=fixture("hold"),c=await execution(f),pending=c.prompt(input),observed=pending.catch(e=>e);
 while(!f.calls().some(v=>v.method==="session.send"))await new Promise(resolve=>setTimeout(resolve,5));
 expect(await c.cancelPrompt({sessionId:id})).toEqual({disposition:"submitted"});expect(await observed).toEqual({...expected,nativeStopReason:"aborted"});
 expect(f.calls().filter(v=>v.method==="session.abort")).toHaveLength(1);
});
it("refuses overlapping prompts and captures original message/update callback",async()=>{
 const f=fixture("hold"),c=await execution(f),captured={...input},updates:Update[]=[],options={onUpdate:(u:Update)=>{updates.push(u);}};
 const pending=c.prompt(captured,options),observed=pending.catch(e=>e);captured.message="replacement";captured.sessionId="sibling";options.onUpdate=()=>{throw Error("replacement");};
 await expect(c.prompt(input)).rejects.toMatchObject({code:"COPILOT_RPC_SESSION_BUSY"});
 while(!f.calls().some(v=>v.method==="session.send"))await new Promise(resolve=>setTimeout(resolve,5));
 await c.cancelPrompt({sessionId:id});expect(await observed).toEqual({...expected,nativeStopReason:"aborted"});expect(updates).toEqual([{kind:"activity",sessionId:id}]);
 expect(f.calls().find(v=>v.method==="session.send")?.params.prompt).toBe(input.message);
});
it("rechecks original mutation Guard at actual input after readonly qualification",async()=>{
 const f=fixture();let allowed=true;const c=await execution(f,()=>{if(!allowed)throw Error("private-revoked");});let checks=0;
 await expect(c.prompt(input,{beforeSend:()=>{if(++checks===3)allowed=false;}})).rejects.toMatchObject({code:"COPILOT_RPC_AUTHORITY_CHANGED"});
 expect(f.calls().some(v=>v.method==="session.send")).toBe(false);
});
it("drops an old queued abort before it can touch the next turn and preserves the healthy connection",async()=>{
 const f=fixture("held-until-release"),c=await execution(f),first=c.prompt(input),gate=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>();
 while(!f.calls().some(v=>v.method==="session.send"))await new Promise(resolve=>setTimeout(resolve,5));
 const cancel=c.cancelPrompt({sessionId:id},{beforeSend:()=>{entered.resolve();return gate.promise;}}),canceled=cancel.catch(e=>e);
 await entered.promise;writeFileSync(join(f.root,"release"),"release");expect(await first).toEqual(expected);
 const second=c.prompt(input);gate.resolve();expect(await canceled).toMatchObject({code:"COPILOT_RPC_IDENTITY_CHANGED"});
 expect(await second).toEqual({...expected,messageId:"turn-2"});expect(f.calls().some(v=>v.method==="session.abort")).toBe(false);c.assertCurrentScope();
});
it("honors a shorter original abort deadline while retaining the ongoing turn",async()=>{
 const f=fixture("held-until-release"),c=await execution(f),first=c.prompt(input),gate=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>();
 while(!f.calls().some(v=>v.method==="session.send"))await new Promise(resolve=>setTimeout(resolve,5));
 const canceled=c.cancelPrompt({sessionId:id},{timeoutMs:100,beforeSend:()=>{entered.resolve();return gate.promise;}}).catch(e=>e);await entered.promise;
 const outcome=await Promise.race([canceled,new Promise(resolve=>setTimeout(()=>resolve("deadline-not-honored"),500))]);
 gate.resolve();writeFileSync(join(f.root,"release"),"release");await first;
 expect(outcome).toMatchObject({code:"COPILOT_RPC_TIMEOUT"});expect(f.calls().some(v=>v.method==="session.abort")).toBe(false);c.assertCurrentScope();
});
it("tracks but refuses asynchronous update callbacks and retains unknown cleanup",async()=>{
 const c=await execution(fixture()),gate=Promise.withResolvers<void>();
 await expect(c.prompt(input,{onUpdate:()=>gate.promise})).rejects.toMatchObject({code:"COPILOT_RPC_CALLBACK_FAILED"});expect((await c.close()).callbacks).toBe("unknown");gate.resolve();
});
it("keeps external cancellation distinct from native idle and stops only its owned connection",async()=>{
 const f=fixture("hold"),c=await execution(f),signal=new AbortController(),pending=c.prompt(input,{signal:signal.signal}),observed=pending.catch(e=>e);
 while(!f.calls().some(v=>v.method==="session.send"))await new Promise(resolve=>setTimeout(resolve,5));signal.abort();
 expect(await observed).toMatchObject({code:"COPILOT_RPC_CANCELLED"});expect((await c.close()).backgroundTools).toBe("unknown");
});
it("retains a reentrant asynchronous update through local close and caches its unknown receipt",async()=>{
 const c=await execution(fixture()),gate=Promise.withResolvers<void>();let closing:ReturnType<Client["close"]>|undefined;
 try{
  await expect(c.prompt(input,{onUpdate:()=>{closing=c.close();return gate.promise;}})).rejects.toMatchObject({code:"COPILOT_RPC_UNREACHABLE"});
  const receipt=await closing;expect(receipt).toMatchObject({ownedRoot:"exited",callbacks:"unknown"});
  gate.resolve();await gate.promise;expect(c.close()).toBe(closing);expect(await c.close()).toBe(receipt);
 }finally{gate.resolve();}
});
