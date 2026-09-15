import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("benchmark report contract", () => {
  it("defines measured values separately from design targets", () => {
    const schema = JSON.parse(readFileSync(new URL("../../../benchmarks/report.schema.json", import.meta.url), "utf8")) as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(schema.required).toContain("measurements");
    expect(schema.required).toContain("targets");
    expect(schema.properties).toHaveProperty("limitations");
  });
});
