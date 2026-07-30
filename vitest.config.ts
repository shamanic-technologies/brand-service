import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules', 'dist', 'tests', '*.config.ts'],
    },
    // Run all tests sequentially for integration tests that share DB
    fileParallelism: false,
    maxWorkers: 1,
    // Increase timeout for integration tests that connect to DB
    testTimeout: 10000,
    // Hooks have their OWN budget, separate from testTimeout, and it defaults to 10s.
    // CI now provisions a throwaway Neon branch per run, so setup and teardown pay cold,
    // cross-region round-trips that a warm long-lived database never charged.
    hookTimeout: 30000,
  },
});
