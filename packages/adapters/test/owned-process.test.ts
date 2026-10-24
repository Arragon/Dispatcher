import {EventEmitter} from "node:events";
import {execFile,exec,spawn,type ChildProcess} from "node:child_process";
import type * as ChildProcessModule from "node:child_process";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {OwnedProcessGroup} from "../src/owned-process.js";
import {OwnedProcessRoot} from "../src/owned-root-process.js";
import {drainCatalogProcess} from "../src/catalog-process.js";
vi.mock("node:child_process",async importOriginal=>({...await importOriginal<typeof ChildProcessModule>(),execFile:vi.fn(()=>{throw Error("tree command forbidden");}),exec:vi.fn(()=>{throw Error("enumeration forbidden");}),spawn:vi.fn(()=>{throw Error("enumeration forbidden");})}));

const pid=12345;
function child(){return Object.assign(new EventEmitter(),{pid,exitCode:null,signalCode:null,kill:vi.fn(()=>true)}) as unknown as ChildProcess;}
function absent(){throw Object.assign(Error("gone"),{code:"ESRCH"});}
function denied(){throw Object.assign(Error("denied"),{code:"EPERM"});}
function observe<T>(promise:Promise<T>):Promise<T>{void promise.catch(()=>undefined);return promise;}
beforeEach(()=>vi.useFakeTimers());
afterEach(async()=>{await vi.advanceTimersByTimeAsync(10_000);try{expect(execFile).not.toHaveBeenCalled();expect(exec).not.toHaveBeenCalled();expect(spawn).not.toHaveBeenCalled();}finally{vi.restoreAllMocks();vi.useRealTimers();}});

