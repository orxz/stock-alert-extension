// background.js — Service Worker（Manifest V3）
// 功能1：插件图标 badge 显示当前排序第一只股票的涨跌幅（不带+号，1位小数，红绿判断涨跌）
// 功能2：鼠标 hover tooltip 显示前 5 只自选股的涨跌幅概览
// 颜色惯例：红涨绿跌（中国股市）

importScripts('storage.js', 'quotes.js');

const ALARM_NAME = 'quote-refresh';
const REFRESH_MINUTES = 0.5; // 30秒刷新一次
const TOOLTIP_MAX = 5;       // tooltip 最多显示 5 只股票

// 格式化 badge 文字（Chrome badge 最多4字符）
// 不带 + 号，仅显示涨跌幅绝对值（1位小数），通过红绿背景判断涨跌
function formatBadge(percent) {
  if (percent === null || percent === undefined) return '';
  const abs = Math.abs(percent);
  if (abs >= 1000) return '999';
  if (abs >= 100) return Math.round(abs).toString();     // 105
  if (abs >= 10) return abs.toFixed(0);                  // 12
  return abs.toFixed(1);                                 // 2.5
}

// 格式化单只股票的 tooltip 行（名称 + 涨跌箭头 + 涨跌幅）
function formatTooltipLine(stock, quote) {
  if (!quote || quote.price === null) {
    return `${(stock.name || stock.code).slice(0, 6)}  暂无数据`;
  }
  const name = (quote.name || stock.name || stock.code).slice(0, 6);
  const percent = quote.changePercent !== null ? quote.changePercent.toFixed(1) + '%' : '--';
  const arrow = quote.change !== null ? (quote.change > 0 ? '▲' : quote.change < 0 ? '▼' : '—') : '';
  return `${name} ${arrow} ${percent}`;
}

// 按与 popup.js getGroupStocks 一致的逻辑排序股票
// 返回排序后的完整列表（置顶区在前，非置顶区在后）
function sortStocks(stocks, quotes, gid, field, dir) {
  const direction = dir === 'asc' ? 1 : -1;
  // 预计算 enrich 后的行情
  const enriched = new Map();
  stocks.forEach(s => { enriched.set(s.code, Quotes.enrich(quotes[s.code]) || {}); });
  stocks.sort((a, b) => {
    // 第一优先级：置顶
    const pa = (a.pinned && a.pinned[gid]) ? 1 : 0;
    const pb = (b.pinned && b.pinned[gid]) ? 1 : 0;
    if (pa !== pb) return pb - pa;
    // 手动排序
    if (field === 'manual') {
      const oa = (a.manualOrder && a.manualOrder[gid]) ?? 9999;
      const ob = (b.manualOrder && b.manualOrder[gid]) ?? 9999;
      return oa - ob;
    }
    // 数据型字段
    if (field === 'addedAt') return ((a.addedAt || 0) - (b.addedAt || 0)) * direction;
    if (field === 'name') return (a.name || '').localeCompare(b.name || '') * direction;
    // 行情型字段
    const qa = enriched.get(a.code), qb = enriched.get(b.code);
    const va = qa[field] ?? 0, vb = qb[field] ?? 0;
    return (va - vb) * direction;
  });
  return stocks;
}

// 重入保护：防止 alarms 和 storage.onChanged 同时触发导致并发
let _updating = false;
let _pending = false;  // 标记是否有被跳过的更新需要重试

// 核心更新逻辑
async function updateBadgeAndTitle() {
  if (_updating) { _pending = true; return; }  // 已有更新在进行中，标记待重试
  _updating = true;
  _pending = false;
  try {
    const data = await Storage.loadAll();
    const watchlist = data.watchlist || [];
    if (!watchlist.length) {
      await chrome.action.setBadgeText({ text: '' });
      await chrome.action.setTitle({ title: '股票提醒助手\n暂无自选股，点击添加' });
      return;
    }

    // 取"全部"分组中的股票，按当前排序配置排序
    const gid = DEFAULT_GROUP_ID;
    let groupStocks = watchlist.filter(s => s.groupIds.includes(gid));
    if (!groupStocks.length) {
      await chrome.action.setBadgeText({ text: '' });
      await chrome.action.setTitle({ title: '股票提醒助手\n暂无自选股，点击添加' });
      return;
    }

    // 读取排序配置
    const cfg = (data.boardConfig && data.boardConfig[gid]) || {};
    const field = cfg.sortField || 'manual';
    const dir = cfg.sortDirection || 'desc';

    // manual/addedAt/name 排序不依赖行情，先排序再仅拉取 badge+tooltip 所需行情
    // 行情型排序（changePercent/price/amount 等）需全量行情
    const needsFullQuotes = !['manual', 'addedAt', 'name'].includes(field);
    let quotes = {};
    if (needsFullQuotes) {
      const allCodes = groupStocks.map(s => s.code);
      quotes = await Quotes.fetch(allCodes);
    }

    // 按当前排序配置排序
    groupStocks = sortStocks(groupStocks, quotes, gid, field, dir);

    const badgeStock = groupStocks[0];
    const tooltipStocks = groupStocks.slice(0, TOOLTIP_MAX);

    // manual 排序时仅拉取 badge+tooltip 所需行情（最多 TOOLTIP_MAX+1 只）
    if (!needsFullQuotes) {
      const fetchCodes = [...new Set([badgeStock.code, ...tooltipStocks.map(s => s.code)])];
      quotes = await Quotes.fetch(fetchCodes);
    }

    // ===== 设置 badge（排序第一的股票涨跌幅，不带+号）=====
    const badgeQuote = Quotes.enrich(quotes[badgeStock.code]);
    if (badgeQuote && badgeQuote.changePercent !== null) {
      const badgeText = formatBadge(badgeQuote.changePercent);
      await chrome.action.setBadgeText({ text: badgeText });
      // 红涨绿跌：涨=红色，跌=绿色，平=灰色
      const color = badgeQuote.changePercent > 0 ? '#E74C3C'
                  : badgeQuote.changePercent < 0 ? '#27AE60'
                  : '#95A5A6';
      await chrome.action.setBadgeBackgroundColor({ color });
    } else {
      await chrome.action.setBadgeText({ text: '--' });
      await chrome.action.setBadgeBackgroundColor({ color: '#95A5A6' });
    }

    // ===== 设置 tooltip（排序前 5 只自选股涨跌幅概览）=====
    const lines = tooltipStocks.map(s => {
      const q = Quotes.enrich(quotes[s.code]);
      return formatTooltipLine(s, q);
    });
    const title = '股票提醒助手\n' + lines.join('\n');
    await chrome.action.setTitle({ title });
  } catch (e) {
    console.warn('[bg] update failed:', e.message);
  } finally {
    _updating = false;
    // 如果在更新期间又有新变更触发，立即执行一次补偿更新
    if (_pending) {
      _pending = false;
      updateBadgeAndTitle();
    }
  }
}

// ===== 事件监听 =====
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: REFRESH_MINUTES });
  updateBadgeAndTitle();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: REFRESH_MINUTES });
  updateBadgeAndTitle();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) updateBadgeAndTitle();
});

// 存储变化时（添加/删除/置顶股票、排序配置变更）立即更新
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.watchlist || changes.groups || changes.boardConfig)) {
    updateBadgeAndTitle();
  }
});
