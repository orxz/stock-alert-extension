// tests/e2e/portfolio.spec.ts
// Task 18 Step 3 — 移植 16 个 v1.3 冻结用户流程场景，使用 v2 组件选择器。
// 选择器映射：stock-header [data-action] → 按钮；stock-card → 卡片；#stock-board → 看板。
import { expect, test } from '@playwright/test';
import { launchBuiltExtension, GROUPS, CODES, stock, cache, baseSeed, getStorage } from './extension-fixture';

test('stock added in a custom group remains visible in All', async () => {
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed({
      watchlist: [{
        code: 'sh600519',
        name: '贵州茅台',
        groupIds: ['g_tech'],
        manualOrder: {},
        pinned: {},
        addedAt: Date.now()
      }]
    })
  });
  try {
    await expect(launched.page.locator('#group-tabs')).toContainText('全部');
    await expect(launched.page.locator('#stock-board')).toContainText('贵州茅台');
  } finally {
    await launched.close();
  }
});

test('mixed cache state is explicit per summary and stock', async () => {
  const now = Date.now();
  const cacheValues = Object.fromEntries(
    CODES.map((code, index) => [`quoteCache:${code}`, cache(code, now - (index < 8 ? 1000 : 600000))])
  );
  const launched = await launchBuiltExtension({
    offline: true,
    holdQuotes: true,
    seed: baseSeed({
      watchlist: CODES.map(stock),
      ...cacheValues
    })
  });
  try {
    // 行情请求被挂起，初始缓存渲染保持稳定。
    await expect(launched.page.locator('#quote-status-summary')).toContainText('实时 8');
    await expect(launched.page.locator('#quote-status-summary')).toContainText('缓存 2');
    await expect(launched.page.locator('.stock-card-stale')).toHaveCount(2);
  } finally {
    launched.releaseHold?.();
    await launched.close();
  }
});

test('cached first stock makes Badge gray and Tooltip stale', async () => {
  const code = 'sh600519';
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed({
      watchlist: [{ ...stock(code), pinned: { g_all: true } }],
      [`quoteCache:${code}`]: cache(code, Date.now() - 600000)
    })
  });
  try {
    await expect.poll(async () =>
      launched.worker.evaluate(async () => chrome.action.getTitle({}))
    ).toContain('已过期');
    const badge = await launched.worker.evaluate(async () => ({
      text: await chrome.action.getBadgeText({}),
      color: await chrome.action.getBadgeBackgroundColor({})
    }));
    expect(badge.text).toBe('11');
    expect(badge.color.slice(0, 3)).toEqual([149, 165, 166]);
  } finally {
    await launched.close();
  }
});

test('rapid duplicate add creates one stock', async () => {
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed()
  });
  try {
    // 点击添加股票按钮 → 打开对话框
    await launched.page.click('stock-header [data-action="add-stock"]');
    await expect(launched.page.locator('dialog')).toBeVisible();
    // 填写 code/name
    await launched.page.fill('input[data-field="code"]', 'sh600519');
    await launched.page.fill('input[data-field="name"]', '贵州茅台');
    // 快速点击两次提交
    await launched.page.evaluate(() => {
      document.querySelector('button[data-action="dialog-submit"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      document.querySelector('button[data-action="dialog-submit"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await expect.poll(async () => {
      const wl = await getStorage<{ length: number } | unknown[]>(launched.page, 'watchlist');
      return Array.isArray(wl) ? wl.length : 0;
    }).toBe(1);
  } finally {
    await launched.close();
  }
});

test('offline code search falls back to local suggestions without page error', async () => {
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed()
  });
  try {
    await launched.page.click('stock-header [data-action="add-stock"]');
    await launched.page.fill('input[data-action="combobox-input"]', '600519');
    await launched.page.waitForTimeout(800);
    await expect(launched.page.locator('[role="option"]')).toContainText('贵州茅台');
    expect(launched.errors).toEqual([]);
  } finally {
    await launched.close();
  }
});

test('rapid view changes persist the final choice', async () => {
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed()
  });
  try {
    await launched.page.evaluate(() => {
      document.querySelector('[data-action="view-list"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      document.querySelector('[data-action="view-grid"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      document.querySelector('[data-action="view-list"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await expect.poll(async () => {
      const cfg = await getStorage<{ g_all?: { viewMode?: string } }>(launched.page, 'boardConfig');
      return cfg?.g_all?.viewMode;
    }).toBe('list');
  } finally {
    await launched.close();
  }
});

test('corrupted cache renders missing without a page error', async () => {
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed({
      watchlist: [stock('sh600519')],
      'quoteCache:sh600519': { broken: true }
    })
  });
  try {
    await expect(launched.page.locator('.stock-card-price')).toContainText('--');
    expect(launched.errors).toEqual([]);
  } finally {
    await launched.close();
  }
});

test('failed manual refresh keeps cached value', async () => {
  const code = 'sh600519';
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed({
      watchlist: [stock(code)],
      [`quoteCache:${code}`]: cache(code, Date.now() - 600000, 10)
    })
  });
  try {
    await expect(launched.page.locator('.stock-card-price')).toContainText('10.00');
    await launched.page.click('[data-action="refresh"]');
    await expect(launched.page.locator('.stock-card-price')).toContainText('10.00');
    await expect(launched.page.locator('#app-live-region')).toContainText('已保留缓存');
  } finally {
    await launched.close();
  }
});

