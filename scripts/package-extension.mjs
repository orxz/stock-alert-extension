import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { validateManifest } from './validate-manifest.mjs';

export const RUNTIME_FILES = [
  'manifest.json',
  'background.js',
  'popup.html',
  'popup.css',
  'popup.js',
  'stock-utils.js',
  'storage.js',
  'quotes.js',
  'quote-service.js',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png',
  'privacy/index.html'
];

const FIXED_MTIME = new Date('1980-01-01T00:00:00.000Z');

export async function buildRelease(rootDir = new URL('../', import.meta.url)) {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', rootDir), 'utf8'));
  const errors = await validateManifest(manifest, rootDir);
  if (errors.length) throw new Error(errors.join('\n'));

  const entries = {};
  for (const file of RUNTIME_FILES) {
    const bytes = new Uint8Array(await readFile(new URL(file, rootDir)));
    entries[file] = [bytes, { mtime: FIXED_MTIME }];
  }

  const archive = zipSync(entries, { level: 9 });
  const outputDir = new URL('dist/', rootDir);
  const outputFile = new URL(`stock-alert-extension-v${manifest.version}.zip`, outputDir);
  await mkdir(outputDir, { recursive: true });
  await writeFile(outputFile, archive);
  const hash = createHash('sha256').update(archive).digest('hex');
  return { outputFile: fileURLToPath(outputFile), hash };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await buildRelease();
  console.log(`${result.hash}  ${result.outputFile}`);
}
