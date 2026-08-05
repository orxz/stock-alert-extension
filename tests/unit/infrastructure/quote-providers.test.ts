// tests/unit/infrastructure/quote-providers.test.ts
// Task 8 — 行情/搜索传输层纯解析器 + Provider 注入测试 + abort 传播。
import assert from 'node:assert/strict';
import test from 'node:test';

import type { StockCode } from '../../../src/domain/brands.js';
import { parseEastmoney, parseTencent, parseEastmoneySearch } from '../../../src/infrastructure/quote-providers/provider-parsers.js';
import { EastmoneyQuoteProvider } from '../../../src/infrastructure/quote-providers/eastmoney-quote-provider.js';
import { TencentQuoteProvider } from '../../../src/infrastructure/quote-providers/tencent-quote-provider.js';
import { EastmoneySearchProvider } from '../../../src/infrastructure/quote-providers/eastmoney-search-provider.js';
import { searchLocalCatalog } from '../../../src/infrastructure/quote-providers/local-stock-catalog.js';
import { createCancellationSource } from '../../../src/application/ports/cancellation.js';
import type { CancellationToken } from '../../../src/application/ports/cancellation.js';

/** 未取消的 token 工厂。 */
function noopToken(): CancellationToken {
  return { aborted: false, onCancel: () => () => {} };
}

/** Mock fetch 响应工具。 */
function mockJsonResponse(body: unknown) {
  return {
    ok: true,
    async json() { return body; },
    async arrayBuffer() {
      const text = typeof body === 'string' ? body : JSON.stringify(body);
      return new TextEncoder().encode(text).buffer;
    }
  };
}

// ===== parseEastmoney =====

test('Eastmoney keeps partial valid rows and drops zero prices', () => {
  const result = parseEastmoney({ data: { diff: [
    { f12: '600519', f13: 1, f14: '贵州茅台', f2: 1500, f3: 1.2 },
    { f12: '000001', f13: 0, f14: '平安银行', f2: 0, f3: 0 }
  ] } });
  assert.equal(result.sh600519?.price, 1500);
  assert.equal(result.sz000001, undefined);
});

test('Eastmoney uses fltt=2 float values directly', () => {
  const result = parseEastmoney({ data: { diff: [
    { f12: '600519', f13: 1, f14: '贵州茅台', f2: 1500, f3: 1.2, f4: 18 }
  ] } });
  assert.equal(result.sh600519?.price, 1500);
  assert.equal(result.sh600519?.changePercent, 1.2);
  assert.equal(result.sh600519?.change, 18);
});

test('Eastmoney computes change from price and prevClose when f4 is absent', () => {
  const result = parseEastmoney({ data: { diff: [
    { f12: '600519', f13: 1, f14: '贵州茅台', f2: 1500, f3: 1.2, f18: 1482 }
  ] } });
  // price=1500, prevClose=1482 → change=18
  assert.equal(result.sh600519?.price, 1500);
  assert.equal(result.sh600519?.change, 18);
});

test('Eastmoney maps f13=1 to sh prefix', () => {
  const result = parseEastmoney({ data: { diff: [
    { f12: '601318', f13: 1, f14: '中国平安', f2: 50, f3: 0.5 }
  ] } });
  assert.ok(result.sh601318);
  assert.equal(result.sh601318?.name, '中国平安');
});

test('Eastmoney maps bj prefix for codes starting with 4/8/9', () => {
  const result = parseEastmoney({ data: { diff: [
    { f12: '430047', f13: 0, f14: '诺思兰德', f2: 5, f3: 0.05 }
  ] } });
  assert.ok(result.bj430047);
});

test('Eastmoney defaults to sz for unknown f13', () => {
  const result = parseEastmoney({ data: { diff: [
    { f12: '000001', f13: 0, f14: '平安银行', f2: 13, f3: 0.13 }
  ] } });
  assert.ok(result.sz000001);
});

test('Eastmoney returns empty for missing diff array', () => {
  assert.deepEqual(parseEastmoney({}), {});
  assert.deepEqual(parseEastmoney({ data: {} }), {});
  assert.deepEqual(parseEastmoney({ data: { diff: null } }), {});
});

test('Eastmoney skips rows without f12', () => {
  const result = parseEastmoney({ data: { diff: [
    null,
    { f13: 1, f14: 'NoCode', f2: 1 },
    { f12: '600519', f13: 1, f14: '贵州茅台', f2: 1500, f3: 1.2 }
  ] } });
  assert.equal(Object.keys(result).length, 1);
  assert.ok(result.sh600519);
});

