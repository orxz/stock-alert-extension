import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const Quotes = require('../../quotes.js');

test('Eastmoney retains a partial valid response', async () => {
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return { data: { diff: [{ f12: '600519', f13: 1, f14: '贵州茅台', f2: 10, f18: 9, f3: 11.11, f4: 1 }] } };
    }
  });
  const result = await Quotes.fetchEastmoney(['sh600519', 'sz000001'], { fetchImpl });
  assert.deepEqual(Object.keys(result), ['sh600519']);
  assert.equal(result.sh600519.price, 10);
});

test('Sina parser returns only rows with usable names and prices', () => {
  const text = [
    'var hq_str_sz000001="平安银行,10.00,9.50,10.20,10.30,9.90,0,0,1000,10000";',
    'var hq_str_sh600519="";'
  ].join('\n');
  const result = Quotes.parseSina(text, ['sz000001', 'sh600519']);
  assert.deepEqual(Object.keys(result), ['sz000001']);
  assert.equal(result.sz000001.prevClose, 9.5);
});

test('transport layer has no demo generator', () => {
  assert.equal(Quotes._demo, undefined);
  assert.equal(Quotes.isDemo, undefined);
  assert.equal(Quotes.fetch, undefined);
});

test('search transport forwards the AbortSignal to injected fetch', async () => {
  const controller = new AbortController();
  let receivedSignal = null;
  const fetchImpl = async (_url, options) => {
    receivedSignal = options.signal;
    return {
      ok: true,
      async json() {
        return { QuotationCodeTable: { Data: [] } };
      }
    };
  };
  await Quotes.searchStocks('茅台', { fetchImpl, signal: controller.signal });
  assert.equal(receivedSignal, controller.signal);
});

test('search returns only supported six-digit A-share records', async () => {
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return {
        QuotationCodeTable: {
          Data: [
            { Code: '600519', Name: '贵州茅台', PinYin: 'GZMT', SecurityType: '1' },
            { Code: '920185', Name: '贝特瑞', SecurityType: '27' },
            { Code: '688001', Name: '科创', SecurityType: '25' },
            { Code: '000001', Name: '平安银行', Classify: 'AStock' },
            { Code: '00700', Name: '无效', SecurityType: '2' },
            { Code: '100001', Name: '非 A 股', SecurityType: '99' }
          ]
        }
      };
    }
  });
  const result = await Quotes.searchStocks('股', { fetchImpl });
  assert.deepEqual(result.map((item) => item.code), ['sh600519', 'bj920185', 'sh688001', 'sz000001']);
});

test('Sina transport decodes and parses the provider response', async () => {
  const text = 'var hq_str_sz000001="PINGAN,10.00,9.50,10.20,10.30,9.90,0,0,1000,10000";';
  const bytes = new TextEncoder().encode(text);
  const result = await Quotes.fetchSina(['sz000001'], {
    fetchImpl: async () => ({
      ok: true,
      async arrayBuffer() { return bytes.buffer; }
    })
  });
  assert.equal(result.sz000001.price, 10.2);
  assert.equal(result.sz000001.change, 0.7);
});

test('transports reject non-success HTTP responses', async () => {
  const fetchImpl = async () => ({ ok: false, status: 503 });
  await assert.rejects(() => Quotes.fetchEastmoney(['sh600519'], { fetchImpl }), /eastmoney HTTP 503/);
  await assert.rejects(() => Quotes.fetchSina(['sh600519'], { fetchImpl }), /sina HTTP 503/);
  await assert.rejects(() => Quotes.searchStocks('茅台', { fetchImpl }), /search HTTP 503/);
});

test('enrich converts unusable fields to null without dividing by zero', () => {
  const enriched = Quotes.enrich({
    name: '停牌',
    price: '-',
    prevClose: 0,
    open: '',
    high: undefined,
    low: null,
    volume: 'bad',
    amount: 0
  });
  assert.deepEqual(enriched, {
    name: '停牌',
    price: null,
    prevClose: 0,
    open: null,
    high: null,
    low: null,
    volume: null,
    amount: 0,
    change: null,
    changePercent: null
  });
  assert.equal(Quotes.enrich(null), null);
});

