// src/popup/components/stock-search-combobox.ts
// Task 17 Step 5 — ARIA combobox / listbox 搜索组件。
// role=combobox + aria-expanded + aria-controls + aria-activedescendant。
// results role=option + aria-selected。ArrowUp/Down 改变 active option、
// Enter 选择 emit stock-search-select、Escape 关闭。
// input 变化触发 300ms debounce search（emit search-keyword-change）。
// 组件拥有并清理 timer/AbortController。拒绝 stale generation 结果。
// 架构约束：仅 import domain + view-models + events；per-connection AbortController。
import type { StockCode } from '../../domain/brands.js';
import type { StockSearchResult } from '../../domain/index.js';
import type { SearchComboboxViewModel } from '../view-models.js';
import { emitPopupEvent } from './events.js';

/** debounce 延迟（ms）。 */
const DEBOUNCE_MS = 300;

/** combobox listbox ID 前缀。 */
const LISTBOX_ID = 'combobox-listbox';

export class StockSearchComboboxElement extends HTMLElement {
  private connection: AbortController | undefined;
  private skeletonBuilt = false;
  private _viewModel: SearchComboboxViewModel = {
    results: [],
    status: 'idle',
    generation: 0
  };

  /** 组件所见的最大 generation；低于此值的 VM 被拒绝（stale）。 */
  private maxGeneration = 0;
  /** 当前接受的（非 stale）结果。 */
  private acceptedResults: readonly StockSearchResult[] = [];
  /** 当前高亮的 option 索引（-1 = 无）。 */
  private activeIndex = -1;
  /** listbox 是否展开。 */
  private expanded = false;
  /** debounce timer ID。 */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  private inputEl: HTMLInputElement | null = null;
  private listboxEl: HTMLElement | null = null;

  connectedCallback(): void {
    this.connection?.abort();
    this.connection = new AbortController();
    const signal = this.connection.signal;
    if (!this.skeletonBuilt) {
      this.buildSkeleton();
      this.skeletonBuilt = true;
    }
    this.bindEvents(signal);
    this.applyViewModel(this._viewModel);
  }

