import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  use: { trace: 'retain-on-failure' },
  webServer: undefined,
  projects: [
    {
      name: 'default',
      testIgnore: ['**/performance.spec.ts'],
      use: {}
    },
    {
      name: 'performance',
      testMatch: /performance\.spec\.ts$/,
      fullyParallel: false,
      workers: 1,
      use: { trace: 'on' }
    }
  ]
});
