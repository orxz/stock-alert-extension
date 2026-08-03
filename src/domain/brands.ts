// src/domain/brands.ts
// 品牌类型：为字符串 ID 提供名义类型区分，防止 StockCode/GroupId/UserDataRevision 混用。
// 品牌类型唯一 escape hatch：在 normalizeStockCode 内通过 `as StockCode` 构造。

/**
 * 品牌类型基类：将原始类型 T 标记为名为 Name 的名义类型。
 * 编译时区分不同 ID 种类，运行时零开销。
 */
export type Brand<T, Name extends string> = T & { readonly __brand: Name };

/** 规范化后的股票代码，形如 `sh600519` / `sz000001` / `bj920001`。 */
export type StockCode = Brand<string, 'StockCode'>;

/** 分组 ID；`g_all` 是固定计算视图，自定义分组由 Popup 生成。 */
export type GroupId = Brand<string, 'GroupId'>;

/** UserData 内容摘要 revision（SHA-256），用于乐观并发控制。 */
export type UserDataRevision = Brand<string, 'UserDataRevision'>;
