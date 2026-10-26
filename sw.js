const CACHE = 'focusboard-v43';
const ASSETS = ['./index.html', './v2.html', './tempo.js', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  // HTML sempre pela rede primeiro — cache-first deixava o app travado
  // numa versão antiga mesmo depois de editar o arquivo.
  const isHtml = e.request.mode === 'navigate' || url.pathname.endsWith('.html');
  if (isHtml) {
    e.respondWith(
      fetch(e.request).then(resp => {
        const copy = resp.clone();
        if (resp.ok) caches.open(CACHE).then(c => c.put(e.request, copy));
        return resp;
      }).catch(() => caches.match(e.request).then(r => r || caches.match('./v2.html')))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
      const copy = resp.clone();
      if (resp.ok) caches.open(CACHE).then(c => c.put(e.request, copy));
      return resp;
    }).catch(() => caches.match('./v2.html')))
  );
});
