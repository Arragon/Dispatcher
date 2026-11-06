import {existsSync,mkdirSync,mkdtempSync,realpathSync,rmSync,renameSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach,expect,it,vi} from "vitest";
import {AdapterStartError,PiRpcExecutionBackend,type PiRpcExecutionScope,type CliStartInput} from "@dispatcher/adapters";
import type {ExecutionContextRef,NativeBinding} from "@dispatcher/domain";
import {PiExecutionRuntime} from "../src/pi-runtime.js";
import {piRpcFixture} from "../../../packages/adapters/test/fixtures/pi-rpc.js";
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const uuid="12345678-1234-4234-8234-123456789abc";
function fixture(){
 const root=realpathSync(mkdtempSync(join(tmpdir(),"dispatcher-pi-runtime-"))),a=join(root,"a"),b=join(root,"b"),agentDirectory=join(root,"agent"),sessionDirectory=join(root,"sessions");for(const path of [a,b,agentDirectory,sessionDirectory])mkdirSync(path);roots.push(root);
 const persisted=new Map<string,NativeBinding>(),entries:Array<{scope:PiRpcExecutionScope;reference:ExecutionContextRef;backend:PiRpcExecutionBackend;starts:ReturnType<typeof vi.spyOn>;source:ReturnType<typeof vi.spyOn>;disconnect:ReturnType<typeof vi.spyOn>}>=[],assertInput=vi.fn();let unknown=false;
 const factory=vi.fn((scope:PiRpcExecutionScope,reference:ExecutionContextRef)=>{
  const backend=new PiRpcExecutionBackend({scope,executionRef:reference});
  const starts=vi.spyOn(backend,"start").mockImplementation(input=>{const ready=Promise.resolve().then(async()=>{input.beforePrompt!();await input.onBinding!({version:1,product:"pi",region:"global",profileId:scope.profileId,backendId:"pi-rpc",runnerId:scope.runnerId,nativeStoreRef:scope.nativeStoreRef,nativeSessionId:input.nativeInput!.providerSessionId!,identityState:"bound",executionRefId:reference.id});input.beforePrompt!();});void ready.catch(()=>undefined);return {ready:()=>ready,status:()=>"completed",result:async()=>{await ready;return {state:"completed",summary:"fixture",events:[]};},cancel:async()=>{await backend.disconnectLocal();}};});
  const source=vi.spyOn(backend,"source").mockReturnValue(undefined),disconnect=vi.spyOn(backend,"disconnectLocal").mockImplementation(async()=>({version:1,connection:unknown?"unknown":"closed",ownedRoot:unknown?"unknown":"not-created",callbacks:unknown?"unknown":"drained",backgroundTools:"unknown",nativeSessionDeleted:false}));entries.push({scope,reference,backend,starts,source,disconnect});return backend;
 });
 const runtime=new PiExecutionRuntime({profile:{id:"p",alias:"Pi",executable:"/fixture/pi",model:"fixture/model"},agentDirectory,sessionDirectory,runnerId:"local",assertInput,bindingFor:id=>persisted.get(id),factory});
 const input=(id="a",path=a):CliStartInput=>({executable:"/fixture/pi",args:[],workspacePath:path,executionRef:{version:1,id,kind:"managed-worktree",runnerId:"local",repositoryId:"repo",workspaceId:id,pathRef:"workspace:"+id,branch:"task/"+id,baseRevision:"sha"},nativeInput:{version:1,profileId:"p",backendId:"pi-rpc",runId:"run-"+id,sessionId:"session-"+id,commandId:"observer-"+id,newSession:true,providerSessionId:id==="a"?uuid:"12345678-1234-4234-8234-123456789abd",prompt:"literal",approveTools:false,executionSelection:{version:1,mode:"legacy",selectionType:"explicit-model",source:"legacy-config",profileId:"p",providerId:"pi",backendId:"pi-rpc",runnerId:"local",configRevision:1,contextFingerprint:"frozen-scope",selectedAt:"2026-10-22T00:00:00Z",requestedModel:"fixture/model",nativeParameters:{}}},beforePrompt:()=>{},onBinding:async binding=>{persisted.set(binding.nativeSessionId,binding);}});
 return {root,a,b,agentDirectory,sessionDirectory,runtime,factory,assertInput,input,persisted,entries,setUnknown:()=>{unknown=true;}};
}
it("lazily routes each original execution and gates source on exact persisted identity",async()=>{const f=fixture();expect(f.factory).not.toHaveBeenCalled();const a=f.runtime.start(f.input()),b=f.runtime.start(f.input("b",f.b));await Promise.all([a.ready!(),b.ready!()]);expect(f.entries).toHaveLength(2);expect(f.entries.map(e=>e.scope.workspacePath)).toEqual([f.a,f.b]);const binding=f.persisted.get(uuid)!;f.runtime.source(binding);expect(f.entries[0]!.source).toHaveBeenCalledWith(binding);f.runtime.source({...binding,executionRefId:"b"});expect(f.entries[1]!.source).not.toHaveBeenCalled();f.persisted.delete(uuid);f.runtime.source(binding);expect(f.entries[0]!.source).toHaveBeenCalledTimes(1);expect(f.runtime.hasUnclosedHosts()).toBe(true);await f.runtime.disconnectLocal();expect(f.runtime.hasUnclosedHosts()).toBe(false);});
it.each(["missing","remote","continuation","backend","uuid","executable"])("refuses %s before backend allocation",mode=>{const f=fixture(),input=f.input();if(mode==="missing")delete input.executionRef;if(mode==="remote")input.executionRef={...input.executionRef!,runnerId:"remote"};if(mode==="continuation")input.nativeInput!.newSession=false;if(mode==="backend")input.nativeInput!.backendId="pi-cli-json";if(mode==="uuid")delete input.nativeInput!.providerSessionId;if(mode==="executable")input.executable="/different/pi";expect(()=>f.runtime.start(input)).toThrowError(expect.objectContaining({creationOutcome:"not-created"}));expect(f.factory).not.toHaveBeenCalled();});
it("refuses stale canonical authority before allocation",()=>{const f=fixture();f.assertInput.mockImplementation(()=>{throw Error("private changed");});expect(()=>f.runtime.start(f.input())).toThrowError(expect.objectContaining({code:"PI_RPC_SCOPE_CHANGED"}));expect(f.factory).not.toHaveBeenCalled();});
it("copies original input before host acquisition",async()=>{const f=fixture(),input=f.input(),turn=f.runtime.start(input);input.nativeInput!.prompt="mutated";input.executionRef!.id="mutated";input.nativeInput!.executionSelection!.requestedModel="mutated/model";await turn.ready!();expect(f.entries[0]!.starts.mock.calls[0]![0]).toMatchObject({executionRef:{id:"a"},nativeInput:{prompt:"literal",executionSelection:{requestedModel:"fixture/model"}}});await f.runtime.disconnectLocal();});
it("closes admission during acquisition before producer start",async()=>{const f=fixture(),turn=f.runtime.start(f.input());f.runtime.beginShutdown();await expect(turn.ready!()).rejects.toMatchObject({code:"PI_RPC_LOCAL_CONNECTION_CLOSED"});await expect(turn.result()).rejects.toThrow();expect(f.entries[0]!.starts).not.toHaveBeenCalled();expect((await f.runtime.disconnectLocal())[0]).toMatchObject({backendId:"pi-rpc",executionRefId:"a",callbacks:"drained",backgroundTools:"unknown"});});
it("admits native creation once for a repeated execution",async()=>{const f=fixture(),a=f.runtime.start(f.input()),b=f.runtime.start(f.input());await a.ready!();await expect(b.ready!()).rejects.toMatchObject({code:"PI_RPC_SESSION_ALREADY_ADMITTED",creationOutcome:"not-created"});expect(f.factory).toHaveBeenCalledTimes(1);expect(f.entries[0]!.starts).toHaveBeenCalledTimes(1);await f.runtime.disconnectLocal();});
it.each(["agentDirectory","sessionDirectory"] as const)("refuses %s replacement at queued admission",async field=>{const f=fixture(),turn=f.runtime.start(f.input());renameSync(f[field],f[field]+".old");mkdirSync(f[field]);await expect(turn.ready!()).rejects.toMatchObject({code:"PI_RPC_SCOPE_CHANGED"});expect(f.entries[0]!.starts).not.toHaveBeenCalled();await f.runtime.disconnectLocal();});
it("never hides asynchronous original authority behind the runtime wrapper",async()=>{const f=fixture(),input=f.input();input.beforePrompt=async()=>{};const turn=f.runtime.start(input);await expect(turn.ready!()).rejects.toMatchObject({code:"PI_RPC_ADMISSION_MUST_BE_SYNCHRONOUS"});expect(f.persisted.size).toBe(0);await f.runtime.disconnectLocal();});
it("unknown cleanup remains unclosed and idempotent",async()=>{const f=fixture(),turn=f.runtime.start(f.input());await turn.ready!();f.setUnknown();const first=await f.runtime.disconnectLocal();expect(first[0]).toMatchObject({connection:"unknown",callbacks:"unknown",nativeSessionDeleted:false});expect(f.runtime.hasUnclosedHosts()).toBe(true);expect(await f.runtime.disconnectLocal()).toEqual(first);expect(f.entries[0]!.disconnect).toHaveBeenCalledTimes(1);expect(f.runtime.source(f.persisted.get(uuid)!)).toBeUndefined();});
it("never-started shutdown allocates no host",async()=>{const f=fixture();expect(await f.runtime.disconnectLocal()).toEqual([]);expect(f.factory).not.toHaveBeenCalled();expect(f.runtime.hasUnclosedHosts()).toBe(false);});
it("isolates profiles sharing a configured native store",async()=>{const f=fixture(),other=new PiExecutionRuntime({profile:{id:"other",alias:"Other",executable:"/fixture/pi",model:"fixture/model"},agentDirectory:f.agentDirectory,sessionDirectory:f.sessionDirectory,runnerId:"local",assertInput:f.assertInput,bindingFor:id=>f.persisted.get(id),factory:f.factory}),input=f.input("b",f.b);input.nativeInput!.profileId="other";input.nativeInput!.executionSelection!.profileId="other";const a=f.runtime.start(f.input()),b=other.start(input);await Promise.all([a.ready!(),b.ready!()]);expect(f.entries[0]!.scope.nativeStoreRef).toBe(f.entries[1]!.scope.nativeStoreRef);expect(f.entries[0]!.scope.scopeFingerprint).not.toBe(f.entries[1]!.scope.scopeFingerprint);f.runtime.source(f.persisted.get(input.nativeInput!.providerSessionId!)!);other.source(f.persisted.get(uuid)!);expect(f.entries.every(entry=>entry.source.mock.calls.length===0)).toBe(true);await Promise.all([f.runtime.disconnectLocal(),other.disconnectLocal()]);});
it("cancels an acquiring turn before producer admission",async()=>{const f=fixture(),turn=f.runtime.start(f.input());await turn.cancel();await expect(turn.ready!()).rejects.toMatchObject({code:"PI_RPC_LOCAL_CONNECTION_CLOSED"});expect(f.entries[0]!.starts).not.toHaveBeenCalled();await f.runtime.disconnectLocal();});
it("rejects workspace replacement during host acquisition",async()=>{const f=fixture(),turn=f.runtime.start(f.input());renameSync(f.a,f.a+".old");mkdirSync(f.a);await expect(turn.ready!()).rejects.toMatchObject({code:"PI_RPC_SCOPE_CHANGED"});expect(f.entries[0]!.starts).not.toHaveBeenCalled();await f.runtime.disconnectLocal();});
it("does not let a refused duplicate turn cancel the original owned backend",async()=>{const f=fixture(),original=f.runtime.start(f.input());await original.ready!();const duplicate=f.runtime.start(f.input());await expect(duplicate.ready!()).rejects.toMatchObject({code:"PI_RPC_SESSION_ALREADY_ADMITTED"});await duplicate.cancel();expect(f.entries[0]!.disconnect).not.toHaveBeenCalled();f.runtime.source(f.persisted.get(uuid)!);expect(f.entries[0]!.source).toHaveBeenCalledOnce();await f.runtime.disconnectLocal();});

