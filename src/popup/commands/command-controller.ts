// src/popup/commands/command-controller.ts
// Task 13 Step 6 — 语义命令层。
// - 写命令：从 Store 取 expectedRevision，经 MutationReconciler 执行（uncertain 对账）。
// - gesture key：相同 method + 关键参数的 in-flight 命令合并为同一 promise（去重）。
// - createGroup：客户端生成 `g_${crypto.randomUUID()}` 作为 groupId。
// - dialogSearchStocks / refreshQuotes：单调递增 generation，拒绝 stale 响应。
// - bootstrap：dispatch requested → rpc.call → dispatch confirmed/failed。
// 只 import domain/protocol + popup 内部（rpc-client / store / commands）。
import type {
  GroupId,
  StockCode,
  UserDataRevision,
  QuoteSnapshot,
  StockSearchResult
} from '../../domain/index.js';
import type {
  MutationMethod,
  RpcPayload,
  AddStockPayload,
  RemoveStockPayload,
  MoveStockPayload,
  SetPinnedPayload,
  SetStockOrderPayload,
  CreateGroupPayload,
  RenameGroupPayload,
  DeleteGroupPayload,
  SetGroupOrderPayload,
  PatchPreferencesPayload
} from '../../protocol/index.js';
import type { Store } from '../store/store.js';
import type { RpcClient } from '../rpc-client.js';
import { MutationReconciler, toSafeClientError } from './mutation-reconciler.js';

/** 写命令公共参数描述（语义化方法签名）。 */
export interface AddStockArgs {
  readonly code: StockCode;
  readonly name: string;
  readonly groupIds: readonly GroupId[];
}
export interface RemoveStocksArgs {
  readonly codes: readonly StockCode[];
  readonly groupId: GroupId;
}
export interface MoveStocksArgs {
  readonly codes: readonly StockCode[];
  readonly fromGroupId: GroupId;
  readonly targetGroupIds: readonly GroupId[];
}
export interface SetPinnedArgs {
  readonly groupId: GroupId;
  readonly code: StockCode;
  readonly pinned: boolean;
  readonly orderedCodes: readonly StockCode[];
}
export interface SetOrderArgs {
  readonly groupId: GroupId;
  readonly orderedCodes: readonly StockCode[];
}
export interface PatchPreferencesArgs {
  readonly groupId: GroupId;
  readonly patch: Readonly<Partial<{ viewMode: 'list' | 'grid'; sortField: 'manual' | 'addedAt' | 'name' | 'price' | 'change' | 'changePercent' | 'amount'; sortDirection: 'asc' | 'desc'; priceHidden: boolean }>>;
}

/**
 * 语义命令控制器：Popup UI 的唯一写出口。
 * 每个 mutation 通过 gesture key 去重；search/quote 用 generation 拒绝 stale 响应。
 */
export class CommandController {
  private readonly reconciler: MutationReconciler;
  /** 进行中的 gesture → promise，用于合并相同意图的并发命令。 */
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(
    private readonly rpc: RpcClient,
    private readonly store: Store
  ) {
    this.reconciler = new MutationReconciler(rpc, store);
  }

  /** 当前 Store 的权威 revision（写命令的 expectedRevision 来源）。 */
  private revision(): UserDataRevision {
    return this.store.getState().domain.revision;
  }

