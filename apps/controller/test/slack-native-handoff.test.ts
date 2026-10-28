import {mkdtempSync,rmSync,mkdirSync,cpSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach,expect,it,vi} from "vitest";
import {codexManifest,assertAdapterWriteAdmission,type AgentAdapter} from "@dispatcher/adapters";
import type {NativeBinding,Run} from "@dispatcher/domain";
import type {DispatcherConfig,SecretStore} from "@dispatcher/config";
import {ConnectorError,type ConversationBinding,type MessagingAdapter,type NormalizedMessage} from "@dispatcher/integrations";
import {InteractionStore,type JsonValue} from "@dispatcher/persistence";
import type {SemanticWorkflowRecord} from "@dispatcher/semantic";
import {ControllerService} from "../src/service.js";

const records:Array<{service:ControllerService;root:string;calls:Record<string,unknown>}> = [];
const evidenceRoot=process.env.DISPATCHER_SLACK_FIXTURE_EVIDENCE;
afterEach(async context=>{for(const record of records.splice(0)){
 if(!evidenceRoot){await record.service.stop();rmSync(record.root,{recursive:true,force:true});continue;}
 const destination=join(evidenceRoot,`${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}`);mkdirSync(destination,{recursive:true});
 const rows=record.service.database.handle.prepare("SELECT * FROM entities ORDER BY kind,id").all();
 writeFileSync(join(destination,"rows.json"),JSON.stringify(rows,null,2));
 writeFileSync(join(destination,"calls.json"),JSON.stringify(record.calls,null,2));
 writeFileSync(join(destination,"test.json"),JSON.stringify({name:context.task.name,result:context.task.result},null,2));
 await record.service.stop();cpSync(record.root,join(destination,"tree"),{recursive:true});rmSync(record.root,{recursive:true,force:true});
 }vi.restoreAllMocks();});
