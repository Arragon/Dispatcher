import { expect, it } from "vitest";
import { assertSessionOwner, nativeBindingKey, normalizeNativeBinding, type NativeBinding } from "../src/index.js";
const binding:NativeBinding={version:1,product:"codex",region:"global",profileId:"p",backendId:"exec",runnerId:"local",nativeStoreRef:"store",nativeSessionId:"native",identityState:"bound",executionRefId:"execution"};
const session={id:"session",profileId:"p",nativeSessionId:"native",nativeBinding:binding};
const adapter={id:"session",runId:"run",profileId:"p",backendId:"exec",providerSessionId:"native",nativeBinding:binding};
const run={id:"run",profileId:"p",runnerId:"local",sessionId:"session",providerSessionId:"native"};
it("projects one canonical identity and rejects cross-profile or changed native projections",()=>{
  expect(normalizeNativeBinding(session,adapter,run)).toEqual({state:"bound",binding});
  expect(normalizeNativeBinding(session,{...adapter,profileId:"other"},run)).toMatchObject({state:"conflict",code:"SESSION_OWNER_MISMATCH"});
  expect(normalizeNativeBinding(session,{...adapter,nativeBinding:{...binding,profileId:"other"}},run)).toMatchObject({state:"conflict",code:"SESSION_OWNER_MISMATCH"});
  expect(normalizeNativeBinding(session,adapter,{...run,providerSessionId:"changed"})).toMatchObject({state:"conflict",code:"NATIVE_IDENTITY_CHANGED"});
  expect(()=>assertSessionOwner(binding,"other")).toThrowError(expect.objectContaining({code:"SESSION_OWNER_MISMATCH"}));
});
it("uses native storage identity rather than aliases or process IDs for uniqueness",()=>{
  expect(nativeBindingKey(binding)).toBe(nativeBindingKey({...binding,profileId:"alias",runnerId:"another"}));
  expect(nativeBindingKey(binding)).not.toBe(nativeBindingKey({...binding,nativeStoreRef:"different"}));
});
it.each(["backendId","runnerId","executionRefId","parentSessionId","version"] as const)("rejects conflicting adapter binding %s while preserving lifecycle observations",field=>{
  const changed={...binding,[field]:field==="version"?2:"changed"} as NativeBinding;
  expect(normalizeNativeBinding(session,{...adapter,nativeBinding:changed},run)).toMatchObject({state:"conflict",code:"NATIVE_IDENTITY_CHANGED"});
});
it("does not invent native ownership for legacy or unstarted sessions",()=>{
  expect(normalizeNativeBinding({id:"unstarted:run",profileId:"p"},adapter,run)).toMatchObject({state:"unbound"});
  expect(normalizeNativeBinding({...session,nativeBinding:undefined},{...adapter,nativeBinding:undefined},run)).toMatchObject({state:"missing"});
  expect(normalizeNativeBinding({...session,nativeBinding:{...binding,identityState:"deleted"}},adapter,run)).toMatchObject({state:"deleted"});
});
