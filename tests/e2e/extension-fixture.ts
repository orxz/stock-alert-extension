// tests/e2e/extension-fixture.ts
// Task 18 Step 1 — 正式构建扩展 + MV3 持久上下文 E2E fixture。
// 每次测试先 buildExtension()，再用临时 profile 加载 build/extension/。
// Teardown 关闭上下文并删除精确的临时 profile 目录。
// 捕获 pageerror / console.error / unhandledrejection 作为测试失败证据。
import { chromium, type BrowserContext, type Page, type Worker } from 'playwright';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';

const exec = promisify(execFile);

// Playwright 在 CommonJS 上下文中运行测试；使用 process.cwd() 定位仓库根目录。
const repoPath = path.resolve(process.cwd());
const extensionPath = path.join(repoPath, 'build/extension');

/** 确保扩展已构建（避免每次测试重复构建）。 */
let buildPromise: Promise<void> | null = null;
async function ensureBuilt(): Promise<void> {
  if (!buildPromise) {
    buildPromise = (async () => {
      try {
        await access(path.join(extensionPath, 'manifest.json'));
      } catch {
        await exec('node', ['scripts/build-extension.mjs'], { cwd: repoPath });
      }
    })();
  }
  return buildPromise;
}

/**
 * 等待 background SW 初始化完成（schemaVersion 出现表示 migration 完成）。
 * 然后额外等待确保 reconcileOrphanQuoteCache 等后续步骤完成。
 */
async function waitForInitialization(worker: Worker): Promise<void> {
  await worker.evaluate(async () => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const data = await chrome.storage.local.get('schemaVersion');
      if (data.schemaVersion === 2) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Background initialization timeout (6s)');
  });
  // 额外等待 coordinator 的串行队列完成（reconcileOrphanQuoteCache 等）。
  await new Promise((resolve) => setTimeout(resolve, 500));
}

/**
 * 在 SW 初始化完成后写入 seed 数据。
 * 不使用 clear()——那会删除 schemaVersion 并触发重新 migration 覆盖 seed。
 * 只删除不在 seed 中的旧 key，然后 set 覆盖。
 */
async function seedExtensionStorage(worker: Worker, values: Record<string, unknown>): Promise<void> {
  await waitForInitialization(worker);
  // 写入 seed 数据：先删除不在 seed 中的 USER_DATA key + 旧 quoteCache，再 set。
  await worker.evaluate(async (nextValues) => {
    const all = await chrome.storage.local.get(null);
    const oldKeys = Object.keys(all);
    const seedKeys = new Set(Object.keys(nextValues));
    const toRemove = oldKeys.filter((k) => !seedKeys.has(k));
    if (toRemove.length > 0) {
      await chrome.storage.local.remove(toRemove);
    }
    await chrome.storage.local.set(nextValues);
  }, values);
  // 等待写入稳定 + chrome.storage.onChanged 传播。
  await new Promise((resolve) => setTimeout(resolve, 300));
}

/**
 * 离线用例需要拦截的全部行情/搜索域名。
 * 与 `extension/manifest.json` 的 host_permissions 一一对应（外加 push2 的重定向目标）。
 */
const QUOTE_HOST_PATTERNS = [
  'https://push2.eastmoney.com/**',
  'https://push2delay.eastmoney.com/**',
  'https://searchapi.eastmoney.com/**',
  'https://qt.gtimg.cn/**'
] as const;

export interface LaunchOptions {
  /** 初始 chrome.storage.local 数据（seed 后再打开 popup）。 */
  seed?: Record<string, unknown> | null;
  /** 离线模式（阻断行情/搜索 API）。 */
  offline?: boolean;
  /** 离线模式下挂起行情请求（保持初始缓存渲染稳定）。 */
  holdQuotes?: boolean;
  /** 强制重新构建扩展（忽略缓存）。 */
  rebuild?: boolean;
}

export interface LaunchedExtension {
  context: BrowserContext;
  worker: Worker;
  page: Page;
  extensionId: string;
  userDataDir: string;
  releaseHold?: (() => void) | null;
  errors: string[];
  consoleErrors: string[];
  close: () => Promise<void>;
}

