import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'web/e2e',
  testMatch: '*.e2e.ts',
  timeout: 60_000,
  reporter: 'list',
  use: { acceptDownloads: true },
});
