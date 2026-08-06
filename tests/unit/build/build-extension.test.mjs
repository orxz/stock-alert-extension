import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildExtension } from '../../../scripts/build-extension.mjs';

test('formal build emits only v2 module entries', async () => {
  const root = new URL('../../../', import.meta.url);
  await buildExtension(root);
  const manifest = JSON.parse(await readFile(new URL('build/extension/manifest.json', root), 'utf8'));
  // 版本号取自唯一真相 extension/manifest.json，而不是写死字面量——
  // 写死会让每次版本升级都以「测试失败」的形式表现，掩盖真正要断言的东西：
  // 构建产物的版本必须与源 manifest 一致（构建不得篡改版本）。
  const source = JSON.parse(await readFile(new URL('extension/manifest.json', root), 'utf8'));
  assert.equal(manifest.version, source.version);
  assert.equal(manifest.background.type, 'module');
  assert.equal(manifest.background.service_worker, 'runtime/background/main.js');
  await access(new URL('build/extension/runtime/popup/main.js', root));
});
