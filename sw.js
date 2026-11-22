// Lock In offline support: always tries the network first (so updates show up),
// and falls back to the saved copy when you're offline or the gym Wi-Fi is bad.
const CACHE = 'lockin-v1';
const ASSETS = ['./', './index.html', './app.js', './library.js', './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    try {
      const res = await Promise.race([
        fetch(req),
        new Promise((_, reject) => setTimeout(() => reject(new Error('slow network')), 4000))
      ]);
      if (res && res.ok) {
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone());
      }
      return res;
    } catch (e) {
      const hit = await caches.match(req, { ignoreSearch: true });
      return hit || caches.match('./index.html');
    }
  })());
});
