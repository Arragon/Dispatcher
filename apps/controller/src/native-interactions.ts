import { isDeepStrictEqual } from "node:util";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import type { AdapterSession, AdapterStartOutcome, NativeInteractionPort, NativeObserverContext } from "@dispatcher/adapters";
import { assertNativeRequestChoice, captureNativeRequestHandle, NativeRequestError, normalizeNativeRequest, type NativePendingRequest, type NativeRequestHandle } from "@dispatcher/adapters";
import { assessInteractionCapability, assessNativeDrift, normalizeNativeDriftPolicy, canMutate, isTerminalRunState, mergeTurnObservation, normalizeNativeBinding, validateExecutionBinding, type CapabilityEvidence, type GuardDecision, type InteractionOperation, type MutationFence, type NativeBinding, type NativeDriftPolicy, type NativeBindingEvent, type NativeCommandReceipt, type NativeObservation, type TaskContract, type TurnObservation, type Run, type Session, type SessionControl } from "@dispatcher/domain";
import { InteractionStore, InteractionStoreError, type DispatcherDatabase, type InteractionCommand, type JsonValue } from "@dispatcher/persistence";
import { NativeRuntime, recoverNativeEvents, createNativeEventCheckpoint, dispatchInteraction as dispatchNativeInteraction, normalizeInteractionCommand, normalizeNativeEvent, reconcileNativeEvents, recordNativeEvent, releaseNativeControl, isSafeNativeMetadataId, reclaimFingerprint, reconcileForReclaim as readForReclaim, type NativeReclaimSource, type ReclaimReport, type NativeDispatchCommand, type NativeDispatchSource, type NativeEventCheckpoint, type NativeEventStream, type NativeHistoryRead, type NativeReleaseSource } from "@dispatcher/runner";

import { blockNativeExternalWrites, hasNativeExternalWriteBlocker, NativeExternalChanges, normalizeNativeExternalSnapshot, resetNativeExternalBaseline, type NativeExternalRead } from "./native-external-changes.js";
import { interruptNativeSession, type NativeStopProof, type NativeStopSource, type NativeStopResult } from "@dispatcher/runner";

const json=(value:unknown):JsonValue=>JSON.parse(JSON.stringify(value)) as JsonValue;
export type NativeStartOutcome=AdapterStartOutcome;
export interface InteractionPrincipal {id:string;roles:readonly string[];profileId?:string}
export type ControllerInteractionOperation=InteractionOperation|"advance"|"resume"|"reroute"|"pause"|"fail"|"cleanup-input"|"cleanup-start"|"request-handoff";
export class InteractionGuardError extends Error {constructor(readonly code:string){super(code);this.name="InteractionGuardError";}}
interface MutationLane {sessionId:string;controlRevision:number;controlEpoch:number;taskRevision?:number;ownsLane:boolean;mutationAuthorized?:boolean;mutationRecordId?:string}
export interface NativeCommandOutcome {commandId:string;state:NativeCommandReceipt["state"]|"reserved"|"cancelled";execution:"unconfirmed"|"running"|"completed"|"failed";requiresReconciliation:boolean;receipt:NativeCommandReceipt}
export interface CancelResolution {version:1;runId:string;sessionId:string;commandId:string;state:"CANCELLED";nativeMayBeRunning:boolean;nativeStopProof:NativeStopProof;receipt?:NativeCommandReceipt}
interface CancelRecord {version:1;actorId:string;fence:MutationFence;humanInterruptConfirmed:boolean;taskRevision:number;binding?:NativeBinding;scopeFingerprint?:string;activeTurnId?:string;resolution:CancelResolution}
export interface HandoffRequest {principal:InteractionPrincipal;fence:MutationFence;settlePolicy:"wait"|"interrupt";timeoutMs?:number}
export interface HandoffSnapshot {commandId:string;phase:"waiting"|"awaiting-release"|"human"|"cancelled"|"failed"|"conflict";control:SessionControl;drain:"pending"|"settled"|"unknown";code?:string}
export interface HandoffInterruptSource {binding:NativeBinding;scopeFingerprint:string;interruptWithoutResume:CapabilityEvidence;port:Pick<NativeInteractionPort,"capabilities"|"interrupt">}
interface HandoffRecord {version:1;commandId:string;actorId:string;originalFence:MutationFence;controlFence:MutationFence;binding:NativeBinding;scopeFingerprint:string;settlePolicy:HandoffRequest["settlePolicy"];deadline:string;phase:HandoffSnapshot["phase"];drainRefs:string[];code?:string;interruptCommandId?:string;releaseCommandId?:string}
interface FrozenDriftPolicy {version:1;runId:string;profileId:string;providerId:string;backendId:string;policy:NativeDriftPolicy;configured?:NativeDriftPolicy}
interface ReclaimRecord {version:1;driftPolicy?:NativeDriftPolicy;commandId:string;actorId:string;originalFence:MutationFence;controlFence:MutationFence;binding:NativeBinding;scopeFingerprint:string;permissionFingerprint?:string;phase:"checking"|"awaiting-confirmation"|"committed"|"conflict";report?:ReclaimReport;commit?:{reportId:string;fence:MutationFence;action:"continue"|"verify";control:SessionControl}}
interface MutationRecord {id:string;sessionId:string;state:"active"|"settled"|"unknown"}
interface NativeRequestRecord {version:1;id:string;profileId:string;fence:MutationFence;binding:NativeBinding;scopeFingerprint:string;request:NativePendingRequest;state:"pending"|"responding"|"consumed"|"expired"|"unknown";commandId?:string;receipt?:NativeCommandReceipt;code?:string}
interface LiveRequestConnection {original:NativeRequestHandle;captured:NativeRequestHandle;source:NativeDispatchSource}
const commandOperation=(command:NativeDispatchCommand):InteractionOperation=>command.type==="approval"?(command.response.kind==="reject"?"reject-approval":"approval"):command.type;

export class NativeInteractions {
  private readonly store:InteractionStore;
  private readonly lanes=new Map<string,Promise<unknown>>();
  private readonly activeMutations=new Map<string,Promise<unknown>>();
  private readonly laneContext=new AsyncLocalStorage<MutationLane>();
  private readonly requestConnections=new Map<string,LiveRequestConnection>();
  private handoffExpiryCursor:string|undefined;
  constructor(private readonly database:DispatcherDatabase,private readonly now:()=>Date=()=>new Date(),private readonly resolveDriftPolicy?: (run:Run)=>NativeDriftPolicy){
    this.store=new InteractionStore(database);
    // A crash after SENDING cannot prove whether the external request arrived.
    this.database.transaction(()=>{
      const pending=this.database.handle.prepare("SELECT document_json FROM interaction_commands WHERE state='SENDING'").all() as Array<{document_json:string}>;
      for(const row of pending){const command=JSON.parse(row.document_json) as InteractionCommand;if(["start","continue","steer","approval","reject-approval","interrupt","cancel","release-control"].includes(command.type))this.store.updateCommand({id:command.id,expectedRevision:command.revision,state:"UNKNOWN",code:command.type==="start"?"NATIVE_START_OUTCOME_UNKNOWN":"NATIVE_COMMAND_OUTCOME_UNKNOWN"});}
      for(const value of this.database.listEntities<JsonValue>("native-request")){const request=value as unknown as NativeRequestRecord;if(["pending","responding"].includes(request.state))this.database.saveEntity("native-request",request.id,json({...request,state:request.state==="responding"?"unknown":"expired",code:"NATIVE_REQUEST_CONNECTION_LOST"}));}
    });
  }
  startForRun(runId:string):InteractionCommand|undefined{return this.store.command(`native-start:${runId}`);}
  hasUncertainStart(runId:string):boolean{return ["SENDING","UNKNOWN"].includes(this.startForRun(runId)?.state??"");}
  /** Capture the invocation's authority before its backend can emit the first fact. */
  registerNativeObserver(context:NativeObserverContext):()=>boolean {
    const captured=structuredClone(context);
    const control=this.store.control(captured.sessionId);
    const lane=this.laneContext.getStore();
    const epoch=lane?.sessionId===captured.sessionId?lane.controlEpoch:control?.epoch??0;
    const revision=lane?.sessionId===captured.sessionId?lane.controlRevision:control?.revision??0;
    const key=`${captured.sessionId}:${captured.invocationId}`;
    // Registration observes the caller's original authority; it never acquires a new epoch.
    if(!this.database.getEntity("native-observer-authority",key))this.database.saveEntity("native-observer-authority",key,json({...captured,controlEpoch:epoch,controlRevision:revision}));
    return ()=>this.observerAuthorityCurrent(captured,true);
  }
  private observerAdapterMatches(context:NativeObserverContext):boolean {
    const adapter=this.database.getEntity<JsonValue>("adapter-session",context.sessionId) as unknown as AdapterSession|undefined;
    return Boolean(adapter&&adapter.runId===context.runId&&adapter.profileId===context.profileId&&adapter.backendId===context.backendId&&adapter.nativeInvocationId===context.invocationId&&adapter.execution?.generation===context.generation&&adapter.execution?.attempt===context.attempt&&adapter.execution?.leaseId===context.leaseId);
  }
  private observerExecutionMatches(context:NativeObserverContext,requireSession=true):boolean {
    const run=this.database.getEntity<JsonValue>("run",context.runId) as unknown as Run|undefined;
    const session=this.database.getEntity<JsonValue>("session",context.sessionId) as unknown as Session|undefined;
    return Boolean(run&&(!requireSession||session)&&(!session||session.profileId===context.profileId)&&!isTerminalRunState(run.state)&&run.sessionId===context.sessionId&&run.profileId===context.profileId&&run.generation===context.generation&&run.attempt===context.attempt&&run.leaseId===context.leaseId&&(this.database.getCanonicalTask<JsonValue>(run.taskId)?.document as {currentRunId?:string}|undefined)?.currentRunId===run.id&&this.observerAdapterMatches(context));
  }
  private observerAuthorityCurrent(context:NativeObserverContext,adapterProjection=false):boolean {
    const authority=this.database.getEntity<JsonValue>("native-observer-authority",`${context.sessionId}:${context.invocationId}`) as unknown as (NativeObserverContext&{controlEpoch:number;controlRevision:number})|undefined;
    const control=this.store.control(context.sessionId);
    if(!authority||!isDeepStrictEqual({...authority,controlEpoch:undefined,controlRevision:undefined},{...context,controlEpoch:undefined,controlRevision:undefined})||!this.observerAdapterMatches(context))return false;
    if(!control){
      // Existing standalone/legacy Adapter reads have no Core authority to promote.
      return adapterProjection&&authority.controlEpoch===0&&authority.controlRevision===0&&!this.store.binding(context.sessionId)&&(!this.database.getEntity("run",context.runId)||this.observerExecutionMatches(context,false));
    }
    return control.state==="AUTOMATED"&&control.activeRunId===context.runId&&control.epoch===authority.controlEpoch&&control.revision===authority.controlRevision&&this.observerExecutionMatches(context);
  }
  applyNativeBindingEvent(event:NativeBindingEvent):{applied:boolean;code?:string} {
    const normalizedEvent=normalizeNativeEvent(event);
    if(!normalizedEvent)return {applied:false,code:"INVALID_NATIVE_EVENT"};
    event=normalizedEvent;
    return this.database.transaction(()=>{
      const prior=this.database.getEntity<JsonValue>("native-binding-event",event.id);
      const priorEvent=(prior as {event?:NativeBindingEvent}|undefined)?.event;
      const semantics=(fact:NativeBindingEvent)=>({...fact,turn:{...fact.turn,observedAt:undefined}});
      if(priorEvent&&isDeepStrictEqual(semantics(priorEvent),semantics(event)))return {applied:false,code:"DUPLICATE_NATIVE_EVENT"};
      const record=(result:{applied:boolean;code?:string})=>{
        if(!prior){
          const counter=this.database.getEntity<JsonValue>("native-event-ingestion",event.sessionId) as {sequence:number}|undefined;
          const sequence=counter?.sequence??0;
          if(!Number.isSafeInteger(sequence)||sequence<0||sequence===Number.MAX_SAFE_INTEGER)throw new InteractionGuardError("NATIVE_EVENT_SEQUENCE_EXHAUSTED");
          const ingestionSequence=sequence+1;
          this.database.saveEntity("native-event-ingestion",event.sessionId,{sequence:ingestionSequence});
          this.database.saveEntity("native-binding-event",event.id,json({event,...result,ingestionSequence}));
          const checkpoint=this.database.getEntity<JsonValue>("native-event-checkpoint",event.sessionId) as unknown as NativeEventCheckpoint|undefined;
          if(checkpoint){const recorded=recordNativeEvent(checkpoint,event);if(recorded.accepted)this.database.saveEntity("native-event-checkpoint",event.sessionId,json(recorded.checkpoint));}
        }
        return result;
      };
      const run=this.database.getEntity<JsonValue>("run",event.runId) as unknown as Run|undefined;
      const session=this.database.getEntity<JsonValue>("session",event.sessionId) as unknown as Session|undefined;
      const adapter=this.database.getEntity<JsonValue>("adapter-session",event.sessionId) as unknown as AdapterSession|undefined;
      const task=run?this.database.getCanonicalTask<JsonValue>(run.taskId):undefined;
      if(!run||!session||!adapter||isTerminalRunState(run.state)||run.sessionId!==event.sessionId||run.profileId!==event.profileId||session.profileId!==event.profileId||session.providerId!==run.providerId||adapter.runId!==run.id||adapter.profileId!==event.profileId||adapter.backendId!==event.backendId||adapter.nativeInvocationId!==event.turn.invocationId||run.executionSelection&&run.executionSelection.backendId!==event.backendId||run.generation!==event.generation||run.attempt!==event.attempt||run.leaseId!==event.leaseId||adapter.execution?.generation!==event.generation||adapter.execution?.attempt!==event.attempt||adapter.execution?.leaseId!==event.leaseId||(task?.document as {currentRunId?:string}|undefined)?.currentRunId!==run.id)return record({applied:false,code:"STALE_NATIVE_EVENT"});
      const observer:NativeObserverContext={sessionId:event.sessionId,runId:event.runId,profileId:event.profileId,backendId:event.backendId,invocationId:event.turn.invocationId,...(event.generation!==undefined?{generation:event.generation}:{}),...(event.attempt!==undefined?{attempt:event.attempt}:{}),...(event.leaseId?{leaseId:event.leaseId}:{})};
      // Legacy producers may be pinned only in the initial epoch, never after handoff.
      if(!this.database.getEntity("native-observer-authority",`${event.sessionId}:${event.turn.invocationId}`)&&this.store.control(event.sessionId)?.epoch===1){try{this.registerNativeObserver(observer);}catch{return record({applied:false,code:"STALE_NATIVE_EVENT"});}}
      if(!this.observerAuthorityCurrent(observer))return record({applied:false,code:"STALE_NATIVE_EVENT"});
      const freeze=(code:string)=>{
        const control=this.store.control(run.sessionId)??this.store.initializeControl({sessionId:run.sessionId,activeRunId:run.id,exclusion:"none",at:event.turn.observedAt});
        this.store.compareAndSwapControl({sessionId:run.sessionId,expectedRevision:control.revision,expectedEpoch:control.epoch,actorId:"native-observer",event:{type:"conflict",at:event.turn.observedAt}});
        this.database.saveEntity("adapter-session",adapter.id,json({...adapter,nativeIdentityIssue:code}));
        return record({applied:false,code});
      };
      if(prior){this.database.saveEntity("native-binding-event-conflict",event.id,json({event,original:priorEvent}));return freeze("IDEMPOTENCY_KEY_REUSE");}
      if(event.nativeSessionId&&[session.nativeSessionId,run.providerSessionId,adapter.providerSessionId].some(id=>id!==undefined&&id!==event.nativeSessionId))return freeze("NATIVE_IDENTITY_CHANGED");
      if(event.nativeBinding){
        if(event.nativeBinding.nativeSessionId!==event.nativeSessionId)return freeze("NATIVE_IDENTITY_CHANGED");
        try{this.store.bindNative({sessionId:run.sessionId,runId:run.id,binding:event.nativeBinding,expectedGeneration:run.generation,expectedLeaseId:run.leaseId});}
        catch(error){if(!(error instanceof InteractionStoreError))throw error;return freeze(error.code);}
      }else if(event.nativeSessionId){
        this.database.saveEntity("session",session.id,json({...session,nativeSessionId:event.nativeSessionId,updatedAt:event.turn.observedAt}));
        this.database.saveEntity("run",run.id,json({...run,providerSessionId:event.nativeSessionId}));
        this.database.saveEntity("adapter-session",adapter.id,json({...adapter,providerSessionId:event.nativeSessionId}));
      }
      const observationId=`${session.id}:${event.turn.invocationId}`;
      const priorTurn=this.database.getEntity<JsonValue>("native-turn-observation",observationId) as unknown as TurnObservation|undefined;
      this.database.saveEntity("native-turn-observation",observationId,json(mergeTurnObservation(priorTurn,event.turn)));
      return record({applied:true});
    });
  }
  /** Trusted read composition captures this before starting inspect/history, never after receiving them. */
  captureNativeReadBarrier(sessionId:string):string|undefined {return this.store.nativeReadBarrier(sessionId);}
  /** Refresh one qualified native snapshot/history page without execution or writer ownership. */
  async refreshNativeObservation(principalInput:InteractionPrincipal,runInput:Run,port:NativeInteractionPort,assertSourceCurrent:()=>void) {
    const principal=structuredClone(principalInput),run=structuredClone(runInput),binding=this.store.binding(run.sessionId),fence=this.fenceFor(run,`native-observation:${randomUUID()}`);
    this.assertInteraction(principal,"collect",fence);
    if(!binding||!port.readHandle||!port.history)return {accepted:false,code:"NATIVE_CAPABILITY_UNSUPPORTED"};
    assertSourceCurrent();
    const capabilityNames=["durableIdentity","historyRead"] as const;
    let capabilities;try{capabilities=port.capabilities();}catch{return {accepted:false,code:"NATIVE_CAPABILITY_UNVERIFIED"};}
    const scope=capabilities.durableIdentity?.scopeFingerprint;
    if(!capabilityNames.every(name=>assessInteractionCapability(capabilities[name],scope,"runtime-verified").supported))return {accepted:false,code:"NATIVE_CAPABILITY_UNVERIFIED"};
    const readMethod=port.readHandle,historyMethod=port.history;let handle:ReturnType<NonNullable<NativeInteractionPort["readHandle"]>>;
    try{handle=readMethod.call(port,structuredClone(binding));}catch{throw new InteractionGuardError("NATIVE_READ_SOURCE_CHANGED");}
    if(handle.scopeFingerprint!==scope||!isDeepStrictEqual(handle.binding,binding))throw new InteractionGuardError("NATIVE_READ_SOURCE_CHANGED");
    const prior=this.database.getEntity<JsonValue>("native-event-checkpoint",run.sessionId) as unknown as NativeEventCheckpoint|undefined;
    const initial=prior??createNativeEventCheckpoint({binding,scopeFingerprint:scope,stream:{kind:"volatile"}});
    if(!isDeepStrictEqual(initial.binding,binding)||initial.scopeFingerprint!==scope)throw new InteractionGuardError("NATIVE_EVENT_SCOPE_CHANGED");
    const barrier=this.captureNativeReadBarrier(run.sessionId),stored=this.database.handle.prepare("SELECT observer_generation FROM native_observation_checkpoints WHERE session_id=?").get(run.sessionId) as {observer_generation:number}|undefined;
    const runtime=new NativeRuntime(),token=runtime.connect(handle,{observerGeneration:Math.max(initial.observerGeneration,stored?.observer_generation??0)+1});
    let open=true,changed=false,observation:NativeObservation|undefined,page:NativeHistoryRead["page"]|undefined,requestedCursor:string|undefined;
    const guard=()=>{
      if(!open)throw new InteractionGuardError("NATIVE_READ_CLOSED");assertSourceCurrent();
      this.assertInteraction(principal,"collect",fence);
      const live=this.database.getEntity<JsonValue>("run",run.id) as unknown as Run|undefined,task=this.database.getCanonicalTask<JsonValue>(run.taskId),control=this.store.control(run.sessionId);
      const session=this.database.getEntity<JsonValue>("session",run.sessionId) as unknown as Session|undefined,adapter=this.database.getEntity<JsonValue>("adapter-session",run.sessionId) as unknown as AdapterSession|undefined;
      const normalized=live&&session&&adapter?normalizeNativeBinding(session,adapter,live):undefined;
      if(!normalized||!("binding" in normalized)||!isDeepStrictEqual(normalized.binding,binding))throw new InteractionGuardError("NATIVE_IDENTITY_CHANGED");
      if(!live||live.sessionId!==run.sessionId||live.profileId!==run.profileId||live.providerId!==run.providerId||live.runnerId!==run.runnerId||live.generation!==run.generation||live.attempt!==run.attempt||live.leaseId!==run.leaseId||live.state!==run.state||live.worktree!==run.worktree||!isDeepStrictEqual(live.executionRef,run.executionRef)||!isDeepStrictEqual(this.store.binding(run.sessionId),binding)||task?.revision!==fence.expectedTaskRevision||(task.document as {currentRunId?:string}).currentRunId!==run.id||control?.activeRunId!==run.id||control.revision!==fence.expectedControlRevision||control.epoch!==fence.expectedControlEpoch||live.leaseExpiresAt&&(!Number.isFinite(Date.parse(live.leaseExpiresAt))||Date.parse(live.leaseExpiresAt)<=this.now().getTime())||this.captureNativeReadBarrier(run.sessionId)!==barrier||port.readHandle!==readMethod||port.history!==historyMethod)throw new InteractionGuardError("STALE_NATIVE_OBSERVATION");
      const current=port.capabilities();if(!capabilityNames.every(name=>assessInteractionCapability(current[name],scope,"runtime-verified").supported))throw new InteractionGuardError("NATIVE_CAPABILITY_UNVERIFIED");
    };
    const facts=(value:NativeObservation)=>({...value,id:undefined,read:undefined,observedAt:undefined});
    const cancellation=new AbortController(),deadline=setTimeout(()=>{cancellation.abort();runtime.disconnect(token);},5_000);
    try{
      guard();const result=await recoverNativeEvents(initial,{
        inspect:async()=>{guard();const value=await runtime.inspect(token);guard();observation=structuredClone(value);return value;},
        history:async(ref,input)=>{guard();if(cancellation.signal.aborted)throw new InteractionGuardError("NATIVE_READ_CLOSED");const read=observation?.read;if(!read)throw new InteractionGuardError("NATIVE_READ_CONTEXT_MISSING");const value=await historyMethod.call(port,structuredClone(ref),{...input},{requestId:read.requestId,observerEpoch:read.observerEpoch,sequence:read.sequence,signal:cancellation.signal});guard();if(cancellation.signal.aborted)throw new InteractionGuardError("NATIVE_READ_CLOSED");const final=await runtime.inspect(token);guard();
          if(!observation||!isDeepStrictEqual(facts(observation),facts(final))){changed=true;throw new InteractionGuardError("NATIVE_OBSERVATION_CHANGED");}
          // Only metadata leaves the read composition; no transcript enters Core persistence.
          page={...value,entries:value.entries.map(entry=>({...entry,text:""}))};requestedCursor=input.cursor;return page;
        },
      });guard();
      if(!isDeepStrictEqual(this.database.getEntity("native-event-checkpoint",run.sessionId),prior))throw new InteractionGuardError("STALE_NATIVE_OBSERVATION");
      if(!observation||changed||!result.accepted){runtime.disconnect(token);observation=await runtime.inspect(token);guard();page=undefined;requestedCursor=undefined;}
      const read=observation.read!;
      return this.applyNativeEventRecovery({sessionId:run.sessionId,runId:run.id,generation:run.generation,leaseId:run.leaseId,controlEpoch:fence.expectedControlEpoch,scopeFingerprint:scope,stream:initial.stream,observerGeneration:read.observerGeneration,observerEpoch:read.observerEpoch,sequence:read.sequence,observation,...(result.checkpoint.gapGeneration!==initial.gapGeneration?{disconnected:true}:{}),...(barrier?{readBarrier:barrier}:{}),...(page?{history:{page,binding,scopeFingerprint:scope,gapGeneration:result.checkpoint.gapGeneration,...read,...(requestedCursor?{requestedCursor}:{})}}:{})});
    }finally{open=false;clearTimeout(deadline);cancellation.abort();runtime.disconnect(token);}
  }
  applyNativeEventRecovery(input:{sessionId:string;runId:string;generation:number;leaseId:string;controlEpoch:number;scopeFingerprint:string;stream:NativeEventStream;observerGeneration:number;observerEpoch:string;sequence:number;observation?:NativeObservation;history?:NativeHistoryRead;disconnected?:boolean;cursor?:string;readBarrier?:string}) {
    let acceptedRead:NativeExternalRead|undefined;
    try{return this.database.transaction(()=>{
      const rejected=(code:string)=>({accepted:false,code});
      const run=this.database.getEntity<JsonValue>("run",input.runId) as unknown as Run|undefined;
      const session=this.database.getEntity<JsonValue>("session",input.sessionId) as unknown as Session|undefined;
      const adapter=this.database.getEntity<JsonValue>("adapter-session",input.sessionId) as unknown as AdapterSession|undefined;
      const binding=this.store.binding(input.sessionId);const control=this.store.control(input.sessionId);
      const task=run?this.database.getCanonicalTask<JsonValue>(run.taskId):undefined;
      if(!run||!session||!adapter||!binding||run.sessionId!==input.sessionId||run.generation!==input.generation||run.leaseId!==input.leaseId||control?.activeRunId!==run.id||(task?.document as {currentRunId?:string}|undefined)?.currentRunId!==run.id)return rejected("STALE_RUN_AUTHORITY");
      if(control.epoch!==input.controlEpoch)return rejected("STALE_CONTROL_EPOCH");
      const normalized=normalizeNativeBinding(session,adapter,run);
      if(!("binding" in normalized)||!isDeepStrictEqual(normalized.binding,binding))return rejected("NATIVE_IDENTITY_CHANGED");
      if(!Number.isSafeInteger(input.observerGeneration)||input.observerGeneration<1||!Number.isSafeInteger(input.sequence)||input.sequence<1||!input.observerEpoch)return rejected("INVALID_NATIVE_OBSERVER");
      const checkpoint=this.database.getEntity<JsonValue>("native-event-checkpoint",input.sessionId) as unknown as NativeEventCheckpoint|undefined;
      if(checkpoint&&(!isDeepStrictEqual(checkpoint.binding,binding)||checkpoint.scopeFingerprint!==input.scopeFingerprint||checkpoint.stream.kind!==input.stream.kind))return rejected("NATIVE_EVENT_SCOPE_CHANGED");
      const initial=checkpoint??createNativeEventCheckpoint({binding,scopeFingerprint:input.scopeFingerprint,stream:input.stream});
      let observation=input.observation;
      if(!observation&&input.disconnected){
        const id=`native-stream-gap:${randomUUID()}`;
        observation={version:1,id,nativeSessionId:binding.nativeSessionId,...(binding.nativeThreadId?{nativeThreadId:binding.nativeThreadId}:{}),scopeFingerprint:input.scopeFingerprint,observedAt:this.now().toISOString(),state:"unknown",pendingTools:"unknown",pendingApprovals:"unknown",historyMode:"unknown",read:{requestId:id,observerEpoch:input.observerEpoch,observerGeneration:input.observerGeneration,sequence:input.sequence,processState:"unknown",readability:"unknown",reasonCode:"NATIVE_EVENT_STREAM_GAP"}};
      }
      if(!observation)return rejected("NATIVE_SNAPSHOT_REQUIRED");
      if(observation.read?.observerGeneration!==input.observerGeneration||observation.read.sequence!==input.sequence||observation.read.observerEpoch!==input.observerEpoch)return rejected("INVALID_NATIVE_OBSERVER");
      const options={...(input.disconnected?{disconnected:true}:{}),...(input.cursor?{cursor:input.cursor}:{})};
      const result=reconcileNativeEvents(initial,observation,input.history,options);
      if(!result.accepted)return result;
      const history=result.checkpoint.history;
      const externalSnapshot=normalizeNativeExternalSnapshot({version:1,binding,controlEpoch:input.controlEpoch,observation,history:{state:history?.state??"unknown",completeness:result.needsHistory?"partial":history?.completeness??"unknown",entries:history?.entries??[]}});
      if(!externalSnapshot){this.store.invalidateObservation({sessionId:input.sessionId,readBarrier:randomUUID(),observation:{version:1,id:`invalid-native-read:${randomUUID()}`,nativeSessionId:binding.nativeSessionId,...(binding.nativeThreadId?{nativeThreadId:binding.nativeThreadId}:{}),scopeFingerprint:"unknown",observedAt:this.now().toISOString(),state:"unknown",pendingTools:"unknown",pendingApprovals:"unknown",historyMode:"unknown",executionRefId:binding.executionRefId}});return rejected("INVALID_NATIVE_EXTERNAL_SNAPSHOT");}
      acceptedRead={sessionId:input.sessionId,runId:input.runId,generation:input.generation,leaseId:input.leaseId,controlEpoch:input.controlEpoch,...(input.readBarrier?{readBarrier:input.readBarrier}:{}),snapshot:externalSnapshot};
      const priorExternal=this.database.getEntity<JsonValue>("native-external-checkpoint",input.sessionId) as unknown as {baseline?:{controlEpoch:number;observation?:NativeObservation}}|undefined;
      const priorObservation=this.store.observation(input.sessionId);
      const firstHuman=this.firstHumanEpoch(input.sessionId);
      const previousEpoch=this.database.handle.prepare("SELECT control_epoch FROM native_observation_checkpoints WHERE session_id=?").get(input.sessionId) as {control_epoch:number}|undefined;
      const baselinePermission=firstHuman===null?priorExternal?.baseline?.observation?.permissionFingerprint??priorObservation?.permissionFingerprint??(!priorExternal&&!priorObservation?externalSnapshot.observation.permissionFingerprint:undefined):priorExternal?.baseline&&priorExternal.baseline.controlEpoch<firstHuman?priorExternal.baseline.observation?.permissionFingerprint:previousEpoch&&previousEpoch.control_epoch<firstHuman?priorObservation?.permissionFingerprint:undefined;
      const saved=this.store.saveObservation({sessionId:input.sessionId,observerGeneration:input.observerGeneration,observerSequence:input.sequence,controlEpoch:input.controlEpoch,observation:externalSnapshot.observation,...(input.readBarrier?{readBarrier:input.readBarrier}:{})});
      if(!saved.accepted)return rejected(saved.code??"DUPLICATE_NATIVE_OBSERVATION");
      if(control.state==="AUTOMATED")this.freezeDriftPolicy(run,baselinePermission);
      this.database.saveEntity("native-event-checkpoint",input.sessionId,json(result.checkpoint));
      const external=new NativeExternalChanges(this.database,this.now).record(acceptedRead);
      if(!external.accepted)throw new InteractionGuardError(external.code??"NATIVE_EXTERNAL_OBSERVATION_REJECTED");
      return result;
    });}catch(error){if(!acceptedRead)throw error;blockNativeExternalWrites(this.database,acceptedRead,this.now());throw new InteractionGuardError("NATIVE_EXTERNAL_PERSISTENCE_FAILED");}
  }
  hasAuthorityContext(sessionId:string):boolean{return this.laneContext.getStore()?.sessionId===sessionId;}
  withAuthorityContext<T>(sessionId:string,operation:()=>Promise<T>):Promise<T> {
    const control=this.store.control(sessionId);
    return this.laneContext.run({sessionId,controlRevision:control?.revision??0,controlEpoch:control?.epoch??0,ownsLane:false},operation);
  }

