import {mkdirSync,mkdtempSync,realpathSync,renameSync,rmSync,chmodSync,writeFileSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach,expect,it,vi} from "vitest";
import {CodexAppServerBackend,codexAppServerProtocolVersion,type CodexAppServerScope,type CodexNativeAuthority,type CodexRpcTransport,type CodexStartInput,type NativeRequestEvent} from "@dispatcher/adapters";
import type {MutationFence,NativeBinding} from "@dispatcher/domain";
import * as versionProbe from "../../../packages/adapters/dist/native-version-probe.js";
import {CodexExecutionRuntime} from "../src/codex-runtime.js";
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});vi.useRealTimers();});
function fixture(authority?:CodexNativeAuthority){
 const root=realpathSync(mkdtempSync(join(tmpdir(),"dispatcher-codex-runtime-")));roots.push(root);const home=join(root,"home"),a=join(root,"a"),b=join(root,"b");for(const path of [home,a,b])mkdirSync(path);
 const ports:Array<{scope:CodexAppServerScope;port:CodexAppServerBackend;calls:string[];disconnect:ReturnType<typeof vi.fn>}>=[];
 const persisted=new Map<string,NativeBinding>(),assertInput=vi.fn(),factory=vi.fn((scope:CodexAppServerScope,selectedAuthority?:CodexNativeAuthority)=>{
  const calls:string[]=[],listeners=new Set<(method:string,params:unknown)=>void>(),disconnect=vi.fn(async()=>({version:1 as const,connection:"closed" as const,ownedRoot:"exited" as const,callbacks:"drained" as const,backgroundTools:"unknown" as const,nativeSessionDeleted:false as const}));
  const thread=()=>({id:`native:${scope.executionRefId}`,sessionId:`native:${scope.executionRefId}`,cwd:scope.workspacePath,ephemeral:false,cliVersion:codexAppServerProtocolVersion,source:"appServer",model:"test-model",modelProvider:"openai",reasoningEffort:null,status:{type:"idle"},turns:[]});
  const rpc:CodexRpcTransport={request:async(method)=>{calls.push(method);if(method==="initialize")return {codexHome:home};if(method==="thread/start"||method==="thread/resume")return {thread:thread(),cwd:scope.workspacePath,model:"test-model",modelProvider:"openai",reasoningEffort:null,approvalPolicy:"on-request",approvalsReviewer:"user",sandbox:{type:"workspaceWrite",writableRoots:[],networkAccess:false}};if(method==="turn/start")return {turn:{id:"turn",status:"completed",items:[]}};if(method==="thread/read")return {thread:thread()};throw Error(method);},notify:()=>{},onNotification:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},onDisconnect:()=>()=>{},close:async()=>{},disconnectLocal:disconnect};
  const port=new CodexAppServerBackend(scope,async()=>rpc,selectedAuthority);vi.spyOn(port,"setNativeRequestSink");ports.push({scope,port,calls,disconnect});return port;
 });
 const bindingFor=vi.fn((nativeId:string)=>persisted.get(nativeId));
 const runtime=new CodexExecutionRuntime({profile:{id:"p",alias:"P",codexHome:home,executable:"/fixture/codex"},runnerId:"local",assertInput,bindingFor,factory,...(authority?{authorityFor:()=>authority}:{})});
 const input=(id="a",path=a):CodexStartInput=>({executable:"/fixture/codex",codexHome:home,workspacePath:path,prompt:"fixture",model:"test-model",commandId:`command:${id}`,executionSelection:{version:1,mode:"manual",source:"explicit",profileId:"p",providerId:"codex",backendId:"codex-app-server",runnerId:"local",selectionType:"explicit-model",requestedModel:"test-model",nativeParameters:{},contextFingerprint:"fixture",configRevision:1,selectedAt:"2026-10-23T00:00:00Z"},beforePrompt:()=>undefined,onNativeEvent:()=>undefined,executionRef:{version:1,id,kind:"managed-worktree",runnerId:"local",repositoryId:"repo",workspaceId:id,pathRef:`workspace:${id}`,branch:`dispatcher/${id}`,baseRevision:"sha"},onBinding:async binding=>{persisted.set(binding.nativeSessionId,binding);}});
 return {root,home,a,b,ports,persisted,factory,assertInput,bindingFor,runtime,input};
}
it("withdraws its source when the owning binding lookup closes the runtime",async()=>{
 const f=fixture();await f.runtime.start(f.input()).ready!();const binding=f.persisted.get("native:a")!;f.bindingFor.mockImplementationOnce(id=>{f.runtime.beginShutdown();return f.persisted.get(id);});expect(f.runtime.source(binding)===undefined).toBe(true);expect(f.runtime.isClosed()).toBe(true);await f.runtime.disconnectLocal();
});
it("blocks request ingress when the source lookup synchronously starts shutdown",async()=>{
 const f=fixture(),sink=vi.fn();f.runtime.setNativeRequestSink(sink);await f.runtime.start(f.input()).ready!();const event=requestEvent(f),forward=vi.mocked(f.ports[0]!.port.setNativeRequestSink).mock.calls[0]![0];f.bindingFor.mockImplementationOnce(id=>{f.runtime.beginShutdown();return f.persisted.get(id);});expect(()=>forward(event)).toThrow(expect.objectContaining({code:"CODEX_BINDING_SCOPE_CHANGED"}));expect(sink).not.toHaveBeenCalled();await f.runtime.disconnectLocal();
});
it("captures canonical selection before asynchronous host admission",async()=>{
 const f=fixture(),input=f.input(),turn=f.runtime.start(input);input.executionSelection!.requestedModel="changed";
 await turn.ready!();expect(f.ports[0]!.calls).toContain("turn/start");await f.runtime.disconnectLocal();
});
it("rejects a Promise-returning owner assertion before host acquisition",async()=>{
 const f=fixture();f.assertInput.mockImplementation(async()=>undefined);expect(()=>f.runtime.start(f.input())).toThrow(expect.objectContaining({creationOutcome:"not-created"}));expect(f.factory).not.toHaveBeenCalled();await f.runtime.disconnectLocal();
});
it("rejects a Promise-returning original prompt guard before native creation",async()=>{
 const f=fixture(),turn=f.runtime.start({...f.input(),beforePrompt:async()=>undefined});await expect(turn.ready!()).rejects.toMatchObject({creationOutcome:"not-created"});expect(f.ports[0]!.calls.some(method=>method==="thread/start")).toBe(false);await f.runtime.disconnectLocal();
});
it("rejects home replacement between runtime construction and first admission",async()=>{
 const f=fixture();renameSync(f.home,f.home+"-old");mkdirSync(f.home);expect(()=>f.runtime.start(f.input())).toThrow(expect.objectContaining({creationOutcome:"not-created"}));expect(f.factory).not.toHaveBeenCalled();await f.runtime.disconnectLocal();
});
it.each(["home","workspace"] as const)("rejects %s replacement inside the owning assertion",async kind=>{
 const f=fixture(),path=kind==="home"?f.home:f.a;f.assertInput.mockImplementationOnce(()=>{renameSync(path,path+"-old");mkdirSync(path);});expect(()=>f.runtime.start(f.input())).toThrow(expect.objectContaining({creationOutcome:"not-created"}));expect(f.factory).not.toHaveBeenCalled();await f.runtime.disconnectLocal();
});
it.each(["home","workspace"] as const)("withdraws an exact source after physical %s replacement",async kind=>{
 const f=fixture();await f.runtime.start(f.input()).ready!();const binding=f.persisted.get("native:a")!,path=kind==="home"?f.home:f.a;expect(f.runtime.source(binding)).toBe(f.ports[0]!.port);renameSync(path,path+"-old");mkdirSync(path);expect(f.runtime.source(binding)===undefined).toBe(true);expect(()=>f.runtime.start({...f.input(),providerSessionId:"native:a"})).toThrow(expect.objectContaining({creationOutcome:"not-created"}));await f.runtime.disconnectLocal();
});
it("blocks the first prompt if durable binding changes inside its admitted callback",async()=>{
 const f=fixture(),turn=f.runtime.start({...f.input(),onBinding:async binding=>{f.persisted.set(binding.nativeSessionId,{...binding,nativeStoreRef:"replaced"});}});await expect(turn.ready!()).rejects.toMatchObject({creationOutcome:"unknown"});expect(f.ports[0]!.calls).not.toContain("turn/start");await f.runtime.disconnectLocal();
});
it("rejects a backend factory's foreign store binding before durable projection",async()=>{
 const f=fixture(),factory=f.factory.getMockImplementation()!;f.factory.mockImplementationOnce((scope,authority)=>factory({...scope,nativeStoreRef:"foreign-store"},authority));const turn=f.runtime.start(f.input());await expect(turn.ready!()).rejects.toMatchObject({creationOutcome:"unknown"});expect(f.persisted.size).toBe(0);expect(f.ports[0]!.calls).not.toContain("turn/start");await f.runtime.disconnectLocal();
});
it("cleans a known-unsent acquired host only with an explicit not-created receipt",async()=>{
 const f=fixture();f.assertInput.mockImplementationOnce(()=>undefined).mockImplementation(()=>{throw new Error("authority changed");});const turn=f.runtime.start(f.input()),disconnect=vi.spyOn(f.ports[0]!.port,"disconnectLocal");await expect(turn.ready!()).rejects.toMatchObject({creationOutcome:"not-created"});expect(disconnect).toHaveBeenCalled();expect(f.ports[0]!.disconnect).not.toHaveBeenCalled();expect(f.runtime.hasUnclosedHosts()).toBe(false);expect(f.ports[0]!.calls).not.toContain("thread/start");await f.runtime.disconnectLocal();
});
it("retains a known-unsent host when its local cleanup cannot prove no root",async()=>{
 const f=fixture();f.assertInput.mockImplementationOnce(()=>undefined).mockImplementation(()=>{throw new Error("authority changed");});const turn=f.runtime.start(f.input());vi.spyOn(f.ports[0]!.port,"disconnectLocal").mockResolvedValue({version:1,connection:"closed",ownedRoot:"unknown",callbacks:"drained",backgroundTools:"unknown",nativeSessionDeleted:false});await expect(turn.ready!()).rejects.toMatchObject({creationOutcome:"not-created"});expect(f.runtime.hasUnclosedHosts()).toBe(true);await f.runtime.disconnectLocal();expect(f.runtime.hasUnclosedHosts()).toBe(true);
});
it("does not hide a Promise-returning original mutation authority behind its source wrapper",async()=>{
 const fence:MutationFence={runId:"run",sessionId:"session",commandId:"command",generation:1,leaseId:"lease",expectedTaskRevision:1,expectedCurrentRunId:"run",expectedControlRevision:1,expectedControlEpoch:1};
 const f=fixture({connectionEpoch:1,fenceFor:()=>fence,assert:async()=>undefined});await f.runtime.start(f.input()).ready!();const wrapped=f.factory.mock.calls[0]![1]!;
 expect(()=>wrapped.assert(f.persisted.get("native:a")!,fence,"interrupt")).toThrow(expect.objectContaining({code:"NATIVE_CAPABILITY_UNVERIFIED"}));await f.runtime.disconnectLocal();
});
it("lazily creates distinct execution hosts with stable backend/store identities",async()=>{
 const f=fixture();expect(f.factory).not.toHaveBeenCalled();expect(f.runtime.hasUnclosedHosts()).toBe(false);const a=f.runtime.start(f.input()),b=f.runtime.start(f.input("b",f.b));await Promise.all([a.ready!(),b.ready!()]);
 expect(f.ports).toHaveLength(2);expect(f.ports[0]!.scope.nativeStoreRef).toBe(f.ports[1]!.scope.nativeStoreRef);expect(f.ports.map(p=>p.scope.executionRefId)).toEqual(["a","b"]);expect(f.runtime.hasUnclosedHosts()).toBe(true);expect(f.runtime.interaction).toBeUndefined();
 const results=await f.runtime.disconnectLocal();expect(results).toHaveLength(2);expect(results.every(r=>r.callbacks==="drained"&&r.ownedRoot==="exited")).toBe(true);expect(f.runtime.hasUnclosedHosts()).toBe(false);
});
it("continues only the same registered native session on its original execution host",async()=>{
 const f=fixture(),first=f.runtime.start(f.input());await first.ready!();await first.result();const binding=f.persisted.get("native:a")!;const source=f.runtime.source(binding);expect(source).toBe(f.ports[0]!.port);
 const next=f.runtime.start({...f.input(),providerSessionId:binding.nativeSessionId});await next.ready!();expect(f.factory).toHaveBeenCalledTimes(1);expect(f.ports[0]!.calls.filter(x=>x==="thread/start")).toHaveLength(1);expect(f.ports[0]!.calls.filter(x=>x==="thread/resume")).toHaveLength(1);await f.runtime.disconnectLocal();
});
it("refuses a second native create in an already admitted execution scope",async()=>{
 const f=fixture(),first=f.runtime.start(f.input()),second=f.runtime.start(f.input());await first.ready!();await expect(second.ready!()).rejects.toMatchObject({creationOutcome:"not-created"});expect(f.ports[0]!.calls.filter(x=>x==="thread/start")).toHaveLength(1);await f.runtime.disconnectLocal();
});
it.each(["runner","kind","missing"])("blocks %s execution contexts before acquiring a host",async drift=>{
 const f=fixture(),input=f.input();if(drift==="missing")delete input.executionRef;else if(drift==="runner")input.executionRef={...input.executionRef!,runnerId:"remote"} as typeof input.executionRef;else input.executionRef={version:1,id:"a",kind:"provider-cloud",organizationRef:"o",environmentRef:"e",repositoryId:"repo",baseRevision:"sha"};
 expect(()=>f.runtime.start(input)).toThrow(expect.objectContaining({creationOutcome:"not-created"}));expect(f.factory).not.toHaveBeenCalled();await f.runtime.disconnectLocal();
});
it("rejects execution workspace drift rather than replacing a live scoped host",async()=>{
 const f=fixture();await f.runtime.start(f.input()).ready!();expect(()=>f.runtime.start({...f.input("a",f.b),providerSessionId:"native:a"})).toThrow(expect.objectContaining({creationOutcome:"not-created"}));expect(f.factory).toHaveBeenCalledTimes(1);await f.runtime.disconnectLocal();
});
it("captures input and profile scope against caller mutation during admission",async()=>{
 const f=fixture(),input=f.input(),turn=f.runtime.start(input);input.executionRef!.id="changed";input.workspacePath=f.b;await turn.ready!();expect(f.ports[0]!.scope.executionRefId).toBe("a");expect(f.ports[0]!.scope.workspacePath).toBe(f.a);await f.runtime.disconnectLocal();
});
it("rechecks current canonical authority before binding and native prompt",async()=>{
 const f=fixture();f.assertInput.mockImplementationOnce(()=>{}).mockImplementation(()=>{throw Error("stale canonical scope");});const turn=f.runtime.start(f.input());await expect(turn.ready!()).rejects.toMatchObject({creationOutcome:"not-created"});expect(f.ports[0]?.calls.some(m=>m==="thread/start")).not.toBe(true);await f.runtime.disconnectLocal();
});
it("does not resume an unregistered or changed persisted binding",async()=>{
 const f=fixture();expect(()=>f.runtime.start({...f.input(),providerSessionId:"native:a"})).toThrow(expect.objectContaining({creationOutcome:"not-created"}));expect(f.factory).not.toHaveBeenCalled();await f.runtime.disconnectLocal();
});
it("refuses cold continuation without a restored frozen native policy",async()=>{
 const f=fixture();await f.runtime.start(f.input()).ready!();const binding=f.persisted.get("native:a")!;await f.runtime.disconnectLocal();
 const recovered=new CodexExecutionRuntime({profile:{id:"p",alias:"P",codexHome:f.home,executable:"/fixture/codex"},runnerId:"local",assertInput:f.assertInput,bindingFor:id=>f.persisted.get(id),factory:f.factory});
 expect(()=>recovered.start({...f.input(),providerSessionId:binding.nativeSessionId})).toThrow(expect.objectContaining({creationOutcome:"not-created",code:"CODEX_RESTART_REATTACH_UNQUALIFIED"}));expect(f.factory).toHaveBeenCalledTimes(1);await recovered.disconnectLocal();
});
it("refuses a cached binding whose durable record was removed",async()=>{
 const f=fixture();await f.runtime.start(f.input()).ready!();f.persisted.clear();expect(()=>f.runtime.start({...f.input(),providerSessionId:"native:a"})).toThrow(expect.objectContaining({creationOutcome:"not-created"}));expect(f.ports[0]!.calls).not.toContain("thread/resume");await f.runtime.disconnectLocal();
});
it("rechecks a persisted binding after a callback before admitting native continuation",async()=>{
 const f=fixture();await f.runtime.start(f.input()).ready!();const next=f.runtime.start({...f.input(),providerSessionId:"native:a",beforePrompt:()=>f.persisted.clear()});
 await expect(next.ready!()).rejects.toMatchObject({creationOutcome:"not-created"});expect(f.ports[0]!.calls).not.toContain("thread/resume");await f.runtime.disconnectLocal();
});
it("blocks new native work after local disconnect and keeps no unscoped source",async()=>{
 const f=fixture();await f.runtime.start(f.input()).ready!();const binding=f.persisted.get("native:a")!;await f.runtime.disconnectLocal();expect(f.runtime.source(binding)).toBeUndefined();expect(()=>f.runtime.start(f.input("b",f.b))).toThrow(expect.objectContaining({creationOutcome:"not-created"}));expect(f.factory).toHaveBeenCalledTimes(1);
});
it("does not claim callback resources drained when an admitted binding callback hangs",async()=>{
 const f=fixture();let release!:()=>void;const gate=new Promise<void>(done=>{release=done;}),persist=vi.fn(async()=>{await gate;});const turn=f.runtime.start({...f.input(),onBinding:persist});await vi.waitFor(()=>expect(persist).toHaveBeenCalledTimes(1));vi.useFakeTimers();
 try{const closing=f.runtime.disconnectLocal();await expect(turn.ready!()).rejects.toMatchObject({creationOutcome:"unknown"});await vi.advanceTimersByTimeAsync(5_001);expect((await closing)[0]).toMatchObject({callbacks:"unknown"});expect(f.runtime.hasUnclosedHosts()).toBe(true);}finally{release();vi.useRealTimers();}
});
it("reports a clean never-started disconnect without opening a native host",async()=>{
 const f=fixture();expect(await f.runtime.disconnectLocal()).toEqual([]);expect(f.factory).not.toHaveBeenCalled();expect(f.runtime.hasUnclosedHosts()).toBe(false);
});
function requestEvent(f:ReturnType<typeof fixture>,id="a"):NativeRequestEvent {
 const binding=f.persisted.get(`native:${id}`)!,scope=f.ports.find(p=>p.scope.executionRefId===id)!.scope.scopeFingerprint;
 return {binding,scopeFingerprint:scope,fence:{runId:id,sessionId:`session:${id}`,commandId:"ingress",generation:1,leaseId:"lease",expectedTaskRevision:1,expectedCurrentRunId:id,expectedControlRevision:1,expectedControlEpoch:1},request:{version:1,requestId:"request",revision:"revision",connectionId:`connection:${id}`,connectionEpoch:1,type:"permission",tool:{name:"write",scope:[`execution:${id}`],risk:"high"},options:[{id:"once",kind:"allow-once"}],expiresAt:new Date(Date.now()+60_000).toISOString()}};
}
it.each(["before-start","after-start"])("bridges exact native request metadata when the sink is registered %s",async timing=>{
 const f=fixture(),sink=vi.fn();if(timing==="before-start")f.runtime.setNativeRequestSink(sink);await f.runtime.start(f.input()).ready!();if(timing==="after-start")f.runtime.setNativeRequestSink(sink);
 const event=requestEvent(f),forward=vi.mocked(f.ports[0]!.port.setNativeRequestSink).mock.calls[0]![0];forward(event);expect(sink).toHaveBeenCalledOnce();expect(sink).toHaveBeenCalledWith(event);expect(sink.mock.calls[0]![0]).not.toBe(event);event.request.tool.name="mutated";expect(sink.mock.calls[0]![0].request.tool.name).toBe("write");
 const next=vi.fn();f.runtime.setNativeRequestSink(next);forward(requestEvent(f));expect(sink).toHaveBeenCalledOnce();expect(next).toHaveBeenCalledOnce();expect(f.runtime.interaction).toBeUndefined();expect(f.ports[0]!.port.capabilities().nativeApproval?.support).toBe("unknown");await f.runtime.disconnectLocal();
});
it.each(["closed","scope","binding","removed","sibling","no-sink"])("refuses a native request from a %s source before Core ingress",async drift=>{
 const f=fixture(),sink=vi.fn();if(drift!=="no-sink")f.runtime.setNativeRequestSink(sink);await f.runtime.start(f.input()).ready!();await f.runtime.start(f.input("b",f.b)).ready!();let event=requestEvent(f);const forward=vi.mocked(f.ports[0]!.port.setNativeRequestSink).mock.calls[0]![0];
 if(drift==="closed")f.runtime.beginShutdown();else if(drift==="scope")event.scopeFingerprint="other";else if(drift==="binding")event.binding={...event.binding,nativeStoreRef:"other"};else if(drift==="removed")f.persisted.delete(event.binding.nativeSessionId);else if(drift==="sibling")event=requestEvent(f,"b");
 expect(()=>forward(event)).toThrow(expect.objectContaining({code:"CODEX_BINDING_SCOPE_CHANGED"}));expect(sink).not.toHaveBeenCalled();await f.runtime.disconnectLocal();
});

