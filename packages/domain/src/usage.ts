/** Owning producer namespace and its stable event identity, not a collector-generated alias. */
export interface UsageProducerOriginV1 {producerId:string;eventId:string}
export interface UsageObservationV1 {
 version:1;eventId:string;profileId:string;runId?:string;sessionId?:string;generation?:number;turnId?:string;
 attempt?:number;nativeSessionId?:string;producerOrigin?:UsageProducerOriginV1;
 /** Explicit native billing occurrence only; never synthesized from observation or collection time. */
 occurredAt?:string;
 scope:"turn"|"run"|"session"|"account-period";mode:"delta"|"snapshot";observedAt:string;collectedAt:string;
 source:"native-event"|"native-query"|"native-result";completeness:"complete"|"partial"|"unknown";
 metrics:Array<{name:string;value:string;unit:string;includedIn?:string}>;
 period?:{start?:string;end?:string;resetsAt?:string};
}
/** Native origins require native ordering; legacy read semantics retain their observation-time basis. */
export const usageAggregationTime=(value:UsageObservationV1):number|undefined=>value.producerOrigin?(value.occurredAt?Date.parse(value.occurredAt):undefined):Date.parse(value.observedAt);
