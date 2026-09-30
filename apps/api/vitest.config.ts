import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: "./src/test/globalSetup.ts",
    setupFiles: ["./src/test/env.ts"],
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 30_000,
    sequence: { concurrent: false },
  },
});
