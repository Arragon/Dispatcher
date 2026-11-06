import { afterEach, expect, it, vi } from "vitest";
import type { NativeBinding, NativeObservation } from "@dispatcher/domain";
import { NativeRuntime } from "../src/native-observation.js";

const binding:NativeBinding={version:1,product:"codex",region:"global",profileId:"p",backendId:"native",runnerId:"local",nativeStoreRef:"opaque-store",nativeSessionId:"native",executionRefId:"execution",identityState:"bound"};
const observation=(state:NativeObservation["state"]="running"):NativeObservation=>({version:1,id:"native-observation",nativeSessionId:"native",scopeFingerprint:"scope",observedAt:"2026-10-07T18:00:00Z",serverEpoch:"actual-server",state,pendingTools:"unknown",pendingApprovals:"unknown",historyMode:"unknown"});
function handle(inspect:()=>Promise<NativeObservation>){return {binding,scopeFingerprint:"scope",inspect,processState:()=>"running" as const,result:vi.fn(()=>new Promise(()=>{})),send:vi.fn(),resume:vi.fn(),cancel:vi.fn()};}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
afterEach(()=>vi.useRealTimers());

it("inspects a long turn without awaiting its result or sending any prompt",async()=>{
 const runtime=new NativeRuntime();const source=handle(async()=>observation());const connection=runtime.connect(source);expect(await runtime.inspect(connection)).toMatchObject({nativeSessionId:"native",state:"running",serverEpoch:"actual-server",read:{processState:"running",readability:"readable",observerGeneration:1,sequence:1}});expect(source.result).not.toHaveBeenCalled();expect(source.send).not.toHaveBeenCalled();expect(source.resume).not.toHaveBeenCalled();expect(source.cancel).not.toHaveBeenCalled();
});
it("does not infer native idle or deleted history from a missing process handle",async()=>{
 const runtime=new NativeRuntime();const connection=runtime.connect({...handle(async()=>observation("unknown")),processState:()=>"missing" as const});expect(await runtime.inspect(connection)).toMatchObject({nativeSessionId:"native",state:"unknown",read:{processState:"missing",readability:"unknown"}});
});
it("times out an uncooperative native read without losing identity or stopping execution",async()=>{
 vi.useFakeTimers();const runtime=new NativeRuntime();const source=handle(()=>new Promise(()=>{}));const connection=runtime.connect(source);const pending=runtime.inspect(connection,{timeoutMs:20});await vi.advanceTimersByTimeAsync(21);expect(await pending).toMatchObject({nativeSessionId:"native",scopeFingerprint:"scope",state:"unreachable",pendingTools:"unknown",read:{reasonCode:"NATIVE_READ_TIMEOUT"}});expect(source.cancel).not.toHaveBeenCalled();
});
it("correlates reads and aborts only the read when the caller cancels",async()=>{
 const runtime=new NativeRuntime();let request:{requestId:string;sequence:number;observerEpoch:string;signal:AbortSignal}|undefined;const connection=runtime.connect({...handle(()=>new Promise(()=>{})),inspect:async(input:typeof request)=>{request=input;return new Promise(()=>{});}});const abort=new AbortController();const pending=runtime.inspect(connection,{signal:abort.signal});await Promise.resolve();abort.abort();expect(await pending).toMatchObject({nativeSessionId:"native",state:"unknown",read:{reasonCode:"NATIVE_READ_CANCELLED",requestId:request!.requestId,sequence:1,observerEpoch:request!.observerEpoch}});expect(request?.signal.aborted).toBe(true);
});
it("rejects a superseded connection even if its late idle read finishes",async()=>{
 const old=deferred<NativeObservation>();const runtime=new NativeRuntime();const previous=runtime.connect(handle(()=>old.promise));const pending=runtime.inspect(previous);await Promise.resolve();const current=runtime.connect(handle(async()=>observation("running")));const accepted=await runtime.inspect(current);old.resolve(observation("idle"));expect(await pending).toMatchObject({state:"unknown",read:{reasonCode:"STALE_NATIVE_OBSERVER"}});expect(runtime.latest(binding)).toEqual(accepted);expect(accepted.read?.observerGeneration).toBe(2);
});
it("cannot overwrite a newer response with an older request on the same connection",async()=>{
 const older=deferred<NativeObservation>();let calls=0;const runtime=new NativeRuntime();const connection=runtime.connect(handle(()=>++calls===1?older.promise:Promise.resolve(observation("running"))));const pending=runtime.inspect(connection);const current=await runtime.inspect(connection);older.resolve(observation("idle"));expect(await pending).toMatchObject({state:"unknown",read:{reasonCode:"STALE_NATIVE_READ"}});expect(runtime.latest(binding)).toEqual(current);expect(current.read?.sequence).toBe(2);
});
it("rejects foreign native identity or scope without accepting an observation",async()=>{
 for(const changed of [{nativeSessionId:"foreign"},{scopeFingerprint:"foreign"}]){const runtime=new NativeRuntime();const connection=runtime.connect(handle(async()=>({...observation("idle"),...changed})));expect(await runtime.inspect(connection)).toMatchObject({nativeSessionId:"native",scopeFingerprint:"scope",state:"unknown",read:{reasonCode:"NATIVE_OBSERVATION_MISMATCH"}});expect(runtime.latest(binding)?.state).toBe("unknown");}
});
it("preserves a positively deleted session independently of process liveness",async()=>{
 const runtime=new NativeRuntime();const connection=runtime.connect(handle(async()=>observation("deleted")));expect(await runtime.inspect(connection)).toMatchObject({nativeSessionId:"native",state:"deleted",read:{processState:"running",readability:"deleted"}});
});
it("disconnect cancels pending reads without calling the native execution cancel method",async()=>{
 const runtime=new NativeRuntime();const source=handle(()=>new Promise(()=>{}));const connection=runtime.connect(source);const pending=runtime.inspect(connection);await Promise.resolve();runtime.disconnect(connection);expect(await pending).toMatchObject({state:"unknown",read:{reasonCode:"STALE_NATIVE_OBSERVER"}});expect(source.cancel).not.toHaveBeenCalled();
});

