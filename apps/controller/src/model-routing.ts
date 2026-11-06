import { randomUUID } from "node:crypto";
import type { DispatcherConfig } from "@dispatcher/config";
import type { AccountModelCatalog, ModelRoutingDecision, PublishDraftV1, TaskModelRoutingConfig } from "@dispatcher/domain";
import { disabledModelRouting } from "@dispatcher/domain";
import type { DispatcherDatabase, JsonValue } from "@dispatcher/persistence";
import { arbitrateClassification, classifyKeywords, selectModelRoutingRule } from "@dispatcher/scheduler";
import type {TaskClassifier} from "./task-classifier.js";
import { contentHash, PublicationError } from "./task-publications.js";

const json=(value:unknown):JsonValue=>JSON.parse(JSON.stringify(value)) as JsonValue;
/** Owns immutable, actor-bound decisions; trial results never enter the execution store. */
export class ModelRoutingService {
  constructor(private readonly db:DispatcherDatabase,private readonly now:()=>Date,private readonly classifier?:TaskClassifier){}
  read(actorId:string,id:string):ModelRoutingDecision {
    const decision=this.db.getEntity<JsonValue>("model-routing-decision",id) as unknown as ModelRoutingDecision|undefined;
    if(!decision||decision.actorId!==actorId)throw new PublicationError("ROUTING_DECISION_NOT_FOUND",404,"Routing decision not found");
    return decision;
  }
  async preview(actorId:string,draft:PublishDraftV1,config:DispatcherConfig,configRevision:number,catalog:AccountModelCatalog,options:{trial?:boolean;policy?:TaskModelRoutingConfig;forceAnalysis?:boolean;keywordOnly?:boolean;forceSemantic?:boolean}={}):Promise<ModelRoutingDecision> {
    const policy=options.policy??config.policies.modelRouting??disabledModelRouting;
    const inputHash=contentHash(draft),policyVersion=contentHash(policy),typeVersion=contentHash(policy.taskTypes);
    const semanticEnabled=policy.enabled&&(policy.classificationMode==="hybrid"||options.trial&&options.forceSemantic)&&!draft.execution.taskTypeId&&!options.keywordOnly;
    const key=contentHash({actorId,inputHash,configRevision,policyVersion,catalogRevision:catalog.revision,context:catalog.contextFingerprint,...(semanticEnabled?{classifierVersion:this.classifier?.version()}:{})});
    if(!options.trial&&!options.forceAnalysis){const binding=this.db.getEntity<JsonValue>("model-routing-draft",key) as {id:string}|undefined;if(binding){const prior=this.read(actorId,binding.id);if(Date.parse(prior.expiresAt)>this.now().getTime())return prior;}}
    const keyword=classifyKeywords({title:draft.title??"",description:draft.description},policy.taskTypes);
    const analysis=semanticEnabled&&this.classifier?await this.classifier.analyze({actorId,clientDraftId:draft.clientDraftId,title:draft.title??"",description:draft.description,types:policy.taskTypes},{...(options.forceAnalysis?{force:true}:{})}):undefined;
    if(analysis?.failure?.code==="CLASSIFICATION_SUPERSEDED"||analysis?.failure?.code==="CLASSIFICATION_CONFIG_CHANGED")throw new PublicationError(analysis.failure.code,409,analysis.failure.message);
    const failure=analysis?.failure??(semanticEnabled&&!this.classifier?{code:"SEMANTIC_CLASSIFIER_UNAVAILABLE",message:"Task classifier is unavailable"}:undefined);
    const arbitration=semanticEnabled?arbitrateClassification(keyword,analysis?.result,failure,policy.semanticFailureMode):undefined;
    const selectedType=draft.execution.taskTypeId??(semanticEnabled?arbitration?.taskTypeId:keyword.primaryType);
    const ruleResult=selectedType?selectModelRoutingRule(policy,{repositoryId:draft.repositoryId,profileId:draft.execution.profileId??"",taskTypeId:selectedType}):{status:"NO_MATCHING_RULE" as const,ruleIds:[],excluded:[]};
    const decision:ModelRoutingDecision={version:1,id:randomUUID(),actorId,clientDraftId:draft.clientDraftId,inputHash,repositoryId:draft.repositoryId,profileId:draft.execution.profileId??"",configRevision,policyVersion,typeVersion,ruleVersions:Object.fromEntries(ruleResult.ruleIds.map(id=>[id,contentHash(policy.rules.find(rule=>rule.id===id))])),classification:{source:draft.execution.taskTypeId?"user":arbitration?.source??"keyword",keyword,...(analysis?{analysis}:{}),...(analysis?.result?{semantic:analysis.result}:{}),...(failure?{failure}:{}),...(arbitration?.degraded?{degraded:true}:{}),...(selectedType?{taskTypeId:selectedType}:{})},ruleResult,catalog:structuredClone(catalog),status:"needs-input",confirmation:{required:policy.requireConfirmation,mode:policy.requireConfirmation?"pending":"policy-exempt"},createdAt:this.now().toISOString(),expiresAt:new Date(this.now().getTime()+600000).toISOString()};
    const fail=(code:string,message:string)=>{decision.error={code,message};};
    if(!policy.enabled)fail("ROUTING_DISABLED","Model routing is disabled; choose a model manually");
    else if(arbitration?.error)fail(arbitration.error,"Task classification needs review; choose an explicit type or model");
    else if(draft.execution.taskTypeId&&!policy.taskTypes.some(type=>type.id===selectedType&&type.enabled))fail("TASK_TYPE_UNAVAILABLE","Choose an enabled task type");
    else if(!selectedType)fail(keyword.status==="ambiguous"?"TASK_TYPE_AMBIGUOUS":"TASK_TYPE_UNCLASSIFIED","Choose a task type or refine the task; no model was selected");
    else if(ruleResult.status!=="matched")fail(ruleResult.status,"No unique routing rule target is available");
    else if(catalog.freshness!=="native-fresh"||catalog.selectionSupport!=="explicit"||catalog.failure)fail("CATALOG_UNAVAILABLE","Policy routing requires a fresh native model catalog");
    else {
      const target=ruleResult.target!,entry=catalog.entries.find(entry=>entry.id===target.modelSelectionId);
      if(!entry?.selectable||entry.kind!=="model"||entry.access==="denied")fail("MODEL_UNAVAILABLE","The winning rule does not select an available concrete native model");
      else if(entry.access==="unconfirmed"&&!draft.execution.allowUnconfirmedModelAccess)fail("MODEL_ACCESS_UNCONFIRMED","Acknowledge that the native catalog does not prove account access");
      else if(target.reasoning.mode==="explicit"&&!entry.parameterOptions.reasoningEffort?.includes(target.reasoning.value))fail("REASONING_UNSUPPORTED","The winning rule's reasoning value is not supported by this model");
      else {decision.status="ready";decision.target={modelId:entry.id,nativeParameters:target.reasoning.mode==="explicit"?{reasoningEffort:target.reasoning.value}:{}};}
    }
    if(!options.trial)this.db.transaction(()=>{this.db.saveEntity("model-routing-decision",decision.id,json(decision));this.db.saveEntity("model-routing-draft",key,json({id:decision.id}));});
    return decision;
  }
  revalidate(actorId:string,draft:PublishDraftV1,configRevision:number,catalog:AccountModelCatalog,reviewed:ModelRoutingDecision):void {
    const stored=this.read(actorId,reviewed.id);
    // Confirmation is a publication transaction fact; every selection fact must match the original decision.
    const selectionFacts=(decision:ModelRoutingDecision)=>({...decision,confirmation:undefined});
    if(contentHash(selectionFacts(stored))!==contentHash(selectionFacts(reviewed))||stored.status!=="ready"||stored.classification.analysis&&stored.classification.analysis.roleVersion!==this.classifier?.version()||stored.inputHash!==contentHash(draft)||stored.configRevision!==configRevision||Date.parse(stored.expiresAt)<=this.now().getTime()||catalog.freshness!=="native-fresh"||catalog.failure||catalog.selectionSupport!=="explicit"||contentHash({...catalog,fetchedAt:undefined})!==contentHash({...stored.catalog,fetchedAt:undefined}))throw new PublicationError("ROUTING_DECISION_STALE",409,"Routing decision or native catalog changed; review the task again");
  }
}
