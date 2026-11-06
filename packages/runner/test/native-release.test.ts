import { expect, it, vi } from "vitest";
import type { InteractionCapabilities, NativeBinding, NativeObservation, ReleaseEvidence, ReleaseRequest } from "@dispatcher/domain";
import { NativeRuntime } from "../src/native-observation.js";
import { releaseNativeControl, verifyQuiescence, type NativeQuiescenceRuntime, type NativeReleaseSource } from "../src/native-quiescence.js";
const at="2026-10-07T18:00:00Z";
const binding:NativeBinding={version:1,product:"opencode",region:"global",profileId:"p",backendId:"serve",runnerId:"local",nativeStoreRef:"store",nativeSessionId:"native",executionRefId:"execution",identityState:"bound"};
const observation:NativeObservation={version:1,id:"idle",nativeSessionId:"native",scopeFingerprint:"scope",observedAt:at,state:"idle",pendingTools:"none",pendingApprovals:"none",historyMode:"native-revision",executionRefId:"execution",read:{requestId:"idle",observerEpoch:"reader",observerGeneration:2,sequence:1,processState:"running",readability:"readable"}};
const evidence={version:1 as const,support:"supported" as const,level:"runtime-verified" as const,scopeFingerprint:"scope",evidenceRef:"proof",verifiedAt:at};
const runtime:NativeQuiescenceRuntime={version:1,binding,scopeFingerprint:"scope",observationRef:"idle",pendingCommands:"none",backgroundTools:"none",readProof:{kind:"live-native-read",requestId:"idle",evidence},processScope:{kind:"native-service",state:"quiescent",evidence},host:{id:"host",ownership:"owned",shared:false,releaseBoundary:"session"},evidence};
const request:ReleaseRequest={commandId:"release",fence:{runId:"run",sessionId:"session",commandId:"release",generation:1,leaseId:"lease",expectedTaskRevision:1,expectedCurrentRunId:"run",expectedControlRevision:2,expectedControlEpoch:2},settlePolicy:"wait"};
function fixture(){
 let sequence=0;const read=vi.fn(async(_binding:NativeBinding,probe:{signal:AbortSignal;requestId:string})=>{const id=`read-${++sequence}`;return {observation:{...structuredClone(observation),id,read:{...observation.read!,requestId:id,sequence}},runtime:{...structuredClone(runtime),observationRef:id,readProof:{...runtime.readProof,requestId:probe.requestId}}};});
 const release=vi.fn(async():Promise<ReleaseEvidence>=>({version:1,nativeSessionId:"native",quiescent:true,pendingCommands:"none",lockReleased:"confirmed",exclusion:"native-enforced",observation:structuredClone(observation)}));
 const source:NativeReleaseSource={binding,scopeFingerprint:"scope",port:{capabilities:()=>({version:1,releaseControl:evidence}) as InteractionCapabilities,release},inspectQuiescence:read};
 const assertCurrent=vi.fn();return {source,read,release,assertCurrent};
}
it("checks native turn, approval, queues, tools and independently qualified process scope",()=>{
 expect(verifyQuiescence(observation,runtime)).toMatchObject({quiescent:true,pendingCommands:"none"});
 for(const changed of [{state:"running",activeTurnId:"turn"},{pendingApprovals:"present"},{pendingTools:"unknown"},{state:"idle",activeTurnId:"old-turn"}] as const)expect(verifyQuiescence({...observation,...changed},runtime).quiescent).toBe(false);
 for(const changed of [{pendingCommands:"present"},{backgroundTools:"present"},{backgroundTools:"unknown"},{processScope:{kind:"native-service",state:"unknown",evidence}},{processScope:{kind:"owned-process-group",state:"empty",evidence:{...evidence,support:"unknown"}}}] as const)expect(verifyQuiescence(observation,{...runtime,...changed}).quiescent).toBe(false);
});
it("unsubscribe_not_automatically_lock_release",async()=>{
 const f=fixture();f.release.mockResolvedValue({version:1,nativeSessionId:"native",quiescent:true,pendingCommands:"none",lockReleased:"unknown",exclusion:"native-enforced",observation});expect(await releaseNativeControl(binding,"native-enforced",request,f.source,f.assertCurrent)).toMatchObject({quiescent:false,lockReleased:"unknown",dispatch:"acknowledged"});expect(f.release).toHaveBeenCalledOnce();
});
it("background_tool_blocks_release and pending_prompt_not_silently_resumed",async()=>{
 for(const field of ["backgroundTools","pendingCommands"] as const){const f=fixture();f.read.mockResolvedValue({observation,runtime:{...runtime,[field]:"present"}});expect(await releaseNativeControl(binding,"native-enforced",request,f.source,f.assertCurrent)).toMatchObject({quiescent:false,dispatch:"not-sent"});expect(f.release).not.toHaveBeenCalled();}
});
it("cannot_kill_shared_host or a user's external host",async()=>{
 for(const host of [{...runtime.host,shared:true,releaseBoundary:"host" as const},{...runtime.host,ownership:"external" as const,releaseBoundary:"host" as const},{...runtime.host,shared:"unknown" as const,releaseBoundary:"host" as const}]){const f=fixture();f.read.mockImplementation(async(_binding,probe)=>({observation,runtime:{...runtime,host,readProof:{...runtime.readProof,requestId:probe.requestId}}}));expect(await releaseNativeControl(binding,"native-enforced",request,f.source,f.assertCurrent)).toMatchObject({quiescent:false,dispatch:"not-sent",reasonCode:"NATIVE_HOST_RELEASE_UNSAFE"});expect(f.release).not.toHaveBeenCalled();}
 const safe=fixture();let sequence=0;safe.read.mockImplementation(async(_binding,probe)=>{const id=`shared-${++sequence}`;return {observation:{...observation,id,read:{...observation.read!,requestId:id,sequence}},runtime:{...runtime,observationRef:id,host:{...runtime.host,shared:true},readProof:{...runtime.readProof,requestId:probe.requestId}}};});expect(await releaseNativeControl(binding,"native-enforced",request,safe.source,safe.assertCurrent)).toMatchObject({quiescent:true,lockReleased:"confirmed"});
});
it("cooperative_never_claims_native_lock",async()=>{
 const f=fixture();f.release.mockResolvedValue({version:1,nativeSessionId:"native",quiescent:true,pendingCommands:"none",lockReleased:"confirmed",exclusion:"cooperative",observation});expect(await releaseNativeControl(binding,"cooperative",request,f.source,f.assertCurrent)).toMatchObject({quiescent:true,exclusion:"cooperative",lockReleased:"unsupported"});
});
it("requires exact identity and scoped runtime capability before release",async()=>{
 const f=fixture();expect(await releaseNativeControl({...binding,nativeSessionId:"foreign"},"native-enforced",request,f.source,f.assertCurrent)).toMatchObject({dispatch:"not-sent",quiescent:false});expect(f.release).not.toHaveBeenCalled();
 f.source.port.capabilities=()=>({version:1,releaseControl:{...evidence,scopeFingerprint:"foreign"}}) as InteractionCapabilities;expect(await releaseNativeControl(binding,"native-enforced",request,f.source,f.assertCurrent)).toMatchObject({dispatch:"not-sent",quiescent:false});expect(f.read).not.toHaveBeenCalled();
 expect(verifyQuiescence({...observation,executionRefId:"changed"},runtime).quiescent).toBe(false);expect(verifyQuiescence(observation,{...runtime,observationRef:"other"}).quiescent).toBe(false);
});
it("requires fresh post-release quiescence and cannot borrow pre-release idle",async()=>{
 const f=fixture();let calls=0;f.read.mockImplementation(async(_binding,probe)=>++calls===1?{observation,runtime:{...runtime,readProof:{...runtime.readProof,requestId:probe.requestId}}}:{observation:{...observation,id:"after",state:"running",activeTurnId:"new"},runtime:{...runtime,observationRef:"after",readProof:{...runtime.readProof,requestId:probe.requestId}}});expect(await releaseNativeControl(binding,"native-enforced",request,f.source,f.assertCurrent)).toMatchObject({quiescent:false,dispatch:"acknowledged"});expect(f.read).toHaveBeenCalledTimes(2);
});
it("fences after the read await before any release call",async()=>{
 const f=fixture();let current=true;f.read.mockImplementation(async()=>{current=false;return {observation,runtime};});const guard=()=>{if(!current)throw new Error("stale authority");};expect(await releaseNativeControl(binding,"native-enforced",request,f.source,guard)).toMatchObject({dispatch:"not-sent",quiescent:false});expect(f.release).not.toHaveBeenCalled();
});
it("does not send after a timed-out read later resolves and cleans its timer",async()=>{
 vi.useFakeTimers();const f=fixture();const held=Promise.withResolvers<{observation:NativeObservation;runtime:NativeQuiescenceRuntime}>();f.read.mockImplementation(()=>held.promise);
 try{const result=releaseNativeControl(binding,"native-enforced",request,f.source,f.assertCurrent,100);await vi.advanceTimersByTimeAsync(101);expect(await result).toMatchObject({dispatch:"not-sent",quiescent:false,reasonCode:"NATIVE_RELEASE_TIMEOUT"});held.resolve({observation,runtime});await vi.advanceTimersByTimeAsync(1);expect(f.release).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);}finally{vi.useRealTimers();}
});
it("keeps a lost release outcome unknown, ignores late payload and never stops another session",async()=>{
 vi.useFakeTimers();const f=fixture();const held=Promise.withResolvers<ReleaseEvidence>();f.release.mockImplementation(()=>held.promise);
 try{const result=releaseNativeControl(binding,"native-enforced",request,f.source,f.assertCurrent,100);await vi.advanceTimersByTimeAsync(101);expect(await result).toMatchObject({dispatch:"unknown",quiescent:false,lockReleased:"unknown"});held.resolve({version:1,nativeSessionId:"native",quiescent:true,pendingCommands:"none",lockReleased:"confirmed",exclusion:"native-enforced",observation});await vi.advanceTimersByTimeAsync(1);expect(f.read).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);}finally{vi.useRealTimers();}
});
it("whitelists release/observation fields and rejects mismatched native release evidence",async()=>{
 const f=fixture();f.release.mockResolvedValue({version:1,nativeSessionId:"foreign",quiescent:true,pendingCommands:"none",lockReleased:"confirmed",exclusion:"native-enforced",observation,debug:"private-error"} as ReleaseEvidence);const result=await releaseNativeControl(binding,"native-enforced",request,f.source,f.assertCurrent);expect(result).toMatchObject({quiescent:false});expect(JSON.stringify(result)).not.toContain("private-error");
});
it("does not accept a reused pre-release read as fresh post-release evidence",async()=>{
 const f=fixture();f.read.mockImplementation(async(_binding,probe)=>({observation,runtime:{...runtime,readProof:{...runtime.readProof,requestId:probe.requestId}}}));expect(await releaseNativeControl(binding,"native-enforced",request,f.source,f.assertCurrent)).toMatchObject({quiescent:false,reasonCode:"STALE_NATIVE_RELEASE_READ"});
});
it("does not disclose unqualified runtime metadata or accept a missing lock outcome",async()=>{
 expect(JSON.stringify(verifyQuiescence(observation,{...runtime,binding:{...binding,nativeSessionId:"access_token=private"},scopeFingerprint:"client_secret=private",pendingCommands:"private" as "unknown"}))).not.toContain("private");
 const f=fixture();f.release.mockResolvedValue({version:1,nativeSessionId:"native",quiescent:true,pendingCommands:"none",exclusion:"cooperative",observation} as ReleaseEvidence);expect(await releaseNativeControl(binding,"cooperative",request,f.source,f.assertCurrent)).toMatchObject({quiescent:false});
});
it("rechecks release qualification after the awaited read before dispatch",async()=>{
 const f=fixture();const inspect=f.read.getMockImplementation()!;f.read.mockImplementation(async(ref,probe)=>{const result=await inspect(ref,probe);f.source.port.capabilities=()=>({version:1,releaseControl:{...evidence,support:"unsupported"}}) as InteractionCapabilities;return result;});expect(await releaseNativeControl(binding,"native-enforced",request,f.source,f.assertCurrent)).toMatchObject({quiescent:false,dispatch:"not-sent",reasonCode:"NATIVE_CAPABILITY_UNVERIFIED"});expect(f.release).not.toHaveBeenCalled();
});
it("rejects a malformed fence or unversioned release capability before probing",async()=>{
 const f=fixture();expect(await releaseNativeControl(binding,"native-enforced",{...request,fence:{...request.fence,expectedControlEpoch:0}},f.source,f.assertCurrent)).toMatchObject({quiescent:false,dispatch:"not-sent",reasonCode:"INVALID_NATIVE_RELEASE"});expect(f.read).not.toHaveBeenCalled();f.source.port.capabilities=()=>({version:2,releaseControl:evidence}) as unknown as InteractionCapabilities;expect(await releaseNativeControl(binding,"native-enforced",request,f.source,f.assertCurrent)).toMatchObject({quiescent:false,dispatch:"not-sent",reasonCode:"NATIVE_CAPABILITY_UNVERIFIED"});expect(f.read).not.toHaveBeenCalled();
});

