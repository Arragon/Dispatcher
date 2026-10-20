import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { isTerminalRunState, nativeBindingKey, normalizeNativeBinding, transitionControl, validateExecutionBinding, isLegacyRunModelSelection, type BindingValidation, type ControlEvent, type MutationFence, type NativeBinding, type NativeCommandReceipt, type NativeObservation, type Run, type Session, type SessionControl } from "@dispatcher/domain";
import type { DispatcherDatabase, JsonValue } from "./index.js";

const json=(value:unknown):JsonValue=>JSON.parse(JSON.stringify(value)) as JsonValue;
const stable=(value:JsonValue):JsonValue=>Array.isArray(value)?value.map(stable):value!==null&&typeof value==="object"?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key]!)])):value;
export class InteractionStoreError extends Error {constructor(readonly code:string){super(code);this.name="InteractionStoreError";}}
export type CommandState="RESERVED"|"SENDING"|"ACKNOWLEDGED"|"UNKNOWN"|"FAILED"|"CANCELLED";
export interface InteractionCommand {
  version:1;id:string;actorId:string;profileId:string;type:string;fence:MutationFence;semanticHash:string;
  state:CommandState;revision:number;createdAt:string;updatedAt:string;code?:string;nativeReceipt?:NativeCommandReceipt;
  backendId?:string;configRevision?:number;
}
export interface NativeSessionTombstone {version:1;sessionId:string;binding:NativeBinding;observationRef:string;scopeFingerprint:string;deletedAt:string}
export class InteractionStore {
  constructor(private readonly database:DispatcherDatabase){}
  private read<T>(table:string,column:string,id:string):T|undefined {
    const row=this.database.handle.prepare(`SELECT document_json FROM ${table} WHERE ${column}=?`).get(id) as {document_json:string}|undefined;
    return row?JSON.parse(row.document_json) as T:undefined;
  }
  binding(sessionId:string):NativeBinding|undefined{return this.read("native_bindings","session_id",sessionId);}
  control(sessionId:string):SessionControl|undefined{return this.read("session_controls","session_id",sessionId);}
  command(id:string):InteractionCommand|undefined{return this.read("interaction_commands","id",id);}
  diagnostics():Array<{id:string;sessionId:string;code:string}>{return this.database.handle.prepare("SELECT id,session_id AS sessionId,code FROM native_identity_diagnostics ORDER BY id").all() as Array<{id:string;sessionId:string;code:string}>;}
  audit(sessionId:string):JsonValue[]{return (this.database.handle.prepare("SELECT document_json FROM control_audit WHERE session_id=? ORDER BY sequence").all(sessionId) as Array<{document_json:string}>).map(row=>JSON.parse(row.document_json) as JsonValue);}

  private assertAuthority(profileId:string, fence:MutationFence):SessionControl {
    const run=this.database.getEntity<JsonValue>("run",fence.runId) as unknown as Run|undefined;
    const session=this.database.getEntity<JsonValue>("session",fence.sessionId) as unknown as Session|undefined;
    const control=this.control(fence.sessionId);
    const task=run?this.database.getCanonicalTask<JsonValue>(run.taskId):undefined;
    if(!run||!session||session.profileId!==profileId||run.profileId!==profileId||run.sessionId!==session.id||run.generation!==fence.generation||run.leaseId!==fence.leaseId||task?.revision!==fence.expectedTaskRevision||(task?.document as {currentRunId?:string}|undefined)?.currentRunId!==fence.expectedCurrentRunId||fence.expectedCurrentRunId!==run.id||isTerminalRunState(run.state))throw new InteractionStoreError("STALE_RUN_AUTHORITY");
    if(!control||control.activeRunId!==run.id||control.revision!==fence.expectedControlRevision)throw new InteractionStoreError("STALE_CONTROL_REVISION");
    if(control.epoch!==fence.expectedControlEpoch)throw new InteractionStoreError("STALE_CONTROL_EPOCH");
    return control;
  }

