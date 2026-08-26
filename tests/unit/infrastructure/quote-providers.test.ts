// tests/unit/infrastructure/quote-providers.test.ts
// Task 8 — 行情/搜索传输层纯解析器 + Provider 注入测试 + abort 传播。
import assert from 'node:assert/strict';
import test from 'node:test';

import type { StockCode } from '../../../src/domain/brands.js';
import { parseEastmoney, parseTencent, parseEastmoneySearch, parseEastmoneyTrends, parseEastmoneyKline } from '../../../src/infrastructure/quote-providers/provider-parsers.js';
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

test('Eastmoney keeps open/high/low/prevClose/volume fields', () => {
  const result = parseEastmoney({ data: { diff: [
    { f12: '600519', f13: 1, f14: '贵州茅台', f2: 1500, f3: 1.2, f4: 18, f5: 28566, f15: 1510, f16: 1490, f17: 1495, f18: 1482 }
  ] } });
  assert.equal(result.sh600519?.open, 1495);
  assert.equal(result.sh600519?.high, 1510);
  assert.equal(result.sh600519?.low, 1490);
  assert.equal(result.sh600519?.prevClose, 1482);
  assert.equal(result.sh600519?.volume, 28566);
});

test('Eastmoney omits detail fields when the endpoint omits them', () => {
  const result = parseEastmoney({ data: { diff: [
    { f12: '600519', f13: 1, f14: '贵州茅台', f2: 1500 }
  ] } });
  assert.equal(result.sh600519?.open, undefined);
  assert.equal(result.sh600519?.high, undefined);
  assert.equal(result.sh600519?.low, undefined);
  assert.equal(result.sh600519?.prevClose, undefined);
  assert.equal(result.sh600519?.volume, undefined);
});

test('Eastmoney keeps ratio/cap detail fields', () => {
  const result = parseEastmoney({ data: { diff: [
    { f12: '600519', f13: 1, f14: '贵州茅台', f2: 1500, f3: 1.2, f4: 18, f7: 1.33, f8: 0.2, f9: 19.78, f10: 0.52, f20: 1635794000000, f21: 1635794000000, f23: 7.02 }
  ] } });
  assert.equal(result.sh600519?.turnoverRate, 0.2);
  assert.equal(result.sh600519?.amplitude, 1.33);
  assert.equal(result.sh600519?.volumeRatio, 0.52);
  assert.equal(result.sh600519?.pe, 19.78);
  assert.equal(result.sh600519?.pb, 7.02);
  assert.equal(result.sh600519?.totalMarketCap, 1635794000000);
  assert.equal(result.sh600519?.floatMarketCap, 1635794000000);
});

/**
 * 回归：ulist.np/get 上的 f51/f52 不是涨停价/跌停价。
 *
 * 实测 push2delay.eastmoney.com/api/qt/ulist.np/get?fltt=2（2026-08-06）：
 *   sh600519 现价 1308.55 / 昨收 1306.45 → f51=271524528742.4、f52=22132684069.8
 *   sz000001 → f51=0.0、f52=10879000000.0
 * 同日 stock/get 上 f51/f52 确为涨停/跌停（143710/117581 = 1437.10/1175.81），
 * 腾讯 [47]/[48] 也给出同一真值——字段含义随 endpoint 变化，批量接口这两个槽位
 * 装的是别的量纲。照搬会把 2715 亿当成涨停价渲染成「271524528742.40」。
 * 该 endpoint 的 f1–f300 全量扫描均无真实涨跌停字段，故主源不提供该数据。
 */
test('Eastmoney never maps f51/f52 to limit prices (they are not limit prices on ulist.np)', () => {
  const result = parseEastmoney({ data: { diff: [
    { f12: '600519', f13: 1, f14: '贵州茅台', f2: 1308.55, f18: 1306.45, f51: 271524528742.4, f52: 22132684069.8 },
    { f12: '000001', f13: 0, f14: '平安银行', f2: 11.27, f18: 11.25, f51: 0.0, f52: 10879000000.0 }
  ] } });
  // f51/f52 绝不能透出（v2.5.5 起有昨收时按规则推导：1306.45 → 1437.10/1175.81；
  // 推导值恰好与 stock/get 的真值一致，但来源是规则而非 f51 槽位）。
  assert.equal(result.sh600519?.limitUp, 1437.1, '推导值（非 f51 的 2715 亿）');
  assert.equal(result.sh600519?.limitDown, 1175.81, '推导值（非 f52）');
  assert.notEqual(result.sh600519?.limitUp, 271524528742.4, 'f51 不是涨停价，绝不能透出');
  assert.equal(result.sz000001?.limitUp, 12.38, '11.25 × 1.1 = 12.375 → 12.38');
  assert.equal(result.sz000001?.limitDown, 10.13, '11.25 × 0.9 = 10.125 → 10.13');
});

