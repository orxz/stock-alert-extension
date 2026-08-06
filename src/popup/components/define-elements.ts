import { StockAppElement } from './stock-app.js';
import { AppLiveRegion } from './app-live-region.js';
import { StockHeaderElement } from './stock-header.js';
import { GroupTabsElement } from './group-tabs.js';
import { StockToolbarElement } from './stock-toolbar.js';
import { StockBoardElement } from './stock-board.js';
import { StockGridElement } from './stock-grid.js';
import { StockCardElement } from './stock-card.js';
import { StockTableElement } from './stock-table.js';
import { BatchToolbarElement } from './batch-toolbar.js';
import { ColumnPanelElement } from './column-panel.js';
import { AppPopoverHostElement } from './app-popover-host.js';
import { StockActionMenuElement } from './stock-action-menu.js';
import { QuoteStatusElement } from './quote-status.js';
import { AppDialogHostElement } from './app-dialog-host.js';
import { StockSearchComboboxElement } from './stock-search-combobox.js';

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
  if (!customElements.get('stock-board')) {
    customElements.define('stock-board', StockBoardElement);
  }
  if (!customElements.get('stock-grid')) {
    customElements.define('stock-grid', StockGridElement);
  }
  if (!customElements.get('stock-card')) {
    customElements.define('stock-card', StockCardElement);
  }
  if (!customElements.get('stock-table')) {
    customElements.define('stock-table', StockTableElement);
  }
  if (!customElements.get('batch-toolbar')) {
    customElements.define('batch-toolbar', BatchToolbarElement);
  }
  if (!customElements.get('stock-action-menu')) {
    customElements.define('stock-action-menu', StockActionMenuElement);
  }
  if (!customElements.get('app-popover-host')) {
    customElements.define('app-popover-host', AppPopoverHostElement);
  }
  if (!customElements.get('column-panel')) {
    customElements.define('column-panel', ColumnPanelElement);
  }
  if (!customElements.get('quote-status')) {
    customElements.define('quote-status', QuoteStatusElement);
  }
  if (!customElements.get('app-dialog-host')) {
    customElements.define('app-dialog-host', AppDialogHostElement);
  }
  if (!customElements.get('stock-search-combobox')) {
    customElements.define('stock-search-combobox', StockSearchComboboxElement);
  }
}
