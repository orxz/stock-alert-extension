# popup 模块群 — 弹窗 UI

## overview

v2.0.0 将弹窗 UI 重写为 TypeScript + ESM 的单向数据流架构（`src/popup/`，`tsc` 输出到 `build/extension/runtime/popup/`，由 `extension/popup.html` 以 `<script type="module">` 加载）。Popup 是 MV3 下的一个组合根：自身不直接访问 `Storage` / `QuoteService`，所有读写在 SW 之间走 RPC v2 单一注册表（`src/protocol/registry.ts`，13 个方法）。分层依赖严格收敛为 `domain` → `protocol` → `popup` 内部；组件层只依赖 `domain` 类型 + `view-models` + 语义事件，**无 RPC / Store 依赖**。

数据流：

```
用户交互 ──CustomEvent(语义)──▶ AppShell ──dispatch / controller──▶ Store(reducer)
                                                                       │
Store 变更 ──subscribe──▶ AppShell.renderAppSafely ──set viewModel──▶ selectAppViewModel
                                                                       │
                                                            Light DOM Web Components 渲染
```

## 模块结构

```
src/popup/
├── main.ts                 — 入口：definePopupElements → createStore → CallbackRpcClient →
│                              CommandController → createAppShell → bootstrap → 调度刷新 → pagehide 清理
├── app-shell.ts            — 应用外壳：renderAppSafely（含静态 fallback）+ 语义事件路由
├── view-models.ts          — 纯数据 ViewModel（无方法 / 无副作用），由 selectors 派生
├── rpc-client.ts           — typed callback RPC 客户端（requestId + 10s 超时 + RpcUncertainError）
├── store/
│   ├── state.ts            — AppState 四区（domain/view/async/overlay）+ createInitialState
│   ├── actions.ts          — AppAction 判别联合（bootstrap/quote/search/mutation/view/overlay）
│   ├── reducer.ts          — 纯 reducer：(state, action) => state，唯一状态写入口
│   ├── selectors.ts        — 纯只读 Selector：从 AppState 派生 ViewModel
│   └── store.ts            — createStore：可观察 Store（getState/dispatch/subscribe）
├── commands/
│   ├── command-controller.ts   — 语义命令层：写命令 + gesture key 去重 + generation 防竞态
│   ├── mutation-reconciler.ts  — 写命令对账：uncertain → bootstrap → desired-state → 安全重试一次
│   └── desired-state.ts        — 每个 mutation 的期望态谓词（satisfies 穷尽）
├── components/             — Light DOM Web Components（stock-app 根 + 子组件 + app-dialog-host）
│   ├── events.ts               — PopupEventMap 语义事件 + emitPopupEvent
│   ├── keyed-update.ts         — updateKeyedChildren：data-key 最小化 DOM diff
│   ├── define-elements.ts      — customElements.define 全部组件（幂等）
│   ├── stock-app.ts            — 根组件：组合子组件，分发 AppViewModel
│   ├── stock-header / group-tabs / stock-toolbar / stock-board / batch-toolbar / quote-status
│   ├── stock-grid / stock-table / stock-card / column-panel
│   ├── app-dialog-host.ts      — 对话框宿主（add/create/rename/move/confirm-remove）
│   ├── app-live-region.ts      — 无障碍实时区域（toast / 状态播报）
│   └── stock-search-combobox.ts — 搜索联想 combobox
└── a11y/                   — dialog-controller（焦点陷阱）+ focus（焦点恢复）
```

## init 序列

`main.ts` 的生产级 bootstrap：

```
definePopupElements()                          — 注册全部 Custom Elements（幂等，重复调用安全）
  → createStore(reducer, createInitialState()) — 不可变初始态（g_all 计算视图打头，空 watchlist，async idle，无 overlay）
  → new CallbackRpcClient(chrome.runtime.sendMessage)
  → new CommandController(rpc, store)
  → createAppShell({ store, controller, stockApp, fallback, liveRegion, dialogHost, sink, clock })
  → controller.bootstrap()                     — dispatch 'bootstrap/requested' → rpc.call('app:bootstrap') → confirmed/failed
       .then(scheduleNextRefresh)              — bootstrap 成功后启动行情刷新调度
  → pagehide listener                          — destroyed=true + clearTimeout(refreshTimer) + shell.destroy()
```

行情调度为递归 `setTimeout`（**不使用 chrome.alarms**）：A 股交易时段（工作日 9:25–11:30 / 13:00–15:00 北京时间）10 秒、盘外 5 分钟；每次取 `store.getState().domain.userData.watchlist` 的 codes 调 `controller.refreshQuotes(codes, false)`。

## architecture_design

### store/（不可变 AppState + 纯 reducer）

