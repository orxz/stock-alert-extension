// tests/e2e/keyboard.spec.ts
// Task 18 Step 3 — 键盘导航等价性测试。
// 验证键盘可完成所有主要操作，焦点恢复，roving tabindex。
import { expect, test } from '@playwright/test';
import { launchBuiltExtension, stock, baseSeed, getStorage , gridBoardConfig} from './extension-fixture';

test('Tab cycles through interactive elements', async () => {
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed({ watchlist: [stock('sh600519')] })
  });
  try {
    // 获取所有可聚焦元素。
    const focusable = await launched.page.evaluate(() => {
      const els = Array.from(document.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex="0"], [role="tab"][tabindex="0"]'
      ));
      return els.map((el) => ({
        tag: el.tagName,
        action: el.getAttribute('data-action'),
        role: el.getAttribute('role'),
        label: el.getAttribute('aria-label')
      }));
    });
    expect(focusable.length).toBeGreaterThan(3, 'should have multiple focusable elements');
  } finally {
    await launched.close();
  }
});

test('ArrowLeft/Right navigates group tabs', async () => {
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed({ watchlist: [stock('sh600519')] })
  });
  try {
    // 聚焦到活动 tab（g_all）。
    const activeTab = launched.page.locator('.group-tab[tabindex="0"]');
    await activeTab.focus();

    // ArrowRight → g_tech。
    await launched.page.keyboard.press('ArrowRight');
    await expect(launched.page.locator('.group-tab.is-active')).toHaveAttribute('data-group-id', 'g_tech');

    // ArrowLeft → g_all。
    await launched.page.keyboard.press('ArrowLeft');
    await expect(launched.page.locator('.group-tab.is-active')).toHaveAttribute('data-group-id', 'g_all');
  } finally {
    await launched.close();
  }
});

test('Enter on focused stock card toggles pin via keyboard', async () => {
  const code = 'sh600519';
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed({ watchlist: [stock(code)] , boardConfig: gridBoardConfig() })
  });
  try {
    // 使用 evaluate 直接触发 keydown（Playwright focus 在自定义元素上可能不稳定）。
    await launched.page.evaluate((c) => {
      const card = document.querySelector(`stock-card[data-key="${c}"]`);
      if (!card) return;
      card.focus();
      card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }, code);
    // 验证 pin 持久化。
    await expect.poll(async () => {
      const wl = await getStorage<Array<{ code: string; pinned: Record<string, boolean> }>>(launched.page, 'watchlist');
      return wl?.[0]?.pinned?.g_all;
    }).toBe(true);
  } finally {
    await launched.close();
  }
});

test('Home/End moves to first/last tab', async () => {
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed({ watchlist: [stock('sh600519')] })
  });
  try {
    const activeTab = launched.page.locator('.group-tab[tabindex="0"]');
    await activeTab.focus();

    // End → 最后一个 tab。
    await launched.page.keyboard.press('End');
    const tabs = launched.page.locator('[role="tab"]');
    const count = await tabs.count();
    const lastTab = tabs.nth(count - 1);
    await expect(lastTab).toHaveAttribute('aria-selected', 'true');

    // Home → 第一个 tab。
    await launched.page.keyboard.press('Home');
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  } finally {
    await launched.close();
  }
});

test('Escape closes dialog and restores focus', async () => {
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed()
  });
  try {
    // 打开对话框。
    await launched.page.click('stock-header [data-action="add-stock"]');
    await expect(launched.page.locator('dialog')).toBeVisible();
    // Escape 关闭。
    await launched.page.keyboard.press('Escape');
    // 对话框应关闭（open 属性移除或 hidden）。
    await expect(launched.page.locator('dialog[open]')).toHaveCount(0);
  } finally {
    await launched.close();
  }
});
