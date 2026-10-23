import {expect,it} from "vitest";
import type {NativeBinding,NativeBindingEvent} from "@dispatcher/domain";
import type {AdapterSession} from "../src/contracts.js";
import {MemorySessionStore} from "../src/generic.js";
import {NativeBindingEvents} from "../src/native-binding-events.js";

const at="2026-10-23T00:00:00Z";
function fixture(input:Partial<AdapterSession>={}){
 const store=new MemorySessionStore(),session:AdapterSession={id:"session",runId:"run",profileId:"profile",backendId:"codex-app-server",workspacePath:"/workspace",state:"STARTING",legacyModel:{},createdAt:at,updatedAt:at,execution:{generation:1,attempt:1,leaseId:"lease"},executionRef:{version:1,id:"execution",kind:"managed-worktree",runnerId:"local",repositoryId:"repository",workspaceId:"workspace",pathRef:"workspace:workspace",branch:"codex/run",baseRevision:"base"},...input};
 store.save(session);const observer=new NativeBindingEvents(store),events:NativeBindingEvent[]=[];let current=true;
 observer.setSink(event=>{events.push(structuredClone(event));},()=>()=>current);
 const emit=observer.begin(session.id),ref:NativeBinding={version:1,product:"codex",region:"global",profileId:"profile",backendId:"codex-app-server",runnerId:"local",nativeStoreRef:"native-store:codex",nativeSessionId:"native-thread",nativeThreadId:"native-thread",identityState:"bound",executionRefId:"execution"};
 const options=()=>observer.startOptions(session,emit,"codex",()=>undefined,"codex-thread");
 return {store,session,observer,emit,ref,events,options,ownsAuthority:()=>current,revoke:()=>{current=false;}};
}

it("saves allocated exact Codex thread identity before the owning durable waiting event",async()=>{
 const f=fixture();let seen=false;
 f.observer.setSink(event=>{seen=true;expect(f.store.load("session")).toMatchObject({providerSessionId:"native-thread",nativeBinding:f.ref});f.events.push(event);},()=>()=>true);
 // begin captures the sink and authority of its own invocation.
 const emit=f.observer.begin("session"),options=f.observer.startOptions(f.session,emit,"codex",()=>undefined,"codex-thread");
 await options.onBinding(f.ref);expect(seen).toBe(true);expect(f.events).toHaveLength(1);expect(f.events[0]).toMatchObject({nativeSessionId:"native-thread",nativeBinding:f.ref,turn:{state:"waiting"}});expect(()=>options.beforePrompt()).not.toThrow();
 f.ref.nativeSessionId="caller-change";expect(f.store.load("session")?.nativeBinding?.nativeSessionId).toBe("native-thread");
});

it.each(["product","region","profileId","backendId","runnerId","executionRefId","nativeThreadId"] as const)("refuses a foreign allocated %s before saving or emitting",async field=>{
 const f=fixture();f.ref[field]="other";await expect(f.options().onBinding(f.ref)).rejects.toMatchObject({code:"NATIVE_IDENTITY_CHANGED"});expect(f.store.load("session")?.providerSessionId).toBeUndefined();expect(f.store.load("session")?.nativeBinding).toBeUndefined();expect(f.events).toEqual([]);
});

it("does not adopt a historical provider id without an existing exact binding",()=>{
 const f=fixture({providerSessionId:"historical-thread"});expect(()=>f.options()).toThrowError(expect.objectContaining({code:"NATIVE_IDENTITY_CHANGED"}));expect(f.events).toEqual([]);
});

it.each(["RUNNING","COMPLETED"] as const)("does not allocate a new identity for an unbound %s session",state=>{
 const f=fixture({state});expect(()=>f.options()).toThrowError(expect.objectContaining({code:"NATIVE_IDENTITY_CHANGED"}));expect(f.events).toEqual([]);
});

