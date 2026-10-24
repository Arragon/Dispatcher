import {EventEmitter} from "node:events";
import {execFile,exec,spawn,type ChildProcess} from "node:child_process";
import type * as ChildProcessModule from "node:child_process";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {OwnedProcessRoot} from "../src/owned-root-process.js";
import {drainCatalogProcess} from "../src/catalog-process.js";
vi.mock("node:child_process",async importOriginal=>({...await importOriginal<typeof ChildProcessModule>(),execFile:vi.fn(()=>{throw Error("tree command forbidden");}),exec:vi.fn(()=>{throw Error("enumeration forbidden");}),spawn:vi.fn(()=>{throw Error("enumeration forbidden");})}));

const pid=12345;
function child(){return Object.assign(new EventEmitter(),{pid,exitCode:null,signalCode:null,kill:vi.fn(()=>true)}) as unknown as ChildProcess;}
function denied(){throw Object.assign(Error("denied"),{code:"EPERM"});}
function observe<T>(promise:Promise<T>):Promise<T>{void promise.catch(()=>undefined);return promise;}
beforeEach(()=>vi.useFakeTimers());
afterEach(async()=>{await vi.advanceTimersByTimeAsync(10_000);try{expect(execFile).not.toHaveBeenCalled();expect(exec).not.toHaveBeenCalled();expect(spawn).not.toHaveBeenCalled();}finally{vi.restoreAllMocks();vi.useRealTimers();}});

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
