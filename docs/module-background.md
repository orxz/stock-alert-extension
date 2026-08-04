# background — Service Worker (v2.0.0)

## overview

Manifest V3 Service Worker，是整个扩展的控制平面。源码位于 `src/background/`（6 个 TypeScript 文件），由 `tsc` 编译到 `build/extension/runtime/background/main.js`，`extension/manifest.json` 中声明为 `{ "service_worker": "runtime/background/main.js", "type": "module" }`。

设计要点：
- **组合根**：`main.ts` 同步装配依赖图（adapter → scheduler eager，barrier → services 惰性）。
- **同步注册 listener**：所有 Chrome listener 在顶层模块执行时同步注册，无任何顶层 `await` 先于注册——SW 在任何事件到达前完成接线。
- **可重试初始化屏障**：`InitializationBarrier` 三态机（idle → running → ready）惰性创建服务，失败回 idle 自动重试。
- **退避跨 SW 重建存活**：行情退避状态持久化到 `chrome.storage.session`，SW 被杀重建后恢复。
- **callback-based RPC 路由**：`handle` 同步返回 `true`，`respondOnce` 守卫保证 `sendResponse` 恰好一次。

## architecture_design

```
src/background/
├── main.ts                    — 组合根：createRuntimeDependencies() + 同步注册 5 个 Chrome listener
├── initialization-barrier.ts  — 三态可重试初始化屏障（idle → running → ready）
├── router.ts                  — callback Router：将 onMessage 回调语义适配到异步 dispatch 流水线
├── rpc-handlers.ts            — exhaustive handler 表：13 个 RpcMethod 各映射到一个 service 调用
├── scheduler.ts               — 行情调度器：safety-before-work + exact-after-work + single-flight
└── badge-presenter.ts         — 纯 Badge/Tooltip 投影函数（零副作用）

依赖装配（main.ts createRuntimeDependencies）：
├── createConsoleDiagnosticSink()    — 诊断 sink（eager）
├── createSystemClock()              — 生产时钟：now()→Date.now()，schedule()→setTimeout（eager）
├── createChromeAlarmAdapter()       — chrome.alarms 的 AlarmPort 实现（eager）
├── createChromeActionPresenter()    — chrome.action 的 ActionPresenterPort 实现（eager）
├── QuoteScheduler                   — eager 构造，bootstrap/quotes 通过 barrier 惰性获取
├── InitializationBarrier<AppServices>
│     factory 首次 get() 时：
│       (a) ChromeStorageAdapter + StorageCoordinator + UserData/QuoteCache Repository
│       (b) BootstrapService + PortfolioCommandsImpl + QuoteService + SearchService
│       (c) coordinator.reconcileOrphanQuoteCache() — 孤儿缓存清理
│       (d) sessionState.readQuoteBackoff → clamp 非法值 → writeQuoteBackoff
│       (e) scheduler.ensureAlarm() — SW 重建后恢复 alarm
└── createRouter({ barrier, sink, clock })

Chrome listener（顶层同步注册）：
├── chrome.runtime.onMessage.addListener(router.handle)
├── chrome.alarms.onAlarm.addListener(onAlarm)        — alarm.name === ALARM_NAME → runQuoteCycle('alarm')
├── chrome.runtime.onInstalled.addListener(onInstalled) → runQuoteCycle('installed')
├── chrome.runtime.onStartup.addListener(onStartup)    → runQuoteCycle('startup')
├── chrome.storage.onChanged.addListener(onStorageChanged) — groups/watchlist/boardConfig 变更触发；quoteCache 不触发（防递归）
└── ensureInitialized('module-activation')  — fire-and-forget 触发首次初始化
```

### initialization-barrier.ts：三态可重试屏障

`createInitializationBarrier<T>(initialize)` 实现 `idle → running → ready` 状态机：
- **idle**：首次 `get()` 进入 running，调用 `initialize()`。
- **running**：返回进行中的 Promise——并发首事件共享同一次 attempt（不重复初始化）。
- **ready**：缓存值，后续 `get()` 同步返回 `Promise.resolve(value)`。
- **失败**：`running → idle`（不缓存错误），下一次 `get()` 重新触发 `initialize()`——任何后续事件（alarm / message / storage-change）自动重试。