it("preserves a previously bound Codex thread and refuses its replacement",async()=>{
 const ref:NativeBinding={version:1,product:"codex",region:"global",profileId:"profile",backendId:"codex-app-server",runnerId:"local",nativeStoreRef:"native-store:codex",nativeSessionId:"native-thread",nativeThreadId:"native-thread",identityState:"bound",executionRefId:"execution"},f=fixture({providerSessionId:"native-thread",nativeBinding:ref}),options=f.options();
 await options.onBinding(ref);await expect(options.onBinding({...ref,nativeSessionId:"different",nativeThreadId:"different"})).rejects.toMatchObject({code:"NATIVE_IDENTITY_CHANGED"});expect(f.store.load("session")?.nativeBinding).toEqual(ref);
});

it("does not overwrite identity changed while native creation is pending",async()=>{
 const f=fixture(),options=f.options();f.store.save({...f.store.load("session")!,providerSessionId:"other"});await expect(options.onBinding(f.ref)).rejects.toMatchObject({code:"NATIVE_IDENTITY_CHANGED"});expect(f.store.load("session")?.providerSessionId).toBe("other");expect(f.events).toEqual([]);
});

it("does not overwrite identity changed by the final synchronous admission",async()=>{
 const f=fixture();let changed=false;const options=f.observer.startOptions(f.session,f.emit,"codex",()=>{if(!changed){changed=true;f.store.save({...f.store.load("session")!,providerSessionId:"other"});}},"codex-thread");
 await expect(options.onBinding(f.ref)).rejects.toMatchObject({code:"NATIVE_IDENTITY_CHANGED"});expect(f.store.load("session")?.providerSessionId).toBe("other");expect(f.store.load("session")?.nativeBinding).toBeUndefined();expect(f.events).toEqual([]);
});

it.each(["RUNNING","COMPLETED","FAILED"] as const)("refuses a pending unbound allocation after session state becomes %s",async state=>{
 const f=fixture(),options=f.options();f.store.save({...f.store.load("session")!,state});await expect(options.onBinding(f.ref)).rejects.toMatchObject({code:"NATIVE_IDENTITY_CHANGED"});expect(f.store.load("session")).toMatchObject({state});expect(f.store.load("session")?.nativeBinding).toBeUndefined();expect(f.events).toEqual([]);
});

it.each(["RUNNING","COMPLETED","FAILED"] as const)("refuses an unbound allocation if final admission changes state to %s",async state=>{
 const f=fixture(),options=f.observer.startOptions(f.session,f.emit,"codex",()=>{f.store.save({...f.store.load("session")!,state});},"codex-thread");await expect(options.onBinding(f.ref)).rejects.toMatchObject({code:"NATIVE_IDENTITY_CHANGED"});expect(f.store.load("session")).toMatchObject({state});expect(f.store.load("session")?.nativeBinding).toBeUndefined();expect(f.events).toEqual([]);
});

it("refuses a Promise-returning final admission before saving an allocated binding",async()=>{
 const f=fixture(),options=f.observer.startOptions(f.session,f.emit,"codex",async()=>undefined,"codex-thread");
 await expect(options.onBinding(f.ref)).rejects.toMatchObject({code:"NATIVE_CAPABILITY_UNVERIFIED"});expect(f.store.load("session")?.providerSessionId).toBeUndefined();expect(f.store.load("session")?.nativeBinding).toBeUndefined();expect(f.events).toEqual([]);
});

it("retains allocated identity and blocks input after durable sink failure",async()=>{
 const f=fixture();f.observer.setSink(()=>{throw Error("private sink failure");},()=>()=>true);const emit=f.observer.begin("session"),options=f.observer.startOptions(f.session,emit,"codex",()=>undefined,"codex-thread");
 await expect(options.onBinding(f.ref)).rejects.toThrow("private sink failure");expect(f.store.load("session")).toMatchObject({providerSessionId:"native-thread",nativeBinding:f.ref,nativeIdentityIssue:"NATIVE_EVENT_PERSISTENCE_FAILED"});expect(()=>options.beforePrompt()).toThrowError(expect.objectContaining({code:"NATIVE_EVENT_PERSISTENCE_FAILED"}));expect(()=>f.observer.begin("session")).toThrowError(expect.objectContaining({code:"NATIVE_EVENT_PERSISTENCE_FAILED"}));
});

