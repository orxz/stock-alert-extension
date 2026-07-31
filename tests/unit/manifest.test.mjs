import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateManifest } from '../../scripts/validate-manifest.mjs';

const rootDir = new URL('../../', import.meta.url);

test('current manifest references existing local runtime files', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', rootDir), 'utf8'));
  assert.deepEqual(await validateManifest(manifest, rootDir), []);
});

test('validator rejects a missing alarms permission', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', rootDir), 'utf8'));
  const invalid = { ...manifest, permissions: manifest.permissions.filter((value) => value !== 'alarms') };
  const errors = await validateManifest(invalid, rootDir);
  assert.ok(errors.includes('permissions must include alarms'));
});
