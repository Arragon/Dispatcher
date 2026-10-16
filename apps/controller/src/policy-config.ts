import {ConfigPlanError,type DispatcherConfig} from "@dispatcher/config";
import type {AccountModelCatalog} from "@dispatcher/domain";
import {contentHash} from "./task-publications.js";
export interface PolicyConfigEvidence {policyHash:string;catalogs:Array<{ruleId:string;profileId:string;repositoryId:string;hash:string}>}
/** Native I/O qualifies a plan outside the synchronous ConfigPlan transaction. */
export async function qualifyRoutingPolicy(current:DispatcherConfig,next:DispatcherConfig,readCatalog:(profileId:string,repositoryId:string)=>Promise<AccountModelCatalog>):Promise<PolicyConfigEvidence|undefined>{
  const policy=next.policies.modelRouting;
  if(!policy?.enabled||contentHash(policy)===contentHash(current.policies.modelRouting))return undefined;
  const evidence:PolicyConfigEvidence={policyHash:contentHash(policy),catalogs:[]},cache=new Map<string,AccountModelCatalog>();
  for(const rule of policy.rules.filter(rule=>rule.enabled)){
    const profile=next.agentProfiles.find(profile=>profile.id===rule.profileId)!,appliedProfile=current.agentProfiles.find(profile=>profile.id===rule.profileId);
    const context=(value:typeof profile)=>({provider:value.provider,runnerId:value.runnerId,settings:value.settings,enabled:value.enabled!==false});
    if(!appliedProfile||contentHash(context(profile))!==contentHash(context(appliedProfile)))throw new ConfigPlanError("ROUTING_CONTEXT_NOT_APPLIED","Apply account settings before qualifying enabled routing rules");
    if(profile.enabled===false)throw new ConfigPlanError("ROUTING_RULE_UNAVAILABLE",`Routing rule ${rule.id} references a disabled account`);
    const repositories=rule.repositoryId?next.repositories.filter(repository=>repository.id===rule.repositoryId):next.repositories;
    if(!repositories.length)throw new ConfigPlanError("ROUTING_CONTEXT_NOT_APPLIED","Register a project before qualifying enabled routing rules");
    for(const repository of repositories){
      if(!current.repositories.some(applied=>applied.id===repository.id&&applied.root===repository.root))throw new ConfigPlanError("ROUTING_CONTEXT_NOT_APPLIED","Apply project registration before qualifying enabled routing rules");
      const key=contentHash([profile.id,repository.id]);let catalog=cache.get(key);if(!catalog){catalog=await readCatalog(profile.id,repository.id);cache.set(key,catalog);}
      const entry=catalog.entries.find(entry=>entry.id===rule.target.modelSelectionId);
      if(catalog.failure||catalog.freshness!=="native-fresh"||catalog.selectionSupport!=="explicit"||!entry?.selectable||entry.kind!=="model"||entry.access==="denied"||rule.target.reasoning.mode==="explicit"&&!entry.parameterOptions.reasoningEffort?.includes(rule.target.reasoning.value))throw new ConfigPlanError("ROUTING_RULE_UNAVAILABLE",`Routing rule ${rule.id} does not select a qualified native model and reasoning value for project ${repository.id}`);
      evidence.catalogs.push({ruleId:rule.id,profileId:profile.id,repositoryId:repository.id,hash:contentHash({...catalog,fetchedAt:undefined})});
    }
  }
  evidence.catalogs.sort((a,b)=>a.ruleId.localeCompare(b.ruleId)||a.profileId.localeCompare(b.profileId)||a.repositoryId.localeCompare(b.repositoryId));
  return evidence;
}
