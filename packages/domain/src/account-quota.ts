/** Account periods are independent of Run usage, billing and execution resources. */
export interface AccountQuotaSnapshot {
 version:1;profileId:string;source:string;collectedAt:string;
 periods:Array<{id:string;unit:string;used?:string;remaining?:string;total?:string;startsAt?:string;resetsAt?:string;windowDurationMins?:number;unlimited?:boolean}>;
}
export interface AccountQuotaState {
 profileId:string;status:"fresh"|"stale"|"error"|"unsupported"|"missing";
 contextFingerprint?:string;snapshot?:AccountQuotaSnapshot;checkedAt?:string;lastSuccessAt?:string;
 reasonCode?:string;error?:{code:string};
}
