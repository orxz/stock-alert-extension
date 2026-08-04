import type { AppViewModel } from '../view-models.js';

export class StockAppElement extends HTMLElement {
  private connection: AbortController | undefined;
  private skeletonBuilt = false;
  private _viewModel: AppViewModel | null = null;
  onRefreshRequest?: () => void;

  connectedCallback(): void {
    this.connection?.abort();
    this.connection = new AbortController();
    const signal = this.connection.signal;
    if (!this.skeletonBuilt) {
      this.buildSkeleton();
      this.skeletonBuilt = true;
    }
    this.addEventListener('quote-refresh-request', () => {
      this.onRefreshRequest?.();
    }, { signal });
  }

  disconnectedCallback(): void {
    this.connection?.abort();
    this.connection = undefined;
  }

  get viewModel(): AppViewModel | null {
    return this._viewModel;
  }

  set viewModel(value: AppViewModel) {
    this._viewModel = value;
    const header = this.querySelector('[data-region="header"]');
    if (header) {
      header.textContent = `${value.header.groupName} ${value.header.stockCount}`;
    }
  }

  private buildSkeleton(): void {
    const header = document.createElement('div');
    header.setAttribute('data-region', 'header');
    const board = document.createElement('div');
    board.setAttribute('data-region', 'board');
    const footer = document.createElement('div');
    footer.setAttribute('data-region', 'footer');
    this.append(header, board, footer);
  }
}
