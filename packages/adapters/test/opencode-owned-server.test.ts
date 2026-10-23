import {chmodSync,existsSync,mkdtempSync,readFileSync,realpathSync,renameSync,rmSync,writeFileSync,mkdirSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach,expect,it,vi} from "vitest";
import * as adapters from "../src/index.js";
import * as versionProbe from "../src/native-version-probe.js";

const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0))await close();});
function fixture(mode="normal",beforeSpawn?:()=>void){
 const root=realpathSync(mkdtempSync(join(tmpdir(),"opencode-owned-host-"))),file=join(root,"native.cjs");
 const source=`#!${process.execPath}
const fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const mode=${JSON.stringify(mode)};
if(process.argv.includes('--version')){
 fs.writeFileSync('probe-environment.json',JSON.stringify({context:process.env.DISPATCHER_NATIVE_CANARY,authority:!!process.env.DISPATCHER_OWNER_TOKEN||!!process.env.dispatcher_secret_store_key}));
 if(mode==='probe-gate'){fs.writeFileSync('probe-entered','yes');const timer=setInterval(()=>{if(fs.existsSync('probe-release')){clearInterval(timer);console.log('opencode v2.0.22');process.exit(0);}},10);return;}
 if(mode==='version-resistant'){fs.writeFileSync('version-pid.txt',String(process.pid));process.on('SIGTERM',()=>fs.writeFileSync('version-term.txt','owned'));setInterval(()=>{},1000);setTimeout(()=>process.exit(2),8000);return;}
 if(mode==='version-drift'){fs.renameSync(process.cwd(),process.cwd()+'.old');fs.mkdirSync(process.cwd());}
 console.log(mode==='unsupported'?'opencode v9.9.9':mode==='current-version'||mode==='version-mismatch'?'opencode v2.0.26':'opencode v2.0.22');process.exit(0);
}
fs.writeFileSync('started.json',JSON.stringify({pid:process.pid,args:process.argv.slice(2),cwd:process.cwd(),pwd:process.env.PWD,passwordPresent:!!process.env.OPENCODE_PASSWORD,context:process.env.DISPATCHER_NATIVE_CANARY,authority:!!process.env.DISPATCHER_OWNER_TOKEN||!!process.env.dispatcher_secret_store_key,serverPassword:!!process.env.OPENCODE_SERVER_PASSWORD,handoff:!!process.env.OPENCODE_PTY_HANDOFF}));
process.on('SIGTERM',()=>{fs.writeFileSync('term.txt','owned');if(mode!=='resistant')process.exit(0);});
const server=http.createServer((req,res)=>{
 if(req.url==='/api/root-exit'){const child=require('node:child_process').spawn(process.execPath,['-e',"setTimeout(()=>process.exit(0),1800)"],{detached:true,stdio:['ignore','inherit','inherit']});child.unref();fs.writeFileSync('root-exiting','yes');process.exit(0);}
 if(req.headers.authorization!=='Basic '+Buffer.from('opencode:'+process.env.OPENCODE_PASSWORD).toString('base64')){res.writeHead(401);res.end('{}');return;}
 res.setHeader('content-type','application/json');
 if(req.url==='/api/info')res.end(JSON.stringify({version:mode==='info-version'?'9.9.9':mode==='current-version'?'2.0.26':'2.0.22',pid:mode==='info-pid'?process.pid+1:process.pid,urls:[],paths:{tmp:process.cwd()}}));
 else if(req.url.startsWith('/api/location'))res.end(JSON.stringify({directory:process.cwd(),project:{id:'project',directory:process.cwd(),canonical:process.cwd()}}));
 else if(req.url==='/api/session'&&req.method==='POST'){
 let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{const input=JSON.parse(body);fs.writeFileSync('session.json',JSON.stringify({id:'ses_a'+process.pid,projectID:'project',location:input.location,model:input.model,permissions:input.permissions,time:{created:1,updated:2}}));res.end(JSON.stringify({data:JSON.parse(fs.readFileSync('session.json','utf8'))}));});
 }
 else if(req.url==='/api/session/active'||req.url.endsWith('/inbox')||req.url.endsWith('/permission'))res.end(JSON.stringify({data:req.url==='/api/session/active'?{}:[]}));
 else if(req.url.endsWith('/prompt')){fs.writeFileSync('prompt.txt','submitted');res.end('{}');}
 else if(req.url.startsWith('/api/session/'))res.end(JSON.stringify({data:JSON.parse(fs.readFileSync('session.json','utf8'))}));
 else if(req.url==='/api/hang'){fs.writeFileSync('pending.txt','read');return;}
 else res.end(JSON.stringify({ok:true}));
});
server.listen(0,'127.0.0.1',()=>{
 if(mode==='malformed'){console.log(JSON.stringify({url:'http://secret:native-password@127.0.0.1:'+server.address().port}));return;}
 const frame=JSON.stringify({url:'http://127.0.0.1:'+server.address().port})+'\\n';
 if(mode==='oversized'){process.stdout.write('x'.repeat(16385));return;}
 process.stdout.write(frame.slice(0,8));setTimeout(()=>process.stdout.write(frame.slice(8)),10);
});
process.stdin.resume();process.stdin.on('end',()=>{fs.writeFileSync('eof.txt','owned');if(mode!=='resistant')server.close(()=>process.exit(0));});
setTimeout(()=>process.exit(2),30000);
`;
 writeFileSync(file,source);chmodSync(file,0o700);if(mode==="missing")rmSync(file);
 const scope={profileId:"p",runnerId:"local",nativeStoreRef:"store-unqualified",workspacePath:root,scopeFingerprint:"scope",backendId:"opencode-server-v2" as const,executable:file};
 const host=new adapters.OpenCodeV2OwnedServer(scope,beforeSpawn);cleanup.push(async()=>{await host.disconnectLocal();rmSync(root,{recursive:true,force:true});rmSync(root+".old",{recursive:true,force:true});});return {root,file,scope,host};
}
it("starts a version-pinned private loopback host with cwd/PWD and a scoped port",async()=>{
 const f=fixture();const port=await f.host.ready();const started=JSON.parse(readFileSync(join(f.root,"started.json"),"utf8"));
 expect(started).toMatchObject({args:["serve","--stdio","--hostname","127.0.0.1","--port","0"],cwd:f.root,pwd:f.root,passwordPresent:true});
 expect(port.capabilities().releaseControl.support).toBe("unknown");expect(await f.host.request({method:"GET",path:"/api/echo"})).toEqual({ok:true});
 expect(Object.hasOwn(f.host,"password")).toBe(false);
 const receipt=await f.host.disconnectLocal();expect(receipt).toMatchObject({connection:"closed",ownedRoot:"exited",ownedRootPid:started.pid,callbacks:"drained",backgroundTools:"unknown",nativeSessionDeleted:false});expect(existsSync(join(f.root,"eof.txt"))).toBe(true);
 await expect(f.host.request({method:"GET",path:"/api/echo"})).rejects.toMatchObject({code:"OPENCODE_LOCAL_CONNECTION_CLOSED"});
});
it("captures configuration and cleans only its own host while a sibling remains available",async()=>{
 const a=fixture(),b=fixture();a.scope.executable="caller-replacement";a.scope.workspacePath=b.root;await Promise.all([a.host.ready(),b.host.ready()]);
 const [one,two]=await Promise.all([a.host.disconnectLocal(),a.host.disconnectLocal()]);expect(one).toEqual(two);one.connection="unknown";expect((await a.host.disconnectLocal()).connection).toBe("closed");
 expect(await b.host.request({method:"GET",path:"/api/echo"})).toEqual({ok:true});expect(existsSync(join(b.root,"eof.txt"))).toBe(false);
});
it.each(["unsupported","version-drift","missing"])("refuses %s before spawning a server",async mode=>{
 const f=fixture(mode);await expect(f.host.ready()).rejects.toMatchObject({outcome:"not-created"});expect(existsSync(join(f.root,"started.json"))).toBe(false);expect((await f.host.disconnectLocal()).ownedRoot).toBe("not-created");
});
it.each(["info-pid","info-version","malformed","oversized"])("sanitizes %s failure and retains owned cleanup",async mode=>{
 const f=fixture(mode);const error=await f.host.ready().catch(error=>error);expect(error).toBeInstanceOf(adapters.OpenCodeV2Error);expect(error.message).not.toMatch(/native-password|secret:/);expect(await f.host.disconnectLocal()).toMatchObject({connection:"closed",ownedRoot:"exited",callbacks:"drained"});
});
it("cancels an in-flight HTTP read and rejects later requests before cleanup",async()=>{
 const f=fixture();await f.host.ready();const pending=f.host.request({method:"GET",path:"/api/hang"}).catch(error=>error.code);await vi.waitFor(()=>expect(existsSync(join(f.root,"pending.txt"))).toBe(true));
 const disconnect=f.host.disconnectLocal();await expect(f.host.request({method:"GET",path:"/api/echo"})).rejects.toMatchObject({code:"OPENCODE_LOCAL_CONNECTION_CLOSED"});expect(await pending).toBe("OPENCODE_LOCAL_CONNECTION_CLOSED");expect(await disconnect).toMatchObject({callbacks:"drained",ownedRoot:"exited"});
});
it("rejects a replaced physical workspace without redirecting owned cleanup",async()=>{
 const f=fixture();await f.host.ready();renameSync(f.root,f.root+".old");mkdirSync(f.root);await expect(f.host.request({method:"GET",path:"/api/echo"})).rejects.toMatchObject({code:"OPENCODE_SCOPE_CHANGED"});expect(await f.host.disconnectLocal()).toMatchObject({ownedRoot:"exited"});expect(existsSync(join(f.root+".old","eof.txt"))).toBe(true);expect(existsSync(join(f.root,"eof.txt"))).toBe(false);
});
it("closes admission before the asynchronous version probe can create a host",async()=>{
 const f=fixture();const cleanup=f.host.disconnectLocal();await expect(f.host.ready()).rejects.toMatchObject({outcome:"not-created",code:"OPENCODE_LOCAL_CONNECTION_CLOSED"});expect(await cleanup).toMatchObject({ownedRoot:"not-created",callbacks:"drained"});expect(existsSync(join(f.root,"started.json"))).toBe(false);
});
it("escalates only the captured owned group after stdin and TERM are resisted",async()=>{
 const f=fixture("resistant");await f.host.ready();const started=Date.now();expect(await f.host.disconnectLocal()).toMatchObject({ownedRoot:"exited",callbacks:"drained",backgroundTools:"unknown"});expect(Date.now()-started).toBeLessThan(5000);expect(existsSync(join(f.root,"eof.txt"))).toBe(true);expect(existsSync(join(f.root,"term.txt"))).toBe(true);
},8000);
it("captures a request before waiting for readiness",async()=>{
 const f=fixture();const input={method:"GET" as const,path:"/api/echo"};const pending=f.host.request(input);input.path="/api/hang";expect(await pending).toEqual({ok:true});expect(existsSync(join(f.root,"pending.txt"))).toBe(false);
});
it("captures original write admission before waiting for owned readiness",async()=>{
 const f=fixture(),guard=vi.fn(()=>{throw Error('authority revoked');});const input={method:'POST' as const,path:'/api/session',body:{model:{providerID:'p',id:'m'},permissions:[],location:{directory:f.root}},beforeSend:guard};const pending=f.host.request(input);input.beforeSend=()=>{};
 await expect(pending).rejects.toMatchObject({code:'OPENCODE_WRITE_ADMISSION_REJECTED'});expect(guard).toHaveBeenCalledTimes(1);expect(existsSync(join(f.root,'session.json'))).toBe(false);
});
it("rechecks physical scope changed synchronously by final write admission",async()=>{
 const f=fixture();await f.host.ready();await expect(f.host.request({method:'POST',path:'/api/session',body:{model:{providerID:'p',id:'m'},permissions:[],location:{directory:f.root}},beforeSend:()=>{renameSync(f.root,f.root+'.old');mkdirSync(f.root);}})).rejects.toMatchObject({code:'OPENCODE_WRITE_ADMISSION_REJECTED'});
 expect(existsSync(join(f.root+'.old','session.json'))).toBe(false);expect(await f.host.disconnectLocal()).toMatchObject({ownedRoot:'exited'});
});
it("keeps a pending binding callback unknown and prevents a late event or prompt",async()=>{
 const f=fixture(),port=await f.host.ready();let finish!:()=>void;const onBinding=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;})),event=vi.fn();
 const creation=port.create({executionRefId:"exec",commandId:"create",prompt:"owned fixture",model:{providerID:"p",id:"m"},permissions:[],onBinding,onNativeEvent:event}).catch(error=>error.code);
 await vi.waitFor(()=>expect(onBinding).toHaveBeenCalledTimes(1));
 try{expect(await f.host.disconnectLocal()).toMatchObject({connection:"closed",ownedRoot:"exited",callbacks:"unknown"});}
 finally{finish();}
 expect(await creation).toBe("OPENCODE_RECONCILIATION_REQUIRED");expect(event).not.toHaveBeenCalled();expect(existsSync(join(f.root,"prompt.txt"))).toBe(false);expect((await f.host.disconnectLocal()).callbacks).toBe("unknown");
});
it("closes the exact owned version probe even when it ignores TERM",async()=>{
 const f=fixture("version-resistant");await vi.waitFor(()=>expect(existsSync(join(f.root,"version-pid.txt"))).toBe(true));const pid=Number(readFileSync(join(f.root,"version-pid.txt"),"utf8"));const started=Date.now();
 expect(await f.host.disconnectLocal()).toMatchObject({connection:"closed",ownedRoot:"not-created",callbacks:"drained"});expect(Date.now()-started).toBeLessThan(5000);expect(()=>process.kill(pid,0)).toThrow();await expect(f.host.ready()).rejects.toMatchObject({outcome:"not-created"});expect(existsSync(join(f.root,"started.json"))).toBe(false);
},10000);

