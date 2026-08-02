# Vera

**Vera** — _versionable, editable, replicable y auditable_.

Vera es una memoria personal soberana: un corpus versionado y distribuido,
habitado por personas y agentes, con procedencia explícita y publicación
selectiva. Reúne en un mismo grafo el PKM cotidiano, la investigación, los
medios nativos y la publicación personal. Personas y agentes participan
mediante los mismos contratos, con identidad y permisos explícitos.

> **Estado:** el primer recorrido completo está construido y corre sobre el
> corpus real. Las otras siete specs siguen sin implementar. Vera es hoy una
> aplicación usable para un solo grafo, no un producto terminado.

## El núcleo

El primer recorrido completo de Vera es el de un PKM basado en bloques:

1. importar un grafo de archivos Markdown;
2. navegar páginas y bloques;
3. editar y guardar contenido;
4. mantener identidad estable de los bloques aunque se editen o muevan;
5. actualizar links, backlinks, tags y propiedades;
6. buscar y ejecutar queries sobre el grafo;
7. registrar la procedencia de cada cambio.

Los siete pasos están hechos. Sobre el corpus de `../mind` —1001 páginas,
44 390 bloques, 49 364 operaciones— la instancia importa, navega, edita, busca,
proyecta a Markdown y responde `[]` a la verificación de invariantes.

La base local es la fuente canónica del grafo. Markdown es una proyección limpia,
portable y versionable: no se insertan UUID técnicos en cada bloque. Este modelo
parte del comportamiento moderno de Logseq, destilado en una especificación
propia.

## Lo que hace distinta a Vera

- **Audio nativo.** Conserva el audio original, lo reproduce, transcribe y enlaza
  con una transcripción corregible. La transcripción participa en búsquedas y
  relaciones sin suplantar la fuente oral.
- **Hipermedia preservable.** Markdown, imágenes, PDF, SVG, Mermaid y sketches
  JavaScript conservan su fuente editable además de su representación.
- **Ontología curada.** Tags libres conviven con tipos componibles y propiedades
  controladas. Vera sugiere clasificaciones; un curador las confirma y Herbert
  mantiene la autoridad final.
- **Grafo aglutinador.** Sistemas especializados, inicialmente Zotero, proyectan
  sus entidades en Vera sin perder identidad ni procedencia. Zotero sigue siendo
  la autoridad bibliográfica y la sincronización inicial es unidireccional.
- **Participación humano–agente.** Herbert, Cotito y futuros agentes operan por
  el mismo contrato. No existe una puerta trasera editorial para los agentes.
- **Publicación desde el corpus.** El sitio personal es una vista selectiva del
  mismo grafo, con autorización humana, URLs históricas estables, búsqueda, SEO
  y RSS; no un segundo corpus que mantener.
- **Soberanía operativa.** Base, archivos y servicios pueden vivir en hardware
  propio, con formatos y respaldos migrables.

La comparación razonada con Logseq, Obsidian, Roam Research y SilverBullet está
en [docs/benchmark.md](docs/benchmark.md). No sostiene que Vera sea hoy un
producto superior: explica por qué su **diseño objetivo** cubre mejor este caso
de uso particular.

La propuesta de implementación completa está en
[docs/architecture.md](docs/architecture.md). Se mantiene separada de las specs:
Allium define el comportamiento; la arquitectura registra una forma revisable
de implementarlo.

## Principios ya acordados

- Cada cambio conserva participante, canal, instante y evidencia de origen
  cuando existe.
- La voz autenticada prueba autoría, no verdad factual.
- Git conserva historia, respaldo y transporte; no coordina por sí solo la
  colaboración interactiva.
- Sólo el propietario humano autoriza publicación pública.
- Una página o bloque puede combinar varios tipos semánticos componibles.
- Las sugerencias ontológicas requieren confirmación; no se aplican solas.
- Las URLs públicas históricas de `herbertspencer.net` se preservan exactamente.
- Las fuentes originales nunca son reemplazadas destructivamente por derivados.

