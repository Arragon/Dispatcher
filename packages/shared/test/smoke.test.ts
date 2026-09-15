import { describe, expect, it } from "vitest";
import { moduleBoundary } from "../src/index.js";

describe("shared package boundary", () => {
  it("is importable and declares its delivery state", () => {
    expect(moduleBoundary.id).toBe("shared");
    expect(moduleBoundary.milestone).toBe("M0");
  });
});