it('admits the separately audited current version and pins its API identity',async()=>{const f=fixture('current-version'),port=await f.host.ready();expect(port.scope.protocolVersion).toBe('2.0.26');expect(await f.host.request({method:'GET',path:'/api/echo'})).toEqual({ok:true});expect((await f.host.disconnectLocal()).callbacks).toBe('drained');});
it('refuses an API version differing from its accepted CLI version',async()=>{const f=fixture('version-mismatch');await expect(f.host.ready()).rejects.toMatchObject({code:'OPENCODE_SERVER_IDENTITY_CHANGED'});expect((await f.host.disconnectLocal()).ownedRoot).toBe('exited');});

it('captures native child environment once across probe readiness and strips Controller authority',async()=>{
 const names=['DISPATCHER_NATIVE_CANARY','DISPATCHER_OWNER_TOKEN','dispatcher_secret_store_key','OPENCODE_SERVER_PASSWORD','OPENCODE_PTY_HANDOFF'] as const,saved=Object.fromEntries(names.map(name=>[name,process.env[name]]));
 try{process.env.DISPATCHER_NATIVE_CANARY='original-native-context';process.env.DISPATCHER_OWNER_TOKEN='fake-owner-canary';process.env.dispatcher_secret_store_key='fake-key-canary';process.env.OPENCODE_SERVER_PASSWORD='fake-inherited-service';process.env.OPENCODE_PTY_HANDOFF='fake-handoff';const f=fixture('probe-gate');await vi.waitFor(()=>expect(existsSync(join(f.root,'probe-entered'))).toBe(true));process.env.DISPATCHER_NATIVE_CANARY='mutated-context';writeFileSync(join(f.root,'probe-release'),'continue');await f.host.ready();expect(JSON.parse(readFileSync(join(f.root,'probe-environment.json'),'utf8'))).toEqual({context:'original-native-context',authority:false});const started=JSON.parse(readFileSync(join(f.root,'started.json'),'utf8'));expect(started).toMatchObject({context:'original-native-context',authority:false,serverPassword:false,handoff:false,passwordPresent:true});await f.host.disconnectLocal();}
 finally{for(const name of names){if(saved[name]===undefined)delete process.env[name];else process.env[name]=saved[name];}}
});

