import type {Run} from "@dispatcher/domain";
import {ConnectorError,type ConversationBinding} from "@dispatcher/integrations";
import type {DispatcherDatabase} from "@dispatcher/persistence";
import {isSafeNativeMetadataId} from "@dispatcher/runner";

/** A selected unreadable binding is a conflict, never permission for a fallback route. */
export function selectRunConversation(database:DispatcherDatabase,run:Run):ConversationBinding|undefined {
    const unverified=()=>new ConnectorError("CONFLICT","Run conversation binding is unverified",{retryable:false,operation:"read"});
    if(!isSafeNativeMetadataId(run.id)||!isSafeNativeMetadataId(run.sessionId)||!Number.isSafeInteger(run.generation))throw unverified();
    const row=database.handle.prepare(`SELECT id,
      CASE WHEN json_valid(document_json) THEN
        CASE WHEN length(CAST(document_json AS BLOB))<=65536 AND
          NOT EXISTS(SELECT 1 FROM json_each(document_json) GROUP BY key HAVING count(*)>1)
        THEN document_json END END AS document_json FROM entities
      WHERE kind='messaging-conversation'
      AND CASE WHEN json_valid(document_json)
        THEN (SELECT count(DISTINCT key) FROM json_each(document_json)
          WHERE key='runId' AND value=? OR key='sessionId' AND value=? OR key='generation' AND value=?)=3
        ELSE 0 END ORDER BY updated_at DESC,id DESC LIMIT 1`).get(run.id,run.sessionId,run.generation) as {id:string;document_json:string|null}|undefined;
    if(!row){
      // Unreadable records cannot establish absence; do not open a fallback route.
      if(database.handle.prepare("SELECT 1 FROM entities WHERE kind='messaging-conversation' AND NOT json_valid(document_json) LIMIT 1").get())throw unverified();
      return undefined;
    }
    if(row.document_json===null)throw unverified();
    const binding=JSON.parse(row.document_json) as ConversationBinding;
    // Recheck decoded identities: SQL and JSON.parse differ on duplicate keys.
    if(binding.runId!==run.id||binding.sessionId!==run.sessionId||binding.generation!==run.generation||binding.id!==row.id||![binding.connectorInstanceId,binding.conversationId,binding.threadId].every(value=>typeof value==="string"&&value.length>0)||binding.id!==`${binding.connectorInstanceId}:${binding.conversationId}:${binding.threadId}`||binding.taskId!==undefined&&binding.taskId!==run.taskId||!Number.isSafeInteger(binding.revision)||binding.revision<1||binding.controlEpoch!==undefined&&(!Number.isSafeInteger(binding.controlEpoch)||binding.controlEpoch<0)||!["ACTIVE","WAITING_USER","CLOSED"].includes(binding.state)||typeof binding.updatedAt!=="string"||!Number.isFinite(Date.parse(binding.updatedAt)))throw unverified();
    return binding;
  }
