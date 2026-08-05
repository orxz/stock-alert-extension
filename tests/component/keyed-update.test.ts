// tests/component/keyed-update.test.ts
// Task 14 Step 1 — 稳定 keyed DOM 更新：data-key 复用、insertBefore 重排、新增/删除。
// 断言：同 key 节点 identity 稳定、顺序跟随 input、stale 节点被移除、新节点被创建。
import '../helpers/dom-environment.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { resetDom } from '../helpers/dom-environment.js';
import { updateKeyedChildren } from '../../src/popup/components/keyed-update.js';

interface Item {
  readonly id: string;
  readonly label: string;
}

function keyOf(item: Item): string {
  return item.id;
}

function create(item: Item): HTMLElement {
  const el = document.createElement('div');
  el.className = 'item';
  el.textContent = item.label;
  return el;
}

function update(node: HTMLElement, item: Item): void {
  node.textContent = item.label;
}

function labels(container: Element): string[] {
  return [...container.children].map((child) => child.textContent ?? '');
}

test('renders initial values in order with data-key attributes', () => {
  resetDom();
  const container = document.createElement('div');
  document.body.append(container);
  updateKeyedChildren(container, [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
    { id: 'c', label: 'C' }
  ], keyOf, create, update);
  assert.deepEqual(labels(container), ['A', 'B', 'C']);
  assert.deepEqual(
    [...container.children].map((c) => c.getAttribute('data-key')),
    ['a', 'b', 'c']
  );
});

test('reorders existing nodes and preserves identity (no recreate)', () => {
  resetDom();
  const container = document.createElement('div');
  document.body.append(container);
  updateKeyedChildren(container, [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
    { id: 'c', label: 'C' }
  ], keyOf, create, update);
  const beforeB = container.querySelector('[data-key="b"]');

  // 反转顺序：c, a, b
  updateKeyedChildren(container, [
    { id: 'c', label: 'C' },
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' }
  ], keyOf, create, update);

  const afterB = container.querySelector('[data-key="b"]');
  assert.equal(afterB, beforeB, '节点 identity 必须稳定（复用而非重建）');
  assert.deepEqual(labels(container), ['C', 'A', 'B']);
});

test('creates missing nodes and reuses the rest', () => {
  resetDom();
  const container = document.createElement('div');
  document.body.append(container);
  updateKeyedChildren(container, [{ id: 'a', label: 'A' }], keyOf, create, update);
  const beforeA = container.querySelector('[data-key="a"]');

  updateKeyedChildren(container, [
    { id: 'a', label: 'A' },
    { id: 'd', label: 'D' }
  ], keyOf, create, update);

  const afterA = container.querySelector('[data-key="a"]');
  assert.equal(afterA, beforeA, '已有节点保持原引用');
  assert.deepEqual(labels(container), ['A', 'D']);
});

test('removes stale nodes not present in the new values', () => {
  resetDom();
  const container = document.createElement('div');
  document.body.append(container);
  updateKeyedChildren(container, [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
    { id: 'c', label: 'C' }
  ], keyOf, create, update);

  updateKeyedChildren(container, [{ id: 'a', label: 'A' }], keyOf, create, update);

  assert.deepEqual(labels(container), ['A']);
  assert.equal(container.querySelector('[data-key="b"]'), null);
  assert.equal(container.querySelector('[data-key="c"]'), null);
});

test('invokes update callback with the latest value for reused nodes', () => {
  resetDom();
  const container = document.createElement('div');
  document.body.append(container);
  updateKeyedChildren(container, [{ id: 'a', label: 'old' }], keyOf, create, update);
  updateKeyedChildren(container, [{ id: 'a', label: 'new' }], keyOf, create, update);
  assert.equal(container.querySelector('[data-key="a"]')?.textContent, 'new');
});