// ===== parseTencent =====

/**
 * 构造腾讯行情行（字段布局按 qt.gtimg.cn 实测：88 字段，`~` 分隔）。
 * [1]=名称 [3]=现价 [4]=昨收 [31]=涨跌额 [32]=涨跌幅 [35]=现价/量/额复合 [37]=成交额(万元)
 */
function tencentLine(
  code: string,
  overrides: Readonly<Record<number, string>> = {}
): string {
  const fields = new Array<string>(88).fill('');
  fields[0] = '1';
  fields[1] = '贵州茅台';
  fields[2] = code.slice(2);
  fields[3] = '1304.89';
  fields[4] = '1328.36';
  fields[5] = '1328.36';
  fields[6] = '28566';
  fields[30] = '20260805131747';
  fields[31] = '-23.47';
  fields[32] = '-1.77';
  fields[33] = '1333.80';
  fields[34] = '1303.50';
  fields[35] = '1304.89/28566/3754515788';
  fields[36] = '28566';
  fields[37] = '375452';
  for (const [index, value] of Object.entries(overrides)) fields[Number(index)] = value;
  return `v_${code}="${fields.join('~')}";`;
}

test('Tencent parses GBK-decoded text into a normalized quote', () => {
  const result = parseTencent(tencentLine('sh600519'));
  assert.equal(result.sh600519?.name, '贵州茅台');
  assert.equal(result.sh600519?.price, 1304.89);
  assert.equal(result.sh600519?.change, -23.47);
  assert.equal(result.sh600519?.changePercent, -1.77);
});

test('Tencent takes the exact amount in yuan from the composite field', () => {
  // [35] 第三段是精确成交额（元），与 Eastmoney f6 口径一致——不是 [37] 的万元。
  const result = parseTencent(tencentLine('sh600519'));
  assert.equal(result.sh600519?.amount, 3754515788);
});

test('Tencent falls back to the 万元 amount field when the composite is absent', () => {
  const result = parseTencent(tencentLine('sh600519', { 35: '' }));
  assert.equal(result.sh600519?.amount, 3754520000);
});

test('Tencent preserves the market prefix echoed back by the endpoint', () => {
  const text = [tencentLine('sz000001'), tencentLine('bj430047')].join('\n');
  const result = parseTencent(text);
  assert.ok(result.sz000001, 'sz prefix preserved');
  assert.ok(result.bj430047, 'bj prefix preserved');
});

test('Tencent drops non-positive prices instead of fabricating a quote', () => {
  const result = parseTencent(tencentLine('sh600519', { 3: '0.00' }));
  assert.equal(result.sh600519, undefined);
});

test('Tencent computes change/changePercent when the endpoint omits them', () => {
  const result = parseTencent(
    tencentLine('sh600519', { 3: '1500', 4: '1482', 31: '', 32: '' })
  );
  assert.equal(result.sh600519!.change, 18);
  assert.ok(result.sh600519!.changePercent > 1.2 && result.sh600519!.changePercent < 1.23);
});

test('Tencent returns empty for unmatched text and the none-match sentinel', () => {
  assert.deepEqual(parseTencent(''), {});
  assert.deepEqual(parseTencent('no match here'), {});
  // 未知代码时腾讯返回 v_pv_none_match="1"——字段数不足，必须跳过。
  assert.deepEqual(parseTencent('v_pv_none_match="1";'), {});
});

// ===== parseEastmoneySearch =====

test('Eastmoney search filters by valid SecurityType', () => {
  const json = { QuotationCodeTable: { Data: [
    { Code: '600519', Name: '贵州茅台', SecurityType: '1', MktNum: '1' },
    { Code: '000001', Name: '平安银行', SecurityType: '2', MktNum: '0' },
    { Code: '999999', Name: '指数', SecurityType: '99', MktNum: '0' }
  ] } };
  const results = parseEastmoneySearch(json);
  assert.equal(results.length, 2);
  assert.equal(results[0].code, 'sh600519');
  assert.equal(results[1].code, 'sz000001');
});

test('Eastmoney search accepts AStock classify without SecurityType', () => {
  const json = { QuotationCodeTable: { Data: [
    { Code: '300750', Name: '宁德时代', Classify: 'AStock' }
  ] } };
  const results = parseEastmoneySearch(json);
  assert.equal(results.length, 1);
  assert.equal(results[0].code, 'sz300750');
});