it("keeps a failed allocation save unbound and blocks the original invocation",async()=>{
 const f=fixture(),save=f.store.save.bind(f.store);f.store.save=session=>{if(session.nativeBinding)throw Error("private storage failure");save(session);};const options=f.options();
 await expect(options.onBinding(f.ref)).rejects.toThrow("private storage failure");expect(f.store.load("session")?.providerSessionId).toBeUndefined();expect(f.store.load("session")?.nativeBinding).toBeUndefined();expect(f.store.load("session")?.nativeIdentityIssue).toBe("NATIVE_EVENT_PERSISTENCE_FAILED");expect(f.events).toEqual([]);expect(()=>options.beforePrompt()).toThrowError(expect.objectContaining({code:"NATIVE_EVENT_PERSISTENCE_FAILED"}));
});

it("retains sink uncertainty if authority expires during allocated-thread persistence",async()=>{
 const f=fixture();f.observer.setSink(()=>{f.revoke();throw Error("private sink failure");},()=>f.ownsAuthority);const emit=f.observer.begin("session"),options=f.observer.startOptions(f.session,emit,"codex",()=>undefined,"codex-thread");
 await expect(options.onBinding(f.ref)).rejects.toThrow("private sink failure");expect(f.store.load("session")).toMatchObject({providerSessionId:"native-thread",nativeIdentityIssue:"NATIVE_EVENT_PERSISTENCE_FAILED"});const recreated=new NativeBindingEvents(f.store);recreated.setSink(()=>undefined,()=>()=>true);expect(()=>recreated.begin("session")).toThrowError(expect.objectContaining({code:"NATIVE_EVENT_PERSISTENCE_FAILED"}));
});

it("rechecks the original authority after the allocated binding sink settles",async()=>{
 const f=fixture();f.observer.setSink(()=>{f.revoke();},()=>f.ownsAuthority);const emit=f.observer.begin("session");
 await expect(f.observer.startOptions(f.session,emit,"codex",()=>undefined,"codex-thread").onBinding(f.ref)).rejects.toMatchObject({code:"STALE_NATIVE_OBSERVER"});expect(f.store.load("session")?.providerSessionId).toBe("native-thread");
});

it("keeps reserved Pi identities strict and cannot opt them into Codex allocation",async()=>{
 const f=fixture({backendId:"pi-rpc",providerSessionId:"reserved"});const options=f.observer.startOptions(f.session,f.emit,"pi",()=>undefined);
 await expect(options.onBinding({...f.ref,product:"pi",backendId:"pi-rpc",nativeSessionId:"reserved",nativeThreadId:"reserved"})).rejects.toMatchObject({code:"NATIVE_IDENTITY_CHANGED"});
 expect(()=>f.observer.startOptions(f.session,f.emit,"pi",()=>undefined,"codex-thread")).toThrowError(expect.objectContaining({code:"NATIVE_IDENTITY_CHANGED"}));expect(f.events).toEqual([]);
});

it("still persists the original preallocated Pi identity without a thread id",async()=>{
 const f=fixture({backendId:"pi-rpc",providerSessionId:"reserved"}),ref={...f.ref,product:"pi",backendId:"pi-rpc",nativeSessionId:"reserved"};delete ref.nativeThreadId;
 await f.observer.startOptions(f.session,f.emit,"pi",()=>undefined).onBinding(ref);expect(f.store.load("session")).toMatchObject({providerSessionId:"reserved",nativeBinding:ref});expect(f.events).toHaveLength(1);expect(f.events[0]?.nativeSessionId).toBe("reserved");
});

function opencodeFixture(input:Partial<AdapterSession>={}){
 const store=new MemorySessionStore(),session:AdapterSession={id:"session",runId:"run",profileId:"profile",backendId:"opencode-server-v2",workspacePath:"/workspace",state:"STARTING",legacyModel:{},createdAt:at,updatedAt:at,execution:{generation:1,attempt:1,leaseId:"lease"},executionRef:{version:1,id:"execution",kind:"managed-worktree",runnerId:"local",repositoryId:"repository",workspaceId:"workspace",pathRef:"workspace:workspace",branch:"codex/run",baseRevision:"base"},...input};
 store.save(session);const observer=new NativeBindingEvents(store),events:NativeBindingEvent[]=[];let current=true;
 observer.setSink(event=>{events.push(structuredClone(event));},()=>()=>current);
 const emit=observer.begin(session.id),ref:NativeBinding={version:1,product:"opencode",region:"global",profileId:"profile",backendId:"opencode-server-v2",runnerId:"local",nativeStoreRef:"native-store:opencode",nativeSessionId:"ses_exact",identityState:"bound",executionRefId:"execution"};
 const options=()=>observer.startOptions(session,emit,"opencode",()=>undefined,"opencode-session");
 return {store,session,observer,emit,ref,events,options,ownsAuthority:()=>current,revoke:()=>{current=false;}};
}

