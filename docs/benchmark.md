# Benchmark estratégico: Vera y el ecosistema que ya existe

## Propósito

Este documento no intenta demostrar que Vera tiene más funciones. Pregunta algo
más útil: **qué parte de Vera debe ser propia, qué parte conviene incorporar de
proyectos abiertos y qué dependencias comprometerían su promesa**.

La comparación se ordena por cinco criterios rectores:

1. **Convivencialidad:** la herramienta aumenta la capacidad de actuar de
   personas y comunidades, y puede ser inspeccionada, apropiada y transformada.
2. **Soberanía:** quien produce una memoria gobierna dónde vive, quién entra, qué
   sale y cómo abandona el sistema.
3. **Integración de IA:** los agentes operan con identidad, autoridad, contexto y
   procedencia explícitos; la IA no es sólo un chat lateral.
4. **Portabilidad:** textos, identidades, relaciones, objetos e historial pueden
   reconstruirse sin el proveedor original.
5. **Extensibilidad:** una comunidad puede añadir capacidades sin bifurcar el
   núcleo ni convertir cada extensión en una puerta trasera.

Se distinguen tres estados de Vera:

- **Construido:** está en el árbol, tiene pruebas y corre sobre el corpus real.
- **Parcial:** existe un camino completo limitado o falta una superficie.
- **Visión:** está argumentado o especificado, pero todavía no existe.

## Veredicto

No hay una herramienta que reúna exactamente el contrato de Vera, pero casi
ninguna pieza es única por separado. La diferencia defendible no es «PKM local
con IA». Es esta:

> **Una memoria intelectual donde personas, comunidades y agentes operan bajo
> un contrato editorial verificable, y donde compartir conocimiento conserva
> procedencia, vocabulario y soberanía.**

Hoy Anytype supera ampliamente a Vera en sincronización soberana y colaboración;
SilverBullet, en extensibilidad convivial y transparencia del soporte; Obsidian,
en madurez y ecosistema; Logseq y Roam, en fluidez del gesto por bloques; AFFiNE,
en colaboración visual; Tana, en experiencia de agentes; y Notion, en madurez
comercial, colaboración y composición de documentos y bases. Solid ofrece la
base protocolar más seria para una federación de datos soberanos.

La estrategia correcta no es imitarlos todos. Es **adoptar protocolos y
componentes abiertos allí donde ya son bienes comunes, y conservar como núcleo
propio el contrato editorial de Vera**.

## Matriz estratégica

| Proyecto | Convivial | Soberano | IA | Portable | Extensible | Decisión para Vera |
| --- | --- | --- | --- | --- | --- | --- |
| **Anytype** | alta para uso; media para transformar el producto | muy alta: local-first, E2EE, P2P, claves propias | API y MCP; procedencia editorial limitada | exportable, pero modelo interno complejo | API; clientes con licencia restrictiva | estudiar `any-sync`; no incorporar el cliente |
| **SilverBullet** | muy alta: herramienta programable por quien la habita | alta: Markdown y autoalojamiento | integrable mediante APIs y scripts, no fundacional | excelente para texto; menor riqueza de historial | excelente: Space Lua, plugs, widgets, Runtime API | incorporar patrones y evaluar componentes MIT |
| **Solid** | alta como infraestructura habilitante | muy alta: Pods, identidad y permisos separados de las apps | agentes como sujetos autorizables | alta por protocolos web y Linked Data | alta entre implementaciones interoperables | candidato principal para federación y autorizaciones |
| **Logseq** | alta en apropiación cotidiana y plugins | alta en grafos locales; sincronización variable | añadida, no contrato central | muy alta en versión Markdown; menor en DB | alta por plugins | mantener compatibilidad e importar gestos probados |
| **Obsidian** | alta para usuarios expertos; núcleo propietario | alta sobre archivos locales | ecosistema amplio, gobierno desigual | excelente para contenido Markdown | excepcional por plugins | referencia de UX y formato; no base arquitectónica |
| **AFFiNE** | alta como espacio creativo compartido | alta en modo local/self-hosted | Copilot integrado | razonable; debe probarse pérdida real | código y plugins, licencias por componente | evaluar editor/canvas y CRDT; auditar licencias primero |
| **Tana** | alta capacidad, baja apropiación del sistema | baja: servicio centralizado | muy alta: agentes, herramientas, voz y horarios | limitada por exportación y servicio | configurabilidad alta; plataforma cerrada | referencia de interacción con agentes, no dependencia |
| **Capacities** | buena composición por objetos | baja-media: servicio y APIs externas | integrada, opt-in y con herramientas de escritura | exportación disponible, no independencia operativa | media | referencia de objetos y consentimiento de IA |
| **Roam** | alta fluidez intelectual | baja: servicio propietario | extensiones y APIs | menor que sistemas basados en archivos | media-alta | referencia histórica del gesto, no infraestructura |
| **Notion** | muy alta para equipos; baja para transformar el soporte | baja: servicio centralizado y nube del proveedor | IA y agentes integrados al servicio | exporta HTML, Markdown y CSV, pero la exportación no reconstruye instantáneamente el espacio | API e integraciones sobre una plataforma cerrada | competencia comercial de referencia; aprender de su superficie sin arrendarle el corpus |

