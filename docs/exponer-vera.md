# Exponer Vera

Tres modos de estar alcanzable, qué exige cada uno, y por qué el que casi todo el
mundo quiere no necesita autenticar a nadie.

> Estado al escribirlo: rama `v0.4-local-first`, `allium check specs/` en 0
> errores y 10 avisos sobre 33 specs. Vera corre en modo **privado**; los otros
> dos modos no están construidos y este documento dice exactamente qué falta de
> cada uno.

---

## Los tres modos

| | Quién llega | Qué ve | Qué exige |
| --- | --- | --- | --- |
| **1. Privado** | tus dispositivos de la tailnet | Vera entera, escribiendo | nada: la red *es* la autenticación |
| **2. Público de lectura** | cualquiera, sin entrar | sólo lo marcado público | **ningún sign-on** |
| **3. Público de acceso** | quien tenga cuenta | Vera entera, escribiendo | identidad de personas, completa |

El 2 no es una versión aguada del 3. Es otra cosa: una **proyección** del corpus
—un sitio que se genera desde el grafo— sin sesión, sin login y sin camino de
escritura. Está especificado en
[`personal-site-projection.allium`](../specs/personal-site-projection.allium), y
su invariante rector lo fija:

> `@invariant SameCorpus` — todo documento público se proyecta desde una página
> del grafo. El sitio no mantiene una copia canónica independiente.

El 3 es publicar **Vera misma**: la aplicación y su API, con gente entrando.
Está especificado en
[`identity-access.allium`](../specs/identity-access.allium), con seis preguntas
todavía abiertas.

---

## Modo 1 — privado (dónde estamos)

Vera escucha en loopback (`VERA_HOST`, por omisión `127.0.0.1`) y
`tailscale serve` la publica **sólo dentro de la tailnet**. Quien alcanza el
puerto es un dispositivo con tu clave.

Sobre eso descansa una decisión que conviene mirar de frente: **quien alcanza el
puerto es el dueño**. Sin credencial, Vera te da el grafo entero, con permiso de
escribir y de borrar. En `packages/server/src/server.ts:752` al leer, y en
`packages/server/src/server.ts:245` al escribir.

No es un descuido —es lo que hoy es cierto en casa, y el registro lo anota como
lo que es, una lectura sin credencial— pero tiene una consecuencia:

**Tailscale no es una capa más de defensa. Es la única que hay.**

De ahí que el servidor avise al arrancar si lo pones a escuchar fuera de
loopback, y de ahí las tres maneras de perder el corpus con un solo comando: un
`tailscale funnel` de más, un `VERA_HOST=0.0.0.0` para una demostración, o un
dispositivo de la tailnet comprometido.

La spec ya dice que esto debe cambiar, con nombre propio:

> `@invariant NobodyIsAssumed` — una petición sin credencial participa como
> nadie. Vera no adivina que quien la alcanzó tiene que ser el dueño: *«en una
> red de cualquier tamaño esa suposición entrega el grafo a quien más esté en
> ella, y una memoria soberana que cualquiera puede escribir no es soberana.»*

Escrito, sin construir. El plan está en
[plan-nadie-por-omision.md](plan-nadie-por-omision.md), y es prerrequisito de los
dos modos siguientes.

---

## Modo 2 — público de lectura

Un sitio que cualquiera puede leer, con lo que tú decidas publicar. **Cero
sign-on: no hay a quién autenticar.**

### Primer corte ejecutable en v0.5

Vera ya puede generar una salida HTML estática separada del espejo Markdown:

```sh
npm run project:public -- data/vera.sqlite ../vera-public https://vera.mediafranca.net \
  --page page:123 --page page:456
```

La salida contiene portada y una carpeta por página publicada explícitamente en
ese sitio. Una página meramente visible no entra: `vera.mediafranca.net` es el
sitio oficial del proyecto Vera, no el sitio personal de Herbert ni un agregado
de sus otros proyectos. No contiene base,
API, manifiesto reconstruible ni identificadores de página o bloque. Reutiliza
el renderer Markdown de Vera, declara una URL canónica y se detiene si dos
títulos producirían la misma ruta. Este primer corte toma la visibilidad como
frontera; antes de desplegarlo falta conectarlo a la operación humana explícita
de publicación y a una revisión visible de la salida.

### Lo que falta

**a) Que `visibility` mande.** Hoy cada página nace `'private'`
(`server.ts:592`) y ese campo **no filtra ni una sola lectura**. `/pages`,
`/search`, `/graph` y `/query` devuelven todo. Las tablas `publications` y
`personal_sites` están en el esquema desde hace tiempo y **no las lee ni las
escribe nadie**.

