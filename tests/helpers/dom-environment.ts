// tests/helpers/dom-environment.ts
// Task 14 — 组件测试 DOM 环境。
// 基于 happy-dom 提供完整 document / customElements / 事件模型。
//
// 实测结论（happy-dom@20）：customElements.define 注册的组件在 append/remove 时
// 自动触发 connectedCallback / disconnectedCallback；事件冒泡正常；
// AbortController 的 { signal } 选项在 abort() 后正确移除监听器。
// 因此无需手动触发生命周期或 mock customElements。
//
// 用法：组件测试文件首行 `import '../helpers/dom-environment.js';`，
// 每个 test 前调用 resetDom() 清空 body 保证隔离。
import { Window } from 'happy-dom';

const win = new Window();

// 将 happy-dom 的 DOM 全局挂到 Node globalThis，供被测组件代码与测试断言使用。
// 类型上 happy-dom 的实现与 TS lib.dom 略有差异，用 unknown 桥接（运行时兼容）。
globalThis.window = win as unknown as Window & typeof globalThis;
globalThis.document = win.document;
globalThis.customElements = win.customElements;
globalThis.HTMLElement = win.HTMLElement as unknown as typeof HTMLElement;
globalThis.CustomEvent = win.CustomEvent as unknown as typeof CustomEvent;
globalThis.Event = win.Event as unknown as typeof Event;
globalThis.EventTarget = win.EventTarget as unknown as typeof EventTarget;
globalThis.Node = win.Node as unknown as typeof Node;
globalThis.Element = win.Element as unknown as typeof Element;
globalThis.DocumentFragment = win.DocumentFragment as unknown as typeof DocumentFragment;

/** 清空 body 子节点，保证测试隔离（customElements 注册是全局持久的，不重置）。 */
export function resetDom(): void {
  win.document.body.innerHTML = '';
}

export {};
