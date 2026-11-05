import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
    testTimeout: 20_000,
    hookTimeout: 60_000,
    // DB tests share one test database; run files sequentially.
    fileParallelism: false,
    globalSetup: ["./test/global-setup.ts"],
    setupFiles: ["./test/setup-env.ts"],
  },
});
