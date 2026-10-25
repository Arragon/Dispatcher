import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,renameSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename,join} from "node:path";
import {createRequire,syncBuiltinESMExports} from "node:module";
import type * as childProcessModule from "node:child_process";
import {afterEach,expect,it,vi} from "vitest";
import * as adapters from "../src/copilot.js";
import type {LocalRuntimeDisconnect} from "../src/interaction-contracts.js";

interface Scope {executable:string;workspacePath:string;copilotHome:string}
interface Options {signal?:AbortSignal;timeoutMs?:number;beforeSend?:()=>void|Promise<void>}
interface Bootstrap {mode:"new"|"resume";model:string;nativeSessionId?:string;onSessionKnown:(id:string)=>void|Promise<void>}
interface Client {
 request(method:string,params?:Record<string,unknown>,options?:Options):Promise<unknown>;
 close():Promise<LocalRuntimeDisconnect>;connectionScope:Scope;disconnectSignal:AbortSignal;
 assertCurrentScope():void;onEvent(listener:(event:{sequence:number;type:string})=>void|Promise<void>):()=>void;
 recentEvents():Array<{sequence:number;type:string}>;
 bootstrap(input:Bootstrap,options?:Options):Promise<{sessionId:string;modelId:string}>;
}
const api=adapters as typeof adapters&{CopilotRpcClient:{open(scope:Scope,options?:Options):Promise<Client>;openExecution(scope:Scope,options:Options&{beforeMutation:()=>void}):Promise<Client>}};
const roots:string[]=[],clients:Client[]=[];
afterEach(async()=>{await Promise.all(clients.splice(0).map(c=>c.close()));for(const root of roots.splice(0)){captureFixture(root);rmSync(root,{recursive:true,force:true});}});
const a="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",b="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function captureFixture(root:string){
 const destination=process.env.DISPATCHER_COPILOT_FIXTURE_EVIDENCE;if(!destination)return;
 mkdirSync(destination,{recursive:true});cpSync(root,join(destination,basename(root)),{recursive:true});
}

