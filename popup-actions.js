// popup-actions.js — Popup 业务逻辑层
//
// 职责：所有用户操作（CRUD / 排序 / 拖拽 / 搜索 / 刷新）。
// 通过 bind(state, render) 注入 State 与 Render：
//   - 读状态：this.state.current
//   - 触发渲染：this.render.<method>(this.state.current)
//   - 调用 RPC：Bridge.send(action, payload)
// 不直接持久化，所有写入经 background Router 落地。

const Actions = {
  _mutations: new Map(),
  _quoteTimer: null,
  _timeTimer: null,

  bind(state, render) {
    this.state = state;
    this.render = render;
    // Node 测试环境无 document，跳过事件绑定；浏览器入口必走 bindEvents。
    if (typeof document !== 'undefined') this.bindEvents();
  },

  // ===== Mutation Lock =====
  // 同一 key 的并发操作（重复点击）只执行一次，后续共享同一个 Promise。
  withMutationLock(key, action) {
    if (this._mutations.has(key)) return this._mutations.get(key);
    const promise = Promise.resolve()
      .then(action)
      .finally(() => this._mutations.delete(key));
    this._mutations.set(key, promise);
    return promise;
  },

  withDisabledButton(buttonId, action) {
    const button = typeof document !== 'undefined' ? document.getElementById(buttonId) : null;
    if (button) button.disabled = true;
    return Promise.resolve()
      .then(action)
      .finally(() => {
        if (button) button.disabled = false;
      });
  },

  // ===== 行情 =====
  applyQuoteSnapshot(snapshot) {
    if ((snapshot?.generation || 0) < this.state.current.quoteGeneration) return false;
    this.state.current.quoteSnapshot = snapshot;
    this.state.current.quoteGeneration = snapshot?.generation || 0;
    return true;
  },

  async refreshQuotes({ force = false } = {}) {
    const codes = this.state.current.watchlist.map((stock) => stock.code);
    const snapshot = await Bridge.send('quote:refresh', { codes, force });
    if (this.applyQuoteSnapshot(snapshot)) {
      this.render.updateQuoteStatus(this.state.current);
      this.render.updateTimeLabel(this.state.current);
    }
    return snapshot;
  },

  scheduleNextRefresh() {
    clearTimeout(this._quoteTimer);
    const delay = QuoteFormat.getRefreshIntervalMs(new Date(), 'popup');
    this._quoteTimer = setTimeout(async () => {
      try {
        await this.refreshQuotes();
        this.render.renderBoard(this.state.current);
      } finally {
        this.scheduleNextRefresh();
      }
    }, delay);
  },

  async manualRefresh() {
    const btn = document.getElementById('btn-refresh');
    if (btn.classList.contains('spinning')) return; // 防止重复点击
    btn.classList.add('spinning');
    try {
      const snapshot = await this.refreshQuotes({ force: true });
      this.render.renderBoard(this.state.current);
      this.render.toast(QuoteFormat.getRefreshToastMessage(snapshot));
      this.scheduleNextRefresh();
    } catch (e) {
      this.render.toast('刷新失败，请稍后重试');
    } finally {
      btn.classList.remove('spinning');
    }
  },

  // ===== 分组切换 / 排序 =====
  async switchGroup(groupId) {
    const prevGroupId = this.state.current.currentGroupId;
    this.state.current.currentGroupId = groupId;
    this.state.current.selected.clear();
    // 切换分组时退出批量模式，避免"批量栏显示但未选中"的困惑状态
    if (this.state.current.batchMode) this.toggleBatchMode();
    try {
      const cfg = await Bridge.send('storage:boardConfig', { groupId });
      Object.assign(this.state.current, cfg);
      this.render.applySortSelect(this.state.current);
      this.render.render(this.state.current);
      document.getElementById('batch-count').textContent = `已选 0 只`;
    } catch (e) {
      // 回滚到原分组，避免 UI 停留在未加载配置的新分组
      this.state.current.currentGroupId = prevGroupId;
      this.render.render(this.state.current);
      this.render.toast(e.message || '切换分组失败，请重试');
    }
  },

  async reorderGroups(srcId, dstId) {
    const ids = this.state.current.groups.map(g => g.groupId);
    const from = ids.indexOf(srcId), to = ids.indexOf(dstId);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    try {
      const result = await Bridge.send('storage:reorderGroups', { ids });
      this.state.current.groups = result.groups;
      this.render.renderGroupTabs(this.state.current);
      this.render.toast('分组顺序已调整');
    } catch (e) {
      this.render.toast(e.message || '操作失败，请重试');
    }
  },

  // ===== 分组 CRUD =====
  openGroupModal(mode, group) {
    this.render.openGroupModal(mode, group);
  },

  submitGroupModal() {
    const modal = document.getElementById('group-modal');
    const key = modal.dataset.mode === 'create' ? 'group:create' : `group:${modal.dataset.groupId}`;
    return this.withMutationLock(key, () =>
      this.withDisabledButton('group-confirm', () => this._submitGroupModal())
    );
  },

  async _submitGroupModal() {
    const modal = document.getElementById('group-modal');
    const name = document.getElementById('group-name-input').value.trim();
    const err = document.getElementById('group-modal-err');
    if (!name) { err.textContent = '请输入分组名称'; return; }
    if (name.length > 12) { err.textContent = '分组名称不超过 12 字符'; return; }
    try {
      let result;
      if (modal.dataset.mode === 'create') {
        result = await Bridge.send('storage:createGroup', { name });
        this.render.toast('分组已创建');
      } else {
        result = await Bridge.send('storage:renameGroup', { groupId: modal.dataset.groupId, name });
        this.render.toast('已重命名');
      }
      this.state.current.groups = result.groups;
      modal.style.display = 'none';
      this.render.renderGroupTabs(this.state.current);
    } catch (e) { err.textContent = e.message; }
  },

  deleteGroup(groupId) {
    return this.withMutationLock(`group:${groupId}`, () =>
      this.withDisabledButton('group-delete', () => this._deleteGroup(groupId))
    );
  },

  async _deleteGroup(groupId) {
    const g = this.state.current.groups.find(x => x.groupId === groupId);
    if (!g) return;
    const ok = await this.render._confirm(`确认删除分组「${g.name}」？组内股票将移回「全部」。`, { title: '删除分组', okText: '删除' });
    if (!ok) return;
    try {
      const result = await Bridge.send('storage:deleteGroup', { groupId });
      if (this.state.current.currentGroupId === groupId) this.state.current.currentGroupId = 'g_all';
      this.state.current.groups = result.groups;
      this.state.current.watchlist = result.watchlist;
      this.render.render(this.state.current);
      this.render.toast('分组已删除');
    } catch (e) { this.render.toast(e.message); }
  },

  // ===== 添加股票 =====
  openAddModal() {
    this.render.openAddModal(this.state.current);
  },

  submitAddStock() {
    return this.withMutationLock('add-stock', () =>
      this.withDisabledButton('add-confirm', () => this._submitAddStock())
    );
  },

  async _submitAddStock() {
    let code = document.getElementById('add-code').value.trim();
    const name = document.getElementById('add-name').value.trim();
    if (!code) { this.render.toast('请输入股票代码'); return; }
    // 自动补全前缀：北交所(4xx/8xx/9xx)→bj，沪市(6xx/5xx等，含科创板688/689)→sh，深市→sz
    code = code.toLowerCase();
    if (!/^(sh|sz|bj)/.test(code)) {
      if (/^(4|8|9)/.test(code)) code = 'bj' + code;
      else if (/^(6|5|11|12|13)/.test(code)) code = 'sh' + code;
      else code = 'sz' + code;
    }
    // 校验代码格式：sh/sz/bj + 6位数字
    if (!/^(sh|sz|bj)\d{6}$/.test(code)) {
      this.render.toast('股票代码格式不正确，请输入6位数字代码');
      return;
    }
    const selected = [...document.querySelectorAll('#add-group-list .group-chip.selected')];
    const groupIds = selected.length ? selected.map(c => c.dataset.groupId) : ['g_all'];
    const existed = this.state.current.watchlist.find(s => s.code === code);
    const wasInAllGroups = existed && groupIds.every((id) =>
      id === StockUtils.ALL_GROUP_ID || existed.groupIds.includes(id)
    );
    try {
      const result = await Bridge.send('storage:addStock', { code, name, groupIds });
      this.state.current.watchlist = result.watchlist;
      document.getElementById('add-modal').style.display = 'none';
      await this.refreshQuotes();
      this.render.render(this.state.current);
      this.render.toast(wasInAllGroups ? '该股票已在所选分组中' : (existed ? '已加入新分组' : '已添加 ' + code));
    } catch (e) {
      this.render.toast(e.message || '操作失败，请重试');
    }
  },

  // ===== 移动到分组 =====
  openMoveModal() {
    this.render.openMoveModal(this.state.current);
  },

  submitMove() {
    return this.withMutationLock(`move:${this.state.current.currentGroupId}`, () =>
      this.withDisabledButton('move-confirm', () => this._submitMove())
    );
  },

  async _submitMove() {
    const selected = [...document.querySelectorAll('#move-group-list .group-chip.selected')];
    if (!selected.length) { this.render.toast('请选择目标分组'); return; }
    // 过滤掉当前分组（移动到当前所在分组是无意义操作，且会导致 manualOrder/pinned 丢失）
    const target = selected.map(c => c.dataset.groupId).filter(id => id !== this.state.current.currentGroupId);
    if (!target.length) { this.render.toast('请选择其他分组（非当前分组）'); return; }
    try {
      const result = await Bridge.send('storage:moveStocks', {
        codes: [...this.state.current.selected],
        fromGroup: this.state.current.currentGroupId,
        toGroups: target
      });
      this.state.current.watchlist = result.watchlist;
      document.getElementById('move-modal').style.display = 'none';
      this.state.current.selected.clear();
      this.state.current.batchMode = false;
      this.render.render(this.state.current);
      this.render.toast('已移动');
    } catch (e) {
      this.render.toast(e.message || '操作失败，请重试');
    }
  },

  // ===== 删除 / 选择 / 置顶 =====
  removeStocks(codes) {
    const groupId = this.state.current.currentGroupId;
    return this.withMutationLock(`remove:${groupId}`, () =>
      this.withDisabledButton('batch-remove', () => this._removeStocks(codes))
    );
  },

  async _removeStocks(codes) {
    const gid = this.state.current.currentGroupId;
    const isAll = gid === 'g_all';
    const msg = isAll
      ? `确认从自选股彻底移除 ${codes.length} 只股票？`
      : `确认将 ${codes.length} 只股票移出当前分组？（仍保留在「全部」中）`;
    const ok = await this.render._confirm(msg, { title: '移除确认', okText: '移除' });
    if (!ok) return;
    try {
      const result = await Bridge.send('storage:removeStocks', { codes, groupId: gid });
      this.state.current.watchlist = result.watchlist;
      this.state.current.selected.clear();
      this.state.current.batchMode = false;
      this.render.render(this.state.current);
      this.render.toast(isAll ? '已移除' : '已移出分组');
    } catch (e) {
      this.render.toast(e.message || '操作失败，请重试');
    }
  },

  toggleSelect(code) {
    if (this.state.current.selected.has(code)) this.state.current.selected.delete(code);
    else this.state.current.selected.add(code);
    document.getElementById('batch-count').textContent = `已选 ${this.state.current.selected.size} 只`;
    this.render.renderBoard(this.state.current);
  },

  togglePin(code) {
    const groupId = this.state.current.currentGroupId;
    return this.withMutationLock(`pin:${groupId}:${code}`, () => this._togglePin(code));
  },

  async _togglePin(code) {
    const gid = this.state.current.currentGroupId;
    try {
      const result = await Bridge.send('storage:togglePin', { groupId: gid, code });
      this.state.current.watchlist = result.watchlist;
      // 置顶/取消置顶后重算 manualOrder，切换分区的股票排到目标分区末尾
      await this._rebalanceManualOrder(gid, code);
      this.render.renderBoard(this.state.current);
    } catch (e) {
      this.render.toast(e.message || '操作失败，请重试');
    }
  },

  // 置顶/取消置顶后重算 manualOrder：置顶区和非置顶区各自从 0 连续编号
  // toggledCode 对应的股票移到目标分区末尾
  async _rebalanceManualOrder(gid, toggledCode) {
    const stocks = StockUtils.getStocksForGroup(this.state.current.watchlist, gid);
    // 按已有 manualOrder 排序，保持用户已排好的顺序
    stocks.sort((a, b) => {
      const oa = (a.manualOrder && a.manualOrder[gid]) ?? 9999;
      const ob = (b.manualOrder && b.manualOrder[gid]) ?? 9999;
      return oa - ob;
    });
    const pinned = stocks.filter(s => s.pinned && s.pinned[gid]);
    const nonPinned = stocks.filter(s => !(s.pinned && s.pinned[gid]));
    // 将刚切换分区的股票移到目标分区末尾
    if (toggledCode) {
      const inPinned = pinned.findIndex(s => s.code === toggledCode);
      const inNonPinned = nonPinned.findIndex(s => s.code === toggledCode);
      if (inPinned >= 0) {
        const [item] = pinned.splice(inPinned, 1);
        pinned.push(item);
      } else if (inNonPinned >= 0) {
        const [item] = nonPinned.splice(inNonPinned, 1);
        nonPinned.push(item);
      }
    }
    const orderMap = {};
    pinned.forEach((s, i) => { orderMap[s.code] = i; });
    nonPinned.forEach((s, i) => { orderMap[s.code] = i; });
    try {
      const result = await Bridge.send('storage:setManualOrder', { groupId: gid, orderMap });
      this.state.current.watchlist = result.watchlist;
    } catch (e) {
      this.render.toast(e.message || '操作失败，请重试');
    }
  },

  manualReorder(srcCode, dstCode) {
    const groupId = this.state.current.currentGroupId;
    return this.withMutationLock(`reorder:${groupId}`, () => this._manualReorder(srcCode, dstCode));
  },

  async _manualReorder(srcCode, dstCode) {
    const gid = this.state.current.currentGroupId;
    const stocks = this.render.getGroupStocks(this.state.current);
    const ids = stocks.map(s => s.code);
    const from = ids.indexOf(srcCode), to = ids.indexOf(dstCode);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    // 置顶/非置顶分区独立编号，避免跨区拖拽后排序错乱
    // 排序时先按 pinned 分区，再按 manualOrder 排，因此两个区各自从 0 开始即可
    const orderMap = {};
    let pinnedIdx = 0, nonPinnedIdx = 0;
    ids.forEach(code => {
      const s = this.state.current.watchlist.find(x => x.code === code);
      const isPinned = s && s.pinned && s.pinned[gid];
      if (isPinned) {
        orderMap[code] = pinnedIdx++;
      } else {
        orderMap[code] = nonPinnedIdx++;
      }
    });
    try {
      const reorderResult = await Bridge.send('storage:setManualOrder', { groupId: gid, orderMap });
      // 刷新 state.watchlist，使 getGroupStocks 读取到最新 manualOrder，避免拖拽视觉不生效
      this.state.current.watchlist = reorderResult.watchlist;
      this.state.current.sortField = 'manual';
      this.render.applySortSelect(this.state.current);
      await this.persistBoardPatch(gid, { sortField: 'manual' });
      this.render.renderBoard(this.state.current);
    } catch (e) {
      this.render.toast(e.message || '操作失败，请重试');
    }
  },

  // ===== 视图切换 =====
  async switchView(mode) {
    this.state.current.viewMode = mode;
    await this.persistBoardPatch(this.state.current.currentGroupId, { viewMode: mode });
    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(mode === 'grid' ? 'btn-view-grid' : 'btn-view-list').classList.add('active');
    this.render.renderBoard(this.state.current);
  },

  // ===== 排序 =====
  async onSortSelectChange(val) {
    if (val === 'manual') {
      this.state.current.sortField = 'manual';
      this.state.current.sortDirection = 'desc';
    } else {
      const [field, dir] = val.split('-');
      this.state.current.sortField = field;
      this.state.current.sortDirection = dir;
    }
    await this.persistBoardPatch(this.state.current.currentGroupId, {
      sortField: this.state.current.sortField,
      sortDirection: this.state.current.sortDirection
    });
    this.render.renderBoard(this.state.current);
  },

  async sortByField(field) {
    if (this.state.current.sortField === field) {
      this.state.current.sortDirection = this.state.current.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.state.current.sortField = field;
      this.state.current.sortDirection = 'desc';
    }
    this.render.applySortSelect(this.state.current);
    await this.persistBoardPatch(this.state.current.currentGroupId, {
      sortField: this.state.current.sortField,
      sortDirection: this.state.current.sortDirection
    });
    this.render.renderBoard(this.state.current);
  },

  // ===== 搜索 =====
  onSearch(val) {
    this.state.current.searchKeyword = val.trim();
    this.render.renderBoard(this.state.current);
  },

  // ===== 价格隐藏 =====
  async togglePriceHidden() {
    this.state.current.priceHidden = !this.state.current.priceHidden;
    const btn = document.getElementById('btn-toggle-price');
    btn.textContent = this.state.current.priceHidden ? '🚫' : '👁';
    btn.title = this.state.current.priceHidden ? '显示价格' : '隐藏价格';
    btn.classList.toggle('active', this.state.current.priceHidden);
    await this.persistBoardPatch(this.state.current.currentGroupId, { priceHidden: this.state.current.priceHidden });
    this.render.renderBoard(this.state.current);
  },

  // ===== 列配置 =====
  toggleColPanel() {
    this.render.toggleColPanel(this.state.current);
  },

  async toggleColumn(field, checked) {
    if (checked) {
      if (!this.state.current.columns.includes(field)) this.state.current.columns.push(field);
      // 同步维护 columnOrder：新字段追加到末尾，确保 renderList 能命中
      if (!this.state.current.columnOrder.includes(field)) this.state.current.columnOrder.push(field);
    } else {
      if (this.state.current.columns.length <= 1) { this.render.toast('至少保留 1 个字段'); this.render.renderColPanel(this.state.current); return; }
      this.state.current.columns = this.state.current.columns.filter(c => c !== field);
    }
    await this.persistBoardPatch(this.state.current.currentGroupId, {
      columns: this.state.current.columns,
      columnOrder: this.state.current.columnOrder
    });
    this.render.renderBoard(this.state.current);
  },

  async reorderColumns(src, dst) {
    const order = [...this.state.current.columnOrder];
    const from = order.indexOf(src), to = order.indexOf(dst);
    if (from < 0 || to < 0) return;
    order.splice(to, 0, order.splice(from, 1)[0]);
    this.state.current.columnOrder = order;
    await this.persistBoardPatch(this.state.current.currentGroupId, { columnOrder: order });
    this.render.renderColPanel(this.state.current);
    this.render.renderBoard(this.state.current);
  },

  // ===== 批量模式 =====
  toggleBatchMode() {
    this.state.current.batchMode = !this.state.current.batchMode;
    if (!this.state.current.batchMode) this.state.current.selected.clear();
    document.getElementById('btn-edit').classList.toggle('active', this.state.current.batchMode);
    document.getElementById('batch-bar').style.display = this.state.current.batchMode ? 'flex' : 'none';
    document.getElementById('batch-count').textContent = `已选 ${this.state.current.selected.size} 只`;
    this.render.renderBoard(this.state.current);
  },

  // ===== 看板配置持久化（Storage 内部串行化）=====
  async persistBoardPatch(groupId, patch) {
    try {
      await Bridge.send('storage:saveBoardConfig', { groupId, patch });
      this.state.current.boardConfig[groupId] = {
        ...(this.state.current.boardConfig[groupId] || {}),
        ...patch
      };
      return true;
    } catch (error) {
      console.warn('[popup] board config save failed:', error.message);
      this.render.toast('设置保存失败，请重试');
      return false;
    }
  },

  // ===== 事件绑定 =====
  bindEvents() {
    // 头部按钮
    document.getElementById('btn-add-stock').onclick = () => this.openAddModal();
    document.getElementById('btn-edit').onclick = () => this.toggleBatchMode();
    document.getElementById('btn-toggle-price').onclick = () => this.togglePriceHidden();
    document.getElementById('btn-new-group').onclick = () => this.openGroupModal('create');
    // 手动刷新行情
    document.getElementById('btn-refresh').onclick = () => this.manualRefresh();
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
        const stillExists = this.state.current.groups.some(g => g.groupId === modal.dataset.groupId);
        if (!stillExists) modal.style.display = 'none';
      }
    };
    // 移动弹层：关闭/取消/确认
    document.getElementById('move-close').onclick = () => { document.getElementById('move-modal').style.display = 'none'; };
    document.getElementById('move-cancel').onclick = () => { document.getElementById('move-modal').style.display = 'none'; };
    document.getElementById('move-confirm').onclick = () => this.submitMove();
    // 批量操作
    document.getElementById('batch-move').onclick = () => this.openMoveModal();
    document.getElementById('batch-remove').onclick = () => this.removeStocks([...this.state.current.selected]);
    document.getElementById('batch-cancel').onclick = () => this.toggleBatchMode();
    // 点击外部关闭卡片操作菜单
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.grid-card-more') && !e.target.closest('.card-menu')) {
        document.querySelectorAll('.card-menu.show').forEach(m => m.classList.remove('show'));
      }
    });
    // 回车确认
    document.getElementById('add-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.submitAddStock(); });
    document.getElementById('add-code').addEventListener('input', (e) => this.render.renderCodeSuggest(e.target.value));
    document.getElementById('add-code').addEventListener('blur', () => {
      setTimeout(() => { document.getElementById('code-suggest').style.display = 'none'; }, 150);
    });
    document.getElementById('add-code').addEventListener('focus', (e) => this.render.renderCodeSuggest(e.target.value));
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
  },

  cleanup() {
    if (this._quoteTimer) { clearTimeout(this._quoteTimer); this._quoteTimer = null; }
    if (this._timeTimer) { clearInterval(this._timeTimer); this._timeTimer = null; }
  }
};

if (typeof module !== 'undefined') module.exports = Actions;
