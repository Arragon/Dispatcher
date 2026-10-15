export type NativeParameter = string | number | boolean;
export interface ExecutionSelection {
  version: 1;
  mode: "manual" | "policy-auto" | "legacy";
  source: "explicit" | "account-default" | "policy" | "native-default" | "legacy-config";
  profileId: string; runnerId: string; providerId: string; backendId: string;
  selectionType: "explicit-model" | "native-default";
  requestedModel?: string;
  nativeParameters: Record<string, NativeParameter>;
  catalogRevision?: string; contextFingerprint: string; configRevision: number; selectedAt: string;
}
export interface PublishDraftV1 {
  schemaVersion: 1; clientDraftId: string; title?: string; description: string;
  projectId: string; repositoryId: string; baseRef?: string; targetBranch?: string;
  scopePaths?: string[]; acceptanceCriteria: string[]; referenceLinks?: string[]; verificationCommandIds?: string[];
  startMode: "create-only" | "dispatch";
  execution: { profileId?: string; selectionMode: "manual" | "policy-auto"; selectionType?: "explicit-model" | "native-default"; selectionSource?: "explicit" | "account-default" | "policy" | "native-default"; nativeModelId?: string; nativeParameters?: Record<string, NativeParameter>; catalogRevision?: string; contextFingerprint?: string; allowUnconfirmedModelAccess?: boolean };
  delivery: { type: "none" | "commit" | "pull-request"; scmConnectorId?: string; targetRepository?: string; baseBranch?: string };
}
export interface PublicationPreview {
  publicationId: string; revision: number; state: "PREVIEW" | "NEEDS_INPUT" | "NEEDS_REVIEW";
  expiresAt: string; inputHash: string;
  effectiveTask: { title: string; description: string; contractState: "READY" | "NEEDS_SPEC"; missing: string[] };
  effectiveExecution?: Omit<ExecutionSelection, "version" | "mode" | "source" | "requestedModel" | "selectedAt"> & { nativeModelId?: string; selectionSource: ExecutionSelection["source"]; repositoryBaseCommit: string };
  checks: Array<{ id: string; status: "passed" | "warning" | "blocked" | "not-required"; code?: string; message: string }>;
  confirmation: { required: boolean; reviewHash: string; reasons: string[] }; canCommit: boolean;
}
export interface PublicationReceipt {
  publicationId: string; revision: number; state: "TASK_CREATED" | "STARTING" | "STARTED" | "START_FAILED" | "OUTCOME_UNKNOWN";
  taskId: string; runId?: string; message?: string;
}
const short = { type: "string", maxLength: 200 } as const;
const strings = { type: "array", maxItems: 200, items: { type: "string", minLength: 1, maxLength: 8000 } } as const;
export const publishDraftSchema = {
  type: "object", additionalProperties: false, required: ["schemaVersion","clientDraftId","description","projectId","repositoryId","acceptanceCriteria","startMode","execution","delivery"],
  properties: {
    schemaVersion: { const: 1 }, clientDraftId: { type: "string", minLength: 1, maxLength: 200 }, title: {type:"string",maxLength:160}, description: {type:"string",minLength:1,maxLength:20000}, projectId: short, repositoryId: short,
    baseRef: short, targetBranch: short, scopePaths: strings, acceptanceCriteria: strings, referenceLinks: strings, verificationCommandIds: strings,
    startMode: { enum: ["create-only","dispatch"] },
    execution: {type:"object",additionalProperties:false,required:["selectionMode"],properties:{profileId:short,selectionMode:{enum:["manual","policy-auto"]},selectionType:{enum:["explicit-model","native-default"]},selectionSource:{enum:["explicit","account-default","policy","native-default"]},nativeModelId:short,nativeParameters:{type:"object",maxProperties:20,additionalProperties:{anyOf:[{type:"string"},{type:"number"},{type:"boolean"}]}},catalogRevision:short,contextFingerprint:short,allowUnconfirmedModelAccess:{type:"boolean"}},allOf:[{if:{required:["selectionType"],properties:{selectionType:{const:"explicit-model"}}},then:{required:["nativeModelId","catalogRevision","contextFingerprint"]}}]},
    delivery: {type:"object",additionalProperties:false,required:["type"],properties:{type:{enum:["none","commit","pull-request"]},scmConnectorId:short,targetRepository:short,baseBranch:short}},
  },
} as const;

export interface ModelCatalogContext {
  profileId: string; runnerId: string; repositoryId: string; executionContextRef: string;
  reason: "open" | "selection-change" | "preflight" | "before-start" | "manual-refresh";
}
export interface AccountModelCatalog {
  profileId: string; runnerId: string; providerId: string; backendId: string;
  contextFingerprint: string; revision: string; fetchedAt: string;
  freshness: "native-fresh" | "native-cache" | "unverified";
  source: "cli-query" | "native-rpc" | "account-api";
  selectionSupport: "explicit" | "native-default-only" | "unsupported";
  entries: Array<{id:string;displayName:string;kind:"model"|"tier"|"native-auto";selectable:boolean;unsupportedReason?:string;access:"account-listed"|"unconfirmed"|"denied";parameterOptions:Record<string,NativeParameter[]>;parameterDefaults?:Record<string,NativeParameter>;billing?:{mode:"unknown"|"subscription"|"metered"}}>;
  failure?: {code:string;message:string};
}