describe.runIf(process.platform!=="win32")("POSIX group ownership",()=>{
it("never signals a reused numeric group after observing the original group empty on root exit",async()=>{
 const owned=child(),signal=vi.spyOn(process,"kill").mockImplementation(absent),cancel=new OwnedProcessGroup(owned);owned.emit("exit",0);signal.mockClear().mockReturnValue(true);await cancel.stop();expect(signal).not.toHaveBeenCalled();expect(owned.kill).not.toHaveBeenCalled();
});
it("does not turn an uncertain group observation into permission to signal after root exit",async()=>{
 const owned=child(),signal=vi.spyOn(process,"kill").mockImplementation(denied),cancel=new OwnedProcessGroup(owned);owned.emit("exit",0);signal.mockClear().mockReturnValue(true);await expect(cancel.stop()).rejects.toThrow("LOCAL_PROCESS_IDENTITY_UNKNOWN");await expect(cancel.stop()).rejects.toMatchObject({cause:{code:"EPERM"}});expect(cancel.treeStatus()).toEqual({state:"unknown",scope:"owned-process-group"});expect(signal).not.toHaveBeenCalled();
});
it("refuses a mutated child PID instead of signaling either the old or replacement process",async()=>{
 const owned=child(),signal=vi.spyOn(process,"kill").mockImplementation(absent),cancel=new OwnedProcessGroup(owned);Object.assign(owned,{pid:67890});await expect(cancel.stop()).rejects.toThrow("LOCAL_PROCESS_IDENTITY_UNKNOWN");expect(signal).not.toHaveBeenCalled();expect(owned.kill).not.toHaveBeenCalled();
});
it("refuses cooperative interruption after captured identity changes",async()=>{
 const owned=child(),signal=vi.spyOn(process,"kill").mockImplementation(absent),cancel=new OwnedProcessGroup(owned);Object.assign(owned,{pid:67890});await expect(cancel.stop(true)).rejects.toThrow("LOCAL_PROCESS_IDENTITY_UNKNOWN");expect(signal).not.toHaveBeenCalled();expect(owned.kill).not.toHaveBeenCalled();
});
it("does not escalate a failed cooperative signal into an unverified group kill",async()=>{
 const owned=child(),signal=vi.spyOn(process,"kill").mockImplementation((_pid,kind)=>kind===0?true:absent());vi.mocked(owned.kill).mockImplementation(denied);const cancel=new OwnedProcessGroup(owned);await expect(cancel.stop(true)).rejects.toThrow("denied");expect(owned.kill).toHaveBeenCalledExactlyOnceWith("SIGINT");expect(signal.mock.calls.every(([,kind])=>kind===0)).toBe(true);
 const first=cancel.stop();owned.emit("close",0);expect(cancel.stop()).toBe(first);await expect(first).rejects.toThrow("denied");expect(signal.mock.calls.every(([,kind])=>kind===0)).toBe(true);
});
it("shares the original operation when SIGINT synchronously emits exit",async()=>{
 const owned=child();let present=true,joined:Promise<void>|undefined;
 const signal=vi.spyOn(process,"kill").mockImplementation(()=>present?true:absent()),owner=new OwnedProcessGroup(owned);
 vi.mocked(owned.kill).mockImplementation(()=>{present=false;owned.emit("exit",0);joined=owner.stop();return true;});
 const first=owner.stop(true);expect(owner.stop()).toBe(first);await first;expect(joined).toBe(first);expect(owned.kill).toHaveBeenCalledExactlyOnceWith("SIGINT");expect(signal.mock.calls.every(([,kind])=>kind===0)).toBe(true);
});
it("waits the full cooperative grace before group TERM and shares first-call mode",async()=>{
 const owned=child();let present=true;
 const signal=vi.spyOn(process,"kill").mockImplementation((_pid,kind)=>{if(!present)return absent();if(kind==="SIGTERM")present=false;return true;}),owner=new OwnedProcessGroup(owned);
 const first=owner.stop(true);expect(owner.stop()).toBe(first);await vi.advanceTimersByTimeAsync(999);expect(owned.kill).toHaveBeenCalledExactlyOnceWith("SIGINT");expect(signal.mock.calls.some(([,kind])=>kind==="SIGTERM")).toBe(false);
 await vi.advanceTimersByTimeAsync(1);await first;expect(signal).toHaveBeenCalledWith(-pid,"SIGTERM");expect(owner.stop(true)).toBe(first);
});
it("drains immediately after cooperative root exit before grace expires",async()=>{
 const owned=child();let present=true;const signal=vi.spyOn(process,"kill").mockImplementation((_pid,kind)=>{if(!present)return absent();if(kind==="SIGTERM")present=false;return true;}),owner=new OwnedProcessGroup(owned),first=owner.stop(true);
 await vi.advanceTimersByTimeAsync(250);expect(signal.mock.calls.some(([,kind])=>kind==="SIGTERM")).toBe(false);owned.emit("exit",0);await vi.advanceTimersByTimeAsync(25);await first;expect(signal).toHaveBeenCalledWith(-pid,"SIGTERM");
});
it("never interrupts an already exited root and keeps the ordinary first request",async()=>{
 const owned=child();const signal=vi.spyOn(process,"kill").mockImplementation(absent),owner=new OwnedProcessGroup(owned);owned.emit("exit",0);const first=owner.stop();expect(owner.stop(true)).toBe(first);await first;expect(owned.kill).not.toHaveBeenCalled();signal.mockClear();await owner.stop(true);expect(signal).not.toHaveBeenCalled();
});
it("rejects mutation during cooperative grace without signaling either group",async()=>{
 const owned=child(),signal=vi.spyOn(process,"kill").mockReturnValue(true),owner=new OwnedProcessGroup(owned),pending=observe(owner.stop(true));await vi.advanceTimersByTimeAsync(25);Object.assign(owned,{pid:67890});await vi.advanceTimersByTimeAsync(25);await expect(pending).rejects.toThrow("LOCAL_PROCESS_IDENTITY_UNKNOWN");expect(signal.mock.calls.every(([target,kind])=>target===-pid&&kind===0)).toBe(true);expect(owned.kill).toHaveBeenCalledExactlyOnceWith("SIGINT");
});
it("captures the original bound root SIGINT method",async()=>{
 const owned=child(),original=owned.kill,owner=new OwnedProcessGroup(owned);let present=true;
 vi.mocked(original).mockImplementation(()=>{present=false;owned.emit("exit",0);return true;});owned.kill=vi.fn(()=>false);vi.spyOn(process,"kill").mockImplementation(()=>present?true:absent());await owner.stop(true);expect(original).toHaveBeenCalledExactlyOnceWith("SIGINT");expect(owned.kill).not.toHaveBeenCalled();
});
it("caches false SIGINT delivery and never escalates after a later close",async()=>{
 const owned=child(),signal=vi.spyOn(process,"kill").mockImplementation((_pid,kind)=>kind===0?true:absent()),owner=new OwnedProcessGroup(owned);vi.mocked(owned.kill).mockReturnValue(false);const first=owner.stop(true);await expect(first).rejects.toThrow("LOCAL_PROCESS_IDENTITY_UNKNOWN");owned.emit("exit",0);owned.emit("close",0);expect(owner.stop()).toBe(first);await expect(owner.stop()).rejects.toThrow("LOCAL_PROCESS_IDENTITY_UNKNOWN");expect(owned.kill).toHaveBeenCalledExactlyOnceWith("SIGINT");expect(signal.mock.calls.every(([,kind])=>kind===0)).toBe(true);
});
it("permanently retains post-exit permission uncertainty without more OS calls",async()=>{
 const owned=child(),signal=vi.spyOn(process,"kill").mockReturnValue(true),owner=new OwnedProcessGroup(owned);owned.emit("exit",0);signal.mockImplementation(denied);await expect(owner.stop()).rejects.toThrow("LOCAL_PROCESS_IDENTITY_UNKNOWN");await expect(owner.stop()).rejects.toMatchObject({cause:{code:"EPERM"}});signal.mockClear().mockReturnValue(true);expect(owner.treeStatus()).toEqual({state:"unknown",scope:"owned-process-group"});await expect(owner.stop()).rejects.toThrow("LOCAL_PROCESS_IDENTITY_UNKNOWN");expect(signal).not.toHaveBeenCalled();
});
it("preserves the cause when a post-exit group signal is denied",async()=>{
 const owned=child(),signal=vi.spyOn(process,"kill").mockImplementation((_pid,kind)=>kind===0?true:denied()),owner=new OwnedProcessGroup(owned);owned.emit("exit",0);await expect(owner.stop()).rejects.toMatchObject({message:"LOCAL_PROCESS_IDENTITY_UNKNOWN",cause:{code:"EPERM"}});signal.mockClear();expect(owner.treeStatus()).toEqual({state:"unknown",scope:"owned-process-group"});expect(signal).not.toHaveBeenCalled();
});
it("keeps ordinary drainage as the first live request without root SIGINT",async()=>{
 const owned=child();let present=true;vi.spyOn(process,"kill").mockImplementation((_pid,kind)=>{if(!present)return absent();if(kind==="SIGTERM")present=false;return true;});const owner=new OwnedProcessGroup(owned),first=owner.stop();expect(owner.stop(true)).toBe(first);await first;expect(owned.kill).not.toHaveBeenCalled();
});
});

