import {isDeepStrictEqual} from "node:util";
import type {RepositoryConfig} from "@dispatcher/config";
import type {VerificationCommand,VerificationResult} from "@dispatcher/runner";
import {contentHash} from "./task-publications.js";
export interface SnapshotPreparation {profileHash:string;commands:VerificationCommand[]}
export interface SnapshotPreparationEvidence extends SnapshotPreparation {checks:VerificationResult[]}
type Resolution={state:"available";preparation?:SnapshotPreparation;verification:VerificationCommand[]}|{state:"unavailable";code:"VERIFICATION_ENVIRONMENT_UNAVAILABLE"|"LOCAL_REVIEW_CONTEXT_CHANGED"|"VERIFICATION_NOT_REGISTERED"};
/** Frozen G2a selection semantics shared by the two lifecycle owners. */
export function resolveSnapshotVerification(input:{marker:unknown;currentRepository:RepositoryConfig;frozenCommands:VerificationCommand[];selectedIds:string[];requirePreparationProfile:boolean}):Resolution {
 const unavailable=(code:Extract<Resolution,{state:"unavailable"}>["code"]):Resolution=>({state:"unavailable",code});
 const {marker,currentRepository:repository,frozenCommands:frozen,selectedIds}=input;let profile:RepositoryConfig["snapshotVerification"]|null=null;
 if(marker!==undefined){
  if(!marker||typeof marker!=="object"||Object.keys(marker).sort().join(",")!=="profile,version"||(marker as {version?:unknown}).version!==1)return unavailable("VERIFICATION_ENVIRONMENT_UNAVAILABLE");
  const value=(marker as {profile:unknown}).profile;
  if(value!==null){
   if(!value||typeof value!=="object"||Object.keys(value).sort().join(",")!=="id,preparationCommandIds,version")return unavailable("VERIFICATION_ENVIRONMENT_UNAVAILABLE");
   profile=value as RepositoryConfig["snapshotVerification"];
   if(!profile||profile.version!==1||typeof profile.id!=="string"||!profile.id.length||Array.from(profile.id).length>100||!Array.isArray(profile.preparationCommandIds)||profile.preparationCommandIds.some(id=>typeof id!=="string"||!id.length)||new Set(profile.preparationCommandIds).size!==profile.preparationCommandIds.length)return unavailable("VERIFICATION_ENVIRONMENT_UNAVAILABLE");
  }
 }
 if((input.requirePreparationProfile||repository.snapshotVerification)&&!profile)return unavailable("VERIFICATION_ENVIRONMENT_UNAVAILABLE");
 if(!isDeepStrictEqual(profile,repository.snapshotVerification??null))return unavailable("LOCAL_REVIEW_CONTEXT_CHANGED");
 const preparationCommands=profile?.preparationCommandIds.map(id=>frozen.find(command=>command.id===id))??[];
 if(preparationCommands.some(command=>!command)||preparationCommands.some(command=>!isDeepStrictEqual(command,repository.verificationCommands.find(current=>current.id===command!.id))))return unavailable("LOCAL_REVIEW_CONTEXT_CHANGED");
 const selected=selectedIds.map(id=>frozen.find(c=>c.id===id)),preparationIds=new Set(profile?.preparationCommandIds),commands=selected.filter(command=>command&&!preparationIds.has(command.id));
 if(selected.some(c=>!c)||frozen.some(c=>c.required&&!selectedIds.includes(c.id))||!commands.some(c=>c?.required))return unavailable("VERIFICATION_NOT_REGISTERED");
 return {state:"available",verification:structuredClone(commands as VerificationCommand[]),...(profile?{preparation:{profileHash:contentHash(profile),commands:structuredClone(preparationCommands as VerificationCommand[])}}:{})};
}
export function preparationEvidenceQualifies(input:{preparation:SnapshotPreparation|undefined;evidence:SnapshotPreparationEvidence|undefined;checks:VerificationResult[]|undefined;commandIds:string[]|undefined;verification:VerificationCommand[]}):boolean {
 if(!input.preparation)return true;
 const {evidence,checks,commandIds,verification}=input,{commands,profileHash}=input.preparation;
 if(!evidence||evidence.profileHash!==profileHash||!isDeepStrictEqual(evidence.commands,commands)||!Array.isArray(evidence.checks)||evidence.checks.length!==commands.length||!Array.isArray(checks))return false;
 const ordered=evidence.checks.every((check,index)=>check&&check.commandId===commands[index]!.id&&check.required===commands[index]!.required&&check.status==="passed"&&check.exitCode===0);
 return ordered&&isDeepStrictEqual(checks.slice(0,commands.length),evidence.checks)&&isDeepStrictEqual(commandIds,[...commands,...verification].map(command=>command.id));
}