function fixture(mode="normal"){
 const root=mkdtempSync(join(realpathSync(tmpdir()),"dispatcher-copilot-rpc-"));roots.push(root);
 const scope={executable:join(root,"copilot"),workspacePath:join(root,"workspace"),copilotHome:join(root,"copilot-home")};
 mkdirSync(scope.workspacePath);mkdirSync(scope.copilotHome);writeFileSync(join(scope.copilotHome,"native-file"),"preserve");
 writeFileSync(scope.executable,[
  "#!"+process.execPath,
  "const fs=require('node:fs'),path=require('node:path'),root="+JSON.stringify(root)+",mode="+JSON.stringify(mode)+",nativeId="+JSON.stringify(a)+";",
  "fs.writeFileSync(path.join(root,'started'),JSON.stringify({pid:process.pid,args:process.argv.slice(2),cwd:process.cwd(),pwd:process.env.PWD,home:process.env.COPILOT_HOME}));",
  "if(mode==='environment-canary')fs.writeFileSync(path.join(root,'environment'),JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(DISPATCHER_OWNER_TOKEN|dispatcher_secret_store_key|COPILOT_HOME|PWD|COPILOT_PROVIDER_CANARY)$/i.test(key)))));",
  "const calls=[],held=[];let buffer=Buffer.alloc(0),permission,createdId,selectedModel='chosen';",
  "const frame=v=>{const body=Buffer.from(JSON.stringify(v));return Buffer.concat([Buffer.from('Content-Length: '+body.length+'\\r\\n\\r\\n'),body]);};",
  "const emit=v=>{const out=frame(v);if(mode==='split'){for(let i=0;i<out.length;i+=3)process.stdout.write(out.subarray(i,i+3));}else process.stdout.write(out);};",
  "const meta=id=>({sessionId:id,startTime:'2026-10-13T00:00:00Z',modifiedTime:'2026-10-13T00:01:00Z',isRemote:false,context:{cwd:process.cwd(),branch:'private-branch'},summary:'private-summary',name:'private-name'});",
  "function respond(m){if(!m.method){fs.writeFileSync(path.join(root,'callback'),JSON.stringify(m));if(permission){emit({jsonrpc:'2.0',id:permission.id,result:{message:'private-message',timestamp:'2026-10-13T00:00:00Z',protocolVersion:3}});permission=undefined;}return;}",
  "calls.push(m);fs.writeFileSync(path.join(root,'calls'),JSON.stringify(calls));let result;",
  "if(m.method==='connect'){result={protocolVersion:mode==='wrong-protocol'?2:3,version:'1.0.97',token:'private-token'};emit({jsonrpc:'2.0',id:m.id,result});if(mode==='queued-spoof')emit({jsonrpc:'2.0',id:2,result:{version:'1.0.97',protocolVersion:3}});return;}",
  "if(m.method==='status.get'){emit({jsonrpc:'2.0',id:m.id,result:{version:mode==='wrong-version'?'other-version':'1.0.97',protocolVersion:3,diagnostic:'private-diagnostic'}});return;}",
  "if(m.method==='session.create'){createdId=m.params.sessionId;selectedModel=m.params.model;fs.writeFileSync(path.join(root,'created'),createdId);const value={sessionId:mode==='bootstrap-wrong-id'?nativeId:mode==='bootstrap-bad-id'?4:createdId,workspacePath:path.join(process.env.COPILOT_HOME,'session-state',createdId),capabilities:{secret:'private-token'}};const event={jsonrpc:'2.0',method:'session.event',params:{sessionId:createdId,event:{type:'session.model_change',data:{newModel:'different',private:'private-token'}}}};if(mode==='bootstrap-model-event')process.stdout.write(Buffer.concat([frame({jsonrpc:'2.0',id:m.id,result:value}),frame(event)]));else emit({jsonrpc:'2.0',id:m.id,result:value});return;}",
  "if(m.method==='session.resume'){if(mode==='bootstrap-disappeared'){emit({jsonrpc:'2.0',id:m.id,error:{code:-32001,message:'private missing session'}});return;}emit({jsonrpc:'2.0',id:m.id,result:mode==='bootstrap-recovered'?{transcriptRecovery:{private:'private-token'}}:mode==='bootstrap-resume-wrong-id'?{sessionId:'other'}:{workspacePath:path.join(process.env.COPILOT_HOME,'session-state',m.params.sessionId)}});return;}",
  "if(m.method==='session.model.getCurrent'){const response={jsonrpc:'2.0',id:m.id,result:mode==='bootstrap-model-unknown'?{}:{modelId:mode==='bootstrap-model-drift'?'different':selectedModel,providerId:'copilot',private:'private-token'}};if(mode==='bootstrap-deleted'||mode==='bootstrap-sibling-deleted'){const event={jsonrpc:'2.0',method:'session.lifecycle',params:{type:'session.deleted',sessionId:mode==='bootstrap-deleted'?(createdId||nativeId):'sibling-session'}};process.stdout.write(Buffer.concat([frame(response),frame(event)]));}else emit(response);return;}",
  "if(mode==='hold')return;",
  "if(mode==='permission'){permission=m;emit({jsonrpc:'2.0',id:'native-callback',method:'permission.request',params:{token:'private-token'}});return;}",
  "if(mode==='bad-header'){process.stdout.write('Content-Length: 2x\\r\\n\\r\\n{}');return;}if(mode==='duplicate-header'){process.stdout.write('Content-Length: 2\\r\\nContent-Length: 2\\r\\n\\r\\n{}');return;}",
  "if(mode==='huge-header'){process.stdout.write('X: '+'x'.repeat(16385));return;}if(mode==='huge-body'){process.stdout.write('Content-Length: 1048577\\r\\n\\r\\n');return;}",
  "if(mode==='bad-json'){process.stdout.write('Content-Length: 5\\r\\n\\r\\nnope!');return;}if(mode==='bad-utf8'){process.stdout.write(Buffer.concat([Buffer.from('Content-Length: 1\\r\\n\\r\\n'),Buffer.from([255])]));return;}",
  "if(mode==='raw-error'){emit({jsonrpc:'2.0',id:m.id,error:{code:-32001,message:'private-token',data:{secret:'private-token'}}});return;}",
  "if(mode==='both-result-error'){emit({jsonrpc:'2.0',id:m.id,result:{},error:{code:-1,message:'private-token'}});return;}",
  "if(mode==='notify')emit({jsonrpc:'2.0',method:'session.event',params:{sessionId:nativeId,event:{type:'assistant.message',content:'private-content'}}});if(mode==='flood')process.stdout.write(Buffer.concat(Array.from({length:130},()=>frame({jsonrpc:'2.0',method:'session.event'}))));",
  "if(m.method==='auth.getStatus')result={isAuthenticated:true,login:'private-login',host:'private-host',statusMessage:'private-token',authType:'env'};",
  "else if(m.method==='session.list'){const value=meta(nativeId);if(mode==='foreign')value.context.cwd='/foreign';if(mode==='remote')value.isRemote=true;result={sessions:mode==='duplicate-id'?[value,value]:[value]};}",
  "else if(m.method==='session.getMetadata'){result={session:mode==='missing'||mode==='bootstrap-missing'?undefined:meta(mode==='prefix'||mode==='bootstrap-prefix'?m.params.sessionId+'-prefix':m.params.sessionId)};if(result.session&&mode==='bootstrap-foreign')result.session.context.cwd='/foreign';if(mode==='out-of-order'){held.push({jsonrpc:'2.0',id:m.id,result});if(held.length===2)for(const v of held.reverse())emit(v);return;}}",
  "else result={message:'private-message-中文\\u2028end',timestamp:'2026-10-13T00:00:00Z',protocolVersion:3};",
  "const response={jsonrpc:'2.0',id:mode==='unknown-id'?999:m.id,result};if(mode==='duplicate-response')process.stdout.write(Buffer.concat([frame(response),frame(response)]));else emit(response);",
  "if(mode==='root-exit'){const child=require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},2000)'],{stdio:['ignore',1,2]});child.once('spawn',()=>{fs.writeFileSync(path.join(root,'descendant'),String(child.pid));child.unref();process.exit(0);});}",
  "}",
  "process.stdin.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);for(;;){const at=buffer.indexOf('\\r\\n\\r\\n');if(at<0)return;const match=/Content-Length: (\\d+)/.exec(buffer.subarray(0,at).toString());if(!match)throw Error('bad client frame');const size=Number(match[1]);if(buffer.length<at+4+size)return;const m=JSON.parse(buffer.subarray(at+4,at+4+size).toString());buffer=buffer.subarray(at+4+size);respond(m);}});setInterval(()=>{},1000);"
 ].join("\n"),{mode:0o755});
 captureFixture(root);
 return {root,scope,calls:()=>existsSync(join(root,"calls"))?JSON.parse(readFileSync(join(root,"calls"),"utf8")) as Array<{method:string;params:Record<string,unknown>;id:unknown}>:[]};
}
async function open(f:ReturnType<typeof fixture>,options?:Options){const client=await api.CopilotRpcClient.open(f.scope,options);clients.push(client);return client;}
async function execution(f:ReturnType<typeof fixture>,beforeMutation:()=>void=()=>{}){const client=await api.CopilotRpcClient.openExecution(f.scope,{beforeMutation});clients.push(client);return client;}
const setup=(mode:"new"|"resume"="new",onSessionKnown:(id:string)=>void|Promise<void>=()=>{}):Bootstrap=>({mode,model:"chosen",nativeSessionId:mode==="new"?b:a,onSessionKnown});
function started(f:ReturnType<typeof fixture>){return JSON.parse(readFileSync(join(f.root,"started"),"utf8")) as {pid:number;args:string[];cwd:string;pwd:string;home:string};}
function alive(pid:number){try{process.kill(pid,0);return true;}catch{return false;}}
async function backpressured(f:ReturnType<typeof fixture>,force=true){
 const childProcess=createRequire(import.meta.url)("node:child_process") as typeof childProcessModule,original=childProcess.spawn;
 let child:childProcessModule.ChildProcess|undefined;
 const spy=vi.spyOn(childProcess,"spawn").mockImplementation(((executable,args,options)=>{
  const result=original(executable,args,options);if(executable===f.scope.executable)child=result;return result;
 }) as typeof childProcess.spawn);syncBuiltinESMExports();
 try{const c=await open(f);if(!child?.stdin)throw Error("Missing owned fixture stdin");if(force)Object.defineProperty(child.stdin,"writableNeedDrain",{configurable:true,get:()=>true});return {c,stdin:child.stdin};}
 finally{spy.mockRestore();syncBuiltinESMExports();}
}

