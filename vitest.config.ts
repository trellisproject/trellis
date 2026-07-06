import { defineConfig } from "vitest/config";

// Tests run against a dedicated Postgres database (trellis_test) on the local
// Docker container, provisioned and migrated by test/global-setup.ts. The env
// override here is authoritative so tests can never touch the dev database.
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://trellis:trellis@localhost:5440/trellis_test";

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    env: { DATABASE_URL: TEST_DATABASE_URL },
    fileParallelism: false, // shared test DB — avoid cross-file truncation races
  },
});