`AppState` 是纯数据，**不含 DOM 节点 / Promise / timer / AbortController / class instance / 可变 Set·Map**，分四个只读区：

```
AppState
├── domain        — userData / revision(SHA-256) / quotes(QuoteSnapshot)：唯一被 confirmed bootstrap/mutation 替换的权威数据
├── view          — currentGroupId / searchKeyword / selectionMode / selectedCodes / searchResults：纯客户端视图态
├── async         — bootstrap / quoteRefresh / stockSearch 异步状态 + mutations(key→MutationAsyncState) 表 + quoteGeneration/searchGeneration
└── overlay       — dialog(判别联合) / menu / toast / focusReturnId
```

`reducer(state, action): AppState` 是**唯一状态写入口**，规则：

1. 只有 confirmed bootstrap / mutation 才替换持久 `domain` 数据；
2. 只克隆变更分支，未变更分支保持引用相等；
3. 未知 action 返回原 state（相同引用）；
4. **stale generation 拒绝**：`quote/refresh/confirmed|failed` 与 `search/confirmed|failed` 比对 `action.generation` 与 state 中的 generation，不匹配则返回原 state。

`createStore`：`getState()` / `dispatch(action)` / `subscribe(listener) → unsubscribe`；通知前对 listener 集合快照（防迭代中增删），unsubscribe 幂等。

### commands/（语义命令层 + 对账器）

**`CommandController`** 是 Popup UI 的唯一写出口。每个写命令从 Store 取 `expectedRevision`（当前权威 revision），经 `MutationReconciler` 执行：

```
addStock / removeStocks / moveStocks / setPinned / setOrder
createGroup / renameGroup / deleteGroup / setGroupOrder / patchPreferences
```

- **gesture key 去重**：相同 method + 关键参数的 in-flight 命令合并为同一 promise（`inflight: Map<string, Promise<void>>`），落定后移除，允许后续同 key 命令重新发起。
- **createGroup 客户端生成 ID**：`g_${crypto.randomUUID()}` 作为 groupId，保证离线/冲突时稳定标识。
- **读命令用 generation 防竞态**：`searchStocks` / `refreshQuotes` 单调递增 generation，仅最新 query 的响应被接受；`bootstrap` 走 requested → call → confirmed/failed，不走 reconciler。

**`MutationReconciler`**（reconcile-before-retry）路径：

```
pending → call → confirmed（成功）
pending → call → 非 RpcUncertainError → failed
pending → call → RpcUncertainError → uncertain → bootstrap/confirmed（安装权威快照）
    → desiredState 满足 → reconciled（不重试，bootstrap 数据已生效）
    → desiredState 不满足 → 用 bootstrap 后的新 revision 安全重试一次
        重试成功 → confirmed
        重试非 uncertain（含 CONFLICT）→ failed（bootstrap 数据已安装）
        重试再次 uncertain → 保持 uncertain（不再重试，需用户手动重试）
```

**`desired-state.ts`**：每个 mutation 对应一个期望态谓词（`stock:add` / `stock:remove` / `stock:move` / `stock:setPinned` / `stock:setOrder` / `group:create` / `group:rename` / `group:delete` / `group:setOrder` / `preferences:patch`），通过 `satisfies { [M in MutationMethod]: ... }` **穷尽**——新增 mutation 必须补谓词，否则编译失败。`isDesiredStateSatisfied` 在 bootstrap 后判定远端是否已达成期望态，避免盲重试造成重复提交。

### rpc-client.ts（typed callback RPC 客户端）

`CallbackRpcClient` 包装 `chrome.runtime.sendMessage` 的 callback 形态，提供类型安全的 `call<M>(method, payload, options?)`。每次 call：

1. 生成唯一 `requestId`（`crypto.randomUUID()`），构造 `{ protocol: 2, requestId, method, payload }` 信封；
2. 启动 `setTimeout`（默认 **10s**）；
3. callback 返回后按序校验，任一失败 reject 一个明确的 `RpcClientError`：
   - `chrome.runtime.lastError` → `CONNECTION_FAILED`（不可重试）
   - 空响应 → `EMPTY_RESPONSE`
   - `protocol !== 2` → `PROTOCOL_MISMATCH`
   - `requestId` 不匹配（串扰/旧响应）→ `REQUEST_ID_MISMATCH`
   - `ok === false` → 携带远端 `code/message/retryable`
   - 缺 `ok` 字段 → `MALFORMED_RESPONSE`
4. **超时（已发送、响应丢失）→ `RpcUncertainError`（code: `RPC_UNCERTAIN`）**——不确定 mutation 是否已提交到远端，是触发 `MutationReconciler` 对账的唯一信号。

`settled` 标志保证超时与迟到响应互斥（迟到的响应被丢弃）。

### components/（Light DOM Web Components）

