# Benchmark de diseño: Vera y otros PKM

## Alcance y honestidad

Este documento compara el **diseño especificado** de Vera con capacidades
documentadas de Logseq, Obsidian, Roam Research y SilverBullet. Vera todavía no
está implementada; por tanto, no hay base honesta para afirmar que hoy sea más
rápida, estable o fácil de usar. Aquí “mejor” significa **mejor ajustada al caso
de Herbert** si cumple sus contratos.

No intentamos ganar una tabla marcando más casillas. Los cuatro productos de
referencia están maduros en áreas donde Vera aún es sólo una intención formal.

## Resumen comparativo

| Criterio | Vera (objetivo) | Logseq | Obsidian | Roam | SilverBullet |
| --- | --- | --- | --- | --- | --- |
| Modelo principal | Grafo de páginas y bloques | Outliner/gráfico por bloques | Archivos Markdown y enlaces | Grafo alojado por bloques | Páginas Markdown + índice de objetos |
| Backlinks, tags, propiedades y queries | Núcleo especificado | Sí | Sí, con diferencias entre núcleo y plugins | Sí, centrado en bloques | Sí, mediante objetos y Space Lua |
| Identidad estable de bloque sin ensuciar Markdown | Sí; base canónica + proyección limpia | Sí en el modelo DB moderno | No es el modelo central | Sí dentro del grafo alojado | Los refs estables explícitos se representan en Markdown |
| Audio como entidad con original, transcripción y procedencia | Nativo y fundacional | Admite medios; no es el centro del modelo | Admite adjuntos y plugins | Admite adjuntos | Admite archivos; no es el centro del modelo |
| Ontología controlada y curada | Tipos componibles, sugerencias pendientes y migraciones | Propiedades/tags flexibles | Properties y ecosistema de plugins | Atributos y convenciones del grafo | Objetos, tags, esquemas y código |
| Integración bibliográfica | Zotero como autoridad; proyección enlazable | Integración Zotero/PDF | Principalmente plugins y flujos externos | Integraciones vía extensiones/API | Programable mediante Space Lua/plugs |
| Humanos y agentes bajo el mismo contrato | Fundacional, con procedencia y permisos | No es su modelo central | No es su modelo central | API y colaboradores, sin este contrato editorial | Programable, pero no con este modelo de participación |
| PKM y sitio personal desde un corpus | Proyección pública selectiva con URLs históricas | Publicación disponible | Obsidian Publish es un servicio separado | Grafos públicos | Puede publicarse/programarse, requiere composición |
| Autoalojamiento soberano | Objetivo principal | Local/open source | Datos locales; aplicación propietaria | Servicio propietario | Sí, abierto y autoalojado |
| Madurez actual | Especificación | Producto usable | Producto usable y gran ecosistema | Servicio usable | Producto usable y programable |

## Dónde Vera pretende ser mejor

### 1. Un solo grafo aglutinador, sin fingir que todo debe nacer dentro de él

Vera distingue entre la autoridad especializada y la memoria integrada. Zotero
puede seguir siendo la autoridad bibliográfica mientras Vera incorpora obras,
anotaciones y fragmentos citables con su identidad de origen. El valor no está
en reemplazar cada herramienta, sino en relacionar sus objetos con ideas,
proyectos, tareas, audios y publicaciones.

### 2. La voz no es un adjunto de segunda clase

En Vera, el audio original, su transcripción, las correcciones y la procedencia
forman una unidad trazable. Esto permite buscar y enlazar lo dicho sin perder la
evidencia que permite corregir errores como una palabra mal transcrita. Los
competidores pueden adjuntar o reproducir audio; la diferencia propuesta es que
Vera lo incorpora al contrato semántico del grafo desde el comienzo.

### 3. Agentes con responsabilidad editorial explícita

Vera no agrega “IA” como caja de texto lateral. Un agente es un participante
identificado: propone o realiza operaciones autorizadas, deja procedencia y no
puede publicar por una vía privilegiada. Las clasificaciones automáticas quedan
pendientes hasta confirmación. Esto vuelve auditables tanto la asistencia como
sus errores.

### 4. Ontología evolutiva sin abandonar los tags libres

Los tags sirven para asociación ligera; los tipos controlados sirven cuando se
necesitan propiedades, relaciones y validación. Los tipos pueden componerse y
su curaduría es central, visible, versionada y reversible. Vera pretende evitar
dos extremos: un grafo sin estructura y una taxonomía universal diseñada antes
de conocer el corpus.

