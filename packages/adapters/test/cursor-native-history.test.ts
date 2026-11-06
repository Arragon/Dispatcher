import {appendFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,rmSync,statSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createRequire,syncBuiltinESMExports} from "node:module";
import type * as childProcessModule from "node:child_process";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import * as adapters from "../src/index.js";

const api=new Proxy(adapters,{get(target,key,receiver){
 const method=Reflect.get(target,key,receiver) as unknown;
 if((key!=="readCursorLocalSessions"&&key!=="locateCursorLocalSession")||typeof method!=="function")return method;
 return async(input:adapters.CursorLocalReadInput&{nativeSessionId?:string})=>{
  const root=join(input.scope.workspacePath,"..");
  captureFixture(root,"before-native",{operation:key,scope:structuredClone(input.scope),cursor:input.cursor,nativeSessionId:input.nativeSessionId,timeoutMs:input.timeoutMs??5000,signalPresent:input.signal!==undefined,signalAborted:input.signal?.aborted??false});
  try{const result:unknown=await method(input);captureFixture(root,"after-awaited-cleanup",{result});return result;}
  catch(error){captureFixture(root,"after-awaited-cleanup",{errorCode:(error as {code?:string}).code});throw error;}
 };
}});
const roots:string[]=[];
let restoreSpawnObservation=()=>{};
beforeEach(()=>{
 const childProcess=createRequire(import.meta.url)("node:child_process") as typeof childProcessModule,originalSpawn=childProcess.spawn;
 childProcess.spawn=((file:string,args?:readonly string[],options?:childProcessModule.SpawnOptions)=>{
  const root=roots.find(root=>file===join(root,"cursor-agent"));
  if(root)captureFixture(root,"actual-pre-spawn",{file,args,options:{cwd:options?.cwd,shell:options?.shell,detached:options?.detached,stdio:options?.stdio,home:options?.env?.HOME,pwd:options?.env?.PWD,authorityAbsent:!Object.keys(options?.env??{}).some(key=>["DISPATCHER_OWNER_TOKEN","DISPATCHER_SECRET_STORE_KEY"].includes(key.toUpperCase()))}});
  // Observe the real spawn and owner; retain the builtin receiver and result.
  const child=originalSpawn.call(childProcess,file,args??[],options??{});
  if(root){
   const role=args?.[0]==="--version"?"version":"acp",events=join(root,role+"-parent-events.jsonl");
   const observe=(event:string,data:Record<string,unknown>={})=>{if(existsSync(root))appendFileSync(events,JSON.stringify({utc:new Date().toISOString(),pid:child.pid,event,...data})+"\n");};
   observe("returned-spawn");child.once("spawn",()=>observe("spawn"));child.once("exit",(code,signal)=>observe("exit",{code,signal}));child.once("close",(code,signal)=>observe("close",{code,signal}));child.once("error",error=>observe("error",{name:error.name}));
   for(const pipe of ["stdout","stderr"] as const){child[pipe]?.on("data",(chunk:Buffer)=>{if(existsSync(root))appendFileSync(join(root,role+"-"+pipe+".bin"),chunk);});child[pipe]?.once("end",()=>observe(pipe+"-end"));child[pipe]?.once("close",()=>observe(pipe+"-close"));child[pipe]?.once("error",error=>observe(pipe+"-error",{name:error.name}));}
   child.stdin?.once("finish",()=>observe("stdin-finish"));child.stdin?.once("close",()=>observe("stdin-close"));
  }
  return child;
 }) as typeof childProcess.spawn;
 syncBuiltinESMExports();restoreSpawnObservation=()=>{childProcess.spawn=originalSpawn;syncBuiltinESMExports();};
});
afterEach(async()=>{
 restoreSpawnObservation();
 for(const root of roots.splice(0)){
  captureFixture(root,"before-teardown");
  const descendant=join(root,"descendant-pid");
  if(existsSync(descendant)){
   const pid=Number(readFileSync(descendant,"utf8"));
   await vi.waitFor(()=>expect(exited(pid)).toBe(true),{timeout:3500});
   captureFixture(root,"controlled-descendant-exited");
  }
  rmSync(root,{recursive:true,force:true});
 }
 vi.unstubAllEnvs();
});
let captureSequence=0;
function captureFixture(root:string,phase:string,input:Record<string,unknown>={}){
 const destination=process.env.DISPATCHER_CURSOR_FIXTURE_EVIDENCE;if(!destination)return;
 const output=join(destination,root.split("/").at(-1)!,String(++captureSequence)+"-"+phase);mkdirSync(output,{recursive:true});
 const identities:Record<string,unknown>={};
 const walk=(directory:string,relative="")=>{
  const stat=statSync(directory);identities[relative||"."]={path:directory,dev:stat.dev,ino:stat.ino,mode:stat.mode,size:stat.size,mtimeMs:stat.mtimeMs};
  for(const name of readdirSync(directory)){
   const path=join(directory,name),next=join(relative,name),info=statSync(path);
   if(info.isDirectory()){mkdirSync(join(output,"payload",next),{recursive:true});walk(path,next);}
   else if(info.isFile()){const bytes=readFileSync(path),target=join(output,"payload",next);mkdirSync(join(target,".."),{recursive:true});writeFileSync(target,bytes);identities[next]={path,dev:info.dev,ino:info.ino,mode:info.mode,size:info.size,mtimeMs:info.mtimeMs,payloadBytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")};}
  }
 };
 walk(root);
 const observed:Record<string,unknown>={};for(const name of ["started","probe-pid","descendant-pid","version-root","acp-root"]){const path=join(root,name);if(existsSync(path)){const bytes=readFileSync(path,"utf8"),pid=["started","version-root","acp-root"].includes(name)?(JSON.parse(bytes) as {pid:number}).pid:Number(bytes);const observation=observeRoot(pid);observed[name]={pid,observation,rootAbsentAtObservation:observation.state==="absent"?true:observation.state==="present"?false:null};}}
 writeFileSync(join(output,"manifest.json"),JSON.stringify({utc:new Date().toISOString(),root,phase,input,identities,observed,limits:"PID absence observes only generated controlled roots; no native writer, group, background release or SDK stop receipt is inferred"},null,2)+"\n");
}
function fixture(mode="normal"){
 const root=mkdtempSync(join(realpathSync(tmpdir()),"dispatcher-cursor-history-"));roots.push(root);
 const workspacePath=join(root,"workspace"),homePath=join(root,"home"),executable=join(root,"cursor-agent");
 mkdirSync(workspacePath);mkdirSync(homePath);
 writeFileSync(executable,[
  "#!"+process.execPath,
  "const fs=require('node:fs'),path=require('node:path'),root="+JSON.stringify(root)+",mode="+JSON.stringify(mode)+";",
  "if(process.argv.includes('--version')){if(mode==='version-hang'){fs.writeFileSync(path.join(root,'probe-pid'),String(process.pid));setInterval(()=>{},1000);}else{if(mode==='home-drift'){fs.renameSync(process.env.HOME,process.env.HOME+'-old');fs.mkdirSync(process.env.HOME);}process.stdout.write(mode==='wrong-version'?'unknown-version':'2026.10.01-e373342');process.exit(0);}return;}",
  "fs.writeFileSync(path.join(root,'started'),JSON.stringify({pid:process.pid,args:process.argv.slice(2),cwd:process.cwd(),pwd:process.env.PWD,home:process.env.HOME}));",
  "const calls=[];let buffer='';const emit=v=>process.stdout.write(JSON.stringify(v)+'\\n');",
  "process.stdin.on('data',c=>{buffer+=c;while(buffer.includes('\\n')){const at=buffer.indexOf('\\n'),line=buffer.slice(0,at);buffer=buffer.slice(at+1);const m=JSON.parse(line);calls.push(m);fs.writeFileSync(path.join(root,'calls'),JSON.stringify(calls));",
  "if(m.method==='initialize'){const response={jsonrpc:'2.0',id:m.id,result:{protocolVersion:mode==='wrong-protocol'?2:1,agentCapabilities:{loadSession:true,sessionCapabilities:mode==='no-list'?{}:{list:{}}},authMethods:[{id:'cursor_login',name:'private-account-do-not-export'}],_meta:{token:'private-token-do-not-export'}}};if(mode==='unsolicited'){process.stdout.write(JSON.stringify(response)+'\\n'+JSON.stringify({jsonrpc:'2.0',id:2,result:{sessions:[{sessionId:'spoof-exact',cwd:process.cwd()}]}})+'\\n');}else emit(response);continue;}",
  "if(m.method!=='session/list'){fs.writeFileSync(path.join(root,'unexpected'),m.method);continue;}if(mode==='ignore')continue;",
  "if(mode==='permission'){emit({jsonrpc:'2.0',id:'native-permission',method:'session/request_permission',params:{sessionId:'native-exact'}});continue;}",
  "if(mode==='bad-json'){process.stdout.write('private-token-do-not-export\\n');continue;}if(mode==='bad-utf8'){process.stdout.write(Buffer.from([255,10]));continue;}",
  "if(mode==='flood'){process.stdout.write('{}\\n'.repeat(100));continue;}if(mode==='huge'){process.stdout.write('x'.repeat(1048577));continue;}",
  "const result={sessions:[{sessionId:'native-exact',cwd:process.cwd(),title:'private-title-do-not-export',_meta:{token:'private-token-do-not-export'}}],nextCursor:null};",
  "if(mode==='duplicate')result.sessions.push(result.sessions[0]);if(mode==='foreign')result.sessions[0].cwd='/foreign';if(mode==='reserved')result.sessions[0].sessionId='-1';",
  "if(mode==='empty')result.sessions=[];if(mode==='null')result.sessions=null;if(mode==='oversize')result.sessions=Array.from({length:101},(_,i)=>({sessionId:'id-'+i,cwd:process.cwd()}));",
  "if(mode==='uid-control')result.sessions[0].sessionId='native\\tbad';if(mode==='bad-cursor')result.nextCursor={secret:'private-token-do-not-export'};",
  "if(mode==='paged'){if(!m.params.cursor){result.sessions[0].sessionId='native-exact-prefix';result.nextCursor='opaque/+=';}}",
  "if(mode==='missing')result.sessions[0].sessionId='native-exact-prefix';if(mode==='loop'){result.sessions=[];result.nextCursor='repeat';}",
  "if(mode==='cross-duplicate')result.nextCursor=m.params.cursor?null:'page2';",
  "if(mode==='final-home-drift'){fs.renameSync(process.env.HOME,process.env.HOME+'-old');fs.mkdirSync(process.env.HOME);}",
  "if(mode==='final-workspace-drift'){fs.renameSync(process.cwd(),process.cwd()+'-old');fs.mkdirSync(process.env.PWD);}",
  "if(mode==='rpc-error'){emit({jsonrpc:'2.0',id:m.id,error:{code:401,message:'private-token-do-not-export'}});continue;}",
  "if(mode==='inherited'||mode==='inherited-invalid'){const c=require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},2000)'],{stdio:['ignore',process.stdout,process.stderr]});c.once('spawn',()=>{fs.writeFileSync(path.join(root,'descendant-pid'),String(c.pid));emit({jsonrpc:'2.0',id:mode==='inherited-invalid'?999:m.id,result});c.unref();process.exit(0);});continue;}",
  "if(mode==='late-duplicate'){process.once('SIGTERM',()=>{fs.writeFileSync(path.join(root,'late-duplicate-during-cleanup'),String(m.id));emit({jsonrpc:'2.0',id:m.id,result});setTimeout(()=>process.exit(0),150);});}",
  "emit({jsonrpc:'2.0',id:mode==='wrong-id'?999:m.id,result});",
  "if(mode==='late-pipe-error'){process.on('SIGTERM',()=>setTimeout(()=>process.exit(0),150));}",
  "}});setInterval(()=>{},1000);"
 ].join("\n"),{mode:0o755});
 // Retain actual root identities without changing the protocol fixture above.
 {
  const bytes=readFileSync(executable,"utf8"),at=bytes.indexOf("\n");
  const observation="require('node:fs').writeFileSync(require('node:path').join("+JSON.stringify(root)+",process.argv.includes('--version')?'version-root':'acp-root'),JSON.stringify({pid:process.pid,args:process.argv.slice(2),cwd:process.cwd(),pwd:process.env.PWD,home:process.env.HOME}));\n";
  writeFileSync(executable,bytes.slice(0,at+1)+observation+bytes.slice(at+1),{mode:0o755});
 }
 // Additional actual-child controls stay outside the protocol fixture above.
 if(mode==="environment-isolation"){
  const bytes=readFileSync(executable,"utf8"),at=bytes.indexOf("\n");
  const check="if(Object.keys(process.env).some(k=>['DISPATCHER_OWNER_TOKEN','DISPATCHER_SECRET_STORE_KEY'].includes(k.toUpperCase())))process.exit(71);if(process.env.CURSOR_API_KEY!=='fixture-cursor-auth'||process.env.PROVIDER_FIXTURE_CONTEXT!=='retained'||!process.env.PATH||process.env.PWD!==process.cwd())process.exit(72);\n";
  writeFileSync(executable,bytes.slice(0,at+1)+check+bytes.slice(at+1),{mode:0o755});
 }
 if(mode.startsWith("extra-")){
  const bytes=readFileSync(executable,"utf8"),at=bytes.indexOf("\n");
  const control=[
   "const fixtureMode="+JSON.stringify(mode)+";",
   "if(process.argv.includes('--version')){if(fixtureMode==='extra-version-stderr'){process.stderr.write('x'.repeat(1048577),()=>process.exit(0));return;}if(fixtureMode==='extra-version-utf8')process.stderr.write(Buffer.from([255]));if(fixtureMode==='extra-executable-drift')require('node:fs').appendFileSync(process.argv[1],'\\n// drift');}",
   "const originalWrite=process.stdout.write.bind(process.stdout);let fixturePage=0;",
   "process.stdout.write=function(chunk,...rest){if(!process.argv.includes('--version')){let packet;try{packet=JSON.parse(String(chunk));}catch{}if(packet?.result?.sessions){fixturePage++;if(fixtureMode==='extra-stderr-utf8')process.stderr.write(Buffer.from([255]));if(fixtureMode==='extra-stderr-huge'){process.stderr.write('x'.repeat(1048577));return true;}if(fixtureMode==='extra-ten-pages'||fixtureMode==='extra-eleven-pages'){packet.result.sessions=Array.from({length:100},(_,i)=>({sessionId:fixturePage===1&&i===0?'native-exact':'page-'+fixturePage+'-id-'+i,cwd:process.cwd()}));packet.result.nextCursor=fixturePage<(fixtureMode==='extra-ten-pages'?10:11)?'page-'+fixturePage:null;chunk=JSON.stringify(packet)+'\\n';}}}return originalWrite(chunk,...rest);};"
  ].join("\n")+"\n";
  writeFileSync(executable,bytes.slice(0,at+1)+control+bytes.slice(at+1),{mode:0o755});
 }
 captureFixture(root,"generated-executable",{mode,scope:{executable,workspacePath,homePath},calls:[],protocolFixture:mode==="late-duplicate"?"duplicate-on-cleanup-signal":"native-read-fixture"});
 return {root,scope:{executable,workspacePath,homePath},calls:()=>existsSync(join(root,"calls"))?JSON.parse(readFileSync(join(root,"calls"),"utf8")) as Array<{method:string;params:Record<string,unknown>;id:unknown}>:[]};
}
function observeRoot(pid:number):{state:"present"|"absent"|"unknown";code?:string}{
 try{process.kill(pid,0);return {state:"present"};}
 catch(error){const code=(error as NodeJS.ErrnoException).code??"UNKNOWN";return {state:code==="ESRCH"?"absent":"unknown",code};}
}
function exited(pid:number){return observeRoot(pid).state==="absent";}

it("reads pinned Cursor local inventory with literal scope and metadata-only projection",async()=>{
 const f=fixture(),page=await api.readCursorLocalSessions({scope:f.scope,cursor:"opaque/+="});
 expect(page).toEqual({sessions:[{sessionId:"native-exact",cwd:f.scope.workspacePath}]});
 const started=JSON.parse(readFileSync(join(f.root,"started"),"utf8"));
 expect(started).toMatchObject({args:["acp"],cwd:f.scope.workspacePath,pwd:f.scope.workspacePath,home:f.scope.homePath});
 expect(exited(started.pid)).toBe(true);
 expect(f.calls().map(c=>c.method)).toEqual(["initialize","session/list"]);
 expect(f.calls()[0]?.params).toMatchObject({protocolVersion:1,clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false}});
 expect(f.calls()[1]?.params).toEqual({cwd:f.scope.workspacePath,cursor:"opaque/+="});
 expect(JSON.stringify(page)).not.toMatch(/private-(title|token|account)-do-not-export/);
});
it("requires negotiated list support rather than returning empty success",async()=>{
 const f=fixture("no-list");await expect(api.readCursorLocalSessions({scope:f.scope})).rejects.toMatchObject({code:"CURSOR_LOCAL_LIST_UNSUPPORTED"});
 expect(f.calls().map(c=>c.method)).toEqual(["initialize"]);
});
it.each(["wrong-version","wrong-protocol"])( "rejects an unqualified %s",async mode=>{
 const f=fixture(mode);await expect(api.readCursorLocalSessions({scope:f.scope})).rejects.toMatchObject({code:mode==="wrong-version"?"CURSOR_LOCAL_VERSION_UNQUALIFIED":"CURSOR_LOCAL_PROTOCOL_UNQUALIFIED"});
 if(mode==="wrong-version")expect(existsSync(join(f.root,"started"))).toBe(false);
});
it.each(["duplicate","foreign","reserved","null","oversize","uid-control","bad-cursor"])( "rejects invalid %s inventory",async mode=>{
 const f=fixture(mode);await expect(api.readCursorLocalSessions({scope:f.scope})).rejects.toMatchObject({code:"CURSOR_LOCAL_INVENTORY_INVALID"});
});
it.each(["bad-json","bad-utf8","flood","huge","permission","wrong-id"])( "refuses %s framing without logs, approvals or native execution",async mode=>{
 const f=fixture(mode),spy=vi.spyOn(console,"error").mockImplementation(()=>{});
 try{
  await expect(api.readCursorLocalSessions({scope:f.scope})).rejects.toMatchObject({code:"CURSOR_LOCAL_PROTOCOL_INVALID"});
  expect(spy).not.toHaveBeenCalled();expect(existsSync(join(f.root,"unexpected"))).toBe(false);
  expect(f.calls().map(c=>c.method)).toEqual(["initialize","session/list"]);
 }finally{spy.mockRestore();}
});
it("normalizes native RPC rejection without private diagnostics",async()=>{
 const f=fixture("rpc-error");await expect(api.readCursorLocalSessions({scope:f.scope})).rejects.toMatchObject({code:"CURSOR_LOCAL_READ_REJECTED",message:"CURSOR_LOCAL_READ_REJECTED"});
});
it("captures original scope and cursor across awaits",async()=>{
 const f=fixture(),original=structuredClone(f.scope),input={scope:f.scope,cursor:"original"};
 const pending=api.readCursorLocalSessions(input);input.scope.homePath="/foreign";input.cursor="changed";
 expect(await pending).toEqual({sessions:[{sessionId:"native-exact",cwd:original.workspacePath}]});
 expect(f.calls()[1]?.params.cursor).toBe("original");
 expect(JSON.parse(readFileSync(join(f.root,"started"),"utf8")).home).toBe(original.homePath);
});
it.each(["home-drift","final-home-drift"])("rejects physical %s scope change",async mode=>{
 const f=fixture(mode);await expect(api.readCursorLocalSessions({scope:f.scope})).rejects.toMatchObject({code:"CURSOR_LOCAL_SCOPE_CHANGED"});
 if(mode==="home-drift")expect(existsSync(join(f.root,"started"))).toBe(false);
});
it("rejects original cancellation before allocating a root",async()=>{
 const f=fixture(),signal=AbortSignal.abort();await expect(api.readCursorLocalSessions({scope:f.scope,signal})).rejects.toMatchObject({code:"CURSOR_LOCAL_READ_CANCELLED"});
 expect(existsSync(join(f.root,"started"))).toBe(false);
});
it("cancels a waiting native read and confirms only its captured root exit",async()=>{
 const f=fixture("ignore"),controller=new AbortController(),input={scope:f.scope,signal:controller.signal};
 const pending=api.readCursorLocalSessions(input);void pending.catch(()=>{});
 await vi.waitFor(()=>expect(f.calls()).toHaveLength(2),{timeout:3500});
 input.signal=new AbortController().signal;controller.abort();
 await expect(pending).rejects.toMatchObject({code:"CURSOR_LOCAL_READ_CANCELLED"});
 expect(exited(JSON.parse(readFileSync(join(f.root,"started"),"utf8")).pid)).toBe(true);
});
it("bounds a hung version probe under the original deadline",async()=>{
 const f=fixture("version-hang");await expect(api.readCursorLocalSessions({scope:f.scope,timeoutMs:300})).rejects.toMatchObject({code:"CURSOR_LOCAL_READ_TIMEOUT"});
 expect(existsSync(join(f.root,"started"))).toBe(false);
 if(existsSync(join(f.root,"probe-pid")))expect(exited(Number(readFileSync(join(f.root,"probe-pid"),"utf8")))).toBe(true);
});
it("prioritizes inherited-pipe cleanup uncertainty over a valid inventory",async()=>{
 const f=fixture("inherited");await expect(api.readCursorLocalSessions({scope:f.scope})).rejects.toMatchObject({code:"CURSOR_LOCAL_CLEANUP_UNKNOWN"});
 expect(existsSync(join(f.root,"descendant-pid"))).toBe(true);
});
it("rejects a queued response before its corresponding request was sent",async()=>{
 const f=fixture("unsolicited");await expect(api.readCursorLocalSessions({scope:f.scope})).rejects.toMatchObject({code:"CURSOR_LOCAL_PROTOCOL_INVALID"});
});
it("retains protocol failure arriving during original local cleanup",async()=>{
 const f=fixture("late-duplicate");await expect(api.readCursorLocalSessions({scope:f.scope})).rejects.toMatchObject({code:"CURSOR_LOCAL_PROTOCOL_INVALID"});
 expect(readFileSync(join(f.root,"late-duplicate-during-cleanup"),"utf8")).toBe("2");
});
it("does not let codec cancellation hide inherited-pipe cleanup uncertainty",async()=>{
 const f=fixture("inherited-invalid");await expect(api.readCursorLocalSessions({scope:f.scope})).rejects.toMatchObject({code:"CURSOR_LOCAL_CLEANUP_UNKNOWN"});
 expect(existsSync(join(f.root,"descendant-pid"))).toBe(true);
});
it.each(["stdout","stderr"] as const)("does not return fresh inventory after a %s source pipe error during cleanup",async pipe=>{
 const f=fixture("late-pipe-error"),childProcess=createRequire(import.meta.url)("node:child_process") as typeof childProcessModule,originalSpawn=childProcess.spawn;
 let inventorySeen=false,injected=false;
 const spy=vi.spyOn(childProcess,"spawn").mockImplementation(((file:string,args?:readonly string[],options?:childProcessModule.SpawnOptions)=>{
  const child=originalSpawn(file,args??[],options??{});
  if(file===f.scope.executable&&args?.[0]==="acp"){
   // The isolated pre-fix stderr probe needs a fixture handler to avoid
   // terminating the test host; production must record the same failure.
   child[pipe]?.once("error",()=>{});
   child.stdout?.on("data",(chunk:Buffer)=>{if(chunk.toString().includes('"sessionId":"native-exact"'))inventorySeen=true;});
   const kill=child.kill.bind(child);
   child.kill=signal=>{const source=child[pipe];if(signal==="SIGTERM"&&inventorySeen&&!injected&&source){injected=true;source.destroy(new Error("private-pipe-error-do-not-export"));}return kill(signal);};
  }return child;
 }) as typeof childProcess.spawn);
 syncBuiltinESMExports();
 try{await expect(api.readCursorLocalSessions({scope:f.scope})).rejects.toMatchObject({code:"CURSOR_LOCAL_CLEANUP_UNKNOWN"});expect(inventorySeen).toBe(true);expect(injected).toBe(true);}
 finally{spy.mockRestore();syncBuiltinESMExports();}
});
it("locates an exact native ID across bounded native pagination without loading it",async()=>{
 const f=fixture("paged");expect(await api.locateCursorLocalSession({scope:f.scope,nativeSessionId:"native-exact"})).toEqual({sessionId:"native-exact",cwd:f.scope.workspacePath});
 expect(f.calls().map(c=>c.method)).toEqual(["initialize","session/list","session/list"]);
 expect(f.calls().at(-1)?.params.cursor).toBe("opaque/+=");
});
it("rejects prefixes and missing native IDs without new/load/latest fallback",async()=>{
 const f=fixture("missing");await expect(api.locateCursorLocalSession({scope:f.scope,nativeSessionId:"native-exact"})).rejects.toMatchObject({code:"CURSOR_LOCAL_SESSION_NOT_FOUND"});
 expect(f.calls().map(c=>c.method)).toEqual(["initialize","session/list"]);
});
it("refuses the latest-session CLI selector before any query",async()=>{
 const f=fixture();await expect(api.locateCursorLocalSession({scope:f.scope,nativeSessionId:"-1"})).rejects.toMatchObject({code:"CURSOR_LOCAL_SESSION_ID_INVALID"});
 expect(existsSync(join(f.root,"started"))).toBe(false);
});
it("rejects duplicate native identities even after finding an earlier exact match",async()=>{
 const f=fixture("cross-duplicate");await expect(api.locateCursorLocalSession({scope:f.scope,nativeSessionId:"native-exact"})).rejects.toMatchObject({code:"CURSOR_LOCAL_INVENTORY_INVALID"});
});
it("keeps incomplete or looping inventory distinct from an absent Session",async()=>{
 const f=fixture("loop");await expect(api.locateCursorLocalSession({scope:f.scope,nativeSessionId:"native-exact"})).rejects.toMatchObject({code:"CURSOR_LOCAL_LOOKUP_INCOMPLETE"});
 expect(f.calls()).toHaveLength(3);
});
it("checks the final original workspace identity",async()=>{
 const f=fixture("final-workspace-drift");await expect(api.readCursorLocalSessions({scope:f.scope})).rejects.toMatchObject({code:"CURSOR_LOCAL_SCOPE_CHANGED"});
});

function savedCursor(providerSessionId:string){
 const store=new adapters.MemorySessionStore(),session:adapters.AdapterSession={id:"dispatcher-session",runId:"run",profileId:"cursor-profile",backendId:"cursor-local-cli",workspacePath:"/workspace",providerSessionId,state:"COMPLETED",legacyModel:{id:"chosen"},createdAt:"2026-10-13T00:00:00Z",updatedAt:"2026-10-13T00:00:00Z"};
 store.save(session);const calls:adapters.CliStartInput[]=[],credential=vi.fn(async()=>"fixture-private-key");
 const backend:adapters.CliAgentBackend={start:input=>{calls.push(input);return {status:()=>"completed",cancel:async()=>{},result:async()=>({state:"completed",summary:"done",events:[],providerSessionId})};}};
 const adapter=new adapters.CursorAdapter({id:"cursor-profile",alias:"Cursor",executable:"fixed-cursor",credentialRef:"secret://cursor/fixture",trustWorkspace:true,approveTools:false},backend,store,credential);
 return {adapter,store,session,calls,credential};
}
it.each(["-1","--force","--continue","--api-key","native\tbad","native\0bad"])( "rejects non-exact resume ID %j before credentials, invocation or execution",async nativeId=>{
 const f=savedCursor(nativeId);await expect(f.adapter.send(f.session.id,"next")).rejects.toMatchObject({code:"CURSOR_LOCAL_SESSION_ID_INVALID"});
 expect(f.credential).not.toHaveBeenCalled();expect(f.calls).toHaveLength(0);expect(f.store.load(f.session.id)).toEqual(f.session);
});
it("preserves exact opaque Cursor resume and separate workspace trust/tool approval",async()=>{
 const id="native-opaque/+=\u2028",f=savedCursor(id);await f.adapter.send(f.session.id,"literal; $(command)");
 expect(f.calls).toHaveLength(1);expect(f.calls[0]?.args).toEqual(["--print","--trust","--output-format","stream-json","--resume",id,"--model","chosen","--","literal; $(command)"]);
 expect(f.store.load(f.session.id)?.legacyModel).toEqual({id:"chosen"});
 expect(f.calls[0]?.args).not.toContain("--force");expect(f.calls[0]?.args).not.toContain("--continue");
 expect(f.calls[0]?.executable).toBe("fixed-cursor");expect(f.calls[0]?.workspacePath).toBe("/workspace");
});
it.each([false,true])("keeps current tool approval consistent with literal argv after credential awaits (%s)",async initial=>{
 const f=savedCursor("native-exact");f.adapter.profile.approveTools=initial;
 f.credential.mockImplementation(async()=>{f.adapter.profile.approveTools=!initial;return "fixture-private-key";});
 await f.adapter.send(f.session.id,"next");
 expect(f.calls[0]?.args.includes("--force")).toBe(!initial);expect(f.calls[0]?.args.includes("--trust")).toBe(true);
});
// Normative source46 adaptation: canonical v3 refuses unknown historical choices.
it("preserves pre-snapshot historical data and rejects missing model before credentials",async()=>{
 const f=savedCursor("native-exact"),old={...f.session};delete old.legacyModel;f.store.save(old);f.adapter.profile.model="old-default";
 f.credential.mockImplementation(async()=>{f.adapter.profile.model="current-default";return "fixture-private-key";});
 const before=JSON.stringify(f.store.load(f.session.id));
 await expect(f.adapter.send(f.session.id,"next")).rejects.toMatchObject({code:"MODEL_SNAPSHOT_UNKNOWN"});
 expect(f.credential).not.toHaveBeenCalled();expect(f.calls).toHaveLength(0);
 expect(JSON.stringify(f.store.load(f.session.id))).toBe(before);
});


it("filters Controller authority from both scoped children while preserving native auth and PATH",async()=>{
 vi.stubEnv("DISPATCHER_OWNER_TOKEN","fixture-owner-only");vi.stubEnv("dispatcher_secret_store_key","fixture-key-only");
 vi.stubEnv("CURSOR_API_KEY","fixture-cursor-auth");vi.stubEnv("PROVIDER_FIXTURE_CONTEXT","retained");
 const f=fixture("environment-isolation"),page=await api.readCursorLocalSessions({scope:f.scope});
 expect(page).toEqual({sessions:[{sessionId:"native-exact",cwd:f.scope.workspacePath}]});
 expect(f.calls().map(c=>c.method)).toEqual(["initialize","session/list"]);
});

it.each([0,30001,1.5,NaN,Infinity])("rejects invalid original deadline %s before native allocation",async timeoutMs=>{
 const f=fixture();await expect(api.readCursorLocalSessions({scope:f.scope,timeoutMs})).rejects.toMatchObject({code:"CURSOR_LOCAL_READ_INVALID"});
 expect(existsSync(join(f.root,"started"))).toBe(false);expect(f.calls()).toEqual([]);
});
it.each(["", "relative", "/bad\0path", "/bad\u007fpath", "/"+"x".repeat(4096)])("refuses invalid absolute physical scope %j before native allocation",async executable=>{
 const f=fixture();await expect(api.readCursorLocalSessions({scope:{...f.scope,executable}})).rejects.toMatchObject({code:"CURSOR_LOCAL_SCOPE_CHANGED"});expect(f.calls()).toEqual([]);
});
it.each(["", "-latest", "x".repeat(513), "native\u007fbad"])("refuses invalid locator identity %j before native allocation",async nativeSessionId=>{
 const f=fixture();await expect(api.locateCursorLocalSession({scope:f.scope,nativeSessionId})).rejects.toMatchObject({code:"CURSOR_LOCAL_SESSION_ID_INVALID"});expect(f.calls()).toEqual([]);
});
it("exhausts exactly ten 100-entry pages after an early exact match",async()=>{
 const f=fixture("extra-ten-pages");expect(await api.locateCursorLocalSession({scope:f.scope,nativeSessionId:"native-exact"})).toEqual({sessionId:"native-exact",cwd:f.scope.workspacePath});expect(f.calls()).toHaveLength(11);
});
it("refuses a still-incomplete eleventh page rather than using an early exact match",async()=>{
 const f=fixture("extra-eleven-pages");await expect(api.locateCursorLocalSession({scope:f.scope,nativeSessionId:"native-exact"})).rejects.toMatchObject({code:"CURSOR_LOCAL_LOOKUP_INCOMPLETE"});expect(f.calls()).toHaveLength(11);
});
it("detects executable bytes changing during the pinned version probe",async()=>{
 const f=fixture("extra-executable-drift");await expect(api.readCursorLocalSessions({scope:f.scope})).rejects.toMatchObject({code:"CURSOR_LOCAL_SCOPE_CHANGED"});expect(existsSync(join(f.root,"started"))).toBe(false);
});
it.each(["extra-version-stderr","extra-version-utf8"])("rejects invalid %s diagnostics after scoped version cleanup",async mode=>{
 const f=fixture(mode);await expect(api.readCursorLocalSessions({scope:f.scope})).rejects.toMatchObject({code:"CURSOR_LOCAL_RUNTIME_UNAVAILABLE"});expect(existsSync(join(f.root,"started"))).toBe(false);
});
it.each(["extra-stderr-utf8","extra-stderr-huge"])("rejects invalid %s after native root cleanup",async mode=>{
 const f=fixture(mode);await expect(api.readCursorLocalSessions({scope:f.scope})).rejects.toMatchObject({code:"CURSOR_LOCAL_PROTOCOL_INVALID"});expect(exited(JSON.parse(readFileSync(join(f.root,"started"),"utf8")).pid)).toBe(true);
});

it.each([["EPERM",false],["EACCES",false],["ESRCH",true]] as const)("requires strict process absence evidence for %s",(code,absent)=>{
 const spy=vi.spyOn(process,"kill").mockImplementation(()=>{throw Object.assign(new Error("controlled process observation"),{code});});
 try{expect(exited(process.pid)).toBe(absent);expect(observeRoot(process.pid)).toEqual({state:absent?"absent":"unknown",code});}finally{spy.mockRestore();}
});

it.each(["version","acp"] as const)("redacts a synchronous %s spawn exception without retry or substitute",async phase=>{
 const f=fixture(),childProcess=createRequire(import.meta.url)("node:child_process") as typeof childProcessModule,originalSpawn=childProcess.spawn,attempts:string[][]=[];
 const spy=vi.spyOn(childProcess,"spawn").mockImplementation(((file:string,args?:readonly string[],options?:childProcessModule.SpawnOptions)=>{
  if(file===f.scope.executable){
   attempts.push([...(args??[])]);writeFileSync(join(f.root,"sync-spawn-attempts"),JSON.stringify(attempts));
   if(args?.[0]===(phase==="version"?"--version":"acp")){
    captureFixture(f.root,"controlled-synchronous-spawn-fault",{phase,file,args,options:{cwd:options?.cwd,shell:options?.shell,detached:options?.detached,stdio:options?.stdio},fault:"injected ENOMEM; no actual OS failure or returned child handle"});
    throw Object.assign(new Error("private-native-spawn-diagnostic-do-not-export"),{code:"ENOMEM"});
   }
  }
  return originalSpawn.call(childProcess,file,args??[],options??{});
 }) as typeof childProcess.spawn);syncBuiltinESMExports();
 try{
  await expect(api.readCursorLocalSessions({scope:f.scope})).rejects.toMatchObject({code:"CURSOR_LOCAL_RUNTIME_UNAVAILABLE",message:"CURSOR_LOCAL_RUNTIME_UNAVAILABLE"});
  expect(attempts).toEqual(phase==="version"?[["--version"]]:[["--version"],["acp"]]);
  expect(f.calls()).toEqual([]);expect(existsSync(join(f.root,"started"))).toBe(false);
  if(phase==="version")expect(existsSync(join(f.root,"version-root"))).toBe(false);
  else expect(exited(JSON.parse(readFileSync(join(f.root,"version-root"),"utf8")).pid)).toBe(true);
 }finally{spy.mockRestore();syncBuiltinESMExports();}
});
