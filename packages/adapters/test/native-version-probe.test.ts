import {EventEmitter} from "node:events";
import {PassThrough} from "node:stream";
import type {ChildProcess} from "node:child_process";
import type * as ChildProcessModule from "node:child_process";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {spawn,execFile} from "node:child_process";
import {OwnedProcessGroup} from "../src/owned-process.js";
import {readOwnedNativeVersion} from "../src/native-version-probe.js";

vi.mock("node:child_process",async importOriginal=>({...await importOriginal<typeof ChildProcessModule>(),spawn:vi.fn(),execFile:vi.fn(()=>{throw Error("tree command forbidden");})}));
let rootMode=false;
function fixture(){
 const child=Object.assign(new EventEmitter(),{pid:12345 as number|undefined,exitCode:null,signalCode:null,kill:vi.fn(()=>true),stdout:new PassThrough(),stderr:new PassThrough()});
 vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcess);
 return child;
}
function input(extra:Partial<Parameters<typeof readOwnedNativeVersion>[0]>={}){rootMode=extra.ownsGroup===false;return {executable:"/fixture/tool",workspacePath:"/fixture/work",environment:{PATH:"/fixture/bin",PWD:"/old",DISPATCHER_OWNER_TOKEN:"forbidden",dispatcher_secret_store_key:"forbidden",PROVIDER_TOKEN:"retained"},failure:(code:"unavailable"|"exit-unconfirmed")=>Error(code),...extra};}
function observe<T>(promise:Promise<T>){void promise.catch(()=>undefined);return promise;}
function natural(child:ReturnType<typeof fixture>,code=0){child.exitCode=code;child.emit("exit",code);child.stdout.end();child.stderr.end();child.emit("close",code);}
beforeEach(()=>{rootMode=false;vi.useFakeTimers();vi.mocked(spawn).mockClear();vi.mocked(execFile).mockClear();vi.spyOn(process,"kill").mockImplementation((target,kind)=>{if(target!==-12345||kind!==0)throw Error("unexpected global signal");throw Object.assign(Error("gone"),{code:"ESRCH"});});});
afterEach(async()=>{await vi.advanceTimersByTimeAsync(10_000);try{if(rootMode)expect(process.kill).not.toHaveBeenCalled();expect(execFile).not.toHaveBeenCalled();}finally{vi.restoreAllMocks();vi.useRealTimers();}});

