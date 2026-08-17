# Manual de Vera

> **Importado desde el corpus.** Este documento es la proyección de la página
> **«Vera — Manual»** (`page:110183`, 197 bloques), escrita dentro de Vera y
> traída aquí para que exista fuera de la instancia de quien la escribió.
>
> **El original vive en el corpus y es donde se edita.** Al reimportarlo,
> rehacer esta proyección; no corregir aquí y esperar que suba.
>
> Al importarlo se corrigió una sección: «Lo que Vera todavía no hace» seguía
> diciendo que no había deshacer ni recorridos, y las dos cosas se construyeron
> después de que se escribiera. La corrección está señalada en su sitio.

---

## Antes de nada

Vera es una memoria personal. Se escribe en bloques, se enlaza con `[[corchetes
dobles]]` y todo lo que se escribe queda en un registro que se puede auditar
entero. Corre en tu máquina; el corpus no sale de aquí.

**No hay botón de guardar.** Lo que escribes baja al grafo tras novecientos
milisegundos de silencio, y otra vez al salir del bloque. Si falla la red, el
bloque se marca y lo reintenta; no se pierde lo escrito.

**Sí hay deshacer.** `Ctrl/Cmd + Z` fuera del editor devuelve esta página al
momento anterior, y `Ctrl/Cmd + Shift + Z` lo rehace; los dos están también en el
menú `⋮`. Deshace un **gesto** —lo que hiciste de una vez— y no una tecla: unir
dos bloques con un retroceso son cinco operaciones y se deshacen juntas. Dentro
del editor manda el deshacer del navegador, que es de otra escala.

No hay pila de deshacer y no hace falta: el registro ya guarda todos los estados
anteriores, así que deshacer se calcula leyéndolo hacia atrás. Sobrevive a cerrar
el navegador y a reiniciar. Y lo que aplica son operaciones nuevas, firmadas:
nada se borra del registro, y por eso deshacer se puede deshacer.

Se deshace lo tuyo y sobre la página que estás mirando. Lo que escribió un agente
o el modelo local no se deshace: eso se corrige escribiendo, y el cambio queda
firmado con tu nombre. Devolver una página entera borrada todavía no se puede.

La pantalla tiene dos columnas: el mapa a la izquierda —lo general— y el texto a
la derecha —lo particular—. El switch de la barra alterna entre sólo mapa, las
dos, y sólo texto. En un teléfono nunca hay dos columnas.

El logotipo, arriba a la izquierda, lleva **al día de hoy**. Es la casa: el sitio
desde el que se escribe sin haber decidido antes dónde.

---

## Escribir

Una página vacía ya trae el cursor puesto. El primer bloque nace cuando escribes,
no cuando miras: mirar una página en blanco no deja nada en el registro.

### Las teclas que dan forma

| Tecla | Qué hace |
| --- | --- |
| `Enter` | Parte el bloque por donde está el cursor. Si el bloque tiene hijos, la segunda mitad nace como **primer hijo**; si no los tiene, como **hermano siguiente**. |
| `Enter` al principio, con texto detrás | No parte: **mete un bloque vacío encima**. Así el bloque conserva su identidad, sus hijos y las referencias que le apuntan. |
| `Shift + Enter` | Salto de línea **dentro** del mismo bloque. Es la única forma de tener un párrafo de varias líneas en un bloque. |
| `Cmd/Ctrl + Enter` | Sale del bloque sin partirlo. |
| `Tab` | Indenta: el bloque pasa a ser hijo del hermano de encima. Sin hermano encima, lo dice y no hace nada. |
| `Shift + Tab` | Desindenta: pasa a colgar del abuelo, justo detrás de su antiguo padre. |
| `Retroceso` al principio | Funde con el bloque de encima y deja el cursor en la juntura. Si el de encima está vacío, desaparece **el de encima** y no el que escribes. Si los dos tienen hijos, se niega: el orden sería ambiguo. |
| `↑` `↓` | Sólo saltan de bloque cuando el cursor está en la primera o la última línea. Dentro de un bloque de varias líneas se mueven por las líneas. |
| `Escape` | Sale del bloque. **Guarda, no descarta**: lo escrito ya bajó al grafo. |

