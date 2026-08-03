<p align="center">
  <img src="packages/web/public/assets/vera_vera-logo.svg" width="128" alt="Logo de Vera">
</p>

# Vera

**Vera** — _versionable, editable, replicable y auditable_.

Vera es una memoria personal soberana: un corpus versionado y distribuido,
habitado por personas y agentes, con procedencia explícita y publicación
selectiva. Reúne en un mismo grafo el PKM cotidiano, la investigación, los
medios nativos y la publicación personal. Personas y agentes participan
mediante los mismos contratos, con identidad y permisos explícitos.

Vera forma parte de [MediaFranca](https://mediafranca.net/): es una tecnología
convivencial para gobernar la memoria y el contexto con que personas y agentes
piensan y actúan en común.

## Soberanía digital

<p align="center">
  <img src="packages/web/public/assets/raised-fist.svg" width="104" alt="Puño alzado">
</p>

<p align="center">
  <strong>SOBERANÍA DIGITAL</strong><br>
  <em>Tu memoria. Tu máquina. Tus reglas.</em>
</p>

Vera parte de una confianza crítica en la inteligencia artificial: un modelo no
conoce por sí solo a la persona con quien trabaja, no conserva necesariamente su
historia ni debe decidir qué cuenta como contexto. Por eso Vera es, primero, una
**wiki personal gobernable**. Quien la habita controla la memoria que alimenta a
sus agentes, puede inspeccionarla, corregirla, relacionarla, exportarla y decidir
qué reglas y fuentes tienen autoridad.

Ese contexto propio permite que la IA amplíe capacidades sin reemplazar el
juicio: ayuda a gestionar, crear, investigar, aprender y tomar decisiones desde
una memoria cuya procedencia permanece visible. Personas y agentes participan
en el mismo corpus, pero la agencia humana no se arrienda a la plataforma ni se
diluye en una caja negra.

El [Manifiesto para el Diseño de Interacción en un Tiempo que se
Despliega](https://herbertspencer.net/2025/manifiesto) sostiene que las
herramientas deben amplificar la capacidad colectiva y la agencia individual, y
que las comunidades han de poder apropiarse de ellas, mantenerlas y
transformarlas. [Intelligent Internet](https://ii.inc/web/whitepaper) propone que
cada persona acceda a una IA soberana que posea y gobierne. Vera toma en serio
ambas premisas y propone cómo llevarlas a la práctica: **cada persona gobierna el
contexto con que su inteligencia trabaja**.

El puño alzado expresa esa postura frente a la concentración del poder digital;
no es un ornamento ni una promesa abstracta. El corpus canónico vive bajo el
control de quien lo habita, puede respaldarse y migrarse, no depende de una
tienda ni de un proveedor obligatorio y conserva visible quién hizo cada cambio
—persona o agente— y con qué autoridad.

## Instalación y stack técnico

<p align="center">
  <img src="packages/web/public/assets/pwa-logo.svg" width="112" alt="Progressive Web App">
  <br>
  <strong>Instalable desde la Web</strong> — sin tienda ni permiso de plataforma.
</p>

Para ejecutar esta alfa se necesita **Node.js 24 o posterior** y **npm**. Vera
usa TypeScript, SQLite y una PWA servida por su propio servidor HTTP; no requiere
una tienda de aplicaciones ni un servicio obligatorio de terceros. Las
instrucciones y la composición de los paquetes están en
[Implementación](#implementación).

> **Estado:** el primer recorrido completo está construido y corre sobre el
> corpus real. Tres specs siguen sin implementar y cinco van a medias. Vera es hoy una
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

Con implementación que las sostiene entera:

- [`core.allium`](specs/core.allium) — participantes, páginas, bloques,
  procedencia, revisiones y publicación selectiva.
- [`change-application.allium`](specs/change-application.allium) — cómo un
  cambio aceptado se vuelve estado durable y ordenado: identidad de operación,
  reenvío idempotente, orden total y reproducción del registro.
- [`graph-navigation.allium`](specs/graph-navigation.allium) — links y tags
  derivados del contenido, backlinks y vecindades acotadas por profundidad.
- [`query-language.allium`](specs/query-language.allium) — qué puede expresar
  una query de Vera y qué selecciona del grafo.
- [`agent-participation.allium`](specs/agent-participation.allium) — cómo
  participa un agente: credenciales revocables con alcance, la identidad que
  sale de la credencial y no de lo que el cuerpo afirme, y la autoría que cada
  bloque lleva para que lo generado nunca se confunda con lo escrito.
- [`voice-capture.allium`](specs/voice-capture.allium) — la cascada de
  validación desde el audio y la denominación de origen que sobrevive a todo lo
  que se le haga después al contenido.
- [`block-editing.allium`](specs/block-editing.allium) — el modelo de teclado:
  qué hace cada tecla, qué se guarda y qué se rechaza a la vista.

Implementadas en parte, con lo que falta declarado en la propia spec:

- [`logseq-block-identity-reference.allium`](specs/logseq-block-identity-reference.allium)
  — identidad estable de bloques y proyección Markdown limpia. La identidad
  sobrevive; la proyección todavía no cubre todo.
- [`content-media.allium`](specs/content-media.allium) — contenido hipermedia
  nativo y preservación de fuentes. Los binarios están ingeridos y direccionados
  por contenido; los derivados editables, no.
- [`workspace-interface.allium`](specs/workspace-interface.allium) — navegación,
  vistas, búsqueda, queries y temas. Es la PWA que existe hoy.
- [`search-index.allium`](specs/search-index.allium) — qué encuentra la búsqueda
  de texto libre, cómo ordena y qué extracto justifica cada hallazgo. Falta
  `properties_fts`, declarado en `schema/schema.sql` y en las obligaciones de
  prueba: hoy la búsqueda cubre títulos y contenido, no valores de propiedad.
- [`identity-access.allium`](specs/identity-access.allium) — instancias,
  credenciales y alcance. Los agentes ya se autentican; las personas todavía no,
  pero ya está dicho cómo lo harán: con la misma credencial, porque dos nociones
  de quién escribe serían una de más.
- [`daily-log.allium`](specs/daily-log.allium) — los días de la bitácora: dónde
  aterriza lo que llega antes de tener lugar, y qué sigue diciendo lo inscrito
  sobre el día del que salió. Los días existen en el corpus y en la proyección
  desde el principio; falta que la interfaz sepa de ellos y que una inscripción
  nombre su día.

Sin implementación:

- [`controlled-ontology.allium`](specs/controlled-ontology.allium) — tipos
  componibles y curaduría semántica. Distingue qué clase de cosa es algo de qué
  trata, guarda las relaciones en una sola dirección y deriva sus inversas, y
  gobierna cómo se funden dos conceptos que resultaron ser uno sin reescribir el
  texto de nadie a sus espaldas.
- [`special-pages.allium`](specs/special-pages.allium) — Vera descrita dentro de
  Vera: las páginas que gobiernan su ontología, su presentación y las
  instrucciones de sus agentes. Un agente puede escribir en cualquier página
  menos en una de estas, donde sus cambios llegan como propuestas.
- [`bibliographic-integration.allium`](specs/bibliographic-integration.allium) —
  agregación unidireccional desde Zotero.
- [`personal-site-projection.allium`](specs/personal-site-projection.allium) —
  proyección pública y migración del sitio histórico.

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
npm test                             # 360 tests, node --test, sin build
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

## Créditos gráficos

- **Puño alzado:** Eugenio Hansen, OFS — trabajo propio, licencia
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), vía
  [Wikimedia Commons](https://commons.wikimedia.org/w/index.php?curid=65787095).
- **Logo PWA:** Diego González-Zúñiga — dedicado al dominio público mediante
  [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/), vía
  [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Progressive_Web_Apps_Logo.svg).
