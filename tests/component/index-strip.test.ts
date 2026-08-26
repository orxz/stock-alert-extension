// tests/component/index-strip.test.ts
// v2.1 固定指数条组件：骨架 / ViewModel 渲染 / 趋势着色 / 更新不重建。
import '../helpers/dom-environment.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { resetDom } from '../helpers/dom-environment.js';
import { definePopupElements } from '../../src/popup/components/define-elements.js';
import { IndexStripElement } from '../../src/popup/components/index-strip.js';
import { emptyIndexStrip, toIndexStrip } from '../../src/popup/view-models.js';
import type { IndexStripViewModel } from '../../src/popup/view-models.js';
import type { QuoteSnapshot, StockCode } from '../../src/domain/index.js';

function freshSnapshot(): QuoteSnapshot {
  return {
    results: {},
    counts: { fresh: 0, cached: 0, missing: 0 },
    attemptedAt: 0,
    succeededAt: null,
    generation: 0
  };
}

function withQuote(
  snapshot: QuoteSnapshot,
  code: string,
  quote: { price: number; changePercent: number; status?: 'fresh' | 'cached' }
): QuoteSnapshot {
  const status = quote.status ?? 'fresh';
  return {
    ...snapshot,
    results: {
      ...snapshot.results,
      [code]: {
        code: code as StockCode,
        status,
        source: status === 'fresh' ? 'eastmoney' : 'cache',
        provider: 'eastmoney',
        fetchedAt: 0,
        quote: {
          code: code as StockCode,
          name: code,
          price: quote.price,
          change: 0,
          changePercent: quote.changePercent,
          amount: 0
        },
        error: null
      }
    }
  };
}

function strip(): IndexStripElement {
  definePopupElements();
  const el = document.createElement('index-strip') as IndexStripElement;
  document.body.append(el);
  return el;
}

test('renders catalog skeleton with dashes before any quote arrives', () => {
  resetDom();
  const el = strip();
  el.viewModel = emptyIndexStrip();
  const chips = el.querySelectorAll('.index-chip');
  assert.equal(chips.length, 4, '目录四只指数恒渲染（含科创50）');
  assert.ok(el.textContent?.includes('上证指数'));
  assert.ok(el.textContent?.includes('深证成指'));
  assert.ok(el.textContent?.includes('创业板指'));
  assert.ok(el.textContent?.includes('科创50'), '科创板指数在目录中');
  for (const chip of chips) {
    assert.ok(chip.querySelector('.index-chip-price')?.textContent?.includes('--'));
  }
});

test('renders prices and percent with trend classes from snapshot', () => {
  resetDom();
  const el = strip();
  let snapshot = freshSnapshot();
  snapshot = withQuote(snapshot, 'sh000001', { price: 3901.33, changePercent: 0.31 });
  snapshot = withQuote(snapshot, 'sz399001', { price: 13769.35, changePercent: -0.2 });
  snapshot = withQuote(snapshot, 'sz399006', { price: 3400.53, changePercent: 0 });
  snapshot = withQuote(snapshot, 'sh000688', { price: 1607.54, changePercent: 0.18 });
  el.viewModel = toIndexStrip(snapshot);

  const chips = el.querySelectorAll('.index-chip');
  assert.equal(chips.length, 4);
  const [sh, sz, cyb, kc] = [...chips];
  assert.ok(sh.classList.contains('is-up'), '涨 → is-up');
  assert.equal(sh.querySelector('.index-chip-price')?.textContent, '3901.33');
  assert.equal(sh.querySelector('.index-chip-pct')?.textContent, '+0.31%');
  assert.ok(sz.classList.contains('is-down'), '跌 → is-down');
  assert.equal(sz.querySelector('.index-chip-pct')?.textContent, '-0.20%');
  assert.ok(cyb.classList.contains('is-flat'), '平 → is-flat');
  assert.equal(cyb.querySelector('.index-chip-pct')?.textContent, '0.00%');
  assert.ok(kc.classList.contains('is-up'), '科创50 涨 → is-up');
  assert.equal(kc.querySelector('.index-chip-price')?.textContent, '1607.54');
  assert.equal(kc.querySelector('.index-chip-pct')?.textContent, '+0.18%');
});

