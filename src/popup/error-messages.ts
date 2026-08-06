// src/popup/error-messages.ts
// 展示层友好文案映射：把 RPC / Provider 层的英文技术错误转成用户可读的中文信息。
// 纯函数、零依赖，可独立测试。
//
// 为什么需要它：background 侧 AppError 的 message 是给开发者的稳定文案
// （'user data revision mismatch …'、'eastmoney HTTP 403'），Provider 抛的更是
// 裸 Error（'Failed to fetch'）。这些直接透给用户既不友好也泄露实现细节。
// 映射策略：结构化错误码（AppError.code）优先；无码时按 message 特征兜底分类；
// 两者都未命中则回退到调用方提供的中文 fallback——绝不把未分类的英文透出去。

/** 可被映射的错误形态（ClientError / AppError 均满足）。 */
export interface ErrorLike {
  readonly code?: unknown;
  readonly message?: unknown;
}

/** 结构化错误码 → 友好文案。 */
const CODE_MESSAGES: Readonly<Record<string, string>> = {
  CONFLICT: '数据已在其他窗口更新，已同步最新内容，请重试',
  QUOTE_TIMEOUT: '行情请求超时，请稍后重试',
  QUOTE_UNAVAILABLE: '行情服务暂时不可用，请稍后重试',
  SEARCH_UNAVAILABLE: '搜索服务暂时不可用，请稍后重试',
  STORAGE_UNAVAILABLE: '本地存储不可用，请检查浏览器隐私设置',
  PROTOCOL_MISMATCH: '扩展版本不一致，请刷新页面后重试',
  VALIDATION_FAILED: '输入内容无效，请检查后重试',
  NOT_FOUND: '未找到相关数据',
  INTERNAL: '出现未知错误，请稍后重试'
};

/** message 特征 → 友好文案。顺序即优先级：更具体的判定在前。 */
const MESSAGE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/failed to fetch|networkerror|load failed|fetch failed/i, '网络连接失败，请检查网络后重试'],
  [/timeout|timed out/i, '请求超时，请稍后重试'],
  // \bsearch\b 要求独立词——「research」这类含子串的英文不会被误分类。
  [/\bsearch\b/i, '搜索服务暂时不可用，请稍后重试'],
  [/http|eastmoney|tencent|quote|provider/i, '行情服务暂时不可用，请稍后重试'],
  [/storage|quota/i, '本地存储不可用，请检查浏览器隐私设置'],
  [/internal error/i, '出现未知错误，请稍后重试']
];

/**
 * 把错误映射为面向用户的友好文案。
 * @param error 任意错误形态；code/message 缺失或非字符串时按未知处理。
 * @param fallback 无法分类时的兜底中文文案（调用方按场景提供）。
 */
export function friendlyErrorMessage(error: ErrorLike | null | undefined, fallback: string): string {
  const code = typeof error?.code === 'string' ? error.code : '';
  if (code) {
    const byCode = CODE_MESSAGES[code];
    if (byCode) return byCode;
  }

  const message = typeof error?.message === 'string' ? error.message : '';
  if (message) {
    for (const [pattern, friendly] of MESSAGE_PATTERNS) {
      if (pattern.test(message)) return friendly;
    }
  }

  return fallback;
}
