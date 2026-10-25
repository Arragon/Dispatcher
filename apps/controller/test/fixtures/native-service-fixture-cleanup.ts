import { expect } from "vitest";
import type { ControllerService } from "../../src/service.js";
const retainedStopFailures=new WeakMap<ControllerService,unknown>();
/** Assertion must succeed before this specific rejected stop can retain test storage. */
export async function expectRetainedStop(service:ControllerService,expected:object):Promise<unknown> {
  const failure=await service.stop().then(()=>{throw Error("Expected fixture shutdown to reject");},error=>error);
  expect(failure).toMatchObject(expected);
  retainedStopFailures.set(service,failure);
  return failure;
}
export async function stopFixtureStorage(service:ControllerService):Promise<boolean>{
 try{await service.stop();return false;}catch(error){
  if(!retainedStopFailures.has(service)||retainedStopFailures.get(service)!==error)throw error;
  await Promise.allSettled([...service["nativeCatalogReads"]]);
  if(service["allNativeRuntimes"]().some(({runtime})=>"hasActiveOperations" in runtime&&runtime.hasActiveOperations()))throw Error("Release and drain retained fixture native operations before storage cleanup",{cause:error});
  return true;
 }
}
export function clearRetainedStop(service:ControllerService):void{retainedStopFailures.delete(service);}