const secrets=():SecretStore=>{const values=new Map<string,string>();return {put:async(reference,value)=>{values.set(reference,value);return {reference,backend:"encrypted-local",exists:true};},delete:async reference=>{values.delete(reference);},test:async reference=>values.has(reference),metadata:async reference=>({reference,backend:"encrypted-local",exists:values.has(reference)}),resolve:async reference=>{const value=values.get(reference);if(value===undefined)throw Error("Missing owned fixture secret");return value;}};};
const json=(value:unknown):JsonValue=>JSON.parse(JSON.stringify(value)) as JsonValue;
async function fixture(native=true){
 const root=mkdtempSync(join(tmpdir(),"slack-native-"));let now=Date.now();const service=new ControllerService({dataDirectory:join(root,"data"),ownerToken:"fixture",secretStore:secrets(),backgroundWorker:false,clock:()=>new Date(now)});const calls:Record<string,unknown>={};records.push({service,root,calls});await service.start({listen:false});const at=new Date(now).toISOString();
 const config=(await service.app.inject({method:"GET",url:"/api/config",headers:{authorization:"Bearer fixture"}})).json().config as DispatcherConfig;
 config.agentProfiles=[{id:"p",alias:"Owned fixture",provider:"codex",runnerId:"local",settings:{codexHome:join(root,"profile")}}];
 const plan=(await service.app.inject({method:"POST",url:"/api/config/plans",headers:{authorization:"Bearer fixture"},payload:{config}})).json().plan;
 const applied=await service.app.inject({method:"POST",url:`/api/config/plans/${plan.id}/apply`,headers:{authorization:"Bearer fixture"},payload:{confirmed:true}});if(applied.statusCode!==200)throw Error(applied.body);
 const run:Run={id:"run",taskId:"task",sessionId:"session",profileId:"p",providerId:"codex",runnerId:"local",state:"ACTIVE",generation:1,attempt:1,leaseId:"lease",leaseExpiresAt:"2100-01-01T00:00:00Z",taskRevision:1,contractRevision:1,worktree:"/workspace",startedAt:at,executionRef:{version:1,id:"execution",kind:"managed-worktree",runnerId:"local",repositoryId:"repo",workspaceId:"workspace",pathRef:"workspace:workspace",branch:"task/run",baseRevision:"sha"}};
 service.database.writeCanonicalTask("task",0,{id:"task",projectId:"project",state:"RUNNING",currentRunId:"run"},at);service.database.saveEntity("run","run",json(run));service.database.saveEntity("session","session",{id:"session",profileId:"p",providerId:"codex",createdAt:at,updatedAt:at,resumable:true});service.database.saveEntity("adapter-session","session",{id:"session",runId:"run",profileId:"p",backendId:"exec",workspacePath:"/workspace",state:"RUNNING",createdAt:at,updatedAt:at});
 const store=new InteractionStore(service.database);const binding:NativeBinding={version:1,product:"codex",region:"global",profileId:"p",backendId:"exec",runnerId:"local",nativeStoreRef:"store",nativeSessionId:"native",executionRefId:"execution",identityState:"bound"};
 const observation={version:1 as const,id:"idle",nativeSessionId:"native",scopeFingerprint:"scope",observedAt:at,state:"idle" as const,pendingTools:"none" as const,pendingApprovals:"none" as const,historyMode:"snapshot-only" as const,executionRefId:"execution"};
 if(native){store.bindNative({sessionId:"session",runId:"run",binding,expectedGeneration:1,expectedLeaseId:"lease"});store.initializeControl({sessionId:"session",activeRunId:"run",exclusion:"cooperative",at});store.saveObservation({sessionId:"session",observerGeneration:1,observerSequence:1,controlEpoch:1,observation});}
 service.messagingIdentity.link({connectorInstanceId:"slack",externalPrincipalId:"U1",principalId:"owner",roles:["operator","admin"]});const conversation=service.conversations.bind({connectorInstanceId:"slack",conversationId:"C1",threadId:"thread",taskId:"task",runId:"run",sessionId:"session",generation:1,state:"ACTIVE",...(native?{controlEpoch:1}:{})});
 const send=vi.fn<(sessionId:string,message:string)=>Promise<void>>(async()=>{});const agents=(service as unknown as {agentAdapters:Map<string,AgentAdapter>}).agentAdapters;const admission={before:undefined as (()=>void)|undefined};const adapterCalls:Array<unknown>=[],admissionCalls:Array<{sessionId:string;state:"invoked"|"allowed"|"denied";code?:string}>=[];calls.adapter=adapterCalls;calls.admission=admissionCalls;calls.provider=send.mock.calls;
 agents.set("p",{manifest:codexManifest,send:async(sessionId:string,message:string,assertAuthority?:()=>void)=>{adapterCalls.push({sessionId,message,hasAuthority:typeof assertAuthority==="function"});if(!assertAuthority)throw Error("Missing actual admission callback");admission.before?.();const entry:{sessionId:string;state:"invoked"|"allowed"|"denied";code?:string}={sessionId,state:"invoked"};admissionCalls.push(entry);try{assertAdapterWriteAdmission(assertAuthority);entry.state="allowed";}catch(error){entry.state="denied";const code=(error as {code?:unknown}).code;if(typeof code==="string")entry.code=code;throw error;}await send(sessionId,message);}} as unknown as AgentAdapter);
 const reply=vi.fn<NonNullable<MessagingAdapter["reply"]>>(async()=>({externalMessageId:"reply"}));const messagingSend=vi.fn<MessagingAdapter["send"]>(async()=>({externalMessageId:"default-message"}));const adapter={instance:{id:"slack",kind:"messaging",definitionId:"messaging.slack"},definition:{kind:"messaging",id:"messaging.slack",capabilities:[]},reply,send:messagingSend} as unknown as MessagingAdapter;service.connectors.register(adapter);calls.reply=reply.mock.calls;calls.messagingSend=messagingSend.mock.calls;
 const handle=(message:NormalizedMessage)=>(service as unknown as {handleMessagingMessage:(adapter:MessagingAdapter,message:NormalizedMessage)=>Promise<unknown>}).handleMessagingMessage(adapter,message);
 const message=(text:string,id="event"):NormalizedMessage=>({version:1,externalMessageId:id,connectorInstanceId:"slack",conversationId:"C1",threadId:"thread",principalExternalId:"U1",text,occurredAt:at,idempotencyKey:id});
 const approve=(id="event")=>{const workflow=service.semanticWorkflows.get(`messaging:slack:${id}`)!;return handle({...message("",`${id}-approval`),action:{id:"workflow.approve",value:JSON.stringify({workflowId:workflow.id,expectedRevision:workflow.revision})}});};
 return {service,store,run,binding,observation,conversation,reply,messagingSend,send,handle,message,approve,admission,adapterCalls,admissionCalls,advance:(ms:number)=>{now+=ms;}};
}
const controlNotice=(id:string,changes:Record<string,unknown>={})=>json({version:1,id,state:"pending",runId:"run",sessionId:"session",controlEpoch:1,controlRevision:1,controlState:"AUTOMATED",...changes});
const notifyControl=(service:ControllerService)=>(service as unknown as {notifyNativeControlAttention:()=>Promise<void>}).notifyNativeControlAttention();
it("selects control notices without materializing the archived outbox",async()=>{
 const f=await fixture();for(let i=0;i<100;i++)f.service.database.saveEntity("native-control-outbox",`archived-${i}`,controlNotice(`archived-${i}`,{state:"sent"}));f.service.database.saveEntity("native-control-outbox","pending",controlNotice("pending"));
 const list=f.service.database.listEntities.bind(f.service.database);vi.spyOn(f.service.database,"listEntities").mockImplementation(kind=>{if(kind==="native-control-outbox")throw Error("unbounded notice materialization");return list(kind);});
 await expect(notifyControl(f.service)).resolves.toBeUndefined();expect(f.reply).toHaveBeenCalledOnce();expect(f.service.database.getEntity("native-control-outbox","pending")).toMatchObject({state:"sent"});expect(f.send).not.toHaveBeenCalled();
});
it("limits control notice delivery to ten candidates per cycle without duplicate effects",async()=>{
 const f=await fixture();for(let i=0;i<21;i++){const id=`notice-${String(i).padStart(2,"0")}`;f.service.database.saveEntity("native-control-outbox",id,controlNotice(id));}
 await notifyControl(f.service);expect(f.reply).toHaveBeenCalledTimes(10);await notifyControl(f.service);expect(f.reply).toHaveBeenCalledTimes(20);await notifyControl(f.service);expect(f.reply).toHaveBeenCalledTimes(21);await notifyControl(f.service);expect(f.reply).toHaveBeenCalledTimes(21);
 expect(new Set(f.reply.mock.calls.map(([,key])=>key)).size).toBe(21);expect(f.send).not.toHaveBeenCalled();
});
it("advances past an unrouted page without discarding its pending notices",async()=>{
 const f=await fixture(),at=new Date().toISOString();const run={...f.run,id:"unrouted",taskId:"unrouted-task",sessionId:"unrouted-session"};
 f.service.database.writeCanonicalTask(run.taskId,0,{id:run.taskId,state:"RUNNING",currentRunId:run.id},at);f.service.database.saveEntity("run",run.id,json(run));f.service.database.saveEntity("session",run.sessionId,{id:run.sessionId,profileId:"p",providerId:"codex",createdAt:at,updatedAt:at,resumable:false});f.store.initializeControl({sessionId:run.sessionId,activeRunId:run.id,exclusion:"none",at});
 for(let i=0;i<10;i++){const id=`a-unrouted-${i}`;f.service.database.saveEntity("native-control-outbox",id,controlNotice(id,{runId:run.id,sessionId:run.sessionId}),"2099-01-01T00:00:00Z");}f.service.database.saveEntity("native-control-outbox","z-routed",controlNotice("z-routed"),"2000-01-01T00:00:00Z");
 await notifyControl(f.service);expect(f.reply).not.toHaveBeenCalled();await notifyControl(f.service);expect(f.reply).toHaveBeenCalledOnce();expect(f.service.database.getEntity("native-control-outbox","z-routed")).toMatchObject({state:"sent"});for(let i=0;i<10;i++)expect(f.service.database.getEntity("native-control-outbox",`a-unrouted-${i}`)).toMatchObject({state:"pending"});expect(f.send).not.toHaveBeenCalled();
});
it("does not parse malformed or oversized notice records before selecting valid work",async()=>{
 const f=await fixture(),insert=f.service.database.handle.prepare("INSERT INTO entities(kind,id,document_json,updated_at) VALUES('native-control-outbox',?,?,?)"),at=new Date().toISOString();
 const oversized=JSON.stringify(controlNotice("b-oversized",{extra:"x".repeat(65_536)}));insert.run("a-malformed","{",at);insert.run("b-oversized",oversized,at);f.service.database.saveEntity("native-control-outbox","z-valid",controlNotice("z-valid"));
 await expect(notifyControl(f.service)).resolves.toBeUndefined();expect(f.reply).toHaveBeenCalledOnce();expect(f.service.database.getEntity("native-control-outbox","z-valid")).toMatchObject({state:"sent"});const raw=f.service.database.handle.prepare("SELECT document_json FROM entities WHERE kind='native-control-outbox' AND id=?");expect(raw.get("a-malformed")).toMatchObject({document_json:"{"});expect(raw.get("b-oversized")).toMatchObject({document_json:oversized});expect(f.send).not.toHaveBeenCalled();
});
it.each([{id:"different"},{version:2},{controlRevision:1.5}])("does not deliver unverified notice metadata %j",async changes=>{
 const f=await fixture();f.service.database.saveEntity("native-control-outbox","unverified",controlNotice("unverified",changes));f.service.database.saveEntity("native-control-outbox","z-valid",controlNotice("z-valid"));await notifyControl(f.service);
 expect(f.reply).toHaveBeenCalledOnce();expect(f.reply.mock.calls[0]?.[1]).toBe("native-control:z-valid");expect(f.service.database.getEntity("native-control-outbox","unverified")).toEqual(controlNotice("unverified",changes));expect(f.send).not.toHaveBeenCalled();
});
it.each(["state","retry"] as const)("rechecks decoded %s when duplicate JSON keys disagree with SQLite selection",async kind=>{
 const f=await fixture(),id="split-parser";
 const base=JSON.stringify(controlNotice(id,kind==="retry"?{nextAttemptAt:"2000-01-01T00:00:00Z"}:{}));
 const raw=base.slice(0,-1)+(kind==="state"?',"state":"sent"}':',"nextAttemptAt":"2100-01-01T00:00:00Z"}');
 f.service.database.handle.prepare("INSERT INTO entities(kind,id,document_json,updated_at) VALUES('native-control-outbox',?,?,?)").run(id,raw,new Date().toISOString());
 await notifyControl(f.service);expect(f.reply).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();expect(f.service.database.handle.prepare("SELECT document_json FROM entities WHERE kind='native-control-outbox' AND id=?").get(id)).toMatchObject({document_json:raw});
});