纯 ES2022 零依赖，被 `main.ts`（生产）与 `router.test.ts`（测试）共享。

### router.ts + rpc-handlers.ts：callback Router

`createRouter({ barrier, sink, clock }).handle` 实现 chrome.runtime.onMessage 回调适配：
- **同步返回 `true`**：声明异步 `sendResponse`，绝不返回 Promise（MV3 要求 listener 同步决策）。
- **respondOnce 守卫**：内部闭包 `responded` 标志保证 `sendResponse` 恰好调用一次。
- **dispatch 异步流水线**：六层防线顺序校验——对象性 → protocol===2 → requestId 非空 → method 在注册表 → payload 经校验器 → `barrier.get()` 取服务后委托 handler。
- **响应结构**：成功 → `{ protocol:2, requestId, ok:true, data }`；失败 → `{ protocol:2, requestId, ok:false, error:{ code, message, retryable } }`。
- **错误映射**：`AppError`（结构化错误模型）保留 `code/message/retryable`；其余未知错误映射为 `INTERNAL`，不泄漏 stack。
- **诊断 span**：每个请求发射 `rpc` scope 的 `dispatch:start` / `dispatch:end` span，含 requestId 与耗时。

`rpc-handlers.ts` 的 `handlers` 对象用 `satisfies { [M in RpcMethod]: RpcHandler<M> }` 编译期强制穷尽性：注册表（`src/protocol/registry.ts`）新增方法时此处漏处理即编译失败——单一真相源保持同步。13 个方法映射：

```
app:bootstrap        → BootstrapService.execute()
quote:refresh        → QuoteService.refresh(codes, { force })
stock:search         → SearchService.search(query)
stock:add/remove/move/setPinned/setOrder → PortfolioCommands.*
group:create/rename/delete/setOrder      → PortfolioCommands.*
preferences:patch                       → PortfolioCommands.patchPreferences
```

### scheduler.ts：安全 Alarm + 精确 Alarm + single-flight

`QuoteScheduler` 编排行情刷新周期，核心常量：
- `ALARM_NAME = 'quote-refresh:v2'`
- `SAFETY_DELAY_MS = 300_000`（5 分钟）

`runQuoteCycle(source)` 的 `QuoteRunSource ∈ { alarm, installed, startup, storage-change, coalesced, module-activation }`：
1. **single-flight**：活跃 run 进行中时新触发设 `pendingRun=true` 并返回活跃 run；活跃 run 结束后若 `pendingRun`，以 `'coalesced'` 源重跑一次。
2. **safety-before-work**：cycle 开始即 `alarm.schedule(ALARM_NAME, now + SAFETY_DELAY_MS)`——即使工作异常崩溃，5 分钟内 SW 也会被该 alarm 重新唤醒。
3. **updateAction**（best-effort，内部 catch 所有错误）：bootstrap → 空 watchlist 清 badge → 否则 Phase 1 缓存即时投影 + Phase 2 网络刷新后新鲜投影。
4. **exact-after-work**（finally 块，保证执行）：`alarm.schedule(ALARM_NAME, now + getRefreshIntervalMs(now, 'background'))`——盘中 30s / 盘外 5min 精确间隔。
5. **诊断 span**：`cycle:start` / `cycle:end`（含 outcome/durationMs）/ `update-action-failed` 共享同一 `runId`（`bg-<counter>`）。

`ensureAlarm()`：SW 激活 / 初始化时调用；若 `alarm.get(ALARM_NAME)` 返回 null（SW 重建后 alarm 丢失），安排一个 safety alarm 恢复调度。

### badge-presenter.ts：纯投影函数

`projectActionState(stocks, snapshot, _now): ActionState` 从**已排序**的 stocks + QuoteSnapshot 派生 `{ text, color, title }`。零副作用：不调用 `chrome.action` / `Date.now()` / DOM，仅 import domain 纯函数（`formatBadgeState` / `formatTooltipLine`）。排序由 scheduler 调用 `sortStocks` 完成后传入；badge-presenter 不排序。行为契约：空 watchlist → 清空 badge + 提示标题；无任何可用行情 → `暂无可用行情` 标题。

