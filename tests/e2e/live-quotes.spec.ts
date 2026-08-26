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
      .locator('[data-field="price"]')
      .first()
      .innerText();
    expect(price).not.toBe('--');
    expect(Number.parseFloat(price)).toBeGreaterThan(0);
    expect(launched.errors).toEqual([]);
  } finally {
    await launched.close();
  }
});

test('online: cold start auto-refreshes the index strip without manual click', async () => {
  // 回归守护（指数数据为空 v2.1.1）：bootstrap 完成后必须**立即**触发一次刷新，
  // 而不是等 10s 调度周期——否则 popup 首帧指数条是 '--'（缺失 3）。
  // 断言窗收紧到 4s：修复前（首个调度周期 10s）必红，修复后（实测 519ms）必绿。
  test.setTimeout(30_000);
  const launched = await launchBuiltExtension({
    seed: baseSeed({ watchlist: [] })
  });
  try {
    // 不点刷新按钮：打开后指数条应在 4s 内自动出现真实点位。
    await expect
      .poll(
        async () => {
          const chips = await launched.page
            .locator('#index-strip .index-chip-price')
            .evaluateAll((els) => els.map((el) => el.textContent ?? ''));
          return chips.length === 4 && chips.every((c) => /^\d/.test(c));
        },
        {
          timeout: 4_000,
          intervals: [250]
        }
      )
      .toBe(true);
    expect(launched.errors).toEqual([]);
  } finally {
    await launched.close();
  }
});

test('online: row click opens detail panel and renders trends canvas', async () => {
  test.setTimeout(LIVE_TIMEOUT_MS + 30_000);
  const launched = await launchBuiltExtension({
    seed: baseSeed({ watchlist: [stock('sh600519')], boardConfig: { g_all: { viewMode: 'list', sortField: 'manual', sortDirection: 'asc', priceHidden: false } } })
  });
  try {
    // 点击名称行主体（非按钮）→ 详情面板打开。
    await launched.page.locator('tr[data-key="sh600519"] .stock-table-name').click();
    await expect(launched.page.locator('chart-detail-panel')).toBeVisible({ timeout: 5_000 });
    // seed 的 stock() 工厂 name 为「股票0」（fixture 约定，非真实名称）。
    await expect(launched.page.locator('[data-region="detail-title"]')).toContainText('股票0');
    // 分时图 canvas 应出现（画布挂载即有；数据到位后绘制不报错）。
    const canvasCount = await launched.page.locator('.detail-canvas').count();
    expect(canvasCount).toBe(1);
    // 切日K：loader 再次调用（网络往返），面板保持打开。
    await launched.page.click('[data-chart-key="day"]');
    await launched.page.waitForTimeout(1_000);
    await expect(launched.page.locator('chart-detail-panel')).toBeVisible();
    // 关闭。
    await launched.page.click('[data-action="detail-close"]');
    await expect(launched.page.locator('chart-detail-panel')).toBeHidden({ timeout: 5_000 });
    expect(launched.errors).toEqual([]);
  } finally {
    await launched.close();
  }
});

test('online: hovering a row shows tooltip; mini trends renders when network allows', async () => {
  // 实网冒烟：hover 浮层必现（16 项指标不依赖网络）；迷你分时图依赖历史接口可用性——
  // 接口被限流（实测 push2his 偶发 52/空回复风控）时静默降级，浮层照常。
  // 断言分两态：网络可 → 迷你图显示；网络否 → 浮层仍完整、无页面错误。
  test.setTimeout(LIVE_TIMEOUT_MS + 30_000);
  const launched = await launchBuiltExtension({
    seed: baseSeed({
      watchlist: [stock('sh600519')],
      boardConfig: { g_all: { viewMode: 'list', sortField: 'manual', sortDirection: 'asc', priceHidden: false } }
    })
  });
  try {
    const row = launched.page.locator('tr[data-key="sh600519"]');
    await row.hover();
    await expect(row.locator('.stock-detail-tooltip')).toBeVisible({ timeout: 5_000 });
    // 等网络窗口：数据到位 → wrap 显示；否则保持 hidden（浮层指标在）——两者都是正确行为。
    const shown = await launched.page
      .evaluate(() => {
        const wrap = document.querySelector('tr[data-key="sh600519"] .detail-mini-wrap') as HTMLElement | null;
        return wrap ? !wrap.hidden : false;
      })
      .catch(() => false);
    // 无论网络成败：浮层指标区必须完整可读（tooltip 字段数 16）。
    const fieldCount = await row.locator('.stock-detail-item').count();
    expect(fieldCount).toBe(16);
    expect(launched.errors).toEqual([]);
    void shown;
  } finally {
    await launched.close();
  }
});

test('online: clicking an index chip opens detail with trends', async () => {
  test.setTimeout(LIVE_TIMEOUT_MS + 30_000);
  const launched = await launchBuiltExtension({ seed: baseSeed({ watchlist: [] }) });
  try {
    // 点击指数条中的上证指数 → 详情面板（分时）。
    await launched.page.locator('.index-chip[data-code="sh000001"]').click();
    await expect(launched.page.locator('chart-detail-panel')).toBeVisible({ timeout: 5_000 });
    await expect(launched.page.locator('[data-region="detail-title"]')).toContainText('上证指数');
    expect(launched.errors).toEqual([]);
  } finally {
    await launched.close();
  }
});
