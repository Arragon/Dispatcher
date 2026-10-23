import { expect,it,vi } from "vitest";
import type { CapabilityEvidence,NativeBinding } from "../../domain/src/index.js";
import { createServer } from "node:http";
import { mkdtempSync,mkdirSync,realpathSync,rmSync,symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OpenCodeV2InteractionPort,OpenCodeV2HttpTransport,type OpenCodeV2Request,type OpenCodeV2Start,type OpenCodeV2Model,type OpenCodeV2Permission } from "../src/opencode-server.js";
import { OpenCodeAdapter } from "../src/native-cli.js";
import { getInteractionPort } from "../src/interaction-contracts.js";
import type { NativeReadRequest } from "../src/interaction-contracts.js";

const at="2026-10-11T05:00:00.000Z";
const workspace=realpathSync(process.cwd());
const evidence:CapabilityEvidence={version:1,support:"supported",level:"runtime-verified",scopeFingerprint:"scope",verifiedAt:at,evidenceRef:"fixture:opencode-v2"};
const model:OpenCodeV2Model={providerID:"openrouter",id:"openai/gpt-4o-mini"};
const binding:NativeBinding={version:1,product:"opencode",region:"global",profileId:"profile",backendId:"opencode-server-v2",runnerId:"runner",nativeStoreRef:"store",nativeSessionId:"ses_exact",identityState:"bound",executionRefId:"execution"};
const info=(directory=workspace)=>({id:"ses_exact",projectID:"project",model,permissions:[] as OpenCodeV2Permission[],location:{directory},time:{created:Date.parse(at),updated:Date.parse(at)},cost:0,tokens:{}});
function fixture(workspacePath=workspace){
  const canonical=realpathSync(workspacePath);let session=info(canonical);let active:Record<string,unknown>={};let messages:unknown[]=[{id:"msg_user",type:"user",text:"hello",time:{created:Date.parse(at)}}];
  let next:string|null=null;
  const request=vi.fn(async(input:OpenCodeV2Request):Promise<unknown>=>{
    if(input.path==="/api/info")return {version:"2.0.22",pid:123,urls:[],paths:{tmp:"/tmp"}};
    if(input.path==="/api/location")return {directory:canonical,project:{id:"project",directory:canonical,canonical}};
    if(input.path==="/api/session"&&input.method==="POST")return {data:session};
    if(input.path==="/api/session/ses_exact")return {data:session};
    if(input.path==="/api/session/active")return {data:active};
    if(input.path.endsWith("/permission")||input.path.endsWith("/inbox"))return {data:[]};
    if(input.path.endsWith("/message"))return {data:messages,cursor:{previous:null,next}};
    if(input.path.endsWith("/prompt"))return {data:{id:"msg_receipt",sessionID:"ses_exact",type:"user",time:{created:Date.parse(at)},payload:{text:(input.body as {text:string}).text},delivery:"queue"}};
    throw new Error('token=never-print-provider-diagnostic');
  });
  const scope={profileId:"profile",runnerId:"runner",nativeStoreRef:"store",workspacePath,scopeFingerprint:"scope",backendId:"opencode-server-v2" as const,evidence:{durableIdentity:evidence,historyRead:evidence,sameSessionContinue:evidence,observeExternalChanges:evidence}};
  const port=new OpenCodeV2InteractionPort(scope,{request});port.registerBinding(binding);
  const start:OpenCodeV2Start={executionRefId:"execution",commandId:"start-command",prompt:"-literal; $(never-run)",model,permissions:[],onBinding:vi.fn(),onNativeEvent:vi.fn()};
  return {port,scope,request,start,setSession:(s:typeof session)=>{session=s},setActive:(a:typeof active)=>{active=a},setMessages:(m:unknown[],n:string|null=null)=>{messages=m;next=n}};
}
it("does not query OpenCode history for an already cancelled read",async()=>{
 const f=fixture(),controller=new AbortController();controller.abort();const read:NativeReadRequest={requestId:"cancelled",observerEpoch:"reader",sequence:1,signal:controller.signal};await expect(f.port.history(binding,{limit:10},read)).rejects.toMatchObject({code:"OPENCODE_NATIVE_UNREACHABLE"});expect(f.request).not.toHaveBeenCalled();
});
it("does not admit more OpenCode queries after cancellation during handshake",async()=>{
 const f=fixture(),controller=new AbortController(),read:NativeReadRequest={requestId:"history",observerEpoch:"reader",sequence:1,signal:controller.signal},request=f.request.getMockImplementation()!;f.request.mockImplementation(async input=>{const result=await request(input);controller.abort();return result;});await expect(f.port.history(binding,{limit:10},read)).rejects.toMatchObject({code:"OPENCODE_NATIVE_UNREACHABLE"});expect(f.request).toHaveBeenCalledOnce();expect(f.request.mock.calls[0]![0]).toMatchObject({method:"GET",signal:controller.signal});
});
it("keeps the original cancellation signal even if the transport replaces its request field",async()=>{
 const f=fixture(),controller=new AbortController(),read:NativeReadRequest={requestId:"history",observerEpoch:"reader",sequence:1,signal:controller.signal},request=f.request.getMockImplementation()!;f.request.mockImplementation(async input=>{const result=await request(input);if(input.path.endsWith("/message")){controller.abort();input.signal=new AbortController().signal;}return result;});await expect(f.port.history(binding,{limit:10},read)).rejects.toMatchObject({code:"OPENCODE_NATIVE_UNREACHABLE"});expect(f.request.mock.calls.at(-1)![0].path).toBe("/api/session/ses_exact/message");expect(f.request.mock.calls.every(([input])=>input.method==="GET")).toBe(true);
});
it("captures OpenCode history bounds and cursor before awaiting handshake",async()=>{
 const f=fixture(),input={limit:10,cursor:"original"},request=f.request.getMockImplementation()!;f.request.mockImplementation(async query=>{input.limit=1;input.cursor="changed";return request(query);});expect(await f.port.history(binding,input)).toMatchObject({nativeSessionId:"ses_exact",state:"available"});expect(f.request.mock.calls.find(([query])=>query.path.endsWith("/message"))![0].query).toEqual({limit:"10",cursor:"original"});
});
it("uses v2 create location/model/permissions and persists native identity before prompt",async()=>{
  const f=fixture();const order:string[]=[];f.start.onBinding=async b=>{expect(b).toEqual(binding);order.push("bound")};f.start.onNativeEvent=fact=>{expect(fact.nativeSessionId).toBe("ses_exact");order.push(fact.state)};
  const original=f.request.getMockImplementation()!;f.request.mockImplementation(async input=>{if(input.path.endsWith('/prompt'))order.push('prompt');return original(input)});
  const result=await f.port.create(f.start);
  expect(result.receipt).toMatchObject({state:"accepted",nativeMessageId:"msg_receipt"});expect(order.indexOf("bound")).toBeLessThan(order.indexOf("prompt"));expect(order).not.toContain("completed");
  expect(f.request).toHaveBeenCalledWith(expect.objectContaining({method:"POST",path:"/api/session",body:{location:{directory:workspace},model,permissions:[]}}));
  expect(f.request).toHaveBeenCalledWith(expect.objectContaining({path:"/api/location",query:{"location[directory]":workspace}}));
  expect(f.request.mock.calls.every(([r])=>r.path.startsWith('/api/'))).toBe(true);
});
it("rejects installed v1 and does not send create or use legacy endpoints",async()=>{
 const f=fixture();f.request.mockResolvedValueOnce({version:"1.18.34"});await expect(f.port.create(f.start)).rejects.toMatchObject({code:"OPENCODE_VERSION_UNSUPPORTED",outcome:"not-created"});expect(f.request.mock.calls.filter(([r])=>r.method==="POST")).toHaveLength(0);
});
it("rejects a location different from cwd before creation",async()=>{
 const f=fixture();const original=f.request.getMockImplementation()!;f.request.mockImplementation(async r=>r.path==="/api/location"?{directory:"/other",project:{id:"project",directory:"/other",canonical:"/other"}}:original(r));await expect(f.port.create(f.start)).rejects.toMatchObject({code:"OPENCODE_LOCATION_MISMATCH",outcome:"not-created"});expect(f.request.mock.calls.filter(([r])=>r.method==="POST")).toHaveLength(0);
});
it("leaves a lost creation acknowledgement unknown without retry",async()=>{
 const f=fixture();const original=f.request.getMockImplementation()!;f.request.mockImplementation(async r=>{if(r.path==='/api/session'&&r.method==='POST')throw new Error('apiKey=private');return original(r)});await expect(f.port.create(f.start)).rejects.toMatchObject({code:"OPENCODE_CREATE_OUTCOME_UNKNOWN",outcome:"unknown"});expect(f.request.mock.calls.filter(([r])=>r.path==='/api/session'&&r.method==='POST')).toHaveLength(1);expect(f.start.onBinding).not.toHaveBeenCalled();
});
it("does not send prompt after binding persistence fails",async()=>{
 const f=fixture();f.start.onBinding=()=>{throw new Error('storage unavailable')};await expect(f.port.create(f.start)).rejects.toMatchObject({code:"OPENCODE_BINDING_PERSISTENCE_UNKNOWN",outcome:"unknown"});expect(f.request.mock.calls.filter(([r])=>r.path.endsWith('/prompt'))).toHaveLength(0);
});
it("reads exact native history without creating or prompting a turn",async()=>{
 const f=fixture();f.setMessages([{id:'msg_user',type:'user',text:'<script>literal</script>',time:{created:Date.parse(at)}},{id:'msg_assistant',type:'assistant',agent:'build',model,content:[{type:'text',text:'answer'}],time:{created:Date.parse(at)}}],"cursor-exact");const page=await f.port.history(binding,{limit:50});expect(page).toMatchObject({nativeSessionId:'ses_exact',state:'available',source:'opencode',completeness:'partial',nextCursor:'cursor-exact',entries:[{id:'msg_user',kind:'user',text:'<script>literal</script>'},{id:'msg_assistant',kind:'assistant',text:'answer'}]});expect(f.request.mock.calls.every(([r])=>r.method==='GET')).toBe(true);expect(f.request).toHaveBeenCalledWith(expect.objectContaining({path:'/api/session/ses_exact/message',query:{limit:'50',order:'asc'}}));
});
it("uses opaque next cursor without combining it with order",async()=>{
 const f=fixture();await f.port.history(binding,{limit:2,cursor:'opaque/+='});expect(f.request).toHaveBeenCalledWith(expect.objectContaining({query:{limit:'2',cursor:'opaque/+='}}));
});
it("fails closed for another profile or execution reference before native reads",async()=>{
 const f=fixture();await expect(f.port.history({...binding,profileId:'other'},{limit:50})).rejects.toMatchObject({code:'OPENCODE_BINDING_SCOPE_CHANGED'});await expect(f.port.history({...binding,executionRefId:'other'},{limit:50})).rejects.toMatchObject({code:'OPENCODE_BINDING_SCOPE_CHANGED'});expect(f.request).not.toHaveBeenCalled();
});
it("marks active service observations without inferring pending tools are absent",async()=>{
 const f=fixture();f.setActive({ses_exact:{type:'running'}});const o=await f.port.inspect(binding);expect(o).toMatchObject({state:'running',pendingTools:'unknown',pendingApprovals:'none',historyMode:'snapshot-only',reportedModel:{nativeSelectionId:'openrouter/openai/gpt-4o-mini'}});expect(o.activeTurnId).toBeUndefined();expect(f.port.eventContinuity).toBe('volatile');
});

