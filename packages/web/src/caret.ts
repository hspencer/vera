// Dónde cae el cursor y qué hay que mover para que se le vea.
//
// Ver specs/block-editing.allium, contract FluidBlockEditing: @invariant
// TheCaretBeginsWhereItWasPut y @invariant WhatIsBeingWrittenStaysInSight.
//
// Las dos preguntas que este archivo contesta son geométricas y no tienen nada
// de DOM, así que viven aquí y se prueban sin navegador. Lo que sí necesita DOM
// —medir dónde está la línea del cursor, mover el contenedor— se queda en el
// outliner, que es quien tiene los elementos, y llama a esto para decidir.

/**
 * Un espacio es un espacio.
 *
 * El texto dibujado no conserva los blancos del fuente: el navegador colapsa
 * una tira de espacios en uno, un salto de línea se vuelve espacio, y un `&nbsp;`
 * no es el mismo carácter que el que se tecleó. Comparar el blanco exacto haría
 * que el emparejamiento se descarrilara en el primer párrafo con sangría.
 */
function blank(character: string): string {
  return /\s/.test(character) ? ' ' : character;
}

/**
 * Cuánto marcado se admite entre dos caracteres visibles.
 *
 * Un enlace `[palabra](una-dirección-larguísima)` mete su dirección entera entre
 * la última letra del rótulo y la primera del texto que sigue, así que el límite
 * no puede ser corto. Existe para lo otro: cuando el emparejamiento se pierde,
 * el siguiente carácter buscado aparece cientos de posiciones más allá y sin
 * tope el cursor acabaría en un sitio arbitrario del bloque en vez de admitir
 * que no se supo.
 */
const MARKUP = 400;

/**
 * La posición en el Markdown fuente que corresponde a una posición en lo dibujado.
 *
 * Lo dibujado y su fuente son dos vistas de un solo texto y no el mismo texto:
 * `**hoy**` se lee `hoy`, `[[Amereida]]` se lee `Amereida`, `[ ] comprar` se lee
 * `comprar`. Señalar una palabra sobre lo dibujado es señalarla en el fuente, y
 * lo que hay entre medias es lo que hay que saltar.
 *
 * Se recorren los dos a la vez emparejando caracteres visibles: cuando no
 * coinciden, lo que sobra es marcado y avanza sólo el fuente. Es la misma idea
 * que un alineamiento de dos secuencias, sin el coste de uno: aquí una de las
 * dos es subsecuencia de la otra salvo por lo que el renderizado añade de su
 * cosecha —el rótulo de un bloque citado, el número de una lista—, y de eso se
 * lleva la cuenta.
 *
 * Devuelve `null` cuando no se pudo alinear con confianza. Es deliberado que
 * pueda: una posición inventada es peor que ninguna, porque quien escriba en
 * ella no tendrá modo de saber que el cursor no estaba donde parecía.
 */
