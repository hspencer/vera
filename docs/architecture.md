# Arquitectura tecnológica inicial

> **Estado:** propuesta inicial revisable. Las especificaciones Allium definen el
> comportamiento de Vera; este documento registra una implementación capaz de
> satisfacerlo sin convertir decisiones técnicas en requisitos del producto.

## Criterios

El stack debe favorecer una instancia soberana con un solo grafo, uso offline
desde varios dispositivos, Markdown portable, medios nativos, despliegue en un
Linux personal y una ruta de migración simple. La concurrencia masiva y el
multi-tenant no son objetivos de v0.

## Lenguaje y repositorio

- **TypeScript** en cliente, servidor y herramientas de importación/exportación.
- **Node.js LTS** como runtime del servidor.
- **pnpm workspaces** para un monorepo con aplicaciones y paquetes compartidos.

TypeScript permite reutilizar directamente componentes de `logseq-constel` y
compartir contratos, validación y tipos entre la PWA, la API y los procesos de
migración.

## PWA

- **React** y **Vite**.
- **vite-plugin-pwa/Workbox** para manifest, service worker, actualización y
  caché de la aplicación.
- **SQLite WASM**, ejecutado en un Web Worker y persistido con OPFS, para la
  copia local consultable del grafo y la cola de operaciones offline.
- **TanStack Query** para el estado remoto y la revalidación. La base local, no
  un store global de componentes, conserva el estado duradero.
- **CodeMirror 6** para edición Markdown y código.
- Componentes accesibles propios sobre primitivas de **Radix UI**, con tokens y
  custom properties CSS editables. No se adopta un tema visual prefabricado.

La interfaz aplica cambios optimistas a su SQLite local. Al recuperar conexión,
envía operaciones pendientes y recibe cambios posteriores a su último cursor.

## Servidor

- **Fastify** sobre Node.js para API HTTP, carga de archivos y canal de eventos.
- **TypeBox/JSON Schema** para validar contratos y generar OpenAPI.
- **WebSocket o Server-Sent Events** sólo para notificar cambios; las escrituras
  siguen pasando por operaciones HTTP autenticadas e idempotentes.
- **Pino** para registros estructurados.

No se necesita GraphQL, Redis, una cola distribuida ni microservicios en v0.

## Persistencia canónica

- **SQLite** en modo WAL como base canónica del servidor.
- **better-sqlite3** como adaptador del proceso Node.
- **Drizzle** para esquema tipado y migraciones; SQL explícito para recorridos y
  consultas que el ORM no exprese con claridad.
- **FTS5** para búsqueda textual.
- Tablas relacionales para páginas, bloques, aristas, tags, propiedades, tipos,
  permisos, fuentes y operaciones. Los recorridos usan CTE recursivos.

PostgreSQL queda como ruta de escalamiento si una futura Vera necesita muchos
escritores simultáneos o alojamiento multi-tenant. No es requisito de v0.

## Sincronización

Vera usa un registro monotónico de operaciones, no replicación del archivo
SQLite:

1. cada dispositivo genera una clave idempotente por operación;
2. el servidor autentica, autoriza y aplica la operación en una transacción;
3. el servidor asigna una secuencia canónica;
4. cada dispositivo solicita operaciones posteriores a su cursor;
5. dos ediciones offline del mismo bloque se presentan como conflicto para
   resolución humana.

No se incorpora un CRDT en v0. La colaboración carácter por carácter no es un
requisito y añadirla complicaría identidad, procedencia y borrado. Yjs o
Automerge sólo se evaluarían si ese comportamiento se vuelve necesario.

## Grafo y queries

- Modelo persistente relacional con nodos y aristas explícitos.
- Lenguaje de queries propio de Vera, compilado a SQL parametrizado.
- **D3** para navegación 2D y **3d-force-graph** para la vista 3D, reutilizando
  componentes y conducta probada de con§tel.
- **Mermaid** para diagramas declarativos.

No se adopta Neo4j: para un grafo personal, SQLite ya ofrece integridad,
recorridos recursivos y una operación mucho más simple.

## Markdown e hipermedia

- Pipeline **unified/remark/rehype** para parsear y renderizar Markdown.
- **DOMPurify** y políticas CSP para sanitización.
- **PDF.js** para PDF; Mermaid para diagramas; SVG y sketches se presentan en
  contextos aislados.
- El mismo pipeline genera la proyección Markdown y el HTML público para evitar
  semánticas divergentes.

## Audio y transcripción

- **MediaRecorder** en el navegador para captura.
- **FFmpeg** en el servidor para inspección, normalización y derivados.
- **whisper.cpp** local como motor inicial de transcripción, detrás de un
  contrato sustituible.
- La validación humana y el borrado posterior del audio son operaciones de Vera,
  no efectos automáticos del transcriptor.

## Archivos y respaldo

- Audio, imágenes, PDF y otros binarios viven fuera de SQLite en un almacén
  local direccionado por **SHA-256**.
- SQLite conserva identidad, hash, MIME, tamaño, procedencia y relaciones.
- Backups consistentes usan la API de backup de SQLite; los binarios se respaldan
  con **restic** hacia un destino independiente de Alexei.
- Git recibe Markdown y manifiestos deterministas. El archivo SQLite activo y
  sus WAL no se usan como historial Git.

## Identidad y seguridad

- **Passkeys/WebAuthn** para humanos, implementadas con SimpleWebAuthn.
- Tokens revocables, con alcance y hash almacenado, para agentes y dispositivos.
- Cookies de sesión `HttpOnly`, `Secure` y `SameSite`; protección CSRF donde
  corresponda.
- Autorización aplicada en el servidor para toda lectura, escritura y
  publicación. La interfaz nunca constituye la frontera de seguridad.

## Publicación

- Un generador estático dentro del monorepo proyecta páginas públicas a HTML.
- **Astro** se usa como capa de plantillas y construcción del sitio estático.
- GitHub Actions puede desplegar la salida en **GitHub Pages**, conservando las
  URLs históricas de `herbertspencer.net`.
- El sitio público no accede a la base privada en tiempo de lectura.

## Pruebas y calidad

- **Vitest** para unidades e integración.
- **fast-check** para propiedades e invariantes derivadas de Allium.
- **Playwright** para recorridos completos, responsive, instalación PWA y
  escenarios offline/sincronización.
- Pruebas de migración con una copia representativa de `mind`.
- ESLint, TypeScript estricto y formateo automático en CI.

## Despliegue inicial

- Un contenedor de Vera y volúmenes explícitos para SQLite, objetos y
  proyecciones.
- **Docker Compose** para reproducibilidad local y futura migración a un VPS.
- **Cloudflare Tunnel** como entrada HTTPS sin abrir puertos del hogar.
- **Tailscale** como acceso administrativo privado.
- GitHub Actions para validación y publicación estática, no para operar la base
  privada.

## Estructura prevista

```text
apps/
  web/          PWA React
  server/       API Fastify y sincronización
  site/         proyección pública Astro
packages/
  domain/       tipos, operaciones e invariantes
  db/           esquema, migraciones y queries
  markdown/     parser, renderer y proyección
  media/        ingestión, hashes y derivados
  sync/         protocolo, cursores y conflictos
  importers/    Logseq, Jekyll y Zotero
  graph-ui/     componentes derivados de con§tel
specs/          comportamiento Allium
```

## Decisiones deliberadamente diferidas

- lenguaje definitivo de queries de Vera;
- granularidad exacta de sincronización y conflictos;
- proveedor alternativo de transcripción;
- migración de SQLite a PostgreSQL;
- empaquetado nativo mediante Capacitor, si la PWA resulta insuficiente.
