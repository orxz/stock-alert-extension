import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
global.StockUtils = require('../../stock-utils.js');
global.document = undefined;
const App = require('../../popup.js');

test('older quote generations cannot overwrite newer state', () => {
  App.state.quoteGeneration = 2;
  const applied = App.applyQuoteSnapshot({
    generation: 1,
    results: {},
    counts: { fresh: 0, cached: 0, missing: 0 },
    attemptedAt: 1,
    succeededAt: null
  });
  assert.equal(applied, false);
  assert.equal(App.state.quoteGeneration, 2);
});
