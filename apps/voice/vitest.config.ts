import { defineConfig } from "vitest/config";

const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgres://fekerte:fekerte@localhost:5432/fekerte_test";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    globalSetup: ["./test/setup.ts"],
    env: { DATABASE_URL: TEST_DB, TEST_DATABASE_URL: TEST_DB, NODE_ENV: "test", LOG_LEVEL: "error", WHATSAPP_PROVIDER: "mock", LLM_PROVIDER: "mock", APP_URL: "http://localhost:3000" },
  },
});
