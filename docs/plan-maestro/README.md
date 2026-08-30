# Plan maestro de Vera

Estado al escribirlo: 2026-08-30, rama `worktree-vera-repository-audit` sobre
`v0.6-federacion`. `allium check specs/` con 0 errores y 21 warnings sobre 38
specs; `npm test` con 1298/1298 en verde tras `npm run build`; `npm run
typecheck` limpio. Auditoría hecha por cuatro agentes de lectura (uno por
dominio) más lectura directa del corpus de Vera vía MCP. Nada de esto edita
código de producto ni specs: es un mapa, no una implementación.

Este directorio existe porque una auditoría de este tamaño no cabe en un solo
documento sin volverse ilegible, y porque cada pieza tiene un ritmo de cambio
distinto: la matriz de trazabilidad envejece con cada commit; el registro de
decisiones, con cada spec nueva; la cola priorizada, con cada rama que se abre.
Separarlas es lo que permite corregir una sin reescribir las demás.

## Qué hay aquí y qué no

**Esto no es el roadmap de producto.** El roadmap vive en el propio corpus de
Vera —[Vera — Roadmap de producto y desarrollo](https://vera.mediafranca.net/vera-roadmap-de-producto-y-desarrollo/),
mantenido por Cotito con fecha de revisión y checkboxes verificables— y
`docs/README.md` ya fija el criterio: la explicación de producto se corrige en
Vera y se publica una sola vez. Repetirla aquí produciría exactamente la
divergencia que este documento denuncia en otras partes (ver
[decisiones-y-preguntas-abiertas.md](decisiones-y-preguntas-abiertas.md), hallazgo
sobre cifras desactualizadas). Lo que este directorio aporta es la capa que
Vera no puede tener por sí sola: verificación línea por línea contra el código,
un plan de ejecución con criterios de aceptación técnicos, y un protocolo para
que varios agentes trabajen sin pisarse.

**Esto tampoco sustituye `docs/test-obligations.md` ni los `docs/plan-*.md`
existentes.** Son evidencia de la misma clase, escritos por quien tocó el
código en el momento de tocarlo. Este plan los cita y no los repite.

## Índice maestro — dónde está la fuente de verdad de cada dominio

| Dominio | Fuente de verdad | Naturaleza |
| --- | --- | --- |
| Visión, principios, postura ética | [Vera — Principios](https://vera.mediafranca.net/vera-principios/), [Postura ética](https://vera.mediafranca.net/vera-postura-etica/) | Corpus de Vera, editorial |
| Roadmap de producto por capacidades | [Vera — Roadmap de producto y desarrollo](https://vera.mediafranca.net/vera-roadmap-de-producto-y-desarrollo/) | Corpus de Vera, vigente, con fecha de revisión |
| Comportamiento exigible de cada capacidad | `specs/*.allium` (38 archivos) | Allium — manda sobre el código |
| Arquitectura de implementación | [`docs/architecture.md`](../architecture.md) | Repositorio |
| Cobertura y obligaciones de prueba | [`docs/test-obligations.md`](../test-obligations.md) | Repositorio — cifras desactualizadas, ver hallazgo E-7 |
| Exposición de red y modos públicos | [`docs/exponer-vera.md`](../exponer-vera.md) | Repositorio |
| Portabilidad e instalación | [`docs/portabilidad.md`](../portabilidad.md) | Repositorio |
| Conexión de agentes/IA vía MCP | [`docs/conectar-una-ia.md`](../conectar-una-ia.md), `packages/mcp/README.md` | Repositorio |
| Deuda técnica puntual ya medida | [`docs/plan-local-first.md`](../plan-local-first.md), [`plan-recorridos.md`](../plan-recorridos.md), [`plan-nadie-por-omision.md`](../plan-nadie-por-omision.md) | Repositorio, snapshots fechados |
| Proceso de contribución, ramas, PR, seguridad | [`CONTRIBUTING.md`](../../CONTRIBUTING.md), [`SECURITY.md`](../../SECURITY.md) | Repositorio |
| Autoría y licencia | [`AUTHORS.md`](../../AUTHORS.md), [`LICENCIA.md`](../../LICENCIA.md) | Repositorio |
| Configuración humana de Cotito | [[Cotito]], [[Cotito - SOUL]], [[Cotito - IDENTITY]], [[Cotito - USER]], [[Cotito - TOOLS]], [[Cotito - LOOP]] | Corpus de Vera — fuente canónica; OpenClaw aún no la deriva (ver fase 6) |
| Postulación FONDEF | [[Vera — FONDEF IDeA I+D 2027]] | Corpus de Vera, perfil en formulación — cifras técnicas desactualizadas, ver E-7 |

## Piezas de este plan maestro

- **[matriz-trazabilidad.md](matriz-trazabilidad.md)** — capacidad → spec →
  implementación → tests → estado → evidencia, para las 38 specs y las
  capacidades del roadmap. Es la pieza D del encargo.
- **[fase-1-local-first-sincronizacion.md](fase-1-local-first-sincronizacion.md)**
  — plan de ejecución detallado para el punto 1 (soberanía local-first, cola
  durable, reconciliación, conflictos) con objetivo observable, alcance,
  dependencias, specs, código afectado, pruebas de aceptación, riesgos y
  criterio de terminado; y esquemas del mismo formato para las fases 2 a 8.
  Es la pieza C.
- **[decisiones-y-preguntas-abiertas.md](decisiones-y-preguntas-abiertas.md)**
  — lo que esta auditoría encontró que Vera todavía no tiene registrado como
  pregunta abierta, más las preguntas ya declaradas en specs que bloquean la
  fase 1. Es la pieza E; no duplica ADR existentes.
- **[protocolo-agentes-contribuyentes.md](protocolo-agentes-contribuyentes.md)**
  — cómo reclamar una unidad de la cola, declarar archivos afectados, evitar
  colisiones entre agentes en paralelo, entregar evidencia y hacer handoff.
  Se apoya en `CONTRIBUTING.md` y sólo añade lo que falta: el protocolo de
  cola. Es la pieza F.
- **[cola-priorizada.md](cola-priorizada.md)** — unidades de trabajo pequeñas,
  independientes, con identidad estable, listas para tomarse. Es una
  fotografía al 2026-08-30, no un tablero de estado — igual que los
  `docs/plan-*.md` existentes, la autoridad sobre "¿está hecho?" es `make
  check` y el código, no esta lista. Es la pieza G.
- **[informe-final.md](informe-final.md)** — hechos verificados, inferencias,
  recomendaciones y decisiones que Herbert debe tomar, separados sin mezclar.
  Es la pieza H.

## Cómo se mantiene esto

Cuando el código cambie lo suficiente como para que la matriz o la cola
mientan, corríjelas en la misma rama que hizo el cambio — igual que un
`docs/plan-*.md` se corrige junto con el código que describe. Si una pieza
entera queda obsoleta (por ejemplo, cuando la fase 1 se cierre), no se borra:
se marca cerrada en su propio encabezado y se abre la siguiente, para que quien
llegue después pueda leer qué pasó y por qué, no sólo qué es cierto hoy.
