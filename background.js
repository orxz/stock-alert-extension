// background.js — 缓存感知的 Badge / Tooltip 与自适应后台调度

if (typeof importScripts === 'function') {
  importScripts('stock-utils.js', 'storage.js', 'quotes.js', 'quote-service.js', 'quote-format.js', 'router.js');
}

const ALARM_NAME = 'quote-refresh';
const TOOLTIP_MAX = 5;

function formatBadge(percent) {
  return QuoteFormat.formatBadge(percent);
}

function formatBadgeState(_stock, result) {
  return QuoteFormat.formatBadgeState(result);
}

function formatTooltipLine(stock, result) {
  return QuoteFormat.formatTooltipLine(stock, result);
}

// 非行情排序只网络刷新 Tooltip 窗口，但缓存读取覆盖全部，避免误报「暂无可用行情」
function planQuoteRequests(stocks, field) {
  const codes = stocks.map((stock) => stock.code);
  const needsFullQuotes = !['manual', 'addedAt', 'name'].includes(field);
  return {
    needsFullQuotes,
    readCodes: codes,
    refreshCodes: needsFullQuotes ? codes : codes.slice(0, TOOLTIP_MAX)
  };
}

let backgroundStorage = null;
let backgroundQuoteService = null;
let updating = false;
let pending = false;

// ===== 失败链路诊断：触发/边界/恢复三段共享 runId =====
let diagnosticCounter = 0;
let activeRun = null;

function nextRunId() {
  diagnosticCounter += 1;
  return `r-${Date.now()}-${diagnosticCounter}`;
}

function activeRunId() {
  return activeRun ? activeRun.id : 'r-?';
}

function emitDiagnostic(runId, scope, event) {
  const fields = [];
  for (const [key, value] of Object.entries(event)) {
    if (key === 'type' || value === null || value === undefined) continue;
    if (key === 'counts' && typeof value === 'object') {
      for (const [name, count] of Object.entries(value)) fields.push(`${name}=${count}`);
      continue;
    }
    fields.push(`${key}=${value}`);
  }
  const line = `[bg] run=${runId} scope=${scope} type=${event.type} ${fields.join(' ')}`;
  if (event.error) console.warn(line);
  else console.log(line);
}

function getBackgroundStorage() {
  if (!backgroundStorage) {
    backgroundStorage = createStorage({
      area: chrome.storage.local,
      onDiagnostic: (event) => emitDiagnostic(activeRunId(), 'storage', event)
    });
  }
  return backgroundStorage;
}

function getBackgroundQuoteService() {
  if (!backgroundQuoteService) {
    backgroundQuoteService = QuoteService.create({
      transport: Quotes,
      cache: getBackgroundStorage(),
      clock: () => Date.now(),
      timeoutMs: 4000,
      chunkSize: 50,
      onDiagnostic: (event) => emitDiagnostic(activeRunId(), 'quote-service', event)
    });
  }
  return backgroundQuoteService;
}

// RPC 消息总线初始化（仅浏览器环境）：注入已配置的 QuoteService 与 Storage。
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  Router.init(getBackgroundQuoteService(), getBackgroundStorage());
}

async function scheduleNextAlarm() {
  const delayMs = QuoteService.getRefreshIntervalMs(new Date(), 'background');
  await chrome.alarms.create(ALARM_NAME, { delayInMinutes: delayMs / 60000 });
}

async function clearUnavailableChrome() {
  await chrome.action.setBadgeText({ text: '--' });
  await chrome.action.setBadgeBackgroundColor({ color: '#95A5A6' });
  await chrome.action.setTitle({ title: '股票提醒助手\n暂无可用行情' });
}

