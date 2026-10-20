import type { DispatcherConfig } from "@dispatcher/config";
import { isNativeModelDefaultReview, type AccountModelCatalog, type NativeModelDefaultReviewV1 } from "@dispatcher/domain";
import { contentHash, PublicationError } from "./task-publications.js";

export interface NativeModelDefaultEvidence {
  format:"v3-model-default-plan-v1";actorId:string;configRevision:number;
  scopeRef:string;review:NativeModelDefaultReviewV1;
}
export function parseNativeModelDefaultReview(value:unknown):NativeModelDefaultReviewV1 {
  if(!isNativeModelDefaultReview(value))throw new PublicationError("MODEL_DEFAULT_REVIEW_INVALID",400,"Provide the exact native model review context");
  return structuredClone(value);
}
export function readNativeModelDefaultEvidence(value:unknown):NativeModelDefaultEvidence|undefined {
  if(!value||typeof value!=="object"||Array.isArray(value))return;
  const record=value as NativeModelDefaultEvidence;
  if(record.format!=="v3-model-default-plan-v1"||typeof record.actorId!=="string"||!record.actorId||!Number.isSafeInteger(record.configRevision)||record.configRevision<0||typeof record.scopeRef!=="string"||!record.scopeRef||!isNativeModelDefaultReview(record.review))return;
  return record;
}

export async function qualifyNativeModelDefault(current:DispatcherConfig,next:DispatcherConfig,review:NativeModelDefaultReviewV1,readCatalog:(profileId:string,repositoryId:string)=>Promise<AccountModelCatalog>):Promise<void> {
  const profile=current.agentProfiles.find(value=>value.id===review.profileId),target=next.agentProfiles.find(value=>value.id===review.profileId);
  const repository=current.repositories.find(value=>value.id===review.repositoryId),nextRepository=next.repositories.find(value=>value.id===review.repositoryId);
  const withoutDefault=(value:NonNullable<typeof profile>)=>{const {settings,...identity}=value;const remaining={...settings};delete remaining.model;return {...identity,settings:remaining};};
  if(!profile||!target||!repository||!nextRepository||target.settings?.model!==review.modelId||contentHash(withoutDefault(profile))!==contentHash(withoutDefault(target))||contentHash(repository)!==contentHash(nextRepository))throw new PublicationError("MODEL_DEFAULT_CONTEXT_CHANGED",409,"Apply other account or repository changes before reviewing its default model");
  const catalog=await readCatalog(review.profileId,review.repositoryId),entry=catalog.entries.find(value=>value.id===review.modelId);
  if(catalog.profileId!==profile.id||catalog.runnerId!==profile.runnerId||catalog.providerId!==profile.provider||catalog.failure||catalog.freshness!=="native-fresh"||catalog.selectionSupport!=="explicit"||catalog.revision!==review.catalogRevision||catalog.contextFingerprint!==review.contextFingerprint||!entry?.selectable||entry.access==="denied"||entry.access==="unconfirmed"&&!review.allowUnconfirmedModelAccess)throw new PublicationError("MODEL_DEFAULT_PLAN_STALE",409,"Native model evidence changed; refresh and review a new default-model plan");
}
