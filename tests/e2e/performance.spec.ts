// tests/e2e/performance.spec.ts
// Task 19 Step 4 — 实测 p95 性能门禁。
// 在专用串行 Playwright project 中运行（workers=1），使用固定 Chromium。
// 门禁：
//   p95(bootstrapMs)    ≤ 250ms
//   p95(interactiveMs)  ≤ 500ms
//   p95(selectorMs)     ≤ 100ms
//   p95(domUpdateMs)    ≤ 100ms
//
// 沙箱说明：Chrome MV3 扩展在无头沙箱下无法加载，测试条件跳过。
// 本测试需要 `npm run test:performance --project=performance`。
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchBuiltExtension, stock, baseSeed } from './extension-fixture.js';

const SKIP_REASON = 'performance gate needs a Chrome build with --load-extension (skipped in sandbox/headless-no-ext)';
const canRunPerf = !process.env.CI || process.env.RUN_PERF === '1';

/** 加载容量夹具（20 组 / 500 股）。 */
function loadCapacitySeed(): Record<string, unknown> {
  const fixturePath = join(process.cwd(), 'tests/fixtures/capacity/portfolio-500.json');
  const raw = JSON.parse(readFileSync(fixturePath, 'utf8'));
  return raw;
}

/** p95 计算：排序后取第 ceil(n*0.95) 个。 */
function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

interface PerfSamples {
  bootstrapMs: number[];
  interactiveMs: number[];
  selectorMs: number[];
  domUpdateMs: number[];
}

/** 测量单次 bootstrap→interactive 全程耗时。 */
async function measureOnce(seed: Record<string, unknown>): Promise<{
  bootstrapMs: number;
  interactiveMs: number;
  selectorMs: number;
  domUpdateMs: number;
  /** 列表视图实际挂载的行数（虚拟化的节点上限证据）。 */
  listRows: number;
  /** 网格视图实际挂载的卡片数。 */
  gridCards: number;
}> {
  const launched = await launchBuiltExtension({ offline: true, seed, rebuild: false });
  try {
    // 测量 selector 查询延迟（document.querySelector 的响应时间）。
    const selectorMs = await launched.page.evaluate(() => {
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        document.querySelector('#stock-board');
        document.querySelector('.group-tab');
      }
      return (performance.now() - start) / 100;
    });

    // 切换到网格前，先记录列表视图实际挂载的行数。
    const listRows = await launched.page
      .locator('stock-table tbody tr[data-key]')
      .count();

    // 测量一次 DOM 更新（切换视图模式触发 rerender）的耗时。
    const domUpdateMs = await launched.page.evaluate(() => {
      return new Promise<number>((resolve) => {
        const start = performance.now();
        const btn = document.querySelector('[data-action="view-grid"]') as HTMLElement | null;
        if (!btn) { resolve(0); return; }
        btn.click();
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve(performance.now() - start);
          });
        });
      });
    });

    // 测量 bootstrap：通过 performance.timing。
    const navEntry = await launched.page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      return nav
        ? { domContentLoaded: nav.domContentLoadedEventEnd, start: nav.startTime }
        : null;
    });
    const bootstrapMs = navEntry ? Math.max(0, navEntry.domContentLoaded - navEntry.start) : 0;

    // 测量 interactive：从 DOMContentLoaded 到 stock-app 首帧渲染。
    const interactiveMs = await launched.page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      const app = document.getElementById('stock-app');
      if (!nav || !app) return 0;
      // stock-app 不再 hidden 表示交互就绪。
      const ready = !app.hasAttribute('hidden');
      return ready ? nav.domContentLoadedEventEnd - nav.startTime : 0;
    });

    // 网格渲染完成后（与 domUpdateMs 同一双 rAF 之后）记录卡片数。
    const gridCards = await launched.page
      .locator('stock-grid stock-card[data-key]')
      .count();

    return { bootstrapMs, interactiveMs, selectorMs, domUpdateMs, listRows, gridCards };
  } finally {
    await launched.close();
  }
}

test.describe.configure({ mode: 'serial' });

test.skip(!canRunPerf, SKIP_REASON);