it("assigns a distinct local observation ID per read while preserving source observation provenance",async()=>{
 const runtime=new NativeRuntime();const connection=runtime.connect(handle(async()=>observation()));const first=await runtime.inspect(connection);const second=await runtime.inspect(connection);expect(first.id).not.toBe(second.id);expect(first.id).toBe(first.read?.requestId);expect(second.read?.sourceObservationId).toBe("native-observation");
});
it("does not retain unrecognized provider fields in normalized observations",async()=>{
 const runtime=new NativeRuntime();const connection=runtime.connect(handle(async()=>({...observation(),rawDiagnostics:"provider-debug"})));expect(await runtime.inspect(connection)).not.toHaveProperty("rawDiagnostics");
});
it("seeds the observer generation from durable state and rejects a stale explicit generation",async()=>{
 const runtime=new NativeRuntime();const first=runtime.connect(handle(async()=>observation()),{observerGeneration:5});expect((await runtime.inspect(first)).read?.observerGeneration).toBe(5);expect(()=>runtime.connect(handle(async()=>observation()),{observerGeneration:5})).toThrowError("STALE_NATIVE_OBSERVER");expect(runtime.latest({...binding,profileId:"foreign"})).toBeUndefined();
});

it("a timed-out late response cannot replace the unreachable checkpoint",async()=>{
 vi.useFakeTimers();const late=deferred<NativeObservation>();const runtime=new NativeRuntime();const connection=runtime.connect(handle(()=>late.promise));const pending=runtime.inspect(connection,{timeoutMs:10});await vi.advanceTimersByTimeAsync(11);const timedOut=await pending;late.resolve(observation("idle"));await Promise.resolve();expect(runtime.latest(binding)).toEqual(timedOut);
});
it("a pre-cancelled request never invokes the reader and provider errors do not leak diagnostics",async()=>{
 const abort=new AbortController();abort.abort();const inspect=vi.fn(async()=>{throw new Error("credential-private-detail");});const runtime=new NativeRuntime();const connection=runtime.connect(handle(inspect));expect(await runtime.inspect(connection,{signal:abort.signal})).toMatchObject({state:"unknown",read:{reasonCode:"NATIVE_READ_CANCELLED"}});expect(inspect).not.toHaveBeenCalled();expect(JSON.stringify(await runtime.inspect(connection))).not.toContain("credential-private-detail");expect(runtime.latest(binding)).toMatchObject({state:"unreachable",read:{reasonCode:"NATIVE_READ_FAILED"}});
});

it("preserves proven session readability independently of unknown native activity",async()=>{
 const runtime=new NativeRuntime();const connection=runtime.connect(handle(async()=>({...observation("unknown"),readability:"readable" as const,historyMode:"snapshot-only",historyRevision:"known-history"})));expect(await runtime.inspect(connection)).toMatchObject({state:"unknown",readability:"readable",historyRevision:"known-history",read:{readability:"readable"}});
});

it("cannot publish idle authority when session readability is negative or contradictory",async()=>{
 for(const readability of ["deleted","unreachable"] as const){const runtime=new NativeRuntime();const connection=runtime.connect(handle(async()=>({...observation("idle"),readability})));expect(await runtime.inspect(connection)).toMatchObject({state:"unknown",read:{reasonCode:"NATIVE_OBSERVATION_MISMATCH"}});}
 const runtime=new NativeRuntime();const connection=runtime.connect(handle(async()=>({...observation("idle"),readability:"readable",read:{requestId:"source",observerEpoch:"source",observerGeneration:1,sequence:1,processState:"running",readability:"unreachable"}})));expect((await runtime.inspect(connection)).state).toBe("unknown");
});
