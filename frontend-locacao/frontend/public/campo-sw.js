// Service worker do app de campo.
// - Páginas e arquivos do app: tenta a rede primeiro (sempre a versão mais nova);
//   sem internet, abre a última versão guardada.
// - Dados (API no Railway, outro endereço): nunca guarda; vão sempre direto para a rede.
const CACHE = 'flex-campo-v1';
const SHELL = ['/campo', '/campo.webmanifest', '/campo-icon-192.png', '/campo-icon-512.png', '/logo.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if(req.method !== 'GET' || url.origin !== self.location.origin) return; // API e mapas: direto na rede
  e.respondWith(
    fetch(req)
      .then(res => {
        if(res.ok){ const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('/campo') : Response.error())))
  );
});