it("saves allocated exact OpenCode thread identity before the owning durable waiting event",async()=>{
 const f=opencodeFixture();let seen=false;
 f.observer.setSink(event=>{seen=true;expect(f.store.load("session")).toMatchObject({providerSessionId:"ses_exact",nativeBinding:f.ref});f.events.push(event);},()=>()=>true);
 // begin captures the sink and authority of its own invocation.
 const emit=f.observer.begin("session"),options=f.observer.startOptions(f.session,emit,"opencode",()=>undefined,"opencode-session");
 await options.onBinding(f.ref);expect(seen).toBe(true);expect(f.events).toHaveLength(1);expect(f.events[0]).toMatchObject({nativeSessionId:"ses_exact",nativeBinding:f.ref,turn:{state:"waiting"}});expect(()=>options.beforePrompt()).not.toThrow();
 f.ref.nativeSessionId="caller-change";expect(f.store.load("session")?.nativeBinding?.nativeSessionId).toBe("ses_exact");
});

it.each(["product","region","profileId","backendId","runnerId","executionRefId","nativeThreadId"] as const)("refuses a foreign allocated %s before saving or emitting",async field=>{
 const f=opencodeFixture();f.ref[field]="other";await expect(f.options().onBinding(f.ref)).rejects.toMatchObject({code:"NATIVE_IDENTITY_CHANGED"});expect(f.store.load("session")?.providerSessionId).toBeUndefined();expect(f.store.load("session")?.nativeBinding).toBeUndefined();expect(f.events).toEqual([]);
});

it("does not adopt a historical provider id without an existing exact binding",()=>{
 const f=opencodeFixture({providerSessionId:"historical-thread"});expect(()=>f.options()).toThrowError(expect.objectContaining({code:"NATIVE_IDENTITY_CHANGED"}));expect(f.events).toEqual([]);
});

it.each(["RUNNING","COMPLETED"] as const)("does not allocate a new identity for an unbound %s session",state=>{
 const f=opencodeFixture({state});expect(()=>f.options()).toThrowError(expect.objectContaining({code:"NATIVE_IDENTITY_CHANGED"}));expect(f.events).toEqual([]);
});

it("preserves a previously bound OpenCode thread and refuses its replacement",async()=>{
 const ref:NativeBinding={version:1,product:"opencode",region:"global",profileId:"profile",backendId:"opencode-server-v2",runnerId:"local",nativeStoreRef:"native-store:opencode",nativeSessionId:"ses_exact",identityState:"bound",executionRefId:"execution"},f=opencodeFixture({providerSessionId:"ses_exact",nativeBinding:ref}),options=f.options();
 await options.onBinding(ref);await expect(options.onBinding({...ref,nativeSessionId:"different"})).rejects.toMatchObject({code:"NATIVE_IDENTITY_CHANGED"});expect(f.store.load("session")?.nativeBinding).toEqual(ref);
});

it("does not overwrite identity changed while native creation is pending",async()=>{
 const f=opencodeFixture(),options=f.options();f.store.save({...f.store.load("session")!,providerSessionId:"other"});await expect(options.onBinding(f.ref)).rejects.toMatchObject({code:"NATIVE_IDENTITY_CHANGED"});expect(f.store.load("session")?.providerSessionId).toBe("other");expect(f.events).toEqual([]);
});

