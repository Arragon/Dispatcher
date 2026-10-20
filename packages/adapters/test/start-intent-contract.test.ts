import { expect, it, vi } from "vitest";
import { AdapterStartError, CodexAdapter, CursorAdapter, DevinAdapter, GenericCliAdapter, LocalServiceAdapter, QoderAdapter, type AgentAdapter } from "../src/index.js";

const profile={id:"p",alias:"P"};
const turn=()=>({status:()=>"running" as const,cancel:async()=>{},result:async()=>({state:"completed" as const,summary:"done",events:[]})});
const factories:Array<[string,(start:ReturnType<typeof vi.fn>)=>AgentAdapter]>=[
  ["Codex",start=>new CodexAdapter({...profile,codexHome:"/fixture/profile"},{start:input=>{start(input);return turn();}})],
  ["Qoder",start=>new QoderAdapter(profile,{start:input=>{start(input);return turn();}})],
  ["Structured CLI",start=>new CursorAdapter(profile,{start:input=>{start(input);return turn();}})],
  ["Generic CLI",start=>new GenericCliAdapter({start:async input=>{start(input);return {id:"process",status:async()=>({state:"running" as const}),send:async()=>{},cancel:async()=>{},result:async()=>({state:"completed" as const,summary:"done"})};}},{file:"/fixture/program",args:["{{prompt}}"]})],
  ["Devin",start=>new DevinAdapter({...profile,organizationId:"fixture",credentialRef:"secret://fixture"},{health:async()=>({ok:true}),create:async input=>{start(input);return {sessionId:"provider-native",status:"running",pullRequests:[]};},get:async()=>({sessionId:"provider-native",status:"running",pullRequests:[]}),send:async()=>({sessionId:"provider-native",status:"running",pullRequests:[]})})],
  ["Local service",start=>new LocalServiceAdapter({...profile,provider:"workbuddy",baseUrl:"http://fixture.invalid",healthPath:"/health",startPath:"/sessions",statusPath:"/sessions/{sessionId}",inputPath:"/sessions/{sessionId}/messages",cancelPath:"/sessions/{sessionId}/cancel"},undefined,async(input,init)=>{if(init?.method==="POST")start(input);return new Response(JSON.stringify({sessionId:"provider-native",state:"running"}),{status:200});})],
];
for(const [name,factory] of factories){
  it(`${name} retains the reserved Dispatcher ID and rejects its reuse before another create`,async()=>{
    const start=vi.fn();const adapter=factory(start);const input={runId:"run",sessionId:"reserved-dispatcher-session",workspacePath:"/fixture/workspace",prompt:"task"};
    const session=await adapter.start(input);expect(session.id).toBe(input.sessionId);expect(session.providerSessionId).not.toBe(input.sessionId);expect(start).toHaveBeenCalledTimes(1);
    await expect(adapter.start(input)).rejects.toMatchObject({creationOutcome:"not-created",code:"SESSION_ID_CONFLICT"});expect(start).toHaveBeenCalledTimes(1);
    expect((await adapter.status(session.id)).id).toBe(session.id);
    expect((await adapter.start({...input,runId:"legacy-run",sessionId:undefined})).id).not.toBe(input.sessionId);expect(start).toHaveBeenCalledTimes(2);
  });
}
for(const [name,factory] of factories.slice(0,4)){
  it(`${name} classifies a proven local spawn failure as not-created and preserves its diagnostic`,async()=>{
    const adapter=factory(vi.fn(()=>{throw Object.assign(new Error("spawn fixture ENOENT"),{code:"ENOENT"});}));
    await expect(adapter.start({runId:"run",sessionId:"reserved",workspacePath:"/fixture/workspace"})).rejects.toMatchObject({creationOutcome:"not-created",code:"SPAWN_FAILED",message:"spawn fixture ENOENT"});
  });
}
it("classifies a failed Structured CLI credential preparation before calling its backend",async()=>{
  const start=vi.fn(()=>turn());const adapter=new CursorAdapter({...profile,credentialRef:"secret://fixture"},{start},undefined,async()=>{throw Error("fixture credential unavailable");});
  await expect(adapter.start({runId:"run",sessionId:"reserved",workspacePath:"/fixture/workspace"})).rejects.toBeInstanceOf(AdapterStartError);expect(start).not.toHaveBeenCalled();
});
for(const provider of ["Devin","Local service"]){
  it(`${provider} distinguishes credential preparation from a possibly delivered HTTP request`,async()=>{
    const fetchImpl=vi.fn<typeof fetch>(async()=>{throw Error("response lost");});const credential=vi.fn(async()=>{throw Error("fixture credential unavailable");});
    const make=()=>provider==="Devin"?new DevinAdapter({...profile,organizationId:"fixture",credentialRef:"secret://fixture"},undefined,undefined,credential,fetchImpl):new LocalServiceAdapter({...profile,provider:"workbuddy",credentialRef:"secret://fixture",baseUrl:"http://fixture.invalid",healthPath:"/health",startPath:"/sessions",statusPath:"/sessions/{sessionId}",inputPath:"/sessions/{sessionId}/messages",cancelPath:"/sessions/{sessionId}/cancel"},credential,fetchImpl);
    await expect(make().start({runId:"run",sessionId:"reserved",workspacePath:"/fixture/workspace"})).rejects.toMatchObject({creationOutcome:"not-created",code:"START_PREPARATION_FAILED"});expect(fetchImpl).not.toHaveBeenCalled();
    credential.mockImplementation(async()=>"fixture-token");const pending=make().start({runId:"run",sessionId:"reserved",workspacePath:"/fixture/workspace"});await expect(pending).rejects.toThrow("response lost");await expect(pending).rejects.not.toHaveProperty("creationOutcome","not-created");expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
}
it.each(["workbuddy","codebuddy"] as const)("retains %s legacy selection using its configured provider identity",async provider=>{
 const fetchImpl=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({sessionId:"native",state:"running"}),{status:200}));
 const adapter=new LocalServiceAdapter({...profile,provider,baseUrl:"http://fixture.invalid",healthPath:"/health",startPath:"/sessions",statusPath:"/sessions/{sessionId}",inputPath:"/sessions/{sessionId}/messages",cancelPath:"/sessions/{sessionId}/cancel"},undefined,fetchImpl);
 const choice={version:1 as const,mode:"legacy" as const,source:"legacy-config" as const,profileId:"p",runnerId:"local",providerId:provider,backendId:"local-service-http",selectionType:"native-default" as const,nativeParameters:{},configRevision:1,contextFingerprint:"scope",selectedAt:"2026-10-20T12:00:00Z"};
 const session=await adapter.start({runId:"run",sessionId:"reserved",workspacePath:"/work",executionSelection:choice});expect(session.executionSelection).toEqual(choice);expect(fetchImpl).toHaveBeenCalledTimes(1);
});
it("reserves a Structured CLI identity before credential preparation can admit a duplicate create",async()=>{
 const entered=Promise.withResolvers<void>(),ready=Promise.withResolvers<string>(),start=vi.fn(()=>turn());
 const adapter=new CursorAdapter({...profile,credentialRef:"secret://fixture"},{start},undefined,async()=>{entered.resolve();return ready.promise;});
 const input={runId:"run",sessionId:"reserved",workspacePath:"/work"},first=adapter.start(input);
 try{await entered.promise;await expect(adapter.start(input)).rejects.toMatchObject({creationOutcome:"not-created",code:"SESSION_ID_CONFLICT"});expect(start).not.toHaveBeenCalled();ready.resolve("fixture-token");expect((await first).id).toBe("reserved");expect(start).toHaveBeenCalledTimes(1);}finally{ready.resolve("fixture-token");await first.catch(()=>undefined);}
});
