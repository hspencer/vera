# Plan: que la mano no espere

Estado al escribirlo: rama `v0.4-local-first`, `allium check specs/` limpio (0 errores,
32 specs), 904 pruebas en verde, árbol sin cambios sin confirmar.

Este documento existe porque `specs/offline-reconciliation.allium` describe
comportamiento que el código no tiene, y porque el hueco es lo bastante grande
como para que convenga saber por dónde se entra. Dice cuánto falta, de qué clase
es cada trozo, qué bloquea a qué, y qué no decide.

## 1. La medida

`allium plan specs/offline-reconciliation.allium` da **57 obligaciones**. Ninguna
tiene prueba hoy.

| Categoría | |
| --- | ---: |
| `rule_failure` | 18 |
| `rule_success` | 12 |
| `enum_comparable` | 5 |
| `invariant` | 5 |
| `entity_fields` | 4 |
| `contract_signature` | 3 |
| `entity_optional` | 3 |
| `entity_relationship` | 2 |
| `rule_entity_creation` | 2 |
| superficie (actor, exposición, provisión) | 3 |

Y la medida que importa, tomada sobre la instancia real:

- Leer una página cuesta **125 ms y 62 KB**, en loopback.
- El cliente hace eso **34 veces**: `onReload()` en `outliner.ts` vuelve a pedir
  la página entera y la redibuja. Cada Enter, cada Tab, cada bloque nuevo.
- Desde otro equipo por la tailnet, a esos 125 ms se les suma el viaje.

## 2. El hallazgo que cambia el tamaño del problema

**`@vera/core` no tiene una sola dependencia de `node:`.** El dominio entero
—`VeraGraph`, sus reglas, sus invariantes— es puro y corre en un navegador sin
tocar nada.

Eso quiere decir que la réplica local no hay que escribirla. El cliente puede
sostener un `VeraGraph` de verdad y aplicarle los cambios con las mismas reglas
con que los aplica el servidor: las mismas negativas, la misma identidad estable,
el mismo orden. No hay una segunda implementación del dominio que pueda divergir
de la primera, que es el modo habitual en que un local-first se pudre.

Lo que queda por escribir no es el modelo: es el camino entre el gesto y el
modelo, y entre el modelo y el registro canónico.

## 3. Dos clases de deuda

### Contradicción — el código hace lo que la spec ahora prohíbe

| # | Sitio | Contradicción |
| --- | --- | --- |
| C1 | `web/src/api.ts:723` | `submit()` espera la respuesta del servidor antes de que el gesto se complete. `@invariant TheHandNeverWaitsForTheNetwork` |
| C2 | `web/src/outliner.ts`, 34 sitios | cada cambio termina en `onReload()`, que es `GET /pages/:id` entero y un redibujado completo. `@invariant RenderingFollowsChangedMeaning` |
| C3 | `web/src/main.ts:100` | lo pendiente vive en un `Set` en memoria; sin red el indicador dice «lo escrito sigue en el editor, pero aún no está guardado», y cerrar la pestaña ahí lo pierde. `@invariant LocalDurabilityPrecedesSavedFeedback` |
| C4 | `server/src/server.ts:293` | `readOperation` descarta `subjectId`, así que el cliente no puede saber cómo se llama lo que acaba de crear sin preguntarlo. |
| C5 | `web/public/sw.js:5` | no se cachea ninguna lectura del grafo, y su comentario lo dice: «el ciclo offline real es la fase siguiente». Ésta es la fase siguiente. |

C3 merece una nota porque es la que miente. Los otros cuatro son lentitud; éste
es un mensaje que dice que algo no está guardado cuando podría estarlo, y que no
distingue «guardado aquí, esperando a la red» de «perdido si cierras».

### Ausencia — la spec describe algo que no existe

`LocalReplica`, `PendingChange`, `Conflict`, `canonical_cursor`, el almacén
durable en el navegador y la resolución de conflictos. Cero líneas. No contradice
nada: falta.

## 4. El bloqueador que resultó no existir — *corregido al implementarlo*