test('Eastmoney search maps SecurityType 27 to bj', () => {
  const json = { QuotationCodeTable: { Data: [
    { Code: '430047', Name: '诺思兰德', SecurityType: '27' }
  ] } };
  const results = parseEastmoneySearch(json);
  assert.equal(results[0].code, 'bj430047');
});

test('Eastmoney search maps SecurityType 25 to sh', () => {
  const json = { QuotationCodeTable: { Data: [
    { Code: '601318', Name: '中国平安', SecurityType: '25', MktNum: '1' }
  ] } };
  const results = parseEastmoneySearch(json);
  assert.equal(results[0].code, 'sh601318');
});

test('Eastmoney search handles _oma_data alternate path', () => {
  const json = { _oma_data: { QuotationCodeTable: { Data: [
    { Code: '000001', Name: '平安银行', SecurityType: '2' }
  ] } } };
  const results = parseEastmoneySearch(json);
  assert.equal(results.length, 1);
});

test('Eastmoney search filters non-6-digit codes', () => {
  const json = { QuotationCodeTable: { Data: [
    { Code: '12345', Name: 'TooShort', SecurityType: '1' },
    { Code: '600519', Name: '贵州茅台', SecurityType: '1' }
  ] } };
  const results = parseEastmoneySearch(json);
  assert.equal(results.length, 1);
});

test('Eastmoney search returns empty for missing Data', () => {
  assert.deepEqual(parseEastmoneySearch({}), []);
  assert.deepEqual(parseEastmoneySearch({ QuotationCodeTable: {} }), []);
});

test('Eastmoney search includes pinyin', () => {
  const json = { QuotationCodeTable: { Data: [
    { Code: '600519', Name: '贵州茅台', PinYin: 'gzmt', SecurityType: '1' }
  ] } };
  const results = parseEastmoneySearch(json);
  assert.equal(results[0].pinyin, 'gzmt');
});

// ===== EastmoneyQuoteProvider: fetch injection =====

test('EastmoneyQuoteProvider constructs correct URL with secids mapping', async () => {
  let capturedUrl = '';
  const mockFetch = async (url: string) => {
    capturedUrl = url;
    return mockJsonResponse({ data: { diff: [
      { f12: '600519', f13: 1, f14: '贵州茅台', f2: 1500, f3: 1.2 }
    ] } });
  };
  const provider = new EastmoneyQuoteProvider(mockFetch);
  const result = await provider.fetch(['sh600519'] as readonly StockCode[], noopToken());
  assert.ok(capturedUrl.includes('secids=1.600519'));
  assert.ok(capturedUrl.includes('fltt=2'));
  assert.ok(capturedUrl.includes('push2.eastmoney.com'));
  assert.ok(result.sh600519);
  assert.equal(result.sh600519?.price, 1500);
});

test('EastmoneyQuoteProvider maps bj to 0 prefix in secids', async () => {
  let capturedUrl = '';
  const mockFetch = async (url: string) => {
    capturedUrl = url;
    return mockJsonResponse({ data: { diff: [] } });
  };
  const provider = new EastmoneyQuoteProvider(mockFetch);
  await provider.fetch(['bj430047'] as readonly StockCode[], noopToken());
  assert.ok(capturedUrl.includes('secids=0.430047'));
});

test('EastmoneyQuoteProvider returns empty for empty codes', async () => {
  let called = false;
  const mockFetch = async () => { called = true; return mockJsonResponse({}); };
  const provider = new EastmoneyQuoteProvider(mockFetch);
  const result = await provider.fetch([], noopToken());
  assert.equal(called, false);
  assert.deepEqual(result, {});
});

test('EastmoneyQuoteProvider throws on HTTP error', async () => {
  const mockFetch = async () => ({ ok: false, status: 500 });
  const provider = new EastmoneyQuoteProvider(mockFetch);
  await assert.rejects(
    provider.fetch(['sh600519'] as readonly StockCode[], noopToken()),
    /HTTP 500/
  );
});

// ===== TencentQuoteProvider: fetch injection =====

test('TencentQuoteProvider constructs correct URL and parses response', async () => {
  let capturedUrl = '';
  const mockFetch = async (url: string) => {
    capturedUrl = url;
    return {
      ok: true,
      async arrayBuffer() {
        return new TextEncoder().encode(tencentLine('sh600519')).buffer;
      }
    };
  };
  const provider = new TencentQuoteProvider(mockFetch);
  const result = await provider.fetch(['sh600519'] as readonly StockCode[], noopToken());
  assert.ok(capturedUrl.includes('qt.gtimg.cn/q=sh600519'));
  assert.equal(result.sh600519?.price, 1304.89);
});

