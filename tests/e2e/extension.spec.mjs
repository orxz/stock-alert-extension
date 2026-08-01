import { expect, test } from '@playwright/test';
import { launchExtension } from './extension-fixture.mjs';

const GROUPS = [
  { groupId: 'g_all', name: '全部', order: 0, isDefault: true },
  { groupId: 'g_tech', name: '科技', order: 1, isDefault: false }
];
const CODES = ['sh600519', 'sz000001', 'sz300750', 'sz002475', 'sh601899', 'sh601318', 'sz000858', 'sh600036', 'sh688981', 'bj920185'];

function stock(code, index = 0) {
  return { code, name: `股票${index}`, groupIds: index < 5 ? ['g_tech'] : [], manualOrder: { g_all: index }, pinned: {}, addedAt: 1000 + index };
}

function cache(code, fetchedAt, price = 10) {
  return {
    cacheVersion: 1,
    code,
    provider: 'eastmoney',
    fetchedAt,
    quote: { name: code, price, prevClose: 9, open: 9, high: 10, low: 9, volume: 1, amount: 1, change: 1, changePercent: 11.11 }
  };
}

test('stock added in a custom group remains visible in All', async () => {
  const { context, page } = await launchExtension({
    offline: true,
    seed: {
      schemaVersion: 2,
      groups: GROUPS,
      watchlist: [{
        code: 'sh600519',
        name: '贵州茅台',
        groupIds: ['g_tech'],
        manualOrder: {},
        pinned: {},
        addedAt: Date.now()
      }],
      boardConfig: {}
    }
  });
  try {
    await expect(page.locator('#tabs-scroll')).toContainText('全部');
    await expect(page.locator('#grid-view')).toContainText('贵州茅台');
  } finally {
    await context.close();
  }
});

test('mixed cache state is explicit per summary and stock', async () => {
  const now = Date.now();
  const cacheValues = Object.fromEntries(CODES.map((code, index) => [
    `quoteCache:${code}`,
    cache(code, now - (index < 8 ? 1000 : 600000))
  ]));
  const { context, page, releaseHold } = await launchExtension({
    offline: true,
    holdQuotes: true,
    seed: {
      schemaVersion: 2,
      groups: GROUPS,
      watchlist: CODES.map(stock),
      boardConfig: {},
      ...cacheValues
    }
  });
  try {
    // 行情请求被挂起，初始缓存渲染保持稳定，不受刷新失败时序影响
    await expect(page.locator('#quote-status-summary')).toHaveText('实时 8 · 缓存 2');
    await expect(page.locator('.quote-stale')).toHaveCount(2);
  } finally {
    releaseHold?.();
    await context.close();
  }
});

test('cached first stock makes Badge gray and Tooltip stale', async () => {
  const code = 'sh600519';
  const { context, page, worker } = await launchExtension({
    offline: true,
    seed: {
      schemaVersion: 2,
      groups: GROUPS,
      watchlist: [{ ...stock(code), pinned: { g_all: true } }],
      boardConfig: {},
      [`quoteCache:${code}`]: cache(code, Date.now() - 600000)
    }
  });
  await expect.poll(async () => worker.evaluate(async () => chrome.action.getTitle({}))).toContain('已过期');
  const badge = await worker.evaluate(async () => ({
    text: await chrome.action.getBadgeText({}),
    color: await chrome.action.getBadgeBackgroundColor({})
  }));
  expect(badge.text).toBe('11');
  expect(badge.color.slice(0, 3)).toEqual([149, 165, 166]);
  await context.close();
});

test('rapid duplicate add creates one stock', async () => {
  const { context, page } = await launchExtension({
    offline: true,
    seed: { schemaVersion: 2, groups: GROUPS, watchlist: [], boardConfig: {} }
  });
  await page.click('#btn-add-stock');
  await page.fill('#add-code', '600519');
  await page.fill('#add-name', '贵州茅台');
  await page.evaluate(() => {
    document.getElementById('add-confirm').click();
    document.getElementById('add-confirm').click();
  });
  await expect.poll(async () => page.evaluate(async () => (await chrome.storage.local.get('watchlist')).watchlist.length)).toBe(1);
  await context.close();
});

