import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildExtension } from '../../../scripts/build-extension.mjs';

test('formal build emits only v2 module entries', async () => {
  const root = new URL('../../../', import.meta.url);
  await buildExtension(root);
  const manifest = JSON.parse(await readFile(new URL('build/extension/manifest.json', root), 'utf8'));
  assert.equal(manifest.version, '2.0.0');
  assert.equal(manifest.background.type, 'module');
  assert.equal(manifest.background.service_worker, 'runtime/background/main.js');
  await access(new URL('build/extension/runtime/popup/main.js', root));
});
