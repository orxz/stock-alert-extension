import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const REQUIRED_HOSTS = [
  'https://hq.sinajs.cn/*',
  'https://push2.eastmoney.com/*',
  'https://searchapi.eastmoney.com/*'
];

export async function validateManifest(manifest, rootDir) {
  const errors = [];
  if (manifest.manifest_version !== 3) errors.push('manifest_version must equal 3');
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version || '')) errors.push('version must use x.y.z');
  if (!manifest.permissions?.includes('storage')) errors.push('permissions must include storage');
  if (!manifest.permissions?.includes('alarms')) errors.push('permissions must include alarms');
  if (JSON.stringify(manifest.host_permissions || []) !== JSON.stringify(REQUIRED_HOSTS)) {
    errors.push('host_permissions must match the approved three hosts');
  }

  const files = [
    manifest.action?.default_popup,
    manifest.background?.service_worker,
    ...Object.values(manifest.action?.default_icon || {}),
    ...Object.values(manifest.icons || {})
  ].filter(Boolean);

  for (const file of new Set(files)) {
    try {
      await access(new URL(file, rootDir));
    } catch {
      errors.push(`missing runtime file: ${file}`);
    }
  }
  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootDir = new URL('../', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', rootDir), 'utf8'));
  const errors = await validateManifest(manifest, rootDir);
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`manifest ${manifest.version} is valid`);
  }
}
