import { StockAppElement } from './stock-app.js';
import { AppLiveRegion } from './app-live-region.js';

export function definePopupElements(): void {
  if (!customElements.get('stock-app')) {
    customElements.define('stock-app', StockAppElement);
  }
  if (!customElements.get('app-live-region')) {
    customElements.define('app-live-region', AppLiveRegion);
  }
}