### 5. PKM y publicación son vistas del mismo corpus

Una página privada puede preparar una proyección pública sin copiarse a otro
repositorio editorial. La publicación requiere autorización humana y conserva
las URLs acumuladas por el sitio histórico. Esta continuidad editorial es más
específica que “publicar notas”: busca reemplazar gradualmente un sitio Jekyll
sin romper veinte años de enlaces.

### 6. Fuentes preservadas, representaciones reemplazables

El audio no se reduce a texto, Mermaid no se reduce a una imagen y un sketch no
se reduce a una captura. Vera conserva la fuente y genera representaciones. Eso
permite reindexar, rerenderizar, corregir y migrar sin pérdida destructiva.

## Lo que Vera aprende de cada sistema

### Logseq

Es la referencia más cercana para edición por bloques, backlinks, propiedades,
queries, journals, PDF y Zotero. Vera adopta especialmente la identidad estable
de bloque en una base canónica con una proyección Markdown limpia. No necesita
copiar toda su interfaz ni heredar cada decisión histórica.

### Obsidian

Demuestra el valor de archivos locales, una experiencia pulida y un ecosistema
amplio. Vera debe igualar su sensación de propiedad y extensibilidad antes de
presumir superioridad. Su diferencia buscada es integrar bloques estables,
ontología curada, audio semántico y agentes dentro del modelo central.

### Roam Research

Mostró que el bloque, la referencia y la escritura diaria podían ser una unidad
de pensamiento fluida. Vera conserva esa lección, pero busca una infraestructura
autoalojable, formatos exportables y una relación explícita entre grafo privado,
fuentes externas y publicación personal.

### SilverBullet

Es el competidor conceptual más incómodo —y por eso el más útil—: soberano,
autoalojado, basado en Markdown, con backlinks, objetos y queries programables.
Vera sólo será claramente mejor para este caso si materializa sus diferencias:
identidad estable sin marcas técnicas en el texto, audio nativo con procedencia,
ontología asistida, participación humano–agente y publicación histórica desde
el mismo corpus.

## Riesgos que pueden invalidar la ventaja

- Si la base canónica dificulta recuperar o migrar el corpus, SilverBullet u
  Obsidian serán opciones más transparentes.
- Si la proyección Markdown no es fiel, Vera habrá sacrificado soberanía por una
  abstracción elegante.
- Si la ontología exige demasiada administración, los tags libres ganarán por
  simple fricción.
- Si los agentes producen cambios opacos o ruidosos, serán peores que plugins
  manuales previsibles.
- Si Vera no importa `mind` con alta fidelidad, ninguna ventaja futura compensa
  el costo de migración.
- Si el audio no ofrece una experiencia inmediata, seguirá siendo un adjunto
  con una spec grandilocuente.

## Cómo convertir esta comparación en un benchmark real

La primera versión medible debe probar el mismo corpus y las mismas tareas en
los cinco sistemas:

1. importar una muestra representativa de `mind`;
2. medir pérdidas de páginas, bloques, propiedades, links y medios;
3. editar y mover un bloque referenciado, verificando si conserva identidad;
4. encontrar una idea por backlink, tag, propiedad y query;
5. ingresar un audio, corregir una transcripción y recuperar el fragmento;
6. enlazar una anotación de Zotero con una idea y una publicación;
7. publicar una página preservando su URL histórica;
8. exportar y reconstruir el corpus sin depender del servicio original.

Para cada tarea se medirán: éxito funcional, pérdida de información, tiempo,
número de acciones, trabajo de configuración, recuperabilidad y trazabilidad.
Sólo después de ejecutar esas pruebas tendrá sentido decir que Vera es mejor en
vez de decir que su intención es mejor.

## Fuentes de referencia

- [Logseq Docs](https://docs.logseq.com/) — funciones de páginas y bloques,
  backlinks, propiedades, queries, medios, Zotero y publicación.
- [Obsidian Help](https://help.obsidian.md/) — archivos locales, backlinks,
  properties, graph, Sync y Publish.
- [Roam Research](https://roamresearch.com/) — propuesta de grafo por bloques,
  colaboración, API y modelo de servicio.
- [SilverBullet](https://silverbullet.md/) — autoalojamiento, Markdown,
  objetos, linked mentions, queries y programación con Space Lua.
- [SilverBullet Objects](https://silverbullet.md/Object) — relación entre
  Markdown, objetos, tags, atributos y referencias.

Consulta de fuentes: 1 de agosto de 2026.
