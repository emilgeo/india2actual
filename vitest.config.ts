import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests that spawn the CLI exceed the 5s default on the macOS runners.
    testTimeout: 30_000,
    // Browser tests need a built page and a browser, so they run on their own.
    exclude: [...configDefaults.exclude, 'web/e2e/**'],
  },
});