  bindNative(input:{sessionId:string;runId:string;binding:NativeBinding;expectedGeneration:number;expectedLeaseId:string}):NativeBinding {
    return this.database.transaction(()=>{
      const session=this.database.getEntity<JsonValue>("session",input.sessionId) as unknown as Session|undefined;
      const run=this.database.getEntity<JsonValue>("run",input.runId) as unknown as Run|undefined;
      if(!session||!run||run.generation!==input.expectedGeneration||run.leaseId!==input.expectedLeaseId||isTerminalRunState(run.state))throw new InteractionStoreError("NATIVE_EVENT_STALE");
      const task=this.database.getCanonicalTask<JsonValue>(run.taskId)?.document as {currentRunId?:string}|undefined;
      if(task?.currentRunId!==run.id)throw new InteractionStoreError("NATIVE_EVENT_STALE");
      const binding=input.binding;
      assertBindingShape(binding);
      if(this.database.getEntity("native-session-tombstone",nativeBindingKey(binding)))throw new InteractionStoreError("NATIVE_SESSION_DELETED");
      const diagnostic=this.database.handle.prepare("SELECT code FROM native_identity_diagnostics WHERE session_id=?").get(session.id) as {code:string}|undefined;
      if(diagnostic&&diagnostic.code!=="LEGACY_NATIVE_BINDING_MISSING")throw new InteractionStoreError(diagnostic.code);
      const normalized=normalizeNativeBinding(session,{id:input.sessionId,runId:input.runId,profileId:binding.profileId,backendId:binding.backendId,nativeBinding:binding},run);
      if(normalized.state!=="bound")throw new InteractionStoreError("code" in normalized?normalized.code:"NATIVE_IDENTITY_CHANGED");
      if(!run.executionRef||run.executionRef.id!==binding.executionRefId||session.executionRef&&!isDeepStrictEqual(session.executionRef,run.executionRef))throw new InteractionStoreError("EXECUTION_CONTEXT_DRIFT");
      const validation=validateRunBinding(this.database,run,binding);if(!validation.valid)throw new InteractionStoreError(validation.code);
      const key=nativeBindingKey(binding);
      const quarantined=this.database.handle.prepare("SELECT code FROM native_identity_diagnostics WHERE binding_key=?").get(key) as {code:string}|undefined;
      if(quarantined)throw new InteractionStoreError(quarantined.code);
      const owner=this.database.handle.prepare("SELECT session_id FROM native_bindings WHERE binding_key=?").get(key) as {session_id:string}|undefined;
      if(owner&&owner.session_id!==input.sessionId)throw new InteractionStoreError("NATIVE_BINDING_CONFLICT");
      const existing=this.binding(input.sessionId);if(existing&&!isDeepStrictEqual(existing,binding))throw new InteractionStoreError("NATIVE_IDENTITY_CHANGED");
      const adapter=this.database.getEntity<JsonValue>("adapter-session",input.sessionId) as Record<string,JsonValue>|undefined;
      if(adapter&&(adapter.runId!==run.id||adapter.profileId!==undefined&&adapter.profileId!==session.profileId||adapter.backendId!==binding.backendId||adapter.providerSessionId!==undefined&&adapter.providerSessionId!==binding.nativeSessionId))throw new InteractionStoreError("NATIVE_IDENTITY_CHANGED");
      this.database.saveEntity("session",session.id,json({...session,nativeBinding:binding,nativeSessionId:binding.nativeSessionId,executionRef:run.executionRef}));
      this.database.saveEntity("run",run.id,json({...run,providerSessionId:binding.nativeSessionId}));
      if(adapter)this.database.saveEntity("adapter-session",session.id,json({...adapter,nativeBinding:binding,providerSessionId:binding.nativeSessionId}));
      this.database.handle.prepare("INSERT INTO native_bindings(session_id,binding_key,profile_id,execution_ref_id,document_json) VALUES(?,?,?,?,?) ON CONFLICT(session_id) DO NOTHING").run(session.id,key,binding.profileId,binding.executionRefId,JSON.stringify(binding));
      return structuredClone(binding);
    });
  }
  initializeControl(input:{sessionId:string;activeRunId:string;exclusion:SessionControl["exclusion"];at:string}):SessionControl {
    return this.database.transaction(()=>{
      const run=this.database.getEntity<JsonValue>("run",input.activeRunId) as unknown as Run|undefined;
      const session=this.database.getEntity<JsonValue>("session",input.sessionId) as unknown as Session|undefined;
      if(!run||!session||run.sessionId!==session.id||run.profileId!==session.profileId||input.exclusion!=="none"&&!this.binding(session.id))throw new InteractionStoreError("NATIVE_IDENTITY_CHANGED");
      if(isTerminalRunState(run.state))throw new InteractionStoreError("TERMINAL_RUN");
      if(!this.binding(session.id)){
        const diagnostic=this.database.handle.prepare("SELECT code FROM native_identity_diagnostics WHERE session_id=?").get(session.id) as {code:string}|undefined;
        if(diagnostic)throw new InteractionStoreError(diagnostic.code);
      }
      const task=this.database.getCanonicalTask<JsonValue>(run.taskId)?.document as {currentRunId?:string}|undefined;
      if(task?.currentRunId!==run.id)throw new InteractionStoreError("STALE_RUN_AUTHORITY");
      if(!Number.isFinite(Date.parse(input.at)))throw new InteractionStoreError("INVALID_CONTROL_RECORD");
      const existing=this.control(session.id);if(existing){if(existing.activeRunId!==run.id)throw new InteractionStoreError("NATIVE_BINDING_CONFLICT");return existing;}
      const control:SessionControl={version:1,sessionId:session.id,activeRunId:run.id,state:"AUTOMATED",epoch:1,revision:1,exclusion:input.exclusion,updatedAt:input.at};
      this.database.handle.prepare("INSERT INTO session_controls(session_id,active_run_id,epoch,revision,state,document_json) VALUES(?,?,?,?,?,?)").run(session.id,run.id,1,1,control.state,JSON.stringify(control));return control;
    });
  }
  compareAndSwapControl(input:{sessionId:string;expectedRevision:number;expectedEpoch:number;actorId:string;event:ControlEvent}):SessionControl {
    return this.database.transaction(()=>{
      const current=this.control(input.sessionId);if(!current||current.revision!==input.expectedRevision)throw new InteractionStoreError("STALE_CONTROL_REVISION");
      if(current.epoch!==input.expectedEpoch)throw new InteractionStoreError("STALE_CONTROL_EPOCH");
      if(input.event.type==="request-handoff"&&input.event.principalId!==input.actorId)throw new InteractionStoreError("SESSION_OWNER_MISMATCH");
      if(input.event.type==="reconcile-verified"){
        const run=this.database.getEntity<JsonValue>("run",current.activeRunId) as unknown as Run|undefined;
        if(!run||isTerminalRunState(run.state))throw new InteractionStoreError("TERMINAL_RUN");
        const task=this.database.getCanonicalTask<JsonValue>(run.taskId)?.document as {currentRunId?:string}|undefined;
        if(run.sessionId!==current.sessionId||task?.currentRunId!==run.id)throw new InteractionStoreError("STALE_RUN_AUTHORITY");
        const checkpoint=this.database.handle.prepare("SELECT control_epoch FROM native_observation_checkpoints WHERE session_id=?").get(current.sessionId) as {control_epoch:number}|undefined;
        const observation=this.observation(current.sessionId);
        if(!observation||observation.id!==input.event.observationRef||checkpoint?.control_epoch!==current.epoch)throw new InteractionStoreError("NATIVE_STATE_UNKNOWN");
        if(observation.state!=="idle"||observation.pendingApprovals!=="none"||observation.pendingTools!=="none")throw new InteractionStoreError("HANDOFF_NOT_QUIESCENT");
      }
      const next=transitionControl(current,input.event,input.expectedRevision);
      if(isDeepStrictEqual(current,next))return current;
      const result=this.database.handle.prepare("UPDATE session_controls SET epoch=?,revision=?,state=?,document_json=? WHERE session_id=? AND revision=? AND epoch=?").run(next.epoch,next.revision,next.state,JSON.stringify(next),input.sessionId,input.expectedRevision,input.expectedEpoch);
      if(result.changes!==1)throw new InteractionStoreError("STALE_CONTROL_REVISION");
      if(input.event.type==="reconcile-verified"){
        // The verified read was admitted under RECONCILING. Its authority promotion
        // must commit with the new epoch without inventing a new observer sequence.
        const promoted=this.database.handle.prepare("UPDATE native_observation_checkpoints SET control_epoch=? WHERE session_id=? AND control_epoch=? AND observation_id=?").run(next.epoch,input.sessionId,current.epoch,input.event.observationRef);
        if(promoted.changes!==1)throw new InteractionStoreError("NATIVE_STATE_UNKNOWN");
      }
      if(next.state!=="AUTOMATED"){
        const queued=this.database.handle.prepare("SELECT id,document_json FROM interaction_commands WHERE session_id=? AND state='RESERVED'").all(input.sessionId) as Array<{id:string;document_json:string}>;
        for(const row of queued){const command=JSON.parse(row.document_json) as InteractionCommand;this.updateCommand({id:row.id,expectedRevision:command.revision,state:"CANCELLED",code:"STALE_CONTROL_EPOCH"});}
      }
      const audit={version:1,actorId:input.actorId,event:input.event.type,oldEpoch:current.epoch,newEpoch:next.epoch,oldRevision:current.revision,newRevision:next.revision,state:next.state,at:next.updatedAt};
      this.database.handle.prepare("INSERT INTO control_audit(id,session_id,document_json) VALUES(?,?,?)").run(randomUUID(),input.sessionId,JSON.stringify(audit));return next;
    });
  }
  reserveCommand(input:{id:string;actorId:string;profileId:string;type:string;fence:MutationFence;semantics:JsonValue;backendId?:string;configRevision?:number}):InteractionCommand {
    return this.database.transaction(()=>{
      if(input.id!==input.fence.commandId||!input.id||input.id.length>200||!input.actorId||!input.type)throw new InteractionStoreError("INVALID_COMMAND");
      const semanticHash=createHash("sha256").update(JSON.stringify(stable(json(input)))).digest("hex");
      const existing=this.command(input.id);if(existing){if(existing.semanticHash!==semanticHash)throw new InteractionStoreError("IDEMPOTENCY_CONFLICT");return existing;}
      const fence=input.fence;const control=this.assertAuthority(input.profileId,fence);
      if(input.type==="release-control"&&control.state!=="HANDOFF_REQUESTED")throw new InteractionStoreError("NATIVE_WRITE_LOCKED");
      if(control.state!=="AUTOMATED"&&!(control.state==="HANDOFF_REQUESTED"&&["reject-approval","release-control"].includes(input.type))&&!["request-return","cancel","interrupt","request-handoff"].includes(input.type))throw new InteractionStoreError("NATIVE_WRITE_LOCKED");
      const now=new Date().toISOString();const command:InteractionCommand={version:1,id:input.id,actorId:input.actorId,profileId:input.profileId,type:input.type,fence:structuredClone(fence),semanticHash,state:"RESERVED",revision:1,createdAt:now,updatedAt:now,...(input.backendId?{backendId:input.backendId}:{}),...(input.configRevision!==undefined?{configRevision:input.configRevision}:{})};
      this.database.handle.prepare("INSERT INTO interaction_commands(id,session_id,semantic_hash,state,revision,document_json) VALUES(?,?,?,?,?,?)").run(command.id,fence.sessionId,semanticHash,command.state,1,JSON.stringify(command));return command;
    });
  }
  updateCommand(input:{id:string;expectedRevision:number;state:CommandState;code?:string;nativeReceipt?:NativeCommandReceipt}):InteractionCommand {
    return this.database.transaction(()=>{
      const current=this.command(input.id);if(!current||current.revision!==input.expectedRevision)throw new InteractionStoreError("STALE_COMMAND_REVISION");
      const transitions:Record<CommandState,CommandState[]>={RESERVED:["SENDING","CANCELLED","FAILED",...(current.type==="start"?["UNKNOWN" as const]:[])],SENDING:["ACKNOWLEDGED","UNKNOWN","FAILED","CANCELLED"],UNKNOWN:["ACKNOWLEDGED","FAILED"],ACKNOWLEDGED:[],FAILED:[],CANCELLED:[]};
      if(!transitions[current.state].includes(input.state))throw new InteractionStoreError("INVALID_COMMAND_TRANSITION");
      // Reservation is not authority to send later: Task/control may have changed.
      if(input.state==="SENDING")this.assertAuthority(current.profileId,current.fence);
      if(input.nativeReceipt&&input.nativeReceipt.commandId!==input.id)throw new InteractionStoreError("INVALID_COMMAND_RECEIPT");
      const next={...current,state:input.state,revision:current.revision+1,updatedAt:new Date().toISOString(),...(input.code?{code:input.code}:{}),...(input.nativeReceipt?{nativeReceipt:structuredClone(input.nativeReceipt)}:{})};
      const result=this.database.handle.prepare("UPDATE interaction_commands SET state=?,revision=?,document_json=? WHERE id=? AND revision=?").run(next.state,next.revision,JSON.stringify(next),input.id,input.expectedRevision);if(result.changes!==1)throw new InteractionStoreError("STALE_COMMAND_REVISION");return next;
    });
  }
  nativeReadBarrier(sessionId:string):string|undefined {
    return (this.database.getEntity<JsonValue>("native-read-barrier",sessionId) as {id:string}|undefined)?.id;
  }
  nativeDeletion(sessionId:string):NativeSessionTombstone|undefined {
    const binding=this.binding(sessionId);
    return binding?this.database.getEntity<JsonValue>("native-session-tombstone",nativeBindingKey(binding)) as unknown as NativeSessionTombstone|undefined:undefined;
  }
  invalidateObservation(input:{sessionId:string;readBarrier:string;observation:NativeObservation}):void {
    const binding=this.binding(input.sessionId);const observation=input.observation;
    if(!binding||!input.readBarrier||observation.state!=="unknown"||observation.nativeSessionId!==binding.nativeSessionId||observation.nativeThreadId!==binding.nativeThreadId||observation.executionRefId!==binding.executionRefId)throw new InteractionStoreError("NATIVE_IDENTITY_CHANGED");
    // This barrier invalidates pending reads without consuming a real observer sequence.
    this.database.saveEntity("native-read-barrier",input.sessionId,json({id:input.readBarrier,observation}));
  }
  saveObservation(input:{sessionId:string;observerGeneration:number;observerSequence:number;controlEpoch:number;observation:NativeObservation;readBarrier?:string}):{accepted:boolean;code?:string} {
    return this.database.transaction(()=>{
      const binding=this.binding(input.sessionId);const observation=input.observation;
      if(!binding||observation.version!==1||!observation.id||!observation.scopeFingerprint||!Number.isFinite(Date.parse(observation.observedAt))||binding.nativeSessionId!==observation.nativeSessionId||binding.nativeThreadId!==observation.nativeThreadId||observation.executionRefId!==undefined&&observation.executionRefId!==binding.executionRefId||!Number.isSafeInteger(input.observerGeneration)||input.observerGeneration<1||!Number.isSafeInteger(input.observerSequence)||input.observerSequence<1||!Number.isSafeInteger(input.controlEpoch)||input.controlEpoch<1)throw new InteractionStoreError("NATIVE_IDENTITY_CHANGED");
      const existing=this.database.handle.prepare("SELECT session_id,document_json FROM native_observations WHERE id=?").get(observation.id) as {session_id:string;document_json:string}|undefined;
      if(existing){if(existing.session_id!==input.sessionId||!isDeepStrictEqual(JSON.parse(existing.document_json),observation))throw new InteractionStoreError("NATIVE_OBSERVATION_CONFLICT");return {accepted:false};}
      this.database.handle.prepare("INSERT INTO native_observations(id,session_id,observer_generation,observer_sequence,control_epoch,document_json) VALUES(?,?,?,?,?,?)").run(observation.id,input.sessionId,input.observerGeneration,input.observerSequence,input.controlEpoch,JSON.stringify(observation));
      const readBarrier=this.nativeReadBarrier(input.sessionId);
      if(readBarrier!==input.readBarrier)return {accepted:false,code:"STALE_NATIVE_READ_BARRIER"};
      if(this.nativeDeletion(input.sessionId)&&observation.state!=="deleted")return {accepted:false,code:"NATIVE_SESSION_DELETED"};
      const control=this.control(input.sessionId);if(control?.epoch!==input.controlEpoch)return {accepted:false,code:"STALE_CONTROL_EPOCH"};
      const checkpoint=this.database.handle.prepare("SELECT observer_generation,observer_sequence,control_epoch FROM native_observation_checkpoints WHERE session_id=?").get(input.sessionId) as {observer_generation:number;observer_sequence:number;control_epoch:number}|undefined;
      if(checkpoint&&checkpoint.observer_generation>input.observerGeneration)return {accepted:false,code:"STALE_OBSERVER_GENERATION"};
      if(checkpoint&&checkpoint.observer_generation===input.observerGeneration&&checkpoint.observer_sequence>=input.observerSequence)return {accepted:false,code:"STALE_OBSERVER_SEQUENCE"};
      this.database.handle.prepare("INSERT INTO native_observation_checkpoints(session_id,observation_id,observer_generation,observer_sequence,control_epoch) VALUES(?,?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET observation_id=excluded.observation_id,observer_generation=excluded.observer_generation,observer_sequence=excluded.observer_sequence,control_epoch=excluded.control_epoch").run(input.sessionId,observation.id,input.observerGeneration,input.observerSequence,input.controlEpoch);
      if(readBarrier)this.database.saveEntity("native-read-barrier",input.sessionId,{id:readBarrier});
      if(observation.state==="deleted"&&!this.nativeDeletion(input.sessionId))this.database.saveEntity("native-session-tombstone",nativeBindingKey(binding),json({version:1,sessionId:input.sessionId,binding,observationRef:observation.id,scopeFingerprint:observation.scopeFingerprint,deletedAt:observation.observedAt}));
      return {accepted:true};
    });
  }
  observation(sessionId:string):NativeObservation|undefined {
    const invalidated=(this.database.getEntity<JsonValue>("native-read-barrier",sessionId) as unknown as {observation?:NativeObservation}|undefined)?.observation;
    if(invalidated)return structuredClone(invalidated);
    const row=this.database.handle.prepare("SELECT o.document_json FROM native_observation_checkpoints c JOIN native_observations o ON o.id=c.observation_id WHERE c.session_id=?").get(sessionId) as {document_json:string}|undefined;return row?JSON.parse(row.document_json) as NativeObservation:undefined;
  }
}

