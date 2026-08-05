// tests/helpers/popup-events.ts
// Task 15 — 组件语义事件捕获工具。
// 在容器元素上监听全部 PopupEventMap 事件，暴露 lastEvent / reset 给断言使用。
import type { PopupEventMap } from '../../src/popup/components/events.js';

const ALL_EVENT_TYPES = [
  'group-select',
  'group-order-request',
  'stock-pin-request',
  'stock-remove-request',
  'stock-order-request',
  'batch-move-request',
  'view-mode-change',
  'preferences-change',
  'selection-mode-change',
  'theme-change',
  'search-keyword-change',
  'dialog-open-request',
  'column-panel-open-request',
  'dialog-submit',
  'dialog-close-request',
  'stock-search-select',
  'quote-refresh-request',
  'stock-toggle-select',
  'virtual-focus-request',
  'column-settings-change',
  'popover-close-request'
] as const;

export interface PopupEventSpy {
  lastEvent<K extends keyof PopupEventMap>(type: K): CustomEvent<PopupEventMap[K]> | undefined;
  eventCount(type: string): number;
  reset(): void;
}

export function spyPopupEvents(target: EventTarget): PopupEventSpy {
  const events: Record<string, CustomEvent> = {};
  const counts: Record<string, number> = {};
  for (const type of ALL_EVENT_TYPES) {
    target.addEventListener(type, ((e: Event) => {
      events[type] = e as CustomEvent;
      counts[type] = (counts[type] ?? 0) + 1;
    }) as EventListener);
  }
  return {
    lastEvent: (type) => events[type] as CustomEvent | undefined,
    eventCount: (type) => counts[type] ?? 0,
    reset: () => {
      for (const k of Object.keys(events)) delete events[k];
      for (const k of Object.keys(counts)) delete counts[k];
    }
  };
}