### Varios bloques a la vez

- `Shift + clic` en otro bloque escoge el tramo entre los dos, en el orden en que
  se leen. No abre el editor.
- `Shift + ↑` y `Shift + ↓` estiran o recogen el tramo por el extremo suelto.
- `Tab` y `Shift + Tab` indentan el tramo entero; lo escogido sigue escogido para
  poder repetir.
- `Retroceso` o `Suprimir` eliminan lo escogido **y todo lo que cuelgue de ello**.
  Pregunta antes, diciendo cuántos bloques se lleva por delante.
- `Escape` deshace la selección.

### Paréntesis y comillas

Al teclear `(`, `[`, `{`, `"` o `` ` `` se escribe también su pareja y el cursor
queda en medio. Con texto seleccionado, lo envuelve. Y si el cierre ya está bajo
el cursor, se salta en vez de duplicarse.

### Plegar

El chevrón a la izquierda de la viñeta pliega un bloque, y sólo aparece si tiene
hijos. Plegar **no es un cambio**: no deja operación ni revisión, porque es cómo
lo estás mirando y no qué dice.

### Incrustar algo que corre

Un bloque cuyo texto entero es un `<iframe src="https://…"></iframe>` se presenta
como un marco encerrado, con quién lo aloja escrito debajo. Entero: si el
`<iframe>` está dentro de una frase, o hay dos en el mismo bloque, se lee como
texto. Todo el demás HTML que escribas se lee como texto, siempre.

Sólo entra lo que viene de un servidor que tú registraste en `[[Ontología]]`,
bajo «Incrustaciones», y sólo por `https`. Sin lista no entra nadie: una dirección
se copia y se pega sin mirar, y lo incrustado corre dentro de tu página.
Registrar `github.io` deja entrar a cualquiera que publique ahí; para uno solo,
escribe el nombre entero.

Lo incrustado corre encerrado: no alcanza tu grafo, ni tu sesión, ni la página
que lo contiene, y la petición no dice desde qué nota se hizo. No se pide hasta
que llegas a él. Pulsar el bloque te devuelve el `<iframe>` tal como lo
escribiste, y se corrige como cualquier otro texto.

Un `height="574"` en el marcado manda; sin él, 460 píxeles.

### HTML, p5.js y SVG propios

Los comandos `/html`, `/p5js` y `/svg` crean bloques completos para contenido
que escribes deliberadamente. HTML y p5.js pueden ejecutar código; SVG permite
pegar directamente el marcado de una ilustración. El mismo código pegado como
Markdown corriente sigue viéndose como texto y no se activa retrospectivamente.

Los tres se presentan en un recinto aislado, sin acceso al grafo, la sesión ni
el almacenamiento de Vera. Reciben sólo los tokens visuales vigentes —fondo,
texto, bordes, acento y tipografías— y ajustan su altura al contenido, con un
límite que impide que una medida absurda vuelva inutilizable la página. Cambiar
de tema o editar los tokens actualiza también los bloques que están a la vista.
La fuente queda siempre disponible bajo la ilustración o ejecución.

### Dibujar a mano

`/dibujo` abre un lienzo a pantalla completa. No hay paleta, ni grosores, ni
goma: la tinta es el color del texto de la página, el papel es su fondo, y el
grosor sale de la presión del lápiz. No hay nada que elegir, así que no hay nada
que ofrecer.

`Esc` o `Enter` cierran, y las dos guardan: en un dibujo hecho a mano no existe el
momento en que uno decide si lo quiere, ya lo hizo. Lo que no quieras, deshazlo.
Con el dedo, el botón **listo**.

Mientras dibujas: `Ctrl/Cmd + Z` quita el último trazo y `Ctrl/Cmd + Shift + Z`
lo devuelve. Con la mano, **tocar con dos dedos** deshace. Y con dos dedos también
se acerca y se arrastra —el dibujo es vectorial, acercarse no pierde nada—, pero
la lente no queda escrita: al cerrar se ve el dibujo entero.

Lo dibujado se ve del tamaño de sus trazos más un margen, y se encoge si no cabe
en la columna. Un garabato pequeño se ve pequeño.

Tocar un dibujo terminado vuelve a abrir el lienzo con lo que había: seguir
dibujando es seguir, no empezar otro.

Los trazos son el texto del bloque —una valla ` ```dibujo ` con un renglón por
trazo—, así que un dibujo se versiona, se deshace, se mueve, se copia y viaja al
Markdown como cualquier bloque. Y lleva su canal: **dibujado**, que es
denominación de origen humana, como la voz. En un corpus donde también escriben
máquinas, eso no es un detalle.