function assertBindingShape(binding:NativeBinding):void {
  const required=[binding.product,binding.region,binding.profileId,binding.backendId,binding.runnerId,binding.nativeStoreRef,binding.nativeSessionId,binding.executionRefId];
  const optional=[binding.nativeThreadId,binding.parentSessionId].filter(value=>value!==undefined);
  if(binding.version!==1||[...required,...optional].some(value=>typeof value!=="string"||!value||value.includes("\0"))||!["bound","missing","deleted","unreachable"].includes(binding.identityState))throw new InteractionStoreError("NATIVE_IDENTITY_CHANGED");
}

function identifiableBindingKey(value:unknown):string|undefined {
  if(!value||typeof value!=="object"||Array.isArray(value))return undefined;
  const record=value as Record<string,unknown>;
  const fields=[record.product,record.region,record.nativeStoreRef,record.nativeSessionId,...(record.nativeThreadId===undefined?[]:[record.nativeThreadId])];
  if(fields.some(field=>typeof field!=="string"||!field||field.includes("\0")))return undefined;
  // Ownership/context can be corrupt while the native identity remains known.
  return nativeBindingKey(value as NativeBinding);
}

export function migrateNativeInteractions(database:DispatcherDatabase):void {
  const sessions = database.listEntities<JsonValue>("session") as unknown as Session[];
  const sessionsById = new Map(sessions.map(session => [session.id, session]));
  const adapters = database.listEntities<JsonValue>("adapter-session") as Array<Record<string, JsonValue>>;
  const adaptersById = new Map(adapters.filter(adapter => typeof adapter.id === "string").map(adapter => [adapter.id as string, adapter]));
  const runsBySession = new Map<string, Run[]>();
  for (const run of database.listEntities<JsonValue>("run") as unknown as Run[]) {
    runsBySession.set(run.sessionId, [...runsBySession.get(run.sessionId) ?? [], run]);
  }
  // Inspect every recorded owner before adopting any key. An Adapter-only or
  // contradictory identity can dispute an otherwise valid canonical record.
  const keysBySession = new Map<string, Set<string>>();
  const ownersByKey = new Map<string, Set<string>>();
  for (const id of new Set([...sessionsById.keys(), ...adaptersById.keys()])) {
    const keys = new Set<string>();
    for (const value of [sessionsById.get(id)?.nativeBinding, adaptersById.get(id)?.nativeBinding]) {
      if (!value) continue;
      const key=identifiableBindingKey(value);
      if(key)keys.add(key);
    }
    keysBySession.set(id, keys);
    for (const key of keys) ownersByKey.set(key, new Set([...ownersByKey.get(key) ?? [], id]));
  }
  const diagnostic = (sessionId:string, code:string) => {
    const keys = [...keysBySession.get(sessionId) ?? []];
    for (const [index, key] of (keys.length ? keys : [null]).entries()) {
      const suffix = index === 0 ? "" : `:${createHash("sha256").update(key!).digest("hex")}`;
      database.handle.prepare("INSERT INTO native_identity_diagnostics(id,session_id,code,binding_key) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING")
        .run(`legacy:${sessionId}${suffix}`, sessionId, code, key);
    }
  };
  for (const session of sessions) {
    const binding = session.nativeBinding;
    const adapter = adaptersById.get(session.id);
    if (!binding) { diagnostic(session.id, "LEGACY_NATIVE_BINDING_MISSING"); continue; }
    try {
      assertBindingShape(binding);
      if (adapter?.nativeBinding) assertBindingShape(adapter.nativeBinding as unknown as NativeBinding);
    } catch { diagnostic(session.id, "LEGACY_NATIVE_BINDING_UNVERIFIED"); continue; }
    if ([...keysBySession.get(session.id) ?? []].some(key => (ownersByKey.get(key)?.size ?? 0) > 1)) {
      diagnostic(session.id, "NATIVE_BINDING_CONFLICT"); continue;
    }
    const runs = runsBySession.get(session.id) ?? [];
    const run = runs[0];
    if (runs.length !== 1 || !run?.executionRef || run.executionRef.id !== binding.executionRefId) {
      diagnostic(session.id, "LEGACY_NATIVE_BINDING_UNVERIFIED"); continue;
    }
    const executionRef = run.executionRef;
    if (session.executionRef && !isDeepStrictEqual(session.executionRef, executionRef)) {
      diagnostic(session.id, "EXECUTION_CONTEXT_DRIFT"); continue;
    }
    if (adapter && (adapter.runId !== run.id || adapter.profileId !== undefined && adapter.profileId !== session.profileId || adapter.backendId !== binding.backendId || adapter.providerSessionId !== undefined && adapter.providerSessionId !== binding.nativeSessionId)) {
      diagnostic(session.id, "NATIVE_IDENTITY_CHANGED"); continue;
    }
    const normalized = normalizeNativeBinding(session, {
      id:session.id, runId:run.id, profileId:session.profileId, backendId:binding.backendId,
      nativeBinding:(adapter?.nativeBinding ?? binding) as NativeBinding,
    }, run);
    if (normalized.state !== "bound") { diagnostic(session.id, "NATIVE_IDENTITY_CHANGED"); continue; }
    const validation=validateRunBinding(database,run,binding);
    if(!validation.valid){diagnostic(session.id,validation.code);continue;}
    database.handle.prepare("INSERT INTO native_bindings(session_id,binding_key,profile_id,execution_ref_id,document_json) VALUES(?,?,?,?,?)")
      .run(session.id, nativeBindingKey(binding), binding.profileId, binding.executionRefId, JSON.stringify(binding));
    database.saveEntity("run", run.id, json({...run, providerSessionId:binding.nativeSessionId}));
    database.saveEntity("session", session.id, json({...session, nativeSessionId:binding.nativeSessionId, executionRef}));
    if (adapter) database.saveEntity("adapter-session", session.id, json({...adapter, nativeBinding:adapter.nativeBinding ?? binding, providerSessionId:binding.nativeSessionId}));
  }
  for (const id of adaptersById.keys()) {
    if (!sessionsById.has(id)) diagnostic(id, "LEGACY_NATIVE_BINDING_MISSING");
  }
}

