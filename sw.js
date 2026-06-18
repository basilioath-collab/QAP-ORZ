const ORIZON_CACHE = 'orizon-static-v13-emergency-open';

self.addEventListener('install', (event) => {
  // Assume controle imediatamente para substituir service workers/cache antigos
  // que podem deixar o aplicativo preso em uma tela de carregamento.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // Modo emergência: sempre buscar a versão atual na rede. Isso impede que um
  // HTML antigo em cache mantenha o app em loading/travado após uma publicação.
  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      })
  );
});
