// scripts/check-runtime-imports.mjs
// v2 runtime import spec gate. Before the build it parses every src/**/*.ts through the
// TS7 native Compiler API and enforces: relative imports must end in .js, no bare imports,
// and dynamic import arguments must be string literals. After the build it parses every
// emitted build/extension/runtime/**/*.js and resolves relative specifiers with
// new URL(specifier, fileUrl), requiring the target file to exist.
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readdir } from 'node:fs/promises';
import { collectImportSpecifiers, lineOf, loadTs7, openSourceSnapshot, toRepoRelative } from './lib/ts7.mjs';

// Brief Step 4 verbatim.
export function validateRuntimeSpecifier(specifier) {
  if (!specifier.startsWith('.')) return [`bare runtime import: ${specifier}`];
  if (!specifier.endsWith('.js')) return [`runtime import must end in .js: ${specifier}`];
  return [];
}

// Recursively list *.js files under a directory (returns repo-relative posix paths).
async function listRuntimeJsFiles() {
  const root = 'build/extension/runtime';
  const out = [];
  const walk = async (dir) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
    }
  };
  await walk(root);
  return out;
}

// Parse the src import graph and validate every specifier. Returns error messages.
export async function checkSourceImports() {
  const { api, snapshot, ast } = await openSourceSnapshot();
  try {
    const errors = [];
    for (const project of snapshot.getProjects()) {
      for (const fileName of project.program.getSourceFileNames()) {
        const rel = toRepoRelative(fileName);
        if (!rel || !rel.startsWith('src/')) continue;
        const sf = project.program.getSourceFile(fileName);
        if (!sf) continue;
        for (const item of collectImportSpecifiers(sf, ast)) {
          const line = lineOf(sf, item.node);
          const where = line === undefined ? rel : `${rel}:${line}`;
          if (item.kind === 'dynamic-nonliteral') {
            errors.push(`${where}: dynamic import argument must be a string literal`);
            continue;
          }
          for (const message of validateRuntimeSpecifier(item.specifier)) {
            errors.push(`${where}: ${message}`);
          }
        }
      }
    }
    return errors;
  } finally {
    api.close();
  }
}

// Validate emitted runtime JS: relative specifiers must resolve to existing files.
// Skipped (not failed) when build/extension/runtime is absent so the gate can run
// standalone before a build; `npm run check` always builds first.
export async function checkEmittedImports() {
  const jsFiles = await listRuntimeJsFiles();
  if (jsFiles.length === 0) {
    return { skipped: true, errors: [] };
  }
  const { API, ast } = await loadTs7();
  const api = new API();
  try {
    const snapshot = api.updateSnapshot({ openFiles: jsFiles });
    const errors = [];
    const seen = new Set();
    for (const project of snapshot.getProjects()) {
      for (const fileName of project.program.getSourceFileNames()) {
        const rel = toRepoRelative(fileName);
        if (!rel || !rel.startsWith('build/extension/runtime/') || seen.has(rel)) continue;
        seen.add(rel);
        const sf = project.program.getSourceFile(fileName);
        if (!sf) continue;
        for (const item of collectImportSpecifiers(sf, ast)) {
          const line = lineOf(sf, item.node);
          const where = line === undefined ? rel : `${rel}:${line}`;
          if (item.kind === 'dynamic-nonliteral') {
            errors.push(`${where}: dynamic import argument must be a string literal`);
            continue;
          }
          const specErrors = validateRuntimeSpecifier(item.specifier);
          if (specErrors.length > 0) {
            errors.push(`${where}: ${specErrors[0]}`);
            continue;
          }
          const targetUrl = new URL(item.specifier, pathToFileURL(fileName));
          try {
            await access(fileURLToPath(targetUrl));
          } catch {
            errors.push(`${where}: emitted import target not found: ${item.specifier}`);
          }
        }
      }
    }
    return { skipped: false, errors };
  } finally {
    api.close();
  }
}

async function main() {
  const errors = [];
  errors.push(...await checkSourceImports());
  const emitted = await checkEmittedImports();
  if (emitted.skipped) {
    console.log('check:runtime-imports [skip] build/extension/runtime not found - run npm run build first');
  } else {
    errors.push(...emitted.errors);
  }
  if (errors.length > 0) {
    console.error('check:runtime-imports FAILED');
    for (const error of errors) console.error(`  ${error}`);
    process.exit(1);
  }
  console.log(`check:runtime-imports OK (${emitted.skipped ? 'source only' : 'source + emitted'})`);
}

const entryPath = process.argv[1];
if (entryPath && resolve(entryPath) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('check:runtime-imports ERROR', error && error.stack ? error.stack : error);
    process.exit(1);
  });
}
