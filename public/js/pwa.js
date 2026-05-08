/* PWA: Service Worker 注册 + iOS「添加到主屏」引导 */
(function () {
  'use strict';

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker
        .register('/service-worker.js', { scope: '/' })
        .catch(function (err) {
          console.warn('[pwa] SW register failed:', err);
        });
    });
  }

  var DISMISS_KEY = 'a2hs-dismissed-v1';
  var DISMISS_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 天内不再提

  function isIOS() {
    return /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.MSStream;
  }

  function isStandalone() {
    return (
      window.matchMedia && window.matchMedia('(display-mode: standalone)').matches
    ) || window.navigator.standalone === true;
  }

  function isSafariOnIOS() {
    var ua = navigator.userAgent;
    if (!isIOS()) return false;
    // 排除 Chrome (CriOS) / Firefox (FxiOS) / Edge (EdgiOS) on iOS — 它们都不支持 A2HS
    if (/CriOS|FxiOS|EdgiOS/.test(ua)) return false;
    return /Safari/.test(ua);
  }

  function dismissed() {
    try {
      var raw = localStorage.getItem(DISMISS_KEY);
      if (!raw) return false;
      var ts = parseInt(raw, 10);
      if (!ts) return false;
      return Date.now() - ts < DISMISS_TTL_MS;
    } catch (_e) {
      return false;
    }
  }

  function markDismissed() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch (_e) {}
  }

  function showA2HSBanner() {
    if (document.getElementById('a2hs-banner')) return;

    var banner = document.createElement('div');
    banner.id = 'a2hs-banner';
    banner.innerHTML =
      '<div class="a2hs-inner">' +
        '<div class="a2hs-icon">' +
          '<img src="/icons/icon-192.png" alt="" width="44" height="44" />' +
        '</div>' +
        '<div class="a2hs-text">' +
          '<div class="a2hs-title">把 Xiaofamous 添到主屏</div>' +
          '<div class="a2hs-hint">点底部 <span class="a2hs-share">⬆︎</span> 分享 → 添加到主屏幕</div>' +
        '</div>' +
        '<button type="button" class="a2hs-close" aria-label="关闭">×</button>' +
      '</div>';

    var style = document.createElement('style');
    style.textContent =
      '#a2hs-banner{position:fixed;left:12px;right:12px;bottom:max(12px,env(safe-area-inset-bottom));z-index:9999;' +
      'background:#fff;border:1px solid #ece7df;border-radius:14px;box-shadow:0 8px 24px rgba(20,14,5,.12);' +
      'padding:12px 14px;animation:a2hsIn .25s ease-out}' +
      '#a2hs-banner .a2hs-inner{display:flex;align-items:center;gap:12px}' +
      '#a2hs-banner .a2hs-icon img{display:block;border-radius:10px}' +
      '#a2hs-banner .a2hs-text{flex:1;min-width:0;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",sans-serif;color:#1f1d1a}' +
      '#a2hs-banner .a2hs-title{font-size:14px;font-weight:600;line-height:1.3}' +
      '#a2hs-banner .a2hs-hint{font-size:12px;color:#857f76;margin-top:2px}' +
      '#a2hs-banner .a2hs-share{display:inline-block;background:#fde7e3;color:#c94a3d;border-radius:4px;padding:0 4px;font-weight:600}' +
      '#a2hs-banner .a2hs-close{background:none;border:0;color:#857f76;font-size:22px;line-height:1;padding:4px 8px;cursor:pointer}' +
      '@keyframes a2hsIn{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}';
    document.head.appendChild(style);
    document.body.appendChild(banner);

    banner.querySelector('.a2hs-close').addEventListener('click', function () {
      markDismissed();
      banner.remove();
    });
  }

  function maybePromptA2HS() {
    if (isStandalone()) return;
    if (!isSafariOnIOS()) return;
    if (dismissed()) return;
    setTimeout(showA2HSBanner, 4000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maybePromptA2HS);
  } else {
    maybePromptA2HS();
  }
})();