it.each(["model","variant","permissions","time","project"] as const)("refuses a mixed native observation when %s changes between session reads",async mode=>{
 const f=fixture(),original=f.request.getMockImplementation()!;let changed=false;
 f.request.mockImplementation(async r=>{
  const value=await original(r);
  if(r.path==="/api/session/active"&&!changed){changed=true;const next={...info()};
   if(mode==="model")next.model={providerID:"openrouter",id:"other-model"};
   if(mode==="variant")next.model={...model,variant:"high"};
   if(mode==="permissions")next.permissions=[{action:"shell",resource:"*",effect:"allow"}];
   if(mode==="time")next.time={...next.time,updated:next.time.updated+1};
   if(mode==="project")next.projectID="other-project";
   f.setSession(next);
  }
  return value;
 });
 await expect(f.port.inspect(binding)).rejects.toMatchObject({code:"OPENCODE_OBSERVATION_CHANGED"});
 expect(f.request.mock.calls.every(([r])=>r.method==="GET")).toBe(true);
});
it("rechecks the session after the final server/location handshake before projecting its model",async()=>{
 const f=fixture(),original=f.request.getMockImplementation()!;let locations=0;
 f.request.mockImplementation(async r=>{const value=await original(r);if(r.path==="/api/location"&&++locations===2)f.setSession({...info(),model:{providerID:"openrouter",id:"new-model"}});return value;});
 await expect(f.port.inspect(binding)).rejects.toMatchObject({code:"OPENCODE_OBSERVATION_CHANGED"});
 expect(await f.port.inspect(binding)).toMatchObject({reportedModel:{nativeSelectionId:"openrouter/new-model"},pendingTools:"unknown"});
});
it("captures the initial session watermark even if its returned payload is later mutated",async()=>{
 const f=fixture(),original=f.request.getMockImplementation()!,mutable=info();f.setSession(mutable);
 f.request.mockImplementation(async r=>{const value=await original(r);if(r.path==="/api/session/active")mutable.time.updated+=1;return value;});
 await expect(f.port.inspect(binding)).rejects.toMatchObject({code:"OPENCODE_OBSERVATION_CHANGED"});
});
it("can reread a newly stable snapshot without promoting native tool or writer evidence",async()=>{
 const f=fixture(),original=f.request.getMockImplementation()!;let changed=false;
 f.request.mockImplementation(async r=>{const value=await original(r);if(r.path.endsWith("/permission")&&!changed){changed=true;f.setSession({...info(),model:{providerID:"openrouter",id:"new-model"}});}return value;});
 await expect(f.port.inspect(binding)).rejects.toMatchObject({code:"OPENCODE_OBSERVATION_CHANGED"});
 expect(await f.port.inspect(binding)).toMatchObject({state:"idle",reportedModel:{nativeSelectionId:"openrouter/new-model"},pendingTools:"unknown",pendingApprovals:"none",historyMode:"snapshot-only"});
 expect(f.port.capabilities().releaseControl.support).toBe("unknown");expect(f.request.mock.calls.every(([r])=>r.method==="GET")).toBe(true);
});
it("accepts semantically unchanged time fields serialized in a different key order",async()=>{
 const f=fixture(),original=f.request.getMockImplementation()!;
 f.request.mockImplementation(async r=>{const value=await original(r);if(r.path==="/api/session/active")f.setSession({...info(),time:{updated:Date.parse(at),created:Date.parse(at)}});return value;});
 expect(await f.port.inspect(binding)).toMatchObject({state:"idle",reportedModel:{nativeSelectionId:"openrouter/openai/gpt-4o-mini"},pendingTools:"unknown"});
});
it("checks scope again after awaited history",async()=>{
 const f=fixture();const original=f.request.getMockImplementation()!;f.request.mockImplementation(async r=>{const result=await original(r);if(r.path.endsWith('/message'))f.setSession({...info(),location:{directory:'/moved'}});return result});await expect(f.port.history(binding,{limit:50})).rejects.toMatchObject({code:'OPENCODE_LOCATION_MISMATCH'});
});
it("does not grant runtime capabilities without scoped evidence",()=>{
 const f=fixture();const port=new OpenCodeV2InteractionPort({...f.scope,evidence:{}},{request:f.request});expect(port.capabilities().historyRead.support).toBe('unknown');expect(port.capabilities().releaseControl.support).toBe('unknown');expect(port.capabilities().surfaces).toEqual({});
});
it("never weakens a supplied denied permission rule",async()=>{
 const f=fixture();f.start.permissions=[{action:'shell',resource:'*',effect:'deny'}];f.setSession({...info(),permissions:f.start.permissions});await f.port.create(f.start);expect(f.request).toHaveBeenCalledWith(expect.objectContaining({path:'/api/session',body:expect.objectContaining({permissions:[{action:'shell',resource:'*',effect:'deny'}]})}));
});
it("keeps uncertain prompt acceptance distinct from completion without resend",async()=>{
 const f=fixture();const original=f.request.getMockImplementation()!;f.request.mockImplementation(async r=>{if(r.path.endsWith('/prompt'))throw new Error('token=secret');return original(r)});expect((await f.port.create(f.start)).receipt).toMatchObject({state:'unknown',code:'OPENCODE_PROMPT_OUTCOME_UNKNOWN'});expect((await f.port.create(f.start)).receipt.state).toBe('unknown');expect(f.request.mock.calls.filter(([r])=>r.path.endsWith('/prompt'))).toHaveLength(1);
});
it("deduplicates the same creation command and rejects a changed body",async()=>{
 const f=fixture();await f.port.create(f.start);await f.port.create(f.start);await expect(f.port.create({...f.start,prompt:'changed'})).rejects.toMatchObject({code:'OPENCODE_COMMAND_CONFLICT'});expect(f.request.mock.calls.filter(([r])=>r.method==='POST'&&r.path==='/api/session')).toHaveLength(1);
});
it("refuses to resume an existing native inbox queue",async()=>{
 const f=fixture();const original=f.request.getMockImplementation()!;f.request.mockImplementation(async r=>r.path.endsWith('/inbox')?{data:[{id:'msg_prior'}]}:original(r));await expect(f.port.create(f.start)).rejects.toMatchObject({code:'OPENCODE_SESSION_BUSY'});expect(f.request.mock.calls.filter(([r])=>r.path.endsWith('/prompt'))).toHaveLength(0);
});
it("marks unrepresented native tool content as a history gap",async()=>{
 const f=fixture();f.setMessages([{id:'msg_tool',type:'assistant',agent:'build',model,time:{created:Date.parse(at)},content:[{type:'tool',name:'shell',state:{type:'completed',output:'private payload'}}]}]);expect(await f.port.history(binding,{limit:50})).toMatchObject({completeness:'partial',gaps:['OPENCODE_HISTORY_CONTENT_UNSUPPORTED']});
});
it("can add scoped read-only history to the retained standalone adapter",()=>{
 const f=fixture();const port=new OpenCodeV2InteractionPort({...f.scope,backendId:'opencode-cli-json',evidence:{historyRead:evidence,durableIdentity:evidence}},{request:f.request});
 const adapter=new OpenCodeAdapter({id:'profile',alias:'existing'},undefined,undefined,port);expect(adapter.manifest.backends[0]?.id).toBe('opencode-cli-json');expect(getInteractionPort(adapter)).toBe(port);expect(port.capabilities().sameSessionContinue.support).toBe('unknown');
});
it.each(['https://provider.example','http://user:password@127.0.0.1:8123','http://127.0.0.1:8123/?token=private'])('rejects unsafe server entry %s',origin=>{
 expect(()=>new OpenCodeV2HttpTransport(origin)).toThrow('OPENCODE_SERVER_ENTRY_INVALID');
});
it("uses real loopback HTTP query encoding and suppresses raw error bodies",async()=>{
 const seen:string[]=[];const server=createServer((req,res)=>{seen.push(req.url!);res.setHeader('content-type','application/json');if(req.url?.startsWith('/api/location'))res.end(JSON.stringify({directory:'/work space'}));else{res.statusCode=401;res.end('{"apiKey":"private-native-diagnostic"}')}});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const addr=server.address();if(!addr||typeof addr==='string')throw new Error('missing test server');const transport=new OpenCodeV2HttpTransport(`http://127.0.0.1:${addr.port}`);expect(await transport.request({method:'GET',path:'/api/location',query:{'location[directory]':'/work space'}})).toEqual({directory:'/work space'});await expect(transport.request({method:'GET',path:'/api/info'})).rejects.toMatchObject({code:'OPENCODE_NATIVE_AUTH_REQUIRED'});expect(seen[0]).toBe('/api/location?location%5Bdirectory%5D=%2Fwork+space');}
 finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()))}
});
it("checks captured start admission before creating a native session",async()=>{
 const f=fixture();f.start.beforePrompt=()=>{throw new Error("authority revoked")};await expect(f.port.create(f.start)).rejects.toMatchObject({code:"OPENCODE_START_ADMISSION_REJECTED",outcome:"not-created"});expect(f.request.mock.calls.filter(([r])=>r.method==="POST")).toHaveLength(0);
});
it.each(["create","prompt"])("rechecks %s admission after actual HTTP headers preparation",async stage=>{
 const f=fixture(),original=f.request.getMockImplementation()!,posts:string[]=[];let allowed=true,writePath:string|undefined;
 const server=createServer(async(req,res)=>{let raw="";for await(const chunk of req)raw+=chunk;const path=new URL(req.url!,"http://localhost").pathname;if(req.method==="POST")posts.push(path);const value=await original({method:req.method as "GET"|"POST",path,...(raw?{body:JSON.parse(raw)}:{})});res.setHeader("content-type","application/json");res.end(JSON.stringify(value));});
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
 try{const address=server.address();if(!address||typeof address==="string")throw Error("missing test server");const http=new OpenCodeV2HttpTransport(`http://127.0.0.1:${address.port}`,async()=>{if(writePath===(stage==="create"?"/api/session":"/api/session/ses_exact/prompt")){await Promise.resolve();allowed=false;}return {};});const port=new OpenCodeV2InteractionPort(f.scope,{request:input=>{writePath=input.method==="POST"?input.path:undefined;return http.request(input);}});
 const pending=port.create({...f.start,beforePrompt:()=>{if(!allowed)throw Error("authority revoked");}});
 if(stage==="create"){await expect(pending).rejects.toMatchObject({code:"OPENCODE_START_ADMISSION_REJECTED",outcome:"not-created"});expect(posts).toEqual([]);expect(f.start.onBinding).not.toHaveBeenCalled();}
 else{expect((await pending).receipt).toMatchObject({state:"rejected",code:"OPENCODE_PROMPT_ADMISSION_REJECTED"});expect(posts).toEqual(["/api/session"]);expect(f.start.onBinding).toHaveBeenCalledTimes(1);await expect(port.readTurn(binding,f.start.commandId)).rejects.toMatchObject({code:"OPENCODE_TURN_RECEIPT_UNAVAILABLE"});}
 }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
it("captures the original HTTP admission and body across headers preparation",async()=>{
 const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>(),seen:unknown[]=[];let allowed=true;
 const server=createServer(async(req,res)=>{let body="";for await(const chunk of req)body+=chunk;seen.push({method:req.method,path:req.url,body});res.setHeader("content-type","application/json");res.end('{}');});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const address=server.address();if(!address||typeof address==='string')throw Error('missing test server');const transport=new OpenCodeV2HttpTransport(`http://127.0.0.1:${address.port}`,async()=>{entered.resolve();await release.promise;return {};});const input:OpenCodeV2Request={method:'POST',path:'/api/session',body:{text:'original'},beforeSend:()=>{if(!allowed)throw Error('authority revoked');}};const pending=transport.request(input);await entered.promise;allowed=false;input.beforeSend=()=>{};input.method='GET';input.body={text:'replacement'};release.resolve();await expect(pending).rejects.toMatchObject({code:'OPENCODE_WRITE_ADMISSION_REJECTED'});expect(seen).toEqual([]);
 }finally{release.resolve();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
it("rechecks disconnection caused synchronously by the admission callback",async()=>{
 const f=fixture();f.start.beforePrompt=()=>f.port.markDisconnected();await expect(f.port.create(f.start)).rejects.toMatchObject({outcome:'not-created'});expect(f.request.mock.calls.filter(([input])=>input.method==='POST')).toHaveLength(0);
});
it("refuses async admission guards rather than submitting while they are unresolved",async()=>{
 const f=fixture();f.start.beforePrompt=async()=>{};await expect(f.port.create(f.start)).rejects.toMatchObject({code:"OPENCODE_START_ADMISSION_REJECTED",outcome:"not-created"});expect(f.request.mock.calls.filter(([r])=>r.method==="POST")).toHaveLength(0);
});
it("keeps a created binding but refuses input revoked during its persistence callback",async()=>{
 const f=fixture();let allowed=true;f.start.beforePrompt=()=>{if(!allowed)throw new Error("authority revoked")};f.start.onBinding=()=>{allowed=false};await expect(f.port.create(f.start)).rejects.toThrow("authority revoked");expect(f.start.onNativeEvent).toHaveBeenCalledWith(expect.objectContaining({state:"waiting",nativeSessionId:"ses_exact"}));expect(f.start.onNativeEvent).not.toHaveBeenCalledWith(expect.objectContaining({state:"received"}));expect(f.request.mock.calls.filter(([r])=>r.path.endsWith("/prompt"))).toHaveLength(0);
});
it("rechecks admission after the last awaited inbox read before native prompt submission",async()=>{
 const f=fixture(),original=f.request.getMockImplementation()!;let allowed=true;f.start.beforePrompt=()=>{if(!allowed)throw new Error("authority revoked")};f.request.mockImplementation(async input=>{const result=await original(input);if(input.path.endsWith("/inbox"))allowed=false;return result;});await expect(f.port.create(f.start)).rejects.toThrow("authority revoked");expect(f.request.mock.calls.filter(([r])=>r.path.endsWith("/prompt"))).toHaveLength(0);
});
it("captures the original callback instead of adopting caller changes across binding persistence",async()=>{
 const f=fixture(),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();let allowed=true;f.start.beforePrompt=()=>{if(!allowed)throw new Error("original authority revoked")};f.start.onBinding=async()=>{entered.resolve();await release.promise};const pending=f.port.create(f.start);await entered.promise;allowed=false;f.start.beforePrompt=()=>{};release.resolve();await expect(pending).rejects.toThrow("original authority revoked");expect(f.request.mock.calls.filter(([r])=>r.path.endsWith("/prompt"))).toHaveLength(0);
});
it("fences an exact continuation after async preparation without another prompt",async()=>{
 const f=fixture(),created=await f.port.create(f.start),original=f.request.getMockImplementation()!;let allowed=true;f.request.mockImplementation(async input=>{const result=await original(input);if(input.path.endsWith("/inbox"))allowed=false;return result;});const commandId="continue-guarded",fence={runId:"run",sessionId:"session",generation:1,leaseId:"lease",expectedTaskRevision:1,expectedControlRevision:1,expectedControlEpoch:1,expectedCurrentRunId:"run",commandId};await expect(f.port.continueTurn(created.binding,{commandId,message:"next",fence},()=>{if(!allowed)throw new Error("authority revoked")})).rejects.toThrow("authority revoked");expect(f.request.mock.calls.filter(([r])=>r.path.endsWith("/prompt"))).toHaveLength(1);
});
it("cancels an already aborted request before resolving credentials",async()=>{
 const abort=new AbortController();abort.abort();const headers=vi.fn(()=>new Promise<Record<string,string>>(()=>{}));const transport=new OpenCodeV2HttpTransport('http://127.0.0.1:8123',headers);
 const result=await Promise.race([transport.request({method:'GET',path:'/api/info',signal:abort.signal}).catch(e=>e.code),new Promise<string>(resolve=>setTimeout(()=>resolve('still-pending'),40))]);expect(result).toBe('OPENCODE_NATIVE_UNREACHABLE');expect(headers).not.toHaveBeenCalled();
});
it("bounds a credential resolver that never settles",async()=>{
 vi.useFakeTimers();try{const transport=new OpenCodeV2HttpTransport('http://127.0.0.1:8123',()=>new Promise(()=>{}));const request=transport.request({method:'GET',path:'/api/info'}).catch(e=>e.code);await vi.advanceTimersByTimeAsync(5000);expect(await Promise.race([request,Promise.resolve('still-pending')])).toBe('OPENCODE_NATIVE_UNREACHABLE');}finally{vi.useRealTimers()}
});
it.each(['different',Number.NaN])("keeps mismatched prompt receipts unknown (%s)",async changed=>{
 const f=fixture();const original=f.request.getMockImplementation()!;f.request.mockImplementation(async r=>{const value=await original(r);if(r.path.endsWith('/prompt')){const receipt=value as {data:{payload:{text:string};time:{created:number}}};if(typeof changed==='string')receipt.data.payload.text=changed;else receipt.data.time.created=changed;}return value});expect((await f.port.create(f.start)).receipt).toMatchObject({state:'unknown',code:'OPENCODE_PROMPT_OUTCOME_UNKNOWN'});
});
it("matches the actual worktree when native APIs canonicalize a symlink",async()=>{
 const root=mkdtempSync(join(tmpdir(),'dispatcher-opencode-location-'));try{const physical=join(root,'physical');mkdirSync(physical);const alias=join(root,'alias');symlinkSync(physical,alias);const f=fixture(alias);expect((await f.port.create(f.start)).receipt.state).toBe('accepted');}finally{rmSync(root,{recursive:true,force:true})}
});
it("rejects a non-string native permission enum before creation",async()=>{
 const f=fixture();f.start.permissions=[{action:'shell',resource:'*',effect:['deny'] as unknown as 'deny'}];await expect(f.port.create(f.start)).rejects.toMatchObject({code:'OPENCODE_START_INVALID',outcome:'not-created'});expect(f.request.mock.calls.filter(([r])=>r.method==='POST')).toHaveLength(0);
});

it('admits only the exact explicitly audited current protocol version',async()=>{const f=fixture(),original=f.request.getMockImplementation()!;f.request.mockImplementation(async input=>input.path==='/api/info'?{version:'2.0.26',pid:123,urls:[],paths:{tmp:'/tmp'}}:original(input));const port=new OpenCodeV2InteractionPort({...f.scope,protocolVersion:'2.0.26'},{request:f.request});expect((await port.create(f.start)).binding.nativeSessionId).toBe('ses_exact');});
it('does not silently adopt another supported version on an existing connection',async()=>{const f=fixture(),original=f.request.getMockImplementation()!;f.request.mockImplementation(async input=>input.path==='/api/info'?{version:'2.0.26',pid:123,urls:[],paths:{tmp:'/tmp'}}:original(input));await expect(f.port.create(f.start)).rejects.toMatchObject({code:'OPENCODE_VERSION_UNSUPPORTED',outcome:'not-created'});expect(f.request.mock.calls.filter(([r])=>r.method==='POST')).toHaveLength(0);});
it('rejects an unqualified protocol version in scope before any I/O',()=>{const f=fixture();expect(()=>new OpenCodeV2InteractionPort({...f.scope,protocolVersion:'2.0.999' as '2.0.26'},{request:f.request})).toThrow('OPENCODE_SCOPE_INVALID');expect(f.request).not.toHaveBeenCalled();});

function catalogFixture(){const f=fixture(),original=f.request.getMockImplementation()!,m={id:'model',providerID:'provider',name:'Model'};f.request.mockImplementation(async input=>input.path==='/api/model'?{location:{directory:workspace,project:{id:'project'}},data:[m]}:input.path==='/api/model/default'?{location:{directory:workspace,project:{id:'project'}},data:m}:original(input));return {...f,m};}
it('reads bounded native models/default in the exact project without creating a session',async()=>{const f=catalogFixture(),result=await f.port.readModels();expect(result).toEqual({models:[f.m],defaultModel:f.m,protocolVersion:'2.0.22'});expect(f.request.mock.calls.filter(([r])=>r.path==='/api/model')).toHaveLength(2);expect(f.request.mock.calls.every(([r])=>r.method==='GET')).toBe(true);for(const [r] of f.request.mock.calls.filter(([r])=>r.path.startsWith('/api/model')))expect(r.query).toEqual({'location[directory]':workspace});});
it('rejects changing model snapshots and never substitutes the first read',async()=>{const f=catalogFixture(),original=f.request.getMockImplementation()!;let count=0;f.request.mockImplementation(async r=>r.path==='/api/model'&&++count===2?{location:{directory:workspace,project:{id:'project'}},data:[]}:original(r));await expect(f.port.readModels()).rejects.toMatchObject({code:'OPENCODE_MODEL_CATALOG_CHANGED'});});
it('rejects mismatched model response locations and project identities',async()=>{for(const replacement of [{directory:'/wrong',project:{id:'project'}},{directory:workspace,project:{id:'other'}}]){const f=catalogFixture(),original=f.request.getMockImplementation()!;f.request.mockImplementation(async r=>r.path==='/api/model'?{location:replacement,data:[f.m]}:original(r));await expect(f.port.readModels()).rejects.toBeInstanceOf(Error);}});
it('rejects server version drift and disconnection after readonly catalog data',async()=>{for(const mode of ['version','closed']){const f=catalogFixture(),original=f.request.getMockImplementation()!;let count=0;f.request.mockImplementation(async r=>{if(r.path==='/api/model/default'&&mode==='closed')f.port.markDisconnected();if(r.path==='/api/info'&&++count===2&&mode==='version')return {version:'2.0.26',pid:123,urls:[],paths:{tmp:'/tmp'}};return original(r);});await expect(f.port.readModels()).rejects.toBeInstanceOf(Error);}});
it('reads actual native PublicRef locations without a project object',async()=>{const f=catalogFixture();f.request.mockImplementation(async r=>r.path==='/api/info'?{version:'2.0.22',pid:123,urls:[],paths:{tmp:'/tmp'}}:r.path==='/api/location'?{directory:workspace,project:{id:'project',directory:workspace,canonical:workspace}}:{location:{directory:workspace},data:r.path==='/api/model'?[f.m]:f.m});expect((await f.port.readModels()).models).toEqual([f.m]);});
it('waits within a bound for initial empty candidate snapshots without native mutation',async()=>{const f=catalogFixture(),original=f.request.getMockImplementation()!;let count=0;f.request.mockImplementation(async r=>r.path==='/api/model'&&++count===1?{location:{directory:workspace,project:{id:'project'}},data:[]}:original(r));expect((await f.port.readModels()).models).toEqual([f.m]);expect(f.request.mock.calls.every(([r])=>r.method==='GET')).toBe(true);});

function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
it.each(['waiting','received'] as const)('awaits durable %s projection and retains callback ownership during drain',async state=>{
 const f=fixture(),entered=deferred(),gate=deferred();const facts:string[]=[];let bound=false,drained=false;
 f.start.onBinding=()=>{bound=true;};f.start.onNativeEvent=async fact=>{expect(bound).toBe(true);facts.push(fact.state);if(fact.state===state){entered.resolve();await gate.promise;}};
 const pending=f.port.create(f.start);await entered.promise;
 expect(f.request.mock.calls.filter(([r])=>r.path.endsWith('/prompt'))).toHaveLength(state==='waiting'?0:1);
 const drain=f.port.drainLocalCallbacks().then(()=>{drained=true;});await Promise.resolve();expect(drained).toBe(false);
 const settled=pending.then(value=>value,error=>error);gate.resolve();await drain;const result=await settled;
 if(state==='waiting'){expect(result).toMatchObject({code:'OPENCODE_RECONCILIATION_REQUIRED'});expect(facts).toEqual(['waiting']);}
 else {expect(result).toMatchObject({receipt:{state:'accepted'}});expect(facts).toEqual(['waiting','received']);}
 expect(drained).toBe(true);expect(f.request.mock.calls.filter(([r])=>r.path.endsWith('/prompt'))).toHaveLength(state==='waiting'?0:1);
});
it.each(['waiting','received'] as const)('fences rejected durable %s events without replaying native input',async state=>{
 const f=fixture();f.start.onNativeEvent=async fact=>{if(fact.state===state)throw Error('sink failed');};
 await expect(f.port.create(f.start)).rejects.toMatchObject({code:'OPENCODE_BINDING_PERSISTENCE_UNKNOWN',outcome:'unknown'});await f.port.drainLocalCallbacks();
 await expect(f.port.create({...f.start,commandId:'another'})).rejects.toMatchObject({code:'OPENCODE_RECONCILIATION_REQUIRED'});
 expect(f.request.mock.calls.filter(([r])=>r.path.endsWith('/prompt'))).toHaveLength(state==='waiting'?0:1);
});
it('projects received only after an accepted native receipt',async()=>{
 const f=fixture(),facts:string[]=[];f.start.onNativeEvent=fact=>{facts.push(fact.state);if(fact.state==='received')expect(f.request.mock.calls.some(([r])=>r.path.endsWith('/prompt'))).toBe(true);};
 expect((await f.port.create(f.start)).receipt.state).toBe('accepted');expect(facts).toEqual(['waiting','received']);
});
it('does not project received for an unknown native prompt receipt',async()=>{
 const f=fixture(),facts:string[]=[];f.start.onNativeEvent=fact=>{facts.push(fact.state);};const read=f.request.getMockImplementation()!;f.request.mockImplementation(async r=>{if(r.path.endsWith('/prompt'))throw Error('lost receipt');return read(r);});
 expect((await f.port.create(f.start)).receipt.state).toBe('unknown');expect(facts).toEqual(['waiting']);expect(f.request.mock.calls.filter(([r])=>r.path.endsWith('/prompt'))).toHaveLength(1);
});
it('captures initial callbacks, guard and inputs before preparation awaits',async()=>{
 const f=fixture();f.start.model={...f.start.model};const original=f.request.getMockImplementation()!,bound=vi.fn(),facts=vi.fn(),guard=vi.fn();f.start.onBinding=bound;f.start.onNativeEvent=facts;f.start.beforePrompt=guard;
 f.request.mockImplementation(async r=>{f.start.onBinding=()=>{throw Error('mutated binding sink')};f.start.onNativeEvent=()=>{throw Error('mutated event sink')};f.start.beforePrompt=()=>{throw Error('mutated guard')};f.start.prompt='changed';f.start.model.id='changed';return original(r);});
 expect((await f.port.create(f.start)).receipt.state).toBe('accepted');expect(bound).toHaveBeenCalledTimes(1);expect(facts.mock.calls.map(([fact])=>fact.state)).toEqual(['waiting','received']);expect(guard).toHaveBeenCalled();
 expect(f.request.mock.calls.find(([r])=>r.path.endsWith('/prompt'))![0].body).toMatchObject({text:'-literal; $(never-run)'});
});
it.each(['inspect','history'] as const)('rejects a stable foreign session project during %s',async operation=>{
 const f=fixture();f.setSession({...info(),projectID:'foreign-project'});
 await expect(operation==='inspect'?f.port.inspect(binding):f.port.history(binding,{limit:10})).rejects.toMatchObject({code:'OPENCODE_OBSERVATION_CHANGED'});expect(f.request.mock.calls.every(([r])=>r.method==='GET')).toBe(true);
});
it('keeps a foreign create response unknown and never sends a prompt',async()=>{
 const f=fixture();f.setSession({...info(),projectID:'foreign-project'});
 await expect(f.port.create(f.start)).rejects.toMatchObject({code:'OPENCODE_CREATE_OUTCOME_UNKNOWN'});expect(f.start.onBinding).not.toHaveBeenCalled();expect(f.request.mock.calls.filter(([r])=>r.path.endsWith('/prompt'))).toHaveLength(0);
});
it('pins project identity across separate handshakes',async()=>{
 const f=fixture();await f.port.inspect(binding);const read=f.request.getMockImplementation()!;f.request.mockImplementation(async r=>r.path==='/api/location'?{directory:workspace,project:{id:'new-project',directory:workspace,canonical:workspace}}:read(r));
 await expect(f.port.history(binding,{limit:10})).rejects.toMatchObject({code:'OPENCODE_LOCATION_MISMATCH'});expect(f.request.mock.calls.every(([r])=>r.method==='GET')).toBe(true);
});
it('blocks an approval introduced during prompt preparation before native input',async()=>{
 const f=fixture(),read=f.request.getMockImplementation()!;let pending=false;f.request.mockImplementation(async r=>{if(r.path.endsWith('/inbox'))pending=true;if(r.path.endsWith('/permission')&&pending)return {data:[{id:'approval',sessionID:binding.nativeSessionId}]};return read(r);});
 await expect(f.port.create(f.start)).rejects.toMatchObject({code:'OPENCODE_APPROVAL_PENDING'});expect(f.request.mock.calls.filter(([r])=>r.path.endsWith('/prompt'))).toHaveLength(0);expect(f.start.onBinding).toHaveBeenCalledTimes(1);
});