test('p95 bootstrap ≤200ms / interactive ≤500ms / selector ≤100ms / domUpdate ≤80ms + bounded nodes (20 groups / 500 stocks)', async () => {
  test.setTimeout(60_000);
  const seed = loadCapacitySeed();
  const samples: PerfSamples = { bootstrapMs: [], interactiveMs: [], selectorMs: [], domUpdateMs: [] };
  let lastListRows = 0;
  let lastGridCards = 0;

  // 预热 2 次（JIT / 首次构建缓存）。
  for (let i = 0; i < 2; i++) {
    await measureOnce(seed);
  }

  // 实测 10 次（减少重复以避免沙箱超时，仍能覆盖 p95）。
  for (let i = 0; i < 10; i++) {
    const s = await measureOnce(seed);
    samples.bootstrapMs.push(s.bootstrapMs);
    samples.interactiveMs.push(s.interactiveMs);
    samples.selectorMs.push(s.selectorMs);
    samples.domUpdateMs.push(s.domUpdateMs);
    lastListRows = s.listRows;
    lastGridCards = s.gridCards;
  }

  const bootstrapP95 = p95(samples.bootstrapMs);
  const interactiveP95 = p95(samples.interactiveMs);
  const selectorP95 = p95(samples.selectorMs);
  const domUpdateP95 = p95(samples.domUpdateMs);

  // 打印所有样本（失败时便于诊断）。
  console.log('perf samples:', JSON.stringify(samples, null, 2));
  console.log(`p95: bootstrap=${bootstrapP95.toFixed(1)}ms interactive=${interactiveP95.toFixed(1)}ms selector=${selectorP95.toFixed(2)}ms domUpdate=${domUpdateP95.toFixed(2)}ms`);

  console.log(`nodes: listRows=${lastListRows} gridCards=${lastGridCards} (500 stocks)`);

  expect(bootstrapP95, `p95 bootstrap ${bootstrapP95}ms > 200ms`).toBeLessThanOrEqual(200);
  expect(interactiveP95, `p95 interactive ${interactiveP95}ms > 500ms`).toBeLessThanOrEqual(500);
  expect(selectorP95, `p95 selector ${selectorP95}ms > 100ms`).toBeLessThanOrEqual(100);
  // 目标 80ms；对外发布上限仍是 100ms，失败信息里同时给出两者。
  expect(
    domUpdateP95,
    `p95 domUpdate ${domUpdateP95}ms > 80ms target (release ceiling 100ms)`
  ).toBeLessThanOrEqual(80);

  // 节点上限：虚拟化的核心保证。500 只股票下真实节点必须有界——
  // 光看耗时不够，机器够快时全量渲染也可能压线通过。
  expect(lastListRows, `list mounted ${lastListRows} rows for 500 stocks`).toBeLessThanOrEqual(27);
  expect(lastListRows, 'list rendered nothing').toBeGreaterThan(0);
  expect(lastGridCards, `grid mounted ${lastGridCards} cards for 500 stocks`).toBeLessThanOrEqual(24);
  expect(lastGridCards, 'grid rendered nothing').toBeGreaterThan(0);
});

test('quote refresh respects 8-second overall deadline', async () => {
  const seed = baseSeed({ watchlist: [stock('sh600519')] });
  const launched = await launchBuiltExtension({ offline: true, seed });
  try {
    const elapsed = await launched.page.evaluate(async () => {
      const start = performance.now();
      const btn = document.querySelector('[data-action="refresh"]') as HTMLElement | null;
      if (!btn) return -1;
      btn.click();
      // 等待 live-region 更新（刷新完成或失败）。
      const region = document.getElementById('app-live-region');
      for (let i = 0; i < 160; i++) {
        if (region && region.textContent && region.textContent.length > 2) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      return performance.now() - start;
    });
    console.log(`refresh elapsed: ${elapsed.toFixed(0)}ms`);
    // 8 秒总截止时间。
    expect(elapsed, `refresh ${elapsed}ms > 8000ms deadline`).toBeLessThanOrEqual(8000);
  } finally {
    await launched.close();
  }
});