test('Eastmoney returns empty when the payload has no row array', async () => {
  const fetchImpl = async () => ({ ok: true, async json() { return { data: null }; } });
  const result = await Quotes.fetchEastmoney(['sh600519'], { fetchImpl });
  assert.deepEqual(result, {});
});

test('Eastmoney skips unusable rows and normalizes prefixes and fallbacks', async () => {
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return {
        data: {
          diff: [
            null,
            { f14: '无代码', f2: 1 },
            { f12: '000001', f13: 0, f2: 10 },
            { f12: '920185', f13: 0, f14: '贝特瑞', f2: 20 },
            { f12: '000858', f13: 0, f14: '五粮液', f2: 30 }
          ]
        }
      };
    }
  });
  const result = await Quotes.fetchEastmoney(['sz000858'], { fetchImpl });
  assert.deepEqual(Object.keys(result).sort(), ['bj920185', 'sz000001', 'sz000858']);
  assert.equal(result.sz000001.name, '000001');
  assert.equal(result.bj920185.price, 20);
  assert.equal(result.sz000858.price, 30);
});

test('Eastmoney keeps the original code when only the numeric suffix matches', async () => {
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return { data: { diff: [{ f12: '920185', f13: 0, f14: '贝特瑞', f2: 20 }] } };
    }
  });
  const result = await Quotes.fetchEastmoney(['SH920185'], { fetchImpl });
  assert.equal(result.SH920185.price, 20);
});

test('Sina transport short-circuits on an empty code list', async () => {
  let called = false;
  const result = await Quotes.fetchSina([], {
    fetchImpl: async () => { called = true; return { ok: true }; }
  });
  assert.deepEqual(result, {});
  assert.equal(called, false);
});

test('Sina parser skips non-quote lines and keeps unmatched response codes', () => {
  const text = [
    'this line is not a quote',
    'var hq_str_sz000002="万科A,10.00,9.00,10.50,10.60,9.80,0,0,100,1000";'
  ].join('\n');
  const result = Quotes.parseSina(text, ['sh600519']);
  assert.deepEqual(Object.keys(result), ['sz000002']);
  assert.equal(result.sz000002.change, 1.5);
});

test('_toSecids maps market prefixes to eastmoney secids', () => {
  assert.deepEqual(
    Quotes._toSecids(['bj920185', 'sh600519', 'sz000001']),
    ['0.920185', '1.600519', '0.000001']
  );
});

test('enrich defaults a missing name and derives change fields', () => {
  const enriched = Quotes.enrich({ price: 10, prevClose: 9 });
  assert.equal(enriched.name, '');
  assert.equal(enriched.change, 1);
  assert.equal(enriched.changePercent, 11.11);
});

test('Sina parser drops a zero price instead of reporting a suspended quote', () => {
  const text = 'var hq_str_sh600519="贵州茅台,0.00,1500.00,0.00,0.00,0.00,0,0,0,0";';
  const result = Quotes.parseSina(text, ['sh600519']);
  assert.deepEqual(result, {});
});

test('Sina parser never substitutes the open price for a zero current price', () => {
  const text = 'var hq_str_sh600519="贵州茅台,10.00,9.50,0.00,0.00,0.00,0,0,0,0";';
  const result = Quotes.parseSina(text, ['sh600519']);
  assert.deepEqual(result, {});
});

test('Eastmoney skips a zero-price row instead of reporting a fake crash', async () => {
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return {
        data: {
          diff: [{ f12: '600519', f13: 1, f14: '贵州茅台', f2: 0, f3: 0, f4: 0, f18: 1500 }]
        }
      };
    }
  });
  const result = await Quotes.fetchEastmoney(['sh600519'], { fetchImpl });
  assert.deepEqual(result, {});
});

test('enrich treats a zero price as missing and never derives a change', () => {
  const enriched = Quotes.enrich({ name: '停牌', price: 0, prevClose: 10 });
  assert.equal(enriched.price, null);
  assert.equal(enriched.change, null);
  assert.equal(enriched.changePercent, null);
});
