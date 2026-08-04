export function updateKeyedChildren<K, V>(
  container: Element,
  values: readonly V[],
  keyOf: (value: V) => K,
  create: (value: V) => HTMLElement,
  update: (node: HTMLElement, value: V) => void
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
  let reference: Element | null = null;
  for (let i = values.length - 1; i >= 0; i--) {
    const value = values[i];
    const key = String(keyOf(value));
    seen.add(key);
    let node = existing.get(key);
    if (node) {
      update(node, value);
    } else {
      node = create(value);
      node.setAttribute('data-key', key);
    }
    if (reference) {
      container.insertBefore(node, reference);
    } else {
      container.append(node);
    }
    reference = node;
  }
  for (const [key, node] of existing) {
    if (!seen.has(key)) node.remove();
  }
}
