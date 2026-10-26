import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentAdapter } from "@dispatcher/adapters";
import type { HistoryPage, InteractionCapabilities, NativeBinding, Run } from "@dispatcher/domain";
import { InteractionStore, type JsonValue } from "@dispatcher/persistence";
import { ControllerService } from "../src/service.js";

const at="2026-10-07T21:00:00Z",headers={authorization:"Bearer fixture-owner"};
const binding:NativeBinding={version:1,product:"codex",region:"global",profileId:"profile",backendId:"native",runnerId:"local",nativeStoreRef:"account-store",nativeSessionId:"provider-native-id",executionRefId:"execution",identityState:"bound"};
const run:Run={id:"dispatcher-run-id",taskId:"task",sessionId:"session",profileId:"profile",providerId:"codex",runnerId:"local",state:"ACTIVE",generation:1,attempt:1,leaseId:"lease",taskRevision:1,contractRevision:1,startedAt:at,executionSelection:{version:1,profileId:"profile",runnerId:"local",providerId:"codex",backendId:"native",mode:"manual",source:"explicit",selectionType:"explicit-model",requestedModel:"fixture-model",contextFingerprint:"context",configRevision:1,selectedAt:at},worktree:"/workspace",executionRef:{version:1,id:"execution",kind:"managed-worktree",runnerId:"local",repositoryId:"repo",workspaceId:"workspace",pathRef:"workspace:workspace",branch:"task/run",baseRevision:"sha"}};
const json=(v:unknown):JsonValue=>JSON.parse(JSON.stringify(v)) as JsonValue;
function capabilities():InteractionCapabilities {
 const unknown={version:1,support:"unknown",level:"documented",scopeFingerprint:"scope"} as const;
 return {version:1,durableIdentity:unknown,historyRead:{...unknown,support:"supported",level:"runtime-verified",verifiedAt:at,evidenceRef:"fixture"},sameSessionContinue:unknown,liveSteer:unknown,interruptTurn:unknown,nativeApproval:unknown,observeExternalChanges:unknown,releaseControl:unknown,reclaimControl:unknown,restartReattach:unknown,surfaces:{web:{...unknown,support:"supported"}}};
}
afterEach(()=>vi.restoreAllMocks());
async function fixture(bound=true){
 const root=mkdtempSync(join(tmpdir(),"native-session-view-"));const service=new ControllerService({dataDirectory:root,ownerToken:"fixture-owner",clock:()=>new Date(at),backgroundWorker:{enabled:false}});
 const evidence=process.env.DISPATCHER_NATIVE_CONTROL_SNAPSHOT_FIXTURE_EVIDENCE;
 const capture=evidence?join(evidence,randomUUID()):undefined;
 if(capture){mkdirSync(capture,{recursive:true});let sequence=0;service.app.addHook("onSend",async(request,reply,payload)=>{const index=++sequence;if(typeof payload==="string"||Buffer.isBuffer(payload))writeFileSync(join(capture,`response-${index}.body`),payload);writeFileSync(join(capture,`response-${index}.json`),JSON.stringify({testName:expect.getState().currentTestName,method:request.method,url:request.url,status:reply.statusCode,body:typeof payload==="string"?payload:null},null,2));return payload;});}
 await service.start({listen:false});const db=service.database;
 db.writeCanonicalTask("task",0,{id:"task",projectId:"project",state:"RUNNING",currentRunId:run.id},at);db.saveEntity("run",run.id,json(run));db.saveEntity("run-contract",run.id,{workspace:{repositoryId:"repo",baseCommit:"sha"}});const store=new InteractionStore(db);
 if(bound){db.saveEntity("session","session",{id:"session",profileId:"profile",providerId:"codex",createdAt:at,updatedAt:at,resumable:true});db.saveEntity("adapter-session","session",{id:"session",runId:run.id,profileId:"profile",backendId:"native",workspacePath:"/workspace",state:"RUNNING",createdAt:at,updatedAt:at});store.bindNative({sessionId:"session",runId:run.id,binding,expectedGeneration:1,expectedLeaseId:"lease"});store.initializeControl({sessionId:"session",activeRunId:run.id,exclusion:"cooperative",at});}
 return {service,db,store,close:async()=>{
 if(capture){
 const tables=(db.handle.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{name:string}>).map(row=>row.name);
 const points=Object.fromEntries(tables.map(table=>[table,db.handle.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)?db.handle.prepare(`SELECT * FROM "${table.replaceAll('"','""')}"`).all():null]));
 const files=readdirSync(root,{recursive:true}).map(name=>join(root,String(name))).filter(path=>statSync(path).isFile()).map(path=>{const stat=statSync(path);return {path,size:stat.size,dev:stat.dev,ino:stat.ino,mtimeMs:stat.mtimeMs};});
 writeFileSync(join(capture,"before-cleanup.json"),JSON.stringify({testName:expect.getState().currentTestName,root,at:new Date().toISOString(),pointReads:points,totalChanges:db.handle.prepare("SELECT total_changes() AS count").get(),files},null,2));
 }
 await service.stop();rmSync(root,{recursive:true,force:true});}};
}
it("keeps legacy Run details readable without inventing a native identity",async()=>{const f=await fixture(false);try{const response=await f.service.app.inject({url:`/api/runs/${run.id}`,headers});expect(response.statusCode).toBe(200);expect(response.json()).toMatchObject({run:{id:run.id},nativeSession:{version:1,runId:run.id,identity:"legacy",binding:null,state:"unknown",freshness:"unknown",completeness:"unknown"}});}finally{await f.close();}});
it.each(["missing-profile","retained-owner"])("preserves legacy Run details when %s prevents native summary authorization",async(reason)=>{const f=await fixture(false);try{f.db.saveEntity("session","session",{id:"session",profileId:"profile",providerId:"codex",createdAt:at,updatedAt:at,resumable:true});f.db.saveEntity("adapter-session","session",{id:"session",runId:reason==="retained-owner"?"new-run":run.id,...(reason==="retained-owner"?{profileId:"profile"}:{}),workspacePath:"/workspace",state:"RUNNING",createdAt:at,updatedAt:at});const response=await f.service.app.inject({url:`/api/runs/${run.id}`,headers});expect(response.statusCode).toBe(200);expect(response.json()).toMatchObject({run:{id:run.id},nativeSession:null,nativeSessionError:{code:"NATIVE_SUMMARY_UNAVAILABLE",status:409}});}finally{await f.close();}});
it("does not verify a capability whose declared callable is absent",async()=>{const f=await fixture();try{const registry=(f.service as unknown as {agentAdapters:Map<string,AgentAdapter>}).agentAdapters;vi.spyOn(registry,"get").mockReturnValue({interaction:{capabilities,access:vi.fn()}} as unknown as AgentAdapter);f.store.saveObservation({sessionId:"session",observerGeneration:1,observerSequence:1,controlEpoch:1,observation:{version:1,id:"observation",nativeSessionId:binding.nativeSessionId,scopeFingerprint:"scope",observedAt:at,state:"idle",pendingTools:"none",pendingApprovals:"none",historyMode:"native-revision"}});const view=(await f.service.app.inject({url:`/api/runs/${run.id}`,headers})).json().nativeSession;expect(view.capabilities).toContainEqual({name:"historyRead",support:"unknown"});}finally{await f.close();}});
it("projects only canonical metadata without native I/O or any SQL mutation",async()=>{const f=await fixture();try{f.store.saveObservation({sessionId:"session",observerGeneration:1,observerSequence:1,controlEpoch:1,observation:{version:1,id:"observation",nativeSessionId:binding.nativeSessionId,scopeFingerprint:"scope",observedAt:at,state:"idle",pendingTools:"none",pendingApprovals:"none",historyMode:"native-revision"}});const before=f.db.handle.prepare("SELECT total_changes() AS count").get();const view=(await f.service.app.inject({url:`/api/runs/${run.id}`,headers})).json().nativeSession;expect(view).toMatchObject({identity:"bound",binding:{nativeSessionId:binding.nativeSessionId},control:{state:"AUTOMATED"},state:"idle",freshness:"fresh",completeness:"unknown",execution:{kind:"managed-worktree",runnerId:"local",worktree:"/workspace"}});expect(view.binding).not.toHaveProperty("nativeStoreRef");expect(view.binding.nativeSessionId).not.toBe(run.id);expect(f.db.handle.prepare("SELECT total_changes() AS count").get()).toEqual(before);}finally{await f.close();}});
it.each(["unknown","deleted","unreachable"] as const)("keeps native %s explicit even with a terminal business Run",async(state)=>{const f=await fixture();try{f.store.saveObservation({sessionId:"session",observerGeneration:1,observerSequence:1,controlEpoch:1,observation:{version:1,id:"observation",nativeSessionId:binding.nativeSessionId,scopeFingerprint:"scope",observedAt:at,state,pendingTools:"unknown",pendingApprovals:"unknown",historyMode:"unknown"}});f.db.saveEntity("run",run.id,json({...f.db.getEntity<JsonValue>("run",run.id) as unknown as Run,state:"COMPLETE"}));expect((await f.service.app.inject({url:`/api/runs/${run.id}`,headers})).json().nativeSession).toMatchObject({state,completeness:"unknown"});}finally{await f.close();}});
it("marks retained observation stale and refuses authenticated scope drift",async()=>{const f=await fixture();try{f.store.saveObservation({sessionId:"session",observerGeneration:1,observerSequence:1,controlEpoch:1,observation:{version:1,id:"observation",nativeSessionId:binding.nativeSessionId,scopeFingerprint:"scope",observedAt:"2026-10-07T20:00:00Z",state:"idle",pendingTools:"none",pendingApprovals:"none",historyMode:"native-revision"}});expect((await f.service.app.inject({url:`/api/runs/${run.id}`,headers})).json().nativeSession).toMatchObject({freshness:"stale",state:"unknown"});const current=f.db.getEntity<JsonValue>("session","session") as Record<string,JsonValue>;expect(()=>f.db.saveEntity("session","session",{...current,profileId:"foreign"})).toThrow("NATIVE_IDENTITY_CHANGED");/* Deliberate persisted corruption tests the read guard as well as the normal write guard. */f.db.handle.prepare("UPDATE entities SET document_json=? WHERE kind=? AND id=?").run(JSON.stringify({...current,profileId:"foreign"}),"session","session");const denied=await f.service.app.inject({url:`/api/runs/${run.id}`,headers});expect(denied.statusCode).toBe(200);expect(denied.json()).toMatchObject({run:{id:run.id},nativeSession:null,nativeSessionError:{status:409}});expect(denied.json().nativeSession).toBeNull();}finally{await f.close();}});
it("requires authentication before returning any native summary or mutation",async()=>{const f=await fixture();try{for(const request of [{url:`/api/runs/${run.id}`},{url:`/api/runs/${run.id}/interrupt`,method:"POST" as const,payload:{}}]){const response=await f.service.app.inject(request);expect(response.statusCode).toBe(401);expect(response.body).not.toContain(binding.nativeSessionId);}}finally{await f.close();}});
it("qualified capability metadata never causes inspect, history, result or access I/O",async()=>{const f=await fixture();try{const history=vi.fn(),inspect=vi.fn(),access=vi.fn(),result=vi.fn();const registry=(f.service as unknown as {agentAdapters:Map<string,AgentAdapter>}).agentAdapters;vi.spyOn(registry,"get").mockReturnValue({interaction:{capabilities,history,inspect,access},result} as unknown as AgentAdapter);f.store.saveObservation({sessionId:"session",observerGeneration:1,observerSequence:1,controlEpoch:1,observation:{version:1,id:"observation",nativeSessionId:binding.nativeSessionId,scopeFingerprint:"scope",observedAt:at,state:"idle",pendingTools:"none",pendingApprovals:"none",historyMode:"native-revision"}});const view=(await f.service.app.inject({url:`/api/runs/${run.id}`,headers})).json().nativeSession;expect(view.capabilities).toContainEqual({name:"historyRead",support:"supported",level:"runtime-verified"});expect(view.access).toContainEqual({surface:"web",availability:"unverified"});for(const method of [history,inspect,access,result])expect(method).not.toHaveBeenCalled();}finally{await f.close();}});
it("serves one bounded readonly native history page through the selected adapter",async()=>{const f=await fixture();try{const page:HistoryPage={version:1,nativeSessionId:binding.nativeSessionId,entries:[{id:"entry",kind:"user",text:"hello"}],state:"available",source:"codex",completeness:"partial",range:"native-history",nextCursor:"next"};const history=vi.fn(async()=>page),send=vi.fn();const interaction={version:1,capabilities,history,access:vi.fn(),readHandle:()=>({binding,scopeFingerprint:"scope"})};(f.service as unknown as {agentAdapters:Map<string,AgentAdapter>}).agentAdapters.set("profile",{interaction,send} as unknown as AgentAdapter);const before=f.db.handle.prepare("SELECT total_changes() AS count").get();const response=await f.service.app.inject({url:`/api/runs/${run.id}/history?cursor=prior&limit=200`,headers});expect(response.statusCode).toBe(200);expect(response.json()).toMatchObject({source:"native",page:{entries:page.entries,nextCursor:"next"}});expect(history).toHaveBeenCalledWith(binding,{cursor:"prior",limit:100},expect.objectContaining({requestId:expect.any(String),observerEpoch:expect.any(String),sequence:1,signal:expect.any(AbortSignal)}));expect(send).not.toHaveBeenCalled();expect(f.db.handle.prepare("SELECT total_changes() AS count").get()).toEqual(before);}finally{await f.close();}});
it("rejects invalid history queries and unauthenticated reads before any native access",async()=>{const f=await fixture();try{const history=vi.fn();(f.service as unknown as {agentAdapters:Map<string,AgentAdapter>}).agentAdapters.set("profile",{interaction:{version:1,capabilities,history,access:vi.fn(),readHandle:()=>({binding,scopeFingerprint:"scope"})}} as unknown as AgentAdapter);for(const query of ["limit=0","limit=1.2","limit=1&limit=2","unknown=value"]){const response=await f.service.app.inject({url:`/api/runs/${run.id}/history?${query}`,headers});expect(response.statusCode).toBe(400);}const denied=await f.service.app.inject({url:`/api/runs/${run.id}/history`});expect(denied.statusCode).toBe(401);expect(denied.body).not.toContain(binding.nativeSessionId);expect(history).not.toHaveBeenCalled();}finally{await f.close();}});
it("never serves a newer Run's transcript through a retained old Run sharing its Session",async()=>{const f=await fixture(false);try{const history=vi.fn(async()=>({version:1,nativeSessionId:binding.nativeSessionId,entries:[{id:"new",kind:"user",text:"new owner transcript"}],state:"available",source:"codex",completeness:"complete",range:"native-history"}));(f.service as unknown as {agentAdapters:Map<string,AgentAdapter>}).agentAdapters.set("profile",{interaction:{capabilities,history,access:vi.fn(),readHandle:()=>({binding,scopeFingerprint:"scope"})}} as unknown as AgentAdapter);
 // A legacy retained Run predates the native ownership binding of the newer Run.
 f.db.saveEntity("run","new-run",json({...run,id:"new-run"}));f.db.saveEntity("run-contract","new-run",{workspace:{repositoryId:"repo",baseCommit:"sha"}});f.db.writeCanonicalTask("task",1,{id:"task",projectId:"project",state:"RUNNING",currentRunId:"new-run"},at);f.db.saveEntity("session","session",{id:"session",profileId:"profile",providerId:"codex",createdAt:at,updatedAt:at,resumable:true});f.db.saveEntity("adapter-session","session",{id:"session",runId:"new-run",profileId:"profile",backendId:"native",workspacePath:"/workspace",state:"RUNNING",createdAt:at,updatedAt:at});f.store.bindNative({sessionId:"session",runId:"new-run",binding,expectedGeneration:1,expectedLeaseId:"lease"});f.store.initializeControl({sessionId:"session",activeRunId:"new-run",exclusion:"cooperative",at});
 const response=await f.service.app.inject({url:`/api/runs/${run.id}/history`,headers});expect(response.statusCode).toBe(403);expect(response.json().code).toBe("FORBIDDEN");expect(response.body).not.toContain("new owner transcript");expect(history).not.toHaveBeenCalled();}finally{await f.close();}});
