export interface LiveRegionViewModel {
  readonly message: string;
  readonly kind: 'info' | 'success' | 'error' | 'none';
}

export class AppLiveRegion extends HTMLElement {
  private span: HTMLElement | null = null;
  private _viewModel: LiveRegionViewModel = { message: '', kind: 'none' };

  connectedCallback(): void {
    if (!this.span) {
      this.span = document.createElement('span');
      this.span.setAttribute('aria-live', 'polite');
      this.span.setAttribute('role', 'status');
      this.append(this.span);
      this.span.textContent = this._viewModel.message;
    }
  }

  get viewModel(): LiveRegionViewModel {
    return this._viewModel;
  }

  set viewModel(value: LiveRegionViewModel) {
    this._viewModel = value;
    if (this.span) {
      this.span.textContent = value.message;
    }
  }
}