  withMutationLane<T>(sessionId:string,operation:()=>Promise<T>):Promise<T> {
    const current=this.laneContext.getStore();
    if(current?.sessionId===sessionId&&current.ownsLane)return operation();
    // Capture authority before queuing: waiting for another caller never grants a new epoch.
    const control=this.store.control(sessionId);
    const context:MutationLane=current?.sessionId===sessionId?{...current,ownsLane:true}:{sessionId,controlRevision:control?.revision??0,controlEpoch:control?.epoch??0,ownsLane:true};
    const previous=this.lanes.get(sessionId)??Promise.resolve();
    const pending=previous.catch(()=>undefined).then(()=>this.laneContext.run(context,async()=>{
      // The durable marker survives disappearance of this process's Promise.
      const id=randomUUID();const record:MutationRecord={id,sessionId,state:"active"};context.mutationRecordId=id;
      this.database.saveEntity("native-mutation",id,json(record));this.activeMutations.set(id,pending);
      try{const result=await operation();this.database.saveEntity("native-mutation",id,json({...record,state:"settled"}));return result;}
      catch(error){this.database.saveEntity("native-mutation",id,json({...record,state:context.mutationAuthorized?"unknown":"settled"}));throw error;}
      finally{this.activeMutations.delete(id);}
    }));
    this.lanes.set(sessionId,pending);
    void pending.finally(()=>{if(this.lanes.get(sessionId)===pending)this.lanes.delete(sessionId);}).catch(()=>undefined);
    return pending;
  }
  acknowledgeSettledMutationOutcome(sessionId:string):void {
    const context=this.laneContext.getStore();
    if(!context?.ownsLane||context.sessionId!==sessionId||!context.mutationRecordId)throw new InteractionGuardError("MUTATION_LANE_REQUIRED");
    // Only a trusted side-effect coordinator may acknowledge its durable outcome.
    context.mutationAuthorized=false;
  }
  assertPriorMutationOutcomesSettled(sessionId:string):void {
    const context=this.laneContext.getStore();
    if(!context?.ownsLane||context.sessionId!==sessionId||!context.mutationRecordId||!this.activeMutations.has(context.mutationRecordId))throw new InteractionGuardError("MUTATION_LANE_REQUIRED");
    const own=this.database.handle.prepare("SELECT id,document_json FROM entities WHERE kind='native-mutation' AND id=?").get(context.mutationRecordId) as {id:string;document_json:string}|undefined;
    let marker:Partial<MutationRecord>|null|undefined;
    try{marker=own?JSON.parse(own.document_json) as Partial<MutationRecord>|null:undefined;}catch{/* An unreadable owned marker cannot establish the lane. */}
    if(!own||!marker||marker.id!==own.id||marker.sessionId!==sessionId||marker.state!=="active")throw new InteractionGuardError("MUTATION_LANE_REQUIRED");
    const rows=this.database.handle.prepare("SELECT id,document_json FROM entities WHERE kind='native-mutation' AND CASE WHEN json_valid(document_json) THEN json_extract(document_json,'$.sessionId') END=?").all(sessionId) as {id:string;document_json:string}[];
    for(const row of rows){
      if(row.id===context.mutationRecordId)continue;
      const prior=JSON.parse(row.document_json) as Partial<MutationRecord>|null;
      // Check all associated rows, including missing/null states; only this exact live lane is excluded.
      if(!prior||prior.id!==row.id||prior.sessionId!==sessionId||prior.state!=="settled"||this.activeMutations.has(row.id))throw new InteractionGuardError("NATIVE_COMMAND_OUTCOME_UNKNOWN");
    }
  }
  fenceFor(run:Run,commandId:string):MutationFence {
    const task=this.database.getCanonicalTask<JsonValue>(run.taskId);
    const context=this.laneContext.getStore();
    const lane=context?.sessionId===run.sessionId?context:undefined;
    if(lane&&lane.taskRevision===undefined)lane.taskRevision=task?.revision??0;
    const control=this.store.control(run.sessionId);
    return {runId:run.id,sessionId:run.sessionId,commandId,generation:run.generation,leaseId:run.leaseId,expectedTaskRevision:lane?.taskRevision??task?.revision??0,expectedCurrentRunId:run.id,expectedControlRevision:lane?.controlRevision??control?.revision??0,expectedControlEpoch:lane?.controlEpoch??control?.epoch??0};
  }
  allocateNativeConnectionEpoch():number {
    return this.database.transaction(()=>{
      const counter=this.database.getEntity<JsonValue>("native-connection-epoch","controller");
      const records=[...(counter===undefined?[]:[counter]),...this.database.listEntities<JsonValue>("native-request-connection")];let epoch=0;
      for(const record of records){const value=record as {version?:unknown;connectionEpoch?:unknown}|null;
        if(!value||value.version!==1||typeof value.connectionEpoch!=="number"||!Number.isSafeInteger(value.connectionEpoch)||value.connectionEpoch<1)throw new InteractionGuardError("NATIVE_CONNECTION_EPOCH_INVALID");
        epoch=Math.max(epoch,value.connectionEpoch);
      }
      if(epoch===Number.MAX_SAFE_INTEGER)throw new InteractionGuardError("NATIVE_CONNECTION_EPOCH_EXHAUSTED");
      this.database.saveEntity("native-connection-epoch","controller",{version:1,connectionEpoch:epoch+1});return epoch+1;
    });
  }
  assertNativeAuthority(binding:NativeBinding,fence:MutationFence,operation:"ingress"|"interrupt"|"approval"|"reject-approval"):void {
    if(!isDeepStrictEqual(this.store.binding(fence.sessionId),binding)||binding.identityState!=="bound")throw new InteractionGuardError("NATIVE_IDENTITY_CHANGED");
    const command=this.store.command(fence.commandId);
    if(command&&command.profileId!==binding.profileId)throw new InteractionGuardError("SESSION_OWNER_MISMATCH");
    if(operation==="ingress"){
      const decision=this.evaluateInteraction({id:"native-runtime",roles:["operator"],profileId:binding.profileId},"approval",fence,undefined,false,true);if(!decision.allowed)throw new InteractionGuardError(decision.code);return;
    }
    if(!command)throw new InteractionGuardError("NATIVE_COMMAND_NOT_SENT");
    if(command?.type==="cancel"&&operation==="interrupt"){
      const record=this.database.getEntity<JsonValue>("native-cancel",fence.runId) as unknown as CancelRecord|undefined;
      if(!record||!isDeepStrictEqual(record.binding,binding)||!isDeepStrictEqual(record.fence,fence))throw new InteractionGuardError("STALE_CANCEL_AUTHORITY");
      this.assertCancelledStop(record);return;
    }
    if(command.type==="interrupt"&&operation==="interrupt"){
      const rows=this.database.handle.prepare("SELECT document_json FROM entities WHERE kind='native-handoff' AND json_extract(document_json,'$.interruptCommandId')=? LIMIT 2").all(command.id) as Array<{document_json:string}>;
      if(rows.length){
        const record=rows.length===1?JSON.parse(rows[0]!.document_json) as HandoffRecord:undefined;
        const parent=record?this.store.command(record.commandId):undefined;
        if(!record||record.phase!=="waiting"||record.settlePolicy!=="interrupt"||!isDeepStrictEqual(record.binding,binding)||command.state!=="SENDING"||command.actorId!==record.actorId||!isDeepStrictEqual(command.fence,fence)||!isDeepStrictEqual(fence,{...record.controlFence,commandId:command.id})||record.controlFence.expectedControlEpoch!==record.originalFence.expectedControlEpoch+1||record.controlFence.expectedControlRevision!==record.originalFence.expectedControlRevision+1||parent?.state!=="ACKNOWLEDGED"||parent.type!=="request-handoff"||parent.actorId!==record.actorId||!isDeepStrictEqual(parent.fence,record.originalFence))throw new InteractionGuardError("NATIVE_COMMAND_OUTCOME_UNKNOWN");
        const code=this.handoffAuthority(record);if(code)throw new InteractionGuardError(code);
        if(this.store.observation(fence.sessionId)?.scopeFingerprint!==record.scopeFingerprint)throw new InteractionGuardError("NATIVE_OBSERVATION_SCOPE_CHANGED");
        if(!Number.isFinite(Date.parse(record.deadline))||this.now().getTime()>=Date.parse(record.deadline))throw new InteractionGuardError("HANDOFF_TIMEOUT");
        if(this.handoffDrain(record)!=="settled"||this.hasUncertainCommand(fence.sessionId,command)||this.hasUnconfirmedNativeQueue(fence.sessionId))throw new InteractionGuardError("NATIVE_COMMAND_OUTCOME_UNKNOWN");
        return;
      }
    }
    if(command&&command.state!=="SENDING")throw new InteractionGuardError("NATIVE_COMMAND_OUTCOME_UNKNOWN");
    const principal={id:command.actorId,roles:["operator"],profileId:binding.profileId};
    const decision=this.evaluateInteraction(principal,operation,fence,command);if(!decision.allowed)throw new InteractionGuardError(decision.code);
  }
  acknowledgeTaskRevision(run:Run):void {
    const context=this.laneContext.getStore();
    if(context?.sessionId===run.sessionId)context.taskRevision=this.database.getCanonicalTask<JsonValue>(run.taskId)?.revision??0;
  }
  assertInteraction(principal:InteractionPrincipal,operation:ControllerInteractionOperation,fence:MutationFence):void {
    const context=this.laneContext.getStore();
    const mutation=!["history","access","collect"].includes(operation);
    if(mutation&&context?.sessionId===fence.sessionId&&context.ownsLane&&context.taskRevision!==undefined&&context.taskRevision!==fence.expectedTaskRevision)throw new InteractionGuardError("STALE_TASK_REVISION");
    const decision=this.authorizeInteraction(principal,operation,fence);
    if(!decision.allowed)throw new InteractionGuardError(decision.code);
    if(context?.sessionId===fence.sessionId&&context.ownsLane&&mutation){context.taskRevision??=fence.expectedTaskRevision;context.mutationAuthorized=true;if(operation==="verify")this.consumeReclaimAction(fence,"verify");}
  }
  authorizeStandaloneInput(principal:InteractionPrincipal,sessionId:string):GuardDecision {
    if(!principal.id||!principal.roles.some(role=>["operator","admin"].includes(role)))return {allowed:false,code:"FORBIDDEN"};
    const adapter=this.database.getEntity<JsonValue>("adapter-session",sessionId) as unknown as AdapterSession|undefined;
    if(!adapter||adapter.id!==sessionId||principal.profileId!==undefined&&adapter.profileId!==principal.profileId)return {allowed:false,code:"SESSION_OWNER_MISMATCH"};
    if(adapter.nativeIdentityIssue)return {allowed:false,code:adapter.nativeIdentityIssue};
    if(adapter.nativeBinding||this.store.control(sessionId)||this.database.getEntity("session",sessionId)||this.database.getEntity("run",adapter.runId)||this.store.diagnostics().some(entry=>entry.sessionId===sessionId&&entry.code!=="LEGACY_NATIVE_BINDING_MISSING"))return {allowed:false,code:"CANONICAL_RUN_REQUIRED"};
    return {allowed:true};
  }
  authorizeInteraction(principal:InteractionPrincipal,operation:ControllerInteractionOperation,fence:MutationFence):GuardDecision {
    return this.evaluateInteraction(principal,operation,fence);
  }
  private hasUncertainCommand(sessionId:string,own?:InteractionCommand):boolean {
    return Boolean(this.database.handle.prepare("SELECT 1 FROM interaction_commands WHERE session_id=? AND state IN ('SENDING','UNKNOWN') AND (id!=? OR state='UNKNOWN') LIMIT 1").get(sessionId,own?.id??""));
  }
  private hasUnconfirmedNativeQueue(sessionId:string):boolean {
    const rows=this.database.handle.prepare("SELECT document_json FROM interaction_commands WHERE session_id=? AND state='ACKNOWLEDGED' AND json_extract(document_json,'$.nativeReceipt.state')='queued' LIMIT 101").all(sessionId) as Array<{document_json:string}>;
    if(rows.length>100)return true;
    return rows.some(row=>{const command=JSON.parse(row.document_json) as InteractionCommand;return !["completed","failed"].includes(this.commandExecution(command,this.commandReceipt(command)));});
  }
  private evaluateInteraction(principal:InteractionPrincipal,operation:ControllerInteractionOperation,fence:MutationFence,own?:InteractionCommand,humanCancelConfirmed=false,metadataIngress=false):GuardDecision {
    const reject=(code:string):GuardDecision=>({allowed:false,code});
    if(own&&(own.state!=="SENDING"||own.actorId!==principal.id||own.id!==fence.commandId||own.type!==operation||!isDeepStrictEqual(own.fence,fence)||!isDeepStrictEqual(this.store.command(own.id),own)))return reject("NATIVE_COMMAND_OUTCOME_UNKNOWN");
    const read=["history","access","collect"].includes(operation);
    if(!principal.id||!(read?principal.roles.some(role=>["viewer","operator","admin"].includes(role)):principal.roles.some(role=>["operator","admin"].includes(role))))return reject("FORBIDDEN");
    const run=this.database.getEntity<JsonValue>("run",fence.runId) as unknown as Run|undefined;
    if(!run||run.sessionId!==fence.sessionId||principal.profileId!==undefined&&principal.profileId!==run.profileId)return reject("SESSION_OWNER_MISMATCH");
    const session=this.database.getEntity<JsonValue>("session",fence.sessionId) as unknown as Session|undefined;
    const adapter=this.database.getEntity<JsonValue>("adapter-session",fence.sessionId) as unknown as AdapterSession|undefined;
    // A lost legacy Runner start reply can leave only its reserved Run/lease.
    // Cancel may revoke that exact lease; all native session writes still need identity.
    const unstartedStop=operation==="cancel"&&run.sessionId===`unstarted:${run.id}`&&!session&&!adapter&&!this.store.control(run.sessionId)&&!this.store.binding(run.sessionId);
    if(session&&(session.profileId!==run.profileId||session.providerId!==run.providerId)||adapter&&(adapter.id!==run.sessionId||adapter.runId!==run.id||adapter.profileId!==run.profileId)||!session&&!adapter&&!unstartedStop)return reject("SESSION_OWNER_MISMATCH");
    if(read)return {allowed:true};
    if(run.revokedLeaseIds?.includes(run.leaseId)&&!["cancel","fail","cleanup-input","cleanup-start"].includes(operation))return reject("STALE_RUN_AUTHORITY");
    if(hasNativeExternalWriteBlocker(this.database,run))return reject("NATIVE_STATE_UNKNOWN");
    if(["continue","steer","approval","resume","advance","verify","deliver","reroute"].includes(operation)){try{this.assertDriftPolicy(run);const policy=this.database.getEntity<JsonValue>("native-drift-policy",run.id) as unknown as FrozenDriftPolicy|undefined;if(this.store.control(run.sessionId)?.state==="AUTOMATED"&&!policy?.policy.permissionFingerprint&&this.firstHumanEpoch(run.sessionId)!==null)return reject("NATIVE_POLICY_UNVERIFIED");}catch(error){return reject(error instanceof InteractionGuardError?error.code:"NATIVE_DRIFT_POLICY_INVALID");}}
    if(operation==="deliver"&&this.database.getEntity("native-verification-invalidation",run.id))return reject("NATIVE_REVERIFICATION_REQUIRED");
    const epoch=this.store.control(run.sessionId)?.epoch;
    // Corrupt TEXT has no trustworthy scope; keep it ahead of a valid choice rather than skipping it.
    const nextAction=this.database.handle.prepare("SELECT document_json FROM entities WHERE kind='native-reclaim-action' AND CASE WHEN json_valid(document_json) THEN json_extract(document_json,'$.runId')=? AND json_extract(document_json,'$.controlEpoch')=? AND json_extract(document_json,'$.state')='authorized' ELSE 1 END ORDER BY json_valid(document_json) LIMIT 1").get(run.id,epoch??0) as {document_json:string}|undefined;
    let choice:{action:"continue"|"verify"}|undefined;
    try{choice=nextAction?JSON.parse(nextAction.document_json) as {action:"continue"|"verify"}:undefined;}
    catch(error){if(error instanceof SyntaxError)return reject("NATIVE_RECLAIM_ACTION_MISMATCH");throw error;}
    if(choice&&(choice.action==="verify"&&["continue","steer","approval","resume","reroute"].includes(operation)||choice.action==="continue"&&operation==="verify"))return reject("NATIVE_RECLAIM_ACTION_MISMATCH");
    const external=this.database.getEntity<JsonValue>("native-external-checkpoint",run.sessionId) as unknown as {decision?:{kind:string;requiresReconcile:boolean}}|undefined;
    if(external?.decision?.kind==="unverified"&&external.decision.requiresReconcile&&!["cancel","fail","reject-approval"].includes(operation))return reject("NATIVE_STATE_UNKNOWN");
    if(adapter?.nativeIdentityIssue)return reject(adapter.nativeIdentityIssue);
    if(!["cancel","interrupt","reject-approval","request-handoff"].includes(operation)&&this.hasUnconfirmedNativeQueue(run.sessionId))return reject("NATIVE_COMMAND_QUEUE_UNCONFIRMED");
    const diagnostic=this.database.handle.prepare("SELECT code FROM native_identity_diagnostics WHERE session_id=? AND code!='LEGACY_NATIVE_BINDING_MISSING' LIMIT 1").get(run.sessionId) as {code:string}|undefined;
    if(diagnostic)return reject(diagnostic.code);
    const binding=this.store.binding(run.sessionId);
    if(binding){
      if(!session||!adapter)return reject("NATIVE_IDENTITY_CHANGED");
      const normalized=normalizeNativeBinding(session,adapter,run);
      if(normalized.state!=="bound"||!isDeepStrictEqual(normalized.binding,binding)||!isDeepStrictEqual(session.nativeBinding,binding)||!isDeepStrictEqual(adapter.nativeBinding,binding)||run.executionRef?.id!==binding.executionRefId)return reject("NATIVE_IDENTITY_CHANGED");
    }else if(session?.nativeBinding||adapter?.nativeBinding)return reject("NATIVE_BINDING_MISSING");
    const streamCheckpoint=this.database.getEntity<JsonValue>("native-event-checkpoint",run.sessionId) as unknown as NativeEventCheckpoint|undefined;
    if(streamCheckpoint&&(streamCheckpoint.needsSnapshot||streamCheckpoint.needsHistory)&&!["cancel","reject-approval","request-handoff"].includes(operation))return reject("NATIVE_STATE_UNKNOWN");
    if(operation==="cleanup-input"||operation==="cleanup-start"){
      // A stale answer may stop only the original Adapter execution. Never stop a handed-off writer.
      const control=this.store.control(run.sessionId);
      if(run.generation!==fence.generation||run.leaseId!==fence.leaseId)return reject("STALE_RUN_AUTHORITY");
      if((control?.revision??0)!==fence.expectedControlRevision||(control?.epoch??0)!==fence.expectedControlEpoch)return reject("STALE_CONTROL_REVISION");
      if(control&&control.state!=="AUTOMATED")return reject("NATIVE_WRITE_LOCKED");
      if(!adapter||(adapter.execution?.generation??run.generation)!==fence.generation||adapter.execution?.leaseId!==undefined&&adapter.execution.leaseId!==fence.leaseId)return reject("STALE_RUN_AUTHORITY");
      if(operation==="cleanup-start"){
        const start=this.startForRun(run.id);
        if(binding||run.executionRef||!start||!isDeepStrictEqual(start.fence,fence)||!["SENDING","UNKNOWN","ACKNOWLEDGED"].includes(start.state))return reject("NATIVE_IDENTITY_CHANGED");
        // Only this original start may be uncertain. Stopping its owned CLI does not settle its native outcome.
        if(this.database.handle.prepare("SELECT 1 FROM interaction_commands WHERE session_id=? AND state IN ('SENDING','UNKNOWN') AND id!=? LIMIT 1").get(run.sessionId,start.id))return reject("NATIVE_COMMAND_OUTCOME_UNKNOWN");
      }else if(this.hasUncertainCommand(run.sessionId,own))return reject("NATIVE_COMMAND_OUTCOME_UNKNOWN");
      return {allowed:true};
    }
    const task=this.database.getCanonicalTask<JsonValue>(run.taskId);
    if(!task||task.revision!==fence.expectedTaskRevision)return reject("STALE_TASK_REVISION");
    if(["DONE","FAILED","CANCELLED"].includes((task.document as {state:string}).state))return reject("TERMINAL_TASK");
    if((task.document as {currentRunId?:string}).currentRunId!==run.id||fence.expectedCurrentRunId!==run.id||run.generation!==fence.generation||run.leaseId!==fence.leaseId||!["fail","cancel"].includes(operation)&&run.leaseExpiresAt&&(!Number.isFinite(Date.parse(run.leaseExpiresAt))||Date.parse(run.leaseExpiresAt)<=this.now().getTime()))return reject("STALE_RUN_AUTHORITY");
    const storedControl=this.store.control(run.sessionId);
    if((storedControl?.revision??0)!==fence.expectedControlRevision||(storedControl?.epoch??0)!==fence.expectedControlEpoch)return reject("STALE_CONTROL_REVISION");
    const control:SessionControl=storedControl??{version:1,sessionId:run.sessionId,activeRunId:run.id,state:"AUTOMATED",exclusion:"none",revision:0,epoch:0,updatedAt:run.startedAt??""};
    if(operation==="request-handoff"){
      if(isTerminalRunState(run.state))return reject("TERMINAL_RUN");
      if(!binding||binding.identityState!=="bound"||control.activeRunId!==run.id)return reject("NATIVE_IDENTITY_CHANGED");
      if(control.state!=="AUTOMATED")return reject("NATIVE_WRITE_LOCKED");
      return control.exclusion==="none"?reject("NATIVE_CAPABILITY_UNSUPPORTED"):{allowed:true};
    }
    if(operation!=="cancel"&&this.hasUncertainCommand(run.sessionId,own))return reject("NATIVE_COMMAND_OUTCOME_UNKNOWN");
    const checkpoint=this.database.handle.prepare("SELECT control_epoch FROM native_observation_checkpoints WHERE session_id=?").get(run.sessionId) as {control_epoch:number}|undefined;
    const observation=binding&&checkpoint?.control_epoch===control.epoch?this.store.observation(run.sessionId):undefined;
    const nativeState=binding?(binding.identityState==="bound"?observation?.state??"unknown":binding.identityState==="missing"?"unknown":binding.identityState):operation==="pause"||operation==="steer"?"running":"idle";
    if(observation&&!["cancel","interrupt","fail","approval","reject-approval"].includes(operation)&&(observation.pendingTools!=="none"||observation.pendingApprovals!=="none"))return reject(observation.pendingTools==="unknown"||observation.pendingApprovals==="unknown"?"NATIVE_STATE_UNKNOWN":"SESSION_BUSY");
    if(["advance","resume","reroute","pause","fail"].includes(operation)){
      if(isTerminalRunState(run.state))return reject("TERMINAL_RUN");
      if(control.activeRunId!==run.id||control.sessionId!==run.sessionId)return reject("NATIVE_IDENTITY_CHANGED");
      if(control.state!=="AUTOMATED")return reject("NATIVE_WRITE_LOCKED");
      if(binding&&(nativeState==="unknown"||nativeState==="deleted"||nativeState==="unreachable"))return reject("NATIVE_STATE_UNKNOWN");
      if(operation==="resume"&&(!["WAITING_USER","RESOURCE_BLOCKED","RUNNER_UNAVAILABLE","SUSPECTED_STALL"].includes(run.state)||nativeState!=="idle"))return reject("RUN_PHASE_CONFLICT");
      if(operation==="pause"&&run.state!=="ACTIVE")return reject("RUN_PHASE_CONFLICT");
      return {allowed:true};
    }
    if(metadataIngress){
      // Qualified pending metadata may precede the first observation. This does not authorize a response.
      if(isTerminalRunState(run.state))return reject("TERMINAL_RUN");
      if(control.activeRunId!==run.id||control.sessionId!==run.sessionId)return reject("NATIVE_IDENTITY_CHANGED");
      if(control.state!=="AUTOMATED")return reject("NATIVE_WRITE_LOCKED");
      if(!["ACTIVE","WAITING_USER"].includes(run.state))return reject("RUN_PHASE_CONFLICT");
      if(observation&&["deleted","unreachable"].includes(observation.state))return reject("NATIVE_STATE_UNKNOWN");
      return {allowed:true};
    }
    return canMutate({control,run,nativeState,humanCancelConfirmed},operation as InteractionOperation);
  }

