import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { NativeBinding } from "@dispatcher/domain";
import { NativeRuntimeHosts } from "../src/native-observation.js";
import { reconcileNativeRuntime } from "../src/reconcile.js";
import { ProcessManager, type ManagedProcessHandle } from "../src/process.js";
const directories:string[]=[];afterEach(()=>{for(const path of directories.splice(0))rmSync(path,{recursive:true,force:true});});
const binding:NativeBinding={version:1,product:"opencode",region:"global",profileId:"p",backendId:"serve",runnerId:"local",nativeStoreRef:"store",nativeSessionId:"session-a",executionRefId:"execution",identityState:"bound"};
const fence={runId:"run-a",sessionId:"dispatcher-a",expectedTaskRevision:1,expectedCurrentRunId:"run-a",expectedControlRevision:1,expectedControlEpoch:1,generation:1,leaseId:"lease-a",commandId:"interrupt-a"};
function fixture(ownership:"owned"|"external"="owned"){
 const stop=vi.fn(async()=>{});const detach=vi.fn(async()=>{});const interrupt=vi.fn(async(ref:NativeBinding,request:{commandId:string})=>({version:1 as const,commandId:request.commandId,state:"accepted" as const,nativeRequestId:`interrupt:${ref.nativeSessionId}`}));
 const processHandle:ManagedProcessHandle={id:"managed",pid:1,send:async()=>{},cancel:async()=>{},status:()=>({state:"completed",pid:1}),result:async()=>({sessionId:"managed",exitCode:0,signal:null,classification:"success",stdoutTail:"",stderrTail:"",durationMs:0}),treeStatus:()=>({state:stop.mock.calls.length?"empty":"present",scope:"owned-process-group"}),subscribe:()=>()=>{}};
 const endpoint={processGroupContainment:{handleId:processHandle.id,evidenceRef:"fixture-confined-group"},process:processHandle,id:"host",profileId:"p",backendId:"serve",runnerId:"local",nativeStoreRef:"store",product:"opencode",region:"global",ownership,stop,detach,interrupt,quiescent:async()=>true};
 const acquire=vi.fn(async()=>endpoint);const backend={id:"serve",runnerId:"local",nativeStoreRef:"store",product:"opencode",region:"global",ownership,acquire};return {backend,endpoint,acquire,stop,detach,interrupt};
}
const localReceipt=()=>({version:1 as const,connection:"closed" as const,ownedRoot:"exited" as const,callbacks:"drained" as const,backgroundTools:"unknown" as const,nativeSessionDeleted:false as const});
it("locally disconnects an uncertain command host without native stop or retry",async()=>{
 const hosts=new NativeRuntimeHosts(),f=fixture(),disconnectLocal=vi.fn(async()=>localReceipt());
 const endpoint={...f.endpoint,interrupt:vi.fn(async()=>{throw new Error("lost receipt");}),disconnectLocal};
 const h=await hosts.acquireRuntime({id:"p"},{...f.backend,acquire:async()=>endpoint});await expect(hosts.cancelSession(h,binding,{commandId:"interrupt-a",fence})).rejects.toThrow();
 expect(await hosts.shutdownLocal()).toEqual([expect.objectContaining({profileId:"p",backendId:"serve",hostId:"host",connection:"closed",ownedRoot:"exited",callbacks:"drained",backgroundTools:"unknown",nativeSessionDeleted:false})]);
 expect(disconnectLocal).toHaveBeenCalledTimes(1);expect(f.stop).not.toHaveBeenCalled();expect(f.detach).not.toHaveBeenCalled();await hosts.shutdownLocal();expect(disconnectLocal).toHaveBeenCalledTimes(1);
 await expect(hosts.acquireRuntime({id:"p"},f.backend)).rejects.toMatchObject({code:"NATIVE_RUNTIME_MANAGER_CLOSED"});await expect(hosts.cancelSession(h,binding,{commandId:"interrupt-a",fence})).rejects.toThrow();
});
it("does not borrow legacy detach as proof of local callback or root cleanup",async()=>{
 const hosts=new NativeRuntimeHosts(),f=fixture();await hosts.acquireRuntime({id:"p"},f.backend);
 expect(await hosts.shutdownLocal()).toEqual([expect.objectContaining({connection:"unknown",ownedRoot:"unknown",callbacks:"unknown"})]);expect(f.stop).not.toHaveBeenCalled();expect(f.detach).not.toHaveBeenCalled();
});
it("keeps callback uncertainty separate from root cleanup and freezes cached receipts",async()=>{
 const hosts=new NativeRuntimeHosts(),f=fixture(),receipt={...localReceipt(),callbacks:"unknown" as const},disconnectLocal=vi.fn(async()=>receipt);
 await hosts.acquireRuntime({id:"p"},{...f.backend,acquire:async()=>({...f.endpoint,disconnectLocal})});const results=await hosts.shutdownLocal();
 expect(results[0]).toMatchObject({connection:"closed",ownedRoot:"exited",callbacks:"unknown"});results[0]!.connection="unknown";receipt.connection="closed";
 expect((await hosts.shutdownLocal())[0]?.connection).toBe("closed");expect(disconnectLocal).toHaveBeenCalledTimes(1);
});
it("captures local cleanup methods before endpoint mutation and removes arbitrary diagnostics",async()=>{
 const hosts=new NativeRuntimeHosts(),f=fixture(),disconnectLocal=vi.fn(async()=>({...localReceipt(),debug:"private-diagnostic"})),endpoint={...f.endpoint,disconnectLocal};
 await hosts.acquireRuntime({id:"p"},{...f.backend,acquire:async()=>endpoint});endpoint.disconnectLocal=vi.fn(async()=>{throw new Error("mutated");});
 const [result]=await hosts.shutdownLocal();expect(result).not.toHaveProperty("debug");expect(result).toMatchObject({callbacks:"drained"});expect(disconnectLocal).toHaveBeenCalledTimes(1);
});
it("never locally stops a root claimed as an external daemon",async()=>{
 const hosts=new NativeRuntimeHosts(),f=fixture("external"),disconnectLocal=vi.fn(async()=>localReceipt());await hosts.acquireRuntime({id:"p"},{...f.backend,acquire:async()=>({...f.endpoint,disconnectLocal})});
 expect(await hosts.shutdownLocal()).toEqual([expect.objectContaining({ownedRoot:"unknown",callbacks:"unknown"})]);expect(disconnectLocal).not.toHaveBeenCalled();expect(f.stop).not.toHaveBeenCalled();
});
it("does not authorize local cleanup through conflicting owned host identities",async()=>{
 const hosts=new NativeRuntimeHosts(),a=fixture(),b=fixture(),first=vi.fn(async()=>localReceipt()),second=vi.fn(async()=>localReceipt());
 await hosts.acquireRuntime({id:"p"},{...a.backend,executionRefId:"a",acquire:async()=>({...a.endpoint,executionRefId:"a",disconnectLocal:first})});
 await expect(hosts.acquireRuntime({id:"p"},{...b.backend,executionRefId:"b",acquire:async()=>({...b.endpoint,executionRefId:"b",disconnectLocal:second})})).rejects.toThrow();
 expect((await hosts.shutdownLocal()).every(result=>result.connection==="unknown")).toBe(true);expect(first).not.toHaveBeenCalled();expect(second).not.toHaveBeenCalled();
});
it("cleans a valid late acquisition after bounded local shutdown retains unknown",async()=>{
 const hosts=new NativeRuntimeHosts(),f=fixture(),disconnectLocal=vi.fn(async()=>localReceipt());let arrive!:(endpoint:typeof f.endpoint&{disconnectLocal:typeof disconnectLocal})=>void;
 const acquired=hosts.acquireRuntime({id:"p"},{...f.backend,acquire:()=>new Promise(done=>{arrive=done;})});const rejected=expect(acquired).rejects.toMatchObject({code:"NATIVE_RUNTIME_ACQUIRE_UNKNOWN"});await Promise.resolve();vi.useFakeTimers();
 try{const closing=hosts.shutdownLocal();await vi.advanceTimersByTimeAsync(5_001);await rejected;expect(await closing).toEqual([expect.objectContaining({ownedRoot:"unknown",callbacks:"unknown"})]);
  arrive({...f.endpoint,disconnectLocal});await vi.advanceTimersByTimeAsync(1);expect(disconnectLocal).toHaveBeenCalledTimes(1);expect((await hosts.shutdownLocal())[0]?.ownedRoot).toBe("unknown");expect(f.stop).not.toHaveBeenCalled();
 }finally{vi.useRealTimers();}
});
it("bounds a hung local disconnect without retrying or promoting eventual success",async()=>{
 const hosts=new NativeRuntimeHosts(),f=fixture(),disconnectLocal=vi.fn(()=>new Promise<ReturnType<typeof localReceipt>>(()=>{}));await hosts.acquireRuntime({id:"p"},{...f.backend,acquire:async()=>({...f.endpoint,disconnectLocal})});vi.useFakeTimers();
 try{const closing=hosts.shutdownLocal();await vi.advanceTimersByTimeAsync(5_001);expect(await closing).toEqual([expect.objectContaining({connection:"unknown",callbacks:"unknown"})]);await hosts.shutdownLocal();expect(disconnectLocal).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);}finally{vi.useRealTimers();}
});
it("does not invoke a pending session interrupt after local shutdown closes admission",async()=>{
 const hosts=new NativeRuntimeHosts(),f=fixture(),disconnectLocal=vi.fn(async()=>localReceipt());const h=await hosts.acquireRuntime({id:"p"},{...f.backend,acquire:async()=>({...f.endpoint,disconnectLocal})});
 const interrupt=hosts.cancelSession(h,binding,{commandId:"interrupt-a",fence}),closing=hosts.shutdownLocal();await expect(interrupt).rejects.toThrow();expect(await closing).toEqual([expect.objectContaining({callbacks:"drained"})]);expect(f.interrupt).not.toHaveBeenCalled();
});
it("retains malformed local cleanup receipts and never uses stop as fallback",async()=>{
 const hosts=new NativeRuntimeHosts(),f=fixture(),disconnectLocal=vi.fn(async()=>({...localReceipt(),ownedRootPid:-1}));await hosts.acquireRuntime({id:"p"},{...f.backend,acquire:async()=>({...f.endpoint,disconnectLocal})});
 expect(await hosts.shutdownLocal()).toEqual([expect.objectContaining({connection:"unknown",callbacks:"unknown"})]);await hosts.shutdown("stop-owned");expect(f.stop).not.toHaveBeenCalled();
});
it("keeps distinct execution workspaces on independent native hosts",async()=>{
 const hosts=new NativeRuntimeHosts(),a=fixture(),b=fixture();
 const backendA={...a.backend,executionRefId:"execution-a",acquire:vi.fn(async()=>({...a.endpoint,id:"host-a",executionRefId:"execution-a"}))};
 const backendB={...b.backend,executionRefId:"execution-b",acquire:vi.fn(async()=>({...b.endpoint,id:"host-b",executionRefId:"execution-b"}))};
 const [first,second]=await Promise.all([hosts.acquireRuntime({id:"p"},backendA),hosts.acquireRuntime({id:"p"},backendB)]);
 expect(backendA.acquire).toHaveBeenCalledTimes(1);expect(backendB.acquire).toHaveBeenCalledTimes(1);
 expect(first).toMatchObject({hostId:"host-a",executionRefId:"execution-a",backendId:"serve",nativeStoreRef:"store"});
 expect(second).toMatchObject({hostId:"host-b",executionRefId:"execution-b",backendId:"serve",nativeStoreRef:"store"});
 expect((await hosts.releaseRuntime(first,"stop-owned")).state).toBe("stopped");expect(a.stop).toHaveBeenCalledTimes(1);expect(b.stop).not.toHaveBeenCalled();
 await hosts.cancelSession(second,{...binding,executionRefId:"execution-b"},{commandId:"interrupt-a",fence});expect(b.interrupt).toHaveBeenCalledTimes(1);
 await hosts.shutdown("stop-owned");
});
it("coalesces repeated acquisitions inside one explicit execution scope",async()=>{
 const hosts=new NativeRuntimeHosts(),f=fixture(),acquire=vi.fn(async()=>({...f.endpoint,executionRefId:"execution-a"}));
 const backend={...f.backend,executionRefId:"execution-a",acquire};
 const [a,b]=await Promise.all([hosts.acquireRuntime({id:"p"},backend),hosts.acquireRuntime({id:"p"},backend)]);
 expect(acquire).toHaveBeenCalledTimes(1);expect(a.executionRefId).toBe("execution-a");expect(a.id).not.toBe(b.id);
 await hosts.shutdown("stop-owned");
});
it("preserves captured profile and scope while waiting for an earlier host close",async()=>{
 const hosts=new NativeRuntimeHosts(),f=fixture();let stopped!:()=>void;
 f.stop.mockImplementationOnce(()=>new Promise<void>(done=>{stopped=done;}));
 const profile={id:"p"},backend={...f.backend,executionRefId:"execution-a",acquire:async()=>({...f.endpoint,executionRefId:"execution-a"})};
 const original=await hosts.acquireRuntime(profile,backend),closing=hosts.releaseRuntime(original,"stop-owned");
 await vi.waitFor(()=>expect(stopped).toBeTypeOf("function"));
 const replacement=hosts.acquireRuntime(profile,backend);profile.id="foreign";backend.executionRefId="execution-b";stopped();await closing;
 expect(await replacement).toMatchObject({profileId:"p",executionRefId:"execution-a"});await hosts.shutdown("stop-owned");
});
it("retains uncertainty when two owned execution scopes resolve to the same host",async()=>{
 const hosts=new NativeRuntimeHosts(),a=fixture(),b=fixture();
 const first=await hosts.acquireRuntime({id:"p"},{...a.backend,executionRefId:"execution-a",acquire:async()=>({...a.endpoint,executionRefId:"execution-a"})});
 await expect(hosts.acquireRuntime({id:"p"},{...b.backend,executionRefId:"execution-b",acquire:async()=>({...b.endpoint,executionRefId:"execution-b"})})).rejects.toMatchObject({code:"NATIVE_RUNTIME_ACQUIRE_UNKNOWN"});
 await expect(hosts.cancelSession(first,{...binding,executionRefId:"execution-a"},{commandId:"interrupt-a",fence})).rejects.toMatchObject({code:"RUNTIME_OWNER_MISMATCH"});
 expect((await hosts.releaseRuntime(first,"stop-owned")).state).toBe("unknown");await hosts.shutdown("stop-owned");expect(a.stop).not.toHaveBeenCalled();expect(b.stop).not.toHaveBeenCalled();
});
it.each(["quiescence","stop"])("does not promote stopped after an alias arrives during awaited %s",async phase=>{
 const hosts=new NativeRuntimeHosts(),a=fixture(),b=fixture();let resume!:()=>void;
 if(phase==="quiescence")a.endpoint.quiescent=()=>new Promise<boolean>(done=>{resume=()=>done(true);});
 else a.stop.mockImplementationOnce(()=>new Promise<void>(done=>{resume=done;}));
 const first=await hosts.acquireRuntime({id:"p"},{...a.backend,executionRefId:"execution-a",acquire:async()=>({...a.endpoint,executionRefId:"execution-a"})});
 const closing=hosts.releaseRuntime(first,"stop-owned");await vi.waitFor(()=>expect(resume).toBeTypeOf("function"));
 await expect(hosts.acquireRuntime({id:"p"},{...b.backend,executionRefId:"execution-b",acquire:async()=>({...b.endpoint,executionRefId:"execution-b"})})).rejects.toMatchObject({code:"NATIVE_RUNTIME_ACQUIRE_UNKNOWN"});resume();
 expect(await closing).toMatchObject({state:"unknown",nativeSessionDeleted:false});expect(a.stop).toHaveBeenCalledTimes(phase==="stop"?1:0);expect(b.stop).not.toHaveBeenCalled();
 await expect(hosts.acquireRuntime({id:"p"},{...a.backend,executionRefId:"execution-a"})).rejects.toMatchObject({code:"NATIVE_RUNTIME_OUTCOME_UNKNOWN"});
});
it.each([undefined,"execution-b"])("rejects endpoint execution scope %s instead of borrowing its native host",async executionRefId=>{
 const hosts=new NativeRuntimeHosts(),f=fixture();
 const backend={...f.backend,executionRefId:"execution-a",acquire:async()=>({...f.endpoint,...(executionRefId?{executionRefId}:{})})};
 await expect(hosts.acquireRuntime({id:"p"},backend)).rejects.toMatchObject({code:"NATIVE_RUNTIME_ACQUIRE_UNKNOWN"});expect(f.stop).not.toHaveBeenCalled();
});
it.each(["","invalid\nref","x".repeat(513)])("rejects invalid execution scope before acquisition",async executionRefId=>{
 const hosts=new NativeRuntimeHosts(),f=fixture();
 await expect(hosts.acquireRuntime({id:"p"},{...f.backend,executionRefId})).rejects.toMatchObject({code:"INVALID_NATIVE_RUNTIME_BACKEND"});expect(f.acquire).not.toHaveBeenCalled();
});
it("captures execution scope before awaited acquisition and guards session interrupts",async()=>{
 const hosts=new NativeRuntimeHosts(),f=fixture();let resolve!:(value:typeof f.endpoint&{executionRefId:string})=>void;
 const backend={...f.backend,executionRefId:"execution-a",acquire:()=>new Promise<typeof f.endpoint&{executionRefId:string}>(done=>{resolve=done;})};
 const pending=hosts.acquireRuntime({id:"p"},backend);backend.executionRefId="execution-b";await Promise.resolve();resolve({...f.endpoint,executionRefId:"execution-a"});
 const handle=await pending;expect(handle.executionRefId).toBe("execution-a");
 await expect(hosts.cancelSession(handle,{...binding,executionRefId:"execution-b"},{commandId:"interrupt-a",fence})).rejects.toMatchObject({code:"RUNTIME_OWNER_MISMATCH"});expect(f.interrupt).not.toHaveBeenCalled();
 await hosts.cancelSession(handle,{...binding,executionRefId:"execution-a"},{commandId:"interrupt-a",fence});expect(f.interrupt).toHaveBeenCalledTimes(1);await hosts.shutdown("stop-owned");
});
it("acquires native hosts lazily and coalesces concurrent requests without losing independent claims",async()=>{
 const hosts=new NativeRuntimeHosts();const f=fixture();expect(f.acquire).not.toHaveBeenCalled();const [a,b]=await Promise.all([hosts.acquireRuntime({id:"p"},f.backend),hosts.acquireRuntime({id:"p"},f.backend)]);expect(f.acquire).toHaveBeenCalledTimes(1);expect(a.hostId).toBe(b.hostId);expect(a.id).not.toBe(b.id);expect((await hosts.releaseRuntime(a,"stop-owned")).state).toBe("retained");expect(f.stop).not.toHaveBeenCalled();expect((await hosts.releaseRuntime(b,"stop-owned")).state).toBe("stopped");expect(f.stop).toHaveBeenCalledTimes(1);
});
it("interrupts only the chosen native session and never stops the host or another session",async()=>{
 const hosts=new NativeRuntimeHosts();const f=fixture();const h=await hosts.acquireRuntime({id:"p"},f.backend);expect(await hosts.cancelSession(h,binding,{commandId:"interrupt-a",fence})).toMatchObject({state:"accepted"});expect(f.interrupt).toHaveBeenCalledWith(binding,{commandId:"interrupt-a",fence});expect(f.stop).not.toHaveBeenCalled();await expect(hosts.cancelSession(h,{...binding,profileId:"foreign"},{commandId:"interrupt-a",fence})).rejects.toMatchObject({code:"RUNTIME_OWNER_MISMATCH"});expect(f.interrupt).toHaveBeenCalledTimes(1);
});
it("never stops an external daemon, including during shutdown",async()=>{
 const hosts=new NativeRuntimeHosts();const f=fixture("external");const h=await hosts.acquireRuntime({id:"p"},f.backend);expect(await hosts.releaseRuntime(h,"stop-owned")).toMatchObject({state:"detached",nativeSessionDeleted:false});await hosts.shutdown("stop-owned");expect(f.stop).not.toHaveBeenCalled();expect(f.detach).toHaveBeenCalledTimes(1);
});
it("retains an owned host when native sessions have not proved quiescence",async()=>{
 const hosts=new NativeRuntimeHosts();const f=fixture();f.endpoint.quiescent=async()=>false;const h=await hosts.acquireRuntime({id:"p"},f.backend);expect(await hosts.releaseRuntime(h,"stop-owned")).toMatchObject({state:"retained",reasonCode:"NATIVE_RUNTIME_BUSY",nativeSessionDeleted:false});expect(f.stop).not.toHaveBeenCalled();
});
it("serializes acquisition behind a pending host release and cannot stop a newly acquired host",async()=>{
 let finish!:(value:boolean)=>void;const quiescence=new Promise<boolean>(r=>{finish=r;});const hosts=new NativeRuntimeHosts();const f=fixture();f.endpoint.quiescent=()=>quiescence;const h=await hosts.acquireRuntime({id:"p"},f.backend);const release=hosts.releaseRuntime(h,"stop-owned");const acquire=hosts.acquireRuntime({id:"p"},f.backend);await Promise.resolve();expect(f.acquire).toHaveBeenCalledTimes(1);finish(true);expect((await release).state).toBe("stopped");const next=await acquire;expect(f.acquire).toHaveBeenCalledTimes(2);expect(next.id).not.toBe(h.id);
});
it("reconciles a stored running Session without a process handle as attention or read-only reobservation",()=>{
 expect(reconcileNativeRuntime({binding,persistedState:"running"})).toMatchObject({action:"ATTENTION",reasonCode:"NATIVE_RUNTIME_HANDLE_MISSING"});expect(reconcileNativeRuntime({binding,persistedState:"running",canObserve:true})).toMatchObject({action:"REOBSERVE",startsExecution:false});expect(reconcileNativeRuntime({binding,persistedState:"idle",canContinueHistory:true})).toMatchObject({action:"CONTINUE_HISTORY",requiresExplicitCommand:true,startsExecution:false});
});
it("retains v3 owned descendant drain and treats any surviving-tree observation as attention",async()=>{
 const directory=mkdtempSync(join(tmpdir(),"dispatcher-native-tree-"));directories.push(directory);const manager=new ProcessManager(directory);let pid:number|undefined;
 const handle=await manager.start({runId:"tree",file:process.execPath,args:["-e",`const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});require('node:fs').writeFileSync('child.pid',String(child.pid));child.unref();`],cwd:directory});
 try{await handle.result();await vi.waitFor(()=>expect(existsSync(join(directory,"child.pid"))).toBe(true),{timeout:5_000});pid=Number(readFileSync(join(directory,"child.pid"),"utf8"));expect(handle.treeStatus?.()).toMatchObject({state:platform()==="win32"?"unknown":"empty"});expect(()=>process.kill(pid!,0)).toThrow(expect.objectContaining({code:"ESRCH"}));expect(reconcileNativeRuntime({binding,persistedState:"idle",processState:"completed",processTree:{state:"present",scope:"owned-process-group"},canObserve:true})).toMatchObject({action:"ATTENTION",startsExecution:false,reasonCode:"NATIVE_BACKGROUND_PROCESS_SURVIVES"});expect(reconcileNativeRuntime({binding,persistedState:"idle",processState:"completed",processTree:handle.treeStatus?.(),canObserve:true})).toMatchObject({action:platform()==="win32"?"ATTENTION":"REOBSERVE",startsExecution:false});}finally{if(pid){try{process.kill(pid,"SIGKILL");}catch{/* The fixture child may already have exited. */}}await manager.shutdown();}
});