test('marks cached quotes with a stale label appended to the percent', () => {
  resetDom();
  const el = strip();
  let snapshot = freshSnapshot();
  snapshot = withQuote(snapshot, 'sh000001', { price: 3901.33, changePercent: 0.31, status: 'cached' });
  el.viewModel = toIndexStrip(snapshot);
  const pct = el.querySelector('.index-chip .index-chip-pct');
  assert.equal(pct?.textContent, '+0.31%·延迟');
});

test('updates in place without rebuilding chips', () => {
  resetDom();
  const el = strip();
  let snapshot = freshSnapshot();
  snapshot = withQuote(snapshot, 'sh000001', { price: 3900, changePercent: 0.1 });
  el.viewModel = toIndexStrip(snapshot);
  const first = el.querySelector('.index-chip');
  el.viewModel = toIndexStrip(withQuote(snapshot, 'sh000001', { price: 3910, changePercent: 0.5 }));
  const second = el.querySelector('.index-chip');
  assert.equal(first, second, '同一 chip 元素被复用（不打断读屏）');
  assert.equal(second.querySelector('.index-chip-price')?.textContent, '3910.00');
});

test('falls back to skeleton when viewModel is missing', () => {
  resetDom();
  const el = strip();
  el.viewModel = undefined;
  assert.equal(el.querySelectorAll('.index-chip').length, 4, '空 VM 渲染目录骨架');
  assert.ok(el.textContent?.includes('--'));
});

test('carries an accessible label per chip', () => {
  resetDom();
  const el = strip();
  let snapshot = freshSnapshot();
  snapshot = withQuote(snapshot, 'sh000001', { price: 3901.33, changePercent: 0.31 });
  el.viewModel = toIndexStrip(snapshot);
  const chip = el.querySelector('.index-chip');
  assert.equal(chip?.getAttribute('role'), 'button');
  assert.equal(chip?.getAttribute('tabindex'), '0');
  // 指数条只显示 点位+涨跌幅（v2.4：涨跌额已移除，保持简洁）。
  assert.equal(chip?.getAttribute('aria-label'), '上证指数 3901.33 +0.31%，点击查看分时与K线');
  assert.equal(el.getAttribute('role'), 'group');
});

test('click chip emits detail-open-request', () => {
  resetDom();
  const el = strip();
  let snapshot = freshSnapshot();
  snapshot = withQuote(snapshot, 'sh000001', { price: 3901.33, changePercent: 0.31 });
  el.viewModel = toIndexStrip(snapshot);
  let opened: { code: string; name: string } | null = null;
  el.addEventListener('detail-open-request', ((e: CustomEvent) => {
    opened = e.detail as { code: string; name: string };
  }) as EventListener);
  el.querySelector('.index-chip')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  assert.equal(opened?.code, 'sh000001');
  assert.equal(opened?.name, '上证指数');
});

test('chip renders name, price and pct with visible widths (layout regression guard)', () => {
  // 回归守护（v2.4.2）：4 只指数 2×2 网格下，点位/涨跌幅不得被挤出只剩名称。
  // 此前单行 flex + 迷你图固定 36px 时，数字 span 宽 0（ellipsis 截断为空）。
  resetDom();
  const el = strip();
  let snapshot = freshSnapshot();
  snapshot = withQuote(snapshot, 'sh000001', { price: 3912.31, changePercent: 0.59 });
  snapshot = withQuote(snapshot, 'sz399001', { price: 13833.9, changePercent: 0.64 });
  snapshot = withQuote(snapshot, 'sz399006', { price: 3415.96, changePercent: 0.54 });
  snapshot = withQuote(snapshot, 'sh000688', { price: 1630.82, changePercent: 1.63 });
  el.viewModel = toIndexStrip(snapshot);
  const chips = el.querySelectorAll('.index-chip');
  assert.equal(chips.length, 4);
  for (const chip of chips) {
    const price = chip.querySelector('.index-chip-price');
    const pct = chip.querySelector('.index-chip-pct');
    assert.ok(price?.textContent && price.textContent !== '--', '点位可见');
    assert.ok(pct?.textContent && pct.textContent !== '--', '涨跌幅可见');
    assert.ok(!chip.querySelector('.index-chip-change'), '涨跌额已移除（v2.4.1）');
  }
});
