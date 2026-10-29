import {EventEmitter} from "node:events";
import type * as NativeFs from "node:fs";
import {mkdtempSync,rmSync,watch,writeFileSync,type FSWatcher} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {awaitFixtureReady,fixtureMarker,fixtureOutcome} from "./catalog-fixtures.js";

vi.mock("node:fs",async importOriginal=>({
 ...await importOriginal<typeof NativeFs>(),
 watch:vi.fn(),
}));

type Notify=(eventType:"rename"|"change",filename:string|Buffer|null)=>void;
let directory:string,markerPath:string,watcher:FSWatcher,notify:Notify;
let marker:ReturnType<typeof fixtureMarker>|undefined;

beforeEach(()=>{
 directory=mkdtempSync(join(tmpdir(),"catalog-fixture-notification-"));
 markerPath=join(directory,"ready");
 marker=undefined;
 watcher=Object.assign(new EventEmitter(),{close:vi.fn()}) as unknown as FSWatcher;
 vi.mocked(watch).mockReset().mockImplementation((...args)=>{
  notify=args.at(-1) as Notify;
  return watcher;
 });
});
afterEach(()=>{
 marker?.close();
 rmSync(directory,{recursive:true,force:true});
});

it("accepts a legal null filename notification only after the actual marker exists",async()=>{
 marker=fixtureMarker(markerPath);
 let ready=false;
 void marker.ready.then(()=>{ready=true;});
 notify("rename",null);
 await Promise.resolve();
 expect(ready).toBe(false);
 expect(watcher.close).not.toHaveBeenCalled();
 writeFileSync(markerPath,"ready");
 notify("change",null);
 await Promise.resolve();
 expect(ready).toBe(true);
 expect(watcher.close).toHaveBeenCalledTimes(1);
});

it.each([
 {label:"string",filename:"ready"},
 {label:"Buffer",filename:Buffer.from("ready")},
])("accepts a named $label notification for an actual marker",async({filename})=>{
 marker=fixtureMarker(markerPath);
 let ready=false;
 void marker.ready.then(()=>{ready=true;});
 notify("rename",filename);
 await Promise.resolve();
 expect(ready).toBe(false);
 writeFileSync(markerPath,"ready");
 notify("rename",filename);
 await Promise.resolve();
 expect(ready).toBe(true);
 expect(watcher.close).toHaveBeenCalledTimes(1);
});

it("keeps a different named notification pending even when the marker exists",async()=>{
 marker=fixtureMarker(markerPath);
 let ready=false;
 void marker.ready.then(()=>{ready=true;});
 writeFileSync(markerPath,"ready");
 notify("change","different");
 await Promise.resolve();
 expect(ready).toBe(false);
 expect(watcher.close).not.toHaveBeenCalled();
 notify("change","ready");
 await Promise.resolve();
 expect(ready).toBe(true);
});

it("accepts a marker that already exists without a notification",async()=>{
 writeFileSync(markerPath,"ready");
 marker=fixtureMarker(markerPath);
 await expect(marker.ready).resolves.toBeUndefined();
 expect(watcher.close).toHaveBeenCalledTimes(1);
});

it("rejects the original watcher error and closes the watcher",async()=>{
 marker=fixtureMarker(markerPath);
 const error=new Error("controlled watcher error");
 const rejected=expect(marker.ready).rejects.toBe(error);
 watcher.emit("error",error);
 await rejected;
 expect(watcher.close).toHaveBeenCalledTimes(1);
});

it("explicitly closes without manufacturing marker readiness",async()=>{
 marker=fixtureMarker(markerPath);
 let ready=false;
 void marker.ready.then(()=>{ready=true;});
 marker.close();
 await Promise.resolve();
 expect(ready).toBe(false);
 expect(watcher.close).toHaveBeenCalledTimes(1);
});

it("retains producer rejection while an absent unnamed marker remains pending",async()=>{
 marker=fixtureMarker(markerPath);
 notify("change",null);
 const error=new Error("controlled producer rejection");
 await expect(awaitFixtureReady(marker.ready,Promise.reject(error))).rejects.toBe(error);
 expect(watcher.close).not.toHaveBeenCalled();
});

it("retains a wrapped producer failure and reports exit before readiness",async()=>{
 marker=fixtureMarker(markerPath);
 const error=new Error("controlled wrapped producer failure"),outcome=fixtureOutcome(Promise.reject(error));
 await expect(awaitFixtureReady(marker.ready,outcome)).rejects.toThrow("Native fixture exited before readiness");
 expect(await outcome).toEqual({error});
 expect(watcher.close).not.toHaveBeenCalled();
});