it("closes a rejected version probe only after its independent not-created cleanup receipt",async()=>{
 const f=fixture(),native=piRpcFixture(roots,"exec-ok","0.0.0"),runtime=new PiExecutionRuntime({profile:{id:"p",alias:"Pi",executable:native.scope.executable,model:"fixture/exec-ok"},agentDirectory:native.scope.agentDirectory,sessionDirectory:native.scope.sessionDirectory,runnerId:"local",assertInput:()=>{},bindingFor:()=>undefined});
 const input=f.input();input.executable=native.scope.executable;input.workspacePath=native.scope.workspacePath;input.nativeInput!.executionSelection!.requestedModel="fixture/exec-ok";
 try{
  const turn=runtime.start(input);await expect(turn.ready!()).rejects.toMatchObject({code:"PI_RPC_VERSION_UNQUALIFIED",creationOutcome:"not-created"});
  expect(runtime.hasUnclosedHosts()).toBe(false);expect(runtime.isClosed()).toBe(true);expect(existsSync(join(native.root,"rpc-started"))).toBe(false);
  expect(await runtime.disconnectLocal()).toEqual([expect.objectContaining({connection:"closed",ownedRoot:"not-created",callbacks:"drained",backgroundTools:"unknown",nativeSessionDeleted:false})]);
 }finally{await runtime.disconnectLocal();}
});
it("releases configuration admission after a synchronous not-created backend failure",async()=>{
 const f=fixture(),turn=f.runtime.start(f.input());f.entries[0]!.starts.mockImplementation(()=>{throw new AdapterStartError("not-created","PI_RPC_START_INVALID","fixture");});
 try{await expect(turn.ready!()).rejects.toMatchObject({code:"PI_RPC_START_INVALID",creationOutcome:"not-created"});expect(f.runtime.hasUnclosedHosts()).toBe(false);expect(f.runtime.isClosed()).toBe(true);}
 finally{await f.runtime.disconnectLocal();}
});
it.each(["connection","ownedRoot","callbacks"] as const)("retains a not-created failure when cleanup %s is unknown",async field=>{
 const f=fixture(),turn=f.runtime.start(f.input());f.entries[0]!.starts.mockImplementation(()=>{throw new AdapterStartError("not-created","PI_RPC_PROBE_EXIT_UNCONFIRMED","fixture");});
 f.entries[0]!.disconnect.mockResolvedValue({version:1,connection:"closed",ownedRoot:"not-created",callbacks:"drained",backgroundTools:"unknown",nativeSessionDeleted:false,[field]:"unknown"});
 try{await expect(turn.ready!()).rejects.toMatchObject({creationOutcome:"not-created"});expect(f.entries[0]!.disconnect).toHaveBeenCalledOnce();expect(f.runtime.hasUnclosedHosts()).toBe(true);expect(f.runtime.isClosed()).toBe(false);}
 finally{await f.runtime.disconnectLocal();}
});
it("never closes another admitted execution after a known not-created failure",async()=>{
 const f=fixture(),original=f.runtime.start(f.input());await original.ready!();const closed=vi.spyOn(f.entries[0]!.backend,"beginShutdown"),failed=f.runtime.start(f.input("b",f.b));
 f.entries[1]!.starts.mockImplementation(()=>{throw new AdapterStartError("not-created","PI_RPC_START_INVALID","fixture");});
 try{
  await expect(failed.ready!()).rejects.toMatchObject({creationOutcome:"not-created"});expect(f.entries[1]!.disconnect).toHaveBeenCalledOnce();
  expect(f.runtime.hasUnclosedHosts()).toBe(true);expect(f.runtime.isClosed()).toBe(false);expect(closed).not.toHaveBeenCalled();expect(f.entries[0]!.disconnect).not.toHaveBeenCalled();
  f.runtime.source(f.persisted.get(uuid)!);expect(f.entries[0]!.source).toHaveBeenCalledOnce();
 }finally{await f.runtime.disconnectLocal();}
});
it("retains an unknown creation outcome without treating local cleanup as not-created",async()=>{
 const f=fixture(),turn=f.runtime.start(f.input());f.entries[0]!.starts.mockImplementation(()=>{throw new AdapterStartError("unknown","PI_RPC_START_OUTCOME_UNKNOWN","fixture");});
 try{await expect(turn.ready!()).rejects.toMatchObject({creationOutcome:"unknown"});expect(f.runtime.hasUnclosedHosts()).toBe(true);expect(f.runtime.isClosed()).toBe(false);expect(f.entries[0]!.disconnect).not.toHaveBeenCalled();}
 finally{await f.runtime.disconnectLocal();}
});