Un cliente que aplica un cambio antes de enviarlo necesita saber cómo se llama lo
que ese cambio crea. Este plan dijo que no podía, y que había que abrir el paso
por HTTP. **Era falso, y la comprobación lo dijo enseguida**: `readOperation`
pasa el cambio entero sin mirarlo, así que un `create_block` con su `stableId`
dentro ya llegaba al dominio, que lo adopta y lo devuelve. `change-application.allium:189`
ya lo gobernaba, y el importador lo usaba desde el principio para conservar los
identificadores de Logseq.

Lo que sí faltaba era la mitad de eso, y en dos sentidos:

1. **Nada lo fijaba.** Funcionaba por omisión. Cualquier validación de forma que
   se añadiera a `readOperation` lo habría tirado sin que ninguna prueba se
   quejara.
2. **Una página no podía traer la suya.** `create_block` la admitía y
   `create_page` no, y la asimetría no se había decidido: al bloque le hacía
   falta para la importación y a la página no le hizo falta hasta ahora. Crear
   una página era el único gesto que obligaba a esperar a la red, y un solo gesto
   que espera basta para que la promesa no se cumpla.

Ambas cosas están cerradas en el paso 0.

## 5. Lo que ya está puesto y no se está usando

- **`GET /ops?since=N`** (`server.ts:3485`) devuelve las operaciones posteriores a
  una secuencia, con su `originId`, su `subjectId` y su autor. Es el transporte
  que `rule PullOperationsAfterCursor` necesita, entero, sin un cliente que lo
  llame.
- **El indicador de sincronización** (`main.ts:100`) ya tiene los cuatro estados
  y su sitio en la interfaz. Lo que le falta es que lo pendiente sea durable.
- **`@invariant OriginIdentityIsTheIdempotencyKey`** ya está implementado y
  probado: reenviar no aplica dos veces. Es lo que hace seguro reintentar, y por
  tanto lo que hace posible una bandeja de salida.

## 6. Los pasos

Cada uno es entregable por su cuenta, deja el árbol verde, y no obliga al
siguiente.

### Paso 0 — la identidad la acuña quien crea — **hecho**

Una página puede traer la suya, como ya podía un bloque, y sólo vale si está
libre. Seis pruebas lo fijan de punta a punta por HTTP, incluida la de que
reenviar el mismo origen no crea un segundo bloque con otro nombre —que es lo que
hará segura la bandeja de salida del paso 3—.

### Paso 1 — el árbol local — **hecho**

El cliente sostiene un `VeraGraph` de la página abierta y le aplica el cambio;
`onReload` redibuja desde ahí en vez de volver a pedir la página. Los 34 sitios
siguen llamándolo y ninguno viaja.

### Paso 2 — el envío deja de bloquear — **hecho**

`submit()` devuelve en cuanto el cambio está aplicado en casa, y el viaje ocurre
sin que nadie lo espere. Salió con el paso 1 porque son la misma cosa vista desde
los dos lados: aplicar en casa es lo que permite no esperar, y no esperar es
para lo que se aplica en casa.

Lo que faltaba y no estaba en este plan: **bautizar en el cliente lo que se
crea**. Sin eso la réplica y el servidor le ponen nombres distintos al mismo
bloque y lo que se escriba después se pierde. No lo encontró ninguna prueba: lo
encontró abrir el navegador.

### Paso 3 — la bandeja durable — **hecho**

Lo pendiente cae en IndexedDB antes de que se anuncie como guardado, y se drena
en orden, de uno en uno. Sobrevive a cerrar la pestaña; lo que se quedó a medio
mandar vuelve a estar sólo aplicado aquí, porque reenviarlo es inocuo. Lo
rechazado se queda con su motivo en vez de desaparecer.

Comprobado en el navegador: escrito sin servidor, guardado en IndexedDB,
recuperado al volver la red y aplicado al corpus en su orden.

**Dos límites que este paso no levanta, y conviene tenerlos escritos:**

- **Sin servidor, la aplicación no abre.** Lo escrito está a salvo, pero leer
  sigue siendo server-first: al recargar sin red se ve «no se pudo hablar con el
  servidor» y nada más. *Levantado después: ver «Leer sin servidor» en el
  ROADMAP. Lo que quedó en pie, y no se vio hasta medirlo, es que leer con un
  servidor **lento** sigue esperando — el paso 3½.*
- **La primera escritura de un día necesita red.** Nace con un `create_page`, que
  la réplica difiere porque toca enlaces que una página sola no tiene. Sin
  servidor, ese primer gesto no ocurre.

