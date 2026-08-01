import assert from 'node:assert/strict';
import test from 'node:test';
import { RUNTIME_FILES } from '../../scripts/package-extension.mjs';

test('release allowlist contains new shared runtime modules and excludes project material', () => {
  assert.ok(RUNTIME_FILES.includes('stock-utils.js'));
  assert.ok(RUNTIME_FILES.includes('quote-service.js'));
  assert.ok(RUNTIME_FILES.includes('quote-format.js'));
  assert.ok(RUNTIME_FILES.includes('router.js'));
  assert.ok(RUNTIME_FILES.includes('popup-bridge.js'));
  assert.ok(RUNTIME_FILES.includes('popup-state.js'));
  assert.ok(RUNTIME_FILES.includes('popup-render.js'));
  assert.ok(RUNTIME_FILES.includes('popup-actions.js'));
  assert.ok(RUNTIME_FILES.includes('privacy/index.html'));
  assert.equal(RUNTIME_FILES.some((file) => file.startsWith('tests/')), false);
  assert.equal(RUNTIME_FILES.some((file) => file.startsWith('docs/')), false);
  assert.equal(RUNTIME_FILES.includes('package.json'), false);
});
