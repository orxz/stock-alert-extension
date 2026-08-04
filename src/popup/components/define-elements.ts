import { StockAppElement } from './stock-app.js';
import { AppLiveRegion } from './app-live-region.js';
import { StockHeaderElement } from './stock-header.js';
import { GroupTabsElement } from './group-tabs.js';
import { StockToolbarElement } from './stock-toolbar.js';

export function definePopupElements(): void {
  if (!customElements.get('stock-app')) {
    customElements.define('stock-app', StockAppElement);
  }
  if (!customElements.get('app-live-region')) {
    customElements.define('app-live-region', AppLiveRegion);
  }
  if (!customElements.get('stock-header')) {
    customElements.define('stock-header', StockHeaderElement);
  }
  if (!customElements.get('group-tabs')) {
    customElements.define('group-tabs', GroupTabsElement);
  }
  if (!customElements.get('stock-toolbar')) {
    customElements.define('stock-toolbar', StockToolbarElement);
  }
}
