// src/infrastructure/storage/storage-area.ts
// StorageArea 接口：chrome.storage.local 的最小抽象。
// 由 ChromeStorageAdapter（生产）和 MemoryStorageArea（测试）实现。
// 所有方法的返回值都是深拷贝（structuredClone 语义），调用方可安全修改。

/**
 * 键值存储区域接口：封装 chrome.storage.local 的 get/set/remove 三个原语。
 * - get(keys): 传入 null/undefined 获取全部，传入键数组获取子集，传入单键获取单值。
 * - set(patch): 合并写入（浅 merge 到现有数据，值深拷贝）。
 * - remove(keys): 删除指定键。
 */
export interface StorageArea {
  get(keys?: readonly string[] | string | null): Promise<Record<string, unknown>>;
  set(patch: Readonly<Record<string, unknown>>): Promise<void>;
  remove(keys: readonly string[] | string): Promise<void>;
  /**
   * 可选：只列出键名，不读取值。
   *
   * 孤儿缓存清理只需要键名，但 `get(null)` 会把每一条 quoteCache 的值
   * 一并反序列化并跨进程拷贝——500 只自选股时这是冷启动路径上最贵的一步。
   * `chrome.storage.local.getKeys()` 自 Chrome 130 起可用；实现方缺省此方法时
   * StorageCoordinator 会回退到 `get(null)`，行为不变。
   */
  getKeys?(): Promise<readonly string[]>;
}
