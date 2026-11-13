// Offline: appka se uloží do cache. Nová verze čeká, dokud ji uživatel v appce nepotvrdí.
const VERSION = 8;
const CACHE = 'tlak-v' + VERSION;
const SHELL = ['./', 'index.html', 'seg7.js', 'manifest.webmanifest', 'icon.svg'];
self.addEventListener('install', e => e.waitUntil(
  caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))));
self.addEventListener('message', e => { if (e.data === 'skip') self.skipWaiting(); });
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
});
