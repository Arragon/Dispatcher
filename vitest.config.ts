import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: { reporter: ["text", "json-summary"] },
    include: ["apps/**/test/**/*.test.ts?(x)", "packages/**/test/**/*.test.ts"],
    testTimeout: 10_000,
  },
});
