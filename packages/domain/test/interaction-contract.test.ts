import { expect, it } from "vitest";
import { RUN_STATES, assessInteractionCapability, type CapabilityEvidence } from "../src/index.js";
const evidence:CapabilityEvidence={version:1,support:"supported",level:"runtime-verified",scopeFingerprint:"scope",verifiedAt:"2026-10-07T13:00:00Z",evidenceRef:"evidence/real",reasonCode:"VERIFIED"};
it("requires scoped runtime evidence and keeps unknown distinct from unsupported",()=>{
  expect(assessInteractionCapability(evidence,"scope","runtime-verified")).toEqual({supported:true});
  expect(assessInteractionCapability(evidence,"changed","runtime-verified")).toMatchObject({supported:false,code:"NATIVE_CAPABILITY_UNVERIFIED"});
  expect(assessInteractionCapability({...evidence,level:"documented"},"scope","runtime-verified").supported).toBe(false);
  expect(assessInteractionCapability({...evidence,verifiedAt:undefined},"scope","runtime-verified").supported).toBe(false);
  expect(assessInteractionCapability({...evidence,support:"unknown"},"scope","runtime-verified").code).toBe("NATIVE_CAPABILITY_UNVERIFIED");
  expect(assessInteractionCapability({...evidence,support:"unsupported"},"scope","runtime-verified").code).toBe("NATIVE_CAPABILITY_UNSUPPORTED");
});
it("preserves all legacy Run states while session control stays orthogonal",()=>{
  expect(RUN_STATES).toEqual(["CREATED","STARTING","ACTIVE","WAITING_USER","RESOURCE_BLOCKED","RUNNER_UNAVAILABLE","SUSPECTED_STALL","VERIFYING","DELIVERING","COMPLETE","FAILED","CANCELLED","SUPERSEDED"]);
});