const conversationFor=(service:ControllerService,run:Run)=>(service as unknown as {runConversation:(run:Run)=>ConversationBinding|undefined}).runConversation(run);
it("finds an exact Run conversation without materializing unrelated bindings",async()=>{
 const f=await fixture();for(let i=0;i<100;i++){const conversationId=`archive-${i}`,id=`slack:${conversationId}:thread`;f.service.database.saveEntity("messaging-conversation",id,json({...f.conversation,id,conversationId,runId:`archive-run-${i}`}));}
 const list=f.service.database.listEntities.bind(f.service.database);vi.spyOn(f.service.database,"listEntities").mockImplementation(kind=>{if(kind==="messaging-conversation")throw Error("unbounded conversation materialization");return list(kind);});
 expect(conversationFor(f.service,f.run)).toEqual(f.conversation);f.service.database.saveEntity("native-control-outbox","lookup",controlNotice("lookup"));await notifyControl(f.service);expect(f.reply).toHaveBeenCalledOnce();expect(f.send).not.toHaveBeenCalled();
});
it("does not decode an unrelated malformed or oversized conversation",async()=>{
 const f=await fixture(),insert=f.service.database.handle.prepare("INSERT INTO entities(kind,id,document_json,updated_at) VALUES('messaging-conversation',?,?,?)"),at=new Date().toISOString();
 const oversized=JSON.stringify({...f.conversation,id:"slack:other:thread",conversationId:"other",runId:"other",extra:"x".repeat(65_536)});insert.run("malformed","{",at);insert.run("slack:other:thread",oversized,at);
 expect(conversationFor(f.service,f.run)).toEqual(f.conversation);f.service.database.saveEntity("native-control-outbox","lookup",controlNotice("lookup"));await notifyControl(f.service);expect(f.reply).toHaveBeenCalledOnce();expect(f.reply.mock.calls[0]?.[0]).toMatchObject({channel:"C1",threadId:"thread"});expect(f.send).not.toHaveBeenCalled();
 expect(f.service.database.handle.prepare("SELECT document_json FROM entities WHERE kind='messaging-conversation' AND id='malformed'").get()).toMatchObject({document_json:"{"});
});
it.each([{runId:"other"},{sessionId:"other"},{generation:2}])("ignores a newer conversation for a different tuple %j",async changes=>{
 const f=await fixture(),id="slack:C2:other";f.service.database.saveEntity("messaging-conversation",id,json({...f.conversation,id,conversationId:"C2",threadId:"other",...changes}),"2099-01-01T00:00:00Z");expect(conversationFor(f.service,f.run)).toEqual(f.conversation);
});
it("preserves the most recently updated exact binding and optional legacy epoch",async()=>{
 const f=await fixture(false),id="slack:C2:latest",latest={...f.conversation,id,conversationId:"C2",threadId:"latest",state:"WAITING_USER" as const,updatedAt:"2099-01-01T00:00:00Z"};f.service.database.saveEntity("messaging-conversation",id,json(latest),latest.updatedAt);
 expect(conversationFor(f.service,f.run)).toEqual(latest);expect(conversationFor(f.service,f.run)?.controlEpoch).toBeUndefined();
});
it.each([{id:"different-record"},{taskId:"other-task"},{revision:1.5}])("does not fall back from a selected unverified exact binding %j",async changes=>{
 const f=await fixture(),id="slack:C2:unverified";const raw=json({...f.conversation,id,conversationId:"C2",threadId:"unverified",...changes});f.service.database.saveEntity("messaging-conversation",id,raw,"2099-01-01T00:00:00Z");
 expect(()=>conversationFor(f.service,f.run)).toThrow(ConnectorError);f.service.database.saveEntity("native-control-outbox","lookup",controlNotice("lookup"));await notifyControl(f.service);expect(f.reply).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();expect(f.service.database.getEntity("messaging-conversation",id)).toEqual(raw);
});
it.each([['runId','other',false],['sessionId','other',false],['generation',2,false],['runId','other',true],['sessionId','other',true],['generation',2,true]] as const)("rejects duplicate %s after SQLite lookup (reverse=%s)",async(field,value,reverse)=>{
 const f=await fixture(),id="slack:C2:duplicate";const base=JSON.stringify({...f.conversation,id,conversationId:"C2",threadId:"duplicate",...(reverse?{[field]:value}:{})});const raw=base.slice(0,-1)+`,"${field}":${JSON.stringify(reverse?f.conversation[field]:value)}}`;
 f.service.database.handle.prepare("INSERT INTO entities(kind,id,document_json,updated_at) VALUES('messaging-conversation',?,?,?)").run(id,raw,"2099-01-01T00:00:00Z");
 expect(()=>conversationFor(f.service,f.run)).toThrow(ConnectorError);f.service.database.saveEntity("native-control-outbox","lookup",controlNotice("lookup"));await notifyControl(f.service);expect(f.reply).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();expect(f.service.database.handle.prepare("SELECT document_json FROM entities WHERE kind='messaging-conversation' AND id=?").get(id)).toMatchObject({document_json:raw});
});
it.each([['runId','other'],['sessionId','other'],['generation',2]] as const)("rejects reverse duplicate %s before HTTP legacy input",async(field,value)=>{
 const f=await fixture(false),run={...f.run,state:"WAITING_USER" as const};f.service.database.saveEntity("run",run.id,json(run));f.service.database.writeCanonicalTask("task",1,{id:"task",projectId:"project",state:"WAITING_USER",currentRunId:run.id},new Date().toISOString());
 const base=JSON.stringify({...f.conversation,state:"CLOSED",[field]:value}),raw=base.slice(0,-1)+`,"${field}":${JSON.stringify(f.conversation[field])}}`;
 f.service.database.handle.prepare("UPDATE entities SET document_json=? WHERE kind='messaging-conversation' AND id=?").run(raw,f.conversation.id);
 const response=await f.service.app.inject({method:"POST",url:"/api/agents/profiles/p/sessions/session/input",headers:{authorization:"Bearer fixture"},payload:{message:"continue",authority:{runId:run.id,generation:run.generation,leaseId:run.leaseId,taskRevision:2}}});
 expect(response.statusCode).toBe(409);expect(response.json().code).toBe("CONFLICT");expect(f.send).not.toHaveBeenCalled();expect(f.reply).not.toHaveBeenCalled();expect(f.messagingSend).not.toHaveBeenCalled();expect(f.service.database.getEntity("run",run.id)).toMatchObject({state:"WAITING_USER"});expect(f.service.database.handle.prepare("SELECT document_json FROM entities WHERE kind='messaging-conversation' AND id=?").get(f.conversation.id)).toMatchObject({document_json:raw});
});