La tabla no usa «open source» como adjetivo publicitario. Anytype publica y deja
compilar sus clientes, pero estos usan **Any Source Available License 1.0**:
permiten uso personal, académico y de I+D, y restringen usos comerciales fuera
de redes autorizadas. `any-sync` y varios nodos sí son MIT. SilverBullet es MIT.
Solid es una familia de estándares e implementaciones abiertas. Logseq declara
AGPL-3.0. AFFiNE necesita revisión por paquete antes de reutilizar código.

## Lo que Vera ya hace de manera singular

### Un contrato de edición y procedencia

Los bloques tienen identidad estable sin ensuciar la proyección Markdown. Toda
escritura entra por `POST /operations`, recibe secuencia canónica y conserva
participante, canal, instante y evidencia de origen. Una credencial prueba quién
intervino y con qué autoridad; no convierte su afirmación en verdad.

Ningún competidor examinado reúne esta granularidad de procedencia con un modelo
de participación humano-agente y una única puerta de escritura.

### Recorridos que se vuelven argumentos

Vera no reduce el grafo a visualización. El rastro personal puede promoverse a
un recorrido auditable, con cruces y conectivas, legible como texto y mapa. Es la
continuidad más explícita con el *trail* del Memex y con con§tel: compartir no es
entregar sólo una conclusión, sino un camino intelectual.

### Hipermedia con fuentes preservadas

Audio y transcripción, Mermaid y SVG, dibujo y representación, Markdown y papel
mantienen distinguibles fuente y derivado. La posibilidad de volver a procesar
sin destruir el original es parte del contrato, no una convención de plugins.

### Gobierno desde el corpus

La ontología, las conexiones externas, los permisos y las decisiones revisables
viven en páginas legibles del mismo corpus. Los secretos son la excepción porque
un secreto debe poder borrarse. Esta coincidencia entre memoria y constitución es
una de las apuestas más propias de Vera.

## Lo que otros resuelven mejor y Vera no debe reinventar

### Sincronización local-first y cifrada — Anytype / any-sync

Anytype demuestra que una aplicación de conocimiento puede ser local-first,
offline, P2P, cifrada de extremo a extremo y colaborativa. Vera tiene registro
monotónico, cambios idempotentes y réplica retenida en navegador, pero no replica
todavía un corpus entre dos instancias ni resuelve escrituras concurrentes.

**Decisión:** estudiar `any-sync` como protocolo MIT y separar sus ideas de los
clientes Anytype, cuya licencia no sirve como cimiento de una tecnología
transferible sin negociación. Antes de incorporar código hay que probar si su
modelo DAG cifrado puede transportar las operaciones, identidades y conflictos
de Vera sin convertir el registro canónico en una segunda verdad.

No se debe adoptar P2P por prestigio. Para una universidad, identidad,
recuperación, borrado, auditoría y dispositivos perdidos importan tanto como la
ausencia de servidor.

