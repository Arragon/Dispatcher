import {isDeepStrictEqual} from "node:util";
import type {Run,Session} from "@dispatcher/domain";
import type {AdapterSession} from "@dispatcher/adapters";
import {InteractionStore,type DispatcherDatabase,type JsonValue} from "@dispatcher/persistence";
import {contentHash} from "./task-publications.js";

/** Read-only qualification of this Controller's unbound local start journal. */
export function isGuardedControllerStart(database:DispatcherDatabase,run:Run):boolean {
  try{
    if(run.executionRef||Object.hasOwn(run,"modelSelection")||!run.executionSelection)return false;
    const selection=run.executionSelection;
    if(selection.version!==1||selection.profileId!==run.profileId||selection.runnerId!==run.runnerId||selection.providerId!==run.providerId||!selection.backendId||!selection.contextFingerprint||!Number.isSafeInteger(selection.configRevision)||selection.configRevision<1)return false;
    const store=new InteractionStore(database),control=store.control(run.sessionId),command=store.command(`native-start:${run.id}`);
    const session=database.getEntity<JsonValue>("session",run.sessionId) as unknown as Session|undefined;
    if(!control||control.version!==1||control.sessionId!==run.sessionId||control.activeRunId!==run.id||control.state!=="AUTOMATED"||control.epoch!==1||control.revision!==1||control.exclusion!=="none")return false;
    const row=database.handle.prepare("SELECT session_id,epoch,revision,state FROM session_controls WHERE active_run_id=?").all(run.id);
    if(row.length!==1||row[0]!.session_id!==run.sessionId||row[0]!.epoch!==1||row[0]!.revision!==1||row[0]!.state!=="AUTOMATED")return false;
    if(store.binding(run.sessionId)||!session||session.id!==run.sessionId||session.profileId!==run.profileId||session.providerId!==run.providerId||session.nativeBinding||session.executionRef)return false;
    if(database.handle.prepare("SELECT 1 FROM native_identity_diagnostics WHERE session_id=? AND code!='LEGACY_NATIVE_BINDING_MISSING' LIMIT 1").get(run.sessionId))return false;
    if(!command||command.id!==`native-start:${run.id}`||command.type!=="start"||!command.actorId||command.profileId!==run.profileId||command.backendId!==selection.backendId||command.configRevision!==selection.configRevision||!["RESERVED","SENDING","UNKNOWN","ACKNOWLEDGED","FAILED","CANCELLED"].includes(command.state))return false;
    const fence=command.fence;
    if(!fence||fence.runId!==run.id||fence.sessionId!==run.sessionId||fence.commandId!==command.id||fence.expectedCurrentRunId!==run.id||fence.generation!==run.generation||fence.leaseId!==run.leaseId||fence.expectedControlEpoch!==1||fence.expectedControlRevision!==1||!Number.isSafeInteger(fence.expectedTaskRevision)||fence.expectedTaskRevision<1)return false;
    const task=database.getCanonicalTask<JsonValue>(run.taskId),contract=database.getEntity<JsonValue>("run-contract",run.id);
    if(!task||(task.document as {currentRunId?:string}).currentRunId!==run.id||task.revision<fence.expectedTaskRevision||!contract)return false;
    if(!store.matchesCommand({id:command.id,actorId:command.actorId,profileId:run.profileId,type:"start",fence,backendId:selection.backendId,configRevision:selection.configRevision,semantics:{input:{controllerStartVersion:1,runnerMode:"embedded",contractHash:contentHash(contract)},executionRef:null,executionSelection:selection as unknown as JsonValue}}))return false;
    const adapter=database.getEntity<JsonValue>("adapter-session",run.sessionId) as unknown as AdapterSession|undefined;
    if(command.state==="ACKNOWLEDGED"&&!adapter)return false;
    if(adapter&&(adapter.id!==run.sessionId||adapter.runId!==run.id||adapter.profileId!==run.profileId||adapter.backendId!==selection.backendId||adapter.workspacePath!==run.worktree||adapter.nativeBinding||adapter.executionRef||adapter.nativeIdentityIssue||!isDeepStrictEqual(adapter.executionSelection,selection)||!isDeepStrictEqual(adapter.execution,{generation:run.generation,attempt:run.attempt,leaseId:run.leaseId})))return false;
    return true;
  }catch{return false;}
}
