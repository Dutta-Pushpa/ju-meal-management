import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    // The test database is migrated before any suite runs, so a new checkout
    // needs nothing more than a created database and npm test.
    globalSetup: ['tests/global-setup.ts'],
    setupFiles: ['tests/setup.ts'],
    // Integration tests share one PostgreSQL instance. Running files in
    // parallel would make their transactions and truncations collide.
    fileParallelism: false,
    // Defaults suit a local database. A hosted provider such as Neon can take
    // far longer to create a scratch database and migrate it, so both timeouts
    // can be raised for a run without editing this file, for example:
    //   $env:VITEST_TEST_TIMEOUT = 120000; npm test
    testTimeout: Number(process.env['VITEST_TEST_TIMEOUT'] ?? 15_000),
    hookTimeout: Number(process.env['VITEST_HOOK_TIMEOUT'] ?? 30_000),
    // A hosted database can drop a connection mid-test. An opt-in retry absorbs
    // that transient failure without masking real ones locally, where the retry
    // stays at 0.
    retry: Number(process.env['VITEST_RETRY'] ?? 0),
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts'],
    },
  },
  resolve: {
    alias: {
      '@ju/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
});
