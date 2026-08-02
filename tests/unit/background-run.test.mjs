// tests/unit/background-run.test.mjs — 背景编排失败/恢复路径与三段可关联诊断
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createStorageArea } from '../helpers/chrome-mock.mjs';

const require = createRequire(import.meta.url);

// 先加载依赖模块（此时 chrome 未定义，storage.js 模块级单例为空），再注入全局依赖与 chrome mock
const { createStorage } = require('../../storage.js');
const QuoteService = require('../../quote-service.js');
const QuoteFormat = require('../../quote-format.js');
const StockUtils = require('../../stock-utils.js');

const listeners = { installed: [], startup: [], alarm: [], message: [], changed: [] };
const actions = [];
const alarms = [];

const area = createStorageArea({
  schemaVersion: 2,
  groups: [{ groupId: 'g_all', name: '全部', order: 0, isDefault: true }],
  watchlist: [{ code: 'sh600519', name: '贵州茅台', groupIds: [], manualOrder: {}, pinned: {}, addedAt: 1 }],
  boardConfig: {},
  'quoteCache:sh600519': {
    cacheVersion: 1,
    code: 'sh600519',
    provider: 'eastmoney',
    fetchedAt: Date.now() - 5000,
    quote: { name: '贵州茅台', price: 10, prevClose: 10, open: 10, high: 10, low: 10, volume: 1, amount: 1, change: 0, changePercent: -2.5 }
  }
});

global.chrome = {
  runtime: {
    onInstalled: { addListener: (fn) => listeners.installed.push(fn) },
    onStartup: { addListener: (fn) => listeners.startup.push(fn) },
    onMessage: { addListener: (fn) => listeners.message.push(fn) }
  },
  alarms: {
    onAlarm: { addListener: (fn) => listeners.alarm.push(fn) },
    async create(name, options) { alarms.push({ name, options }); }
  },
  action: {
    async setBadgeText(info) { actions.push(['badgeText', info]); },
    async setBadgeBackgroundColor(info) { actions.push(['badgeColor', info]); },
    async setTitle(info) { actions.push(['title', info]); }
  },
  storage: {
    local: area,
    onChanged: { addListener: (fn) => listeners.changed.push(fn) }
  }
};

let networkOk = false;
global.QuoteFormat = QuoteFormat;
global.QuoteService = QuoteService;
global.StockUtils = StockUtils;
global.DEFAULT_GROUP_ID = 'g_all';
global.Router = { init() {} };
global.createStorage = createStorage;
global.Quotes = {
  enrich: (value) => value,
  async fetchEastmoney() {
    if (!networkOk) throw new Error('aborted');
    return { sh600519: { name: '贵州茅台', price: 10, prevClose: 10, open: 10, high: 10, low: 10, volume: 1, amount: 1, change: 0, changePercent: -2.5 } };
  },
  async fetchSina() {
    if (!networkOk) throw new Error('sina HTTP 503');
    return {};
  }
};

const background = require('../../background.js');

