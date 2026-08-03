// v2 background 最小 shell：同步安装 no-op listener，保证 Service Worker 加载无 console error。
chrome.runtime.onMessage.addListener((_message, _sender, _sendResponse) => {
  // no-op：Task 4+ 接入消息路由。
  return false;
});

chrome.alarms.onAlarm.addListener((_alarm) => {
  // no-op：Task 4+ 接入行情刷新调度。
});
