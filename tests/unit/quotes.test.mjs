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
