import {existsSync,readFileSync,rmSync} from "node:fs";
import {join} from "node:path";
import {afterEach,expect,it} from "vitest";
import type {ExecutionContextRef,NativeBindingEvent} from "@dispatcher/domain";
import {MemorySessionStore,PiAdapter,type AdapterStartInput} from "../src/index.js";
import * as adapters from "../src/index.js";
import {PiRpcExecutionBackend} from "../src/pi-rpc-execution.js";
import {NativeBindingEvents} from "../src/native-binding-events.js";
import {getInteractionPort} from "../src/interaction-contracts.js";
import {piRpcFixture} from "./fixtures/pi-rpc.js";

const roots:string[]=[],backends:PiRpcExecutionBackend[]=[];
afterEach(async()=>{for(const backend of backends.splice(0))await backend.disconnectLocal();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const executionRef:ExecutionContextRef={version:1,id:"execution-1",kind:"managed-worktree",runnerId:"local",repositoryId:"repository-1",workspaceId:"run-1",pathRef:"workspace:run-1",branch:"codex/run-1",baseRevision:"base-1"};
const wire=(root:string)=>existsSync(join(root,"wire-types"))?readFileSync(join(root,"wire-types"),"utf8").trim().split("\n"):[];
function harness(mode="exec-ok"){
 const fixture=piRpcFixture(roots,mode),scope={...fixture.scope,profileId:"pi-profile",runnerId:"local",nativeStoreRef:"native-store:fixture",scopeFingerprint:"pi-scope"};
 const backend=new PiRpcExecutionBackend({scope,executionRef});backends.push(backend);
 const store=new MemorySessionStore(),adapter=new PiAdapter({id:"pi-profile",alias:"Pi",executable:scope.executable},backend,store);
 const input:AdapterStartInput={runId:"run-1",sessionId:"session-1",backendId:"pi-rpc",workspacePath:scope.workspacePath,prompt:"literal task",executionRef:structuredClone(executionRef),execution:{generation:1,attempt:1,leaseId:"lease-1"},beforeCreate:()=>undefined,beforeSend:()=>undefined,executionSelection:{version:1,mode:"legacy",selectionType:"explicit-model",source:"legacy-config",profileId:"pi-profile",providerId:"pi",backendId:"pi-rpc",runnerId:"local",configRevision:1,contextFingerprint:"frozen-catalog-scope",selectedAt:"2026-10-13T10:00:00Z",requestedModel:`fixture/${mode}`,nativeParameters:{}}};
 const events:NativeBindingEvent[]=[];let current=true;
 const sink=(event:NativeBindingEvent)=>{events.push(structuredClone(event));};
 return {...fixture,backend,store,adapter,input,events,sink,revoke:()=>{current=false;},onBegin:()=>()=>current};
}
it("selects the injected RPC backend through PiAdapter without enabling continuation or native stop",async()=>{
 const f=harness();expect(f.adapter.legacyInvocationDefaults().backendId).toBe("pi-rpc");expect(getInteractionPort(f.adapter)).toBeUndefined();expect(new PiAdapter({id:"print",alias:"Print"}).manifest.backends.map(backend=>backend.id)).toEqual(["pi-cli-json"]);
 const manifest=f.adapter.manifest.backends.find(value=>value.id==="pi-rpc");expect(manifest?.capabilities).toContain("start");expect(manifest?.capabilities).not.toContain("send");expect(manifest?.capabilities).not.toContain("cancel");expect(f.adapter.manifest.capabilities.resume).toBe(false);expect(f.adapter.manifest.backends.some(backend=>backend.capabilities.includes("cancel")||backend.capabilities.includes("send"))).toBe(false);
 f.adapter.setNativeEventSink(f.sink,f.onBegin);
 const session=await f.adapter.start(f.input);expect(session).toMatchObject({id:"session-1",backendId:"pi-rpc",executionRef,executionSelection:f.input.executionSelection,nativeBinding:{product:"pi",backendId:"pi-rpc",executionRefId:"execution-1"}});
 expect(session.providerSessionId).toMatch(/^[a-f0-9-]{36}$/i);expect(session.nativeBinding?.nativeSessionId).toBe(session.providerSessionId);
 expect(await f.adapter.result(session.id)).toMatchObject({state:"COMPLETED",summary:"native answer"});
 await expect(f.adapter.send(session.id,"next")).rejects.toMatchObject({code:"UNSUPPORTED_CAPABILITY"});
 await expect(f.adapter.cancel(session.id)).rejects.toMatchObject({code:"PI_RPC_STOP_UNQUALIFIED"});
 expect(adapters.PiRpcExecutionBackend).toBe(PiRpcExecutionBackend);
});
it("persists and relays scoped native binding before prompt and merges the native turn facts",async()=>{
 const f=harness();f.adapter.setNativeEventSink(event=>{
  if(f.events.length===0){expect(existsSync(join(f.root,"prompt-input"))).toBe(false);expect(f.store.load("session-1")?.nativeBinding).toEqual(event.nativeBinding);}
  f.sink(event);
 },context=>{expect(context).toMatchObject({sessionId:"session-1",runId:"run-1",profileId:"pi-profile",backendId:"pi-rpc",generation:1,attempt:1,leaseId:"lease-1"});expect(f.store.load("session-1")?.nativeInvocationId).toBe(context.invocationId);return f.onBegin();});
 const session=await f.adapter.start(f.input);await f.adapter.result(session.id);
 expect(f.events.map(event=>event.turn.state)).toEqual(expect.arrayContaining(["received","running","completed"]));
 expect(f.store.load(session.id)?.turnObservation?.state).toBe("completed");expect(new Set(f.events.map(event=>event.turn.invocationId)).size).toBe(1);
 expect(f.backend.source(session.nativeBinding!)?.capabilities().sameSessionContinue.support).toBe("unknown");
 expect(f.backend.source({...session.nativeBinding!,executionRefId:"wrong"})).toBeUndefined();
});
it.each(["executionRef","execution","sessionId","beforeCreate","beforeSend","executionSelection"] as const)("rejects missing %s before native probing",async field=>{
 const f=harness();f.adapter.setNativeEventSink(f.sink,f.onBegin);delete f.input[field];
 await expect(f.adapter.start(f.input)).rejects.toMatchObject({creationOutcome:"not-created"});expect(existsSync(join(f.root,"environment.jsonl"))).toBe(false);
});
it("rejects an unregistered observer before native probing",async()=>{const f=harness();await expect(f.adapter.start(f.input)).rejects.toMatchObject({creationOutcome:"not-created",code:"NATIVE_OBSERVER_UNAVAILABLE"});expect(existsSync(join(f.root,"environment.jsonl"))).toBe(false);});
it.each(["beforeCreate","beforeSend"] as const)("rejects asynchronous %s before native probing",async field=>{
 const f=harness();f.adapter.setNativeEventSink(f.sink,f.onBegin);f.input[field]=async()=>undefined;
 await expect(f.adapter.start(f.input)).rejects.toMatchObject({creationOutcome:"not-created"});expect(existsSync(join(f.root,"environment.jsonl"))).toBe(false);
});
it.each(["profileId","providerId","backendId","runnerId"] as const)("rejects an execution selection for another %s before probing",async field=>{
 const f=harness();f.adapter.setNativeEventSink(f.sink,f.onBegin);f.input.executionSelection![field]="wrong";
 await expect(f.adapter.start(f.input)).rejects.toMatchObject({creationOutcome:"not-created"});expect(existsSync(join(f.root,"environment.jsonl"))).toBe(false);
});
it("rejects a foreign execution reference before probing",async()=>{
 const f=harness();f.adapter.setNativeEventSink(f.sink,f.onBegin);f.input.executionRef={...executionRef,id:"wrong"};
 await expect(f.adapter.start(f.input)).rejects.toMatchObject({creationOutcome:"not-created",code:"PI_RPC_SCOPE_CHANGED"});expect(existsSync(join(f.root,"environment.jsonl"))).toBe(false);
});
it("rechecks observer authority after binding persistence before sending prompt",async()=>{
 const f=harness();f.adapter.setNativeEventSink(event=>{f.sink(event);f.revoke();},f.onBegin);
 await expect(f.adapter.start(f.input)).rejects.toMatchObject({creationOutcome:"unknown"});expect(existsSync(join(f.root,"prompt-input"))).toBe(false);expect(wire(f.root)).toEqual(["get_state"]);expect(f.store.load("session-1")?.nativeIdentityIssue).toBeUndefined();
});
it("preserves unknown binding failure and refuses a duplicate creation attempt",async()=>{
 const f=harness();f.adapter.setNativeEventSink(()=>{throw Error("private sink failure");},f.onBegin);
 await expect(f.adapter.start(f.input)).rejects.toMatchObject({creationOutcome:"unknown",code:"PI_RPC_BINDING_PERSISTENCE_UNKNOWN"});
 await expect(f.adapter.start(f.input)).rejects.toMatchObject({creationOutcome:"not-created",code:"SESSION_ID_CONFLICT"});
 expect(wire(f.root)).toEqual(["get_state"]);expect(existsSync(join(f.root,"prompt-input"))).toBe(false);expect(f.store.load("session-1")?.state).toBe("STARTING");
});
it("freezes the caller selection and execution reference across native startup",async()=>{
 const f=harness();f.adapter.setNativeEventSink(f.sink,f.onBegin);const start=f.adapter.start(f.input);
 f.input.executionRef={...executionRef,id:"mutated"};f.input.executionSelection!.requestedModel="wrong/model";
 const session=await start;expect(session.executionRef).toEqual(executionRef);expect(session.executionSelection?.requestedModel).toBe("fixture/exec-ok");expect(await f.adapter.result(session.id)).toMatchObject({state:"COMPLETED"});
});

it("records observer registration failure as known not-created without native probing",async()=>{
 const f=harness();f.adapter.setNativeEventSink(f.sink,()=>{throw Error("registration persistence failed");});
 await expect(f.adapter.start(f.input)).rejects.toMatchObject({creationOutcome:"not-created"});
 expect(existsSync(join(f.root,"environment.jsonl"))).toBe(false);expect(wire(f.root)).toEqual([]);
});
it("retains event persistence uncertainty across observer recreation",async()=>{
 const f=harness();f.adapter.setNativeEventSink(()=>{throw Error("sink persistence failed");},f.onBegin);
 await expect(f.adapter.start(f.input)).rejects.toMatchObject({creationOutcome:"unknown"});
 expect(f.store.load("session-1")?.nativeIdentityIssue).toBe("NATIVE_EVENT_PERSISTENCE_FAILED");
 const observer=new NativeBindingEvents(f.store);observer.setSink(f.sink,f.onBegin);
 expect(()=>observer.begin("session-1")).toThrowError(expect.objectContaining({code:"NATIVE_EVENT_PERSISTENCE_FAILED"}));
 expect(existsSync(join(f.root,"prompt-input"))).toBe(false);
});
it("retains a failed sink after authority is revoked for the same invocation",async()=>{
 const f=harness();f.adapter.setNativeEventSink(async()=>{f.revoke();throw Error("sink persistence failed after authority changed");},f.onBegin);
 await expect(f.adapter.start(f.input)).rejects.toMatchObject({creationOutcome:"unknown"});
 expect(f.store.load("session-1")?.nativeIdentityIssue).toBe("NATIVE_EVENT_PERSISTENCE_FAILED");
 const observer=new NativeBindingEvents(f.store);observer.setSink(f.sink,()=>()=>true);
 expect(()=>observer.begin("session-1")).toThrowError(expect.objectContaining({code:"NATIVE_EVENT_PERSISTENCE_FAILED"}));
 expect(existsSync(join(f.root,"prompt-input"))).toBe(false);
});
it("qualifies execution references only for the guarded Pi RPC adapter",()=>{
 const f=harness();expect(f.adapter.supportsExecutionRef).toBe(true);
 expect(new PiAdapter({id:"pi-profile",alias:"Pi"}).supportsExecutionRef).toBe(false);
});
it("rejects a native event with no session identity before projecting it",async()=>{
 const store=new MemorySessionStore();store.save({id:"session-1",runId:"run-1",profileId:"pi-profile",backendId:"pi-rpc",workspacePath:"/fixture",legacyModel:{},state:"STARTING",createdAt:"2026-10-22T00:00:00Z",updatedAt:"2026-10-22T00:00:00Z",execution:{generation:1,attempt:1,leaseId:"lease-1"}});
 const observer=new NativeBindingEvents(store),events:NativeBindingEvent[]=[];observer.setSink(event=>{events.push(event);},()=>()=>true);
 await expect(observer.begin("session-1")({state:"waiting",observedAt:"2026-10-22T00:00:00Z"})).rejects.toMatchObject({code:"INVALID_NATIVE_EVENT"});
 expect(events).toEqual([]);expect(store.load("session-1")?.turnObservation).toBeUndefined();
});

it("does not let a late observer failure poison its replacement invocation",async()=>{
 const f=harness();f.adapter.setNativeEventSink(f.sink,f.onBegin);const session=await f.adapter.start(f.input);await f.adapter.result(session.id);
 const observers=new NativeBindingEvents(f.store);observers.setSink(f.sink,f.onBegin);
 const previous=observers.begin(session.id),current=observers.begin(session.id),before=f.store.load(session.id)!;
 await expect(previous({state:"running",nativeSessionId:session.providerSessionId!,observedAt:"2026-10-22T00:00:00Z"})).rejects.toMatchObject({code:"STALE_NATIVE_OBSERVER"});
 expect(f.store.load(session.id)).toEqual(before);
 await expect(current({state:"running",nativeSessionId:session.providerSessionId!,observedAt:"2026-10-22T00:00:01Z"})).resolves.toBeUndefined();
});
