import {existsSync,watch} from "node:fs";
import {basename,dirname} from "node:path";

/** Observe fixture readiness before testing cancellation; startup latency is not the assertion. */
export function fixtureMarker(path:string):{ready:Promise<void>;close:()=>void}{
  const signal=Promise.withResolvers<void>();
  const watcher=watch(dirname(path),(_,name)=>{if(name?.toString()===basename(path)&&existsSync(path)){watcher.close();signal.resolve();}});
  watcher.once("error",error=>{watcher.close();signal.reject(error);});
  if(existsSync(path)){watcher.close();signal.resolve();}
  return {ready:signal.promise,close:()=>watcher.close()};
}
export function fixtureOutcome<T>(read:Promise<T>):Promise<{value:T}|{error:unknown}>{
  return read.then(value=>({value}),error=>({error}));
}
export async function awaitFixtureReady(ready:Promise<void>,outcome:Promise<unknown>):Promise<void>{
  await Promise.race([ready,outcome.then(()=>{throw new Error("Native fixture exited before readiness");})]);
}