it('retains exit-unconfirmed probe uncertainty without inventing absent service proof',async()=>{
 const probe=vi.spyOn(versionProbe,'readOwnedNativeVersion').mockImplementation(async input=>{throw input.failure('exit-unconfirmed');});
 try{const f=fixture();await expect(f.host.ready()).rejects.toMatchObject({code:'OPENCODE_PROBE_EXIT_UNCONFIRMED'});expect(existsSync(join(f.root,'started.json'))).toBe(false);const receipt=await f.host.disconnectLocal();expect(receipt).toMatchObject({connection:'unknown',ownedRoot:'unknown',callbacks:'unknown'});expect(await f.host.disconnectLocal()).toEqual(receipt);}finally{probe.mockRestore();}
});
it('closes admission on root exit independently of inherited pipe drain',async()=>{
 const f=fixture();await f.host.ready();const request=f.host.request({method:'GET',path:'/api/root-exit'}).catch(error=>error);await vi.waitFor(()=>expect(existsSync(join(f.root,'root-exiting'))).toBe(true));await expect(f.host.request({method:'GET',path:'/api/echo'})).rejects.toMatchObject({code:'OPENCODE_LOCAL_CONNECTION_CLOSED'});await request;const receipt=await f.host.disconnectLocal();expect(receipt).toMatchObject({connection:'closed',ownedRoot:'exited',callbacks:'unknown',backgroundTools:'unknown'});await new Promise(resolve=>setTimeout(resolve,1800));expect((await f.host.disconnectLocal()).callbacks).toBe('unknown');
});

