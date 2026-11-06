import { isTerminalRunState, type Run, type Session } from "@dispatcher/domain";
import type { AdapterSession } from "@dispatcher/adapters";
import { InteractionStore, type DispatcherDatabase, type JsonValue } from "@dispatcher/persistence";
import type { CleanupPlan, WorkspaceManager, WorkspacePin } from "@dispatcher/workspace";

export type SessionCleanupPlan=CleanupPlan|{safe:false;reasons:string[];pins:WorkspacePin[];sessionId:string;workspaceId?:string};
/** Durable retention facts are read by cleanup; elapsed time never releases a reference. */
export class NativeSessionRetention {
 private readonly store:InteractionStore;
 constructor(private readonly database:DispatcherDatabase){this.store=new InteractionStore(database);}
 getWorkspacePins(workspaceId:string):WorkspacePin[] {
  return this.database.transaction(()=>this.readWorkspacePins(workspaceId));
 }
 private readWorkspacePins(workspaceId:string):WorkspacePin[] {
  if(!workspaceId||workspaceId.length>512)throw new Error("INVALID_WORKSPACE_ID");
  const runs=(this.database.handle.prepare("SELECT document_json FROM entities WHERE kind='run' AND (id=? OR json_extract(document_json,'$.executionRef.workspaceId')=?) LIMIT 201").all(workspaceId,workspaceId) as Array<{document_json:string}>).map(row=>JSON.parse(row.document_json) as Run);
  const records=this.database.handle.prepare("SELECT document_json FROM entities WHERE kind='session' AND json_extract(document_json,'$.executionRef.workspaceId')=? LIMIT 201").all(workspaceId) as Array<{document_json:string}>;
  const adapters=(this.database.handle.prepare("SELECT document_json FROM entities WHERE kind='adapter-session' AND json_extract(document_json,'$.runId')=? LIMIT 201").all(workspaceId) as Array<{document_json:string}>).map(row=>JSON.parse(row.document_json) as AdapterSession);
  if(runs.length>200||records.length>200||adapters.length>200)throw new Error("RETENTION_INDEX_LIMIT");
  const sessions=new Map(records.map(row=>{const session=JSON.parse(row.document_json) as Session;return [session.id,session] as const;}));
  for(const run of runs){const session=this.database.getEntity<JsonValue>("session",run.sessionId) as unknown as Session|undefined;if(session)sessions.set(session.id,session);}
  const pins:WorkspacePin[]=[];
  const pin=(sessionId:string,reason:string)=>{if(!pins.some(item=>item.sessionId===sessionId&&item.reason===reason))pins.push({workspaceId,sessionId,reason});};
  // Legacy adapters retain the actual Run/workspace association after Run pruning.
  for(const adapter of adapters){
   const session=this.database.getEntity<JsonValue>("session",adapter.id) as unknown as Session|undefined;if(session)sessions.set(session.id,session);
   if(adapter.providerSessionId||adapter.nativeBinding)pin(adapter.id,"NATIVE_SESSION_REFERENCE");
   if(["RUNNING","WAITING_INPUT"].includes(adapter.state))pin(adapter.id,"ACTIVE_NATIVE_JOB");
  }
  for(const run of runs){if(!isTerminalRunState(run.state))pin(run.sessionId,"ACTIVE_RUN");if((this.database.getEntity<JsonValue>("native-cancel",run.id) as {resolution?:{nativeMayBeRunning?:boolean}}|undefined)?.resolution?.nativeMayBeRunning)pin(run.sessionId,"NATIVE_CANCEL_UNCONFIRMED");}
  for(const session of sessions.values()){
   const control=this.store.control(session.id);const binding=this.store.binding(session.id);const observation=this.store.observation(session.id);
   if(control&&control.state!=="AUTOMATED")pin(session.id,["HUMAN","HANDOFF_REQUESTED","CONFLICT","RECONCILING"].includes(control.state)?control.state:"CONTROL_STATE_UNKNOWN");
   if(binding||session.nativeSessionId)pin(session.id,"NATIVE_SESSION_REFERENCE");
   if(binding){
    if(!observation||["unknown","unreachable"].includes(observation.state))pin(session.id,"NATIVE_STATE_UNKNOWN");
    if(observation?.state==="deleted"||this.store.nativeDeletion(session.id))pin(session.id,"NATIVE_SESSION_DELETED");
    if(observation?.pendingTools!=="none")pin(session.id,observation?.pendingTools==="present"?"BACKGROUND_TOOLS":"BACKGROUND_TOOLS_UNKNOWN");
    if(observation?.pendingApprovals!=="none")pin(session.id,"PENDING_APPROVALS");
   }
   const commands=this.database.handle.prepare("SELECT state,document_json FROM interaction_commands WHERE session_id=? AND (state IN ('RESERVED','SENDING','UNKNOWN') OR json_extract(document_json,'$.nativeReceipt.state')='queued') LIMIT 201").all(session.id) as Array<{state:string;document_json:string}>;
   if(commands.length>200)throw new Error("RETENTION_INDEX_LIMIT");
   for(const command of commands)pin(session.id,command.state==="UNKNOWN"||command.state==="SENDING"?"UNKNOWN_COMMAND":command.state==="RESERVED"?"UNSENT_COMMAND":"NATIVE_QUEUE_UNCONFIRMED");
  }
  return pins;
 }
 async planSessionCleanup(sessionId:string,manager:WorkspaceManager):Promise<SessionCleanupPlan> {
  const session=this.database.getEntity<JsonValue>("session",sessionId) as unknown as Session|undefined;
  const ref=session?.executionRef;
  const legacy=!ref?this.database.getEntity<JsonValue>("adapter-session",sessionId) as unknown as AdapterSession|undefined:undefined;
  const workspaceId=ref?.kind==="managed-worktree"?ref.workspaceId:legacy?.runId;
  if(!workspaceId)return {safe:false,sessionId,reasons:["session execution workspace is unavailable"],pins:[]};
  const pins=this.getWorkspacePins(workspaceId);const workspace=manager.getForRun(workspaceId);
  if(!workspace)return {safe:false,sessionId,workspaceId,reasons:["workspace is not registered by this manager"],pins};
  return manager.cleanupPlan(workspace);
 }
}