it("reads the exact authoritative control/fence without SQL or native side effects",async()=>{
 const f=await fixture();try{const methods={capabilities:vi.fn(),inspect:vi.fn(),history:vi.fn(),release:vi.fn(),attach:vi.fn()};(f.service as unknown as {agentAdapters:Map<string,AgentAdapter>}).agentAdapters.set("profile",{interaction:methods} as unknown as AgentAdapter);const before=f.db.handle.prepare("SELECT total_changes() AS count").get(),response=await f.service.app.inject({url:`/api/runs/${run.id}/control`,headers});expect(response.statusCode,response.body).toBe(200);expect(response.json()).toMatchObject({version:1,runId:run.id,profileId:run.profileId,generation:1,attempt:1,control:f.store.control("session"),fence:{sessionId:"session",runId:run.id,generation:1,leaseId:"lease",expectedTaskRevision:1,expectedCurrentRunId:run.id,expectedControlRevision:1,expectedControlEpoch:1},mutationAvailable:false,reasonCode:"NATIVE_CONTROL_COORDINATOR_UNAVAILABLE"});expect(response.json().fence).not.toHaveProperty("commandId");expect(response.body).not.toContain("account-store");expect(f.db.handle.prepare("SELECT total_changes() AS count").get()).toEqual(before);for(const method of Object.values(methods))expect(method).not.toHaveBeenCalled();}finally{await f.close();}
});
it("does not invent control or a fence for legacy Runs",async()=>{const f=await fixture(false);try{const response=await f.service.app.inject({url:`/api/runs/${run.id}/control`,headers});expect(response.statusCode).toBe(200);expect(response.json()).toMatchObject({control:null,fence:null,mutationAvailable:false,reasonCode:"NATIVE_CONTROL_UNAVAILABLE"});}finally{await f.close();}});
it("rejects unauthorized and missing control reads before revealing identity",async()=>{const f=await fixture();try{expect((await f.service.app.inject({url:`/api/runs/${run.id}/control`})).statusCode).toBe(401);expect((await f.service.app.inject({url:"/api/runs/missing/control",headers})).statusCode).toBe(404);}finally{await f.close();}});
it("does not expose another Run's retained control through an old Run URL",async()=>{const f=await fixture();try{const adapter=f.db.getEntity<JsonValue>("adapter-session","session") as Record<string,JsonValue>;f.db.handle.prepare("UPDATE entities SET document_json=? WHERE kind='adapter-session' AND id='session'").run(JSON.stringify({...adapter,runId:"new-run"}));const response=await f.service.app.inject({url:`/api/runs/${run.id}/control`,headers});expect(response.statusCode).toBe(409);expect(response.body).not.toContain(binding.nativeSessionId);expect(response.json()).not.toHaveProperty("control");}finally{await f.close();}});