### Paso 3½ — la medida que faltaba, tomada tarde

Los pasos 1 a 3 quitaron la espera de **escribir** y la de **abrir sin
servidor**. No quitaron la de **leer con un servidor lento**, y nadie lo había
medido. Con el corpus real:

| | tiempo | bytes |
| --- | ---: | ---: |
| abrir *Magnifica Humanitas* (1.147 bloques) | 0,81 s | **512 KB** |
| abrir *Lombardi — Grafo de Eventos Federado* | 0,71 s | 314 KB |
| preguntar «¿qué cambió desde mi cursor?» (últimas 20 operaciones) | **0,003 s** | **3,8 KB** |

Y el hallazgo: **no hay lectura condicional en ninguna parte**. Ni ETag, ni
`If-None-Match`, ni «¿sigue valiendo lo mío?». `openPage()` pide la página entera
cada vez. Haberla visitado cincuenta veces no ahorra un byte, y lo retenido en
IndexedDB sólo se consulta en el `catch` — es decir, nunca, mientras el servidor
conteste. Tres capas hacen lo mismo: `sw.js:71` para el documento, `loadPages()`
para el índice, `openPage()` para la página.

Lo cual contradice una garantía que llevaba escrita desde el principio:
`@guarantee LocalFirstMeansFirst` — *«The local replica is not a cache consulted
when the server is slow»*—. La implementación siguió a la regla de debajo, que
exigía lo contrario.

### Paso 4 — lo retenido primero, y el botón que avisa — *especificado*

Decidido el 11 de agosto de 2026, y escrito en `offline-reconciliation.allium`:

1. Una página que este aparato ya tuvo **se dibuja desde aquí, al instante**,
   conteste o no el servidor. `rule ShowRetainedPageAtOnce`.
2. Detrás, la pregunta barata: `GET /ops?since=<cursor>`.
   `rule PullOperationsAfterCursor` — que ahora **no aplica nada**, sólo anota.
3. Si hay algo esperando, **el indicador cambia y espera a que lo pulsen**.
   `rule AnnounceWaitingCanonicalWork`, con dos estados: algo se movió en el
   corpus, y algo se movió *en esta página*.
4. Lo toma el dueño. `rule TakeWaitingCanonicalWork`. Lo que no choca se aplica;
   lo que choca abre el diálogo.

La razón de que no se aplique solo es que **otra mano escribe en este corpus**.
Un agente bibliotecario puede reescribir una página mientras se lee, y sólo hay
tres cosas que se pueden hacer: cambiar el texto bajo los ojos de quien lee —que
no es sincronizar sino interrumpir—, callarlo —que es lo único que
`SilenceNeverPretendsToBeSuccess` prohíbe—, o decirlo y dejar que el dueño elija
cuándo. Cuesta un botón.

De ahí se sigue que una página se pueda leer sabiéndola desactualizada, y eso es
la función y no un defecto tolerado.

### Paso 5 — el desacuerdo se resuelve por bloque — *especificado*

Donde dos manos escribieron el mismo bloque, se enseñan las dos versiones con las
líneas que difieren marcadas, y se elige una —o se escribe una tercera—.

**El bloque y no la línea**: es lo único de lo que Vera tiene identidad. Mezclar
línea a línea produce un texto que no escribió ninguna de las dos manos, en un
bloque cuya autoría ya no se puede afirmar, en un corpus donde saber qué mano
escribió qué es justamente el asunto. Las líneas se enseñan porque elegir entre
dos versiones sin ver en qué difieren es elegir a ciegas.

## 7. Lo que este plan no decide

Las seis preguntas abiertas de la spec siguen abiertas, y tres de ellas muerden
antes de terminar:

- Cuánto de un corpus de 1.972 páginas y 46.899 bloques se replica en un teléfono,
  y qué hay disponible antes de terminar de hidratarse. Muerde en el paso 4.
- Qué pasa con lo pendiente cuando la credencial caduca con el aparato sin red.
- Qué camino de recuperación conserva lo pendiente cuando el almacén local está
  lleno, no disponible o corrupto.

Las otras tres —presupuestos de latencia, qué se borra al cerrar sesión, y qué
cambios sobre el mismo sujeto se pueden fundir solos— no bloquean estos pasos.
