export interface EvidenceState {
  status:"ready"|"missing"|"failed"|"unknown"|"stale"|"unsupported";
  observedAt?:string;source?:string;reasonCode?:string;message?:string;contextFingerprint?:string;
}
export interface ActionAvailability {allowed:boolean;requiresConfirmation:boolean;reasonCode?:string;message?:string;evidenceAt?:string}
export interface ProfileProbeEvidence {
  version:1;profileId:string;runnerId:string;providerId:string;repositoryId?:string;configRevision:number;contextFingerprint:string;observedAt:string;
  installation:EvidenceState;compatibility:EvidenceState;authentication:EvidenceState;nativeVersion?:string;
}
export interface ProfileConsoleView {
  id:string;alias:string;providerId:string;adapterId:string;runnerId:string;dispatchEnabled:boolean;configRevision:number;
  installation:EvidenceState;compatibility:EvidenceState;authentication:EvidenceState;resources:EvidenceState;
  defaultModel?:{id:string;selectable?:boolean;reason?:string};configuration:{complete:boolean;missingFields:string[]};
  executionSupport:"local-ready"|"remote-ready"|"unverified"|"unsupported";actions:Record<string,ActionAvailability>;
  limitations:string[];
  interaction?:ProfileInteractionView;
}
export interface NativeSessionConsoleView {
  id:string;runId:string;profileId?:string;state:string;createdAt:string;updatedAt:string;
  canonical:boolean;taskId?:string;contextState:"current"|"changed"|"unknown";
  stopState:"none"|"requested"|"unconfirmed"|"confirmed";
  actions:Record<"input"|"cancel"|"refresh",ActionAvailability>;
}

export interface ProfileInteractionEvidence {
  name:string;support:"supported"|"unsupported"|"unknown";
  historicalSupport?:"supported"|"unsupported"|"unknown";
  evidenceLevel?:"documented"|"installed-probed"|"runtime-verified"|"ui-roundtrip-verified";verifiedAt?:string;
}
export interface ProfileInteractionRow {
  backendId:string;region:string;installedVersion:string|null;invalidationReason:string;
  installation:"supported"|"unsupported"|"unknown";authentication:"supported"|"unsupported"|"unknown";
  capabilities:ProfileInteractionEvidence[];surfaces:ProfileInteractionEvidence[];nextVerification:string;
}
export interface ProfileInteractionView {version:1;rows:ProfileInteractionRow[]}
