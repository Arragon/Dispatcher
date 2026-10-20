import { isDeepStrictEqual } from "node:util";
import { isTerminalRunState, type HistoryPage, type NativeBinding, type NativeCommandReceipt, type NativeHistoryEntry, type NativeObservation, type Run, type SessionControl } from "@dispatcher/domain";
import { InteractionStore, type DispatcherDatabase, type InteractionCommand, type JsonValue } from "@dispatcher/persistence";

export interface NativeExternalMessage {id:string;kind:NativeHistoryEntry["kind"];turnId?:string;requestId?:string}
export interface NativeExternalSnapshot {
 version:1;binding:NativeBinding;controlEpoch:number;observation:NativeObservation;
 history:{state:HistoryPage["state"];completeness:HistoryPage["completeness"];entries:NativeExternalMessage[]};
 metadata?:{archived?:boolean;peerRef?:string;locationFingerprint?:string};
}
export interface KnownNativeCommand {commandId:string;type:string;state:InteractionCommand["state"];binding:NativeBinding;scopeFingerprint:string;receipt:NativeCommandReceipt}
export type NativeExternalChangeKind="message"|"turn"|"model"|"policy"|"location"|"fork"|"identity"|"store"|"scope"|"peer"|"archive"|"delete"|"history";
export interface ExternalChangeDecision {kind:"unchanged"|"known-command"|"external"|"unverified"|"stale";changes:NativeExternalChangeKind[];requiresReconcile:boolean;coverage:"complete"|"limited"|"unknown";code?:string}
const json=(value:unknown):JsonValue=>JSON.parse(JSON.stringify(value)) as JsonValue;
const id=(value:unknown):value is string=>typeof value==="string"&&value.length>0&&value.length<=512&&Array.from(value).every(c=>c.charCodeAt(0)>=32)&&!/(?:\b(?:[a-z][a-z0-9]*[-_])*(?:token|secret|password|credential|authorization|api[-_]?key|private[-_]?key)["']?\s*[:=]|\bBearer\s|\b(?:sk|ghp|github_pat|xox[baprs])[-_][\w-]{8,})/i.test(value);
const readCodes=new Set(["INVALID_NATIVE_READ_HANDLE","INVALID_NATIVE_READ_TIMEOUT","STALE_NATIVE_OBSERVER","STALE_NATIVE_READ","NATIVE_READ_CANCELLED","NATIVE_READ_TIMEOUT","NATIVE_READ_FAILED","NATIVE_OBSERVATION_MISMATCH","NATIVE_EVENT_STREAM_GAP"]);
function incomplete(next:NativeExternalSnapshot,previous?:NativeExternalSnapshot):boolean {
 const o=next.observation;const p=previous?.observation;
 return ["unknown","unreachable"].includes(o.state)||o.read?.readability!=="readable"||o.pendingTools==="unknown"||o.pendingApprovals==="unknown"||!o.reportedModel||!o.permissionFingerprint||!o.executionRefId||next.history.state!=="available"||next.history.completeness!=="complete"||p?.serverEpoch!==undefined&&o.serverEpoch!==p.serverEpoch||previous?.metadata?.archived!==undefined&&next.metadata?.archived===undefined||previous?.metadata?.peerRef!==undefined&&next.metadata?.peerRef===undefined||previous?.metadata?.locationFingerprint!==undefined&&next.metadata?.locationFingerprint===undefined;
}
function coverage(next:NativeExternalSnapshot|undefined):ExternalChangeDecision["coverage"] {
 return !next||incomplete(next)?"unknown":next.metadata?.archived!==undefined&&next.metadata.peerRef&&next.metadata.locationFingerprint?"complete":"limited";
}
export function normalizeNativeExternalSnapshot(input:NativeExternalSnapshot):NativeExternalSnapshot|undefined {
 const b=input?.binding;const o=input?.observation;const h=input?.history;const r=o?.read;const m=input?.metadata;
 if(input?.version!==1||!Number.isSafeInteger(input.controlEpoch)||input.controlEpoch<1||!b||b.version!==1||![b.product,b.region,b.profileId,b.backendId,b.runnerId,b.nativeStoreRef,b.nativeSessionId,b.executionRefId].every(id)||[b.nativeThreadId,b.parentSessionId].some(v=>v!==undefined&&!id(v))||!["bound","missing","deleted","unreachable"].includes(b.identityState)||!o||o.version!==1||![o.id,o.nativeSessionId,o.scopeFingerprint].every(id)||o.nativeSessionId!==b.nativeSessionId||o.nativeThreadId!==b.nativeThreadId||!["running","idle","unknown","deleted","unreachable"].includes(o.state)||![o.pendingTools,o.pendingApprovals].every(v=>["none","present","unknown"].includes(v))||typeof o.observedAt!=="string"||o.observedAt.length>64||!Number.isFinite(Date.parse(o.observedAt))||[o.activeTurnId,o.serverEpoch,o.historyRevision,o.executionRefId,o.permissionFingerprint].some(v=>v!==undefined&&!id(v))||!["native-revision","snapshot-only","unknown"].includes(o.historyMode)||o.reportedModel&&(!id(o.reportedModel.nativeSelectionId)||o.reportedModel.reasoning!==undefined&&!id(o.reportedModel.reasoning))||o.readability!==undefined&&!["readable","deleted","unreachable","unknown"].includes(o.readability)||!r||r.requestId!==o.id||r.sourceObservationId!==undefined&&!id(r.sourceObservationId)||o.readability!==undefined&&o.readability!==r.readability||![r.requestId,r.observerEpoch].every(id)||![r.observerGeneration,r.sequence].every(v=>Number.isSafeInteger(v)&&v>=1)||!["running","completed","missing","unknown"].includes(r.processState)||!["readable","deleted","unreachable","unknown"].includes(r.readability)||!h||!["available","deleted","unreachable","unsupported","unknown"].includes(h.state)||!["complete","partial","unknown"].includes(h.completeness)||!Array.isArray(h.entries)||h.entries.length>100||h.entries.some(e=>!e||!id(e.id)||!["user","assistant","tool","approval","summary","other"].includes(e.kind)||[e.turnId,e.requestId].some(v=>v!==undefined&&!id(v)))||m&&(m.archived!==undefined&&typeof m.archived!=="boolean"||[m.peerRef,m.locationFingerprint].some(v=>v!==undefined&&!id(v))))return undefined;
 return {version:1,controlEpoch:input.controlEpoch,binding:{version:1,product:b.product,region:b.region,profileId:b.profileId,backendId:b.backendId,runnerId:b.runnerId,nativeStoreRef:b.nativeStoreRef,nativeSessionId:b.nativeSessionId,executionRefId:b.executionRefId,identityState:b.identityState,...(b.nativeThreadId?{nativeThreadId:b.nativeThreadId}:{}),...(b.parentSessionId?{parentSessionId:b.parentSessionId}:{})},observation:{version:1,id:o.id,nativeSessionId:o.nativeSessionId,scopeFingerprint:o.scopeFingerprint,observedAt:o.observedAt,state:o.state,pendingTools:o.pendingTools,pendingApprovals:o.pendingApprovals,historyMode:o.historyMode,...(o.nativeThreadId?{nativeThreadId:o.nativeThreadId}:{}),...(o.activeTurnId?{activeTurnId:o.activeTurnId}:{}),...(o.serverEpoch?{serverEpoch:o.serverEpoch}:{}),...(o.historyRevision?{historyRevision:o.historyRevision}:{}),...(o.executionRefId?{executionRefId:o.executionRefId}:{}),...(o.permissionFingerprint?{permissionFingerprint:o.permissionFingerprint}:{}),...(o.reportedModel?{reportedModel:{nativeSelectionId:o.reportedModel.nativeSelectionId,...(o.reportedModel.reasoning?{reasoning:o.reportedModel.reasoning}:{})}}:{}),...(o.readability?{readability:o.readability}:{}),read:{requestId:r.requestId,observerEpoch:r.observerEpoch,observerGeneration:r.observerGeneration,sequence:r.sequence,processState:r.processState,readability:r.readability,...(r.sourceObservationId?{sourceObservationId:r.sourceObservationId}:{}),...(r.reasonCode?{reasonCode:readCodes.has(r.reasonCode)?r.reasonCode:"NATIVE_READ_DIAGNOSTIC"}:{})}},history:{state:h.state,completeness:h.completeness,entries:h.entries.map(e=>({id:e.id,kind:e.kind,...(e.turnId?{turnId:e.turnId}:{}),...(e.requestId?{requestId:e.requestId}:{})}))},...(m?{metadata:{...(m.archived!==undefined?{archived:m.archived}:{}),...(m.peerRef?{peerRef:m.peerRef}:{}),...(m.locationFingerprint?{locationFingerprint:m.locationFingerprint}:{})}}:{})};
}
function bindingChanges(old:NativeBinding,current:NativeBinding):Set<NativeExternalChangeKind> {
 const changes=new Set<NativeExternalChangeKind>();
 if(old.nativeStoreRef!==current.nativeStoreRef)changes.add("store");
 if(["product","region","profileId","backendId","runnerId"].some(key=>old[key as keyof NativeBinding]!==current[key as keyof NativeBinding]))changes.add("scope");
 if(old.nativeSessionId!==current.nativeSessionId||old.nativeThreadId!==current.nativeThreadId||old.parentSessionId!==current.parentSessionId)changes.add(current.parentSessionId===old.nativeSessionId||current.parentSessionId!==old.parentSessionId?"fork":"identity");
 if(old.executionRefId!==current.executionRefId)changes.add("location");return changes;
}
/** Provider metadata has already crossed a trusted normalized read boundary. No transcript or actor inference. */
export function classifyExternalChange(previousInput:NativeExternalSnapshot,nextInput:NativeExternalSnapshot,knownCommands:readonly KnownNativeCommand[]):ExternalChangeDecision {
 const previous=normalizeNativeExternalSnapshot(previousInput);const next=normalizeNativeExternalSnapshot(nextInput);
 const result=(kind:ExternalChangeDecision["kind"],changes:NativeExternalChangeKind[]=[],code?:string):ExternalChangeDecision=>({kind,changes,requiresReconcile:kind==="external"||kind==="unverified",coverage:kind==="unverified"?"unknown":coverage(next),...(code?{code}:{})});
 if(!previous||!next)return result("unverified",[],"INVALID_NATIVE_EXTERNAL_SNAPSHOT");
 const a=previous.observation.read!;const b=next.observation.read!;
 if(next.controlEpoch<previous.controlEpoch||b.observerGeneration<a.observerGeneration||b.observerGeneration===a.observerGeneration&&(b.observerEpoch!==a.observerEpoch||b.sequence<=a.sequence))return result("stale",[],"STALE_NATIVE_EXTERNAL_OBSERVATION");
 const changes=new Set<NativeExternalChangeKind>();let echoed=false;
 const commands=knownCommands.slice(0,200).filter(c=>c.state==="ACKNOWLEDGED"&&c.receipt?.version===1&&c.receipt.commandId===c.commandId&&["accepted","queued"].includes(c.receipt.state)&&isDeepStrictEqual(c.binding,previous.binding)&&c.scopeFingerprint===previous.observation.scopeFingerprint&&[c.receipt.nativeMessageId,c.receipt.nativeRequestId,c.receipt.nativeTurnId].every(v=>v===undefined||id(v)));
 const prompt=(c:KnownNativeCommand)=>["start","continue","steer"].includes(c.type);
 const known=(e:NativeExternalMessage)=>commands.some(c=>(prompt(c)||e.kind==="approval"&&["approval","reject-approval"].includes(c.type))&&(c.receipt.nativeMessageId===e.id||e.requestId!==undefined&&c.receipt.nativeRequestId===e.requestId||["assistant","tool"].includes(e.kind)&&e.turnId!==undefined&&c.receipt.nativeTurnId===e.turnId));
 const old=previous.binding;const current=next.binding;
 for(const change of bindingChanges(old,current))changes.add(change);
 if(previous.observation.scopeFingerprint!==next.observation.scopeFingerprint)changes.add("scope");
 if(old.executionRefId!==current.executionRefId||next.observation.executionRefId!==undefined&&next.observation.executionRefId!==current.executionRefId||previous.metadata?.locationFingerprint!==undefined&&next.metadata?.locationFingerprint!==undefined&&previous.metadata.locationFingerprint!==next.metadata.locationFingerprint)changes.add("location");
 if(previous.observation.reportedModel&&next.observation.reportedModel&&!isDeepStrictEqual(previous.observation.reportedModel,next.observation.reportedModel))changes.add("model");
 if(previous.observation.permissionFingerprint&&next.observation.permissionFingerprint&&previous.observation.permissionFingerprint!==next.observation.permissionFingerprint)changes.add("policy");
 if(next.observation.state==="deleted"||current.identityState==="deleted"||next.history.state==="deleted")changes.add("delete");
 if(next.metadata?.archived!==undefined&&previous.metadata?.archived!==undefined&&next.metadata.archived!==previous.metadata.archived)changes.add("archive");
 if(next.metadata?.peerRef&&previous.metadata?.peerRef&&next.metadata.peerRef!==previous.metadata.peerRef)changes.add("peer");
 const newEntries=next.history.entries.filter(e=>!previous.history.entries.some(oldEntry=>oldEntry.id===e.id));
 for(const entry of newEntries){if(known(entry))echoed=true;else changes.add("message");}
 if(next.observation.activeTurnId&&next.observation.activeTurnId!==previous.observation.activeTurnId){if(commands.some(c=>prompt(c)&&c.receipt.nativeTurnId===next.observation.activeTurnId))echoed=true;else changes.add("turn");}
 if(previous.observation.historyRevision&&next.observation.historyRevision&&previous.observation.historyRevision!==next.observation.historyRevision&&!newEntries.length)changes.add("history");
 if(changes.size)return result("external",[...changes]);
 if(incomplete(next,previous))return result("unverified",[],"NATIVE_EXTERNAL_OBSERVATION_INCOMPLETE");
 return result(echoed?"known-command":"unchanged");
}
export interface NativeExternalRead {sessionId:string;runId:string;generation:number;leaseId:string;controlEpoch:number;snapshot:NativeExternalSnapshot;readBarrier?:string}
export interface NativeExternalRecordResult {accepted:boolean;decision?:ExternalChangeDecision;control?:SessionControl;code?:string}
interface WriteBlocker {version:1;sessionId:string;runId:string;generation:number;leaseId:string;observationRef:string;code:"NATIVE_EXTERNAL_PERSISTENCE_FAILED";at:string}
/** Public boundary error intentionally excludes raw database diagnostics and their cause. */
export class NativeExternalPersistenceError extends Error {
 readonly code="NATIVE_EXTERNAL_PERSISTENCE_FAILED";
 constructor(){super("NATIVE_EXTERNAL_PERSISTENCE_FAILED");this.name="NativeExternalPersistenceError";}
}
const emergencyBlocks=new WeakMap<DispatcherDatabase,Map<string,WriteBlocker>>();
const matches=(block:WriteBlocker|undefined,run:Run):boolean=>!!block&&block.sessionId===run.sessionId&&block.runId===run.id&&block.generation===run.generation&&block.leaseId===run.leaseId;
export function hasNativeExternalWriteBlocker(database:DispatcherDatabase,run:Run):boolean {
 return matches(emergencyBlocks.get(database)?.get(run.sessionId),run)||matches(database.getEntity<JsonValue>("native-external-write-blocker",run.sessionId) as unknown as WriteBlocker|undefined,run);
}
/** Called again outside the outer recovery transaction so its rollback cannot remove the blocker. */
export function blockNativeExternalWrites(database:DispatcherDatabase,input:NativeExternalRead,at:Date):void {
 const block:WriteBlocker={version:1,sessionId:input.sessionId,runId:input.runId,generation:input.generation,leaseId:input.leaseId,observationRef:input.snapshot.observation.id,code:"NATIVE_EXTERNAL_PERSISTENCE_FAILED",at:at.toISOString()};
 let blocks=emergencyBlocks.get(database);if(!blocks){blocks=new Map();emergencyBlocks.set(database,blocks);}blocks.set(input.sessionId,block);
 // The in-process guard remains closed even when every durable write fails.
 try{const run=database.getEntity<JsonValue>("run",input.runId) as unknown as Run|undefined;if(run&&matches(block,run))database.saveEntity("native-external-write-blocker",input.sessionId,json(block));}catch{return;}
}
/** Only the qualified reclaim transaction may replace an uncertain baseline. */
export function resetNativeExternalBaseline(database:DispatcherDatabase,input:NativeExternalRead):()=>void {
 const store=new InteractionStore(database);const control=store.control(input.sessionId);const snapshot=normalizeNativeExternalSnapshot(input.snapshot);
 const run=database.getEntity<JsonValue>("run",input.runId) as unknown as Run|undefined;
 if(!run||!snapshot||incomplete(snapshot)||control?.state!=="AUTOMATED"||control.activeRunId!==run.id||control.epoch!==input.controlEpoch||snapshot.controlEpoch!==control.epoch||run.generation!==input.generation||run.leaseId!==input.leaseId||!isDeepStrictEqual(store.binding(input.sessionId),snapshot.binding)||store.observation(input.sessionId)?.id!==snapshot.observation.id)throw new NativeExternalPersistenceError();
 database.saveEntity("native-external-checkpoint",input.sessionId,json({version:1,snapshot,baseline:snapshot,unverifiedContext:false,decision:{kind:"unchanged",changes:[],requiresReconcile:false,coverage:coverage(snapshot),code:"NATIVE_EXTERNAL_RECLAIM_BASELINE"}}));
 database.handle.prepare("DELETE FROM entities WHERE kind='native-external-write-blocker' AND id=? AND json_extract(document_json,'$.runId')=? AND json_extract(document_json,'$.generation')=? AND json_extract(document_json,'$.leaseId')=?").run(input.sessionId,input.runId,input.generation,input.leaseId);
 // Clearing the process guard before COMMIT would reopen writes after rollback.
 return ()=>{const blocks=emergencyBlocks.get(database);if(matches(blocks?.get(input.sessionId),run))blocks!.delete(input.sessionId);};
}
export class NativeExternalChanges {
 private readonly store:InteractionStore;
 constructor(private readonly database:DispatcherDatabase,private readonly now:()=>Date=()=>new Date()){this.store=new InteractionStore(database);}
 private knownCommands(sessionId:string):KnownNativeCommand[] {
  const rows=this.database.handle.prepare("SELECT document_json FROM interaction_commands WHERE session_id=? AND state='ACKNOWLEDGED' ORDER BY rowid DESC LIMIT 200").all(sessionId) as Array<{document_json:string}>;
  return rows.flatMap(row=>{const c=JSON.parse(row.document_json) as InteractionCommand;const context=this.database.getEntity<JsonValue>("native-command-context",c.id) as unknown as {binding:NativeBinding;scopeFingerprint:string}|undefined;return c.nativeReceipt&&context?[{commandId:c.id,type:c.type,state:c.state,binding:context.binding,scopeFingerprint:context.scopeFingerprint,receipt:c.nativeReceipt}]:[];});
 }
 /** Records a trusted read under its original execution/control authority; never starts or rebinds a native session. */
 record(input:NativeExternalRead):NativeExternalRecordResult {
  let acceptedRead:NativeExternalRead|undefined;
  try{return this.database.transaction(()=>{
   const reject=(code:string):NativeExternalRecordResult=>({accepted:false,code});
   const run=this.database.getEntity<JsonValue>("run",input.runId) as unknown as Run|undefined;const task=run?this.database.getCanonicalTask<JsonValue>(run.taskId):undefined;const binding=this.store.binding(input.sessionId);let control=this.store.control(input.sessionId);
   if(!run||isTerminalRunState(run.state)||!binding||run.sessionId!==input.sessionId||run.generation!==input.generation||run.leaseId!==input.leaseId||control?.activeRunId!==run.id||(task?.document as {currentRunId?:string}|undefined)?.currentRunId!==run.id||run.leaseExpiresAt&&(!Number.isFinite(Date.parse(run.leaseExpiresAt))||Date.parse(run.leaseExpiresAt)<=this.now().getTime()))return reject("STALE_RUN_AUTHORITY");
   if(control.epoch!==input.controlEpoch||input.snapshot?.controlEpoch!==input.controlEpoch)return reject("STALE_CONTROL_EPOCH");
   if(this.store.nativeReadBarrier(input.sessionId)!==input.readBarrier)return reject("STALE_NATIVE_READ_BARRIER");
   const next=normalizeNativeExternalSnapshot(input.snapshot);if(!next)return reject("INVALID_NATIVE_EXTERNAL_SNAPSHOT");
   const read=next.observation.read!;const watermark=this.database.handle.prepare("SELECT observer_generation,observer_sequence,observation_id FROM native_observation_checkpoints WHERE session_id=?").get(input.sessionId) as {observer_generation:number;observer_sequence:number;observation_id:string}|undefined;
   if(watermark&&(watermark.observer_generation>read.observerGeneration||watermark.observer_generation===read.observerGeneration&&(watermark.observer_sequence>read.sequence||watermark.observer_sequence===read.sequence&&watermark.observation_id!==next.observation.id)))return reject("STALE_NATIVE_EXTERNAL_OBSERVATION");
   acceptedRead={...input,snapshot:next};
   const prior=this.database.getEntity<JsonValue>("native-external-checkpoint",input.sessionId) as unknown as {snapshot:NativeExternalSnapshot;baseline?:NativeExternalSnapshot;unverifiedContext?:boolean;decision:ExternalChangeDecision}|undefined;
   // The first read establishes a historical baseline; it cannot identify older authors.
   const initialChanges=bindingChanges(binding,next.binding);if(next.observation.state==="deleted"||next.binding.identityState==="deleted"||next.history.state==="deleted")initialChanges.add("delete");
   const previous=prior?{...(prior.baseline??prior.snapshot),controlEpoch:prior.snapshot.controlEpoch,observation:{...(prior.baseline??prior.snapshot).observation,id:prior.snapshot.observation.id,read:prior.snapshot.observation.read!}}:undefined;
   const decision:ExternalChangeDecision=previous?classifyExternalChange(previous,next,this.knownCommands(input.sessionId)):{kind:initialChanges.size?"external":incomplete(next)?"unverified":"unchanged",changes:[...initialChanges],requiresReconcile:initialChanges.size>0||incomplete(next),coverage:coverage(next),code:incomplete(next)?"NATIVE_EXTERNAL_OBSERVATION_INCOMPLETE":"NATIVE_EXTERNAL_BASELINE"};if(decision.kind==="stale")return reject(decision.code!);
   const unverifiedContext=prior?.unverifiedContext??(!next.observation.reportedModel||!next.observation.permissionFingerprint||!next.observation.executionRefId);
   if(unverifiedContext&&["unchanged","known-command"].includes(decision.kind)){decision.kind="unverified";decision.requiresReconcile=true;decision.coverage="unknown";decision.code="NATIVE_EXTERNAL_BASELINE_UNVERIFIED";}
   if(decision.kind==="external"){
    if(["AUTOMATED","HANDOFF_REQUESTED","RECONCILING"].includes(control.state))control=this.store.compareAndSwapControl({sessionId:input.sessionId,expectedRevision:control.revision,expectedEpoch:control.epoch,actorId:"native-observer",event:{type:"conflict",observationRef:next.observation.id,at:this.now().toISOString()}});
    const key=`${input.sessionId}:${next.observation.id}`;this.database.saveEntity("native-external-change",key,json({version:1,id:key,sessionId:input.sessionId,runId:run.id,observationRef:next.observation.id,controlEpoch:input.controlEpoch,changes:decision.changes,requiresReconcile:true,human:control.state==="HUMAN",observedAt:next.observation.observedAt}));
    if(control.state!=="HUMAN")this.database.saveEntity("native-control-outbox",key,json({version:1,id:key,state:"pending",sessionId:input.sessionId,runId:run.id,controlState:control.state,controlEpoch:control.epoch,controlRevision:control.revision,code:"NATIVE_EXTERNAL_CHANGE",changes:decision.changes}));
   }
   const last=prior?.baseline??prior?.snapshot;
   const entries=next.history.completeness==="complete"?next.history.entries:[...(last?.history.entries??[]),...next.history.entries].filter((entry,index,all)=>all.findIndex(other=>other.id===entry.id)===index).slice(-100);
   const baseline:NativeExternalSnapshot={...next,observation:{...next.observation,...(!next.observation.reportedModel&&last?.observation.reportedModel?{reportedModel:last.observation.reportedModel}:{}),...(!next.observation.permissionFingerprint&&last?.observation.permissionFingerprint?{permissionFingerprint:last.observation.permissionFingerprint}:{})},metadata:{...last?.metadata,...next.metadata},history:{...next.history,entries}};
   this.database.saveEntity("native-external-checkpoint",input.sessionId,json({version:1,snapshot:next,baseline,unverifiedContext,decision}));return {accepted:true,decision,control};
  });}catch(error){if(!acceptedRead)throw error;blockNativeExternalWrites(this.database,acceptedRead,this.now());throw new NativeExternalPersistenceError();}
 }
}
