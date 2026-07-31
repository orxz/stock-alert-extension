// quotes.js — 东方财富 / 新浪行情传输与标准化
// 仅返回真实远端数据；超时、回退、缓存和状态编排由 quote-service.js 负责。

/**
 * @typedef {{ name: string, price: number|null, prevClose: number|null, open: number|null, high: number|null, low: number|null, volume: number|null, amount: number|null, change: number|null, changePercent: number|null }} NormalizedQuote
 * @typedef {{ fetchImpl?: typeof fetch, signal?: AbortSignal }} FetchOptions
 * @typedef {Record<string, NormalizedQuote>} QuoteMap
 */

const Quotes = {
  /**
   * @param {string} keyword
   * @param {FetchOptions} options
   * @returns {Promise<Array<{ code: string, name: string, pinyin: string }>>}
   */
  async searchStocks(keyword, { fetchImpl = fetch, signal } = {}) {
    const input = keyword.trim();
    if (!input) return [];
    const params = new URLSearchParams({
      input,
      type: '14',
      token: 'D43BF722C8E33BDC906FB84D85E326E8',
      count: '15'
    });
    const response = await fetchImpl(
      'https://searchapi.eastmoney.com/api/suggest/get?' + params.toString(),
      { method: 'GET', signal }
    );
    if (!response.ok) throw new Error('search HTTP ' + response.status);
    const json = await response.json();
    const table = json.QuotationCodeTable || json._oma_data?.QuotationCodeTable;
    const data = table?.Data;
    if (!Array.isArray(data)) return [];

    const validSecurityTypes = new Set(['1', '2', '25', '27']);
    const stocks = [];
    for (const item of data) {
      if (!item) continue;
      const securityType = String(item.SecurityType || '');
      const classify = String(item.Classify || '');
      if (!validSecurityTypes.has(securityType) && !(!item.SecurityType && classify === 'AStock')) continue;
      const rawCode = String(item.Code || '');
      if (!/^\d{6}$/.test(rawCode)) continue;
      const prefix = securityType === '27'
        ? 'bj'
        : securityType === '25' || securityType === '1' || item.MktNum === '1'
          ? 'sh'
          : 'sz';
      stocks.push({
        code: prefix + rawCode,
        name: item.Name || rawCode,
        pinyin: item.PinYin || ''
      });
    }
    return stocks;
  },

  /**
   * @param {string[]} codes
   * @param {FetchOptions} options
   * @returns {Promise<QuoteMap>}
   */
  async fetchEastmoney(codes, { fetchImpl = fetch, signal } = {}) {
    if (!codes.length) return {};
    const params = new URLSearchParams({
      fltt: '2',
      fields: 'f2,f3,f4,f5,f6,f12,f13,f14,f15,f16,f17,f18',
      secids: this._toSecids(codes).join(',')
    });
    const response = await fetchImpl(
      'https://push2.eastmoney.com/api/qt/ulist.np/get?' + params.toString(),
      { method: 'GET', signal }
    );
    if (!response.ok) throw new Error('eastmoney HTTP ' + response.status);
    const json = await response.json();
    const rows = json?.data?.diff;
    if (!Array.isArray(rows)) return {};

    /** @type {QuoteMap} */
    const result = {};
    for (const item of rows) {
      if (!item || item.f12 == null) continue;
      const rawCode = String(item.f12);
      const prefix = item.f13 === 1 ? 'sh' : /^[489]\d{5}$/.test(rawCode) ? 'bj' : 'sz';
      const canonicalCode = prefix + rawCode;
      const matched = codes.find((code) => code.toLowerCase() === canonicalCode)
        || codes.find((code) => code.toLowerCase().endsWith(rawCode))
        || canonicalCode;
      const quote = this.enrich({
        name: item.f14 || rawCode,
        price: item.f2,
        prevClose: item.f18,
        open: item.f17,
        high: item.f15,
        low: item.f16,
        volume: item.f5,
        amount: item.f6,
        changePercent: item.f3,
        change: item.f4
      });
      if (quote?.price !== null) result[matched] = quote;
    }
    return result;
  },

  /**
   * @param {string[]} codes
   * @param {FetchOptions} options
   * @returns {Promise<QuoteMap>}
   */
  async fetchSina(codes, { fetchImpl = fetch, signal } = {}) {
    if (!codes.length) return {};
    const response = await fetchImpl(
      'https://hq.sinajs.cn/list=' + codes.join(','),
      { method: 'GET', signal }
    );
    if (!response.ok) throw new Error('sina HTTP ' + response.status);
    const buffer = await response.arrayBuffer();
    const text = new TextDecoder('gbk').decode(buffer);
    return this.parseSina(text, codes);
  },

  /**
   * @param {string} text
   * @param {string[]} codes
   * @returns {QuoteMap}
   */
  parseSina(text, codes) {
    /** @type {QuoteMap} */
    const result = {};
    for (const line of text.split('\n')) {
      const match = line.match(/hq_str_(\w+?)="(.*)"/);
      if (!match) continue;
      const responseCode = match[1];
      const fields = match[2].split(',');
      const price = Number.parseFloat(fields[3]) || Number.parseFloat(fields[1]);
      if (fields.length < 4 || !fields[0] || !Number.isFinite(price)) continue;
      const matched = codes.find((code) => code.toLowerCase() === responseCode.toLowerCase()) || responseCode;
      const quote = this.enrich({
        name: fields[0],
        price,
        prevClose: Number.parseFloat(fields[2]),
        open: Number.parseFloat(fields[1]),
        high: Number.parseFloat(fields[4]),
        low: Number.parseFloat(fields[5]),
        volume: Number.parseInt(fields[8], 10),
        amount: Number.parseFloat(fields[9])
      });
      if (quote?.price !== null) result[matched] = quote;
    }
    return result;
  },

  /**
   * @param {string[]} codes
   * @returns {string[]}
   */
  _toSecids(codes) {
    return codes.map((code) => {
      const lowerCode = code.toLowerCase();
      const number = lowerCode.replace(/^(sh|sz|bj)/, '');
      if (lowerCode.startsWith('bj')) return '0.' + number;
      if (lowerCode.startsWith('sh')) return '1.' + number;
      return '0.' + number;
    });
  },

  /**
   * @param {unknown} value
   * @returns {number|null}
   */
  _num(value) {
    if (value === '-' || value === '' || value === null || value === undefined) return null;
    const number = typeof value === 'number' ? value : Number.parseFloat(String(value));
    return Number.isFinite(number) ? number : null;
  },

  /**
   * @param {Record<string, any>|null|undefined} rawQuote
   * @returns {NormalizedQuote|null}
   */
  enrich(rawQuote) {
    if (!rawQuote) return null;
    const rawPrice = this._num(rawQuote.price);
    const safe = {
      name: String(rawQuote.name || ''),
      // A 股价格不会为 0 或负数：停牌/盘前接口常返回 0.00，必须按缺失处理，否则会渲染成 -100% 的假行情
      price: rawPrice !== null && rawPrice > 0 ? rawPrice : null,
      prevClose: this._num(rawQuote.prevClose),
      open: this._num(rawQuote.open),
      high: this._num(rawQuote.high),
      low: this._num(rawQuote.low),
      volume: this._num(rawQuote.volume),
      amount: this._num(rawQuote.amount)
    };
    let change = this._num(rawQuote.change);
    let changePercent = this._num(rawQuote.changePercent);
    if (change === null && safe.price !== null && safe.prevClose !== null) {
      change = +(safe.price - safe.prevClose).toFixed(2);
    }
    if (changePercent === null && change !== null && safe.prevClose) {
      changePercent = +((change / safe.prevClose) * 100).toFixed(2);
    }
    return { ...safe, change, changePercent };
  }
};

if (typeof module !== 'undefined') module.exports = Quotes;