Publicar tiene que ser una operación como cualquier otra —con autoría, fecha y
sitio en el registro—, porque «quién publicó esto y cuándo» es exactamente la
clase de pregunta que Vera existe para contestar.

**b) Un camino de lectura separado, y no un filtro añadido.** Éste es el punto
importante de todo el documento.

Si lo resuelves poniendo `WHERE visibility = 'public'` en los endpoints que ya
hay, el día que añadas el endpoint número treinta y cuatro se te olvida, y el
fallo no avisa: filtra. Tiene que **denegar por omisión**, o sea una superficie
que sólo sabe leer lo público y es incapaz de expresar la otra consulta.

Es la misma lección que ya se aprendió una vez en este repositorio, en el
`sw.js`: una lista de rutas que había que dejar escapar del caché se quedó corta
en cuanto apareció una lectura nueva, y hubo que invertirla. Una lista de lo que
se permite envejece mal; una regla sobre la forma de la cosa, no.

**c) Y por eso: la forma más segura es estática.** Generar HTML y servir
archivos. Entonces la cara pública no tiene base de datos, ni API, ni proceso de
Node, ni sesiones: no hay superficie que atacar, y toda la lista de endurecimiento
del modo 3 desaparece de golpe. El `@invariant ReproducibleOutput` de la spec ya
empuja hacia ahí —«la misma revisión produce salida equivalente
independientemente de la tecnología de despliegue»—.

**d) Lo demás ya está especificado**: URL canónica estable
(`CanonicalAddress`), metadatos HTML, notas al pie que sobreviven a la
proyección, citas en el estilo que elija quien lee, y URLs históricas
preservadas al migrar el sitio anterior.

**e) La fuga clásica: el índice de búsqueda.** La spec la nombra aparte
—`SearchReturnsOnlyPublicPages`— porque es el error que se comete incluso
habiendo filtrado bien las páginas: se publica un índice construido sobre el
corpus entero y los extractos cuentan lo que la página oculta no dejaba ver.

### Requisitos de seguridad

Casi ninguno, y ése es el argumento entero a favor de este modo. Con proyección
estática: TLS (Funnel o cualquier alojamiento lo da), y nada más. Sin proceso no
hay autenticación, ni sesiones, ni límites de tasa, ni credenciales que rotar.

---

## Modo 3 — público de acceso

Vera misma en una URL pública, con gente entrando. Esto sí es caro.

### Identidad de personas

La forma ya está decidida en la spec, y la decisión importa: **una persona se
autentica con la misma credencial que un agente**. No por comodidad, sino para
que Vera no tenga dos nociones de quién escribe —«y el sentido entero de la
frontera de autoría es que haya exactamente una»—. Una credencial prueba *quién*,
no *cómo*: el canal sale de qué clase de participante nombra, así que una persona
que escribe con credencial sigue escribiendo, no generando.

Lo que la spec **no** ha respondido son seis preguntas, y ninguna es un detalle
de implementación:

1. ¿Cómo autoriza, identifica y revoca el dueño a cada agente?
2. ¿Dónde vive la credencial de una persona entre visita y visita —el navegador,
   un gestor de contraseñas, el llavero de la máquina— y qué cuesta cada una
   cuando el navegador no es el suyo?
3. ¿Caduca la de una persona, dado que la de un agente no? ¿Una memoria de la que
   te echan cada mes sigue sintiéndose tuya?
4. ¿Los permisos de un colaborador son por rol, por capacidad, o concedidos uno a
   uno por operación y recurso?
5. ¿Cuándo expira una sesión, y qué pasa con las operaciones pendientes de un
   agente después de revocarlo?
6. ¿Cómo recupera el dueño la propiedad si pierde todas las credenciales?

La sexta ya tiene respuesta, y de ella sale un requisito duro:

> `@invariant TheMachineIsTheLastResort` — quien tiene la máquina se emite una
> credencial, sin credencial, desde la máquina. Es la raíz de confianza de una
> instancia soberana: el corpus vive en un disco que su dueño sostiene, y ninguna
> credencial puede interponerse entre los dos. *«Y es también la razón por la que
> la instancia no debe ser alcanzable de esa manera desde una red.»*

O sea: **exposición y recuperación no pueden confundirse**. El camino de rescate
no es una ruta HTTP: abre la base desde la máquina. Un túnel inverso ejecutado en
Alexei también llega al servidor por loopback, de modo que el socket no basta
para distinguir a quien está sentado delante de una petición que vino de fuera.

