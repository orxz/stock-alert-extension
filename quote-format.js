// quote-format.js — 共享行情格式化（Popup / Background 共用）

const QuoteFormat = (() => {
  const TZ_OPTIONS = {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  };

  function formatTime(ts) {
    return new Intl.DateTimeFormat('zh-CN', TZ_OPTIONS).format(new Date(ts));
  }

  function formatUpdateTime(ts) {
    return formatTime(ts) + ' 更新';
  }

  function formatRelativeTime(ts, now) {
    const current = now || Date.now();
    const diff = Math.floor((current - ts) / 1000);
    if (diff < 5) return '刚刚更新';
    if (diff < 60) return diff + ' 秒前更新';
    if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前更新';
    return formatUpdateTime(ts);
  }

  function formatStatusSummary(snapshot) {
    const { fresh = 0, cached = 0, missing = 0 } = snapshot?.counts || {};
    if (fresh + cached + missing === 0) return '暂无自选股';
    const parts = [];
    if (fresh) parts.push(`实时 ${fresh}`);
    if (cached) parts.push(`缓存 ${cached}`);
    if (missing) parts.push(`缺失 ${missing}`);
    if (fresh === 0 && cached === 0) return '无行情数据 · 点击刷新重试';
    if (fresh === 0) return `${parts.join(' · ')} · 行情服务暂不可用`;
    return parts.join(' · ');
  }

  function getRefreshToastMessage(snapshot) {
    const requested = Object.keys(snapshot.results || {}).length;
    if (requested === 0) return '暂无自选股';
    if (snapshot.counts.missing === requested) return '刷新失败，请稍后重试';
    if (!snapshot.succeededAt) return '实时行情不可用，已保留缓存';
    return '行情已刷新';
  }

  function getQuoteDisplay(result) {
    if (!result?.quote || result.status === 'missing') {
      return { price: '--', change: '--', status: 'missing', staleLabel: '' };
    }
    const quote = result.quote;
    const price = Number.isFinite(quote.price) ? quote.price.toFixed(2) : '--';
    const change = Number.isFinite(quote.change) && Number.isFinite(quote.changePercent)
      ? `${quote.change > 0 ? '+' : ''}${quote.change.toFixed(2)} ${quote.changePercent > 0 ? '+' : ''}${quote.changePercent.toFixed(2)}%`
      : '--';
    const time = result.fetchedAt ? formatTime(result.fetchedAt) : '';
    return {
      price,
      change,
      status: result.status,
      staleLabel: result.status === 'cached' ? `旧 ${time}` : ''
    };
  }

  function formatBadge(percent) {
    if (!Number.isFinite(percent)) return '--';
    const absolute = Math.abs(percent);
    if (absolute >= 1000) return '999';
    if (absolute >= 100) return Math.round(absolute).toString();
    if (absolute >= 10) return absolute.toFixed(0);
    return absolute.toFixed(1);
  }

  function formatBadgeState(result) {
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
    const time = Number.isFinite(result.fetchedAt) ? formatTime(result.fetchedAt) : '--:--';
    return `${name} ${arrow} ${percent} · 已过期 ${time}`;
  }

  function formatVolume(v) {
    if (!v) return '0';
    if (v >= 100000000) return (v / 100000000).toFixed(2) + '亿';
    if (v >= 10000) return (v / 10000).toFixed(1) + '万';
    return String(v);
  }

  function formatAmount(v) {
    if (!v) return '0';
    if (v >= 100000000) return (v / 100000000).toFixed(2) + '亿';
    if (v >= 10000) return (v / 10000).toFixed(1) + '万';
    return v.toFixed(0);
  }

  return {
    formatTime,
    formatUpdateTime,
    formatRelativeTime,
    formatStatusSummary,
    getRefreshToastMessage,
    getQuoteDisplay,
    formatBadge,
    formatBadgeState,
    formatTooltipLine,
    formatVolume,
    formatAmount
  };
})();

if (typeof globalThis !== 'undefined') globalThis.QuoteFormat = QuoteFormat;

if (typeof module !== 'undefined') module.exports = QuoteFormat;
