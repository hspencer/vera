// Service worker de Vera.
//
// Aquí se cachea el armazón: lo que hace que Vera abra sin red. Nada más.
//
// Ninguna lectura del grafo pasa por este caché, y ahora que Vera sí lee sin
// servidor conviene decir por qué, porque parece una omisión y no lo es. Un
// caché de service worker no sabe si hay red: contesta con lo que tiene y no
// hay forma de que quien pregunta se entere de que la respuesta es de ayer. Lo
// retenido de las páginas leídas vive en IndexedDB —ver `src/held.ts`— y sólo
// se consulta cuando la petición al servidor falla de verdad, así que con red
// se lee lo que el corpus dice ahora y sin red se lee lo de la última vez,
// dicho. Cachear `/pages` aquí volvería a lo de antes: datos viejos servidos
// como si fueran de ahora, sin nadie a quien preguntarle.
//
// Escribir tampoco pasa por aquí. `/operations` sale por la bandeja durable de
// `src/outbox.ts`, que reintenta cuando vuelve la red.

// Subir este número tira el caché anterior entero al activarse. Hace falta
// cuando lo guardado deja de ser válido, y no sólo cuando cambia esta lista.
// v6 reemplaza también los iconos anteriores por la familia nocturna.
// v5 tiraba lo guardado por v4, que incluía respuestas de `/ontology` y de las
// demás lecturas que la regla de abajo dejaba caer en el caché por descuido.
const SHELL = 'vera-shell-v6';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon-16.png',
  '/icon-32.png',
  '/icon-192.png',
  '/favicon.ico',
];

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

  /*
   * De aquí abajo se cachea, y por eso sólo pasa lo que es un archivo.
   *
   * Era al revés: una lista de rutas que había que dejar escapar a la red
   * —`/operations`, `/pages`, `/graph`, `/search`, `/ops`, `/health`— y todo lo
   * demás caía en el caché. Una lista así se queda corta el día que aparece una
   * lectura nueva, y no avisa: se sirve la respuesta de la última vez y la
   * aplicación dibuja datos viejos como si fueran de ahora.
   *
   * Pasó con `/ontology`, que es la lectura que más cambia —la ontología se
   * edita como cualquier otra página— y quedó guardada: poner una propiedad
   * ofrecía el vocabulario de la sesión anterior, y el propio comentario de
   * `api.ontology` decía que eso era justamente lo que no debía ocurrir.
   * `/services`, `/special-pages`, `/workspace` y las historias de bloque
   * estaban en el mismo caso.
   *
   * Invertido no hay lista que mantener: un archivo se reconoce por llevar
   * extensión y una lectura del grafo no la lleva. Lo que el servidor añada
   * mañana va a la red por no llamarse `.svg`, que es la respuesta correcta por
   * omisión. Las dos excepciones van arriba y a propósito: la navegación,
   * porque `/p/2026-08-09` tampoco tiene extensión y su armazón sí se guarda, y
   * lo direccionado por contenido, porque un hash ya dice que no va a cambiar.
   */
  /*
   * Lo que lleva su huella en la ruta se sirve del caché sin preguntar.
   *
   * `/build/index-BMdgMbJP.css` no puede cambiar de contenido sin cambiar de
   * nombre, y `/media/<hash>` tampoco: una copia guardada nunca es una versión
   * equivocada. Va antes que la comprobación de abajo porque una grabación se
   * pide por su hash y sin extensión, y es justamente lo que más conviene tener
   * guardado: un audio de dos minutos que ya se descargó una vez.
   */
  if (url.pathname.startsWith('/build/') || url.pathname.startsWith('/media/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) => hit ?? fetch(request).then((response) => keep(request, response)),
      ),
    );
    return;
  }

  if (!/\.[a-z0-9]{2,8}$/i.test(url.pathname)) return;

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
