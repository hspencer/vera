// Service worker de Vera.
//
// v0 sólo hace instalable la aplicación y cachea su propio armazón. El ciclo
// offline real —cola local de operaciones y reconciliación— es la fase
// siguiente, y por eso aquí NO se cachea ninguna respuesta de /operations ni de
// las lecturas del grafo: servir grafo viejo sin poder escribir sería peor que
// decir que no hay red.

const SHELL = 'vera-shell-v2';
const ASSETS = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== SHELL).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

/** Guardar una copia sin retrasar la respuesta que el navegador está esperando. */
function keep(request, response) {
  if (!response.ok) return response;
  const copy = response.clone();
  void caches.open(SHELL).then((cache) => cache.put(request, copy));
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  const isData =
    url.pathname.startsWith('/operations') ||
    url.pathname.startsWith('/pages') ||
    url.pathname.startsWith('/graph') ||
    url.pathname.startsWith('/search') ||
    url.pathname.startsWith('/ops') ||
    url.pathname.startsWith('/health');

  if (isData) return;

  // El documento va primero a la red. Cachearlo de entrada dejaba servido un
  // index.html viejo que pedía assets con hash ya inexistentes: la aplicación
  // quedaba en blanco después de cada build hasta borrar el caché a mano.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => keep(request, response))
        .catch(() => caches.match('/index.html').then((hit) => hit ?? caches.match('/'))),
    );
    return;
  }

  // Todo lo demás sí puede venir del caché: los assets llevan hash en el
  // nombre, así que una copia guardada nunca es una versión equivocada.
  event.respondWith(
    caches.match(request).then(
      (hit) => hit ?? fetch(request).then((response) => keep(request, response)),
    ),
  );
});