test('failed manual refresh on a recent cache does not claim success', async () => {
  const code = 'sh600519';
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed({
      watchlist: [stock(code)],
      [`quoteCache:${code}`]: cache(code, Date.now() - 1000, 10)
    })
  });
  try {
    await expect(launched.page.locator('.stock-card-price')).toContainText('10.00');
    await launched.page.click('[data-action="refresh"]');
    await expect(launched.page.locator('.stock-card-price')).toContainText('10.00');
    await expect(launched.page.locator('#app-live-region')).toContainText('已保留缓存');
  } finally {
    await launched.close();
  }
});

test('tooltip does not claim no data when a later sorted stock has cache', async () => {
  const first = 'sh600519';
  const later = 'sz000001';
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed({
      watchlist: [
        { ...stock(first), manualOrder: { g_all: 0 } },
        { ...stock(later, 1), manualOrder: { g_all: 1 } }
      ],
      boardConfig: { g_all: { sortField: 'manual', sortDirection: 'asc' } },
      [`quoteCache:${later}`]: cache(later, Date.now() - 600000)
    })
  });
  try {
    await expect.poll(async () =>
      launched.worker.evaluate(async () => chrome.action.getTitle({}))
    ).toContain('暂无行情');
    const title = await launched.worker.evaluate(async () => chrome.action.getTitle({}));
    expect(title).not.toContain('暂无可用行情');
  } finally {
    await launched.close();
  }
});

test('keyboard ArrowRight moves focus between group tabs and switches group', async () => {
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed({ watchlist: [stock('sh600519')] })
  });
  try {
    const activeTab = launched.page.locator('.group-tab[tabindex="0"]');
    await expect(activeTab).toHaveAttribute('role', 'tab');
    await expect(activeTab).toHaveAttribute('aria-selected', 'true');
    await activeTab.focus();
    await launched.page.keyboard.press('ArrowRight');
    await expect(launched.page.locator('.group-tab.is-active')).toHaveAttribute('data-group-id', 'g_tech');
    await expect(launched.page.locator('.group-tab.is-active')).toHaveAttribute('aria-selected', 'true');
    const focusedRole = await launched.page.evaluate(() => document.activeElement?.getAttribute('role'));
    expect(focusedRole).toBe('tab');
    const focusedGroupId = await launched.page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.groupId);
    expect(focusedGroupId).toBe('g_tech');
  } finally {
    await launched.close();
  }
});

test('keyboard Enter toggles pin on the focused stock card', async () => {
  const code = 'sh600519';
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed({ watchlist: [stock(code)] })
  });
  try {
    // 使用 evaluate 直接触发 keydown（Playwright focus 在自定义元素上可能不稳定）。
    await launched.page.evaluate((c) => {
      const card = document.querySelector(`stock-card[data-key="${c}"]`);
      if (!card) return;
      card.focus();
      card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }, code);
    await expect.poll(async () => {
      const wl = await getStorage<Array<{ code: string; pinned: Record<string, boolean> }>>(launched.page, 'watchlist');
      return wl?.[0]?.pinned?.g_all;
    }).toBe(true);
  } finally {
    await launched.close();
  }
});

test('ARIA landmark roles are present on key elements', async () => {
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed()
  });
  try {
    await expect(launched.page.locator('#group-tabs [role="tablist"]')).toHaveCount(1);
    await expect(launched.page.locator('#stock-board[role="region"]')).toHaveCount(1);
    await expect(launched.page.locator('#quote-status-summary [role="status"], #quote-status-summary[role="status"], .quote-status [role="status"]')).toHaveCount(1, { timeout: 5000 });
    await expect(launched.page.locator('#fatal-fallback[role="alert"]')).toHaveCount(1);
  } finally {
    await launched.close();
  }
});

test('icon buttons have accessible aria-labels', async () => {
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed()
  });
  try {
    for (const selector of [
      '[data-action="add-stock"]',
      '[data-action="refresh"]',
      '[data-action="multiselect"]',
      '[data-action="price-visibility"]'
    ]) {
      const label = await launched.page.locator(selector).first().getAttribute('aria-label');
      expect(label).toBeTruthy();
      expect(label!.length).toBeGreaterThan(2);
    }
  } finally {
    await launched.close();
  }
});

test('CSS design tokens are defined on :root', async () => {
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed()
  });
  try {
    const tokens = await launched.page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return {
        up: style.getPropertyValue('--color-up').trim(),
        down: style.getPropertyValue('--color-down').trim(),
        secondary: style.getPropertyValue('--text-secondary').trim(),
        touchTarget: style.getPropertyValue('--touch-target-min').trim()
      };
    });
    expect(tokens.up).toBeTruthy();
    expect(tokens.down).toBeTruthy();
    expect(tokens.secondary).toBeTruthy();
    expect(tokens.touchTarget).toBe('44px');
  } finally {
    await launched.close();
  }
});

test('group tab has correct roving tabindex', async () => {
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed({ watchlist: [stock('sh600519', 0)] })
  });
  try {
    const tabs = launched.page.locator('[role="tab"]');
    const count = await tabs.count();
    expect(count).toBeGreaterThanOrEqual(2);
    let activeFound = false;
    for (let i = 0; i < count; i++) {
      const tabIndex = await tabs.nth(i).getAttribute('tabindex');
      const selected = await tabs.nth(i).getAttribute('aria-selected');
      if (selected === 'true') {
        expect(tabIndex).toBe('0');
        activeFound = true;
      } else {
        expect(tabIndex).toBe('-1');
      }
    }
    expect(activeFound).toBe(true);
  } finally {
    await launched.close();
  }
});
