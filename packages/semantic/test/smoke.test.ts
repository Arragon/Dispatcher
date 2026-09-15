import { describe, expect, it } from "vitest";
import { moduleBoundary } from "../src/index.js";

describe("semantic package boundary", () => {
  it("is importable and declares its delivery state", () => {
    expect(moduleBoundary.id).toBe("semantic");
    expect(moduleBoundary.milestone).toBe("M8");
  });
});