---

## Los comandos: la barra `/`

Escribe `/` al principio de un bloque o tras un espacio, y se abre la lista. Se
filtra por el nombre **o por la descripción**, así que `/consulta` encuentra `/?`.

| Comando | Qué hace |
| --- | --- |
| `/titulo` `/subtitulo` | Encabezados de primer y segundo nivel. |
| `/cita` `/codigo` `/mermaid` `/tabla` `/linea` `/lista` `/numerada` `/tarea` `/nota` | Lo que dicen; el cursor queda dentro, listo para escribir. |
| `/pagina` | Inserta `[[]]` con el cursor entre los corchetes. |
| `/hoy` | Escribe la fecha de hoy como enlace. |
| `/fecha` | Abre el calendario y escribe la que elijas. |
| `/audio` | Graba aquí mismo. Si el bloque tenía texto, la grabación va a un bloque nuevo debajo: la transcripción no pisa palabras. |
| `/import` | Trae un `.md`, `.txt` o `.docx` como página nueva y te lleva a ella. |
| `/dibujo` | Abre el lienzo a mano alzada. |
| `/zotero` | Busca en tu biblioteca y deja el enlace a la página del ítem. |
| `/?` | Convierte el bloque en una **consulta al grafo**. |

---

## Enlazar y referirse

`[[` abre el buscador de páginas. `((` el de bloques —para citar un bloque
concreto—. `#` las etiquetas, y `#[[` las que llevan espacios.

**Una página se crea pulsando un enlace que no existe.** No hay botón de página
nueva: escribes `[[Lo que sea]]`, lo pulsas, y nace vacía y privada. Es
deliberado: una página nace porque hizo falta nombrarla.

Pulsar una `((referencia))` lleva al bloque, no sólo a su página, y el bloque
destella dos segundos al llegar.

Volver a poner el cursor dentro de un `[[enlace]]` ya escrito reabre la búsqueda
para corregirlo.

---

## La viñeta de un bloque

Pulsar el `•` abre su menú. Lo que dice el propio punto, sin abrirlo: el
identificador del bloque, si nació de una grabación, y si lo escribió un agente.

- **Copiar referencia** — `((id))` al portapapeles, para citar este bloque desde
  otro sitio.
