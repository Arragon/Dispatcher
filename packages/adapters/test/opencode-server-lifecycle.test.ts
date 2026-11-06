import { mkdirSync,mkdtempSync,realpathSync,renameSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect,it,vi } from "vitest";
import type { CapabilityEvidence,NativeBinding,AttachRequest,ExecutionContextRef } from "../../domain/src/index.js";
import { OpenCodeV2InteractionPort,type OpenCodeV2Request } from "../src/opencode-server.js";
import { NativeRuntime,NativeRuntimeHosts } from "../../runner/src/native-observation.js";
import { createNativeEventCheckpoint,recoverNativeEvents } from "../../runner/src/native-event-reconcile.js";
import { interruptNativeSession } from "../../runner/src/native-stop.js";

const workspace=realpathSync(process.cwd());const at="2026-10-11T06:10:00.000Z";
const evidence:CapabilityEvidence={version:1,support:"supported",level:"runtime-verified",scopeFingerprint:"scope",verifiedAt:at,evidenceRef:"fixture:opencode-v2-lifecycle"};
const a:NativeBinding={version:1,product:"opencode",region:"global",profileId:"p",backendId:"opencode-server-v2",runnerId:"local",nativeStoreRef:"store",nativeSessionId:"ses_a",executionRefId:"execution-a",identityState:"bound"};
const b={...a,nativeSessionId:"ses_b",executionRefId:"execution-b"};
const fence={runId:"run-a",sessionId:"dispatcher-a",expectedTaskRevision:1,expectedCurrentRunId:"run-a",expectedControlRevision:1,expectedControlEpoch:1,generation:1,leaseId:"lease",commandId:"interrupt-a"};
const model={providerID:"openrouter",id:"openai/gpt-4o-mini"};
const executionRef=(binding:NativeBinding=a):ExecutionContextRef=>({version:1,id:binding.executionRefId,kind:'managed-worktree',runnerId:'local',repositoryId:'repo',workspaceId:'work',pathRef:'workspace:work',branch:'codex/test',baseRevision:'base'});
const attachRequest=(binding:NativeBinding=a):AttachRequest=>({commandId:'attach',fence:{...fence,commandId:'attach'},executionSelection:{version:1,profileId:'p',providerId:'opencode',backendId:a.backendId,runnerId:'local',mode:'manual',selectionType:'explicit-model',source:'explicit',requestedModel:'openrouter/openai/gpt-4o-mini',nativeParameters:{},contextFingerprint:'catalog',configRevision:1,selectedAt:at},executionRef:executionRef(binding)});
function fixture(workspacePath=workspace,tmpDirectory="/tmp"){
 const directory=realpathSync(workspacePath);
 let pid=123;let active:Record<string,unknown>={ses_a:{type:"running"},ses_b:{type:"running"}};let inbox:unknown[]=[];
 const request=vi.fn(async(input:OpenCodeV2Request):Promise<unknown>=>{
  if(input.path==='/api/info')return {version:'2.0.22',pid,urls:[],paths:{tmp:tmpDirectory}};
  if(input.path==='/api/location')return {directory,project:{id:'project',directory,canonical:directory}};
  if(input.path==='/api/session/active')return {data:active};
  if(input.path.endsWith('/permission'))return {data:[]};
  if(input.path.endsWith('/inbox'))return {data:inbox};
  if(input.path.endsWith('/message'))return {data:[{id:'msg_user',type:'user',text:'retained',time:{created:Date.parse(at)}}],cursor:{previous:null,next:null}};
  if(input.path.endsWith('/prompt'))return {data:{id:'msg_receipt',sessionID:input.path.split('/')[3],type:'user',time:{created:Date.parse(at)},payload:{text:(input.body as {text:string}).text},delivery:'queue'}};
  if(input.path.endsWith('/interrupt')){delete active[input.path.split('/')[3]!];return {interrupted:true};}
  const id=input.path==='/api/session'?'ses_a':input.path.split('/')[3];
  if(id==='ses_a'||id==='ses_b')return {data:{id,projectID:'project',location:{directory},model,permissions:[],time:{created:Date.parse(at),updated:Date.parse(at)}}};
  throw new Error('token=private-native-error');
 });
 const scope={profileId:'p',runnerId:'local',nativeStoreRef:'store',workspacePath,scopeFingerprint:'scope',backendId:'opencode-server-v2' as const,server:{pid:123,tmpDirectory,ownership:'external' as const,shared:true},interruptWithoutResume:evidence,evidence:{interruptTurn:evidence,durableIdentity:evidence,historyRead:evidence,sameSessionContinue:evidence,observeExternalChanges:evidence}};
 const port=new OpenCodeV2InteractionPort(scope,{request});port.registerBinding(a,executionRef(a));port.registerBinding(b,executionRef(b));
 return {port,scope,request,setPid:(next:number)=>{pid=next},setInbox:(items:unknown[])=>{inbox=items},setActive:(items:Record<string,unknown>)=>{active=items},active:()=>active};
}
it('interrupts exact A with resume=false while B and the shared host remain active',async()=>{
 const f=fixture();expect(await f.port.interrupt(a,{commandId:fence.commandId,fence})).toMatchObject({state:'accepted'});
 expect(f.request).toHaveBeenCalledWith({method:'POST',path:'/api/session/ses_a/interrupt',query:{resume:'false'},beforeSend:expect.any(Function)});expect(f.active()).toEqual({ses_b:{type:'running'}});
 expect(f.request.mock.calls.filter(([r])=>r.method==='POST')).toHaveLength(1);
});
it('keeps lost interruption acknowledgements unknown and does not resend the same command',async()=>{
 const f=fixture();const read=f.request.getMockImplementation()!;f.request.mockImplementation(async r=>{if(r.path.endsWith('/interrupt'))throw new Error('password=private');return read(r)});
 expect(await f.port.interrupt(a,{commandId:fence.commandId,fence})).toMatchObject({state:'unknown',code:'OPENCODE_INTERRUPT_OUTCOME_UNKNOWN'});
 expect(await f.port.interrupt(a,{commandId:fence.commandId,fence})).toMatchObject({state:'unknown'});expect(f.request.mock.calls.filter(([r])=>r.path.endsWith('/interrupt'))).toHaveLength(1);
});
it('rejects a changed command body and unsupported turn-specific interruption',async()=>{
 const f=fixture();await f.port.interrupt(a,{commandId:fence.commandId,fence});await expect(f.port.interrupt(a,{commandId:fence.commandId,fence:{...fence,expectedControlEpoch:2}})).rejects.toMatchObject({code:'OPENCODE_COMMAND_CONFLICT'});
 await expect(f.port.interrupt(b,{commandId:'interrupt-b',fence:{...fence,commandId:'interrupt-b'},activeTurnId:'turn-specific'})).rejects.toMatchObject({code:'OPENCODE_TURN_INTERRUPT_UNSUPPORTED'});expect(f.request.mock.calls.filter(([r])=>r.method==='POST')).toHaveLength(1);
});
it('refuses another profile before any native I/O',async()=>{
 const f=fixture();await expect(f.port.interrupt({...a,profileId:'foreign'},{commandId:fence.commandId,fence})).rejects.toMatchObject({code:'OPENCODE_BINDING_SCOPE_CHANGED'});expect(f.request).not.toHaveBeenCalled();
});
it('does not interrupt after server ownership PID changes',async()=>{
 const f=fixture();f.setPid(456);await expect(f.port.interrupt(a,{commandId:fence.commandId,fence})).rejects.toMatchObject({code:'OPENCODE_SERVER_IDENTITY_CHANGED'});expect(f.request.mock.calls.filter(([r])=>r.method==='POST')).toHaveLength(0);
});
it('keeps an acknowledgement unknown if its owning server changes before readback',async()=>{
 const f=fixture();const read=f.request.getMockImplementation()!;f.request.mockImplementation(async r=>{const value=await read(r);if(r.path.endsWith('/interrupt'))f.setPid(456);return value});expect(await f.port.interrupt(a,{commandId:fence.commandId,fence})).toMatchObject({state:'unknown',code:'OPENCODE_INTERRUPT_OUTCOME_UNKNOWN'});
});
it('does not claim a pending native queue is empty or resume it during release',async()=>{
 const f=fixture();f.setActive({});f.setInbox([{id:'msg_pending',sessionID:'ses_a',type:'user'}]);
 const proof=await f.port.inspectQuiescence(a,{requestId:'fresh-read',signal:new AbortController().signal});expect(proof.runtime.pendingCommands).toBe('present');expect(proof.runtime.backgroundTools).toBe('unknown');
 expect(await f.port.release(a,{commandId:'release-a',fence:{...fence,commandId:'release-a'},settlePolicy:'wait'})).toMatchObject({quiescent:false,pendingCommands:'present',lockReleased:'unknown',reasonCode:'OPENCODE_PENDING_NATIVE_QUEUE'});expect(f.request.mock.calls.every(([r])=>r.method==='GET')).toBe(true);
});
it('fails release closed when process-local idle cannot prove native background tools absent',async()=>{
 const f=fixture();f.setActive({});expect(await f.port.release(a,{commandId:'release-a',fence:{...fence,commandId:'release-a'},settlePolicy:'wait'})).toMatchObject({quiescent:false,pendingCommands:'none',lockReleased:'unknown',reasonCode:'OPENCODE_BACKGROUND_TOOLS_UNQUALIFIED'});expect(f.port.capabilities().releaseControl.support).toBe('unknown');
});
it('normalizes a fresh quiescence read without inventing stop proof',async()=>{
 const f=fixture();const proof=await f.port.inspectQuiescence(a,{requestId:'fresh',signal:new AbortController().signal});expect(proof).toMatchObject({observation:{id:'fresh',state:'running',pendingTools:'unknown',read:{requestId:'fresh',readability:'readable'}},runtime:{binding:a,readProof:{requestId:'fresh',kind:'live-native-read'},host:{ownership:'external',shared:true,releaseBoundary:'session'}}});
});
it.each(['activity','approval','model','permissions','queue'] as const)('rejects %s changes in the outer quiescence read window',async drift=>{
 const f=fixture();f.setActive({});const read=f.request.getMockImplementation()!;let changed=false;
 f.request.mockImplementation(async input=>{
  if(changed&&drift==='approval'&&input.path.endsWith('/permission'))return {data:[{id:'permission-current'}]};
  const result=await read(input);
  if(changed&&input.path==='/api/session/ses_a'){
   const data=(result as {data:{model:typeof model;permissions:unknown[]}}).data;
   if(drift==='model')data.model={...model,id:'changed'};
   if(drift==='permissions')data.permissions=[{action:'bash',resource:'*',effect:'deny'}];
  }
  if(!changed&&input.path.endsWith('/inbox')){changed=true;if(drift==='activity')f.setActive({ses_a:{type:'running'}});if(drift==='queue')f.setInbox([{id:'msg_late',sessionID:'ses_a',type:'user'}]);}
  return result;
 });
 await expect(f.port.inspectQuiescence(a,{requestId:'outer-window',signal:new AbortController().signal})).rejects.toMatchObject({code:'OPENCODE_OBSERVATION_CHANGED'});
 expect(f.request.mock.calls.every(([input])=>input.method==='GET')).toBe(true);expect(f.port.capabilities().releaseControl.support).toBe('unknown');
 // A later stable read remains available, without granting stop/release authority.
 const stable=await f.port.inspectQuiescence(a,{requestId:'stable-window',signal:new AbortController().signal});expect(stable).toMatchObject({observation:{id:'stable-window'},runtime:{backgroundTools:'unknown',processScope:{state:drift==='activity'?'active':'unknown'}}});
});
it('captures the inbox before a later transport read mutates its returned array in place',async()=>{
 const f=fixture();f.setActive({});const inbox=[{id:'msg_original',sessionID:'ses_a',type:'user'}];f.setInbox(inbox);const read=f.request.getMockImplementation()!;let sampled=false;
 f.request.mockImplementation(async input=>{const result=await read(input);if(sampled&&input.path==='/api/session/active')inbox[0]!.id='msg_replaced';if(input.path.endsWith('/inbox'))sampled=true;return result;});
 await expect(f.port.inspectQuiescence(a,{requestId:'inbox-snapshot',signal:new AbortController().signal})).rejects.toMatchObject({code:'OPENCODE_OBSERVATION_CHANGED'});expect(f.request.mock.calls.every(([input])=>input.method==='GET')).toBe(true);
});
it('keeps sibling activity out of the exact-session quiescence window and propagates the original signal',async()=>{
 const f=fixture();f.setActive({});const read=f.request.getMockImplementation()!,signal=new AbortController().signal;
 f.request.mockImplementation(async input=>{const result=await read(input);if(input.path.endsWith('/inbox'))f.setActive({ses_b:{type:'running'}});return result;});
 expect(await f.port.inspectQuiescence(a,{requestId:'only-a',signal})).toMatchObject({observation:{id:'only-a',state:'idle'},runtime:{binding:a,pendingCommands:'none',backgroundTools:'unknown',processScope:{state:'unknown'},host:{shared:true}}});
 expect(f.request.mock.calls.filter(([input])=>input.path.endsWith('/inbox'))).toHaveLength(2);expect(f.request.mock.calls.every(([input])=>input.signal===signal&&input.method==='GET')).toBe(true);expect(f.port.capabilities().releaseControl.support).toBe('unknown');
});
it.each(['model','permissions','policy-removed'] as const)('rejects %s drift observed by the final metadata guard',async drift=>{
 const f=fixture();f.setActive({});const read=f.request.getMockImplementation()!;let inboxReads=0,changed=false;
 f.request.mockImplementation(async input=>{
  const result=await read(input);
  if(changed&&input.path==='/api/session/ses_a'){
   const data=(result as {data:{model?:typeof model;permissions?:unknown[]}}).data;
   if(drift==='model')data.model={...model,id:'late-model'};
   if(drift==='permissions')data.permissions=[{action:'bash',resource:'*',effect:'deny'}];
   if(drift==='policy-removed'){delete data.model;delete data.permissions;}
  }
  if(input.path.endsWith('/inbox')&&++inboxReads===2)changed=true;
  return result;
 });
 await expect(f.port.inspectQuiescence(a,{requestId:'tail-read',signal:new AbortController().signal})).rejects.toMatchObject({code:'OPENCODE_OBSERVATION_CHANGED'});expect(f.request.mock.calls.every(([input])=>input.method==='GET')).toBe(true);
});
it('distinguishes Runner interrupt acceptance from unverified tool cleanup',async()=>{
 const f=fixture();const result=await interruptNativeSession({binding:a,scopeFingerprint:'scope',port:f.port},{commandId:fence.commandId,fence},()=>{});expect(result.receipt.state).toBe('accepted');expect(result.nativeStopProof.state).toBe('unknown');expect(f.active()).toEqual({ses_b:{type:'running'}});
});
it('recovers a volatile gap through Runner read-only snapshot and exact session history',async()=>{
 const f=fixture();f.setActive({});f.port.markDisconnected();const runtime=new NativeRuntime();const connection=runtime.connect(f.port.readHandle(a));
 const result=await recoverNativeEvents(createNativeEventCheckpoint({binding:a,scopeFingerprint:'scope',stream:{kind:'volatile'}}),{inspect:()=>runtime.inspect(connection),history:(ref,input)=>f.port.history(ref,input)});expect(result.accepted).toBe(true);expect(result.checkpoint.history?.entries).toMatchObject([{id:'msg_user'}]);expect(f.request.mock.calls.every(([r])=>r.method==='GET')).toBe(true);
 await expect(f.port.create({commandId:'new',executionRefId:'new',prompt:'do not blindly resume',model,permissions:[],onBinding:()=>{}})).rejects.toMatchObject({code:'OPENCODE_RECONCILIATION_REQUIRED',outcome:'not-created'});expect(f.request.mock.calls.every(([r])=>r.method==='GET')).toBe(true);
});
it('keeps partial history gaps visible instead of granting write permission',async()=>{
 const f=fixture();f.setActive({});const read=f.request.getMockImplementation()!;f.request.mockImplementation(async r=>r.path.endsWith('/message')?{data:[{id:'msg_rich',type:'assistant',time:{created:Date.parse(at)},content:[{type:'tool',state:{type:'running'}}]}],cursor:{next:null,previous:null}}:read(r));
 expect((await f.port.history(a,{limit:50})).gaps).toContain('OPENCODE_HISTORY_CONTENT_UNSUPPORTED');
 const runtime=new NativeRuntime();const token=runtime.connect(f.port.readHandle(a));const result=await recoverNativeEvents(createNativeEventCheckpoint({binding:a,scopeFingerprint:'scope',stream:{kind:'volatile'}}),{inspect:()=>runtime.inspect(token),history:(ref,q)=>f.port.history(ref,q)});expect(result.needsHistory).toBe(true);expect(result.gaps).toEqual(['HISTORY_PROVIDER_PARTIAL','PROVIDER_REPORTED_GAP']);
});
it('releases only the local external host claim through existing Runner ownership management',async()=>{
 const f=fixture();const stop=vi.fn(async()=>{});const detach=vi.fn(async()=>{});const hosts=new NativeRuntimeHosts();
 const backend={id:a.backendId,runnerId:a.runnerId,nativeStoreRef:a.nativeStoreRef,product:a.product,region:a.region,ownership:'external' as const,acquire:async()=>({id:'external-server',profileId:'p',backendId:a.backendId,runnerId:a.runnerId,nativeStoreRef:a.nativeStoreRef,product:a.product,region:a.region,ownership:'external' as const,interrupt:f.port.interrupt.bind(f.port),quiescent:async()=>false,stop,detach})};
 const h=await hosts.acquireRuntime({id:'p'},backend);await hosts.cancelSession(h,a,{commandId:fence.commandId,fence});expect(await hosts.releaseRuntime(h,'stop-owned')).toMatchObject({state:'detached',nativeSessionDeleted:false});expect(stop).not.toHaveBeenCalled();expect(detach).toHaveBeenCalledTimes(1);expect(f.active()).toEqual({ses_b:{type:'running'}});
});
it('does not equate read-only reattachment to reacquired writer control',async()=>{
 const f=fixture();f.setActive({});const request=attachRequest();
 expect(await f.port.attach(a,request)).toMatchObject({nativeSessionId:a.nativeSessionId,attached:false,method:'unknown',reasonCode:'OPENCODE_RECLAIM_UNQUALIFIED'});expect(f.request.mock.calls.every(([r])=>r.method==='GET')).toBe(true);
});
it('blocks a creation disconnected during preflight before the create POST',async()=>{
 const f=fixture();const read=f.request.getMockImplementation()!;f.request.mockImplementation(async r=>{const value=await read(r);if(r.path==='/api/location')f.port.markDisconnected();return value});
 await expect(f.port.create({commandId:'new',executionRefId:'new',prompt:'literal',model,permissions:[],onBinding:()=>{}})).rejects.toMatchObject({code:'OPENCODE_RECONCILIATION_REQUIRED',outcome:'not-created'});expect(f.request.mock.calls.filter(([r])=>r.method==='POST')).toHaveLength(0);
});
it('blocks a prompt disconnected during its awaited inbox preflight',async()=>{
 const f=fixture();f.setActive({});const read=f.request.getMockImplementation()!;f.request.mockImplementation(async r=>{const value=await read(r);if(r.path.endsWith('/inbox'))f.port.markDisconnected();return value});
 await expect(f.port.create({commandId:'new',executionRefId:a.executionRefId,prompt:'literal',model,permissions:[],onBinding:()=>{}})).rejects.toMatchObject({code:'OPENCODE_RECONCILIATION_REQUIRED'});expect(f.request.mock.calls.filter(([r])=>r.path.endsWith('/prompt'))).toHaveLength(0);
});
it('rechecks the server after an awaited preflight session read before interrupt',async()=>{
 const f=fixture();const read=f.request.getMockImplementation()!;f.request.mockImplementation(async r=>{const value=await read(r);if(r.path==='/api/session/ses_a')f.setPid(456);return value});
 await expect(f.port.interrupt(a,{commandId:fence.commandId,fence})).rejects.toMatchObject({code:'OPENCODE_SERVER_IDENTITY_CHANGED'});expect(f.request.mock.calls.filter(([r])=>r.method==='POST')).toHaveLength(0);
});
it('assigns each concurrent quiescence read its own allocated sequence',async()=>{
 const f=fixture();const results=await Promise.all([f.port.inspectQuiescence(a,{requestId:'one',signal:new AbortController().signal}),f.port.inspectQuiescence(a,{requestId:'two',signal:new AbortController().signal})]);expect(results.map(r=>r.observation.read?.sequence)).toEqual([1,2]);
});
it('freezes the effective native variant when the requested model uses native default',async()=>{
 const f=fixture();f.setActive({});const read=f.request.getMockImplementation()!;f.request.mockImplementation(async r=>{const value=await read(r);if(r.path==='/api/session'||r.path==='/api/session/ses_a')(value as {data:{model:typeof model&{variant?:string}}}).data.model={...model,variant:'default'};return value});
 const result=await f.port.create({commandId:'new',executionRefId:a.executionRefId,prompt:'literal',model,permissions:[],onBinding:()=>{}});expect(result.receipt.state).toBe('accepted');
 const nativeRead=f.request.getMockImplementation()!;f.request.mockImplementation(async r=>{const value=await nativeRead(r);if(r.path==='/api/session/ses_a')(value as {data:{model:typeof model&{variant?:string}}}).data.model.variant='high';return value});
 await expect(f.port.continueTurn(a,{commandId:'next',fence:{...fence,commandId:'next'},message:'literal'})).rejects.toMatchObject({code:'OPENCODE_NATIVE_POLICY_DRIFT'});expect(f.request.mock.calls.filter(([r])=>r.path.endsWith('/prompt'))).toHaveLength(1);
});
it('does not replace an explicit requested variant with the native default',async()=>{
 const f=fixture();const read=f.request.getMockImplementation()!;f.request.mockImplementation(async r=>{const value=await read(r);if(r.path==='/api/session')(value as {data:{model:typeof model&{variant?:string}}}).data.model={...model,variant:'default'};return value});
 await expect(f.port.create({commandId:'new',executionRefId:a.executionRefId,prompt:'literal',model:{...model,variant:'high'},permissions:[],onBinding:()=>{}})).rejects.toMatchObject({code:'OPENCODE_NATIVE_POLICY_DRIFT'});expect(f.request.mock.calls.filter(([r])=>r.path.endsWith('/prompt'))).toHaveLength(0);
});

