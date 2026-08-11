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

## 4. El bloqueador, y que es más pequeño de lo que parece

Un cliente que aplica un cambio antes de enviarlo necesita saber cómo se llama lo
que ese cambio crea. Hoy no puede: el identificador lo acuña el servidor y viaja
en la respuesta, así que crear un bloque obliga a esperar. Siete sitios del
cliente dependen de ese `subjectId` de vuelta.

Lo que hace pequeño el bloqueador es que el dominio **ya lo admite**:

```ts
// packages/core/src/graph.ts:474
const subjectId = this.#apply(input.change, input.subjectId ?? null, at);
```

Quien envía puede traer la identidad, y el importador ya lo hace para conservar
la de Logseq. Lo único que falta es que el paso por HTTP no la tire:
`readOperation` (`server.ts:293`) no la lee.

Hay dos decisiones dentro, y son de la spec y no del código:

1. **Qué forma tiene una identidad acuñada en el cliente.** Tiene que ser
   irrepetible sin coordinación, y tiene que distinguirse —o no— de las que
   acuñó el servidor.
2. **Quién puede acuñarla.** Aceptar cualquier `subjectId` de cualquiera es dejar
   que alguien escriba encima de un bloque existente diciendo que lo está
   creando. La regla mínima es que sólo vale para cambios que crean, y sólo si
   nada lleva ya ese nombre.

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

### Paso 0 — la identidad la acuña quien crea

`readOperation` acepta `subjectId` para los cambios que crean, y sólo si está
libre. El cliente lo acuña. Desbloquea los siete sitios que hoy esperan la
respuesta para saber el nombre de lo que crearon.

### Paso 1 — el árbol local

El cliente sostiene un `VeraGraph` de la página abierta y le aplica el cambio.
Redibuja desde ahí. Mueren los 34 `onReload()`.

### Paso 2 — el envío deja de bloquear

`submit()` devuelve en cuanto el cambio está aplicado localmente. La red pasa a
segundo plano.

### Paso 3 — la bandeja durable

Lo pendiente cae en IndexedDB antes de decir «guardado», y se drena en orden.
Sobrevive a cerrar la pestaña. Es lo que hace verdad el indicador.

### Paso 4 — el cursor y lo que llega

`canonical_cursor` por réplica, `GET /ops?since=` en segundo plano, y aplicar lo
que llegue sin recargar.

### Paso 5 — los conflictos

Exponer la divergencia en vez de elegir en silencio, y las tres resoluciones que
la spec nombra.

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