## data_flow

### Service Worker 激活流程

```
SW 模块顶层执行（同步，无顶层 await）
  ↓
createRuntimeDependencies()
  ├─ eager: sink / clock / alarm / action adapter
  ├─ eager: QuoteScheduler（bootstrap/quotes delegate 通过 barrier.get() 惰性获取）
  └─ lazy:  InitializationBarrier（factory 待首次 get() 才执行）
  ↓
同步注册 5 个 Chrome listener（onMessage/onAlarm/onInstalled/onStartup/onStorageChanged）
  ↓
ensureInitialized('module-activation')  — fire-and-forget：void barrier.get()
  └─ factory 首次执行：
       (a) 创建 Coordinator + Repositories + Services
       (b) reconcileOrphanQuoteCache()
       (c) readQuoteBackoff → clamp → writeQuoteBackoff
       (d) scheduler.ensureAlarm()
  └─ 失败 → 诊断 sink 记录（不缓存错误），下一事件自动重试
```

### RPC 消息流程（Popup → Background）

```
Popup Client.postMessage(request)
  ↓ chrome.runtime.onMessage → router.handle(request, sender, sendResponse)
  ↓ handle 同步 return true（声明异步 sendResponse）
dispatch(request) 异步执行：
  ├─ Layer 1: typeof object?
  ├─ Layer 2: protocol === 2?
  ├─ Layer 3: requestId 非空字符串?
  ├─ Layer 4: method in rpcRegistry?
  ├─ Layer 5: validateRpcRequest payload 校验?
  ├─ Layer 6: await barrier.get() → services
  └─ handlers[method](payload, services) → result
  ↓
respondOnce({ protocol:2, requestId, ok:true, data } | ok:false, error:{ code, message, retryable } })
```

### 行情刷新周期流程

```
触发源（alarm / installed / startup / storage-change / module-activation）
  ↓ scheduler.runQuoteCycle(source)
single-flight 检查（activeRun 进行中 → pendingRun=true，折叠为一次 'coalesced' 重跑）
  ↓
safety-before-work: alarm.schedule(ALARM_NAME, now + 5min)
  ↓
updateAction(source, runId)（best-effort，catch 所有错误）:
  ├─ bootstrap.execute() → userData + quoteSnapshot
  ├─ 空 watchlist → action.clear(EMPTY_TITLE)，return（不调 QuoteService）
  ├─ Phase 1（cache）: sortStocks + projectActionState → action.render（即时缓存投影）
  └─ Phase 2（network）: quotes.refresh(codes, {requestId:runId})
                          → sortStocks + projectActionState → action.render（新鲜投影）
  ↓ finally（保证执行）
exact-after-work: alarm.schedule(ALARM_NAME, now + getRefreshIntervalMs(now,'background'))
  ↓
cycle:end span（outcome/durationMs）
  ↓
pendingRun? → runQuoteCycle('coalesced')（最多重跑一次）
```

## gotchas_and_constraints

### listener 同步注册（非 async）

在 MV3 下，顶层异步初始化有竞态风险：若 SW 在初始化完成前被杀，listener 可能未注册。v2 的 `main.ts` 保证所有 5 个 listener 在模块顶层**同步**注册，初始化（`barrier.initialize`）惰性推迟到首次事件——任何事件到达时 listener 已就位，初始化在事件处理中按需完成。

### safety-before-work / exact-after-work 双 alarm

Manifest V3 中 `chrome.alarms` 是后台定时器的唯一可靠方式（`setInterval` 在 Service Worker 中会被回收）。但单个 alarm 在 SW 被杀后可能丢失。v2 的策略：
- **cycle 开始**：先安排 5min safety alarm——即使本次工作因网络/异常崩溃，5min 内 SW 也会被唤醒重跑。
- **cycle 结束**（finally 块）：替换为精确 interval alarm（盘中 30s / 盘外 5min）。
- **ensureAlarm**：SW 激活时若 alarm 丢失则恢复 safety alarm。

