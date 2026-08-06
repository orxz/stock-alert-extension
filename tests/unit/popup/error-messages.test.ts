// tests/unit/popup/error-messages.test.ts
// 展示层友好文案映射：把 RPC/Provider 层的英文技术错误转成用户可读的中文信息。
import assert from 'node:assert/strict';
import test from 'node:test';
import { friendlyErrorMessage } from '../../../src/popup/error-messages.js';

test('maps structured error codes to friendly Chinese messages', () => {
  assert.equal(
    friendlyErrorMessage({ code: 'CONFLICT', message: 'user data revision mismatch', retryable: true }, 'fallback'),
    '数据已在其他窗口更新，已同步最新内容，请重试'
  );
  assert.equal(
    friendlyErrorMessage({ code: 'QUOTE_TIMEOUT', message: 'x', retryable: true }, 'fallback'),
    '行情请求超时，请稍后重试'
  );
  assert.equal(
    friendlyErrorMessage({ code: 'QUOTE_UNAVAILABLE', message: 'x', retryable: false }, 'fallback'),
    '行情服务暂时不可用，请稍后重试'
  );
  assert.equal(
    friendlyErrorMessage({ code: 'SEARCH_UNAVAILABLE', message: 'x', retryable: false }, 'fallback'),
    '搜索服务暂时不可用，请稍后重试'
  );
  assert.equal(
    friendlyErrorMessage({ code: 'STORAGE_UNAVAILABLE', message: 'x', retryable: false }, 'fallback'),
    '本地存储不可用，请检查浏览器隐私设置'
  );
  assert.equal(
    friendlyErrorMessage({ code: 'PROTOCOL_MISMATCH', message: 'x', retryable: false }, 'fallback'),
    '扩展版本不一致，请刷新页面后重试'
  );
  assert.equal(
    friendlyErrorMessage({ code: 'VALIDATION_FAILED', message: 'x', retryable: false }, 'fallback'),
    '输入内容无效，请检查后重试'
  );
  assert.equal(
    friendlyErrorMessage({ code: 'NOT_FOUND', message: 'x', retryable: false }, 'fallback'),
    '未找到相关数据'
  );
  assert.equal(
    friendlyErrorMessage({ code: 'INTERNAL', message: 'internal error', retryable: false }, 'fallback'),
    '出现未知错误，请稍后重试'
  );
});

test('classifies provider-level raw errors by message shape', () => {
  assert.equal(
    friendlyErrorMessage({ code: 'UNKNOWN', message: 'Failed to fetch', retryable: true }, 'fallback'),
    '网络连接失败，请检查网络后重试'
  );
  assert.equal(
    friendlyErrorMessage({ code: 'UNKNOWN', message: 'eastmoney HTTP 403', retryable: true }, 'fallback'),
    '行情服务暂时不可用，请稍后重试'
  );
  assert.equal(
    friendlyErrorMessage({ code: 'UNKNOWN', message: 'tencent HTTP 0', retryable: true }, 'fallback'),
    '行情服务暂时不可用，请稍后重试'
  );
  assert.equal(
    friendlyErrorMessage({ code: 'UNKNOWN', message: 'quotes timeout after 8000ms', retryable: true }, 'fallback'),
    '请求超时，请稍后重试'
  );
  assert.equal(
    friendlyErrorMessage({ code: 'UNKNOWN', message: 'search HTTP 502', retryable: false }, 'fallback'),
    '搜索服务暂时不可用，请稍后重试'
  );
  // \bsearch\b 要求独立词——含 search 子串的英文单词（research）不应被误分类。
  assert.equal(
    friendlyErrorMessage({ code: 'UNKNOWN', message: 'research index unavailable', retryable: false }, 'fallback'),
    'fallback'
  );
  assert.equal(
    friendlyErrorMessage({ code: 'UNKNOWN', message: 'storage quota exceeded', retryable: false }, 'fallback'),
    '本地存储不可用，请检查浏览器隐私设置'
  );
});

test('falls back for unknown messages instead of leaking technical detail', () => {
  assert.equal(friendlyErrorMessage({ code: 'UNKNOWN', message: 'weird internal thing', retryable: false }, '加载失败'), '加载失败');
  assert.equal(friendlyErrorMessage(null, '加载失败'), '加载失败');
  assert.equal(friendlyErrorMessage(undefined, '加载失败'), '加载失败');
  assert.equal(friendlyErrorMessage({ code: 42, message: 42 }, '加载失败'), '加载失败');
  assert.equal(friendlyErrorMessage({ code: 'UNKNOWN', message: '', retryable: false }, '加载失败'), '加载失败');
});