it("does not mistake NativeRuntime local IDs for qualified live native read proof",async()=>{
 const f=fixture();const reader=new NativeRuntime();const token=reader.connect({binding,scopeFingerprint:"scope",inspect:async()=>({...observation,id:"cached-native-snapshot",observedAt:"2026-10-01T00:00:00Z"})});f.read.mockImplementation(async()=>{const observed=await reader.inspect(token);return {observation:observed,runtime:{...runtime,observationRef:observed.id}};});expect(await releaseNativeControl(binding,"native-enforced",request,f.source,f.assertCurrent)).toMatchObject({quiescent:false,dispatch:"not-sent",reasonCode:"NATIVE_READ_FRESHNESS_UNVERIFIED"});expect(f.release).not.toHaveBeenCalled();reader.disconnect(token);
});
it("requires separately qualified correlated live read proof and preserves source provenance",async()=>{
 const f=fixture();const inspect=f.read.getMockImplementation()!;f.read.mockImplementation(async(ref,probe)=>{const result=await inspect(ref,probe);return {...result,runtime:{...result.runtime,readProof:{...result.runtime.readProof,evidence:{...evidence,support:"unknown"}}}};});expect(await releaseNativeControl(binding,"native-enforced",request,f.source,f.assertCurrent)).toMatchObject({quiescent:false,dispatch:"not-sent"});expect(f.release).not.toHaveBeenCalled();
 const live=fixture();const read=live.read.getMockImplementation()!;live.read.mockImplementation(async(ref,probe)=>{const result=await read(ref,probe);return {...result,observation:{...result.observation,historyRevision:"unchanged-idle",read:{...result.observation.read!,sourceObservationId:"native-rpc-snapshot"}}};});expect(await releaseNativeControl(binding,"native-enforced",request,live.source,live.assertCurrent)).toMatchObject({quiescent:true,observation:{historyRevision:"unchanged-idle",read:{sourceObservationId:"native-rpc-snapshot"}}});
});
it("does not disclose invalid binding or request metadata in rejection evidence",async()=>{
 const f=fixture();const unsafe={...binding,nativeSessionId:"access_token=private",executionRefId:"client_secret=private",nativeThreadId:"Bearer private"};f.source.binding=unsafe;f.source.scopeFingerprint="password=private";expect(JSON.stringify(await releaseNativeControl(unsafe,"native-enforced",{...request,commandId:"authorization=private"},f.source,f.assertCurrent))).not.toContain("private");expect(f.release).not.toHaveBeenCalled();
});
it("never qualifies a replacement endpoint while invoking the captured old release",async()=>{
 const f=fixture();const inspect=f.read.getMockImplementation()!;const old=f.source.port;let supported=true;old.capabilities=()=>({version:1,releaseControl:{...evidence,support:supported?"supported":"unsupported"}}) as InteractionCapabilities;const replacement=vi.fn(async()=>f.release());f.read.mockImplementation(async(ref,probe)=>{const result=await inspect(ref,probe);supported=false;f.source.port={capabilities:()=>({version:1,releaseControl:evidence}) as InteractionCapabilities,release:replacement};return result;});expect(await releaseNativeControl(binding,"native-enforced",request,f.source,f.assertCurrent)).toMatchObject({quiescent:false,dispatch:"not-sent",reasonCode:"NATIVE_RELEASE_SCOPE_CHANGED"});expect(f.release).not.toHaveBeenCalled();expect(replacement).not.toHaveBeenCalled();
});