it("does not overwrite identity changed by the final synchronous admission",async()=>{
 const f=opencodeFixture();let changed=false;const options=f.observer.startOptions(f.session,f.emit,"opencode",()=>{if(!changed){changed=true;f.store.save({...f.store.load("session")!,providerSessionId:"other"});}},"opencode-session");
 await expect(options.onBinding(f.ref)).rejects.toMatchObject({code:"NATIVE_IDENTITY_CHANGED"});expect(f.store.load("session")?.providerSessionId).toBe("other");expect(f.store.load("session")?.nativeBinding).toBeUndefined();expect(f.events).toEqual([]);
});

it.each(["RUNNING","COMPLETED","FAILED"] as const)("refuses a pending unbound allocation after session state becomes %s",async state=>{
 const f=opencodeFixture(),options=f.options();f.store.save({...f.store.load("session")!,state});await expect(options.onBinding(f.ref)).rejects.toMatchObject({code:"NATIVE_IDENTITY_CHANGED"});expect(f.store.load("session")).toMatchObject({state});expect(f.store.load("session")?.nativeBinding).toBeUndefined();expect(f.events).toEqual([]);
});

it.each(["RUNNING","COMPLETED","FAILED"] as const)("refuses an unbound allocation if final admission changes state to %s",async state=>{
 const f=opencodeFixture(),options=f.observer.startOptions(f.session,f.emit,"opencode",()=>{f.store.save({...f.store.load("session")!,state});},"opencode-session");await expect(options.onBinding(f.ref)).rejects.toMatchObject({code:"NATIVE_IDENTITY_CHANGED"});expect(f.store.load("session")).toMatchObject({state});expect(f.store.load("session")?.nativeBinding).toBeUndefined();expect(f.events).toEqual([]);
});

it("refuses a Promise-returning final admission before saving an allocated binding",async()=>{
 const f=opencodeFixture(),options=f.observer.startOptions(f.session,f.emit,"opencode",async()=>undefined,"opencode-session");
 await expect(options.onBinding(f.ref)).rejects.toMatchObject({code:"NATIVE_CAPABILITY_UNVERIFIED"});expect(f.store.load("session")?.providerSessionId).toBeUndefined();expect(f.store.load("session")?.nativeBinding).toBeUndefined();expect(f.events).toEqual([]);
});

it("retains allocated identity and blocks input after durable sink failure",async()=>{
 const f=opencodeFixture();f.observer.setSink(()=>{throw Error("private sink failure");},()=>()=>true);const emit=f.observer.begin("session"),options=f.observer.startOptions(f.session,emit,"opencode",()=>undefined,"opencode-session");
 await expect(options.onBinding(f.ref)).rejects.toThrow("private sink failure");expect(f.store.load("session")).toMatchObject({providerSessionId:"ses_exact",nativeBinding:f.ref,nativeIdentityIssue:"NATIVE_EVENT_PERSISTENCE_FAILED"});expect(()=>options.beforePrompt()).toThrowError(expect.objectContaining({code:"NATIVE_EVENT_PERSISTENCE_FAILED"}));expect(()=>f.observer.begin("session")).toThrowError(expect.objectContaining({code:"NATIVE_EVENT_PERSISTENCE_FAILED"}));
});

it("keeps a failed allocation save unbound and blocks the original invocation",async()=>{
 const f=opencodeFixture(),save=f.store.save.bind(f.store);f.store.save=session=>{if(session.nativeBinding)throw Error("private storage failure");save(session);};const options=f.options();
 await expect(options.onBinding(f.ref)).rejects.toThrow("private storage failure");expect(f.store.load("session")?.providerSessionId).toBeUndefined();expect(f.store.load("session")?.nativeBinding).toBeUndefined();expect(f.store.load("session")?.nativeIdentityIssue).toBe("NATIVE_EVENT_PERSISTENCE_FAILED");expect(f.events).toEqual([]);expect(()=>options.beforePrompt()).toThrowError(expect.objectContaining({code:"NATIVE_EVENT_PERSISTENCE_FAILED"}));
});