### Extensibilidad para usuarios — SilverBullet

SilverBullet es la referencia convivial más incómoda. Su espacio son archivos
Markdown; Space Lua permite consultas y automatizaciones; plugs, widgets,
bibliotecas y Runtime API dejan que quien habita el sistema lo transforme. Todo
ello bajo MIT.

**Decisión:** adoptar el principio de extensiones con capacidades declaradas y
evaluar reutilización de componentes concretos, no incrustar SilverBullet entero.
Vera necesita un API de extensión pequeño que sólo pueda leer o proponer las
operaciones autorizadas. Una extensión no obtiene SQLite ni identidad implícita.

Space Lua sugiere un buen reparto: el corpus contiene programas pequeños y
legibles, mientras un runtime limitado les concede funciones explícitas. Vera
debe añadir procedencia, presupuesto y permisos a ese patrón.

### Federación de datos — Solid

Solid separa almacenamiento, identidad y aplicación. Cada persona u organización
puede gobernar uno o varios Pods; aplicaciones y agentes solicitan accesos
granulares mediante protocolos abiertos. Es conceptualmente más cercano a una
federación soberana que ActivityPub, cuyo centro es distribuir actividades y
copias sociales.

**Decisión:** no inventar todavía `vera://` como mundo cerrado. Prototipar una
proyección de páginas, ramas y recorridos públicos como recursos Linked Data;
mapear participantes a WebID/Solid-OIDC; y contrastar los permisos de Vera con
Data Grants. Vera seguiría siendo el editor y registro intelectual; Solid podría
ser la membrana federada.

Solid no resuelve por sí solo procedencia, semántica de bifurcación, retractación
ni experiencia de escritura. Tampoco impide que un receptor copie lo que pudo
leer. Por eso es sustrato, no producto sustituto.

Vera está pensada para una federación, pero todavía no ha decidido su unidad ni
su protocolo de intercambio. Quedan separados tres gestos: publicar una
proyección legible por cualquiera; compartir una página, rama o recorrido con
participantes determinados; y federar entre grafos conservando origen, permiso,
versiones y posibilidad de retractación. Las páginas públicas pueden copiarse;
las privadas exigen autorización revocable; ninguna de las dos cosas resuelve
por sí sola cómo una copia remota recibe cambios sin volverse una segunda verdad.

### Edición colaborativa y superficies visuales — AFFiNE

AFFiNE prueba la integración de documentos por bloques, bases y canvas con
colaboración local-first. Su experiencia visual es mucho más madura que Vera.

**Decisión:** estudiar su modelado de documentos/canvas y su uso de CRDT sólo
para superficies que realmente exijan coedición carácter a carácter. Vera no
debe convertir todo el grafo en un CRDT: su unidad de responsabilidad es la
operación editorial y muchos conflictos merecen resolución humana visible.
Además, cada paquete debe pasar una auditoría de licencia antes de reutilizarse.

### Gesto por bloques y compatibilidad — Logseq

Logseq sigue siendo la referencia para outliner, diario, referencias de bloque,
PDF, Zotero y ecosistema. Vera nació al destilar ese comportamiento sobre un
corpus real.

**Decisión:** conservar importación y proyección fieles, y tratar la
compatibilidad Logseq como prueba de portabilidad. No importar su arquitectura
completa ni perseguir cada plugin. El criterio es que alguien pueda abandonar
Vera sin perder su texto y pueda llegar desde Logseq sin perder su historia
intelectual esencial.

### Experiencia de agentes — Tana

Tana convierte agentes en objetos configurables con capacidades, contexto, voz y
horarios. La experiencia es más avanzada que la de Vera, pero ocurre dentro de
un servicio centralizado.

**Decisión:** aprender de la superficie, no de la dependencia. En Vera un agente
debe ser participante, mandato y credencial: quién es, qué puede leer, qué puede
proponer o escribir, con qué presupuesto y por cuánto tiempo. Su configuración
debe ser portable y auditable; su secreto, revocable.

