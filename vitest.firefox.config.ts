import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['web/e2e-firefox/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 300_000,
    // One Firefox and one Actual server, shared by the tests in order.
    fileParallelism: false,
    // NODE_ENV=test breaks the Actual API and the sync server's migrations.
    env: { NODE_ENV: 'production' },
  },
});
