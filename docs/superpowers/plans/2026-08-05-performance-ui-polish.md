# Popup Performance and UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace full-DOM list/grid rendering with bounded virtual windows and deliver the approved “精密终端” UI across the entire 420×560 Popup while preserving every v2 architecture and release invariant.

**Architecture:** Add a pure virtual-window calculator shared by list and grid, let `stock-board` own the scroll viewport and mount only the active view, and keep row/card rendering keyed and diff-aware. Presentation-only column preferences live in the Popup Store and versioned `localStorage`; business preferences, RPC, storage schema, quote semantics, and rollback compatibility remain unchanged.

**Tech Stack:** TypeScript 5, ES2022 modules, Light DOM Web Components, immutable reducer/selectors, Chrome Manifest V3, `node:test` + happy-dom, Playwright, axe-core, CSS custom properties.

## Global Constraints

- Popup dimensions are exactly 420×560: Header 52px + Group Tabs 38px + Toolbar 48px + Board 390px + Status Bar 32px.
- Keep both list and grid views; both must use bounded virtual rendering.
- 500-stock view-switch DOM update p95 must be ≤80ms; the external release ceiling remains ≤100ms.
- Bootstrap p95 must be ≤200ms; virtual scrolling must not produce a >50ms long task.
- Do not reduce the 20-group / 500-stock supported capacity or weaken performance measurements.
- No runtime third-party dependencies, network fonts, icon fonts, `backdrop-filter`, or per-row/per-card heavy shadows.
- Top actions retain inline SVG plus visible text: 浅色/深色、价格、多选、添加; each button is 44px high.
- Never fabricate quotes; cached and missing states keep their current domain semantics.
- Do not change RPC v2, `StorageCoordinator`, schema v2, `userDataRevision`, quote providers, cache/backoff, permissions, or rollback behavior.
- Components receive ViewModels and emit semantic events; they never access Store, RPC, Repository, or Chrome Storage directly.
- `src/popup/store/reducer.ts` remains the only `AppState` write path.
- Column settings are presentation-only: Store view state + validated `localStorage` key `uiColumns:v1`; never `BoardConfig`.
- All animation is disabled under `prefers-reduced-motion: reduce`.
- Implement test-first, preserve ≥90/85 global coverage and critical per-file thresholds, and finish with `npm run release:verify`.

---

## Planned File Structure

### New focused modules

- `src/popup/virtualization/virtual-window.ts` — pure range, spacer, and normalized-scroll calculation.
- `src/popup/virtualization/raf-scheduler.ts` — coalesces repeated viewport updates into one animation-frame task.
- `src/popup/ui-preferences.ts` — `UiColumnPreferences` types, defaults, normalization, load/save helpers.
- `src/popup/components/app-popover-host.ts` — fixed-position overlay host for stock actions and column settings.
- `src/popup/components/stock-action-menu.ts` — semantic stock actions only; no Store/RPC access.
- `extension/popup/styles/controls.css` — Header, tabs, toolbar, batch toolbar, and status bar.
- `extension/popup/styles/board.css` — table, grid, card, virtual spacers, and board states.
- `extension/popup/styles/overlays.css` — popover, column panel, dialog, search results, toast/fallback.

### Existing modules with changed responsibilities

- `src/popup/components/stock-board.ts` — sole scroll owner, active-view lifecycle, viewport propagation, scroll restoration.
- `src/popup/components/stock-table.ts` — accessible virtual `<tbody>` and visible-row diffing.
- `src/popup/components/stock-grid.ts` — two-column virtual card-row window.
- `src/popup/store/{state,actions,reducer,selectors}.ts` — column view state and discriminated popover state.
- `src/popup/app-shell.ts` — semantic event routing and presentation preference persistence.
- `src/popup/main.ts` — validated theme/column preference bootstrap.
- `src/popup/view-models.ts` — active columns, popover, recoverable board states.
- `src/popup/components/{stock-header,group-tabs,stock-toolbar,stock-card,stock-app,app-dialog-host}.ts` — approved structure and interactions.
- `extension/popup/styles/{tokens,layout,components,accessibility}.css` — shared tokens/layout/primitives and imports of the focused style files.

---

### Task 1: Pure Virtual Window and Frame Scheduler

**Files:**
- Create: `src/popup/virtualization/virtual-window.ts`
- Create: `src/popup/virtualization/raf-scheduler.ts`
- Create: `tests/unit/popup/virtual-window.test.ts`
- Create: `tests/unit/popup/raf-scheduler.test.ts`

**Interfaces:**
- Produces:
  - `calculateVirtualWindow(input: VirtualWindowInput): VirtualWindowResult`
  - `VirtualViewport { scrollOffset: number; viewportExtent: number }`
  - `createRafScheduler(requestFrame, cancelFrame, task): RafScheduler`
- Consumed by Tasks 2–4.

- [ ] **Step 1: Write failing range tests**

```ts
// tests/unit/popup/virtual-window.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateVirtualWindow } from '../../../src/popup/virtualization/virtual-window.js';

test('empty input produces an empty safe window', () => {
  assert.deepEqual(calculateVirtualWindow({
    itemCount: 0, itemExtent: 48, viewportExtent: 390,
    scrollOffset: 0, overscanScreens: 1
  }), {
    startIndex: 0, endIndex: 0, beforeExtent: 0,
    afterExtent: 0, normalizedScrollOffset: 0
  });
});

test('500 rows render only the viewport plus one screen of overscan on each side', () => {
  const result = calculateVirtualWindow({
    itemCount: 500, itemExtent: 48, viewportExtent: 390,
    scrollOffset: 4_800, overscanScreens: 1
  });
  assert.ok(result.endIndex - result.startIndex <= 27);
  assert.equal(result.beforeExtent, result.startIndex * 48);
  assert.equal(result.afterExtent, (500 - result.endIndex) * 48);
});

test('scroll offset is clamped after data shrinks', () => {
  const result = calculateVirtualWindow({
    itemCount: 3, itemExtent: 48, viewportExtent: 390,
    scrollOffset: 9_999, overscanScreens: 1
  });
  assert.equal(result.normalizedScrollOffset, 0);
  assert.equal(result.endIndex, 3);
});
```

