import type {EvidenceState,ProfileProbeEvidence} from "@dispatcher/domain";
import type {DispatcherDatabase,JsonValue} from "@dispatcher/persistence";
import {ConfigPlanError} from "@dispatcher/config";
import {containsSecretLike} from "@dispatcher/observability";
export interface ProfileProbeContext {profileId:string;runnerId:string;providerId:string;repositoryId?:string;configRevision:number;fingerprint:string}
const object=(v:unknown):v is Record<string,unknown>=>Boolean(v&&typeof v==="object"&&!Array.isArray(v));
export class ProfileProbeService {
  private readonly pending=new Map<string,Promise<ProfileProbeEvidence>>();
  constructor(private readonly database:DispatcherDatabase,private readonly now:()=>Date=()=>new Date()){}
  latest(profileId:string):ProfileProbeEvidence|undefined{return this.database.getEntity<JsonValue>("profile-probe",profileId) as unknown as ProfileProbeEvidence|undefined;}
  async drain():Promise<void>{await Promise.allSettled([...this.pending.values()]);}
  current(context:ProfileProbeContext):ProfileProbeEvidence|undefined {
    const stored=this.latest(context.profileId);if(!stored)return;
    const reason=stored.contextFingerprint!==context.fingerprint?"PROFILE_CONTEXT_CHANGED":this.now().getTime()-Date.parse(stored.observedAt)>5*60_000?"PROBE_EXPIRED":undefined;
    const result=structuredClone(stored);if(reason)for(const key of ["installation","compatibility","authentication"] as const)result[key]={...result[key],status:"stale",reasonCode:reason,message:"Repeat the native check for the current account context"};return result;
  }
  run(context:ProfileProbeContext,read:()=>Promise<unknown>,currentFingerprint:()=>string):Promise<ProfileProbeEvidence>{
    const key=JSON.stringify([context.profileId,context.fingerprint]),existing=this.pending.get(key);if(existing)return existing;
    const work=Promise.resolve().then(async()=>{
      let raw:unknown;try{raw=await read();}catch{raw={failure:{code:"NATIVE_PROBE_FAILED"}};}
      if(currentFingerprint()!==context.fingerprint)throw new ConfigPlanError("PROFILE_CONTEXT_CHANGED","Account context changed during the native check");
      const value=object(raw)?raw:{},selected=object(value.selected)?value.selected:value,observedAt=this.now().toISOString();
      const state=(status:EvidenceState["status"],reasonCode:string):EvidenceState=>({status,observedAt,source:"native-probe",contextFingerprint:context.fingerprint,reasonCode});
      const failure=object(value.failure)?value.failure:{},versionFailed=failure.stage==="version",capabilityFailed=failure.stage==="capability";
      const failureCode=typeof failure.code==="string"&&["TIMEOUT","OUTPUT_LIMIT","NOT_FOUND","PERMISSION_DENIED","INVALID_OUTPUT","EXECUTION_FAILED"].includes(failure.code)?failure.code:undefined;
      const installed=typeof selected.installed==="boolean"?selected.installed:typeof selected.version==="string"&&selected.version.length>0?true:undefined;
      const authentication=selected.authentication==="ready"&&selected.authenticated===true||selected.authenticated===true&&selected.authentication===undefined?"ready":selected.authentication==="missing"?"missing":"unknown";
      const record:ProfileProbeEvidence={version:1,profileId:context.profileId,runnerId:context.runnerId,providerId:context.providerId,configRevision:context.configRevision,contextFingerprint:context.fingerprint,observedAt,...(context.repositoryId?{repositoryId:context.repositoryId}:{}),
        installation:state(installed===true?"ready":failureCode==="NOT_FOUND"?"missing":installed===false?"failed":"unknown",versionFailed&&failureCode?`NATIVE_VERSION_${failureCode}`:installed===true?"NATIVE_EXECUTABLE_FOUND":"INSTALLATION_UNVERIFIED"),
        compatibility:state(versionFailed?"unknown":selected.compatible===true?"ready":selected.compatible===false?"failed":"unknown",capabilityFailed&&failureCode?`NATIVE_CAPABILITY_${failureCode}`:selected.compatible===true?"NATIVE_CAPABILITY_VERIFIED":selected.compatible===false&&!versionFailed?"NATIVE_VERSION_UNSUPPORTED":"COMPATIBILITY_UNVERIFIED"),
        authentication:state(authentication,authentication==="ready"?"NATIVE_AUTH_VERIFIED":authentication==="missing"?"NATIVE_AUTH_REQUIRED":"AUTHENTICATION_UNVERIFIED"),
        ...(typeof selected.version==="string"&&selected.version.length<=160&&!containsSecretLike(selected.version)?{nativeVersion:selected.version}:{})};
      this.database.saveEntity("profile-probe",context.profileId,JSON.parse(JSON.stringify(record)) as JsonValue,observedAt);return record;
    });
    this.pending.set(key,work);void work.finally(()=>{if(this.pending.get(key)===work)this.pending.delete(key);}).catch(()=>undefined);return work;
  }
}
