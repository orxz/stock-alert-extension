// src/popup/components/keyed-update.ts
// 稳定的 keyed 子节点更新：按 key 复用节点，只移动真正错位的那些。
//
// 为什么要判断位置：`insertBefore` / `append` 一个**已在正确位置**的节点，
// 在 DOM 规范里依然是「先从树中移除，再插入」。后果是：
//   - 被移除的节点若持有焦点，焦点会丢失（此前 stock-table 里那段
//     「保存 focusedKey → 渲染 → 手动 focus 回去」的补丁就是在绕这个坑）；
//   - CSS 动画/过渡重启（价格闪烁每次刷新都会被打断重来）；
//   - 盘中每 10s 一次行情刷新，就要白白产生 N 次结构变更。
// 因此只在 `node.nextSibling !== reference` 时才移动。

/**
 * 按 key 同步容器子节点到 `values` 的顺序与内容。
 *
 * @param anchor 所有 keyed 子节点必须排在它之前的节点（虚拟列表的底部 spacer）。
 *               传 null / 省略表示排到容器末尾。容器中的非 keyed 节点
 *               （如上下 spacer）不会被本函数移动或删除。
 */
export function updateKeyedChildren<K, V>(
  container: Element,
  values: readonly V[],
  keyOf: (value: V) => K,
  create: (value: V) => HTMLElement,
  update: (node: HTMLElement, value: V) => void,
  anchor: Node | null = null
): void {
  if (values.length === 0) {
    const stale = container.querySelectorAll('[data-key]');
    for (const node of stale) node.remove();
    return;
  }

  const existing = new Map<string, HTMLElement>();
  for (const child of container.children) {
    const key = child.getAttribute('data-key');
    if (key !== null) existing.set(key, child as HTMLElement);
  }

  const seen = new Set<string>();
  // 从后往前构建：reference 始终是「当前节点应当紧邻其前」的那个节点。
  let reference: Node | null = anchor;
  for (let i = values.length - 1; i >= 0; i--) {
    const value = values[i];
    const key = String(keyOf(value));
    seen.add(key);

    const reused = existing.get(key);
    let node: HTMLElement;
    if (reused) {
      node = reused;
      update(node, value);
      // 仅在位置确实不对时移动（insertBefore(node, null) 等价于 append）。
      // 新建节点不能走这个判断——它还不在树里，nextSibling 恒为 null，
      // 会被误判成「已在位」而永远插不进去。
      if (node.nextSibling !== reference) {
        container.insertBefore(node, reference);
      }
    } else {
      node = create(value);
      node.setAttribute('data-key', key);
      container.insertBefore(node, reference);
    }
    reference = node;
  }

  for (const [key, node] of existing) {
    if (!seen.has(key)) node.remove();
  }
}