test('TencentQuoteProvider batches codes into one comma-separated query', async () => {
  let capturedUrl = '';
  const mockFetch = async (url: string) => {
    capturedUrl = url;
    return {
      ok: true,
      async arrayBuffer() {
        return new TextEncoder().encode(
          [tencentLine('sh600519'), tencentLine('sz000001')].join('\n')
        ).buffer;
      }
    };
  };
  const provider = new TencentQuoteProvider(mockFetch);
  const result = await provider.fetch(
    ['sh600519', 'sz000001'] as readonly StockCode[],
    noopToken()
  );
  assert.ok(capturedUrl.includes('q=sh600519,sz000001'));
  assert.equal(Object.keys(result).length, 2);
});

test('TencentQuoteProvider throws on HTTP error', async () => {
  const mockFetch = async () => ({ ok: false, status: 403 });
  const provider = new TencentQuoteProvider(mockFetch);
  await assert.rejects(
    provider.fetch(['sh600519'] as readonly StockCode[], noopToken()),
    /HTTP 403/
  );
});

test('TencentQuoteProvider returns empty without calling fetch for no codes', async () => {
  let called = false;
  const mockFetch = async () => { called = true; return { ok: true, async arrayBuffer() { return new ArrayBuffer(0); } }; };
  const provider = new TencentQuoteProvider(mockFetch);
  const result = await provider.fetch([] as readonly StockCode[], noopToken());
  assert.deepEqual(result, {});
  assert.equal(called, false);
});

// ===== EastmoneySearchProvider: fetch injection + abort propagation =====

test('EastmoneySearchProvider constructs correct search URL', async () => {
  let capturedUrl = '';
  const mockFetch = async (url: string) => {
    capturedUrl = url;
    return mockJsonResponse({ QuotationCodeTable: { Data: [
      { Code: '600519', Name: '贵州茅台', SecurityType: '1', MktNum: '1' }
    ] } });
  };
  const provider = new EastmoneySearchProvider(mockFetch);
  const results = await provider.search('茅台', noopToken());
  assert.ok(capturedUrl.includes('searchapi.eastmoney.com'));
  assert.ok(capturedUrl.includes('input='));
  assert.equal(results.length, 1);
  assert.equal(results[0].code, 'sh600519');
});

test('search links CancellationToken to the fetch AbortSignal', async () => {
  const cancellation = createCancellationSource();
  let capturedSignal: AbortSignal | undefined;
  const mockFetch = async (_url: string, init?: { signal?: AbortSignal }) => {
    capturedSignal = init?.signal;
    return mockJsonResponse({ QuotationCodeTable: { Data: [] } });
  };
  const provider = new EastmoneySearchProvider(mockFetch);
  await provider.search('茅台', cancellation.token);
  cancellation.cancel();
  assert.ok(capturedSignal);
  assert.equal(capturedSignal!.aborted, true);
});

test('pre-aborted token immediately aborts the fetch signal', async () => {
  const cancellation = createCancellationSource();
  cancellation.cancel();
  let capturedSignal: AbortSignal | undefined;
  const mockFetch = async (_url: string, init?: { signal?: AbortSignal }) => {
    capturedSignal = init?.signal;
    return mockJsonResponse({ QuotationCodeTable: { Data: [] } });
  };
  const provider = new EastmoneySearchProvider(mockFetch);
  await provider.search('茅台', cancellation.token);
  assert.ok(capturedSignal);
  assert.equal(capturedSignal!.aborted, true);
});

// ===== local-stock-catalog =====

test('local catalog fuzzy matches by name', () => {
  const results = searchLocalCatalog('茅台');
  assert.ok(results.length >= 1);
  assert.ok(results.some(r => r.code === 'sh600519'));
});

test('local catalog fuzzy matches by code', () => {
  const results = searchLocalCatalog('600519');
  assert.ok(results.some(r => r.code === 'sh600519'));
});

test('local catalog fuzzy matches by pinyin', () => {
  const results = searchLocalCatalog('gzmt');
  assert.ok(results.some(r => r.code === 'sh600519'));
});

test('local catalog returns empty for empty query', () => {
  assert.deepEqual(searchLocalCatalog(''), []);
  assert.deepEqual(searchLocalCatalog('   '), []);
});
