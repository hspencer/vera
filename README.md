# Vera

**Vera** — _versionable, editable, replicable y auditable_.

Vera es una memoria personal soberana: un corpus versionado y distribuido,
habitado por personas y agentes, con procedencia explícita y publicación
selectiva. Reúne en un mismo grafo el PKM cotidiano, la investigación, los
medios nativos y la publicación personal. Personas y agentes participan
mediante los mismos contratos, con identidad y permisos explícitos.

> **Estado:** Vera está en fase de especificación. Este repositorio describe el
> producto que queremos construir; todavía no constituye una aplicación usable.

## El núcleo

El primer recorrido completo de Vera será el de un PKM basado en bloques:

1. importar un grafo de archivos Markdown;
2. navegar páginas y bloques;
3. editar y guardar contenido;
4. mantener identidad estable de los bloques aunque se editen o muevan;
5. actualizar links, backlinks, tags y propiedades;
6. buscar y ejecutar queries sobre el grafo;
7. registrar la procedencia de cada cambio.

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

- [`core.allium`](specs/core.allium) — participantes, páginas, bloques,
  procedencia, revisiones y publicación selectiva.
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

Las specs son válidas pero no están completas. Sus preguntas abiertas son parte
del trabajo de elicitación, no defectos que deban ocultarse.

## Referencias locales

- `../mind` — corpus actual y fuente principal de migración.
- `../logseq` — implementación de referencia para destilar comportamiento.
- `../logseq-constel` — navegación y visualización de referencia.
- `../hspencer.github.io` — sitio Jekyll histórico que Vera deberá proyectar.

## Método

Primero especificamos comportamiento y casos límite en Allium. Después elegimos
arquitectura e implementación. Las decisiones técnicas deben servir a las
garantías del producto, no sustituirlas.
