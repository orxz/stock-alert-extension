// tests/e2e/live-quotes.spec.ts
// 实网行情冒烟测试——**不属于阻断门禁**（playwright.config.mjs 的 `live` project）。
//
// 为什么单独隔离：本文件真实访问 push2.eastmoney.com / qt.gtimg.cn。
// 这两个端点在中国大陆以外延迟高、偶发不可达（实测东财走 302 重定向后
// TLS 握手 2.5–6.0s，4 次里有 1 次 8s 超时），GitHub 托管的 ubuntu runner
// 位于境外——把它放进 `npm run ci` 会让门禁按第三方网络状况随机变红。
// 它验证的是「传输层没有回归」，用 `npm run test:live` 按需运行。
//
// 断言纪律：状态栏的「实时」是常驻文案（`实时 ${count}`），
// 断言 `toContain('实时')` 恒真且会立刻通过、变成与网络赛跑——
// 必须断言非零计数 /实时 [1-9]/。
import { expect, test } from '@playwright/test';
import { launchBuiltExtension, stock, baseSeed } from './extension-fixture';

/** 实网往返允许的时间：覆盖东财冷连接重定向 + 腾讯备源兜底。 */
const LIVE_TIMEOUT_MS = 40_000;

test('online: manual refresh fetches real quotes over the network', async () => {
  test.setTimeout(LIVE_TIMEOUT_MS + 30_000);
  const launched = await launchBuiltExtension({
    seed: baseSeed({ watchlist: [stock('sh600519')] })
  });
  try {
    await launched.page.click('[data-action="refresh"]');

    // 必须等到**非零**实时计数——主源超时时由腾讯备源兜底。
    await expect
      .poll(() => launched.page.locator('#quote-status-summary').innerText(), {
        timeout: LIVE_TIMEOUT_MS,
        intervals: [500]
      })
      .toMatch(/实时 [1-9]/);

    // 行情价格应为真实数字而非 '--'。
    const price = await launched.page
      .locator('.stock-table-cell--price, .stock-card-price')
      .first()
      .innerText();
    expect(price).not.toBe('--');
    expect(Number.parseFloat(price)).toBeGreaterThan(0);
    expect(launched.errors).toEqual([]);
  } finally {
    await launched.close();
  }
});
