export interface DiagnosticEntry {
 id:string;status:"pass"|"fail"|"unknown"|"stale";severity:"info"|"warning"|"error";category:string;
 entityRef:{kind:string;id:string};source:string;observedAt?:string;freshness:"fresh"|"stale"|"unknown";message:string;reasonCode:string;
 actions:Array<{label:string;href?:string;checkId?:string}>;
}
export interface DiagnosticsSnapshot {
 generatedAt:string;controllerReady:boolean;executionReadiness:"ready"|"unconfigured"|"unverified";
 configRevision:number;entries:DiagnosticEntry[];summary:Record<DiagnosticEntry["status"],number>;
 checks:Array<{id:string;label:string;cost:"read-only"|"provider-query";entityRequired:boolean}>;
}
