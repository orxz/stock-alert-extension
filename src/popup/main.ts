// v2 popup 最小 shell：隐藏 fatal-fallback，展示「v2 架构升级中」占位（纯 textContent，无 innerHTML）。
// CSP 禁止内联 onclick，reload 按钮使用事件绑定。
const reloadButton = document.getElementById('btn-reload');
reloadButton?.addEventListener('click', () => location.reload());

const fallback = document.getElementById('fatal-fallback');
if (fallback) fallback.hidden = true;

const app = document.getElementById('stock-app');
if (app) {
  app.hidden = false;
  app.textContent = 'v2 架构升级中';
}
