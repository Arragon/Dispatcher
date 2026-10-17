import { describe, expect, it } from "vitest";
import { LEGACY_PROTOCOL_VERSION, PROTOCOL_VERSION, createEnvelope, parseEnvelope, type ProtocolValidationError } from "../src/index.js";

describe("Runner Protocol v1", () => {
  it("accepts bounded native execution descriptors and requires authority for native mutations",()=>{
    const plan={repositoryId:"repo",taskId:"task",runId:"run",attempt:1,baseRef:"main",scopePaths:["."]};
    const base={kind:"command" as const,messageId:"native",traceId:"trace",runnerId:"runner",sequence:1,leaseId:"lease",generation:1,leaseExpiresAt:"2026-10-16T20:00:00Z"};
    const envelope={...createEnvelope({...base,payload:{type:"runner.health"}}),payload:{type:"native.workspace_prepare",runId:"run",profileId:"account",plan,verificationCommandIds:["test"]}};
    expect(parseEnvelope(envelope).payload.type).toBe("native.workspace_prepare");
    const finalize={...envelope,payload:{type:"native.run_finalize",runId:"run"}};
    expect(()=>parseEnvelope(finalize)).not.toThrow();expect(()=>parseEnvelope({...finalize,leaseId:undefined})).toThrow();expect(()=>parseEnvelope({...finalize,payload:{...finalize.payload,root:"/outside"}})).toThrow();
    for(const patch of [{leaseId:undefined},{generation:undefined},{payload:{...envelope.payload,executable:"/bin/sh"}},{payload:{...envelope.payload,plan:{...plan,root:"/arbitrary"}}},{payload:{...envelope.payload,runId:"different"}}])expect(()=>parseEnvelope({...envelope,...patch})).toThrow();
    expect(()=>parseEnvelope({...envelope,leaseId:undefined,generation:undefined,leaseExpiresAt:undefined,payload:{type:"native.model_catalog",profileId:"account",repositoryId:"repo",reason:"open"}})).not.toThrow();
    expect(()=>parseEnvelope({...envelope,protocolVersion:"1.1"})).toThrowError(expect.objectContaining({code:"UNSUPPORTED_PROTOCOL"}));
  });
  it("allows only frozen bounded commit intent and an authority-bound command without executable overrides",()=>{
    const base=createEnvelope({kind:"command",runnerId:"remote",traceId:"trace",messageId:"prepare",sequence:1,leaseId:"lease",generation:1,leaseExpiresAt:"2026-10-16T20:00:00Z",payload:{type:"native.workspace_prepare",runId:"run",profileId:"p",plan:{repositoryId:"repo",taskId:"task",runId:"run",attempt:1,baseRef:"main",scopePaths:["."]},verificationCommandIds:[],delivery:{type:"commit",message:"Explicit commit"}}});
    expect(()=>parseEnvelope(base)).not.toThrow();
    for(const delivery of [{type:"commit",message:""},{type:"commit",message:"x".repeat(1001)},{type:"commit",message:"hi",args:["push"]},{type:"pull-request"}])expect(()=>parseEnvelope({...base,payload:{...base.payload,delivery}})).toThrow();
    const commit={...base,payload:{type:"native.run_commit",runId:"run"}};expect(()=>parseEnvelope(commit)).not.toThrow();expect(()=>parseEnvelope({...commit,leaseId:undefined})).toThrow();expect(()=>parseEnvelope({...commit,payload:{...commit.payload,message:"changed"}})).toThrow();
  });
  it("bounds native PR targets and refuses push command overrides",()=>{
    const base=createEnvelope({kind:"command",runnerId:"remote",traceId:"t",messageId:"m",sequence:1,leaseId:"l",generation:1,leaseExpiresAt:"2026-10-16T20:00:00Z",payload:{type:"runner.health"}}),target={version:1,host:"github.example",repository:"acme/repo",remoteFingerprint:"a".repeat(64)},prepare={type:"native.workspace_prepare",runId:"run",profileId:"p",plan:{repositoryId:"repo",taskId:"task",runId:"run",attempt:1,baseRef:"main",scopePaths:["."]},verificationCommandIds:[],delivery:{type:"pull-request",message:"explicit PR",target}};
    expect(()=>parseEnvelope({...base,payload:prepare})).not.toThrow();for(const patch of [{host:"https://github.example"},{repository:"../repo"},{remoteFingerprint:"bad"},{url:"ssh://git@private/target"}])expect(()=>parseEnvelope({...base,payload:{...prepare,delivery:{...prepare.delivery,target:{...target,...patch}}}})).toThrow();
    const push={type:"native.run_push",runId:"run"};expect(()=>parseEnvelope({...base,payload:push})).not.toThrow();expect(()=>parseEnvelope({...base,leaseId:undefined,payload:push})).toThrow();expect(()=>parseEnvelope({...base,payload:{...push,args:["--force"]}})).toThrow();expect(()=>parseEnvelope({...base,payload:{type:"native.repository_delivery",repositoryId:"repo",root:"/outside"}})).toThrow();
  });
  it("binds a native start selection to the descriptor's profile, Runner and managed workspace",()=>{
    const selection={version:1,mode:"manual",source:"explicit",profileId:"account",runnerId:"runner",providerId:"codex",backendId:"codex-exec-json",selectionType:"explicit-model",requestedModel:"model",catalogRevision:"catalog",contextFingerprint:"context",configRevision:1,nativeParameters:{},selectedAt:"2026-10-16T20:00:00Z"};
    const execution={version:1,profileId:"account",workspaceId:"run",prompt:"Original\n任务",selection};
    const envelope={...createEnvelope({kind:"command",messageId:"start",traceId:"trace",runnerId:"runner",sequence:1,payload:{type:"runner.health"}}),leaseId:"lease",generation:1,leaseExpiresAt:"2026-10-16T20:15:00Z",payload:{type:"run.start",runId:"run",execution}};
    expect(parseEnvelope(envelope).payload.type).toBe("run.start");
    for(const changed of [{...execution,executable:"/bin/sh"},{...execution,workspaceId:"outside"},{...execution,selection:{...selection,profileId:"other"}},{...execution,selection:{...selection,runnerId:"other"}},{...execution,selection:{...selection,nativeParameters:{raw:{secret:"no"}}}}])expect(()=>parseEnvelope({...envelope,payload:{...envelope.payload,execution:changed}})).toThrow();
  });
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

  it("accepts v1 fixtures while current envelopes add traceable connector metadata", () => {
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
    expect(parseEnvelope(current)).toMatchObject({ protocolVersion: PROTOCOL_VERSION, idempotencyKey: "dedupe" });
  });

  it("validates v1.2 acknowledgement and lease fencing metadata", () => {
    const envelope = createEnvelope({
      kind: "command",
      messageId: "fenced",
      traceId: "trace",
      runnerId: "runner",
      sequence: 2,
      ackSequence: 1,
      leaseId: "lease-2",
      generation: 2,
      leaseExpiresAt: "2026-09-23T12:00:00.000Z",
      payload: { type: "run.start", runId: "run-2" },
    });
    expect(parseEnvelope(envelope)).toMatchObject({ ackSequence: 1, leaseId: "lease-2", generation: 2 });
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
