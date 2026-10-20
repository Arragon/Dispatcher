import { expect, it, vi } from "vitest";
import type { InteractionCapabilities, MutationFence, NativeBinding, NativeCommandReceipt, NativeObservation, Run } from "@dispatcher/domain";
import { DispatcherDatabase, InteractionStore, type JsonValue } from "@dispatcher/persistence";
import { NativeRuntime } from "@dispatcher/runner";
import { NativeInteractions } from "../src/native-interactions.js";
import type { NativeInteractionPort } from "@dispatcher/adapters";
const at="2026-10-07T18:00:00Z";
const binding:NativeBinding={version:1,product:"codex",region:"global",profileId:"p",backendId:"native",runnerId:"local",nativeStoreRef:"store",nativeSessionId:"native",executionRefId:"execution",identityState:"bound"};
const run:Run={id:"run",taskId:"task",sessionId:"session",profileId:"p",providerId:"codex",runnerId:"local",state:"ACTIVE",generation:1,attempt:1,leaseId:"lease",leaseExpiresAt:"2100-01-01T00:00:00Z",taskRevision:1,contractRevision:1,worktree:"/workspace",startedAt:at,executionRef:{version:1,id:"execution",kind:"managed-worktree",runnerId:"local",repositoryId:"repo",workspaceId:"workspace",pathRef:"workspace:workspace",branch:"task/run",baseRevision:"sha"}};
const observation:NativeObservation={version:1,id:"idle",nativeSessionId:"native",scopeFingerprint:"scope",observedAt:at,state:"idle",pendingTools:"none",pendingApprovals:"none",historyMode:"native-revision",executionRefId:"execution",reportedModel:{nativeSelectionId:"model"},permissionFingerprint:"policy"};
const evidence={version:1 as const,support:"supported" as const,level:"runtime-verified" as const,scopeFingerprint:"scope",evidenceRef:"proof",verifiedAt:at};
const principal={id:"owner",roles:["operator"],profileId:"p"};
const command={type:"continue" as const,commandId:"command",message:"continue with task"};
const json=(value:unknown):JsonValue=>JSON.parse(JSON.stringify(value)) as JsonValue;
function fixture(){
 const db=new DispatcherDatabase(":memory:");db.writeCanonicalTask("task",0,{id:"task",projectId:"project",state:"RUNNING",currentRunId:"run"},at);db.saveEntity("run","run",json(run));db.saveEntity("session","session",{id:"session",profileId:"p",providerId:"codex",createdAt:at,updatedAt:at,resumable:true});db.saveEntity("adapter-session","session",{id:"session",runId:"run",profileId:"p",backendId:"native",workspacePath:"/workspace",state:"RUNNING",createdAt:at,updatedAt:at});
 const store=new InteractionStore(db);store.bindNative({sessionId:"session",runId:"run",binding,expectedGeneration:1,expectedLeaseId:"lease"});store.initializeControl({sessionId:"session",activeRunId:"run",exclusion:"cooperative",at});store.saveObservation({sessionId:"session",observerGeneration:1,observerSequence:1,controlEpoch:1,observation});const interactions=new NativeInteractions(db,()=>new Date(at));
 const fence:MutationFence={runId:"run",sessionId:"session",commandId:"command",generation:1,leaseId:"lease",expectedTaskRevision:1,expectedCurrentRunId:"run",expectedControlRevision:1,expectedControlEpoch:1};
 const continueTurn=vi.fn<NonNullable<NativeInteractionPort["continueTurn"]>>(async()=>({version:1,commandId:"command",state:"accepted",nativeTurnId:"turn"}));const steer=vi.fn<NonNullable<NativeInteractionPort["steer"]>>(async()=>({version:1,commandId:"command",state:"accepted"}));const respond=vi.fn<NonNullable<NativeInteractionPort["respond"]>>(async()=>({version:1,commandId:"command",state:"accepted",nativeRequestId:"request"}));const capabilities=vi.fn(()=>({version:1,sameSessionContinue:evidence,liveSteer:evidence,nativeApproval:evidence}) as InteractionCapabilities);
 const request={version:1 as const,requestId:"request",revision:"request-revision",connectionId:"connection",connectionEpoch:1,type:"permission" as const,tool:{name:"write",scope:["workspace:workspace"],risk:"high" as const},options:[{id:"once",kind:"allow-once" as const}],expiresAt:"2026-10-07T18:05:00Z"};
 const handle={binding,scopeFingerprint:"scope",connectionId:"connection",connectionEpoch:1,isConnected:()=>true,inspectPending:async(_id:string,q:{requestId:string})=>({version:1 as const,requestId:q.requestId,connectionId:"connection",connectionEpoch:1,state:"pending" as const,request}),respond};
 const source={binding,scopeFingerprint:"scope",port:{continueTurn,steer,respond,capabilities,requestHandle:()=>handle}};
 return {db,store,interactions,fence,source,request,continueTurn,steer,respond,capabilities};
}
it("persists intent before native invocation and keeps accepted separate from completed",async()=>{
 const f=fixture();try{f.continueTurn.mockImplementation(async()=>{expect(f.store.command("command")?.state).toBe("SENDING");return {version:1,commandId:"command",state:"accepted",nativeTurnId:"turn"};});expect(await f.interactions.dispatchInteraction(principal,command,f.fence,f.source)).toMatchObject({state:"accepted"});expect(f.store.command("command")?.state).toBe("ACKNOWLEDGED");expect(f.interactions.getCommandOutcome(principal,"command")).toMatchObject({state:"accepted",execution:"unconfirmed"});expect((f.db.getEntity("run","run") as unknown as Run).state).toBe("ACTIVE");}finally{f.db.close();}
});
it.each(['continue','steer','approval'] as const)('revokes delayed %s input through the final guard using current SQLite control',async kind=>{
 const f=fixture(),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>(),effects:string[]=[];
 try{if(kind==='steer')f.store.saveObservation({sessionId:'session',observerGeneration:1,observerSequence:2,controlEpoch:1,observation:{...observation,id:'running',state:'running',activeTurnId:'active'}});
 if(kind==='approval')f.interactions.registerNativeRequest(f.fence,f.request,f.source);
 const method=kind==='continue'?f.continueTurn:kind==='steer'?f.steer:f.respond;method.mockImplementation(async(_binding,input,beforeSend)=>{entered.resolve();await release.promise;beforeSend?.();effects.push(kind);return {version:1,commandId:input.commandId,state:'accepted',...(kind==='approval'?{nativeRequestId:'request'}:{})};});
 const input=kind==='continue'?command:kind==='steer'?{type:'steer' as const,commandId:'command',message:'steer',activeTurnId:'active'}:{type:'approval' as const,commandId:'command',requestId:'request',requestType:'permission' as const,expectedRevision:'request-revision',response:{kind:'allow' as const,optionId:'once'}};
 const pending=f.interactions.dispatchInteraction(principal,input,f.fence,f.source);await entered.promise;expect(f.store.command('command')?.state).toBe('SENDING');f.store.compareAndSwapControl({sessionId:'session',expectedRevision:1,expectedEpoch:1,actorId:'owner',event:{type:'request-handoff',principalId:'owner',at}});release.resolve();expect(await pending).toMatchObject({state:'rejected'});expect(effects).toEqual([]);expect(f.store.command('command')?.state).toBe('FAILED');expect((f.db.getEntity('run','run') as unknown as Run).state).toBe('ACTIVE');
 }finally{release.resolve();f.db.close();}
});
it("replays the same receipt without sending twice and conflicts on changed message",async()=>{
 const f=fixture();try{const first=await f.interactions.dispatchInteraction(principal,command,f.fence,f.source);expect(await f.interactions.dispatchInteraction(principal,command,f.fence,f.source)).toEqual(first);await expect(f.interactions.dispatchInteraction(principal,{...command,message:"different"},f.fence,f.source)).rejects.toMatchObject({code:"IDEMPOTENCY_CONFLICT"});expect(f.continueTurn).toHaveBeenCalledOnce();}finally{f.db.close();}
});
it("never replaces busy continue with steer implicitly",async()=>{
 const f=fixture();try{f.store.saveObservation({sessionId:"session",observerGeneration:1,observerSequence:2,controlEpoch:1,observation:{...observation,id:"running",state:"running",activeTurnId:"active"}});await expect(f.interactions.dispatchInteraction(principal,command,f.fence,f.source)).rejects.toMatchObject({code:"SESSION_BUSY"});expect(f.continueTurn).not.toHaveBeenCalled();expect(await f.interactions.dispatchInteraction(principal,{type:"steer",commandId:"command",message:"steer",activeTurnId:"active"},f.fence,f.source)).toMatchObject({state:"accepted"});expect(f.steer).toHaveBeenCalledWith(binding,expect.objectContaining({activeTurnId:"active",fence:f.fence}),expect.any(Function));}finally{f.db.close();}
});
it("freezes unsent reservations on takeover without sending them",async()=>{
 const f=fixture();try{f.interactions.reserveInteraction(principal,command,f.fence);f.store.compareAndSwapControl({sessionId:"session",expectedRevision:1,expectedEpoch:1,actorId:"owner",event:{type:"request-handoff",principalId:"owner",at}});expect(f.store.command("command")?.state).toBe("CANCELLED");expect(await f.interactions.dispatchInteraction(principal,command,f.fence,f.source)).toMatchObject({state:"rejected"});expect(f.continueTurn).not.toHaveBeenCalled();}finally{f.db.close();}
});
it("does not replay an uncertain native write or a crash-recovered SENDING command",async()=>{
 const f=fixture();try{f.continueTurn.mockRejectedValue(new Error("raw provider credential error"));expect(await f.interactions.dispatchInteraction(principal,command,f.fence,f.source)).toMatchObject({state:"unknown"});expect(await f.interactions.dispatchInteraction(principal,command,f.fence,f.source)).toMatchObject({state:"unknown"});expect(f.continueTurn).toHaveBeenCalledOnce();expect(JSON.stringify(f.interactions.getCommandOutcome(principal,"command"))).not.toContain("credential");
 const second={...command,commandId:"second"};const secondFence={...f.fence,commandId:"second"};await expect(f.interactions.dispatchInteraction(principal,second,secondFence,f.source)).rejects.toMatchObject({code:"NATIVE_COMMAND_OUTCOME_UNKNOWN"});
 }finally{f.db.close();}
 const fresh=fixture();try{const reserved=fresh.interactions.reserveInteraction(principal,command,fresh.fence);fresh.store.updateCommand({id:"command",expectedRevision:reserved.revision,state:"SENDING"});const recovered=new NativeInteractions(fresh.db,()=>new Date(at));expect(await recovered.dispatchInteraction(principal,command,fresh.fence,fresh.source)).toMatchObject({state:"unknown"});expect(fresh.continueTurn).not.toHaveBeenCalled();}finally{fresh.db.close();}
});
it("keeps native queued input explicit after takeover until it has read/cancel evidence",async()=>{
 const f=fixture();try{f.continueTurn.mockResolvedValue({version:1,commandId:"command",state:"queued",nativeTurnId:"turn"});await f.interactions.dispatchInteraction(principal,command,f.fence,f.source);f.store.compareAndSwapControl({sessionId:"session",expectedRevision:1,expectedEpoch:1,actorId:"owner",event:{type:"request-handoff",principalId:"owner",at}});expect(f.interactions.getCommandOutcome(principal,"command")).toMatchObject({state:"queued",execution:"unconfirmed",requiresReconciliation:true});}finally{f.db.close();}
});
it("rejects foreign source, stale fence and unsupported capabilities before native input",async()=>{
 const f=fixture();try{await expect(f.interactions.dispatchInteraction(principal,command,{...f.fence,generation:2},f.source)).rejects.toMatchObject({code:"STALE_RUN_AUTHORITY"});await expect(f.interactions.dispatchInteraction(principal,command,f.fence,{...f.source,binding:{...binding,nativeStoreRef:"foreign"}})).rejects.toMatchObject({code:"NATIVE_IDENTITY_CHANGED"});f.capabilities.mockReturnValue({version:1,sameSessionContinue:{...evidence,support:"unsupported"}} as InteractionCapabilities);expect(await f.interactions.dispatchInteraction(principal,command,f.fence,f.source)).toMatchObject({state:"rejected"});expect(f.continueTurn).not.toHaveBeenCalled();}finally{f.db.close();}
});
it("routes a permission response to respond with its request revision instead of generic input",async()=>{
 const f=fixture();try{f.interactions.registerNativeRequest(f.fence,f.request,f.source);const response={type:"approval" as const,commandId:"command",requestId:"request",requestType:"permission" as const,expectedRevision:"request-revision",response:{kind:"allow" as const,optionId:"once"}};expect(await f.interactions.dispatchInteraction(principal,response,f.fence,f.source)).toMatchObject({state:"accepted"});expect(f.respond).toHaveBeenCalledWith(binding,{commandId:"command",fence:f.fence,requestId:"request",type:"permission",expectedRevision:"request-revision",response:{kind:"allow",optionId:"once"},connectionId:"connection",connectionEpoch:1},expect.any(Function));expect(f.continueTurn).not.toHaveBeenCalled();}finally{f.db.close();}
});
it("never treats a historical completed turn as completion of a new command",async()=>{
 const f=fixture();try{f.db.saveEntity("native-binding-event","old",json({applied:true,event:{version:1,id:"old",sessionId:"session",runId:"run",profileId:"p",backendId:"native",generation:1,attempt:1,leaseId:"lease",nativeSessionId:"native",turn:{id:"turn",invocationId:"old-invocation",source:"native",nativeTurnId:"turn",state:"completed",observedAt:at}}}));await f.interactions.dispatchInteraction(principal,command,f.fence,f.source);expect(f.interactions.getCommandOutcome(principal,"command").execution).toBe("unconfirmed");}finally{f.db.close();}
});
it("reports only command-correlated applied native execution while Run completion remains separate",async()=>{
 const f=fixture();try{await f.interactions.dispatchInteraction(principal,command,f.fence,f.source);const adapter=f.db.getEntity<JsonValue>("adapter-session","session") as Record<string,JsonValue>;f.db.saveEntity("adapter-session","session",{...adapter,nativeInvocationId:"invocation",execution:{generation:1,attempt:1,leaseId:"lease"}});f.interactions.registerNativeObserver({sessionId:"session",runId:"run",profileId:"p",backendId:"native",invocationId:"invocation",generation:1,attempt:1,leaseId:"lease"});expect(f.interactions.applyNativeBindingEvent({version:1,id:"actual-completion",sessionId:"session",runId:"run",profileId:"p",backendId:"native",generation:1,attempt:1,leaseId:"lease",nativeSessionId:"native",turn:{id:"turn",invocationId:"invocation",source:"native",nativeTurnId:"turn",state:"completed",observedAt:at}}).applied).toBe(true);expect(f.interactions.getCommandOutcome(principal,"command").execution).toBe("completed");expect((f.db.getEntity("run","run") as unknown as Run).state).toBe("ACTIVE");}finally{f.db.close();}
});
it("bounds a pending write and never sends it again when a late native reply arrives",async()=>{
 vi.useFakeTimers();const f=fixture();try{const pending=Promise.withResolvers<NativeCommandReceipt>();f.continueTurn.mockImplementation(()=>pending.promise);const result=f.interactions.dispatchInteraction(principal,command,f.fence,f.source);await vi.advanceTimersByTimeAsync(5_001);expect(await result).toMatchObject({state:"unknown",code:"NATIVE_COMMAND_TIMEOUT"});pending.resolve({version:1,commandId:"command",state:"accepted"});await vi.advanceTimersByTimeAsync(1);expect(await f.interactions.dispatchInteraction(principal,command,f.fence,f.source)).toMatchObject({state:"unknown"});expect(f.continueTurn).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);}finally{f.db.close();vi.useRealTimers();}
});
it("retains a late receipt after takeover without promoting or executing the Run",async()=>{
 const f=fixture();try{const pending=Promise.withResolvers<NativeCommandReceipt>();f.continueTurn.mockImplementation(()=>pending.promise);const result=f.interactions.dispatchInteraction(principal,command,f.fence,f.source);await vi.waitFor(()=>expect(f.continueTurn).toHaveBeenCalledOnce());f.store.compareAndSwapControl({sessionId:"session",expectedRevision:1,expectedEpoch:1,actorId:"owner",event:{type:"request-handoff",principalId:"owner",at}});pending.resolve({version:1,commandId:"command",state:"queued"});expect(await result).toMatchObject({state:"queued"});expect(f.interactions.getCommandOutcome(principal,"command")).toMatchObject({state:"queued",execution:"unconfirmed",requiresReconciliation:true});expect(f.store.control("session")?.state).toBe("HANDOFF_REQUESTED");}finally{f.db.close();}
});
it("does not persist or disclose credential-bearing receipt IDs or foreign receipts",async()=>{
 const f=fixture();try{f.continueTurn.mockResolvedValue({version:1,commandId:"command",state:"accepted",nativeTurnId:"access_token=private-short-value"});const receipt=await f.interactions.dispatchInteraction(principal,command,f.fence,f.source);expect(receipt).toMatchObject({state:"unknown",code:"NATIVE_COMMAND_RECEIPT_INVALID"});expect(JSON.stringify(f.store.command("command"))).not.toContain("private-short-value");}finally{f.db.close();}
});
it("invalidates cached idle authority after accepted input until a newer native observation",async()=>{
 const f=fixture();try{await f.interactions.dispatchInteraction(principal,command,f.fence,f.source);const second={...command,commandId:"second"};const secondFence={...f.fence,commandId:"second"};await expect(f.interactions.dispatchInteraction(principal,second,secondFence,f.source)).rejects.toMatchObject({code:"NATIVE_STATE_UNKNOWN"});expect(f.store.observation("session")?.state).toBe("unknown");f.store.saveObservation({sessionId:"session",observerGeneration:2,observerSequence:1,controlEpoch:1,readBarrier:f.interactions.captureNativeReadBarrier("session"),observation:{...observation,id:"new-idle"}});f.continueTurn.mockResolvedValue({version:1,commandId:"second",state:"accepted"});expect(await f.interactions.dispatchInteraction(principal,second,secondFence,f.source)).toMatchObject({state:"accepted"});}finally{f.db.close();}
});
it("keeps unresolved native queued input blocking writes even when a later snapshot reports idle",async()=>{
 const f=fixture();try{f.continueTurn.mockResolvedValue({version:1,commandId:"command",state:"queued",nativeTurnId:"turn"});await f.interactions.dispatchInteraction(principal,command,f.fence,f.source);f.store.saveObservation({sessionId:"session",observerGeneration:2,observerSequence:1,controlEpoch:1,readBarrier:f.interactions.captureNativeReadBarrier("session"),observation:{...observation,id:"new-idle"}});await expect(f.interactions.dispatchInteraction(principal,{...command,commandId:"second"},{...f.fence,commandId:"second"},f.source)).rejects.toMatchObject({code:"NATIVE_COMMAND_QUEUE_UNCONFIRMED"});expect(f.continueTurn).toHaveBeenCalledOnce();}finally{f.db.close();}
});
it("never borrows an idle snapshot from a different runtime scope",async()=>{
 const f=fixture();try{f.capabilities.mockReturnValue({version:1,sameSessionContinue:{...evidence,scopeFingerprint:"foreign"}} as InteractionCapabilities);await expect(f.interactions.dispatchInteraction(principal,command,f.fence,{...f.source,scopeFingerprint:"foreign"})).rejects.toMatchObject({code:"NATIVE_OBSERVATION_SCOPE_CHANGED"});expect(f.continueTurn).not.toHaveBeenCalled();}finally{f.db.close();}
});
it("preserves handoff rejection of native approval while refusing allow",async()=>{
 const f=fixture();try{
  f.request.revision="revision";f.interactions.registerNativeRequest(f.fence,f.request,f.source);
  f.store.compareAndSwapControl({sessionId:"session",expectedRevision:1,expectedEpoch:1,actorId:"owner",event:{type:"request-handoff",principalId:"owner",at}});
  const fence={...f.fence,expectedControlRevision:2,expectedControlEpoch:2};
  const request={type:"approval" as const,commandId:"command",requestId:"request",requestType:"permission" as const,expectedRevision:"revision",response:{kind:"reject" as const}};
  expect(await f.interactions.dispatchInteraction(principal,request,fence,f.source)).toMatchObject({state:"accepted"});
  expect(f.respond).toHaveBeenCalledOnce();expect(f.store.control("session")?.state).toBe("HANDOFF_REQUESTED");
  await expect(f.interactions.dispatchInteraction(principal,{...request,commandId:"allow",response:{kind:"allow",optionId:"once"}},{...fence,commandId:"allow"},f.source)).rejects.toMatchObject({code:"NATIVE_WRITE_LOCKED"});
  expect(f.respond).toHaveBeenCalledOnce();
 }finally{f.db.close();}
});
it("does not turn database row reordering into post-command completion evidence",async()=>{
 const f=fixture();try{
  const adapter=f.db.getEntity<JsonValue>("adapter-session","session") as Record<string,JsonValue>;
  f.db.saveEntity("adapter-session","session",{...adapter,nativeInvocationId:"invocation",execution:{generation:1,attempt:1,leaseId:"lease"}});
  f.interactions.registerNativeObserver({sessionId:"session",runId:"run",profileId:"p",backendId:"native",invocationId:"invocation",generation:1,attempt:1,leaseId:"lease"});
  expect(f.interactions.applyNativeBindingEvent({version:1,id:"old-completion",sessionId:"session",runId:"run",profileId:"p",backendId:"native",generation:1,attempt:1,leaseId:"lease",nativeSessionId:"native",turn:{id:"turn",invocationId:"invocation",source:"native",nativeTurnId:"turn",state:"completed",observedAt:at}}).applied).toBe(true);
  const old=f.db.getEntity<JsonValue>("native-binding-event","old-completion")!;
  await f.interactions.dispatchInteraction(principal,command,f.fence,f.source);
  f.db.handle.prepare("DELETE FROM entities WHERE kind='native-binding-event' AND id='old-completion'").run();
  f.db.saveEntity("restore-order","later",{});f.db.saveEntity("native-binding-event","old-completion",old);
  expect(new NativeInteractions(f.db,()=>new Date(at)).getCommandOutcome(principal,"command").execution).toBe("unconfirmed");
 }finally{f.db.close();}
});
it("rejects all reads begun before accepted input even when their sequence is higher",async()=>{
 const f=fixture();try{
  await f.interactions.dispatchInteraction(principal,command,f.fence,f.source);
  const stale={...observation,id:"late-pre-send-read",read:{requestId:"late-pre-send-read",observerEpoch:"reader",observerGeneration:1,sequence:100,processState:"running" as const,readability:"readable" as const}};
  const context={sessionId:"session",runId:"run",generation:1,leaseId:"lease",controlEpoch:1,scopeFingerprint:"scope",stream:{kind:"volatile" as const},observerGeneration:1,observerEpoch:"reader",sequence:100};
  const history={binding,scopeFingerprint:"scope",gapGeneration:1,requestId:stale.id,observerEpoch:"reader",observerGeneration:1,sequence:100,page:{version:1 as const,nativeSessionId:"native",state:"available" as const,entries:[],range:"native-history" as const,completeness:"complete" as const,source:"fixture"}};
  expect(f.interactions.applyNativeEventRecovery({...context,observation:stale,history}).accepted).toBe(false);
  expect(f.store.observation("session")?.state).toBe("unknown");
  expect(f.store.saveObservation({sessionId:"session",observerGeneration:3,observerSequence:1000,controlEpoch:1,observation:{...observation,id:"direct-stale"}}).accepted).toBe(false);
  const readBarrier=f.interactions.captureNativeReadBarrier("session");
  const fresh={...stale,id:"fresh-post-send",read:{...stale.read,requestId:"fresh-post-send",sequence:101}};
  expect(f.interactions.applyNativeEventRecovery({...context,sequence:101,readBarrier,observation:fresh,history:{...history,requestId:fresh.id,sequence:101}}).accepted).toBe(true);
  expect(f.store.observation("session")?.state).toBe("idle");
 }finally{f.db.close();}
});

