import { describe, expect, it } from "vitest";
import { LEGACY_PROTOCOL_VERSION, PROTOCOL_VERSION, createEnvelope, parseEnvelope, type ProtocolValidationError } from "../src/index.js";

describe("Runner Protocol v1", () => {
  it("round-trips a command envelope", () => {
    const envelope = createEnvelope({
      kind: "command",
      messageId: "msg-1",
      traceId: "trace-1",
      runnerId: "mac-neo",
      sequence: 1,
      sentAt: "2026-09-16T00:00:00.000Z",
      payload: { type: "runner.health" },
    });
    expect(parseEnvelope(JSON.parse(JSON.stringify(envelope)))).toEqual(envelope);
    expect(envelope.protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it("rejects an unsupported version with a stable code", () => {
    expect(() =>
      parseEnvelope({
        protocolVersion: "2.0",
        messageId: "msg-1",
        traceId: "trace-1",
        runnerId: "mac-neo",
        sequence: 1,
        sentAt: new Date().toISOString(),
        kind: "command",
        payload: { type: "runner.health" },
      }),
    ).toThrowError(expect.objectContaining<Partial<ProtocolValidationError>>({ code: "UNSUPPORTED_PROTOCOL" }));
  });

  it("rejects an unknown message without corrupting the contract", () => {
    expect(() =>
      parseEnvelope({
        protocolVersion: PROTOCOL_VERSION,
        messageId: "msg-2",
        traceId: "trace-2",
        runnerId: "mac-neo",
        sequence: 2,
        sentAt: new Date().toISOString(),
        kind: "command",
        payload: { type: "shell.exec" },
      }),
    ).toThrowError(expect.objectContaining<Partial<ProtocolValidationError>>({ code: "UNKNOWN_MESSAGE_TYPE" }));
  });

  it("accepts v1 fixtures while v1.1 adds traceable connector metadata", () => {
    const legacy = {
      protocolVersion: LEGACY_PROTOCOL_VERSION,
      messageId: "legacy",
      traceId: "trace",
      runnerId: "runner",
      sequence: 0,
      sentAt: "2026-09-01T00:00:00.000Z",
      kind: "command",
      payload: { type: "runner.health" },
    };
    expect(parseEnvelope(legacy).protocolVersion).toBe("1.0");
    const current = createEnvelope({
      kind: "event",
      messageId: "event",
      traceId: "trace",
      runnerId: "runner",
      sequence: 1,
      payload: { type: "run.activity", runId: "run", summary: "safe" },
      origin: "connector",
      connectorInstanceId: "task-main",
      causationId: "cause",
      correlationId: "correlation",
      externalEventId: "external",
      idempotencyKey: "dedupe",
    });
    expect(parseEnvelope(current)).toMatchObject({ protocolVersion: "1.1", idempotencyKey: "dedupe" });
  });

  it("rejects raw provider payloads from the protocol boundary", () => {
    expect(() => parseEnvelope({
      protocolVersion: PROTOCOL_VERSION,
      messageId: "bad",
      traceId: "trace",
      runnerId: "runner",
      sequence: 1,
      sentAt: new Date().toISOString(),
      kind: "event",
      payload: { type: "run.activity", runId: "run", summary: "safe", raw: { token: "no" } },
    })).toThrowError(expect.objectContaining<Partial<ProtocolValidationError>>({ code: "INVALID_ENVELOPE" }));
  });
});
