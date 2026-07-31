// background.js — 缓存感知的 Badge / Tooltip 与自适应后台调度

if (typeof importScripts === 'function') {
  importScripts('stock-utils.js', 'storage.js', 'quotes.js', 'quote-service.js');
}

const ALARM_NAME = 'quote-refresh';
const TOOLTIP_MAX = 5;

function formatBadge(percent) {
  if (!Number.isFinite(percent)) return '--';
  const absolute = Math.abs(percent);
  if (absolute >= 1000) return '999';
  if (absolute >= 100) return Math.round(absolute).toString();
  if (absolute >= 10) return absolute.toFixed(0);
  return absolute.toFixed(1);
}

function formatBadgeState(_stock, result) {
  const percent = result?.quote?.changePercent;
  if (!Number.isFinite(percent)) return { text: '--', color: '#95A5A6' };
  if (result.status === 'cached') return { text: formatBadge(percent), color: '#95A5A6' };
  const color = percent > 0 ? '#E74C3C' : percent < 0 ? '#27AE60' : '#95A5A6';
  return { text: formatBadge(percent), color };
}

function formatTooltipLine(stock, result) {
  const quote = result?.quote;
  if (!quote || !Number.isFinite(quote.price)) {
    return `${(stock.name || stock.code).slice(0, 6)}  暂无行情`;
  }
  const name = (quote.name || stock.name || stock.code).slice(0, 6);
  const percent = Number.isFinite(quote.changePercent) ? `${quote.changePercent.toFixed(1)}%` : '--';
  const arrow = quote.change > 0 ? '▲' : quote.change < 0 ? '▼' : '—';
  if (result.status !== 'cached') return `${name} ${arrow} ${percent}`;
  const time = Number.isFinite(result.fetchedAt)
    ? new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).format(new Date(result.fetchedAt))
    : '--:--';
  return `${name} ${arrow} ${percent} · 已过期 ${time}`;
}

let backgroundQuoteService = null;
let updating = false;
let pending = false;

function getBackgroundQuoteService() {
  if (!backgroundQuoteService) {
    backgroundQuoteService = QuoteService.create({
      transport: Quotes,
      cache: Storage,
      clock: () => Date.now(),
      timeoutMs: 4000,
      chunkSize: 50
    });
  }
  return backgroundQuoteService;
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

async function updateBadgeAndTitle() {
  if (updating) {
    pending = true;
    return;
  }
  updating = true;
  pending = false;
  try {
    const data = await Storage.loadAll();
    const watchlist = data.watchlist || [];
    if (!watchlist.length) {
      await renderChrome([], { results: {} });
      return;
    }

    const groupId = DEFAULT_GROUP_ID;
    const config = data.boardConfig?.[groupId] || {};
    const field = config.sortField || 'manual';
    const direction = config.sortDirection || 'desc';
    const needsFullQuotes = !['manual', 'addedAt', 'name'].includes(field);
    const service = getBackgroundQuoteService();
    let groupStocks = StockUtils.getStocksForGroup(watchlist, groupId);

    if (needsFullQuotes) {
      const codes = groupStocks.map((stock) => stock.code);
      const cached = await service.read(codes);
      groupStocks = StockUtils.sortStocks(groupStocks, cached.results, groupId, field, direction);
      await renderChrome(groupStocks, cached);
      const refreshed = await service.refresh(codes);
      groupStocks = StockUtils.sortStocks(groupStocks, refreshed.results, groupId, field, direction);
      await renderChrome(groupStocks, refreshed);
    } else {
      groupStocks = StockUtils.sortStocks(groupStocks, {}, groupId, field, direction);
      const codes = groupStocks.slice(0, TOOLTIP_MAX).map((stock) => stock.code);
      const cached = await service.read(codes);
      await renderChrome(groupStocks, cached);
      const refreshed = await service.refresh(codes);
      await renderChrome(groupStocks, refreshed);
    }
  } catch (error) {
    console.warn('[bg] update failed:', error.message);
    try {
      await clearUnavailableChrome();
    } catch (chromeError) {
      console.warn('[bg] failed to clear browser chrome:', chromeError.message);
    }
  } finally {
    updating = false;
    try {
      await scheduleNextAlarm();
    } catch (error) {
      console.warn('[bg] alarm schedule failed:', error.message);
    }
    if (pending) {
      pending = false;
      void updateBadgeAndTitle();
    }
  }
}

function registerBackgroundListeners() {
  chrome.runtime.onInstalled.addListener(() => { void updateBadgeAndTitle(); });
  chrome.runtime.onStartup.addListener(() => { void updateBadgeAndTitle(); });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) void updateBadgeAndTitle();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.watchlist || changes.groups || changes.boardConfig)) {
      void updateBadgeAndTitle();
    }
  });
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onInstalled) {
  registerBackgroundListeners();
}

if (typeof module !== 'undefined') {
  module.exports = { formatBadge, formatBadgeState, formatTooltipLine };
}
