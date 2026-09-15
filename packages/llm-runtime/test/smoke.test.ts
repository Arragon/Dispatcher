import { describe, expect, it } from "vitest";
import { moduleBoundary } from "../src/index.js";

describe("llm-runtime package boundary", () => {
  it("is importable and declares its delivery state", () => {
    expect(moduleBoundary.id).toBe("llm-runtime");
    expect(moduleBoundary.milestone).toBe("M3");
  });
});
