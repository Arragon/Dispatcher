// Dispatcher-owned external wire contract. This is separate from Runner protocol
// and from RHIZA's future public API. Never export internal credentials or paths.
export const RHIZA_API_PREFIX = "/api/integrations/rhiza/v1";
export const RHIZA_PROTOCOL_VERSION = "1.1";
export const RHIZA_SCHEMA_ARTIFACT_VERSION = "1.1.0";
export const RHIZA_EVENT_SCHEMA_VERSION = "1";
export const RHIZA_SCOPES = ["targets:read", "jobs:submit", "jobs:read", "jobs:cancel", "jobs:input", "events:read", "artifacts:read"] as const;
export type RhizaScope = typeof RHIZA_SCOPES[number];
export const RHIZA_CAPABILITIES = ["targets.read", "jobs.preflight", "jobs.submit", "jobs.reassign", "jobs.read", "jobs.cancel", "jobs.input", "events.read", "artifacts.read", "model.configuration-confirmed", "model.verified"] as const;
export type RhizaCapability = typeof RHIZA_CAPABILITIES[number];
export type RhizaModelOptions = Record<string, string | number | boolean>;
export interface RhizaExecutionTargetV1 {
  executorRef: string; runnerId: string; profileId: string; harnessId: string; backendId: string;
  modelId: string; modelOptions: RhizaModelOptions; catalogRevision: string; profileRevision: string;
  contextFingerprint: string; adapterVersion: string; cliVersion: string;
}
export interface RhizaOriginV1 {
  authorityId: string; workspaceId: string; executionRunId: string; dispatchId: string; generation: number;
  workflowRunId?: string; stepAttemptId?: string;
}
export interface RhizaReassignmentV1 {jobId:string;expectedJobRevision:number;runId:string|null;runGeneration?:number}
export interface RhizaWorkOrderV1 {
  reassignment?:RhizaReassignmentV1;
  origin: RhizaOriginV1; title: string; description: string; repositoryId: string;
  scopePaths: string[]; constraints: string[]; acceptanceCriteria: string[]; verificationCommandIds: string[];
  context: { packetId: string; formatVersion: "1"; content: string; inputHash: string };
  target: RhizaExecutionTargetV1;
  approval: { reference: string; digest: string; expiresAt: string }; deadline: string;
  evidencePolicy: { minimum: "verified" | "configuration_confirmed" };
  delivery: { type: "pull-request"; scmConnectorId: string; targetRepository: string; baseBranch: string };
}
export interface RhizaHandshakeRequestV1 { protocolVersions: string[]; requiredCapabilities: string[]; requiredScopes: RhizaScope[] }
export interface RhizaCapabilitiesV1 {
  schemaVersion: 1; protocolVersions: string[]; eventSchemaVersion: "1"; authorityId: string;
  capabilities: RhizaCapability[]; scopes: RhizaScope[];
}
export interface RhizaHandshakeV1 {
  schemaVersion: 1; protocolVersion: "1.1"; eventSchemaVersion: "1"; authorityId: string; clientId: string;
  capabilities: RhizaCapability[]; scopes: RhizaScope[]; expiresAt: string;
}
export interface RhizaPreflightV1 {
  schemaVersion: 1; preflightId: string; inputHash: string; workOrderHash: string;
  target: RhizaExecutionTargetV1 & { targetHash: string }; expiresAt: string;
}
export interface RhizaCatalogTargetV1 {
  repositoryId: string; executorRef: string; runnerId: string; profileId: string; harnessId: string; backendId: string;
  profileRevision: string; adapterVersion: string; cliVersion: string | null; catalogRevision: string | null; contextFingerprint: string | null;
  status: "available" | "unverified" | "unavailable"; releaseQualified: boolean;
  evidenceCapabilities: Array<"configuration_confirmed" | "verified">;
  models: Array<{ modelId: string; selectable: boolean; access: "account-listed" | "unconfirmed" | "denied"; modelOptions: Record<string, Array<string | number | boolean>> }>;
}
export interface RhizaTargetCatalogV1 { schemaVersion: 1; repositoryId: string; revision: string; targets: RhizaCatalogTargetV1[] }
export interface RhizaSubmitRequestV1 { requestId: string; preflightId: string; targetHash: string; workOrder: RhizaWorkOrderV1 }
export interface RhizaReceiptV1 {
  reassignment?:RhizaReassignmentV1;
  schemaVersion: 1; receiptId: string; requestId: string; clientId: string; requestHash: string;
  jobId: string; taskId: string; state: "accepted"; acceptedAt: string; origin: RhizaOriginV1; targetHash: string; inputHash: string;
}
export interface RhizaEvidenceBindingV1 extends RhizaOriginV1 { runId: string; runGeneration: number; sessionId: string | null; targetHash: string }
export interface RhizaModelEvidenceV1 {
  status: "verified" | "configuration_confirmed" | "unverified" | "mismatch";
  source: "native-session-metadata" | "invocation-record" | "unavailable";
  requested: { modelId: string; modelOptions: RhizaModelOptions };
  resolved: { modelId: string; modelOptions: RhizaModelOptions };
  reported: { modelId: string } | null; binding: RhizaEvidenceBindingV1;
  observedAt: string; adapterVersion: string; cliVersion: string;
}
export type RhizaJobState = "accepted" | "running" | "waiting_input" | "candidate" | "failed" | "canceled" | "unknown";
export interface RhizaSnapshotV1 {
  schemaVersion: 1; jobId: string; taskId: string; revision: number; state: RhizaJobState; origin: RhizaOriginV1;
  target: RhizaExecutionTargetV1 & { targetHash: string }; inputHash: string;
  processObservation: "not_started" | "running" | "stop_requested" | "stopped" | "unknown";
  cancellationRequested: boolean; allowedOperations: RhizaScope[]; cursor: string; updatedAt: string;
  runId?: string; runGeneration?: number; modelEvidence?: RhizaModelEvidenceV1;
  intervention?: { revision: number; sessionId: string; leaseId: string; taskRevision: number };
}
export interface RhizaCancellationRequestV1 { requestId: string; expectedJobRevision: number; runId: string | null; generation: number; runGeneration?: number }
export interface RhizaControlReceiptV1 {schemaVersion:1;commandId:string;requestId:string;jobId:string;kind:"cancel"|"input";state:"accepted";acceptedAt:string}
export interface RhizaInputRequestV1 extends RhizaCancellationRequestV1 { runId: string; runGeneration: number; interventionRevision: number; sessionId: string; leaseId: string; taskRevision: number; input: string }
export interface RhizaEventV1 {schemaVersion:"1";eventId:string;jobId:string;revision:number;type:"job.changed";committedAt:string}
export interface RhizaEventPageV1 {schemaVersion:"1";events:RhizaEventV1[];cursor:string;hasMore:boolean}
export interface RhizaArtifactV1 {
 artifactId:string;jobId:string;runId:string;
 /** Dispatcher Run generation; RHIZA generation remains in modelEvidence.binding. */
 generation:number;targetHash:string;inputHash:string;repositoryId:string;commit:string;prUrl:string;digest:string;
 verification:{state:"passed"|"failed"|"pending";commandIds:string[];commit:string};modelEvidence:RhizaModelEvidenceV1;
}
export interface RhizaArtifactsV1 {schemaVersion:1;jobId:string;artifacts:RhizaArtifactV1[]}

