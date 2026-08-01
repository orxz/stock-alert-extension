// popup.js — 入口：初始化 State，绑定 Actions，订阅 Render
//
// 仅负责启动顺序与生命周期：拉取初始数据 → 绑定事件/订阅 → 首屏渲染 →
// 首次行情刷新 → 调度下一次刷新 → 注册卸载清理。所有逻辑分散在：
//   - popup-state.js   视图状态
//   - popup-render.js  DOM 渲染
//   - popup-actions.js 用户操作

async function init() {
  try {
    await State.init();
    Actions.bind(State, Render);
    Render.subscribe(State);
    Render.applySortSelect(State.current);
    Render.render(State.current);
    Render.updateQuoteStatus(State.current);
    Render.updateTimeLabel(State.current);
    await Actions.refreshQuotes();
    Render.renderBoard(State.current);
    Actions.scheduleNextRefresh();
  } catch (e) {
    console.error('[popup.init] failed:', e);
    // 即使初始化失败，也尝试渲染空看板而非白屏
    try {
      if (typeof document !== 'undefined') {
        Render.toast('初始化失败，请重新打开');
      }
    } catch (_) {}
  }
  // 每秒更新「x秒前」时间显示
  Actions._timeTimer = setInterval(() => Render.updateTimeLabel(State.current), 1000);
  // popup 关闭时清除定时器，防止后续访问已销毁的 DOM
  window.addEventListener('beforeunload', () => Actions.cleanup());
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', init);
}