function physicalFixture(){
 const parent=realpathSync(mkdtempSync(join(tmpdir(),'dispatcher-opencode-directory-'))),directory=join(parent,'workspace'),serverTmp=join(parent,'native-tmp');mkdirSync(directory);mkdirSync(serverTmp);
 const f=fixture(directory,serverTmp);const replace=(kind:'workspace'|'serverTmp')=>{const path=kind==='workspace'?directory:serverTmp;renameSync(path,path+'-retained');mkdirSync(path);};
 return {...f,parent,replace};
}
const directoryError=(kind:'workspace'|'serverTmp')=>kind==='workspace'?'OPENCODE_LOCATION_MISMATCH':'OPENCODE_SERVER_IDENTITY_CHANGED';
it.each(['workspace','serverTmp'] as const)('blocks interruption after same-path %s replacement before I/O',async kind=>{
 const f=physicalFixture();try{f.replace(kind);await expect(f.port.interrupt(a,{commandId:fence.commandId,fence})).rejects.toMatchObject({code:directoryError(kind)});expect(f.request).not.toHaveBeenCalled();expect(f.active()).toEqual({ses_a:{type:'running'},ses_b:{type:'running'}});}finally{rmSync(f.parent,{recursive:true,force:true});}
});
it.each(['workspace','serverTmp'] as const)('does not project metadata after awaited %s replacement',async kind=>{
 const f=physicalFixture();try{const read=f.request.getMockImplementation()!;f.request.mockImplementation(async r=>{const result=await read(r);if(r.path==='/api/session/ses_a')f.replace(kind);return result;});await expect(f.port.inspect(a)).rejects.toMatchObject({code:directoryError(kind)});expect(f.request.mock.calls.every(([r])=>r.method==='GET')).toBe(true);}finally{rmSync(f.parent,{recursive:true,force:true});}
});
it.each(['workspace','serverTmp'] as const)('keeps interruption outcome unknown after %s replacement during submission',async kind=>{
 const f=physicalFixture();try{const read=f.request.getMockImplementation()!;f.request.mockImplementation(async r=>{const result=await read(r);if(r.path.endsWith('/interrupt'))f.replace(kind);return result;});expect(await f.port.interrupt(a,{commandId:fence.commandId,fence})).toMatchObject({state:'unknown',code:'OPENCODE_INTERRUPT_OUTCOME_UNKNOWN'});expect(f.active()).toEqual({ses_b:{type:'running'}});expect(f.request.mock.calls.filter(([r])=>r.method==='POST')).toHaveLength(1);}finally{rmSync(f.parent,{recursive:true,force:true});}
});
it.each(['workspace','serverTmp'] as const)('withdraws capability evidence after %s replacement without I/O',kind=>{
 const f=physicalFixture();try{expect(f.port.capabilities().historyRead.support).toBe('supported');f.replace(kind);expect(f.port.capabilities().historyRead).toMatchObject({support:'unknown',reasonCode:directoryError(kind)});expect(f.port.interruptWithoutResume.support).toBe('unknown');expect(f.request).not.toHaveBeenCalled();}finally{rmSync(f.parent,{recursive:true,force:true});}
});
it.each(['workspace','serverTmp'] as const)('blocks prompt and received projection when binding callback replaces %s',async kind=>{
 const f=physicalFixture();try{f.setActive({});const facts=vi.fn();await expect(f.port.create({commandId:'new',executionRefId:a.executionRefId,prompt:'literal',model,permissions:[],onBinding:()=>f.replace(kind),onNativeEvent:facts})).rejects.toMatchObject({code:directoryError(kind)});expect(facts).not.toHaveBeenCalled();expect(f.request.mock.calls.some(([r])=>r.path.endsWith('/prompt'))).toBe(false);}finally{rmSync(f.parent,{recursive:true,force:true});}
});
it.each([
 ['physical path',{pathRef:workspace}],['foreign logical path',{pathRef:'workspace:foreign'}],['repository',{repositoryId:'foreign'}],['base',{baseRevision:'foreign'}],['version',{version:2}],['extra field',{physicalPath:workspace}],
] as const)('rejects canonical attach %s before native I/O',async(_,drift)=>{
 const f=fixture(),request=attachRequest();await expect(f.port.attach(a,{...request,executionRef:{...request.executionRef,...drift}} as AttachRequest)).rejects.toMatchObject({code:'OPENCODE_BINDING_SCOPE_CHANGED'});expect(f.request).not.toHaveBeenCalled();
});
it.each(['release','attach'] as const)('captures %s identity and request before an awaited native read',async operation=>{
 const f=fixture();f.setActive({});let resume!:()=>void,entered!:()=>void;const waiting=new Promise<void>(resolve=>{entered=resolve;});const gate=new Promise<void>(resolve=>{resume=resolve;});const read=f.request.getMockImplementation()!;
 let first=true;f.request.mockImplementation(async r=>{if(first){first=false;entered();await gate;}return read(r);});
 const ref={...a},request=attachRequest();const pending=operation==='attach'?f.port.attach(ref,request):f.port.release(ref,{commandId:'release',fence:{...fence,commandId:'release'},settlePolicy:'wait'});
 await waiting;ref.nativeSessionId=b.nativeSessionId;ref.executionRefId=b.executionRefId;request.executionSelection.requestedModel='caller-change';resume();
 expect(await pending).toMatchObject({nativeSessionId:a.nativeSessionId,reasonCode:operation==='attach'?'OPENCODE_RECLAIM_UNQUALIFIED':'OPENCODE_BACKGROUND_TOOLS_UNQUALIFIED'});expect(f.request.mock.calls.every(([r])=>r.method==='GET')).toBe(true);
});
it('captures the original quiescence challenge and signal before native I/O',async()=>{
 const f=fixture(),signal=new AbortController().signal,request={requestId:'original',signal};let resume!:()=>void,entered!:()=>void;const waiting=new Promise<void>(resolve=>{entered=resolve;});const gate=new Promise<void>(resolve=>{resume=resolve;});const read=f.request.getMockImplementation()!;
 let first=true;f.request.mockImplementation(async r=>{if(first){first=false;entered();await gate;}return read(r);});const pending=f.port.inspectQuiescence(a,request);
 await waiting;request.requestId='caller-change';request.signal=new AbortController().signal;resume();const result=await pending;
 expect(result.observation.id).toBe('original');expect(result.observation.read?.requestId).toBe('original');expect(result.runtime.readProof.requestId).toBe('original');expect(f.request.mock.calls.every(([r])=>r.signal===signal)).toBe(true);
});

