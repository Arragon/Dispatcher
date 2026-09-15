import { describe, expect, it } from "vitest";
import { moduleBoundary } from "../src/index.js";

describe("integrations package boundary", () => {
  it("is importable and declares its delivery state", () => {
    expect(moduleBoundary.id).toBe("integrations");
    expect(moduleBoundary.milestone).toBe("M6");
  });
});
