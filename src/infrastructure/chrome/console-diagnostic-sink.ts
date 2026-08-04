// src/infrastructure/chrome/console-diagnostic-sink.ts
// ConsoleDiagnosticSink：DiagnosticSink 的 Chrome/Console 实现。
// 将结构化诊断事件通过 console.log / console.error 输出到 Service Worker 控制台。
// 生产环境使用；测试使用收集 sink（内联数组）。
import type { DiagnosticSink, DiagnosticEvent } from '../../application/ports/diagnostics.js';

/**
 * Console 诊断 sink：将 DiagnosticEvent 输出到 console。
 * - outcome === 'failed' → console.error
 * - 其他 → console.log
 */
export class ConsoleDiagnosticSink implements DiagnosticSink {
  emit(event: DiagnosticEvent): void {
    if (event.outcome === 'failed') {
      console.error('[diagnostic]', event);
    } else {
      console.log('[diagnostic]', event);
    }
  }
}

/** 创建 ConsoleDiagnosticSink 实例的工厂函数。 */
export function createConsoleDiagnosticSink(): DiagnosticSink {
  return new ConsoleDiagnosticSink();
}
