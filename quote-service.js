// quote-service.js — 行情编排：超时、分批、双源合并、缓存、退避与刷新策略

const QuoteService = (() => {
  const DEFAULT_TIMEOUT_MS = 4000;
  const DEFAULT_CHUNK_SIZE = 50;
  const DEFAULT_FRESHNESS_MS = 30000;
  const CACHE_MAX_AGE_MS = 604800000;
  const OFF_HOURS_INTERVAL_MS = 300000;
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
    return quote && typeof quote === 'object' && typeof quote.price === 'number' && Number.isFinite(quote.price);
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
      return summarize(results, now, null, generation);
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
            status: age <= DEFAULT_FRESHNESS_MS ? 'fresh' : 'cached',
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
      const currentGeneration = ++generation;
      if (!force && attemptedAt < nextAutomaticAttemptAt) {
        return read(requested).then((snapshot) => ({
          ...snapshot,
          attemptedAt,
          generation: currentGeneration,
          deferredUntil: nextAutomaticAttemptAt
        }));
      }

      const promise = executeRefresh(requested, currentGeneration, attemptedAt)
        .finally(() => inFlight.delete(key));
      inFlight.set(key, promise);
      return promise;
    }

    return { read, refresh };
  }

  function chinaTimeParts(now) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(now);
    return Object.fromEntries(parts.map((part) => [part.type, part.value]));
  }

  function isChinaMarketActive(now) {
    const parts = chinaTimeParts(now);
    if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return false;
    const minutes = Number(parts.hour) * 60 + Number(parts.minute);
    return (minutes >= 555 && minutes <= 695) || (minutes >= 775 && minutes <= 905);
  }

  function getRefreshIntervalMs(now, target) {
    if (!isChinaMarketActive(now)) return OFF_HOURS_INTERVAL_MS;
    return target === 'background' ? 30000 : 10000;
  }

  return { create, getRefreshIntervalMs, isChinaMarketActive };
})();

if (typeof module !== 'undefined') module.exports = QuoteService;
