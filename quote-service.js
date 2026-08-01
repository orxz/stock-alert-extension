// quote-service.js — 行情编排：超时、分批、双源合并、缓存、退避与刷新策略

// 中国市场时段判断与刷新间隔计算已迁移至 quote-format.js 作为共享工具。
// 此处在 Node 测试环境中按需加载 QuoteFormat，浏览器/SW 由 importScripts 已加载。
if (typeof globalThis !== 'undefined' && !globalThis.QuoteFormat && typeof require === 'function') {
  require('./quote-format.js');
}

const QuoteService = (() => {
  const DEFAULT_TIMEOUT_MS = 4000;
  const DEFAULT_CHUNK_SIZE = 50;
  const DEFAULT_FRESHNESS_MS = 30000;
  const CACHE_MAX_AGE_MS = 604800000;
  const BACKOFF_MS = [30000, 120000, 300000];

  function chunk(values, size) {
    const result = [];
    for (let index = 0; index < values.length; index += size) {
      result.push(values.slice(index, index + size));
    }
    return result;
  }

  function missingResult(code, error = 'unavailable') {
    return { code, status: 'missing', source: 'none', fetchedAt: null, quote: null, error };
  }

  function summarize(results, attemptedAt, succeededAt = null, generation = 0) {
    const counts = { fresh: 0, cached: 0, missing: 0 };
    for (const result of Object.values(results)) counts[result.status] += 1;
    return { results, counts, attemptedAt, succeededAt, generation };
  }

  async function withTimeout(operation, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await operation(controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  function classifyError(error) {
    if (error?.name === 'AbortError' || error?.message === 'aborted') return 'timeout';
    if (/http/i.test(error?.message || '')) return 'http';
    if (/json|parse|payload|malformed/i.test(error?.message || '')) return 'parse';
    return 'unavailable';
  }

  function isUsableQuote(quote) {
    return quote
      && typeof quote === 'object'
      && typeof quote.price === 'number'
      && Number.isFinite(quote.price)
      && quote.price > 0;
  }

  function uniqueCodes(codes) {
    return [...new Set((codes || []).filter((code) => typeof code === 'string' && code))];
  }

  /**
   * @param {{
   *   transport: {
   *     fetchEastmoney(codes: string[], options: { signal: AbortSignal }): Promise<Record<string, any>>,
   *     fetchSina(codes: string[], options: { signal: AbortSignal }): Promise<Record<string, any>>,
   *     enrich(quote: Record<string, any>): Record<string, any>|null
   *   },
   *   cache: {
   *     readQuoteCache(codes: string[]): Promise<Record<string, any>>,
   *     writeQuoteCache(entries: Record<string, any>): Promise<void>,
   *     deleteQuoteCache(codes: string[]): Promise<void>
   *   },
   *   clock?: () => number,
   *   timeoutMs?: number,
   *   chunkSize?: number
   * }} options
   */
  function create({
    transport,
    cache,
    clock = () => Date.now(),
    timeoutMs = DEFAULT_TIMEOUT_MS,
    chunkSize = DEFAULT_CHUNK_SIZE
  }) {
    let generation = 0;
    let failureCount = 0;
    let nextAutomaticAttemptAt = 0;
    const inFlight = new Map();

    async function read(codes, { freshnessMs = DEFAULT_FRESHNESS_MS } = {}) {
      const requested = uniqueCodes(codes);
      const gen = generation;
      const now = clock();
      const cached = await cache.readQuoteCache(requested);
      const expired = [];
      const results = {};
      for (const code of requested) {
        const entry = cached[code];
        const age = entry && Number.isFinite(entry.fetchedAt)
          ? Math.max(0, now - entry.fetchedAt)
          : Number.POSITIVE_INFINITY;
        if (entry && isUsableQuote(entry.quote) && age <= CACHE_MAX_AGE_MS) {
          results[code] = {
            code,
            status: age <= freshnessMs ? 'fresh' : 'cached',
            source: 'cache',
            provider: entry.provider || 'unknown',
            fetchedAt: entry.fetchedAt,
            quote: entry.quote,
            error: null
          };
        } else {
          if (entry) expired.push(code);
          results[code] = missingResult(code);
        }
      }
      if (expired.length) await cache.deleteQuoteCache(expired);
      return summarize(results, now, null, gen);
    }

    async function fetchProvider(provider, codes) {
      try {
        const values = await withTimeout(
          (signal) => transport[provider](codes, { signal }),
          timeoutMs
        );
        return { values: values || {}, error: null };
      } catch (error) {
        return { values: {}, error: classifyError(error) };
      }
    }

    async function executeRefresh(requested, currentGeneration, attemptedAt) {
      // 空自选股守卫：直接返回空快照，不触碰 failureCount / nextAutomaticAttemptAt。
      // v1.3.0 起 QuoteService 常驻 SW，退避状态会跨 Popup 重载存活；若放任空刷新累积
      // 失败计数，新用户首屏（空自选）→ 退避 → 添加股票 → 刷新被推迟 30s → 行情缺失。
      if (requested.length === 0) {
        return summarize({}, attemptedAt, null, currentGeneration);
      }
      const cached = await cache.readQuoteCache(requested);
      const freshResults = {};
      const cacheWrites = {};
      const errors = Object.fromEntries(requested.map((code) => [code, 'unavailable']));

      for (const batch of chunk(requested, chunkSize)) {
        const primary = await fetchProvider('fetchEastmoney', batch);
        if (primary.error) {
          for (const code of batch) errors[code] = primary.error;
        }
        for (const code of batch) {
          const normalized = transport.enrich(primary.values[code]);
          if (!isUsableQuote(normalized)) continue;
          freshResults[code] = {
            code,
            status: 'fresh',
            source: 'eastmoney',
            provider: 'eastmoney',
            fetchedAt: attemptedAt,
            quote: normalized,
            error: null
          };
          cacheWrites[code] = { provider: 'eastmoney', fetchedAt: attemptedAt, quote: normalized };
        }

        const missing = batch.filter((code) => !freshResults[code]);
        if (!missing.length) continue;
        const secondary = await fetchProvider('fetchSina', missing);
        if (secondary.error) {
          for (const code of missing) errors[code] = secondary.error;
        }
        for (const code of missing) {
          const normalized = transport.enrich(secondary.values[code]);
          if (!isUsableQuote(normalized)) continue;
          freshResults[code] = {
            code,
            status: 'fresh',
            source: 'sina',
            provider: 'sina',
            fetchedAt: attemptedAt,
            quote: normalized,
            error: null
          };
          cacheWrites[code] = { provider: 'sina', fetchedAt: attemptedAt, quote: normalized };
        }
      }

      if (Object.keys(cacheWrites).length) await cache.writeQuoteCache(cacheWrites);

      const expired = [];
      const results = {};
      for (const code of requested) {
        if (freshResults[code]) {
          results[code] = freshResults[code];
          continue;
        }
        const entry = cached[code];
        const age = entry && Number.isFinite(entry.fetchedAt)
          ? Math.max(0, attemptedAt - entry.fetchedAt)
          : Number.POSITIVE_INFINITY;
        if (entry && isUsableQuote(entry.quote) && age <= CACHE_MAX_AGE_MS) {
          results[code] = {
            code,
            status: 'cached',
            source: 'cache',
            provider: entry.provider || 'unknown',
            fetchedAt: entry.fetchedAt,
            quote: entry.quote,
            error: errors[code]
          };
        } else {
          if (entry) expired.push(code);
          results[code] = missingResult(code, errors[code]);
        }
      }
      if (expired.length) await cache.deleteQuoteCache(expired);

      const snapshot = summarize(
        results,
        attemptedAt,
        Object.keys(freshResults).length ? attemptedAt : null,
        currentGeneration
      );
      if (currentGeneration === generation) {
        if (snapshot.counts.fresh > 0) {
          failureCount = 0;
          nextAutomaticAttemptAt = 0;
        } else {
          failureCount += 1;
          const delay = BACKOFF_MS[Math.min(failureCount - 1, BACKOFF_MS.length - 1)];
          nextAutomaticAttemptAt = attemptedAt + delay;
        }
      }
      return snapshot;
    }

    function refresh(codes, { force = false } = {}) {
      const requested = uniqueCodes(codes);
      const key = [...requested].sort().join(',');
      if (inFlight.has(key)) return inFlight.get(key);

      const attemptedAt = clock();
      if (!force && attemptedAt < nextAutomaticAttemptAt) {
        // 退避期内存在失败记录，近期缓存不得再以 fresh 呈现（见设计 §6.1）
        return read(requested, { freshnessMs: 0 }).then((snapshot) => ({
          ...snapshot,
          attemptedAt,
          deferredUntil: nextAutomaticAttemptAt
        }));
      }

      const currentGeneration = ++generation;
      const promise = executeRefresh(requested, currentGeneration, attemptedAt)
        .finally(() => inFlight.delete(key));
      inFlight.set(key, promise);
      return promise;
    }

    return { read, refresh };
  }

  function chinaTimeParts(now) {
    return globalThis.QuoteFormat.chinaTimeParts(now);
  }

  function isChinaMarketActive(now) {
    return globalThis.QuoteFormat.isChinaMarketActive(now);
  }

  function getRefreshIntervalMs(now, target) {
    return globalThis.QuoteFormat.getRefreshIntervalMs(now, target);
  }

  return { create, getRefreshIntervalMs, isChinaMarketActive };
})();

if (typeof module !== 'undefined') module.exports = QuoteService;
