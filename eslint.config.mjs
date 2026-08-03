import babelParser from '@babel/eslint-parser';

const browserGlobals = {
  AbortController: 'readonly',
  clearInterval: 'readonly',
  clearTimeout: 'readonly',
  console: 'readonly',
  document: 'readonly',
  fetch: 'readonly',
  getComputedStyle: 'readonly',
  module: 'readonly',
  process: 'readonly',
  require: 'readonly',
  setInterval: 'readonly',
  setTimeout: 'readonly',
  structuredClone: 'readonly',
  TextDecoder: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  window: 'readonly',
  chrome: 'readonly',
  importScripts: 'readonly',
  Bridge: 'readonly',
  Quotes: 'readonly',
  QuoteService: 'readonly',
  QuoteFormat: 'readonly',
  Router: 'readonly',
  Storage: 'readonly',
  StockUtils: 'readonly',
  State: 'readonly',
  Render: 'readonly',
  Actions: 'readonly',
  createStorage: 'readonly',
  DEFAULT_GROUP_ID: 'readonly'
};

export default [
  { ignores: ['coverage/**', 'dist/**', 'node_modules/**', 'playwright-report/**', 'test-results/**', 'build/**'] },
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
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: { presets: ['@babel/preset-typescript'] },
        ecmaVersion: 2022,
        sourceType: 'module'
      },
      globals: {
        AbortController: 'readonly',
        chrome: 'readonly',
        clearInterval: 'readonly',
        clearTimeout: 'readonly',
        console: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        getComputedStyle: 'readonly',
        location: 'readonly',
        setInterval: 'readonly',
        setTimeout: 'readonly',
        structuredClone: 'readonly',
        TextDecoder: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        window: 'readonly'
      }
    },
    rules: {
      'no-async-promise-executor': 'error',
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
        chrome: 'readonly',
        document: 'readonly',
        getComputedStyle: 'readonly',
        StockUtils: 'readonly',
        TextEncoder: 'readonly',
        URL: 'readonly',
        console: 'readonly',
        global: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        structuredClone: 'readonly'
      }
    },
    rules: { 'no-undef': 'error', 'no-eval': 'error', 'no-new-func': 'error' }
  }
];
