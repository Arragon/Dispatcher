import { expect, it } from "vitest";
import type { InteractionCapabilities } from "@dispatcher/domain";
import { getInteractionPort, requireInteractionCapability, type NativeInteractionPort } from "../src/interaction-contracts.js";
import { genericMockManifest } from "../src/generic.js";
import { assessInteractionRequirement } from "../src/compatibility.js";
const unknown={version:1 as const,support:"unknown" as const,level:"installed-probed" as const,scopeFingerprint:"scope",reasonCode:"NOT_VERIFIED"};
const capabilities:InteractionCapabilities={version:1,durableIdentity:unknown,historyRead:unknown,sameSessionContinue:unknown,liveSteer:unknown,interruptTurn:unknown,nativeApproval:unknown,observeExternalChanges:unknown,releaseControl:unknown,reclaimControl:unknown,restartReattach:unknown,surfaces:{tui:unknown}};
it("keeps legacy adapters compatible without inferring steer from send",()=>{
  expect(getInteractionPort({manifest:genericMockManifest})).toBeUndefined();
  const port={capabilities:()=>capabilities};expect(getInteractionPort({manifest:genericMockManifest,interaction:port})).toBe(port);
  expect(()=>requireInteractionCapability(port,"liveSteer","scope")).toThrowError(expect.objectContaining({code:"NATIVE_CAPABILITY_UNVERIFIED"}));
});
it("rejects a supported capability without its actual port method",()=>{
  const supported={...unknown,support:"supported" as const,level:"runtime-verified" as const,verifiedAt:"2026-10-07T13:00:00Z",evidenceRef:"real"};
  for(const capability of ["durableIdentity","historyRead","sameSessionContinue","liveSteer","interruptTurn","nativeApproval","observeExternalChanges","releaseControl","reclaimControl","restartReattach"] as const){
    const port:NativeInteractionPort={capabilities:()=>({...capabilities,[capability]:supported})};
    expect(()=>getInteractionPort({manifest:genericMockManifest,interaction:port})).toThrowError(expect.objectContaining({code:"INVALID_INTERACTION_CONTRACT"}));
  }
});
it("requires attachment for restart reattachment rather than read-only inspection",()=>{
  const supported={...unknown,support:"supported" as const,level:"runtime-verified" as const,verifiedAt:"2026-10-07T13:00:00Z",evidenceRef:"real"};
  const port:NativeInteractionPort={capabilities:()=>({...capabilities,restartReattach:supported}),inspect:async()=>{throw Error("read-only");}};
  expect(()=>getInteractionPort({manifest:genericMockManifest,interaction:port})).toThrowError(expect.objectContaining({code:"INVALID_INTERACTION_CONTRACT"}));
  expect(()=>requireInteractionCapability(port,"restartReattach","scope")).toThrowError(expect.objectContaining({code:"INVALID_INTERACTION_CONTRACT"}));
});
it("does not satisfy strict native GUI requirements with an unverified CLI backend",()=>{
  expect(assessInteractionRequirement({manifest:genericMockManifest},{version:1,profileId:"p",backendId:"mock-sdk",mode:"native-gui",surface:"desktop",executionLocation:"managed-worktree"},"scope")).toMatchObject({supported:false,code:"NATIVE_CAPABILITY_UNVERIFIED"});
});
