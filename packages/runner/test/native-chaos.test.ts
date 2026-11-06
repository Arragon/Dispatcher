import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { NativeBinding, NativeCommandReceipt, NativeObservation } from "@dispatcher/domain";
import { NativeRuntime, NativeRuntimeHosts, type NativeRuntimeBackend, type NativeRuntimeEndpoint } from "../src/native-observation.js";
import { reconcileNativeRuntime } from "../src/reconcile.js";
import { ProcessManager } from "../src/process.js";

const roots:string[]=[];afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const binding:NativeBinding={version:1,product:"opencode",region:"global",profileId:"p",backendId:"native",runnerId:"local",nativeStoreRef:"store",nativeSessionId:"native-a",executionRefId:"execution",identityState:"bound"};
const observation:NativeObservation={version:1,id:"fixture",nativeSessionId:"native-a",scopeFingerprint:"scope",observedAt:"2026-10-11T08:00:00Z",state:"idle",pendingTools:"none",pendingApprovals:"none",historyMode:"native-revision",executionRefId:"execution"};
const fence={runId:"run",sessionId:"session",commandId:"interrupt",generation:1,leaseId:"lease",expectedTaskRevision:1,expectedCurrentRunId:"run",expectedControlRevision:1,expectedControlEpoch:1};
function cleanupChild(root:string,pid?:number):number|undefined{
  if(pid===undefined&&existsSync(join(root,"child.pid")))pid=Number(readFileSync(join(root,"child.pid"),"utf8"));
  if(pid&&Number.isSafeInteger(pid)&&pid>0){try{process.kill(pid,"SIGKILL");}catch(error){if((error as NodeJS.ErrnoException).code!=="ESRCH")throw error;}}
  return pid;
}
function host(){
  const stop=vi.fn(async()=>{}),detach=vi.fn(async()=>{}),interrupt=vi.fn(async():Promise<NativeCommandReceipt>=>({version:1,commandId:"interrupt",state:"accepted"}));
  const endpoint:NativeRuntimeEndpoint={id:"host",profileId:"p",backendId:"native",runnerId:"local",nativeStoreRef:"store",product:"opencode",region:"global",ownership:"external",quiescent:async()=>true,stop,detach,interrupt};
  const acquire=vi.fn(async()=>endpoint);const backend:NativeRuntimeBackend={id:"native",runnerId:"local",nativeStoreRef:"store",product:"opencode",region:"global",ownership:"external",acquire};
  return {endpoint,backend,stop,detach,interrupt,acquire};
}
it("reconnection during a pending read fences old idle evidence and never resumes execution",async()=>{
  const runtime=new NativeRuntime();const held=Promise.withResolvers<NativeObservation>();const first=runtime.connect({binding,scopeFingerprint:"scope",inspect:()=>held.promise,processState:()=>"running"});
  const pending=runtime.inspect(first);await Promise.resolve();const read=vi.fn(async()=>({...observation,state:"unreachable" as const,pendingTools:"unknown" as const,pendingApprovals:"unknown" as const}));const second=runtime.connect({binding,scopeFingerprint:"scope",inspect:read,processState:()=>"unknown"},{observerGeneration:2});
  expect(await pending).toMatchObject({state:"unknown",read:{reasonCode:"STALE_NATIVE_OBSERVER"}});held.resolve(observation);await Promise.resolve();expect(runtime.latest(binding)).toBeUndefined();
  const current=await runtime.inspect(second);expect(current).toMatchObject({state:"unreachable",read:{observerGeneration:2,processState:"unknown"}});expect(read).toHaveBeenCalledOnce();expect(reconcileNativeRuntime({binding,persistedState:current.state,processState:current.read!.processState,canObserve:true})).toMatchObject({action:"REOBSERVE",startsExecution:false});runtime.disconnect(second);
});
it("timeout followed by a late healthy snapshot cannot authorize the replacement observer",async()=>{
  vi.useFakeTimers();const runtime=new NativeRuntime();const held=Promise.withResolvers<NativeObservation>();const first=runtime.connect({binding,scopeFingerprint:"scope",inspect:()=>held.promise});const pending=runtime.inspect(first,{timeoutMs:10});
  await vi.advanceTimersByTimeAsync(11);expect(await pending).toMatchObject({state:"unreachable",read:{reasonCode:"NATIVE_READ_TIMEOUT"}});const second=runtime.connect({binding,scopeFingerprint:"scope",inspect:async()=>({...observation,state:"deleted"})},{observerGeneration:2});held.resolve(observation);await vi.advanceTimersByTimeAsync(1);expect(runtime.latest(binding)).toBeUndefined();
  expect(await runtime.inspect(second)).toMatchObject({state:"deleted",read:{observerGeneration:2,readability:"deleted"}});expect(runtime.latest(binding)?.state).toBe("deleted");runtime.disconnect(second);expect(vi.getTimerCount()).toBe(0);
});
it("a lost interrupt reply freezes both claims of a shared host even after a late ACK",async()=>{
  vi.useFakeTimers();const f=host(),hosts=new NativeRuntimeHosts();const held=Promise.withResolvers<NativeCommandReceipt>();f.interrupt.mockImplementation(()=>held.promise);const a=await hosts.acquireRuntime({id:"p"},f.backend),b=await hosts.acquireRuntime({id:"p"},f.backend);
  const pending=hosts.cancelSession(a,binding,{commandId:"interrupt",fence});const failed=expect(pending).rejects.toMatchObject({code:"NATIVE_RUNTIME_INTERRUPT_UNKNOWN"});await vi.advanceTimersByTimeAsync(30_001);await failed;expect(f.interrupt).toHaveBeenCalledOnce();held.resolve({version:1,commandId:"interrupt",state:"accepted"});await vi.advanceTimersByTimeAsync(1);
  await expect(hosts.cancelSession(b,{...binding,nativeSessionId:"native-b"},{commandId:"interrupt",fence})).rejects.toMatchObject({code:"RUNTIME_OWNER_MISMATCH"});expect(await hosts.releaseRuntime(a,"stop-owned")).toMatchObject({state:"retained"});expect(await hosts.releaseRuntime(b,"stop-owned")).toMatchObject({state:"unknown",reasonCode:"NATIVE_RUNTIME_OUTCOME_UNKNOWN",nativeSessionDeleted:false});
  await expect(hosts.acquireRuntime({id:"p"},f.backend)).rejects.toMatchObject({code:"NATIVE_RUNTIME_OUTCOME_UNKNOWN"});expect(f.acquire).toHaveBeenCalledOnce();expect(f.interrupt).toHaveBeenCalledOnce();expect(f.stop).not.toHaveBeenCalled();expect(f.detach).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
});
it.each(["deleted","unreachable"] as const)("an escaped real child plus %s history never starts a replacement or proves native cleanup",async state=>{
  const root=mkdtempSync(join(tmpdir(),"native-chaos-child-"));roots.push(root);const manager=new ProcessManager(root);let pid:number|undefined;
  const handle=await manager.start({runId:"fixture-child",file:process.execPath,args:["-e","const child=require('node:child_process').spawn(process.execPath,['-e','const timer=setInterval(()=>{},1000);setTimeout(()=>clearInterval(timer),30000)'],{stdio:'ignore',detached:true});require('node:fs').writeFileSync('child.pid',String(child.pid));child.unref();"],cwd:root});
  try{const result=await handle.result();await vi.waitFor(()=>expect(existsSync(join(root,"child.pid"))).toBe(true),{timeout:5000});pid=Number(readFileSync(join(root,"child.pid"),"utf8"));expect(result.exitCode).toBe(0);process.kill(pid,0);
    const tree=handle.treeStatus?.();expect(tree?.state).toBe(platform()==="win32"?"unknown":"empty");const runtime=new NativeRuntime();const token=runtime.connect({binding,scopeFingerprint:"scope",processState:()=>"completed",inspect:async()=>({...observation,state,pendingTools:"unknown",pendingApprovals:"unknown"})});const read=await runtime.inspect(token);
    expect(reconcileNativeRuntime({binding,persistedState:read.state,processState:read.read!.processState,processTree:tree,canObserve:true})).toMatchObject({action:state==="deleted"||platform()==="win32"?"ATTENTION":"REOBSERVE",startsExecution:false,reasonCode:state==="deleted"?"NATIVE_SESSION_DELETED":platform()==="win32"?"NATIVE_PROCESS_TREE_UNKNOWN":"NATIVE_READ_ONLY_REOBSERVATION"});expect(read.pendingTools).toBe("unknown");runtime.disconnect(token);process.kill(pid,0);
  }finally{cleanupChild(root,pid);await manager.shutdown();}
});
it("recovers the owned child PID for cleanup after a nonzero parent exit before PID registration",async()=>{
  const root=mkdtempSync(join(tmpdir(),"native-chaos-failed-parent-"));roots.push(root);const manager=new ProcessManager(root);let pid:number|undefined;
  try{const handle=await manager.start({runId:"failed-parent",file:process.execPath,args:["-e","const child=require('node:child_process').spawn(process.execPath,['-e','const timer=setInterval(()=>{},1000);setTimeout(()=>clearInterval(timer),30000)'],{stdio:'ignore'});require('node:fs').writeFileSync('child.pid',String(child.pid));child.unref();process.exit(17);"],cwd:root});const result=await handle.result();
    expect(result.exitCode).toBe(17);expect(pid).toBeUndefined();pid=cleanupChild(root,pid);expect(pid).toBeGreaterThan(0);await vi.waitFor(()=>expect(()=>process.kill(pid!,0)).toThrow(expect.objectContaining({code:"ESRCH"})),{timeout:5000});
  }finally{cleanupChild(root,pid);await manager.shutdown();}
});
