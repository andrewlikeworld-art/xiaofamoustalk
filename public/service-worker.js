/* Xiaofamous Talk · Service Worker
 * 策略:
 *   - app shell (HTML/CSS/JS/manifest/icons): stale-while-revalidate
 *   - /uploads/* (用户上传图片): cache-first,最多 200 条
 *   - /api/*: 直通网络,不缓存
 *   - 导航失败 → /offline.html
 */

const CACHE_VERSION = 'v1-2026-05-08';
const SHELL_CACHE = `shell-${CACHE_VERSION}`;
const UPLOADS_CACHE = `uploads-${CACHE_VERSION}`;
const UPLOADS_MAX_ENTRIES = 200;

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/js/compress.js',
  '/js/pwa.js',
  '/manifest.webmanifest',
  '/offline.html',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon.svg',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !k.endsWith(CACHE_VERSION))
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.headers.has('range')) return;

  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/admin')) return;

  if (url.pathname.startsWith('/uploads/')) {
    event.respondWith(cacheFirst(req, UPLOADS_CACHE));
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(navigationHandler(req));
    return;
  }

  if (isShellAsset(url.pathname)) {
    event.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
    return;
  }
});

function isShellAsset(pathname) {
  return (
    pathname === '/' ||
    pathname === '/index.html' ||
    pathname === '/style.css' ||
    pathname === '/app.js' ||
    pathname === '/manifest.webmanifest' ||
    pathname === '/offline.html' ||
    pathname.startsWith('/icons/') ||
    pathname.startsWith('/js/')
  );
}

async function navigationHandler(req) {
  try {
    const fresh = await fetch(req);
    const cache = await caches.open(SHELL_CACHE);
    cache.put('/index.html', fresh.clone()).catch(() => {});
    return fresh;
  } catch (_e) {
    const cached = await caches.match('/index.html');
    if (cached) return cached;
    return caches.match('/offline.html');
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req).then((res) => {
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  }).catch(() => cached);
  return cached || network;
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) {
    trimCache(cacheName, UPLOADS_MAX_ENTRIES);
    return cached;
  }
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      cache.put(req, res.clone()).catch(() => {});
      trimCache(cacheName, UPLOADS_MAX_ENTRIES);
    }
    return res;
  } catch (e) {
    return cached || Response.error();
  }
}

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  for (let i = 0; i < keys.length - maxEntries; i++) {
    await cache.delete(keys[i]);
  }
}