- [ ] **Step 2: Run range tests and verify RED**

Run: `node --import tsx --test tests/unit/popup/virtual-window.test.ts`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `virtual-window.js`.

- [ ] **Step 3: Implement the pure calculator**

```ts
// src/popup/virtualization/virtual-window.ts
export interface VirtualViewport {
  readonly scrollOffset: number;
  readonly viewportExtent: number;
}

export interface VirtualWindowInput extends VirtualViewport {
  readonly itemCount: number;
  readonly itemExtent: number;
  readonly overscanScreens: number;
}

export interface VirtualWindowResult {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly beforeExtent: number;
  readonly afterExtent: number;
  readonly normalizedScrollOffset: number;
}

export function calculateVirtualWindow(input: VirtualWindowInput): VirtualWindowResult {
  const itemCount = Number.isFinite(input.itemCount) ? Math.max(0, Math.floor(input.itemCount)) : 0;
  const itemExtent = Number.isFinite(input.itemExtent) && input.itemExtent > 0 ? input.itemExtent : 1;
  const viewportExtent = Number.isFinite(input.viewportExtent) && input.viewportExtent > 0
    ? input.viewportExtent : 390;
  const maxOffset = Math.max(0, itemCount * itemExtent - viewportExtent);
  const requestedOffset = Number.isFinite(input.scrollOffset) ? input.scrollOffset : 0;
  const normalizedScrollOffset = Math.min(maxOffset, Math.max(0, requestedOffset));
  if (itemCount === 0) {
    return { startIndex: 0, endIndex: 0, beforeExtent: 0, afterExtent: 0, normalizedScrollOffset: 0 };
  }
  const visibleCount = Math.ceil(viewportExtent / itemExtent);
  const overscanCount = Math.ceil(visibleCount * Math.max(0, input.overscanScreens));
  const firstVisible = Math.floor(normalizedScrollOffset / itemExtent);
  const startIndex = Math.max(0, firstVisible - overscanCount);
  const endIndex = Math.min(itemCount, firstVisible + visibleCount + overscanCount);
  return {
    startIndex,
    endIndex,
    beforeExtent: startIndex * itemExtent,
    afterExtent: (itemCount - endIndex) * itemExtent,
    normalizedScrollOffset
  };
}
```

- [ ] **Step 4: Write failing scheduler tests**

```ts
// tests/unit/popup/raf-scheduler.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRafScheduler } from '../../../src/popup/virtualization/raf-scheduler.js';

test('coalesces repeated schedule calls into one task', () => {
  let queued: FrameRequestCallback | null = null;
  let calls = 0;
  const scheduler = createRafScheduler(
    (cb) => { queued = cb; return 1; },
    () => { queued = null; },
    () => { calls += 1; }
  );
  scheduler.schedule(); scheduler.schedule(); scheduler.schedule();
  assert.equal(calls, 0);
  queued?.(0);
  assert.equal(calls, 1);
});
```

- [ ] **Step 5: Implement and verify the scheduler**

```ts
// src/popup/virtualization/raf-scheduler.ts
export interface RafScheduler { schedule(): void; cancel(): void; }

export function createRafScheduler(
  requestFrame: (callback: FrameRequestCallback) => number,
  cancelFrame: (handle: number) => void,
  task: () => void
): RafScheduler {
  let handle: number | null = null;
  return {
    schedule() {
      if (handle !== null) return;
      handle = requestFrame(() => { handle = null; task(); });
    },
    cancel() {
      if (handle === null) return;
      cancelFrame(handle);
      handle = null;
    }
  };
}
```

Run: `node --import tsx --test tests/unit/popup/virtual-window.test.ts tests/unit/popup/raf-scheduler.test.ts`

Expected: PASS, including safe invalid inputs and scheduler cancellation.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/popup/virtualization tests/unit/popup/virtual-window.test.ts tests/unit/popup/raf-scheduler.test.ts
git commit -m "feat(popup): add virtual window primitives"
```

---

### Task 2: Accessible Virtual Stock Table

**Files:**
- Modify: `src/popup/components/stock-table.ts`
- Modify: `src/popup/components/keyed-update.ts`
- Modify: `tests/component/stock-table.test.ts`
- Modify: `tests/component/keyed-update.test.ts`

**Interfaces:**
- Consumes: `VirtualViewport`, `calculateVirtualWindow` from Task 1.
- Produces: `StockTableElement.viewport: VirtualViewport`, `StockTableElement.focusCode(code)` and a bounded real-row DOM.
- Task 4 supplies the viewport and calls `focusCode`.

- [ ] **Step 1: Replace full-row expectations with failing bounded-window tests**

```ts
test('500-stock table keeps real stock rows bounded', () => {
  const stocks = Array.from({ length: 500 }, (_, i) => card(`sh${String(600000 + i).padStart(6, '0')}`));
  const { el } = setupTable(stocks);
  el.viewport = { scrollOffset: 0, viewportExtent: 390 };
  const realRows = el.querySelectorAll('tbody tr[data-key]');
  assert.ok(realRows.length <= 27, `expected <=27 real rows, got ${realRows.length}`);
  assert.equal(el.querySelector('table')?.getAttribute('aria-rowcount'), '501');
});