// Both live binding and migration validate only stored Run facts. Current config
// cannot repair an incomplete historical execution context.
function validateRunBinding(database:DispatcherDatabase,run:Run,binding:NativeBinding):BindingValidation {
  const ref=run.executionRef;
  if(!ref)return {valid:false,code:"EXECUTION_CONTEXT_DRIFT"};
  if(run.executionSelection){
    const contract=database.getEntity<JsonValue>("run-contract",run.id) as {workspace?:{repositoryId?:string;baseCommit?:string}}|undefined;
    const context=contract?.workspace;
    if(!context?.repositoryId||!context.baseCommit)return {valid:false,code:"EXECUTION_CONTEXT_DRIFT"};
    return validateExecutionBinding({profileId:run.profileId,providerId:run.providerId,backendId:binding.backendId,runnerId:run.runnerId,executionRef:ref,nativeBinding:binding},run.executionSelection,{repositoryId:context.repositoryId,baseRevision:context.baseCommit});
  }
  const legacy=(run as unknown as Record<string,unknown>).modelSelection;
  if(legacy!==undefined){
    if(!isLegacyRunModelSelection(legacy)||legacy.profileId!==run.profileId||legacy.providerId!==run.providerId||legacy.backendId!==binding.backendId)return {valid:false,code:"MODEL_BINDING_DRIFT"};
    if("repositoryId" in ref&&(ref.repositoryId!==legacy.context.repositoryId||ref.baseRevision!==legacy.context.baseRevision))return {valid:false,code:"EXECUTION_CONTEXT_DRIFT"};
  }
  return {valid:true};
}
