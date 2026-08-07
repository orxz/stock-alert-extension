// tests/e2e/cross-browser.spec.ts
// 跨浏览器冒烟守护：验证扩展在 Chromium 系浏览器（Edge 优先）上的核心闭环。
//
// 设计取舍：
// - 不复用 default project 的细粒度断言——chromium 全套已覆盖业务逻辑。
//   这里只做"在这条浏览器上扩展能跑起来 + 核心闭环通过"的守护，
//   目的是在 API/行为出现跨浏览器分叉时第一时间变红。
// - 用 offline 模式，不依赖实网行情，避免 CI runner 抖动。
// - 通过 E2E_CHANNEL 环境变量选择浏览器 channel（edge project 设 msedge）。
import { expect, test } from '@playwright/test';
import { launchBuiltExtension, stock, baseSeed, getStorage, gridBoardConfig } from './extension-fixture';

// 当前生效的 channel——写入测试标题便于排错。
const CHANNEL = process.env.E2E_CHANNEL ?? 'chromium';

test.describe(`cross-browser smoke [channel: ${CHANNEL}]`, () => {
  test('edge project is not silently running on chromium', ({}, testInfo) => {
    // fixture 读 E2E_CHANNEL 选 channel，不经 Playwright 的 use.channel。
    // 如果直跑 --project=edge 却不设 E2E_CHANNEL=msedge，会静默回退到 chromium。
    // 这个守护让该错误变成显式失败，而非测试标题与 project 名矛盾但不报错。
    // 注意：显式设 E2E_CHANNEL=chromium 是合法的调试场景，只有完全未设时才 fail-fast。
    if (testInfo.project.name === 'edge' && process.env.E2E_CHANNEL === undefined) {
      throw new Error('edge project requires E2E_CHANNEL=msedge; running without it silently uses chromium. Use: npm run test:cross-browser');
    }
  });

  test('fresh profile bootstraps without SW/popup errors', async () => {
    const launched = await launchBuiltExtension({ offline: true, seed: baseSeed() });
    try {
      // bootstrap 完成（schemaVersion===2 由 waitForInitialization 守护）。
      // 弹窗应正常渲染，没有 SW/popup 异常。
      await expect(launched.page.locator('#stock-board')).toBeVisible();
      expect(launched.errors).toEqual([]);
      expect(launched.consoleErrors).toEqual([]);
    } finally {
      await launched.close();
    }
  });

  test('seeded stock renders and persists across group switch', async () => {
    // 两只股票分属不同分组，验证 view 不变量（选中集 ⊆ 当前分组可见集）。
    const launched = await launchBuiltExtension({
      offline: true,
      seed: baseSeed({
        watchlist: [
          { ...stock('sh600519', 0), groupIds: ['g_tech'], manualOrder: { g_all: 0, g_tech: 0 } },
          { ...stock('sz000001', 1), groupIds: [], manualOrder: { g_all: 1 } }
        ],
        boardConfig: gridBoardConfig()
      })
    });
    try {
      // 「全部」视图应渲染两只股票（网格视图下卡片）。
      await expect(launched.page.locator('stock-card[data-key="sh600519"]')).toBeVisible();
      await expect(launched.page.locator('stock-card[data-key="sz000001"]')).toBeVisible();

      // 切换到 g_tech——只有 sh600519 属于该分组。
      await launched.page.evaluate(() => {
        document.querySelectorAll('[role="tab"]').forEach((tab) => {
          if (tab.getAttribute('data-group-id') === 'g_tech') {
            (tab as HTMLElement).click();
          }
        });
      });
      await launched.page.waitForTimeout(200);

      await expect(launched.page.locator('stock-card[data-key="sh600519"]')).toBeVisible();
      // g_tech 视图不应渲染 sz000001（view 不变量）。
      await expect(launched.page.locator('stock-card[data-key="sz000001"]')).toHaveCount(0);

      // 持久化未受切分组影响。
      const wl = await getStorage<Array<{ code: string }>>(launched.page, 'watchlist');
      expect(wl).toHaveLength(2);
      expect(launched.errors).toEqual([]);
      expect(launched.consoleErrors).toEqual([]);
    } finally {
      await launched.close();
    }
  });

  test('add-then-remove stock completes a write round-trip', async () => {
    const launched = await launchBuiltExtension({ offline: true, seed: baseSeed() });
    try {
      const page = launched.page;
      // 添加一只股票。
      await page.click('stock-header [data-action="add-stock"]');
      await expect(page.locator('dialog')).toBeVisible();
      await page.fill('input[data-field="code"]', 'sh600519');
      await page.fill('input[data-field="name"]', '贵州茅台');
      await page.click('button[data-action="dialog-submit"]');
      // 看板应渲染该股票（默认网格视图）。
      await expect(page.locator('#stock-board')).toContainText('贵州茅台');
      // 持久化确认。
      await expect.poll(async () => {
        const wl = await getStorage<Array<{ code: string }>>(page, 'watchlist');
        return wl?.length ?? 0;
      }).toBe(1);

      // 删除该股票（行内菜单 → 确认对话框 → 提交）。
      // 确认对话框的提交按钮统一用 dialog-submit（与 add-stock 等一致）。
      await page.click('#stock-actions-sh600519');
      await page.click('button[data-action="remove"]');
      await expect(page.locator('dialog')).toBeVisible();
      await page.click('button[data-action="dialog-submit"]');
      // 看板回到空状态。
      await expect.poll(async () => {
        const wl = await getStorage<Array<{ code: string }>>(page, 'watchlist');
        return wl?.length ?? 0;
      }).toBe(0);
      expect(launched.errors).toEqual([]);
      expect(launched.consoleErrors).toEqual([]);
    } finally {
      await launched.close();
    }
  });
});
