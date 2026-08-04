// Service worker de Vera.
//
// v0 sólo hace instalable la aplicación y cachea su propio armazón. El ciclo
// offline real —cola local de operaciones y reconciliación— es la fase
// siguiente, y por eso aquí NO se cachea ninguna respuesta de /operations ni de
// las lecturas del grafo: servir grafo viejo sin poder escribir sería peor que
// decir que no hay red.

// Subir este número tira el caché anterior entero al activarse. Hace falta
// cuando lo guardado deja de ser válido, y no sólo cuando cambia esta lista.
const SHELL = 'vera-shell-v4';
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

  // `?fresh` es la aplicación preguntando qué versión sirve el servidor ahora
  // mismo. Contestarla desde el caché sería contestarse a sí misma: diría
  // siempre que la versión en curso es la vigente, que es justo lo que la
  // pregunta trata de averiguar. Va a la red sin pasar por aquí, y no se guarda.
  if (url.searchParams.has('fresh')) return;

  // El documento va primero a la red. Cachearlo de entrada dejaba servido un
  // index.html viejo que pedía assets con hash ya inexistentes: la aplicación
  // quedaba en blanco después de cada build hasta borrar el caché a mano.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // El armazón se guarda SIEMPRE bajo la misma clave. Guardarlo sólo
          // bajo la URL pedida dejaba `/index.html` con la copia del día de la
          // instalación para siempre, y era justo esa la que se servía al caer
          // la red: un index viejo pidiendo assets con hash ya inexistentes.
          // La aplicación quedaba en blanco ante cualquier hipo del servidor.
          if (response.ok) {
            const copy = response.clone();
            void caches.open(SHELL).then((cache) => cache.put('/index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('/index.html').then((hit) => hit ?? caches.match('/'))),
    );
    return;
  }

  // Lo compilado lleva huella en la ruta: `/build/index-BMdgMbJP.css` no puede
  // cambiar de contenido sin cambiar de nombre, así que una copia guardada
  // nunca es una versión equivocada y se sirve sin preguntar.
  if (url.pathname.startsWith('/build/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) => hit ?? fetch(request).then((response) => keep(request, response)),
      ),
    );
    return;
  }

  // El resto —iconos, fuentes, el manifiesto, los SVG de `public/`— conserva su
  // nombre entre versiones. Servirlo del caché sin más lo congela para siempre:
  // era el caso de los iconos de la interfaz, que una vez guardados no volvían
  // a pedirse aunque el archivo cambiara.
  //
  // Se responde con la copia si la hay —rápido, y sirve sin red— y se pide la
  // nueva en paralelo para la próxima vez. Una versión de retraso como mucho,
  // en vez de ninguna versión nunca.
  event.respondWith(
    caches.match(request).then((hit) => {
      const fresh = fetch(request).then((response) => keep(request, response));
      // Sin copia guardada no hay nada que ofrecer si la red falla: el error
      // tiene que llegar tal cual. Con copia, el fallo de la red no es asunto
      // de nadie —ya se respondió— pero se recoge para no dejarlo suelto.
      if (hit === undefined) return fresh;
      void fresh.catch(() => undefined);
      return hit;
    }),
  );
});
