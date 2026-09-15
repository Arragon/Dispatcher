import { describe, expect, it } from "vitest";
import { moduleBoundary } from "../src/index.js";

describe("workspace package boundary", () => {
  it("is importable and declares its delivery state", () => {
    expect(moduleBoundary.id).toBe("workspace");
    expect(moduleBoundary.milestone).toBe("M4");
  });
});
