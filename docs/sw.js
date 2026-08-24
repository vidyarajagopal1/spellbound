const CACHE_NAME = 'spellbound-v116';
const ASSETS = [
  '/',
  '/index.html',
  '/app.js?v=116',
  '/styles.css?v=116',
  '/logo-header.png',
  '/manifest.json',
  '/purify.min.js',
  'https://cdn.jsdelivr.net/npm/marked@9/marked.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Let Google API requests pass through uncached
  if (e.request.url.includes('googleapis.com') || e.request.url.includes('accounts.google.com')) {
    return;
  }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
