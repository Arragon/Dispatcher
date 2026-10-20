import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { HistoryPage, NativeBinding, NativeBindingEvent, NativeObservation } from "@dispatcher/domain";
import { createNativeEventCheckpoint, reconcileNativeEvents, recoverNativeEvents, recordNativeEvent } from "../src/native-event-reconcile.js";
import { RunnerJournal } from "../src/journal.js";
const binding:NativeBinding={version:1,product:"opencode",region:"global",profileId:"p",backendId:"serve",runnerId:"local",nativeStoreRef:"store",nativeSessionId:"native",executionRefId:"execution",identityState:"bound"};
const at="2026-10-07T18:00:00Z";
const snapshot:NativeObservation={version:1,id:"snapshot",nativeSessionId:"native",scopeFingerprint:"scope",observedAt:at,state:"idle",pendingTools:"none",pendingApprovals:"none",historyMode:"native-revision",historyRevision:"revision",read:{requestId:"snapshot",observerEpoch:"observer",observerGeneration:1,sequence:1,processState:"missing",readability:"readable"}};
const history:HistoryPage={version:1,nativeSessionId:"native",entries:[{id:"human-message",kind:"user",text:"private-transcript",turnId:"human-turn"}],completeness:"complete",range:"native-history",state:"available",source:"opencode"};
const event:NativeBindingEvent={version:1,id:"event",sessionId:"dispatcher",runId:"run",profileId:"p",backendId:"serve",generation:1,attempt:1,leaseId:"lease",nativeSessionId:"native",turn:{id:"turn",invocationId:"invocation",source:"native",state:"running",nativeTurnId:"turn",observedAt:at}};
const historyRead=(page=history,observation=snapshot,gapGeneration=1,requestedCursor?:string)=>({page,binding,scopeFingerprint:"scope",gapGeneration,...observation.read!,...(requestedCursor?{requestedCursor}:{})});
const checkpoint=()=>createNativeEventCheckpoint({binding,scopeFingerprint:"scope",stream:{kind:"volatile"}});
it("requires both a fresh snapshot and history after a volatile stream gap",()=>{
 const gap=reconcileNativeEvents(checkpoint(),undefined,undefined,{disconnected:true});expect(gap).toMatchObject({needsSnapshot:true,needsHistory:true,completeness:"unknown"});expect(gap.checkpoint.stream).not.toHaveProperty("cursor");const recovered=reconcileNativeEvents(gap.checkpoint,snapshot,historyRead(history,snapshot,gap.checkpoint.gapGeneration));expect(recovered).toMatchObject({needsSnapshot:false,needsHistory:false,completeness:"complete"});expect(recovered.checkpoint.history?.entries).toEqual([{id:"human-message",kind:"user",turnId:"human-turn"}]);expect(JSON.stringify(recovered)).not.toContain("private-transcript");
});
it("deduplicates normalized native events but rejects reused IDs with changed facts",()=>{
 const first=recordNativeEvent(checkpoint(),event);expect(first.accepted).toBe(true);const duplicate=recordNativeEvent(first.checkpoint,{...event,turn:{...event.turn,observedAt:"2026-10-07T18:01:00Z"}});expect(duplicate).toMatchObject({accepted:false,code:"DUPLICATE_NATIVE_EVENT"});expect(recordNativeEvent(first.checkpoint,{...event,turn:{...event.turn,state:"completed"}})).toMatchObject({accepted:false,code:"NATIVE_EVENT_CONFLICT"});
});
it("retains partial pages, missing ranges and provider cursor without inventing replay",()=>{
 const page={...history,completeness:"partial" as const,range:"retained-range" as const,gaps:["missing-native-page"],nextCursor:"actual-next"};const result=reconcileNativeEvents(checkpoint(),snapshot,historyRead(page));expect(result).toMatchObject({needsHistory:true,completeness:"partial",checkpoint:{history:{range:"retained-range",nextCursor:"actual-next"}}});expect(result.checkpoint.stream).not.toHaveProperty("cursor");expect(result.gaps).toContain("PROVIDER_REPORTED_GAP");
});
it("retains only actual replayable cursors and treats cursorless reconnect as a snapshot recovery",()=>{
 const replay=createNativeEventCheckpoint({binding,scopeFingerprint:"scope",stream:{kind:"replayable",cursor:"actual-cursor"}});expect(reconcileNativeEvents(replay,undefined,undefined,{disconnected:true}).checkpoint.stream).toEqual({kind:"replayable",cursor:"actual-cursor"});expect(reconcileNativeEvents(checkpoint(),snapshot,historyRead(),{cursor:"fabricated"}).checkpoint.stream).toEqual({kind:"volatile"});
});
it("reconnect reads exactly this session and one bounded page without sending prompts",async()=>{
 const inspect=vi.fn(async()=>snapshot);const read=vi.fn(async()=>history);const send=vi.fn();const result=await recoverNativeEvents(checkpoint(),{inspect,history:read,send});expect(result.needsSnapshot).toBe(false);expect(inspect).toHaveBeenCalledWith(binding);expect(read).toHaveBeenCalledWith(binding,{limit:50});expect(send).not.toHaveBeenCalled();
});
it("does not promote late observations or foreign history into the current checkpoint",()=>{
 const first=reconcileNativeEvents(checkpoint(),{...snapshot,read:{...snapshot.read!,observerGeneration:2,sequence:2}},historyRead(history,{...snapshot,read:{...snapshot.read!,observerGeneration:2,sequence:2}}));const late=reconcileNativeEvents(first.checkpoint,snapshot,historyRead({...history,nativeSessionId:"foreign"}));expect(late.accepted).toBe(false);expect(late.checkpoint).toEqual(first.checkpoint);
});
it("bounds the dedup window and page metadata without retaining transcript text",()=>{
 let current=checkpoint();for(let n=0;n<300;n++)current=recordNativeEvent(current,{...event,id:`event-${n}`}).checkpoint;expect(current.seen).toHaveLength(256);const huge={...history,entries:Array.from({length:110},(_,n)=>({id:`message-${n}`,kind:"user" as const,text:"private"}))};const result=reconcileNativeEvents(current,snapshot,historyRead(huge));expect(result.checkpoint.history?.entries).toHaveLength(100);expect(result.completeness).toBe("partial");expect(result.gaps).toContain("HISTORY_PAGE_TRUNCATED");expect(JSON.stringify(result)).not.toContain('"text"');
});
it("persists native checkpoints across journal restart without mixing transport sequence",()=>{
 const directory=mkdtempSync(join(tmpdir(),"dispatcher-native-journal-"));const path=join(directory,"journal.sqlite");let journal=new RunnerJournal(path);try{const first=recordNativeEvent(checkpoint(),event).checkpoint;journal.saveNativeCheckpoint("dispatcher",first);expect(journal.replay(0)).toEqual([]);journal.close();journal=new RunnerJournal(path);const restored=journal.nativeCheckpoint("dispatcher")!;expect(recordNativeEvent(restored,event).accepted).toBe(false);expect(journal.acknowledgedSequence()).toBe(0);}finally{journal.close();rmSync(directory,{recursive:true,force:true});}
});
it("returns bounded unknown recovery on a hanging reader instead of waiting for native completion",async()=>{
 vi.useFakeTimers();try{const result=recoverNativeEvents(checkpoint(),{inspect:async()=>await new Promise(()=>{}),history:async()=>history},{timeoutMs:10});await vi.advanceTimersByTimeAsync(11);expect(await result).toMatchObject({needsSnapshot:true,needsHistory:true,completeness:"unknown"});expect(vi.getTimerCount()).toBe(0);}finally{vi.useRealTimers();}
});
it("cannot clear a gap with only a new snapshot and stale earlier history",()=>{
 const before=reconcileNativeEvents(checkpoint(),snapshot,historyRead());const gap=reconcileNativeEvents(before.checkpoint,undefined,undefined,{disconnected:true});const after=reconcileNativeEvents(gap.checkpoint,{...snapshot,id:"next",read:{...snapshot.read!,sequence:2}});expect(after).toMatchObject({needsSnapshot:false,needsHistory:true,completeness:"partial"});
});
it("ignores provider extras and object key order when deduplicating normalized events",()=>{
 const extra={...event,raw:{text:"private-provider-payload"}};const first=recordNativeEvent(checkpoint(),extra);const reordered={turn:{...event.turn},nativeSessionId:event.nativeSessionId,leaseId:event.leaseId,attempt:1,generation:1,backendId:"serve",profileId:"p",runId:"run",sessionId:"dispatcher",id:"event",version:1 as const};expect(recordNativeEvent(first.checkpoint,reordered)).toMatchObject({accepted:false,code:"DUPLICATE_NATIVE_EVENT"});
});
it("rejects cached idle with contradictory readability and malformed activity before promotion",()=>{
 expect(reconcileNativeEvents(checkpoint(),{...snapshot,readability:"unreachable"},historyRead())).toMatchObject({accepted:false});expect(reconcileNativeEvents(checkpoint(),{...snapshot,observedAt:"invalid"},historyRead())).toMatchObject({accepted:false});
});
it("rejects stale durable checkpoint writes and raw transcript fields",()=>{
 const directory=mkdtempSync(join(tmpdir(),"dispatcher-native-journal-fence-"));const journal=new RunnerJournal(join(directory,"journal.sqlite"));try{const old=checkpoint();const first=recordNativeEvent(old,event).checkpoint;journal.saveNativeCheckpoint("dispatcher",first);expect(()=>journal.saveNativeCheckpoint("dispatcher",old)).toThrow(/STALE/);const recovered=reconcileNativeEvents(first,snapshot,historyRead()).checkpoint;const polluted={...recovered,history:{...recovered.history!,entries:[{id:"message",kind:"user" as const,text:"private-transcript"}]}};expect(()=>journal.saveNativeCheckpoint("dispatcher",polluted)).toThrow(/INVALID/);expect(JSON.stringify(journal.nativeCheckpoint("dispatcher"))).not.toContain("private-transcript");}finally{journal.close();rmSync(directory,{recursive:true,force:true});}
});
it("atomically refuses a stale writer when another journal connection advances after its read",()=>{
 const directory=mkdtempSync(join(tmpdir(),"dispatcher-native-journal-cas-"));const path=join(directory,"journal.sqlite");const a=new RunnerJournal(path);const b=new RunnerJournal(path);try{const first=recordNativeEvent(checkpoint(),event).checkpoint;const second=recordNativeEvent(first,{...event,id:"second"}).checkpoint;const third=recordNativeEvent(second,{...event,id:"third"}).checkpoint;a.saveNativeCheckpoint("dispatcher",first);const read=a.nativeCheckpoint.bind(a);let interleave=true;a.nativeCheckpoint=sessionId=>{const prior=read(sessionId);if(interleave){interleave=false;b.saveNativeCheckpoint(sessionId,third);}return prior;};expect(()=>a.saveNativeCheckpoint("dispatcher",second)).toThrow(/STALE/);expect(b.nativeCheckpoint("dispatcher")?.revision).toBe(third.revision);}finally{a.close();b.close();rmSync(directory,{recursive:true,force:true});}
});
it("rejects a pre-gap history page reused with a new snapshot",()=>{
 const before=reconcileNativeEvents(checkpoint(),snapshot,historyRead());const gap=reconcileNativeEvents(before.checkpoint,undefined,undefined,{disconnected:true});const after=reconcileNativeEvents(gap.checkpoint,{...snapshot,id:"new",read:{...snapshot.read!,requestId:"new",sequence:2}},historyRead());expect(after.accepted).toBe(false);
});
it("captures the selected store and reader methods before deferred reads",async()=>{
 const selected=checkpoint();const inspect=vi.fn(async()=>snapshot);const read=vi.fn(async()=>history);const reader={inspect,history:read};const pending=recoverNativeEvents(selected,reader);selected.binding.nativeStoreRef="foreign-store";reader.inspect=vi.fn(async()=>snapshot);await pending;expect(inspect).toHaveBeenCalledWith(binding);expect(read).toHaveBeenCalledWith(binding,{limit:50});
});
it("advances the actual history cursor and preserves earlier human turn references",async()=>{
 let sequence=0;const requests:unknown[]=[];const reader={inspect:async()=>({...snapshot,id:`r${++sequence}`,read:{...snapshot.read!,requestId:`r${sequence}`,sequence}}),history:async(_binding:NativeBinding,request:{cursor?:string;limit:number})=>{requests.push(request);return request.cursor?{...history,entries:[{id:"last",kind:"assistant" as const,text:"last"}]}:{...history,nextCursor:"actual-next"};}};
 const first=await recoverNativeEvents(checkpoint(),reader);const second=await recoverNativeEvents(first.checkpoint,reader);expect(requests).toEqual([{limit:50},{limit:50,cursor:"actual-next"}]);expect(second.checkpoint.history?.entries.map(entry=>entry.id)).toEqual(["human-message","last"]);expect(second).toMatchObject({needsHistory:false,completeness:"complete"});
});
it("keeps earlier provider gaps and truncation when the final page declares complete",async()=>{
 let sequence=0;const reader={inspect:async()=>({...snapshot,id:`r${++sequence}`,read:{...snapshot.read!,requestId:`r${sequence}`,sequence}}),history:async(_binding:NativeBinding,request:{cursor?:string;limit:number})=>request.cursor?{...history,entries:[{id:"last",kind:"assistant" as const,text:"last"}]}:{...history,completeness:"partial" as const,gaps:["missing"],nextCursor:"next"}};
 const first=await recoverNativeEvents(checkpoint(),reader);const second=await recoverNativeEvents(first.checkpoint,reader);expect(second).toMatchObject({needsHistory:true,completeness:"partial"});expect(second.gaps).toContain("PROVIDER_REPORTED_GAP");expect(second.gaps).not.toContain("HISTORY_MORE_PAGES");expect(second.checkpoint.history?.entries[0]?.turnId).toBe("human-turn");
});
it("rejects history with foreign scope, gap or local read correlation",()=>{
 for(const changed of [{scopeFingerprint:"foreign"},{gapGeneration:2},{sequence:2},{requestId:"old-request"},{binding:{...binding,nativeStoreRef:"foreign"}}])expect(reconcileNativeEvents(checkpoint(),snapshot,{...historyRead(),...changed})).toMatchObject({accepted:false,code:"NATIVE_HISTORY_MISMATCH"});
});
it("bounds metadata across pages and keeps an explicit truncation gap",async()=>{
 let sequence=0;const reader={inspect:async()=>({...snapshot,id:`r${++sequence}`,read:{...snapshot.read!,requestId:`r${sequence}`,sequence}}),history:async(_binding:NativeBinding,request:{cursor?:string;limit:number})=>({...history,entries:Array.from({length:60},(_,n)=>({id:`${request.cursor??"first"}-${n}`,kind:"user" as const,text:"private"})),...(!request.cursor?{nextCursor:"next"}:{})})};const first=await recoverNativeEvents(checkpoint(),reader);const second=await recoverNativeEvents(first.checkpoint,reader);expect(second.checkpoint.history?.entries).toHaveLength(100);expect(second.gaps).toContain("HISTORY_METADATA_TRUNCATED");expect(second.needsHistory).toBe(true);
});
it("restarts history range when its native revision changes before the next page",async()=>{
 let sequence=0;const requests:unknown[]=[];const reader={inspect:async()=>({...snapshot,id:`r${++sequence}`,historyRevision:`revision-${sequence}`,read:{...snapshot.read!,requestId:`r${sequence}`,sequence}}),history:async(_binding:NativeBinding,request:{cursor?:string;limit:number})=>{requests.push(request);return request.cursor?{...history,entries:[{id:"tail",kind:"assistant" as const,text:"tail"}]}:{...history,nextCursor:"actual-next"};}};const first=await recoverNativeEvents(checkpoint(),reader);const second=await recoverNativeEvents(first.checkpoint,reader);expect(requests).toEqual([{limit:50},{limit:50}]);expect(second.needsHistory).toBe(true);expect(second.checkpoint.gapGeneration).toBeGreaterThan(first.checkpoint.gapGeneration);
});
it("does not claim a complete multipage range when native revision is unavailable",async()=>{
 let sequence=0;const reader={inspect:async()=>({...snapshot,id:`r${++sequence}`,historyMode:"snapshot-only" as const,historyRevision:undefined,read:{...snapshot.read!,requestId:`r${sequence}`,sequence}}),history:async(_binding:NativeBinding,request:{cursor?:string;limit:number})=>({...history,...(!request.cursor?{nextCursor:"actual-next"}:{})})};const first=await recoverNativeEvents(checkpoint(),reader);const second=await recoverNativeEvents(first.checkpoint,reader);expect(second).toMatchObject({needsHistory:true,completeness:"partial"});expect(second.gaps).toContain("HISTORY_REVISION_UNVERIFIED");
});
it("restarts a paged range when the provider server epoch changes even if revision repeats",async()=>{
 let sequence=0;const requests:unknown[]=[];const reader={inspect:async()=>({...snapshot,id:`r${++sequence}`,serverEpoch:`server-${sequence}`,read:{...snapshot.read!,requestId:`r${sequence}`,sequence}}),history:async(_binding:NativeBinding,request:{cursor?:string;limit:number})=>{requests.push(request);return {...history,nextCursor:"next"};}};const first=await recoverNativeEvents(checkpoint(),reader);const second=await recoverNativeEvents(first.checkpoint,reader);expect(requests).toEqual([{limit:50},{limit:50}]);expect(second.needsHistory).toBe(true);
});
it("preserves v3 command identity, transport replay and ACK while native metadata advances",()=>{
 const directory=mkdtempSync(join(tmpdir(),"dispatcher-journal-coexist-"));const path=join(directory,"journal.sqlite");let journal=new RunnerJournal(path);
 try{
  const envelope={protocolVersion:"1.2" as const,messageId:"heartbeat",traceId:"trace",runnerId:"local",sequence:7,sentAt:at,kind:"event" as const,payload:{type:"runner.heartbeat" as const,runnerId:"local",state:"ONLINE" as const}};
  journal.append(envelope);expect(journal.bindCommand("start","immutable-command-hash")).toBe(true);journal.acknowledge(6);
  const first=recordNativeEvent(checkpoint(),event).checkpoint;journal.saveNativeCheckpoint("dispatcher",first);journal.close();journal=new RunnerJournal(path);
  expect(journal.commandIdentity("start")).toBe("immutable-command-hash");expect(journal.bindCommand("start","different-command-hash")).toBe(false);
  expect(journal.replay().map(entry=>entry.envelope)).toEqual([envelope]);expect(journal.acknowledgedSequence()).toBe(6);
  journal.saveNativeCheckpoint("dispatcher",recordNativeEvent(journal.nativeCheckpoint("dispatcher")!,{...event,id:"next-native-event"}).checkpoint);
  journal.acknowledge(7);expect(journal.compact(0)).toBe(1);expect(journal.nativeCheckpoint("dispatcher")?.seen).toHaveLength(2);expect(journal.commandIdentity("start")).toBe("immutable-command-hash");
 }finally{journal.close();rmSync(directory,{recursive:true,force:true});}
});