it("fences real in-flight reads and admits the first fresh read without consuming its sequence",async()=>{
 const f=fixture();const runtime=new NativeRuntime();const held:Array<ReturnType<typeof Promise.withResolvers<NativeObservation>>>=[];
 const token=runtime.connect({binding,scopeFingerprint:"scope",inspect:async()=>{const pending=Promise.withResolvers<NativeObservation>();held.push(pending);return pending.promise;}});
 const apply=(value:NativeObservation,readBarrier?:string)=>f.interactions.applyNativeEventRecovery({sessionId:"session",runId:"run",generation:1,leaseId:"lease",controlEpoch:1,scopeFingerprint:"scope",stream:{kind:"volatile"},observerGeneration:value.read!.observerGeneration,observerEpoch:value.read!.observerEpoch,sequence:value.read!.sequence,observation:value,readBarrier,history:{binding,scopeFingerprint:"scope",gapGeneration:1,...value.read!,page:{version:1,nativeSessionId:"native",state:"available",entries:[],range:"native-history",completeness:"complete",source:"fixture"}}});
 try{
  const staleBarrier=f.interactions.captureNativeReadBarrier("session");
  const first=runtime.inspect(token);await vi.waitFor(()=>expect(held).toHaveLength(1));held[0]!.resolve(observation);expect(apply(await first,staleBarrier).accepted).toBe(false); // Runtime seq1 cannot replace the existing seq1 fixture.
  const old2=runtime.inspect(token);const old3=runtime.inspect(token);await vi.waitFor(()=>expect(held).toHaveLength(3));
  await f.interactions.dispatchInteraction(principal,command,f.fence,f.source);
  held[2]!.resolve(observation);expect(apply(await old3,staleBarrier)).toMatchObject({accepted:false,code:"STALE_NATIVE_READ_BARRIER"});
  held[1]!.resolve(observation);expect(apply(await old2,staleBarrier).accepted).toBe(false);
  expect(f.store.observation("session")?.state).toBe("unknown");
  const freshBarrier=new NativeInteractions(f.db,()=>new Date(at)).captureNativeReadBarrier("session");
  const fresh=runtime.inspect(token);await vi.waitFor(()=>expect(held).toHaveLength(4));held[3]!.resolve(observation);expect(apply(await fresh,freshBarrier)).toMatchObject({accepted:true,needsSnapshot:false,needsHistory:false});
  expect(f.store.observation("session")?.state).toBe("idle");
  expect(await f.interactions.dispatchInteraction(principal,command,f.fence,f.source)).toMatchObject({state:"accepted"});expect(f.interactions.captureNativeReadBarrier("session")).toBe(freshBarrier);
  f.continueTurn.mockResolvedValue({version:1,commandId:"second",state:"accepted"});await f.interactions.dispatchInteraction(principal,{...command,commandId:"second"},{...f.fence,commandId:"second"},f.source);
  expect(f.interactions.captureNativeReadBarrier("session")).not.toBe(freshBarrier);
 }finally{runtime.disconnect(token);f.db.close();}
});
it("admits the next real seq2 read after ACK and keeps the barrier across Core restart",async()=>{
 const f=fixture();const runtime=new NativeRuntime();const token=runtime.connect({binding,scopeFingerprint:"scope",inspect:async()=>observation});
 try{
  await runtime.inspect(token);await f.interactions.dispatchInteraction(principal,command,f.fence,f.source);
  const recovered=new NativeInteractions(f.db,()=>new Date(at));const readBarrier=recovered.captureNativeReadBarrier("session");
  const fresh=await runtime.inspect(token);expect(fresh.read?.sequence).toBe(2);
  expect(f.store.saveObservation({sessionId:"session",observerGeneration:1,observerSequence:2,controlEpoch:1,readBarrier,observation:fresh}).accepted).toBe(true);
  expect(f.store.observation("session")?.state).toBe("idle");
 }finally{runtime.disconnect(token);f.db.close();}
});
