import {isDeepStrictEqual} from "node:util";
import type {NativeModelInvocation,Run} from "@dispatcher/domain";
import type {AdapterSession} from "@dispatcher/adapters";
import type {RhizaModelEvidenceV1,RhizaWorkOrderV1} from "@dispatcher/protocol";
import {containsSecretLike} from "@dispatcher/observability";
import {RhizaIngressError} from "./rhiza-auth.js";
import {rhizaDigest} from "./rhiza-semantics.js";

/** Internal producer contract, never a wire request or a UI/history projection.
 * No production adapter currently qualifies executed-model metadata. A future
 * producer must prove model semantics AND this exact native invocation binding.
 */
export interface QualifiedModelReport {
 version:1;qualification:{level:"runtime-verified";semantics:"executed-model";reference:string;adapterVersion:string;cliVersion:string};
 invocationId:string;sessionId:string;nativeSessionId:string;runId:string;generation:number;attempt:number;leaseId:string;contextFingerprint:string;
 observationId:string;observerEpoch:string;observerGeneration:number;sequence:number;observedAt:string;
 model:{id:string;options:Record<string,string|number|boolean>};
}
interface Input {order:RhizaWorkOrderV1;targetHash:string;run:Run;session?:AdapterSession|undefined;invocation?:NativeModelInvocation|undefined;native?:QualifiedModelReport|undefined;now:Date}
const safe=(value:unknown):value is string=>typeof value==="string"&&value.length>0&&value.length<=512&&!Array.from(value).some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127)&&!containsSecretLike(value);
const positive=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>0;
const time=(value:string)=>Date.parse(value);
const sameSelection=(a:NativeModelInvocation["executionSelection"],b:Run["executionSelection"])=>{if(!a||!b)return false;const left={...a},right={...b};delete left.routingDecision;delete right.routingDecision;return isDeepStrictEqual(left,right);};

/** Pure projection from owning facts. Requested/resolved are never proof by themselves. */
export function projectRhizaModelEvidence(input:Input):{evidence:RhizaModelEvidenceV1;candidateAllowed:boolean} {
 const {order,targetHash,run,session,invocation,native,now}=input,target=order.target,selection=run.executionSelection;
 if(rhizaDigest(target)!==targetHash)throw new RhizaIngressError("TARGET_CHANGED",409,"Frozen target digest changed");
 if(!selection||selection.selectionType!=="explicit-model"||!selection.requestedModel)throw new RhizaIngressError("MODEL_EVIDENCE_REQUIRED",409,"No explicit resolved Run model is available");
 const requested={modelId:target.modelId,modelOptions:structuredClone(target.modelOptions)},resolved={modelId:selection.requestedModel,modelOptions:structuredClone(selection.nativeParameters)};
 const evidence:RhizaModelEvidenceV1={status:"unverified",source:"unavailable",requested,resolved,reported:null,binding:{...structuredClone(order.origin),runId:run.id,runGeneration:run.generation,sessionId:run.sessionId??null,targetHash},observedAt:now.toISOString(),adapterVersion:target.adapterVersion,cliVersion:target.cliVersion};
 const execution={generation:run.generation,attempt:run.attempt,leaseId:run.leaseId};
 const targetMatches=run.profileId===target.profileId&&run.providerId===target.harnessId&&run.runnerId===target.runnerId&&selection.profileId===target.profileId&&selection.providerId===target.harnessId&&selection.backendId===target.backendId&&selection.runnerId===target.runnerId&&selection.contextFingerprint===target.contextFingerprint&&isDeepStrictEqual(requested,resolved);
 const current=targetMatches&&session&&session.id===run.sessionId&&session.runId===run.id&&session.profileId===run.profileId&&session.backendId===target.backendId&&sameSelection(session.executionSelection,selection)&&isDeepStrictEqual(session.execution,execution)&&session.turnId===session.modelInvocationId&&(run.providerSessionId===undefined||session.providerSessionId===run.providerSessionId);
 const invoked=current&&invocation?.version===1&&invocation.id===session.modelInvocationId&&invocation.sessionId===session.id&&invocation.runId===run.id&&invocation.profileId===run.profileId&&invocation.backendId===target.backendId&&sameSelection(invocation.executionSelection,selection)&&isDeepStrictEqual(invocation.execution,execution)&&Number.isFinite(time(invocation.invokedAt))&&time(invocation.invokedAt)<=now.getTime()&&(!invocation.nativeSessionId||invocation.nativeSessionId===session.providerSessionId);
 if(!targetMatches)evidence.status="mismatch";
 else if(invoked){
  evidence.source="invocation-record";evidence.observedAt=invocation.invokedAt;
  evidence.status=isDeepStrictEqual(invocation.model,{id:resolved.modelId,options:resolved.modelOptions})?"configuration_confirmed":"mismatch";
 }
 const qualified=invoked&&native?.version===1&&native.qualification?.level==="runtime-verified"&&native.qualification.semantics==="executed-model"&&safe(native.qualification.reference)&&native.qualification.adapterVersion===target.adapterVersion&&native.qualification.cliVersion===target.cliVersion&&native.invocationId===invocation.id&&native.sessionId===run.sessionId&&native.nativeSessionId===session.providerSessionId&&native.nativeSessionId===run.providerSessionId&&safe(native.nativeSessionId)&&native.runId===run.id&&native.generation===run.generation&&native.attempt===run.attempt&&native.leaseId===run.leaseId&&native.contextFingerprint===target.contextFingerprint&&safe(native.observationId)&&safe(native.observerEpoch)&&positive(native.observerGeneration)&&positive(native.sequence)&&Number.isFinite(time(native.observedAt))&&time(native.observedAt)>=time(invocation.invokedAt)&&time(native.observedAt)<=now.getTime()&&native.model&&safe(native.model.id)&&native.model.options&&typeof native.model.options==="object"&&!Array.isArray(native.model.options);
 if(qualified&&evidence.status!=="mismatch"){
  const keys=Object.keys(resolved.modelOptions),missing=keys.some(key=>!Object.hasOwn(native.model.options,key));
  const mismatch=native.model.id!==resolved.modelId||keys.some(key=>Object.hasOwn(native.model.options,key)&&native.model.options[key]!==resolved.modelOptions[key]);
  if(mismatch||!missing){evidence.source="native-session-metadata";evidence.reported={modelId:native.model.id};evidence.observedAt=native.observedAt;evidence.status=mismatch?"mismatch":"verified";}
 }
 return {evidence,candidateAllowed:session?.state==="COMPLETED"&&safe(run.providerSessionId)&&session.providerSessionId===run.providerSessionId&&(evidence.status==="verified"||evidence.status==="configuration_confirmed"&&order.evidencePolicy.minimum==="configuration_confirmed")};
}