## Especificaciones

Las cinco que sostienen el primer recorrido, y que ya tienen implementación:

- [`core.allium`](specs/core.allium) — participantes, páginas, bloques,
  procedencia, revisiones y publicación selectiva.
- [`change-application.allium`](specs/change-application.allium) — cómo un
  cambio aceptado se vuelve estado durable y ordenado: identidad de operación,
  reenvío idempotente, orden total y reproducción del registro.
- [`graph-navigation.allium`](specs/graph-navigation.allium) — links y tags
  derivados del contenido, backlinks y vecindades acotadas por profundidad.
- [`query-language.allium`](specs/query-language.allium) — qué puede expresar
  una query de Vera y qué selecciona del grafo.
- [`search-index.allium`](specs/search-index.allium) — qué encuentra la búsqueda
  de texto libre, cómo ordena y qué extracto justifica cada hallazgo.

Las siete restantes, todavía sin implementación:

- [`logseq-block-identity-reference.allium`](specs/logseq-block-identity-reference.allium)
  — identidad estable de bloques y proyección Markdown limpia.
- [`content-media.allium`](specs/content-media.allium) — contenido hipermedia
  nativo y preservación de fuentes.
- [`workspace-interface.allium`](specs/workspace-interface.allium) — navegación,
  vistas, búsqueda, queries y temas.
- [`controlled-ontology.allium`](specs/controlled-ontology.allium) — tipos
  componibles y curaduría semántica.
- [`bibliographic-integration.allium`](specs/bibliographic-integration.allium) —
  agregación unidireccional desde Zotero.
- [`personal-site-projection.allium`](specs/personal-site-projection.allium) —
  proyección pública y migración del sitio histórico.
- [`identity-access.allium`](specs/identity-access.allium) — instancias,
  credenciales y alcance de los permisos.

Las specs son válidas pero no están completas. Sus preguntas abiertas son parte
del trabajo de elicitación, no defectos que deban ocultarse.

## Implementación

Un monorepo de npm workspaces, en TypeScript, sin paso de build fuera de la PWA:

| Paquete | Qué es |
| --- | --- |
| `@vera/core` | dominio puro: tipos, reglas e invariantes derivados de las specs |
| `@vera/store` | SQLite canónico, registro de operaciones y proyección Markdown |
| `@vera/importer` | ingesta de un grafo Logseq, con reporte explícito de pérdida |
| `@vera/server` | API HTTP local sobre el `node:http` de la biblioteca estándar |
| `@vera/web` | el espacio de trabajo: outliner, grafo 2D y 3D, búsqueda, PWA |

`operations` es el registro canónico; las tablas de estado son su
materialización y los índices derivados son reconstruibles. Nada fuera de
`submitOperation()` escribe en ellas.

```sh
npm install
npm run typecheck                    # tsc --noEmit, raíz y PWA
npm test                             # 184 tests, node --test, sin build
npm run spec                         # allium check specs/
npm run import -- ../mind            # ingesta del corpus
npm run build                        # la PWA a packages/web/dist
npm run serve                        # http://localhost:4173
```

El servidor sirve la PWA ya construida, así que `build` va antes de `serve`.
Para desarrollo, `npm run dev --workspace @vera/web` levanta Vite aparte.

La cobertura de pruebas y, sobre todo, lo que **no** cubre está en
[docs/test-obligations.md](docs/test-obligations.md).

## Referencias locales

- `../mind` — corpus actual y fuente principal de migración.
- `../logseq` — implementación de referencia para destilar comportamiento.
- `../logseq-constel` — navegación y visualización de referencia.
- `../hspencer.github.io` — sitio Jekyll histórico que Vera deberá proyectar.

## Método

Primero especificamos comportamiento y casos límite en Allium. Después elegimos
arquitectura e implementación. Las decisiones técnicas deben servir a las
garantías del producto, no sustituirlas.
