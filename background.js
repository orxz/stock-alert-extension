// background.js — Service Worker（Manifest V3）
// 功能1：插件图标 badge 显示置顶股票的涨跌幅（不带+号，1位小数，红绿判断涨跌）
// 功能2：鼠标 hover tooltip 显示前 5 个自选股的涨跌幅概览
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

    // 置顶股票优先（在"全部"分组中 pinned 的），否则取第一个自选股
    const pinnedStock = watchlist.find(s => s.pinned && s.pinned[DEFAULT_GROUP_ID]);
    const badgeStock = pinnedStock || watchlist[0]; // badge 显示置顶股票（或第一个）

    // tooltip 显示前 5 只：置顶的排前面，然后按 watchlist 顺序
    const pinnedStocks = watchlist.filter(s => s.pinned && s.pinned[DEFAULT_GROUP_ID]);
    const restStocks = watchlist.filter(s => !(s.pinned && s.pinned[DEFAULT_GROUP_ID]));
    const tooltipStocks = [...pinnedStocks, ...restStocks].slice(0, TOOLTIP_MAX);

    // 合并需要查询的代码（去重）
    const codes = [...new Set([badgeStock.code, ...tooltipStocks.map(s => s.code)])];
    const quotes = await Quotes.fetch(codes);

    // ===== 设置 badge（置顶股票涨跌幅，不带+号）=====
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

    // ===== 设置 tooltip（前 5 只自选股涨跌幅概览）=====
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

// 存储变化时（添加/删除/置顶股票）立即更新
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.watchlist || changes.groups)) {
    updateBadgeAndTitle();
  }
});
