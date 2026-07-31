const browserGlobals = {
  AbortController: 'readonly',
  clearInterval: 'readonly',
  clearTimeout: 'readonly',
  console: 'readonly',
  document: 'readonly',
  fetch: 'readonly',
  module: 'readonly',
  process: 'readonly',
  setInterval: 'readonly',
  setTimeout: 'readonly',
  structuredClone: 'readonly',
  TextDecoder: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  window: 'readonly',
  chrome: 'readonly',
  importScripts: 'readonly',
  App: 'readonly',
  Quotes: 'readonly',
  QuoteService: 'readonly',
  Storage: 'readonly',
  StockUtils: 'readonly',
  DEFAULT_GROUP_ID: 'readonly'
};

export default [
  { ignores: ['coverage/**', 'dist/**', 'node_modules/**', 'playwright-report/**', 'test-results/**'] },
  {
    files: ['*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: browserGlobals },
    rules: {
      'no-async-promise-executor': 'error',
      'no-constant-binary-expression': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-undef': 'error',
      'no-unsafe-finally': 'error'
    }
  },
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.mjs', '*.config.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        AbortController: 'readonly',
        Buffer: 'readonly',
        StockUtils: 'readonly',
        URL: 'readonly',
        console: 'readonly',
        global: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        structuredClone: 'readonly'
      }
    },
    rules: { 'no-undef': 'error', 'no-eval': 'error', 'no-new-func': 'error' }
  }
];