全部组件为 Light DOM Custom Elements（无 Shadow DOM、无虚拟 DOM、无框架），由 `define-elements.ts` 幂等注册：

- **根组件 `stock-app`**：组合 `stock-header` / `group-tabs` / `stock-toolbar` / `stock-board` / `batch-toolbar` / `quote-status`，通过 `set viewModel(AppViewModel)` 接收单次渲染快照并分发给子组件。**仅 import domain types + view-models + 子组件，无 RPC/Store 依赖**。
- **语义事件**：子组件通过 `emitPopupEvent(target, type, detail)` 发出 `CustomEvent`（`bubbles: true, composed: true`），冒泡到 `stock-app` 根，由 `AppShell` 监听并路由。`PopupEventMap` 穷举全部事件：`group-select` / `group-order-request` / `stock-pin-request` / `stock-remove-request` / `stock-order-request` / `batch-move-request` / `view-mode-change` / `preferences-change` / `selection-mode-change` / `stock-toggle-select` / `search-keyword-change` / `dialog-open-request` / `column-panel-open-request` / `dialog-submit` / `dialog-close-request` / `stock-search-select` / `quote-refresh-request`。
- **AbortController 生命周期**：每个组件持有 per-connection `AbortController`，`connectedCallback` 中 `abort()` 旧连接再建新的，所有 `addEventListener` 传 `{ signal }`，`disconnectedCallback` 后监听器自动清理。
- **keyed update**：`updateKeyedChildren(container, values, keyOf, create, update)` 用 `data-key` 属性做最小化 DOM diff——按 key 复用已存在节点并 `update`，新增节点 `create` 并 `insertBefore` 维持顺序，未出现在新列表的旧节点 `remove`。列表组件（grid/table/tabs）统一用它。
- **无 innerHTML**：所有用户可见文本通过 `textContent` / 文本节点注入，价格掩码改变文本为 `****` 但保留 accessible name；`fresh/cached/missing` 有文本标签。

### app-shell.ts（应用外壳）

`createAppShell(deps)` 连接 Store + CommandController + DOM 根元素（`#stock-app` / `#fatal-fallback` / `#app-live-region` / `#dialog-host`）：

- **`renderAppSafely()`**：`try` 内 `selectAppViewModel(state)` → 写入 `stockApp.viewModel` / `dialogHost.viewModel` / `liveRegion.viewModel`；bootstrap 失败或渲染抛错时 `catch` → 隐藏 `#stock-app`、显示静态 `#fatal-fallback`（`role="alert"`，含"重新加载"按钮），并通过 `sink.emit` 记录 `render-failed` 诊断。
- **语义事件路由**：`on(type, handler)` 用单个 `AbortController`（`ac.signal`）在 `stock-app` 与 `dialog-host`（兄弟元素）上注册监听，把 `PopupEventMap` 事件分发到 `store.dispatch`（纯视图态）或 `controller.*`（写命令）。对话框提交经 `routeDialogSubmit(d, controller, store)` 按 `kind` 调对应命令并关闭对话框。
- **`destroy()` 幂等**：`ac.abort()` 撤销全部监听 + `unsubscribe()` 解除 Store 订阅。

### view-models.ts（纯数据 ViewModel）

纯数据接口（`StockCardViewModel` / `GroupTabViewModel` / `ToolbarViewModel` / `HeaderViewModel` / `BatchToolbarViewModel` / `BoardViewModel` / `QuoteStatusViewModel` / `LiveRegionViewModel` / `DialogViewModel` / `SearchComboboxViewModel` / 聚合 `AppViewModel`），无方法、无副作用，由 `selectors` 从 `AppState` 派生。**偏好单一真相**：`selectCurrentBoardConfig` 从 `domain.userData.boardConfig[currentGroupId]` 派生，缺省回退 `defaultBoardConfig()`（list + manual + asc + 价格可见）——`viewMode` / `sortField` / `sortDirection` / `priceHidden` 的唯一真相来源。`toStockCardViewModels` / `toGroupTabs` / `closedDialog` 为纯投影 helper。

## tech_stack

- TypeScript + ESM（`src/popup/`），`tsc` 输出到 `build/extension/runtime/popup/`
- 原生 Light DOM Web Components（Custom Elements + `connectedCallback` / `disconnectedCallback`），无 Shadow DOM、无虚拟 DOM、无框架
- 单向数据流：`Store(reducer)` 为唯一状态写入口，`selectors` 只读派生，组件通过 `set viewModel` 接收不可变快照
- 语义事件总线：子组件 `CustomEvent(bubbles+composed)` → 根组件 → `AppShell` 路由
- RPC v2：`CallbackRpcClient` 经 `chrome.runtime.sendMessage` → SW 单一注册表（13 方法：`app:bootstrap` / `quote:refresh` / `stock:search` + 10 个 mutation）
- AbortController 管理组件与 AppShell 的全部监听器生命周期
- CSS 设计令牌系统（CSS Custom Properties，WCAG 2.1 AA），样式在 `extension/popup/styles/`
- ARIA 无障碍：`role="region"` 看板、`app-live-region` 实时区域、`app-dialog-host` 焦点陷阱
- 递归 `setTimeout` 行情刷新调度（盘中 10s / 盘外 5min），不使用 chrome.alarms

