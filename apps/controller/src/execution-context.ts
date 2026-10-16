import {statSync} from "node:fs";
import {isAbsolute,join} from "node:path";
import {homedir} from "node:os";
import {ConfigPlanError,repositoryRunnerId,type DispatcherConfig} from "@dispatcher/config";
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
  const settings=profile.settings??{},paths=runner.mode==="embedded"?[
    typeof settings.executable==="string"&&isAbsolute(settings.executable)?settings.executable:undefined,
    ...(typeof settings.codexHome==="string"?[join(settings.codexHome,"auth.json"),join(settings.codexHome,"config.toml")]:[]),
    ...(typeof settings.configDir==="string"?[join(settings.configDir,"settings.json")]:[]),
    ...(profile.provider==="cursor"?[join(homedir(),".cursor","cli-config.json")]:[]),
  ].filter((path):path is string=>typeof path==="string"):[];
  const nativeEpoch=paths.map(path=>{try{const s=statSync(path);return {path,size:s.size,mtime:s.mtimeMs,ino:s.ino};}catch{return {path,unavailable:true};}});
  return {profileId,runnerId:runner.id,providerId:profile.provider,configRevision:snapshot.revision,fingerprint:contentHash({profile,runner:{id:runner.id,mode:runner.mode,credentialRef:runner.credentialRef},repository,nativeEpoch}),profile:structuredClone(profile),runner:structuredClone(runner),...(repository?{repository:structuredClone(repository),repositoryId:repository.id}:{}),purpose};
}
