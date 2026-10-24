import type {ChildProcess} from "node:child_process";
import {EventEmitter} from "node:events";
import {expect,it,vi} from "vitest";
import {OwnedProcessGroup} from "../src/owned-process.js";
it.runIf(process.platform!=="win32")("keeps permission uncertainty and latches owned group absence before a numeric PID can be reused",()=>{
 const child=Object.assign(new EventEmitter(),{pid:2147483000}) as ChildProcess;
 const owned=new OwnedProcessGroup(child);let state:"present"|"denied"|"absent"="present";
 const kill=vi.spyOn(process,"kill").mockImplementation(()=>{if(state!=="present")throw Object.assign(new Error("fixture"),{code:state==="denied"?"EPERM":"ESRCH"});return true;});
 try{
  expect(owned.treeStatus()).toEqual({state:"present",scope:"owned-process-group"});state="denied";
  expect(owned.treeStatus()).toEqual({state:"unknown",scope:"owned-process-group"});state="absent";
  expect(owned.treeStatus()).toEqual({state:"empty",scope:"owned-process-group"});const calls=kill.mock.calls.length;state="present";
  expect(owned.treeStatus()).toEqual({state:"empty",scope:"owned-process-group"});expect(kill).toHaveBeenCalledTimes(calls);
 }finally{kill.mockRestore();}
});
it("does not promote a PTY root exit into a verified process-group observation",()=>{
 const terminal={pid:2147483000,kill:()=>{},onExit:()=>{}};const owned=new OwnedProcessGroup(terminal);
 expect(owned.treeStatus()).toEqual({state:"unknown",scope:"unverified"});
});