- **Copiar identificador** y **Copiar el Markdown del bloque**.
- **Procesar el bloque** — ver abajo.
- **Explicar relación…** — dice por qué esta página y otra se tocan. Ver
  [Relaciones](#relaciones-y-referencias).
- **Subir** y **Bajar** — intercambian con el hermano de al lado, arrastrando lo
  que cuelgue.
- **Enfocar en este bloque** — reenraiza la vista en ese subárbol; aparece una
  barra para salir. Deshabilitado si el bloque no tiene hijos.
- **Eliminar bloque** — deshabilitado si tiene hijos: el dominio sólo borra
  hojas, y eso impide que un borrado se lleve por delante lo que había dentro sin
  decirlo.
- **Ver la historia del bloque** — todo lo que ese bloque dijo alguna vez, con
  cuándo, quién lo escribió y por qué canal, y cada estado se puede copiar. No
  sale de una copia guardada aparte: sale del registro, que lo tenía desde el
  principio. **Cuando algo parezca perdido, éste es el sitio donde se comprueba
  que no lo está.**

### Procesar el bloque

Le da al modelo local lo que escribiste como pedido, y la respuesta ocupa el sitio
del bloque, con sus ítems colgando. Escribe «hazme una lista de compras con
tomate cherry, quesos, coliflor y after shave», procesa, y el bloque pasa a
llamarse «Lista de compras» con los ítems agrupados debajo.

- El pedido no se pierde: queda en las revisiones del bloque y en el log, como
  cualquier edición. Deja de estar a la vista, que es distinto de desaparecer.
- Lo que salga queda firmado por el **modelo local** —no por `[[Cotito]]`, que es
  el bibliotecario y tiene criterio sobre el corpus— y por eso el bloque se dibuja
  como generado en cuanto se procesa. La autoría cambia de mano porque el texto lo
  escribió una máquina.
- Lo que ya colgaba del bloque se queda donde estaba y viaja como contexto: un
  bloque que dice «lista de compras» con seis bloques debajo es un pedido de siete
  líneas, no de una.
- Tarda lo que tarde: el modelo corre en tu máquina, que es lo que hace que el
  pedido no salga de casa. Mientras lee, el bloque se ve ocupado.
- Se aplica y ya. No hay panel donde revisarlo antes ni deshacer después; lo que
  quedó mal se corrige escribiendo, como todo lo demás.

---

## La cabecera de la página

El **título** se pulsa y se renombra ahí mismo. El de un día no: su título es su
identidad, no una etiqueta.

**pública / privada** — el interruptor de arriba. Toda página nace privada. Ver
[qué significa hoy](#privado-público-y-qué-significa-hoy).

**fecha de creación** y **fecha de actualización** — no se editan; se pulsan y
llevan a la bitácora de ese día.

**Las propiedades** se editan pulsándolas: la clave para renombrarla, el valor
para cambiarlo. La cruz la quita. `+ propiedad` añade una.

Si el corpus contesta esa clave con pocas palabras distintas, aparece un chevrón
con las más usadas. Si no, se escribe: Vera no obliga a elegir de una lista que no
existe. Un valor con comas son **varias respuestas**, y cada una es un enlace a su
página.

El botón `⋮` —«Más de esta página»— trae: **Procesar la página**, **Copiar el
Markdown**, **Descargar como .md**, **Exportar a PDF** y **Eliminar la página**.
Eliminar dice cuántos bloques se lleva, los borra de abajo arriba uno a uno —cada
uno auditable— y al terminar te deja en el día de hoy.

**Exportar a PDF** descarga el PDF que compone el servidor, no abre el diálogo de
impresión: así el archivo es siempre el mismo documento y no depende de los
márgenes ni del papel que tengas configurados. Sale en carta, sin fondo, sin las
propiedades de la cabecera, sin las referencias del pie y sin la sangría del
esquema —texto seguido—. Una incrustación no se imprime: en su lugar aparece de
dónde venía.

---

## Procesar la página

Es el gesto que más cambia una página, así que conviene saber exactamente qué
hace. Se pide a mano desde `⋮`; **nunca ocurre solo**. El panel cuenta lo que va
pasando mientras pasa.

### Lo que arregla solo, sin preguntar

Es la **puesta en forma**, y son seis arreglos que no interpretan nada: borrar
bloques vacíos; separar un encabezado de su desarrollo pegado; marcar como título
lo que ya se comportaba como título; partir un párrafo largo por donde ya venía
partido; subir un encabezado que colgaba de otro más hondo; y hacer que cada
encabezado se lleve lo que encabeza.

**El texto nunca se reescribe**: se corta, se le prefija un `#` y se cambia de
sitio. Nada añade ni quita sentido, y por eso puede ocurrir sin preguntar.

**No se toca** un bloque con vallas de código, tabla, fórmula o propiedades
dentro: ahí las líneas significan algo juntas.

Cada paso entra por la vía normal, con su autoría y su registro. Pero **no hay
deshacer**.

### Lo que propone, y no escribe hasta que aceptas

- `type::` — uno o dos tipos, y sólo del vocabulario; lo inventado se descarta.
- `concepto::` — de dos a cinco asuntos. Cada uno dice si **ya es página del
  corpus** y con cuántos enlaces, para no partir en dos un vecindario que era uno.
- **Enlazar menciones** — títulos que la página nombra sin enlazar. Envuelve la
  palabra tal como está escrita, no el título. Un título de una sola palabra sólo
  cuenta si está escrito idéntico y en mayúscula, para no llenar el grafo de
  aristas que no dicen nada.
- **Titular un enlace desnudo** — la dirección no se sustituye: se envuelve con su
  título.

Cada sugerencia tiene dos botones, aceptar y descartar, y al pie «aplicar los N».
Descartar no deja rastro.

### Lo que sólo describe

La **forma** de la página: cuántos bloques, cuántas secciones, y los defectos que
ve —párrafos largos sin partir, listas sin profundidad, encabezados colgando de
otro más hondo—, cada uno con la cuenta que lo sostiene, para que puedas no estar
de acuerdo con conocimiento. No lleva botón.

### Lo que declara que no pudo hacer

- Si no hay modelo local instalado, lo dice —y sigue haciendo todo lo que no lo
  necesita.
- Si la página es más larga de lo que el modelo puede leer, dice cuántas partes
  leyó y cuántos caracteres quedaron fuera. El tope son ocho partes, unos
  veinticuatro mil caracteres.
- De cada enlace externo que no contestó, la razón. Resolver enlaces es un acto
  hacia fuera y sólo ocurre porque lo pediste sobre esta página.

---

## Preguntarle al grafo

Un bloque que **empieza por `?`** es una pregunta. Se contesta cada vez que se lee
la página, contra el grafo como esté entonces, y la respuesta no se guarda: una
lista guardada envejece sin decirlo. `/?` pone la marca y deja el cursor detrás.

### La sintaxis, entera

| Forma | Qué selecciona |
| --- | --- |
| `clave=valor` | La propiedad vale eso. La clave es la que tu corpus escribe, aunque la cabecera la enseñe traducida. `tipo=proyecto` |
| `clave=` | Lleva esa clave, con el valor que sea. `concepto=` |
| `~texto` | El contenido lo contiene. `~pictogramas` |
| `->[[Página]]` | Enlaza a. |
| `<-[[Página]]` | Enlazada desde. |
| `!` | Niega. |
| `+` | Y. |
| `*` | O. |
| `( )` | Agrupa. |
| `; tabla` | Al final, la lee como tabla; sin eso, como lista. |

Un valor puede llevar espacios sin comillas —`estado=en revisión`—; las comillas
sólo hacen falta si el valor lleva alguno de los signos.

**Mezclar `+` y `*` sin paréntesis se rechaza.** No hay precedencia que haya que
saberse: una consulta que selecciona algo distinto de lo que su autor leyó es peor
que una que no corre.

### Ejemplos

```
? tipo=proyecto ; tabla
? concepto=AAC + tipo=nota
? ->[[Vera]] * <-[[Vera]]
? tipo=proyecto + !~borrador
? concepto= + !tipo=        ← las que tienen concepto y no dicen qué son
```

### Cuando no entiende, lo dice

Una pregunta rota señala el término que la rompe, en vez de contestar cero. Cero
es una respuesta, y darla cuando no se entendió la pregunta es mentir con la forma
correcta.

Cuando no cumple ninguna, enseña **la pregunta tal como Vera la entendió**. Así se
distingue «el corpus no tiene nada» de «preguntaste otra cosa».

Si hay más de doscientas, manda doscientas y dice cuántas faltan.

---

## Relaciones y referencias

Al pie de cada página hay dos cosas distintas, y conviene no confundirlas.

### Referencias

**Nombra a** y **La nombran**, a la par, y debajo **En los dos sentidos** para las
que se nombran mutuamente. Son las menciones: quién escribió el nombre de quién.

Cada renglón lleva una **pluma**. Pulsarla abre una caja para decir *por qué* esas
dos páginas se tocan: `profundiza: su rejilla se vuelve generativa`. Lo de delante
de los dos puntos es el término y puede faltar.

Todo el pie se pliega, sección por sección.

### Relaciones explicadas

**Afirma sobre otras** y **Afirman sobre ésta**. Son las que alguien escribió a
mano: una frase que dice qué tiene que ver esta página con aquélla.

Se escriben como un bloque que cuelga de aquel desde el que se afirma, con
`explica:: [[Página]]` y, si quieres, `término:: profundiza`. Desde el menú de la
viñeta se escribe en una línea: `profundiza [[Guemil]]`.

Un entrante se lee **con el recíproco**: lo que ésta afirma es que *profundiza* a
aquélla, y lo que aquélla lee es que *es profundizada por* ésta.

El término es opcional. Explicar no exige clasificar. Los que Vera trae:
profundiza, contradice, respalda, ejemplifica, generaliza, precede a, nace de, y
tres simétricos —se opone a, dialoga con, es lo mismo que. Se cambian en la página
de ontología, bajo un bloque que empiece por «Relaciones».

Borrar el bloque borra la relación, porque la relación **era** el bloque. No hay
tabla aparte.

---

## El mapa

Un nodo **es su nombre**: no hay círculos. La letra crece con lo escrito en esa
página, y la que estás leyendo va en grande. Las cinco últimas por las que pasaste
se marcan en cálido, desvaneciéndose.

### Gestos

- Un clic **señala** sin salir de lo que lees; **doble clic abre**. En pantalla
  táctil, un toque hace las dos cosas.
- Pasar por encima apaga el resto y enciende esa página con lo que nombra.
- En 3D: arrastrar gira; dos dedos o `Shift + arrastrar` corren el mapa sin
  girarlo; la rueda y el pellizco acercan.
- En 2D: arrastrar el fondo desplaza; la rueda acerca.

### El ojo, arriba a la izquierda

Abre los controles sin tapar el mapa: **dimensión** (2D o 3D) y **proximidad**,
que es cuántos saltos desde la página que lees se dibujan. Va de uno a tres.
Cambiarla olvida las posiciones, porque ya no es el mismo grafo.

Al pie del mapa, el **rastro**: las últimas seis páginas por las que pasaste, la
actual marcada. Se pulsan y llevan allí.

---

## La voz

El micrófono de la barra graba **en el día de hoy**, creándolo si no existe.
`/audio` graba en el bloque donde estés.

Empieza sola: escribir `/audio` o pulsar el micrófono ya es haber decidido hablar.
Mientras graba se ve el punto rojo, el cronómetro y un medidor que se mueve —la
prueba de que hay alguien al otro lado, porque grabar una pista muda produce una
grabación perfecta y vacía.

**detener** guarda y sube; **descartar** no sube nada. La pantalla no se apaga
mientras dictas.

Después, el bloque tiene el audio arriba y su texto debajo, editable. **Nada se
transcribe sin pedirlo**: hay un botón «transcribir», y otro para volver a hacerlo
—avisa antes si el texto se editó a mano.

«borrar el audio» suelta los bytes y deja lo escrito, diciendo de dónde vino. Si
no había transcripción, avisa de que no quedará nada de lo que se dijo.

Hace falta tener instalados **ffmpeg** y **whisper.cpp** con su modelo. Si faltan,
grabar sigue funcionando y transcribir dice exactamente qué falta. El servidor lo
dice también al arrancar.

---

## Traer documentos de fuera

`/import` acepta `.md`, `.markdown`, `.txt` y `.docx`. Crea una **página nueva**
—nunca funde con una que exista; si el título está tomado, nace como «Título (2)»—
y te lleva a ella.

De un Markdown no se pierde nada. De un `.docx` **sí**, y lo dice: las tablas
llegan como párrafos sueltos —el texto está, la rejilla no— y las imágenes no
llegan. Lo que no declara y también se pierde: negritas, cursivas, notas al pie y
comentarios.

El archivo se lee entero antes de escribir nada: si no se puede leer, no queda una
página vacía que borrar.

---

## Buscar

La lupa de la barra busca en títulos, contenidos y valores de propiedad a la vez,
con el extracto donde aparece. `Escape` la vacía y la cierra.

Mientras escribes salen primero las **páginas que se llaman así**, al instante y
sin pedirle nada al servidor: el índice de títulos ya está en memoria. Debajo,
cuando llegan, los bloques que lo dicen. `↑` y `↓` señalan y `Enter` abre lo
señalado —o el primero, si no señalaste nada—, así que escribir el nombre de una
página y pulsar Enter lleva a esa página.

Buscar es otra cosa que preguntar: **la búsqueda encuentra texto, la consulta
selecciona páginas por lo que son.**

---

## Ajustes

**Memoria** — cuántas páginas y bloques hay, por qué número de operación va el
registro, y las páginas que gobiernan a Vera. Si una no está, lo dice: rige lo que
Vera trae.

**Teclado** — la lista entera de atajos, gestos y comandos, leída de donde la
aplicación los toma. No cambia nada: es la ayuda, y no puede quedarse
desactualizada.

**Apariencia** — claro y oscuro con paletas independientes, todos los colores
—incluidos los del mapa—, cuánto se agranda todo en el teléfono, hasta dónde llega
una línea de prosa, y las tipografías. Y un botón para volver a los valores de
origen.

Tres tokens gobiernan la talla: **tamaño del texto** —lo que se lee, y lo mismo
que se ve al editar—, **tamaño en el teléfono** —cuánto se agranda la interfaz en
una pantalla estrecha— y **sangría por nivel**. En un teléfono el texto sube un
poco sobre su tamaño de base, porque se lee de cerca y en movimiento, y el escalón
del esquema baja al 80%, porque lo que dice ya lo dicen la viñeta y su línea.

---

## La bitácora

Un día **es una página cuyo título es una fecha**. No hay tabla de días ni sección
aparte.

Abrir hoy no crea nada: si no hay nada escrito se ve el día vacío y un botón
«escribir». Un día vacío no es un hecho sobre una vida, es un hecho sobre un
calendario.

Al escribir, la página nace con `type:: bitácora`, y ese tipo no se le puede
quitar.

Los días se leen **de corrido**: al bajar se montan solos los anteriores, hacia
atrás y sólo los que existen. La dirección no cambia al bajar.

---

## Páginas especiales

Una página es especial porque **lo dice en una propiedad** que cualquiera puede
leer y cambiar: `special-kind::`. Vera no guarda una lista privada de títulos que
trata distinto.

`special-kind:: ontology` gobierna dos cosas, en dos bloques suyos: los **tipos**
con que se clasifica —los hijos de un bloque que empiece por «Tipos iniciales»,
separados por `·`— y el **vocabulario de relaciones** —los hijos de uno que empiece
por «Relaciones», con el recíproco detrás de `·`.

Se relee sola: cambiarla surte efecto sin reiniciar nada. Y si falta, no pasa
nada: rige lo que Vera trae. La página **pisa** los valores por defecto; no los
suministra.

- **`[[Propiedades]]`** — cada propiedad de este corpus y qué clase de campo es:
  **texto**, **número**, **fecha**, **enlace** —nombra otra página—, **sí/no** o
  **una de**. Un bloque por propiedad con `campo::`, `varios::` si admite varias
  respuestas, `valores::` cuando son una lista corta, y `papel::` cuando cumple uno
  de los papeles que Vera necesita conocer.
- **`[[Objetos]]`** — las clases de cosa que el corpus reconoce y qué propiedades
  constituyen a cada una, con `propiedades::`. Los nombres de estas clases son los
  valores que puede tomar `tipo`.

Declarar describe y no obliga: nada se rechaza por tener una propiedad sin
declarar ni por que le falte lo que su clase espera. Lo que sí cambia es que `+
propiedad` ofrece primero lo que a esta página le falta, y cada una se ofrece con
su clase de campo detrás.

Una página especial de tipo `service` —como `[[Zotero]]`— lleva arriba el panel de
su conexión: la clave, con qué biblioteca habla, cuántas páginas vinieron de ahí, y
un botón para probarla. **La clave no se escribe en un bloque**: vive fuera del
registro, porque el registro sólo sabe añadir y una clave escrita ahí no se puede
desescribir. Olvidarla la borra de verdad.

Y `/zotero` desde cualquier bloque busca por autor, título o año y deja el enlace a
la página del ítem, que nace si no estaba y se refresca si Zotero tiene algo más
nuevo. Lo que ya está en el corpus se marca en la lista, para no citarlo dos veces
sin darse cuenta.

---

## Privado, público, y qué significa hoy

Toda página nace **privada**. El interruptor de la cabecera la hace pública y,
por tanto, elegible para publicar; todavía no la pone en un sitio. En una página
pública aparece la fila **sitio**: ahí se elige su dirección estable, se publica,
se hace portada o se retira. Retirarla no borra la página ni vuelve privada su
contenido dentro de Vera.

Lo que sí hay: el servidor escucha sólo en esta máquina, y si lo abres a la red
avisa al arrancar de que cualquiera que alcance ese puerto escribe como tú.

---

## Dónde vive todo

El corpus está en **`data/vera.sqlite`**. Su control de acceso son los permisos
del sistema de archivos, y eso es la decisión, no un descuido.

Lo canónico es el **registro de operaciones**: cada cambio, con quién, cuándo, por
qué canal y sobre qué. Las tablas de estado son su materialización, y al arrancar
el grafo se reconstruye reproduciéndolo entero.

Los binarios —audios, imágenes— viven en **`objects/`**, guardados por el hash de
su contenido. Los mismos bytes dos veces son un archivo, y un archivo guardado no
se puede pisar por accidente.

A git no va el corpus: va la **proyección Markdown**, determinista, a un
repositorio aparte. Editar ahí no cambia nada en Vera: la proyección va en una sola
dirección.

Lo que **no** pasa por el registro, a propósito: plegar un bloque, las preferencias
de apariencia, y las credenciales de los agentes. Ninguna dice nada sobre el
corpus.

---

## Cuando algo cambia en el código

`./scripts/serve.sh restart` — el cliente se recompila y el servidor lo relee
solo, pero **el dominio se carga una sola vez al arrancar**. Un cambio en las
reglas no llega hasta que el proceso vuelve a nacer, y no avisa: la aplicación
sigue respondiendo, con las reglas viejas.

`./scripts/deploy.sh "mensaje"` — comprueba tipos, pruebas y specs, compila,
comitea, empuja, reinicia si hizo falta, y **verifica que lo que el servidor sirve
es lo que se acaba de compilar**. Si no coinciden, se planta.

---

## Lo que Vera todavía no hace

> **Corregido al importar.** El original decía «No hay deshacer, en ninguna
> parte» y «No hay recorridos todavía». Las dos cosas se construyeron después de
> que se escribiera esa sección: deshacer y rehacer, calculados sobre el registro
> —y documentados al principio de este mismo manual—, y los recorridos, que se
> crean andando, se leen en su página y se ven en el mapa. La corrección debe
> bajar también a la página del corpus.

- **No hay papelera**: lo borrado se borró.
- **No se puede crear una página desde un botón**; se crea nombrándola. Es
  deliberado.
- **No se puede devolver una página entera borrada.** Deshacer alcanza a los
  gestos sobre una página que existe.
- **No se puede deshacer lo que escribió un agente o el modelo local.** Eso se
  corrige escribiendo, y el cambio queda firmado con tu nombre.
- **La puesta en forma de «procesar la página» no se deshace.**
- **No se puede preguntar por relaciones explicadas**: la consulta mira
  propiedades de página y eso es una propiedad de bloque.
- **Un recorrido no se puede podar ni publicar.** Se crea andando y se guarda; el
  argumento vivo y su publicación, no.
- **El sitio público todavía no tiene búsqueda ni RSS.** Publicar y retirar,
  portada, URL canónica y salida HTML estática sí están construidos.
- **La búsqueda no cubre valores de propiedad.** Falta `properties_fts`, ya
  declarado en el esquema.
- **Las personas no se autentican ante Vera.** Sin credencial, todo lo que llega
  se firma como la persona propietaria.

---

*Original: «Vera — Manual» (`page:110183`), última edición 2026-08-09. Proyectado
a este repositorio el 2026-08-11.*