it.each(["attention","delivery"] as const)("rejects selected-invalid routing before a default-channel %s send",async kind=>{
 const f=await fixture(false);const run={...f.run,state:kind==="attention"?"WAITING_USER" as const:"COMPLETE" as const,activitySummary:"private-run-body"};f.service.database.saveEntity("run",run.id,json(run));
 (f.service as unknown as {messagingChannels:Map<string,string>}).messagingChannels.set("slack","default-public-channel");
 const id="slack:C2:unverified",raw=json({...f.conversation,id:"different-record",conversationId:"C2",threadId:"unverified"});f.service.database.saveEntity("messaging-conversation",id,raw,"2099-01-01T00:00:00Z");
 if(kind==="attention")await expect((f.service as unknown as {notifyAttention:(run:Run)=>Promise<void>}).notifyAttention(run)).rejects.toMatchObject({code:"CONFLICT"});
 else {f.service.database.saveEntity("delivery-feedback","feedback",{version:1,id:"feedback",runId:run.id,generation:run.generation,body:"private-run-body",severity:"info",status:"PENDING",failures:0,nextAttemptAt:"2000-01-01T00:00:00Z"});await (f.service as unknown as {notifyDeliveryFeedback:()=>Promise<void>}).notifyDeliveryFeedback();expect(f.service.database.getEntity("delivery-feedback","feedback")).toMatchObject({status:"OBSOLETE"});}
 expect(f.messagingSend).not.toHaveBeenCalled();expect(f.reply).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();expect(f.service.database.getEntity("messaging-conversation",id)).toEqual(raw);expect(f.service.database.getEntity("messaging-conversation",f.conversation.id)).toEqual(f.conversation);
});
it.each(["attention","delivery"] as const)("preserves a truly missing binding's default-channel %s notification",async kind=>{
 const f=await fixture(false),run={...f.run,state:kind==="attention"?"WAITING_USER" as const:"COMPLETE" as const,activitySummary:"run-body"};f.service.database.saveEntity("run",run.id,json(run));f.service.database.handle.prepare("DELETE FROM entities WHERE kind='messaging-conversation'").run();
 (f.service as unknown as {messagingChannels:Map<string,string>}).messagingChannels.set("slack","default-public-channel");
 if(kind==="attention")await (f.service as unknown as {notifyAttention:(run:Run)=>Promise<void>}).notifyAttention(run);
 else {f.service.database.saveEntity("delivery-feedback","feedback",{version:1,id:"feedback",runId:run.id,generation:run.generation,body:"run-body",severity:"info",status:"PENDING",failures:0,nextAttemptAt:"2000-01-01T00:00:00Z"});await (f.service as unknown as {notifyDeliveryFeedback:()=>Promise<void>}).notifyDeliveryFeedback();expect(f.service.database.getEntity("delivery-feedback","feedback")).toMatchObject({status:"SENT"});}
 expect(f.messagingSend).toHaveBeenCalledOnce();expect(f.messagingSend.mock.calls[0]?.[0]).toMatchObject({channel:"default-public-channel",body:"run-body"});expect(f.reply).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();
});
it.each(["valid-closed","invalid-closed","oversized-closed","malformed","missing"] as const)("keeps HTTP input conversation authority distinct from missing: %s",async kind=>{
 const f=await fixture(false),run={...f.run,state:"WAITING_USER" as const};f.service.database.saveEntity("run",run.id,json(run));f.service.database.writeCanonicalTask("task",1,{id:"task",projectId:"project",state:"WAITING_USER",currentRunId:run.id},new Date().toISOString());
 if(kind==="missing")f.service.database.handle.prepare("DELETE FROM entities WHERE kind='messaging-conversation'").run();
 else if(kind==="malformed")f.service.database.handle.prepare("UPDATE entities SET document_json='{' WHERE kind='messaging-conversation' AND id=?").run(f.conversation.id);
 else f.service.database.saveEntity("messaging-conversation",f.conversation.id,json({...f.conversation,state:"CLOSED",...(kind==="invalid-closed"?{id:"different-record"}:{}),...(kind==="oversized-closed"?{extra:"x".repeat(65_536)}:{})}));
 const response=await f.service.app.inject({method:"POST",url:"/api/agents/profiles/p/sessions/session/input",headers:{authorization:"Bearer fixture"},payload:{message:"continue",authority:{runId:run.id,generation:run.generation,leaseId:run.leaseId,taskRevision:2}}});
 expect(response.statusCode).toBe(kind==="missing"?200:409);if(kind!=="missing"){expect(response.json().code).toBe("CONFLICT");expect(f.send).not.toHaveBeenCalled();expect(f.service.database.getEntity("run",run.id)).toMatchObject({state:"WAITING_USER"});}else expect(f.send).toHaveBeenCalledExactlyOnceWith("session","continue");expect(f.reply).not.toHaveBeenCalled();expect(f.messagingSend).not.toHaveBeenCalled();
});
it.each(["invalid","missing"] as const)("does not replace unverified dispatch conversation with default state: %s",async kind=>{
 const f=await fixture(false);f.service.database.saveEntity("messaging-workflow-origin","dispatch",{connectorInstanceId:"slack",conversationId:"C1",threadId:"thread"});
 if(kind==="missing")f.service.database.handle.prepare("DELETE FROM entities WHERE kind='messaging-conversation'").run();
 else f.service.database.saveEntity("messaging-conversation",f.conversation.id,json({...f.conversation,id:"different-record"}));
 const at=new Date().toISOString(),workflow:SemanticWorkflowRecord={id:"dispatch",revision:1,intent:{version:2,action:"task.dispatch",entities:[],arguments:{},confidence:1,source:"fixed-command"},state:"EXECUTED",principal:{id:"owner",roles:["operator","admin"],channel:"messaging"},toolName:"task.dispatch",resolvedEntities:[],questions:[],result:{run:f.run},createdAt:at,updatedAt:at};
 const execute=()=>(f.service as unknown as {executeMessagingWorkflow:(workflow:SemanticWorkflowRecord)=>Promise<SemanticWorkflowRecord>}).executeMessagingWorkflow(workflow);
 if(kind==="invalid"){await expect(execute()).rejects.toMatchObject({code:"CONFLICT"});expect(f.service.database.getEntity("messaging-conversation",f.conversation.id)).toMatchObject({id:"different-record"});}else {await expect(execute()).resolves.toEqual(workflow);expect(f.service.database.getEntity("messaging-conversation",f.conversation.id)).toMatchObject({id:f.conversation.id,state:"ACTIVE"});}
 expect(f.send).not.toHaveBeenCalled();expect(f.reply).not.toHaveBeenCalled();expect(f.messagingSend).not.toHaveBeenCalled();
});
it("continues a control notice batch past an unverified binding while retaining it",async()=>{
 const f=await fixture(),at=new Date().toISOString(),run={...f.run,id:"other-run",taskId:"other-task",sessionId:"other-session"};
 f.service.database.writeCanonicalTask(run.taskId,0,{id:run.taskId,state:"RUNNING",currentRunId:run.id},at);f.service.database.saveEntity("run",run.id,json(run));f.service.database.saveEntity("session",run.sessionId,{id:run.sessionId,profileId:"p",providerId:"codex",createdAt:at,updatedAt:at,resumable:false});f.store.initializeControl({sessionId:run.sessionId,activeRunId:run.id,exclusion:"none",at});
 f.service.conversations.bind({connectorInstanceId:"slack",conversationId:"C2",threadId:"other",taskId:run.taskId,runId:run.id,sessionId:run.sessionId,generation:run.generation,controlEpoch:1,state:"ACTIVE"});
 f.service.database.saveEntity("messaging-conversation",f.conversation.id,json({...f.conversation,id:"different-record"}));f.service.database.saveEntity("native-control-outbox","a-invalid",controlNotice("a-invalid"));f.service.database.saveEntity("native-control-outbox","z-valid",controlNotice("z-valid",{runId:run.id,sessionId:run.sessionId}));
 await notifyControl(f.service);expect(f.reply).toHaveBeenCalledOnce();expect(f.reply.mock.calls[0]?.[0]).toMatchObject({channel:"C2",threadId:"other"});expect(f.service.database.getEntity("native-control-outbox","a-invalid")).toMatchObject({state:"pending"});expect(f.service.database.getEntity("native-control-outbox","z-valid")).toMatchObject({state:"sent"});expect(f.send).not.toHaveBeenCalled();expect(f.messagingSend).not.toHaveBeenCalled();
});

