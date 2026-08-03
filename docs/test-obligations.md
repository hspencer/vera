# Obligaciones de prueba de v0

Derivadas con `allium plan` de las cinco specs que componen el primer recorrido usable.
Este documento es de trazabilidad: dice qué cubre la suite y, sobre todo, qué **no**.

## Recuento por spec

| Spec | Obligaciones |
| --- | ---: |
| `core.allium` | 76 |
| `change-application.allium` | 67 |
| `query-language.allium` | 40 |
| `graph-navigation.allium` | 31 |
| `search-index.allium` | 26 |
| **Total v0** | **240** |

Por categoría: `rule_failure` 68, `invariant` 44, `entity_fields` 23, `entity_optional` 22,
`rule_success` 22, `entity_relationship` 12, `sum_type_variant` 9, `enum_comparable` 7,
`rule_entity_creation` 7, `contract_signature` 7, `surface_actor` 6, `surface_exposure` 6,
`surface_provides` 5, `value_equality` 1, `derived` 1.

Las otras siete specs suman 262 obligaciones más. Quedan fuera de v0 y sin tests.

## Qué hay escrito

184 tests en 36 bloques. 101 verifican obligaciones de las specs directamente,
sobre el dominio puro; los otros 83 cubren los bordes donde el dominio toca al
mundo —archivos, SQLite, HTTP, DOM— que las specs excluyen de su alcance.

Obligaciones de spec, en `packages/core/test/`:

| Archivo | Tests | Cubre |
| --- | ---: | --- |
| `change-application.test.ts` | 35 | identidad estable, idempotencia, orden total, replay, procedencia, precondiciones de reglas |
| `search-and-query.test.ts` | 26 | búsqueda, términos de consulta, composición, negación, queries Logseq sin portar |
| `graph-navigation.test.ts` | 21 | links derivados del contenido, backlinks, vecindad acotada |
| `core-model.test.ts` | 19 | enumeraciones, campos de entidad, visibilidad y publicación, superficies |

Bordes de implementación, fuera de `@vera/core`:

| Archivo | Tests | Cubre |
| --- | ---: | --- |
| `web/outliner.test.ts` | 17 | árbol de bloques, Markdown en línea, sesión de edición |
| `importer/import.test.ts` | 16 | ingesta de un grafo Logseq y reporte de pérdida |
| `server/server.test.ts` | 15 | rutas HTTP, códigos de error, idempotencia sobre el transporte |
| `importer/logseq.test.ts` | 14 | parseo del Markdown de origen |
| `store/store.test.ts` | 11 | registro canónico, materialización, reapertura de la base |
| `store/projection.test.ts` | 10 | determinismo de la proyección Markdown |

Se priorizaron las obligaciones que sostienen las garantías distintivas de Vera:

- `stable_id` sobrevive a editar, mover y renombrar la página — la prueba central
- una operación reenviada con el mismo `origin_id` no aplica dos veces ni consume secuencia
- las secuencias del log son únicas, crecientes y arrancan en 1
- reproducir el log desde cero reconstruye el mismo estado
- un link existe exactamente mientras lo diga el contenido del bloque que lo produjo

Muchas de estas son property-based con `fast-check` sobre secuencias de hasta 40
operaciones, y verifican `checkInvariants(graph)` después de cada corrida.

## Divergencias conocidas entre spec e implementación

- **La búsqueda no cubre los valores de propiedad.** `search-index.allium` declara
  `property_value` en `SearchableField` y su `@guarantee
  OneSearchReachesEverySearchableField` exige que una sola búsqueda cubra títulos,
  contenido y propiedades juntos. `searchStore()` consulta `pages_fts` y `blocks_fts`;
  no existe `properties_fts`. Son 3973 asignaciones de propiedad invisibles a la
  búsqueda en el corpus actual. Ningún test falla porque ninguno lo exige.
- **`audio_transcript`, el cuarto `SearchableField`, tampoco se indexa.** Esto sí es
  esperado: el audio pertenece a `content-media.allium`, fuera de v0.

## Qué falta, dicho explícitamente

- **139 obligaciones de v0 sin test.** El grueso son `rule_failure` de combinaciones de
  precondiciones que la interfaz no puede alcanzar, y `entity_fields` estructurales.
- **`contract_signature`**: los 7 contratos se ejercitan por comportamiento, no por firma.
  `packages/store` ya existe y sigue pendiente verificar que su implementación satisface
  la firma declarada, no sólo que se comporta bien.
- **Tests temporales**: ninguno. Las reglas de v0 usan `now` sólo como sello, y no hay
  disparadores temporales que exijan inyección de reloj.
- **Tests entre módulos**: `BlockContentSettled` y `PageRemoved` cruzan de
  `change-application` a `graph-navigation`. Se prueban a través del grafo en memoria; no
  hay todavía un fixture que cablee componentes reales.
- **Recorrido de punta a punta**: ningún test conduce la PWA contra el servidor contra la
  base. Los tres se prueban por separado. La verificación de que el conjunto funciona
  sobre el corpus real es hoy manual: importar, servir y pedir `GET /invariants`.
- **Las specs fuera de v0**: ontología, Zotero y sitio público. Sin cobertura y sin
  pretenderla.
- **La lectura por alcance**: `read` se emite, se lista y se devuelve en `whoami`, pero
  ninguna ruta de lectura lo exige todavía. Una credencial sólo de lectura no puede
  escribir —eso sí está probado— y puede leer, como puede leer cualquiera que alcance el
  puerto. El alcance describe la intención antes que la frontera.
- **La identidad humana**: sigue sin demostrarse. Quien llega sin credencial se toma por
  el dueño. Lo que las pruebas cubren es que esa vía no puede escribir como otro.

## Cómo correrlos

```sh
npm install
npm run typecheck    # tsc --noEmit, raíz y PWA
npm test             # node --test, sin paso de build
```

Los 360 pasan y el typecheck está limpio. `node --test` ejecuta TypeScript directamente:
no hay paso de compilación intermedio que pueda quedar desfasado del código.
