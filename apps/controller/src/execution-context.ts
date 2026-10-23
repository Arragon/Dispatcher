import {ConfigPlanError,repositoryRunnerId,nativeProfileEpoch,type DispatcherConfig} from "@dispatcher/config";
import {contentHash} from "./task-publications.js";
export type ExecutionPurpose="probe"|"catalog"|"start"|"resume";
/** Applied registration only. Private fields stay inside this server-side value. */
export function resolveProfileExecutionContext(snapshot:{revision:number;config:DispatcherConfig},profileId:string,repositoryId:string|undefined,purpose:ExecutionPurpose){
  const profile=snapshot.config.agentProfiles.find(profile=>profile.id===profileId);if(!profile)throw new ConfigPlanError("PROFILE_NOT_FOUND","Configured account is unavailable");
  const runner=snapshot.config.runners.find(runner=>runner.id===profile.runnerId);if(!runner)throw new ConfigPlanError("RUNNER_NOT_FOUND","Configured account has no owning Runner");
  const repository=repositoryId?snapshot.config.repositories.find(repository=>repository.id===repositoryId):undefined;
  if(repositoryId&&!repository)throw new ConfigPlanError("REPOSITORY_NOT_FOUND","Registered repository is unavailable");
  if(repository&&repositoryRunnerId(snapshot.config,repository)!==runner.id)throw new ConfigPlanError("RUNNER_REPOSITORY_MISMATCH","Account and repository belong to different Runners");
  if((purpose==="start"||purpose==="resume")&&profile.enabled===false)throw new ConfigPlanError("PROFILE_DISABLED","Account is disabled for dispatch");
  const nativeEpoch=runner.mode==="embedded"?nativeProfileEpoch(profile):[];
  return {profileId,runnerId:runner.id,providerId:profile.provider,configRevision:snapshot.revision,fingerprint:contentHash({profile,runner:{id:runner.id,mode:runner.mode,credentialRef:runner.credentialRef},repository,nativeEpoch}),profile:structuredClone(profile),runner:structuredClone(runner),...(repository?{repository:structuredClone(repository),repositoryId:repository.id}:{}),purpose};
}
