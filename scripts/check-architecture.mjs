// scripts/check-architecture.mjs
// v2 architecture boundary gate. Reads the static import graph of src/**/*.ts through the
// TS7 native Compiler API (typescript/unstable/sync), enforces the layer dependency table
// from the Task 3 brief (allowed), runs DFS cycle detection over internal edges, and
// verifies src/domain + src/protocol compile without DOM/Chrome types.
// The pure function analyzeImports(programOrMap) accepts a Map<string, string[]> (unit-test
// injection shape) or a TS7 Snapshot (getProjects()).
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectImportSpecifiers, openSourceSnapshot, toRepoRelative } from './lib/ts7.mjs';

export const LAYERS = ['domain', 'protocol', 'application', 'infrastructure', 'background', 'popup'];

// Task 3 brief Step 3 allowed table (verbatim).
export const allowed = {
  domain: new Set(['domain']),
  protocol: new Set(['protocol', 'domain']),
  application: new Set(['application', 'domain', 'protocol']),
  infrastructure: new Set(['infrastructure', 'application', 'domain', 'protocol']),
  background: new Set(['background', 'infrastructure', 'application', 'domain', 'protocol']),
  popup: new Set(['popup', 'application', 'domain', 'protocol'])
};

const LAYER_RE = /^src\/(domain|protocol|application|infrastructure|background|popup)\//;

function layerOf(relPath) {
  const match = LAYER_RE.exec(relPath);
  return match ? match[1] : undefined;
}

// Resolve a relative specifier against a repo-relative source path; returns the
// normalized repo-relative target (forward slashes).
function resolveRelative(sourceRel, specifier) {
  return normalize(join(dirname(sourceRel), specifier)).split('\\').join('/');
}

// Canonical node name for cycle detection/dedup: strip the extension and a trailing index.
function canonicalize(relPath) {
  const parts = relPath.replace(/\.(ts|js|mjs|cjs)$/, '').split('/');
  if (parts[parts.length - 1] === 'index') parts.pop();
  return parts.join('/');
}

// Depth-first cycle detection. Errors look like: cycle: a.ts -> b.ts -> a.ts.
// `display` maps canonical names to human-readable paths.
function detectCycles(edges, display) {
  const errors = [];
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map();
  const stack = [];
  const seen = new Set();
  for (const node of edges.keys()) color.set(node, WHITE);
  const visit = (node) => {
    color.set(node, GRAY);
    stack.push(node);
    const nexts = edges.get(node) || [];
    for (const next of nexts) {
      const state = color.get(next) ?? WHITE;
      if (state === GRAY) {
        const start = stack.indexOf(next);
        const cycle = [...stack.slice(start), next];
        const path = cycle.map((name) => (display?.get(name) ?? name)).join(' -> ');
        if (!seen.has(path)) {
          seen.add(path);
          errors.push(`cycle: ${path}`);
        }
      } else if (state === WHITE) {
        visit(next);
      }
    }
    stack.pop();
    color.set(node, BLACK);
  };
  for (const node of edges.keys()) {
    if ((color.get(node) ?? WHITE) === WHITE) visit(node);
  }
  return errors;
}

/**
 * Enforce the layer rules (pure function; injectable via Map).
 * @param {Map<string,string[]>|object} programOrMap A Map (repo-relative source path ->
 *   specifier array) or a TS7 Snapshot with getProjects() (graph extracted synchronously).
 * @returns {string[]} Violation messages (empty array means pass).
 */
