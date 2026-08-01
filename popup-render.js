// popup-render.js — Popup 视图层
//
// 职责：纯 DOM 渲染与纯函数化辅助。所有方法显式接收 state（或必要参数），
// 不再读取 this.state；所有用户操作通过 Actions 委托（不在本模块内直接修改 state）。
// 行情格式化统一调用全局 QuoteFormat，不再保留同名薄包装。

const Render = {
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
    { code: 'sz300760', name: '迈瑞医疗', tag: '医疗', pinyin: 'mrly' },
    // 科创板（sh688xxx）
    { code: 'sh688981', name: '中芯国际', tag: '半导体', pinyin: 'zxgj' },
    { code: 'sh688111', name: '金山办公', tag: '软件', pinyin: 'jsbg' },
    { code: 'sh688036', name: '传音控股', tag: '手机', pinyin: 'cykg' },
    { code: 'sh688256', name: '寒武纪', tag: 'AI芯片', pinyin: 'hwj' },
    { code: 'sh688599', name: '天合光能', tag: '光伏', pinyin: 'thgn' },
    // 北交所（bj920xxx/bj8xxxxx/bj4xxxxx）
    { code: 'bj920185', name: '贝特瑞', tag: '新能源', pinyin: 'btr' },
    { code: 'bj920368', name: '连城数控', tag: '光伏设备', pinyin: 'lcsk' },
    { code: 'bj920819', name: '颖泰生物', tag: '农药', pinyin: 'ytsw' },
    { code: 'bj430047', name: '诺思兰德', tag: '生物医药', pinyin: 'nsld' },
    { code: 'bj830799', name: '艾融软件', tag: '金融科技', pinyin: 'arrj' }
  ],

  // 订阅 state：任意 notify 都触发完整重渲染
  subscribe(state) {
    state.subscribe((s) => this.render(s));
  },

  // ===== 渲染入口 =====
  render(state) {
    this.renderGroupTabs(state);
    // 视图按钮激活态
    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    const vb = document.getElementById(state.viewMode === 'grid' ? 'btn-view-grid' : 'btn-view-list');
    if (vb) vb.classList.add('active');
    // 头部按钮激活态
    document.getElementById('btn-edit').classList.toggle('active', state.batchMode);
    document.getElementById('btn-toggle-price').classList.toggle('active', state.priceHidden);
    document.getElementById('btn-toggle-price').textContent = state.priceHidden ? '🚫' : '👁';
    document.getElementById('btn-toggle-price').title = state.priceHidden ? '显示价格' : '隐藏价格';
    this.renderBoard(state);
    document.getElementById('batch-bar').style.display = state.batchMode ? 'flex' : 'none';
  },

  // ===== 分组 Tab =====
  renderGroupTabs(state) {
    const scroll = document.getElementById('tabs-scroll');
    scroll.innerHTML = '';
    state.groups.forEach(g => {
      const tab = document.createElement('div');
      const isActive = g.groupId === state.currentGroupId;
      tab.className = 'tab' + (isActive ? ' active' : '');
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
      tab.tabIndex = isActive ? 0 : -1;
      tab.draggable = true;
      tab.dataset.groupId = g.groupId;
      const count = StockUtils.countStocksForGroup(state.watchlist, g.groupId);
      tab.innerHTML = `<span>${this.esc(g.name)}</span><span style="font-size:10px;color:var(--text-secondary);margin-left:2px;">${count}</span>`;
      tab.onclick = () => Actions.switchGroup(g.groupId);
      tab.oncontextmenu = (e) => { e.preventDefault(); if (!g.isDefault) Actions.openGroupModal('rename', g); };
      tab.ondragstart = (e) => { state.dragSrc = g.groupId; state.dragType = 'group'; e.dataTransfer.effectAllowed = 'move'; };
      tab.ondragover = (e) => { e.preventDefault(); tab.style.opacity = '.5'; };
      tab.ondragleave = () => { tab.style.opacity = ''; };
      tab.ondrop = (e) => {
        e.preventDefault();
        tab.style.opacity = '';
        if (state.dragType === 'group' && state.dragSrc && state.dragSrc !== g.groupId) {
          Actions.reorderGroups(state.dragSrc, g.groupId);
        }
      };
      tab.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const tabs = [...scroll.querySelectorAll('[role="tab"]')];
          const currentIdx = tabs.indexOf(tab);
          if (currentIdx === -1 || tabs.length < 2) return;
          const nextIdx = e.key === 'ArrowRight'
            ? (currentIdx + 1) % tabs.length
            : (currentIdx - 1 + tabs.length) % tabs.length;
          const nextGroupId = tabs[nextIdx].dataset.groupId;
          Actions.switchGroup(nextGroupId).finally(() => {
            // 重渲染会销毁旧 DOM，需在新 tab 上恢复焦点（roving tabindex）
            const newActive = scroll.querySelector(`[role="tab"][data-group-id="${nextGroupId}"]`);
            if (newActive) newActive.focus();
          });
        }
      });
      scroll.appendChild(tab);
    });
  },

  // ===== 看板渲染 =====
  getGroupStocks(state) {
    let stocks = StockUtils.getStocksForGroup(state.watchlist, state.currentGroupId);
    if (state.searchKeyword) {
      const kw = state.searchKeyword.toLowerCase();
      stocks = stocks.filter(s => {
        // 1. 代码匹配（前缀/包含）
        const numCode = s.code.replace(/^(sh|sz|bj)/, '');
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
    return StockUtils.sortStocks(
      stocks,
      state.quoteSnapshot.results,
      state.currentGroupId,
      state.sortField,
      state.sortDirection
    );
  },

  renderBoard(state) {
    const stocks = this.getGroupStocks(state);
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
    if (state.viewMode === 'grid') {
      grid.style.display = 'grid';
      list.style.display = 'none';
      this.renderGrid(state, stocks);
    } else {
      grid.style.display = 'none';
      list.style.display = 'block';
      this.renderList(state, stocks);
    }
  },

  renderGrid(state, stocks) {
    const grid = document.getElementById('grid-view');
    grid.innerHTML = '';
    const gid = state.currentGroupId;
    stocks.forEach(s => {
      const result = state.quoteSnapshot.results[s.code]
        || { status: 'missing', fetchedAt: null, quote: null };
      const display = QuoteFormat.getQuoteDisplay(result);
      const q = result.quote || {};
      const up = typeof q.change === 'number' && q.change > 0;
      const down = typeof q.change === 'number' && q.change < 0;
      const cls = up ? 'up' : (down ? 'down' : 'flat');
      const card = document.createElement('div');
      card.className = `grid-card ${cls} quote-${display.status}`;
      card.draggable = !state.batchMode;
      card.dataset.code = s.code;
      const priceText = state.priceHidden && display.price !== '--' ? '****' : display.price;
      const changeText = state.priceHidden && display.change !== '--' ? '****' : display.change;
      const isPinned = s.pinned && s.pinned[gid];
      const isSelected = state.selected.has(s.code);
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', `${q.name || s.name} ${priceText} ${changeText}`);
      card.setAttribute('aria-pressed', isPinned ? 'true' : 'false');
      const staleBadge = display.staleLabel
        ? `<span class="quote-stale" title="缓存行情">${display.staleLabel}</span>`
        : '';
      card.innerHTML = `
        ${isPinned ? '<span class="grid-card-pin">📌</span>' : ''}
        ${state.batchMode
          ? `<span class="grid-card-check${isSelected ? ' checked' : ''}">${isSelected ? '✓' : ''}</span>`
          : '<span class="grid-card-more">⋯</span><div class="card-menu"><div class="card-menu-item" data-action="pin">📌 ' + (isPinned ? '取消置顶' : '置顶') + '</div><div class="card-menu-divider"></div><div class="card-menu-item danger" data-action="delete">🗑 删除</div></div>'}
        <div class="grid-card-name">${this.esc(q.name || s.name)}${staleBadge}</div>
        <div class="grid-card-price">${priceText}</div>
        <div class="grid-card-change">${changeText}</div>`;
      if (state.batchMode) {
        if (isSelected) card.style.outline = '2px solid var(--color-accent)';
        card.onclick = () => Actions.toggleSelect(s.code);
      } else {
        card.onclick = () => Actions.togglePin(s.code);
        card.oncontextmenu = (e) => { e.preventDefault(); Actions.togglePin(s.code); };
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
          if (pinItem) pinItem.onclick = (e) => { e.stopPropagation(); menu.classList.remove('show'); Actions.togglePin(s.code); };
          // 菜单项：删除
          const delItem = menu.querySelector('[data-action="delete"]');
          if (delItem) delItem.onclick = (e) => { e.stopPropagation(); menu.classList.remove('show'); Actions.removeStocks([s.code]); };
        }
      }
      // 键盘支持：Enter / Space 触发与点击一致的操作
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const action = state.batchMode ? 'select' : 'pin';
          if (action === 'select') {
            // toggleSelect 同步触发重渲染（销毁旧卡片），用 Promise.resolve 对齐
            // 非批量分支的 .finally() 模式，在微任务中恢复同 code 新卡片焦点。
            Promise.resolve(Actions.toggleSelect(s.code)).finally(() => {
              const newCard = grid.querySelector(`.grid-card[data-code="${s.code}"]`);
              if (newCard) newCard.focus();
            });
          } else {
            Actions.togglePin(s.code).finally(() => {
              // 重渲染会销毁旧 DOM，需在同 code 的新卡片上恢复焦点
              const newCard = grid.querySelector(`.grid-card[data-code="${s.code}"]`);
              if (newCard) newCard.focus();
            });
          }
        }
      });
      card.ondragstart = (e) => { state.dragSrc = s.code; state.dragType = 'stock'; e.dataTransfer.effectAllowed = 'move'; };
      card.ondragover = (e) => { e.preventDefault(); card.classList.add('drag-over'); };
      card.ondragleave = () => card.classList.remove('drag-over');
      card.ondrop = (e) => {
        e.preventDefault();
        card.classList.remove('drag-over');
        if (state.dragType === 'stock' && state.dragSrc && state.dragSrc !== s.code) {
          Actions.manualReorder(state.dragSrc, s.code);
        }
      };
      // 悬浮显示行情详情
      card.onmouseenter = (e) => this.showQuoteTooltip(s.code, e, state);
      card.onmouseleave = () => this.hideQuoteTooltip();
      grid.appendChild(card);
    });
  },

  renderList(state, stocks) {
    const header = document.getElementById('list-header');
    const body = document.getElementById('list-body');
    const cols = state.columnOrder.filter(c => state.columns.includes(c));
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
      if (c === state.sortField) cell.textContent += state.sortDirection === 'asc' ? ' ↑' : ' ↓';
      cell.onclick = () => Actions.sortByField(c);
      header.appendChild(cell);
    });
    // 操作列（非批量模式时显示移除按钮）
    if (!state.batchMode) {
      const hOp = document.createElement('div');
      hOp.className = 'list-cell';
      hOp.style.flex = '0 0 40px';
      hOp.textContent = '操作';
      header.appendChild(hOp);
    }
    body.innerHTML = '';
    const gid = state.currentGroupId;
    stocks.forEach(s => {
      const result = state.quoteSnapshot.results[s.code]
        || { status: 'missing', fetchedAt: null, quote: null };
      const display = QuoteFormat.getQuoteDisplay(result);
      const q = result.quote || {};
      const up = typeof q.change === 'number' && q.change > 0;
      const down = typeof q.change === 'number' && q.change < 0;
      const row = document.createElement('div');
      row.className = `list-row quote-${display.status}`;
      row.draggable = !state.batchMode;
      row.dataset.code = s.code;
      if (state.batchMode && state.selected.has(s.code)) row.style.background = '#E8F0FE';
      let html = '<div class="list-cell drag-handle" style="flex:0 0 16px;">⋮⋮</div>';
      cols.forEach(c => {
        let val = '';
        if (c === 'name') {
          const staleBadge = display.staleLabel
            ? `<span class="quote-stale" title="缓存行情">${display.staleLabel}</span>`
            : '';
          val = this.esc(q.name || s.name) + staleBadge;
        }
        else if (c === 'code') val = this.esc(s.code);
        else if (c === 'addedAt') val = s.addedAt ? new Date(s.addedAt).toLocaleDateString() : '--';
        else if (typeof q[c] === 'number') {
          if (state.priceHidden && ['price', 'change', 'changePercent', 'open', 'prevClose', 'high', 'low'].includes(c)) val = '****';
          else if (c === 'price') val = q[c].toFixed(2);
          else if (['change', 'changePercent'].includes(c)) val = (up ? '+' : '') + q[c].toFixed(2);
          else if (['volume'].includes(c)) val = QuoteFormat.formatVolume(q[c]);
          else if (['amount'].includes(c)) val = QuoteFormat.formatAmount(q[c]);
          else val = q[c];
        } else val = this.esc(q[c] ?? '--');
        const cls = ['change', 'changePercent'].includes(c) ? (up ? 'up' : down ? 'down' : '') : '';
        html += `<div class="list-cell ${cls}${c === 'name' ? ' col-name' : ''}">${val}</div>`;
      });
      // 操作列：单只移除按钮（非批量模式）
      if (!state.batchMode) {
        html += `<div class="list-cell" style="flex:0 0 40px;"><button class="row-remove-btn" data-code="${s.code}" title="移出自选">✕</button></div>`;
      }
      row.innerHTML = html;
      if (state.batchMode) {
        row.onclick = () => Actions.toggleSelect(s.code);
      } else {
        row.onclick = () => Actions.togglePin(s.code);
        row.oncontextmenu = (e) => { e.preventDefault(); Actions.togglePin(s.code); };
        // 单只移除按钮
        const removeBtn = row.querySelector('.row-remove-btn');
        if (removeBtn) {
          removeBtn.onclick = (e) => { e.stopPropagation(); Actions.removeStocks([s.code]); };
        }
      }
      row.ondragstart = (e) => { state.dragSrc = s.code; state.dragType = 'stock'; e.dataTransfer.effectAllowed = 'move'; };
      row.ondragover = (e) => { e.preventDefault(); row.classList.add('drag-over'); };
      row.ondragleave = () => row.classList.remove('drag-over');
      row.ondrop = (e) => {
        e.preventDefault();
        row.classList.remove('drag-over');
        if (state.dragType === 'stock' && state.dragSrc && state.dragSrc !== s.code) {
          Actions.manualReorder(state.dragSrc, s.code);
        }
      };
      // 悬浮显示行情详情
      row.onmouseenter = (e) => this.showQuoteTooltip(s.code, e, state);
      row.onmouseleave = () => this.hideQuoteTooltip();
      body.appendChild(row);
    });
    // 虚拟滚动：超过 50 只时启用 content-visibility（PRD 4.1）
    if (stocks.length > 50) {
      body.querySelectorAll('.list-row').forEach(r => r.classList.add('virtual'));
    }
  },

  // 从 HOT_STOCKS 查找股票元数据（pinyin/tag），供看板搜索使用
  getStockMeta(code) {
    return this.HOT_STOCKS.find(s => s.code === code) || null;
  },

  // ===== 排序下拉同步 =====
  applySortSelect(state) {
    const sel = document.getElementById('sort-select');
    const f = state.sortField, d = state.sortDirection;
    if (f === 'manual') sel.value = 'manual';
    else sel.value = f + '-' + d;
  },

  // ===== 行情状态 / 时间标签 =====
  updateQuoteStatus(state) {
    const element = document.getElementById('quote-status-summary');
    if (element) element.textContent = QuoteFormat.formatStatusSummary(state.quoteSnapshot);
  },

  updateTimeLabel(state) {
    const el = document.getElementById('update-time');
    if (!el) return;
    const ts = state.quoteSnapshot?.succeededAt;
    if (!ts) { el.textContent = '未更新'; return; }
    el.textContent = QuoteFormat.formatRelativeTime(ts);
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
    let results = [];
    try {
      results = await Quotes.searchStocks(kw);
    } catch (error) {
      console.warn('[popup] 搜索服务不可用，使用本地联想:', error.message);
    }

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
      const numCode = s.code.replace(/^(sh|sz|bj)/, '');
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
          <span class="cs-code">${this.esc(s.code)}</span>
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

  // ===== 弹层：添加 / 移动 / 分组 =====
  openAddModal(state) {
    const modal = document.getElementById('add-modal');
    document.getElementById('add-code').value = '';
    document.getElementById('add-name').value = '';
    document.getElementById('code-suggest').style.display = 'none';
    const list = document.getElementById('add-group-list');
    list.innerHTML = '';
    state.groups.forEach(g => {
      const chip = document.createElement('div');
      chip.className = 'group-chip' + (g.groupId === state.currentGroupId ? ' selected' : '');
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

  openMoveModal(state) {
    if (state.selected.size === 0) { this.toast('请先选择股票'); return; }
    const modal = document.getElementById('move-modal');
    const list = document.getElementById('move-group-list');
    list.innerHTML = '';
    state.groups.forEach(g => {
      const chip = document.createElement('div');
      const isCurrent = g.groupId === state.currentGroupId;
      chip.className = 'group-chip' + (isCurrent ? ' disabled' : '');
      chip.dataset.groupId = g.groupId;
      chip.textContent = g.name + (isCurrent ? '（当前）' : '');
      if (!isCurrent) chip.onclick = () => chip.classList.toggle('selected');
      list.appendChild(chip);
    });
    modal.style.display = 'flex';
  },

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

  // ===== 列配置面板 =====
  toggleColPanel(state) {
    const panel = document.getElementById('col-panel');
    if (panel.style.display === 'none') {
      panel.style.display = 'block';
      this.renderColPanel(state);
    } else {
      panel.style.display = 'none';
    }
  },

  renderColPanel(state) {
    const body = document.getElementById('col-panel-body');
    body.innerHTML = '';
    const ordered = [...state.columnOrder];
    this.ALL_FIELDS.forEach(f => { if (!ordered.includes(f)) ordered.push(f); });
    ordered.forEach(f => {
      const item = document.createElement('div');
      item.className = 'col-item';
      item.draggable = true;
      item.dataset.field = f;
      const checked = state.columns.includes(f);
      item.innerHTML = `
        <input type="checkbox" ${checked ? 'checked' : ''}>
        <span class="col-item-label">${this.FIELD_LABELS[f] || f}</span>
        <span class="col-item-drag">⋮⋮</span>`;
      item.querySelector('input').onchange = (e) => Actions.toggleColumn(f, e.target.checked);
      item.ondragstart = (e) => { state.dragSrc = f; state.dragType = 'column'; e.dataTransfer.effectAllowed = 'move'; };
      item.ondragover = (e) => { e.preventDefault(); item.style.background = '#F0F2F5'; };
      item.ondragleave = () => { item.style.background = ''; };
      item.ondrop = (e) => {
        e.preventDefault();
        item.style.background = '';
        if (state.dragType === 'column' && state.dragSrc && state.dragSrc !== f) {
          Actions.reorderColumns(state.dragSrc, f);
        }
      };
      body.appendChild(item);
    });
  },

  // ===== 悬浮行情浮窗 =====
  showQuoteTooltip(code, evt, state) {
    const result = state.quoteSnapshot.results[code];
    const q = result?.quote;
    if (!q) return;
    const tip = document.getElementById('quote-tooltip');
    const up = q.change > 0, down = q.change < 0;
    const cls = up ? 'up' : (down ? 'down' : 'flat');
    const sign = up ? '+' : '';
    const fmt = (v, d = 2) => (v != null && !isNaN(v)) ? Number(v).toFixed(d) : '--';
    const pct = q.changePercent != null ? `${sign}${fmt(q.changePercent)}%` : '--';
    const chg = q.change != null ? `${sign}${fmt(q.change)}` : '--';
    tip.innerHTML = `
      <div class="tt-name">${this.esc(q.name || code)}<span class="tt-code">${this.esc(code)}</span>${result.status === 'cached' ? `<span class="quote-stale" title="缓存行情">${QuoteFormat.getQuoteDisplay(result).staleLabel}</span>` : ''}</div>
      <div class="tt-row"><span class="tt-label">现价</span><span class="tt-val ${cls}">${fmt(q.price)}</span></div>
      <div class="tt-row"><span class="tt-label">涨跌额</span><span class="tt-val ${cls}">${chg}</span></div>
      <div class="tt-row"><span class="tt-label">涨跌幅</span><span class="tt-val ${cls}">${pct}</span></div>
      <div class="tt-row"><span class="tt-label">今开</span><span class="tt-val">${fmt(q.open)}</span></div>
      <div class="tt-row"><span class="tt-label">昨收</span><span class="tt-val">${fmt(q.prevClose)}</span></div>
      <div class="tt-row"><span class="tt-label">最高</span><span class="tt-val ${cls}">${fmt(q.high)}</span></div>
      <div class="tt-row"><span class="tt-label">最低</span><span class="tt-val ${cls}">${fmt(q.low)}</span></div>
      <div class="tt-row"><span class="tt-label">成交量</span><span class="tt-val">${q.volume != null ? QuoteFormat.formatVolume(q.volume) : '--'}</span></div>
      <div class="tt-row"><span class="tt-label">成交额</span><span class="tt-val">${q.amount != null ? QuoteFormat.formatAmount(q.amount) : '--'}</span></div>`;
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
  _toastTimer: null,

  toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('show'), 2000);
  },

  // ===== 自定义确认弹层（替代原生 confirm()，避免 popup 失焦关闭） =====
  _confirmResolve: null,
  _confirmCleanup: null,

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
  }
};

if (typeof module !== 'undefined') module.exports = Render;