it('rejects attachment without separately registered authoritative context but preserves reads',async()=>{
 const f=fixture(),port=new OpenCodeV2InteractionPort(f.scope,{request:f.request});port.registerBinding(a);
 await expect(port.attach(a,attachRequest())).rejects.toMatchObject({code:'OPENCODE_BINDING_SCOPE_CHANGED'});expect(f.request).not.toHaveBeenCalled();
 expect(await port.inspect(a)).toMatchObject({nativeSessionId:a.nativeSessionId});
 expect(()=>port.registerBinding(a,executionRef())).toThrow('OPENCODE_BINDING_SCOPE_CHANGED');
});
it('keeps independently captured contexts for shared A and B',async()=>{
 const f=fixture();f.setActive({});expect(await f.port.attach(b,attachRequest(b))).toMatchObject({attached:false,reasonCode:'OPENCODE_RECLAIM_UNQUALIFIED'});
 f.request.mockClear();await expect(f.port.attach(a,{...attachRequest(),executionRef:executionRef(b)})).rejects.toMatchObject({code:'OPENCODE_BINDING_SCOPE_CHANGED'});expect(f.request).not.toHaveBeenCalled();
});
it.each(['repositoryId','baseRevision','workspaceId','branch','id','runnerId'] as const)('rejects registered context %s replacement',key=>{
 const f=fixture(),ref=executionRef();expect(()=>f.port.registerBinding(a,{...ref,[key]:'changed'} as ExecutionContextRef)).toThrow('OPENCODE_BINDING_SCOPE_CHANGED');expect(f.request).not.toHaveBeenCalled();
});
it('captures registered context before caller mutation',async()=>{
 const f=fixture(),port=new OpenCodeV2InteractionPort(f.scope,{request:f.request}),ref=executionRef();port.registerBinding(a,ref);
 if(ref.kind==='managed-worktree')ref.baseRevision='caller-change';
 expect(await port.attach(a,attachRequest())).toMatchObject({attached:false,reasonCode:'OPENCODE_RECLAIM_UNQUALIFIED'});
});
it.each([{version:2},{physicalPath:workspace},{pathRef:workspace},{workspaceId:'foreign'},{runnerId:'foreign'},{id:'foreign'}])('rejects malformed authoritative context %j',drift=>{
 const f=fixture(),port=new OpenCodeV2InteractionPort(f.scope,{request:f.request});expect(()=>port.registerBinding(a,{...executionRef(),...drift} as ExecutionContextRef)).toThrow('OPENCODE_BINDING_SCOPE_CHANGED');expect(f.request).not.toHaveBeenCalled();
});
it('captures creation context across waits and includes it in command deduplication',async()=>{
 const f=fixture();f.setActive({});const ref=executionRef(),original=structuredClone(ref),read=f.request.getMockImplementation()!;
 f.request.mockImplementation(async r=>{if(ref.kind==='managed-worktree')ref.baseRevision='caller-change';return read(r);});
 const input={commandId:'context-start',executionRefId:a.executionRefId,executionRef:ref,prompt:'literal',model,permissions:[],onBinding:()=>{}};
 expect((await f.port.create(input)).receipt.state).toBe('accepted');expect(await f.port.attach(a,attachRequest())).toMatchObject({attached:false,reasonCode:'OPENCODE_RECLAIM_UNQUALIFIED'});
 await expect(f.port.create(input)).rejects.toMatchObject({code:'OPENCODE_COMMAND_CONFLICT'});
 expect((await f.port.create({...input,executionRef:original})).receipt.state).toBe('accepted');expect(f.request.mock.calls.filter(([r])=>r.path.endsWith('/prompt'))).toHaveLength(1);
});
it('validates creation context before any awaited preparation',async()=>{
 const f=fixture();await expect(f.port.create({commandId:'context-start',executionRefId:a.executionRefId,executionRef:executionRef(b),prompt:'literal',model,permissions:[],onBinding:()=>{}})).rejects.toMatchObject({code:'OPENCODE_BINDING_SCOPE_CHANGED',outcome:'not-created'});expect(f.request).not.toHaveBeenCalled();
});
it('native-default attachment preserves absent concrete model semantics',async()=>{
 const f=fixture(),request=attachRequest();request.executionSelection={...request.executionSelection,selectionType:'native-default',source:'native-default'};delete request.executionSelection.requestedModel;
 expect(await f.port.attach(a,request)).toMatchObject({attached:false,reasonCode:'OPENCODE_RECLAIM_UNQUALIFIED'});expect(request.executionSelection.requestedModel).toBeUndefined();expect(f.request.mock.calls.every(([r])=>r.method==='GET')).toBe(true);
});
it.each(['model','reasoning'] as const)('reports explicit selection %s drift without reclaiming control',async key=>{
 const f=fixture(),request=attachRequest();if(key==='model')request.executionSelection.requestedModel='foreign/model';else request.executionSelection.nativeParameters={reasoningEffort:'high'};
 expect(await f.port.attach(a,request)).toMatchObject({attached:false,reasonCode:'OPENCODE_NATIVE_POLICY_DRIFT'});expect(f.request.mock.calls.every(([r])=>r.method==='GET')).toBe(true);
});
