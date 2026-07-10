// popup.js — 主逻辑：分组管理 / 看板渲染 / 排序 / 列配置 / 拖拽 / 模态框
// 对应 PRD 第 2 章（功能需求与交互流程）
// ID/类名严格匹配 popup.html / popup.css

const App = {
  state: {
    groups: [],
    watchlist: [],
    boardConfig: {},
    quotes: {},
    currentGroupId: 'g_all',
    viewMode: 'grid',
    sortField: 'manual',
    sortDirection: 'desc',
    columns: ['name', 'price', 'change', 'changePercent'],
    columnOrder: ['name', 'price', 'change', 'changePercent'],
    batchMode: false,
    selected: new Set(),
    searchKeyword: '',
    priceHidden: false,
    dragSrc: null,
    dragType: null
  },

  FIELD_LABELS: {
    name: '名称', code: '代码', price: '现价', change: '涨跌额',
    changePercent: '涨跌幅', open: '今开', prevClose: '昨收',
    high: '最高', low: '最低', volume: '成交量', amount: '成交额', addedAt: '自选时间'
  },

  ALL_FIELDS: ['name', 'code', 'price', 'change', 'changePercent', 'open', 'prevClose', 'high', 'low', 'volume', 'amount', 'addedAt'],

  // 热门股票库（pinyin = 拼音首字母），覆盖常见代码前缀
  // 6000xx: 浦发/上海机场/民生/中石化/南航/中信证券/招行/联通
  // 6001xx: 上汽/复星    0024xx: 海康/立讯    3007xx: 宁德/迈瑞
  HOT_STOCKS: [
    { code: 'sh600000', name: '浦发银行', tag: '银行', pinyin: 'pfyh' },
    { code: 'sh600009', name: '上海机场', tag: '航空', pinyin: 'shjc' },
    { code: 'sh600016', name: '民生银行', tag: '银行', pinyin: 'msyh' },
    { code: 'sh600028', name: '中国石化', tag: '石化', pinyin: 'zgsh' },
    { code: 'sh600029', name: '南方航空', tag: '航空', pinyin: 'nfhk' },
    { code: 'sh600030', name: '中信证券', tag: '证券', pinyin: 'zxzq' },
    { code: 'sh600036', name: '招商银行', tag: '银行', pinyin: 'zsyh' },
    { code: 'sh600050', name: '中国联通', tag: '通信', pinyin: 'zglh' },
    { code: 'sh600104', name: '上汽集团', tag: '汽车', pinyin: 'sqjt' },
    { code: 'sh600196', name: '复星医药', tag: '医药', pinyin: 'fxyy' },
    { code: 'sh600276', name: '恒瑞医药', tag: '医药', pinyin: 'hryy' },
    { code: 'sh600309', name: '万华化学', tag: '化工', pinyin: 'whhx' },
    { code: 'sh600519', name: '贵州茅台', tag: '白酒', pinyin: 'gzmt' },
    { code: 'sh600887', name: '伊利股份', tag: '食品', pinyin: 'ylgf' },
    { code: 'sh601318', name: '中国平安', tag: '保险', pinyin: 'zgpa' },
    { code: 'sh601398', name: '工商银行', tag: '银行', pinyin: 'gsyh' },
    { code: 'sh601688', name: '华泰证券', tag: '证券', pinyin: 'htzq' },
    { code: 'sh601857', name: '中国石油', tag: '石化', pinyin: 'zgsy' },
    { code: 'sh601988', name: '中国银行', tag: '银行', pinyin: 'zgyh' },
    { code: 'sz000001', name: '平安银行', tag: '银行', pinyin: 'payh' },
    { code: 'sz000002', name: '万科A', tag: '地产', pinyin: 'wka' },
    { code: 'sz000333', name: '美的集团', tag: '家电', pinyin: 'mdjt' },
    { code: 'sz000538', name: '云南白药', tag: '中药', pinyin: 'ynby' },
    { code: 'sz000651', name: '格力电器', tag: '家电', pinyin: 'gldq' },
    { code: 'sz000725', name: '京东方A', tag: '电子', pinyin: 'jdfa' },
    { code: 'sz000858', name: '五粮液', tag: '白酒', pinyin: 'wly' },
    { code: 'sz002415', name: '海康威视', tag: '电子', pinyin: 'hkws' },
    { code: 'sz002475', name: '立讯精密', tag: '电子', pinyin: 'lxjm' },
    { code: 'sz002594', name: '比亚迪', tag: '汽车', pinyin: 'byd' },
    { code: 'sz300059', name: '东方财富', tag: '证券', pinyin: 'dfcf' },
    { code: 'sz300750', name: '宁德时代', tag: '新能源', pinyin: 'ndsd' },
    { code: 'sz300760', name: '迈瑞医疗', tag: '医疗', pinyin: 'mrly' }
  ],

  async init() {
    try {
      const data = await Storage.loadAll();
      this.state.groups = data.groups;
      this.state.watchlist = data.watchlist;
      this.state.boardConfig = data.boardConfig;
      const cfg = await Storage.getBoardConfig(this.state.currentGroupId);
      Object.assign(this.state, cfg);
      this.bindEvents();
      this.applySortSelect();
      await this.refreshQuotes();
      this.render();
    } catch (e) {
      console.error('[App.init] failed:', e);
      // 即使初始化失败，也尝试渲染空看板而非白屏
      try { this.render(); } catch (_) {}
    }
    this._timer = setInterval(() => {
      this.refreshQuotes().then(() => this.renderBoard()).catch(() => {});
    }, 10000);
    // popup 关闭时清除定时器 + flush 待保存配置，防止 DOM 访问 + 数据丢失
    window.addEventListener('beforeunload', () => {
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
      if (this._boardSaveTimer) {
        clearTimeout(this._boardSaveTimer);
        this._flushBoardSave();
      }
    });
  },

  // ===== 行情 =====
  async refreshQuotes() {
    const codes = this.state.watchlist.map(s => s.code);
    this.state.quotes = await Quotes.fetch(codes);
    this.updateDataSourceLabel();
  },

  updateDataSourceLabel() {
    const el = document.getElementById('data-source');
    if (Quotes.isDemo) {
      el.textContent = '行情数据：演示数据（Demo）';
      el.className = 'data-source demo';
    } else {
      el.textContent = '行情数据：实时 · ' + (Quotes._sourceName || '行情接口');
      el.className = 'data-source';
    }
  },

  // ===== 分组 Tab =====
  renderGroupTabs() {
    const scroll = document.getElementById('tabs-scroll');
    scroll.innerHTML = '';
    this.state.groups.forEach(g => {
      const tab = document.createElement('div');
      tab.className = 'tab' + (g.groupId === this.state.currentGroupId ? ' active' : '');
      tab.draggable = true;
      tab.dataset.groupId = g.groupId;
      const count = this.state.watchlist.filter(s => s.groupIds.includes(g.groupId)).length;
      tab.innerHTML = `<span>${this.esc(g.name)}</span><span style="font-size:10px;color:#8A93A6;margin-left:2px;">${count}</span>`;
      tab.onclick = () => this.switchGroup(g.groupId);
      tab.oncontextmenu = (e) => { e.preventDefault(); if (!g.isDefault) this.openGroupModal('rename', g); };
      tab.ondragstart = (e) => { this.state.dragSrc = g.groupId; this.state.dragType = 'group'; e.dataTransfer.effectAllowed = 'move'; };
      tab.ondragover = (e) => { e.preventDefault(); tab.style.opacity = '.5'; };
      tab.ondragleave = () => { tab.style.opacity = ''; };
      tab.ondrop = (e) => {
        e.preventDefault();
        tab.style.opacity = '';
        if (this.state.dragType === 'group' && this.state.dragSrc && this.state.dragSrc !== g.groupId) {
          this.reorderGroups(this.state.dragSrc, g.groupId);
        }
      };
      scroll.appendChild(tab);
    });
  },

  async reorderGroups(srcId, dstId) {
    const ids = this.state.groups.map(g => g.groupId);
    const from = ids.indexOf(srcId), to = ids.indexOf(dstId);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    await Storage.reorderGroups(ids);
    const data = await Storage.loadAll();
    this.state.groups = data.groups;
    this.renderGroupTabs();
    this.toast('分组顺序已调整');
  },

  async switchGroup(groupId) {
    this.state.currentGroupId = groupId;
    this.state.selected.clear();
    // 切换分组时退出批量模式，避免"批量栏显示但未选中"的困惑状态
    if (this.state.batchMode) this.toggleBatchMode();
    const cfg = await Storage.getBoardConfig(groupId);
    Object.assign(this.state, cfg);
    this.applySortSelect();
    this.render();
    document.getElementById('batch-count').textContent = `已选 0 只`;
  },

  // ===== 分组操作 =====
  openGroupModal(mode, group) {
    const modal = document.getElementById('group-modal');
    const title = document.getElementById('group-modal-title');
    const input = document.getElementById('group-name-input');
    const err = document.getElementById('group-modal-err');
    const delBtn = document.getElementById('group-delete');
    err.textContent = '';
    if (mode === 'create') {
      title.textContent = '新建分组';
      input.value = '';
      modal.dataset.mode = 'create';
      delete modal.dataset.groupId;
      delBtn.style.display = 'none';
    } else {
      title.textContent = '重命名分组';
      input.value = group.name;
      modal.dataset.mode = 'rename';
      modal.dataset.groupId = group.groupId;
      delBtn.style.display = group.isDefault ? 'none' : 'inline-block';
    }
    modal.style.display = 'flex';
    setTimeout(() => input.focus(), 50);
  },

  async submitGroupModal() {
    const modal = document.getElementById('group-modal');
    const name = document.getElementById('group-name-input').value.trim();
    const err = document.getElementById('group-modal-err');
    if (!name) { err.textContent = '请输入分组名称'; return; }
    if (name.length > 12) { err.textContent = '分组名称不超过 12 字符'; return; }
    try {
      if (modal.dataset.mode === 'create') {
        await Storage.createGroup(name);
        this.toast('分组已创建');
      } else {
        await Storage.renameGroup(modal.dataset.groupId, name);
        this.toast('已重命名');
      }
      const data = await Storage.loadAll();
      this.state.groups = data.groups;
      modal.style.display = 'none';
      this.renderGroupTabs();
    } catch (e) { err.textContent = e.message; }
  },

  async deleteGroup(groupId) {
    const g = this.state.groups.find(x => x.groupId === groupId);
    if (!g) return;
    const ok = await this._confirm(`确认删除分组「${g.name}」？组内股票将移回「全部」。`, { title: '删除分组', okText: '删除' });
    if (!ok) return;
    try {
      await Storage.deleteGroup(groupId);
      if (this.state.currentGroupId === groupId) this.state.currentGroupId = 'g_all';
      const data = await Storage.loadAll();
      this.state.groups = data.groups;
      this.state.watchlist = data.watchlist;
      this.render();
      this.toast('分组已删除');
    } catch (e) { this.toast(e.message); }
  },

  // ===== 添加股票 =====
  openAddModal() {
    const modal = document.getElementById('add-modal');
    document.getElementById('add-code').value = '';
    document.getElementById('add-name').value = '';
    document.getElementById('code-suggest').style.display = 'none';
    const list = document.getElementById('add-group-list');
    list.innerHTML = '';
    this.state.groups.forEach(g => {
      const chip = document.createElement('div');
      chip.className = 'group-chip' + (g.groupId === this.state.currentGroupId ? ' selected' : '');
      chip.dataset.groupId = g.groupId;
      chip.textContent = g.name;
      chip.onclick = () => chip.classList.toggle('selected');
      list.appendChild(chip);
    });
    modal.style.display = 'flex';
    setTimeout(() => {
      const codeInput = document.getElementById('add-code');
      codeInput.focus();
      // 弹窗打开时默认展示热门股票
      this.renderCodeSuggest('');
    }, 50);
  },

  // ===== 代码搜索补全（实时 API 查询 + 本地降级）=====
  _searchTimer: null,
  _searchSeq: 0,

  renderCodeSuggest(keyword) {
    const box = document.getElementById('code-suggest');
    const kw = keyword.trim();

    if (!kw) {
      // 空输入：展示前 10 只热门股票
      const top = this.HOT_STOCKS.slice(0, 10).map(s => ({ ...s, matchType: '' }));
      this._renderSuggestItems(box, top);
      return;
    }

    // 防抖：300ms 内连续输入只发最后一次请求
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this._asyncSearch(kw), 300);
    // 立即显示加载提示
    box.innerHTML = '<div class="code-suggest-empty">搜索中…</div>';
    box.style.display = 'block';
  },

  // 异步搜索：先调 API，失败则降级到本地 HOT_STOCKS 匹配
  async _asyncSearch(kw) {
    const box = document.getElementById('code-suggest');
    const seq = ++this._searchSeq; // 防止旧请求覆盖新结果

    // 1. 尝试实时 API 查询
    let results = await Quotes.searchStocks(kw);

    // 如果期间用户又输入了新关键词，丢弃本次结果
    if (seq !== this._searchSeq) return;

    if (results.length) {
      // API 成功：渲染结果，最多 10 条
      const items = results.slice(0, 10).map(s => ({
        code: s.code,
        name: s.name,
        tag: 'A股',
        matchType: ''
      }));
      this._renderSuggestItems(box, items);
      return;
    }

    // 2. API 无结果或失败：降级到本地 HOT_STOCKS 匹配
    const lower = kw.toLowerCase();
    const local = [];
    for (const s of this.HOT_STOCKS) {
      const numCode = s.code.replace(/^(sh|sz)/, '');
      const pinyin = (s.pinyin || '').toLowerCase();
      let matchType = null, priority = 99;
      if (numCode.startsWith(lower) || s.code.toLowerCase().startsWith(lower)) {
        matchType = '前缀'; priority = 1;
      } else if (numCode.includes(lower) || s.code.toLowerCase().includes(lower)) {
        matchType = '代码'; priority = 2;
      } else if (pinyin && pinyin.startsWith(lower)) {
        matchType = '拼音'; priority = 3;
      } else if (pinyin && pinyin.includes(lower)) {
        matchType = '拼音'; priority = 4;
      } else if (s.name.toLowerCase().includes(lower)) {
        matchType = '名称'; priority = 5;
      } else if (s.tag && s.tag.toLowerCase().includes(lower)) {
        matchType = '行业'; priority = 6;
      }
      if (matchType) local.push({ ...s, matchType, priority });
    }
    local.sort((a, b) => a.priority - b.priority);

    if (seq !== this._searchSeq) return;

    if (local.length) {
      this._renderSuggestItems(box, local.slice(0, 10));
    } else {
      box.innerHTML = '<div class="code-suggest-empty">无匹配结果，可直接输入代码添加</div>';
      box.style.display = 'block';
    }
  },

  // 渲染补全列表项
  _renderSuggestItems(box, items) {
    box.innerHTML = '';
    items.forEach(s => {
      const item = document.createElement('div');
      item.className = 'code-suggest-item';
      const matchBadge = s.matchType
        ? `<span class="cs-match">${s.matchType}</span>` : '';
      item.innerHTML = `
        <div class="cs-left">
          <span class="cs-name">${this.esc(s.name)}</span>
          <span class="cs-code">${s.code}</span>
        </div>
        <div class="cs-right">
          ${matchBadge}
          <span class="cs-tag">${this.esc(s.tag || '热门')}</span>
        </div>`;
      item.onmousedown = (e) => {
        e.preventDefault(); // 防止 input 失焦
        document.getElementById('add-code').value = s.code;
        document.getElementById('add-name').value = s.name;
        box.style.display = 'none';
      };
      box.appendChild(item);
    });
    box.style.display = 'block';
  },

  // 从 HOT_STOCKS 查找股票元数据（pinyin/tag），供看板搜索使用
  getStockMeta(code) {
    return this.HOT_STOCKS.find(s => s.code === code) || null;
  },

  async submitAddStock() {
    let code = document.getElementById('add-code').value.trim();
    const name = document.getElementById('add-name').value.trim();
    if (!code) { this.toast('请输入股票代码'); return; }
    // 自动补全前缀
    code = code.toLowerCase();
    if (!/^(sh|sz)/.test(code)) {
      code = (code.startsWith('6') || code.startsWith('5') || code.startsWith('11') || code.startsWith('12') || code.startsWith('13')) ? 'sh' + code : 'sz' + code;
    }
    // 校验代码格式：sh/sz + 6位数字
    if (!/^s[hz]\d{6}$/.test(code)) {
      this.toast('股票代码格式不正确，请输入6位数字代码');
      return;
    }
    const selected = [...document.querySelectorAll('#add-group-list .group-chip.selected')];
    const groupIds = selected.length ? selected.map(c => c.dataset.groupId) : ['g_all'];
    const existed = this.state.watchlist.find(s => s.code === code);
    const wasInAllGroups = existed && groupIds.every(id => existed.groupIds.includes(id));
    await Storage.addStock(code, name, groupIds);
    const data = await Storage.loadAll();
    this.state.watchlist = data.watchlist;
    document.getElementById('add-modal').style.display = 'none';
    await this.refreshQuotes();
    this.render();
    this.toast(wasInAllGroups ? '该股票已在所选分组中' : (existed ? '已加入新分组' : '已添加 ' + code));
  },

  // ===== 移动到分组 =====
  openMoveModal() {
    if (this.state.selected.size === 0) { this.toast('请先选择股票'); return; }
    const modal = document.getElementById('move-modal');
    const list = document.getElementById('move-group-list');
    list.innerHTML = '';
    this.state.groups.forEach(g => {
      const chip = document.createElement('div');
      const isCurrent = g.groupId === this.state.currentGroupId;
      chip.className = 'group-chip' + (isCurrent ? ' disabled' : '');
      chip.dataset.groupId = g.groupId;
      chip.textContent = g.name + (isCurrent ? '（当前）' : '');
      if (!isCurrent) chip.onclick = () => chip.classList.toggle('selected');
      list.appendChild(chip);
    });
    modal.style.display = 'flex';
  },

  async submitMove() {
    const selected = [...document.querySelectorAll('#move-group-list .group-chip.selected')];
    if (!selected.length) { this.toast('请选择目标分组'); return; }
    // 过滤掉当前分组（移动到当前所在分组是无意义操作，且会导致 manualOrder/pinned 丢失）
    const target = selected.map(c => c.dataset.groupId).filter(id => id !== this.state.currentGroupId);
    if (!target.length) { this.toast('请选择其他分组（非当前分组）'); return; }
    await Storage.moveStocksToGroups([...this.state.selected], this.state.currentGroupId, target);
    const data = await Storage.loadAll();
    this.state.watchlist = data.watchlist;
    document.getElementById('move-modal').style.display = 'none';
    this.state.selected.clear();
    this.state.batchMode = false;
    this.render();
    this.toast('已移动');
  },

  // ===== 看板渲染 =====
  getGroupStocks() {
    const gid = this.state.currentGroupId;
    let stocks = this.state.watchlist.filter(s => s.groupIds.includes(gid));
    if (this.state.searchKeyword) {
      const kw = this.state.searchKeyword.toLowerCase();
      stocks = stocks.filter(s => {
        // 1. 代码匹配（前缀/包含）
        const numCode = s.code.replace(/^(sh|sz)/, '');
        if (numCode.includes(kw) || s.code.toLowerCase().includes(kw)) return true;
        // 2. 中文名称包含
        if (s.name && s.name.toLowerCase().includes(kw)) return true;
        // 3. 拼音首字母 + 4. 行业标签（从 HOT_STOCKS 查找元数据）
        const meta = this.getStockMeta(s.code);
        if (meta) {
          if (meta.pinyin && meta.pinyin.toLowerCase().includes(kw)) return true;
          if (meta.tag && meta.tag.toLowerCase().includes(kw)) return true;
        }
        return false;
      });
    }
    const field = this.state.sortField;
    const dir = this.state.sortDirection === 'asc' ? 1 : -1;
    // 预计算 enrich 后的行情数据，避免排序时重复调用 Quotes.enrich
    const enriched = new Map();
    stocks.forEach(s => { enriched.set(s.code, Quotes.enrich(this.state.quotes[s.code]) || {}); });
    stocks.sort((a, b) => {
      const pa = (a.pinned && a.pinned[gid]) ? 1 : 0, pb = (b.pinned && b.pinned[gid]) ? 1 : 0;
      if (pa !== pb) return pb - pa;
      if (field === 'manual') {
        const oa = a.manualOrder[gid] ?? 9999, ob = b.manualOrder[gid] ?? 9999;
        return oa - ob;
      }
      if (field === 'addedAt') return ((a.addedAt || 0) - (b.addedAt || 0)) * dir;
      if (field === 'name') return (a.name || '').localeCompare(b.name || '') * dir;
      const qa = enriched.get(a.code), qb = enriched.get(b.code);
      const va = qa[field] ?? 0, vb = qb[field] ?? 0;
      return (va - vb) * dir;
    });
    return stocks;
  },

  renderBoard() {
    const stocks = this.getGroupStocks();
    const empty = document.getElementById('empty-state');
    const grid = document.getElementById('grid-view');
    const list = document.getElementById('list-view');
    if (!stocks.length) {
      empty.style.display = 'block';
      grid.style.display = 'none';
      list.style.display = 'none';
      return;
    }
    empty.style.display = 'none';
    if (this.state.viewMode === 'grid') {
      grid.style.display = 'grid';
      list.style.display = 'none';
      this.renderGrid(stocks);
    } else {
      grid.style.display = 'none';
      list.style.display = 'block';
      this.renderList(stocks);
    }
  },

  renderGrid(stocks) {
    const grid = document.getElementById('grid-view');
    grid.innerHTML = '';
    const gid = this.state.currentGroupId;
    stocks.forEach(s => {
      const q = Quotes.enrich(this.state.quotes[s.code]) || { name: s.name, price: 0, change: 0, changePercent: 0 };
      const up = q.change > 0, down = q.change < 0;
      const cls = up ? 'up' : (down ? 'down' : 'flat');
      const card = document.createElement('div');
      card.className = 'grid-card ' + cls;
      card.draggable = !this.state.batchMode;
      card.dataset.code = s.code;
      const priceText = this.state.priceHidden ? '****' : (q.price != null ? q.price.toFixed(2) : '--');
      const changeText = this.state.priceHidden ? '****' :
        `${up ? '+' : ''}${q.change?.toFixed(2) ?? '--'} ${up ? '+' : ''}${q.changePercent?.toFixed(2) ?? '--'}%`;
      const isPinned = s.pinned && s.pinned[gid];
      const isSelected = this.state.selected.has(s.code);
      card.innerHTML = `
        ${isPinned ? '<span class="grid-card-pin">📌</span>' : ''}
        ${this.state.batchMode
          ? `<span class="grid-card-check${isSelected ? ' checked' : ''}">${isSelected ? '✓' : ''}</span>`
          : '<span class="grid-card-more">⋯</span><div class="card-menu"><div class="card-menu-item" data-action="pin">📌 ' + (isPinned ? '取消置顶' : '置顶') + '</div><div class="card-menu-divider"></div><div class="card-menu-item danger" data-action="delete">🗑 删除</div></div>'}
        <div class="grid-card-name">${this.esc(q.name || s.name)}</div>
        <div class="grid-card-price">${priceText}</div>
        <div class="grid-card-change">${changeText}</div>`;
      if (this.state.batchMode) {
        if (isSelected) card.style.outline = '2px solid #3A6EA5';
        card.onclick = () => this.toggleSelect(s.code);
      } else {
        card.onclick = () => this.togglePin(s.code);
        card.oncontextmenu = (e) => { e.preventDefault(); this.togglePin(s.code); };
        // "⋯"按钮：展开操作菜单（置顶 / 删除）
        const moreBtn = card.querySelector('.grid-card-more');
        const menu = card.querySelector('.card-menu');
        if (moreBtn && menu) {
          moreBtn.onclick = (e) => {
            e.stopPropagation();
            // 关闭其他已打开的菜单
            document.querySelectorAll('.card-menu.show').forEach(m => { if (m !== menu) m.classList.remove('show'); });
            menu.classList.toggle('show');
            // 根据卡片在看板中的位置，动态决定菜单向上还是向下展开
            // 避免被 .board 的 overflow-y:auto 裁剪
            if (menu.classList.contains('show')) {
              const cardRect = card.getBoundingClientRect();
              const board = document.getElementById('board');
              const boardRect = board.getBoundingClientRect();
              const cardCenter = cardRect.top + cardRect.height / 2;
              const boardCenter = boardRect.top + boardRect.height / 2;
              if (cardCenter > boardCenter) {
                menu.style.top = 'auto';
                menu.style.bottom = '22px';
              } else {
                menu.style.top = '22px';
                menu.style.bottom = 'auto';
              }
            }
          };
          moreBtn.style.cursor = 'pointer';
          // 菜单项：置顶
          const pinItem = menu.querySelector('[data-action="pin"]');
          if (pinItem) pinItem.onclick = (e) => { e.stopPropagation(); menu.classList.remove('show'); this.togglePin(s.code); };
          // 菜单项：删除
          const delItem = menu.querySelector('[data-action="delete"]');
          if (delItem) delItem.onclick = (e) => { e.stopPropagation(); menu.classList.remove('show'); this.removeStocks([s.code]); };
        }
      }
      card.ondragstart = (e) => { this.state.dragSrc = s.code; this.state.dragType = 'stock'; e.dataTransfer.effectAllowed = 'move'; };
      card.ondragover = (e) => { e.preventDefault(); card.classList.add('drag-over'); };
      card.ondragleave = () => card.classList.remove('drag-over');
      card.ondrop = (e) => {
        e.preventDefault();
        card.classList.remove('drag-over');
        if (this.state.dragType === 'stock' && this.state.dragSrc && this.state.dragSrc !== s.code) {
          this.manualReorder(this.state.dragSrc, s.code);
        }
      };
      // 悬浮显示行情详情
      card.onmouseenter = (e) => this.showQuoteTooltip(s.code, e);
      card.onmouseleave = () => this.hideQuoteTooltip();
      grid.appendChild(card);
    });
  },

  renderList(stocks) {
    const header = document.getElementById('list-header');
    const body = document.getElementById('list-body');
    const cols = this.state.columnOrder.filter(c => this.state.columns.includes(c));
    header.innerHTML = '';
    // 拖拽手柄列
    const hDrag = document.createElement('div');
    hDrag.className = 'list-cell drag-handle';
    hDrag.style.flex = '0 0 16px';
    header.appendChild(hDrag);
    cols.forEach(c => {
      const cell = document.createElement('div');
      cell.className = 'list-cell' + (c === 'name' ? ' col-name' : '');
      cell.textContent = this.FIELD_LABELS[c] || c;
      cell.style.cursor = 'pointer';
      cell.dataset.field = c;
      if (c === this.state.sortField) cell.textContent += this.state.sortDirection === 'asc' ? ' ↑' : ' ↓';
      cell.onclick = () => this.sortByField(c);
      header.appendChild(cell);
    });
    // 操作列（非批量模式时显示移除按钮）
    if (!this.state.batchMode) {
      const hOp = document.createElement('div');
      hOp.className = 'list-cell';
      hOp.style.flex = '0 0 40px';
      hOp.textContent = '操作';
      header.appendChild(hOp);
    }
    body.innerHTML = '';
    const gid = this.state.currentGroupId;
    stocks.forEach(s => {
      const q = Quotes.enrich(this.state.quotes[s.code]) || { name: s.name, price: 0, change: 0, changePercent: 0 };
      const up = q.change > 0, down = q.change < 0;
      const row = document.createElement('div');
      row.className = 'list-row';
      row.draggable = !this.state.batchMode;
      row.dataset.code = s.code;
      if (this.state.batchMode && this.state.selected.has(s.code)) row.style.background = '#E8F0FE';
      let html = '<div class="list-cell drag-handle" style="flex:0 0 16px;">⋮⋮</div>';
      cols.forEach(c => {
        let val = '';
        if (c === 'name') val = this.esc(q.name || s.name);
        else if (c === 'code') val = this.esc(s.code);
        else if (c === 'addedAt') val = s.addedAt ? new Date(s.addedAt).toLocaleDateString() : '--';
        else if (typeof q[c] === 'number') {
          if (this.state.priceHidden && ['price', 'change', 'changePercent', 'open', 'prevClose', 'high', 'low'].includes(c)) val = '****';
          else if (c === 'price') val = q[c].toFixed(2);
          else if (['change', 'changePercent'].includes(c)) val = (up ? '+' : '') + q[c].toFixed(2);
          else if (['volume'].includes(c)) val = this.formatVolume(q[c]);
          else if (['amount'].includes(c)) val = this.formatAmount(q[c]);
          else val = q[c];
        } else val = this.esc(q[c] ?? '--');
        const cls = ['change', 'changePercent'].includes(c) ? (up ? 'up' : down ? 'down' : '') : '';
        html += `<div class="list-cell ${cls}${c === 'name' ? ' col-name' : ''}">${val}</div>`;
      });
      // 操作列：单只移除按钮（非批量模式）
      if (!this.state.batchMode) {
        html += `<div class="list-cell" style="flex:0 0 40px;"><button class="row-remove-btn" data-code="${s.code}" title="移出自选">✕</button></div>`;
      }
      row.innerHTML = html;
      if (this.state.batchMode) {
        row.onclick = () => this.toggleSelect(s.code);
      } else {
        row.onclick = () => this.togglePin(s.code);
        row.oncontextmenu = (e) => { e.preventDefault(); this.togglePin(s.code); };
        // 单只移除按钮
        const removeBtn = row.querySelector('.row-remove-btn');
        if (removeBtn) {
          removeBtn.onclick = (e) => { e.stopPropagation(); this.removeStocks([s.code]); };
        }
      }
      row.ondragstart = (e) => { this.state.dragSrc = s.code; this.state.dragType = 'stock'; e.dataTransfer.effectAllowed = 'move'; };
      row.ondragover = (e) => { e.preventDefault(); row.classList.add('drag-over'); };
      row.ondragleave = () => row.classList.remove('drag-over');
      row.ondrop = (e) => {
        e.preventDefault();
        row.classList.remove('drag-over');
        if (this.state.dragType === 'stock' && this.state.dragSrc && this.state.dragSrc !== s.code) {
          this.manualReorder(this.state.dragSrc, s.code);
        }
      };
      // 悬浮显示行情详情
      row.onmouseenter = (e) => this.showQuoteTooltip(s.code, e);
      row.onmouseleave = () => this.hideQuoteTooltip();
      body.appendChild(row);
    });
    // 虚拟滚动：超过 50 只时启用 content-visibility（PRD 4.1）
    if (stocks.length > 50) {
      body.querySelectorAll('.list-row').forEach(r => r.classList.add('virtual'));
    }
  },

  formatVolume(v) {
    if (!v) return '0';
    if (v >= 100000000) return (v / 100000000).toFixed(2) + '亿';
    if (v >= 10000) return (v / 10000).toFixed(1) + '万';
    return String(v);
  },

  formatAmount(v) {
    if (!v) return '0';
    if (v >= 100000000) return (v / 100000000).toFixed(2) + '亿';
    if (v >= 10000) return (v / 10000).toFixed(1) + '万';
    return v.toFixed(0);
  },

  // ===== 排序 =====
  applySortSelect() {
    const sel = document.getElementById('sort-select');
    const f = this.state.sortField, d = this.state.sortDirection;
    if (f === 'manual') sel.value = 'manual';
    else sel.value = f + '-' + d;
  },

  async onSortSelectChange(val) {
    if (val === 'manual') {
      this.state.sortField = 'manual';
      this.state.sortDirection = 'desc';
    } else {
      const [field, dir] = val.split('-');
      this.state.sortField = field;
      this.state.sortDirection = dir;
    }
    this._scheduleBoardSave(this.state.currentGroupId, { sortField: this.state.sortField, sortDirection: this.state.sortDirection });
    this.renderBoard();
  },

  async sortByField(field) {
    if (this.state.sortField === field) {
      this.state.sortDirection = this.state.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.state.sortField = field;
      this.state.sortDirection = 'desc';
    }
    this.applySortSelect();
    this._scheduleBoardSave(this.state.currentGroupId, { sortField: this.state.sortField, sortDirection: this.state.sortDirection });
    this.renderBoard();
  },

  async manualReorder(srcCode, dstCode) {
    const stocks = this.getGroupStocks();
    const ids = stocks.map(s => s.code);
    const from = ids.indexOf(srcCode), to = ids.indexOf(dstCode);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    await Storage.setManualOrder(this.state.currentGroupId, ids);
    this.state.sortField = 'manual';
    this.applySortSelect();
    this._scheduleBoardSave(this.state.currentGroupId, { sortField: 'manual' });
    this.renderBoard();
  },

  async togglePin(code) {
    await Storage.togglePin(this.state.currentGroupId, code);
    const data = await Storage.loadAll();
    this.state.watchlist = data.watchlist;
    this.renderBoard();
  },

  async removeStocks(codes) {
    const gid = this.state.currentGroupId;
    const isAll = gid === 'g_all';
    const msg = isAll
      ? `确认从自选股彻底移除 ${codes.length} 只股票？`
      : `确认将 ${codes.length} 只股票移出当前分组？（仍保留在「全部」中）`;
    const ok = await this._confirm(msg, { title: '移除确认', okText: '移除' });
    if (!ok) return;
    await Storage.removeStocksBatch(codes, gid);
    const data = await Storage.loadAll();
    this.state.watchlist = data.watchlist;
    this.state.selected.clear();
    this.state.batchMode = false;
    this.render();
    this.toast(isAll ? '已移除' : '已移出分组');
  },

  toggleSelect(code) {
    if (this.state.selected.has(code)) this.state.selected.delete(code);
    else this.state.selected.add(code);
    document.getElementById('batch-count').textContent = `已选 ${this.state.selected.size} 只`;
    this.renderBoard();
  },

  // ===== 视图切换 =====
  async switchView(mode) {
    this.state.viewMode = mode;
    this._scheduleBoardSave(this.state.currentGroupId, { viewMode: mode });
    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(mode === 'grid' ? 'btn-view-grid' : 'btn-view-list').classList.add('active');
    this.renderBoard();
  },

  // ===== 列配置 =====
  toggleColPanel() {
    const panel = document.getElementById('col-panel');
    if (panel.style.display === 'none') {
      panel.style.display = 'block';
      this.renderColPanel();
    } else {
      panel.style.display = 'none';
    }
  },

  renderColPanel() {
    const body = document.getElementById('col-panel-body');
    body.innerHTML = '';
    const ordered = [...this.state.columnOrder];
    this.ALL_FIELDS.forEach(f => { if (!ordered.includes(f)) ordered.push(f); });
    ordered.forEach(f => {
      const item = document.createElement('div');
      item.className = 'col-item';
      item.draggable = true;
      item.dataset.field = f;
      const checked = this.state.columns.includes(f);
      item.innerHTML = `
        <input type="checkbox" ${checked ? 'checked' : ''}>
        <span class="col-item-label">${this.FIELD_LABELS[f] || f}</span>
        <span class="col-item-drag">⋮⋮</span>`;
      item.querySelector('input').onchange = (e) => this.toggleColumn(f, e.target.checked);
      item.ondragstart = (e) => { this.state.dragSrc = f; this.state.dragType = 'column'; e.dataTransfer.effectAllowed = 'move'; };
      item.ondragover = (e) => { e.preventDefault(); item.style.background = '#F0F2F5'; };
      item.ondragleave = () => { item.style.background = ''; };
      item.ondrop = (e) => {
        e.preventDefault();
        item.style.background = '';
        if (this.state.dragType === 'column' && this.state.dragSrc && this.state.dragSrc !== f) {
          this.reorderColumns(this.state.dragSrc, f);
        }
      };
      body.appendChild(item);
    });
  },

  async toggleColumn(field, checked) {
    if (checked) {
      if (!this.state.columns.includes(field)) this.state.columns.push(field);
    } else {
      if (this.state.columns.length <= 1) { this.toast('至少保留 1 个字段'); this.renderColPanel(); return; }
      this.state.columns = this.state.columns.filter(c => c !== field);
    }
    this._scheduleBoardSave(this.state.currentGroupId, { columns: this.state.columns });
    this.renderBoard();
  },

  async reorderColumns(src, dst) {
    const order = [...this.state.columnOrder];
    const from = order.indexOf(src), to = order.indexOf(dst);
    if (from < 0 || to < 0) return;
    order.splice(to, 0, order.splice(from, 1)[0]);
    this.state.columnOrder = order;
    this._scheduleBoardSave(this.state.currentGroupId, { columnOrder: order });
    this.renderColPanel();
    this.renderBoard();
  },

  // ===== 批量模式 =====
  toggleBatchMode() {
    this.state.batchMode = !this.state.batchMode;
    if (!this.state.batchMode) this.state.selected.clear();
    document.getElementById('btn-edit').classList.toggle('active', this.state.batchMode);
    document.getElementById('batch-bar').style.display = this.state.batchMode ? 'flex' : 'none';
    document.getElementById('batch-count').textContent = `已选 ${this.state.selected.size} 只`;
    this.renderBoard();
  },

  // ===== 搜索 =====
  onSearch(val) {
    this.state.searchKeyword = val.trim();
    this.renderBoard();
  },

  // ===== 价格隐藏 =====
  togglePriceHidden() {
    this.state.priceHidden = !this.state.priceHidden;
    const btn = document.getElementById('btn-toggle-price');
    btn.textContent = this.state.priceHidden ? '🚫' : '👁';
    btn.title = this.state.priceHidden ? '显示价格' : '隐藏价格';
    btn.classList.toggle('active', this.state.priceHidden);
    this.renderBoard();
  },

  // ===== 悬浮行情浮窗 =====
  showQuoteTooltip(code, evt) {
    const q = Quotes.enrich(this.state.quotes[code]);
    if (!q) return;
    const tip = document.getElementById('quote-tooltip');
    const up = q.change > 0, down = q.change < 0;
    const cls = up ? 'up' : (down ? 'down' : 'flat');
    const sign = up ? '+' : '';
    const fmt = (v, d = 2) => (v != null && !isNaN(v)) ? Number(v).toFixed(d) : '--';
    const pct = q.changePercent != null ? `${sign}${fmt(q.changePercent)}%` : '--';
    const chg = q.change != null ? `${sign}${fmt(q.change)}` : '--';
    tip.innerHTML = `
      <div class="tt-name">${this.esc(q.name || code)}<span class="tt-code">${this.esc(code)}</span></div>
      <div class="tt-row"><span class="tt-label">现价</span><span class="tt-val ${cls}">${fmt(q.price)}</span></div>
      <div class="tt-row"><span class="tt-label">涨跌额</span><span class="tt-val ${cls}">${chg}</span></div>
      <div class="tt-row"><span class="tt-label">涨跌幅</span><span class="tt-val ${cls}">${pct}</span></div>
      <div class="tt-row"><span class="tt-label">今开</span><span class="tt-val">${fmt(q.open)}</span></div>
      <div class="tt-row"><span class="tt-label">昨收</span><span class="tt-val">${fmt(q.prevClose)}</span></div>
      <div class="tt-row"><span class="tt-label">最高</span><span class="tt-val ${cls}">${fmt(q.high)}</span></div>
      <div class="tt-row"><span class="tt-label">最低</span><span class="tt-val ${cls}">${fmt(q.low)}</span></div>
      <div class="tt-row"><span class="tt-label">成交量</span><span class="tt-val">${q.volume != null ? this.formatVolume(q.volume) : '--'}</span></div>
      <div class="tt-row"><span class="tt-label">成交额</span><span class="tt-val">${q.amount != null ? this.formatAmount(q.amount) : '--'}</span></div>`;
    tip.style.display = 'block';
    // 定位：避免超出 popup 边界
    const rect = evt.currentTarget.getBoundingClientRect();
    const tipW = 220, tipH = tip.offsetHeight || 200;
    let x = rect.right + 6;
    let y = rect.top;
    if (x + tipW > 420) x = rect.left - tipW - 6;
    if (x < 4) x = 4;
    if (y + tipH > window.innerHeight) y = window.innerHeight - tipH - 4;
    if (y < 4) y = 4;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  },

  hideQuoteTooltip() {
    document.getElementById('quote-tooltip').style.display = 'none';
  },

  // ===== HTML 转义（防止 XSS）=====
  esc(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },

  // ===== Toast =====
  toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('show'), 2000);
  },

  // ===== 自定义确认弹层（替代原生 confirm()，避免 popup 失焦关闭） =====
  _confirm(msg, { title = '确认', okText = '确认', danger = true } = {}) {
    // 关闭前一个未完成的确认弹窗，防止并发导致 Promise 悬挂
    if (this._confirmResolve) {
      this._confirmResolve(false);
      this._confirmCleanup?.();
    }
    return new Promise((resolve) => {
      this._confirmResolve = resolve;
      const modal = document.getElementById('confirm-modal');
      document.getElementById('confirm-title').textContent = title;
      document.getElementById('confirm-msg').textContent = msg;
      const okBtn = document.getElementById('confirm-ok');
      const cancelBtn = document.getElementById('confirm-cancel');
      okBtn.textContent = okText;
      okBtn.className = danger ? 'btn-danger' : 'btn-primary';
      modal.style.display = 'flex';
      // 键盘支持：Escape 取消，Enter 确认
      const onKeydown = (e) => {
        if (e.key === 'Escape') { cleanup(); resolve(false); }
        if (e.key === 'Enter')  { cleanup(); resolve(true); }
      };
      document.addEventListener('keydown', onKeydown);
      const cleanup = () => {
        modal.style.display = 'none';
        okBtn.onclick = null;
        cancelBtn.onclick = null;
        document.removeEventListener('keydown', onKeydown);
        this._confirmResolve = null;
        this._confirmCleanup = null;
      };
      this._confirmCleanup = cleanup;
      okBtn.onclick = () => { cleanup(); resolve(true); };
      cancelBtn.onclick = () => { cleanup(); resolve(false); };
    });
  },

  // ===== 配置写入防抖（PRD 4.1：200ms 批量写入，按分组隔离，避免频繁/跨组 storage IO） =====
  _scheduleBoardSave(groupId, cfg) {
    if (!this._pendingBoardCfg) this._pendingBoardCfg = {};
    if (!this._pendingBoardCfg[groupId]) this._pendingBoardCfg[groupId] = {};
    Object.assign(this._pendingBoardCfg[groupId], cfg);
    clearTimeout(this._boardSaveTimer);
    this._boardSaveTimer = setTimeout(() => this._flushBoardSave(), 200);
  },

  _flushBoardSave() {
    if (!this._pendingBoardCfg) return;
    for (const [gid, gcfg] of Object.entries(this._pendingBoardCfg)) {
      Storage.saveBoardConfigForGroup(gid, gcfg);
    }
    this._pendingBoardCfg = {};
  },

  // ===== 渲染入口 =====
  render() {
    this.renderGroupTabs();
    // 视图按钮激活态
    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    const vb = document.getElementById(this.state.viewMode === 'grid' ? 'btn-view-grid' : 'btn-view-list');
    if (vb) vb.classList.add('active');
    // 头部按钮激活态
    document.getElementById('btn-edit').classList.toggle('active', this.state.batchMode);
    document.getElementById('btn-toggle-price').classList.toggle('active', this.state.priceHidden);
    document.getElementById('btn-toggle-price').textContent = this.state.priceHidden ? '🚫' : '👁';
    document.getElementById('btn-toggle-price').title = this.state.priceHidden ? '显示价格' : '隐藏价格';
    this.renderBoard();
    document.getElementById('batch-bar').style.display = this.state.batchMode ? 'flex' : 'none';
  },

  // ===== 事件绑定 =====
  bindEvents() {
    // 头部按钮
    document.getElementById('btn-add-stock').onclick = () => this.openAddModal();
    document.getElementById('btn-edit').onclick = () => this.toggleBatchMode();
    document.getElementById('btn-toggle-price').onclick = () => this.togglePriceHidden();
    document.getElementById('btn-new-group').onclick = () => this.openGroupModal('create');
    // 视图与列设置
    document.getElementById('btn-view-grid').onclick = () => this.switchView('grid');
    document.getElementById('btn-view-list').onclick = () => this.switchView('list');
    document.getElementById('btn-col-config').onclick = () => this.toggleColPanel();
    document.getElementById('col-panel-close').onclick = () => { document.getElementById('col-panel').style.display = 'none'; };
    document.getElementById('col-panel-back').onclick = () => { document.getElementById('col-panel').style.display = 'none'; };
    // 排序与搜索
    document.getElementById('sort-select').onchange = (e) => this.onSortSelectChange(e.target.value);
    document.getElementById('search-input').oninput = (e) => this.onSearch(e.target.value);
    // 空状态添加按钮
    document.getElementById('btn-empty-add').onclick = () => this.openAddModal();
    // 添加股票弹层：关闭/取消/确认
    document.getElementById('add-close').onclick = () => { document.getElementById('add-modal').style.display = 'none'; };
    document.getElementById('add-cancel').onclick = () => { document.getElementById('add-modal').style.display = 'none'; };
    document.getElementById('add-confirm').onclick = () => this.submitAddStock();
    // 分组弹层：关闭/取消/确认/删除
    document.getElementById('group-close').onclick = () => { document.getElementById('group-modal').style.display = 'none'; };
    document.getElementById('group-cancel').onclick = () => { document.getElementById('group-modal').style.display = 'none'; };
    document.getElementById('group-confirm').onclick = () => this.submitGroupModal();
    document.getElementById('group-delete').onclick = async () => {
      const modal = document.getElementById('group-modal');
      if (modal.dataset.mode === 'rename' && modal.dataset.groupId) {
        await this.deleteGroup(modal.dataset.groupId);
        // 仅在删除成功（分组已不存在）时关闭弹层
        const stillExists = this.state.groups.some(g => g.groupId === modal.dataset.groupId);
        if (!stillExists) modal.style.display = 'none';
      }
    };
    // 移动弹层：关闭/取消/确认
    document.getElementById('move-close').onclick = () => { document.getElementById('move-modal').style.display = 'none'; };
    document.getElementById('move-cancel').onclick = () => { document.getElementById('move-modal').style.display = 'none'; };
    document.getElementById('move-confirm').onclick = () => this.submitMove();
    // 批量操作
    document.getElementById('batch-move').onclick = () => this.openMoveModal();
    document.getElementById('batch-remove').onclick = () => this.removeStocks([...this.state.selected]);
    document.getElementById('batch-cancel').onclick = () => this.toggleBatchMode();
    // 点击外部关闭卡片操作菜单
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.grid-card-more') && !e.target.closest('.card-menu')) {
        document.querySelectorAll('.card-menu.show').forEach(m => m.classList.remove('show'));
      }
    });
    // 回车确认
    document.getElementById('add-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.submitAddStock(); });
    document.getElementById('add-code').addEventListener('input', (e) => this.renderCodeSuggest(e.target.value));
    document.getElementById('add-code').addEventListener('blur', () => {
      setTimeout(() => { document.getElementById('code-suggest').style.display = 'none'; }, 150);
    });
    document.getElementById('add-code').addEventListener('focus', (e) => this.renderCodeSuggest(e.target.value));
    document.getElementById('group-name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.submitGroupModal(); });
    // 点击遮罩关闭弹层
    document.querySelectorAll('.modal-mask').forEach(m => {
      m.addEventListener('click', (e) => { if (e.target === m) m.style.display = 'none'; });
    });
    // 确认弹层遮罩点击 = 取消（阻止冒泡，避免通用 .modal-mask handler 干扰）
    const confirmMask = document.getElementById('confirm-modal');
    confirmMask.addEventListener('click', (e) => {
      if (e.target === confirmMask) {
        e.stopImmediatePropagation();
        document.getElementById('confirm-cancel').click();
      }
    });
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