  /**
   * 执行一条写命令：相同 key 的 in-flight 命令合并为同一 promise。
   * promise 落定（无论成功失败）后从 inflight 移除，允许后续同 key 命令重新发起。
   */
  private mutate<M extends MutationMethod>(method: M, payload: RpcPayload<M>, key: string): Promise<void> {
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const promise = this.reconciler.execute(method, payload, key).finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, promise);
    return promise;
  }

  // ===== 写命令 =====

  addStock(args: AddStockArgs): Promise<void> {
    const payload: AddStockPayload = { expectedRevision: this.revision(), code: args.code, name: args.name, groupIds: args.groupIds };
    const key = `stock:add:${args.code}`;
    return this.mutate('stock:add', payload, key);
  }

  removeStocks(args: RemoveStocksArgs): Promise<void> {
    const payload: RemoveStockPayload = { expectedRevision: this.revision(), codes: args.codes, groupId: args.groupId };
    const key = `stock:remove:${args.groupId}:${[...args.codes].join(',')}`;
    return this.mutate('stock:remove', payload, key);
  }

  moveStocks(args: MoveStocksArgs): Promise<void> {
    const payload: MoveStockPayload = {
      expectedRevision: this.revision(),
      codes: args.codes,
      fromGroupId: args.fromGroupId,
      targetGroupIds: args.targetGroupIds
    };
    const key = `stock:move:${args.fromGroupId}:${[...args.codes].join(',')}:${[...args.targetGroupIds].join(',')}`;
    return this.mutate('stock:move', payload, key);
  }

  setPinned(args: SetPinnedArgs): Promise<void> {
    const payload: SetPinnedPayload = {
      expectedRevision: this.revision(),
      groupId: args.groupId,
      code: args.code,
      pinned: args.pinned,
      orderedCodes: args.orderedCodes
    };
    const key = `stock:setPinned:${args.groupId}:${args.code}`;
    return this.mutate('stock:setPinned', payload, key);
  }

  setOrder(args: SetOrderArgs): Promise<void> {
    const payload: SetStockOrderPayload = {
      expectedRevision: this.revision(),
      groupId: args.groupId,
      orderedCodes: args.orderedCodes
    };
    const key = `stock:setOrder:${args.groupId}`;
    return this.mutate('stock:setOrder', payload, key);
  }

  createGroup(name: string): Promise<void> {
    // 客户端生成 groupId（g_ + UUID），保证离线/冲突时的稳定标识。
    const groupId = `g_${crypto.randomUUID()}` as GroupId;
    const payload: CreateGroupPayload = { expectedRevision: this.revision(), groupId, name };
    const key = `group:create:${groupId}`;
    return this.mutate('group:create', payload, key);
  }

  renameGroup(groupId: GroupId, name: string): Promise<void> {
    const payload: RenameGroupPayload = { expectedRevision: this.revision(), groupId, name };
    const key = `group:rename:${groupId}`;
    return this.mutate('group:rename', payload, key);
  }

  deleteGroup(groupId: GroupId): Promise<void> {
    const payload: DeleteGroupPayload = { expectedRevision: this.revision(), groupId };
    const key = `group:delete:${groupId}`;
    return this.mutate('group:delete', payload, key);
  }

  setGroupOrder(orderedGroupIds: readonly GroupId[]): Promise<void> {
    const payload: SetGroupOrderPayload = { expectedRevision: this.revision(), orderedGroupIds };
    // 分组排序是全局唯一 gesture（同时只允许一个进行中）。
    const key = 'group:setOrder';
    return this.mutate('group:setOrder', payload, key);
  }

  patchPreferences(args: PatchPreferencesArgs): Promise<void> {
    const payload: PatchPreferencesPayload = { expectedRevision: this.revision(), groupId: args.groupId, patch: args.patch };
    const key = `preferences:patch:${args.groupId}`;
    return this.mutate('preferences:patch', payload, key);
  }

  // ===== 读命令（不走 reconciler；用 generation 拒绝 stale 响应）=====

  /**
   * 对话框内股票搜索（add-stock）——popup 里唯一的远程搜索入口。
   * 工具栏那条是纯本地过滤（只写 view/searchKeyword），不发 RPC。
   * 写入 view/dialogSearch 而非 view/searchKeyword——避免后台列表跳动。
   * 复用同一个 searchGeneration 做 stale 拒绝。
   */
  async dialogSearchStocks(query: string): Promise<void> {
    this.store.dispatch({ type: 'view/dialogSearchKeyword', keyword: query });
    if (!query.trim()) {
      // 清空查询同样要作废在途响应：dialogReset 原子重置 keyword/results、
      // 归零 async 并递增 generation——否则迟到的旧关键词结果会落进空查询状态。
      this.store.dispatch({ type: 'search/dialogReset' });
      return;
    }
    const generation = this.store.getState().async.searchGeneration + 1;
    // 用 dialogRequested 而非 search/requested——后者会写 view.searchKeyword 污染工具栏。
    this.store.dispatch({ type: 'search/dialogRequested', generation });
    try {
      const results = (await this.rpc.call('stock:search', { query })) as readonly StockSearchResult[];
      // stale 判定交给 reducer（dialogConfirmed 带 generation），避免两处判定漂移；
      // 同时结算 async.stockSearch，否则 combobox 会一直停在 loading/aria-busy。
      this.store.dispatch({ type: 'search/dialogConfirmed', results, generation });
    } catch (error) {
      if (generation !== this.store.getState().async.searchGeneration) return; // stale
      this.store.dispatch({ type: 'search/failed', error: toSafeClientError(error), generation });
    }
  }

  /** 刷新行情：reducer 在 quote/refresh/requested 时自增 quoteGeneration；此处读取后再比对。 */
  async refreshQuotes(codes: readonly StockCode[], force = false): Promise<void> {
    this.store.dispatch({ type: 'quote/refresh/requested' });
    const generation = this.store.getState().async.quoteGeneration;
    try {
      const snapshot = (await this.rpc.call('quote:refresh', { codes, force })) as QuoteSnapshot;
      if (generation !== this.store.getState().async.quoteGeneration) return; // stale
      this.store.dispatch({ type: 'quote/refresh/confirmed', snapshot, generation });
    } catch (error) {
      if (generation !== this.store.getState().async.quoteGeneration) return; // stale
      this.store.dispatch({ type: 'quote/refresh/failed', error: toSafeClientError(error), generation });
    }
  }

  /** Bootstrap：冷启动加载完整初始态。 */
  async bootstrap(): Promise<void> {
    this.store.dispatch({ type: 'bootstrap/requested' });
    try {
      const result = await this.rpc.call('app:bootstrap', {});
      this.store.dispatch({ type: 'bootstrap/confirmed', result });
    } catch (error) {
      this.store.dispatch({ type: 'bootstrap/failed', error: toSafeClientError(error) });
    }
  }
}
