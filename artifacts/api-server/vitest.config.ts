import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Integration tests share the dev database; run serially.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