### Espacio de trabajo comercial — Notion

Notion es la comparación comercial más reconocible: integra documentos, bases,
publicación, colaboración, automatizaciones e IA con una experiencia madura. Su
fortaleza es reducir la fricción de coordinar un equipo dentro de un mismo
servicio. Su límite para Vera es igualmente claro: el espacio vive y se gobierna
en la nube del proveedor. La exportación entrega HTML, Markdown y CSV, pero la
propia documentación advierte que esos archivos no recrean instantáneamente el
workspace original.

**Decisión:** tratar Notion como referencia de interacción y como prueba de
honestidad comercial, no como infraestructura. Vera no necesita vencerlo en
cantidad de funciones; necesita demostrar qué conserva cuando se apaga el
proveedor: identidad de bloques, operaciones, procedencia, relaciones,
recorridos y autoridad editorial reconstruibles.

## Arquitectura de incorporación propuesta

```text
                         PROTOCOLOS ABIERTOS
             Solid / WebID / permisos / HTTP / Markdown
                                   │
                    membrana de publicación y federación
                                   │
┌──────────────────────────────────▼──────────────────────────────────┐
│                         NÚCLEO PROPIO DE VERA                       │
│ identidad estable · operaciones · procedencia · autoridad          │
│ ontología gobernada · recorridos · fuentes preservadas             │
└──────────────┬───────────────────┬───────────────────┬──────────────┘
               │                   │                   │
       RÉPLICA Y CIFRADO      EXTENSIONES          SUPERFICIES
       evaluar any-sync       patrón Space Lua     editor/outliner
       sin ceder el log       + capacidades        canvas/medios
               │                   │                   │
       componentes MIT        runtime cercado      componentes auditados
```

### El núcleo que no se delega

- tipos de operación y sus invariantes;
- identidad de participantes y bloques;
- procedencia y registro de exposición;
- autorización y única puerta de escritura;
- semántica de recorridos, cruces y conectivas;
- distinción entre fuente, derivado y afirmación;
- reglas de publicación, bifurcación y retractación.

Delegar cualquiera de estas piezas a una biblioteca cuyo modelo no las expresa
haría que Vera fuese sólo una interfaz ética sobre una infraestructura que decide
otra cosa.

### Las piezas que sí deben componerse

- protocolos de identidad y autorización federada;
- transporte y cifrado de réplicas;
- editor Markdown y motores de diagramas;
- runtimes confinados para extensiones;
- parsers, exportadores e importadores;
- almacenamiento de objetos por contenido;
- motores locales de transcripción e inferencia;
- componentes accesibles de interfaz y canvas.

La incorporación exige cuatro pruebas: licencia compatible, modelo de amenaza,
capacidad de exportación y correspondencia con las invariantes de Vera.

## Cinco pruebas duras

### 1. Convivencialidad

Una persona sin permiso del proveedor debe poder:

- inspeccionar cómo se representa su trabajo;
- cambiar comportamientos mediante extensiones cercadas;
- corregir o sustituir un agente;
- comprender qué autoridad tiene cada automatización;
- organizarse con otros sin que la plataforma imponga un vocabulario único.

### 2. Soberanía

Se prueba apagando al proveedor. El corpus debe seguir abriendo, editando y
exportando; las claves deben estar bajo control de la persona o institución; una
credencial perdida debe poder revocarse; ninguna función esencial debe depender
de una red autorizada por un tercero.

### 3. IA

Se conecta el mismo agente a un corpus controlado y se verifica:

- qué contexto salió y quién lo autorizó;
- qué operaciones realizó;
- si sus bloques siguen distinguibles;
- si puede sustituirse el modelo sin migrar la memoria;
- si leer, escribir, publicar y entrenar son permisos independientes.

### 4. Portabilidad

Una exportación debe reconstruir páginas, bloques, relaciones, propiedades,
objetos, procedencia y recorridos en una instancia vacía. Markdown solo es una
excelente salida editorial, pero no prueba por sí mismo la portabilidad completa
de una memoria con historia.

### 5. Extensibilidad