export function sourceOffsetFor(source: string, visible: string, at: number): number | null {
  const upto = Math.max(0, Math.min(at, visible.length));
  // El final es el final. Sin esto, pulsar detrás de la última palabra de un
  // texto que termina en marcado —`**así**`— dejaría el cursor delante de los
  // asteriscos, y escribir ahí seguiría en negrita.
  if (upto === visible.length) return source.length;

  let found = 0;
  let missed = 0;
  let index = 0;
  while (index < upto) {
    /*
     * Una tira de blancos vale por otra tira de blancos.
     *
     * Y las dos son tiras, que es lo que costó ver: el fuente lleva saltos de
     * línea y sangrías, y lo dibujado lleva los suyos —dos espacios donde un
     * párrafo empieza sangrado, ninguno donde dos bloques se tocan—. Emparejar
     * blanco a blanco descarrilaba en el primer párrafo de una lista: el
     * segundo espacio dibujado no encontraba blanco delante, se iba a buscar el
     * siguiente y se saltaba una palabra entera, y de ahí en adelante el
     * desfase crecía palabra a palabra hasta que la cuenta se declaraba perdida.
     */
    if (blank(visible[index] ?? '') === ' ') {
      while (index < upto && blank(visible[index] ?? '') === ' ') index += 1;
      let probe = found;
      while (probe < source.length && blank(source[probe] ?? '') !== ' ') probe += 1;
      if (probe >= source.length || probe - found > MARKUP) {
        // Lo dibujado separa donde el fuente no separa. Se sigue desde donde se
        // estaba, sin contarlo como perdido: no hay nada que buscar.
        continue;
      }
      found = probe;
      while (found < source.length && blank(source[found] ?? '') === ' ') found += 1;
      continue;
    }

    const want = visible[index] ?? '';
    let probe = found;
    while (probe < source.length && source[probe] !== want) probe += 1;
    if (probe >= source.length || probe - found > MARKUP) {
      // Ese carácter no está en el fuente: lo puso el dibujo. Se cuenta y se
      // sigue, porque uno solo no invalida el resto.
      missed += 1;
      index += 1;
      continue;
    }
    found = probe + 1;
    index += 1;
  }

  // Un cuarto de desajuste ya no es marcado: es que lo dibujado no viene de este
  // texto. Pasa con un bloque cuyo cuerpo es una tabla, un diagrama o la
  // respuesta a una consulta, y ahí el sitio pulsado no dice nada del fuente.
  if (missed * 4 > upto) return null;

  /*
   * Y por último, delante de lo que se señaló y no detrás de lo anterior.
   *
   * Contar lo que queda atrás deja el cursor pegado al último carácter contado,
   * que no es lo mismo cuando entre él y el que se pulsó hay marcado: se pulsa
   * la primera letra de un ítem de una lista y el cursor cae al final del ítem
   * anterior, seis caracteres antes, del otro lado del salto de línea. Mirar
   * cuál es el carácter señalado y buscarlo cierra esa distancia.
   */
  const next = visible[upto] ?? '';
  if (next !== '' && blank(next) !== ' ') {
    let probe = found;
    while (probe < source.length && source[probe] !== next) probe += 1;
    if (probe < source.length && probe - found <= MARKUP) return probe;
  }
  return found;
}

/** Lo que hace falta saber para decidir si algo se mueve, y cuánto. */
export interface Sight {
  /** Dónde empieza el editor, medido desde el borde de arriba del visor. */
  top: number;
  /** Lo que mide el editor, que es lo que mide su texto. */
  height: number;
  /** A qué altura, dentro del editor, está la línea del cursor. */
  caret: number;
  /** Lo que mide una línea, para que quepa entera y no por la mitad. */
  line: number;
  /** Lo que mide el visor. */
  view: number;
  /** Lo que se respeta arriba, para no dejar el texto pegado al canto. */
  margin: number;
  /** Zona superior ocupada por controles flotantes o persistentes. */
  topInset?: number;
}

/**
 * Cuánto sitio se deja por debajo de la línea que se escribe.
 *
 * Un tercio del visor. Escribir es mirar lo que viene, y lo que viene está
 * debajo: con la línea pegada al borde inferior se cumple la letra de que se ve
 * y no la intención. No es una cantidad fija en píxeles porque en un teléfono
 * apaisado un tercio son tres renglones y en una pantalla de escritorio son
 * quince, y las dos veces es «holgado».
 */
const COMFORT = 1 / 3;

/**
 * Cuánto hay que desplazar el contenedor para que se vea lo que se escribe.
 *
 * Positivo baja, negativo sube, cero no hace nada — y cero es la respuesta
 * corriente: lo que no hace falta mover no se mueve. Un editor que recoloca la
 * página en cada pulsación es más difícil de leer que uno que la deja quieta.
 *
 * Dos casos y no uno. Un bloque que cabe entero en el visor se trata como una
 * unidad: se enseña entero, que es lo que uno quiere ver del párrafo que está
 * corrigiendo. Uno más alto que el visor no puede enseñarse entero, así que lo
 * que manda es la línea del cursor. @invariant WhatIsBeingWrittenStaysInSight.
 */
export function scrollDeltaFor(sight: Sight): number {
  const { top, height, caret, line, view, margin } = sight;
  const topMargin = Math.max(margin, sight.topInset ?? 0);

  if (height + topMargin + margin <= view) {
    if (top < topMargin) return top - topMargin;
    const bottom = top + height;
    if (bottom > view - margin) return bottom - (view - margin);
    return 0;
  }

  // La banda cómoda: por arriba, el margen de siempre; por abajo, un tercio del
  // visor libre. Dentro de ella no se mueve nada, y al salir se vuelve al borde
  // de la banda y no al centro: corregir de más es un salto que nadie pidió.
  const comfort = Math.max(margin, view * COMFORT);
  const y = top + caret;
  if (y < topMargin) return y - topMargin;
  if (y + line > view - comfort) return y + line - (view - comfort);
  return 0;
}
