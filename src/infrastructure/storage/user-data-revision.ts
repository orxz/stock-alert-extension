// src/infrastructure/storage/user-data-revision.ts
// UserData 内容摘要（SHA-256）：用于乐观并发控制。
// 规范化 JSON（键排序递归）+ SHA-256 → sha256:<hex> 形式 revision。
// 纯函数——使用 globalThis.crypto.subtle.digest（Web Crypto API，Node 18+/浏览器通用）。
import type { UserData } from '../../domain/board-config.js';
import type { UserDataRevision } from '../../domain/brands.js';

/**
 * 计算 UserData 的内容摘要 revision。
 * 规范化 { groups, watchlist, boardConfig } 的 JSON（递归排序键）后 SHA-256。
 * schemaVersion 不参与摘要（始终为 2，不影响内容区分）。
 */
export async function computeUserDataRevision(data: UserData): Promise<UserDataRevision> {
  const canonical = canonicalJson({
    groups: data.groups,
    watchlist: data.watchlist,
    boardConfig: data.boardConfig
  });
  const bytes = new TextEncoder().encode(canonical);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}` as UserDataRevision;
}

/**
 * 规范化 JSON：递归排序对象键，保留数组顺序。
 * 确保键插入顺序不影响摘要值，但内容变化会被检测到。
 */
function canonicalJson(value: unknown): string {
  const normalize = (input: unknown): unknown =>
    Array.isArray(input)
      ? input.map(normalize)
      : input !== null && typeof input === 'object'
        ? Object.fromEntries(
            Object.keys(input as Record<string, unknown>)
              .sort()
              .map((key) => [key, normalize((input as Record<string, unknown>)[key])])
          )
        : input;
  return JSON.stringify(normalize(value));
}
