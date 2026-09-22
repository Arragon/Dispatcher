import { describe, expect, it } from "vitest";
import { RunnerEnrollmentAuthority, isRunnerVersionCompatible } from "../src/index.js";

describe("Runner enrollment and upgrade compatibility", () => {
  it("consumes a one-time token once and rejects it after expiry", () => {
    const authority = new RunnerEnrollmentAuthority();
    const now = new Date("2026-09-23T00:00:00.000Z");
    const issued = authority.issue("runner-1", 60_000, now);
    expect(authority.consume("runner-1", issued.token, new Date("2026-09-23T00:00:30.000Z"))).toMatchObject({ runnerId: "runner-1" });
    expect(() => authority.consume("runner-1", issued.token, new Date("2026-09-23T00:00:31.000Z"))).toThrow("already consumed");
    const expired = authority.issue("runner-2", 1_000, now);
    expect(() => authority.consume("runner-2", expired.token, new Date("2026-09-23T00:00:01.000Z"))).toThrow("expired");
  });

  it("allows patch upgrades but rejects incompatible major/minor runners", () => {
    expect(isRunnerVersionCompatible("0.1.0", "0.1.9")).toBe(true);
    expect(isRunnerVersionCompatible("0.1.0", "0.2.0")).toBe(false);
    expect(isRunnerVersionCompatible("0.1.0", "1.1.0")).toBe(false);
    expect(isRunnerVersionCompatible("0.1.0", "dev")).toBe(false);
  });
});
