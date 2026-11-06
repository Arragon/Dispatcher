import {expect,it,vi} from "vitest";
import {CursorAdapter,StructuredCliAdapter,cursorManifest,QoderAdapter,GenericCliAdapter,GenericMockAdapter,DevinAdapter,LocalServiceAdapter,MemorySessionStore,type AgentAdapter} from "../src/index.js";
const profile={id:"p",alias:"P"};
const turn=()=>({cancel:async()=>{},status:()=>"completed" as const,result:async()=>({state:"waiting" as const,summary:"question",providerSessionId:"native",events:[]})});
const factories:Array<[string,(start:ReturnType<typeof vi.fn>,store?:MemorySessionStore)=>AgentAdapter]>=[
 ["Qoder",(start,store)=>new QoderAdapter(profile,{start:input=>{start(input);return turn();}},store)],
 ["CLI",(start,store)=>new CursorAdapter(profile,{start:input=>{start(input);return turn();}},store)],
 ["Generic",(start,store)=>new GenericCliAdapter({start:async input=>{start(input);return {id:"process",status:async()=>({state:"running" as const}),send:async()=>{},cancel:async()=>{},result:async()=>({state:"completed" as const,summary:"done"})};}},{file:"fixture",args:["{{prompt}}"]},store,"p")],
];
const stale=()=>{throw Object.assign(Error("stale authority"),{code:"STALE_CONTROL_EPOCH"});};
it("keeps mock resume under the same write admission contract",async()=>{
 const adapter=new GenericMockAdapter(),session=await adapter.start({runId:"r",workspacePath:"/work"});await adapter.pause(session.id);
 await expect(adapter.resume(session.id,stale)).rejects.toMatchObject({dispatch:"not-sent",code:"STALE_CONTROL_EPOCH"});expect((await adapter.status(session.id)).state).toBe("PAUSED");
});
it.each(["pause","cancel"] as const)("keeps mock %s under final write admission",async action=>{const adapter=new GenericMockAdapter(),session=await adapter.start({runId:"r",workspacePath:"/work"});await expect(adapter[action](session.id,stale)).rejects.toMatchObject({dispatch:"not-sent",code:"STALE_CONTROL_EPOCH"});expect((await adapter.status(session.id)).state).toBe("RUNNING");});
for(const [name,make] of factories){
 it(`${name} rejects an owned stop at final admission without a cancelled snapshot`,async()=>{const adapter=make(vi.fn()),session=await adapter.start({runId:"r",workspacePath:"/work"});await expect(adapter.cancel(session.id,stale)).rejects.toMatchObject({dispatch:"not-sent",code:"STALE_CONTROL_EPOCH"});expect((await adapter.status(session.id)).state).not.toBe("CANCELLED");});
 it(`${name} rejects creation at final write admission`,async()=>{const start=vi.fn();await expect(make(start).start({runId:"r",sessionId:"s",workspacePath:"/work",beforeSend:stale})).rejects.toMatchObject({creationOutcome:"not-created",code:"STALE_CONTROL_EPOCH"});expect(start).not.toHaveBeenCalled();});
 it(`${name} rejects same-session input at final write admission`,async()=>{const start=vi.fn(),adapter=make(start),session=await adapter.start({runId:"r",workspacePath:"/work"});await expect(adapter.send(session.id,"next",stale)).rejects.toMatchObject({dispatch:"not-sent",code:"STALE_CONTROL_EPOCH"});expect(start).toHaveBeenCalledTimes(1);});
 it(`${name} preserves actual logical invocation counters without borrowing caller mutations`,async()=>{const store=new MemorySessionStore(),execution={generation:2,attempt:3,leaseId:"lease"},start=vi.fn(()=>{execution.generation=99;}),adapter=make(start,store),session=await adapter.start({runId:"r",workspacePath:"/work",execution});expect(session.execution).toEqual({generation:2,attempt:3,leaseId:"lease"});expect(store.load(session.id)?.execution).toEqual(session.execution);});
 it(`${name} rejects malformed invocation counters before native I/O`,async()=>{const start=vi.fn();await expect(make(start).start({runId:"r",workspacePath:"/work",execution:{generation:0,attempt:1}})).rejects.toMatchObject({creationOutcome:"not-created",code:"INVALID_EXECUTION_CONTEXT"});expect(start).not.toHaveBeenCalled();});
}
it("checks HTTP cancellation after pending credential preparation",async()=>{
 const entered=Promise.withResolvers<void>(),ready=Promise.withResolvers<string>();let reads=0,current=true;
 const fetchImpl=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({sessionId:"native",state:"cancelled"})));
 const adapter=new LocalServiceAdapter({...profile,provider:"workbuddy",credentialRef:"secret://fixture",baseUrl:"http://fixture.invalid",healthPath:"/health",startPath:"/start",statusPath:"/status/{sessionId}",inputPath:"/input/{sessionId}",cancelPath:"/cancel/{sessionId}"},async()=>{if(++reads===1)return "fixture-token";entered.resolve();return ready.promise;},fetchImpl);
 const session=await adapter.start({runId:"r",workspacePath:"/work"}),pending=adapter.cancel(session.id,()=>{if(!current)stale();}),rejected=expect(pending).rejects.toMatchObject({dispatch:"not-sent",code:"STALE_CONTROL_EPOCH"});
 await entered.promise;current=false;ready.resolve("fixture-token");await rejected;expect(fetchImpl).toHaveBeenCalledTimes(1);
});
for(const provider of ["Devin","Local"] as const){
 function fixture(credential:()=>Promise<string>,fetchImpl:typeof fetch){return provider==="Devin"?new DevinAdapter({...profile,organizationId:"org-fixture",credentialRef:"secret://fixture"},undefined,undefined,credential,fetchImpl):new LocalServiceAdapter({...profile,provider:"workbuddy",credentialRef:"secret://fixture",baseUrl:"http://fixture.invalid",healthPath:"/health",startPath:"/sessions",statusPath:"/sessions/{sessionId}",inputPath:"/sessions/{sessionId}/messages",cancelPath:"/sessions/{sessionId}/cancel"},credential,fetchImpl);}
 it(`${provider} checks creation after awaited credential preparation`,async()=>{const entered=Promise.withResolvers<void>(),ready=Promise.withResolvers<string>(),fetchImpl=vi.fn<typeof fetch>();let current=true;const adapter=fixture(async()=>{entered.resolve();return ready.promise;},fetchImpl);const pending=adapter.start({runId:"r",sessionId:"s",workspacePath:"/work",beforeSend:()=>{if(!current)stale();}}),rejected=expect(pending).rejects.toMatchObject({creationOutcome:"not-created",code:"STALE_CONTROL_EPOCH"});await entered.promise;current=false;ready.resolve("fixture-token");await rejected;expect(fetchImpl).not.toHaveBeenCalled();});
 it(`${provider} checks input after awaited credential preparation`,async()=>{const entered=Promise.withResolvers<void>(),ready=Promise.withResolvers<string>();let reads=0,current=true;const fetchImpl=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({org_id:"org-fixture",session_id:"native",sessionId:"native",state:"running",status:"running",pullRequests:[]}),{status:200}));const adapter=fixture(async()=>{if(++reads===1)return "fixture-token";entered.resolve();return ready.promise;},fetchImpl),session=await adapter.start({runId:"r",workspacePath:"/work"});const pending=adapter.send(session.id,"next",()=>{if(!current)stale();}),rejected=expect(pending).rejects.toMatchObject({dispatch:"not-sent",code:"STALE_CONTROL_EPOCH"});await entered.promise;current=false;ready.resolve("fixture-token");await rejected;expect(fetchImpl).toHaveBeenCalledTimes(1);});
}
it("does not silently enter guarded mode with an opaque legacy async API backend",async()=>{
 const create=vi.fn(async()=>({sessionId:"native",status:"running",pullRequests:[]})),adapter=new DevinAdapter({...profile,organizationId:"org-fixture",credentialRef:"secret://fixture"},{health:async()=>({ok:true}),create,get:async()=>({sessionId:"native",status:"running",pullRequests:[]}),send:async()=>({sessionId:"native",status:"running",pullRequests:[]})});
 await expect(adapter.start({runId:"r",workspacePath:"/work",beforeSend:()=>{}})).rejects.toMatchObject({creationOutcome:"not-created",code:"NATIVE_CAPABILITY_UNVERIFIED"});expect(create).not.toHaveBeenCalled();
 await adapter.start({runId:"legacy",workspacePath:"/work"});expect(create).toHaveBeenCalledTimes(1);
});

