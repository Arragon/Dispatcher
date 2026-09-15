import { describe, expect, it } from "vitest";
import { normalizeCliArguments } from "../src/cli-args.js";

describe("CLI argument normalization", () => {
  it("accepts the pnpm script separator without changing command flags", () => {
    expect(normalizeCliArguments(["--", "doctor", "--data-dir", "/tmp/dispatcher"])).toEqual([
      "doctor",
      "--data-dir",
      "/tmp/dispatcher",
    ]);
    expect(normalizeCliArguments(["serve", "--with-runner"])).toEqual(["serve", "--with-runner"]);
  });
});
