/* Flex Solar — service worker do app instalado (PWA)
   Estratégia: tela e scripts vêm sempre da rede quando há internet (assim
   cada atualização no GitHub/Railway já aparece); a cópia guardada só é
   usada sem conexão. Os dados (/api) nunca são guardados no aparelho. */
const VERSAO = "flex-v23";
const ARQUIVOS = ["/", "/index.html", "/admin.js", "/operacao.js", "/config.js", "/manifest.webmanifest",
  "/flex-solar.jpg", "/icone-192.png", "/icone-512.png", "/solar-topo.jpg"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname === "/health") return;
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok) { const copia = r.clone(); caches.open(VERSAO).then(c => c.put(e.request, copia)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("/index.html")))
  );
});