## coding_conventions

### 客户端生成稳定标识

`createGroup` 在客户端用 `g_${crypto.randomUUID()}` 生成 groupId（而非依赖服务端回填），保证离线、并发、冲突场景下的稳定标识。Popup 使用 DOM lib（`crypto.randomUUID` / `setTimeout` / `clearTimeout` 均可用）。

### 搜索 / 行情 generation 防竞态

`searchStocks` / `refreshQuotes` 维护单调递增 `generation`（`searchGeneration` / `quoteGeneration`）：

```typescript
// command-controller.ts
const generation = this.store.getState().async.searchGeneration + 1;
this.store.dispatch({ type: 'search/requested', query, generation });
const results = await this.rpc.call('stock:search', { query });
if (generation !== this.store.getState().async.searchGeneration) return; // 丢弃 stale
this.store.dispatch({ type: 'search/confirmed', results, generation });
```

reducer 对 `confirmed/failed` 也比对 `action.generation`，双重保险。代码前缀补全 / 搜索联想在 SW 端完成（`stock:search`），Popup 不再做本地正则。

### RPC 错误处理：uncertain vs 明确失败

写命令的错误分两类，语义不同：

- **明确失败（`RpcClientError`）**：`CONNECTION_FAILED` / `EMPTY_RESPONSE` / `PROTOCOL_MISMATCH` / `REQUEST_ID_MISMATCH` / `MALFORMED_RESPONSE` / 远端 `ok:false` → 直接 `mutation/failed`，`toSafeClientError` 映射为客户端安全 `{ code, message, retryable }`。
- **不确定（`RpcUncertainError`，10s 超时 / 响应丢失）**：触发 `MutationReconciler` 的 bootstrap 对账流程（见 architecture_design），绝不盲重试。

读命令（search/quote/bootstrap）的错误一律经 `toSafeClientError` 写入对应 async 区，由 UI 展示。

### 安全设计

- **无 innerHTML**：组件全部用 `textContent` / 文本节点，杜绝 XSS；价格掩码仅替换文本。
- **渲染安全降级**：`renderAppSafely` 的 `try/catch` 保证任何渲染异常都回退到静态 `#fatal-fallback`（含"重新加载"按钮），不让用户看到白屏。
- **生命周期幂等**：`destroy()` / `definePopupElements()` / `unsubscribe()` 均幂等；`pagehide` 清理全部 timer 与监听。
- **AbortController 隔离**：组件 reconnect 时 `abort()` 旧连接，杜绝悬挂监听器。

## gotchas_and_constraints

### 偏好单一真相（boardConfig）

`viewMode` / `sortField` / `sortDirection` / `priceHidden` 只能从 `selectCurrentBoardConfig(state)`（即 `domain.userData.boardConfig[currentGroupId]`）派生，**不要在 view 区复制一份**。写入统一走 `controller.patchPreferences`（→ `preferences:patch` mutation），confirmed 后 reducer 替换 `domain.userData`，selector 自动反映。

### keyed update 与 data-key

列表组件必须为每个子节点设置稳定的 `data-key`（股票用 code、分组用 groupId），`updateKeyedChildren` 依赖它复用 DOM。key 不稳定会导致整列表重建，丧失最小 diff 的性能优势。

### stale generation 双重保险

`search/confirmed|failed` 与 `quote/refresh/confirmed|failed` 在 **controller 与 reducer 两处** 都比对 generation：controller 端先丢弃 stale 响应不发 dispatch，reducer 端再校验一次防御并发 dispatch 交错。

### WCAG 2.1 AA 合规

- 颜色对比度：所有文本 ≥ 4.5:1，通过 CSS 设计令牌（`--text-primary`、`--text-secondary`、`--color-up`、`--color-down` 等）。
- 触控目标：`.header-btn`、`.view-btn`、`.tab-add` ≥ 44px。
- `prefers-reduced-motion`：动画降级为即时切换。
- 焦点恢复：`overlay/focusReturnId` 在对话框/面板关闭后恢复原焦点元素；`app-dialog-host` 内置焦点陷阱。
- 实时区域：`app-live-region` 承载 toast / 状态播报（`aria-live`），看板 `role="region"` 不对整个股票列表使用 `aria-live`，避免过度播报。