it('rejects an asynchronous spawn admission before acquiring the owned version probe',async()=>{
 const probe=vi.spyOn(versionProbe,'readOwnedNativeVersion'),guard=vi.fn(async()=>{});
 try{const f=fixture('normal',guard);expect(await f.host.ready().then(()=>({state:'resolved'}),error=>({state:'rejected',code:error.code,outcome:error.outcome,message:error.message}))).toMatchObject({state:'rejected',code:'OPENCODE_SPAWN_ADMISSION_REJECTED',outcome:'not-created',message:'OPENCODE_SPAWN_ADMISSION_REJECTED'});expect(guard).toHaveBeenCalledTimes(1);expect(probe).not.toHaveBeenCalled();expect(existsSync(join(f.root,'probe-environment.json'))).toBe(false);expect(existsSync(join(f.root,'started.json'))).toBe(false);expect(await f.host.disconnectLocal()).toMatchObject({connection:'closed',ownedRoot:'not-created',callbacks:'drained',backgroundTools:'unknown',nativeSessionDeleted:false});}finally{probe.mockRestore();}
});
it('rechecks the original spawn admission after a gated owned version probe before service spawn',async()=>{
 let allowed=true;const guard=vi.fn(()=>{if(!allowed)throw Error('secret://private-path');}),f=fixture('probe-gate',guard);
 await vi.waitFor(()=>expect(existsSync(join(f.root,'probe-entered'))).toBe(true));allowed=false;writeFileSync(join(f.root,'probe-release'),'continue');expect(await f.host.ready().then(()=>({state:'resolved'}),error=>({state:'rejected',code:error.code,outcome:error.outcome,message:error.message}))).toMatchObject({state:'rejected',code:'OPENCODE_SPAWN_ADMISSION_REJECTED',outcome:'not-created',message:'OPENCODE_SPAWN_ADMISSION_REJECTED'});expect(guard).toHaveBeenCalledTimes(2);expect(existsSync(join(f.root,'probe-environment.json'))).toBe(true);expect(existsSync(join(f.root,'started.json'))).toBe(false);expect(existsSync(join(f.root,'session.json'))).toBe(false);expect(existsSync(join(f.root,'prompt.txt'))).toBe(false);const receipt=await f.host.disconnectLocal();expect(receipt).toMatchObject({connection:'closed',ownedRoot:'not-created',callbacks:'drained',backgroundTools:'unknown',nativeSessionDeleted:false});receipt.connection='unknown';expect((await f.host.disconnectLocal()).connection).toBe('closed');
});