  cancellationForRun(runId:string):CancelResolution|undefined {return structuredClone((this.database.getEntity<JsonValue>("native-cancel",runId) as unknown as CancelRecord|undefined)?.resolution);}
  fenceForCancellation(run:Run,commandId:string,actorId:string):MutationFence {
    const record=this.database.getEntity<JsonValue>("native-cancel",run.id) as unknown as CancelRecord|undefined;
    return record?.actorId===actorId&&record.fence.commandId===commandId?structuredClone(record.fence):this.fenceFor(run,commandId);
  }
  assertCancellation(principal:InteractionPrincipal,fence:MutationFence,humanInterruptConfirmed=false):void {
    this.assertStopFence(fence);const decision=this.evaluateInteraction(principal,"cancel",fence,undefined,humanInterruptConfirmed);if(!decision.allowed)throw new InteractionGuardError(decision.code);
  }
  assertStoppedReroute(principal:InteractionPrincipal,fence:MutationFence):void {
    this.assertStopFence(fence);this.assertInteraction(principal,"collect",fence);
    if(!principal.roles.some(role=>["operator","admin"].includes(role)))throw new InteractionGuardError("FORBIDDEN");
    const run=this.database.getEntity<JsonValue>("run",fence.runId) as unknown as Run;
    const task=this.database.getCanonicalTask<JsonValue>(run.taskId),control=this.store.control(fence.sessionId);
    const adapter=this.database.getEntity<JsonValue>("adapter-session",fence.sessionId) as unknown as (AdapterSession&{authority?:{stopState?:string}})|undefined;
    if(run.state!=="SUPERSEDED"||run.generation!==fence.generation||run.leaseId!==fence.leaseId||!Array.isArray(run.revokedLeaseIds)||!run.revokedLeaseIds.includes(fence.leaseId))throw new InteractionGuardError("STALE_RUN_AUTHORITY");
    if(!task||task.revision!==fence.expectedTaskRevision||(task.document as {currentRunId?:string}).currentRunId!==run.id||fence.expectedCurrentRunId!==run.id||!["RUNNING","WAITING_USER","WAITING_RESOURCE"].includes((task.document as {state:string}).state))throw new InteractionGuardError("STALE_TASK_REVISION");
    if((control?.revision??0)!==fence.expectedControlRevision||(control?.epoch??0)!==fence.expectedControlEpoch)throw new InteractionGuardError("STALE_CONTROL_REVISION");
    if(control&&(control.state!=="AUTOMATED"||control.activeRunId!==run.id))throw new InteractionGuardError("NATIVE_WRITE_LOCKED");
    if(run.executionRef||adapter?.nativeBinding||this.store.binding(run.sessionId))throw new InteractionGuardError("NATIVE_CAPABILITY_UNVERIFIED");
    if(!adapter||adapter.runId!==run.id||adapter.profileId!==run.profileId||adapter.workspacePath!==run.worktree||adapter.authority?.stopState!=="confirmed"||!["CANCELLED","COMPLETED","FAILED"].includes(adapter.state)||adapter.execution&&(adapter.execution.generation!==run.generation||adapter.execution.leaseId!==run.leaseId||adapter.execution.attempt!==run.attempt))throw new InteractionGuardError("NATIVE_STOP_UNCONFIRMED");
    if(hasNativeExternalWriteBlocker(this.database,run)||this.hasUncertainCommand(run.sessionId)||this.hasUnconfirmedNativeQueue(run.sessionId))throw new InteractionGuardError("NATIVE_COMMAND_OUTCOME_UNKNOWN");
    this.assertDriftPolicy(run);
  }
  recordUnsentCancellation(principal:InteractionPrincipal,fence:MutationFence,humanInterruptConfirmed=false):CancelResolution {
    this.assertStopFence(fence);this.assertInteraction(principal,"collect",fence);
    const run=this.database.getEntity<JsonValue>("run",fence.runId) as unknown as Run;const task=this.database.getCanonicalTask<JsonValue>(run.taskId)!;
    if(this.startForRun(run.id)?.state!=="CANCELLED"||run.state!=="CANCELLED"||(task.document as {state:string}).state!=="CANCELLED")throw new InteractionGuardError("NATIVE_START_OUTCOME_UNKNOWN");
    const resolution:CancelResolution={version:1,runId:run.id,sessionId:run.sessionId,commandId:fence.commandId,state:"CANCELLED",nativeMayBeRunning:false,nativeStopProof:{version:1,state:"stopped",code:"NATIVE_START_NOT_SENT"}};
    this.database.saveEntity("native-cancel",run.id,json({version:1,actorId:principal.id,fence,humanInterruptConfirmed,taskRevision:task.revision,resolution} satisfies CancelRecord));return resolution;
  }
  occupiesCapacity(run:Run):boolean {return !isTerminalRunState(run.state)||this.cancellationForRun(run.id)?.nativeMayBeRunning===true;}
  private settleStopCommand(commandId:string,receipt:NativeCommandReceipt):void {
    const command=this.store.command(commandId);
    if(command?.state==="SENDING")this.store.updateCommand({id:command.id,expectedRevision:command.revision,state:receipt.state==="unknown"?"UNKNOWN":receipt.state==="rejected"?"FAILED":"ACKNOWLEDGED",nativeReceipt:receipt});
  }
  private invalidateStopRead(sessionId:string):void {
    const binding=this.store.binding(sessionId);if(!binding)return;
    const scope=this.store.observation(sessionId)?.scopeFingerprint??"unknown";
    this.store.invalidateObservation({sessionId,readBarrier:randomUUID(),observation:{version:1,id:`stop-read:${randomUUID()}`,nativeSessionId:binding.nativeSessionId,...(binding.nativeThreadId?{nativeThreadId:binding.nativeThreadId}:{}),executionRefId:binding.executionRefId,scopeFingerprint:scope,observedAt:this.now().toISOString(),state:"unknown",pendingTools:"unknown",pendingApprovals:"unknown",historyMode:"unknown"}});
  }
  private assertCancelledStop(record:CancelRecord,source?:NativeStopSource):void {
    const run=this.database.getEntity<JsonValue>("run",record.fence.runId) as unknown as Run|undefined;const control=this.store.control(record.fence.sessionId);const task=run?this.database.getCanonicalTask<JsonValue>(run.taskId):undefined;
    if(!run||run.state!=="CANCELLED"||run.sessionId!==record.fence.sessionId||run.generation!==record.fence.generation||run.leaseId!==record.fence.leaseId||task?.revision!==record.taskRevision||(task.document as {currentRunId?:string;state:string}).currentRunId!==run.id||(task.document as {state:string}).state!=="CANCELLED"||(control?.epoch??0)!==record.fence.expectedControlEpoch||(control?.revision??0)!==record.fence.expectedControlRevision)throw new InteractionGuardError("STALE_CANCEL_AUTHORITY");
    if(source&&(!isDeepStrictEqual(this.store.binding(run.sessionId),record.binding)||!isDeepStrictEqual(source.binding,record.binding)||source.scopeFingerprint!==record.scopeFingerprint))throw new InteractionGuardError("NATIVE_STOP_SCOPE_CHANGED");
    if(record.binding){const command=this.store.command(record.fence.commandId);if(command?.state!=="SENDING"||command.type!=="cancel"||command.actorId!==record.actorId||!isDeepStrictEqual(command.fence,record.fence))throw new InteractionGuardError("NATIVE_COMMAND_OUTCOME_UNKNOWN");}
  }
  private assertStopFence(fence:MutationFence):void {
    if(!fence||![fence.runId,fence.sessionId,fence.expectedCurrentRunId,fence.leaseId,fence.commandId].every(isSafeNativeMetadataId)||fence.commandId.length>200||![fence.generation,fence.expectedTaskRevision].every(n=>Number.isSafeInteger(n)&&n>=1)||![fence.expectedControlRevision,fence.expectedControlEpoch].every(n=>Number.isSafeInteger(n)&&n>=0))throw new InteractionGuardError("INVALID_INTERACTION_FENCE");
  }
  /** The trusted synchronous commit revokes Run/Task authority in the same transaction as intent. */
  async cancelRun(principalInput:InteractionPrincipal,fenceInput:MutationFence,commitCancellation:()=>void,source?:NativeStopSource,options:{humanInterruptConfirmed?:boolean;legacyCancel?:()=>Promise<unknown>}={}):Promise<CancelResolution> {
    const principal=structuredClone(principalInput);const fence=structuredClone(fenceInput);const confirmed=options.humanInterruptConfirmed===true;const legacyCancel=options.legacyCancel;
    this.assertStopFence(fence);
    this.assertInteraction(principal,"collect",fence);
    const prior=this.database.getEntity<JsonValue>("native-cancel",fence.runId) as unknown as CancelRecord|undefined;
    if(prior){if(prior.actorId!==principal.id||!isDeepStrictEqual(prior.fence,fence)||prior.humanInterruptConfirmed!==confirmed)throw new InteractionGuardError("IDEMPOTENCY_CONFLICT");return structuredClone(prior.resolution);}
    const record=this.database.transaction(()=>{
      const decision=this.evaluateInteraction(principal,"cancel",fence,undefined,confirmed);if(!decision.allowed)throw new InteractionGuardError(decision.code);
      const run=this.database.getEntity<JsonValue>("run",fence.runId) as unknown as Run;const binding=this.store.binding(fence.sessionId);const observation=this.store.observation(fence.sessionId);
      const resolution:CancelResolution={version:1,runId:run.id,sessionId:run.sessionId,commandId:fence.commandId,state:"CANCELLED",nativeMayBeRunning:true,nativeStopProof:{version:1,state:"unknown",code:"NATIVE_STOP_UNCONFIRMED"}};
      if(binding){const reserved=this.store.reserveCommand({id:fence.commandId,actorId:principal.id,profileId:run.profileId,type:"cancel",fence,semantics:json({binding,humanInterruptConfirmed:confirmed,activeTurnId:observation?.activeTurnId??null})});if(reserved.state!=="RESERVED")throw new InteractionGuardError("IDEMPOTENCY_CONFLICT");this.store.updateCommand({id:reserved.id,expectedRevision:reserved.revision,state:"SENDING"});}
      commitCancellation();
      const task=this.database.getCanonicalTask<JsonValue>(run.taskId)!;
      const record:CancelRecord={version:1,actorId:principal.id,fence,humanInterruptConfirmed:confirmed,taskRevision:task.revision,...(binding?{binding}:{}),...(observation?{scopeFingerprint:observation.scopeFingerprint,...(observation.activeTurnId?{activeTurnId:observation.activeTurnId}:{})}:{}),resolution};
      this.assertCancelledStop(record);this.database.saveEntity("native-cancel",run.id,json(record));this.invalidateStopRead(run.sessionId);return record;
    });
    return this.withMutationLane(fence.sessionId,async()=>{
      let result:NativeStopResult={receipt:{version:1,commandId:fence.commandId,state:"rejected"},nativeStopProof:{version:1,state:"unknown",code:"NATIVE_CAPABILITY_UNVERIFIED"}};
      if(record.binding&&source)result=await interruptNativeSession(source,{commandId:fence.commandId,fence,...(record.activeTurnId?{activeTurnId:record.activeTurnId}:{})},()=>this.assertCancelledStop(record,source));
      else if(!record.binding&&legacyCancel){let timer:ReturnType<typeof setTimeout>|undefined;try{this.assertCancelledStop(record);await Promise.race([legacyCancel(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("timeout")),5_000);})]);}catch{/* A legacy local flag supplies no native stop proof. */}finally{if(timer)clearTimeout(timer);}}
      return this.database.transaction(()=>{
        if(result.nativeStopProof.state==="stopped"){try{this.assertCancelledStop(record,source);}catch{result={receipt:result.receipt,nativeStopProof:{version:1,state:"unknown",code:"STALE_CANCEL_AUTHORITY"}};}}
        const resolution:CancelResolution={...record.resolution,receipt:result.receipt,nativeStopProof:result.nativeStopProof,nativeMayBeRunning:result.nativeStopProof.state!=="stopped"};
        this.settleStopCommand(fence.commandId,result.receipt);this.database.saveEntity("native-cancel",fence.runId,json({...record,resolution}));return resolution;
      });
    });
  }
  async interruptTurn(principalInput:InteractionPrincipal,fenceInput:MutationFence,source:NativeStopSource):Promise<NativeCommandReceipt> {
    const principal=structuredClone(principalInput);const fence=structuredClone(fenceInput);
    this.assertStopFence(fence);
    return this.withMutationLane(fence.sessionId,async()=>{
      this.assertInteraction(principal,"collect",fence);
      const existing=this.store.command(fence.commandId);
      if(existing){if(existing.actorId!==principal.id||existing.type!=="interrupt"||!isDeepStrictEqual(existing.fence,fence))throw new InteractionGuardError("IDEMPOTENCY_CONFLICT");return this.commandReceipt(existing);}
      this.assertInteraction(principal,"interrupt",fence);
      const binding=this.store.binding(fence.sessionId);const observation=this.store.observation(fence.sessionId);
      if(!binding||!isDeepStrictEqual(binding,source.binding)||observation?.scopeFingerprint!==source.scopeFingerprint)throw new InteractionGuardError("NATIVE_STOP_SCOPE_CHANGED");
      const sending=this.database.transaction(()=>{const reserved=this.store.reserveCommand({id:fence.commandId,actorId:principal.id,profileId:binding.profileId,type:"interrupt",fence,semantics:json({binding,scopeFingerprint:source.scopeFingerprint,activeTurnId:observation.activeTurnId??null})});return this.store.updateCommand({id:reserved.id,expectedRevision:reserved.revision,state:"SENDING"});});
      const result=await interruptNativeSession(source,{commandId:fence.commandId,fence,...(observation.activeTurnId?{activeTurnId:observation.activeTurnId}:{})},()=>{const decision=this.evaluateInteraction(principal,"interrupt",fence,sending);if(!decision.allowed)throw new InteractionGuardError(decision.code);});
      this.database.transaction(()=>{this.settleStopCommand(fence.commandId,result.receipt);this.invalidateStopRead(fence.sessionId);});return result.receipt;
    });
  }

  requestHandoff(input:HandoffRequest):NativeCommandReceipt {
    const principal=structuredClone(input.principal);const fence=structuredClone(input.fence);
    const timeoutMs=input.timeoutMs??30_000;
    normalizeInteractionCommand({type:"continue",commandId:fence.commandId,message:"handoff"});
    if(!["wait","interrupt"].includes(input.settlePolicy)||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30_000)throw new InteractionGuardError("INVALID_HANDOFF_REQUEST");
    if(!principal.roles.some(role=>["operator","admin"].includes(role)))throw new InteractionGuardError("FORBIDDEN");
    return this.database.transaction(()=>{
      this.assertInteraction(principal,"collect",fence);
      const run=this.database.getEntity<JsonValue>("run",fence.runId) as unknown as Run;
      const prior=this.handoffRecord(fence.commandId);
      if(!prior)this.assertInteraction(principal,"request-handoff",fence);
      const reserved=this.store.reserveCommand({id:fence.commandId,actorId:principal.id,profileId:run.profileId,type:"request-handoff",fence,semantics:{version:1,settlePolicy:input.settlePolicy,timeoutMs}});
      if(prior)return this.commandReceipt(reserved);
      const binding=this.store.binding(fence.sessionId)!;
      const scopeFingerprint=this.store.observation(fence.sessionId)?.scopeFingerprint;
      if(!scopeFingerprint)throw new InteractionGuardError("NATIVE_OBSERVATION_SCOPE_CHANGED");
      const rows=this.pendingMutations(fence.sessionId);
      if(rows.length>200)throw new InteractionGuardError("INFLIGHT_LIMIT_EXCEEDED");
      this.freezeDriftPolicy(run,this.firstHumanEpoch(fence.sessionId)===null?this.store.observation(fence.sessionId)?.permissionFingerprint:undefined);
      const sending=this.store.updateCommand({id:reserved.id,expectedRevision:reserved.revision,state:"SENDING"});
      const control=this.store.compareAndSwapControl({sessionId:fence.sessionId,expectedRevision:fence.expectedControlRevision,expectedEpoch:fence.expectedControlEpoch,actorId:principal.id,event:{type:"request-handoff",principalId:principal.id,at:this.now().toISOString()}});
      const record:HandoffRecord={version:1,commandId:fence.commandId,actorId:principal.id,originalFence:fence,controlFence:{...fence,expectedControlRevision:control.revision,expectedControlEpoch:control.epoch},binding,scopeFingerprint,settlePolicy:input.settlePolicy,deadline:new Date(this.now().getTime()+timeoutMs).toISOString(),phase:"waiting",drainRefs:rows.map(row=>row.id)};
      this.database.saveEntity("native-handoff",record.commandId,json(record));
      this.invalidateHandoffRead(record);
      this.saveControlNotice(record,control);
      const receipt:NativeCommandReceipt={version:1,commandId:record.commandId,state:"accepted",code:"HANDOFF_REQUEST_ACCEPTED"};
      this.store.updateCommand({id:sending.id,expectedRevision:sending.revision,state:"ACKNOWLEDGED",nativeReceipt:receipt});return receipt;
    });
  }
  private handoffRecord(commandId:string):HandoffRecord|undefined {return this.database.getEntity<JsonValue>("native-handoff",commandId) as unknown as HandoffRecord|undefined;}
  expireHandoffs(limit=25):{selected:number;expired:number;rejected:number} {
    if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new InteractionGuardError("INVALID_HANDOFF_EXPIRY_LIMIT");
    const at=this.now().toISOString();
    const query=this.database.handle.prepare(`WITH bounded AS (
      SELECT id,CASE WHEN length(CAST(document_json AS BLOB))<=65536 AND json_valid(document_json) THEN document_json ELSE '{}' END AS document_json
      FROM entities WHERE kind='native-handoff'
    ) SELECT id,document_json FROM bounded
      WHERE id>? AND json_extract(document_json,'$.phase') IN ('waiting','awaiting-release') AND julianday(json_extract(document_json,'$.deadline'))<=julianday(?)
      ORDER BY id LIMIT ?`);
    let rows=query.all(this.handoffExpiryCursor??"",at,limit) as Array<{id:string;document_json:string}>;
    if(!rows.length&&this.handoffExpiryCursor!==undefined){this.handoffExpiryCursor=undefined;rows=query.all("",at,limit) as typeof rows;}
    const recordRead=this.database.handle.prepare("SELECT CASE WHEN length(CAST(document_json AS BLOB))<=65536 AND json_valid(document_json) THEN document_json ELSE NULL END AS document_json FROM entities WHERE kind='native-handoff' AND id=?");
    const parentRead=this.database.handle.prepare("SELECT CASE WHEN length(CAST(document_json AS BLOB))<=65536 AND json_valid(document_json) THEN document_json ELSE NULL END AS document_json FROM interaction_commands WHERE id=?");
    const result={selected:rows.length,expired:0,rejected:0};
    for(const row of rows){
      const applied=this.database.transaction(()=>{
        const stored=recordRead.get(row.id) as {document_json:string|null}|undefined,parentStored=parentRead.get(row.id) as {document_json:string|null}|undefined;
        if(typeof stored?.document_json!=="string"||typeof parentStored?.document_json!=="string")return false;
        const record=JSON.parse(stored.document_json) as HandoffRecord,original=record?.originalFence,controlFence=record?.controlFence,parent=JSON.parse(parentStored.document_json) as InteractionCommand;
        // The worker can only fail an existing accepted intent; it cannot borrow an
        // actor's roles or acquire authority to interrupt/release a provider.
        if(!record||record.version!==1||record.commandId!==row.id||!isSafeNativeMetadataId(record.actorId)||!isSafeNativeMetadataId(record.scopeFingerprint)||!["wait","interrupt"].includes(record.settlePolicy)||!["waiting","awaiting-release"].includes(record.phase)||typeof record.deadline!=="string"||!Number.isFinite(Date.parse(record.deadline))||Date.parse(record.deadline)>Date.parse(at)||!Array.isArray(record.drainRefs)||record.drainRefs.length>200||record.drainRefs.some(id=>!isSafeNativeMetadataId(id))||!original||original.commandId!==row.id||!controlFence||!parent||parent.id!==row.id||parent.state!=="ACKNOWLEDGED"||parent.type!=="request-handoff"||parent.actorId!==record.actorId||parent.profileId!==record.binding?.profileId||parent.nativeReceipt?.state!=="accepted"||parent.nativeReceipt.commandId!==row.id||parent.nativeReceipt.code!=="HANDOFF_REQUEST_ACCEPTED"||!isDeepStrictEqual(parent.fence,original)||!isDeepStrictEqual(controlFence,{...original,expectedControlRevision:original.expectedControlRevision+1,expectedControlEpoch:original.expectedControlEpoch+1})||!this.store.control(controlFence.sessionId))return false;
        const stale=this.handoffAuthority(record);
        this.stopHandoff(record,stale?"conflict":"failed",stale??"HANDOFF_TIMEOUT",false);return true;
      });
      if(applied)result.expired++;else result.rejected++;
      // A rejected legacy/corrupt record must not occupy every bounded cycle.
      this.handoffExpiryCursor=row.id;
    }
    return result;
  }
  private pendingMutations(sessionId:string):MutationRecord[] {
    return (this.database.handle.prepare("SELECT document_json FROM entities WHERE kind='native-mutation' AND json_extract(document_json,'$.sessionId')=? AND json_extract(document_json,'$.state')!='settled' LIMIT 201").all(sessionId) as Array<{document_json:string}>).map(row=>JSON.parse(row.document_json) as MutationRecord);
  }
  private authorizeHandoff(principal:InteractionPrincipal,commandId:string):HandoffRecord {
    const record=this.handoffRecord(commandId);if(!record)throw new InteractionGuardError("HANDOFF_NOT_FOUND");
    if(!principal.roles.some(role=>["operator","admin"].includes(role))||principal.id!==record.actorId&&!principal.roles.includes("admin"))throw new InteractionGuardError("FORBIDDEN");
    this.assertInteraction(principal,"collect",record.originalFence);return record;
  }
  private handoffAuthority(record:HandoffRecord):string|undefined {
    const fence=record.controlFence;const control=this.store.control(fence.sessionId);
    if(control?.state!=="HANDOFF_REQUESTED"||control.epoch!==fence.expectedControlEpoch||control.revision!==fence.expectedControlRevision)return "STALE_CONTROL_REVISION";
    const run=this.database.getEntity<JsonValue>("run",fence.runId) as unknown as Run|undefined;
    const task=run?this.database.getCanonicalTask<JsonValue>(run.taskId):undefined;
    if(!run||isTerminalRunState(run.state)||run.sessionId!==fence.sessionId||control.activeRunId!==run.id||run.generation!==fence.generation||run.leaseId!==fence.leaseId||(task?.document as {currentRunId?:string}|undefined)?.currentRunId!==run.id||run.leaseExpiresAt&&(!Number.isFinite(Date.parse(run.leaseExpiresAt))||Date.parse(run.leaseExpiresAt)<=this.now().getTime()))return "STALE_RUN_AUTHORITY";
    if(task?.revision!==fence.expectedTaskRevision)return "STALE_TASK_REVISION";
    const session=this.database.getEntity<JsonValue>("session",fence.sessionId) as unknown as Session|undefined;
    const adapter=this.database.getEntity<JsonValue>("adapter-session",fence.sessionId) as unknown as AdapterSession|undefined;
    if(!session||!adapter||adapter.nativeIdentityIssue||!isDeepStrictEqual(normalizeNativeBinding(session,adapter,run),{state:"bound",binding:record.binding})||!isDeepStrictEqual(this.store.binding(fence.sessionId),record.binding))return "NATIVE_IDENTITY_CHANGED";
    return undefined;
  }
  private invalidateHandoffRead(record:HandoffRecord):void {
    this.store.invalidateObservation({sessionId:record.controlFence.sessionId,readBarrier:randomUUID(),observation:{version:1,id:`handoff-read:${randomUUID()}`,nativeSessionId:record.binding.nativeSessionId,...(record.binding.nativeThreadId?{nativeThreadId:record.binding.nativeThreadId}:{}),scopeFingerprint:record.scopeFingerprint,observedAt:this.now().toISOString(),state:"unknown",pendingTools:"unknown",pendingApprovals:"unknown",historyMode:"unknown",executionRefId:record.binding.executionRefId,readability:"unknown"}});
  }
  private saveControlNotice(record:HandoffRecord,control:SessionControl):void {
    // Metadata-only durable notice intent; HTTP/SSE/connector delivery is composed separately.
    const id=`${record.commandId}:${control.revision}:${record.phase}`;
    this.database.saveEntity("native-control-outbox",id,json({version:1,id,state:"pending",commandId:record.commandId,sessionId:control.sessionId,runId:control.activeRunId,controlState:control.state,controlEpoch:control.epoch,controlRevision:control.revision,phase:record.phase,...(record.code?{code:record.code}:{})}));
  }
  private handoffDrain(record:HandoffRecord):HandoffSnapshot["drain"] {
    const rows=this.pendingMutations(record.controlFence.sessionId);
    if(rows.length>200||rows.some(row=>row.state==="unknown"||!this.activeMutations.has(row.id)))return "unknown";
    for(const id of record.drainRefs){const fact=this.database.getEntity<JsonValue>("native-mutation",id) as unknown as MutationRecord|undefined;if(!fact||fact.state==="unknown"||fact.state==="active"&&!this.activeMutations.has(id))return "unknown";}
    return rows.length?"pending":"settled";
  }
  private handoffSnapshot(record:HandoffRecord,code=record.code,readDrain=true):HandoffSnapshot {
    return {commandId:record.commandId,phase:record.phase,control:this.store.control(record.controlFence.sessionId)!,drain:readDrain?this.handoffDrain(record):"unknown",...(code?{code}:{})};
  }
  private waitHandoff(record:HandoffRecord,code:string):HandoffSnapshot {
    const latest=this.handoffRecord(record.commandId)!;
    if(["failed","conflict","cancelled","human"].includes(latest.phase))return this.handoffSnapshot(latest);
    const waiting:HandoffRecord={...latest,phase:"waiting",code};this.database.saveEntity("native-handoff",record.commandId,json(waiting));return this.handoffSnapshot(waiting);
  }
  private stopHandoff(record:HandoffRecord,phase:"failed"|"conflict"|"cancelled",code:string,readDrain=true):HandoffSnapshot {
    return this.database.transaction(()=>{
      const latest=this.handoffRecord(record.commandId)!;if(["failed","conflict","cancelled","human"].includes(latest.phase))return this.handoffSnapshot(latest,latest.code,readDrain);
      const control=this.store.control(record.controlFence.sessionId)!;
      const next=control.state==="HANDOFF_REQUESTED"&&control.revision===record.controlFence.expectedControlRevision&&control.epoch===record.controlFence.expectedControlEpoch?this.store.compareAndSwapControl({sessionId:control.sessionId,expectedRevision:control.revision,expectedEpoch:control.epoch,actorId:record.actorId,event:{type:phase==="cancelled"?"cancel-handoff":"conflict",at:this.now().toISOString()}}):control;
      const stopped:HandoffRecord={...latest,phase,code};this.database.saveEntity("native-handoff",record.commandId,json(stopped));this.saveControlNotice(stopped,next);return this.handoffSnapshot(stopped,stopped.code,readDrain);
    });
  }
  cancelHandoff(principal:InteractionPrincipal,commandId:string,fenceInput:MutationFence):HandoffSnapshot {
    const record=this.authorizeHandoff(principal,commandId);const fence=structuredClone(fenceInput);
    if(!isDeepStrictEqual(fence,record.controlFence))throw new InteractionGuardError("STALE_CONTROL_REVISION");
    if(record.phase==="cancelled")return this.handoffSnapshot(record);
    const code=this.handoffAuthority(record);if(code)throw new InteractionGuardError(code);
    return this.stopHandoff(record,"cancelled","HANDOFF_CANCELLED_RECONCILE_REQUIRED");
  }
  async advanceHandoff(principalInput:InteractionPrincipal,commandId:string,source?:HandoffInterruptSource):Promise<HandoffSnapshot> {
    const principal=structuredClone(principalInput);let record=this.authorizeHandoff(principal,commandId);
    const ended=()=>["failed","conflict","cancelled","human"].includes(record.phase);
    if(ended())return this.handoffSnapshot(record);
    const check=()=>this.handoffAuthority(record);
    const stale=check();if(stale)return this.stopHandoff(record,"conflict",stale);
    if(this.now().getTime()>=Date.parse(record.deadline))return this.stopHandoff(record,"failed","HANDOFF_TIMEOUT");
    if(this.handoffDrain(record)==="unknown")return this.stopHandoff(record,"conflict","INFLIGHT_OUTCOME_UNKNOWN");
    const waitDeadline=performance.now()+Math.min(30_000,Math.max(1,Date.parse(record.deadline)-this.now().getTime()));
    let drainTimedOut=false;
    while(this.handoffDrain(record)==="pending"){
      const pending=this.lanes.get(record.controlFence.sessionId);
      const remaining=Math.min(waitDeadline-performance.now(),Date.parse(record.deadline)-this.now().getTime());
      if(!pending||remaining<=0){drainTimedOut=true;break;}
      let timer:ReturnType<typeof setTimeout>|undefined;
      try{await Promise.race([pending.catch(()=>undefined),new Promise<void>(resolve=>{timer=setTimeout(()=>{drainTimedOut=true;resolve();},remaining);})]);}
      finally{if(timer)clearTimeout(timer);}
      if(drainTimedOut)break;
    }
    record=this.authorizeHandoff(principal,commandId);if(ended())return this.handoffSnapshot(record);
    const drift=check();if(drift)return this.stopHandoff(record,"conflict",drift);
    if(this.now().getTime()>=Date.parse(record.deadline)||drainTimedOut)return this.stopHandoff(record,"failed","HANDOFF_TIMEOUT");
    if(this.handoffDrain(record)==="unknown")return this.stopHandoff(record,"conflict","INFLIGHT_OUTCOME_UNKNOWN");
    if(this.hasUncertainCommand(record.controlFence.sessionId))return this.waitHandoff(record,"NATIVE_COMMAND_OUTCOME_UNKNOWN");
    if(this.hasUnconfirmedNativeQueue(record.controlFence.sessionId))return this.waitHandoff(record,"NATIVE_COMMAND_QUEUE_UNCONFIRMED");
    const checkpoint=this.database.handle.prepare("SELECT control_epoch FROM native_observation_checkpoints WHERE session_id=?").get(record.controlFence.sessionId) as {control_epoch:number}|undefined;
    const observation=this.store.observation(record.controlFence.sessionId);
    if(checkpoint?.control_epoch!==record.controlFence.expectedControlEpoch||!observation||observation.nativeSessionId!==record.binding.nativeSessionId||observation.scopeFingerprint!==record.scopeFingerprint||["unknown","unreachable","deleted"].includes(observation.state))return this.waitHandoff(record,"NATIVE_STATE_UNKNOWN");
    if(record.settlePolicy==="interrupt"&&observation.state==="running"&&!record.interruptCommandId){
      let interrupt:NativeInteractionPort["interrupt"];
      try{
        if(source&&isDeepStrictEqual(source.binding,record.binding)&&source.scopeFingerprint===record.scopeFingerprint&&assessInteractionCapability(source.interruptWithoutResume,record.scopeFingerprint,"runtime-verified").supported&&assessInteractionCapability(source.port.capabilities().interruptTurn,record.scopeFingerprint,"runtime-verified").supported)interrupt=source.port.interrupt?.bind(source.port);
        if(!source||!isDeepStrictEqual(source.binding,record.binding)||source.scopeFingerprint!==record.scopeFingerprint||!assessInteractionCapability(source.interruptWithoutResume,record.scopeFingerprint,"runtime-verified").supported)interrupt=undefined;
      }catch{interrupt=undefined;}
      if(!interrupt)return this.waitHandoff(record,"NATIVE_CAPABILITY_UNVERIFIED");
      const interruptId=`handoff-interrupt:${randomUUID()}`;const fence={...record.controlFence,commandId:interruptId};
      const sending=this.database.transaction(()=>{
        const current=this.handoffRecord(commandId)!;if(current.interruptCommandId)return undefined;
        const rejected=this.handoffAuthority(current);if(rejected)throw new InteractionGuardError(rejected);
        const reserved=this.store.reserveCommand({id:interruptId,actorId:record.actorId,profileId:record.binding.profileId,type:"interrupt",fence,semantics:json({binding:record.binding,scopeFingerprint:record.scopeFingerprint,activeTurnId:observation.activeTurnId??null,withoutResume:true})});
        const sent=this.store.updateCommand({id:interruptId,expectedRevision:reserved.revision,state:"SENDING"});record={...current,interruptCommandId:interruptId};this.database.saveEntity("native-handoff",commandId,json(record));return sent;
      });
      if(sending){let timer:ReturnType<typeof setTimeout>|undefined;let receipt:NativeCommandReceipt;
        try{const raw=await Promise.race([interrupt(structuredClone(record.binding),{commandId:interruptId,fence, ...(observation.activeTurnId?{activeTurnId:observation.activeTurnId}:{})}),new Promise<undefined>(resolve=>{timer=setTimeout(()=>resolve(undefined),Math.min(5_000,Math.max(1,Date.parse(record.deadline)-this.now().getTime())));})]);receipt={version:1,commandId:interruptId,state:raw?.version===1&&raw.commandId===interruptId&&["accepted","queued","rejected","unknown"].includes(raw.state)?raw.state:"unknown"};}
        catch{receipt={version:1,commandId:interruptId,state:"unknown"};}finally{if(timer)clearTimeout(timer);}
        this.database.transaction(()=>{const current=this.store.command(interruptId)!;if(current.state==="SENDING")this.store.updateCommand({id:interruptId,expectedRevision:current.revision,state:receipt.state==="unknown"?"UNKNOWN":receipt.state==="rejected"?"FAILED":"ACKNOWLEDGED",nativeReceipt:receipt});if(isDeepStrictEqual(this.store.binding(record.controlFence.sessionId),record.binding))this.invalidateHandoffRead(record);});
      }
      record=this.authorizeHandoff(principal,commandId);if(ended())return this.handoffSnapshot(record);
      const changed=check();if(changed)return this.stopHandoff(record,"conflict",changed);
      if(this.now().getTime()>=Date.parse(record.deadline))return this.stopHandoff(record,"failed","HANDOFF_TIMEOUT");
      return this.waitHandoff(record,"NATIVE_STATE_UNKNOWN");
    }
    if(observation.state!=="idle"||observation.activeTurnId||observation.pendingTools!=="none"||observation.pendingApprovals!=="none")return this.waitHandoff(record,observation.pendingTools==="unknown"||observation.pendingApprovals==="unknown"?"NATIVE_STATE_UNKNOWN":"SESSION_BUSY");
    // A fresh idle snapshot alone cannot release the native writer.
    record={...record,phase:"awaiting-release"};delete record.code;
    return this.database.transaction(()=>{this.database.saveEntity("native-handoff",commandId,json(record));this.saveControlNotice(record,this.store.control(record.controlFence.sessionId)!);return this.handoffSnapshot(record);});
  }

  async releaseHandoff(principalInput:InteractionPrincipal,commandId:string,source:NativeReleaseSource):Promise<HandoffSnapshot> {
    const principal=structuredClone(principalInput);let record=this.authorizeHandoff(principal,commandId);
    if(["human","failed","conflict","cancelled"].includes(record.phase))return this.handoffSnapshot(record);
    if(record.releaseCommandId)return this.now().getTime()>=Date.parse(record.deadline)?this.stopHandoff(record,"failed","HANDOFF_TIMEOUT"):this.waitHandoff(record,"NATIVE_RELEASE_OUTCOME_UNKNOWN");
    const ready=await this.advanceHandoff(principal,commandId);if(ready.phase!=="awaiting-release")return ready;
    record=this.authorizeHandoff(principal,commandId);
    if(!isDeepStrictEqual(source.binding,record.binding)||source.scopeFingerprint!==record.scopeFingerprint)return this.stopHandoff(record,"conflict","NATIVE_RELEASE_SCOPE_CHANGED");
    const releaseId=`handoff-release:${randomUUID()}`;
    const fence={...record.controlFence,commandId:releaseId};
    const sending=this.database.transaction(()=>{
      const current=this.handoffRecord(commandId)!;if(current.releaseCommandId)return undefined;
      const code=this.handoffAuthority(current);if(code)throw new InteractionGuardError(code);
      if(this.handoffDrain(current)!=="settled"||this.hasUncertainCommand(fence.sessionId)||this.hasUnconfirmedNativeQueue(fence.sessionId))throw new InteractionGuardError("NATIVE_RELEASE_OUTCOME_UNKNOWN");
      const control=this.store.control(fence.sessionId)!;
      const reserved=this.store.reserveCommand({id:releaseId,actorId:current.actorId,profileId:current.binding.profileId,type:"release-control",fence,semantics:json({binding:current.binding,scopeFingerprint:current.scopeFingerprint,mode:control.exclusion,settlePolicy:current.settlePolicy})});
      const sent=this.store.updateCommand({id:releaseId,expectedRevision:reserved.revision,state:"SENDING"});record={...current,releaseCommandId:releaseId};this.database.saveEntity("native-handoff",commandId,json(record));this.invalidateHandoffRead(record);return sent;
    });
    if(!sending)return this.handoffSnapshot(this.handoffRecord(commandId)!);
    const readBarrier=this.captureNativeReadBarrier(fence.sessionId);
    const mode=this.store.control(fence.sessionId)!.exclusion;
    const result=await releaseNativeControl(record.binding,mode,{commandId:releaseId,fence,settlePolicy:record.settlePolicy},source,()=>{
      const current=this.authorizeHandoff(principal,commandId);const code=this.handoffAuthority(current);if(code)throw new InteractionGuardError(code);
      if(current.releaseCommandId!==releaseId||this.store.command(releaseId)?.state!=="SENDING"||this.handoffDrain(current)!=="settled"||this.hasUncertainCommand(fence.sessionId,sending)||this.hasUnconfirmedNativeQueue(fence.sessionId))throw new InteractionGuardError("NATIVE_RELEASE_OUTCOME_UNKNOWN");
    },Math.min(5_000,Math.max(1,Date.parse(record.deadline)-this.now().getTime())));
    return this.database.transaction(()=>{
      const command=this.store.command(releaseId)!;
      if(command.state==="SENDING")this.store.updateCommand({id:releaseId,expectedRevision:command.revision,state:result.dispatch==="unknown"?"UNKNOWN":result.dispatch==="not-sent"?"FAILED":"ACKNOWLEDGED",nativeReceipt:{version:1,commandId:releaseId,state:result.dispatch==="unknown"?"unknown":result.dispatch==="not-sent"?"rejected":"accepted",...(result.reasonCode?{code:result.reasonCode}:{})}});
      record=this.authorizeHandoff(principal,commandId);
      if(["human","failed","conflict","cancelled"].includes(record.phase))return this.handoffSnapshot(record);
      const code=this.handoffAuthority(record);if(code)return this.stopHandoff(record,"conflict",code);
      if(!result.quiescent||result.dispatch!=="acknowledged"||this.handoffDrain(record)!=="settled"||this.hasUncertainCommand(fence.sessionId)||this.hasUnconfirmedNativeQueue(fence.sessionId))return this.stopHandoff(record,"conflict",result.reasonCode??"NATIVE_RELEASE_OUTCOME_UNKNOWN");
      if(this.now().getTime()>=Date.parse(record.deadline))return this.stopHandoff(record,"failed","HANDOFF_TIMEOUT");
      const read=result.observation.read;
      if(!read)return this.stopHandoff(record,"conflict","NATIVE_RELEASE_READ_UNVERIFIED");
      const saved=this.store.saveObservation({sessionId:fence.sessionId,observerGeneration:read.observerGeneration,observerSequence:read.sequence,controlEpoch:fence.expectedControlEpoch,observation:result.observation,...(readBarrier?{readBarrier}:{})});
      if(!saved.accepted)return this.stopHandoff(record,"conflict",saved.code??"NATIVE_RELEASE_READ_UNVERIFIED");
      const evidence={version:result.version,nativeSessionId:result.nativeSessionId,quiescent:result.quiescent,pendingCommands:result.pendingCommands,lockReleased:result.lockReleased,exclusion:result.exclusion,observation:result.observation};
      this.database.saveEntity("native-release-evidence",releaseId,json({commandId:releaseId,binding:record.binding,scopeFingerprint:record.scopeFingerprint,fence,evidence,readProof:result.readProof}));
      const control=this.store.compareAndSwapControl({sessionId:fence.sessionId,expectedRevision:fence.expectedControlRevision,expectedEpoch:fence.expectedControlEpoch,actorId:record.actorId,event:{type:"release-verified",evidence,at:this.now().toISOString()}});
      record={...record,phase:"human"};delete record.code;this.database.saveEntity("native-handoff",commandId,json(record));this.saveControlNotice(record,control);return this.handoffSnapshot(record);
    });
  }

  requestReclaim(input:{principal:InteractionPrincipal;fence:MutationFence}):NativeCommandReceipt {
    const principal=structuredClone(input.principal);const fence=structuredClone(input.fence);
    normalizeInteractionCommand({type:"continue",commandId:fence.commandId,message:"reclaim"});
    if(!principal.id||!principal.roles.some(role=>["operator","admin"].includes(role)))throw new InteractionGuardError("FORBIDDEN");
    try{return this.database.transaction(()=>{
      this.assertInteraction(principal,"collect",fence);
      const run=this.database.getEntity<JsonValue>("run",fence.runId) as unknown as Run;
      const prior=this.reclaimRecord(fence.commandId);
      if(prior){const command=this.store.reserveCommand({id:fence.commandId,actorId:principal.id,profileId:run.profileId,type:"request-return",fence,semantics:{version:1}});return this.commandReceipt(command);}
      const task=this.database.getCanonicalTask<JsonValue>(run.taskId);
      if(["DONE","FAILED","CANCELLED"].includes((task?.document as {state?:string}|undefined)?.state??""))throw new InteractionGuardError("TERMINAL_TASK");
      if(isTerminalRunState(run.state)||run.leaseExpiresAt&&(!Number.isFinite(Date.parse(run.leaseExpiresAt))||Date.parse(run.leaseExpiresAt)<=this.now().getTime()))throw new InteractionGuardError("STALE_RUN_AUTHORITY");
      const current=this.store.control(fence.sessionId);const binding=this.store.binding(fence.sessionId);
      const session=this.database.getEntity<JsonValue>("session",fence.sessionId) as unknown as Session;const adapter=this.database.getEntity<JsonValue>("adapter-session",fence.sessionId) as unknown as AdapterSession;
      const normalized=normalizeNativeBinding(session,adapter,run);
      if(!current||!binding||binding.identityState!=="bound"||normalized.state!=="bound"||!isDeepStrictEqual(normalized.binding,binding)||this.store.nativeDeletion(fence.sessionId))throw new InteractionGuardError("NATIVE_IDENTITY_CHANGED");
      if(!["HUMAN","CONFLICT","RECONCILING"].includes(current.state))throw new InteractionGuardError("NATIVE_WRITE_LOCKED");
      const active=this.database.handle.prepare("SELECT 1 FROM entities WHERE kind='native-reclaim' AND json_extract(document_json,'$.controlFence.sessionId')=? AND json_extract(document_json,'$.controlFence.expectedControlEpoch')=? AND json_extract(document_json,'$.phase') IN ('checking','awaiting-confirmation') LIMIT 1").get(fence.sessionId,current.epoch);
      if(active)throw new InteractionGuardError("NATIVE_RECLAIM_IN_PROGRESS");
      const trustedRow=this.database.handle.prepare("SELECT o.document_json,c.control_epoch FROM native_observation_checkpoints c JOIN native_observations o ON o.id=c.observation_id WHERE c.session_id=?").get(fence.sessionId) as {document_json:string;control_epoch:number}|undefined;
      const trusted=trustedRow?JSON.parse(trustedRow.document_json) as NativeObservation:undefined;
      const known=trusted?.nativeSessionId===binding.nativeSessionId&&trusted.nativeThreadId===binding.nativeThreadId?trusted:undefined;
      const scopeFingerprint=this.store.observation(fence.sessionId)?.scopeFingerprint??known?.scopeFingerprint;
      // Legacy readback may seed a baseline only if its accepted checkpoint still
      // precedes HUMAN. A newer human read never becomes the original policy.
      const human=this.firstHumanEpoch(fence.sessionId);
      const priorPermission=human!==null&&trustedRow&&trustedRow.control_epoch<human?known?.permissionFingerprint:undefined;
      const driftPolicy=this.freezeDriftPolicy(run,priorPermission)?.policy;
      const permissionFingerprint=driftPolicy?.permissionFingerprint;
      if(!isSafeNativeMetadataId(scopeFingerprint)||scopeFingerprint==="unknown"||permissionFingerprint!==undefined&&!isSafeNativeMetadataId(permissionFingerprint))throw new InteractionGuardError("NATIVE_OBSERVATION_SCOPE_CHANGED");
      const command=this.store.reserveCommand({id:fence.commandId,actorId:principal.id,profileId:run.profileId,type:"request-return",fence,semantics:{version:1}});
      const sending=this.store.updateCommand({id:command.id,expectedRevision:command.revision,state:"SENDING"});
      const control=current.state==="RECONCILING"?current:this.store.compareAndSwapControl({sessionId:fence.sessionId,expectedRevision:fence.expectedControlRevision,expectedEpoch:fence.expectedControlEpoch,actorId:principal.id,event:{type:current.state==="HUMAN"?"request-return":"begin-reconcile",at:this.now().toISOString()}});
      const record:ReclaimRecord={version:1,commandId:command.id,actorId:principal.id,originalFence:fence,controlFence:{...fence,expectedControlRevision:control.revision,expectedControlEpoch:control.epoch},binding,scopeFingerprint,phase:"checking",...(driftPolicy?{driftPolicy}:{}),...(permissionFingerprint?{permissionFingerprint}:{})};
      this.database.saveEntity("native-reclaim",command.id,json(record));
      const id=`reclaim-read:${randomUUID()}`;this.store.invalidateObservation({sessionId:fence.sessionId,readBarrier:randomUUID(),observation:{version:1,id,nativeSessionId:binding.nativeSessionId,...(binding.nativeThreadId?{nativeThreadId:binding.nativeThreadId}:{}),scopeFingerprint,executionRefId:binding.executionRefId,observedAt:this.now().toISOString(),state:"unknown",pendingTools:"unknown",pendingApprovals:"unknown",historyMode:"unknown"}});
      const receipt:NativeCommandReceipt={version:1,commandId:command.id,state:"accepted",code:"RECLAIM_REQUEST_ACCEPTED"};this.store.updateCommand({id:sending.id,expectedRevision:sending.revision,state:"ACKNOWLEDGED",nativeReceipt:receipt});return receipt;
    });}catch(error){if(error instanceof InteractionGuardError||error instanceof InteractionStoreError)throw error;throw new InteractionGuardError("NATIVE_RECLAIM_PERSISTENCE_FAILED");}
  }
  private consumeReclaimAction(fence:MutationFence,action:"continue"|"verify"):void {
    const rows=this.database.handle.prepare("SELECT id,document_json FROM entities WHERE kind='native-reclaim-action' AND json_extract(document_json,'$.runId')=? AND json_extract(document_json,'$.sessionId')=? AND json_extract(document_json,'$.controlEpoch')=? AND json_extract(document_json,'$.state')='authorized' AND json_extract(document_json,'$.action')=? LIMIT 2").all(fence.runId,fence.sessionId,fence.expectedControlEpoch,action) as Array<{id:string;document_json:string}>;
    if(rows.length>1)throw new InteractionGuardError("NATIVE_RECLAIM_ACTION_MISMATCH");
    for(const row of rows)this.database.saveEntity("native-reclaim-action",row.id,json({...JSON.parse(row.document_json),state:"consumed"}));
  }
  requiresDeliverySnapshot(run:Run):boolean {return this.firstHumanEpoch(run.sessionId)!==null||Boolean(this.database.getEntity("native-verification-invalidation",run.id));}
  private firstHumanEpoch(sessionId:string):number|null {
    const row=this.database.handle.prepare("SELECT MIN(json_extract(document_json,'$.newEpoch')) AS epoch FROM control_audit WHERE session_id=? AND json_extract(document_json,'$.state')='HUMAN'").get(sessionId) as {epoch:number|null};return row.epoch;
  }
  private freezeDriftPolicy(run:Run,permissionFingerprint?:string):FrozenDriftPolicy|undefined {
    if(!run.executionSelection)return undefined;
    const existing=this.database.getEntity<JsonValue>("native-drift-policy",run.id) as unknown as FrozenDriftPolicy|undefined;
    if(existing&&(existing.runId!==run.id||existing.profileId!==run.profileId||existing.providerId!==run.providerId||existing.backendId!==run.executionSelection.backendId||!normalizeNativeDriftPolicy(existing.policy)))throw new InteractionGuardError("NATIVE_DRIFT_POLICY_INVALID");
    if(existing){
      if(!existing.policy.permissionFingerprint&&permissionFingerprint){const policy=normalizeNativeDriftPolicy({...existing.policy,permissionFingerprint});if(!policy)throw new InteractionGuardError("NATIVE_DRIFT_POLICY_INVALID");const filled={...existing,policy};this.database.saveEntity("native-drift-policy",run.id,json(filled));return filled;}
      return existing;
    }
    const configured=this.configuredDriftPolicy(run);
    const policy=normalizeNativeDriftPolicy({...configured??{version:1 as const,mode:"compatible" as const},...(configured?.permissionFingerprint?{}:permissionFingerprint?{permissionFingerprint}:{})});
    if(!policy)throw new InteractionGuardError("NATIVE_DRIFT_POLICY_INVALID");
    const record:FrozenDriftPolicy={version:1,runId:run.id,profileId:run.profileId,providerId:run.providerId,backendId:run.executionSelection.backendId,policy,...(configured?{configured}:{})};this.database.saveEntity("native-drift-policy",run.id,json(record));return record;
  }
  private configuredDriftPolicy(run:Run):NativeDriftPolicy|undefined {
    if(!this.resolveDriftPolicy)return undefined;
    try{const policy=normalizeNativeDriftPolicy(this.resolveDriftPolicy(structuredClone(run)));if(policy)return policy;}catch{/* Do not expose composition diagnostics. */}
    throw new InteractionGuardError("NATIVE_DRIFT_POLICY_INVALID");
  }
  private assertDriftPolicy(run:Run,expected?:NativeDriftPolicy):void {
    const frozen=this.database.getEntity<JsonValue>("native-drift-policy",run.id) as unknown as FrozenDriftPolicy|undefined;
    if(expected&&(!frozen||!isDeepStrictEqual(frozen.policy,expected)))throw new InteractionGuardError("NATIVE_DRIFT_POLICY_CHANGED");
    if(frozen&&(frozen.version!==1||frozen.runId!==run.id||frozen.profileId!==run.profileId||frozen.providerId!==run.providerId||frozen.backendId!==run.executionSelection?.backendId||!normalizeNativeDriftPolicy(frozen.policy)))throw new InteractionGuardError("NATIVE_DRIFT_POLICY_INVALID");
    if(frozen?.configured){const current=this.configuredDriftPolicy(run);if(!isDeepStrictEqual(current,frozen.configured))throw new InteractionGuardError("NATIVE_DRIFT_POLICY_CHANGED");}
    else if(this.resolveDriftPolicy)throw new InteractionGuardError("NATIVE_DRIFT_POLICY_CHANGED");
  }
  private reclaimRecord(commandId:string):ReclaimRecord|undefined{return this.database.getEntity<JsonValue>("native-reclaim",commandId) as unknown as ReclaimRecord|undefined;}
  private authorizeReclaim(principal:InteractionPrincipal,commandId:string):ReclaimRecord {
    const record=this.reclaimRecord(commandId);if(!record)throw new InteractionGuardError("NATIVE_RECLAIM_NOT_FOUND");
    if(!principal.roles.some(role=>["operator","admin"].includes(role))||principal.id!==record.actorId&&!principal.roles.includes("admin"))throw new InteractionGuardError("FORBIDDEN");
    this.assertInteraction(principal,"collect",record.originalFence);return record;
  }
  private reclaimAuthority(record:ReclaimRecord):Run {
    const f=record.controlFence;const control=this.store.control(f.sessionId);const run=this.database.getEntity<JsonValue>("run",f.runId) as unknown as Run|undefined;const task=run?this.database.getCanonicalTask<JsonValue>(run.taskId):undefined;
    if(["DONE","FAILED","CANCELLED"].includes((task?.document as {state?:string}|undefined)?.state??""))throw new InteractionGuardError("TERMINAL_TASK");
    if(control?.state!=="RECONCILING"||control.revision!==f.expectedControlRevision||control.epoch!==f.expectedControlEpoch)throw new InteractionGuardError("STALE_CONTROL_REVISION");
    if(!run||isTerminalRunState(run.state)||run.sessionId!==f.sessionId||run.generation!==f.generation||run.leaseId!==f.leaseId||control.activeRunId!==run.id||task?.revision!==f.expectedTaskRevision||(task.document as {currentRunId?:string}).currentRunId!==run.id||run.leaseExpiresAt&&(!Number.isFinite(Date.parse(run.leaseExpiresAt))||Date.parse(run.leaseExpiresAt)<=this.now().getTime()))throw new InteractionGuardError("STALE_RUN_AUTHORITY");
    const session=this.database.getEntity<JsonValue>("session",f.sessionId) as unknown as Session;const adapter=this.database.getEntity<JsonValue>("adapter-session",f.sessionId) as unknown as AdapterSession;
    if(!session||!adapter)throw new InteractionGuardError("NATIVE_IDENTITY_CHANGED");
    const normalized=normalizeNativeBinding(session,adapter,run);if(normalized.state!=="bound"||!isDeepStrictEqual(normalized.binding,record.binding)||!isDeepStrictEqual(this.store.binding(f.sessionId),record.binding)||this.store.nativeDeletion(f.sessionId))throw new InteractionGuardError("NATIVE_IDENTITY_CHANGED");
    if(!record.driftPolicy)throw new InteractionGuardError("NATIVE_DRIFT_POLICY_UNVERIFIED");
    this.assertDriftPolicy(run,record.driftPolicy);
    return run;
  }
  private reclaimPolicy(record:ReclaimRecord,run:Run,report:ReclaimReport):string|undefined {
    if(["RESOURCE_BLOCKED","RUNNER_UNAVAILABLE"].includes(run.state)||run.resourceBlockReason)return "RESOURCE_BLOCKED";
    if(this.hasUncertainCommand(run.sessionId)||this.hasUnconfirmedNativeQueue(run.sessionId)||this.pendingMutations(run.sessionId).some(row=>row.id!==this.laneContext.getStore()?.mutationRecordId||this.laneContext.getStore()?.mutationAuthorized))return "NATIVE_COMMAND_OUTCOME_UNKNOWN";
    if(!report.ready)return report.code??"NATIVE_RECLAIM_READ_UNVERIFIED";
    if(!run.executionSelection||!run.executionRef)return "NATIVE_RECLAIM_CONTEXT_UNVERIFIED";
    const frozenContract=this.database.getEntity<JsonValue>("run-contract",run.id) as unknown as TaskContract|undefined;
    const context=frozenContract?.workspace;
    if(frozenContract?.version!==1||frozenContract.revision!==run.contractRevision||!context?.repositoryId||!context.baseCommit)return "EXECUTION_CONTEXT_DRIFT";
    const validation=validateExecutionBinding({profileId:run.profileId,providerId:run.providerId,backendId:record.binding.backendId,runnerId:run.runnerId,executionRef:run.executionRef,nativeBinding:record.binding},run.executionSelection,{repositoryId:context.repositoryId,baseRevision:context.baseCommit});if(!validation.valid)return validation.code;
    const policy=record.driftPolicy!;
    report.drift=assessNativeDrift(run.executionSelection,{...(report.observation?.reportedModel?{model:report.observation.reportedModel}:{}),...(report.observation?.permissionFingerprint?{permissionFingerprint:report.observation.permissionFingerprint}:{}),...(report.account?.state==="reported"?{accountFingerprint:report.account.fingerprint}:{})},policy);
    return report.drift.code;
  }
  private failReclaim(record:ReclaimRecord,report:ReclaimReport):ReclaimReport {
    return this.database.transaction(()=>{
      const control=this.store.control(record.controlFence.sessionId);
      if(control?.state==="RECONCILING"&&control.epoch===record.controlFence.expectedControlEpoch&&control.revision===record.controlFence.expectedControlRevision)this.store.compareAndSwapControl({sessionId:control.sessionId,expectedRevision:control.revision,expectedEpoch:control.epoch,actorId:record.actorId,event:{type:"conflict",at:this.now().toISOString()}});
      const failed={...report,ready:false,code:report.code??"NATIVE_RECLAIM_READ_UNVERIFIED"};this.database.saveEntity("native-reclaim",record.commandId,json({...record,phase:"conflict",report:failed}));return failed;
    });
  }
  async reconcileForReclaim(principal:InteractionPrincipal,commandId:string,source:NativeReclaimSource,timeoutMs=5_000):Promise<ReclaimReport> {
    const original=this.authorizeReclaim(principal,commandId);
    return this.withMutationLane(original.controlFence.sessionId,async()=>{
      const record=this.authorizeReclaim(principal,commandId);if(record.phase!=="checking")return record.report??(()=>{throw new InteractionGuardError("NATIVE_RECLAIM_PHASE_CONFLICT");})();
      let run:Run;try{run=this.reclaimAuthority(record);}catch(error){const failed:ReclaimReport={version:1,id:randomUUID(),ready:false,binding:record.binding,scopeFingerprint:record.scopeFingerprint,code:error instanceof InteractionGuardError?error.code:"NATIVE_RECLAIM_AUTHORITY_CHANGED"};return this.failReclaim(record,failed);}const barrier=this.store.nativeReadBarrier(run.sessionId);
      const report=run.executionRef?await readForReclaim(record.binding,run.executionRef,source,()=>{this.reclaimAuthority(record);if(this.store.nativeReadBarrier(run.sessionId)!==barrier||source.scopeFingerprint!==record.scopeFingerprint)throw new InteractionGuardError("STALE_NATIVE_READ_BARRIER");},timeoutMs):{version:1 as const,id:randomUUID(),ready:false,binding:record.binding,scopeFingerprint:record.scopeFingerprint,code:"EXECUTION_CONTEXT_DRIFT"};
      let fresh:Run;try{fresh=this.reclaimAuthority(record);}catch(error){return this.failReclaim(record,{...report,ready:false,code:error instanceof InteractionGuardError?error.code:"NATIVE_RECLAIM_AUTHORITY_CHANGED"});}const code=this.reclaimPolicy(record,fresh,report);if(code)return this.failReclaim(record,{...report,ready:false,code});
      try{return this.database.transaction(()=>{this.reclaimAuthority(record);const o=report.observation!;const read=o.read!;const saved=this.store.saveObservation({sessionId:run.sessionId,controlEpoch:record.controlFence.expectedControlEpoch,observerGeneration:read.observerGeneration,observerSequence:read.sequence,observation:o,...(barrier?{readBarrier:barrier}:{})});if(!saved.accepted)throw new InteractionGuardError(saved.code??"STALE_NATIVE_RECLAIM_READ");this.database.saveEntity("native-reclaim",commandId,json({...record,phase:"awaiting-confirmation",report}));return report;});}catch{throw new InteractionGuardError("NATIVE_RECLAIM_PERSISTENCE_FAILED");}
    }).catch(error=>{if(error instanceof InteractionGuardError||error instanceof InteractionStoreError)throw error;throw new InteractionGuardError("NATIVE_RECLAIM_PERSISTENCE_FAILED");});
  }
  async commitReclaim(input:{principal:InteractionPrincipal;commandId:string;reportId:string;fence:MutationFence;action:"continue"|"verify";source:NativeReclaimSource}):Promise<SessionControl> {
    const principal=structuredClone(input.principal);const fence=structuredClone(input.fence);const action=input.action;const reportId=input.reportId;const commandId=input.commandId;
    if(!["continue","verify"].includes(action))throw new InteractionGuardError("INVALID_RECLAIM_ACTION");
    const original=this.authorizeReclaim(principal,commandId);
    return this.withMutationLane(original.controlFence.sessionId,async()=>{
      const record=this.authorizeReclaim(principal,commandId);
      const semantics={reportId,fence,action};if(record.commit){if(!isDeepStrictEqual({...record.commit,control:undefined},{...semantics,control:undefined}))throw new InteractionGuardError("IDEMPOTENCY_CONFLICT");return record.commit.control;}
      if(record.phase!=="awaiting-confirmation"||!record.report||record.report.id!==reportId)throw new InteractionGuardError("NATIVE_RECLAIM_REPORT_MISMATCH");
      if(!isDeepStrictEqual({...fence,commandId:record.controlFence.commandId},record.controlFence))throw new InteractionGuardError("STALE_CONTROL_REVISION");
      let run:Run;try{run=this.reclaimAuthority(record);}catch(error){const code=error instanceof InteractionGuardError?error.code:"NATIVE_RECLAIM_AUTHORITY_CHANGED";this.failReclaim(record,{version:1,id:randomUUID(),ready:false,binding:record.binding,scopeFingerprint:record.scopeFingerprint,code});throw new InteractionGuardError(code);}const barrier=this.store.nativeReadBarrier(run.sessionId);
      const report=await readForReclaim(record.binding,run.executionRef!,input.source,()=>{this.reclaimAuthority(record);if(this.store.nativeReadBarrier(run.sessionId)!==barrier||input.source.scopeFingerprint!==record.scopeFingerprint)throw new InteractionGuardError("STALE_NATIVE_READ_BARRIER");});
      let current:Run;try{current=this.reclaimAuthority(record);}catch(error){const code=error instanceof InteractionGuardError?error.code:"NATIVE_RECLAIM_AUTHORITY_CHANGED";this.failReclaim(record,{...report,ready:false,code});throw new InteractionGuardError(code);}const code=this.reclaimPolicy(record,current,report);
      if(code||!isDeepStrictEqual(reclaimFingerprint(record.report),reclaimFingerprint(report))){const failed=this.failReclaim(record,{...report,ready:false,code:code??"NATIVE_RECLAIM_CHANGED"});throw new InteractionGuardError(failed.code!);}
      const previous=record.report.observation!.read!;const next=report.observation!.read!;
      if(report.observation!.id===record.report.observation!.id||next.observerGeneration<previous.observerGeneration||next.observerGeneration===previous.observerGeneration&&(next.observerEpoch!==previous.observerEpoch||next.sequence<=previous.sequence)){this.failReclaim(record,{...report,ready:false,code:"STALE_NATIVE_RECLAIM_READ"});throw new InteractionGuardError("STALE_NATIVE_RECLAIM_READ");}
      let clearEmergency:(()=>void)|undefined;
      try{const control=this.database.transaction(()=>{
        this.reclaimAuthority(record);const o=report.observation!;const read=o.read!;
        const saved=this.store.saveObservation({sessionId:run.sessionId,controlEpoch:record.controlFence.expectedControlEpoch,observerGeneration:read.observerGeneration,observerSequence:read.sequence,observation:o,...(barrier?{readBarrier:barrier}:{})});if(!saved.accepted)throw new InteractionGuardError(saved.code??"STALE_NATIVE_RECLAIM_READ");
        const initial=this.database.getEntity<JsonValue>("native-event-checkpoint",run.sessionId) as unknown as NativeEventCheckpoint|undefined;
        const previousCheckpoint=initial??createNativeEventCheckpoint({binding:record.binding,scopeFingerprint:record.scopeFingerprint,stream:{kind:"volatile"}});
        // A qualified full reread starts a new history window, not the next page
        // of an old cursor. Preserve event dedupe and monotonic observer order.
        const eventCheckpoint=reconcileNativeEvents(previousCheckpoint,undefined,undefined,{disconnected:true}).checkpoint;
        // The shared reconciler retains only metadata; no transcript is carried in a reclaim report.
        const reconciled=reconcileNativeEvents(eventCheckpoint,o,{binding:record.binding,scopeFingerprint:record.scopeFingerprint,gapGeneration:eventCheckpoint.gapGeneration,...read,page:{version:1,nativeSessionId:record.binding.nativeSessionId,state:"available",completeness:"complete",range:"native-history",source:record.binding.product,entries:report.history!.entries.map(entry=>({...entry,text:""}))}});
        if(!reconciled.accepted||reconciled.needsSnapshot||reconciled.needsHistory)throw new InteractionGuardError("NATIVE_RECLAIM_HISTORY_UNVERIFIED");
        this.database.saveEntity("native-event-checkpoint",run.sessionId,json(reconciled.checkpoint));
        const control=this.store.compareAndSwapControl({sessionId:run.sessionId,expectedRevision:fence.expectedControlRevision,expectedEpoch:fence.expectedControlEpoch,actorId:principal.id,event:{type:"reconcile-verified",runTerminal:false,observationRef:o.id,at:this.now().toISOString()}});
        clearEmergency=resetNativeExternalBaseline(this.database,{sessionId:run.sessionId,runId:run.id,generation:run.generation,leaseId:run.leaseId,controlEpoch:control.epoch,snapshot:{version:1,binding:record.binding,controlEpoch:control.epoch,observation:o,history:report.history!}});
        this.database.saveEntity("native-verification-invalidation",run.id,json({version:1,runId:run.id,sessionId:run.sessionId,controlEpoch:control.epoch,observationRef:o.id,code:"NATIVE_REVERIFICATION_REQUIRED"}));
        this.database.saveEntity("native-reclaim-action",commandId,json({version:1,commandId,reportId,action,runId:run.id,sessionId:run.sessionId,controlEpoch:control.epoch,state:"authorized",observationRef:o.id}));
        this.database.saveEntity("native-reclaim",commandId,json({...record,phase:"committed",report,commit:{...semantics,control}}));
        this.database.saveEntity("native-control-outbox",`reclaim:${commandId}`,json({version:1,id:`reclaim:${commandId}`,state:"pending",sessionId:run.sessionId,runId:run.id,controlState:control.state,controlEpoch:control.epoch,controlRevision:control.revision,code:"NATIVE_RECLAIM_COMMITTED"}));return control;
      });clearEmergency?.();return control;}catch{throw new InteractionGuardError("NATIVE_RECLAIM_PERSISTENCE_FAILED");}
    }).catch(error=>{if(error instanceof InteractionGuardError||error instanceof InteractionStoreError)throw error;throw new InteractionGuardError("NATIVE_RECLAIM_PERSISTENCE_FAILED");});
  }

  private nativeRequestKey(sessionId:string,binding:NativeBinding,requestId:string,connection:{connectionId:string;connectionEpoch:number}):string{return createHash("sha256").update(JSON.stringify({sessionId,binding,connectionId:connection.connectionId,connectionEpoch:connection.connectionEpoch,requestId})).digest("hex");}
  private bindRequestCommand(command:NativeDispatchCommand,fence:MutationFence,source?:NativeDispatchSource):NativeDispatchCommand{
    if(command.type!=="approval"||command.requestRef)return command;
    let handle:NativeRequestHandle|undefined;try{handle=source?.port.requestHandle?.(source.binding);}catch{throw new InteractionGuardError("NATIVE_REQUEST_CONNECTION_CHANGED");}
    const previous=(this.database.getEntity<JsonValue>("native-command-context",command.commandId) as {requestRef?:string}|undefined)?.requestRef;
    const requestRef=handle&&source?this.nativeRequestKey(fence.sessionId,source.binding,command.requestId,handle):previous;
    if(!requestRef)throw new InteractionGuardError("NATIVE_REQUEST_NOT_FOUND");return {...command,requestRef};
  }
  registerNativeRequest(fenceInput:MutationFence,input:NativePendingRequest,source:NativeDispatchSource):NativeRequestRecord {
    try{
      const fence=structuredClone(fenceInput);const request=normalizeNativeRequest(input);
      this.assertNativeAuthority(source.binding,fence,"ingress");
      const observation=this.store.observation(fence.sessionId);
      if(observation&&observation.scopeFingerprint!==source.scopeFingerprint)throw new InteractionGuardError("NATIVE_IDENTITY_CHANGED");
      const assessment=assessInteractionCapability(source.port.capabilities().nativeApproval,source.scopeFingerprint,"runtime-verified");if(!assessment.supported)throw new InteractionGuardError(assessment.code!);
      const original=source.port.requestHandle?.(source.binding);if(!original)throw new InteractionGuardError("NATIVE_CAPABILITY_UNSUPPORTED");
      const captured=captureNativeRequestHandle(original,source.binding,source.scopeFingerprint);
      if(!captured.isConnected()||request.connectionId!==captured.connectionId||request.connectionEpoch!==captured.connectionEpoch)throw new InteractionGuardError("NATIVE_REQUEST_CONNECTION_CHANGED");
      const expires=Date.parse(request.expiresAt);if(expires<=this.now().getTime()||expires-this.now().getTime()>86_400_000)throw new InteractionGuardError("NATIVE_REQUEST_EXPIRED");
      const id=this.nativeRequestKey(fence.sessionId,source.binding,request.requestId,request);
      const existing=this.database.getEntity<JsonValue>("native-request",id) as unknown as NativeRequestRecord|undefined;
      if(existing){if(!isDeepStrictEqual(existing.request,request)||!isDeepStrictEqual(existing.fence,fence))throw new InteractionGuardError("NATIVE_REQUEST_CHANGED");return existing;}
      if(this.database.listEntities("native-request").length>=1024||this.requestConnections.size>=128&&!this.requestConnections.has(fence.sessionId))throw new InteractionGuardError("NATIVE_REQUEST_CAPACITY_REACHED");
      const record:NativeRequestRecord={version:1,id,profileId:source.binding.profileId,fence,binding:structuredClone(source.binding),scopeFingerprint:source.scopeFingerprint,request,state:"pending"};
      const old=this.requestConnections.get(fence.sessionId);
      const prior=this.database.getEntity<JsonValue>("native-request-connection",fence.sessionId) as {connectionId:string;connectionEpoch:number}|undefined;
      if(prior&&(captured.connectionEpoch<prior.connectionEpoch||captured.connectionEpoch===prior.connectionEpoch&&(captured.connectionId!==prior.connectionId||old?.original!==original)))throw new InteractionGuardError("NATIVE_REQUEST_CONNECTION_CHANGED");
      this.database.transaction(()=>{
        if(old&&old.original!==original)for(const value of this.database.listEntities<JsonValue>("native-request")){const r=value as unknown as NativeRequestRecord;if(r.fence.sessionId===fence.sessionId&&r.state==="pending")this.database.saveEntity("native-request",r.id,json({...r,state:"expired",code:"NATIVE_REQUEST_CONNECTION_CHANGED"}));}
        this.database.saveEntity("native-request",id,json(record));
        this.database.saveEntity("native-request-connection",fence.sessionId,{version:1,connectionId:captured.connectionId,connectionEpoch:captured.connectionEpoch});
      });
      if(!old||old.original!==original)this.requestConnections.set(fence.sessionId,{original,captured,source:{binding:structuredClone(source.binding),scopeFingerprint:source.scopeFingerprint,port:source.port}});
      return structuredClone(record);
    }catch(error){if(error instanceof InteractionGuardError)throw error;throw new InteractionGuardError(error instanceof NativeRequestError?error.code:"NATIVE_REQUEST_PERSISTENCE_FAILED");}
  }
  private requestForCommand(command:Extract<NativeDispatchCommand,{type:"approval"}>,fence:MutationFence,source:NativeDispatchSource,claimed=false):{record:NativeRequestRecord;live:LiveRequestConnection}{
    const live=this.requestConnections.get(fence.sessionId);if(!live)throw new InteractionGuardError("NATIVE_REQUEST_NOT_FOUND");
    let current:NativeRequestHandle|undefined;try{current=source.port.requestHandle?.(source.binding);}catch{throw new InteractionGuardError("NATIVE_REQUEST_CONNECTION_CHANGED");}
    let connected=false;try{connected=live.captured.isConnected();}catch{/* A failed connection check never authorizes a response. */}
    if(current!==live.original||!connected||current.connectionId!==live.captured.connectionId||current.connectionEpoch!==live.captured.connectionEpoch||!isDeepStrictEqual(current.binding,live.captured.binding)||current.scopeFingerprint!==live.captured.scopeFingerprint||!isDeepStrictEqual(live.captured.binding,source.binding)||live.captured.scopeFingerprint!==source.scopeFingerprint)throw new InteractionGuardError("NATIVE_REQUEST_CONNECTION_CHANGED");
    const id=this.nativeRequestKey(fence.sessionId,source.binding,command.requestId,live.captured);
    const record=this.database.getEntity<JsonValue>("native-request",id) as unknown as NativeRequestRecord|undefined;
    if(!record)throw new InteractionGuardError("NATIVE_REQUEST_NOT_FOUND");
    if(command.requestRef!==undefined&&command.requestRef!==id)throw new InteractionGuardError("NATIVE_REQUEST_CHANGED");
    if(claimed?record.state!=="responding"||record.commandId!==command.commandId:record.state!=="pending")throw new InteractionGuardError("NATIVE_REQUEST_CONSUMED");
    const control=this.store.control(fence.sessionId);const rejectionDrain=command.response.kind==="reject"&&control?.state==="HANDOFF_REQUESTED"&&record.fence.expectedControlEpoch<fence.expectedControlEpoch;
    if(record.fence.runId!==fence.runId||record.fence.generation!==fence.generation||record.fence.leaseId!==fence.leaseId||record.fence.expectedTaskRevision!==fence.expectedTaskRevision||!rejectionDrain&&(record.fence.expectedControlEpoch!==fence.expectedControlEpoch||record.fence.expectedControlRevision!==fence.expectedControlRevision)||record.request.revision!==command.expectedRevision||record.request.type!==command.requestType)throw new InteractionGuardError("NATIVE_REQUEST_CHANGED");
    if(Date.parse(record.request.expiresAt)<=this.now().getTime())throw new InteractionGuardError("NATIVE_REQUEST_EXPIRED");
    try{assertNativeRequestChoice(record.request,command.response);}catch(error){throw new InteractionGuardError(error instanceof NativeRequestError?error.code:"INVALID_NATIVE_REQUEST_CHOICE");}
    return {record,live};
  }
  listNativeRequests(principal:InteractionPrincipal,sessionId:string):Array<{id:string;type:NativePendingRequest["type"];tool:NativePendingRequest["tool"];options:NativePendingRequest["options"];expiresAt:string;state:string}> {
    if(!principal.id||!principal.roles.some(role=>["viewer","operator","admin"].includes(role)))throw new InteractionGuardError("FORBIDDEN");
    const control=this.store.control(sessionId);const adapter=this.database.getEntity<JsonValue>("adapter-session",sessionId) as unknown as AdapterSession|undefined;const run=this.database.getEntity<JsonValue>("run",control?.activeRunId??adapter?.runId??"") as unknown as Run|undefined;
    if(!run)throw new InteractionGuardError("SESSION_OWNER_MISMATCH");this.assertInteraction(principal,"collect",this.fenceFor(run,"native-request-list"));
    return (this.database.listEntities<JsonValue>("native-request") as unknown as NativeRequestRecord[]).filter(r=>r.fence.sessionId===sessionId).slice(-128).map(r=>({id:r.id,type:r.request.type,tool:structuredClone(r.request.tool),options:structuredClone(r.request.options),expiresAt:r.request.expiresAt,state:r.state==="pending"&&(r.fence.generation!==run.generation||r.fence.leaseId!==run.leaseId||r.fence.expectedControlEpoch!==control?.epoch||Date.parse(r.request.expiresAt)<=this.now().getTime()||!this.requestConnections.get(sessionId)?.captured.isConnected())?"expired":r.state}));
  }
  nativeRequestAvailability(sessionId:string,port?:NativeInteractionPort):{supported:boolean;code?:string}{
    if(!port?.requestHandle)return {supported:false,code:"NATIVE_CAPABILITY_UNSUPPORTED"};
    try{const live=this.requestConnections.get(sessionId),scope=this.store.observation(sessionId)?.scopeFingerprint??(live?.source.port===port&&live.captured.isConnected()&&isDeepStrictEqual(this.store.binding(sessionId),live.source.binding)?live.source.scopeFingerprint:undefined);return scope?assessInteractionCapability(port.capabilities().nativeApproval,scope,"runtime-verified"):{supported:false,code:"NATIVE_CAPABILITY_UNVERIFIED"};}catch{return {supported:false,code:"NATIVE_CAPABILITY_UNVERIFIED"};}
  }
  async respondNativeRequest(principal:InteractionPrincipal,id:string,response:Extract<NativeDispatchCommand,{type:"approval"}>["response"],fence:MutationFence,currentPort?:NativeDispatchSource["port"],assertSourceCurrent?:()=>void):Promise<NativeCommandReceipt>{
    this.assertInteraction(principal,"collect",fence);
    const r=this.database.getEntity<JsonValue>("native-request",id) as unknown as NativeRequestRecord|undefined;
    if(!r||r.fence.sessionId!==fence.sessionId||r.fence.runId!==fence.runId||principal.profileId!==undefined&&r.profileId!==principal.profileId)throw new InteractionGuardError("NATIVE_REQUEST_NOT_FOUND");
    const live=this.requestConnections.get(fence.sessionId);
    const existing=this.store.command(fence.commandId);
    if(!live&&!existing)throw new InteractionGuardError("NATIVE_REQUEST_CONNECTION_CHANGED");
    const source=currentPort?{binding:r.binding,scopeFingerprint:r.scopeFingerprint,port:currentPort}:live?.source??{binding:r.binding,scopeFingerprint:r.scopeFingerprint,port:{capabilities:()=>{throw new InteractionGuardError("NATIVE_REQUEST_CONNECTION_CHANGED");}}};
    let command:NativeDispatchCommand;try{command=normalizeInteractionCommand({type:"approval",commandId:fence.commandId,requestId:r.request.requestId,requestType:r.request.type,expectedRevision:r.request.revision,requestRef:r.id,response});}catch{throw new InteractionGuardError("INVALID_NATIVE_REQUEST_CHOICE");}
    return this.dispatchInteraction(principal,command,fence,source,assertSourceCurrent).catch(error=>{
      if(error instanceof InteractionStoreError&&error.code==="IDEMPOTENCY_CONFLICT")throw new InteractionGuardError(error.code);
      throw error;
    });
  }
  reserveInteraction(principal:InteractionPrincipal,input:NativeDispatchCommand,fence:MutationFence):InteractionCommand {
    let command=normalizeInteractionCommand(input);
    if(!principal.id||!principal.roles.some(role=>["operator","admin"].includes(role)))throw new InteractionGuardError("FORBIDDEN");
    return this.database.transaction(()=>{
      this.assertInteraction(principal,"collect",fence);
      command=this.bindRequestCommand(command,fence,this.requestConnections.get(fence.sessionId)?.source);
      const run=this.database.getEntity<JsonValue>("run",fence.runId) as unknown as Run;
      if(!this.store.command(command.commandId)){this.assertInteraction(principal,commandOperation(command),fence);if(command.type==="approval"){const live=this.requestConnections.get(fence.sessionId);if(!live)throw new InteractionGuardError("NATIVE_REQUEST_NOT_FOUND");this.requestForCommand(command,fence,live.source);}}
      return this.store.reserveCommand({id:command.commandId,actorId:principal.id,profileId:run.profileId,type:commandOperation(command),fence,semantics:json(command)});
    });
  }
  private commandReceipt(command:InteractionCommand):NativeCommandReceipt {
    if(command.nativeReceipt)return structuredClone(command.nativeReceipt);
    return {version:1,commandId:command.id,state:command.state==="FAILED"||command.state==="CANCELLED"?"rejected":"unknown",code:command.code??(command.state==="RESERVED"?"NATIVE_COMMAND_NOT_SENT":"NATIVE_COMMAND_OUTCOME_UNKNOWN")};
  }
  async dispatchInteraction(principalInput:InteractionPrincipal,input:NativeDispatchCommand,fenceInput:MutationFence,source:NativeDispatchSource,assertSourceCurrent?:()=>void):Promise<NativeCommandReceipt> {
    const principal=structuredClone(principalInput);let command=normalizeInteractionCommand(input);const fence=structuredClone(fenceInput);
    return this.withMutationLane(fence.sessionId,async()=>{
      this.assertInteraction(principal,"collect",fence);
      command=this.bindRequestCommand(command,fence,source);
      const existing=this.store.command(command.commandId);
      if(!existing||existing.state==="RESERVED") {
        assertSourceCurrent?.();
        if(command.type==="approval")this.assertInteraction(principal,commandOperation(command),fence);
        if(!isDeepStrictEqual(this.store.binding(fence.sessionId),source.binding)||source.binding.identityState!=="bound")throw new InteractionGuardError("NATIVE_IDENTITY_CHANGED");
        if(this.store.observation(fence.sessionId)?.scopeFingerprint!==source.scopeFingerprint)throw new InteractionGuardError("NATIVE_OBSERVATION_SCOPE_CHANGED");
        if(command.type==="approval")this.requestForCommand(command,fence,source);
      }
      const reserved=this.reserveInteraction(principal,command,fence);
      if(reserved.state!=="RESERVED")return this.commandReceipt(reserved);
      const binding=structuredClone(source.binding);const scope=source.scopeFingerprint;
      let pending:ReturnType<NativeInteractions["requestForCommand"]>|undefined;
      const sending=this.database.transaction(()=>{
        assertSourceCurrent?.();
        this.assertInteraction(principal,commandOperation(command),fence);
        const ingestionFloor=(this.database.getEntity<JsonValue>("native-event-ingestion",fence.sessionId) as {sequence:number}|undefined)?.sequence??0;
        this.database.saveEntity("native-command-context",command.commandId,json({binding,scopeFingerprint:scope,ingestionFloor,...(command.type==="approval"?{requestRef:command.requestRef}:{})}));
        if(command.type==="approval"){pending=this.requestForCommand(command,fence,source);this.database.saveEntity("native-request",pending.record.id,json({...pending.record,state:"responding",commandId:command.commandId}));}
        return this.store.updateCommand({id:command.commandId,expectedRevision:reserved.revision,state:"SENDING"});
      });
      const receipt=await dispatchNativeInteraction(command,fence,{binding,scopeFingerprint:scope,port:source.port,...(pending?{nativeRequest:{handle:pending.live.captured,request:pending.record.request,now:this.now}}:{})},()=>{
        assertSourceCurrent?.();
        const currentBinding=this.store.binding(fence.sessionId);
        if(!isDeepStrictEqual(currentBinding,binding)||source.scopeFingerprint!==scope||!isDeepStrictEqual(source.binding,binding))throw new InteractionGuardError("NATIVE_IDENTITY_CHANGED");
        if(this.store.observation(fence.sessionId)?.scopeFingerprint!==scope)throw new InteractionGuardError("NATIVE_OBSERVATION_SCOPE_CHANGED");
        const decision=this.evaluateInteraction(principal,commandOperation(command),fence,sending);if(!decision.allowed)throw new InteractionGuardError(decision.code);
        if(command.type==="steer"&&this.store.observation(fence.sessionId)?.activeTurnId!==command.activeTurnId)throw new InteractionGuardError("STALE_NATIVE_TURN");
        if(command.type==="approval")this.requestForCommand(command,fence,source,true);
      });
      // Recording the original receipt does not resume or complete the Run, even after handoff.
      try{this.database.transaction(()=>{
        const current=this.store.command(command.commandId)!;
        if(["SENDING","UNKNOWN"].includes(current.state)&&!(current.state==="UNKNOWN"&&receipt.state==="unknown"))this.store.updateCommand({id:current.id,expectedRevision:current.revision,state:receipt.state==="unknown"?"UNKNOWN":receipt.state==="rejected"?"FAILED":"ACKNOWLEDGED",nativeReceipt:receipt,...(receipt.code?{code:receipt.code}:{})});
        if(pending)this.database.saveEntity("native-request",pending.record.id,json({...pending.record,commandId:command.commandId,state:receipt.state==="unknown"?"unknown":receipt.state==="rejected"?"expired":"consumed",receipt}));
        const control=this.store.control(fence.sessionId);
        if(["accepted","queued"].includes(receipt.state)&&control&&isDeepStrictEqual(this.store.binding(fence.sessionId),binding)) {
          if(command.type==="continue")this.consumeReclaimAction(fence,"continue");
          this.store.invalidateObservation({sessionId:fence.sessionId,readBarrier:randomUUID(),observation:{version:1,id:`native-command:${command.commandId}:accepted`,nativeSessionId:binding.nativeSessionId,...(binding.nativeThreadId?{nativeThreadId:binding.nativeThreadId}:{}),scopeFingerprint:scope,observedAt:this.now().toISOString(),state:"unknown",pendingTools:"unknown",pendingApprovals:"unknown",historyMode:"unknown",executionRefId:binding.executionRefId,readability:"unknown"}});
        }
      });}catch(error){if(pending)throw new InteractionGuardError("NATIVE_REQUEST_PERSISTENCE_FAILED");throw error;}
      return receipt;
    });
  }
  private commandExecution(command:InteractionCommand,receipt:NativeCommandReceipt):NativeCommandOutcome["execution"] {
    let execution:NativeCommandOutcome["execution"]="unconfirmed";
    const context=this.database.getEntity<JsonValue>("native-command-context",command.id) as {binding?:{nativeSessionId?:string};ingestionFloor?:number}|undefined;
    if(command.state==="ACKNOWLEDGED"&&receipt.nativeTurnId&&context&&Number.isSafeInteger(context.ingestionFloor)) {
      const rows=this.database.handle.prepare("SELECT document_json FROM entities WHERE kind='native-binding-event' AND json_extract(document_json,'$.ingestionSequence')>? AND json_extract(document_json,'$.applied')=1 AND json_extract(document_json,'$.event.sessionId')=? AND json_extract(document_json,'$.event.runId')=? AND json_extract(document_json,'$.event.turn.nativeTurnId')=? ORDER BY json_extract(document_json,'$.ingestionSequence') DESC LIMIT 32").all(context.ingestionFloor!,command.fence.sessionId,command.fence.runId,receipt.nativeTurnId) as Array<{document_json:string}>;
      for(const row of rows) {const event=(JSON.parse(row.document_json) as {event:NativeBindingEvent}).event;
        const authority=this.database.getEntity<JsonValue>("native-observer-authority",`${event.sessionId}:${event.turn.invocationId}`) as {controlEpoch?:number;controlRevision?:number}|undefined;
        if(event.generation!==command.fence.generation||event.leaseId!==command.fence.leaseId||event.nativeSessionId!==context.binding?.nativeSessionId||authority?.controlEpoch!==command.fence.expectedControlEpoch||authority.controlRevision!==command.fence.expectedControlRevision||receipt.nativeRequestId&&receipt.nativeRequestId!==event.turn.nativeRequestId||receipt.nativeMessageId&&receipt.nativeMessageId!==event.turn.nativeMessageId)continue;
        if(event.turn.state==="completed"||event.turn.state==="failed"){execution=event.turn.state;break;}if(event.turn.state==="running")execution="running";
      }
    }
    return execution;
  }
  getCommandOutcome(principal:InteractionPrincipal,commandId:string):NativeCommandOutcome {
    const command=this.store.command(commandId);if(!command)throw new InteractionGuardError("NATIVE_COMMAND_NOT_FOUND");
    this.assertInteraction(principal,"collect",command.fence);
    if(principal.id!==command.actorId&&!principal.roles.includes("admin"))throw new InteractionGuardError("FORBIDDEN");
    const receipt=this.commandReceipt(command);const execution=this.commandExecution(command,receipt);
    const control=this.store.control(command.fence.sessionId);
    const drift=control?.epoch!==command.fence.expectedControlEpoch||control?.revision!==command.fence.expectedControlRevision;
    return {commandId,state:command.state==="RESERVED"?"reserved":command.state==="CANCELLED"?"cancelled":receipt.state,execution,requiresReconciliation:receipt.state==="unknown"||receipt.state==="queued"&&!["completed","failed"].includes(execution)||Boolean(drift&&command.state==="ACKNOWLEDGED"),receipt};
  }

  reserveNativeStart(input:{run:Run;actorId:string;resumable:boolean;semantics:JsonValue;backendId?:string;configRevision?:number}):InteractionCommand {
    return this.database.transaction(()=>{
      const {run}=input;const id=`native-start:${run.id}`;
      if(!run.profileId||!run.providerId||!run.startedAt||!Number.isFinite(Date.parse(run.startedAt)))throw new InteractionStoreError("START_IDENTITY_REQUIRED");
      const existing=this.store.command(id);
      if(!existing&&run.state!=="STARTING")throw new InteractionStoreError("INVALID_START_STATE");
      const current=this.database.getEntity<JsonValue>("run",run.id) as unknown as Run|undefined;
      if(!existing&&current?.revokedLeaseIds?.includes(current.leaseId))throw new InteractionStoreError("STALE_RUN_AUTHORITY");
      if(!current||current.sessionId!==run.sessionId||current.taskId!==run.taskId||current.profileId!==run.profileId||current.providerId!==run.providerId||current.runnerId!==run.runnerId||current.attempt!==run.attempt||current.worktree!==run.worktree||current.branch!==run.branch||current.startedAt!==run.startedAt||current.generation!==run.generation||current.leaseId!==run.leaseId||!isDeepStrictEqual(current.executionRef,run.executionRef)||!isDeepStrictEqual(current.executionSelection,run.executionSelection))throw new InteractionStoreError("STALE_RUN_AUTHORITY");
      const task=this.database.getCanonicalTask<JsonValue>(run.taskId);
      if(!task)throw new InteractionStoreError("STALE_RUN_AUTHORITY");
      const before=this.database.getEntity<JsonValue>("session",run.sessionId) as unknown as Session|undefined;
      const session:Session={id:run.sessionId,profileId:run.profileId,providerId:run.providerId,resumable:input.resumable,createdAt:run.startedAt,updatedAt:run.startedAt,...(run.executionRef?{executionRef:run.executionRef}:{})};
      if(!before)this.database.saveEntity("session",session.id,json(session));
      else if(before.profileId!==session.profileId||before.providerId!==session.providerId||!isDeepStrictEqual(before.executionRef,session.executionRef))throw new InteractionStoreError("NATIVE_IDENTITY_CHANGED");
      this.freezeDriftPolicy(run);
      const control=existing?this.store.control(run.sessionId)!:this.store.initializeControl({sessionId:run.sessionId,activeRunId:run.id,exclusion:"none",at:run.startedAt});
      return this.store.reserveCommand({id,actorId:input.actorId,profileId:run.profileId,type:"start",fence:existing?.fence??{runId:run.id,sessionId:run.sessionId,commandId:id,expectedTaskRevision:task.revision,expectedCurrentRunId:run.id,expectedControlRevision:control.revision,expectedControlEpoch:control.epoch,generation:run.generation,leaseId:run.leaseId},semantics:json({input:input.semantics,executionRef:run.executionRef??null,executionSelection:run.executionSelection??null}),...(input.backendId?{backendId:input.backendId}:{}),...(input.configRevision!==undefined?{configRevision:input.configRevision}:{})});
    });
  }
  beginNativeStart(commandId:string):InteractionCommand {
    const command=this.store.command(commandId);if(!command||command.type!=="start")throw new InteractionStoreError("START_INTENT_NOT_FOUND");
    if(command.state!=="RESERVED")throw new InteractionStoreError(command.state==="SENDING"||command.state==="UNKNOWN"?"NATIVE_START_OUTCOME_UNKNOWN":"START_ALREADY_SETTLED");
    this.assertNativeStartAuthority(command);
    return this.store.updateCommand({id:command.id,expectedRevision:command.revision,state:"SENDING"});
  }
  /** A repeated check is valid only inside this one admitted invocation, never a retry. */
  nativeStartAdmission(commandId:string):()=>void {
    const reserved=this.store.command(commandId);
    if(!reserved||reserved.type!=="start")throw new InteractionStoreError("START_INTENT_NOT_FOUND");
    if(reserved.state!=="RESERVED")throw new InteractionStoreError("NATIVE_START_OUTCOME_UNKNOWN");
    let sending:InteractionCommand|undefined;
    return ()=>this.database.transaction(()=>{
      if(!sending){sending=this.beginNativeStart(commandId);return;}
      const current=this.store.command(commandId);
      if(!isDeepStrictEqual(current,sending))throw new InteractionStoreError("NATIVE_START_OUTCOME_UNKNOWN");
      this.assertNativeStartAuthority(sending);
    });
  }
  private assertNativeStartAuthority(command:InteractionCommand):void {
    const run=this.database.getEntity<JsonValue>("run",command.fence.runId) as unknown as Run|undefined;
    const task=run?this.database.getCanonicalTask<JsonValue>(run.taskId):undefined;
    const control=this.store.control(command.fence.sessionId),f=command.fence;
    if(!run||isTerminalRunState(run.state)||run.revokedLeaseIds?.includes(run.leaseId)||run.generation!==f.generation||run.leaseId!==f.leaseId||run.sessionId!==f.sessionId||run.profileId!==command.profileId||task?.revision!==f.expectedTaskRevision||(task.document as {currentRunId?:string}).currentRunId!==run.id||run.leaseExpiresAt&&(!Number.isFinite(Date.parse(run.leaseExpiresAt))||Date.parse(run.leaseExpiresAt)<=this.now().getTime()))throw new InteractionStoreError("STALE_RUN_AUTHORITY");
    if(!control||control.activeRunId!==run.id||control.revision!==f.expectedControlRevision||control.epoch!==f.expectedControlEpoch)throw new InteractionStoreError("STALE_CONTROL_REVISION");
    if(control.state!=="AUTOMATED")throw new InteractionStoreError("NATIVE_WRITE_LOCKED");
    this.assertDriftPolicy(run);
  }
  assertNativeStartProjection(commandId:string):void {
    const command=this.store.command(commandId);
    if(!command||command.type!=="start"||!["ACKNOWLEDGED","UNKNOWN","FAILED"].includes(command.state))throw new InteractionGuardError("NATIVE_START_OUTCOME_UNKNOWN");
    try{this.assertNativeStartAuthority(command);}catch(error){throw new InteractionGuardError(error instanceof InteractionStoreError?error.code:"STALE_RUN_AUTHORITY");}
  }
  cancelReservedStart(run:Run):boolean {
    return this.database.transaction(()=>{
      const command=this.startForRun(run.id);if(command?.state!=="RESERVED")return false;
      const current=this.database.getEntity<JsonValue>("run",run.id) as unknown as Run|undefined;
      if(!current||current.generation!==command.fence.generation||current.leaseId!==command.fence.leaseId||!(current.state==="STARTING"||current.state==="RUNNER_UNAVAILABLE"&&current.recoveryState==="STARTING")||current.sessionId!==command.fence.sessionId)throw new InteractionStoreError("STALE_RUN_AUTHORITY");
      this.store.updateCommand({id:command.id,expectedRevision:command.revision,state:"CANCELLED",code:"START_NOT_SENT"});return true;
    });
  }
  settleNativeStart(commandId:string,outcome:NativeStartOutcome):InteractionCommand {
    return this.database.transaction(()=>{
      const command=this.store.command(commandId);if(!command||command.type!=="start")throw new InteractionStoreError("START_INTENT_NOT_FOUND");
      if(outcome.kind==="not-created"&&command.state==="CANCELLED")return command;
      if(outcome.kind!=="created")return this.store.updateCommand({id:commandId,expectedRevision:command.revision,state:outcome.kind==="unknown"?"UNKNOWN":"FAILED",code:outcome.code});
      this.assertNativeStartAuthority(command);
      const session=outcome.session;const run=this.database.getEntity<JsonValue>("run",command.fence.runId) as unknown as Run|undefined;
      const task=run?this.database.getCanonicalTask<JsonValue>(run.taskId):undefined;
      if(!run||run.generation!==command.fence.generation||run.leaseId!==command.fence.leaseId||run.sessionId!==command.fence.sessionId||(task?.document as {currentRunId?:string}|undefined)?.currentRunId!==run.id||isTerminalRunState(run.state))throw new InteractionStoreError("STALE_RUN_AUTHORITY");
      if(session.id!==command.fence.sessionId||session.runId!==run.id||session.profileId!==undefined&&session.profileId!==command.profileId||session.workspacePath!==run.worktree||command.backendId!==undefined&&session.backendId!==command.backendId||run.executionSelection&&session.backendId!==run.executionSelection.backendId)throw new InteractionStoreError("NATIVE_IDENTITY_CHANGED");
      if(run.executionSelection&&!isDeepStrictEqual(session.executionSelection,run.executionSelection))throw new InteractionStoreError("MODEL_BINDING_DRIFT");
      if(run.executionSelection&&!isDeepStrictEqual(session.executionRef,run.executionRef))throw new InteractionStoreError("EXECUTION_CONTEXT_DRIFT");
      const canonical=this.database.getEntity<JsonValue>("session",session.id) as unknown as Session|undefined;
      if(!canonical||canonical.profileId!==command.profileId)throw new InteractionStoreError("NATIVE_IDENTITY_CHANGED");
      this.database.saveEntity("session",session.id,json({...canonical,...(session.providerSessionId?{nativeSessionId:session.providerSessionId}:{}),updatedAt:session.updatedAt}));
      if(session.providerSessionId)this.database.saveEntity("run",run.id,json({...run,providerSessionId:session.providerSessionId}));
      return this.store.updateCommand({id:command.id,expectedRevision:command.revision,state:"ACKNOWLEDGED",nativeReceipt:{version:1,commandId:command.id,state:"accepted"}});
    });
  }
}
