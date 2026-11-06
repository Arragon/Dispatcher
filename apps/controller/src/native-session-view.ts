import { isDeepStrictEqual } from "node:util";
import { assessInteractionCapability, normalizeNativeBinding, type InteractionCapabilities, type Run, type Session, type RunNativeSessionView } from "@dispatcher/domain";
import type { AdapterSession } from "@dispatcher/adapters";
import { InteractionStore, type DispatcherDatabase, type JsonValue } from "@dispatcher/persistence";
import { redactNativeText } from "@dispatcher/observability";

const capabilityNames=["durableIdentity","historyRead","sameSessionContinue","liveSteer","interruptTurn","nativeApproval","observeExternalChanges","releaseControl","reclaimControl","restartReattach"] as const;
const surfaces=["desktop","ide","web","mobile","tui"] as const;
const text=(value:unknown):string|undefined=>typeof value==="string"&&value.length>0&&value.length<=1024&&!Array.from(value).some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127)&&redactNativeText(value)===value?value:undefined;
/** Stored metadata only: no native inspect/history/result/access/launch or state mutation. */
export function nativeSessionView(database:DispatcherDatabase,run:Run,capabilities:InteractionCapabilities|undefined,now:Date):RunNativeSessionView {
 const store=new InteractionStore(database),binding=text(run.sessionId)?store.binding(run.sessionId):undefined,control=text(run.sessionId)?store.control(run.sessionId):undefined;
 const requested=run.executionSelection?.requestedModel??(run.model?.source!=="runtime"?run.model?.id:undefined);
 const reported=(run.model?.source==="runtime"?run.model.id:undefined);
 const execution=run.executionRef;
 const effort=run.executionSelection?.nativeParameters?.reasoningEffort;
 const view:RunNativeSessionView={version:1,mutationAvailable:false,runId:run.id,sessionId:run.sessionId,profileId:run.profileId,generation:run.generation,attempt:run.attempt,identity:run.providerSessionId?"unbound":"legacy",binding:null,control:null,execution:{kind:execution?.kind??"legacy",...(text(run.runnerId)?{runnerId:run.runnerId}:{}),...(text(run.worktree)?{worktree:run.worktree}:{}),...(text(run.branch)?{branch:run.branch}:{}),...(execution&&"environmentRef" in execution&&text(execution.environmentRef)?{environmentRef:execution.environmentRef}:{})},state:"unknown",freshness:"unknown",observedAt:null,completeness:"unknown",...(text(requested)?{requestedModel:{id:requested!,...(text(effort)?{reasoning:String(effort)}:{})}}:{}),...(text(reported)?{reportedModel:{id:reported!}}:{}),capabilities:capabilityNames.map(name=>({name,support:"unknown"})),access:surfaces.map(surface=>({surface,availability:"unverified"}))};
 if(!binding)return view;
 const session=database.getEntity<JsonValue>("session",run.sessionId) as unknown as Session|undefined;
 const adapter=database.getEntity<JsonValue>("adapter-session",run.sessionId) as unknown as AdapterSession|undefined;
 const normalized=session&&adapter?normalizeNativeBinding(session,adapter,run):undefined;
 if(!normalized||!("binding" in normalized)||!isDeepStrictEqual(normalized.binding,binding)||run.executionRef?.id!==binding.executionRefId||!Object.values(binding).every(value=>typeof value!=="string"||Boolean(text(value)))||control&&control.activeRunId!==run.id){view.identity="conflict";return view;}
 view.identity="bound";view.binding={product:binding.product,region:binding.region,profileId:binding.profileId,backendId:binding.backendId,runnerId:binding.runnerId,nativeSessionId:binding.nativeSessionId,...(binding.nativeThreadId?{nativeThreadId:binding.nativeThreadId}:{})};
 if(binding.identityState==="missing"){view.identity="unbound";return view;}
 if(binding.identityState==="unreachable"){view.identity="unreachable";view.state="unreachable";return view;}
 if(control)view.control={state:control.state,epoch:control.epoch,revision:control.revision,exclusion:control.exclusion};
 const observation=store.observation(run.sessionId);
 const checkpoint=database.handle.prepare("SELECT control_epoch FROM native_observation_checkpoints WHERE session_id=?").get(run.sessionId) as {control_epoch:number}|undefined;
 const matches=observation&&control&&checkpoint&&observation.nativeSessionId===binding.nativeSessionId&&(!observation.executionRefId||observation.executionRefId===binding.executionRefId)&&control.epoch===checkpoint.control_epoch;
 const deleted=Boolean(store.nativeDeletion(run.sessionId))||binding.identityState==="deleted";
 if(deleted){view.identity="deleted";view.state="deleted";}
 if(matches){
   const observed=Date.parse(observation.observedAt),age=now.getTime()-observed;
   view.observedAt=Number.isFinite(observed)?observation.observedAt:null;
   // Display freshness is not an authorization or writer-release proof.
   view.freshness=Number.isFinite(observed)&&age>=0?(age<=60_000?"fresh":"stale"):"unknown";
   if(!deleted)view.state=view.freshness==="fresh"?observation.state:"unknown";
   if(view.state==="unreachable")view.identity="unreachable";
   if(text(observation.reportedModel?.nativeSelectionId))view.reportedModel={id:observation.reportedModel!.nativeSelectionId};
   if(!deleted&&view.freshness==="fresh"&&capabilities?.version===1){view.capabilities=capabilityNames.map(name=>{const evidence=capabilities[name];const assessment=assessInteractionCapability(evidence,observation.scopeFingerprint,"runtime-verified");return {name,support:assessment.supported?"supported":evidence?.support==="unsupported"?"unsupported":"unknown",...(evidence?.level?{level:evidence.level}:{})};});view.access=surfaces.map(surface=>({surface,availability:capabilities.surfaces?.[surface]?.support==="unsupported"?"unsupported":"unverified"}));}
 }
 return view;
}