const id = { type: "string", minLength: 1, maxLength: 200, pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$" };
const opaque = { type: "string", minLength: 1, maxLength: 512, pattern: "^[^\\u0000-\\u001f\\u007f]+$" };
const text = { type: "string", minLength: 1, maxLength: 8000 };
const digest = { type: "string", pattern: "^[a-f0-9]{64}$" };
const timestamp = { type: "string", maxLength: 30, pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$" };
const positive = { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const scalar = { anyOf: [{ type: "string", maxLength: 1024 }, { type: "number" }, { type: "boolean" }] };
const options = { type: "object", maxProperties: 20, propertyNames: opaque, additionalProperties: scalar };
const ref = (name: string) => ({ $ref: `#/$defs/${name}` });
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: "object", additionalProperties: false, required, properties });
const array = (items: unknown, minItems = 0, maxItems = 200) => ({ type: "array", minItems, maxItems, uniqueItems: true, items });
const originProperties = { authorityId: id, workspaceId: id, executionRunId: id, dispatchId: id, generation: positive, workflowRunId: id, stepAttemptId: id };
const targetProperties = { executorRef: opaque, runnerId: id, profileId: id, harnessId: opaque, backendId: opaque, modelId: opaque, modelOptions: options,
  catalogRevision: opaque, profileRevision: opaque, contextFingerprint: opaque, adapterVersion: opaque, cliVersion: opaque };
const controlProperties = { requestId: id, expectedJobRevision: positive, runId: { anyOf: [id, { type: "null" }] }, generation: positive, runGeneration: positive };
const target = object(targetProperties);
const model = object({ modelId: opaque, modelOptions: options });
const reported = object({ modelId: opaque });
const intervention = object({ revision: positive, sessionId: id, leaseId: id, taskRevision: positive });

// One schema source is exported for independently versioned clients. Structural
// validation cannot prove authorization, semantic digests, actual models or stop.
export const rhizaV1Schema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://dispatcher.local/schemas/rhiza-ingress-v1.json",
  $defs: {
    target,
    reassignment:{...object({jobId:id,expectedJobRevision:positive,runId:{anyOf:[id,{type:"null"}]},runGeneration:positive},["jobId","expectedJobRevision","runId"]),allOf:[{if:{properties:{runId:{type:"string"}},required:["runId"]},then:{properties:{runGeneration:positive},required:["runGeneration"]},else:{not:{properties:{runGeneration:positive},required:["runGeneration"]}}}]},
    resolvedTarget: object({ ...targetProperties, targetHash: digest }),
    origin: object(originProperties, ["authorityId", "workspaceId", "executionRunId", "dispatchId", "generation"]),
    binding: object({ ...originProperties, runId: id, runGeneration: positive, sessionId: { anyOf: [id, { type: "null" }] }, targetHash: digest },
      ["authorityId", "workspaceId", "executionRunId", "dispatchId", "generation", "runId", "runGeneration", "sessionId", "targetHash"]),
    workOrder: object({ reassignment:ref("reassignment"), origin: ref("origin"), title: { type: "string", minLength: 1, maxLength: 160 }, description: { type: "string", minLength: 1, maxLength: 20000 },
      repositoryId: id, scopePaths: array(text, 1), constraints: array(text), acceptanceCriteria: array(text, 1), verificationCommandIds: array(id, 1),
      context: object({ packetId: id, formatVersion: { const: "1" }, content: { type: "string", maxLength: 65536 }, inputHash: digest }),
      target: ref("target"), approval: object({ reference: opaque, digest, expiresAt: timestamp }), deadline: timestamp,
      evidencePolicy: object({ minimum: { enum: ["verified", "configuration_confirmed"] } }),
      delivery: object({ type: { const: "pull-request" }, scmConnectorId: id, targetRepository: opaque, baseBranch: opaque }) },["origin","title","description","repositoryId","scopePaths","constraints","acceptanceCriteria","verificationCommandIds","context","target","approval","deadline","evidencePolicy","delivery"]),
    handshakeRequest: object({ protocolVersions: array(opaque, 1, 10), requiredCapabilities: array(opaque, 0, 32), requiredScopes: array({ enum: RHIZA_SCOPES }, 0, RHIZA_SCOPES.length) }),
    capabilities: object({ schemaVersion: { const: 1 }, protocolVersions: array(opaque, 1, 10), eventSchemaVersion: { const: "1" }, authorityId: opaque,
      capabilities: array({ enum: RHIZA_CAPABILITIES }), scopes: array({ enum: RHIZA_SCOPES }) }),
    handshake: object({ schemaVersion: { const: 1 }, protocolVersion: { const: RHIZA_PROTOCOL_VERSION }, eventSchemaVersion: { const: "1" }, authorityId: opaque, clientId: id,
      capabilities: array({ enum: RHIZA_CAPABILITIES }), scopes: array({ enum: RHIZA_SCOPES }), expiresAt: timestamp }),
    preflightRequest: object({ workOrder: ref("workOrder") }),
    catalogTarget: object({ repositoryId: id, executorRef: opaque, runnerId: id, profileId: id, harnessId: opaque, backendId: opaque,
      profileRevision: opaque, adapterVersion: opaque, cliVersion: { anyOf: [opaque, { type: "null" }] }, catalogRevision: { anyOf: [opaque, { type: "null" }] }, contextFingerprint: { anyOf: [opaque, { type: "null" }] },
      status: { enum: ["available", "unverified", "unavailable"] }, releaseQualified: { type: "boolean" }, evidenceCapabilities: array({ enum: ["configuration_confirmed", "verified"] }, 0, 2),
      models: array(object({ modelId: opaque, selectable: { type: "boolean" }, access: { enum: ["account-listed", "unconfirmed", "denied"] }, modelOptions: { type: "object", maxProperties: 20, propertyNames: opaque, additionalProperties: array(scalar, 0, 32) } }), 0, 1000) }),
    targetCatalog: object({ schemaVersion: { const: 1 }, repositoryId: id, revision: digest, targets: array(ref("catalogTarget"), 0, 200) }),
    preflight: object({ schemaVersion: { const: 1 }, preflightId: id, inputHash: digest, workOrderHash: digest, target: ref("resolvedTarget"), expiresAt: timestamp }),
    submitRequest: object({ requestId: id, preflightId: id, targetHash: digest, workOrder: ref("workOrder") }),
    receipt: object({ reassignment:ref("reassignment"),schemaVersion: { const: 1 }, receiptId: id, requestId: id, clientId: id, requestHash: digest, jobId: id, taskId: id,
      state: { const: "accepted" }, acceptedAt: timestamp, origin: ref("origin"), targetHash: digest, inputHash: digest },["schemaVersion","receiptId","requestId","clientId","requestHash","jobId","taskId","state","acceptedAt","origin","targetHash","inputHash"]),
    modelEvidence: {
      ...object({ status: { enum: ["verified", "configuration_confirmed", "unverified", "mismatch"] }, source: { enum: ["native-session-metadata", "invocation-record", "unavailable"] },
        requested: model, resolved: model, reported: { anyOf: [reported, { type: "null" }] }, binding: ref("binding"), observedAt: timestamp, adapterVersion: opaque, cliVersion: opaque }),
      allOf: [{ if: { properties: { status: { const: "verified" } }, required: ["status"] }, then: { properties: {
        source: { const: "native-session-metadata" }, reported,
        binding: { type: "object", properties: { sessionId: id }, required: ["sessionId"] },
      } } }],
    },
    snapshot: { ...object({ schemaVersion: { const: 1 }, jobId: id, taskId: id, revision: positive,
      state: { enum: ["accepted", "running", "waiting_input", "candidate", "failed", "canceled", "unknown"] }, origin: ref("origin"), target: ref("resolvedTarget"), inputHash: digest,
      processObservation: { enum: ["not_started", "running", "stop_requested", "stopped", "unknown"] }, cancellationRequested: { type: "boolean" },
      allowedOperations: array({ enum: RHIZA_SCOPES }), cursor: { type: "string", minLength: 1, maxLength: 4096 }, updatedAt: timestamp, runId: id, runGeneration: positive,
      intervention, modelEvidence: ref("modelEvidence") },
    ["schemaVersion", "jobId", "taskId", "revision", "state", "origin", "target", "inputHash", "processObservation", "cancellationRequested", "allowedOperations", "cursor", "updatedAt"]),
      allOf: [
        { if: { properties: { runId: id }, required: ["runId"] }, then: { properties: { runGeneration: positive }, required: ["runGeneration"] } },
        { if: { properties: { runGeneration: positive }, required: ["runGeneration"] }, then: { properties: { runId: id }, required: ["runId"] } },
        { if: { properties: { allowedOperations: { type: "array", contains: { const: "jobs:input" } } }, required: ["allowedOperations"] },
          then: { required: ["runId", "runGeneration", "intervention"], properties: { state: { const: "waiting_input" }, runId: id, runGeneration: positive, intervention } } },
      ],
    },
    event: object({ schemaVersion: { const: "1" }, eventId: id, jobId: id, revision: positive, type: { const: "job.changed" }, committedAt: timestamp }),
    artifact: object({ artifactId: id, jobId: id, runId: id, generation: positive, targetHash: digest, inputHash: digest, repositoryId: id,
      commit: { type: "string", pattern: "^(?:[a-f0-9]{40}|[a-f0-9]{64})$" }, prUrl: { type: "string", maxLength: 2048, pattern: "^https://[^\\s]+$" }, digest,
      verification: object({ state: { enum: ["passed", "failed", "pending"] }, commandIds: array(id, 1), commit: opaque }), modelEvidence: ref("modelEvidence") }),
    eventPage:object({schemaVersion:{const:"1"},events:array(ref("event"),0,100),cursor:opaque,hasMore:{type:"boolean"}}),
    artifacts:object({schemaVersion:{const:1},jobId:id,artifacts:array(ref("artifact"),0,100)}),
    cancellationRequest: { ...object(controlProperties, ["requestId", "expectedJobRevision", "runId", "generation"]),
      allOf: [{ if: { properties: { runId: { type: "string" } }, required: ["runId"] }, then: { properties: { runGeneration: positive }, required: ["runGeneration"] }, else: { not: { properties: { runGeneration: positive }, required: ["runGeneration"] } } }],
    },
    controlReceipt:object({schemaVersion:{const:1},commandId:id,requestId:id,jobId:id,kind:{enum:["cancel","input"]},state:{const:"accepted"},acceptedAt:timestamp}),
    inputRequest: object({ ...controlProperties, runId: id, interventionRevision: positive, sessionId: id, leaseId: id, taskRevision: positive, input: text }),
    error: object({ code: { enum: ["INGRESS_DISABLED", "AUTH_REQUIRED", "ACCESS_DENIED", "HOST_REJECTED", "ORIGIN_REJECTED", "TLS_REQUIRED", "RATE_LIMITED", "PROTOCOL_UNSUPPORTED", "CAPABILITY_REQUIRED", "INVALID_REQUEST", "TARGET_UNAVAILABLE", "TARGET_CHANGED", "MODEL_EVIDENCE_REQUIRED", "MODEL_EVIDENCE_MISMATCH", "IDEMPOTENCY_CONFLICT", "PREFLIGHT_EXPIRED", "APPROVAL_EXPIRED", "DEADLINE_EXCEEDED", "NOT_FOUND", "REVISION_CONFLICT", "LAUNCH_UNCERTAIN", "CURSOR_EXPIRED", "TARGET_AUTHORITY_CHANGED", "STOP_UNCONFIRMED", "INPUT_PENDING", "INPUT_OUTCOME_UNKNOWN", "OPERATION_UNSUPPORTED", "INTERNAL_ERROR"] },
      message: { type: "string", maxLength: 512 }, requestId: id }, ["code", "message"]),
  },
} as const;
