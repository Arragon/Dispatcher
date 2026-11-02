import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import * as publicAdapters from "../src/index.js";
import * as nativeAdapters from "../src/codex-app-server.js";
const adapters={...publicAdapters,...nativeAdapters};
import type { ExecutionSelection, NativeBinding, NativeBindingEvent } from "@dispatcher/domain";
import type { CodexAppServerScope, CodexRpcTransport } from "../src/codex-app-server.js";
import type {CodexStartInput} from "../src/codex.js";
import type {AdapterStartInput} from "../src/contracts.js";
import type { NativeReadRequest } from "../src/interaction-contracts.js";

const root=realpathSync(mkdtempSync(join(tmpdir(),"dispatcher-codex-contract-")));
const roots=[root];
afterAll(()=>{for(const path of roots)rmSync(path,{recursive:true,force:true});});
const scope:CodexAppServerScope={profileId:"p",runnerId:"local",nativeStoreRef:"native-store:fixture",scopeFingerprint:"tuple",executionRefId:"exec-ref",codexHome:root,workspacePath:root,executable:"codex",approvalPolicy:"on-request",sandbox:"workspace-write"};
const binding:NativeBinding={version:1,product:"codex",region:"global",profileId:"p",backendId:"codex-app-server",runnerId:"local",nativeStoreRef:"native-store:fixture",nativeSessionId:"thread-1",nativeThreadId:"thread-1",identityState:"bound",executionRefId:"exec-ref"};
const sandbox={type:"workspaceWrite",writableRoots:[],networkAccess:false,excludeSlashTmp:false,excludeTmpdirEnvVar:false};
const thread=(id="thread-1",status="idle")=>({id,sessionId:id,cliVersion:"0.166.0-alpha.5.1",createdAt:1,updatedAt:2,cwd:root,ephemeral:false,modelProvider:"openai",model:"test-model",reasoningEffort:"high",source:"appServer",status:{type:status},turns:[],preview:"",projectId:null,path:null});
class ProtocolFixture implements CodexRpcTransport {
  calls:Array<{method:string;params:Record<string,unknown>}>=[];
  handlers=new Map<string,(params:Record<string,unknown>)=>unknown|Promise<unknown>>();
  listeners=new Set<(method:string,params:unknown)=>void>();
  disconnects=new Set<()=>void>();
  async request(method:string,params:Record<string,unknown>,signal?:AbortSignal):Promise<unknown>{
    if(signal?.aborted)throw new adapters.AdapterContractError("CODEX_NATIVE_UNREACHABLE","aborted");
    this.calls.push({method,params:structuredClone(params)});
    const custom=this.handlers.get(method);if(custom)return custom(params);
    if(method==="initialize")return {codexHome:root,platformFamily:"unix",platformOs:"macos",userAgent:"codex_cli_rs/0.166.0-alpha.5.1"};
    if(method==="thread/start"||method==="thread/resume")return {thread:thread(),model:"test-model",modelProvider:"openai",cwd:root,approvalPolicy:"on-request",approvalsReviewer:"user",sandbox,reasoningEffort:"high"};
    if(method==="thread/read")return {thread:thread(String(params.threadId))};
    if(method==="turn/start")return {turn:{id:"turn-1",items:[],status:"inProgress"}};
    if(method==="turn/interrupt")return {};
    if(method==="thread/turns/list")return {data:[{id:"turn-1",status:"completed",itemsView:"full",items:[{id:"user-1",type:"userMessage",content:[{type:"text",text:"first"}]},{id:"assistant-1",type:"agentMessage",text:"answer"}]}],nextCursor:null,backwardsCursor:"anchor"};
    throw new Error("Unimplemented fixture method");
  }
  notify(method:string,params:Record<string,unknown>):void {this.calls.push({method,params});}
  onNotification(listener:(method:string,params:unknown)=>void):()=>void {this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  onDisconnect(listener:()=>void):()=>void {this.disconnects.add(listener);return()=>this.disconnects.delete(listener);}
  emit(method:string,params:unknown):void {for(const listener of this.listeners)listener(method,params);}
  async close():Promise<void>{for(const listener of this.disconnects)listener();}
  async disconnectLocal(){await this.close();return {version:1 as const,connection:"closed" as const,ownedRoot:"exited" as const,callbacks:"drained" as const,backgroundTools:"unknown" as const,nativeSessionDeleted:false as const};}
}
function setup(options:Partial<CodexAppServerScope>={}){
  expect(adapters).toHaveProperty("CodexAppServerBackend");
  const rpc=new ProtocolFixture();
  const backend=new adapters.CodexAppServerBackend({...scope,...options},async()=>rpc);
  return {rpc,backend};
}
it("does not initialize or query native history for an already cancelled read",async()=>{
 const {rpc,backend}=setup();backend.registerBinding(binding);const controller=new AbortController();controller.abort();const read:NativeReadRequest={requestId:"cancelled-history",observerEpoch:"reader",sequence:1,signal:controller.signal};await expect(backend.history(binding,{limit:10},read)).rejects.toMatchObject({code:"CODEX_NATIVE_UNREACHABLE"});expect(rpc.calls).toEqual([]);
});
it("does not admit history or a final snapshot after cancellation during the first read",async()=>{
 const {rpc,backend}=setup();backend.registerBinding(binding);const controller=new AbortController(),read:NativeReadRequest={requestId:"history",observerEpoch:"reader",sequence:1,signal:controller.signal};rpc.handlers.set("thread/read",()=>{controller.abort();return {thread:thread()};});await expect(backend.history(binding,{limit:10},read)).rejects.toMatchObject({code:"CODEX_NATIVE_UNREACHABLE"});expect(rpc.calls.filter(c=>c.method==="thread/read")).toHaveLength(1);expect(rpc.calls.some(c=>c.method==="thread/turns/list")).toBe(false);
});
it("does not admit thread reads after a shared initialization finishes for a cancelled history caller",async()=>{
 const {rpc,backend}=setup();backend.registerBinding(binding);const controller=new AbortController(),held=Promise.withResolvers<void>(),read:NativeReadRequest={requestId:"history",observerEpoch:"reader",sequence:1,signal:controller.signal};rpc.handlers.set("initialize",async()=>{await held.promise;return {codexHome:root};});const result=backend.history(binding,{limit:10},read);
 try{await vi.waitFor(()=>expect(rpc.calls.some(call=>call.method==="initialize")).toBe(true));controller.abort();held.resolve();await expect(result).rejects.toMatchObject({code:"CODEX_NATIVE_UNREACHABLE"});expect(rpc.calls.some(call=>call.method.startsWith("thread/"))).toBe(false);}
 finally{held.resolve();await result.catch(()=>undefined);}
});
it.each(["page","final-snapshot"] as const)("rejects cancellation during the Codex history %s",async stage=>{
 const {rpc,backend}=setup();backend.registerBinding(binding);const controller=new AbortController(),read:NativeReadRequest={requestId:"history",observerEpoch:"reader",sequence:1,signal:controller.signal},request=rpc.request.bind(rpc);let snapshots=0;const calls=vi.spyOn(rpc,"request").mockImplementation(async(method,params,signal)=>{if(method==="thread/read"||method==="thread/turns/list")expect(signal).toBe(controller.signal);const result=await request(method,params,signal);if(stage==="page"&&method==="thread/turns/list"||stage==="final-snapshot"&&method==="thread/read"&&++snapshots===2)controller.abort();return result;});await expect(backend.history(binding,{limit:10},read)).rejects.toMatchObject({code:"CODEX_NATIVE_UNREACHABLE"});expect(calls.mock.calls.filter(([method])=>method==="thread/read")).toHaveLength(stage==="page"?1:2);expect(rpc.calls.some(call=>["thread/start","thread/resume","turn/start"].includes(call.method))).toBe(false);
});
it("captures Codex history binding and bounds before awaiting its first snapshot",async()=>{
 const {rpc,backend}=setup();backend.registerBinding(binding);backend.registerBinding({...binding,nativeSessionId:"thread-2",nativeThreadId:"thread-2"});const selected={...binding},input={limit:10,cursor:"original"};
 rpc.handlers.set("thread/read",params=>{selected.nativeSessionId="thread-2";selected.nativeThreadId="thread-2";input.cursor="changed";input.limit=1;return {thread:thread(String(params.threadId))};});expect(await backend.history(selected,input)).toMatchObject({nativeSessionId:"thread-1"});expect(rpc.calls.find(call=>call.method==="thread/turns/list")?.params).toMatchObject({threadId:"thread-1",limit:10,cursor:"original"});expect(rpc.calls.filter(call=>call.method==="thread/read").every(call=>call.params.threadId==="thread-1")).toBe(true);
});
const executionRef=()=>({version:1 as const,id:"exec-ref",kind:"managed-worktree" as const,runnerId:"local",repositoryId:"repo",workspaceId:"w",pathRef:"workspace:w",branch:"task/run",baseRevision:"sha"});
const selection=():ExecutionSelection=>({version:1,mode:"manual",source:"explicit",profileId:"p",providerId:"codex",runnerId:"local",backendId:"codex-app-server",selectionType:"explicit-model",requestedModel:"test-model",nativeParameters:{reasoningEffort:"high"},contextFingerprint:"tuple",configRevision:1,selectedAt:new Date().toISOString()});
const input=()=>({executable:"codex",codexHome:root,workspacePath:root,prompt:"first",model:"test-model",reasoningEffort:"high",commandId:"command-1",executionRef:executionRef(),executionSelection:selection(),beforePrompt:()=>undefined,onBinding:async()=>undefined,onNativeEvent:()=>undefined});
it.each(["start","history"] as const)("rejects a foreign root session identity during %s",async stage=>{
 const {rpc,backend}=setup(),onBinding=vi.fn();
 if(stage==="start"){
  rpc.handlers.set("thread/start",()=>({thread:{...thread(),sessionId:"foreign-root"},model:"test-model",modelProvider:"openai",cwd:root,approvalPolicy:"on-request",approvalsReviewer:"user",sandbox,reasoningEffort:"high"}));
  await expect(backend.start({...input(),onBinding}).ready!()).rejects.toMatchObject({code:"CODEX_THREAD_IDENTITY_CHANGED",creationOutcome:"unknown"});expect(onBinding).not.toHaveBeenCalled();
 }else{
  backend.registerBinding(binding);rpc.handlers.set("thread/read",()=>({thread:{...thread(),sessionId:"foreign-root"}}));
  await expect(backend.history(binding,{limit:10})).rejects.toMatchObject({code:"CODEX_THREAD_IDENTITY_CHANGED"});expect(rpc.calls.some(call=>call.method==="thread/turns/list")).toBe(false);
 }
 expect(rpc.calls.some(call=>["turn/start","thread/resume"].includes(call.method))).toBe(false);
 await backend.disconnectLocal();
});
it("refuses a thread created by the previous protocol without rewriting its binding",async()=>{
 const {rpc,backend}=setup();backend.registerBinding(binding);rpc.handlers.set("thread/read",()=>({thread:{...thread(),cliVersion:"0.162.0-alpha.17.2"}}));
 await expect(backend.inspect(binding)).rejects.toMatchObject({code:"CODEX_THREAD_IDENTITY_CHANGED"});expect(rpc.calls.some(call=>["thread/start","thread/resume","turn/start"].includes(call.method))).toBe(false);await backend.disconnectLocal();
});
const adapterInput=()=>({sessionId:"session",runId:"run",backendId:"codex-app-server",workspacePath:root,prompt:"first",executionRef:executionRef(),executionSelection:selection(),execution:{generation:1,attempt:1,leaseId:"lease"},beforeCreate:()=>undefined,beforeSend:()=>undefined});

describe("Codex persistent App Server contract",()=>{
  it.each(["executionRef","executionSelection","beforePrompt","onBinding","onNativeEvent"] as const)("requires canonical %s before native I/O",async field=>{
    const {rpc,backend}=setup(),request:CodexStartInput=input();delete request[field];
    await expect(backend.start(request).ready!()).rejects.toMatchObject({creationOutcome:"not-created"});expect(rpc.calls).toEqual([]);
  });
  it.each(["model","reasoningEffort"] as const)("rejects contradictory canonical %s before native I/O",async field=>{
    const {rpc,backend}=setup();await expect(backend.start({...input(),[field]:"changed"}).ready!()).rejects.toMatchObject({creationOutcome:"not-created",code:"CODEX_MODEL_PERMISSION_DRIFT"});expect(rpc.calls).toEqual([]);
  });
  it("rejects a Promise-returning final guard before native creation",async()=>{
    const {rpc,backend}=setup(),guard=vi.fn(async()=>undefined);
    await expect(backend.start({...input(),beforePrompt:guard}).ready!()).rejects.toMatchObject({creationOutcome:"not-created",code:"NATIVE_CAPABILITY_UNVERIFIED"});expect(rpc.calls.some(call=>call.method==="thread/start")).toBe(false);
  });
  it("captures canonical selection before asynchronous initialization",async()=>{
    const {rpc,backend}=setup(),request=input();rpc.handlers.set("initialize",()=>{request.executionSelection.requestedModel="changed";request.executionSelection.nativeParameters.reasoningEffort="low";return {codexHome:root};});
    await backend.start(request).ready!();expect(rpc.calls.find(call=>call.method==="turn/start")?.params).toMatchObject({model:"test-model",effort:"high"});
  });
  it("awaits received-event persistence before submitting the first prompt",async()=>{
    const {rpc,backend}=setup(),held=Promise.withResolvers<void>(),persist=vi.fn(fact=>fact.state==="received"?held.promise:undefined);
    const turn=backend.start({...input(),onNativeEvent:persist});await vi.waitFor(()=>expect(persist).toHaveBeenCalled());expect(rpc.calls.some(call=>call.method==="turn/start")).toBe(false);
    held.resolve();await turn.ready!();expect(rpc.calls.some(call=>call.method==="turn/start")).toBe(true);
  });
  it("blocks the first prompt after asynchronous received-event persistence fails",async()=>{
    const {rpc,backend}=setup(),held=Promise.withResolvers<void>();void held.promise.catch(()=>undefined);
    const persist=vi.fn(fact=>fact.state==="received"?held.promise:undefined),turn=backend.start({...input(),onNativeEvent:persist});await vi.waitFor(()=>expect(persist).toHaveBeenCalled());held.reject(new Error("database failed"));
    await expect(turn.ready!()).rejects.toMatchObject({creationOutcome:"unknown"});expect(rpc.calls.some(call=>call.method==="turn/start")).toBe(false);
  });
  it("keeps a terminal event pending until its durable sink completes",async()=>{
    const {rpc,backend}=setup(),held=Promise.withResolvers<void>(),persist=vi.fn(fact=>fact.state==="completed"?held.promise:undefined),turn=backend.start({...input(),onNativeEvent:persist});await turn.ready!();
    let settled=false;void turn.result().then(()=>{settled=true;});rpc.emit("turn/completed",{threadId:"thread-1",turn:{id:"turn-1",status:"completed",items:[]}});await Promise.resolve();expect(settled).toBe(false);expect(turn.status()).toBe("running");
    held.resolve();expect(await turn.result()).toMatchObject({state:"completed"});
  });
  it("does not persist terminal success ahead of an admitted running event",async()=>{
    const {rpc,backend}=setup(),held=Promise.withResolvers<void>();void held.promise.catch(()=>undefined);
    const persist=vi.fn(fact=>fact.state==="running"?held.promise:undefined),turn=backend.start({...input(),onNativeEvent:persist});await vi.waitFor(()=>expect(persist.mock.calls.some(([fact])=>fact.state==="running")).toBe(true));
    try{rpc.emit("turn/completed",{threadId:"thread-1",turn:{id:"turn-1",status:"completed",items:[]}});await Promise.resolve();expect(persist.mock.calls.some(([fact])=>fact.state==="completed")).toBe(false);
      held.reject(new Error("running persistence failed"));await expect(turn.ready!()).rejects.toMatchObject({creationOutcome:"unknown"});expect(await turn.result()).toMatchObject({state:"failed"});expect(persist.mock.calls.some(([fact])=>fact.state==="completed")).toBe(false);
    }finally{held.resolve();await turn.ready!().catch(()=>undefined);await turn.result();}
  });
  it("fences subsequent input when asynchronous terminal persistence fails",async()=>{
    const {rpc,backend}=setup(),held=Promise.withResolvers<void>();void held.promise.catch(()=>undefined);
    const turn=backend.start({...input(),onNativeEvent:fact=>fact.state==="completed"?held.promise:undefined});await turn.ready!();rpc.emit("turn/completed",{threadId:"thread-1",turn:{id:"turn-1",status:"completed",items:[]}});held.reject(new Error("database failed"));
    expect(await turn.result()).toMatchObject({state:"failed"});await expect(backend.start({...input(),providerSessionId:"thread-1"}).ready!()).rejects.toMatchObject({code:"CODEX_NATIVE_RECONCILIATION_REQUIRED"});
  });
  it("retains undrained terminal persistence independently of local root exit",async()=>{
    const {rpc,backend}=setup(),held=Promise.withResolvers<void>(),persist=vi.fn(fact=>fact.state==="completed"?held.promise:undefined),turn=backend.start({...input(),onNativeEvent:persist});await turn.ready!();rpc.emit("turn/completed",{threadId:"thread-1",turn:{id:"turn-1",status:"completed",items:[]}});await vi.waitFor(()=>expect(persist.mock.calls.some(([fact])=>fact.state==="completed")).toBe(true));vi.useFakeTimers();
    try{const disconnected=backend.disconnectLocal();await vi.advanceTimersByTimeAsync(5_001);expect(await disconnected).toMatchObject({ownedRoot:"exited",callbacks:"unknown"});held.resolve();await turn.result();expect((await backend.disconnectLocal()).callbacks).toBe("unknown");}finally{held.resolve();vi.useRealTimers();}
  });
  it("waits for an admitted binding callback before reporting local callbacks drained",async()=>{
    const {rpc,backend}=setup();let release!:()=>void;const gate=new Promise<void>(done=>{release=done;}),writes=vi.fn();
    const persist=vi.fn(async()=>{await gate;writes();}),turn=backend.start({...input(),onBinding:persist});await vi.waitFor(()=>expect(persist).toHaveBeenCalledTimes(1));
    let settled=false;const disconnect=backend.disconnectLocal().then(receipt=>{settled=true;return receipt;});
    await expect(turn.ready!()).rejects.toMatchObject({creationOutcome:"unknown"});expect(settled).toBe(false);expect(writes).not.toHaveBeenCalled();
    release();expect(await disconnect).toMatchObject({connection:"closed",ownedRoot:"exited",callbacks:"drained"});expect(writes).toHaveBeenCalledTimes(1);expect(rpc.calls.some(call=>call.method==="turn/start")).toBe(false);
  });
  it("reports undrained binding callbacks independently of owned root exit",async()=>{
    const {rpc,backend}=setup();let release!:()=>void;const gate=new Promise<void>(done=>{release=done;}),writes=vi.fn(),persist=vi.fn(async()=>{await gate;writes();});
    const turn=backend.start({...input(),onBinding:persist});await vi.waitFor(()=>expect(persist).toHaveBeenCalledTimes(1));vi.useFakeTimers();
    try{const disconnect=backend.disconnectLocal();await expect(turn.ready!()).rejects.toMatchObject({creationOutcome:"unknown"});await vi.advanceTimersByTimeAsync(5_001);
      expect(await disconnect).toMatchObject({connection:"closed",ownedRoot:"exited",callbacks:"unknown"});expect(writes).not.toHaveBeenCalled();release();await gate;await Promise.resolve();
      expect(writes).toHaveBeenCalledTimes(1);expect((await backend.disconnectLocal()).callbacks).toBe("unknown");expect(rpc.calls.some(call=>call.method==="turn/start")).toBe(false);expect(vi.getTimerCount()).toBe(0);
    }finally{release();vi.useRealTimers();}
  });
  it("does not submit a native create after its final admission callback closes the connection",async()=>{
    const {rpc,backend}=setup();let calls=0;const turn=backend.start({...input(),beforePrompt:()=>{if(++calls===2)void backend.disconnectLocal();}});
    await expect(turn.ready!()).rejects.toMatchObject({creationOutcome:"not-created"});expect(rpc.calls.some(call=>call.method==="thread/start")).toBe(false);await backend.disconnectLocal();
  });
  it("disconnects a never-started local runtime without acquiring or deleting a native session",async()=>{
    const rpc=new ProtocolFixture(),connect=vi.fn(async()=>rpc),backend=new adapters.CodexAppServerBackend(scope,connect);
    expect(await backend.disconnectLocal()).toMatchObject({version:1,connection:"closed",ownedRoot:"not-created",backgroundTools:"unknown",nativeSessionDeleted:false});
    expect(connect).not.toHaveBeenCalled();expect(()=>backend.start(input())).toThrow(expect.objectContaining({creationOutcome:"not-created"}));expect(connect).not.toHaveBeenCalled();
  });
  it("disconnects only its local host and withdraws callbacks without native stop or release",async()=>{
    const {rpc,backend}=setup(),other=setup(),events=vi.fn(),turn=backend.start({...input(),onNativeEvent:events});await turn.ready!();
    const otherTurn=other.backend.start(input());await otherTurn.ready!();const before=events.mock.calls.length;
    const disconnect=vi.spyOn(rpc,"disconnectLocal");expect(await backend.disconnectLocal()).toMatchObject({connection:"closed",ownedRoot:"exited",backgroundTools:"unknown",nativeSessionDeleted:false});
    expect(disconnect).toHaveBeenCalledTimes(1);expect(await turn.result()).toMatchObject({state:"failed"});
    rpc.emit("turn/completed",{threadId:"thread-1",turn:{id:"turn-1",status:"completed",items:[]}});expect(events).toHaveBeenCalledTimes(before);
    expect(rpc.listeners.size).toBe(0);expect(rpc.disconnects.size).toBe(0);expect(rpc.calls.some(c=>["turn/interrupt","thread/unsubscribe","thread/archive"].includes(c.method))).toBe(false);
    expect(backend.capabilities().releaseControl.support).toBe("unknown");expect(backend.capabilities().historyRead.support).toBe("unknown");expect(otherTurn.status()).toBe("running");
    other.rpc.emit("turn/completed",{threadId:"thread-1",turn:{id:"turn-1",status:"completed",items:[]}});await otherTurn.result();await other.backend.close();
  });
  it("does not persist a late thread acknowledgement or submit its first prompt after local disconnect",async()=>{
    const {rpc,backend}=setup();let reply!:(value:unknown)=>void;rpc.handlers.set("thread/start",()=>new Promise(done=>{reply=done;}));const persist=vi.fn();
    const turn=backend.start({...input(),onBinding:persist});await vi.waitFor(()=>expect(reply).toBeTypeOf("function"));const disconnecting=backend.disconnectLocal();
    reply({thread:thread(),model:"test-model",modelProvider:"openai",cwd:root,approvalPolicy:"on-request",approvalsReviewer:"user",sandbox,reasoningEffort:"high"});
    await disconnecting;await expect(turn.ready!()).rejects.toMatchObject({creationOutcome:"unknown"});expect(persist).not.toHaveBeenCalled();expect(rpc.calls.some(c=>c.method==="turn/start")).toBe(false);
  });
  it("closes a late acquired owned connection before initialization",async()=>{
    let acquired!:(rpc:CodexRpcTransport)=>void;const rpc=new ProtocolFixture(),connect=vi.fn(()=>new Promise<CodexRpcTransport>(done=>{acquired=done;})),backend=new adapters.CodexAppServerBackend(scope,connect);
    const turn=backend.start(input());await vi.waitFor(()=>expect(acquired).toBeTypeOf("function"));const disconnecting=backend.disconnectLocal();acquired(rpc);
    expect(await disconnecting).toMatchObject({connection:"closed",ownedRoot:"exited"});await expect(turn.ready!()).rejects.toMatchObject({creationOutcome:"not-created"});expect(rpc.calls).toEqual([]);expect(connect).toHaveBeenCalledTimes(1);
  });
  it("settles a disconnected start even when acquisition never answers",async()=>{
    const backend=new adapters.CodexAppServerBackend(scope,()=>new Promise(()=>{})),turn=backend.start(input());vi.useFakeTimers();
    try{const disconnecting=backend.disconnectLocal();await expect(turn.ready!()).rejects.toMatchObject({creationOutcome:"not-created"});await vi.advanceTimersByTimeAsync(5_001);expect(await disconnecting).toMatchObject({connection:"unknown",ownedRoot:"unknown"});}finally{vi.useRealTimers();}
  });
  it("settles a disconnected native create without waiting for a missing acknowledgement",async()=>{
    const {rpc,backend}=setup();rpc.handlers.set("thread/start",()=>new Promise(()=>{}));const turn=backend.start(input());await vi.waitFor(()=>expect(rpc.calls.some(c=>c.method==="thread/start")).toBe(true));
    await backend.disconnectLocal();await expect(turn.ready!()).rejects.toMatchObject({creationOutcome:"unknown"});expect(rpc.calls.some(c=>c.method==="turn/start")).toBe(false);
  });
  it("cleans an initialization interrupted by local disconnect without using legacy close",async()=>{
    const {rpc,backend}=setup();let reply!:(value:unknown)=>void;rpc.handlers.set("initialize",()=>new Promise(done=>{reply=done;}));const close=vi.spyOn(rpc,"close"),disconnect=vi.spyOn(rpc,"disconnectLocal").mockResolvedValue({version:1,connection:"closed",ownedRoot:"exited",callbacks:"drained",backgroundTools:"unknown",nativeSessionDeleted:false});
    const turn=backend.start(input());await vi.waitFor(()=>expect(reply).toBeTypeOf("function"));const disconnecting=backend.disconnectLocal();reply({codexHome:root});await disconnecting;
    await expect(turn.ready!()).rejects.toMatchObject({creationOutcome:"not-created"});expect(disconnect).toHaveBeenCalledTimes(1);expect(close).not.toHaveBeenCalled();expect(rpc.calls.some(c=>c.method==="initialized")).toBe(false);
  });
  it("cleans an already acquired root when initialization never acknowledges",async()=>{
    const {rpc,backend}=setup();rpc.handlers.set("initialize",()=>new Promise(()=>{}));const disconnect=vi.spyOn(rpc,"disconnectLocal"),turn=backend.start(input());
    await vi.waitFor(()=>expect(rpc.calls.some(call=>call.method==="initialize")).toBe(true));vi.useFakeTimers();
    try{const pending=backend.disconnectLocal();await expect(turn.ready!()).rejects.toMatchObject({creationOutcome:"not-created"});await vi.advanceTimersByTimeAsync(5_001);
      expect(await pending).toMatchObject({connection:"closed",ownedRoot:"exited",callbacks:"drained"});expect(disconnect).toHaveBeenCalledTimes(1);expect(rpc.calls.some(call=>call.method==="initialized")).toBe(false);
    }finally{vi.useRealTimers();}
  });
  it("does not assume legacy close proves an owned root or retry an uncertain disconnect",async()=>{
    const {rpc,backend}=setup();backend.registerBinding(binding);await backend.history(binding,{limit:10});Object.defineProperty(rpc,"disconnectLocal",{value:undefined});const close=vi.spyOn(rpc,"close");
    expect(await backend.disconnectLocal()).toMatchObject({connection:"unknown",ownedRoot:"unknown",backgroundTools:"unknown"});expect(await backend.disconnectLocal()).toMatchObject({connection:"unknown",ownedRoot:"unknown"});expect(close).not.toHaveBeenCalled();expect(rpc.listeners.size).toBe(0);
  });
  it("coalesces local disconnect and captures its receipt against caller mutation",async()=>{
    const {rpc,backend}=setup();backend.registerBinding(binding);await backend.history(binding,{limit:10});const disconnect=vi.spyOn(rpc,"disconnectLocal");
    const [a,b]=await Promise.all([backend.disconnectLocal(),backend.disconnectLocal()]);expect(disconnect).toHaveBeenCalledTimes(1);expect(a).toEqual(b);a.connection="unknown";expect((await backend.disconnectLocal()).connection).toBe("closed");
  });
  it("bounds a hung local disconnect and preserves unknown without repeated calls",async()=>{
    const {rpc,backend}=setup();backend.registerBinding(binding);await backend.history(binding,{limit:10});const disconnect=vi.spyOn(rpc,"disconnectLocal").mockImplementation(()=>new Promise(()=>{}));vi.useFakeTimers();
    try{const pending=backend.disconnectLocal();await vi.advanceTimersByTimeAsync(5_001);expect(await pending).toMatchObject({connection:"unknown",ownedRoot:"unknown",backgroundTools:"unknown"});await backend.disconnectLocal();expect(disconnect).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);}finally{vi.useRealTimers();}
  });
  it.each(["id","runner","kind"])("rejects canonical execution %s drift before native I/O",async drift=>{
    const {rpc,backend}=setup();const ref=executionRef();
    const changed=drift==="id"?{...ref,id:"foreign"}:drift==="runner"?{...ref,runnerId:"remote"}:{version:1 as const,id:"exec-ref",kind:"provider-cloud" as const,organizationRef:"o",environmentRef:"e",repositoryId:"repo",baseRevision:"sha"};
    const turn=backend.start({...input(),executionRef:changed});await expect(turn.ready!()).rejects.toMatchObject({creationOutcome:"not-created",code:"CODEX_SCOPE_CHANGED"});expect(rpc.calls).toEqual([]);
  });
  it("snapshots a logical managed reference before asynchronous native admission",async()=>{
    const {rpc,backend}=setup();const ref=executionRef();const turn=backend.start({...input(),executionRef:ref});ref.id="caller-change";ref.runnerId="remote";
    await expect(turn.ready!()).resolves.toBeUndefined();expect(rpc.calls.some(call=>call.method==="turn/start")).toBe(true);
    rpc.emit("turn/completed",{threadId:"thread-1",turn:{id:"turn-1",status:"completed",items:[]}});await turn.result();
  });
  it("persists a durable binding before the first turn is accepted or completed",async()=>{
    const {rpc,backend}=setup();let persisted:NativeBinding|undefined;const facts:unknown[]=[];
    rpc.handlers.set("turn/start",()=>{expect(persisted).toEqual(binding);return {turn:{id:"turn-1",items:[],status:"inProgress"}};});
    const turn=backend.start({...input(),onBinding:async ref=>{persisted=ref;},onNativeEvent:fact=>facts.push(fact)});
    await turn.ready!();expect(turn.status()).toBe("running");expect(facts).toContainEqual(expect.objectContaining({state:"received",nativeSessionId:"thread-1"}));
    expect(rpc.calls.find(c=>c.method==="thread/start")?.params).toMatchObject({ephemeral:false,allowProviderModelFallback:false,model:"test-model",cwd:root,sandbox:"workspace-write",approvalPolicy:"on-request"});
    expect(rpc.calls.find(c=>c.method==="turn/start")?.params).toMatchObject({threadId:"thread-1",model:"test-model",effort:"high",sandboxPolicy:sandbox,input:[{type:"text",text:"first"}]});
    rpc.emit("turn/completed",{threadId:"other",turn:{id:"turn-1",status:"completed",items:[]}});expect(turn.status()).toBe("running");
    rpc.emit("turn/completed",{threadId:"thread-1",turn:{id:"turn-1",status:"completed",items:[{id:"answer",type:"agentMessage",text:"done"}]}});
    expect(await turn.result()).toMatchObject({state:"completed",providerSessionId:"thread-1",summary:"done"});
  });
  it("does not send a prompt when durable binding persistence fails",async()=>{
    const {rpc,backend}=setup();const turn=backend.start({...input(),onBinding:async()=>{throw new Error("storage unavailable");}});
    await expect(turn.ready!()).rejects.toMatchObject({creationOutcome:"unknown"});
    expect(rpc.calls.filter(c=>c.method==="turn/start")).toEqual([]);
    expect(await turn.result()).toMatchObject({state:"failed"});
  });
  it("projects the complete binding through the existing adapter before prompting",async()=>{
    const {rpc,backend}=setup();const events:NativeBindingEvent[]=[];const store=new adapters.MemorySessionStore();
    const adapter=new adapters.CodexAdapter({id:"p",alias:"P",codexHome:root,executable:"codex"},backend,store);
    adapter.setNativeEventSink(event=>{events.push(event);},()=>()=>true);
    rpc.handlers.set("turn/start",()=>{expect(store.load("session")?.nativeBinding).toEqual(binding);expect(events[0]?.nativeBinding).toEqual(binding);return {turn:{id:"turn-1",items:[],status:"inProgress"}};});
    const session=await adapter.start(adapterInput());
    expect(session.nativeBinding).toEqual(binding);expect(adapter.interaction).toBe(backend);
  });
  it("blocks the initial prompt when the durable native event sink fails",async()=>{
    const {rpc,backend}=setup();const adapter=new adapters.CodexAdapter({id:"p",alias:"P",codexHome:root},backend);
    adapter.setNativeEventSink(()=>{throw new Error("database failed");},()=>()=>true);
    await expect(adapter.start(adapterInput())).rejects.toMatchObject({creationOutcome:"unknown"});
    expect(rpc.calls.filter(c=>c.method==="turn/start")).toEqual([]);
  });
  it.each(["sessionId","execution","executionRef","executionSelection","beforeCreate","beforeSend"] as const)("rejects Adapter startup without %s before native acquisition",async field=>{
    const {rpc,backend}=setup(),adapter=new adapters.CodexAdapter({id:"p",alias:"P",codexHome:root},backend),request:AdapterStartInput=adapterInput();delete request[field];adapter.setNativeEventSink(()=>undefined,()=>()=>true);
    await expect(adapter.start(request)).rejects.toMatchObject({creationOutcome:"not-created"});expect(rpc.calls).toEqual([]);expect(adapter.hasActiveOperations()).toBe(false);
  });
  it("requires an owning Adapter observer and synchronous guards",async()=>{
    const {rpc,backend}=setup(),adapter=new adapters.CodexAdapter({id:"p",alias:"P",codexHome:root},backend);
    await expect(adapter.start(adapterInput())).rejects.toMatchObject({creationOutcome:"not-created",code:"NATIVE_OBSERVER_UNAVAILABLE"});adapter.setNativeEventSink(()=>undefined,()=>()=>true);
    await expect(adapter.start({...adapterInput(),beforeCreate:async()=>undefined})).rejects.toMatchObject({creationOutcome:"not-created",code:"NATIVE_CAPABILITY_UNVERIFIED"});expect(rpc.calls).toEqual([]);
  });
  it.each(["selection","backend","observer"] as const)("classifies pre-creation %s rejection as known unsent",async failure=>{
    const {rpc,backend}=setup(),adapter=new adapters.CodexAdapter({id:"p",alias:"P",codexHome:root},backend),request=adapterInput();adapter.setNativeEventSink(()=>undefined,()=>{if(failure==="observer")throw new Error("observer failed");return()=>true;});
    if(failure==="selection")request.executionSelection.profileId="foreign";if(failure==="backend")request.backendId="foreign";
    await expect(adapter.start(request)).rejects.toMatchObject({creationOutcome:"not-created"});expect(rpc.calls).toEqual([]);expect(adapter.hasActiveOperations()).toBe(false);
  });
  it("keeps an argument-evaluation store failure known unsent until backend invocation",async()=>{
    const {rpc,backend}=setup(),store=new adapters.MemorySessionStore(),load=store.load.bind(store),start=vi.spyOn(backend,"start"),adapter=new adapters.CodexAdapter({id:"p",alias:"P",codexHome:root},backend,store);let guards=0,unavailable=false;vi.spyOn(store,"load").mockImplementation(id=>unavailable?undefined:load(id));adapter.setNativeEventSink(()=>undefined,()=>()=>true);
    await expect(adapter.start({...adapterInput(),beforeSend:()=>{if(++guards===2)unavailable=true;}})).rejects.toMatchObject({creationOutcome:"not-created"});expect(start).not.toHaveBeenCalled();expect(rpc.calls).toEqual([]);expect(adapter.hasActiveOperations()).toBe(false);
  });
  it("retains the Adapter binding while waiting for durable startup and blocks unqualified generic mutations",async()=>{
    const {rpc,backend}=setup(),store=new adapters.MemorySessionStore(),adapter=new adapters.CodexAdapter({id:"p",alias:"P",codexHome:root},backend,store),held=Promise.withResolvers<void>(),sink=vi.fn(()=>held.promise);adapter.setNativeEventSink(sink,()=>()=>true);
    const starting=adapter.start(adapterInput());await vi.waitFor(()=>expect(sink).toHaveBeenCalled());expect(adapter.hasActiveOperations()).toBe(true);expect(store.load("session")?.nativeBinding).toEqual(binding);expect(rpc.calls.some(call=>call.method==="turn/start")).toBe(false);held.resolve();const session=await starting;
    expect(session).toMatchObject({providerSessionId:"thread-1",nativeBinding:binding,executionRef:executionRef()});
    await expect(adapter.send(session.id,"next")).rejects.toMatchObject({code:"UNSUPPORTED_CAPABILITY"});await expect(adapter.resume(session.id)).rejects.toMatchObject({code:"UNSUPPORTED_CAPABILITY"});await expect(adapter.cancel(session.id)).rejects.toMatchObject({code:"CODEX_NATIVE_STOP_UNQUALIFIED"});expect(rpc.calls.filter(call=>call.method==="turn/start")).toHaveLength(1);
  });
  it("reads unloaded threads and full paginated history without resuming or prompting",async()=>{
    const {rpc,backend}=setup();backend.registerBinding(binding);
    rpc.handlers.set("thread/read",()=>({thread:thread("thread-1","notLoaded")}));
    expect(await backend.inspect(binding)).toMatchObject({state:"unknown",readability:"readable",nativeThreadId:"thread-1",reportedModel:{nativeSelectionId:"test-model",reasoning:"high"},pendingTools:"unknown"});
    expect(await backend.history(binding,{limit:10})).toMatchObject({state:"available",completeness:"complete",entries:[{id:"user-1",kind:"user",text:"first"},{id:"assistant-1",kind:"assistant",text:"answer"}]});
    expect(rpc.calls.map(c=>c.method)).toEqual(["initialize","initialized","thread/read","thread/read","thread/turns/list","thread/read"]);
    expect(rpc.calls.find(c=>c.method==="thread/turns/list")?.params).toEqual({threadId:"thread-1",limit:10,itemsView:"full",sortDirection:"asc"});
  });
  it("keeps a read handle on its captured thread after caller or displayed-binding mutation",async()=>{
    const {rpc,backend}=setup(),selected={...binding};backend.registerBinding(binding);backend.registerBinding({...binding,nativeSessionId:"thread-2",nativeThreadId:"thread-2"});const handle=backend.readHandle(selected);
    selected.nativeSessionId="thread-2";selected.nativeThreadId="thread-2";handle.binding.nativeSessionId="thread-2";handle.binding.nativeThreadId="thread-2";
    expect(await handle.inspect({requestId:"read",observerEpoch:"observer",sequence:1,signal:new AbortController().signal})).toMatchObject({nativeSessionId:"thread-1",nativeThreadId:"thread-1"});expect(rpc.calls.find(call=>call.method==="thread/read")?.params.threadId).toBe("thread-1");
  });
  it("labels unsupported history explicitly and never falls back to resume",async()=>{
    const {rpc,backend}=setup();backend.registerBinding(binding);
    rpc.handlers.set("thread/turns/list",()=>{throw new adapters.AdapterContractError("CODEX_METHOD_UNSUPPORTED","unsupported");});
    expect(await backend.history(binding,{limit:10})).toMatchObject({state:"unsupported",completeness:"unknown",entries:[],gaps:["CODEX_METHOD_UNSUPPORTED"]});
    expect(backend.capabilities().historyRead.support).toBe("unsupported");expect(rpc.calls.some(c=>c.method==="thread/resume")).toBe(false);
  });
  it.each(["home","cwd","ephemeral","model","permissions"])("rejects changed %s before inference",async(drift)=>{
    const {rpc,backend}=setup();
    if(drift==="home")rpc.handlers.set("initialize",()=>({codexHome:"/wrong",platformFamily:"unix",platformOs:"macos",userAgent:"native"}));
    else rpc.handlers.set("thread/start",()=>({thread:{...thread(),...(drift==="ephemeral"?{ephemeral:true}:{})},cwd:drift==="cwd"?"/wrong":root,model:drift==="model"?"different":"test-model",modelProvider:"openai",approvalPolicy:drift==="permissions"?"never":"on-request",approvalsReviewer:"user",sandbox,reasoningEffort:"high"}));
    const turn=backend.start(input());await expect(turn.ready!()).rejects.toBeInstanceOf(adapters.AdapterContractError);expect(rpc.calls.some(c=>c.method==="turn/start")).toBe(false);
  });
  it("resumes only the exact requested thread with frozen model and permissions",async()=>{
    const {rpc,backend}=setup();backend.registerBinding(binding);
    const turn=backend.start({...input(),providerSessionId:"thread-1"});await turn.ready!();
    expect(rpc.calls.find(c=>c.method==="thread/resume")?.params).toMatchObject({threadId:"thread-1",model:"test-model",approvalPolicy:"on-request",sandbox:"workspace-write"});
    expect(rpc.calls.some(c=>c.method==="thread/start")).toBe(false);
    rpc.emit("turn/completed",{threadId:"thread-1",turn:{id:"turn-1",status:"interrupted",items:[]}});expect(await turn.result()).toMatchObject({state:"cancelled"});
  });
  it("never retries an ambiguous turn/start or admits writes after a disconnect",async()=>{
    const {rpc,backend}=setup();rpc.handlers.set("turn/start",()=>{throw new Error("connection lost after write");});
    const turn=backend.start(input());await expect(turn.ready!()).rejects.toMatchObject({creationOutcome:"unknown"});
    await expect(backend.start({...input(),commandId:"command-2"}).ready!()).rejects.toBeInstanceOf(adapters.AdapterContractError);
    expect(rpc.calls.filter(c=>c.method==="turn/start")).toHaveLength(1);
  });
  it("interrupts the selected native turn without terminating the shared runtime",async()=>{
    const {rpc,backend}=setup();const turn=backend.start(input());await turn.ready!();const cancel=turn.cancel();
    await vi.waitFor(()=>expect(rpc.calls.find(c=>c.method==="turn/interrupt")?.params).toEqual({threadId:"thread-1",turnId:"turn-1"}));
    expect(turn.status()).toBe("running");rpc.emit("turn/completed",{threadId:"thread-1",turn:{id:"turn-1",status:"interrupted",items:[]}});await cancel;
    expect(await turn.result()).toMatchObject({state:"cancelled"});
  });
  it("uses the installed ThreadStartSource schema instead of SessionSource values",async()=>{
    const {rpc,backend}=setup();rpc.handlers.set("thread/start",params=>{
      if(params.sessionStartSource!==undefined&&!['startup','clear'].includes(String(params.sessionStartSource)))throw new adapters.AdapterContractError("CODEX_NATIVE_REQUEST_FAILED","invalid ThreadStartSource");
      return {thread:thread(),model:"test-model",modelProvider:"openai",cwd:root,approvalPolicy:"on-request",approvalsReviewer:"user",sandbox,reasoningEffort:"high"};
    });await expect(backend.start(input()).ready!()).resolves.toBeUndefined();
  });
  it("ignores an old completion while binding is awaiting durable storage",async()=>{
    const {rpc,backend}=setup();let release!:()=>void;const storage=new Promise<void>(resolve=>{release=resolve;});
    const turn=backend.start({...input(),onBinding:async()=>{rpc.emit("turn/completed",{threadId:"thread-1",turn:{id:"old-turn",status:"completed",items:[]}});await storage;}});
    await vi.waitFor(()=>expect(rpc.calls.some(c=>c.method==="thread/start")).toBe(true));expect(turn.status()).toBe("running");
    release();await turn.ready!();expect(turn.status()).toBe("running");
  });
  it("buffers a completion preceding its RPC receipt and applies only the admitted turn",async()=>{
    const {rpc,backend}=setup();rpc.handlers.set("turn/start",()=>{
      rpc.emit("turn/completed",{threadId:"thread-1",turn:{id:"old-turn",status:"completed",items:[]}});
      rpc.emit("turn/completed",{threadId:"thread-1",turn:{id:"turn-1",status:"completed",items:[{id:"a",type:"agentMessage",text:"correct"}]}});
      return {turn:{id:"turn-1",status:"inProgress",items:[]}};
    });const turn=backend.start(input());await turn.ready!();expect(await turn.result()).toMatchObject({state:"completed",summary:"correct"});
  });
  it("rejects delegated approvals before prompting",async()=>{
    const {rpc,backend}=setup();rpc.handlers.set("thread/start",()=>({thread:thread(),model:"test-model",modelProvider:"openai",cwd:root,approvalPolicy:"on-request",approvalsReviewer:"guardian_subagent",sandbox,reasoningEffort:"high"}));
    await expect(backend.start(input()).ready!()).rejects.toMatchObject({code:"CODEX_MODEL_PERMISSION_DRIFT"});expect(rpc.calls.some(c=>c.method==="turn/start")).toBe(false);
  });
  it("admits at most one concurrent resume for a native thread",async()=>{
    const {rpc,backend}=setup();backend.registerBinding(binding);
    const a=backend.start({...input(),providerSessionId:"thread-1"});const b=backend.start({...input(),providerSessionId:"thread-1",commandId:"command-2"});
    const receipts=await Promise.allSettled([a.ready!(),b.ready!()]);expect(receipts.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(rpc.calls.filter(c=>c.method==="turn/start")).toHaveLength(1);
  });
  it("rejects a changed frozen model before resume can mutate native configuration",async()=>{
    const {rpc,backend}=setup();const first=backend.start(input());await first.ready!();rpc.emit("turn/completed",{threadId:"thread-1",turn:{id:"turn-1",status:"completed",items:[]}});await first.result();
    await expect(backend.start({...input(),providerSessionId:"thread-1",model:"changed-model"}).ready!()).rejects.toMatchObject({code:"CODEX_MODEL_PERMISSION_DRIFT"});expect(rpc.calls.some(c=>c.method==="thread/resume")).toBe(false);
  });
  it("rechecks observer authority after the final asynchronous boundary before RPC write",async()=>{
    const {rpc,backend}=setup();let authority=true;
    const turn=backend.start({...input(),beforePrompt:()=>{
      if(!authority)throw new adapters.AdapterContractError("STALE_NATIVE_OBSERVER","revoked");
      if(rpc.calls.some(c=>c.method==="thread/start"))queueMicrotask(()=>{authority=false;});
    }});
    await expect(turn.ready!()).rejects.toMatchObject({code:"STALE_NATIVE_OBSERVER"});expect(rpc.calls.some(c=>c.method==="turn/start")).toBe(false);
  });
  it("records native source kind without inferring Desktop availability",async()=>{
    const {backend}=setup();const adapter=new adapters.CodexAdapter({id:"p",alias:"P",codexHome:root},backend);
    adapter.setNativeEventSink(()=>undefined,()=>()=>true);
    const session=await adapter.start(adapterInput());expect(await adapter.diagnostics(session.id)).toMatchObject({nativeSourceKind:"appServer",nativeThreadId:"thread-1"});expect(backend.capabilities().surfaces).toEqual({});
  });
  it("rejects external model-provider drift before a resume can overwrite it",async()=>{
    const {rpc,backend}=setup();const first=backend.start(input());await first.ready!();rpc.emit("turn/completed",{threadId:"thread-1",turn:{id:"turn-1",status:"completed",items:[]}});await first.result();
    rpc.handlers.set("thread/read",()=>({thread:{...thread(),modelProvider:"another-provider"}}));
    await expect(backend.start({...input(),providerSessionId:"thread-1"}).ready!()).rejects.toMatchObject({code:"CODEX_MODEL_PERMISSION_DRIFT"});expect(rpc.calls.some(c=>c.method==="thread/resume")).toBe(false);
  });
  it("continues an unchanged native-default null effort without hydrating all history",async()=>{
    const {rpc,backend}=setup();rpc.handlers.set("thread/start",()=>({thread:{...thread(),reasoningEffort:null},model:"test-model",modelProvider:"openai",cwd:root,approvalPolicy:"on-request",approvalsReviewer:"user",sandbox,reasoningEffort:null}));
    rpc.handlers.set("thread/read",()=>({thread:{...thread(),reasoningEffort:null}}));
    rpc.handlers.set("thread/resume",()=>({thread:{...thread(),reasoningEffort:null},model:"test-model",modelProvider:"openai",cwd:root,approvalPolicy:"on-request",approvalsReviewer:"user",sandbox,reasoningEffort:null}));
    const {reasoningEffort:ignored,...nativeDefault}=input();void ignored;nativeDefault.executionSelection.nativeParameters={};
    const first=backend.start(nativeDefault);await first.ready!();rpc.emit("turn/completed",{threadId:"thread-1",turn:{id:"turn-1",status:"completed",items:[]}});await first.result();
    await expect(backend.start({...nativeDefault,providerSessionId:"thread-1"}).ready!()).resolves.toBeUndefined();expect(rpc.calls.find(c=>c.method==="thread/resume")?.params).toMatchObject({excludeTurns:true});
  });
  it("settles a failed turn and blocks input when a terminal observation callback throws",async()=>{
    const {rpc,backend}=setup();const turn=backend.start({...input(),onNativeEvent:fact=>{if(fact.state==="completed")throw new Error("native sink unavailable");}});await turn.ready!();
    rpc.emit("turn/completed",{threadId:"thread-1",turn:{id:"turn-1",status:"completed",items:[]}});
    expect(await turn.result()).toMatchObject({state:"failed"});await expect(backend.start({...input(),providerSessionId:"thread-1"}).ready!()).rejects.toMatchObject({code:"CODEX_NATIVE_RECONCILIATION_REQUIRED"});
  });
  it("does not claim App Server token usage until its native token events are supported",async()=>{
    const {backend}=setup();const adapter=new adapters.CodexAdapter({id:"p",alias:"P",codexHome:root},backend);
    adapter.setNativeEventSink(()=>undefined,()=>()=>true);const session=await adapter.start(adapterInput());
    expect(await adapter.usage(session.id)).not.toHaveProperty("tokens");expect(await adapter.usageObservations(session.id)).toEqual([]);
  });
});

describe("Codex frozen physical directory identity",()=>{
  function isolated(){
    const parent=realpathSync(mkdtempSync(join(tmpdir(),"dispatcher-codex-directory-")));roots.push(parent);
    const home=join(parent,"home"),cwd=join(parent,"cwd");mkdirSync(home);mkdirSync(cwd);
    const selected={...scope,codexHome:home,workspacePath:cwd,evidence:{historyRead:{version:1 as const,support:"supported" as const,level:"runtime-verified" as const,scopeFingerprint:"tuple",verifiedAt:new Date().toISOString(),evidenceRef:"fixture:directory"}}};
    const rpc=new ProtocolFixture();
    rpc.handlers.set("initialize",()=>({codexHome:home}));
    rpc.handlers.set("thread/start",()=>({thread:{...thread(),cwd},model:"test-model",modelProvider:"openai",cwd,approvalPolicy:"on-request",approvalsReviewer:"user",sandbox,reasoningEffort:"high"}));
    rpc.handlers.set("thread/read",()=>({thread:{...thread(),cwd}}));
    const backend=new adapters.CodexAppServerBackend(selected,async()=>rpc);
    const replace=(kind:"home"|"cwd")=>{const path=kind==="home"?home:cwd;renameSync(path,`${path}-retained`);mkdirSync(path);};
    return {parent,home,cwd,selected,rpc,backend,replace,start:()=>backend.start({...input(),codexHome:home,workspacePath:cwd})};
  }
  it.each(["home","cwd"] as const)("rejects a same-path %s replacement before opening a connection",async kind=>{
    const f=isolated();try{
      f.replace(kind);await expect(f.start().ready!()).rejects.toMatchObject({creationOutcome:"not-created",code:"CODEX_SCOPE_CHANGED"});expect(f.rpc.calls).toEqual([]);
    }finally{rmSync(f.parent,{recursive:true,force:true});}
  });
  it.each(["home","cwd"] as const)("rejects %s replacement while initialization is awaited",async kind=>{
    const f=isolated();try{
      f.rpc.handlers.set("initialize",()=>{f.replace(kind);return {codexHome:f.home};});
      await expect(f.start().ready!()).rejects.toMatchObject({creationOutcome:"not-created",code:"CODEX_SCOPE_CHANGED"});expect(f.rpc.calls.map(call=>call.method)).toEqual(["initialize"]);
    }finally{rmSync(f.parent,{recursive:true,force:true});}
  });
  it.each(["home","cwd"] as const)("rejects %s replacement after thread/start before persisting a binding or prompting",async kind=>{
    const f=isolated();try{
      const original=f.rpc.handlers.get("thread/start")!;
      f.rpc.handlers.set("thread/start",params=>{f.replace(kind);return original(params);});const persist=vi.fn();
      const turn=f.backend.start({...input(),codexHome:f.home,workspacePath:f.cwd,onBinding:persist});
      await expect(turn.ready!()).rejects.toMatchObject({creationOutcome:"unknown",code:"CODEX_SCOPE_CHANGED"});expect(persist).not.toHaveBeenCalled();expect(f.rpc.calls.some(call=>call.method==="turn/start")).toBe(false);
    }finally{rmSync(f.parent,{recursive:true,force:true});}
  });
  it.each(["home","cwd"] as const)("rejects %s replacement while a metadata read is awaited",async kind=>{
    const f=isolated();try{
      f.backend.registerBinding(binding);f.rpc.handlers.set("thread/read",()=>{f.replace(kind);return {thread:{...thread(),cwd:f.cwd}};});
      await expect(f.backend.inspect(binding)).rejects.toMatchObject({code:"CODEX_SCOPE_CHANGED"});expect(f.rpc.calls.some(call=>["thread/resume","turn/start"].includes(call.method))).toBe(false);
    }finally{rmSync(f.parent,{recursive:true,force:true});}
  });
  it("withdraws scoped capability qualification after directory replacement without native I/O",()=>{
    const f=isolated();try{
      expect(f.backend.capabilities().historyRead.support).toBe("supported");f.replace("home");
      expect(f.backend.capabilities().historyRead).toMatchObject({support:"unknown",reasonCode:"CODEX_SCOPE_CHANGED"});expect(f.rpc.calls).toEqual([]);
    }finally{rmSync(f.parent,{recursive:true,force:true});}
  });
  it.each(["home","cwd"] as const)("does not project a successful completion from replaced %s",async kind=>{
    const f=isolated();try{
      const facts:unknown[]=[];const turn=f.backend.start({...input(),codexHome:f.home,workspacePath:f.cwd,onNativeEvent:fact=>facts.push(fact)});await turn.ready!();f.replace(kind);
      f.rpc.emit("turn/completed",{threadId:"thread-1",turn:{id:"turn-1",status:"completed",items:[]}});
      expect(await turn.result()).toMatchObject({state:"failed"});expect(facts).not.toContainEqual(expect.objectContaining({state:"completed"}));
      expect(f.backend.capabilities().historyRead.support).toBe("unknown");
    }finally{rmSync(f.parent,{recursive:true,force:true});}
  });
  it.each(["home","cwd"] as const)("rechecks %s after the admission callback before thread/start",async kind=>{
    const f=isolated();try{
      let calls=0;const turn=f.backend.start({...input(),codexHome:f.home,workspacePath:f.cwd,beforePrompt:()=>{if(++calls===2)f.replace(kind);}});
      await expect(turn.ready!()).rejects.toMatchObject({creationOutcome:"not-created",code:"CODEX_SCOPE_CHANGED"});expect(f.rpc.calls.some(call=>call.method==="thread/start")).toBe(false);
    }finally{rmSync(f.parent,{recursive:true,force:true});}
  });
  it("accepts aliases of the same directory and ordinary file updates",async()=>{
    const f=isolated();try{
      const alias=join(f.parent,"home-alias");symlinkSync(f.home,alias);writeFileSync(join(f.home,"new-native-state"),"state");writeFileSync(join(f.cwd,"new-file"),"work");
      const turn=f.backend.start({...input(),codexHome:alias,workspacePath:f.cwd});await expect(turn.ready!()).resolves.toBeUndefined();
      f.rpc.emit("turn/completed",{threadId:"thread-1",turn:{id:"turn-1",status:"completed",items:[]}});await turn.result();
    }finally{rmSync(f.parent,{recursive:true,force:true});}
  });
});
