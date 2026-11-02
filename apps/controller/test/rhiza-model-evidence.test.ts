import {expect,it} from "vitest";
import type {ExecutionSelection,NativeModelInvocation,Run} from "@dispatcher/domain";
import type {RhizaWorkOrderV1} from "@dispatcher/protocol";
import type {AdapterSession} from "@dispatcher/adapters";
import {workOrder} from "../../../packages/protocol/test/fixtures/rhiza-v1.js";
import {projectRhizaModelEvidence,type QualifiedModelReport} from "../src/rhiza-model-evidence.js";
import {rhizaDigest} from "../src/rhiza-semantics.js";
function fixture(){
 const order=structuredClone(workOrder) as RhizaWorkOrderV1,target=order.target,now=new Date("2026-10-23T10:00:00.000Z");
 const selection:ExecutionSelection={version:1,mode:"manual",source:"explicit",selectionType:"explicit-model",requestedModel:target.modelId,nativeParameters:{...target.modelOptions},profileId:target.profileId,providerId:target.harnessId,backendId:target.backendId,runnerId:target.runnerId,contextFingerprint:target.contextFingerprint,catalogRevision:"private-native-revision",configRevision:1,selectedAt:now.toISOString()};
 const run={id:"run-a",taskId:"task-a",profileId:target.profileId,providerId:target.harnessId,runnerId:target.runnerId,sessionId:"session-a",providerSessionId:"native-a",generation:2,attempt:1,leaseId:"lease-a",executionSelection:selection} as Run;
 const session={id:run.sessionId,runId:run.id,state:"COMPLETED",profileId:run.profileId,backendId:target.backendId,providerSessionId:run.providerSessionId,executionSelection:selection,execution:{generation:run.generation,attempt:run.attempt,leaseId:run.leaseId},turnId:"turn-a",modelInvocationId:"turn-a"} as AdapterSession;
 const invocation:NativeModelInvocation={version:1,id:"turn-a",sessionId:session.id,runId:run.id,profileId:run.profileId,backendId:session.backendId,kind:"start",invokedAt:new Date(now.getTime()-1000).toISOString(),execution:session.execution,executionSelection:selection,model:{id:target.modelId,options:{...target.modelOptions}}};
 const native:QualifiedModelReport={version:1,qualification:{level:"runtime-verified",semantics:"executed-model",reference:"synthetic-model-qualification-only",adapterVersion:target.adapterVersion,cliVersion:target.cliVersion},invocationId:invocation.id,sessionId:session.id,nativeSessionId:run.providerSessionId!,runId:run.id,generation:run.generation,attempt:run.attempt,leaseId:run.leaseId,contextFingerprint:target.contextFingerprint,observationId:"observation-a",observerEpoch:"epoch-a",observerGeneration:1,sequence:1,observedAt:now.toISOString(),model:{id:target.modelId,options:{...target.modelOptions}}};
 return {order,targetHash:rhizaDigest(target),run,session,invocation,native,now};
}
it("separates request/resolution from actual invocation and never promotes echoes or historical display fields",()=>{
 const f=fixture();expect(projectRhizaModelEvidence({...f,invocation:undefined,native:undefined})).toMatchObject({evidence:{status:"unverified",source:"unavailable",reported:null},candidateAllowed:false});
 const configuration=projectRhizaModelEvidence({...f,native:undefined});expect(configuration).toMatchObject({evidence:{status:"configuration_confirmed",source:"invocation-record",reported:null},candidateAllowed:false});
 f.order.evidencePolicy.minimum="configuration_confirmed";expect(projectRhizaModelEvidence({...f,native:undefined}).candidateAllowed).toBe(true);
 const echo={...f.native,qualification:{...f.native.qualification,level:"request-echo"}} as unknown as QualifiedModelReport;
 expect(projectRhizaModelEvidence({...f,native:echo}).evidence).toMatchObject({status:"configuration_confirmed",reported:null});
});
it("binds a qualified synthetic native report to both products without treating a fixture as native qualification",()=>{
 const f=fixture(),result=projectRhizaModelEvidence(f);expect(result).toMatchObject({candidateAllowed:true,evidence:{status:"verified",source:"native-session-metadata",requested:{modelId:f.order.target.modelId},resolved:{modelId:f.run.executionSelection?.requestedModel},reported:{modelId:f.native.model.id},binding:{...f.order.origin,runId:f.run.id,runGeneration:f.run.generation,sessionId:f.session.id,targetHash:f.targetHash},adapterVersion:f.order.target.adapterVersion,cliVersion:f.order.target.cliVersion}});
});
it.each(["invocationId","sessionId","nativeSessionId","runId","generation","attempt","leaseId","contextFingerprint","observerEpoch","observationId","sequence","observerGeneration"] as const)("ignores an unbound or invalid native %s",key=>{
 const f=fixture();(f.native as unknown as Record<string,unknown>)[key]=typeof f.native[key]==="number"?0:"";
 expect(projectRhizaModelEvidence(f)).toMatchObject({evidence:{status:"configuration_confirmed",reported:null},candidateAllowed:false});
});
it.each(["old","future","cli","adapter","missing-option"])("does not verify %s native metadata",reason=>{
 const f=fixture();if(reason==="old")f.native.observedAt=new Date(Date.parse(f.invocation.invokedAt)-1).toISOString();if(reason==="future")f.native.observedAt=new Date(f.now.getTime()+1).toISOString();if(reason==="cli")f.native.qualification.cliVersion="different";if(reason==="adapter")f.native.qualification.adapterVersion="different";if(reason==="missing-option")f.native.model.options={};
 expect(projectRhizaModelEvidence(f)).toMatchObject({evidence:{status:"configuration_confirmed"},candidateAllowed:false});
});
it.each(["invocation-model","invocation-option","reported-model","reported-option","resolved-model"])("blocks %s mismatch even for an explicitly lower policy",reason=>{
 const f=fixture();f.order.evidencePolicy.minimum="configuration_confirmed";
 if(reason==="invocation-model")f.invocation.model.id="different";if(reason==="invocation-option")f.invocation.model.options={reasoningEffort:"different"};if(reason==="reported-model")f.native.model.id="different";if(reason==="reported-option")f.native.model.options=Object.fromEntries(Object.keys(f.order.target.modelOptions).map(key=>[key,"different"]));if(reason==="resolved-model")f.run.executionSelection={...f.run.executionSelection!,requestedModel:"different"};
 expect(projectRhizaModelEvidence(f)).toMatchObject({evidence:{status:"mismatch"},candidateAllowed:false});
});
it.each(["id","runId","sessionId","profileId","backendId","execution","executionSelection"] as const)("rejects unrelated stored invocation %s",key=>{
 const f=fixture();(f.invocation as unknown as Record<string,unknown>)[key]=typeof f.invocation[key]==="object"?{}:"other";
 expect(projectRhizaModelEvidence(f)).toMatchObject({evidence:{status:"unverified",reported:null},candidateAllowed:false});
});
it("rejects another target digest and a prior invocation after input changed the current turn",()=>{
 const f=fixture();expect(()=>projectRhizaModelEvidence({...f,targetHash:"f".repeat(64)})).toThrowError(expect.objectContaining({code:"TARGET_CHANGED"}));
 f.session.turnId="next-turn";expect(projectRhizaModelEvidence(f)).toMatchObject({evidence:{status:"unverified",reported:null},candidateAllowed:false});
});
it.each(["STARTING","RUNNING","PAUSED","FAILED","CANCELLED"] as const)("does not publish a model-qualified candidate while the latest native invocation is %s",state=>{
 const f=fixture();f.session.state=state;expect(projectRhizaModelEvidence(f)).toMatchObject({evidence:{status:"verified"},candidateAllowed:false});
});
it.each(["replaced","missing"])("rejects %s native identity after the Run learned its original session",reason=>{
 const f=fixture();f.order.evidencePolicy.minimum="configuration_confirmed";
 if(reason==="replaced")f.session.providerSessionId="foreign-session";else delete f.session.providerSessionId;
 expect(projectRhizaModelEvidence({...f,native:undefined})).toMatchObject({evidence:{status:"unverified",reported:null},candidateAllowed:false});
});
it("retains first-learned invocation configuration without qualifying a candidate before canonical identity adoption",()=>{
 const f=fixture();delete f.run.providerSessionId;f.order.evidencePolicy.minimum="configuration_confirmed";
 expect(projectRhizaModelEvidence({...f,native:undefined})).toMatchObject({evidence:{status:"configuration_confirmed"},candidateAllowed:false});
});
