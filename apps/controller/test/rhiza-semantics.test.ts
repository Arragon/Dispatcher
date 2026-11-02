import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalRhizaJson, rhizaDigest, rhizaInputHash, rhizaApprovalDigest } from "../src/rhiza-semantics.js";

describe("ingress v1 semantic identity", () => {
  it("sorts object keys by code unit recursively, preserving arrays and exact text", () => {
    expect(canonicalRhizaJson({ z: [2, 1], a: { "ä": "line\r\n😀", Z: 0, a: false } })).toBe('{"a":{"Z":0,"a":false,"ä":"line\\r\\n😀"},"z":[2,1]}');
    expect(rhizaDigest({ a: 1, b: 2 })).toBe(rhizaDigest({ b: 2, a: 1 }));
    expect(rhizaDigest([1, 2])).not.toBe(rhizaDigest([2, 1]));
    expect(rhizaInputHash("x\r\n")).not.toBe(rhizaInputHash("x\n"));
    expect(rhizaInputHash("😀")).toBe(createHash("sha256").update("😀", "utf8").digest("hex"));
  });
  it.each([undefined, NaN, Infinity, 1n, new Date(), () => 1, "\ud800", "\udc00", { "\ud800": 1 }, { value: undefined }])("rejects a noncanonical value %s", value => {
    expect(() => canonicalRhizaJson(value)).toThrow();
  });
  it("rejects cycles and excessive nesting", () => {
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    expect(() => canonicalRhizaJson(cycle)).toThrow();
    let nested: unknown = 0; for (let i = 0; i < 65; i++) nested = [nested];
    expect(() => canonicalRhizaJson(nested)).toThrow();
  });
  it("binds approval fields while excluding only its own digest", () => {
    const order = { title: "same", origin: { generation: 1 }, approval: { reference: "approval-a", expiresAt: "2026-12-01T00:00:00Z", digest: "ignored" } };
    const expected = rhizaDigest({ workOrder: { title: order.title, origin: order.origin }, approval: { reference: order.approval.reference, expiresAt: order.approval.expiresAt } });
    expect(rhizaApprovalDigest(order)).toBe(expected);
    expect(rhizaApprovalDigest({ ...order, approval: { ...order.approval, digest: "other" } })).toBe(expected);
    expect(rhizaApprovalDigest({ ...order, origin: { generation: 2 } })).not.toBe(expected);
    expect(rhizaApprovalDigest({ ...order, approval: { ...order.approval, reference: "other" } })).not.toBe(expected);
  });
});