it.each([undefined,false] as const)("spawns exact sanitized version options in ownsGroup=%s mode",async ownsGroup=>{
 const child=fixture(),stop=vi.spyOn(OwnedProcessGroup.prototype,"stop").mockResolvedValue(),pending=readOwnedNativeVersion(input(ownsGroup===false?{ownsGroup:false}:{}));child.stdout.write("tool 1.2\n");natural(child);expect(await pending).toBe("tool 1.2");
 expect(spawn).toHaveBeenCalledExactlyOnceWith("/fixture/tool",["--version"],{cwd:"/fixture/work",env:{PATH:"/fixture/bin",PWD:"/fixture/work",PROVIDER_TOKEN:"retained"},detached:ownsGroup===false?false:process.platform!=="win32",shell:false,stdio:["ignore","pipe","pipe"]});
 if(ownsGroup===false){expect(stop).not.toHaveBeenCalled();expect(child.kill).not.toHaveBeenCalled();}else {expect(stop).toHaveBeenCalled();if(process.platform!=="win32")expect(vi.mocked(process.kill).mock.calls).toEqual([[-12345,0]]);}
});
it.each([0,-1,NaN,Infinity])("does not spawn for invalid timeout %s",async timeoutMs=>{fixture();await expect(readOwnedNativeVersion(input({timeoutMs}))).rejects.toThrow("unavailable");expect(spawn).not.toHaveBeenCalled();});
it("does not spawn when pre-aborted",async()=>{fixture();await expect(readOwnedNativeVersion(input({signal:AbortSignal.abort()}))).rejects.toThrow("unavailable");expect(spawn).not.toHaveBeenCalled();});
it.each([undefined,30_000])("uses the 3000 ms default/cap for timeout %s and requires proven cleanup",async timeoutMs=>{
 const child=fixture(),pending=observe(readOwnedNativeVersion(input({ownsGroup:false,...(timeoutMs===undefined?{}:{timeoutMs})})));child.kill.mockImplementation(()=>{natural(child);return true;});await vi.advanceTimersByTimeAsync(2999);expect(child.kill).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(1);await expect(pending).rejects.toThrow("unavailable");expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
});
it.each([16_384,16_385])("enforces the exact %s-byte stdout boundary",async size=>{
 const child=fixture(),pending=observe(readOwnedNativeVersion(input({ownsGroup:false})));child.stdout.write(Buffer.alloc(size,120));natural(child);if(size===16_384)expect(await pending).toBe("x".repeat(size));else await expect(pending).rejects.toThrow("unavailable");
});
it.each(["nonzero","spawn-error","abort"])("returns unavailable for %s only after cleanup is proven",async mode=>{
 const child=fixture();if(mode==="spawn-error")child.pid=undefined;const controller=new AbortController(),pending=observe(readOwnedNativeVersion(input({ownsGroup:false,signal:controller.signal})));child.kill.mockImplementation(()=>{natural(child);return true;});if(mode==="nonzero")natural(child,1);else if(mode==="spawn-error"){child.emit("error",Error("spawn error"));natural(child,1);}else controller.abort();await expect(pending).rejects.toThrow("unavailable");if(mode==="spawn-error")expect(child.kill).not.toHaveBeenCalled();
});
it("always drains the group even after valid natural output",async()=>{
 const child=fixture(),stop=vi.spyOn(OwnedProcessGroup.prototype,"stop").mockRejectedValue(Error("denied")),pending=observe(readOwnedNativeVersion(input()));child.stdout.write("valid 1.2");natural(child);await expect(pending).rejects.toThrow("exit-unconfirmed");expect(stop).toHaveBeenCalled();
});
it("rejects root exit with inherited open pipes after the exact 500 ms close budget",async()=>{
 const child=fixture(),pending=observe(readOwnedNativeVersion(input({ownsGroup:false,timeoutMs:1}))),destroy=vi.spyOn(child.stdout,"destroy");child.stdout.write("valid 1.2");child.emit("exit",0);await vi.advanceTimersByTimeAsync(500);expect(destroy).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(1);await expect(pending).rejects.toThrow("exit-unconfirmed");expect(destroy).toHaveBeenCalled();child.emit("close",0);await expect(pending).rejects.toThrow("exit-unconfirmed");expect(child.kill).not.toHaveBeenCalled();
});
it.each([false,undefined] as const)("preserves natural-close budgets for ownsGroup=%s",async ownsGroup=>{
 const child=fixture();vi.spyOn(OwnedProcessGroup.prototype,"stop").mockResolvedValue();const pending=observe(readOwnedNativeVersion(input({...(ownsGroup===false?{ownsGroup:false}:{}),timeoutMs:1})));child.stdout.write("valid");child.emit("exit",0);await vi.advanceTimersByTimeAsync(601);child.emit("close",0);if(ownsGroup===false)await expect(pending).rejects.toThrow("exit-unconfirmed");else await expect(pending).rejects.toThrow("unavailable");
});
it.each(["stdout","stderr"] as const)("retains %s errors as exit-unconfirmed even with valid output",async stream=>{
 const child=fixture(),pending=observe(readOwnedNativeVersion(input({ownsGroup:false})));child.stdout.write("valid 1.2");child[stream].emit("error",Error("pipe failed"));natural(child);await expect(pending).rejects.toThrow("exit-unconfirmed");
});
it("cannot use valid data when root stop is denied",async()=>{
 const child=fixture(),pending=observe(readOwnedNativeVersion(input({ownsGroup:false,timeoutMs:1})));child.stdout.write("valid 1.2");child.kill.mockImplementation(()=>{throw Error("denied");});await vi.advanceTimersByTimeAsync(1);await expect(pending).rejects.toThrow("exit-unconfirmed");
});
it.runIf(process.platform!=="win32")("drains a successful default group with the exact captured negative PID sequence",async()=>{
 const child=fixture();let present=true;vi.mocked(process.kill).mockImplementation((target,kind)=>{expect(target).toBe(-12345);if(kind===0){if(!present)throw Object.assign(Error("gone"),{code:"ESRCH"});return true;}expect(kind).toBe("SIGTERM");present=false;return true;});
 const pending=readOwnedNativeVersion(input());child.stdout.write("valid 1.2");child.emit("exit",0);await vi.advanceTimersByTimeAsync(0);child.emit("close",0);expect(await pending).toBe("valid 1.2");expect(vi.mocked(process.kill).mock.calls).toEqual([[-12345,0],[-12345,0],[-12345,"SIGTERM"],[-12345,0]]);expect(child.kill).not.toHaveBeenCalled();
});
it("rejects missing root exit and close even after successful SIGKILL delivery",async()=>{
 const child=fixture(),pending=observe(readOwnedNativeVersion(input({ownsGroup:false,timeoutMs:1})));child.stdout.write("valid 1.2");await vi.advanceTimersByTimeAsync(2501);await expect(pending).rejects.toThrow("exit-unconfirmed");expect(child.kill.mock.calls).toEqual([["SIGTERM"],["SIGKILL"]]);
});
