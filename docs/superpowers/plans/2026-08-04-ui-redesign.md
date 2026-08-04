# UI 与交互整体焕新 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 v2.0.0 架构之上完成 Popup 整体焕新：深色交易终端主题（默认）+ 浅色切换、固定 420×560 布局、A1 图标+文字顶部操作区、行情信息增强（涨跌额/成交额/三态）、骨架屏、等宽数字、价格闪烁。

**Architecture:** 主题通过 CSS 自定义属性（`[data-theme]`）实现双套 token；主题状态走 Store（`view.theme`）+ `localStorage` 持久化；布局改为固定高度 + 行情区内部滚动；组件样式全部迁移到 token 变量。不改变 RPC/存储/行情语义。

**Tech Stack:** TypeScript 7, CSS Custom Properties, Light DOM Web Components, node:test + tsx + happy-dom, Playwright, @axe-core/playwright。

**Spec:** `docs/superpowers/specs/2026-08-04-ui-redesign-design.md`

## Global Constraints

- 零运行时第三方依赖；图标用内联 SVG，禁止图标字体/网络字体
- 44×44px 触控目标（行内操作按钮达 44px）
- WCAG 2.1 AA 对比度：深色/浅色 token 逐值校验
- 红涨绿跌（A 股惯例）；绝不模拟价格
- 主题不进 BoardConfig/UserData/chrome.storage.local（走 localStorage）
- 组件只收 ViewModel、发语义事件；不直接访问 Store/RPC
- reduced-motion 下所有动效 duration: 0s
- 现有 37 个核心 e2e + axe 门禁必须保持全绿

---

### Task 1: 双主题 CSS Design Tokens

**Files:**
- Modify: `extension/popup/styles/tokens.css`（完全重写）

**Interfaces:**
- 产出：`:root` 默认深色 token + `:root[data-theme="light"]` 浅色覆盖
- 消费方：layout.css / components.css / accessibility.css 引用变量

- [ ] **Step 1: 重写 tokens.css 为双主题 token**

```css
/* v2.x 双主题设计令牌
 * 深色（默认）：交易终端气质
 * 浅色：通过 [data-theme="light"] 覆盖
 * 所有组件样式只引用变量，不硬编码颜色。
 */
:root {
  /* 深色主题（默认） */
  --bg: #0a0e15;
  --bg-grad: linear-gradient(180deg, #0d1220 0%, #0a0e15 40%);
  --surface: #121722;
  --surface2: #1a2130;
  --surface3: #222b3d;
  --border: rgba(255, 255, 255, 0.07);
  --border-strong: rgba(255, 255, 255, 0.12);
  --text: #e9edf5;
  --text2: #96a0b5;
  --text3: #5f6a80;
  --up: #ff5b5b;
  --up-soft: rgba(255, 91, 91, 0.12);
  --down: #2fd18c;
  --down-soft: rgba(47, 209, 140, 0.12);
  --brand: #4d9fff;
  --brand-soft: rgba(77, 159, 255, 0.15);
  --gold: #e8b341;
  --shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
  --touch-target-min: 44px;
}

:root[data-theme="light"] {
  --bg: #f2f4f8;
  --bg-grad: linear-gradient(180deg, #ffffff 0%, #f2f4f8 45%);
  --surface: #ffffff;
  --surface2: #eef1f6;
  --surface3: #e3e8f0;
  --border: rgba(20, 30, 55, 0.08);
  --border-strong: rgba(20, 30, 55, 0.14);
  --text: #1c2333;
  --text2: #5c6779;
  --text3: #9aa3b2;
  --up: #d93025;
  --up-soft: rgba(217, 48, 37, 0.09);
  --down: #0f8a4c;
  --down-soft: rgba(15, 138, 76, 0.09);
  --brand: #2f6fbd;
  --brand-soft: rgba(47, 111, 189, 0.11);
  --gold: #c98a12;
  --shadow: 0 10px 40px rgba(30, 45, 80, 0.14);
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html,
body {
  height: 100%;
}
```

- [ ] **Step 2: 验证构建通过**

Run: `npm run build`
Expected: PASS（CSS 不参与 tsc，但 build 复制静态资源）

- [ ] **Step 3: Commit**

```bash
git add extension/popup/styles/tokens.css
git commit -m "style: dual-theme design tokens (dark default + light)"
```

---

### Task 2: 固定 420×560 布局 + 内部滚动

**Files:**
- Modify: `extension/popup/styles/layout.css`（完全重写）

**Interfaces:**
- 产出：固定宽高 + overflow hidden + 行情区滚动 + 状态栏固定底部
- 依赖：Task 1 的 token 变量

- [ ] **Step 1: 重写 layout.css**