it.each(["Qoder","CLI"] as const)("%s rejects logical execution metadata drift across its previous result await",async kind=>{
 const store=new MemorySessionStore(),held=Promise.withResolvers<{state:"waiting";summary:string;providerSessionId:string;events:[]}>();
 const start=vi.fn(()=>({cancel:async()=>{},status:()=>"completed" as const,result:()=>held.promise}));
 const adapter=kind==="Qoder"?new QoderAdapter(profile,{start},store):new CursorAdapter(profile,{start},store);
 const session=await adapter.start({runId:"r",workspacePath:"/work",execution:{generation:2,attempt:3,leaseId:"lease"}}),pending=adapter.send(session.id,"next");
 const rejected=expect(pending).rejects.toMatchObject({code:"EXECUTION_CONTEXT_DRIFT"});
 store.save({...session,execution:{generation:99,attempt:3,leaseId:"lease"}});held.resolve({state:"waiting",summary:"question",providerSessionId:"native",events:[]});await rejected;expect(start).toHaveBeenCalledTimes(1);
});

it("checks final CLI authority after argument preparation rather than before it",async()=>{
 let current=true;const start=vi.fn(()=>turn());
 const adapter=new StructuredCliAdapter({manifest:cursorManifest,defaultExecutable:"fixture",versionArgs:["--version"],authArgs:["login","status"],supportsResume:true,startArgs:()=>{current=false;return ["task"]; }},profile,{start});
 await expect(adapter.start({runId:"r",workspacePath:"/work",beforeSend:()=>{if(!current)stale();}})).rejects.toMatchObject({creationOutcome:"not-created",code:"STALE_CONTROL_EPOCH"});expect(start).not.toHaveBeenCalled();
});
