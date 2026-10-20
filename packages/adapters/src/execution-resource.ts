import type {AdapterSession} from "./contracts.js";
import {RESOURCE_STATES,type ResourceState} from "@dispatcher/domain";

/** Use an owned turn's lifecycle facts, without querying usage or account quota. */
export function turnExecutionResource(events:readonly unknown[]|undefined,state:string,observedAt:string):NonNullable<AdapterSession["executionResource"]>{
 const event=events?.findLast(value=>Boolean(value&&typeof value==="object"&&"type" in value&&value.type==="resource"&&"state" in value&&RESOURCE_STATES.includes(value.state as ResourceState))) as {state:NonNullable<AdapterSession["executionResource"]>["state"];reason?:unknown;resetsAt?:unknown;source?:unknown;confidence?:unknown;observedAt?:unknown}|undefined;
 if(!event)return {state:state==="completed"?"AVAILABLE":"UNKNOWN",source:"session",confidence:state==="completed"?"medium":"low",checkedAt:observedAt,...(state==="completed"?{reason:"Native execution completed; remaining quota was not reported"}:{})};
 return {state:event.state,source:event.source==="error"?"error":"session",confidence:event.confidence==="high"||event.confidence==="medium"?event.confidence:"low",checkedAt:typeof event.observedAt==="string"&&Number.isFinite(Date.parse(event.observedAt))?event.observedAt:observedAt,...(typeof event.reason==="string"?{reason:event.reason.slice(0,500)}:{}),...(typeof event.resetsAt==="string"&&Number.isFinite(Date.parse(event.resetsAt))?{resetsAt:event.resetsAt}:{})};
}
