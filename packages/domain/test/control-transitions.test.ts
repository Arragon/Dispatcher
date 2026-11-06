import { expect, it } from "vitest";
import { canMutate, transitionControl, type SessionControl } from "../src/index.js";
const control:SessionControl={version:1,sessionId:"session",activeRunId:"run",state:"AUTOMATED",epoch:1,revision:1,exclusion:"cooperative",updatedAt:"2026-10-07T13:00:00Z"};
const at="2026-10-07T13:01:00Z";
const run={id:"run",sessionId:"session",state:"ACTIVE" as const};
const observation={version:1 as const,id:"obs",nativeSessionId:"native",scopeFingerprint:"scope",observedAt:at,state:"idle" as const,pendingTools:"none" as const,pendingApprovals:"none" as const,historyMode:"snapshot-only" as const};
const release={version:1 as const,nativeSessionId:"native",quiescent:true,pendingCommands:"none" as const,lockReleased:"unsupported" as const,exclusion:"cooperative" as const,observation};
it("allows one handoff revision and requires reconciliation before returning authority",()=>{
  const requested=transitionControl(control,{type:"request-handoff",principalId:"owner",at},1);
  expect(requested).toMatchObject({state:"HANDOFF_REQUESTED",epoch:2,revision:2});
  expect(()=>transitionControl(requested,{type:"request-handoff",principalId:"owner",at},1)).toThrowError(expect.objectContaining({code:"STALE_CONTROL_REVISION"}));
  const human=transitionControl(requested,{type:"release-verified",evidence:release,at},2);
  expect(human.state).toBe("HUMAN");
  expect(()=>transitionControl(human,{type:"reconcile-verified",runTerminal:false,observationRef:"obs",at},human.revision)).toThrowError(expect.objectContaining({code:"INVALID_CONTROL_TRANSITION"}));
  const checking=transitionControl(human,{type:"request-return",at},human.revision);
  const automated=transitionControl(checking,{type:"reconcile-verified",runTerminal:false,observationRef:"obs",at},checking.revision);
  expect(automated).toMatchObject({state:"AUTOMATED",epoch:5,revision:5});
  expect(automated.handoffPrincipalId).toBeUndefined();expect(control.state).toBe("AUTOMATED");
});
it("rejects uncertain release, never resumes a terminal Run, and never reclaims on timeout",()=>{
  const requested=transitionControl(control,{type:"request-handoff",principalId:"owner",at},1);
  expect(()=>transitionControl(requested,{type:"release-verified",evidence:{...release,observation:{...observation,pendingTools:"unknown"}},at},2)).toThrowError(expect.objectContaining({code:"HANDOFF_NOT_QUIESCENT"}));
  const checking=transitionControl(requested,{type:"cancel-handoff",at},2);expect(checking.state).toBe("RECONCILING");
  expect(()=>transitionControl(checking,{type:"reconcile-verified",runTerminal:true,observationRef:"obs",at},checking.revision)).toThrowError(expect.objectContaining({code:"TERMINAL_RUN"}));
  const human={...control,state:"HUMAN" as const};expect(transitionControl(human,{type:"attention-timeout",at},1)).toEqual(human);
});
it("requires a known release outcome and confirmed native exclusion when advertised",()=>{
  const requested=transitionControl(control,{type:"request-handoff",principalId:"owner",at},1);
  for(const exclusion of ["cooperative","native-enforced"] as const){
    const current={...requested,exclusion};
    expect(()=>transitionControl(current,{type:"release-verified",evidence:{...release,exclusion,lockReleased:"unknown"},at},2)).toThrowError(expect.objectContaining({code:"HANDOFF_NOT_QUIESCENT"}));
  }
  const current={...requested,exclusion:"native-enforced" as const};
  expect(()=>transitionControl(current,{type:"release-verified",evidence:{...release,exclusion:"native-enforced"},at},2)).toThrowError(expect.objectContaining({code:"HANDOFF_NOT_QUIESCENT"}));
  expect(transitionControl(current,{type:"release-verified",evidence:{...release,exclusion:"native-enforced",lockReleased:"confirmed"},at},2).state).toBe("HUMAN");
});
it("keeps history readable while every non-automated state fences writes and delivery",()=>{
  for(const state of ["AUTOMATED","HANDOFF_REQUESTED","HUMAN","RECONCILING","CONFLICT"] as const){
    const snapshot={control:{...control,state},run,nativeState:"idle" as const};
    expect(canMutate(snapshot,"history")).toEqual({allowed:true});
    expect(canMutate(snapshot,"continue").allowed).toBe(state==="AUTOMATED");
    expect(canMutate({...snapshot,run:{...run,state:"DELIVERING"}},"deliver").allowed).toBe(state==="AUTOMATED");
    expect(canMutate({...snapshot,run:{...run,state:"COMPLETE"}},"continue")).toEqual({allowed:false,code:"TERMINAL_RUN"});
  }
  expect(canMutate({control,run,nativeState:"running"},"continue")).toEqual({allowed:false,code:"SESSION_BUSY"});
  expect(canMutate({control,run,nativeState:"unknown"},"deliver")).toEqual({allowed:false,code:"NATIVE_STATE_UNKNOWN"});
  expect(canMutate({control:{...control,state:"HUMAN"},run,nativeState:"running"},"cancel")).toEqual({allowed:false,code:"HUMAN_CANCEL_CONFIRMATION_REQUIRED"});
});
