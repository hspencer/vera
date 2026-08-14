# Hoja de ruta

Lo que viene, en el orden en que unas cosas condicionan a otras. Lo que ya se
construyó de esta hoja va marcado *hecho* donde corresponde; todo lo demás no
existe. El estado general se cuenta en el [README](README.md#estado) y en las
specs.

Este documento no promete fechas. Dice **qué falta, por qué importa, qué lo
bloquea y qué preguntas siguen abiertas**. Una hoja de ruta con fechas y sin
preguntas abiertas es una lista de deseos con formato de plan.

Las cuatro direcciones estructurales antes resumidas en
[README § Pasos futuros](README.md#pasos-futuros) y los tres horizontes de
experiencia no son dos planes distintos. Todos dependen de un mismo umbral:
definir qué se instala, qué contiene, quién entra y qué contrato ofrece Vera a
personas y agentes. La hoja empieza por ese fundamento y después ordena **que la
mano no espere**, **que la espera se vea** y **la federación**.

---

## Umbral — Saber qué es una Vera

**Estado: parcialmente decidido y construido para una sola persona, un solo
grafo y agentes locales. La generalización no está especificada.**

Antes de robustecer el servidor o elegir un protocolo de federación hay que
separar cuatro cosas que hoy coinciden en la única Vera que existe:

- una **instancia** es el servidor instalable y operable, con dirección,
  almacenamiento, configuración, actualización, respaldo y recuperación;
- una **biblioteca** es un corpus gobernado como una unidad, con sus páginas,
  bloques, objetos, historial, vocabulario y reglas;
- un **participante** es una persona o un agente con identidad, membresía,
  autoridad y procedencia;
- una **publicación** es una proyección revocable de una biblioteca, no acceso
  anónimo al almacén que la contiene.

Vera es el contexto, no la inteligencia que lo usa. La biblioteca conserva los
textos, relaciones y decisiones independientemente de cualquier modelo; sus
funciones locales de IA son capacidades auxiliares, no el lugar donde vive la
memoria. Un agente más capaz entra desde fuera como participante identificado:
puede leer, escribir y modificar estructura por las mismas operaciones del
dominio, sin convertirse por ello en dueño del contexto.

La unidad soberana de Vera es personal: una biblioteca pertenece a un individuo
humano. Esto ya no es sólo el alcance accidental de la v0. En la red federada se
relacionan individuos soberanos; lo colectivo se construye entre varios sin
convertirse retroactivamente en dueño de sus bibliotecas ni absorberlas en una
cuenta común.

Una instancia y una biblioteca siguen siendo conceptos distintos para poder
mover, respaldar y restaurar la biblioteca sin identificarla con la máquina que
la sirve. Queda por decidir si una instalación puede operar varias bibliotecas
personales aisladas; esa decisión de alojamiento no cambia la unidad de
soberanía.

### 0.1 El modelo de instalación y gobierno

Especificar el ciclo completo de una instancia: crearla, reclamar su propiedad,
levantarla en otra máquina, actualizarla, respaldarla, restaurarla y abandonarla
sin perder el corpus ni su procedencia. El despliegue de una sola instancia debe
ser reproducible antes de diseñar una red de ellas.

Entregables: una spec de instancia y biblioteca; una prueba de restauración sobre
una instalación vacía; y una decisión explícita sobre uno o varios grafos
**personales** por instancia. Ésta última queda abierta: cambia el aislamiento,
las URLs, el modelo de permisos, la sincronización y el modo de operar el
servidor, pero no quién gobierna cada biblioteca.

### 0.2 Una identidad, distintas autoridades

Cerrar el camino que hoy supone que una petición sin credencial es la persona
propietaria. Personas y agentes se autentican por el mismo límite de identidad;
lo que difiere es su clase de participante, su canal de contribución y la
concesión concreta bajo la que actúan.

La participación es horizontal en capacidad y explícitamente asimétrica en
soberanía. Un agente admitido no queda reducido a sugerir desde un chat lateral:
puede intervenir de verdad y cada intervención conserva su mano. Pero la persona
o comunidad propietaria decide qué forma parte de su contexto, puede corregir,
revertir o retirar autoridad y tiene la última palabra editorial. Que su palabra
sea canónica significa que gobierna **su biblioteca**; no convierte sus
afirmaciones en verdad factual ni permite reatribuir o borrar la procedencia de
lo que escribió otra mano.

Falta: autenticación humana; sesiones; recuperación desde la máquina soberana;
membresías y concesiones por biblioteca; revocación; registro de lo leído además
de lo escrito; y autenticación remota con consentimiento. Sólo después se expone
Vera fuera de `localhost` y se abre MCP a clientes que viven en la nube.

### 0.3 El protocolo del bibliotecario

Vera no debe estar documentada para una IA particular. Cualquier inteligencia
admitida puede ocupar una plaza de bibliotecario y tiene que poder descubrir,
sin conocimiento privado del código:

- qué puede hacer y bajo qué identidad, concesión y versión de protocolo;
- qué contexto rector debe leer y qué parte del corpus es sólo contenido;
- cómo descubrir páginas, bloques, relaciones, propiedades y objetos;
- cómo consultar el grafo y cómo interpretar resultados, límites y procedencia;
- cómo proponer y aplicar cambios idempotentes, con precondiciones y rechazos
  legibles;
- cuáles son las reglas de escritura del outliner: identidad del bloque,
  jerarquía, orden, referencias, propiedades, medios y descarte;
- qué conserva y qué pierde cada representación, especialmente Markdown;
- cómo verificar el efecto de una escritura y cómo actuar ante conflicto.

El entregable no es sólo documentación narrativa: es un contrato versionado,
descubrible por máquina, una referencia para humanos, ejemplos canónicos y una
matriz de pruebas que conecte cada comando MCP/HTTP con la misma operación de
dominio. Las páginas rectoras aportan contexto autorizado; ningún bloque común
se convierte en instrucciones por estar escrito en el corpus.

Ese contrato presenta a Vera como contexto soberano y durable, no como una IA
con memoria incorporada. Los modelos y agentes deben poder cambiar sin cambiar
la identidad de la biblioteca, y dos inteligencias distintas deben recibir la
misma descripción observable de qué existe, qué pueden hacer y quién decide.

El proyecto conserva sus decisiones en tres rastros enlazados. Las páginas de
Vera guardan el pensamiento pasado al limpio: razones, alternativas, desacuerdos,
preguntas y decisiones en su contexto intelectual. Las specs Allium reciben las
decisiones conjuntas que ya fijan comportamiento observable del software. Los
README, documentos y diagramas Mermaid del repositorio explican la arquitectura
elegida para cumplirlas. Vera enlaza hacia ambos: la página explica **por qué** y
cómo se llegó; la spec obliga **qué** debe cumplirse; el repositorio muestra
**cómo** se realiza técnicamente. Una pregunta abierta no se disfraza de regla,
una regla no depende de reconstruir una conversación para entender su intención
y la documentación técnica no se convierte en una tercera fuente normativa.

### 0.4 Sincronización y Solid como decisiones derivadas

La sincronización local entre navegador y servidor, la sincronización entre
aparatos y la federación entre instancias comparten operaciones e identidad,
pero no son el mismo problema. Primero se completa y mide la reconciliación del
horizonte 1. Después se ejecutan dos prototipos aislados:

1. contrastar `any-sync` con el registro canónico de operaciones, cifrado,
   conflictos y portabilidad de Vera;
2. contrastar Solid —Pods, WebID/Solid-OIDC y autorizaciones— con bibliotecas,
   participantes, publicación y procedencia.

Solid es un candidato a infraestructura, no el modelo de dominio de Vera. El
prototipo debe contestar qué sustituye, qué conserva y qué obliga a duplicar
antes de adoptarlo. No se diseña un protocolo exclusivo mientras una combinación
de estándares abiertos pueda satisfacer el contrato sin perder semántica.

---

## Horizonte 1 — Que la mano no espere

**Estado: en curso, rama `v0.4-local-first`. Pasos 0 a 3 hechos y leer sin
servidor también. Los pasos 4 y 5 están especificados y sin implementar: leer con
un servidor *lento* todavía espera, que es lo que quedaba y no se había medido.**

Es la prioridad y no es una optimización. Una memoria personal que hace esperar
al pensamiento no es una memoria personal: es un formulario. La spec que lo
gobierna es
[`offline-reconciliation.allium`](specs/offline-reconciliation.allium) y el plan
detallado, con la medida sobre la instancia real, está en
[`docs/plan-local-first.md`](docs/plan-local-first.md).

Lo que ya cambió: el cliente sostiene un `VeraGraph` de verdad y le aplica los
cambios con las mismas reglas del servidor —no hay una segunda implementación del
dominio que pueda divergir—; el envío dejó de bloquear; y lo pendiente cae en
IndexedDB antes de anunciarse como guardado, así que sobrevive a cerrar la
pestaña y se drena solo cuando vuelve la red. Y lo que se lee se retiene, así que
Vera abre sin servidor con lo que este aparato ya había leído.

### 1.1 Leer sin servidor — *hecho*

**Lo leído se queda.** Cada página que el corpus entrega se retiene en IndexedDB
—ver [`held.ts`](packages/web/src/held.ts)— junto con la lista de páginas y el
estado del corpus, y cuando el servidor no contesta se lee de ahí. La réplica se
siembra igual, así que **una página leída ayer se escribe hoy sin red** y lo
escrito sale por la bandeja cuando vuelve.

Nada se replica por adelantado, que es la respuesta práctica a §1.3: un corpus de
casi dos mil páginas no cabe en un teléfono, y elegir de antemano qué bajar es
adivinar la atención de alguien. **Leer es esa adivinanza ya hecha, por la
persona.** El límite son 240 páginas, y se suelta por última lectura.

Lo único que no se puede leer sin corpus es el **mapa**: el vecindario a dos
saltos se calcula sobre el grafo entero. Se queda el anterior, atenuado y con la
razón escrita, en vez de fingir que es el de la página abierta.

### 1.2 Lo retenido primero, y el botón que avisa — *paso 4, especificado*

Está escrito en `offline-reconciliation.allium` y falta implementarlo.

Lo que se descubrió al medir: **leer con un servidor lento sigue esperando**. No
hay lectura condicional en ninguna parte —ni ETag, ni «¿sigue valiendo lo mío?»—
así que `openPage()` pide la página entera cada vez, la haya visitado una vez o
cincuenta, y lo retenido en IndexedDB sólo se consulta cuando la red *falla*. Un
`catch` no se dispara porque algo tarde.

| | tiempo | bytes |
| --- | ---: | ---: |
| abrir una página muy escrita (1.147 bloques) | 0,81 s | **512 KB** |
| preguntar «¿qué cambió desde mi cursor?» | **0,003 s** | **3,8 KB** |

Con eso, el diseño: la página se dibuja desde este aparato al instante; detrás se
pregunta lo barato; si algo espera, **el indicador cambia y espera a que lo
pulsen**; lo toma el dueño. Nada cruza al texto en pantalla sin que alguien lo
pida — porque otra mano escribe en este corpus, y cambiar el texto bajo los ojos
de quien lee no es sincronizar sino interrumpir.

Y queda el otro límite que el paso 3 dejó escrito:

- **La primera escritura de un día necesita red.** Nace con un `create_page` que
  la réplica difiere, y un solo gesto que espera basta para que la promesa no se
  cumpla. Es lo siguiente que hay que quitar: la lista de títulos ya está
  retenida, así que la réplica podría saber si el título está libre sin preguntar.

### 1.3 El desacuerdo, por bloque — *paso 5, especificado*

Donde dos manos escribieron el mismo bloque, se enseñan las dos versiones con las
líneas que difieren marcadas, y se elige una —o se escribe una tercera—. Un
local-first que resuelve conflictos callando es un local-first que pierde texto
sin decirlo.

**El bloque y no la línea**: es lo único de lo que Vera tiene identidad. Mezclar
línea a línea produce un texto que no escribió ninguna de las dos manos, en un
bloque cuya autoría ya no se puede afirmar — y en este corpus también escribe una
máquina.

### 1.4 Cuánto cabe en un teléfono

**Contestado a medias por 1.1**: se retiene lo leído, hasta 240 páginas, y no hay
hidratación previa que esperar. Lo que sigue abierto es si conviene retener algo
*además* de lo leído —el día en curso, lo que la página abierta enlaza— sabiendo
que traerse a los vecinos anula justo lo que hace barata esta política, que es
dejar que la atención elija. Y qué hacer en un aparato cuyo almacenamiento Vera
no puede medir.

### 1.5 Lo que sigue sin decidirse

- Qué pasa con lo pendiente cuando la credencial caduca con el aparato sin red.
- Qué camino de recuperación conserva lo pendiente cuando el almacén local está
  lleno, no disponible o corrupto.
- Qué cambios sobre el mismo sujeto se pueden fundir solos.

### 1.6 Deuda menor

Resuelta: los comentarios de `main.ts` que seguían diciendo que la bandeja no es
durable, y el aviso que le decía a quien se quedaba sin red que cerrar la pestaña
perdía lo escrito. Las dos cosas eran falsas desde el paso 3.

---

## Horizonte 2 — Que la espera se vea

**Estado: la doctrina está escrita, especificada y puesta en las tres esperas que
más se notan. Faltan cuatro.**

Local-first quita casi todas las esperas. Las que quedan son las verdaderas —el
modelo local, la transcripción, la composición del PDF, la primera hidratación—
y son largas. Una espera larga sin realimentación es peor que una espera larga,
porque además de esperar hay que decidir si el programa murió.

### 2.1 La regla

Vive en [`waiting.allium`](specs/waiting.allium) y en
[`waiting.ts`](packages/web/src/waiting.ts), y se resume en cuatro decisiones que
**no se van a revisar**:

1. **No se anima.** Una rueda girando dice lo mismo esté viva o muerta. Una
   animación miente cuando el proceso se cuelga.
2. **Se cuenta.** Un número que sube no puede mentir: si el proceso se cuelga, el
   número sigue subiendo, y eso es exactamente la verdad.
3. **Nunca un porcentaje.** Sería fingir que se sabe cuánto falta.
4. **Se recuerda lo que tarda, y se dice**: «6 s · suele tardar ~20 s». La
   **mediana** de las últimas siete medidas, no la media, para que una llamada
   que un día se fue a noventa segundos no cambie lo que se le promete a nadie.
   Y se calla al pasarse de lo normal: insistir en «suele tardar 20 s» en el
   segundo cuarenta se lee como burla.

Y el umbral: **nada antes de 900 ms**. Lo que tarda menos de un segundo no tarda,
y un contador en cada paso instantáneo convierte la interfaz en un parpadeo de
números.

Y una quinta que no estaba escrita y ahora sí: **sólo se recuerda lo que salió
bien**. Un proceso que falló al segundo segundo no tardó dos segundos en hacerse
—tardó dos segundos en fallar—, y guardarlo como lo primero prometería una
velocidad que Vera no tiene.

### 2.2 Dónde está y dónde falta

| Dónde | Estado |
| --- | --- |
| **Transcribir un audio** (`audio-block.ts`) | **Hecho.** La cuenta va en el botón que se pulsó, con clave `voice:transcribe`: a partir de la segunda vez el aparato dice cuánto suele tardar. Era la espera más larga de Vera y la que menos decía. |
| **Una consulta al grafo** (`query-block.ts`) | **Hecho.** Contador donde va a salir la respuesta. Y con rama de fallo, que no había: sin servidor el bloque se quedaba en `preguntando…` para siempre. |
| **Abrir una página** (`main.ts`) | **Hecho.** El título de destino tras 300 ms y la cuenta debajo, contada desde que se pidió la página y no desde que se pintó el aviso. |
| **Exportar a PDF** | Falta. El navegador sin ventana compone en el servidor, sin señal alguna. |
| **Importar un documento** | Falta. Un `.docx` grande no dice nada mientras se lee. |
| **Dibujar el mapa** | Falta. Con proximidad 3 sobre un corpus grande, el cálculo de fuerzas se nota. |
| **Arranque en frío** | Ya no aplica como se escribió: no hay hidratación previa que esperar (§1.1). |

### 2.3 Lo decidido, y lo que sigue abierto

**Dónde va el contador — resuelto, y no como se había planteado.** La pregunta
era si el timer va «al medio». La respuesta es que va **donde estuvo la mano**:
quien pulsó un botón mira el botón, quien hizo una pregunta mira dónde va a salir
la respuesta, y quien abrió una página mira el sitio donde va a aparecer —y ahí
sí queda centrado bajo el título, que es lo que «al medio» quería decir. Un
rincón fijo de estado de la máquina obligaría a apartar la vista de lo que se
está esperando para enterarse de que se está esperando.

**Un solo componente — hecho.** `countInto(elemento, qué, clave)` es el
mecanismo, y `pendingLine` es ahora un caso suyo. Una sola regla de estilo
—`.counting`— para que el botón, el bloque de la pregunta y el título de una
página que viene se parezcan, porque son la misma espera contada.

Sigue abierto:

- **Qué pasa cuando se pasa de lo razonable.** Después de un umbral, un contador
  que sube solo también deja de informar. Falta decir qué se ofrece entonces:
  cancelar, seguir en segundo plano, o al menos nombrar qué se está esperando.
- **Si lo medido debe viajar entre aparatos.** Un teléfono y una estación de
  trabajo llamando al mismo modelo local no miden lo mismo, así que hoy cada
  aparato recuerda el suyo.
- **Contar por pasos o de punta a punta** cuando el trabajo tiene varios, y si la
  respuesta cambia según se esté mirando o se haya dejado corriendo.

### 2.4 Y lo que no se va a hacer

Esqueletos grises que imitan el texto que va a llegar. Ya está decidido y escrito
en el código: **no se dice «espera» ni se imita el texto con rectángulos; se dice
qué carga y dónde**, y cuando el texto llega el título ya estaba puesto.

---

## Horizonte 3 — Federación

**Estado: nada construido. Una spec sin implementación
([`personal-site-projection.allium`](specs/personal-site-projection.allium)) y
ninguna spec para el resto.**

Es el horizonte más lejano y el que da sentido a los anteriores. Vera es hoy una
memoria de una persona en una máquina. La federación es que esas máquinas se
hablen **sin que aparezca un centro**.

El modelo es el de Mastodon y no el de una nube: muchos servidores pequeños,
cada uno con su dueño y sus reglas, capaces de referirse unos a otros. No un
Vera SaaS con instancias; **instancias, y ninguna de ellas principal**.

### 3.1 Publicación web de las páginas públicas

*Lo primero, porque es lo único que no necesita que nadie más participe.*

El interruptor `pública/privada` existe en cada página desde el principio, y hoy
**declara una intención sin efecto**: marcar una página como pública no pone nada
en internet. Cerrar ese hueco es lo primero de este horizonte.

Falta: la proyección del sitio como **vista selectiva del mismo grafo** y no un
segundo corpus que mantener; autorización humana explícita para cada publicación;
URLs históricas estables —las de un sitio anterior se preservan exactamente—;
búsqueda, SEO y RSS; y el camino de **despublicar**, que es el que se olvida y el
único que importa cuando alguien se arrepiente.

Depende de nada. Se puede empezar.

### 3.2 Identidad entre instancias

*Depende del punto 1 de [README § Pasos futuros](README.md#pasos-futuros).*

Una persona en su Vera es hoy `participant:herbert`, y ese nombre sólo significa
algo dentro de esa base. Para que dos instancias se refieran a la misma persona
hace falta una identidad que cruce la frontera, y que la firma siga probando
autoría al otro lado.

`identity-access.allium` ya fijó la decisión de fondo —una persona se autentica
con la misma credencial que un agente, porque dos nociones de quién escribe
serían una de más—. Falta llevarla entre instancias.

**Pregunta abierta:** si la identidad federada se ancla al dominio de la
instancia —`herbert@vera.ejemplo`, como Mastodon—, mudarse de servidor cambia de
nombre a la persona. En una memoria personal de décadas, eso es más grave que en
una red social. Puede que haga falta una identidad que no dependa de dónde está
alojada.

### 3.3 Grafos compartidos

Que varias personas habiten un mismo grafo, cada una desde su instancia, sin que
ninguna de las instancias sea la dueña.

**El sustrato ya existe y es lo mejor que tiene Vera para esto.** El registro de
operaciones es canónico, cada operación lleva su `originId` como clave de
idempotencia, hay orden total, y el grafo se reconstruye reproduciéndolo entero.
Federar no es inventar un protocolo de sincronización: es **intercambiar tramos
de registro entre instancias**, que es la misma operación que el horizonte 1
construye entre un navegador y su servidor, con otro alcance.

Falta: el proyecto como unidad de gobierno, con membresía y concesiones propias;
precondiciones de edición que impidan pisar lo que otro escribió mientras tanto;
y la reconciliación entre instancias, que hoy no existe en ninguna forma.

**Decidido:** una persona con escritura edita su réplica sin esperar, pero la
biblioteca que compartió la página conserva el canon. Al sincronizar, su
propietario ve las diferencias y acepta o rechaza antes de incorporarlas. Aceptar
preserva la autoría remota; rechazar no reescribe la réplica ajena. Descompartir
corta futuras sincronizaciones y autoridad sin recuperar copias ya distribuidas.
Las contribuciones se revisan como lotes coherentes, grupos cerrados bajo sus
dependencias o bloques completos, nunca como líneas arbitrarias. Si se retira el
origen de un espacio compartido, el espacio continúa normalmente como una sola
bifurcación común con canon nuevo; las ramas personales sólo nacen por una
decisión explícita posterior. Esa continuación la gobiernan primero quienes
conservan autoridad en el espacio compartido; si el grupo no puede ejercerla, la
custodia vuelve a la persona propietaria original que constituyó y sostiene ese
grafo. Sigue abierto cómo se resuelven dos escrituras concurrentes.

**Preguntas abiertas, todas sin respuesta:**

- **Qué se federa.** ¿Páginas públicas? ¿Un grafo entero compartido? ¿Bloques
  sueltos citados desde otra instancia? Cada respuesta es un sistema distinto.
- **Cómo se nombra una página que vive en otra parte.** `[[Página]]` resuelve
  dentro de un corpus. `[[Página@instancia]]` no está decidido, y un enlace que
  cruza la frontera es un enlace que puede romperse por decisión de un tercero.
- **Qué pasa cuando una instancia desaparece.** ¿Lo citado desde ella queda como
  hueco, como copia o como cita muerta? Una memoria que se vacía cuando otro
  apaga su máquina no es soberana.
- **Retracción — principio decidido, protocolo pendiente.** Compartir o publicar
  permite que otras personas, bibliotecas o sitios sincronicen copias. Retirar el
  origen detiene su disponibilidad futura, pero no borra lo que otra soberanía ya
  recibió. Vera debe advertir esta consecuencia antes de compartir y puede
  propagar una petición de retirada; no promete recuperar todas las copias. Falta
  decidir cómo se representa, acusa recibo y audita esa petición. Quien recibió
  el trabajo puede continuarlo como una bifurcación editable con identidad y
  canon nuevos, permanentemente derivada del origen histórico. El origen puede
  terminar el vínculo, no destruir el trabajo ajeno.
- **Moderación y bloqueo.** El fediverso resolvió esto mal y a golpes. Vera no
  puede pretender que el problema no la alcanza en cuanto dos instancias se
  hablen.
- **Autoría a través de instancias.** La procedencia por bloque es la garantía
  central de Vera. Que sobreviva al viaje —y que no se pueda falsificar en el
  camino— es la condición para federar, no un detalle de implementación.

### 3.4 Protocolo: qué se usa

**Sin decidir.** Las dos vías, con lo que cada una cuesta:

- **ActivityPub.** Interoperabilidad inmediata con el fediverso existente, y un
  modelo de contenido —notas, actividades, actores— que no se parece a un grafo
  de bloques con procedencia. Traducir entre ambos pierde exactamente lo que Vera
  conserva.
- **Un protocolo propio sobre el registro de operaciones.** Conserva todo, y no
  habla con nadie más. Aísla.

Puede que la respuesta sea las dos cosas con distinto alcance: ActivityPub hacia
afuera para lo publicado —que alguien pueda seguir un sitio Vera desde
Mastodon—, y sincronización de registro entre instancias Vera para lo compartido.
No está decidido y **se decide en una spec antes que en código**, como todo.

---

## El orden

```
  Umbral 0.1 ── instancia y biblioteca ──────────────────────────┐
       │                                                         │
       ├──► Umbral 0.2 · identidad y autoridad ───► MCP remoto   │
       │             │                                           │
       │             └──► identidad federada y colaboración      │
       │                                                         │
       ├──► Umbral 0.3 · protocolo del bibliotecario             │
       │             └──► cualquier IA lee y escribe con contrato│
       │                                                         │
       └──► Horizonte 3.1 · publicación web                      │
                                                                 │
  Horizonte 1 ── reconciliación local ─► Umbral 0.4 · prototipos │
       │                                      Solid / any-sync   │
       └──────────────────────────────────────► federación ◄─────┘

  Horizonte 2 ── esperas visibles (independiente, empezable ya)
```

Lo que se puede empezar hoy sin depender de decisiones abiertas: **lo que queda
del horizonte 2** —PDF, importación, mapa—, la **publicación web (3.1)** como
proyección estática y la documentación del contrato ya construido en **0.3**.
Exponer el corpus vivo, MCP remoto, multiusuario y federación pasan por la
autenticación humana: mientras exista una vía anónima que escribe como el
propietario, exponer Vera fuera de la máquina es exponer la firma.

---

## Lo que deliberadamente no está en esta hoja de ruta

- **Una nube de Vera.** No hay un servicio central planeado, y la licencia está
  escrita para que cualquiera pueda alojar el suyo — ver
  [`LICENSE-REPLICACION.md`](LICENSE-REPLICACION.md). Si algún día existe una
  instancia alojada de MediaFranca, será una más y no la principal.
- **Un modelo propio, ni entrenamiento con corpus ajenos.** Vera usa modelos que
  corren en la máquina de quien la habita. Lo que se escribe en un Vera no
  entrena nada.
- **Aplicaciones nativas de tienda.** Es una PWA instalable desde la web, sin
  tienda ni permiso de plataforma, y eso es una posición y no una etapa.
- **Editar el corpus desde la proyección Markdown.** La proyección va en una sola
  dirección, a propósito. Dos fuentes de verdad son cero fuentes de verdad.
- **Colaboración en tiempo real sobre el mismo bloque.** Git conserva historia,
  respaldo y transporte, pero no coordina por sí solo la colaboración
  interactiva, y eso es un principio acordado y no una limitación temporal.

---

*Esta hoja se revisa cuando un horizonte se cierra o cuando una pregunta abierta
se responde. Se modifica en su propia rama, como todo — ver
[`CONTRIBUTING.md`](CONTRIBUTING.md).*