  disconnectedCallback(): void {
    this.connection?.abort();
    this.connection = undefined;
    // 清理 debounce timer（组件拥有 timer）。
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  get viewModel(): SearchComboboxViewModel {
    return this._viewModel;
  }

  set viewModel(value: SearchComboboxViewModel) {
    // 拒绝 stale generation：只接受 >= maxGeneration 的结果。
    if (value.generation < this.maxGeneration) {
      return;
    }
    this.maxGeneration = value.generation;
    this._viewModel = value;
    this.acceptedResults = value.results;
    // 结果变化后重置 active option。
    this.activeIndex = -1;
    this.expanded = this.acceptedResults.length > 0;
    if (this.isConnected) this.applyViewModel(value);
  }

  /** 暴露内部 input 元素（供 dialog-host 读取/写入 code 字段）。 */
  get input(): HTMLInputElement | null {
    return this.inputEl;
  }

  private buildSkeleton(): void {
    this.className = 'search-combobox';

    const wrapper = document.createElement('div');
    wrapper.className = 'combobox-wrapper';

    const input = document.createElement('input');
    input.type = 'text';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', LISTBOX_ID);
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-activedescendant', '');
    input.setAttribute('aria-label', '搜索股票代码或名称');
    input.setAttribute('placeholder', '输入代码或名称搜索');
    input.className = 'combobox-input';
    input.setAttribute('data-action', 'combobox-input');
    this.inputEl = input;

    const listbox = document.createElement('ul');
    listbox.id = LISTBOX_ID;
    listbox.setAttribute('role', 'listbox');
    listbox.setAttribute('aria-label', '搜索结果');
    listbox.className = 'combobox-listbox';
    listbox.setAttribute('data-region', 'combobox-listbox');
    this.listboxEl = listbox;

    wrapper.append(input, listbox);
    this.append(wrapper);
  }

  private bindEvents(signal: AbortSignal): void {
    // input 变化 → 300ms debounce → emit search-keyword-change。
    this.inputEl?.addEventListener('input', () => {
      const keyword = this.inputEl?.value ?? '';
      if (this.debounceTimer !== null) {
        clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = setTimeout(() => {
        emitPopupEvent(this, 'search-keyword-change', { keyword });
        this.debounceTimer = null;
      }, DEBOUNCE_MS);
    }, { signal });

    // keydown：ArrowUp/Down/Enter/Escape。
    this.inputEl?.addEventListener('keydown', ((e: Event) => {
      this.handleKeydown(e as KeyboardEvent);
    }) as EventListener, { signal });

    // 点击 option 直接选择。
    this.listboxEl?.addEventListener('click', ((e: Event) => {
      const target = e.target as HTMLElement;
      const option = target.closest('[role="option"]') as HTMLElement | null;
      if (!option) return;
      const index = Number(option.getAttribute('data-index'));
      if (Number.isInteger(index) && index >= 0 && index < this.acceptedResults.length) {
        this.selectIndex(index);
      }
    }) as EventListener, { signal });
  }

  private handleKeydown(e: KeyboardEvent): void {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (this.acceptedResults.length === 0) return;
        this.activeIndex = (this.activeIndex + 1) % this.acceptedResults.length;
        this.expanded = true;
        this.updateActiveOption();
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (this.acceptedResults.length === 0) return;
        this.activeIndex = this.activeIndex <= 0
          ? this.acceptedResults.length - 1
          : this.activeIndex - 1;
        this.expanded = true;
        this.updateActiveOption();
        break;
      case 'Enter':
        if (this.expanded && this.activeIndex >= 0 && this.activeIndex < this.acceptedResults.length) {
          e.preventDefault();
          this.selectIndex(this.activeIndex);
        }
        break;
      case 'Escape':
        e.preventDefault();
        this.expanded = false;
        this.activeIndex = -1;
        this.updateAriaExpanded();
        break;
    }
  }

  /** 选择指定索引的结果，emit stock-search-select。 */
  private selectIndex(index: number): void {
    const result = this.acceptedResults[index];
    if (!result) return;
    // 将选中项填入 input。
    if (this.inputEl) {
      this.inputEl.value = `${result.code} ${result.name}`;
    }
    emitPopupEvent(this, 'stock-search-select', {
      code: result.code as StockCode,
      name: result.name
    });
    this.expanded = false;
    this.activeIndex = -1;
    this.updateAriaExpanded();
  }

  /** 更新 aria-activedescendant + option aria-selected。 */
  private updateActiveOption(): void {
    this.updateAriaExpanded();
    if (!this.listboxEl) return;
    const options = this.listboxEl.querySelectorAll('[role="option"]');
    for (let i = 0; i < options.length; i++) {
      const opt = options[i] as HTMLElement;
      const isActive = i === this.activeIndex;
      opt.setAttribute('aria-selected', String(isActive));
      opt.classList.toggle('is-active', isActive);
    }
    // 设置 aria-activedescendant
    if (this.inputEl && this.activeIndex >= 0) {
      const activeId = `combobox-option-${this.activeIndex}`;
      this.inputEl.setAttribute('aria-activedescendant', activeId);
    } else if (this.inputEl) {
      this.inputEl.setAttribute('aria-activedescendant', '');
    }
  }

  private updateAriaExpanded(): void {
    if (this.inputEl) {
      this.inputEl.setAttribute('aria-expanded', String(this.expanded));
    }
    if (this.listboxEl) {
      this.listboxEl.classList.toggle('is-expanded', this.expanded);
    }
  }

  private applyViewModel(vm: SearchComboboxViewModel): void {
    // 渲染 listbox options。
    if (!this.listboxEl) return;
    this.listboxEl.textContent = '';

    for (let i = 0; i < this.acceptedResults.length; i++) {
      const result = this.acceptedResults[i];
      const li = document.createElement('li');
      li.id = `combobox-option-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('data-index', String(i));
      li.setAttribute('aria-selected', String(i === this.activeIndex));
      li.className = 'combobox-option';
      if (i === this.activeIndex) li.classList.add('is-active');
      li.textContent = `${result.code} ${result.name}`;
      this.listboxEl.append(li);
    }

    this.updateAriaExpanded();
    if (this.inputEl && this.activeIndex >= 0) {
      this.inputEl.setAttribute('aria-activedescendant', `combobox-option-${this.activeIndex}`);
    } else if (this.inputEl) {
      this.inputEl.setAttribute('aria-activedescendant', '');
    }

    // loading 状态标记。
    if (this.inputEl) {
      this.inputEl.setAttribute('aria-busy', String(vm.status === 'loading'));
    }
  }
}
