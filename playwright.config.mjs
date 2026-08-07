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
      // cross-browser.spec.ts 由 edge project 专门跑——chromium 全套业务用例已覆盖逻辑。
      testIgnore: ['**/performance.spec.ts', '**/live-quotes.spec.ts', '**/cross-browser.spec.ts'],
      use: {}
    },
    {
      // 跨浏览器冒烟（Edge）：通过环境变量 E2E_CHANNEL=msedge 驱动 fixture 启动 Edge channel。
      // chromium 基线已由 default project 覆盖，这里只守护 Chromium 系分叉。
      // use.channel 仅为文档意图——实际 channel 切换由 fixture 内 chromium.launchPersistentContext({channel}) 完成，不经 Playwright browser fixture。
      name: 'edge',
      testMatch: /cross-browser\.spec\.ts$/,
      use: { channel: 'msedge' }
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
