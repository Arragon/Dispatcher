import type {NativeModelInvocation} from "@dispatcher/domain";
import {AdapterContractError,type AdapterSession} from "./contracts.js";
import type {SessionStore} from "./generic.js";

/** Synchronous effect-admission paths only; async acquiring returns are not proof. Never retain prompt, argv or credentials. */
export function recordModelInvocation(store:SessionStore,session:AdapterSession,kind:NativeModelInvocation["kind"],model:NativeModelInvocation["model"]):void {
  if(!session.turnId||!session.profileId)throw new AdapterContractError("MODEL_INVOCATION_UNKNOWN","Invocation identity is missing");
  const record:NativeModelInvocation={version:1,id:session.turnId,sessionId:session.id,runId:session.runId,profileId:session.profileId,backendId:session.backendId,kind,invokedAt:new Date().toISOString(),model:structuredClone(model),
    ...(session.providerSessionId?{nativeSessionId:session.providerSessionId}:{}),...(session.execution?{execution:structuredClone(session.execution)}:{}),...(session.executionSelection?{executionSelection:structuredClone(session.executionSelection)}:{})};
  if(record.executionSelection)delete record.executionSelection.routingDecision;
  store.recordModelInvocation?.(record);
  session.modelInvocationId=record.id;
}
