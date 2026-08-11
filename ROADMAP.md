# Hoja de ruta

Lo que viene, en el orden en que unas cosas condicionan a otras. **Nada de lo que
está aquí está construido**; lo construido se cuenta en el
[README](README.md#estado) y en las specs.

Este documento no promete fechas. Dice **qué falta, por qué importa, qué lo
bloquea y qué preguntas siguen abiertas**. Una hoja de ruta con fechas y sin
preguntas abiertas es una lista de deseos con formato de plan.

> Las cuatro direcciones estructurales —instanciación multiusuario, MCP remoto,
> modularización, proyectos colaborativos— están descritas en
> [README § Pasos futuros](README.md#pasos-futuros) y no se repiten aquí.
> Este documento añade los tres horizontes que hoy mandan sobre la experiencia:
> **que la mano no espere**, **que la espera se vea** y **la federación**.

---

## Horizonte 1 — Que la mano no espere

**Estado: en curso, rama `v0.4-local-first`. Pasos 0 a 3 hechos; 4 y 5 no.**

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
pestaña y se drena solo cuando vuelve la red.

### 1.1 El cursor y lo que llega — *paso 4*

`canonical_cursor` por réplica, `GET /ops?since=` en segundo plano, y aplicar lo
que llegue **sin recargar la página**. El transporte ya existe entero en
`server.ts` y no tiene un cliente que lo llame.

Levanta los dos límites que el paso 3 dejó escritos:

- **Sin servidor, la aplicación no abre.** Lo escrito está a salvo, pero leer
  sigue siendo *server-first*: al recargar sin red se ve «no se pudo hablar con
  el servidor» y nada más.
- **La primera escritura de un día necesita red.** Nace con un `create_page` que
  la réplica difiere, y un solo gesto que espera basta para que la promesa no se
  cumpla.

### 1.2 Los conflictos — *paso 5*

Exponer la divergencia en vez de elegir en silencio, y las tres resoluciones que
la spec nombra. Un local-first que resuelve conflictos callando es un
local-first que pierde texto sin decirlo.

### 1.3 Cuánto cabe en un teléfono

**Pregunta abierta que muerde en 1.1.** Un corpus de 1.979 páginas y 48.129
bloques no se replica entero en un móvil. Falta decidir qué se replica, con qué
criterio, y **qué está disponible antes de terminar de hidratarse** — porque la
respuesta «nada hasta que termine» convierte el local-first en una pantalla de
carga más larga.

### 1.4 Lo que sigue sin decidirse

- Qué pasa con lo pendiente cuando la credencial caduca con el aparato sin red.
- Qué camino de recuperación conserva lo pendiente cuando el almacén local está
  lleno, no disponible o corrupto.
- Qué cambios sobre el mismo sujeto se pueden fundir solos.

### 1.5 Deuda menor, ya detectable

Los comentarios de `main.ts:122` y `main.ts:159` siguen diciendo que la bandeja
no es durable y que cerrar la pestaña pierde lo pendiente. El paso 3 lo cambió;
el texto que la persona lee al quedarse sin red todavía no.

---

## Horizonte 2 — Que la espera se vea

**Estado: la doctrina está escrita y probada en un solo sitio. Falta el resto.**

Local-first quita casi todas las esperas. Las que quedan son las verdaderas —el
modelo local, la transcripción, la composición del PDF, la primera hidratación—
y son largas. Una espera larga sin realimentación es peor que una espera larga,
porque además de esperar hay que decidir si el programa murió.

### 2.1 La regla, que ya existe

Está en [`packages/web/src/waiting.ts`](packages/web/src/waiting.ts) y se resume
en cuatro decisiones que **no se van a revisar**:

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

### 2.2 Dónde falta hoy

`waiting.ts` sólo lo usa el panel de procesar. Todo lo demás dice una palabra y
se queda callado:

| Dónde | Qué dice hoy | Qué falta |
| --- | --- | --- |
| **Transcribir un audio** (`audio-block.ts:275`) | `transcribiendo…`, fijo | Es **la espera más larga de Vera** — minutos con un audio de media hora— y la que menos dice. Prioridad 1. |
| **Una consulta al grafo** (`query-block.ts:78`) | `preguntando…`, fijo | Contador tras 900 ms. Una consulta amplia sobre 48.129 bloques no es instantánea. |
| **Abrir una página** (`main.ts:539`) | El título de destino tras 300 ms | Está bien resuelto; falta el contador si se pasa de unos segundos. |
| **Exportar a PDF** | El navegador sin ventana compone en el servidor | Sin señal alguna hoy. |
| **Importar un documento** | — | Un `.docx` grande no dice nada mientras se lee. |
| **Dibujar el mapa** | — | Con proximidad 3 sobre un corpus grande, el cálculo de fuerzas se nota. |
| **Arranque en frío** | — | Hidratar la réplica es la espera que va a **aparecer** con el horizonte 1, no a desaparecer. |

### 2.3 Lo que hay que decidir

- **Dónde va el contador.** El usuario pidió «un timer al medio». Hoy vive en la
  línea del registro de procesar. Para una espera modal —transcribir, componer
  un PDF— probablemente corresponde el centro de lo que se está esperando, y no
  una esquina. Falta resolverlo como decisión de composición, no caso por caso.
- **Un solo componente.** Que cada espera resuelva la suya es cómo se llega a
  siete realimentaciones que no se parecen. El contador debe ser uno, con su
  clave de medición, y las llamadas lo piden.
- **Qué pasa cuando se pasa de lo razonable.** Después de un umbral, un contador
  que sube solo también deja de informar. Hace falta decir qué se ofrece
  entonces: cancelar, seguir en segundo plano, o al menos nombrar qué se está
  esperando.

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

**Preguntas abiertas, todas sin respuesta:**

- **Qué se federa.** ¿Páginas públicas? ¿Un grafo entero compartido? ¿Bloques
  sueltos citados desde otra instancia? Cada respuesta es un sistema distinto.
- **Cómo se nombra una página que vive en otra parte.** `[[Página]]` resuelve
  dentro de un corpus. `[[Página@instancia]]` no está decidido, y un enlace que
  cruza la frontera es un enlace que puede romperse por decisión de un tercero.
- **Qué pasa cuando una instancia desaparece.** ¿Lo citado desde ella queda como
  hueco, como copia o como cita muerta? Una memoria que se vacía cuando otro
  apaga su máquina no es soberana.
- **Retracción.** Si alguien despublica o borra algo que otras instancias
  copiaron, ¿qué se puede exigir y qué se puede sólo pedir?
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
  Horizonte 1 ─── que la mano no espere ──────────────┐
  (en curso)                                          │
                                                      ▼
  Horizonte 2 ─── que la espera se vea ───────► independientes entre sí;
  (empezable ya)                                los dos son experiencia
                                                      │
  README §1 ────── multiusuario ──────────────────────┤
  (precondición de casi todo)                         │
       │                                              ▼
       ├──► README §2 · MCP remoto            Horizonte 3.1 · publicación web
       │                                      (empezable ya, no depende de nada)
       ├──► README §3 · modularización
       │                                              │
       └──► Horizonte 3.2 · identidad federada ───────┤
                     │                                │
                     └──► Horizonte 3.3 · grafos compartidos
                              │
                              └──► README §4 · proyectos colaborativos
```

Dos cosas se pueden empezar hoy sin depender de nada: **el horizonte 2** y la
**publicación web (3.1)**. Todo lo demás pasa por la autenticación humana, que es
la deuda que bloquea el resto del proyecto: mientras exista una vía anónima que
escribe como el propietario, exponer Vera fuera de la máquina es exponer la
firma.

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
