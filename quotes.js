// quotes.js — 行情数据层
// 对应 PRD 3.3.1：接入正式行情接口
// 主源：东方财富 push2 API（JSON/UTF-8，无需特殊请求头）
// 备源：新浪财经 hq.sinajs.cn（GBK，浏览器扩展中 fetch 无法设置 Referer，故仅作备用尝试）
// 兜底：demo 数据（清晰标注「演示数据」）

const Quotes = {
  _demoBase: {
    'sz300418': { name: '昆仑万维', price: 50.65, prevClose: 47.96 },
    'sh600519': { name: '贵州茅台', price: 1689.00, prevClose: 1675.50 },
    'sz000858': { name: '五粮液', price: 156.20, prevClose: 158.40 },
    'sh601318': { name: '中国平安', price: 48.30, prevClose: 47.80 },
    'sz300750': { name: '宁德时代', price: 210.50, prevClose: 205.00 },
    'sh600036': { name: '招商银行', price: 35.80, prevClose: 36.10 },
    'sz002475': { name: '立讯精密', price: 38.90, prevClose: 37.50 },
    'sh601899': { name: '紫金矿业', price: 14.20, prevClose: 13.85 },
    // 科创板（688xxx）演示数据
    'sh688981': { name: '中芯国际', price: 171.99, prevClose: 163.02 },
    'sh688111': { name: '金山办公', price: 305.50, prevClose: 298.80 },
    'sh688256': { name: '寒武纪', price: 1120.00, prevClose: 1095.00 },
    // 北交所（920xxx / 8xxxxx / 4xxxxx）演示数据
    'bj920185': { name: '贝特瑞', price: 22.05, prevClose: 22.69 },
    'bj920368': { name: '连城数控', price: 25.77, prevClose: 25.00 },
    'bj920819': { name: '颖泰生物', price: 2.63, prevClose: 2.70 },
    'bj430047': { name: '诺思兰德', price: 8.50, prevClose: 8.17 },
    'bj830799': { name: '艾融软件', price: 35.20, prevClose: 34.28 }
  },

  isDemo: false,
  _sourceName: '',

  // ===== 股票搜索（东方财富搜索建议 API）=====
  // 输入关键词（代码前缀/拼音/中文），返回匹配的 A 股列表
  // 返回格式: [{ code: 'sh600519', name: '贵州茅台', pinyin: 'GZMT' }, ...]
  async searchStocks(keyword) {
    const kw = keyword.trim();
    if (!kw) return [];
    try {
      const params = new URLSearchParams({
        input: kw,
        type: '14',          // 14 = A 股
        token: 'D43BF722C8E33BDC906FB84D85E326E8',
        count: '15'
      });
      const url = 'https://searchapi.eastmoney.com/api/suggest/get?' + params.toString();
      const resp = await fetch(url, { method: 'GET' });
      if (!resp.ok) throw new Error('search HTTP ' + resp.status);
      const json = await resp.json();
      // 兼容两种响应格式：直接 QuotationCodeTable 或包裹在 _oma_data 内
      const table = json.QuotationCodeTable || (json._oma_data && json._oma_data.QuotationCodeTable);
      const data = table && table.Data;
      if (!data || !Array.isArray(data)) return [];
      // 筛选 A 股类型：沪A(1)/深A(2)/科创板(25)/京A·北交所(27)
      // 注：科创板 Classify='23'，北交所 Classify='NEEQ'+SecurityTypeName 含'京'
      // SecurityType 白名单覆盖主力市场；缺失时回退 Classify 兜底，避免 API 变动导致漏检
      const VALID_SEC_TYPES = ['1', '2', '25', '27'];
      const stocks = [];
      for (const item of data) {
        if (!item) continue;
        const secType = String(item.SecurityType || '');
        const classify = String(item.Classify || '');
        if (!VALID_SEC_TYPES.includes(secType)) {
          // 兜底：SecurityType 缺失/未知时，回退到 Classify='AStock' 检查（兼容旧逻辑）
          if (!item.SecurityType && classify === 'AStock') {
            // Classify 确认为 A 股，但 SecurityType 缺失，继续处理
          } else {
            continue;
          }
        }
        const rawCode = String(item.Code || '');
        if (!/^\d{6}$/.test(rawCode)) continue;
        // 确定前缀：科创板→sh，京A→bj，沪A→sh，深A→sz
        let prefix;
        if (secType === '27') prefix = 'bj';
        else if (secType === '25' || secType === '1' || item.MktNum === '1') prefix = 'sh';
        else prefix = 'sz';
        stocks.push({
          code: prefix + rawCode,
          name: item.Name || rawCode,
          pinyin: item.PinYin || ''
        });
      }
      return stocks;
    } catch (e) {
      console.warn('[quotes] searchStocks failed:', e.message);
      return [];
    }
  },

  // 主入口：依次尝试东方财富 → 新浪 → demo
  async fetch(codes) {
    if (!codes || !codes.length) return {};
    let result;
    // 1. 东方财富（主源）
    try {
      result = await this._fetchEastmoney(codes);
      if (result && Object.keys(result).length) {
        this.isDemo = false;
        this._sourceName = '东方财富';
        return result;
      }
    } catch (e) { console.warn('[quotes] eastmoney failed:', e.message); }

    // 2. 新浪（备源）
    try {
      result = await this._fetchSina(codes);
      if (result && Object.keys(result).length) {
        this.isDemo = false;
        this._sourceName = '新浪财经';
        return result;
      }
    } catch (e) { console.warn('[quotes] sina failed:', e.message); }

    // 3. demo 兜底
    this.isDemo = true;
    this._sourceName = '演示数据';
    return this._demo(codes);
  },

  // ===== 东方财富 push2 API =====
  // 将代码转为 secids：0=深市(sz)/北交所(bj), 1=沪市(sh)
  // 沪市代码前缀：600/601/603/688（A股/科创板）、5（基金/ETF）、11/13（转债）
  // 北交所代码前缀：4xx/8xx/9xx（bj前缀），东方财富 secids 中 market=0
  _toSecids(codes) {
    return codes.map(code => {
      const c = code.toLowerCase();
      const num = code.replace(/^(sh|sz|bj)/i, '');
      // 北交所：bj 前缀 → market=0
      if (c.startsWith('bj')) return '0.' + num;
      // 沪市：sh 前缀或 6xx/5xx/11x/12x/13x 代码段（含科创板 688/689）
      if (c.startsWith('sh') || /^(6|5|11|12|13)/.test(num)) return '1.' + num;
      // 深市 sz 及其他（含创业板 300、中小板 002 等）→ market=0
      return '0.' + num;
    });
  },

  async _fetchEastmoney(codes) {
    const secids = this._toSecids(codes);
    const fields = 'f2,f3,f4,f5,f6,f12,f13,f14,f15,f16,f17,f18';
    const params = new URLSearchParams({
      fltt: '2',
      fields: fields,
      secids: secids.join(',')
    });
    const url = 'https://push2.eastmoney.com/api/qt/ulist.np/get?' + params.toString();
    const resp = await fetch(url, { method: 'GET' });
    if (!resp.ok) throw new Error('eastmoney HTTP ' + resp.status);
    const json = await resp.json();
    if (!json || !json.data || !json.data.diff) return {};
    const result = {};
    json.data.diff.forEach(item => {
      if (!item || item.f12 == null) return; // 跳过 null/无效项
      // item.f12 = code (without prefix), item.f13 = market (0=SZ/BJ, 1=SH)
      const rawCode = String(item.f12);
      // f13=1 → 沪市(sh/科创板)；f13=0 → 深市(sz) 或 北交所(bj)
      // 北交所代码特征：4xx/8xx/9xx 开头的6位数字（含新旧段：430/830/920）
      let prefix;
      if (item.f13 === 1) prefix = 'sh';
      else if (/^[489]\d{5}$/.test(rawCode)) prefix = 'bj';
      else prefix = 'sz';
      const code = prefix + rawCode;
      // 匹配用户原始代码格式（可能用户输入的是 sh600519 或 600519）
      // 优先精确匹配（含前缀），避免跨市场同代码号误匹配
      const matched = codes.find(c => c.toLowerCase() === code.toLowerCase())
                    || codes.find(c => c.toLowerCase().endsWith(rawCode))
                    || code;
      result[matched] = {
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
      };
    });
    return result;
  },

  // ===== 新浪财经 API（备用）=====
  // 注意：浏览器扩展中 fetch 无法设置 Referer 头，部分情况新浪会返回空。
  // 响应为 GBK 编码，需用 TextDecoder('gbk') 解码。
  // 北交所兼容性：新浪对 bj 前缀的支持未正式验证（curl 测试返回 Forbidden），
  // 代码已按新浪通用格式（list=bj{code}）构造 URL，若不可用则降级到 demo。
  async _fetchSina(codes) {
    const url = 'https://hq.sinajs.cn/list=' + codes.join(',');
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('sina HTTP ' + resp.status);
    // 新浪返回 GBK 编码，必须用 GBK 解码否则中文乱码
    const buffer = await resp.arrayBuffer();
    const text = new TextDecoder('gbk').decode(buffer);
    return this._parseSina(text, codes);
  },

  _parseSina(text, codes) {
    const result = {};
    const lines = text.split('\n');
    lines.forEach(line => {
      const m = line.match(/hq_str_(\w+?)="(.*)"/);
      if (!m) return;
      const code = m[1];
      const fields = m[2].split(',');
      if (fields.length < 3 || !fields[0]) return;
      const price = parseFloat(fields[3]) || parseFloat(fields[1]);
      const prevClose = parseFloat(fields[2]);
      // 匹配用户原始代码
      const matched = codes.find(c => c.toLowerCase() === code.toLowerCase()) || code;
      result[matched] = {
        name: fields[0], price, prevClose,
        open: parseFloat(fields[1]), high: parseFloat(fields[4]), low: parseFloat(fields[5]),
        volume: parseInt(fields[8]) || 0, amount: parseFloat(fields[9]) || 0
      };
    });
    return result;
  },

  // ===== demo 数据（兜底）=====
  _demo(codes) {
    const result = {};
    codes.forEach(code => {
      const base = this._demoBase[code.toLowerCase()];
      if (base) {
        const jitter = (Math.random() - 0.5) * base.price * 0.01;
        const price = +(base.price + jitter).toFixed(2);
        const change = +(price - base.prevClose).toFixed(2);
        result[code] = {
          name: base.name, price, prevClose: base.prevClose,
          open: +(base.prevClose * (1 + (Math.random() - 0.5) * 0.02)).toFixed(2),
          high: +(price * 1.01).toFixed(2), low: +(price * 0.99).toFixed(2),
          volume: Math.floor(100000 + Math.random() * 900000),
          amount: Math.floor(100000 + Math.random() * 9000000),
          change, changePercent: +((change / base.prevClose) * 100).toFixed(2)
        };
      } else {
        const p = +(10 + Math.random() * 40).toFixed(2);
        const pc = +(p * (1 + (Math.random() - 0.5) * 0.05)).toFixed(2);
        const change = +(p - pc).toFixed(2);
        result[code] = { name: code, price: p, prevClose: pc, open: pc, high: +(p * 1.02).toFixed(2), low: +(p * 0.98).toFixed(2), volume: 0, amount: 0, change, changePercent: +((change / pc) * 100).toFixed(2) };
      }
    });
    return result;
  },

  // 数值安全：东财 API 对停牌股票返回 "-" 字符串，需转为 null
  _num(v) {
    if (v === '-' || v === '' || v === null || v === undefined) return null;
    const n = typeof v === 'number' ? v : parseFloat(v);
    return isNaN(n) ? null : n;
  },

  // 计算涨跌额/涨跌幅（东方财富已直接返回，新浪/demo 需计算）
  // 同时做数值安全处理：停牌股票字段为 "-" 时转为 null，避免 .toFixed() 崩溃
  enrich(q) {
    if (!q) return q;
    const safe = {
      name: q.name,
      price: this._num(q.price),
      prevClose: this._num(q.prevClose),
      open: this._num(q.open),
      high: this._num(q.high),
      low: this._num(q.low),
      volume: this._num(q.volume),
      amount: this._num(q.amount)
    };
    let change = this._num(q.change);
    let changePercent = this._num(q.changePercent);
    if (change === null && safe.price !== null && safe.prevClose !== null) {
      change = +(safe.price - safe.prevClose).toFixed(2);
    }
    if (changePercent === null && change !== null && safe.prevClose) {
      changePercent = +((change / safe.prevClose) * 100).toFixed(2);
    }
    return { ...safe, change, changePercent };
  }
};
