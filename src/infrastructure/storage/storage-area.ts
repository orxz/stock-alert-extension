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
}