it("opens only pinned local read protocol with literal executable/workspace/home and safe identity projection",async()=>{
 const f=fixture(),c=await open(f);
 expect(started(f)).toMatchObject({args:["--headless","--no-auto-update","--stdio"],cwd:f.scope.workspacePath,pwd:f.scope.workspacePath,home:f.scope.copilotHome});
 expect(await c.request("session.list")).toEqual({sessions:[{sessionId:a,startTime:"2026-10-13T00:00:00Z",modifiedTime:"2026-10-13T00:01:00Z",isRemote:false,context:{cwd:f.scope.workspacePath}}]});
 expect(f.calls().map(v=>v.method)).toEqual(["connect","status.get","session.list"]);
 expect(f.calls()[2]?.params).toEqual({filter:{cwd:f.scope.workspacePath}});
 expect(c.connectionScope).toEqual(f.scope);const receipt=await c.close();
 expect(receipt).toMatchObject({version:1,connection:"closed",ownedRoot:"exited",callbacks:"drained",backgroundTools:"unknown",nativeSessionDeleted:false});
 expect(alive(started(f).pid)).toBe(false);expect(readFileSync(join(f.scope.copilotHome,"native-file"),"utf8")).toBe("preserve");
});
it("captures original scope before open awaits rather than adopting mutable caller paths",async()=>{
 const f=fixture(),original={...f.scope},pending=api.CopilotRpcClient.open(f.scope);
 f.scope.workspacePath="/changed";f.scope.copilotHome="/changed";f.scope.executable="/changed";
 const c=await pending;clients.push(c);expect(c.connectionScope).toEqual(original);expect(started(f).cwd).toBe(original.workspacePath);
 const copy=c.connectionScope;copy.workspacePath="/copy";expect(c.connectionScope.workspacePath).toBe(original.workspacePath);
});
it.each(["wrong-protocol","wrong-version"])("rejects %s during open and stops only its captured root",async mode=>{
 const f=fixture(mode);await expect(open(f)).rejects.toMatchObject({code:"COPILOT_RPC_VERSION_UNQUALIFIED"});
 expect(alive(started(f).pid)).toBe(false);expect(readFileSync(join(f.scope.copilotHome,"native-file"),"utf8")).toBe("preserve");
});
it("checks physical original paths before a queued read",async()=>{
 const f=fixture(),c=await open(f);renameSync(f.scope.workspacePath,f.scope.workspacePath+"-old");mkdirSync(f.scope.workspacePath);
 await expect(c.request("ping")).rejects.toMatchObject({code:"COPILOT_RPC_SCOPE_CHANGED"});expect(f.calls()).toHaveLength(2);
});
it("rejects relative executable scope without invoking a PATH fallback",async()=>{
 const f=fixture();await expect(api.CopilotRpcClient.open({...f.scope,executable:"copilot"})).rejects.toMatchObject({code:"COPILOT_RPC_SCOPE_INVALID"});
 expect(existsSync(join(f.root,"started"))).toBe(false);
});
it.each(["split","normal"])("reads %s UTF8 frames without exporting native echoes or auth details",async mode=>{
 const c=await open(fixture(mode));
 expect(await c.request("ping")).toEqual({timestamp:"2026-10-13T00:00:00Z",protocolVersion:3});
 expect(await c.request("auth.getStatus")).toEqual({isAuthenticated:true});
});
it.each(["bad-header","duplicate-header","huge-header","huge-body","bad-json","bad-utf8","both-result-error","unknown-id","duplicate-response"])("rejects malformed/uncorrelated %s without raw diagnostics",async mode=>{
 const c=await open(fixture(mode));const error=await c.request("ping").catch(e=>e);
 expect(error).toMatchObject({code:"COPILOT_RPC_PROTOCOL_INVALID"});expect(String(error)).not.toContain("private-");expect(c.disconnectSignal.aborted).toBe(true);
});
it("rejects responses queued before the corresponding request actually reaches stdin",async()=>{
 const f=fixture("queued-spoof");await expect(open(f)).rejects.toMatchObject({code:"COPILOT_RPC_PROTOCOL_INVALID"});expect(alive(started(f).pid)).toBe(false);
});
it("keeps JSON-RPC errors as failures and omits native error message/data",async()=>{
 const c=await open(fixture("raw-error")),error=await c.request("ping").catch(e=>e);
 expect(error).toMatchObject({code:"COPILOT_RPC_COMMAND_REJECTED"});expect(String(error)).not.toContain("private-");
});
it.each(["foreign","remote","duplicate-id"])("refuses %s native inventory rather than broadening local discovery",async mode=>{
 const c=await open(fixture(mode));await expect(c.request("session.list")).rejects.toMatchObject({code:"COPILOT_RPC_PROTOCOL_INVALID"});
});
it("correlates simultaneous exact metadata reads in reverse response order",async()=>{
 const c=await open(fixture("out-of-order")),values=await Promise.all([c.request("session.getMetadata",{sessionId:a}),c.request("session.getMetadata",{sessionId:b})]);
 expect(values.map(value=>(value as {session:{sessionId:string}}).session.sessionId)).toEqual([a,b]);
});
it("preserves missing metadata as absence with no create/resume fallback",async()=>{
 const f=fixture("missing"),c=await open(f);expect(await c.request("session.getMetadata",{sessionId:a})).toEqual({});
 expect(f.calls().map(v=>v.method)).toEqual(["connect","status.get","session.getMetadata"]);
});
it("rejects name/prefix metadata instead of accepting another exact identity",async()=>{
 const c=await open(fixture("prefix"));await expect(c.request("session.getMetadata",{sessionId:a})).rejects.toMatchObject({code:"COPILOT_RPC_PROTOCOL_INVALID"});
});
it("keeps a read-only method and payload allowlist outside the native mutation protocol",async()=>{
 const f=fixture(),c=await open(f);
 for(const [method,params] of [["session.create",{}],["session.resume",{sessionId:a}],["session.send",{prompt:"do not execute"}],["session.list",{filter:{cwd:"/foreign"}}],["ping",{token:"private-token"}]] as Array<[string,Record<string,unknown>]>)
  await expect(c.request(method,params)).rejects.toMatchObject({code:"COPILOT_RPC_REQUEST_INVALID"});
 expect(f.calls()).toHaveLength(2);
});
it("captures metadata payload and original signal before queued work",async()=>{
 const f=fixture(),c=await open(f),payload={sessionId:a};const first=c.request("session.getMetadata",payload);payload.sessionId=b;
 expect(await first).toMatchObject({session:{sessionId:a}});const signal=new AbortController(),replacement=new AbortController(),gate=Promise.withResolvers<void>(),options:Options={signal:signal.signal,beforeSend:()=>gate.promise};
 const pending=c.request("ping",{},options),observed=expect(pending).rejects.toMatchObject({code:"COPILOT_RPC_CANCELLED"});options.signal=replacement.signal;signal.abort();gate.resolve();await observed;
 expect(f.calls().filter(v=>v.method==="ping")).toHaveLength(0);
});
it("captures one exact metadata identity even when the caller property can change between reads",async()=>{
 const c=await open(fixture());let reads=0;
 const params=Object.defineProperty({},"sessionId",{enumerable:true,get:()=>reads++===0?a:b});
 expect(await c.request("session.getMetadata",params)).toMatchObject({session:{sessionId:a}});
});
it("keeps the first original cancellation signal when the caller property can change",async()=>{
 const f=fixture(),c=await open(f),original=new AbortController(),replacement=new AbortController(),gate=Promise.withResolvers<void>();let reads=0;
 const options=Object.defineProperty({beforeSend:()=>gate.promise},"signal",{enumerable:true,get:()=>reads++===0?original.signal:replacement.signal});
 const pending=c.request("ping",{},options),observed=expect(pending).rejects.toMatchObject({code:"COPILOT_RPC_CANCELLED"});
 original.abort();gate.resolve();await observed;expect(f.calls().filter(v=>v.method==="ping")).toHaveLength(0);
});
it("drops an expired async-guard read without poisoning a later healthy read",async()=>{
 const f=fixture(),c=await open(f),gate=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>();
 const pending=c.request("ping",{}, {timeoutMs:30,beforeSend:()=>{entered.resolve();return gate.promise;}});
 const observed=expect(pending).rejects.toMatchObject({code:"COPILOT_RPC_TIMEOUT"});await entered.promise;await observed;gate.resolve();
 expect(await c.request("ping")).toMatchObject({protocolVersion:3});expect(f.calls().filter(v=>v.method==="ping")).toHaveLength(1);
});
it("rechecks scope after the original async Guard at final stdin admission",async()=>{
 const f=fixture(),c=await open(f);
 await expect(c.request("ping",{}, {beforeSend:async()=>{renameSync(f.scope.copilotHome,f.scope.copilotHome+"-old");mkdirSync(f.scope.copilotHome);}})).rejects.toMatchObject({code:"COPILOT_RPC_SCOPE_CHANGED"});
 expect(f.calls()).toHaveLength(2);
});
it.each(["close","cancel","expire"])("does not invoke an unsent Guard after backpressure %s revokes admission",async mode=>{
 const f=fixture(),{c,stdin}=await backpressured(f),signal=new AbortController();let guardCalls=0;
 const pending=c.request("ping",{}, {signal:signal.signal,timeoutMs:mode==="expire"?40:5000,beforeSend:()=>{guardCalls++;}}),observed=pending.catch(e=>e);
 await vi.waitFor(()=>expect(stdin.listenerCount("drain")).toBeGreaterThan(0));
 if(mode==="expire"){expect(await observed).toMatchObject({code:"COPILOT_RPC_TIMEOUT"});stdin.emit("drain");}
 else{stdin.emit("drain");if(mode==="close")await c.close();else signal.abort();}
 await observed;await new Promise(resolve=>setTimeout(resolve,20));expect(guardCalls).toBe(0);expect(f.calls()).toHaveLength(2);
});
it("does not add an await between a synchronous original Guard and actual stdin write",async()=>{
 const f=fixture(),{c,stdin}=await backpressured(f,false),original=stdin.write.bind(stdin);let admitted=false,atWrite:boolean|undefined;
 const spy=vi.spyOn(stdin,"write").mockImplementation(((...args)=>{atWrite=admitted;return original(...args);}) as typeof stdin.write);
 try{
  await c.request("ping",{}, {beforeSend:()=>{admitted=true;queueMicrotask(()=>{admitted=false;});}});
  expect(atWrite).toBe(true);expect(f.calls().filter(v=>v.method==="ping")).toHaveLength(1);
 }finally{spy.mockRestore();}
});
it("bounds outstanding reads and never exports a raw native permission approval",async()=>{
 const f=fixture("hold"),c=await open(f),pending=Array.from({length:64},()=>c.request("ping").catch(e=>e));
 await expect(c.request("ping")).rejects.toMatchObject({code:"COPILOT_RPC_REQUEST_LIMIT"});await c.close();await Promise.all(pending);
 const p=fixture("permission"),other=await open(p);expect(await other.request("ping")).toMatchObject({protocolVersion:3});
 const callback=JSON.parse(readFileSync(join(p.root,"callback"),"utf8"));expect(callback).toEqual({jsonrpc:"2.0",id:"native-callback",error:{code:-32601,message:"COPILOT_RPC_CLIENT_METHOD_UNSUPPORTED"}});
});
it("projects notifications per listener and bounds retained metadata",async()=>{
 const c=await open(fixture("notify")),seen:unknown[]=[];c.onEvent(value=>{value.type="changed";});c.onEvent(value=>{seen.push(value);});
 for(let i=0;i<102;i++)await c.request("ping");
 expect(seen[0]).toEqual({sequence:1,type:"session.event"});expect(c.recentEvents()).toHaveLength(100);expect(JSON.stringify(seen)).not.toContain("private-");
});
it("bounds listeners and notification backlog before codec dispatch",async()=>{
 const c=await open(fixture());for(let i=0;i<64;i++)c.onEvent(()=>{});expect(()=>c.onEvent(()=>{})).toThrowError(expect.objectContaining({code:"COPILOT_RPC_REQUEST_LIMIT"}));
 const flooded=await open(fixture("flood"));await expect(flooded.request("ping")).rejects.toMatchObject({code:"COPILOT_RPC_PROTOCOL_INVALID"});
});
it("reports unknown callback drain and refuses late writes after closing admission",async()=>{
 const f=fixture(),c=await open(f),gate=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>();
 const pending=c.request("ping",{}, {beforeSend:()=>{entered.resolve();return gate.promise;}}),observed=pending.catch(e=>e);await entered.promise;
 const receipt=await c.close();expect(receipt.callbacks).toBe("unknown");expect(receipt.backgroundTools).toBe("unknown");expect(await observed).toMatchObject({code:"COPILOT_RPC_UNREACHABLE"});
 gate.resolve();await new Promise(resolve=>setTimeout(resolve,20));expect(f.calls()).toHaveLength(2);expect(alive(started(f).pid)).toBe(false);
});
it("closes local pipes without claiming an inherited native child or Session was stopped",async()=>{
 const f=fixture("root-exit"),c=await open(f);await c.request("ping").catch(()=>{});await new Promise(resolve=>setTimeout(resolve,50));
 const receipt=await c.close(),pid=Number(readFileSync(join(f.root,"descendant"),"utf8"));
 expect(receipt).toMatchObject({ownedRoot:"exited",backgroundTools:"unknown",nativeSessionDeleted:false});expect(alive(pid)).toBe(true);
 expect(readFileSync(join(f.scope.copilotHome,"native-file"),"utf8")).toBe("preserve");
});
it("keeps the original read principal unable to bootstrap even when read options include a Guard",async()=>{
 const f=fixture(),c=await open(f);await expect(c.bootstrap(setup(),{beforeSend:()=>{}})).rejects.toMatchObject({code:"COPILOT_RPC_READ_ONLY"});expect(f.calls()).toHaveLength(2);
});
it.each(["mode","new-id","resume-id","model","control-model","callback"])("rejects invalid bootstrap %s before any native lifecycle frame",async kind=>{
 const f=fixture(),c=await execution(f),input=setup();
 if(kind==="mode")input.mode="invalid" as "new";else if(kind==="new-id")input.nativeSessionId="dispatcher-run";
 else if(kind==="resume-id"){input.mode="resume";delete input.nativeSessionId;}
 else if(kind==="callback")input.onSessionKnown=undefined as unknown as Bootstrap["onSessionKnown"];else input.model=kind==="model"?"":"bad\u0000model";
 await expect(c.bootstrap(input)).rejects.toMatchObject({creationOutcome:"not-created",code:"COPILOT_RPC_REQUEST_INVALID"});expect(f.calls()).toHaveLength(2);
});
it("requires an explicitly supplied original mutation Guard for the execution factory",async()=>{
 const f=fixture();await expect(api.CopilotRpcClient.openExecution(f.scope,{} as {beforeMutation:()=>void})).rejects.toMatchObject({code:"COPILOT_RPC_AUTHORITY_CHANGED"});expect(existsSync(join(f.root,"started"))).toBe(false);
});
it("creates an independent exact UUID and persists it before model/metadata qualification",async()=>{
 const f=fixture(),c=await execution(f),known:string[]=[];
 expect(await c.bootstrap(setup("new",id=>{known.push(id);expect(f.calls().map(v=>v.method)).toEqual(["connect","status.get","session.create"]);}))).toEqual({sessionId:b,modelId:"chosen"});
 expect(known).toEqual([b]);const request=f.calls().find(v=>v.method==="session.create")!;
 expect(request.params).toMatchObject({sessionId:b,model:"chosen",workingDirectory:f.scope.workspacePath,remoteSession:"off",enableSessionStore:true});
 expect(request.params).not.toHaveProperty("prompt");expect(f.calls().map(v=>v.method)).toEqual(["connect","status.get","session.create","session.getMetadata","session.model.getCurrent"]);
});
it("generates a new native UUID independently from Dispatcher task/session identity",async()=>{
 const f=fixture(),c=await execution(f),input=setup();delete input.nativeSessionId;const result=await c.bootstrap(input);
 expect(result.sessionId).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
 expect(f.calls().find(v=>v.method==="session.create")?.params.sessionId).toBe(result.sessionId);expect(result.modelId).toBe("chosen");
});
it("resumes only fresh exact local metadata without model override, recovery or pending replay",async()=>{
 const f=fixture(),c=await execution(f),known:string[]=[];expect(await c.bootstrap(setup("resume",id=>{known.push(id);}))).toEqual({sessionId:a,modelId:"chosen"});
 expect(known).toEqual([a]);const request=f.calls().find(v=>v.method==="session.resume")!;
 expect(request.params).toMatchObject({sessionId:a,remoteSession:"off",allowTranscriptRecovery:false,continuePendingWork:false});
 expect(request.params).not.toHaveProperty("model");expect(request.params).not.toHaveProperty("workingDirectory");
 expect(f.calls().map(v=>v.method)).toEqual(["connect","status.get","session.getMetadata","session.resume","session.getMetadata","session.model.getCurrent"]);
});
it.each(["bootstrap-missing","bootstrap-prefix","bootstrap-foreign"])("never mutates or recreates %s old Session during preflight",async mode=>{
 const f=fixture(mode),c=await execution(f);await expect(c.bootstrap(setup("resume"))).rejects.toMatchObject({creationOutcome:"not-created"});
 expect(f.calls().map(v=>v.method)).toEqual(["connect","status.get","session.getMetadata"]);expect(existsSync(join(f.root,"created"))).toBe(false);
});
it("keeps a disappearance after exact preflight as unknown resume failure with no new fallback",async()=>{
 const f=fixture("bootstrap-disappeared"),c=await execution(f);await expect(c.bootstrap(setup("resume"))).rejects.toMatchObject({creationOutcome:"unknown",code:"COPILOT_RPC_COMMAND_REJECTED"});
 expect(f.calls().filter(v=>v.method==="session.create")).toHaveLength(0);expect(f.calls().filter(v=>v.method==="session.resume")).toHaveLength(1);
});
it.each(["bootstrap-wrong-id","bootstrap-bad-id"])("refuses %s create acknowledgement without adopting another identity",async mode=>{
 const f=fixture(mode),c=await execution(f),known:unknown[]=[];await expect(c.bootstrap(setup("new",id=>{known.push(id);}))).rejects.toMatchObject({creationOutcome:"unknown"});
 expect(known).toEqual([]);expect(f.calls().filter(v=>v.method==="session.create")).toHaveLength(1);expect(f.calls().filter(v=>v.method==="session.model.getCurrent")).toHaveLength(0);
});
it.each(["bootstrap-model-drift","bootstrap-model-unknown"])("retains the known ID but refuses %s without a corrective model setter",async mode=>{
 const f=fixture(mode),c=await execution(f),known:string[]=[];await expect(c.bootstrap(setup("new",id=>{known.push(id);}))).rejects.toMatchObject({creationOutcome:"unknown"});
 expect(known).toEqual([b]);expect(f.calls().filter(v=>v.method==="session.create")).toHaveLength(1);expect(f.calls().some(v=>/switch|setModel|prompt|send/.test(v.method))).toBe(false);
});
it("does not hide native model drift by overriding it during old-session resume",async()=>{
 const f=fixture("bootstrap-model-drift"),c=await execution(f);await expect(c.bootstrap(setup("resume"))).rejects.toMatchObject({creationOutcome:"unknown",code:"COPILOT_RPC_MODEL_DRIFT"});
 expect(f.calls().find(v=>v.method==="session.resume")?.params).not.toHaveProperty("model");
});
it.each(["new","resume"] as const)("refuses same-buffer exact deletion after %s model response while retaining known binding",async mode=>{
 const f=fixture("bootstrap-deleted"),c=await execution(f),known:string[]=[],input=setup(mode,id=>{known.push(id);});
 await expect(c.bootstrap(input)).rejects.toMatchObject({creationOutcome:"unknown",code:"COPILOT_RPC_SESSION_NOT_FOUND"});
 expect(known).toEqual([input.nativeSessionId]);expect(f.calls().filter(v=>v.method===`session.${mode==="new"?"create":"resume"}`)).toHaveLength(1);
 await expect(c.bootstrap(input)).rejects.toMatchObject({code:"COPILOT_RPC_BOOTSTRAP_NOT_RETRYABLE"});
});
it.each(["new","resume"] as const)("does not invalidate %s binding for same-buffer sibling deletion",async mode=>{
 const f=fixture("bootstrap-sibling-deleted"),c=await execution(f),input=setup(mode);
 expect(await c.bootstrap(input)).toEqual({sessionId:input.nativeSessionId,modelId:"chosen"});
});
it.each(["bootstrap-recovered","bootstrap-resume-wrong-id"])("refuses %s resume acknowledgement before model admission",async mode=>{
 const f=fixture(mode),c=await execution(f);await expect(c.bootstrap(setup("resume"))).rejects.toMatchObject({creationOutcome:"unknown"});
 expect(f.calls().filter(v=>v.method==="session.model.getCurrent")).toHaveLength(0);
});
it("captures original bootstrap identity/model/callback before awaits",async()=>{
 const f=fixture(),c=await execution(f),known:string[]=[],input=setup("new",id=>{known.push(id);}),pending=c.bootstrap(input);
 input.nativeSessionId=a;input.model="changed";input.onSessionKnown=()=>{throw Error("replacement callback");};
 expect(await pending).toEqual({sessionId:b,modelId:"chosen"});expect(known).toEqual([b]);
});
it("preserves the original execution factory Guard across caller option replacement",async()=>{
 const f=fixture(),counts={original:0,replacement:0},options={beforeMutation:()=>{counts.original++;}};
 const pending=api.CopilotRpcClient.openExecution(f.scope,options);options.beforeMutation=()=>{counts.replacement++;};
 const c=await pending;clients.push(c);await c.bootstrap(setup());expect(counts).toEqual({original:2,replacement:0});
});
it("rejects a revoked original mutation Guard before actual native creation",async()=>{
 const f=fixture(),c=await execution(f,()=>{throw Error("private revoked authority");});
 await expect(c.bootstrap(setup())).rejects.toMatchObject({creationOutcome:"not-created",code:"COPILOT_RPC_AUTHORITY_CHANGED"});expect(f.calls()).toHaveLength(2);
});
it("tracks but refuses an asynchronous mutation Guard without creating",async()=>{
 const f=fixture(),gate=Promise.withResolvers<void>(),c=await execution(f,()=>gate.promise);
 await expect(c.bootstrap(setup())).rejects.toMatchObject({creationOutcome:"not-created",code:"COPILOT_RPC_AUTHORITY_CHANGED"});
 const receipt=await c.close();expect(receipt.callbacks).toBe("unknown");gate.resolve();expect(f.calls()).toHaveLength(2);
});
it("keeps early known binding before a failed original callback and never retries bootstrap",async()=>{
 const f=fixture(),c=await execution(f),known:string[]=[];await expect(c.bootstrap(setup("new",id=>{known.push(id);throw Error("private persistence failure");}))).rejects.toMatchObject({creationOutcome:"unknown",code:"COPILOT_RPC_BINDING_FAILED"});
 await expect(c.bootstrap(setup())).rejects.toMatchObject({code:"COPILOT_RPC_BOOTSTRAP_NOT_RETRYABLE"});expect(known).toEqual([b]);expect(f.calls().map(v=>v.method)).toEqual(["connect","status.get","session.create"]);
});
it("refuses final admission when known binding persistence revokes the original mutation Guard",async()=>{
 const f=fixture();let allowed=true;const c=await execution(f,()=>{if(!allowed)throw Error("private revoked after binding");});
 await expect(c.bootstrap(setup("new",()=>{allowed=false;}))).rejects.toMatchObject({creationOutcome:"unknown",code:"COPILOT_RPC_AUTHORITY_CHANGED"});
 expect(f.calls().filter(v=>v.method==="session.create")).toHaveLength(1);expect(f.calls().some(v=>/switch|prompt|send/.test(v.method))).toBe(false);
});
it("bounds an unresolved binding callback and keeps cleanup unknown rather than qualifying metadata",async()=>{
 const f=fixture(),c=await execution(f),gate=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>();
 const pending=c.bootstrap(setup("new",()=>{entered.resolve();return gate.promise;}),{timeoutMs:100}),observed=pending.catch(e=>e);await entered.promise;
 expect(await observed).toMatchObject({creationOutcome:"unknown",code:"COPILOT_RPC_TIMEOUT"});expect((await c.close()).callbacks).toBe("unknown");gate.resolve();expect(f.calls()).toHaveLength(3);
});
it("honors original cancellation while a known binding callback is pending",async()=>{
 const f=fixture(),c=await execution(f),signal=new AbortController(),gate=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>();
 const pending=c.bootstrap(setup("new",()=>{entered.resolve();return gate.promise;}),{signal:signal.signal}),observed=pending.catch(e=>e);await entered.promise;signal.abort();
 expect(await observed).toMatchObject({creationOutcome:"unknown",code:"COPILOT_RPC_CANCELLED"});gate.resolve();expect(f.calls()).toHaveLength(3);
});
it("refuses concurrent bootstrap and any duplicate attempt after one native identity was established",async()=>{
 const f=fixture(),c=await execution(f),gate=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>();
 const pending=c.bootstrap(setup("new",()=>{entered.resolve();return gate.promise;}));await entered.promise;
 await expect(c.bootstrap(setup())).rejects.toMatchObject({code:"COPILOT_RPC_BOOTSTRAP_NOT_RETRYABLE"});gate.resolve();await pending;
 await expect(c.bootstrap(setup())).rejects.toMatchObject({code:"COPILOT_RPC_BOOTSTRAP_NOT_RETRYABLE"});expect(f.calls().filter(v=>v.method==="session.create")).toHaveLength(1);
});
it("does not qualify a model-change event already received in the creation response batch",async()=>{
 const f=fixture("bootstrap-model-event"),c=await execution(f);await expect(c.bootstrap(setup())).rejects.toMatchObject({creationOutcome:"unknown",code:"COPILOT_RPC_MODEL_DRIFT"});
 expect(f.calls().filter(v=>v.method==="session.create")).toHaveLength(1);expect(f.calls().some(v=>/switch|setModel|prompt|send/.test(v.method))).toBe(false);
});

