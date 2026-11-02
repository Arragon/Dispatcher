import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import * as protocol from "../src/index.js";
import { examples, workOrder, target, modelEvidence } from "./fixtures/rhiza-v1.js";

const schema = Reflect.get(protocol, "rhizaV1Schema");
const ajv = new Ajv({ strict: true, allErrors: true });
if (schema) ajv.addSchema(schema);
const valid = (name: string, value: unknown): boolean => schema
  ? Boolean(ajv.getSchema(`${schema.$id}#/$defs/${name}`)!(value)) : false;
const copy = <T>(value: T): T => structuredClone(value);

describe("Dispatcher RHIZA ingress v1 wire contract", () => {
  it.each(Object.entries(examples))("accepts the bounded %s example", (name, value) => {
    expect(valid(name, value)).toBe(true);
  });
  it.each(Object.entries(examples))("rejects unknown %s fields instead of discarding them", (name, value) => {
    expect(valid(name, { ...value, ownerToken: "must-not-be-accepted" })).toBe(false);
  });
  it("preserves per-task explicit models and all constraints without fixed Profile model coupling", () => {
    expect(valid("workOrder", { ...workOrder, target: { ...target, modelId: "fixture/model-b", modelOptions: { effort: "low" } } })).toBe(true);
    expect(valid("workOrder", { ...workOrder, constraints: [] })).toBe(true);
    const missing = copy(workOrder) as Partial<typeof workOrder>; delete missing.constraints;
    expect(valid("workOrder", missing)).toBe(false);
  });
  it.each(["none", "commit", "shell"])("rejects %s delivery for the code+PR ingress", type => {
    expect(valid("workOrder", { ...workOrder, delivery: { ...workOrder.delivery, type } })).toBe(false);
  });
  it("rejects arbitrary executables, credentials, missing target versions and non-scalar model options", () => {
    for (const patch of [{ executable: "/bin/sh" }, { credentialRef: "secret://owner/token" }, { modelOptions: { effort: { raw: true } } }, { cliVersion: "" }]) {
      expect(valid("target", { ...target, ...patch })).toBe(false);
    }
    const missing = copy(target) as Partial<typeof target>; delete missing.contextFingerprint;
    expect(valid("target", missing)).toBe(false);
  });
  it("rejects unbounded Context, empty verification and non-integer generation", () => {
    expect(valid("workOrder", { ...workOrder, context: { ...workOrder.context, content: "x".repeat(65537) } })).toBe(false);
    expect(valid("workOrder", { ...workOrder, verificationCommandIds: [] })).toBe(false);
    expect(valid("workOrder", { ...workOrder, origin: { ...workOrder.origin, generation: 1.5 } })).toBe(false);
  });
  it("requires binding and trusted-source fields before wire evidence can claim verified", () => {
    expect(valid("modelEvidence", { ...modelEvidence, reported: null })).toBe(false);
    expect(valid("modelEvidence", { ...modelEvidence, source: "invocation-record" })).toBe(false);
    expect(valid("modelEvidence", { ...modelEvidence, binding: { ...modelEvidence.binding, sessionId: null } })).toBe(false);
    expect(valid("modelEvidence", { ...modelEvidence, status: "configuration_confirmed", source: "invocation-record", reported: null })).toBe(true);
  });
  it.each(["completed", "success", "arbitrary"])("does not map unknown snapshot state %s to candidate success", state => {
    expect(valid("snapshot", { ...examples.snapshot, state })).toBe(false);
  });
  it("requires new command identity and exact control fence fields", () => {
    const missing = copy(examples.inputRequest) as Partial<typeof examples.inputRequest>; delete missing.leaseId;
    expect(valid("inputRequest", missing)).toBe(false);
    expect(valid("cancellationRequest", { ...examples.cancellationRequest, expectedJobRevision: 0 })).toBe(false);
  });
  it("requires an actionable input snapshot to expose its current native fences", () => {
    const waiting = { ...examples.snapshot, state: "waiting_input", runId: "dispatcher-run", runGeneration: 2, allowedOperations: ["jobs:input"] };
    expect(valid("snapshot", waiting)).toBe(false);
    expect(valid("snapshot", { ...waiting, intervention: { revision: 3, sessionId: "native-session", leaseId: "lease-a", taskRevision: 4 } })).toBe(true);
  });
  it("allows explicit pre-Run cancellation without inventing a native execution identity", () => {
    expect(valid("cancellationRequest", { requestId: "cancel-queued", expectedJobRevision: 1, runId: null, generation: 3 })).toBe(true);
    expect(valid("cancellationRequest", { ...examples.cancellationRequest, runGeneration: 2 })).toBe(true);
    const missing = copy(examples.cancellationRequest) as Partial<typeof examples.cancellationRequest>; delete missing.runGeneration;
    expect(valid("cancellationRequest", missing)).toBe(false);
  });
});
