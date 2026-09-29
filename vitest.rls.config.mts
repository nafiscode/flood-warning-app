import { defineConfig } from "vitest/config";

/**
 * RLS policy tests: real SQL against a real Supabase database, one rolled-back transaction per
 * test. Laptop: jaga-dev via SUPABASE_DB_URL. CI: a throwaway local Supabase on the runner.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/rls/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
