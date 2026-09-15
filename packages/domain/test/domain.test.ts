import { describe, expect, it } from "vitest";
import {
  InvalidStateTransitionError,
  assertRunTransition,
  assertTaskTransition,
  domainContractSchema,
  isTerminalRunState,
} from "../src/index.js";

describe("domain state contracts", () => {
  it.each([
    ["READY", "QUEUED"],
    ["RUNNING", "WAITING_RESOURCE"],
    ["WAITING_RESOURCE", "RUNNING"],
    ["VERIFYING", "REVIEW"],
  ] as const)("accepts task transition %s -> %s", (from, to) => {
    expect(() => assertTaskTransition(from, to)).not.toThrow();
  });

  it.each([
    ["ACTIVE", "RESOURCE_BLOCKED"],
    ["RESOURCE_BLOCKED", "ACTIVE"],
    ["VERIFYING", "DELIVERING"],
    ["DELIVERING", "COMPLETE"],
  ] as const)("accepts run transition %s -> %s", (from, to) => {
    expect(() => assertRunTransition(from, to)).not.toThrow();
  });

  it("rejects an illegal transition with a classified error", () => {
    expect(() => assertRunTransition("COMPLETE", "ACTIVE")).toThrow(InvalidStateTransitionError);
  });

  it("keeps resource blocking distinct from failure", () => {
    expect(isTerminalRunState("RESOURCE_BLOCKED")).toBe(false);
    expect(isTerminalRunState("FAILED")).toBe(true);
  });

  it("publishes stable JSON schema identifiers", () => {
    expect(domainContractSchema.$id).toContain("domain-v1");
    expect(domainContractSchema.$defs.runState.enum).toContain("SUPERSEDED");
  });
});
