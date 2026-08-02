// scripts/check-bundle-size.mjs — 检查打包 ZIP 体积是否在合理范围内
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const ZIP_PATH = join(root, 'dist', 'stock-alert-extension-v1.3.0.zip');
const MAX_SIZE_KB = 200; // 200 KB 警告阈值
const HARD_LIMIT_KB = 500; // 500 KB 硬限制

try {
  const stats = statSync(ZIP_PATH);
  const sizeKB = Math.round(stats.size / 1024);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

  console.log(`📦 Extension ZIP: ${sizeKB} KB (${sizeMB} MB)`);

  if (sizeKB > HARD_LIMIT_KB) {
    console.error(`❌ Bundle size ${sizeKB} KB exceeds hard limit ${HARD_LIMIT_KB} KB`);
    process.exit(1);
  }

  if (sizeKB > MAX_SIZE_KB) {
    console.warn(`⚠️  Bundle size ${sizeKB} KB exceeds warning threshold ${MAX_SIZE_KB} KB`);
  } else {
    console.log(`✅ Bundle size within acceptable range`);
  }
} catch (error) {
  console.error(`❌ Cannot stat ZIP: ${error.message}`);
  console.error('   Run `npm run package:extension` first.');
  process.exit(1);
}
