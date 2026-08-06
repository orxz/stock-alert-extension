// scripts/lib/ts7.mjs
// Programmatic access helper for TypeScript 7 (native/Go port).
// The main `typescript` entry only exports `version` (no createProgram/createSourceFile
// JS API). The official programmatic API lives in `typescript/unstable/sync` (RPC client
// to the native binary) plus `typescript/unstable/ast`. This module encapsulates:
// opening project snapshots, recursively collecting import/export/dynamic-import
// specifiers, and computing 1-based line numbers.
import { relative, sep } from 'node:path';

// The three v2 TS project configs (matching the tsconfig.json references).
export const PROJECT_CONFIGS = ['tsconfig.shared.json', 'tsconfig.background.json', 'tsconfig.popup.json'];

let cached = undefined;

// Lazily load the TS7 native API (unstable/sync + unstable/ast), once per process.
export async function loadTs7() {
  if (!cached) {
    const [sync, ast] = await Promise.all([
      import('typescript/unstable/sync'),
      import('typescript/unstable/ast')
    ]);
    cached = { API: sync.API, ast };
  }
  return cached;
}

// Open a snapshot over the three v2 src projects. Caller is responsible for api.close().
export async function openSourceSnapshot() {
  const { API } = await loadTs7();
  const api = new API();
  const snapshot = api.updateSnapshot({ openProjects: PROJECT_CONFIGS });
  return { api, snapshot, ast: (await loadTs7()).ast };
}

// Recursively walk the AST and collect module specifiers. Each item keeps the AST node
// so callers can compute line numbers:
//   { specifier: '...', kind: 'static' | 'dynamic' | 'import-equals' | 'export-from', node }
//   { specifier: undefined, kind: 'dynamic-nonliteral', node }  // non-literal dynamic import
export function collectImportSpecifiers(sourceFile, ast) {
  const out = [];
  const visit = (node) => {
    if (ast.isImportDeclaration(node) || ast.isExportDeclaration(node)) {
      const spec = node.moduleSpecifier;
      if (spec && typeof spec.text === 'string') {
        out.push({ specifier: spec.text, kind: ast.isImportDeclaration(node) ? 'static' : 'export-from', node });
      }
    } else if (ast.isImportEqualsDeclaration(node)) {
      const expr = node.moduleReference && node.moduleReference.expression;
      if (expr && typeof expr.text === 'string') {
        out.push({ specifier: expr.text, kind: 'import-equals', node });
      }
    } else if (ast.isCallExpression(node) && node.expression && node.expression.kind === ast.SyntaxKind.ImportKeyword) {
      const arg = node.arguments && node.arguments[0];
      if (arg && ast.isStringLiteral(arg)) {
        out.push({ specifier: arg.text, kind: 'dynamic', node });
      } else if (arg) {
        out.push({ specifier: undefined, kind: 'dynamic-nonliteral', node });
      }
    }
    return undefined;
  };
  const walk = (node) => {
    const result = visit(node);
    if (result !== undefined) return result;
    if (typeof node.forEachChild === 'function') {
      return node.forEachChild((child) => walk(child));
    }
    return undefined;
  };
  walk(sourceFile);
  return out;
}

// 1-based line number of a node; returns undefined when unavailable.
export function lineOf(sourceFile, node) {
  try {
    const text = sourceFile && sourceFile.text;
    const start = node && typeof node.getStart === 'function' ? node.getStart(sourceFile) : undefined;
    if (typeof text !== 'string' || start === undefined || start < 0) return undefined;
    let line = 1;
    for (let i = 0; i < start; i += 1) {
      if (text.charCodeAt(i) === 10) line += 1;
    }
    return line;
  } catch {
    return undefined;
  }
}

// Absolute path -> repo-relative path with forward slashes; undefined when outside the repo.
export function toRepoRelative(absPath) {
  const rel = relative(process.cwd(), absPath);
  if (rel.startsWith('..') || rel.startsWith(`${sep}..`)) return undefined;
  return rel.split(sep).join('/');
}
