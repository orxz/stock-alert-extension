import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  use: { trace: 'retain-on-failure' },
  webServer: undefined,
  projects: [
    {
      // 阻断门禁：完全离线/受控，不依赖第三方网络可达性。
      name: 'default',
      testIgnore: ['**/performance.spec.ts', '**/live-quotes.spec.ts'],
      use: {}
    },
    {
      // 实网冒烟：按需运行（npm run test:live），不进 `npm run ci`。
      name: 'live',
      testMatch: /live-quotes\.spec\.ts$/,
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