it("chooses the descending id when exact bindings share updated_at",async()=>{
 const f=await fixture(),at="2099-01-01T00:00:00Z";
 for(const channel of ["C2","C3"]){const id=`slack:${channel}:t`;f.service.database.saveEntity("messaging-conversation",id,json({...f.conversation,id,conversationId:channel,threadId:"t",updatedAt:at}),at);}
 expect(conversationFor(f.service,f.run)?.conversationId).toBe("C3");
});
it("honors retryAfter at 4000ms and performs no native action",async()=>{
 const f=await fixture();f.service.database.saveEntity("native-control-outbox","retry",controlNotice("retry"));
 f.reply.mockRejectedValueOnce(new ConnectorError("RATE_LIMITED","429",{retryable:true,retryAfterMs:4000}));
 await notifyControl(f.service);expect(f.service.database.getEntity("native-control-outbox","retry")).toMatchObject({state:"pending",failures:1,nextAttemptAt:new Date(Date.parse(f.run.startedAt!)+4000).toISOString()});
 f.advance(3999);await notifyControl(f.service);expect(f.reply).toHaveBeenCalledTimes(1);
 f.advance(2);await notifyControl(f.service);expect(f.reply).toHaveBeenCalledTimes(2);expect(f.service.database.getEntity("native-control-outbox","retry")).toMatchObject({state:"sent",failures:1});
 expect(f.reply.mock.calls.map(([,key])=>key)).toEqual(["native-control:retry","native-control:retry"]);expect(f.send).not.toHaveBeenCalled();expect(f.service.database.listEntities("native-handoff")).toHaveLength(0);
});
it.each(["permanent","fifth"] as const)("stops notice retries on %s failure",async kind=>{
 const f=await fixture();f.service.database.saveEntity("native-control-outbox","failure",controlNotice("failure",kind==="fifth"?{failures:4}:{}));
 f.reply.mockRejectedValue(new ConnectorError("TEMPORARY","failure",{retryable:kind==="fifth"}));
 await notifyControl(f.service);expect(f.service.database.getEntity("native-control-outbox","failure")).toMatchObject({state:"failed",failures:kind==="fifth"?5:1,nextAttemptAt:new Date(Date.parse(f.run.startedAt!)+(kind==="fifth"?16000:1000)).toISOString()});f.advance(300001);await notifyControl(f.service);expect(f.reply).toHaveBeenCalledOnce();expect(f.send).not.toHaveBeenCalled();
});
it.each(["generation","session","lease","expired","task","control","connector","thread","newer-epoch","waiting"] as const)("rechecks actual authority and latest route after held reply: %s",async change=>{
 const f=await fixture();f.service.database.saveEntity("native-control-outbox","held",controlNotice("held"));
 let release!:()=>void;f.reply.mockImplementationOnce(()=>new Promise(resolve=>{release=()=>resolve({externalMessageId:"held"});}));
 const pending=notifyControl(f.service);expect(f.reply).toHaveBeenCalledOnce();
 if(change==="generation"||change==="session"||change==="lease"||change==="expired")f.service.database.handle.prepare("UPDATE entities SET document_json=? WHERE kind='run' AND id=?").run(JSON.stringify({...f.run,...(change==="generation"?{generation:2}:change==="session"?{sessionId:"other"}:change==="lease"?{leaseId:"new-lease"}:{leaseExpiresAt:"2000-01-01T00:00:00Z"})}),f.run.id);
 else if(change==="task")f.service.database.writeCanonicalTask("task",1,{id:"task",state:"RUNNING",currentRunId:"other"},new Date().toISOString());
 else if(change==="control")f.store.compareAndSwapControl({sessionId:"session",expectedRevision:1,expectedEpoch:1,actorId:"owner",event:{type:"request-handoff",principalId:"owner",at:new Date().toISOString()}});
 else if(change==="connector"){const original=f.service.connectors.get<MessagingAdapter>("slack")!;f.service.connectors.clear();f.service.connectors.register({...original,reply:vi.fn(async()=>({externalMessageId:"replacement"}))});}
 else if(change==="thread"){const id="slack:C2:new";f.service.database.saveEntity("messaging-conversation",id,json({...f.conversation,id,conversationId:"C2",threadId:"new"}),"2099-01-01T00:00:00Z");}
 else f.service.conversations.bind({...f.conversation,...(change==="waiting"?{state:"WAITING_USER" as const}:{controlEpoch:2})});
 release();await pending;
 const notice=f.service.database.getEntity("native-control-outbox","held");
 if(change==="waiting"){expect(notice).toMatchObject({state:"sent"});expect(conversationFor(f.service,f.run)).toMatchObject({state:"WAITING_USER",controlEpoch:1});}
 else if(["connector","thread","newer-epoch"].includes(change)){expect(notice).toMatchObject({state:"failed",failures:1});}
 else expect(notice).toMatchObject({state:"obsolete"});
 if(change==="newer-epoch")expect(conversationFor(f.service,f.run)?.controlEpoch).toBe(2);
 if(change!=="waiting"&&change!=="newer-epoch")expect(f.service.database.getEntity("messaging-conversation",f.conversation.id)).toEqual(f.conversation);
 expect(f.send).not.toHaveBeenCalled();expect(f.messagingSend).not.toHaveBeenCalled();expect(f.service.database.listEntities("native-handoff")).toHaveLength(0);
});
it("composes control notices into the existing attention cycle",async()=>{
 const f=await fixture();f.service.database.saveEntity("native-control-outbox","background",controlNotice("background"));
 await (f.service as unknown as {notifyDueAttention:()=>Promise<void>}).notifyDueAttention();
 expect(f.reply).toHaveBeenCalledOnce();expect(f.service.database.getEntity("native-control-outbox","background")).toMatchObject({state:"sent"});expect(f.send).not.toHaveBeenCalled();
});
it.each(["before","after"] as const)("refuses SQL control-row disagreement %s reply",async timing=>{
 const f=await fixture();f.service.database.saveEntity("native-control-outbox","row-drift",controlNotice("row-drift"));
 const revoke=()=>f.service.database.handle.prepare("UPDATE session_controls SET state='HUMAN',epoch=2,revision=2,active_run_id='other' WHERE session_id='session'").run();
 if(timing==="before")revoke();
 let release!:()=>void;if(timing==="after")f.reply.mockImplementationOnce(()=>new Promise(resolve=>{release=()=>resolve({externalMessageId:"held"});}));
 const pending=notifyControl(f.service);if(timing==="after"){expect(f.reply).toHaveBeenCalledOnce();revoke();release();}await pending;
 expect(f.service.database.getEntity("native-control-outbox","row-drift")).toMatchObject({state:"obsolete"});expect(f.reply).toHaveBeenCalledTimes(timing==="before"?0:1);expect(f.service.database.getEntity("messaging-conversation",f.conversation.id)).toEqual(f.conversation);expect(f.send).not.toHaveBeenCalled();
});
it("executes the real input authority callback before the fake provider action",async()=>{
 const f=await fixture(false),run={...f.run,state:"WAITING_USER" as const};f.service.database.saveEntity("run",run.id,json(run));f.service.database.writeCanonicalTask("task",1,{id:"task",state:"WAITING_USER",currentRunId:run.id},new Date().toISOString());
 f.service.database.handle.prepare("DELETE FROM entities WHERE kind='messaging-conversation'").run();
 f.admission.before=()=>{f.service.database.writeCanonicalTask("task",2,{id:"task",state:"WAITING_USER",currentRunId:"replacement"},new Date().toISOString());};
 const response=await f.service.app.inject({method:"POST",url:"/api/agents/profiles/p/sessions/session/input",headers:{authorization:"Bearer fixture"},payload:{message:"continue",authority:{runId:run.id,generation:run.generation,leaseId:run.leaseId,taskRevision:2}}});
 expect(response.statusCode).toBe(409);expect(f.adapterCalls).toHaveLength(1);expect(f.admissionCalls).toMatchObject([{sessionId:"session",state:"denied"}]);expect(f.send).not.toHaveBeenCalled();expect(f.service.database.getEntity("run",run.id)).toMatchObject({state:"WAITING_USER"});
});
it.each(["generation","lease","task","control"] as const)("rechecks %s changed during exact routing before reply",async change=>{
 const f=await fixture();f.service.database.saveEntity("native-control-outbox","pre-send",controlNotice("pre-send"));
 const access=f.service as unknown as {runConversation:(run:Run)=>ConversationBinding|undefined};const actual=access.runConversation.bind(access);
 vi.spyOn(access,"runConversation").mockImplementationOnce(run=>{const binding=actual(run);
  if(change==="generation"||change==="lease")f.service.database.handle.prepare("UPDATE entities SET document_json=? WHERE kind='run' AND id=?").run(JSON.stringify({...f.run,...(change==="generation"?{generation:2}:{leaseId:"replacement"})}),f.run.id);
  else if(change==="task")f.service.database.writeCanonicalTask("task",1,{id:"task",state:"RUNNING",currentRunId:"replacement"},new Date().toISOString());
  else f.store.compareAndSwapControl({sessionId:"session",expectedRevision:1,expectedEpoch:1,actorId:"owner",event:{type:"request-handoff",principalId:"owner",at:new Date().toISOString()}});
  return binding;
 });
 await notifyControl(f.service);expect(f.reply).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();expect(f.service.database.getEntity("native-control-outbox","pre-send")).toMatchObject({state:"obsolete"});expect(f.service.database.getEntity("messaging-conversation",f.conversation.id)).toEqual(f.conversation);
});
it("rechecks an actual connector replacement before reply",async()=>{
 const f=await fixture();f.service.database.saveEntity("native-control-outbox","pre-connector",controlNotice("pre-connector"));
 const original=f.service.connectors.get<MessagingAdapter>("slack")!,get=f.service.connectors.get.bind(f.service.connectors),replacement={...original,reply:vi.fn(async()=>({externalMessageId:"replacement"}))};
 vi.spyOn(f.service.connectors,"get").mockImplementationOnce(id=>{const selected=get(id);f.service.connectors.clear();f.service.connectors.register(replacement);return selected;});
 await notifyControl(f.service);expect(f.reply).not.toHaveBeenCalled();expect(replacement.reply).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();expect(f.service.database.getEntity("native-control-outbox","pre-connector")).toMatchObject({state:"failed",failures:1});
});
it("pins the delivered epoch while preserving a newer WAITING_USER binding",async()=>{
 const f=await fixture();f.store.compareAndSwapControl({sessionId:"session",expectedRevision:1,expectedEpoch:1,actorId:"owner",event:{type:"request-handoff",principalId:"owner",at:new Date().toISOString()}});
 f.service.database.saveEntity("native-control-outbox","epoch-two",controlNotice("epoch-two",{controlEpoch:2,controlRevision:2,controlState:"HANDOFF_REQUESTED"}));
 let release!:()=>void;f.reply.mockImplementationOnce(()=>new Promise(resolve=>{release=()=>resolve({externalMessageId:"held"});}));
 const pending=notifyControl(f.service);expect(f.service.database.getEntity("messaging-conversation",f.conversation.id)).toEqual(f.conversation);expect(f.service.database.getEntity("native-control-outbox","epoch-two")).toMatchObject({state:"pending"});
 f.service.conversations.bind({...f.conversation,state:"WAITING_USER"});release();await pending;
 expect(conversationFor(f.service,f.run)).toMatchObject({state:"WAITING_USER",controlEpoch:2});expect(f.service.database.getEntity("native-control-outbox","epoch-two")).toMatchObject({state:"sent"});expect(f.reply.mock.calls[0]?.[0].text).toContain("尚未确认交接完成");expect(f.send).not.toHaveBeenCalled();expect(f.service.database.listEntities("native-handoff")).toHaveLength(0);
});
