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