it.each(["assertInput","assertInput-startup","beforePrompt"] as const)("retains entered runtime %s work independently of public failure and host receipts",async boundary=>{
 const f=fixture(),held=Promise.withResolvers<void>();let getters=0,thenCalls=0;
 const result={get then(){getters++;return (resolve:()=>void,reject:(reason:unknown)=>void)=>{thenCalls++;void held.promise.then(resolve,reject);};}};
 const input=f.input();if(boundary==="assertInput")f.assertInput.mockReturnValue(result);else if(boundary==="assertInput-startup")f.assertInput.mockImplementation(()=>f.runtime["executions"].size>0?result:undefined);else input.beforePrompt=()=>result as never;
 try{
  if(boundary==="assertInput")expect(()=>f.runtime.start(input)).toThrowError(expect.objectContaining({code:"PI_RPC_SCOPE_CHANGED",creationOutcome:"not-created"}));
  else{const code=boundary==="assertInput-startup"?"PI_RPC_SCOPE_CHANGED":"PI_RPC_ADMISSION_MUST_BE_SYNCHRONOUS",turn=f.runtime.start(input);await expect(turn.ready!()).rejects.toMatchObject({code,creationOutcome:"not-created"});await expect(turn.result()).rejects.toMatchObject({code});}
  const receipts=await f.runtime.disconnectLocal();expect(f.runtime.hasUnclosedHosts()).toBe(false);expect(f.persisted.size).toBe(0);
  expect(f.runtime.hasActiveOperations()).toBe(true);expect(getters).toBe(1);expect(thenCalls).toBe(1);if(boundary==="assertInput")expect(f.factory).not.toHaveBeenCalled();
  held.reject(Error("late private runtime rejection"));await vi.waitFor(()=>expect(f.runtime.hasActiveOperations()).toBe(false));
  expect(await f.runtime.disconnectLocal()).toEqual(receipts);expect(f.persisted.size).toBe(0);expect(f.entries.every(entry=>entry.source.mock.calls.length===0)).toBe(true);expect(getters).toBe(1);expect(thenCalls).toBe(1);
 }finally{held.resolve();}
});
it("tracks acquisition readiness until it really settles",async()=>{
 const f=fixture(),held=Promise.withResolvers<void>(),turn=f.runtime.start(f.input());
 f.entries[0]!.starts.mockReturnValue({ready:()=>held.promise,status:()=>"completed",result:async()=>({state:"completed",summary:"fixture",events:[]}),cancel:async()=>{}});
 try{await vi.waitFor(()=>expect(f.entries[0]!.starts).toHaveBeenCalledOnce());expect(f.runtime.hasActiveOperations()).toBe(true);f.runtime.beginShutdown();expect(f.runtime.hasActiveOperations()).toBe(true);}
 finally{held.resolve();await turn.ready!();await f.runtime.disconnectLocal();}
 expect(f.runtime.hasActiveOperations()).toBe(false);
});
it("consumes a runtime guard then getter rejection exactly once",async()=>{
 const f=fixture();let getters=0;f.assertInput.mockReturnValue({get then(){getters++;throw Error("private runtime getter");}});
 expect(()=>f.runtime.start(f.input())).toThrowError(expect.objectContaining({code:"PI_RPC_SCOPE_CHANGED"}));expect(f.runtime.hasActiveOperations()).toBe(true);
 await vi.waitFor(()=>expect(f.runtime.hasActiveOperations()).toBe(false));expect(getters).toBe(1);expect(await f.runtime.disconnectLocal()).toEqual([]);
});
