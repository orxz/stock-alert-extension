// tests/e2e/groups.spec.ts
// Task 18 Step 4 — 分组生命周期完整测试。
// 每个流程后重开 Popup 检查 chrome.storage.local 确保持久化。
import { expect, test } from '@playwright/test';
import { launchBuiltExtension, GROUPS, stock, baseSeed, getStorage , gridBoardConfig, listBoardConfig } from './extension-fixture';

test('create a new custom group', async () => {
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed()
  });
  try {
    // v2 中创建分组需通过分组管理对话框（这里通过代码触发）。
    await launched.page.evaluate(() => {
      const el = document.querySelector('#stock-app');
      el?.dispatchEvent(new CustomEvent('dialog-open-request', { detail: { kind: 'create-group' }, bubbles: true }));
    });
    await expect(launched.page.locator('dialog')).toBeVisible();
    await launched.page.fill('input[data-field="name"]', '新能源');
    await launched.page.click('button[data-action="dialog-submit"]');
    // 对话框关闭后分组出现在 tablist 中。
    await expect(launched.page.locator('[role="tablist"]')).toContainText('新能源');
    // 持久化检查。
    const groups = await getStorage<Array<{ name: string }>>(launched.page, 'groups');
    expect(groups?.some((g) => g.name === '新能源')).toBe(true);
  } finally {
    await launched.close();
  }
});

test('rename a custom group', async () => {
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed({ watchlist: [stock('sh600519')] })
  });
  try {
    // 切换到 g_tech → 触发 rename-group 对话框。
    await launched.page.evaluate(() => {
      document.querySelectorAll('[role="tab"]').forEach((tab) => {
        if (tab.getAttribute('data-group-id') === 'g_tech') {
          (tab as HTMLElement).click();
        }
      });
    });
    await launched.page.waitForTimeout(200);
    await launched.page.evaluate(() => {
      const el = document.querySelector('#stock-app');
      el?.dispatchEvent(new CustomEvent('dialog-open-request', { detail: { kind: 'rename-group' }, bubbles: true }));
    });
    await expect(launched.page.locator('dialog')).toBeVisible();
    // 预填名称应存在。
    const nameInput = launched.page.locator('input[data-field="name"]');
    await expect(nameInput).toHaveValue(/.+/);
    // 修改名称。
    await nameInput.fill('科技股2');
    await launched.page.click('button[data-action="dialog-submit"]');
    // 持久化检查。
    await expect.poll(async () => {
      const groups = await getStorage<Array<{ name: string; groupId: string }>>(launched.page, 'groups');
      return groups?.find((g) => g.groupId === 'g_tech')?.name;
    }).toBe('科技股2');
  } finally {
    await launched.close();
  }
});

test('delete a custom group', async () => {
  const launched = await launchBuiltExtension({
    offline: true,
    // 该用例断言回退到「全部」后表格里能看到那只股票——显式声明列表视图。
    seed: baseSeed({ watchlist: [stock('sh600519')], boardConfig: listBoardConfig() })
  });
  try {
    // 切换到 g_tech → 触发 rename-group 对话框（包含删除按钮）。
    await launched.page.evaluate(() => {
      document.querySelectorAll('[role="tab"]').forEach((tab) => {
        if (tab.getAttribute('data-group-id') === 'g_tech') {
          (tab as HTMLElement).click();
        }
      });
    });
    await launched.page.waitForTimeout(200);
    await launched.page.evaluate(() => {
      const el = document.querySelector('#stock-app');
      el?.dispatchEvent(new CustomEvent('dialog-open-request', { detail: { kind: 'rename-group' }, bubbles: true }));
    });
    await expect(launched.page.locator('dialog')).toBeVisible();
    const deleteBtn = launched.page.locator('button[data-action="dialog-delete-group"]');
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();
    // g_tech 应从 storage 中移除。
    await expect.poll(async () => {
      const groups = await getStorage<Array<{ groupId: string }>>(launched.page, 'groups');
      return groups?.some((g) => g.groupId === 'g_tech');
    }).toBe(false);
    // 删除的是当前激活分组——应自动回退到「全部」视图：
    // 全部标签高亮，且列表显示全部股票（sh600519 原属于被删分组，删除后归入全部）。
    await expect(launched.page.locator('[role="tab"][data-group-id="g_all"]')).toHaveAttribute('aria-selected', 'true');
    await expect(launched.page.locator('tbody tr[data-key="sh600519"]')).toBeVisible();
  } finally {
    await launched.close();
  }
});

test('move stock to another group', async () => {
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed({ watchlist: [stock('sh600519')] , boardConfig: gridBoardConfig() })
  });
  try {
    // 选中股票 → 批量移动。
    await launched.page.evaluate(() => {
      const el = document.querySelector('#stock-app');
      el?.dispatchEvent(new CustomEvent('selection-mode-change', { detail: { enabled: true }, bubbles: true }));
    });
    await launched.page.waitForTimeout(200);
    // 选中卡片（通过 article click 避免 Playwright actionability 超时）。
    await launched.page.evaluate(() => {
      const card = document.querySelector('stock-card');
      card?.querySelector('article')?.click();
    });
    await launched.page.waitForTimeout(200);
    // 打开移动对话框。
    await launched.page.evaluate(() => {
      const el = document.querySelector('#stock-app');
      el?.dispatchEvent(new CustomEvent('dialog-open-request', { detail: { kind: 'move-stocks' }, bubbles: true }));
    });
    await expect(launched.page.locator('dialog')).toBeVisible();
    // 勾选 g_tech。
    const checkbox = launched.page.locator('input[type="checkbox"][data-group-id="g_tech"]');
    await checkbox.check();
    await launched.page.click('button[data-action="dialog-submit"]');
    // 股票应出现在 g_tech 的 groupIds 中。
    await expect.poll(async () => {
      const wl = await getStorage<Array<{ code: string; groupIds: string[] }>>(launched.page, 'watchlist');
      return wl?.[0]?.groupIds?.includes('g_tech');
    }).toBe(true);
  } finally {
    await launched.close();
  }
});