it("retains sink uncertainty if authority expires during allocated-thread persistence",async()=>{
 const f=opencodeFixture();f.observer.setSink(()=>{f.revoke();throw Error("private sink failure");},()=>f.ownsAuthority);const emit=f.observer.begin("session"),options=f.observer.startOptions(f.session,emit,"opencode",()=>undefined,"opencode-session");
 await expect(options.onBinding(f.ref)).rejects.toThrow("private sink failure");expect(f.store.load("session")).toMatchObject({providerSessionId:"ses_exact",nativeIdentityIssue:"NATIVE_EVENT_PERSISTENCE_FAILED"});const recreated=new NativeBindingEvents(f.store);recreated.setSink(()=>undefined,()=>()=>true);expect(()=>recreated.begin("session")).toThrowError(expect.objectContaining({code:"NATIVE_EVENT_PERSISTENCE_FAILED"}));
});

it("rechecks the original authority after the allocated binding sink settles",async()=>{
 const f=opencodeFixture();f.observer.setSink(()=>{f.revoke();},()=>f.ownsAuthority);const emit=f.observer.begin("session");
 await expect(f.observer.startOptions(f.session,emit,"opencode",()=>undefined,"opencode-session").onBinding(f.ref)).rejects.toMatchObject({code:"STALE_NATIVE_OBSERVER"});expect(f.store.load("session")?.providerSessionId).toBe("ses_exact");
});


it('rejects another allocated observer invocation before saving the OpenCode identity',async()=>{
 const f=opencodeFixture(),other={...f.session,id:'other-session',runId:'other-run'};f.store.save(other);const otherEmit=f.observer.begin(other.id);
 expect(()=>f.observer.startOptions(f.session,otherEmit,'opencode',()=>undefined,'opencode-session')).toThrowError(expect.objectContaining({code:'STALE_NATIVE_OBSERVER'}));expect(f.store.load(f.session.id)?.nativeBinding).toBeUndefined();expect(f.events).toEqual([]);
});
it.each(['region','nativeThreadId','parentSessionId'] as const)('rejects an already bound OpenCode %s incompatible with session allocation',field=>{
 const f=opencodeFixture(),ref={...f.ref,[field]:'foreign'},session={...f.session,nativeBinding:ref,providerSessionId:ref.nativeSessionId};f.store.save(session);const emit=f.observer.begin(session.id);expect(()=>f.observer.startOptions(session,emit,'opencode',()=>undefined,'opencode-session')).toThrowError(expect.objectContaining({code:'NATIVE_IDENTITY_CHANGED'}));expect(f.events).toEqual([]);
});
it.each(['nativeStoreRef','parentSessionId','nativeThreadId'] as const)('keeps exact OpenCode repeats immutable for %s',async field=>{const f=opencodeFixture(),options=f.options();await options.onBinding(f.ref);await options.onBinding(structuredClone(f.ref));expect(f.events).toHaveLength(2);await expect(options.onBinding({...f.ref,[field]:'foreign'})).rejects.toMatchObject({code:'NATIVE_IDENTITY_CHANGED'});expect(f.store.load('session')?.nativeBinding).toEqual(f.ref);expect(f.events).toHaveLength(2);});
it.each(['pi-rpc','opencode-cli-json','codex-app-server'])('cannot allocate OpenCode session identities for %s',backendId=>{const f=opencodeFixture({backendId});expect(()=>f.options()).toThrowError(expect.objectContaining({code:'NATIVE_IDENTITY_CHANGED'}));expect(f.events).toEqual([]);});
it.each(['executionRef','executionSelection','execution','nativeInvocationId'] as const)('rejects current allocated OpenCode %s drift before saving',async field=>{const f=opencodeFixture(),options=f.options(),current=f.store.load(f.session.id)!;if(field==='executionRef')current.executionRef={...current.executionRef!,id:'foreign'};if(field==='executionSelection')current.executionSelection={version:1,mode:'manual',selectionType:'native-default',source:'native-default',profileId:'profile',providerId:'opencode',backendId:'opencode-server-v2',runnerId:'local',configRevision:1,contextFingerprint:'scope',selectedAt:at,nativeParameters:{}};if(field==='execution')current.execution={...current.execution!,generation:2};if(field==='nativeInvocationId')current.nativeInvocationId='foreign';f.store.save(current);await expect(options.onBinding(f.ref)).rejects.toThrow();expect(f.store.load(f.session.id)?.nativeBinding).toBeUndefined();expect(f.events).toEqual([]);});