Una extensión de prueba debe añadir una consulta y una superficie sin acceder a
SQLite, falsificar participante ni escribir fuera de `POST /operations`. Al
retirarla, el corpus debe seguir siendo legible y sus cambios deben conservar
procedencia.

## Benchmark ejecutable

La comparación real debe usar el mismo corpus de muestra y medir tareas, no
promesas. Candidatos mínimos: Vera, Notion, Anytype, SilverBullet, Logseq, Obsidian,
AFFiNE, Tana y Capacities. Solid se evalúa como infraestructura mediante un
prototipo de publicación federada, no como editor.

1. Importar páginas, bloques, links, propiedades, medios y referencias.
2. Editar y mover un bloque citado, conservando o perdiendo identidad.
3. Trabajar sin red en dos dispositivos y reconciliar cambios incompatibles.
4. Dar acceso limitado a otra persona y retirarlo.
5. Hacer que un agente lea y escriba, auditando contexto y procedencia.
6. Sustituir el proveedor de IA sin migrar el corpus.
7. Crear una extensión pequeña y auditar sus capacidades.
8. Publicar una página, una rama y un recorrido con licencia y versión.
9. Bifurcar contenido remoto sin suplantar el original.
10. Exportar y reconstruir el sistema sin el servicio de origen.

Se miden éxito, pérdida de información, tiempo, acciones, configuración,
recuperabilidad, trazabilidad, superficie de confianza y dependencia jurídica.

## Prioridades resultantes

1. **Especificar portabilidad completa** y probar restauración automática.
2. **Prototipar Solid** para publicación y federación antes de diseñar un
   protocolo exclusivo.
3. **Evaluar any-sync** en un spike aislado contra el registro de operaciones.
4. **Diseñar el contrato de extensiones** inspirado en Space Lua, con capacidades
   y procedencia obligatorias.
5. **Mantener Logseq/Markdown como ruta de entrada y salida**, no como base
   canónica paralela.
6. **No incorporar clientes source-available** al núcleo transferible.
7. **Construir identidad y mandatos de agentes** antes de sumar más funciones de
   generación.

## Riesgo estratégico

Vera podría terminar como un collage de buenas ideas ajenas envuelto en un
discurso humanista. La defensa contra ese riesgo no es reclamar originalidad,
sino sostener una coherencia que los demás no ofrecen juntos: cada componente
adoptado debe obedecer el mismo contrato de dignidad, procedencia, soberanía y
responsabilidad.

También existe el riesgo contrario: inventarlo todo para preservar una pureza
imaginaria. Eso produciría una herramienta soberana pero aislada, costosa y
frágil. La arquitectura correcta es porosa hacia los bienes comunes y estricta
en su constitución.

## Fuentes primarias

- [Anytype](https://anytype.io/) — local-first, E2EE y colaboración.
- [Licencia Anytype](https://raw.githubusercontent.com/anyproto/anytype-ts/main/LICENSE.md)
  — código disponible con restricción comercial.
- [`any-sync`](https://github.com/anyproto/any-sync) — protocolo P2P MIT.
- [SilverBullet](https://github.com/silverbulletmd/silverbullet) — PKM Markdown,
  Space Lua y extensiones bajo MIT.
- [Solid](https://solidproject.org/about) — Pods y control de datos.
- [Solid Application Interoperability](https://solidproject.org/TR/sai) —
  registros, necesidades de acceso y autorizaciones.
- [Logseq](https://github.com/logseq/logseq) — plataforma por bloques AGPL-3.0.
- [AFFiNE](https://github.com/toeverything/AFFiNE) y
  [autoalojamiento](https://affine.pro/self-host).
- [Tana Agents](https://tana.inc/learn/features/agents).
- [Capacities: tipos](https://docs.capacities.io/reference/content-types) y
  [privacidad de IA](https://docs.capacities.io/more/ai-privacy).
- [Notion: exportar contenido](https://www.notion.com/help/export-your-content)
  — formatos disponibles y límites de reconstrucción del espacio.

Consulta de fuentes: 16 de agosto de 2026.