```css
/* v2.x 固定 420×560 布局：顶部/底部固定，行情区内部滚动 */
body {
  font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  background: var(--bg-grad);
  background-color: var(--bg);
  color: var(--text);
  width: 420px;
  height: 560px;
  overflow: hidden;
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
  transition: background-color 0.35s, color 0.35s;
}

stock-app {
  display: flex;
  flex-direction: column;
  width: 420px;
  height: 560px;
  overflow: hidden;
}

stock-app[hidden] {
  display: none;
}

/* 行情区：唯一纵向滚动区 */
stock-board {
  display: block;
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
}

stock-board::-webkit-scrollbar {
  width: 7px;
}

stock-board::-webkit-scrollbar-thumb {
  background: var(--surface3);
  border-radius: 4px;
}

/* 状态栏固定底部（不随行情区滚动） */
quote-status {
  display: flex;
  align-items: center;
  height: 32px;
  flex-shrink: 0;
  padding: 0 13px;
  background: var(--surface);
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--text2);
  gap: 13px;
}

#fatal-fallback {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  width: 420px;
  height: 560px;
  padding: 24px;
  text-align: center;
  color: var(--text2);
}

#fatal-fallback[hidden] {
  display: none;
}

#btn-reload {
  min-height: var(--touch-target-min);
  min-width: 120px;
  padding: 0 20px;
  border: none;
  border-radius: 8px;
  background: var(--brand);
  color: #fff;
  font-size: 14px;
  cursor: pointer;
}

#btn-reload:active {
  opacity: 0.85;
}
```

- [ ] **Step 2: 验证构建**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add extension/popup/styles/layout.css
git commit -m "style: fixed 420x560 layout with internal scroll"
```

---

### Task 3: Store 主题状态（state + action + reducer）

**Files:**
- Modify: `src/popup/store/state.ts`
- Modify: `src/popup/store/actions.ts`
- Modify: `src/popup/store/reducer.ts`
- Test: `tests/unit/popup/reducer.test.ts`（追加）

**Interfaces:**
- `AppState.view.theme: 'dark' | 'light'`
- `AppAction: { type: 'view/theme'; theme: 'dark' | 'light' }`
- Reducer：更新 `view.theme`，其余分支引用不变

- [ ] **Step 1: 写失败测试**

在 `tests/unit/popup/reducer.test.ts` 末尾追加：

```ts
test('view/theme updates theme and preserves other branches', () => {
  const state = createInitialState();
  const next = reducer(state, { type: 'view/theme', theme: 'light' });
  assert.equal(next.view.theme, 'light');
  assert.equal(next.domain, state.domain); // 未变更分支引用相等
  assert.equal(next.async, state.async);
  assert.equal(next.overlay, state.overlay);
});

