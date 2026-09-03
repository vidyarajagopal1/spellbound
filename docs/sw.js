const CACHE_NAME = 'spellbound-v178';
const ASSETS = [
  '/',
  '/index.html',
  '/app.js?v=178',
  '/styles.css?v=178',
  '/logo-header.png',
  '/manifest.json',
  '/purify.min.js',
  'https://cdn.jsdelivr.net/npm/marked@9/marked.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(ASSETS.map(url =>
        fetch(url, { cache: 'reload' }).then(res => cache.put(url, res))
      ))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Let Google/Open Library API requests pass through uncached
  if (e.request.url.includes('googleapis.com') || e.request.url.includes('accounts.google.com') || e.request.url.includes('openlibrary.org')) {
    return;
  }
  // Always try the network first for the HTML shell so it never gets stuck
  // pointing at stale versioned asset URLs; fall back to cache when offline.
  const isHTML = e.request.mode === 'navigate' ||
    e.request.url.endsWith('/') || e.request.url.endsWith('/index.html');
  if (isHTML) {
    e.respondWith(
      fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, copy));
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
