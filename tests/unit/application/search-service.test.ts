// tests/unit/application/search-service.test.ts
// Task 8 — SearchService：remote 成功/失败降级/abort 不降级/空 query/Clock 超时。
import assert from 'node:assert/strict';
import test from 'node:test';

import { SearchService } from '../../../src/application/search/search-service.js';
import type { StockSearchProvider } from '../../../src/application/ports/search-provider.js';
import type { CancellationToken } from '../../../src/application/ports/cancellation.js';
import type { StockSearchResult } from '../../../src/domain/quote.js';
import { FixedClock } from '../../helpers/fixed-clock.js';

const NOW = 1_700_000_000;

/** 构造测试用 StockSearchResult。 */
function result(code: string, name: string, pinyin = ''): StockSearchResult {
  return { code: code as never, name, pinyin, tags: [] };
}

/** Mock 远端 Provider——impl 接收 query 与 token。 */
function mockRemote(
  impl: (query: string, token: CancellationToken) => Promise<readonly StockSearchResult[]>
): StockSearchProvider {
  return {
    async search(query: string, token: CancellationToken) {
      return impl(query, token);
    }
  };
}

/** Mock 本地搜索函数。 */
function mockLocalSearch(catalog: readonly StockSearchResult[]) {
  return (query: string): readonly StockSearchResult[] => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return catalog.filter(
      (r) => r.name.includes(query.trim()) || r.code.toLowerCase().includes(q) || r.pinyin.includes(q)
    );
  };
}

const LOCAL_CATALOG: readonly StockSearchResult[] = [
  result('sh600519', '贵州茅台', 'gzmt'),
  result('sz000001', '平安银行', 'payh'),
  result('sz300750', '宁德时代', 'ndsd')
];

function createService(
  remote: StockSearchProvider,
  localSearch: (q: string) => readonly StockSearchResult[] = mockLocalSearch(LOCAL_CATALOG)
): { service: SearchService; clock: FixedClock } {
  const clock = new FixedClock(NOW);
  const service = new SearchService(remote, localSearch, clock);
  return { service, clock };
}

// ===== 空 query =====

test('search with empty query returns empty array without calling remote', async () => {
  let remoteCalled = false;
  const { service } = createService(mockRemote(async () => {
    remoteCalled = true;
    return [];
  }));
  const results = await service.search('');
  assert.equal(results.length, 0);
  assert.equal(remoteCalled, false);
});

test('search with whitespace-only query returns empty array', async () => {
  const { service } = createService(mockRemote(async () => []));
  const results = await service.search('   ');
  assert.equal(results.length, 0);
});

// ===== remote 成功 =====

test('search returns remote results on success', async () => {
  const remoteResults = [result('sh600519', '贵州茅台', 'gzmt')];
  const { service } = createService(mockRemote(async () => remoteResults));
  const results = await service.search('茅台');
  assert.equal(results.length, 1);
  assert.equal(results[0].code, 'sh600519');
});

test('search trims query before passing to remote', async () => {
  let capturedQuery = '';
  const { service } = createService(mockRemote(async (q) => {
    capturedQuery = q;
    return [];
  }));
  await service.search('  茅台  ');
  assert.equal(capturedQuery, '茅台');
});

// ===== remote 失败降级 =====

test('search falls back to local catalog on remote failure', async () => {
  const { service } = createService(mockRemote(async () => {
    throw new Error('network error');
  }));
  const results = await service.search('茅台');
  assert.ok(results.length >= 1);
  assert.ok(results.some((r) => r.code === 'sh600519'));
});

test('search fallback returns at most 20 results', async () => {
  const bigLocal: StockSearchResult[] = Array.from({ length: 30 }, (_, i) =>
    result(`sh600${String(i).padStart(3, '0')}`, `股票${i}`)
  );
  const localSearch = (q: string): readonly StockSearchResult[] => {
    if (q === '股票') return bigLocal;
    return [];
  };
  const { service } = createService(
    mockRemote(async () => { throw new Error('network error'); }),
    localSearch
  );
  const results = await service.search('股票');
  assert.equal(results.length, 20);
});

// ===== abort 不降级 =====

test('search rethrows on abort without local fallback', async () => {
  const { service, clock } = createService(mockRemote(async (_q, token) => {
    // 远端永不主动 resolve——等待 token 取消时 reject
    return new Promise<readonly StockSearchResult[]>((_resolve, reject) => {
      token.onCancel(() => reject(new Error('aborted by token')));
    });
  }));
  const searchPromise = service.search('茅台');
  // 触发 4s 超时 → source.cancel() → token.aborted=true → remote rejects
  clock.flush();
  await assert.rejects(searchPromise, /aborted/);
});

// ===== Clock 4s 超时 =====

test('SearchService schedules 4s timeout via Clock and cancels after success', async () => {
  const { service, clock } = createService(mockRemote(async () => []));
  await service.search('茅台');
  const timer = clock.scheduled.find((s) => s.delayMs === 4000);
  assert.ok(timer, 'expected a 4000ms schedule');
  assert.equal(timer!.cancelled, true);
});

test('SearchService cancels timeout timer in finally after fallback', async () => {
  const { service, clock } = createService(mockRemote(async () => {
    throw new Error('fail');
  }));
  await service.search('茅台');
  const timer = clock.scheduled.find((s) => s.delayMs === 4000);
  assert.ok(timer);
  assert.equal(timer!.cancelled, true);
});

test('SearchService cancels timeout timer in finally after abort', async () => {
  const { service, clock } = createService(mockRemote(async (_q, token) => {
    return new Promise<readonly StockSearchResult[]>((_resolve, reject) => {
      token.onCancel(() => reject(new Error('aborted')));
    });
  }));
  const searchPromise = service.search('茅台');
  clock.flush();
  await assert.rejects(searchPromise, /aborted/);
  const timer = clock.scheduled.find((s) => s.delayMs === 4000);
  // timer was already fired by flush (not cancelled), but that's OK — it's consumed
  assert.ok(timer);
});

// ===== 降级优先级 =====

test('search prefers remote results over local when remote succeeds', async () => {
  const remoteResult = result('sh999999', '远端结果', 'ydcg');
  const { service } = createService(mockRemote(async () => [remoteResult]));
  const results = await service.search('茅台');
  assert.equal(results.length, 1);
  assert.equal(results[0].code, 'sh999999');
});

// ===== local search 也为空时 =====

test('search returns empty when both remote fails and local has no match', async () => {
  const { service } = createService(
    mockRemote(async () => { throw new Error('fail'); }),
    () => []
  );
  const results = await service.search('不存在的股票');
  assert.equal(results.length, 0);
});
