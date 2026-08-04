// src/application/ports/diagnostics.ts
// 诊断端口接口：Application 层通过此接口发射结构化诊断事件。
// 纯接口——只 import domain/protocol，不依赖 infrastructure/console/Chrome。
// 具体实现（ConsoleDiagnosticSink）在 infrastructure 层。
import type { ErrorCode } from '../../domain/errors.js';

/**
 * 诊断事件：结构化日志，贯穿 RPC、storage、quote、search 等所有用例。
 * 每个事件包含时间戳、版本、scope 和 type，可选附带 outcome / duration / counts。
 */
export interface DiagnosticEvent {
  readonly timestamp: number;
  readonly version: '2.0.0';
  readonly requestId?: string;
  readonly runId?: string;
  readonly scope: 'rpc' | 'storage' | 'quote' | 'search' | 'scheduler' | 'ui';
  readonly type: string;
  readonly outcome?: 'ok' | 'degraded' | 'failed';
  readonly durationMs?: number;
  readonly errorCode?: ErrorCode;
  readonly counts?: Readonly<Record<string, number>>;
}

/**
 * 诊断 sink 端口：接收 DiagnosticEvent 并转发到具体后端（console / telemetry）。
 * Application 服务通过此接口发射诊断；生产使用 ConsoleDiagnosticSink，测试使用收集 sink。
 */
export interface DiagnosticSink {
  emit(event: DiagnosticEvent): void;
}