export function analyzeImports(programOrMap) {
  const graph = programOrMap instanceof Map ? programOrMap : extractGraphFromSnapshot(programOrMap, astCache);
  const errors = [];
  const nodes = new Set();
  const edges = new Map();
  const displayNames = new Map();

  for (const [sourceRel, specifiers] of graph) {
    const sourceLayer = layerOf(sourceRel);
    if (!sourceLayer) continue; // files outside the six src/ layers are not part of the graph
    const sourceCanon = canonicalize(sourceRel);
    nodes.add(sourceCanon);
    displayNames.set(sourceCanon, sourceRel);
    for (const specifier of specifiers) {
      if (typeof specifier !== 'string' || !specifier.startsWith('.')) continue; // bare/dynamic -> runtime-imports gate
      const resolved = resolveRelative(sourceRel, specifier);
      if (!resolved.startsWith('src/')) {
        // Relative imports must stay inside the src/ tree; escaping it (e.g. up to a
        // repo-root layer dir) is an architecture violation.
        errors.push(`${sourceRel}: ${sourceLayer} cannot import outside src/ (${specifier} resolves to ${resolved})`);
        continue;
      }
      const targetLayer = layerOf(resolved);
      if (!targetLayer) continue; // inside src/ but not a layer root (e.g. src/shared): no layer edge
      if (sourceLayer !== targetLayer && !allowed[sourceLayer].has(targetLayer)) {
        if (sourceLayer === 'popup' && (targetLayer === 'infrastructure' || targetLayer === 'background')) {
          errors.push(`${sourceRel}: popup must not import ${targetLayer} (${specifier})`);
        } else {
          errors.push(`${sourceRel}: ${sourceLayer} cannot import ${targetLayer} (${specifier})`);
        }
      }
      const targetCanon = canonicalize(resolved);
      if (!edges.has(sourceCanon)) edges.set(sourceCanon, new Set());
      edges.get(sourceCanon).add(targetCanon);
    }
  }

  // Keep only edges whose endpoints are both graph nodes for cycle detection.
  for (const targets of edges.values()) {
    for (const target of [...targets]) {
      if (!nodes.has(target)) targets.delete(target);
      else if (!displayNames.has(target)) displayNames.set(target, `${target}.ts`);
    }
  }

  errors.push(...detectCycles(edges, displayNames));

  return errors;
}

// Synchronously extract the import graph from a TS7 Snapshot (analyzeImports program form).
function extractGraphFromSnapshot(snapshot, ast) {
  if (!snapshot || typeof snapshot.getProjects !== 'function') {
    throw new Error('analyzeImports: expected a Map<string, string[]> or a TS7 Snapshot (getProjects())');
  }
  if (!ast) {
    throw new Error('analyzeImports: Snapshot form requires a loaded TS7 ast module (call extractImportGraph first)');
  }
  const graph = new Map();
  const seen = new Set();
  for (const project of snapshot.getProjects()) {
    for (const fileName of project.program.getSourceFileNames()) {
      const rel = toRepoRelative(fileName);
      if (!rel || !rel.startsWith('src/') || seen.has(rel)) continue;
      seen.add(rel);
      const sf = project.program.getSourceFile(fileName);
      if (!sf) continue;
      const specs = collectImportSpecifiers(sf, ast)
        .filter((item) => typeof item.specifier === 'string')
        .map((item) => item.specifier);
      if (specs.length) graph.set(rel, specs);
    }
  }
  return graph;
}

let astCache = undefined;

// Extract the real src/**/*.ts static import graph via the TS7 native API.
export async function extractImportGraph() {
  const { api, snapshot, ast } = await openSourceSnapshot();
  astCache = ast;
  try {
    return extractGraphFromSnapshot(snapshot, ast);
  } finally {
    api.close();
  }
}

// src/domain and src/protocol must resolve without DOM/Chrome types: check the lib/types
// of every project that contains domain/protocol source files.
export async function checkDomainProtocolTypeEnvironment() {
  const { api, snapshot } = await openSourceSnapshot();
  try {
    const errors = [];
    for (const project of snapshot.getProjects()) {
      const rootFiles = project.rootFiles || [];
      const coversDomainOrProtocol = rootFiles.some(
        (file) => /\/src\/(domain|protocol)\//.test(file) || /^src\/(domain|protocol)\//.test(file)
      );
      if (!coversDomainOrProtocol) continue;
      const lib = project.compilerOptions?.lib || [];
      const types = project.compilerOptions?.types || [];
      const badLib = lib.filter((name) => /lib\.dom|webworker/.test(name));
      const hasChrome = types.includes('chrome');
      if (badLib.length > 0 || hasChrome) {
        const config = toRepoRelative(project.configFileName) || project.configFileName;
        errors.push(
          `src/domain and src/protocol must resolve without DOM/Chrome types: ${config} exposes lib=[${lib.join(', ')}] types=[${types.join(', ')}]`
        );
      }
    }
    return errors;
  } finally {
    api.close();
  }
}

async function main() {
  const graph = await extractImportGraph();
  const errors = analyzeImports(graph);
  const envErrors = await checkDomainProtocolTypeEnvironment();
  errors.push(...envErrors);
  if (errors.length > 0) {
    console.error('check:architecture FAILED');
    for (const error of errors) console.error(`  ${error}`);
    process.exit(1);
  }
  console.log(`check:architecture OK (${graph.size} src files with imports)`);
}

const entryPath = process.argv[1];
if (entryPath && resolve(entryPath) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('check:architecture ERROR', error && error.stack ? error.stack : error);
    process.exit(1);
  });
}