it.each([undefined, ""])('returns unavailable control for a legacy session identifier %s', async sessionId => {
 const f=await fixture(false);
 try {
  f.db.saveEntity("run",run.id,json({...run,sessionId}));
  const before=f.db.handle.prepare("SELECT total_changes() AS count").get();
  const response=await f.service.app.inject({url:`/api/runs/${run.id}/control`,headers});
  expect(response.statusCode,response.body).toBe(200);
  expect(response.json()).toEqual({version:1,runId:run.id,profileId:"profile",generation:1,attempt:1,control:null,fence:null,mutationAvailable:false,reasonCode:"NATIVE_CONTROL_UNAVAILABLE"});
  expect(f.db.handle.prepare("SELECT total_changes() AS count").get()).toEqual(before);
 } finally {await f.close();}
});
it('withholds control and fence when the saved control belongs to another Run', async()=>{
 const f=await fixture();
 try {
  const control=f.store.control("session")!;
  f.db.handle.prepare("UPDATE session_controls SET active_run_id=?,document_json=? WHERE session_id=?").run("new-run",JSON.stringify({...control,activeRunId:"new-run"}),"session");
  const before=f.db.handle.prepare("SELECT total_changes() AS count").get();
  const response=await f.service.app.inject({url:`/api/runs/${run.id}/control`,headers});
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({control:null,fence:null,mutationAvailable:false,reasonCode:"NATIVE_CONTROL_UNAVAILABLE"});
  expect(response.body).not.toContain("new-run");
  expect(f.db.handle.prepare("SELECT total_changes() AS count").get()).toEqual(before);
 }finally{await f.close();}
});
it('reflects freshly saved control revision and epoch without invoking any native method',async()=>{
 const f=await fixture();
 try {
  const methods={capabilities:vi.fn(),readHandle:vi.fn(),inspect:vi.fn(),history:vi.fn(),access:vi.fn(),release:vi.fn(),attach:vi.fn(),respond:vi.fn(),requestHandle:vi.fn(),continueTurn:vi.fn(),steer:vi.fn(),interrupt:vi.fn(),inspectQuiescence:vi.fn()};
  (f.service as unknown as {agentAdapters:Map<string,AgentAdapter>}).agentAdapters.set("profile",{interaction:methods,result:methods.inspect} as unknown as AgentAdapter);
  const before=f.db.handle.prepare("SELECT total_changes() AS count").get();
  const first=await f.service.app.inject({url:`/api/runs/${run.id}/control`,headers});
  expect(first.statusCode).toBe(200);
  expect(first.json().fence).toEqual({runId:run.id,sessionId:"session",generation:1,leaseId:"lease",expectedTaskRevision:1,expectedCurrentRunId:run.id,expectedControlRevision:1,expectedControlEpoch:1});
  expect(f.db.handle.prepare("SELECT total_changes() AS count").get()).toEqual(before);
  f.store.compareAndSwapControl({sessionId:"session",expectedRevision:1,expectedEpoch:1,actorId:"owner",event:{type:"request-handoff",principalId:"owner",at}});
  const updated=f.db.handle.prepare("SELECT total_changes() AS count").get();
  const next=await f.service.app.inject({url:`/api/runs/${run.id}/control`,headers});
  expect(next.statusCode).toBe(200);
  expect(next.json()).toMatchObject({control:{state:"HANDOFF_REQUESTED",revision:2,epoch:2},fence:{expectedControlRevision:2,expectedControlEpoch:2},mutationAvailable:false});
  expect(f.db.handle.prepare("SELECT total_changes() AS count").get()).toEqual(updated);
  for(const method of Object.values(methods))expect(method).not.toHaveBeenCalled();
 }finally{await f.close();}
});
it('redacts credential-like saved control diagnostics and keeps refusals controlled',async()=>{
 const f=await fixture();
 try {
  const control=f.store.control("session")!;
  f.db.handle.prepare("UPDATE session_controls SET document_json=? WHERE session_id=?").run(JSON.stringify({...control,diagnostic:"Bearer private-control-token",password:"private-password"}),"session");
  const response=await f.service.app.inject({url:`/api/runs/${run.id}/control`,headers});
  expect(response.statusCode).toBe(200);
  expect(response.body).not.toContain("private-");
  expect(response.body).not.toContain("account-store");
  const current=f.db.getEntity<JsonValue>("session","session") as Record<string,JsonValue>;
  f.db.handle.prepare("UPDATE entities SET document_json=? WHERE kind='session' AND id='session'").run(JSON.stringify({...current,profileId:"foreign",diagnostic:"Bearer private-refusal-token"}));
  const denied=await f.service.app.inject({url:`/api/runs/${run.id}/control`,headers});
  expect(denied.statusCode).toBe(409);
  expect(denied.json().code).toBe("SESSION_OWNER_MISMATCH");
  expect(denied.body).not.toContain("private-");
  expect(denied.body).not.toContain(binding.nativeSessionId);
  expect(denied.json()).not.toHaveProperty("control");
 }finally{await f.close();}
});
it.each([null,"not-callable"])('does not qualify a malformed history callable %s from scoped evidence',async history=>{
 const f=await fixture();
 try {
  (f.service as unknown as {agentAdapters:Map<string,AgentAdapter>}).agentAdapters.set("profile",{interaction:{capabilities,history,access:vi.fn()}} as unknown as AgentAdapter);
  f.store.saveObservation({sessionId:"session",observerGeneration:1,observerSequence:1,controlEpoch:1,observation:{version:1,id:"malformed",nativeSessionId:binding.nativeSessionId,scopeFingerprint:"scope",observedAt:at,state:"idle",pendingTools:"none",pendingApprovals:"none",historyMode:"native-revision"}});
  const response=await f.service.app.inject({url:`/api/runs/${run.id}`,headers});
  expect(response.statusCode).toBe(200);
  expect(response.json().nativeSession.capabilities).toContainEqual({name:"historyRead",support:"unknown"});
 }finally{await f.close();}
});
it('keeps the frozen Run contract on a denied native summary',async()=>{
 const f=await fixture();
 try {
  f.db.handle.prepare("UPDATE entities SET document_json=? WHERE kind='adapter-session' AND id='session'").run(JSON.stringify({id:"session",runId:"foreign-run",profileId:"profile"}));
  const response=await f.service.app.inject({url:`/api/runs/${run.id}`,headers});
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({contract:{workspace:{repositoryId:"repo",baseCommit:"sha"}},nativeSession:null,nativeSessionError:{code:"NATIVE_SUMMARY_UNAVAILABLE",status:409}});
 }finally{await f.close();}
});