async function renderChrome(stocks, snapshot) {
  if (!stocks.length) {
    await chrome.action.setBadgeText({ text: '' });
    await chrome.action.setTitle({ title: '股票提醒助手\n暂无自选股，点击添加' });
    return;
  }
  const badgeStock = stocks[0];
  const badge = formatBadgeState(badgeStock, snapshot.results[badgeStock.code]);
  await chrome.action.setBadgeText({ text: badge.text });
  await chrome.action.setBadgeBackgroundColor({ color: badge.color });

  const lines = stocks.slice(0, TOOLTIP_MAX)
    .map((stock) => formatTooltipLine(stock, snapshot.results[stock.code]));
  const hasAnyQuote = stocks.some((stock) => snapshot.results[stock.code]?.quote);
  await chrome.action.setTitle({
    title: hasAnyQuote
      ? '股票提醒助手\n' + lines.join('\n')
      : '股票提醒助手\n暂无可用行情'
  });
}

async function updateBadgeAndTitle(source = 'unknown') {
  if (updating) {
    pending = true;
    return;
  }
  updating = true;
  pending = false;
  const run = { id: nextRunId(), source };
  activeRun = run;
  const startedAt = Date.now();
  emitDiagnostic(run.id, 'trigger', { type: 'run-start', trigger: source, startedAt });
  try {
    const data = await getBackgroundStorage().loadAll();
    const watchlist = data.watchlist || [];
    if (!watchlist.length) {
      await renderChrome([], { results: {} });
      emitDiagnostic(run.id, 'result', { type: 'run-end', outcome: 'ok', durationMs: Date.now() - startedAt });
      return;
    }

    const groupId = DEFAULT_GROUP_ID;
    const config = data.boardConfig?.[groupId] || {};
    const field = config.sortField || 'manual';
    const direction = config.sortDirection || 'desc';
    const service = getBackgroundQuoteService();
    let groupStocks = StockUtils.getStocksForGroup(watchlist, groupId);
    const plan = planQuoteRequests(groupStocks, field);

    let counts;
    if (plan.needsFullQuotes) {
      const cached = await service.read(plan.readCodes);
      groupStocks = StockUtils.sortStocks(groupStocks, cached.results, groupId, field, direction);
      await renderChrome(groupStocks, cached);
      const refreshed = await service.refresh(plan.refreshCodes);
      groupStocks = StockUtils.sortStocks(groupStocks, refreshed.results, groupId, field, direction);
      await renderChrome(groupStocks, refreshed);
      counts = refreshed.counts;
    } else {
      groupStocks = StockUtils.sortStocks(groupStocks, {}, groupId, field, direction);
      const cached = await service.read(plan.readCodes);
      await renderChrome(groupStocks, cached);
      const refreshed = await service.refresh(plan.refreshCodes);
      await renderChrome(groupStocks, { ...cached, results: { ...cached.results, ...refreshed.results } });
      counts = refreshed.counts;
    }
    emitDiagnostic(run.id, 'result', {
      type: 'run-end',
      outcome: 'ok',
      counts,
      durationMs: Date.now() - startedAt
    });
  } catch (error) {
    emitDiagnostic(run.id, 'result', {
      type: 'run-end',
      outcome: 'failed',
      error: String(error?.message || error),
      durationMs: Date.now() - startedAt
    });
    try {
      await clearUnavailableChrome();
    } catch (chromeError) {
      console.warn(`[bg] run=${run.id} scope=chrome type=clear-failed error=${String(chromeError?.message || chromeError)}`);
    }
  } finally {
    activeRun = null;
    updating = false;
    try {
      await scheduleNextAlarm();
    } catch (error) {
      console.warn(`[bg] run=${run.id} scope=chrome type=alarm-schedule-failed error=${String(error?.message || error)}`);
    }
    if (pending) {
      pending = false;
      void updateBadgeAndTitle('retry');
    }
  }
}

function registerBackgroundListeners() {
  chrome.runtime.onInstalled.addListener(() => { void updateBadgeAndTitle('installed'); });
  chrome.runtime.onStartup.addListener(() => { void updateBadgeAndTitle('startup'); });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) void updateBadgeAndTitle('alarm');
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.watchlist || changes.groups || changes.boardConfig)) {
      void updateBadgeAndTitle('storage-change');
    }
  });
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onInstalled) {
  registerBackgroundListeners();
}

if (typeof module !== 'undefined') {
  module.exports = { formatBadge, formatBadgeState, formatTooltipLine, planQuoteRequests, updateBadgeAndTitle };
}
