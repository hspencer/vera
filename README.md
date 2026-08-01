# Vera

Vera es una memoria personal soberana y asistida: un grafo de conocimiento
legible, versionado y publicable, al que personas y agentes acceden como pares
mediante contratos comunes.

Este repositorio comienza por la especificación conductual. La implementación
se elegirá después de aclarar qué debe hacer el sistema y qué garantías debe
preservar.

## Decisiones iniciales

- Herbert, Cotito y futuros agentes son participantes del sistema. Ninguno
  escribe por una vía privilegiada o secreta.
- Los clientes humanos y agentes solicitan operaciones semánticas a Vera; Vera
  valida, aplica y registra esas operaciones.
- Cada cambio conserva procedencia: participante, canal, instante y evidencia
  de origen cuando existe.
- Una contribución de voz autenticada es canónica respecto de su autoría: Vera
  puede afirmar que Herbert la dijo. Esto no convierte automáticamente su
  contenido en una verdad factual.
- Git conserva historia, respaldo y transporte del corpus. No define por sí
  solo la colaboración interactiva entre clientes.
- con§tel es la referencia inicial para navegación y visualización del grafo,
  no una restricción sobre el modelo interno de Vera.

## Referencias locales

- `../mind` — corpus personal actual y fuente de migración.
- `../logseq` — comportamiento editorial que Vera debe estudiar, no forkear.
- `../logseq-constel` — vista dividida, navegación y visualización de referencia.
- `../constel` — exploración posterior de análisis de corpus y persistencia
  textual.

## Especificaciones

- [`specs/core.allium`](specs/core.allium) — identidad horizontal, procedencia,
  cambios del grafo y publicación selectiva.

## Estado

Esqueleto de descubrimiento. La especificación contiene preguntas abiertas de
producto deliberadas; todavía no prescribe framework, base de datos, protocolo
ni formato físico del corpus.