test('Eastmoney omits ratio/cap fields when the endpoint omits them', () => {
  const result = parseEastmoney({ data: { diff: [
    { f12: '600519', f13: 1, f14: '贵州茅台', f2: 1500 }
  ] } });
  assert.equal(result.sh600519?.turnoverRate, undefined);
  assert.equal(result.sh600519?.amplitude, undefined);
  assert.equal(result.sh600519?.volumeRatio, undefined);
  assert.equal(result.sh600519?.pe, undefined);
  assert.equal(result.sh600519?.pb, undefined);
  assert.equal(result.sh600519?.totalMarketCap, undefined);
  assert.equal(result.sh600519?.floatMarketCap, undefined);
  assert.equal(result.sh600519?.limitUp, undefined);
  assert.equal(result.sh600519?.limitDown, undefined);
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

test('Tencent keeps open/high/low/prevClose/volume fields', () => {
  const result = parseTencent(tencentLine('sh600519'));
  assert.equal(result.sh600519?.open, 1328.36);
  assert.equal(result.sh600519?.high, 1333.8);
  assert.equal(result.sh600519?.low, 1303.5);
  assert.equal(result.sh600519?.prevClose, 1328.36);
  assert.equal(result.sh600519?.volume, 28566);
});

test('Tencent omits detail fields when the endpoint omits them', () => {
  const result = parseTencent(tencentLine('sh600519', { 5: '', 33: '', 34: '', 36: '' }));
  assert.equal(result.sh600519?.open, undefined);
  assert.equal(result.sh600519?.high, undefined);
  assert.equal(result.sh600519?.low, undefined);
  assert.equal(result.sh600519?.volume, undefined);
});

test('Tencent keeps ratio/cap/limit detail fields (cap converted to yuan)', () => {
  const result = parseTencent(tencentLine('sh600519', {
    38: '0.20', 39: '19.78', 43: '1.10', 44: '16357.94', 45: '16357.94', 46: '7.02', 47: '1437.10', 48: '1175.81', 49: '0.52'
  }));
  assert.equal(result.sh600519?.turnoverRate, 0.2);
  assert.equal(result.sh600519?.amplitude, 1.1);
  assert.equal(result.sh600519?.volumeRatio, 0.52);
  assert.equal(result.sh600519?.pe, 19.78);
  assert.equal(result.sh600519?.pb, 7.02);
  assert.equal(result.sh600519?.totalMarketCap, 1635794000000);
  assert.equal(result.sh600519?.floatMarketCap, 1635794000000);
  assert.equal(result.sh600519?.limitUp, 1437.1);
  assert.equal(result.sh600519?.limitDown, 1175.81);
});

test('Tencent omits ratio/cap/limit fields when the endpoint omits them', () => {
  const result = parseTencent(tencentLine('sh600519', { 38: '', 39: '', 43: '', 44: '', 45: '', 46: '', 47: '', 48: '', 49: '' }));
  assert.equal(result.sh600519?.turnoverRate, undefined);
  assert.equal(result.sh600519?.amplitude, undefined);
  assert.equal(result.sh600519?.volumeRatio, undefined);
  assert.equal(result.sh600519?.pe, undefined);
  assert.equal(result.sh600519?.pb, undefined);
  assert.equal(result.sh600519?.totalMarketCap, undefined);
  assert.equal(result.sh600519?.floatMarketCap, undefined);
  // 涨跌停：真值缺失时按昨收 1328.36 推导（v2.5.5）——其余字段省略仍是 undefined。
  assert.equal(result.sh600519?.limitUp, 1461.2);
  assert.equal(result.sh600519?.limitDown, 1195.52);
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

// ===== 大盘指数（v2.1）=====
// fixture 取自 2026-02 实网响应（docs/调研-大盘指数支持.md §2）：
// 东财指数 f9/f23 上报 0、腾讯指数 [47]/[48] 上报 -1、北证50 行 87 字段——
// 三类哨兵值都必须在解析层消解，不许以 0.00 / -1.00 的形式流入展示层。

/** 东财指数行（实证：f13=1 f12=000001 上证指数，f9=0 f23=0）。 */
test('Eastmoney index row: pe/pb=0 sentinels are stripped, price/change kept', () => {
  const result = parseEastmoney({ data: { diff: [
    { f2: 3901.33, f3: 0.31, f4: 11.89, f5: 196647792, f6: 334159504351, f7: 0.63, f8: 0.41,
      f9: 0, f10: 2.44, f12: '000001', f13: 1, f14: '上证指数', f15: 3906.4, f16: 3881.74,
      f17: 3881.74, f18: 3889.44, f20: 68962964463057, f21: 61000631718705, f23: 0 }
  ] } });
  const quote = result.sh000001;
  assert.ok(quote, 'sh000001 上证指数规范化成功（f13=1 → sh）');
  assert.equal(quote.price, 3901.33);
  assert.equal(quote.change, 11.89);
  assert.equal(quote.changePercent, 0.31);
  assert.equal(quote.prevClose, 3889.44);
  assert.equal(quote.pe, undefined, '指数 PE=0 哨兵不得透出（会渲染 0.00）');
  assert.equal(quote.pb, undefined, '指数 PB=0 哨兵不得透出');
  assert.equal(quote.limitUp, undefined);
  assert.equal(quote.limitDown, undefined);
  assert.equal(quote.turnoverRate, 0.41, '换手率两源口径一致，保留');
  assert.equal(quote.totalMarketCap, 68962964463057);
});

/** 东财深市指数行（实证：f13=0 f12=399001 深证成指）。 */
test('Eastmoney sz index row maps to sz399001', () => {
  const result = parseEastmoney({ data: { diff: [
    { f2: 13769.35, f3: 0.17, f4: 23.48, f12: '399001', f13: 0, f14: '深证成指', f18: 13745.87 }
  ] } });
  assert.ok(result.sz399001, '399 段 + f13=0 → sz399001（指数）');
  assert.equal(result.sz399001?.price, 13769.35);
});

/** 腾讯指数行（实证：[47]/[48]=-1 哨兵，PE=17.70 与东财口径矛盾）。 */
test('Tencent index row: limit -1 sentinels dropped, contradictory pe stripped', () => {
  const result = parseTencent(tencentLine('sh000001', {
    1: '上证指数',
    3: '3901.27', 4: '3889.44', 31: '11.83', 32: '0.30',
    33: '3906.40', 34: '3881.74',
    35: '3901.27/196525082/333965502104',
    37: '33396550',
    38: '0.41', 39: '17.70', 43: '0.63',
    47: '-1', 48: '-1', 49: '2.41'
  }));
  const quote = result.sh000001;
  assert.ok(quote, 'v_sh000001 直接取用');
  assert.equal(quote.price, 3901.27);
  assert.equal(quote.changePercent, 0.30);
  assert.equal(quote.amount, 333965502104, '复合字段第三段为精确元值');
  assert.equal(quote.limitUp, undefined, '腾讯指数涨跌停 -1 哨兵不得透出（会渲染 -1.00）');
  assert.equal(quote.limitDown, undefined);
  assert.equal(quote.pe, undefined, '腾讯指数 PE 与东财矛盾（17.70 vs 0），解析层剔除');
});

/** 腾讯北证50 指数行（实证：87 字段，低于 88 但远高于哨兵阈值 6）。 */
test('Tencent bj index row parses with 87 fields', () => {
  const fields = new Array<string>(88).fill('');
  fields[0] = '1'; fields[1] = '北证50'; fields[2] = '899050';
  fields[3] = '1066.57'; fields[4] = '1063.20'; fields[5] = '1064.13';
  fields[31] = '3.37'; fields[32] = '0.32';
  fields[35] = '1066.57/2624886/5582851619'; fields[36] = '2624886'; fields[37] = '558285.16';
  const result = parseTencent(`v_bj899050="${fields.slice(0, 87).join('~')}";`);
  assert.ok(result.bj899050, '87 字段行解析成功');
  assert.equal(result.bj899050?.price, 1066.57);
  assert.equal(result.bj899050?.limitUp, undefined);
});

/** 股票行不受指数投影影响：PE/涨跌停真值保留。 */
test('stock rows keep pe and limit prices (index projection is index-only)', () => {
  const result = parseTencent(tencentLine('sh600519', { 39: '30.5', 47: '1432.0', 48: '1194.0' }));
  assert.equal(result.sh600519?.pe, 30.5);
  assert.equal(result.sh600519?.limitUp, 1432.0);
  assert.equal(result.sh600519?.limitDown, 1194.0);
});

/** 股票行涨跌停非正真值被过滤，缺失由规则推导兑底（v2.5.5）。 */
test('stock rows drop non-positive limit prices then derive from prevClose', () => {
  const result = parseTencent(tencentLine('sz000001', { 47: '0', 48: '-1' }));
  // 真值 0/-1 不透出；昨收 1328.36（tencentLine 默认 f4）是深主板 → 推导 1461.20/1195.52。
  assert.equal(result.sz000001?.limitUp, 1461.2, '非正真值过滤后按规则推导');
  assert.equal(result.sz000001?.limitDown, 1195.52);
});

// ===== 搜索：指数（SecurityType=5）=====

test('search returns exchange indices in addable segments with correct prefixes', () => {
  const result = parseEastmoneySearch({ QuotationCodeTable: { Data: [
    // 实证：上证指数 MktNum=1
    { Code: '000001', Name: '上证指数', SecurityType: '5', Classify: 'Index', MktNum: '1' },
    // 实证：深证成指 MktNum=0
    { Code: '399001', Name: '深证成指', SecurityType: '5', Classify: 'Index', MktNum: '0' },
    // 实证：北证50 Classify=34（不是 'Index'）、MktNum=0——靠 MktNum/Classify 会误判成深市
    { Code: '899050', Name: '北证50', SecurityType: '5', Classify: '34', MktNum: '0' },
    // 实证：生猪指数 980073——SecurityType=5 但不在可添加段位
    { Code: '980073', Name: '生猪指数', SecurityType: '5', Classify: 'Index', MktNum: '0' }
  ] } });
  assert.deepEqual(
    result.map((r) => ({ code: String(r.code), tags: [...r.tags] })),
    [
      { code: 'sh000001', tags: ['指数'] },
      { code: 'sz399001', tags: ['指数'] },
      { code: 'bj899050', tags: ['指数'] }
    ],
    '只放行 000/399/899 段，北证50 按段位归 bj'
  );
});

test('search does not leak index codes into stock prefix mapping', () => {
  // SecurityType=5 且 6 位数字但段位不明（假想 500xxx 指数）→ 拒掉，不走股票前缀推断。
  const result = parseEastmoneySearch({ QuotationCodeTable: { Data: [
    { Code: '500001', Name: '某跨市场指数', SecurityType: '5', Classify: 'Index', MktNum: '0' }
  ] } });
  assert.equal(result.length, 0);
});

// ===== 历史行情解析（v2.2）——fixture 取自 2026-08-26 实网响应 =====

test('parseEastmoneyTrends maps real trends row fields', () => {
  const result = parseEastmoneyTrends({ data: { trends: [
    '2026-08-26 09:30,1300.00,1300.00,1300.00,1300.00,176,22880000.00,1300.000',
    '2026-08-26 09:31,1299.00,1300.42,1303.00,1295.00,926,120311019.00,1299.209'
  ] } });
  assert.equal(result.length, 2);
  const second = result[1];
  // 字段映射（实证）：f52 价格 / f53 均价 / f54 高 / f55 低 / f56 量 / f57 额 / f58 量比
  assert.equal(second.price, 1299.00);
  assert.equal(second.avgPrice, 1300.42);
  assert.equal(second.high, 1303.00);
  assert.equal(second.low, 1295.00);
  assert.equal(second.volume, 926);
  assert.equal(second.amount, 120311019.00);
  assert.equal(second.volumeRatio, 1299.209);
  // 时间解析（+08:00）
  const d = new Date(second.time);
  assert.equal(d.getUTCHours() + 8, 9); // 北京时间 09:31 → UTC+8 校验（夏令时无关）
});

test('parseEastmoneyTrends skips malformed rows and empty payload', () => {
  assert.deepEqual(parseEastmoneyTrends({}), []);
  assert.deepEqual(parseEastmoneyTrends({ data: {} }), []);
  const result = parseEastmoneyTrends({ data: { trends: [
    '', // 空行
    '2026-08-26 09:31,1299.00,1300.42,1303.00', // 字段不足 8
    '2026-08-26 09:32,abc,1300.00,1300.00,1299.00,1,2,3' // 价格非法
  ] } });
  assert.equal(result.length, 0);
});

test('parseEastmoneyKline maps real kline row fields', () => {
  const result = parseEastmoneyKline({ data: { klines: [
    '2026-06-03,1275.98,1253.89,1275.98,1247.98,52477,6743202681.00,2.19,-1.98,-25.31,0.42'
  ] } });
  assert.equal(result.length, 1);
  const bar = result[0];
  assert.equal(bar.date, '2026-06-03');
  assert.equal(bar.open, 1275.98);
  assert.equal(bar.close, 1253.89);
  assert.equal(bar.high, 1275.98);
  assert.equal(bar.low, 1247.98);
  assert.equal(bar.volume, 52477);
  assert.equal(bar.amount, 6743202681.00);
  // 字段下标核对：f59 涨跌幅（parts[8]）≠ 振幅（parts[7]）
  assert.equal(bar.changePercent, -1.98);
  assert.equal(bar.turnoverRate, 0.42);
  assert.notEqual(bar.changePercent, 2.19, '涨跌幅不得取到振幅（f58）');
});

test('parseEastmoneyKline skips invalid rows', () => {
  const result = parseEastmoneyKline({ data: { klines: [
    '2026-06-03', // 字段不足
    'not-a-row',
    '2026-06-04,x,1,2,3,1,1,1,1,1,1' // 开盘非法
  ] } });
  assert.equal(result.length, 0);
});

// ===== 涨跌停补齐（v2.5.5）=====

test('Eastmoney rows derive limit prices from prevClose (batch endpoint lacks them)', () => {
  // 批量接口不返回涨跌停（f51/f52 无关量纲）——解析后按规则推导：1304 → 1434.40/1173.60。
  const result = parseEastmoney({ data: { diff: [
    { f2: 1311.02, f3: 0.54, f4: 7.02, f12: '600519', f13: 1, f14: '贵州茅台', f18: 1304 }
  ] } });
  assert.equal(result.sh600519?.limitUp, 1434.4);
  assert.equal(result.sh600519?.limitDown, 1173.6);
});

test('Eastmoney rows without prevClose keep limits undefined', () => {
  const result = parseEastmoney({ data: { diff: [
    { f2: 1311.02, f3: 0.54, f4: 7.02, f12: '600519', f13: 1, f14: '贵州茅台' }
  ] } });
  assert.equal(result.sh600519?.limitUp, undefined, '无昨收不推导（展示 --）');
  assert.equal(result.sh600519?.limitDown, undefined);
});

test('Tencent real limit values win over derived ones', () => {
  // 腾讯 [47]/[48] 有真值（15.0/9.0，非昨收 10 的推导值 11/9）——真值优先。
  const result = parseTencent(tencentLine('sz000001', { 47: '15.0', 48: '9.0' }));
  assert.equal(result.sz000001?.limitUp, 15.0, '真值优先');
  assert.equal(result.sz000001?.limitDown, 9.0);
});

test('Tencent sentinel-filtered limits fall back to derived values', () => {
  // [47]/[48]=-1 哨兵被过滤 → 按昨收 1328.36 推导（主板 ±10%）。
  const result = parseTencent(tencentLine('sh600519', { 47: '-1', 48: '-1' }));
  assert.equal(result.sh600519?.limitUp, 1461.2);  // 1328.36 × 1.1 = 1461.196 → 1461.20
  assert.equal(result.sh600519?.limitDown, 1195.52); // 1328.36 × 0.9 = 1195.524 → 1195.52
});

test('index rows never carry limit prices (derived or real)', () => {
  const em = parseEastmoney({ data: { diff: [
    { f2: 3901.33, f3: 0.31, f4: 11.89, f12: '000001', f13: 1, f14: '上证指数', f18: 3889.44 }
  ] } });
  assert.equal(em.sh000001?.limitUp, undefined, '指数即使有昨收也不推导');
  const tx = parseTencent(tencentLine('sh000001', { 1: '上证指数', 47: '-1', 48: '-1' }));
  assert.equal(tx.sh000001?.limitUp, undefined);
});
