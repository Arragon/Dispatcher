import type {AgentAdapter} from "@dispatcher/adapters";
import {captureAccountQuotaSnapshot,captureAccountQuotaState,type AccountQuotaState} from "@dispatcher/domain";
import type {DispatcherDatabase,JsonValue} from "@dispatcher/persistence";

const json=(value:unknown):JsonValue=>JSON.parse(JSON.stringify(value)) as JsonValue;
class AccountQuotaError extends Error {constructor(readonly code:string){super(code);this.name="AccountQuotaError";}}
interface PendingQuota {scope:string;adapter:AgentAdapter;abort:AbortController;closeRead:()=>void;settled:Promise<void>;result:Promise<AccountQuotaState>}

/** Account-only reads, separated from Run advancement, resources and usage quantities. */
export class AccountQuotas {
 private readonly pending=new Map<string,PendingQuota>();
 private readonly uncertain=new Map<string,{scope:string}>();
 private readonly nextQuery=new Map<string,{scope:string;at:number}>();
 private closed=false;private closing?:Promise<void>;
 constructor(private readonly database:DispatcherDatabase,private readonly adapters:ReadonlyMap<string,AgentAdapter>,private readonly scope:(profileId:string)=>string|undefined,private readonly publish:(type:string,id:string,data:JsonValue)=>void=()=>{},private readonly now:()=>Date=()=>new Date(),private readonly onError:(error:unknown)=>void=()=>{}){
  for(const value of database.listEntities<JsonValue>("account-quota-lifecycle")){const record=value as {profileId?:string;contextFingerprint?:string;status?:string};if(record.status==="unknown"&&typeof record.profileId==="string")this.uncertain.set(record.profileId,{scope:record.contextFingerprint??"unproven"});}
 }
 hasPending(profileId?:string):boolean{return profileId===undefined?Boolean(this.pending.size||this.uncertain.size):this.pending.has(profileId)||this.uncertain.has(profileId);}
 state(profileId:string):AccountQuotaState {
  const saved=this.database.getEntity<JsonValue>("account-quota",profileId) as unknown as AccountQuotaState|undefined;
  if(this.uncertain.has(profileId)){const current=this.scope(profileId);return {profileId,status:"error",...(saved&&current&&saved.contextFingerprint===current?{contextFingerprint:current,...(saved.snapshot?{snapshot:saved.snapshot}:{}),...(saved.lastSuccessAt?{lastSuccessAt:saved.lastSuccessAt}:{})}:{}),error:{code:"QUOTA_CLEANUP_UNKNOWN"}};}
  if(!this.adapters.get(profileId)?.accountQuota&&!this.adapters.get(profileId)?.accountQuotaState)return {profileId,status:"unsupported"};
  if(!saved)return {profileId,status:"missing"};
  const current=this.scope(profileId);
  if(!current||saved.contextFingerprint!==current)return {profileId,status:"stale",reasonCode:"QUOTA_CONTEXT_CHANGED"};
  if(saved.snapshot?.periods.some(period=>period.resetsAt&&Date.parse(period.resetsAt)<=this.now().getTime()&&Date.parse(saved.snapshot!.collectedAt)<Date.parse(period.resetsAt)))return {...saved,status:"stale",reasonCode:"QUOTA_PERIOD_RESET"};
  if(saved.status==="fresh"&&(!saved.snapshot||this.now().getTime()-Date.parse(saved.snapshot.collectedAt)>10*60_000||this.now().getTime()-Date.parse(saved.lastSuccessAt??"")>10*60_000))return {...saved,status:"stale",reasonCode:"QUOTA_EVIDENCE_EXPIRED"};
  return saved;
 }
 refresh(profileId:string):Promise<AccountQuotaState> {
  const existing=this.pending.get(profileId);if(existing)return existing.result;
  if(this.uncertain.has(profileId))return Promise.resolve({...this.state(profileId),status:"error",error:{code:"QUOTA_CLEANUP_UNKNOWN"}});
  if(this.pending.size>=4)return Promise.resolve({...this.state(profileId),reasonCode:"QUOTA_QUERY_CAPACITY"});
  const adapter=this.adapters.get(profileId),scope=this.scope(profileId);
  if(this.closed||!adapter||!adapter.accountQuota&&!adapter.accountQuotaState||!scope)return Promise.resolve(this.state(profileId));
  const abort=new AbortController(),prior=this.database.getEntity<JsonValue>("account-quota",profileId) as unknown as AccountQuotaState|undefined;
  const current=()=>!this.closed&&this.adapters.get(profileId)===adapter&&this.scope(profileId)===scope;
  const native=Promise.resolve().then(async()=>adapter.accountQuotaState?await adapter.accountQuotaState(abort.signal):await adapter.accountQuota!(abort.signal)).catch(error=>{
   if((error as {code?:unknown})?.code==="MODEL_CATALOG_CLEANUP_UNKNOWN"){
    this.uncertain.set(profileId,{scope});
    if(!this.closed)this.database.saveEntity("account-quota-lifecycle",profileId,{profileId,contextFingerprint:scope,status:"unknown",reasonCode:"QUOTA_CLEANUP_UNKNOWN",observedAt:this.now().toISOString()});
    throw new AccountQuotaError("QUOTA_CLEANUP_UNKNOWN");
   }
   throw error;
  });
  const entry={} as PendingQuota;
  const settled=native.then(()=>undefined,()=>undefined).finally(()=>{if(this.pending.get(profileId)===entry)this.pending.delete(profileId);});
  let timer:ReturnType<typeof setTimeout>,closeRead:()=>void;
  const timeout=new Promise<never>((_,reject)=>{closeRead=()=>reject(new AccountQuotaError("QUOTA_QUERY_CLOSED"));timer=setTimeout(()=>{reject(new AccountQuotaError("QUOTA_QUERY_TIMEOUT"));abort.abort();},31_000);});
  const result=Promise.race([native,timeout]).then(value=>{
   if(!current())return this.state(profileId);
   const at=this.now().toISOString();let state:AccountQuotaState;
   try{
    if(adapter.accountQuotaState){
     const source=captureAccountQuotaState(value,profileId);
     if([source.snapshot?.collectedAt,source.checkedAt,source.lastSuccessAt].some(time=>time&&Date.parse(time)>this.now().getTime()+5_000))throw Error();
     state={...source,contextFingerprint:scope};
    }else{
     const snapshot=captureAccountQuotaSnapshot(value,profileId);
     if(Date.parse(snapshot.collectedAt)>this.now().getTime()+5_000)throw Error();
     state={profileId,status:"fresh",contextFingerprint:scope,snapshot,checkedAt:at,lastSuccessAt:at};
    }
   }catch{throw new AccountQuotaError("INVALID_ACCOUNT_QUOTA");}
   this.database.saveEntity("account-quota",profileId,json(state),at);this.publish("quota.changed",profileId,{profileId});this.nextQuery.set(profileId,{scope,at:this.now().getTime()+5*60_000});return this.state(profileId);
  }).catch(error=>{
   if(!current())return this.state(profileId);
   const at=this.now().toISOString(),state:AccountQuotaState={profileId,status:"error",contextFingerprint:scope,...(prior?.contextFingerprint===scope?{...(prior.snapshot?{snapshot:prior.snapshot,...(prior.lastSuccessAt?{lastSuccessAt:prior.lastSuccessAt}:{})}:{}),...(prior.sourceContextFingerprint?{sourceContextFingerprint:prior.sourceContextFingerprint}:{})}:{}),checkedAt:at,error:{code:error instanceof AccountQuotaError?error.code:"QUOTA_QUERY_FAILED"}};
   this.database.saveEntity("account-quota",profileId,json(state),at);this.publish("quota.changed",profileId,{profileId});this.nextQuery.set(profileId,{scope,at:this.now().getTime()+5*60_000});return state;
  }).finally(()=>clearTimeout(timer));
  Object.assign(entry,{scope,adapter,abort,closeRead:closeRead!,settled,result});this.pending.set(profileId,entry);return result;
 }
 kick(profileIds:readonly string[]):void {
  if(this.closed)return;
  for(const id of profileIds){if(this.pending.size>=4)break;const next=this.nextQuery.get(id),scope=this.scope(id);if((this.adapters.get(id)?.accountQuota||this.adapters.get(id)?.accountQuotaState)&&!this.hasPending(id)&&(next?.scope!==scope||(next?.at??0)<=this.now().getTime()))void this.refresh(id).catch(this.onError);}
 }
 beginShutdown():void {this.closed=true;for(const read of this.pending.values()){read.closeRead();read.abort.abort();}}
 close():Promise<void>{
  if(this.closing)return this.closing;this.beginShutdown();
  this.closing=(async()=>{
   let timer:ReturnType<typeof setTimeout>|undefined;
   try{await Promise.race([Promise.allSettled([...this.pending.values()].map(read=>read.settled)),new Promise<void>(resolve=>{timer=setTimeout(resolve,3_000);})]);}finally{if(timer)clearTimeout(timer);}
   const unknown=new Map([...this.uncertain,...this.pending]);
   if(unknown.size){for(const [profileId,read] of unknown)this.database.saveEntity("account-quota-lifecycle",profileId,{profileId,contextFingerprint:read.scope,status:"unknown",reasonCode:"QUOTA_CLEANUP_UNKNOWN",observedAt:this.now().toISOString()});throw new AccountQuotaError("QUOTA_CLEANUP_UNKNOWN");}
  })();return this.closing;
 }
}
