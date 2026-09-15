import { describe, expect, it } from "vitest";
import { moduleBoundary } from "../src/index.js";

describe("fleet package boundary", () => {
  it("is importable and declares its delivery state", () => {
    expect(moduleBoundary.id).toBe("fleet");
    expect(moduleBoundary.milestone).toBe("M7");
  });
});
