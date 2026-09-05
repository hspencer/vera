# Cobertura y obligaciones de prueba

> Este documento describe obligaciones, no una fotografía de una corrida.
> `npm test`, `npm run typecheck` y `npm run spec` son la autoridad para el
> estado actual.

Las especificaciones Allium dicen qué comportamiento debe sostener Vera. La
suite comprueba una parte de esas obligaciones y también los bordes que Allium
no modela: SQLite, HTTP, archivos, DOM, IndexedDB, importación y proyección.

## Qué se prueba

- reglas e invariantes del dominio sobre páginas, bloques, identidad estable,
  procedencia, links, propiedades y operaciones;
- aplicación idempotente y reproducción del registro canónico;
- importación y proyección Markdown sin pérdida silenciosa;
- migraciones y materialización de SQLite;
- búsqueda, queries, vecindarios y recorridos;
- edición del outliner, teclado, rutas y renderizado;
- réplica local, retención, cola offline y reconciliación básica;
- credenciales, cercos de escritura, exposición y puerta MCP;
- publicación selectiva y generación del sitio público;
- voz, documentos, medios y contenido ejecutable aislado.

Varias familias usan `fast-check` para explorar secuencias de operaciones y
verifican los invariantes después de cada corrida. Los tests unitarios e
integrados viven junto a cada paquete en `packages/*/test/`.

## Qué no demuestra todavía

- **No hay un recorrido E2E de navegador** que conduzca la PWA completa contra
  un servidor y una base reales. Cliente, servidor y almacén se prueban, pero no
  mediante Playwright como un solo sistema.
- **No se ha probado una restauración completa** de una biblioteca y su almacén
  de objetos en una máquina vacía.
- **No existe colaboración entre dos instancias.** Por tanto, tampoco hay una
  prueba de conflicto o reconciliación federada de extremo a extremo.
- **La identidad humana remota sigue abierta.** La aplicación privada presupone
  loopback; las credenciales de agentes sí se prueban.
- **La cobertura de una spec no es exhaustiva por definición.** Que todas las
  pruebas pasen no implica que cada regla, negativa y pregunta abierta de todas
  las specs tenga una prueba directa.

Estas ausencias no convierten lo construido en falso; delimitan lo que la suite
permite afirmar. Las decisiones pendientes están en [ROADMAP.md](../ROADMAP.md)
y las divergencias de comportamiento deben registrarse en las specs o corregirse
en el código, no esconderse aquí como una cifra tranquilizadora.

## Ejecutar las comprobaciones

```sh
npm run spec       # valida todas las specs; los diagnósticos informativos no fallan
npm run traceability:check # exige una fila de matriz por cada spec
npm run typecheck  # TypeScript en la raíz y la PWA
npm test           # unidades e integración
npm run build      # construcción de la aplicación web
```

Para una instancia en funcionamiento, `GET /invariants` verifica además el grafo
materializado. La suite no sustituye esa comprobación sobre datos reales.