### single-flight 并发控制

alarms / onInstalled / onStartup / storage.onChanged 可能并发触发 `runQuoteCycle`。`QuoteScheduler` 用 `activeRun` + `pendingRun` 折叠并发：活跃 run 进行中时新触发设 `pendingRun=true`，活跃 run 结束后若 `pendingRun` 以 `'coalesced'` 源重跑一次——保证最新数据被投影，但不重复执行网络刷新。

### 可重试初始化屏障

`InitializationBarrier` 失败时回 `idle`（不缓存错误），下一次 `get()` 重新触发 `initialize()`。生产环境 `ensureInitialized('module-activation')` 是 fire-and-forget：失败仅经诊断 sink 记录，下一事件（alarm / message / storage-change）自动重试。Router 的 `dispatch` 在 Layer 6 `await barrier.get()`——若初始化失败，该请求拿到 rejection 并返回 `INTERNAL`，但屏障已回 idle，后续请求可重新初始化。

### 退避跨 SW 重建存活

`QuoteService` 的退避状态（`failureCount` / `nextAutomaticAttemptAt`）通过 `SessionStatePort`（生产为 `ChromeSessionState`）持久化到 `chrome.storage.session` 的 `quoteBackoff:v2` 键。Service Worker 被杀重建后，退避序列（30s → 120s → 300s 循环）继续生效——不会因 SW 重启而立即重试失败的 provider。初始化工厂还会读取退避、clamp 非法值（负数/NaN/非数字）后写回，防御损坏数据。

### RPC callback exactly-once

MV3 的 `chrome.runtime.onMessage` 回调要求 listener 同步返回 `true` 才能异步 `sendResponse`。`router.handle` 内部 `respondOnce` 闭包用 `responded` 标志保证 `sendResponse` 恰好一次——无论 dispatch 成功、失败还是抛异常，Popup 侧都收到且只收到一个响应。

### quoteCache 变更不触发刷新

`onStorageChanged` 仅对 `groups` / `watchlist` / `boardConfig` 三个键触发 `runQuoteCycle('storage-change')`。`quoteCache:*` 变更不触发——否则刷新写缓存 → onStorageChanged → 再刷新，形成递归。

### 空 watchlist 早退

`updateAction` 检测到空 watchlist 时 `action.clear(EMPTY_TITLE)` 并直接返回，不调用 `QuoteService` 或 `SessionStatePort`——避免无谓的网络请求与退避状态变更。

## coding_conventions

- **分层约束**：`src/background/` 是 Infrastructure 层的组合根。它可 import `application/*` / `domain/*` / `protocol/*` / `infrastructure/*`，但绝不反向依赖。`badge-presenter.ts` 是纯投影函数（仅 import domain），`scheduler.ts` / `router.ts` 通过 port 接口（`AlarmPort` / `ActionPresenterPort` / `Clock` / `DiagnosticSink`）解耦 chrome。
- **结构化方法签名而非具体类**：`AppServices` / `SchedulerDeps` / `RouterDeps` 用结构化类型（structural typing）声明依赖，生产实例与测试 mock 都能结构化满足，无需 mock 框架。
- **诊断 span exactly-once**：所有 `startSpan` 必须有对应的 `span.end`（含 outcome/durationMs）。`runId`（`bg-<counter>`）贯穿 scheduler 与 quote 两个 scope，便于跨层关联。诊断事件版本号统一 `2.0.0`。
- **fire-and-forget 的 chrome 调用**：adapter 内部的 `chrome.action.setBadgeText` 等调用不检查错误（fire-and-forget），异常由调度循环的 try-catch 捕获后经诊断 sink 记录，不中断调度。
- **颜色惯例**：红涨绿跌（中国股市标准），由 `domain/formatting.ts` 的 `formatBadgeState` 集中实现（红 `#E74C3C` 涨 / 绿 `#27AE60` 跌 / 灰 `#95A5A6` 平或缓存或缺失），与欧美市场相反。
