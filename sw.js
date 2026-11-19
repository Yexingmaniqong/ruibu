/* Service Worker：离线缓存，装到桌面后断网也能打开 */
var CACHE = 'ruibu-v1.0.3';
var ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/db.js',
  './js/store.js',
  './js/canvas.js',
  './js/ui.js',
  './js/render.js',
  './js/ai.js',
  './js/app.js',
  './manifest.json',
  './icon.svg',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png'
];

/* 代码类资源：网络优先，保证改动立刻生效；离线时回退缓存 */
function isCode(url) {
  return /\.(html|css|js|json)$/i.test(url.pathname) || url.pathname.endsWith('/');
}

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.addAll(ASSETS).catch(function () { /* 个别失败不阻塞 */ });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  // 同步接口一律走网络，不能被缓存
  if (url.pathname.indexOf('/api/') === 0) return;

  // 页面导航：网络优先，离线回退缓存
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put('./index.html', copy); });
        return res;
      }).catch(function () {
        return caches.match('./index.html');
      })
    );
    return;
  }

  // 代码类资源：网络优先，失败回退缓存
  if (isCode(url)) {
    e.respondWith(
      fetch(e.request).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(e.request).then(function (hit) {
          return hit || caches.match('./index.html');
        });
      })
    );
    return;
  }

  // 图标等静态资源：缓存优先
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      if (hit) return hit;
      return fetch(e.request).then(function (res) {
        try {
          if (res && res.status === 200) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
          }
        } catch (err) { /* ignore */ }
        return res;
      });
    })
  );
});
