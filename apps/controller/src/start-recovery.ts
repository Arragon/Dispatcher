import {isDeepStrictEqual} from "node:util";
import {isExecutionContextRef,normalizeNativeBinding,validateExecutionBinding,type Run,type Session} from "@dispatcher/domain";
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

/** Checks stored agreement only; provider wrappers decide which bound shapes are readable. */
function checkedManagedRun(database:DispatcherDatabase,run:Run) {
  const ref=run.executionRef,selection=run.executionSelection;
  if(Object.hasOwn(run,"modelSelection")||!selection||!isExecutionContextRef(ref)||ref.kind!=="managed-worktree"||ref.workspaceId!==run.id||!run.worktree)return;
  const store=new InteractionStore(database),binding=store.binding(run.sessionId),control=store.control(run.sessionId);
  const session=database.getEntity<JsonValue>("session",run.sessionId) as unknown as Session|undefined,adapter=database.getEntity<JsonValue>("adapter-session",run.sessionId) as unknown as AdapterSession|undefined;
  const task=database.getCanonicalTask<JsonValue>(run.taskId),contract=database.getEntity<JsonValue>("run-contract",run.id) as {workspace?:{repositoryId?:string;baseCommit?:string}}|undefined;
  if(!session||session.id!==run.sessionId||session.profileId!==run.profileId||session.providerId!==run.providerId||!adapter||!binding||!control||control.version!==1||!Number.isSafeInteger(control.epoch)||control.epoch<1||!Number.isSafeInteger(control.revision)||control.revision<1||!["AUTOMATED","HANDOFF_REQUESTED","HUMAN","RECONCILING","CONFLICT"].includes(control.state)||!["none","cooperative","native-enforced"].includes(control.exclusion)||control.sessionId!==run.sessionId||control.activeRunId!==run.id||!task||(task.document as {currentRunId?:string}).currentRunId!==run.id||!contract?.workspace?.repositoryId||!contract.workspace.baseCommit)return;
  const owners=database.handle.prepare("SELECT session_id,epoch,revision,state FROM session_controls WHERE active_run_id=?").all(run.id);if(owners.length!==1||owners[0]!.session_id!==run.sessionId||owners[0]!.epoch!==control.epoch||owners[0]!.revision!==control.revision||owners[0]!.state!==control.state)return;
  if(adapter.id!==run.sessionId||adapter.runId!==run.id||adapter.profileId!==run.profileId||adapter.backendId!==selection.backendId||adapter.workspacePath!==run.worktree||adapter.nativeIdentityIssue||!adapter.nativeInvocationId||!isDeepStrictEqual(adapter.executionSelection,selection)||!isDeepStrictEqual(adapter.executionRef,ref)||!isDeepStrictEqual(session.executionRef,ref)||!isDeepStrictEqual(adapter.execution,{generation:run.generation,attempt:run.attempt,leaseId:run.leaseId}))return;
  if(database.handle.prepare("SELECT 1 FROM native_identity_diagnostics WHERE session_id=? AND code!='LEGACY_NATIVE_BINDING_MISSING' LIMIT 1").get(run.sessionId))return;
  const normalized=normalizeNativeBinding(session,adapter,run);
  if(!("binding" in normalized)||!isDeepStrictEqual(normalized.binding,binding)||binding.identityState!=="bound"||!isDeepStrictEqual(adapter.nativeBinding,binding)||!isDeepStrictEqual(session.nativeBinding,binding))return;
  if(!validateExecutionBinding({profileId:run.profileId,providerId:run.providerId,backendId:binding.backendId,runnerId:run.runnerId,executionRef:ref,nativeBinding:binding},selection,{repositoryId:contract.workspace.repositoryId,baseRevision:contract.workspace.baseCommit}).valid)return;
  return {binding,session,adapter,ref,selection};
}

/** A consistent bound Codex record can be read after restart; it grants no live source or writer. */
export function isReadableManagedCodexRun(database:DispatcherDatabase,run:Run):boolean {
  try{
    if(run.providerId!=="codex"||run.executionSelection?.backendId!=="codex-app-server")return false;
    const checked=checkedManagedRun(database,run);if(!checked)return false;
    const {binding}=checked;
    return binding.product==="codex"&&binding.region==="global"&&binding.nativeThreadId===binding.nativeSessionId&&binding.parentSessionId===undefined;
  }catch{return false;}
}

/** Read-only OpenCode storage qualification never restores a native connection or writer. */
export function isReadableManagedOpenCodeRun(database:DispatcherDatabase,run:Run):boolean {
  try{
    if(run.providerId!=="opencode"||run.executionSelection?.backendId!=="opencode-server-v2")return false;
    const checked=checkedManagedRun(database,run);if(!checked)return false;
    const {binding}=checked;
    return binding.product==="opencode"&&binding.region==="global"&&binding.backendId==="opencode-server-v2"&&typeof binding.nativeSessionId==="string"&&binding.nativeSessionId.length<=512&&/^ses[A-Za-z0-9_-]+$/.test(binding.nativeSessionId)&&binding.nativeThreadId===undefined&&binding.parentSessionId===undefined;
  }catch{return false;}
}

/** Read-only Pi storage qualification never restores a native source or writer. */
export function isReadableManagedPiRun(database:DispatcherDatabase,run:Run):boolean {
  try{
    if(run.providerId!=="pi"||run.executionSelection?.backendId!=="pi-rpc")return false;
    const checked=checkedManagedRun(database,run);if(!checked)return false;
    const {binding}=checked;
    return binding.product==="pi"&&binding.backendId==="pi-rpc"&&binding.region==="global"&&typeof binding.nativeSessionId==="string"&&binding.nativeSessionId.length===36&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(binding.nativeSessionId)&&binding.nativeThreadId===undefined&&binding.parentSessionId===undefined;
  }catch{return false;}
}

/** Read-only Local ACP storage qualification never restores a native source or writer. */
export function isReadableManagedDevinRun(database:DispatcherDatabase,run:Run):boolean {
  try{
    if(run.providerId!=="devin-local"||run.executionSelection?.backendId!=="devin-local-acp")return false;
    const checked=checkedManagedRun(database,run);if(!checked)return false;
    const {binding}=checked;
    return binding.product==="devin-local"&&binding.backendId==="devin-local-acp"&&binding.region==="global"&&typeof binding.nativeSessionId==="string"&&binding.nativeSessionId.length>0&&binding.nativeSessionId.length<=512&&!Array.from(binding.nativeSessionId).some(character=>character.charCodeAt(0)<32||character.charCodeAt(0)===127)&&!binding.nativeSessionId.startsWith("unstarted:")&&binding.nativeThreadId===undefined&&binding.parentSessionId===undefined;
  }catch{return false;}
}