function ownedSpawnFixture(){
 const f=fixture(),executable=join(f.root,"native.cjs"),marker=join(f.root,"app-server-started");
 writeFileSync(executable,"#!"+process.execPath+"\nrequire('node:fs').writeFileSync("+JSON.stringify(marker)+",'started');\n");chmodSync(executable,0o700);
 const runtime=new CodexExecutionRuntime({profile:{id:"p",alias:"P",codexHome:f.home,executable},runnerId:"local",assertInput:f.assertInput,bindingFor:f.bindingFor});
 return {...f,executable,marker,owned:runtime,input:()=>({...f.input(),executable})};
}
it.each(["owner","write","closed","current"] as const)("rechecks %s admission after the actual default owned version probe before service spawn",async mode=>{
 const f=ownedSpawnFixture(),entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();let returned=false,afterProbe=0,current=true;
 f.assertInput.mockImplementation(()=>{if(returned)afterProbe++;if(mode==="owner"&&!current)throw Error("owner revoked");});const input=f.input(),binding=vi.fn(input.onBinding),event=vi.fn();input.onBinding=binding;input.onNativeEvent=event;input.beforePrompt=()=>{if(mode==="write"&&!current)throw Error("write revoked");};
 const probe=vi.spyOn(versionProbe,"readOwnedNativeVersion").mockImplementation(async()=>{entered.resolve();await release.promise;returned=true;return `codex-cli ${codexAppServerProtocolVersion}`;});
 const turn=f.owned.start(input);
 try{await entered.promise;current=false;if(mode==="closed")f.owned.beginShutdown();release.resolve();await expect(turn.ready!()).rejects.toThrow();await expect(turn.result()).resolves.toMatchObject({state:"failed"});expect(existsSync(f.marker)).toBe(mode==="current");if(mode==="current")expect(afterProbe).toBeGreaterThan(0);expect(binding.mock.calls.length).toBe(0);expect(event.mock.calls.map(([fact])=>({state:fact.state,nativeSessionId:fact.nativeSessionId}))).toEqual([{state:"failed",nativeSessionId:undefined}]);expect(f.persisted.size).toBe(0);expect(probe.mock.calls.length).toBe(1);}
 finally{release.resolve();await f.owned.disconnectLocal();probe.mockRestore();}
});
it("checks the original write admission before the default owned version probe",async()=>{
 const f=ownedSpawnFixture(),probe=vi.spyOn(versionProbe,"readOwnedNativeVersion").mockResolvedValue(`codex-cli ${codexAppServerProtocolVersion}`),input=f.input();input.beforePrompt=()=>{throw Error("write already revoked");};const turn=f.owned.start(input);
 try{await expect(turn.ready!()).rejects.toThrow();await expect(turn.result()).resolves.toMatchObject({state:"failed"});expect(probe.mock.calls.length).toBe(0);expect(existsSync(f.marker)).toBe(false);}finally{await f.owned.disconnectLocal();probe.mockRestore();}
});
it("retains a forbidden asynchronous canonical owner until actual settlement after rejected admission",async()=>{
 const f=fixture(),gate=Promise.withResolvers<void>();f.assertInput.mockImplementation(()=>gate.promise);
 try{expect(()=>f.runtime.start(f.input())).toThrowError(expect.objectContaining({creationOutcome:"not-created"}));expect(f.factory).not.toHaveBeenCalled();expect(f.runtime.hasActiveOperations()).toBe(true);expect(await f.runtime.disconnectLocal()).toEqual([]);expect(f.runtime.hasActiveOperations()).toBe(true);}
 finally{gate.resolve();await vi.waitFor(()=>expect(f.runtime.hasActiveOperations()).toBe(false));await f.runtime.disconnectLocal();}
});
