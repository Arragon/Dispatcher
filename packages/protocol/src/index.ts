import type { ResourceSnapshot, RunState, Runner } from "@dispatcher/domain";

export const PROTOCOL_VERSION = "1.0" as const;

export type CommandPayload =
  | { type: "run.start"; runId: string }
  | { type: "run.send_input"; runId: string; input: string }
  | { type: "run.pause"; runId: string }
  | { type: "run.resume"; runId: string }
  | { type: "run.cancel"; runId: string }
  | { type: "run.status"; runId: string }
  | { type: "run.tail_log"; runId: string; cursor?: string }
  | { type: "resource.probe"; profileId: string }
  | { type: "runner.health" }
  | { type: "workspace.cleanup"; workspaceId: string };

export type EventPayload =
  | { type: "runner.register"; runner: Runner }
  | { type: "runner.heartbeat"; runnerId: string; state: Runner["state"] }
  | { type: "run.state"; runId: string; state: RunState; reason?: string }
  | { type: "run.activity"; runId: string; summary: string }
  | { type: "resource.state"; resource: ResourceSnapshot }
  | { type: "run.delivery"; runId: string; prUrl: string }
  | { type: "journal.replay"; fromSequence: number; toSequence: number };

export type ResponsePayload =
  | { type: "rpc.result"; correlationId: string; result: unknown }
  | { type: "rpc.error"; correlationId: string; code: string; message: string };

export type ProtocolPayload = CommandPayload | EventPayload | ResponsePayload;
export type EnvelopeKind = "command" | "event" | "response";

export interface ProtocolEnvelope<TPayload extends ProtocolPayload = ProtocolPayload> {
  protocolVersion: typeof PROTOCOL_VERSION;
  messageId: string;
  traceId: string;
  runnerId: string;
  sequence: number;
  sentAt: string;
  kind: EnvelopeKind;
  payload: TPayload;
}

const commandTypes = new Set<CommandPayload["type"]>([
  "run.start",
  "run.send_input",
  "run.pause",
  "run.resume",
  "run.cancel",
  "run.status",
  "run.tail_log",
  "resource.probe",
  "runner.health",
  "workspace.cleanup",
]);
const eventTypes = new Set<EventPayload["type"]>([
  "runner.register",
  "runner.heartbeat",
  "run.state",
  "run.activity",
  "resource.state",
  "run.delivery",
  "journal.replay",
]);
const responseTypes = new Set<ResponsePayload["type"]>(["rpc.result", "rpc.error"]);

export class ProtocolValidationError extends Error {
  constructor(readonly code: "UNSUPPORTED_PROTOCOL" | "UNKNOWN_MESSAGE_TYPE" | "INVALID_ENVELOPE", message: string) {
    super(message);
    this.name = "ProtocolValidationError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseEnvelope(value: unknown): ProtocolEnvelope {
  if (!isObject(value) || !isObject(value.payload)) {
    throw new ProtocolValidationError("INVALID_ENVELOPE", "Envelope and payload must be objects");
  }
  if (value.protocolVersion !== PROTOCOL_VERSION) {
    throw new ProtocolValidationError("UNSUPPORTED_PROTOCOL", `Unsupported protocol version: ${String(value.protocolVersion)}`);
  }
  if (
    typeof value.messageId !== "string" ||
    typeof value.traceId !== "string" ||
    typeof value.runnerId !== "string" ||
    typeof value.sequence !== "number" ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 0 ||
    typeof value.sentAt !== "string" ||
    !["command", "event", "response"].includes(String(value.kind)) ||
    typeof value.payload.type !== "string"
  ) {
    throw new ProtocolValidationError("INVALID_ENVELOPE", "Envelope fields are invalid");
  }
  const validType =
    (value.kind === "command" && commandTypes.has(value.payload.type as CommandPayload["type"])) ||
    (value.kind === "event" && eventTypes.has(value.payload.type as EventPayload["type"])) ||
    (value.kind === "response" && responseTypes.has(value.payload.type as ResponsePayload["type"]));
  if (!validType) {
    throw new ProtocolValidationError("UNKNOWN_MESSAGE_TYPE", `Unknown ${String(value.kind)} type: ${value.payload.type}`);
  }
  return value as unknown as ProtocolEnvelope;
}

export function createEnvelope<TPayload extends ProtocolPayload>(input: {
  kind: EnvelopeKind;
  messageId: string;
  traceId: string;
  runnerId: string;
  sequence: number;
  payload: TPayload;
  sentAt?: string;
}): ProtocolEnvelope<TPayload> {
  const envelope: ProtocolEnvelope<TPayload> = {
    protocolVersion: PROTOCOL_VERSION,
    messageId: input.messageId,
    traceId: input.traceId,
    runnerId: input.runnerId,
    sequence: input.sequence,
    sentAt: input.sentAt ?? new Date().toISOString(),
    kind: input.kind,
    payload: input.payload,
  };
  return parseEnvelope(envelope) as ProtocolEnvelope<TPayload>;
}

export const runnerProtocolSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://dispatcher.local/schemas/runner-protocol-v1.json",
  type: "object",
  required: ["protocolVersion", "messageId", "traceId", "runnerId", "sequence", "sentAt", "kind", "payload"],
  properties: {
    protocolVersion: { const: PROTOCOL_VERSION },
    messageId: { type: "string", minLength: 1 },
    traceId: { type: "string", minLength: 1 },
    runnerId: { type: "string", minLength: 1 },
    sequence: { type: "integer", minimum: 0 },
    sentAt: { type: "string", format: "date-time" },
    kind: { enum: ["command", "event", "response"] },
    payload: { type: "object", required: ["type"] },
  },
  additionalProperties: false,
} as const;
