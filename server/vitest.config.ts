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
    testTimeout: 15_000,
    hookTimeout: 30_000,
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
