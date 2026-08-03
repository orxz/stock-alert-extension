import { expect, test } from '@playwright/test';
import { chromium } from 'playwright';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildExtension } from '../../scripts/build-extension.mjs';

const root = new URL('../../', import.meta.url);
const extensionPath = path.resolve(fileURLToPath(root), 'build/extension');

test('v2 shell background registers and popup renders without page errors', async () => {
  // 正式产物缺失时先执行一次正式构建，保证测试可独立运行。
  try {
    await access(new URL('build/extension/manifest.json', root));
  } catch {
    await buildExtension(root);
  }

  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });
  try {
    // Service Worker（background type=module）注册成功且加载无异常。
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
    expect(new URL(worker.url()).pathname).toBe('/runtime/background/main.js');
    expect(await worker.evaluate(() => chrome.runtime.getManifest().version)).toBe('2.0.0');

    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    const stockApp = page.locator('#stock-app');
    await expect(stockApp).toBeVisible();
    await expect(stockApp).toContainText('v2 架构升级中');
    await expect(page.locator('#fatal-fallback')).toBeHidden();
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  } finally {
    await context.close();
  }
});