### Tres superficies, no una puerta enorme

La versión soberana para la web separa el despliegue por propósito:

| Superficie | Audiencia | Autoridad |
| --- | --- | --- |
| `vera.mediafranca.net` | cualquiera | sólo la proyección de páginas públicas |
| aplicación viva | personas autenticadas | lectura y escritura según su credencial |
| MCP remoto | inteligencias y clientes autorizados | herramientas y recursos según su credencial |

Pueden compartir un túnel y una implementación, pero no una política. La
proyección pública nunca consulta el corpus privado; la aplicación requiere una
sesión humana; MCP usa OAuth o una credencial de máquina y conserva identidad,
alcance y exposición en cada llamada.

### Endurecimiento del transporte

Nada de esto existe hoy. Lo que la propia página de la puerta MCP ya enumera,
más lo que exige un login:

| | |
| --- | --- |
| **Sesiones** | cookie, expiración, cierre, rotación |
| **TLS** | y HSTS. Funnel lo da; un proxy propio hay que configurarlo |
| **Origen y host** | validados exactamente, no por prefijo |
| **DNS rebinding** | comprobación de `Host` contra lo esperado |
| **CORS** | restrictivo, no `*` |
| **Límites** | por identidad, por ruta, por tamaño de cuerpo |
| **Fuerza bruta** | bloqueo progresivo en la ruta de entrada |

### Requisitos de despliegue

- **Node sigue en loopback.** `VERA_HOST=0.0.0.0` no es cómo se publica esto. El
  frente es un proxy inverso; el servidor no se entera de que hay internet.
- **Nunca publicar `/`.** Lista blanca de rutas en el proxy. Sin ella quedan en
  internet `POST /operations`, `/agents/credentials`, `/exposures` —el registro
  de quién leyó qué, que es material sensible por sí solo— y `/services/…`, por
  donde se administran las claves de terceros.
- **Respaldos y plan de incidente** dejan de ser opcionales. Mientras es privado,
  perder el disco es un problema tuyo; en público, un compromiso es un problema
  de todos los que aparecen escritos en el corpus.
- **Las dependencias pasan a tener calendario.** Node y todo lo demás se
  actualizan porque hay alguien mirando, no cuando toque.

---

## Qué conviene hacer

**El modo 2, y no el 3.**

Lo que ganas haciendo visible tu memoria es que otros **lean** lo que decides
publicar, y eso no necesita autenticar a nadie. El modo 3 sólo compra «escribo
desde un computador prestado», que la tailnet ya da en cualquier equipo propio, a
cambio de un sistema de identidad entero con seis preguntas de diseño sin
responder y años de corpus al otro lado.

Dicho de otro modo: el modo 2 pone en internet **lo que elegiste**; el modo 3
pone en internet **la puerta de todo**, y confía en que la cerradura sea buena.

**Y una cosa ahora, mientras sigues privado:** cerrar `NobodyIsAssumed`. Que sin
credencial no se sea nadie, con la salida por la máquina para no quedar fuera.
Elimina las tres maneras de perder el corpus con un solo comando, y es
prerrequisito de los dos modos públicos, así que no es trabajo desviado. El plan
está en [plan-nadie-por-omision.md](plan-nadie-por-omision.md).

### El orden

1. `NobodyIsAssumed` + la salida por la máquina. *Sigues privado.*
2. Que publicar sea una operación, y `visibility` filtre de verdad.
3. La proyección estática: HTML, URL canónica, metadatos, notas al pie, citas.
4. Búsqueda pública construida **sólo** sobre lo público.
5. Publicar los archivos. *Ya estás en el modo 2.*
6. — y sólo si algún día hace falta — las seis preguntas del modo 3.

Los pasos 1 a 4 no exponen nada. El único paso que cambia quién puede llegar es
el 5, y para entonces lo que se expone son archivos.

---

## Ver también

- [`specs/identity-access.allium`](../specs/identity-access.allium) — cómo se
  autentica una persona, y las seis preguntas abiertas.
- [`specs/personal-site-projection.allium`](../specs/personal-site-projection.allium)
  — el sitio público.
- [plan-nadie-por-omision.md](plan-nadie-por-omision.md) — el paso 1, medido.
- [conectar-una-ia.md](conectar-una-ia.md) — la puerta MCP, que tiene su propia
  versión de esta misma pregunta.
- [portabilidad.md](portabilidad.md) — levantar la instancia y exponerla con
  Tailscale.
