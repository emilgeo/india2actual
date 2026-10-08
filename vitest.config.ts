import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Browser tests need a built page and a browser, so they run on their own.
    exclude: [...configDefaults.exclude, 'web/e2e/**'],
  },
});
