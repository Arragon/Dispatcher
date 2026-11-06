import { defineConfig } from "vitest/config";
import { availableParallelism } from "node:os";

export default defineConfig({
  test: {
    // Integration workers also spawn native CLI, Git and verification children.
    // Leave CPU for those children instead of exhausting their probe deadlines.
    maxWorkers: Math.min(4, availableParallelism()),
    coverage: { reporter: ["text", "json-summary"] },
    include: ["apps/**/test/**/*.test.ts?(x)", "packages/**/test/**/*.test.ts"],
    testTimeout: 10_000,
  },
});
