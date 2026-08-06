const CACHE = 'peach-todo-v11';
const ASSETS = ['./', './index.html', './styles.css', './app.js', './manifest.json', './icon-192.png', './icon-512.png', './icon-180.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.map(k => {
        if (k !== CACHE) { return caches.delete(k); }
      })
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Network-first for HTML and JS/CSS (so updates take effect immediately)
  if (e.request.mode === 'navigate' ||
      e.request.destination === 'script' ||
      e.request.destination === 'style') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
    );
    return;
  }
  // Cache-first for static assets (images, manifest)
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
