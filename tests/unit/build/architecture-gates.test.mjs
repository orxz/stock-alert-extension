// tests/unit/build/architecture-gates.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeImports } from '../../../scripts/check-architecture.mjs';
import { validateRuntimeSpecifier } from '../../../scripts/check-runtime-imports.mjs';

test('domain cannot import infrastructure', () => {
  const errors = analyzeImports(new Map([
    ['src/domain/stock.ts', ['../infrastructure/storage/chrome-storage-adapter.js']]
  ]));
  assert.match(errors.join('\n'), /domain.*infrastructure/);
});

test('runtime imports require relative js targets', () => {
  assert.deepEqual(validateRuntimeSpecifier('react'), ['bare runtime import: react']);
  assert.deepEqual(validateRuntimeSpecifier('./stock'), ['runtime import must end in .js: ./stock']);
  assert.deepEqual(validateRuntimeSpecifier('./stock.js'), []);
});