it("filters Controller authority from the real owned child while preserving native context",async()=>{
 const original={...process.env};
 try{
  process.env.DISPATCHER_OWNER_TOKEN="fake-owner-canary";process.env.dispatcher_secret_store_key="fake-key-canary";process.env.COPILOT_PROVIDER_CANARY="fake-provider-context";
  const f=fixture("environment-canary"),c=await open(f);
  expect(JSON.parse(readFileSync(join(f.root,"environment"),"utf8"))).toEqual({PWD:f.scope.workspacePath,COPILOT_HOME:f.scope.copilotHome,COPILOT_PROVIDER_CANARY:"fake-provider-context"});
  await c.close();
 }finally{process.env=original;}
});
it("reserves callback capacity before invoking a mutation Guard with 64 raw event callbacks pending",async()=>{
 const f=fixture("notify"),gate=Promise.withResolvers<void>();let checks=0;
 const c=await execution(f,()=>{checks++;});for(let i=0;i<64;i++)c.onEvent(()=>gate.promise);
 await c.request("ping");
 try{
  await expect(c.bootstrap(setup())).rejects.toMatchObject({creationOutcome:"not-created",code:"COPILOT_RPC_REQUEST_LIMIT"});
  expect(checks).toBe(0);expect(f.calls().filter(v=>v.method==="session.create")).toHaveLength(0);
 }finally{gate.resolve();}
});
it("captures a getter-backed execution Guard once before opening awaits",async()=>{
 const f=fixture();let reads=0,original=0,replacement=0;
 const options=Object.defineProperty({},"beforeMutation",{get:()=>reads++===0?()=>{original++;}:()=>{replacement++;}}) as {beforeMutation:()=>void};
 const c=await api.CopilotRpcClient.openExecution(f.scope,options);clients.push(c);await c.bootstrap(setup());
 expect({reads,original,replacement}).toEqual({reads:1,original:2,replacement:0});
});
it("retains reentrant binding callback work and caches unknown after its late settlement",async()=>{
 const f=fixture(),c=await execution(f),gate=Promise.withResolvers<void>();let closing:Promise<LocalRuntimeDisconnect>|undefined;
 const pending=c.bootstrap(setup("new",()=>{closing=c.close();return gate.promise;}));
 try{
  await expect(pending).rejects.toMatchObject({creationOutcome:"unknown",code:"COPILOT_RPC_UNREACHABLE"});
  const receipt=await closing;expect(receipt).toMatchObject({ownedRoot:"exited",callbacks:"unknown"});
  gate.resolve();await gate.promise;expect(c.close()).toBe(closing);expect(await c.close()).toBe(receipt);
  expect(f.calls().map(value=>value.method)).toEqual(["connect","status.get","session.create"]);
 }finally{gate.resolve();}
});
it("normalizes one forbidden Guard thenable once while retaining its raw reentrant shutdown work",async()=>{
 const f=fixture(),gate=Promise.withResolvers<void>();let calls=0;
 const c=await execution(f,()=>({then:(resolve:()=>void)=>{calls++;void c.close();void gate.promise.then(resolve);}}));
 try{
  await expect(c.bootstrap(setup())).rejects.toMatchObject({creationOutcome:"not-created",code:"COPILOT_RPC_AUTHORITY_CHANGED"});
  expect((await c.close()).callbacks).toBe("unknown");expect(calls).toBe(1);expect(f.calls()).toHaveLength(2);
 }finally{gate.resolve();}
});
it("stops listener admission after a callback synchronously closes the connection",async()=>{
 const c=await open(fixture("notify")),gate=Promise.withResolvers<void>();let later=0;
 c.onEvent(()=>{void c.close();return gate.promise;});c.onEvent(()=>{later++;});
 try{
  await expect(c.request("ping")).rejects.toMatchObject({code:"COPILOT_RPC_UNREACHABLE"});
  expect((await c.close()).callbacks).toBe("unknown");expect(later).toBe(0);
 }finally{gate.resolve();}
});
