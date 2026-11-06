// Batch 3: real-database tests. Separate config because these need a live
// PostgreSQL (CI `quality` job service, local docker/psql) instead of the
// in-process stores the unit suite relies on.
//
//   pnpm test:db        # skips (exit 0 + SKIP notice) when DATABASE_URL is unset
//
// No coverage thresholds here: the files under tests/db are integration probes,
// their value is the SQL semantics they exercise, not line coverage.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  resolve: { alias: { "@": srcDir } },
  test: {
    include: ["tests/db/**/*.test.ts"],
    environment: "node",
    // One shared database: parallel files would fight over rows.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