test('handles empty values by clearing all keyed children', () => {
  resetDom();
  const container = document.createElement('div');
  document.body.append(container);
  updateKeyedChildren(container, [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' }
  ], keyOf, create, update);
  updateKeyedChildren(container, [], keyOf, create, update);
  assert.equal(container.children.length, 0);
});

// ===== 无条件 DOM 移动的回归防护 =====

/**
 * 统计容器的 DOM 变更次数。
 * 关键点：`insertBefore`/`append` 一个**已在正确位置**的节点，
 * 在 DOM 规范里仍是「先移除再插入」——会使焦点丢失、CSS 动画重启，
 * 并在每次行情刷新（盘中每 10s）产生 N 次无谓的结构变更。
 */
function countMutations(container: Element, run: () => void): number {
  let mutations = 0;
  const el = container as unknown as Record<string, unknown>;
  const originalInsert = container.insertBefore.bind(container);
  const originalAppend = container.appendChild.bind(container);
  el.insertBefore = (node: Node, ref: Node | null) => { mutations += 1; return originalInsert(node, ref); };
  el.appendChild = (node: Node) => { mutations += 1; return originalAppend(node); };
  try {
    run();
  } finally {
    delete el.insertBefore;
    delete el.appendChild;
  }
  return mutations;
}

test('re-rendering an unchanged list performs no DOM moves', () => {
  resetDom();
  const container = document.createElement('div');
  document.body.append(container);
  const items: Item[] = [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
    { id: 'c', label: 'C' }
  ];
  updateKeyedChildren(container, items, keyOf, create, update);

  const moves = countMutations(container, () => {
    updateKeyedChildren(container, items, keyOf, create, update);
  });

  assert.equal(moves, 0, 'nodes already in position must not be reinserted');
  assert.deepEqual(labels(container), ['A', 'B', 'C']);
});

test('updating only values performs no DOM moves', () => {
  resetDom();
  const container = document.createElement('div');
  document.body.append(container);
  const before: Item[] = [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' }
  ];
  updateKeyedChildren(container, before, keyOf, create, update);

  const moves = countMutations(container, () => {
    updateKeyedChildren(
      container,
      [{ id: 'a', label: 'A2' }, { id: 'b', label: 'B2' }],
      keyOf,
      create,
      update
    );
  });

  assert.equal(moves, 0, 'a price tick must not restructure the list');
  assert.deepEqual(labels(container), ['A2', 'B2']);
});

test('a focused control survives a re-render of an unchanged list', () => {
  resetDom();
  const container = document.createElement('div');
  document.body.append(container);
  const items: Item[] = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }];
  const createWithButton = (item: Item): HTMLElement => {
    const el = document.createElement('div');
    const btn = document.createElement('button');
    btn.id = `btn-${item.id}`;
    btn.textContent = item.label;
    el.append(btn);
    return el;
  };
  const updateWithButton = (node: HTMLElement, item: Item): void => {
    const btn = node.querySelector('button');
    if (btn) btn.textContent = item.label;
  };
  updateKeyedChildren(container, items, keyOf, createWithButton, updateWithButton);

  const target = document.querySelector<HTMLElement>('#btn-b');
  target?.focus();
  assert.equal(document.activeElement?.id, 'btn-b');

  updateKeyedChildren(container, items, keyOf, createWithButton, updateWithButton);
  assert.equal(document.activeElement?.id, 'btn-b', 'focus preserved without a restore hack');
});

test('reordering still moves only the nodes that actually moved', () => {
  resetDom();
  const container = document.createElement('div');
  document.body.append(container);
  updateKeyedChildren(
    container,
    [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }],
    keyOf, create, update
  );
  const nodeA = container.querySelector('[data-key="a"]');

  updateKeyedChildren(
    container,
    [{ id: 'c', label: 'C' }, { id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    keyOf, create, update
  );

  assert.deepEqual(labels(container), ['C', 'A', 'B']);
  assert.equal(container.querySelector('[data-key="a"]'), nodeA, 'node identity preserved');
});
