declare function importScripts(...urls: string[]): void;

declare const StockUtils: {
  ALL_GROUP_ID: string;
  normalizeStockCode(input: unknown): string | null;
  getStocksForGroup<T>(watchlist: T[], groupId: string): T[];
  countStocksForGroup<T>(watchlist: T[], groupId: string): number;
  sortStocks<T>(
    stocks: T[],
    quoteResults: Record<string, unknown>,
    groupId: string,
    field: string,
    direction: string
  ): T[];
};