it("cannot stop a host while a session interruption is awaiting its receipt",async()=>{
 let finish!:(receipt:{version:1;commandId:string;state:"accepted"})=>void;const pending=new Promise<{version:1;commandId:string;state:"accepted"}>(r=>{finish=r;});const hosts=new NativeRuntimeHosts();const f=fixture();f.endpoint.interrupt=async()=>pending;const h=await hosts.acquireRuntime({id:"p"},f.backend);const cancel=hosts.cancelSession(h,binding,{commandId:"interrupt-a",fence});await Promise.resolve();const released=await hosts.releaseRuntime(h,"stop-owned");expect(released.state).toBe("retained");expect(f.stop).not.toHaveBeenCalled();finish({version:1,commandId:"interrupt-a",state:"accepted"});await cancel;
});
it("does not retry an acquisition whose reply failed and never returns provider diagnostics",async()=>{
 const hosts=new NativeRuntimeHosts();const f=fixture();f.backend.acquire=vi.fn(async()=>{throw new Error("private-native-diagnostic");});for(let n=0;n<2;n++)await expect(hosts.acquireRuntime({id:"p"},f.backend)).rejects.toMatchObject({code:"NATIVE_RUNTIME_ACQUIRE_UNKNOWN",message:"NATIVE_RUNTIME_ACQUIRE_UNKNOWN"});expect(f.backend.acquire).toHaveBeenCalledTimes(1);
});