it("never signals a non-group root after its captured exit",async()=>{
 const owned=child(),cancel=new OwnedProcessRoot(owned),signal=vi.spyOn(process,"kill").mockImplementation(()=>{throw Error("group authority forbidden");});Object.assign(owned,{exitCode:0});owned.emit("exit",0);Object.assign(owned,{pid:67890,exitCode:null});await cancel.stop();expect(owned.kill).not.toHaveBeenCalled();expect(signal).not.toHaveBeenCalled();
});
it("root mode captures the bound kill and shares one stop operation",async()=>{
 const owned=child(),original=owned.kill,owner=new OwnedProcessRoot(owned),signal=vi.spyOn(process,"kill").mockImplementation(()=>{throw Error("group authority forbidden");});
 vi.mocked(original).mockImplementation(function(this:ChildProcess){expect(this).toBe(owned);owned.emit("exit",0);return true;});owned.kill=vi.fn(()=>false);const first=owner.stop();expect(owner.stop()).toBe(first);await first;expect(original).toHaveBeenCalledExactlyOnceWith("SIGTERM");expect(owned.kill).not.toHaveBeenCalled();expect(signal).not.toHaveBeenCalled();
});
it("root mode rejects changed identity before stop or after polling",async()=>{
 const signal=vi.spyOn(process,"kill").mockImplementation(()=>{throw Error("group authority forbidden");}),before=child(),beforeOwner=new OwnedProcessRoot(before);Object.assign(before,{pid:67890});await expect(beforeOwner.stop()).rejects.toThrow("LOCAL_PROCESS_IDENTITY_UNKNOWN");expect(before.kill).not.toHaveBeenCalled();
 const during=child(),owner=new OwnedProcessRoot(during),pending=observe(owner.stop());await vi.advanceTimersByTimeAsync(25);Object.assign(during,{pid:67890});await vi.advanceTimersByTimeAsync(25);await expect(pending).rejects.toThrow("LOCAL_PROCESS_IDENTITY_UNKNOWN");expect(during.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");expect(signal).not.toHaveBeenCalled();
});
it.each(["throw","false"])("root mode caches %s signal refusal without escalation",async mode=>{
 const owned=child(),owner=new OwnedProcessRoot(owned),signal=vi.spyOn(process,"kill").mockReturnValue(true);vi.mocked(owned.kill).mockImplementation(()=>mode==="throw"?denied():false);const first=owner.stop();await expect(first).rejects.toThrow(mode==="throw"?"denied":"LOCAL_PROCESS_IDENTITY_UNKNOWN");owned.emit("close",0);expect(owner.stop()).toBe(first);await expect(owner.stop()).rejects.toThrow();expect(owned.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");expect(signal).not.toHaveBeenCalled();
});
it("root mode treats missing PID as unknown unless spawn failure was observed",async()=>{
 const signal=vi.spyOn(process,"kill").mockReturnValue(true),unknown=child();Object.assign(unknown,{pid:undefined});const unknownOwner=new OwnedProcessRoot(unknown);await expect(unknownOwner.stop()).rejects.toThrow("LOCAL_PROCESS_IDENTITY_UNKNOWN");expect(unknown.kill).not.toHaveBeenCalled();
 const failed=child();Object.assign(failed,{pid:undefined});const failedOwner=new OwnedProcessRoot(failed);failed.emit("error",Error("spawn failed"));await failedOwner.stop();expect(failed.kill).not.toHaveBeenCalled();expect(signal).not.toHaveBeenCalled();
});
it("root SIGKILL delivery alone cannot satisfy the caller natural-close gate",async()=>{
 const owned=child(),owner=new OwnedProcessRoot(owned),signal=vi.spyOn(process,"kill").mockImplementation(()=>{throw Error("group authority forbidden");}),closed=Promise.withResolvers<void>(),pending=observe(drainCatalogProcess(owner,closed.promise,500));
 await vi.advanceTimersByTimeAsync(1999);expect(owned.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");await vi.advanceTimersByTimeAsync(1);await owner.stop();expect(owned.kill.mock.calls).toEqual([["SIGTERM"],["SIGKILL"]]);await vi.advanceTimersByTimeAsync(500);await expect(pending).rejects.toMatchObject({code:"MODEL_CATALOG_CLEANUP_UNKNOWN"});closed.resolve();expect(signal).not.toHaveBeenCalled();
});