async function waitFor(predicate, timeoutMs = 3000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timeout waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function captureConsole(record) {
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = (...args) => record.push(['log', args.join(' ')]);
  console.warn = (...args) => record.push(['warn', args.join(' ')]);
  return () => {
    console.log = originalLog;
    console.warn = originalWarn;
  };
}

function runIdOf(line) {
  const match = /\[bg\] run=(r-\d+-\d+)/.exec(line);
  return match ? match[1] : null;
}

function lastAction(kind) {
  return actions.filter(([entry]) => entry === kind).at(-1);
}

function restoreArea() {
  area.data.watchlist = [{ code: 'sh600519', name: '贵州茅台', groupIds: [], manualOrder: {}, pinned: {}, addedAt: 1 }];
  area.data['quoteCache:sh600519'] = {
    cacheVersion: 1,
    code: 'sh600519',
    provider: 'eastmoney',
    fetchedAt: Date.now() - 5000,
    quote: { name: '贵州茅台', price: 10, prevClose: 10, open: 10, high: 10, low: 10, volume: 1, amount: 1, change: 0, changePercent: -2.5 }
  };
}

test('alarm-triggered provider failure correlates trigger, boundary, and recovery output', async () => {
  const lines = [];
  const restore = captureConsole(lines);
  networkOk = false;
  try {
    listeners.alarm[0]({ name: 'quote-refresh' });
    await waitFor(() => lines.some(([, text]) => text.includes('type=run-end')));
  } finally {
    restore();
  }
  const bgLines = lines.map(([, text]) => text).filter((text) => text.startsWith('[bg]'));
  const start = bgLines.find((text) => text.includes('type=run-start'));
  const provider = bgLines.find((text) => text.includes('type=provider-failed provider=eastmoney'));
  const done = bgLines.find((text) => text.includes('type=refresh-done'));
  const end = bgLines.find((text) => text.includes('type=run-end'));
  // 三段共享同一 runId
  assert.ok(start && provider && done && end, 'trigger/boundary/recovery lines all present');
  const runIds = new Set([start, provider, done, end].map(runIdOf));
  assert.equal(runIds.size, 1, 'all three segments share one runId');
  // 触发段
  assert.match(start, /scope=trigger type=run-start trigger=alarm/);
  // 边界段：双源失败带错误分类
  assert.match(provider, /scope=quote-service type=provider-failed provider=eastmoney .*error=timeout/);
  assert.ok(bgLines.some((text) => text.includes('type=provider-failed provider=sina') && text.includes('error=http')));
  // 恢复段：回退缓存 + 退避计划 + 运行结果
  assert.match(done, /scope=quote-service type=refresh-done .*cached=1 missing=0/);
  assert.ok(bgLines.some((text) => text.includes('nextRetryAt=') && text.includes('failureCount=1')));
  assert.match(end, /scope=result type=run-end outcome=ok/);
  // badge 保持缓存数值（灰），未误报成功为红色数字
  assert.deepEqual(lastAction('badgeText'), ['badgeText', { text: '2.5' }]);
  assert.deepEqual(lastAction('badgeColor'), ['badgeColor', { color: '#95A5A6' }]);
  // 调度恢复：下一次 alarm 已重新排定
  assert.ok(alarms.length >= 1);
  assert.equal(alarms.at(-1).name, 'quote-refresh');
});

test('concurrent runs collapse into one run with an explicit retry trigger', async () => {
  const lines = [];
  const restore = captureConsole(lines);
  networkOk = false;
  try {
    await Promise.all([
      background.updateBadgeAndTitle('alarm'),
      background.updateBadgeAndTitle('storage-change')
    ]);
    // 等待主 run 与其自动 retry 全部结束（两个 run-end），避免 retry 泄漏到后续用例
    await waitFor(() => lines.filter(([, text]) => text.includes('type=run-end')).length >= 2);
  } finally {
    restore();
  }
  const bgLines = lines.map(([, text]) => text).filter((text) => text.startsWith('[bg]'));
  assert.ok(bgLines.some((text) => text.includes('type=run-start trigger=alarm')));
  assert.ok(bgLines.some((text) => text.includes('type=run-start trigger=retry')));
  // 第二次调用未发起独立 run-start（storage-change），被合并为 pending retry
  assert.ok(!bgLines.some((text) => text.includes('type=run-start trigger=storage-change')));
});

test('storage read failure emits a correlated diagnostic and degrades the badge', async () => {
  const lines = [];
  const restore = captureConsole(lines);
  const originalGet = area.get.bind(area);
  let getCalls = 0;
  area.get = async (keys) => {
    getCalls += 1;
    if (getCalls > 1) throw new Error('read denied');
    return originalGet(keys);
  };
  try {
    await background.updateBadgeAndTitle('alarm');
    await waitFor(() => lines.some(([, text]) => text.includes('type=run-end')));
  } finally {
    area.get = originalGet;
    restore();
  }
  const bgLines = lines.map(([, text]) => text).filter((text) => text.startsWith('[bg]'));
  const start = bgLines.find((text) => text.includes('type=run-start'));
  const storageLine = bgLines.find((text) => text.includes('scope=storage type=cache-read-failed'));
  const end = bgLines.find((text) => text.includes('type=run-end'));
  assert.ok(start && storageLine && end);
  assert.match(storageLine, /scope=storage type=cache-read-failed/);
  assert.ok(storageLine.includes('codes=sh600519') && storageLine.includes('error=read denied'));
  assert.equal(runIdOf(storageLine), runIdOf(start), 'storage boundary shares the runId');
  assert.match(end, /scope=result type=run-end outcome=failed/);
  // badge/tooltip 降级行为不变
  assert.deepEqual(lastAction('badgeText'), ['badgeText', { text: '--' }]);
  assert.deepEqual(lastAction('badgeColor'), ['badgeColor', { color: '#95A5A6' }]);
  assert.ok(actions.some(([kind, info]) => kind === 'title' && String(info.title).includes('暂无可用行情')));
  assert.equal(alarms.at(-1).name, 'quote-refresh');
  restoreArea();
});

test('empty watchlist run reports ok without touching the badge', async () => {
  const lines = [];
  const restore = captureConsole(lines);
  area.data.watchlist = [];
  try {
    listeners.installed[0]();
    await waitFor(() => lines.some(([, text]) => text.includes('type=run-end')));
  } finally {
    restore();
  }
  const bgLines = lines.map(([, text]) => text).filter((text) => text.startsWith('[bg]'));
  assert.ok(bgLines.some((text) => text.includes('type=run-start trigger=installed')));
  assert.ok(bgLines.some((text) => text.includes('type=run-end outcome=ok')));
  assert.deepEqual(lastAction('badgeText'), ['badgeText', { text: '' }]);
  restoreArea();
});
