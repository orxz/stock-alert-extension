// src/application/diagnostics/span.ts
// 诊断 span：exactly-once 的 start / boundary / end 结构化日志发射器。
// 纯 Application 层——仅 import 同层 application/ports。
// Brief Step 4 逐字实现：startSpan 发射 `${type}:start`，返回 { boundary, end }。
// end 是幂等的（ended 标志），多次调用只发射一次 `${type}:end`。
import type { DiagnosticSink, DiagnosticEvent } from '../ports/diagnostics.js';

/**
 * startSpan 返回的 span 句柄。
 * - boundary(event): 发射中间事件（如 deadline / cache-fallback）。
 * - end(event): 发射 `${type}:end`，幂等——多次调用只发射一次。
 */
export interface Span {
  boundary(event: DiagnosticEvent): void;
  end(event: DiagnosticEvent): void;
}

/**
 * 启动诊断 span：立即发射 `${start.type}:start`，返回 { boundary, end }。
 *
 * 用法：
 * ```ts
 * const span = startSpan(sink, { timestamp, version: '2.0.0', scope: 'quote', type: 'refresh' });
 * // ... 执行用例 ...
 * span.boundary({ ..., type: 'deadline', outcome: 'degraded' }); // 可选中间事件
 * span.end({ ..., outcome: 'ok' }); // 发射 `refresh:end`（幂等）
 * ```
 *
 * end 幂等性：内部 ended 标志保证多次调用只发射一次 `${type}:end`。
 */
export function startSpan(sink: DiagnosticSink, start: DiagnosticEvent): Span {
  let ended = false;
  sink.emit({ ...start, type: `${start.type}:start` });
  return {
    boundary(event: DiagnosticEvent): void {
      sink.emit(event);
    },
    end(event: DiagnosticEvent): void {
      if (ended) return;
      ended = true;
      sink.emit({ ...event, type: `${start.type}:end` });
    }
  };
}