test('view/theme to dark works', () => {
  const state = createInitialState();
  const light = reducer(state, { type: 'view/theme', theme: 'light' });
  const dark = reducer(light, { type: 'view/theme', theme: 'dark' });
  assert.equal(dark.view.theme, 'dark');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test tests/unit/popup/reducer.test.ts`
Expected: FAIL — `theme` 不存在于 `view`

- [ ] **Step 3: 修改 state.ts — 添加 theme 字段**

在 `src/popup/store/state.ts` 的 `AppState.view` 中添加：

```ts
readonly view: Readonly<{
  currentGroupId: GroupId;
  searchKeyword: string;
  selectionMode: boolean;
  selectedCodes: readonly StockCode[];
  searchResults: readonly StockSearchResult[];
  theme: 'dark' | 'light';
}>;
```

在 `createInitialState()` 的 `view` 对象中添加：

```ts
theme: 'dark' as const,
```

- [ ] **Step 4: 修改 actions.ts — 添加 theme action**

在 `AppAction` 联合的 `// view` 区添加：

```ts
| { readonly type: 'view/theme'; readonly theme: 'dark' | 'light' }
```

- [ ] **Step 5: 修改 reducer.ts — 处理 theme action**

在 `// view` 区的 switch 分支中添加（在 `view/selectionMode` 之后）：

```ts
case 'view/theme':
  return { ...state, view: { ...state.view, theme: action.theme } };
```

- [ ] **Step 6: 运行测试确认通过**

Run: `node --import tsx --test tests/unit/popup/reducer.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/popup/store/state.ts src/popup/store/actions.ts src/popup/store/reducer.ts tests/unit/popup/reducer.test.ts
git commit -m "feat: add theme state to popup store"
```

---

### Task 4: 主题持久化 + AppShell 路由 + 入口初始化

**Files:**
- Modify: `src/popup/components/events.ts`（添加 theme-change 事件）
- Modify: `src/popup/app-shell.ts`（路由 theme-change）
- Modify: `src/popup/main.ts`（启动时读 localStorage 设 data-theme）
- Test: `tests/unit/popup/app-shell.test.ts`（追加）

**Interfaces:**
- `PopupEventMap['theme-change']: { readonly theme: 'dark' | 'light' }`
- AppShell：`on('theme-change', ...)` → dispatch + localStorage + data-theme
- main.ts：bootstrap 前读 `localStorage.getItem('uiTheme')` 设初始主题

- [ ] **Step 1: 写失败测试**

在 `tests/unit/popup/app-shell.test.ts` 追加：

```ts
test('theme-change event dispatches view/theme and sets localStorage', async () => {
  // 使用现有 test helper 创建 shell（参考文件中已有的 setup 模式）
  const { shell, store, root } = createTestShell();
  try {
    root.dispatchEvent(new CustomEvent('theme-change', {
      detail: { theme: 'light' },
      bubbles: true,
      composed: true
    }));
    assert.equal(store.getState().view.theme, 'light');
  } finally {
    shell.destroy();
  }
});
```

注意：此测试需要参考 `tests/unit/popup/app-shell.test.ts` 中已有的 `createTestShell` 或等价 helper。如果不存在，使用文件中已有的 setup 模式。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test tests/unit/popup/app-shell.test.ts`
Expected: FAIL — `theme-change` 未注册

- [ ] **Step 3: 修改 events.ts — 添加 theme-change**

在 `PopupEventMap` 接口中添加：

```ts
'theme-change': { readonly theme: 'dark' | 'light' };
```

- [ ] **Step 4: 修改 app-shell.ts — 路由 theme-change**

在 `// ===== 导航/视图事件 =====` 区（`selection-mode-change` 之后）添加：

```ts
on('theme-change', (d) => {
  store.dispatch({ type: 'view/theme', theme: d.theme });
  try { localStorage.setItem('uiTheme', d.theme); } catch { /* 隐私模式 */ }
  document.documentElement.dataset.theme = d.theme;
});
```

- [ ] **Step 5: 修改 main.ts — 启动时读主题**

在 `definePopupElements();` 之后、`const sink = ...` 之前添加：

```ts
// 主题初始化：读 localStorage，设 data-theme（在 Store 创建前执行，避免闪烁）。
const savedTheme = localStorage.getItem('uiTheme');
const initialTheme = savedTheme === 'light' ? 'light' : 'dark';
document.documentElement.dataset.theme = initialTheme;
```

修改 `createInitialState()` 调用处，传入初始主题：

```ts
const store = createStore(reducer, createInitialState(initialTheme));
```

- [ ] **Step 6: 修改 state.ts — createInitialState 接受初始主题**

```ts
export function createInitialState(theme: 'dark' | 'light' = 'dark'): AppState {
  return {
    // ...existing fields...
    view: {
      // ...existing fields...
      theme,
    },
    // ...
  };
}
```

- [ ] **Step 7: 运行测试确认通过**

Run: `node --import tsx --test tests/unit/popup/app-shell.test.ts`
Expected: PASS

- [ ] **Step 8: 运行全量 popup 单测确认无回归**

Run: `node --import tsx --test tests/unit/popup/*.test.ts`
Expected: ALL PASS

- [ ] **Step 9: Commit**

```bash
git add src/popup/components/events.ts src/popup/app-shell.ts src/popup/main.ts src/popup/store/state.ts tests/unit/popup/app-shell.test.ts
git commit -m "feat: theme persistence via localStorage + AppShell routing"
```

---

### Task 5: Header A1 重设计（图标+文字+主题切换）

**Files:**
- Modify: `src/popup/components/stock-header.ts`
- Modify: `src/popup/view-models.ts`（HeaderViewModel 添加 theme）
- Modify: `src/popup/store/selectors.ts`（selectHeader 传递 theme）
- Test: `tests/component/stock-header.test.ts`（追加）

**Interfaces:**
- `HeaderViewModel.theme: 'dark' | 'light'`
- 4 个按钮：主题（SVG 半圆 + 文字）/ 价格（SVG 眼睛 + 文字）/ 多选（SVG 勾选框 + 文字）/ 添加（SVG 加号 + 文字，品牌色）
- 主题按钮发 `theme-change`；其余保持现有事件

- [ ] **Step 1: 写失败测试**

在 `tests/component/stock-header.test.ts` 追加：

```ts
test('header renders 4 buttons with icon+label (A1 layout)', () => {
  const el = createHeader(); // 使用文件中已有的 helper
  el.viewModel = {
    groupName: '全部', stockCount: 5, selectionMode: false,
    priceHidden: false, canAddStock: true, theme: 'dark'
  };
  const btns = el.querySelectorAll('button');
  assert.equal(btns.length, 4);
  // 主题按钮文字随状态变
  const themeBtn = el.querySelector('[data-action="theme-toggle"]');
  assert.ok(themeBtn);
  assert.ok(themeBtn!.textContent!.includes('浅色')); // dark 状态下显示"浅色"（点击切换到浅色）
});

test('theme button emits theme-change event', () => {
  const el = createHeader();
  el.viewModel = {
    groupName: '全部', stockCount: 5, selectionMode: false,
    priceHidden: false, canAddStock: true, theme: 'dark'
  };
  let detail: unknown = null;
  el.addEventListener('theme-change', (e) => { detail = (e as CustomEvent).detail; });
  const themeBtn = el.querySelector('[data-action="theme-toggle"]') as HTMLButtonElement;
  themeBtn.click();
  assert.deepEqual(detail, { theme: 'light' });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test tests/component/stock-header.test.ts`
Expected: FAIL — 按钮数量/结构不匹配

- [ ] **Step 3: 修改 view-models.ts — HeaderViewModel 添加 theme**

```ts
export interface HeaderViewModel {
  readonly groupName: string;
  readonly stockCount: number;
  readonly selectionMode: boolean;
  readonly priceHidden: boolean;
  readonly canAddStock: boolean;
  readonly theme: 'dark' | 'light';
}
```

- [ ] **Step 4: 修改 selectors.ts — selectHeader 传递 theme**

在 `selectHeader` 返回对象中添加 `theme: state.view.theme`。

- [ ] **Step 5: 重写 stock-header.ts buildSkeleton + bindEvents + applyViewModel**

完全替换 `buildSkeleton()`：

```ts
private buildSkeleton(): void {
  const title = document.createElement('div');
  title.setAttribute('data-region', 'header-title');
  title.className = 'header-title';
  this.titleEl = title;

  const actions = document.createElement('div');
  actions.setAttribute('data-region', 'header-actions');
  actions.className = 'header-actions';

  // 主题切换按钮（SVG 半圆 + 文字标签）
  const themeBtn = document.createElement('button');
  themeBtn.type = 'button';
  themeBtn.className = 'header-btn header-btn--labeled';
  themeBtn.setAttribute('data-action', 'theme-toggle');
  themeBtn.setAttribute('aria-label', '切换主题');
  themeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/></svg><span class="header-btn-label">浅色</span>';
  this.themeBtn = themeBtn;

  // 价格可见性按钮（SVG 眼睛 + 文字标签）
  const priceBtn = document.createElement('button');
  priceBtn.type = 'button';
  priceBtn.className = 'header-btn header-btn--labeled header-btn--toggle';
  priceBtn.setAttribute('data-action', 'price-visibility');
  priceBtn.setAttribute('aria-pressed', 'false');
  priceBtn.setAttribute('aria-label', '隐藏价格');
  priceBtn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/></svg><span class="header-btn-label">价格</span>';
  this.priceBtn = priceBtn;

  // 多选按钮（SVG 勾选框 + 文字标签）
  const multiselectBtn = document.createElement('button');
  multiselectBtn.type = 'button';
  multiselectBtn.className = 'header-btn header-btn--labeled header-btn--toggle';
  multiselectBtn.setAttribute('data-action', 'multiselect');
  multiselectBtn.setAttribute('aria-pressed', 'false');
  multiselectBtn.setAttribute('aria-label', '进入多选模式');
  multiselectBtn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M8.5 12.2l2.6 2.6 4.6-5.2"/></svg><span class="header-btn-label">多选</span>';
  this.multiselectBtn = multiselectBtn;

  // 添加按钮（SVG 加号 + 文字标签，品牌色主操作）
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'header-btn header-btn--labeled header-btn--primary';
  addBtn.setAttribute('data-action', 'add-stock');
  addBtn.setAttribute('aria-label', '添加股票');
  addBtn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg><span class="header-btn-label">添加</span>';
  this.addBtn = addBtn;

  actions.append(themeBtn, priceBtn, multiselectBtn, addBtn);
  this.append(title, actions);
}
```

添加成员变量：

```ts
private themeBtn: HTMLButtonElement | null = null;
```

替换 `bindEvents`：

```ts
private bindEvents(signal: AbortSignal): void {
  this.addBtn?.addEventListener('click', () => {
    emitPopupEvent(this, 'dialog-open-request', { kind: 'add-stock' });
  }, { signal });

  this.multiselectBtn?.addEventListener('click', () => {
    const enabled = !(this._viewModel?.selectionMode ?? false);
    emitPopupEvent(this, 'selection-mode-change', { enabled });
  }, { signal });

  this.priceBtn?.addEventListener('click', () => {
    const priceHidden = !(this._viewModel?.priceHidden ?? false);
    emitPopupEvent(this, 'preferences-change', { patch: { priceHidden } });
  }, { signal });

  this.themeBtn?.addEventListener('click', () => {
    const next = (this._viewModel?.theme ?? 'dark') === 'dark' ? 'light' : 'dark';
    emitPopupEvent(this, 'theme-change', { theme: next });
  }, { signal });
}
```

替换 `applyViewModel`：

```ts
private applyViewModel(vm: HeaderViewModel): void {
  if (this.titleEl) {
    this.titleEl.textContent = `${vm.groupName} · ${vm.stockCount}`;
  }
  if (this.addBtn) {
    this.addBtn.disabled = !vm.canAddStock;
  }
  if (this.themeBtn) {
    const label = vm.theme === 'dark' ? '浅色' : '深色';
    const span = this.themeBtn.querySelector('.header-btn-label');
    if (span) span.textContent = label;
    this.themeBtn.setAttribute('aria-label', vm.theme === 'dark' ? '切换到浅色主题' : '切换到深色主题');
  }
  if (this.multiselectBtn) {
    this.multiselectBtn.setAttribute('aria-pressed', String(vm.selectionMode));
    this.multiselectBtn.classList.toggle('is-active', vm.selectionMode);
  }
  if (this.priceBtn) {
    this.priceBtn.setAttribute('aria-pressed', String(vm.priceHidden));
    this.priceBtn.classList.toggle('is-active', vm.priceHidden);
  }
}
```

- [ ] **Step 6: 运行测试确认通过**

Run: `node --import tsx --test tests/component/stock-header.test.ts`
Expected: PASS

- [ ] **Step 7: 运行全量 component 测试确认无回归**

Run: `node --import tsx --test tests/component/*.test.ts`
Expected: ALL PASS

- [ ] **Step 8: Commit**

```bash
git add src/popup/components/stock-header.ts src/popup/view-models.ts src/popup/store/selectors.ts tests/component/stock-header.test.ts
git commit -m "feat: header A1 redesign with SVG icons + theme toggle"
```

---

### Task 6: components.css 迁移到 token + 清理重复块

**Files:**
- Modify: `extension/popup/styles/components.css`（完全重写）

**Interfaces:**
- 所有颜色/背景/边框引用 token 变量
- 删除重复的 App Dialog Host 和 Search Combobox 块（行 820-1034）
- 新增 header-btn--labeled 样式（A1 按钮）
- 新增骨架屏样式

- [ ] **Step 1: 重写 components.css**

这是最大的一个文件改动。核心原则：
1. 所有 `var(--color-up, #e0413c)` → `var(--up)`（去掉 fallback，token 已定义）
2. 所有 `var(--surface-hover, #f1f3f4)` → `var(--surface2)`
3. 所有 `var(--border-color, #dadce0)` → `var(--border-strong)`
4. 所有 `var(--brand, #1a73e8)` → `var(--brand)`
5. 删除行 820-1034 的重复块
6. 新增 A1 header 按钮样式
7. 新增骨架屏样式

由于文件很大（1035 行），此处给出关键新增/修改段落。完整文件在实现时基于现有内容逐段替换变量。

**新增 A1 header 按钮样式（在 Stock Header 区）：**

```css
/* ===== Stock Header (A1: icon + label) ===== */
stock-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  padding: 0 12px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.header-title {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.3px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.header-actions {
  display: flex;
  gap: 5px;
  align-items: center;
}

.header-btn--labeled {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 34px;
  min-width: 34px;
  padding: 0 9px;
  border-radius: 9px;
  color: var(--text2);
  background: var(--surface2);
  border: 1px solid var(--border);
  cursor: pointer;
  font-size: 11px;
  transition: color 0.15s, background 0.15s, border-color 0.15s;
}

.header-btn--labeled:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--border-strong);
  background: var(--surface3);
}

.header-btn--labeled:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 2px;
}

.header-btn--labeled.is-active {
  color: var(--brand);
  background: var(--brand-soft);
  border-color: var(--brand);
  font-weight: 600;
}

.header-btn--labeled:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.header-btn--labeled.header-btn--primary {
  background: var(--brand-soft);
  color: var(--brand);
  border-color: var(--brand);
  font-weight: 600;
}

.header-btn--labeled.header-btn--primary:hover:not(:disabled) {
  background: var(--brand);
  color: #fff;
}

.header-btn-label {
  white-space: nowrap;
}

.header-btn--labeled svg {
  flex-shrink: 0;
}
```

**新增骨架屏样式（在 Stock Board 区）：**

```css
/* ===== Skeleton Loading ===== */
.board-loading {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
}

.board-loading[hidden] {
  display: none;
}

.skeleton-row {
  height: 44px;
  border-radius: 10px;
  background: var(--surface2);
  animation: skeleton-pulse 1.5s ease-in-out infinite;
}

@keyframes skeleton-pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}
```

**新增行情行样式（列表视图增强）：**

```css
/* ===== Stock Table Enhanced ===== */
.stock-table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}

.stock-table th {
  font-size: 10px;
  color: var(--text3);
  letter-spacing: 0.3px;
  padding: 6px 8px 4px;
  text-align: right;
  font-weight: 400;
}

.stock-table th:first-child {
  text-align: left;
}

.stock-table td {
  padding: 0 8px;
  height: 46px;
  text-align: right;
  font-size: 12px;
  border-bottom: 1px solid var(--border);
}

.stock-table td:first-child {
  text-align: left;
}

.stock-table tr {
  transition: background 0.16s;
  cursor: pointer;
}

.stock-table tr:hover {
  background: var(--surface2);
}

.stock-table tr.is-pinned {
  background: var(--surface);
}

.stock-table tr.is-pinned td:first-child {
  border-left: 3px solid var(--gold);
}

.stock-table-cell--name {
  font-weight: 600;
  font-size: 13px;
}

.stock-table-cell--code {
  font-size: 10px;
  color: var(--text3);
}

.stock-table-cell--price {
  font-size: 14px;
  font-weight: 700;
}

.stock-table-cell--change.is-up,
.stock-table-cell--change-percent.is-up {
  color: var(--up);
}

.stock-table-cell--change.is-down,
.stock-table-cell--change-percent.is-down {
  color: var(--down);
}

.stock-table-cell--amount {
  color: var(--text2);
  font-size: 11px;
}

/* 价格闪烁动画 */
.stock-table-cell--price.flash,
.stock-card-price.flash {
  animation: price-flash 0.25s ease-out;
}

@keyframes price-flash {
  0% { background: var(--brand-soft); }
  100% { background: transparent; }
}
```

**新增网格卡片增强样式：**

```css
/* ===== Stock Grid Enhanced ===== */
.stock-grid-container {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 9px;
  padding: 10px;
}

.stock-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 11px 12px;
  cursor: pointer;
  transition: border-color 0.16s, transform 0.16s, box-shadow 0.16s;
  position: relative;
}

.stock-card:hover {
  border-color: var(--border-strong);
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
}

.stock-card.is-pinned {
  border-color: var(--gold);
}
```

注意：实现时需要将现有 components.css 中所有旧变量引用替换为新 token，并删除重复块。上述代码段是新增/修改的关键部分；其余现有样式（toolbar、dialog、combobox、batch、column-panel、quote-status）保持结构不变，仅替换颜色变量。

- [ ] **Step 2: 验证构建**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add extension/popup/styles/components.css
git commit -m "style: migrate components.css to dual-theme tokens + remove duplicates"
```

---

### Task 7: 行情信息增强（ViewModel + stock-card + stock-table）

**Files:**
- Modify: `src/popup/view-models.ts`（StockCardViewModel 添加 amount 展示）
- Modify: `src/popup/components/stock-card.ts`（三态呈现 + 涨跌额）
- Modify: `src/popup/components/stock-table.ts`（添加成交额列 + 代码列）
- Test: `tests/component/stock-card.test.ts`（追加）
- Test: `tests/component/stock-table.test.ts`（追加）

**Interfaces:**
- `StockCardViewModel` 添加 `displayChange: string` 和 `displayAmount: string`
- stock-table COLUMNS 添加 `{ key: 'amount', label: '成交额', sortField: 'amount' }`
- 三态：fresh 正常色 / cached 降透明度+staleLabel / missing 灰色+`--`

- [ ] **Step 1: 写失败测试**

在 `tests/component/stock-table.test.ts` 追加：

```ts
test('table renders amount column', () => {
  const el = createTable(); // 使用文件中已有 helper
  el.viewModel = [{
    code: 'sh600519' as StockCode, name: '贵州茅台', price: 1689,
    change: 13.5, changePercent: 0.81, amount: 2_000_000_000,
    status: 'fresh' as const, pinned: false, staleLabel: '',
    displayPrice: '1689.00', displayChange: '+13.50', displayAmount: '20.0亿'
  }];
  const headers = el.querySelectorAll('th');
  const labels = [...headers].map((h) => h.textContent);
  assert.ok(labels.includes('成交额'));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test tests/component/stock-table.test.ts`
Expected: FAIL — 无成交额列

- [ ] **Step 3: 修改 view-models.ts — 添加 displayChange/displayAmount**

在 `StockCardViewModel` 接口添加：

```ts
/** 涨跌额展示文本（带符号）；缺失时 '--'。 */
readonly displayChange: string;
/** 成交额展示文本（亿/万分级）；缺失时 '--'。 */
readonly displayAmount: string;
```

在 `toStockCardViewModels` 中计算：

```ts
const displayChange = change === null ? '--' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}`;
const displayAmount = amount === null ? '--' : formatAmountText(amount);
```

添加 helper（在 view-models.ts 内）：

```ts
/** 格式化成交额：亿/万分级（与 domain formatting 一致）。 */
function formatAmountText(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '--';
  if (v >= 100_000_000) return `${(v / 100_000_000).toFixed(1)}亿`;
  if (v >= 10_000) return `${(v / 10_000).toFixed(1)}万`;
  return v.toFixed(0);
}
```

并在 return 对象中添加 `displayChange` 和 `displayAmount`。

注意：`toStockCardViewModels` 需要从 quote 中取 `amount`：

```ts
const amount = quote && Number.isFinite(quote.amount) ? quote.amount : null;
```

- [ ] **Step 4: 修改 stock-table.ts — 添加成交额列**

在 `COLUMNS` 数组中，`changePercent` 之后添加：

```ts
{ key: 'amount', label: '成交额', sortField: 'amount' },
```

在 `renderRow` 或等价的行渲染逻辑中，为 `amount` 列生成 `<td>`：

```ts
case 'amount': {
  const td = document.createElement('td');
  td.className = 'stock-table-cell--amount';
  td.textContent = vm.displayAmount;
  return td;
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `node --import tsx --test tests/component/stock-table.test.ts tests/component/stock-card.test.ts`
Expected: PASS

- [ ] **Step 6: 运行全量 component 测试**

Run: `node --import tsx --test tests/component/*.test.ts`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add src/popup/view-models.ts src/popup/components/stock-card.ts src/popup/components/stock-table.ts tests/component/stock-table.test.ts tests/component/stock-card.test.ts
git commit -m "feat: add amount column + displayChange to quote views"
```

---

### Task 8: 骨架屏 Loading

**Files:**
- Modify: `src/popup/components/stock-board.ts`
- Test: `tests/component/stock-board.test.ts`（追加）

**Interfaces:**
- Loading 态渲染 5 个 `.skeleton-row` 占位条（无假数字）
- `aria-busy="true"` 在 loading 态

- [ ] **Step 1: 写失败测试**

在 `tests/component/stock-board.test.ts` 追加：

```ts
test('loading state renders skeleton rows with aria-busy', () => {
  const el = createBoard(); // 使用文件中已有 helper
  el.viewModel = { viewMode: 'list', stocks: [], loading: true, empty: false, error: null };
  const loading = el.querySelector('[data-region="loading"]');
  assert.ok(loading);
  assert.equal(loading!.getAttribute('hidden'), null); // 可见
  assert.equal(loading!.getAttribute('aria-busy'), 'true');
  assert.ok(loading!.querySelectorAll('.skeleton-row').length >= 3);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test tests/component/stock-board.test.ts`
Expected: FAIL — loading 态无 skeleton-row

- [ ] **Step 3: 修改 stock-board.ts buildSkeleton — loading 态用骨架条**

替换 loading 容器构建：

```ts
const loadingEl = document.createElement('div');
loadingEl.setAttribute('data-region', 'loading');
loadingEl.className = 'board-loading';
loadingEl.setAttribute('hidden', '');
loadingEl.setAttribute('aria-busy', 'true');
loadingEl.setAttribute('aria-label', '加载中');
// 5 个骨架占位条（无假数据）
for (let i = 0; i < 5; i++) {
  const row = document.createElement('div');
  row.className = 'skeleton-row';
  loadingEl.append(row);
}
this.loadingEl = loadingEl;
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --import tsx --test tests/component/stock-board.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/popup/components/stock-board.ts tests/component/stock-board.test.ts
git commit -m "feat: skeleton loading state for stock board"
```

---

### Task 9: 价格闪烁动画

**Files:**
- Modify: `src/popup/components/stock-table.ts`（检测价格变化 → 添加 flash class）
- Modify: `src/popup/components/stock-card.ts`（同上）

**Interfaces:**
- 当 `displayPrice` 变化时，给价格元素添加 `.flash` class，250ms 后移除
- `reduced-motion` 下 CSS 已将 animation-duration 归零（accessibility.css 覆盖）

- [ ] **Step 1: 修改 stock-table.ts — 价格变化检测**

在行渲染/更新逻辑中，当 price cell 的 textContent 即将变化时：

```ts
// 在更新 price cell 时检测变化
const oldPrice = priceTd.textContent;
priceTd.textContent = vm.displayPrice;
if (oldPrice !== vm.displayPrice && vm.displayPrice !== '--') {
  priceTd.classList.add('flash');
  setTimeout(() => priceTd.classList.remove('flash'), 250);
}
```

- [ ] **Step 2: 修改 stock-card.ts — 同样逻辑**

在 `applyViewModel` 的 priceEl 更新处：

```ts
if (this.priceEl) {
  const old = this.priceEl.textContent;
  this.priceEl.textContent = vm.displayPrice;
  if (old !== vm.displayPrice && vm.displayPrice !== '--') {
    this.priceEl.classList.add('flash');
    setTimeout(() => this.priceEl!.classList.remove('flash'), 250);
  }
}
```

- [ ] **Step 3: 运行 component 测试确认无回归**

Run: `node --import tsx --test tests/component/*.test.ts`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add src/popup/components/stock-table.ts src/popup/components/stock-card.ts
git commit -m "feat: price flash animation on quote update"
```

---

### Task 10: accessibility.css 扩展（reduced-motion 覆盖新动效）

**Files:**
- Modify: `extension/popup/styles/accessibility.css`

- [ ] **Step 1: 确认现有 reduced-motion 覆盖已包含新动效**

现有 `accessibility.css` 已有：

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    transition-duration: 0s !important;
    animation-duration: 0s !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
  }
}
```

这已覆盖所有新增的 `price-flash`、`skeleton-pulse`、主题过渡。无需修改。验证即可。

- [ ] **Step 2: 验证（无改动则跳过 commit）**

Run: `npm run build`
Expected: PASS

---

### Task 11: E2E 集成测试（主题 + 布局 + 信息增强）

**Files:**
- Create: `tests/e2e/ui-redesign.spec.ts`

**Interfaces:**
- 主题切换：点击主题按钮 → `data-theme` 变化 → localStorage 持久化 → 重开保留
- 固定布局：body 420×560，状态栏在首屏可见
- 行情区内部滚动：body 无纵向滚动
- 成交额列存在

- [ ] **Step 1: 写 E2E 测试**

```ts
// tests/e2e/ui-redesign.spec.ts
import { test, expect } from '@playwright/test';
import { launchBuiltExtension, baseSeed, CODES, stock, cache } from './extension-fixture.js';

const now = Date.now();

function seedWithQuotes() {
  return baseSeed({
    watchlist: CODES.map((code, i) => stock(code, i)),
    boardConfig: { g_all: { viewMode: 'list', sortField: 'manual' } },
    ...Object.fromEntries(CODES.map((code, i) => {
      const q = cache(code, now, 10 + i);
      return [`quoteCache:${code}`, {
        ...q,
        quote: { ...q.quote, price: 10 + i, amount: 1_000_000_000 + i * 100_000_000 }
      }];
    }))
  });
}

test('theme toggle changes data-theme and persists', async () => {
  const launched = await launchBuiltExtension({ offline: true, holdQuotes: true, seed: seedWithQuotes() });
  const { page, close } = launched;
  try {
    await page.setViewportSize({ width: 420, height: 560 });
    // 初始深色
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    // 点击主题按钮
    await page.click('[data-action="theme-toggle"]');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    // 重开 popup 保留
    await page.reload();
    await page.waitForSelector('[data-action="theme-toggle"]', { timeout: 10_000 });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  } finally {
    await close();
  }
});

test('popup is fixed 420x560 with no body scroll', async () => {
  const launched = await launchBuiltExtension({ offline: true, holdQuotes: true, seed: seedWithQuotes() });
  const { page, close } = launched;
  try {
    await page.setViewportSize({ width: 420, height: 560 });
    await page.waitForSelector('stock-table', { timeout: 10_000 });
    const metrics = await page.evaluate(() => ({
      bodyW: document.body.clientWidth,
      bodyH: document.body.clientHeight,
      scrollH: document.body.scrollHeight
    }));
    expect(metrics.bodyW).toBe(420);
    expect(metrics.bodyH).toBe(560);
    expect(metrics.scrollH).toBeLessThanOrEqual(560);
  } finally {
    await close();
  }
});

test('status bar is visible in viewport', async () => {
  const launched = await launchBuiltExtension({ offline: true, holdQuotes: true, seed: seedWithQuotes() });
  const { page, close } = launched;
  try {
    await page.setViewportSize({ width: 420, height: 560 });
    await page.waitForSelector('quote-status', { timeout: 10_000 });
    const box = await page.locator('quote-status').boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(560);
  } finally {
    await close();
  }
});

test('table shows amount column', async () => {
  const launched = await launchBuiltExtension({ offline: true, holdQuotes: true, seed: seedWithQuotes() });
  const { page, close } = launched;
  try {
    await page.setViewportSize({ width: 420, height: 560 });
    await page.waitForSelector('stock-table', { timeout: 10_000 });
    const headers = await page.locator('stock-table th').allTextContents();
    expect(headers).toContain('成交额');
  } finally {
    await close();
  }
});
```

- [ ] **Step 2: 运行 E2E**

Run: `npx playwright test tests/e2e/ui-redesign.spec.ts`
Expected: 4 PASSED

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/ui-redesign.spec.ts
git commit -m "test: e2e for theme toggle, fixed layout, amount column"
```

---

### Task 12: a11y 双主题扫描

**Files:**
- Modify: `tests/e2e/accessibility.spec.ts`（扩展双主题）

- [ ] **Step 1: 在 accessibility.spec.ts 中添加深色主题扫描**

在现有 `STATES` 循环之后添加：

```ts
// 浅色主题下的 axe 扫描（确保双主题均无 critical/serious）
test.skip(!canRunA11y, SKIP_REASON);
test('axe has no critical/serious violation in light theme (grid)', async () => {
  const needsStocks = true;
  const launched = await launchBuiltExtension({
    offline: true,
    seed: baseSeed({
      watchlist: CODES.map((code, i) => stock(code, i)),
      boardConfig: { g_all: { viewMode: 'grid', sortField: 'manual' } },
      ...Object.fromEntries(CODES.slice(0, 3).map((code) => [`quoteCache:${code}`, cache(code, Date.now())]))
    })
  });
  const { page, close } = launched;
  try {
    // 切换到浅色
    await page.click('[data-action="theme-toggle"]');
    await page.waitForTimeout(400);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const critical = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(critical).toEqual([]);
  } finally {
    await close();
  }
});
```

注意：需要在文件顶部确认 `AxeBuilder` 的 import 已存在（应该已有）。

- [ ] **Step 2: 运行 a11y 测试**

Run: `RUN_A11Y=1 npx playwright test tests/e2e/accessibility.spec.ts`
Expected: ALL PASS（含新增浅色主题测试）

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/accessibility.spec.ts
git commit -m "test: axe scan for light theme"
```

---

### Task 13: 全量验证 + 修复回归

**Files:**
- 无新建；修复任何回归

- [ ] **Step 1: 运行完整 CI 门禁**

Run: `npm run ci`
Expected: ALL PASS

注意：`npm run ci` 包含 check + contracts + unit + critical-coverage + component + e2e + a11y。
a11y 在 CI 环境下需要 `RUN_A11Y=1`（当前 shell CI=1）。

如果 CI 变量导致 a11y 跳过，单独运行：
Run: `RUN_A11Y=1 npx playwright test tests/e2e/accessibility.spec.ts`

- [ ] **Step 2: 运行 6 个核心 e2e 确认无回归**

Run: `npx playwright test tests/e2e/portfolio.spec.ts tests/e2e/groups.spec.ts tests/e2e/keyboard.spec.ts tests/e2e/recovery.spec.ts tests/e2e/preferences.spec.ts tests/e2e/quotes.spec.ts`
Expected: 37 PASSED

- [ ] **Step 3: 修复任何回归（如有）**

根据失败信息修复，重新运行直到全绿。

- [ ] **Step 4: 最终 commit（如有修复）**

```bash
git add -A
git commit -m "fix: resolve regressions from UI redesign"
```

---

### Task 14: 更新商店截图

**Files:**
- Modify: `scripts/capture-store-assets.mjs`（viewport 已是 420×640，确认兼容）

- [ ] **Step 1: 重新捕获商店截图**

Run: `npm run capture:store`
Expected: 生成 store-assets/screenshot*.png（深色主题）

- [ ] **Step 2: Commit**

```bash
git add store-assets/
git commit -m "chore: refresh store screenshots with new dark theme"
```

---

## Self-Review Checklist

- [x] Spec 3.1（双主题 token）→ Task 1
- [x] Spec 3.2（固定 420×560）→ Task 2
- [x] Spec 3.3（A1 顶部操作区）→ Task 5
- [x] Spec 3.4（行情信息增强）→ Task 7
- [x] Spec 3.5（视觉 token）→ Task 1 + Task 6
- [x] Spec 3.6（动效/骨架屏）→ Task 8 + Task 9 + Task 10
- [x] Spec §4 组件改动清单 → Tasks 3-9
- [x] Spec §5 无障碍 → Task 12
- [x] Spec §6 测试策略 → Tasks 3,4,5,7,8,11,12
- [x] Spec §9 验收标准 → Task 13 全量验证
- [x] 无 placeholder / TBD
- [x] 类型一致性：`theme: 'dark' | 'light'` 贯穿 state/action/event/ViewModel