it("isolates two native sessions sharing a host when only session A is interrupted",async()=>{
 const hosts=new NativeRuntimeHosts();const f=fixture();const active=new Set(["session-a","session-b"]);f.endpoint.interrupt=vi.fn(async(ref,request)=>{active.delete(ref.nativeSessionId);return {version:1,commandId:request.commandId,state:"accepted",nativeRequestId:"receipt"};});const a=await hosts.acquireRuntime({id:"p"},f.backend);const b=await hosts.acquireRuntime({id:"p"},f.backend);await hosts.cancelSession(a,binding,{commandId:"interrupt-a",fence});expect([...active]).toEqual(["session-b"]);expect((await hosts.releaseRuntime(a,"stop-owned")).state).toBe("retained");expect(f.stop).not.toHaveBeenCalled();await hosts.releaseRuntime(b);
});
it("freezes a host after an unknown interrupt instead of stopping it or resending",async()=>{
 const hosts=new NativeRuntimeHosts();const f=fixture();f.endpoint.interrupt=vi.fn(async()=>{throw new Error("private-receipt");});const h=await hosts.acquireRuntime({id:"p"},f.backend);await expect(hosts.cancelSession(h,binding,{commandId:"interrupt-a",fence})).rejects.toMatchObject({code:"NATIVE_RUNTIME_INTERRUPT_UNKNOWN",message:"NATIVE_RUNTIME_INTERRUPT_UNKNOWN"});await expect(hosts.cancelSession(h,binding,{commandId:"interrupt-a",fence})).rejects.toThrow();expect(f.endpoint.interrupt).toHaveBeenCalledTimes(1);expect(await hosts.releaseRuntime(h,"stop-owned")).toMatchObject({state:"unknown",nativeSessionDeleted:false});expect(f.stop).not.toHaveBeenCalled();await expect(hosts.acquireRuntime({id:"p"},f.backend)).rejects.toMatchObject({code:"NATIVE_RUNTIME_OUTCOME_UNKNOWN"});
});
it("rejects malformed command identity before invoking a native interruption",async()=>{
 const hosts=new NativeRuntimeHosts();const f=fixture();const h=await hosts.acquireRuntime({id:"p"},f.backend);await expect(hosts.cancelSession(h,binding,{commandId:"different",fence})).rejects.toMatchObject({code:"INVALID_NATIVE_INTERRUPT_REQUEST"});await expect(hosts.cancelSession(h,{...binding,identityState:"deleted"},{commandId:"interrupt-a",fence})).rejects.toThrow();expect(f.interrupt).not.toHaveBeenCalled();await hosts.releaseRuntime(h);
});
it("captures external ownership so later metadata mutation cannot authorize stopping a daemon",async()=>{
 const hosts=new NativeRuntimeHosts();const f=fixture("external");const h=await hosts.acquireRuntime({id:"p"},f.backend);f.endpoint.ownership="owned";await expect(hosts.acquireRuntime({id:"p"},{...f.backend,ownership:"owned"})).rejects.toMatchObject({code:"RUNTIME_OWNER_MISMATCH"});expect((await hosts.releaseRuntime(h,"stop-owned")).state).toBe("detached");expect(f.stop).not.toHaveBeenCalled();
});
it("shuts down each host once and does not turn local detachment into session deletion",async()=>{
 const hosts=new NativeRuntimeHosts();const f=fixture();await hosts.acquireRuntime({id:"p"},f.backend);const first=await hosts.shutdown();expect(await hosts.shutdown("stop-owned")).toEqual(first);expect(first).toEqual([{state:"detached",nativeSessionDeleted:false}]);expect(f.detach).toHaveBeenCalledTimes(1);expect(f.stop).not.toHaveBeenCalled();await expect(hosts.acquireRuntime({id:"p"},f.backend)).rejects.toMatchObject({code:"NATIVE_RUNTIME_MANAGER_CLOSED"});
});
it("does not report host cleanup as proved when its process tree is unavailable",async()=>{
 const hosts=new NativeRuntimeHosts();const f=fixture();f.endpoint.process.treeStatus=()=>({state:"unknown",scope:"unverified"});const h=await hosts.acquireRuntime({id:"p"},f.backend);expect(await hosts.releaseRuntime(h,"stop-owned")).toMatchObject({state:"unknown",reasonCode:"NATIVE_PROCESS_TREE_UNKNOWN"});expect(f.stop).toHaveBeenCalledTimes(1);await hosts.shutdown("stop-owned");expect(f.stop).toHaveBeenCalledTimes(1);
});
it("does not treat deleted or ambiguous bindings as runnable history",()=>{
 expect(reconcileNativeRuntime({binding:{...binding,identityState:"deleted"},persistedState:"idle",processState:"running",canContinueHistory:true})).toMatchObject({action:"ATTENTION"});expect(reconcileNativeRuntime({binding,persistedState:"deleted",canObserve:true,canContinueHistory:true})).toMatchObject({action:"ATTENTION",reasonCode:"NATIVE_SESSION_DELETED"});
});
it("verifies cleanup through a real owned process handle",async()=>{
 const directory=mkdtempSync(join(tmpdir(),"dispatcher-native-host-"));directories.push(directory);const manager=new ProcessManager(directory);const child=await manager.start({runId:"host",file:process.execPath,args:["-e","setInterval(()=>{},1000)"],cwd:directory});const f=fixture();f.endpoint.process=child;f.endpoint.processGroupContainment={handleId:child.id,evidenceRef:"fixture-no-descendant-script"};f.endpoint.stop=async()=>child.cancel();const hosts=new NativeRuntimeHosts();
 try{const h=await hosts.acquireRuntime({id:"p"},f.backend);expect(await hosts.releaseRuntime(h,"stop-owned")).toMatchObject({state:platform()==="win32"?"unknown":"stopped",nativeSessionDeleted:false});expect((await child.result()).classification).toBe("cancelled");}finally{await manager.shutdown();}
});
it("cannot reuse an owned endpoint after its local client has been detached",async()=>{
 const hosts=new NativeRuntimeHosts();const f=fixture();const h=await hosts.acquireRuntime({id:"p"},f.backend);await hosts.releaseRuntime(h);await expect(hosts.acquireRuntime({id:"p"},f.backend)).rejects.toMatchObject({code:"NATIVE_RUNTIME_DETACHED"});await hosts.shutdown();expect(f.detach).toHaveBeenCalledTimes(1);expect(f.acquire).toHaveBeenCalledTimes(1);expect(f.stop).not.toHaveBeenCalled();
});
it("returns only normalized receipt fields instead of arbitrary endpoint diagnostics",async()=>{
 const hosts=new NativeRuntimeHosts();const f=fixture();f.endpoint.interrupt=vi.fn(async(_ref,request)=>({version:1,commandId:request.commandId,state:"accepted",nativeRequestId:"receipt",debug:"private-native-diagnostic"}));const h=await hosts.acquireRuntime({id:"p"},f.backend);expect(await hosts.cancelSession(h,binding,{commandId:"interrupt-a",fence})).not.toHaveProperty("debug");await hosts.releaseRuntime(h);
});
it("bounds a lost interrupt receipt and pins the unknown native outcome",async()=>{
 vi.useFakeTimers();const hosts=new NativeRuntimeHosts();const f=fixture();f.endpoint.interrupt=async()=>await new Promise(()=>{});
 try{const h=await hosts.acquireRuntime({id:"p"},f.backend);const cancel=hosts.cancelSession(h,binding,{commandId:"interrupt-a",fence});const rejected=expect(cancel).rejects.toMatchObject({code:"NATIVE_RUNTIME_INTERRUPT_UNKNOWN"});await vi.advanceTimersByTimeAsync(5_001);await rejected;expect(await hosts.releaseRuntime(h,"stop-owned")).toMatchObject({state:"unknown"});expect(f.stop).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);}finally{vi.useRealTimers();}
});
it("drains an admitted interrupt before completing shutdown and releasing the host",async()=>{
 let finish!:(receipt:{version:1;commandId:string;state:"accepted";nativeRequestId:string})=>void;const pending=new Promise<{version:1;commandId:string;state:"accepted";nativeRequestId:string}>(r=>{finish=r;});const hosts=new NativeRuntimeHosts();const f=fixture();f.endpoint.interrupt=vi.fn(async()=>pending);const h=await hosts.acquireRuntime({id:"p"},f.backend);const cancel=hosts.cancelSession(h,binding,{commandId:"interrupt-a",fence});await Promise.resolve();const shutdown=hosts.shutdown("stop-owned");await vi.waitFor(()=>expect(f.endpoint.interrupt).toHaveBeenCalledTimes(1));expect(f.stop).not.toHaveBeenCalled();finish({version:1,commandId:"interrupt-a",state:"accepted",nativeRequestId:"receipt"});await cancel;expect(await shutdown).toContainEqual({state:"stopped",nativeSessionDeleted:false});expect(f.stop).toHaveBeenCalledTimes(1);
});
it("keeps cleanup unknown when a detached descendant escapes the owned process group",async()=>{
 const directory=mkdtempSync(join(tmpdir(),"dispatcher-native-escaped-"));directories.push(directory);const manager=new ProcessManager(directory);let pid:number|undefined;
 const child=await manager.start({runId:"escaped",file:process.execPath,args:["-e",`const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',detached:true});require('node:fs').writeFileSync('child.pid',String(child.pid));child.unref();`],cwd:directory});
 try{await child.result();pid=Number(readFileSync(join(directory,"child.pid"),"utf8"));process.kill(pid,0);const f=fixture();f.endpoint.process=child;f.endpoint.stop=async()=>child.cancel();const hosts=new NativeRuntimeHosts();const h=await hosts.acquireRuntime({id:"p"},f.backend);expect(await hosts.releaseRuntime(h,"stop-owned")).toMatchObject({state:"unknown",reasonCode:platform()==="win32"?"NATIVE_PROCESS_TREE_UNKNOWN":"NATIVE_BACKGROUND_SCOPE_UNVERIFIED"});}finally{if(pid){try{process.kill(pid,"SIGKILL");}catch{/* The fixture child may already have exited. */}}await manager.shutdown();}
});
it("captures class or inherited backend and endpoint metadata without losing identity",async()=>{
 const f=fixture();const endpoint=Object.create(f.endpoint) as typeof f.endpoint;const backend=Object.create(f.backend) as typeof f.backend;backend.acquire=vi.fn(async()=>endpoint);const hosts=new NativeRuntimeHosts();const h=await hosts.acquireRuntime({id:"p"},backend);expect(h).toMatchObject({hostId:"host",profileId:"p",backendId:"serve",runnerId:"local",nativeStoreRef:"store",product:"opencode",region:"global",ownership:"owned"});expect((await hosts.releaseRuntime(h,"stop-owned")).state).toBe("stopped");
});
