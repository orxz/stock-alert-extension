import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function canonical(value) {
  return JSON.stringify(value, (key, entry) => (
    entry && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(Object.keys(entry).sort().map((name) => [name, entry[name]]))
      : entry
  ));
}

async function seedStable(worker, values) {
  await worker.evaluate(async () => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const data = await chrome.storage.local.get('schemaVersion');
      if (data.schemaVersion === 2) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await worker.evaluate(async (nextValues) => {
      await chrome.storage.local.set(nextValues);
      const current = await chrome.storage.local.get(null);
      const staleKeys = Object.keys(current).filter((key) => !(key in nextValues));
      if (staleKeys.length) await chrome.storage.local.remove(staleKeys);
    }, values);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const current = await worker.evaluate(async () => chrome.storage.local.get(null));
    const matches = Object.entries(values).every(([key, value]) => (
      canonical(current[key]) === canonical(value)
    ));
    if (matches) return;
  }
  throw new Error('seed storage did not stabilize before popup load');
}

export async function seedStorage(worker, values) {
  await seedStable(worker, values);
}

export async function launchExtension({ seed = null, offline = false, onPageError = null } = {}) {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });
  if (offline) await context.setOffline(true);
  if (offline) {
    await context.route('https://push2.eastmoney.com/**', (route) => route.abort());
    await context.route('https://hq.sinajs.cn/**', (route) => route.abort());
    await context.route('https://searchapi.eastmoney.com/**', (route) => route.abort());
  }
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  if (seed) await seedStorage(worker, seed);
  const page = await context.newPage();
  if (onPageError) page.on('pageerror', onPageError);
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  return { context, page, worker, extensionId };
}

export async function replaceStorage(page, values) {
  await page.evaluate(async (nextValues) => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set(nextValues);
  }, values);
}
