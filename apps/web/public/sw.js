// virtuallyView service worker. It only caches the app shell so the app opens from the home screen.
// Media, the API and anything with a Range header are never touched: the browser handles them as normal.
// Bump CACHE when the shell logic changes. Hashed /assets files never change, so they stay cached.
const CACHE = 'vv-shell-v1';
const SHELL = ['/', '/index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

// Remove caches from older versions so old code does not linger.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
  );
});

function isApi(url) {
  return url.pathname === '/api' || url.pathname.startsWith('/api/');
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  // Range requests are how players seek. Never answer or cache them.
  if (request.headers.has('range')) return;
  if (request.destination === 'video' || request.destination === 'audio' || request.destination === 'track') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isApi(url)) return;

  // Pages: try the network first so a new release shows up, and fall back to the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put('/index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('/index.html').then((hit) => hit || caches.match('/')))
    );
    return;
  }

  // Hashed build files: serve from cache, and fetch once if missing.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((hit) => {
        if (hit) return hit;
        return fetch(request).then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      })
    );
  }
});