test('offline code search falls back to local suggestions without page error', async () => {
  const errors = [];
  const { context, page } = await launchExtension({
    offline: true,
    onPageError: (error) => errors.push(error.message),
    seed: { schemaVersion: 2, groups: GROUPS, watchlist: [], boardConfig: {} }
  });
  await page.click('#btn-add-stock');
  await page.fill('#add-code', '600519');
  await page.waitForTimeout(800);
  await expect(page.locator('#code-suggest')).toContainText('贵州茅台');
  expect(errors).toEqual([]);
  await context.close();
});

test('rapid view changes persist the final choice', async () => {
  const { context, page } = await launchExtension({
    offline: true,
    seed: { schemaVersion: 2, groups: GROUPS, watchlist: [], boardConfig: {} }
  });
  await page.evaluate(() => {
    document.getElementById('btn-view-list').click();
    document.getElementById('btn-view-grid').click();
    document.getElementById('btn-view-list').click();
  });
  await expect.poll(async () => page.evaluate(async () => (await chrome.storage.local.get('boardConfig')).boardConfig.g_all.viewMode)).toBe('list');
  await context.close();
});

test('corrupted cache renders missing without a page error', async () => {
  const errors = [];
  const { context, page } = await launchExtension({
    offline: true,
    onPageError: (error) => errors.push(error.message),
    seed: {
      schemaVersion: 2,
      groups: GROUPS,
      watchlist: [stock('sh600519')],
      boardConfig: {},
      'quoteCache:sh600519': { broken: true }
    }
  });
  await expect(page.locator('.grid-card-price')).toHaveText('--');
  expect(errors).toEqual([]);
  await context.close();
});

test('failed manual refresh keeps cached value', async () => {
  const code = 'sh600519';
  const { context, page } = await launchExtension({
    offline: true,
    seed: {
      schemaVersion: 2,
      groups: GROUPS,
      watchlist: [stock(code)],
      boardConfig: {},
      [`quoteCache:${code}`]: cache(code, Date.now() - 600000, 10)
    }
  });
  await expect(page.locator('.grid-card-price')).toHaveText('10.00');
  await page.click('#btn-refresh');
  await expect(page.locator('.grid-card-price')).toHaveText('10.00');
  await expect(page.locator('#toast')).toContainText('已保留缓存');
  await context.close();
});

test('failed manual refresh on a recent cache does not claim success', async () => {
  const code = 'sh600519';
  const { context, page } = await launchExtension({
    offline: true,
    seed: {
      schemaVersion: 2,
      groups: GROUPS,
      watchlist: [stock(code)],
      boardConfig: {},
      [`quoteCache:${code}`]: cache(code, Date.now() - 1000, 10)
    }
  });
  await expect(page.locator('.grid-card-price')).toHaveText('10.00');
  await page.click('#btn-refresh');
  await expect(page.locator('.grid-card-price')).toHaveText('10.00');
  await expect(page.locator('#toast')).toContainText('已保留缓存');
  await context.close();
});

test('tooltip does not claim no data when a later sorted stock has cache', async () => {
  const first = 'sh600519';
  const later = 'sz000001';
  const { context, worker } = await launchExtension({
    offline: true,
    seed: {
      schemaVersion: 2,
      groups: GROUPS,
      watchlist: [
        { ...stock(first), manualOrder: { g_all: 0 } },
        { ...stock(later, 1), manualOrder: { g_all: 1 } }
      ],
      boardConfig: { g_all: { sortField: 'manual', sortDirection: 'asc' } },
      [`quoteCache:${later}`]: cache(later, Date.now() - 600000)
    }
  });
  try {
    // 前 5 只缺失、第 6 只有缓存时，标题必须展示逐股状态而不是谎报「暂无可用行情」
    await expect.poll(async () => worker.evaluate(async () => chrome.action.getTitle({}))).toContain('暂无行情');
    const title = await worker.evaluate(async () => chrome.action.getTitle({}));
    expect(title).not.toContain('暂无可用行情');
  } finally {
    await context.close();
  }
});
