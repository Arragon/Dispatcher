export interface UsageObservationV1 {
 version:1;eventId:string;profileId:string;runId?:string;sessionId?:string;generation?:number;turnId?:string;
 scope:"turn"|"run"|"session"|"account-period";mode:"delta"|"snapshot";observedAt:string;collectedAt:string;
 source:"native-event"|"native-query"|"native-result";completeness:"complete"|"partial"|"unknown";
 metrics:Array<{name:string;value:string;unit:string;includedIn?:string}>;
 period?:{start?:string;end?:string;resetsAt?:string};
}