test('scrolling changes the rendered key range and exposes aria-rowindex', () => {
  const stocks = Array.from({ length: 100 }, (_, i) => card(`sh${String(600000 + i).padStart(6, '0')}`));
  const { el } = setupTable(stocks);
  el.viewport = { scrollOffset: 48 * 50, viewportExtent: 390 };
  assert.ok(el.querySelector('[data-key="sh600050"]'));
  assert.equal(el.querySelector('[data-key="sh600050"]')?.getAttribute('aria-rowindex'), '52');
});
```

- [ ] **Step 2: Run focused component tests and verify RED**

Run: `node --import tsx --test tests/component/stock-table.test.ts`

Expected: FAIL because `viewport` is not implemented and 500 rows are mounted.

- [ ] **Step 3: Add viewport state, spacer rows, and visible slicing**

Implement these exact constants and property:

```ts
const TABLE_HEADER_EXTENT = 28;
const TABLE_ROW_EXTENT = 48;
const OVERSCAN_SCREENS = 1;

private _viewport: VirtualViewport = { scrollOffset: 0, viewportExtent: 390 };

set viewport(value: VirtualViewport) {
  this._viewport = value;
  if (this.isConnected) this.render();
}
```

In `render()`, call `calculateVirtualWindow`, slice `this._viewModel`, and pass only the slice to `updateKeyedChildren`. Create top/bottom spacer `<tr aria-hidden="true">` elements with one `td.colSpan = visibleColumnCount + 1` and explicit pixel height. Set `table[aria-rowcount]` to `stockCount + 1` because the header occupies row 1; each real data row uses `aria-rowindex = stockIndex + 2`.

- [ ] **Step 4: Make visible-row updates field-diffed**

Add a small helper and use it for text mutations:

```ts
function setText(node: Element | undefined, value: string): void {
  if (node && node.textContent !== value) node.textContent = value;
}
```

Keep keyed identity for rows that remain inside the virtual window; remove only keys outside it. Change `updateKeyedChildren` only if required to accept stable sentinel spacer nodes without treating them as keyed children.

- [ ] **Step 5: Implement focus-to-code behavior**

```ts
focusCode(code: StockCode): boolean {
  const index = this._viewModel.findIndex((vm) => vm.code === code);
  if (index < 0) return false;
  this.dispatchEvent(new CustomEvent('virtual-focus-request', {
    detail: { index, itemExtent: TABLE_ROW_EXTENT }, bubbles: true, composed: true
  }));
  return true;
}
```

Task 4 will scroll and focus after rendering; the table must not retain detached focused-node references.

- [ ] **Step 6: Run table and keyed-update tests**

Run: `node --import tsx --test tests/component/stock-table.test.ts tests/component/keyed-update.test.ts`

Expected: PASS; 500-stock real row count ≤27, semantic row count 501 including the header, existing sorting and node identity tests remain green.

- [ ] **Step 7: Commit Task 2**

```bash
git add src/popup/components/stock-table.ts src/popup/components/keyed-update.ts tests/component/stock-table.test.ts tests/component/keyed-update.test.ts
git commit -m "perf(popup): virtualize stock table rows"
```

---

### Task 3: Virtual Two-Column Stock Grid

**Files:**
- Modify: `src/popup/components/stock-grid.ts`
- Modify: `src/popup/components/stock-card.ts`
- Modify: `tests/component/stock-board.test.ts`
- Modify: `tests/component/stock-card.test.ts`

**Interfaces:**
- Consumes: `VirtualViewport`, `calculateVirtualWindow`.
- Produces: `StockGridElement.viewport: VirtualViewport`, `StockGridElement.focusCode(code)` and ≤24 real cards at 390px viewport.
- Emits the same business events as before; Task 6 later replaces inline action buttons with a menu trigger.

- [ ] **Step 1: Write failing bounded grid tests**

```ts
test('500-stock grid keeps card nodes bounded', () => {
  const stocks = Array.from({ length: 500 }, (_, i) => card(`sh${String(600000 + i).padStart(6, '0')}`));
  const { el } = setupGrid(stocks);
  el.viewport = { scrollOffset: 0, viewportExtent: 390 };
  assert.ok(el.querySelectorAll('stock-card[data-key]').length <= 24);
  assert.equal(el.querySelector('stock-card')?.getAttribute('aria-setsize'), '500');
});