export async function launchBuiltExtension(options: LaunchOptions = {}): Promise<LaunchedExtension> {
  const { seed = null, offline = false, holdQuotes = false, rebuild = false } = options;

  if (rebuild) {
    buildPromise = null;
  }
  await ensureBuilt();

  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'stock-alert-v2-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: process.env.CI === 'true' || false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  const errors: string[] = [];
  const consoleErrors: string[] = [];

  // 捕获未处理拒绝。
  context.on('weberror', (err) => errors.push(err.message));

  let releaseHold: (() => void) | null = null;
  if (offline) {
    await context.setOffline(true);
    // 必须与 manifest host_permissions 中的数据源保持同步——漏掉任何一个域名，
    // 「离线」用例都会悄悄打到真实网络、拿到真行情，从而断言错误的结论。
    // push2delay 是 push2 的 302 目标：主请求被 abort 时不会产生它，
    // 但仍显式拦截以防上游改成直连。
    const routeOrHold = holdQuotes
      ? (() => {
          const holdGate = new Promise<void>((resolve) => { releaseHold = resolve; });
          return (route: { abort: () => Promise<void> }) =>
            holdGate.then(() => route.abort()).catch(() => {});
        })()
      : (route: { abort: () => Promise<void> }) => route.abort();

    for (const pattern of QUOTE_HOST_PATTERNS) {
      await context.route(pattern, routeOrHold);
    }
  }

  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = new URL(worker.url()).host;

  if (seed) {
    await seedExtensionStorage(worker, seed);
  }

  const page = await context.newPage();
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  const close = async () => {
    await context.close().catch(() => {});
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  };

  return { context, worker, page, extensionId, userDataDir, releaseHold, errors, consoleErrors, close };
}

/** 在 popup 页面中替换 storage（用于测试冲突恢复场景）。 */
export async function replaceStorage(page: Page, values: Record<string, unknown>): Promise<void> {
  await page.evaluate(async (nextValues) => {
    const all = await chrome.storage.local.get(null);
    const oldKeys = Object.keys(all);
    const seedKeys = new Set(Object.keys(nextValues));
    const toRemove = oldKeys.filter((k) => !seedKeys.has(k));
    if (toRemove.length > 0) {
      await chrome.storage.local.remove(toRemove);
    }
    await chrome.storage.local.set(nextValues);
  }, values);
}

/** 读取 chrome.storage.local 的指定 key。 */
export async function getStorage<T = unknown>(page: Page, key: string): Promise<T | undefined> {
  return page.evaluate(async (k) => {
    const result = await chrome.storage.local.get(k);
    return result[k];
  }, key);
}

/** 读取 chrome.storage.local 全部数据。 */
export async function getAllStorage(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(async () => chrome.storage.local.get(null));
}

// ===== 测试数据工厂 =====

export const GROUPS = [
  { groupId: 'g_all', name: '全部', order: 0, isDefault: true, createdAt: 0, updatedAt: 0 },
  { groupId: 'g_tech', name: '科技', order: 1, isDefault: false, createdAt: 0, updatedAt: 0 }
];

export const CODES = [
  'sh600519', 'sz000001', 'sz300750', 'sz002475', 'sh601899',
  'sh601318', 'sz000858', 'sh600036', 'sh688981', 'bj920185'
];

export function stock(code: string, index = 0) {
  return {
    code,
    name: `股票${index}`,
    groupIds: index < 5 ? ['g_tech'] : [],
    manualOrder: { g_all: index },
    pinned: {} as Record<string, boolean>,
    addedAt: 1000 + index
  };
}

export function cache(code: string, fetchedAt: number, price = 10) {
  return {
    cacheVersion: 1,
    code,
    provider: 'eastmoney',
    fetchedAt,
    quote: {
      name: code,
      price,
      prevClose: 9,
      open: 9,
      high: 10,
      low: 9,
      volume: 1,
      amount: 1,
      change: 1,
      changePercent: 11.11
    }
  };
}

export function baseSeed(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 2,
    groups: GROUPS,
    watchlist: [] as unknown[],
    boardConfig: {},
    ...overrides
  };
}

/**
 * 以网格视图打开看板的 boardConfig。
 *
 * 用于断言 `stock-card` 行为的用例：看板现在**只挂载激活视图**，
 * 非激活视图根本不在 DOM 里。此前两个视图都常驻（靠 hidden 隐藏），
 * 这类用例其实一直在对着不可见的节点做断言。
 */
export function gridBoardConfig(): Record<string, unknown> {
  return {
    g_all: { viewMode: 'grid', sortField: 'manual', sortDirection: 'asc', priceHidden: false }
  };
}