test('grid scroll offset renders cards around the target row', () => {
  const stocks = Array.from({ length: 100 }, (_, i) => card(`sh${String(600000 + i).padStart(6, '0')}`));
  const { el } = setupGrid(stocks);
  el.viewport = { scrollOffset: 126 * 20, viewportExtent: 390 };
  assert.ok(el.querySelector('[data-key="sh600040"]'));
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --import tsx --test tests/component/stock-board.test.ts tests/component/stock-card.test.ts`

Expected: FAIL because all cards are mounted.

- [ ] **Step 3: Implement row-based grid virtualization**

Use exact layout constants:

```ts
const GRID_COLUMNS = 2;
const GRID_ROW_EXTENT = 126;
const OVERSCAN_SCREENS = 1;
```

Calculate the virtual item count as `Math.ceil(stocks.length / GRID_COLUMNS)`, slice stock indexes from `startIndex * 2` through `endIndex * 2`, and set top/bottom spacer block heights from the virtual row result. Give the container `role="list"`; set every real card to `role="listitem"` with its own `aria-posinset` and `aria-setsize`.

- [ ] **Step 4: Preserve visible card identity and focus**

Continue using `updateKeyedChildren`; when a target is outside the window, emit the same `virtual-focus-request` shape with `index: Math.floor(stockIndex / 2)` and `itemExtent: GRID_ROW_EXTENT`.

- [ ] **Step 5: Run grid/card regression tests**

Run: `node --import tsx --test tests/component/stock-board.test.ts tests/component/stock-card.test.ts tests/component/keyed-update.test.ts`

Expected: PASS, including existing pin/reorder semantics and bounded card count.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/popup/components/stock-grid.ts src/popup/components/stock-card.ts tests/component/stock-board.test.ts tests/component/stock-card.test.ts
git commit -m "perf(popup): virtualize stock card grid"
```

---

### Task 4: Active-View Board Lifecycle and Scroll Restoration

**Files:**
- Modify: `src/popup/components/stock-board.ts`
- Modify: `src/popup/components/stock-app.ts`
- Modify: `tests/component/stock-board.test.ts`
- Modify: `tests/component/stock-app.test.ts`
- Modify: `tests/component/component-lifecycle.test.ts`

**Interfaces:**
- Consumes virtual table/grid viewport properties and `createRafScheduler`.
- Produces one connected active view, independent `{ list, grid }` scroll offsets, a 390px fallback viewport, and virtual focus routing.

- [ ] **Step 1: Write failing lifecycle tests**

```ts
test('board connects only the active stock view', () => {
  setupBoard(board({ stocks: [card('sh600519')], viewMode: 'list' }));
  assert.ok(document.querySelector('stock-table'));
  assert.equal(document.querySelector('stock-grid'), null);
});

test('inactive view does not receive later quote updates', () => {
  const { el } = setupBoard(board({ stocks: [card('sh600519')], viewMode: 'list' }));
  el.viewModel = board({ stocks: [card('sh600519')], viewMode: 'grid' });
  const detachedTable = (el as unknown as { debugViews(): { table: HTMLElement } }).debugViews().table;
  const before = detachedTable.querySelector('[data-key="sh600519"]')?.textContent;
  el.viewModel = board({ stocks: [card('sh600519', { displayPrice: '999.00' })], viewMode: 'grid' });
  assert.equal(detachedTable.querySelector('[data-key="sh600519"]')?.textContent, before);
});
```

Do not keep `debugViews()` in production. Tests may instead capture the table before switching and assert on the detached reference.

- [ ] **Step 2: Run board tests and verify RED**

Run: `node --import tsx --test tests/component/stock-board.test.ts tests/component/component-lifecycle.test.ts`

Expected: FAIL because both views are created and updated.

- [ ] **Step 3: Make `stock-board` the sole viewport owner**

Implement:

```ts
private readonly scrollOffsets: Record<'list' | 'grid', number> = { list: 0, grid: 0 };
private activeMode: 'list' | 'grid' | null = null;
private viewportExtent = 390;
private resizeObserver: ResizeObserver | null = null;
private scheduler = createRafScheduler(
  (cb) => requestAnimationFrame(cb),
  (id) => cancelAnimationFrame(id),
  () => this.flushViewport()
);
```

On mode change: save current `scrollTop`, detach the old view without updating its ViewModel, lazily create/append the new view, restore its normalized scroll offset, assign its ViewModel, and flush the viewport. On disconnect: cancel scheduler, disconnect observer, and remove listeners through the per-connection AbortController.

- [ ] **Step 4: Route viewport and virtual focus requests**

`flushViewport()` sends `{ scrollOffset: Math.max(0, this.scrollTop - 28), viewportExtent: this.clientHeight || 390 }` to the active child. Handle `virtual-focus-request` by setting `scrollTop = index * itemExtent`, flushing synchronously, then focusing the requested keyed control in the next animation frame.

- [ ] **Step 5: Keep loading/error/empty mutually exclusive**

Build six skeleton rows once. When loading/error/empty is active, detach the active data view; when data becomes available, reattach only the selected mode. Empty CTA emits `dialog-open-request { kind: 'add-stock' }`.

- [ ] **Step 6: Run component lifecycle suite**

Run: `node --import tsx --test tests/component/stock-board.test.ts tests/component/stock-app.test.ts tests/component/component-lifecycle.test.ts`

Expected: PASS; one active view, scroll offsets restored, exactly six skeleton rows, no duplicate listeners after reconnect.

- [ ] **Step 7: Run the performance test once for directional evidence**

Run: `npm run build && npm run test:performance`

Expected: the 500-stock view-switch test is materially below the 136–142ms baseline. Do not adjust thresholds in this task.

- [ ] **Step 8: Commit Task 4**

```bash
git add src/popup/components/stock-board.ts src/popup/components/stock-app.ts tests/component/stock-board.test.ts tests/component/stock-app.test.ts tests/component/component-lifecycle.test.ts
git commit -m "perf(popup): mount only the active stock view"
```

---

### Task 5: Versioned Presentation-Only Column Preferences

**Files:**
- Create: `src/popup/ui-preferences.ts`
- Create: `tests/unit/popup/ui-preferences.test.ts`
- Modify: `src/popup/store/state.ts`
- Modify: `src/popup/store/actions.ts`
- Modify: `src/popup/store/reducer.ts`
- Modify: `src/popup/store/selectors.ts`
- Modify: `src/popup/view-models.ts`
- Modify: `src/popup/components/events.ts`
- Modify: `src/popup/components/column-panel.ts`
- Modify: `src/popup/main.ts`
- Modify: `src/popup/app-shell.ts`
- Modify: `tests/unit/popup/reducer.test.ts`
- Modify: `tests/unit/popup/selectors.test.ts`
- Modify: `tests/unit/popup/app-shell.test.ts`
- Modify: `tests/component/column-panel.test.ts`

**Interfaces:**
- Produces:
  - `ColumnKey = 'name' | 'code' | 'status' | 'price' | 'changePercent' | 'amount'`
  - `UiColumnPreferences { version: 1; enabled: readonly ColumnKey[]; order: readonly ColumnKey[] }`
  - `normalizeUiColumns`, `loadUiColumns`, `saveUiColumns`
  - action `view/columns` and event `column-settings-change`
- Consumed by Tasks 6–8 and table/grid rendering.

- [ ] **Step 1: Write failing normalization tests**

```ts
test('normalizes corrupt, duplicate, and unknown columns', () => {
  assert.deepEqual(normalizeUiColumns({
    version: 1,
    enabled: ['amount', 'amount', 'unknown'],
    order: ['amount', 'unknown']
  }), {
    version: 1,
    enabled: ['name', 'price', 'changePercent', 'amount'],
    order: ['name', 'price', 'changePercent', 'amount', 'code', 'status']
  });
});

test('unknown versions fall back to defaults', () => {
  assert.deepEqual(normalizeUiColumns({ version: 2, enabled: [], order: [] }), DEFAULT_UI_COLUMNS);
});
```

- [ ] **Step 2: Run test and verify RED**

Run: `node --import tsx --test tests/unit/popup/ui-preferences.test.ts`

Expected: FAIL with missing module.

- [ ] **Step 3: Implement validated persistence helpers**

Use exact storage key and defaults:

```ts
export const UI_COLUMNS_STORAGE_KEY = 'uiColumns:v1';
export const REQUIRED_COLUMNS = ['name', 'price', 'changePercent'] as const;
export const DEFAULT_UI_COLUMNS: UiColumnPreferences = {
  version: 1,
  enabled: ['name', 'code', 'status', 'price', 'changePercent', 'amount'],
  order: ['name', 'price', 'changePercent', 'amount', 'code', 'status']
};
```

`loadUiColumns` catches storage/JSON errors. `saveUiColumns` writes only normalized JSON and catches quota/privacy errors.

- [ ] **Step 4: Add Store state/action/reducer tests**

```ts
test('view/columns replaces only the view column branch', () => {
  const state = createInitialState('dark', DEFAULT_UI_COLUMNS);
  const columns = normalizeUiColumns({ version: 1, enabled: ['name', 'price', 'changePercent'], order: [] });
  const next = reducer(state, { type: 'view/columns', columns });
  assert.equal(next.view.columns, columns);
  assert.equal(next.domain, state.domain);
});
```

Extend `createInitialState(theme, columns)` and keep `domain.userData.boardConfig` unchanged.

- [ ] **Step 5: Replace overloaded preference event fields**

Remove `columns` and `columnOrder` from `preferences-change`. Add:

```ts
'column-settings-change': { readonly columns: UiColumnPreferences };
```

Update `column-panel` to emit the complete normalized final state and enforce all three required columns.

- [ ] **Step 6: Wire bootstrap and AppShell persistence**

In `main.ts`, call `loadUiColumns(window.localStorage)` beside theme loading and pass it to `createInitialState`. In `AppShell`:

```ts
on('column-settings-change', ({ columns }) => {
  const normalized = normalizeUiColumns(columns);
  store.dispatch({ type: 'view/columns', columns: normalized });
  saveUiColumns(localStorage, normalized);
});
```

Components never call `localStorage`.

- [ ] **Step 7: Project columns into ViewModels**

Add `columns` to `BoardViewModel` and `ColumnPanelViewModel`, and add a top-level `columnPanel` ViewModel to `AppViewModel`. Table/grid use the enabled/order values; code/status remain secondary content controlled by their flags.

- [ ] **Step 8: Run unit and component tests**

Run: `node --import tsx --test tests/unit/popup/ui-preferences.test.ts tests/unit/popup/reducer.test.ts tests/unit/popup/selectors.test.ts tests/unit/popup/app-shell.test.ts tests/component/column-panel.test.ts`

Expected: PASS; unknown/corrupt values safely normalize, no `BoardConfig` or RPC change.

- [ ] **Step 9: Commit Task 5**

```bash
git add src/popup/ui-preferences.ts src/popup/store src/popup/view-models.ts src/popup/components/events.ts src/popup/components/column-panel.ts src/popup/main.ts src/popup/app-shell.ts tests/unit/popup tests/component/column-panel.test.ts
git commit -m "feat(popup): persist validated column preferences"
```

---

### Task 6: Unified Popover Host for Stock Actions and Column Settings

**Files:**
- Create: `src/popup/components/app-popover-host.ts`
- Create: `src/popup/components/stock-action-menu.ts`
- Create: `tests/component/app-popover-host.test.ts`
- Create: `tests/component/stock-action-menu.test.ts`
- Modify: `extension/popup.html`
- Modify: `src/popup/components/define-elements.ts`
- Modify: `src/popup/components/events.ts`
- Modify: `src/popup/store/state.ts`
- Modify: `src/popup/store/actions.ts`
- Modify: `src/popup/store/reducer.ts`
- Modify: `src/popup/store/selectors.ts`
- Modify: `src/popup/view-models.ts`
- Modify: `src/popup/app-shell.ts`
- Modify: `src/popup/components/stock-table.ts`
- Modify: `src/popup/components/stock-card.ts`
- Modify: `tests/unit/popup/reducer.test.ts`
- Modify: `tests/unit/popup/selectors.test.ts`
- Modify: `tests/unit/popup/app-shell.test.ts`

**Interfaces:**
- Produces discriminated `MenuState`:

```ts
type MenuState =
  | { readonly kind: 'stock-actions'; readonly anchorId: string; readonly code: StockCode }
  | { readonly kind: 'column-settings'; readonly anchorId: string };
```

- Produces semantic events `stock-menu-open-request`, `popover-close-request`, and `stock-remove-confirm-request`.
- Reuses existing `stock-pin-request`, `stock-order-request`, `dialog-open-request` and `column-settings-change`.

- [ ] **Step 1: Write failing reducer/selector tests for discriminated menus**

```ts
test('stock action menu selector exposes only the requested stock', () => {
  const state = withStocks(createInitialState(), [stock('sh600519'), stock('sz000001')]);
  const opened = reducer(state, {
    type: 'overlay/menu',
    menu: { kind: 'stock-actions', anchorId: 'stock-actions-sh600519', code: 'sh600519' as StockCode }
  });
  const vm = selectPopover(opened);
  assert.equal(vm.kind, 'stock-actions');
  assert.equal(vm.stock?.code, 'sh600519');
});
```

- [ ] **Step 2: Implement state and selector projection**

Add `PopoverViewModel` containing `open`, `kind`, `anchorId`, current `groupId`, optional target stock, ordered codes, and `columnPanel`. Missing/deleted target stocks produce the closed ViewModel rather than throwing.

- [ ] **Step 3: Write failing menu interaction tests**

Test that pin, move up/down, and remove emit exact semantic payloads; first/last move buttons are disabled; Escape and outside click emit close; close restores the trigger focus.

Run: `node --import tsx --test tests/component/stock-action-menu.test.ts tests/component/app-popover-host.test.ts`

Expected: FAIL with missing custom elements.

- [ ] **Step 4: Implement the two focused components**

`stock-action-menu` receives a pure ViewModel and renders native buttons. `app-popover-host` owns fixed positioning from `document.getElementById(anchorId).getBoundingClientRect()`, viewport clamping, outside click, Escape, and focus return. It chooses `stock-action-menu` or existing `column-panel` by `kind`.

- [ ] **Step 5: Replace inline action clusters with one trigger**

For table and card, create deterministic button IDs:

```ts
button.id = `stock-actions-${vm.code}`;
button.dataset.action = 'stock-menu';
button.setAttribute('aria-label', `打开 ${vm.name} 操作菜单`);
button.textContent = '•••';
```

Emit `stock-menu-open-request { anchorId, code }`. Remove visible pin/up/down clusters after menu tests are green.

- [ ] **Step 6: Wire the host in Popup and AppShell**

Add `<app-popover-host id="popover-host"></app-popover-host>` beside `dialog-host`. Extend AppShell dependencies and its event listener helper to include both overlay hosts. `stock-remove-confirm-request` dispatches `confirm-remove` with the single target code; it never deletes immediately.

- [ ] **Step 7: Run focused interaction suites**

Run: `node --import tsx --test tests/component/app-popover-host.test.ts tests/component/stock-action-menu.test.ts tests/component/stock-table.test.ts tests/component/stock-card.test.ts tests/unit/popup/app-shell.test.ts tests/unit/popup/selectors.test.ts`

Expected: PASS; one trigger per row/card, menu keyboard support, confirmed removal, no dead column button.

- [ ] **Step 8: Commit Task 6**

```bash
git add extension/popup.html src/popup tests/component/app-popover-host.test.ts tests/component/stock-action-menu.test.ts tests/component/stock-table.test.ts tests/component/stock-card.test.ts tests/unit/popup
git commit -m "feat(popup): unify stock and column popovers"
```

---

### Task 7: Precision Terminal Structure and Styles

**Files:**
- Create: `extension/popup/styles/controls.css`
- Create: `extension/popup/styles/board.css`
- Create: `extension/popup/styles/overlays.css`
- Modify: `extension/popup.html`
- Modify: `extension/popup/styles/tokens.css`
- Modify: `extension/popup/styles/layout.css`
- Modify: `extension/popup/styles/components.css`
- Modify: `extension/popup/styles/accessibility.css`
- Modify: `src/popup/components/stock-header.ts`
- Modify: `src/popup/components/group-tabs.ts`
- Modify: `src/popup/components/stock-toolbar.ts`
- Modify: `src/popup/components/quote-status.ts`
- Modify: `src/popup/components/batch-toolbar.ts`
- Modify: `src/popup/components/stock-table.ts`
- Modify: `src/popup/components/stock-card.ts`
- Modify: `tests/component/stock-header.test.ts`
- Modify: `tests/component/group-tabs.test.ts`
- Modify: `tests/component/stock-toolbar.test.ts`
- Modify: `tests/component/quote-status.test.ts`
- Modify: `tests/component/batch-toolbar.test.ts`
- Modify: `tests/component/stock-table.test.ts`
- Modify: `tests/component/stock-card.test.ts`
- Modify: `tests/e2e/ui-redesign.spec.ts`

**Interfaces:**
- Consumes all ViewModels/events already stabilized in Tasks 1–6.
- Produces exact 52/38/48/390/32 layout and approved visible text controls.

- [ ] **Step 1: Add failing structure assertions**

```ts
test('header keeps visible labels on all four actions', () => {
  setupHeader(headerVm());
  const labels = [...document.querySelectorAll('.header-btn-label')].map((node) => node.textContent);
  assert.deepEqual(labels, ['浅色', '价格', '多选', '添加']);
});

test('toolbar uses compact labels and one overflow trigger', () => {
  setupToolbar(toolbarVm());
  assert.equal(document.querySelector('[data-action="view-list"]')?.textContent, '列表');
  assert.equal(document.querySelector('[data-action="view-grid"]')?.textContent, '网格');
  assert.ok(document.querySelector('[data-action="more"]'));
});
```

Extend E2E to assert computed region heights and body overflow.

- [ ] **Step 2: Run component/UI E2E and verify RED**

Run: `node --import tsx --test tests/component/stock-header.test.ts tests/component/group-tabs.test.ts tests/component/stock-toolbar.test.ts && npm run build && npx playwright test tests/e2e/ui-redesign.spec.ts`

Expected: FAIL on labels/region heights/toolbar structure.

- [ ] **Step 3: Restructure Header, tabs, toolbar, and status**

- Header: compact identity mark/copy plus four 44px labeled buttons; `添加` remains primary.
- Tabs: remove left/right arrow controls; native horizontal scrolling with roving tabindex, Home/End, ArrowLeft/Right.
- Toolbar: search + 98px sort + 76px `列表/网格` segment + 38px `⋮`; the overflow opens column settings.
- Status: fixed counts and refresh control, no wrapping.

- [ ] **Step 4: Reduce list to the approved hierarchy**

Default visible hierarchy is stock name with code/status subline, price, percentage change, amount, and action trigger. Use `displayChange` only where an enabled optional layout requests it; do not restore the eight cramped primary columns.

- [ ] **Step 5: Implement tokens and focused style files**

`tokens.css` defines exact dark/light surfaces, text tiers, brand, up/down, gold, focus, spacing, radii, and durations. `layout.css` owns only fixed geometry. Move selectors into `controls.css`, `board.css`, and `overlays.css`; keep `components.css` for shared button/input primitives and delete duplicated legacy blocks.

Use CSS import/link order in `popup.html`:

```html
<link rel="stylesheet" href="popup/styles/tokens.css">
<link rel="stylesheet" href="popup/styles/layout.css">
<link rel="stylesheet" href="popup/styles/components.css">
<link rel="stylesheet" href="popup/styles/controls.css">
<link rel="stylesheet" href="popup/styles/board.css">
<link rel="stylesheet" href="popup/styles/overlays.css">
<link rel="stylesheet" href="popup/styles/accessibility.css">
```

- [ ] **Step 6: Enforce interaction-cost constraints in CSS**

Search and reject `backdrop-filter`; allow box-shadow only on Popup frame, popover, and dialog. Price flash is 180ms, theme transitions 120ms, overlay fade 120ms, and virtual rows/cards have no transform animation.

- [ ] **Step 7: Run component, architecture, and UI tests**

Run: `npm run check && npm run test:component && npm run build && npx playwright test tests/e2e/ui-redesign.spec.ts`

Expected: PASS; body is 420×560 with zero overflow, Status Bar visible, toolbar single-line, four labeled Header actions.

- [ ] **Step 8: Commit Task 7**

```bash
git add extension/popup.html extension/popup/styles src/popup/components tests/component tests/e2e/ui-redesign.spec.ts
git commit -m "feat(ui): apply precision terminal popup design"
```

---

### Task 8: Dialogs, Recoverable States, and Accessibility

**Files:**
- Modify: `src/popup/components/app-dialog-host.ts`
- Modify: `src/popup/components/stock-search-combobox.ts`
- Modify: `src/popup/components/stock-board.ts`
- Modify: `src/popup/view-models.ts`
- Modify: `src/popup/store/selectors.ts`
- Modify: `src/popup/app-shell.ts`
- Modify: `tests/component/app-dialog-host.test.ts`
- Modify: `tests/component/stock-search-combobox.test.ts`
- Modify: `tests/component/stock-board.test.ts`
- Modify: `tests/e2e/accessibility.spec.ts`
- Modify: `tests/e2e/failure-injection.spec.ts`
- Modify: `tests/e2e/keyboard.spec.ts`
- Modify: `tests/e2e/portfolio.spec.ts`

**Interfaces:**
- Produces centered 360px dialog, six-row skeleton, empty-state CTA, recoverable data-preserving error state, and complete keyboard/focus paths across virtualized content.

- [ ] **Step 1: Write failing state and dialog tests**

```ts
test('empty board exposes a native add-stock action', () => {
  const { spy } = setupBoard(board({ empty: true, stocks: [] }));
  (document.querySelector('[data-action="empty-add-stock"]') as HTMLButtonElement).click();
  assert.equal(spy.lastEvent('dialog-open-request')?.detail.kind, 'add-stock');
});

test('dialog has a stable accessible title and centered panel class', () => {
  setupDialog(addStockVm());
  const dialog = document.querySelector('[role="dialog"]');
  assert.ok(dialog?.getAttribute('aria-labelledby'));
  assert.ok(dialog?.querySelector('.dialog-panel--centered'));
});
```

- [ ] **Step 2: Run component tests and verify RED**

Run: `node --import tsx --test tests/component/app-dialog-host.test.ts tests/component/stock-board.test.ts tests/component/stock-search-combobox.test.ts`

Expected: FAIL on empty CTA/centered dialog structure.

- [ ] **Step 3: Implement approved state behavior**

- Loading renders exactly six empty skeleton rows with `aria-busy="true"`.
- Empty renders explanatory copy and a native Add button.
- Quote refresh error preserves current stocks and displays a retryable status; only unrecoverable bootstrap failure uses `fatal-fallback`.
- Cached/missing copy uses existing real quote status; no fake numeric text is introduced.

- [ ] **Step 4: Apply one overlay focus contract**

Dialog and popover both support initial focus, Tab containment where modal, Escape close, backdrop/outside close, and focus return. Dialog is centered with `max-width: 360px`; search results scroll inside the dialog rather than expanding Popup height.

- [ ] **Step 5: Extend real-extension accessibility paths**

Add E2E coverage for:

- Header labels and 44px targets.
- Keyboard opening/closing stock menu and column settings.
- Focusing a stock outside the initial virtual window.
- 90–150% zoom without clipped Header/Status controls.
- Dark/light axe scans for list, grid, dialog, popover, empty, recoverable error.
- Reduced motion producing zero-duration transitions.

- [ ] **Step 6: Run focused E2E and a11y**

Run: `npm run build && npx playwright test tests/e2e/failure-injection.spec.ts tests/e2e/keyboard.spec.ts tests/e2e/portfolio.spec.ts && npm run test:a11y`

Expected: PASS with zero critical/serious axe violations and no page/Service Worker errors.

- [ ] **Step 7: Commit Task 8**

```bash
git add src/popup tests/component tests/e2e/accessibility.spec.ts tests/e2e/failure-injection.spec.ts tests/e2e/keyboard.spec.ts tests/e2e/portfolio.spec.ts
git commit -m "feat(ui): polish popup states and accessibility"
```

---

### Task 9: Performance Gate Hardening and Release Acceptance

**Files:**
- Modify: `tests/e2e/performance.spec.ts`
- Modify: `tests/e2e/ui-redesign.spec.ts`
- Modify: `store-assets/screenshot1-list.png`
- Modify: `store-assets/screenshot2-grid.png`
- Modify: `store-assets/screenshot3-add.png`
- Modify if output changes: `dist/stock-alert-extension-v2.0.0.zip` (normally ignored)
- Update checkboxes only after evidence: `docs/superpowers/plans/2026-08-05-performance-ui-polish.md`

**Interfaces:**
- Consumes completed implementation.
- Produces stable performance budgets, bounded-node regression assertions, refreshed release assets, deterministic ZIP, and final acceptance evidence.

- [ ] **Step 1: Harden the performance test without weakening measurement**

At the start of the capacity test use `test.setTimeout(60_000)` so the second deadline test is not skipped by suite overhead. Keep two warmups and ten measured launches. Measure list rows before clicking Grid and cards after the Grid render; assert both connected real-node limits:

```ts
const listRows = await launched.page.locator('stock-table tbody tr[data-key]').count();
expect(listRows).toBeLessThanOrEqual(27);
// click Grid and wait for the same double-rAF measurement used by domUpdateMs
const gridCards = await launched.page.locator('stock-grid stock-card[data-key]').count();
expect(gridCards).toBeLessThanOrEqual(24);
```

Set the project target assertion to `domUpdateP95 <= 80`; retain reporting against the external 100ms release ceiling in the failure message.

- [ ] **Step 2: Add a virtual-scroll long-task test**

Scroll through 20 deterministic offsets in list and grid, measuring each scheduled virtual update. Assert maximum synchronous/observed task duration ≤50ms and that the first and last requested regions render correct keys.

- [ ] **Step 3: Run all fast gates**

Run: `npm run check && npm run test:contracts && npm run test:unit && npm run test:critical-coverage && npm run test:component`

Expected: all commands exit 0; coverage remains above configured thresholds.

- [ ] **Step 4: Run complete browser gates**

Run: `npm run test:e2e && npm run test:a11y`

Expected: all scenarios pass. If the live quote scenario alone fails, retry that single test once and record it separately; never hide a reproducible product failure.

- [ ] **Step 5: Prove performance stability three times**

Run three independent times:

```bash
npm run test:performance
npm run test:performance
npm run test:performance
```

Expected each run: capacity test p95 ≤80ms, quote deadline test ≤8s, both tests execute and pass.

- [ ] **Step 6: Capture and inspect release visuals**

Run: `npm run capture:store`

Inspect all three 420×640 capture canvases. Verify the 420×560 Popup portion has no clipping, labels remain present, Status Bar is visible, list/grid/dialog match the approved precision-terminal hierarchy, and no mock/fabricated quote appears.

- [ ] **Step 7: Run the complete release pipeline**

Run: `npm run release:verify`

Expected: CI, performance, audit, rollback, deterministic build, capture, package, and bundle checks all pass; package contains exactly the intended v2.0.0 extension files.

- [ ] **Step 8: Verify deterministic artifact and clean tracked state**

Run:

```bash
shasum -a 256 dist/stock-alert-extension-v2.0.0.zip
git status --short
git diff --check
```

Expected: SHA matches deterministic-build output; only intended plan checkbox/store-asset changes remain tracked; pre-existing untracked `.gstack/`, `.superpowers/`, and `docs/superpowers/ACCEPTANCE-v2.0.0.md` are not staged.

- [ ] **Step 9: Commit final release evidence**

```bash
git add tests/e2e/performance.spec.ts tests/e2e/ui-redesign.spec.ts store-assets docs/superpowers/plans/2026-08-05-performance-ui-polish.md
git commit -m "test(release): verify popup performance and UI polish"
```

- [ ] **Step 10: Final acceptance summary**

Report exact test counts, three performance p95 values, coverage totals, audit result, rollback result, deterministic SHA, ZIP size, screenshots, and any external-network retry. Do not declare release-ready unless `npm run release:verify` exits 0 from the final committed state.
